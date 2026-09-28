-- 010300: TÀI KHOẢN BẤT THƯỜNG (Quản trị → Người dùng → Tài khoản bất thường)
-- Gom các dấu hiệu dùng chung tài khoản / nuôi nhiều tài khoản / ăn gian Xu thành một danh sách cho admin xem và khóa:
--   • TWO_PLACES     hai bài chạy cùng lúc ở hai nơi cách nhau > 2 km (một tài khoản, hai người chạy)
--   • SHARED_DEVICE  một thiết bị đăng nhập nhiều tài khoản (theo đăng ký thông báo đẩy; chỉ lưu mã băm, không lưu địa chỉ)
--   • OVERLAP        nhiều bài bị loại vì trùng giờ với bài khác (009900)
--   • REFERRAL_FARM  mời ≥ 3 người đã nhận thưởng giới thiệu nhưng mỗi người chỉ chạy ≤ 1 bài (nghi tự tạo tài khoản ảo)
--   • SUSPICIOUS     nhiều bài nghi vấn nặng (điểm rủi ro ≥ 50) bị giữ hoặc bị từ chối
-- Chỉ là gợi ý để admin xem xét — không tự khóa ai. Điểm 0–100, chỉ liệt kê từ 20 điểm.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create table if not exists private.device_links (
  device text not null,                          -- md5(endpoint thông báo đẩy): nhận ra cùng máy, không lộ địa chỉ
  user_id uuid not null references public.profiles(id) on delete cascade,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (device, user_id)
);
create index if not exists device_links_user_idx on private.device_links (user_id);
revoke all on private.device_links from public, anon, authenticated;

create or replace function private.track_device_link() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into private.device_links (device, user_id) values (md5(new.endpoint), new.user_id)
  on conflict (device, user_id) do update set last_seen = now();
  return new;
end $$;

drop trigger if exists trg_push_device_link on public.push_subscriptions;
create trigger trg_push_device_link after insert or update of user_id, last_seen_at on public.push_subscriptions
  for each row execute function private.track_device_link();

-- Thiết bị đang đăng ký hiện có
insert into private.device_links (device, user_id, first_seen, last_seen)
select md5(s.endpoint), s.user_id, s.created_at, s.last_seen_at from public.push_subscriptions s
on conflict (device, user_id) do nothing;

create or replace function public.admin_account_risks(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
begin
  return (
    with dup as (
      select a.user_id, count(*) as n from public.activities a
       where a.created_at >= v_since and a.validation_reason = 'Trùng giờ với bài chạy khác.' group by 1
    ), two as (
      select a.user_id, count(*) as n
        from public.activities a
        join public.activities b on b.user_id = a.user_id and b.id > a.id
             and b.started_at < coalesce(a.ended_at, a.started_at) and coalesce(b.ended_at, b.started_at) > a.started_at
        join public.activity_details da on da.activity_id = a.id
        join public.activity_details db on db.activity_id = b.id
       where a.started_at >= v_since and coalesce(a.status, '') <> 'DELETED' and coalesce(b.status, '') <> 'DELETED'
         and da.start_lat is not null and db.start_lat is not null
         and private.haversine_m(da.start_lat, da.start_lng, db.start_lat, db.start_lng) > 2000
       group by 1
    ), sus as (
      select a.user_id, count(*) as n from public.activities a
       where a.created_at >= v_since and a.validation_status in ('PENDING', 'REJECTED') and coalesce(a.risk_score, 0) >= 50
       group by 1
    ), dev as (
      select l.user_id, count(distinct o.user_id) as n
        from private.device_links l join private.device_links o on o.device = l.device and o.user_id <> l.user_id
       where l.last_seen >= v_since and o.last_seen >= v_since
       group by 1
    ), ref as (
      select p.referred_by as user_id, count(*) as n
        from public.profiles p
       where p.referred_by is not null and p.created_at >= v_since
         and exists (select 1 from public.ledger_transactions t where t.idempotency_key = 'referral_inviter:' || p.id)
         and (select count(*) from public.activities x
               where x.user_id = p.id and x.validation_status = 'APPROVED' and coalesce(x.status, '') <> 'DELETED') <= 1
       group by 1 having count(*) >= 3
    ), ids as (
      select user_id from dup union select user_id from two union select user_id from sus
      union select user_id from dev union select user_id from ref
    ), scored as (
      select i.user_id, coalesce(two.n, 0) as two, coalesce(dev.n, 0) as dev, coalesce(dup.n, 0) as dup,
             coalesce(ref.n, 0) as ref, coalesce(sus.n, 0) as sus,
             least(coalesce(two.n, 0) * 40, 80) + least(coalesce(dev.n, 0) * 25, 50) + least(coalesce(dup.n, 0) * 10, 40)
             + least(coalesce(ref.n, 0) * 10, 50) + least(coalesce(sus.n, 0) * 5, 30) as score
        from ids i
        left join two on two.user_id = i.user_id left join dev on dev.user_id = i.user_id left join dup on dup.user_id = i.user_id
        left join ref on ref.user_id = i.user_id left join sus on sus.user_id = i.user_id
    ), ranked as (
      select s.*, row_number() over (order by s.score desc, s.user_id) as rn from scored s where s.score >= 20
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', r.user_id, 'name', pr.display_name, 'avatar_url', pr.avatar_url, 'email', au.email,
        'banned', pr.banned_at is not null, 'score', least(r.score, 100),
        'flags', (select coalesce(jsonb_agg(jsonb_build_object('code', v.code, 'count', v.n) order by v.ord), '[]'::jsonb)
                    from (values (1, 'TWO_PLACES', r.two), (2, 'SHARED_DEVICE', r.dev), (3, 'OVERLAP', r.dup),
                                 (4, 'REFERRAL_FARM', r.ref), (5, 'SUSPICIOUS', r.sus)) v(ord, code, n)
                   where v.n > 0))
        order by r.score desc, r.user_id), '[]'::jsonb)
      from ranked r
      join public.profiles pr on pr.id = r.user_id
      left join auth.users au on au.id = r.user_id
     where r.rn <= 200
  );
end $$;

revoke all on function private.track_device_link() from public, anon, authenticated;
revoke all on function public.admin_account_risks(integer) from public, anon;
grant execute on function public.admin_account_risks(integer) to authenticated;

notify pgrst, 'reload schema';
