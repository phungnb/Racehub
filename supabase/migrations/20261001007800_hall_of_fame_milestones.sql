-- 007800: Đại sảnh danh vọng của CLB + cột mốc tự đăng bảng tin — học từ Tucana ("Marathon Hall of Fame", milestones).
-- • Cột mốc (user_milestones): 100 / 500 / 1.000 / 2.000 / 5.000 / 10.000 km tích luỹ, Half Marathon đầu tiên (≥ 21,1 km một bài),
--   Full Marathon đầu tiên (≥ 42,2 km), Ultra đầu tiên (≥ 50 km). Chạm mốc bằng một bài HỢP LỆ và ĐANG CHIA SẺ → mỗi CLB
--   runner đang là thành viên có một bài "cột mốc" trên bảng tin (thành viên vào cổ vũ / tặng quà như bài thường).
--   Mốc đã đạt trước khi chạy migration được ghi nhận lặng lẽ (không đăng bài dồn dập).
-- • Đại sảnh (club_hall_of_fame): người hoàn thành Full / Half Marathon, kỷ lục CLB 5K / 10K / 21K / 42K (ước tính từ bài chạy có
--   cự ly sát mốc), BXH km trong năm, cột mốc gần đây. Chỉ tính bài hợp lệ + đang chia sẻ.
-- • Lỗi ở phần này không bao giờ làm hỏng việc nhận bài chạy (ghi vào nhật ký lỗi 006900).
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT. Chạy lại nhiều lần vẫn an toàn.

alter table public.club_posts drop constraint if exists club_posts_kind_check;
alter table public.club_posts add constraint club_posts_kind_check
  check (kind in ('POST', 'ANNOUNCEMENT', 'AUTO_RUN', 'AUTO_JOIN', 'RECAP', 'CHALLENGE', 'NEWS', 'MILESTONE'));

create table if not exists public.user_milestones (
  user_id uuid not null references public.profiles(id) on delete cascade,
  code text not null,
  activity_id uuid references public.activities(id) on delete set null,
  total_km numeric,
  reached_at timestamptz not null default now(),
  primary key (user_id, code)
);
alter table public.user_milestones enable row level security;
revoke all on public.user_milestones from anon, authenticated;

create or replace function private.milestone_defs() returns table (code text, need_m numeric, single boolean, label text, sort integer)
language sql immutable as $$
  values ('KM_100', 100000::numeric, false, 'đạt 100 km cùng RaceHub', 10), ('KM_500', 500000, false, 'đạt 500 km', 20),
         ('KM_1000', 1000000, false, 'cán mốc 1.000 km', 30), ('KM_2000', 2000000, false, 'cán mốc 2.000 km', 40),
         ('KM_5000', 5000000, false, 'cán mốc 5.000 km', 50), ('KM_10000', 10000000, false, 'cán mốc 10.000 km', 60),
         ('FIRST_HM', 21097.5, true, 'hoàn thành Half Marathon đầu tiên', 70),
         ('FIRST_FM', 42195, true, 'hoàn thành Full Marathon đầu tiên', 80),
         ('FIRST_ULTRA', 50000, true, 'chinh phục Ultra (≥ 50 km) đầu tiên', 90)
$$;

create or replace function private.countable_km_m(p_user uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(x.distance_m), 0) from public.activities x
   where x.user_id = p_user and x.validation_status = 'APPROVED' and public.activity_is_countable(x.status, x.validation_status)
$$;

create or replace function private.check_milestones(p_user uuid, p_activity uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  a public.activities := (select x from public.activities x where x.id = p_activity);
  v_total numeric := private.countable_km_m(p_user);
  v_name text := private.display_name(p_user);
  d record;
  c record;
  n integer := 0;
begin
  if a.id is null or a.user_id <> p_user or not a.shared or a.validation_status is distinct from 'APPROVED'
     or not public.activity_is_countable(a.status, a.validation_status) then
    return 0;
  end if;
  for d in select * from private.milestone_defs() m
            where (not m.single and v_total >= m.need_m) or (m.single and coalesce(a.distance_m, 0) >= m.need_m)
            order by m.sort loop
    insert into public.user_milestones (user_id, code, activity_id, total_km) values (p_user, d.code, a.id, round(v_total / 1000, 1))
    on conflict (user_id, code) do nothing;
    if found then
      n := n + 1;
      for c in select cm.club_id from public.club_members cm where cm.user_id = p_user and cm.status = 'APPROVED' loop
        insert into public.club_posts (club_id, author_id, kind, title, body, activity_id, meta)
        values (c.club_id, p_user, 'MILESTONE', v_name || ' ' || d.label, '', a.id,
                jsonb_build_object('code', d.code, 'total_km', round(v_total / 1000, 1), 'distance_m', a.distance_m,
                                   'moving_s', a.moving_time_s, 'activity_id', a.id));
      end loop;
    end if;
  end loop;
  return n;
end $$;

create or replace function private.milestones_on_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null and new.validation_status = 'APPROVED' and new.shared
     and public.activity_is_countable(new.status, new.validation_status) then
    begin
      perform private.check_milestones(new.user_id, new.id);
    exception when others then
      perform private.log_notify_error('milestone', 'MILESTONE', new.user_id, sqlstate, sqlerrm);
    end;
  end if;
  return null;
end $$;
drop trigger if exists trg_milestones_on_activity on public.activities;
create trigger trg_milestones_on_activity after insert or update of validation_status, status, shared on public.activities
  for each row execute function private.milestones_on_activity();

-- Ghi nhận lặng lẽ các mốc đã đạt trước đó (không đăng bài)
insert into public.user_milestones (user_id, code, total_km)
select t.user_id, m.code, round(t.total / 1000, 1)
  from (select x.user_id, sum(x.distance_m) as total from public.activities x
         where x.user_id is not null and x.validation_status = 'APPROVED' and public.activity_is_countable(x.status, x.validation_status)
         group by x.user_id) t
  join private.milestone_defs() m on not m.single and t.total >= m.need_m
on conflict (user_id, code) do nothing;
insert into public.user_milestones (user_id, code, activity_id)
select distinct on (x.user_id, m.code) x.user_id, m.code, x.id
  from public.activities x join private.milestone_defs() m on m.single and x.distance_m >= m.need_m
 where x.user_id is not null and x.validation_status = 'APPROVED' and public.activity_is_countable(x.status, x.validation_status)
 order by x.user_id, m.code, x.started_at
on conflict (user_id, code) do nothing;

-- Đại sảnh danh vọng của CLB
create or replace function public.club_hall_of_fame(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_year timestamptz := date_trunc('year', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh';
begin
  if not public.club_is_member(p_club_id) then raise exception 'NOT_A_MEMBER'; end if;
  return (
    with mem as (
      select m.user_id from public.club_members m where m.club_id = p_club_id and m.status = 'APPROVED'
    ), runs as (
      select x.id, x.user_id, x.distance_m, x.moving_time_s, x.started_at
        from public.activities x join mem on mem.user_id = x.user_id
       where x.validation_status = 'APPROVED' and x.shared and public.activity_is_countable(x.status, x.validation_status)
         and coalesce(x.distance_m, 0) > 0
    ), finishers as (
      select r.user_id, d.kind, count(*)::int as times, min(r.started_at) as first_at,
             min(case when r.distance_m <= d.need * 1.06 and r.moving_time_s > 0 then round(r.moving_time_s * d.need / r.distance_m) end)::int as best_s
        from runs r join (values ('FM', 42195::numeric), ('HM', 21097.5)) d(kind, need) on r.distance_m >= d.need
       group by r.user_id, d.kind
    ), rec as (
      select d.label, d.need, r.user_id, min(round(r.moving_time_s * d.need / r.distance_m))::int as best_s
        from runs r join (values ('5K', 5000::numeric), ('10K', 10000), ('21K', 21097.5), ('42K', 42195)) d(label, need)
          on r.distance_m >= d.need and r.distance_m <= d.need * 1.05 and r.moving_time_s > 0
       group by d.label, d.need, r.user_id
    ), rec_ranked as (
      select rec.*, row_number() over (partition by rec.label order by rec.best_s) as rn from rec
    ), yr as (
      select r.user_id, sum(r.distance_m) as distance_m, count(*)::int as runs,
             row_number() over (order by sum(r.distance_m) desc) as rn
        from runs r where r.started_at >= v_year group by r.user_id
    ), ms as (
      select um.user_id, um.code, um.reached_at, row_number() over (order by um.reached_at desc) as rn
        from public.user_milestones um join mem on mem.user_id = um.user_id
       where um.activity_id is not null
    )
    select jsonb_build_object(
      'marathon', coalesce((select jsonb_agg(jsonb_build_object('user_id', f.user_id, 'name', private.display_name(f.user_id),
                    'avatar_url', p.avatar_url, 'times', f.times, 'first_at', f.first_at, 'best_s', f.best_s) order by f.first_at)
                  from finishers f join public.profiles p on p.id = f.user_id where f.kind = 'FM'), '[]'::jsonb),
      'half', coalesce((select jsonb_agg(jsonb_build_object('user_id', f.user_id, 'name', private.display_name(f.user_id),
                    'avatar_url', p.avatar_url, 'times', f.times, 'first_at', f.first_at, 'best_s', f.best_s) order by f.first_at)
                  from finishers f join public.profiles p on p.id = f.user_id where f.kind = 'HM'), '[]'::jsonb),
      'records', coalesce((select jsonb_agg(jsonb_build_object('label', rr.label, 'rank', rr.rn, 'user_id', rr.user_id,
                    'name', private.display_name(rr.user_id), 'avatar_url', p.avatar_url, 'best_s', rr.best_s) order by rr.need, rr.rn)
                  from rec_ranked rr join public.profiles p on p.id = rr.user_id where rr.rn <= 3), '[]'::jsonb),
      'year', coalesce((select jsonb_agg(jsonb_build_object('rank', y.rn, 'user_id', y.user_id, 'name', private.display_name(y.user_id),
                    'avatar_url', p.avatar_url, 'distance_m', y.distance_m, 'runs', y.runs) order by y.rn)
                  from yr y join public.profiles p on p.id = y.user_id where y.rn <= 10), '[]'::jsonb),
      'milestones', coalesce((select jsonb_agg(jsonb_build_object('user_id', ms.user_id, 'name', private.display_name(ms.user_id),
                    'avatar_url', p.avatar_url, 'code', ms.code, 'label', d.label, 'reached_at', ms.reached_at) order by ms.reached_at desc)
                  from ms join public.profiles p on p.id = ms.user_id join private.milestone_defs() d on d.code = ms.code
                 where ms.rn <= 20), '[]'::jsonb),
      'year_start', v_year));
end $$;

revoke all on function private.milestone_defs(), private.countable_km_m(uuid), private.check_milestones(uuid, uuid),
  private.milestones_on_activity() from public, anon, authenticated;
revoke all on function public.club_hall_of_fame(uuid) from public, anon;
grant execute on function public.club_hall_of_fame(uuid) to authenticated;

notify pgrst, 'reload schema';
