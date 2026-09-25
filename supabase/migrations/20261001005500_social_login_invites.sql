-- 005500: Đăng nhập Google / Apple + lời mời chuyên nghiệp.
-- • Hồ sơ mới: lấy tên / ảnh từ Google, Apple (full_name, name, picture) hoặc tên nhập lúc đăng ký email (display_name).
--   Trước đây đăng ký email luôn ra tên = phần trước @ của email. Email ẩn của Apple (privaterelay) → "Runner".
-- • Mã giới thiệu ngắn, dễ đọc (8 ký tự, không có 0/O/1/I): link mời /join/<mã> thay cho /join/<uuid dài>.
--   Nhập mã ở màn đăng ký hoặc Tôi → Mời bạn bè (trong 14 ngày đầu). Link cũ /join/<uuid> vẫn dùng được.
-- • my_referral(): mã, số bạn đã mời / đã nhận thưởng / Xu đã nhận, luật thưởng hiện hành.
-- • Xem trước lời mời khi CHƯA đăng nhập: referral_preview (tên người mời), club_invite_preview (tên, logo, số thành viên CLB).
-- Cần 000300, 003400, 003700. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 1. Hồ sơ mới từ đăng ký email / Google / Apple
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_name text := coalesce(
    nullif(left(trim(m->>'display_name'), 60), ''), nullif(left(trim(m->>'full_name'), 60), ''), nullif(left(trim(m->>'name'), 60), ''),
    case when new.email is not null and new.email not ilike '%privaterelay.appleid.com' and new.email not ilike '%@phone.racehub.vn'
         then nullif(split_part(new.email, '@', 1), '') end,
    'Runner');
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, v_name, coalesce(nullif(m->>'avatar_url', ''), nullif(m->>'picture', '')))
  on conflict (id) do nothing;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2. Mã giới thiệu ngắn
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists referral_code text;
create unique index if not exists profiles_referral_code_key on public.profiles (referral_code);

-- 8 ký tự từ bảng 32 chữ dễ đọc, suy ra cố định từ id (2^40 tổ hợp) — chạy lại vẫn ra đúng mã cũ
create or replace function private.referral_code_for(p_id uuid, p_salt int default 0) returns text
language sql immutable as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', ((n >> (5 * i)) & 31)::int + 1, 1), '' order by i)
    from (select ('x' || substr(md5(p_id::text || case when p_salt > 0 then ':' || p_salt else '' end), 1, 10))::bit(40)::bigint as n) s,
         generate_series(0, 7) as i
$$;

create or replace function private.assign_referral_code() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_code text; v_salt int := 0;
begin
  if new.referral_code is not null then return new; end if;
  loop
    v_code := private.referral_code_for(new.id, v_salt);
    exit when not exists (select 1 from public.profiles p where p.referral_code = v_code and p.id <> new.id);
    v_salt := v_salt + 1;
  end loop;
  new.referral_code := v_code;
  return new;
end $$;
drop trigger if exists trg_assign_referral_code on public.profiles;
create trigger trg_assign_referral_code before insert or update of referral_code on public.profiles
  for each row execute function private.assign_referral_code();
-- Cấp mã cho tài khoản cũ (trigger tự tính mã khi đặt về null)
update public.profiles set referral_code = null where referral_code is null;

-- Tìm người mời theo mã ngắn hoặc uuid (link cũ)
create or replace function private.referrer_by_code(p_code text) returns uuid
language sql stable security definer set search_path = public as $$
  select p.id from public.profiles p
   where p.referral_code = upper(trim(coalesce(p_code, '')))
      or (trim(coalesce(p_code, '')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and p.id = trim(p_code)::uuid)
$$;

create or replace function public.apply_referral_code(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ref uuid := private.referrer_by_code(p_code);
begin
  perform private.require_uid();
  if v_ref is null then raise exception 'REFERRER_NOT_FOUND'; end if;
  return public.apply_referral(v_ref) || jsonb_build_object('referrer_name', private.display_name(v_ref));
end $$;

create or replace function public.referral_preview(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when r.id is null then null else jsonb_build_object(
    'display_name', r.display_name, 'avatar_url', r.avatar_url, 'code', r.referral_code,
    'referee_xu', coalesce((private.economy_config()->'referral'->>'refereeXu')::numeric, 0),
    'min_km', coalesce((private.economy_config()->'referral'->>'minKm')::numeric, 3)) end
    from (select p.id, p.display_name, p.avatar_url, p.referral_code from public.profiles p where p.id = private.referrer_by_code(p_code)) r
    right join (select 1) one on true
$$;

create or replace function public.my_referral() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  me public.profiles := (select p from public.profiles p where p.id = v_uid);
  cfg jsonb := private.economy_config()->'referral';
begin
  return jsonb_build_object(
    'code', me.referral_code,
    'invited', (select count(*) from public.profiles p where p.referred_by = v_uid),
    'rewarded', (select count(*) from public.ledger_transactions t join public.ledger_entries e on e.transaction_id = t.id
                  where t.type = 'REFERRAL_INVITER' and e.account_id = v_uid and e.amount > 0),
    'xu_earned', (select coalesce(sum(e.amount), 0) from public.ledger_transactions t join public.ledger_entries e on e.transaction_id = t.id
                  where t.type = 'REFERRAL_INVITER' and e.account_id = v_uid and e.amount > 0),
    'friends', (select coalesce(jsonb_agg(jsonb_build_object('display_name', x.display_name, 'avatar_url', x.avatar_url, 'joined_at', x.created_at,
                  'rewarded', exists (select 1 from public.ledger_transactions t where t.idempotency_key = 'referral_inviter:' || x.id)) order by x.created_at desc), '[]'::jsonb)
                  from (select p.id, p.display_name, p.avatar_url, p.created_at, row_number() over (order by p.created_at desc) as rn
                          from public.profiles p where p.referred_by = v_uid) x where x.rn <= 50),
    'referred_by', (select jsonb_build_object('display_name', r.display_name, 'avatar_url', r.avatar_url) from public.profiles r where r.id = me.referred_by),
    'can_enter_code', me.referred_by is null and me.created_at >= now() - interval '14 days',
    'enter_until', case when me.referred_by is null then me.created_at + interval '14 days' end,
    'rules', jsonb_build_object('inviter_xu', coalesce((cfg->>'inviterXu')::numeric, 0), 'referee_xu', coalesce((cfg->>'refereeXu')::numeric, 0),
                                'min_km', coalesce((cfg->>'minKm')::numeric, 3), 'monthly_cap', coalesce((cfg->>'monthlyCap')::int, 10)));
end $$;

-- ---------------------------------------------------------------------
-- 3. Xem trước lời mời CLB (chưa đăng nhập cũng xem được; không trả mã mời)
-- ---------------------------------------------------------------------
create or replace function public.club_invite_preview(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when c.id is null then null else jsonb_build_object(
    'id', c.id, 'name', c.name, 'description', left(c.description, 280), 'avatar_url', c.avatar_url, 'accent_color', c.accent_color,
    'member_count', c.member_count, 'join_policy', c.join_policy, 'plan', c.plan,
    'full', c.member_count >= coalesce(c.member_limit, 2147483647),
    'my_status', (select m.status from public.club_members m where m.club_id = c.id and m.user_id = auth.uid())) end
    from (select x.* from public.clubs x where x.invite_code = lower(trim(coalesce(p_code, '')))) c
    right join (select 1) one on true
$$;

revoke all on function private.referral_code_for(uuid, int), private.assign_referral_code(), private.referrer_by_code(text) from public, anon, authenticated;
revoke all on function public.apply_referral_code(text), public.my_referral(), public.referral_preview(text), public.club_invite_preview(text) from public, anon;
grant execute on function public.apply_referral_code(text), public.my_referral() to authenticated;
grant execute on function public.referral_preview(text), public.club_invite_preview(text) to anon, authenticated;

notify pgrst, 'reload schema';
