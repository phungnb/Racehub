-- RaceHub — PHẦN 09/14 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 007000, 007100, 007200, 007300, 007400, 007500
-- Supabase → SQL Editor → New query → dán TOÀN BỘ phần này → Run. Lỗi thì không có gì thay đổi; chạy lại vẫn an toàn.
-- Xong thì chạy phần tiếp theo.
begin;
-- ===================================================================
-- 20261001007000_strava_share_consent.sql
-- ===================================================================
-- 007000: Hướng B+ — bài chạy từ Strava chỉ hiện cho người khác khi runner ĐỒNG Ý (Thoả thuận API Strava 11/2024).
-- Cách làm: cột activities.shared (được chia sẻ cho người khác) tính theo:
--   bài không từ Strava → luôn chia sẻ; bài Strava → theo chính sách chung (admin chọn) và đồng ý của runner:
--     OPT_IN (mặc định): runner bật "Hiện bài Strava" mới chia sẻ · OWNER_ONLY (hướng A): không bao giờ · ALL (hướng B cũ): luôn.
-- Bài KHÔNG chia sẻ vẫn tính đầy đủ cho CHÍNH runner (Xu, XP, huy hiệu, chuỗi tuần, nhiệm vụ, thống kê cá nhân) nhưng
-- không lên: bảng tin CLB, BXH CLB / CLB đấu CLB / thách đấu, thử thách, giải chạy ảo, league, vinh danh, điểm danh tự động,
-- pace trên Quanh đây, hồ sơ công khai, danh sách chờ duyệt của ban quản trị CLB (admin hệ thống vẫn thấy để duyệt).
-- Đổi đồng ý / chính sách → cập nhật shared → trigger tự thêm / gỡ khỏi thử thách đang diễn ra, giải chạy, bảng tin CLB.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT. Chạy lại nhiều lần vẫn an toàn.

alter table public.activities add column if not exists shared boolean not null default true;
alter table public.profile_settings add column if not exists strava_share boolean;
alter table public.profile_settings add column if not exists strava_share_at timestamptz;

create or replace function private.strava_share_policy() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select a.value from private.app_settings a where a.key = 'strava_share_policy'), 'OPT_IN')
$$;

create or replace function private.activity_shared(p_user uuid, p_source text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when coalesce(p_source, '') <> 'STRAVA' then true
    when private.strava_share_policy() = 'ALL' then true
    when private.strava_share_policy() = 'OWNER_ONLY' then false
    else coalesce((select s.strava_share from public.profile_settings s where s.user_id = p_user), false) end
$$;

create or replace function private.activities_set_shared() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.source is distinct from old.source or new.user_id is distinct from old.user_id then
    new.shared := private.activity_shared(new.user_id, new.source);
  end if;
  return new;
end $$;
drop trigger if exists trg_aa_activity_shared on public.activities;
create trigger trg_aa_activity_shared before insert or update of source, user_id on public.activities
  for each row execute function private.activities_set_shared();

-- Tính lại cờ chia sẻ cho bài Strava của một người (hoặc tất cả khi p_user null) → trigger phía sau tự áp dụng
create or replace function private.strava_reshare(p_user uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.activities a set shared = private.activity_shared(a.user_id, a.source)
   where a.source = 'STRAVA' and (p_user is null or a.user_id = p_user)
     and a.shared is distinct from private.activity_shared(a.user_id, a.source);
  get diagnostics n = row_count;
  return n;
end $$;

-- 1. Bảng tin CLB
create or replace function private.club_posts_on_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_vis text;
begin
  if tg_op = 'UPDATE' and new.status = 'DELETED' and old.status is distinct from 'DELETED' then
    update public.club_posts set deleted_at = now(), is_pinned = false where activity_id = new.id and deleted_at is null;
    return null;
  end if;
  -- Runner tắt chia sẻ bài Strava → gỡ bài tự động khỏi bảng tin CLB
  if tg_op = 'UPDATE' and old.shared and not new.shared then
    update public.club_posts set deleted_at = now(), is_pinned = false
     where activity_id = new.id and kind = 'AUTO_RUN' and deleted_at is null;
    return null;
  end if;
  if not new.shared then return null; end if;
  -- Bật lại chia sẻ → hiện lại bài đã gỡ (bài mới trong 3 ngày được đăng ở dưới)
  if tg_op = 'UPDATE' and not old.shared and new.shared then
    update public.club_posts set deleted_at = null where activity_id = new.id and kind = 'AUTO_RUN' and deleted_at is not null;
  end if;
  if new.validation_status is distinct from 'APPROVED' or coalesce(new.status, '') = 'DELETED' then return null; end if;
  if tg_op = 'UPDATE' and old.validation_status = 'APPROVED' and old.shared = new.shared then return null; end if;
  if new.started_at < now() - interval '3 days' then return null; end if;
  if coalesce(new.validation_reason, '') like '%chỉ lưu lịch sử%' then return null; end if;
  v_vis := (select s.activity_visibility from public.profile_settings s where s.user_id = new.user_id);
  if v_vis = 'PRIVATE' then return null; end if;

  insert into public.club_posts (club_id, author_id, kind, body, activity_id, meta, created_at)
  select m.club_id, new.user_id, 'AUTO_RUN', coalesce(new.title, ''), new.id,
         jsonb_build_object('distance_m', new.distance_m, 'moving_s', new.moving_time_s, 'avg_pace_s', new.avg_pace_s,
                            'elevation_gain_m', new.elevation_gain_m, 'source', new.source, 'started_at', new.started_at),
         now()
    from public.club_members m
   where m.user_id = new.user_id and m.status = 'APPROVED'
  on conflict (club_id, activity_id) where kind = 'AUTO_RUN' do nothing;
  return null;
end $$;

-- 2. Thử thách (BXH công khai)
create or replace function private.challenge_progress_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.validation_status = 'APPROVED' and new.shared and public.activity_is_countable(new.status, new.validation_status) then
    perform private.challenge_apply_activity(new.id);
  elsif tg_op = 'UPDATE' then
    perform private.challenge_revoke_activity(new.id);
  end if;
  return null;
end $$;

create or replace function private.challenge_apply_activity(p_activity_id uuid, p_only_participant uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  a public.activities := (select x from public.activities x where x.id = p_activity_id);
  r record;
  v_day date;
  v_km numeric;
  v_already numeric;
  v_counted numeric;
  n integer := 0;
begin
  if a.id is null or a.user_id is null or a.validation_status is distinct from 'APPROVED'
     or not public.activity_is_countable(a.status, a.validation_status) or not a.shared then
    return 0;
  end if;
  v_km := greatest(coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0), 0) / 1000.0;
  v_day := (a.started_at at time zone 'Asia/Ho_Chi_Minh')::date;

  for r in
    select p.id as pid, c.*
      from public.challenge_participants p join public.challenges c on c.id = p.challenge_id
     where p.profile_id = a.user_id and p.status in ('JOINED', 'COMPLETED')
       and (p_only_participant is null or p.id = p_only_participant)
       and c.status = 'ACTIVE'
       and a.started_at >= c.start_date and a.started_at < c.end_date
  loop
    -- Luật: cự ly tối thiểu mỗi bài (trừ chuỗi ngày — cộng dồn trong ngày), khoảng pace, bắt buộc nhịp tim
    if r.objective <> 'STREAK_DAYS' and v_km < coalesce(r.min_km, 0) then continue; end if;
    if coalesce(a.avg_pace_s, 0) > 0 and (a.avg_pace_s < coalesce(r.min_pace, 0) * 60
                                          or a.avg_pace_s > coalesce(r.max_pace, 99) * 60) then continue; end if;
    if r.require_hr and coalesce(a.avg_heartrate, 0) <= 0 then continue; end if;

    v_counted := v_km * 1000;
    if coalesce(r.daily_cap_km, 0) > 0 then
      v_already := (select coalesce(sum(e.counted_m), 0) from public.challenge_progress_events e
                     where e.participant_id = r.pid and e.day = v_day and e.activity_id <> a.id);
      v_counted := least(v_counted, greatest(r.daily_cap_km * 1000 - v_already, 0));
    end if;

    insert into public.challenge_progress_events (challenge_id, participant_id, activity_id, day, distance_m, counted_m, moving_s)
    values (r.id, r.pid, a.id, v_day, v_km * 1000, v_counted, coalesce(a.moving_time_s, 0))
    on conflict (participant_id, activity_id) do nothing;
    if found then
      perform private.challenge_recompute_participant(r.pid);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- 3. Giải chạy ảo
create or replace function private.race_evaluate(p_reg_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  g public.race_registrations := (select x from public.race_registrations x where x.id = p_reg_id);
  r public.virtual_races;
  best record;
  v_target numeric;
  v_was text;
begin
  if g.id is null or g.status = 'WITHDRAWN' then return; end if;
  r := (select x from public.virtual_races x where x.id = g.race_id);
  if r.status = 'CANCELLED' then return; end if;
  v_target := g.distance_km * 1000;
  v_was := g.status;
  for best in
    select a.id, a.distance_m, a.moving_time_s, a.started_at
      from public.activities a
     where a.user_id = g.user_id and a.validation_status = 'APPROVED' and coalesce(a.status, '') <> 'DELETED' and a.shared
       and a.started_at >= r.start_at and a.started_at < r.end_at
       and a.distance_m >= v_target * 0.99 and coalesce(a.moving_time_s, 0) > 0
     order by a.moving_time_s / a.distance_m, a.started_at
  loop
    update public.race_registrations
       set status = 'FINISHED', finish_activity_id = best.id, finish_distance_m = best.distance_m,
           finish_moving_s = best.moving_time_s,
           finish_time_s = round(best.moving_time_s * v_target / best.distance_m),
           finished_at = best.started_at
     where id = g.id;
    if v_was <> 'FINISHED' then
      perform private.notify(g.user_id, r.club_id, 'RACE_FINISHED', 'Hoàn thành ' || r.title,
        'Cự ly ' || g.distance_km || ' km · BIB ' || g.bib || '. Xem thứ hạng và nhận giấy chứng nhận.', '/races/' || r.id, null, true);
    end if;
    return;                                  -- chỉ lấy bài tốt nhất
  end loop;
  update public.race_registrations
     set status = 'REGISTERED', finish_activity_id = null, finish_distance_m = null, finish_moving_s = null,
         finish_time_s = null, finished_at = null
   where id = g.id and status = 'FINISHED';
end $$;

-- 4. League: điểm tuần chỉ tính bài được chia sẻ
create or replace function private.league_points(p_user uuid, p_week date) returns numeric
language sql stable security definer set search_path = public as $$
  select round(coalesce(sum(private.run_km(a)), 0), 2)
    from public.activities a
   where a.user_id = p_user and a.rewarded_at is not null and a.validation_status = 'APPROVED'
     and coalesce(a.status, '') <> 'DELETED' and a.shared
     and a.started_at >= private.vn_start(p_week) and a.started_at < private.vn_start(p_week + 7)
$$;

-- 5. Điểm danh sự kiện CLB tự động
create or replace function private.event_auto_checkin() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  e record;
  v_lat numeric;
  v_lng numeric;
begin
  if new.user_id is null or new.rewarded_at is null or old.rewarded_at is not null or new.started_at is null or not new.shared then return new; end if;
  begin
    v_lat := (select (array_agg(t.latitude order by t.sequence))[1] from public.activity_track_points t where t.activity_id = new.id);
    v_lng := (select (array_agg(t.longitude order by t.sequence))[1] from public.activity_track_points t where t.activity_id = new.id);
    for e in select ev.* from public.club_events ev
               join public.club_members m on m.club_id = ev.club_id and m.user_id = new.user_id and m.status = 'APPROVED'
              where ev.status = 'SCHEDULED'
                and new.started_at between ev.starts_at - interval '30 minutes' and ev.starts_at + interval '30 minutes' loop
      if e.lat is not null and v_lat is not null then
        if private.haversine_m(v_lat, v_lng, e.lat::numeric, e.lng::numeric) <= 500 then
          perform private.event_mark_checkin(e.id, new.user_id, 'AUTO', new.id);
        end if;
      elsif exists (select 1 from public.club_event_rsvps r where r.event_id = e.id and r.user_id = new.user_id and r.status in ('GOING', 'MAYBE')) then
        perform private.event_mark_checkin(e.id, new.user_id, 'AUTO', new.id);
      end if;
    end loop;
  exception when others then
    raise warning 'event_auto_checkin: %', sqlerrm;         -- không bao giờ chặn việc ghi bài chạy
  end;
  return new;
end $$;

-- 6. Bảng xếp hạng, CLB đấu CLB, thách đấu, tổng kết tuần
create or replace function public.club_leaderboard(p_club_id uuid, p_period text default 'WEEK')
returns table (
  rank integer, user_id uuid, display_name text, avatar_url text, level integer, role text,
  distance_m numeric, run_count integer, moving_s bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.club_is_member(p_club_id) then raise exception 'NOT_A_MEMBER'; end if;
  if upper(coalesce(p_period, '')) not in ('WEEK', 'MONTH', 'ALL') then raise exception 'INVALID_PERIOD'; end if;
  return query
  with totals as (
    select m.user_id, m.role,
           coalesce(sum(a.distance_m), 0)::numeric as distance_m,
           count(a.id)::int as run_count,
           coalesce(sum(a.moving_time_s), 0)::bigint as moving_s
      from public.club_members m
      left join public.activities a
        on a.user_id = m.user_id and a.validation_status = 'APPROVED' and a.shared
       and coalesce(a.status, '') <> 'DELETED' and a.started_at >= private.period_start(p_period)
     where m.club_id = p_club_id and m.status = 'APPROVED'
     group by m.user_id, m.role
  )
  select (rank() over (order by t.distance_m desc))::int, t.user_id, private.display_name(t.user_id),
         pr.avatar_url, coalesce(pr.level, 1)::int, t.role, t.distance_m, t.run_count, t.moving_s
    from totals t join public.profiles pr on pr.id = t.user_id
   order by t.distance_m desc, t.run_count desc, pr.display_name;
end $$;

create or replace function public.club_rankings(p_period text default 'MONTH') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_from timestamptz;
  f numeric := case upper(coalesce(p_period, '')) when 'WEEK' then 0.25 else 1 end;
begin
  if upper(coalesce(p_period, '')) not in ('WEEK', 'MONTH') then raise exception 'INVALID_PERIOD'; end if;
  v_from := private.period_start(p_period);
  return (
    with mem as (
      select m.club_id, m.user_id, m.joined_at from public.club_members m where m.status = 'APPROVED'
    ), totals as (
      select c.id, c.name, c.avatar_url, c.accent_color,
             (select count(*) from mem where mem.club_id = c.id) as members,
             coalesce((select sum(a.distance_m) from public.activities a join mem on mem.user_id = a.user_id and mem.club_id = c.id
                        where a.validation_status = 'APPROVED' and coalesce(a.status, '') <> 'DELETED' and a.shared
                          and a.started_at >= v_from and a.started_at >= coalesce(mem.joined_at, '-infinity'::timestamptz)), 0) / 1000.0 as km,
             (select count(distinct a.user_id) from public.activities a join mem on mem.user_id = a.user_id and mem.club_id = c.id
               where a.validation_status = 'APPROVED' and coalesce(a.status, '') <> 'DELETED' and a.shared and a.started_at >= v_from) as runners
        from public.clubs c
    ), ranked as (
      select t.*, round(t.km / greatest(t.members, 1), 2) as avg_km,
             row_number() over (order by t.km / greatest(t.members, 1) desc, t.km desc, t.name) as rn
        from totals t where t.members >= 3
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'rank', r.rn, 'club_id', r.id, 'name', r.name, 'avatar_url', r.avatar_url, 'accent_color', r.accent_color,
        'members', r.members, 'runners', r.runners, 'km', round(r.km, 1), 'avg_km', r.avg_km,
        'tier', case when r.avg_km >= 120 * f then 'DIAMOND' when r.avg_km >= 80 * f then 'PLATINUM'
                     when r.avg_km >= 50 * f then 'GOLD' when r.avg_km >= 25 * f then 'SILVER' else 'BRONZE' end,
        'is_mine', exists (select 1 from public.club_members x where x.club_id = r.id and x.user_id = auth.uid() and x.status = 'APPROVED'))
        order by r.rn), '[]'::jsonb)
      from ranked r where r.rn <= 100 or exists (select 1 from public.club_members x where x.club_id = r.id and x.user_id = auth.uid() and x.status = 'APPROVED'));
end $$;

create or replace function private.club_battle_side(p_club uuid, p_start timestamptz, p_end timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
  with mem as (
    select m.user_id, m.joined_at from public.club_members m where m.club_id = p_club and m.status = 'APPROVED'
  ), runs as (
    select a.user_id, sum(a.distance_m) as m, count(*) as n
      from public.activities a join mem on mem.user_id = a.user_id
     where a.validation_status = 'APPROVED' and coalesce(a.status, '') <> 'DELETED' and a.shared
       and a.started_at >= p_start and a.started_at < p_end
       and a.started_at >= coalesce(mem.joined_at, '-infinity'::timestamptz)
     group by a.user_id
  ), ranked as (
    select r.*, row_number() over (order by r.m desc) as rn from runs r
  )
  select jsonb_build_object(
    'club_id', c.id, 'name', c.name, 'avatar_url', c.avatar_url, 'accent_color', c.accent_color,
    'members', greatest((select count(*) from mem), 1),
    'runners', (select count(*) from runs),
    'km', round(coalesce((select sum(m) from runs), 0) / 1000.0, 2),
    'avg_km', round(coalesce((select sum(m) from runs), 0) / 1000.0 / greatest((select count(*) from mem), 1), 2),
    'top', (select coalesce(jsonb_agg(jsonb_build_object('user_id', r.user_id, 'display_name', private.display_name(r.user_id),
                                                          'avatar_url', pr.avatar_url, 'km', round(r.m / 1000.0, 2), 'runs', r.n)
                                      order by r.rn), '[]'::jsonb)
              from ranked r join public.profiles pr on pr.id = r.user_id where r.rn <= 5))
  from public.clubs c where c.id = p_club
$$;

create or replace function private.cup_standings(p_cup uuid, p_start timestamptz, p_end timestamptz, p_metric text) returns jsonb
language sql stable security definer set search_path = public as $$
  with e as (
    select ce.club_id from public.club_cup_entries ce where ce.cup_id = p_cup
  ), mem as (
    select m.club_id, m.user_id, m.joined_at,
           row_number() over (partition by m.user_id order by m.joined_at nulls first, m.club_id) as k
      from public.club_members m join e on e.club_id = m.club_id
     where m.status = 'APPROVED'
  ), m1 as (
    select * from mem where k = 1
  ), runs as (
    select m1.club_id, a.user_id, sum(a.distance_m) as meters
      from public.activities a join m1 on m1.user_id = a.user_id
     where p_end > p_start
       and a.validation_status = 'APPROVED' and coalesce(a.status, '') <> 'DELETED' and a.shared
       and a.started_at >= p_start and a.started_at < p_end
       and a.started_at >= coalesce(m1.joined_at, '-infinity'::timestamptz)
     group by m1.club_id, a.user_id
  ), agg as (
    select e.club_id,
           (select count(*) from m1 where m1.club_id = e.club_id) as members,
           (select count(*) from runs r where r.club_id = e.club_id) as runners,
           coalesce((select sum(r.meters) from runs r where r.club_id = e.club_id), 0) as meters
      from e
  ), scored as (
    select agg.*, round(agg.meters / 1000.0, 2) as km,
           round(agg.meters / 1000.0 / greatest(agg.members, 1), 2) as avg_km
      from agg
  ), ranked as (
    select s.*, rank() over (order by case when p_metric = 'TOTAL_KM' then s.km else s.avg_km end desc) as rnk from scored s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'rank', r.rnk, 'club_id', c.id, 'name', c.name, 'avatar_url', c.avatar_url, 'accent_color', c.accent_color,
           'members', r.members, 'runners', r.runners, 'km', r.km, 'avg_km', r.avg_km,
           'score', case when p_metric = 'TOTAL_KM' then r.km else r.avg_km end)
         order by r.rnk, c.name), '[]'::jsonb)
    from ranked r join public.clubs c on c.id = r.club_id
$$;

create or replace function public.post_weekly_club_recaps() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_end timestamptz := private.period_start('WEEK');
  v_start timestamptz := v_end - interval '7 days';
  v_week text := to_char(v_start at time zone 'Asia/Ho_Chi_Minh', 'IYYY-"W"IW');
  c record; v_top jsonb; v_km numeric; v_runs int; v_active int; v_new int; n int := 0;
begin
  for c in select id from public.clubs loop
    v_runs := (select count(a.id) from public.club_members m
                 join public.activities a on a.user_id = m.user_id and a.validation_status = 'APPROVED' and a.shared
                  and coalesce(a.status, '') <> 'DELETED' and a.started_at >= v_start and a.started_at < v_end
                where m.club_id = c.id and m.status = 'APPROVED');
    if v_runs = 0 then continue; end if;
    v_km := (select coalesce(sum(a.distance_m), 0) from public.club_members m
               join public.activities a on a.user_id = m.user_id and a.validation_status = 'APPROVED' and a.shared
                and coalesce(a.status, '') <> 'DELETED' and a.started_at >= v_start and a.started_at < v_end
              where m.club_id = c.id and m.status = 'APPROVED');
    v_active := (select count(distinct a.user_id) from public.club_members m
                   join public.activities a on a.user_id = m.user_id and a.validation_status = 'APPROVED' and a.shared
                    and coalesce(a.status, '') <> 'DELETED' and a.started_at >= v_start and a.started_at < v_end
                  where m.club_id = c.id and m.status = 'APPROVED');
    v_top := (select coalesce(jsonb_agg(jsonb_build_object('user_id', t.user_id, 'name', t.name, 'distance_m', t.distance_m)
                                        order by t.distance_m desc), '[]'::jsonb)
                from (select m.user_id, private.display_name(m.user_id) as name, sum(a.distance_m) as distance_m,
                             row_number() over (order by sum(a.distance_m) desc) as rk
                        from public.club_members m
                        join public.activities a on a.user_id = m.user_id and a.validation_status = 'APPROVED' and a.shared
                         and coalesce(a.status, '') <> 'DELETED' and a.started_at >= v_start and a.started_at < v_end
                       where m.club_id = c.id and m.status = 'APPROVED'
                       group by m.user_id) t
               where t.rk <= 3);
    v_new := (select count(*) from public.club_members
               where club_id = c.id and status = 'APPROVED' and joined_at >= v_start and joined_at < v_end);

    insert into public.club_posts (club_id, kind, title, body, meta)
    values (c.id, 'RECAP', 'Tổng kết tuần ' || to_char(v_start at time zone 'Asia/Ho_Chi_Minh', 'DD/MM'),
            '', jsonb_build_object('week', v_week, 'distance_m', v_km, 'run_count', v_runs,
                                   'active_members', v_active, 'new_members', v_new, 'top', v_top))
    on conflict (club_id, (meta->>'week')) where kind = 'RECAP' do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- 7. Hồ sơ đối tác, pace trên Quanh đây, bài chờ duyệt của CLB
create or replace function private.partner_runner_stats(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'level', (select p.level from public.profiles p where p.id = p_user),
    'km_12m', (select round(coalesce(sum(coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0)), 0) / 1000.0) from public.activities a
                where a.user_id = p_user and a.validation_status = 'APPROVED' and a.shared and a.started_at >= now() - interval '365 days'),
    'runs_12m', (select count(*) from public.activities a where a.user_id = p_user and a.validation_status = 'APPROVED' and a.shared and a.started_at >= now() - interval '365 days'),
    'member_since', (select p.created_at from public.profiles p where p.id = p_user))
$$;

create or replace function private.typical_pace(p_user uuid) returns integer
language sql stable security definer set search_path = public as $$
  select round(percentile_cont(0.5) within group (order by a.moving_time_s / (a.distance_m / 1000.0)))::int
    from public.activities a
   where a.user_id = p_user and a.validation_status = 'APPROVED' and coalesce(a.status, '') <> 'DELETED' and a.shared
     and a.distance_m >= 1000 and a.moving_time_s > 0 and a.started_at > now() - interval '28 days'
$$;

create or replace function public.club_pending_activities(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.club_is_staff(p_club_id) and not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'title', a.title, 'distance_m', a.distance_m, 'moving_time_s', a.moving_time_s,
      'started_at', a.started_at, 'created_at', a.created_at, 'source', a.source,
      'validation_reason', a.validation_reason, 'risk_score', a.risk_score, 'risk_level', a.risk_level, 'risk_flags', a.risk_flags,
      'user_id', a.user_id, 'can_review', a.user_id <> auth.uid(),
      'profiles', jsonb_build_object('display_name', pr.display_name, 'avatar_url', pr.avatar_url))
      order by a.created_at desc), '[]'::jsonb)
    from public.activities a
    join public.club_members m on m.user_id = a.user_id and m.club_id = p_club_id and m.status = 'APPROVED'
    join public.profiles pr on pr.id = a.user_id
   where a.validation_status = 'PENDING' and coalesce(a.status, '') <> 'DELETED'
     and (a.shared or public.is_system_admin()));
end $$;

-- 8. Hồ sơ runner xem từ người khác: danh sách bài + số liệu tổng
CREATE OR REPLACE FUNCTION "public"."list_athlete_activities"("p_user_id" "uuid", "p_limit" integer DEFAULT 10, "p_offset" integer DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_can_map boolean;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.can_view_activities(p_user_id) then return '[]'::jsonb; end if;

  v_can_map := public.can_view_map(p_user_id);

  return coalesce((
    select jsonb_agg(to_jsonb(t) - 'rn' order by t.rn) from (
      select a.id,
             a.title,
             a.source,
             a.started_at,
             coalesce(a.moving_distance_m, a.distance_m, 0)  as distance_m,
             coalesce(a.moving_time_s, a.elapsed_time_s, 0)  as moving_time_s,
             a.avg_pace_s,
             a.elevation_gain_m,
             (v_can_map and exists (select 1 from public.activity_track_points tp where tp.activity_id = a.id)) as has_map,
             row_number() over (order by a.started_at desc nulls last) as rn
      from public.activities a
      where a.user_id = p_user_id
        and public.activity_is_countable(a.status, a.validation_status)
        and (a.shared or a.user_id = auth.uid())
    ) t
    where t.rn > greatest(p_offset, 0) and t.rn <= greatest(p_offset, 0) + least(greatest(p_limit, 1), 50)
  ), '[]'::jsonb);
end $$;

CREATE OR REPLACE FUNCTION "public"."get_athlete_profile"("p_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid         uuid := auth.uid();
  p             public.profiles%rowtype;
  s             public.profile_settings%rowtype;
  v_can_profile boolean;
  v_can_acts    boolean;
  v_stats       jsonb := null;
  v_clubs       jsonb := '[]'::jsonb;
  v_now         timestamp := (now() at time zone 'Asia/Ho_Chi_Minh');
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  p := (select x from public.profiles x where x.id = p_user_id);
  if p.id is null then return null; end if;

  s := (select x from public.profile_settings x where x.user_id = p_user_id);

  v_can_profile := public.can_view_profile(p_user_id);
  v_can_acts    := public.can_view_activities(p_user_id);

  -- Hồ sơ riêng tư: chỉ lộ tên và ảnh (như Strava)
  if not v_can_profile then
    return jsonb_build_object(
      'id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url,
      'can_view_profile', false, 'is_self', false);
  end if;

  if v_can_acts then
    v_stats := (select jsonb_build_object(
      'week',  jsonb_build_object(
                 'distance_m', coalesce(sum(d) filter (where ts >= date_trunc('week',  v_now)), 0),
                 'time_s',     coalesce(sum(t) filter (where ts >= date_trunc('week',  v_now)), 0),
                 'count',      count(*)        filter (where ts >= date_trunc('week',  v_now))),
      'month', jsonb_build_object(
                 'distance_m', coalesce(sum(d) filter (where ts >= date_trunc('month', v_now)), 0),
                 'time_s',     coalesce(sum(t) filter (where ts >= date_trunc('month', v_now)), 0),
                 'count',      count(*)        filter (where ts >= date_trunc('month', v_now))),
      'year',  jsonb_build_object(
                 'distance_m', coalesce(sum(d) filter (where ts >= date_trunc('year',  v_now)), 0),
                 'time_s',     coalesce(sum(t) filter (where ts >= date_trunc('year',  v_now)), 0),
                 'count',      count(*)        filter (where ts >= date_trunc('year',  v_now))),
      'all',   jsonb_build_object(
                 'distance_m', coalesce(sum(d), 0),
                 'time_s',     coalesce(sum(t), 0),
                 'count',      count(*))
    )
    from (
      select coalesce(a.moving_distance_m, a.distance_m, 0)          as d,
             coalesce(a.moving_time_s, a.elapsed_time_s, 0)          as t,
             (a.started_at at time zone 'Asia/Ho_Chi_Minh')          as ts
      from public.activities a
      where a.user_id = p_user_id
        and public.activity_is_countable(a.status, a.validation_status)
        and (a.shared or a.user_id = v_uid)
    ) x);
  end if;

  v_clubs := (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url) order by c.name), '[]'::jsonb)
  from public.club_members m
  join public.clubs c on c.id = m.club_id
  where m.user_id = p_user_id and m.status = 'APPROVED');

  return jsonb_build_object(
    'id', p.id,
    'display_name', p.display_name,
    'avatar_url', p.avatar_url,
    'level', p.level,
    'xp', p.xp,
    'joined_at', p.created_at,
    'region', s.region,
    'is_self', v_uid = p_user_id,
    'can_view_profile', true,
    'can_view_activities', v_can_acts,
    'stats', v_stats,
    'clubs', v_clubs
  );
end $$;

-- 9. Chi tiết bài chạy
create or replace function public.activity_detail(p_activity_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  a public.activities := (select x from public.activities x where x.id = p_activity_id);
  d public.activity_details := (select x from public.activity_details x where x.activity_id = p_activity_id);
  v_mine boolean;
  v_map boolean;
  -- Bài đồng bộ từ Strava, người xem không phải chủ bài → chỉ số tổng, không chi tiết (API Agreement Strava 11/2024)
  v_strava_other boolean;
begin
  if a.id is null or coalesce(a.status, '') = 'DELETED' then raise exception 'ACTIVITY_NOT_FOUND'; end if;
  v_mine := a.user_id = v_uid;
  if not v_mine and not public.is_system_admin()
     and not (a.shared and public.can_view_activities(a.user_id) and public.activity_is_countable(a.status, a.validation_status)) then
    raise exception 'ACTIVITY_NOT_FOUND';
  end if;
  v_strava_other := not v_mine and a.source = 'STRAVA';
  v_map := v_mine or (not v_strava_other and public.can_view_map(a.user_id));

  return jsonb_build_object(
    'id', a.id, 'title', a.title, 'source', a.source, 'sport_type', a.sport_type, 'device_name', case when not v_strava_other then a.device_name end,
    'started_at', a.started_at, 'distance_m', coalesce(a.moving_distance_m, a.distance_m, 0),
    'moving_s', coalesce(a.moving_time_s, a.elapsed_time_s, 0), 'elapsed_s', coalesce(a.elapsed_time_s, 0),
    'avg_pace_s', a.avg_pace_s, 'elevation_gain_m', coalesce(a.elevation_gain_m, 0),
    'avg_heartrate', case when not v_strava_other then a.avg_heartrate end,
    'max_heartrate', case when not v_strava_other then d.max_heartrate end,
    'avg_cadence', case when not v_strava_other then d.avg_cadence end,
    'calories', case when not v_strava_other then d.calories end,
    'strava_limited', v_strava_other,
    'shared', a.shared,
    'strava_id', case when v_mine and a.source = 'STRAVA' then a.source_activity_id end,
    'validation_status', a.validation_status,
    'validation_reason', case when v_mine then a.validation_reason end,
    'earned_xu', a.earned_xu, 'earned_xp', a.earned_xp,
    'is_mine', v_mine,
    'owner', (select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url, 'level', p.level)
                from public.profiles p where p.id = a.user_id),
    'map_allowed', v_map,
    'polyline', case when v_map then d.polyline end,
    -- Bài GPS trong app: điểm GPS rút gọn ≤ ~1000 điểm [lat, lng, giây kể từ lúc bắt đầu, độ cao]
    'points', case when v_map and d.polyline is null then (
        select jsonb_agg(jsonb_build_array(s.latitude, s.longitude,
                 round(extract(epoch from (s.recorded_at - a.started_at))), s.altitude) order by s.sequence)
          from (select t.latitude, t.longitude, t.recorded_at, t.altitude, t.sequence,
                       row_number() over (order by t.sequence) as rn, count(*) over () as cnt
                  from public.activity_track_points t where t.activity_id = a.id) s
         where s.rn % greatest(ceil(s.cnt / 1000.0)::int, 1) = 0 or s.rn = s.cnt) end,
    'splits', case when not v_strava_other then d.splits end,
    'needs_detail', v_mine and a.source = 'STRAVA' and not coalesce(d.detailed, false),
    'challenges', case when v_mine then (
        select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'counted_m', e.counted_m) order by e.created_at), '[]'::jsonb)
          from public.challenge_progress_events e join public.challenges c on c.id = e.challenge_id
         where e.activity_id = a.id) else '[]'::jsonb end,
    'cheers', (select jsonb_build_object('count', count(*), 'total', coalesce(sum(ch.amount), 0))
                 from public.cheers ch where ch.activity_id = a.id),
    -- So với 10 bài trước đó của chính người chạy (để hiện "dài hơn / nhanh hơn thường lệ")
    'compare', (select jsonb_build_object(
          'runs', count(*),
          'avg_distance_m', round(avg(coalesce(x.moving_distance_m, x.distance_m))),
          'avg_pace_s', round(avg(x.avg_pace_s) filter (where x.avg_pace_s > 0)),
          'longest_30d', coalesce(a.distance_m >= (select max(y.distance_m) from public.activities y
                              where y.user_id = a.user_id and y.id <> a.id and public.activity_is_countable(y.status, y.validation_status)
                                and y.started_at > a.started_at - interval '30 days' and y.started_at <= a.started_at), true))
        from (select z.*, row_number() over (order by z.started_at desc) as rn
                from public.activities z
               where z.user_id = a.user_id and z.id <> a.id and z.started_at < a.started_at
                 and public.activity_is_countable(z.status, z.validation_status)) x
       where x.rn <= 10)
  );
end $$;

-- 10. Đọc trực tiếp bảng activities (RLS): người khác chỉ thấy bài được chia sẻ
drop policy if exists "Activities visible by owner privacy" on public.activities;
create policy "Activities visible by owner privacy" on public.activities for select
  using (auth.uid() = user_id
         or (shared and public.can_view_activities(user_id) and public.activity_is_countable(status, validation_status)));

-- 11. Trigger phía sau: chạy lại khi cờ chia sẻ đổi
drop trigger if exists trg_club_posts_on_activity on public.activities;
create trigger trg_club_posts_on_activity after insert or update of validation_status, status, shared on public.activities
  for each row execute function private.club_posts_on_activity();
drop trigger if exists trg_challenge_progress on public.activities;
create trigger trg_challenge_progress after insert or update of validation_status, status, shared on public.activities
  for each row execute function private.challenge_progress_trigger();
drop trigger if exists trg_race_on_activity on public.activities;
create trigger trg_race_on_activity
  after insert or update of validation_status, status, distance_m, shared on public.activities
  for each row execute function private.race_on_activity();

-- 12. RPC người dùng
create or replace function public.my_strava_sharing() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  return jsonb_build_object(
    'policy', private.strava_share_policy(),
    'consent', (select s.strava_share from public.profile_settings s where s.user_id = v_uid),
    'connected', exists (select 1 from public.connected_accounts c where c.user_id = v_uid and c.provider = 'STRAVA'),
    'strava_runs', (select count(*) from public.activities a where a.user_id = v_uid and a.source = 'STRAVA'),
    'hidden_runs', (select count(*) from public.activities a where a.user_id = v_uid and a.source = 'STRAVA' and not a.shared));
end $$;

create or replace function public.set_strava_sharing(p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); n integer;
begin
  if p_on is null then raise exception 'INVALID_VALUE'; end if;
  insert into public.profile_settings (user_id, strava_share, strava_share_at) values (v_uid, p_on, now())
  on conflict (user_id) do update set strava_share = excluded.strava_share, strava_share_at = now(), updated_at = now();
  n := private.strava_reshare(v_uid);
  return public.my_strava_sharing() || jsonb_build_object('changed', n);
end $$;

-- 13. Admin: chọn chính sách chung (chuyển nhanh sang hướng A khi Strava yêu cầu)
create or replace function public.admin_set_strava_policy(p_policy text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_admin(); v_old text := private.strava_share_policy(); n integer;
begin
  if upper(coalesce(p_policy, '')) not in ('OPT_IN', 'OWNER_ONLY', 'ALL') then raise exception 'INVALID_POLICY'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  insert into private.app_settings (key, value, updated_at) values ('strava_share_policy', upper(p_policy), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  n := private.strava_reshare(null);
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'STRAVA_SHARE_POLICY', 'strava', jsonb_build_object('from', v_old, 'to', upper(p_policy), 'reason', trim(p_reason), 'changed', n));
  return jsonb_build_object('policy', upper(p_policy), 'changed', n);
end $$;

create or replace function public.admin_strava_sharing_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'policy', private.strava_share_policy(),
    'connected', (select count(*) from public.connected_accounts c where c.provider = 'STRAVA'),
    'opted_in', (select count(*) from public.profile_settings s where s.strava_share is true
                   and exists (select 1 from public.connected_accounts c where c.user_id = s.user_id and c.provider = 'STRAVA')),
    'opted_out', (select count(*) from public.profile_settings s where s.strava_share is false
                   and exists (select 1 from public.connected_accounts c where c.user_id = s.user_id and c.provider = 'STRAVA')),
    'hidden_runs', (select count(*) from public.activities a where a.source = 'STRAVA' and not a.shared));
end $$;

revoke all on function private.strava_share_policy(), private.activity_shared(uuid, text), private.activities_set_shared(),
  private.strava_reshare(uuid) from public, anon, authenticated;
revoke all on function public.my_strava_sharing(), public.set_strava_sharing(boolean), public.admin_set_strava_policy(text, text),
  public.admin_strava_sharing_stats() from public, anon;
grant execute on function public.my_strava_sharing(), public.set_strava_sharing(boolean), public.admin_set_strava_policy(text, text),
  public.admin_strava_sharing_stats() to authenticated;

-- 14. Áp dụng cho dữ liệu hiện có (bài Strava của người chưa đồng ý → chỉ còn cho chính họ). Chạy lại: 0 dòng.
select private.strava_reshare(null);

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001007100_admin_full_power.sql
-- ===================================================================
-- 007100: Admin hệ thống TOÀN QUYỀN trong mọi CLB (luật sản phẩm: "admin là full-power").
-- Trước đây quyền ban quản trị CLB (club_is_staff) chỉ tính chủ nhiệm / đội trưởng của CHÍNH CLB đó → admin hệ thống
-- không duyệt thành viên, sửa cài đặt, đăng tin, xoá bài, quản lý sự kiện / quỹ / thử thách… ở CLB mình không tham gia.
-- Nay: admin hệ thống được coi là ban quản trị + thành viên của mọi CLB (mọi thao tác vẫn ghi nhật ký như cũ).
-- "CLB của tôi" trên bảng xếp hạng CLB vẫn tính theo thành viên thật (007000). Chạy lại nhiều lần vẫn an toàn.

create or replace function public.club_is_staff(p_club uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_system_admin()
      or exists (select 1 from public.club_members
                  where club_id = p_club and user_id = auth.uid() and status = 'APPROVED'
                    and role in ('OWNER', 'CAPTAIN'))
$$;

create or replace function public.club_is_member(p_club uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_system_admin()
      or exists (select 1 from public.club_members
                  where club_id = p_club and user_id = auth.uid() and status = 'APPROVED')
$$;

-- Thử thách cá nhân (không thuộc CLB): admin cũng quản lý / huỷ được
create or replace function private.challenge_is_manager(c public.challenges) returns boolean
language sql stable security definer set search_path = public as $$
  select c.created_by = auth.uid() or public.is_system_admin()
      or (c.target_club_id is not null and public.club_is_staff(c.target_club_id))
$$;

create or replace function public.cancel_challenge(p_challenge_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); c public.challenges%rowtype; r record;
begin
  c := (select x from public.challenges x where x.id = p_challenge_id for update);
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if c.created_by is distinct from v_uid and not public.is_system_admin()
     and not (c.target_club_id is not null and public.club_is_staff(c.target_club_id)) then
    raise exception 'FORBIDDEN';
  end if;
  if c.status <> 'ACTIVE' then raise exception 'CHALLENGE_CLOSED'; end if;
  if now() >= c.start_date and exists (select 1 from public.challenge_participants
       where challenge_id = c.id and profile_id <> c.created_by) then
    raise exception 'CANNOT_CANCEL_STARTED';
  end if;
  update public.challenges set status = 'CANCELLED', cancelled_reason = left(p_reason, 300), settled_at = now() where id = c.id;
  perform private.challenge_refund_escrow(c);
  for r in select profile_id from public.challenge_participants where challenge_id = c.id loop
    perform private.notify(r.profile_id, c.target_club_id, 'CHALLENGE_CANCELLED', 'Thử thách đã bị hủy: ' || c.title,
      p_reason, '/challenges/' || c.id, v_uid, true);
  end loop;
end $$;

-- Hàm vai trò gốc (schema production) dùng cho duyệt / xoá / đổi vai trò thành viên, sửa CLB, đổi mã mời, thông báo CLB…:
-- admin hệ thống được tính là Chủ nhiệm ở mọi CLB.
create or replace function public.club_role(p_club uuid, p_user uuid default auth.uid()) returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.profiles p where p.id = p_user and (p.role = 'SYSTEM_ADMIN' or p.is_admin is true)) then 'OWNER'
    else (select (array_agg(m.role))[1] from public.club_members m
           where m.club_id = p_club and m.user_id = p_user and m.status = 'APPROVED') end
$$;

-- Giải tán CLB: chủ nhiệm hoặc admin hệ thống (gõ đúng tên CLB); admin xoá CLB của người khác → ghi nhật ký quản trị
create or replace function public.delete_club(p_club_id uuid, p_confirm_name text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.clubs := (select x from public.clubs x where x.id = p_club_id);
  v_owner boolean;
begin
  if c.id is null then raise exception 'CLUB_NOT_FOUND'; end if;
  v_owner := c.owner_id = v_uid or exists (select 1 from public.club_members m
               where m.club_id = p_club_id and m.user_id = v_uid and m.role = 'OWNER' and m.status = 'APPROVED');
  if not v_owner and not public.is_system_admin() then raise exception 'NOT_AUTHORIZED'; end if;
  if trim(lower(coalesce(p_confirm_name, ''))) <> trim(lower(c.name)) then raise exception 'WRONG_NAME'; end if;
  if not v_owner then
    insert into public.admin_audit_log (actor_id, action, target, new_value)
    values (v_uid, 'CLUB_DELETE', 'club:' || c.id, jsonb_build_object('name', c.name, 'owner_id', c.owner_id, 'members', c.member_count));
  end if;
  delete from public.clubs where id = p_club_id;
end $$;

-- Trao quyền Chủ nhiệm: chủ nhiệm hoặc admin hệ thống
create or replace function public.transfer_club_ownership(p_club_id uuid, p_new_owner_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_club text := (select c.name from public.clubs c where c.id = p_club_id);
begin
  if v_club is null then raise exception 'CLUB_NOT_FOUND'; end if;
  if p_new_owner_id is null or p_new_owner_id = v_uid then raise exception 'CANNOT_TRANSFER_TO_SELF'; end if;
  if not public.is_system_admin()
     and not exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = v_uid and m.role = 'OWNER' and m.status = 'APPROVED') then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if not exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = p_new_owner_id and m.status = 'APPROVED') then
    raise exception 'TARGET_NOT_MEMBER';
  end if;
  -- Chủ nhiệm hiện tại (có thể không phải người thao tác khi admin trao quyền) → Quản trị viên
  update public.club_members set role = 'CAPTAIN' where club_id = p_club_id and role = 'OWNER' and user_id <> p_new_owner_id;
  update public.club_members set role = 'OWNER' where club_id = p_club_id and user_id = p_new_owner_id;
  update public.clubs set owner_id = p_new_owner_id where id = p_club_id;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'CLUB_TRANSFER_OWNER', 'club:' || p_club_id, jsonb_build_object('from', v_uid, 'to', p_new_owner_id));
  perform private.notify(p_new_owner_id, p_club_id, 'CLUB_ROLE', 'Bạn là Chủ nhiệm mới của ' || v_club,
    'Quyền Chủ nhiệm CLB đã được trao cho bạn.', '/clubs/' || p_club_id, v_uid, true);
end $$;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001007200_restore_admin_set_club_plan.sql
-- ===================================================================
-- 007200: Khôi phục hàm gán gói CLB Pro về bản chuẩn.
-- Sự cố (09/2026): gán Pro cho NO BEER NO RUN báo "Chỉ quản trị viên hệ thống…" dù admin đúng quyền. Chạy thử trên
-- production cho thấy public.admin_set_club_plan ở đó KHÔNG phải bản trong mã nguồn (gọi private.require_admin() ngay
-- ở phần khai báo — không migration nào có bản này, có thể do sửa tay trong SQL Editor). Migration này:
--   1. Viết lại is_system_admin / require_admin đúng bản chuẩn (000300).
--   2. Xoá hẳn admin_set_club_plan đang có rồi tạo lại bản chuẩn (002800), phòng khi bản lạ khác kiểu trả về.
--   3. Bước báo cho ban quản trị CLB được bọc lỗi: thông báo hỏng không bao giờ làm hỏng việc gán gói.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT. Chạy lại nhiều lần vẫn an toàn.

create or replace function public.is_system_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                  where id = auth.uid() and (role = 'SYSTEM_ADMIN' or is_admin is true))
$$;

create or replace function private.require_admin() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_uid();
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return auth.uid();
end $$;

drop function if exists public.admin_set_club_plan(uuid, text, timestamptz, text);

create function public.admin_set_club_plan(p_club_id uuid, p_plan text, p_until timestamptz, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_plan text := upper(coalesce(p_plan, ''));
  c public.clubs := (select x from public.clubs x where x.id = p_club_id);
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  if c.id is null then raise exception 'CLUB_NOT_FOUND'; end if;
  if v_plan not in ('FREE', 'PRO') then raise exception 'INVALID_PLAN'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  update public.clubs set plan = v_plan, pro_until = case when v_plan = 'PRO' then p_until end where id = c.id;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'SET_CLUB_PLAN', c.id::text, jsonb_build_object('plan', v_plan, 'until', p_until, 'reason', trim(p_reason), 'old_plan', c.plan));
  begin
    perform private.notify_club(c.id, true, 'CLUB_PRO',
      case when v_plan = 'PRO' then c.name || ' đã lên gói CLB Pro' else c.name || ' trở về gói miễn phí' end,
      case when v_plan = 'PRO' then 'Mở khóa: không giới hạn quản trị viên, link mời riêng, báo cáo chuyên cần.'
           else 'Các tính năng Pro tạm khóa. Dữ liệu vẫn được giữ nguyên.' end,
      '/clubs/' || c.id || '/settings', v_uid);
  exception when others then
    perform private.log_notify_error('club_plan', 'CLUB_PRO', v_uid, sqlstate, sqlerrm);
  end;
  return jsonb_build_object('plan', v_plan, 'pro_until', case when v_plan = 'PRO' then p_until end);
end $$;

revoke all on function public.admin_set_club_plan(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.admin_set_club_plan(uuid, text, timestamptz, text) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001007300_help_center.sql
-- ===================================================================
-- 007300: Trung tâm Hướng dẫn & Chính sách (menu ☰) + thông tin pháp nhân.
-- • public.help_pages: trang hướng dẫn chơi (GUIDE), chính sách / quy định (POLICY), hỗ trợ (SUPPORT) — nội dung Markdown,
--   có phiên bản + ngày hiệu lực; admin soạn / sửa / ẩn ở Quản trị → Cộng đồng → Hướng dẫn & chính sách, không cần deploy.
--   Đọc được KHI CHƯA ĐĂNG NHẬP (người dùng phải xem được chính sách trước khi đồng ý đăng ký).
-- • public.site_info: tên công ty, MST, địa chỉ, email / điện thoại hỗ trợ, người phụ trách dữ liệu cá nhân, tuổi tối thiểu —
--   hiện ở chân menu và thay vào chỗ {{company_name}}, {{support_email}}… trong nội dung trang (chưa nhập → "đang cập nhật").
-- • Nội dung mẫu chỉ được thêm khi chưa có trang cùng slug → chạy lại KHÔNG ghi đè bản admin đã sửa.
--   Trang đánh dấu needs_review = cần luật sư / admin rà trước khi coi là bản chính thức.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT. Chạy lại nhiều lần vẫn an toàn.

create table if not exists public.help_pages (
  slug text primary key check (slug ~ '^[a-z0-9-]{2,60}$'),
  section text not null check (section in ('GUIDE', 'POLICY', 'SUPPORT')),
  title text not null check (char_length(title) between 2 and 120),
  icon text check (icon is null or char_length(icon) <= 8),
  summary text check (summary is null or char_length(summary) <= 200),
  body text not null default '' check (char_length(body) <= 60000),
  version text not null default '1.0' check (char_length(version) <= 20),
  effective_at date,
  sort integer not null default 100,
  is_published boolean not null default true,
  needs_review boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
alter table public.help_pages enable row level security;
revoke all on public.help_pages from anon, authenticated;

create table if not exists public.site_info (
  id boolean primary key default true check (id),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
alter table public.site_info enable row level security;
revoke all on public.site_info from anon, authenticated;
insert into public.site_info (id) values (true) on conflict (id) do nothing;

-- Các khoá thông tin pháp nhân được phép (giữ đồng bộ với features/help/model/help.ts)
create or replace function private.site_info_keys() returns text[]
language sql immutable as $$
  select array['company_name', 'tax_code', 'address', 'support_email', 'support_phone', 'dpo_contact', 'min_age', 'report_email', 'business_license']
$$;

-- ---------------------------------------------------------------------
-- 1. Đọc (khách + người dùng)
-- ---------------------------------------------------------------------
create or replace function public.help_menu() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'pages', coalesce((select jsonb_agg(jsonb_build_object('slug', p.slug, 'section', p.section, 'title', p.title, 'icon', p.icon,
                                                           'summary', p.summary) order by p.section, p.sort, p.title)
                       from public.help_pages p where p.is_published), '[]'::jsonb),
    'site', coalesce((select s.data from public.site_info s where s.id), '{}'::jsonb))
$$;

create or replace function public.help_page(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  p public.help_pages := (select x from public.help_pages x where x.slug = lower(trim(coalesce(p_slug, ''))));
begin
  if p.slug is null or (not p.is_published and not public.is_system_admin()) then raise exception 'PAGE_NOT_FOUND'; end if;
  return jsonb_build_object('slug', p.slug, 'section', p.section, 'title', p.title, 'icon', p.icon, 'summary', p.summary,
    'body', p.body, 'version', p.version, 'effective_at', p.effective_at, 'updated_at', p.updated_at,
    'is_published', p.is_published, 'needs_review', p.needs_review,
    'site', coalesce((select s.data from public.site_info s where s.id), '{}'::jsonb));
end $$;

-- ---------------------------------------------------------------------
-- 2. Quản trị
-- ---------------------------------------------------------------------
create or replace function public.admin_help_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'pages', coalesce((select jsonb_agg(to_jsonb(p) - 'updated_by'
                         || jsonb_build_object('updated_by_name', private.display_name(p.updated_by)) order by p.section, p.sort, p.title)
                       from public.help_pages p), '[]'::jsonb),
    'site', coalesce((select s.data from public.site_info s where s.id), '{}'::jsonb));
end $$;

create or replace function public.admin_help_save(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  v_slug text := lower(trim(coalesce(p->>'slug', '')));
  v_old public.help_pages := (select x from public.help_pages x where x.slug = v_slug);
begin
  if v_slug !~ '^[a-z0-9-]{2,60}$' then raise exception 'INVALID_SLUG'; end if;
  if coalesce(p->>'section', '') not in ('GUIDE', 'POLICY', 'SUPPORT') then raise exception 'INVALID_SECTION'; end if;
  if char_length(trim(coalesce(p->>'title', ''))) not between 2 and 120 then raise exception 'INVALID_TITLE'; end if;
  insert into public.help_pages (slug, section, title, icon, summary, body, version, effective_at, sort, is_published, needs_review, updated_at, updated_by)
  values (v_slug, p->>'section', trim(p->>'title'), nullif(trim(coalesce(p->>'icon', '')), ''), nullif(trim(coalesce(p->>'summary', '')), ''),
          coalesce(p->>'body', ''), coalesce(nullif(trim(coalesce(p->>'version', '')), ''), '1.0'), nullif(p->>'effective_at', '')::date,
          coalesce((p->>'sort')::integer, 100), coalesce((p->>'is_published')::boolean, true), coalesce((p->>'needs_review')::boolean, false),
          now(), v_uid)
  on conflict (slug) do update set section = excluded.section, title = excluded.title, icon = excluded.icon, summary = excluded.summary,
    body = excluded.body, version = excluded.version, effective_at = excluded.effective_at, sort = excluded.sort,
    is_published = excluded.is_published, needs_review = excluded.needs_review, updated_at = now(), updated_by = v_uid;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'HELP_PAGE_SAVE', v_slug, jsonb_build_object('title', trim(p->>'title'), 'version', p->>'version',
          'published', coalesce((p->>'is_published')::boolean, true), 'new', v_old.slug is null,
          'old_version', v_old.version, 'body_changed', v_old.body is distinct from coalesce(p->>'body', '')));
  return v_slug;
end $$;

create or replace function public.admin_help_delete(p_slug text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  v_old public.help_pages := (select x from public.help_pages x where x.slug = p_slug);
begin
  if v_old.slug is null then raise exception 'PAGE_NOT_FOUND'; end if;
  delete from public.help_pages where slug = p_slug;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'HELP_PAGE_DELETE', p_slug, jsonb_build_object('title', v_old.title, 'version', v_old.version, 'body', left(v_old.body, 20000)));
end $$;

create or replace function public.admin_site_info_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  v_data jsonb := (select coalesce(jsonb_object_agg(k, left(trim(p->>k), 300)), '{}'::jsonb)
                     from unnest(private.site_info_keys()) k
                    where p ? k and trim(coalesce(p->>k, '')) <> '');
begin
  update public.site_info set data = v_data, updated_at = now(), updated_by = v_uid where id;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SITE_INFO_SAVE', 'site_info', v_data);
  return v_data;
end $$;

revoke all on function public.help_menu(), public.help_page(text), public.admin_help_list(), public.admin_help_save(jsonb),
  public.admin_help_delete(text), public.admin_site_info_save(jsonb) from public;
grant execute on function public.help_menu(), public.help_page(text) to anon, authenticated;
grant execute on function public.admin_help_list(), public.admin_help_save(jsonb), public.admin_help_delete(text),
  public.admin_site_info_save(jsonb) to authenticated;
revoke all on function private.site_info_keys() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Nội dung mẫu (chỉ thêm khi chưa có — không ghi đè bản admin đã sửa)
-- ---------------------------------------------------------------------
insert into public.help_pages (slug, section, title, icon, summary, sort, needs_review, effective_at, body) values

('bat-dau', 'GUIDE', 'Bắt đầu trong 3 phút', '🚀', 'Chạy → XP → Level → Thử thách → CLB', 10, false, date '2026-10-01', $md$
RaceHub biến mỗi km bạn chạy thành một cuộc chơi.

## Vòng chơi

🏃 **Chạy** → ⭐ **XP** → ⬆️ **Level** → 🎯 **Thử thách** → 🏅 **Huy hiệu** → 👥 **CLB**

## 4 việc đầu tiên

1. **Hoàn thiện hồ sơ** — tên hiển thị, ảnh đại diện.
2. **Chọn nhân vật** — runner của bạn sẽ lên đồ theo hành trình.
3. **Kết nối nguồn chạy** — chạy bằng app RaceHub hoặc kết nối Strava.
4. **Chạy bài đầu tiên** — bấm nút **Chạy** ở giữa thanh dưới.

Sau đó: tham gia một [thử thách](/challenges) và tìm [CLB](/clubs) gần bạn.

> Mọi thứ trong RaceHub đều bắt đầu từ km thật. Không có cách mua XP.
$md$),

('chay-va-ghi-bai', 'GUIDE', 'Chạy & ghi bài', '🏃', 'GPS trong app, Strava, vì sao bài bị từ chối', 20, false, date '2026-10-01', $md$
## Hai cách ghi bài

- **Chạy bằng app RaceHub:** bấm **Chạy**, chờ biểu tượng GPS chuyển xanh rồi bắt đầu. Để màn hình sáng hoặc cho phép app chạy nền.
- **Kết nối Strava:** bài chạy trên đồng hồ / Strava tự về RaceHub sau vài phút.

## Bài hợp lệ

Bài được tính khi đúng là **chạy bộ / đi bộ** với tốc độ hợp lý. Hệ thống tự phát hiện:

- tốc độ quá nhanh (đi xe), GPS nhảy, mất tín hiệu dài rồi nối thẳng;
- bài trùng giờ với bài khác.

Bài nghi ngờ sẽ **chờ duyệt**, không bị xoá. Xem chi tiết tại [Công bằng & chống gian lận](/help/cong-bang-chong-gian-lan).

## Mẹo GPS

- Android: tắt **tối ưu pin** cho RaceHub.
- Đợi GPS ổn định 10–20 giây trước khi bấm bắt đầu.
- Chạy nơi thoáng, tránh hầm và toà nhà cao.

## Bài Strava có hiện cho CLB không?

Khi kết nối Strava, bài chạy của bạn tự hiện trên bảng tin CLB và bảng xếp hạng (chỉ quãng đường, thời gian; bản đồ và nhịp tim chỉ bạn xem). Muốn ẩn: **Cài đặt → Quyền riêng tư → Tắt**. Bài đã ẩn vẫn tính Xu / XP / huy hiệu cho chính bạn.
$md$),

('xp-level', 'GUIDE', 'XP & Level', '⭐', 'XP chỉ đến từ km chạy thật', 30, false, date '2026-10-01', $md$
## XP đến từ đâu?

🏃 **1 km hợp lệ** → ⭐ **XP**

XP **chỉ** đến từ km bạn chạy. Không mua được, không nhận từ nhiệm vụ hay quà tặng.

## Level

Có **8 cấp độ** từ *Tân Binh* đến *Đỉnh Cao RaceHub*. XP càng nhiều, level càng cao; một số cấp có thưởng Xu một lần.

## Nghỉ lâu có mất level?

Không. Level là thành tích trọn đời — nghỉ dài ngày chỉ đổi trạng thái **phong độ** (Đang lên / Ổn định / Tạm nghỉ…). Quay lại chạy sau thời gian dài còn có thưởng *Chào mừng trở lại*.
$md$),

('xu-vi', 'GUIDE', 'Xu & Ví', '🪙', 'Xu là đơn vị tiện ích, không quy đổi thành tiền', 40, false, date '2026-10-01', $md$
## Xu là gì?

**Xu** là đơn vị tiện ích trong RaceHub. Xu **không quy đổi thành tiền mặt**, không chuyển cho người khác.

## Nhận Xu

- Chạy bộ: Xu tính theo tổng km trong ngày, có trần mỗi ngày.
- Điểm danh ngày có bài chạy hợp lệ, chuỗi tuần chạy đều.
- Nhiệm vụ, giới thiệu bạn bè (khi bạn mới chạy đủ km).
- Nạp Xu hoặc gói VIP.

## Dùng Xu

- Tạo thử thách (phí theo số người tối đa).
- Mua đồ cho nhân vật, tặng quà.

Số liệu hiện hành (trần ngày, phí…) xem ngay trong **Ví**. Quy định đầy đủ: [Quy định Xu, quà tặng & vật phẩm ảo](/help/quy-dinh-xu-qua).
$md$),

('qua-tang', 'GUIDE', 'Quà tặng & Điểm tỏa sáng', '🎁', 'Quà để cổ vũ và sưu tầm — không phải tiền', 50, false, date '2026-10-01', $md$
## Tặng quà

Bạn dùng Xu để tặng quà cổ vũ runner khác. **Xu của bạn được dùng hết** (không chuyển sang người nhận).

## Nhận quà

Người nhận có **quà trên tường quà** và **Điểm tỏa sáng** (tổng giá trị quà đã nhận).

- Quà **không phải tiền**, không đổi ra Xu hay tiền mặt.
- Quà **không tặng lại / bán lại** được.
- Điểm tỏa sáng dùng để hiển thị, mở một số vật phẩm trang trí.
$md$),

('thu-thach', 'GUIDE', 'Thử thách & Giải chạy ảo', '🎯', 'Chạy cùng nhau, cạnh tranh, hoàn thành', 60, false, date '2026-10-01', $md$
## Các loại

- **Thử thách cá nhân / nhóm bạn:** tự tạo, mời bạn bè.
- **Thử thách CLB:** ban quản trị CLB tạo cho thành viên.
- **Giải chạy ảo:** có BIB, chứng nhận, vinh danh.

## Tham gia

Mở thử thách → đọc **thể lệ** → **Tham gia**. Bài chạy hợp lệ trong thời gian thử thách tự được tính.

## Tạo thử thách

Phí tạo tính theo **số người tối đa** (nhóm nhỏ miễn phí). Gói VIP / CLB Pro có lượt tạo miễn phí.
$md$),

('clb', 'GUIDE', 'Câu lạc bộ', '👥', 'Chạy một mình, tiến bộ cùng cộng đồng', 70, false, date '2026-10-01', $md$
## Trong CLB có gì?

- Bảng tin & chat, lịch chạy nhóm có **điểm danh QR**.
- Thử thách CLB, bảng xếp hạng, CLB đấu CLB.
- Quỹ CLB minh bạch (RaceHub **không giữ tiền** — quỹ chỉ ghi sổ).

## Tham gia / tạo CLB

Vào tab **CLB** → tìm CLB → **Tham gia**, hoặc **Tạo CLB** của bạn.
$md$),

('nhan-vat', 'GUIDE', 'Nhân vật & Tủ đồ', '👤', 'Xây runner của riêng bạn', 80, false, date '2026-10-01', $md$
Bạn không chỉ chạy — bạn **xây runner của mình**.

- Chọn dáng nhân vật, phối màu áo, quần, tất, giày.
- Mở khoá đồ theo level, sự kiện, huy hiệu; mua đồ bằng Xu.
- Thiết kế đồng phục CLB (logo, chữ, số áo).

Đồ nhân vật chỉ để **trang trí**, không làm tăng thành tích.
$md$),

('vip-pro', 'GUIDE', 'VIP & CLB Pro', '👑', 'Gói trả phí cho runner và CLB', 90, false, date '2026-10-01', $md$
## VIP (cá nhân)

Phân tích bài chạy nâng cao, lượt tạo thử thách, quà / đồ trang trí riêng. VIP **không** tăng km, XP hay thứ hạng.

## CLB Pro

Không giới hạn quản trị viên, link mời riêng, báo cáo chuyên cần, lượt tạo thử thách CLB.

Thanh toán & hoàn tiền: xem [Thanh toán & hoàn tiền](/help/thanh-toan-hoan-tien).
$md$),

('hoi-dap', 'GUIDE', 'Câu hỏi thường gặp', '❓', 'Những thắc mắc phổ biến nhất', 100, false, date '2026-10-01', $md$
### Bài chạy của tôi chưa về?
Bài Strava thường về sau 1–5 phút. Ở Trang chủ bấm **Đồng bộ Strava** để lấy ngay. Vẫn chưa có → kiểm tra kết nối Strava trong trang Tôi.

### Vì sao bài bị "chờ duyệt"?
Hệ thống thấy dấu hiệu bất thường (tốc độ, GPS). Admin sẽ xem và duyệt; bạn không cần làm gì.

### Xu có đổi ra tiền được không?
Không. Xu chỉ dùng trong RaceHub.

### Tôi xoá tài khoản thế nào?
Menu ☰ → **Xoá tài khoản**, hoặc Cài đặt → Xoá tài khoản.

### Tôi cần hỗ trợ thêm?
Xem [Liên hệ hỗ trợ](/help/lien-he).
$md$),

('quy-tac-cong-dong', 'POLICY', 'Quy tắc cộng đồng', '🤝', 'Tôn trọng, trung thực, an toàn', 10, true, date '2026-10-01', $md$
RaceHub là cộng đồng chạy bộ. Khi dùng bảng tin, chat CLB, bình luận, ảnh, tên CLB / thử thách, bạn đồng ý:

## Không được

- Xúc phạm, quấy rối, phân biệt đối xử, đe doạ.
- Nội dung khiêu dâm, bạo lực, cờ bạc, chất cấm, đồ uống có cồn hướng tới trẻ vị thành niên.
- Thông tin sai sự thật, lừa đảo, mạo danh người / tổ chức khác.
- Quảng cáo, bán hàng trái phép; kêu gọi chuyển tiền ngoài app.
- Nội dung vi phạm pháp luật Việt Nam, vi phạm bản quyền.
- Đăng thông tin cá nhân của người khác khi chưa được đồng ý.

## Xử lý vi phạm

Người dùng bấm **Báo cáo** trên runner / tin Chợ BIB, hoặc báo qua [Báo cáo vi phạm & khiếu nại](/help/bao-cao-vi-pham). Chúng tôi xem xét và có thể: gỡ nội dung, cảnh cáo, tạm khoá hoặc khoá vĩnh viễn tài khoản. Yêu cầu gỡ bỏ của cơ quan nhà nước có thẩm quyền được xử lý theo thời hạn luật định.

Khiếu nại quyết định: [Báo cáo vi phạm & khiếu nại](/help/bao-cao-vi-pham).
$md$),

('quy-dinh-xu-qua', 'POLICY', 'Quy định Xu, quà tặng & vật phẩm ảo', '🪙', 'Xu, quà, vật phẩm chỉ dùng trong RaceHub', 20, true, date '2026-10-01', $md$
## 1. Xu

- Xu là **đơn vị tiện ích** chỉ dùng trong RaceHub; **không quy đổi** thành tiền, thẻ cào, thẻ quà tặng hay tài sản có giá trị ngoài RaceHub.
- Xu **không chuyển** giữa người dùng; không mua bán Xu giữa người dùng.
- Xu nhận miễn phí có thể có giới hạn theo ngày / tuần. Mọi biến động Xu được ghi sổ để đối soát.

## 2. Quà tặng

- Tặng quà dùng Xu của người tặng; người nhận **không nhận Xu**, chỉ nhận quà hiển thị và Điểm tỏa sáng.
- Quà **không tặng lại, bán lại** hay quy đổi.

## 3. Vật phẩm nhân vật

- Vật phẩm chỉ dùng trong RaceHub, **không mua bán giữa người dùng**.
- Vật phẩm ngừng bán: người đã sở hữu vẫn giữ, hoặc được hoàn Xu theo thông báo.

## 4. Không có

- Không quay thưởng / hộp quà ngẫu nhiên trả phí.
- Không thưởng bằng tiền hay hiện vật gắn với Xu.

## 5. Vi phạm

Tài khoản gian lận Xu (bài chạy giả, lợi dụng lỗi) có thể bị thu hồi Xu / vật phẩm và khoá tài khoản.
$md$),

('cong-bang-chong-gian-lan', 'POLICY', 'Công bằng & chống gian lận', '⚖️', 'Mọi km phải là km thật', 30, false, date '2026-10-01', $md$
## Nguyên tắc

Bảng xếp hạng, thử thách và phần thưởng chỉ có ý nghĩa khi mọi km là **km chạy / đi bộ thật**.

## Hệ thống tự kiểm tra

- Tốc độ và pace ngoài ngưỡng chạy bộ (đi xe, xe máy).
- GPS nhảy, mất tín hiệu dài rồi nối thẳng.
- Bài trùng thời gian, bài nhập tay bất thường.

Bài nghi ngờ **chờ admin duyệt**; bài bị từ chối không tính km / Xu / XP.

## Không được

- Nhờ người khác chạy hộ, dùng phương tiện, giả lập GPS.
- Tạo nhiều tài khoản để nhận thưởng.

Vi phạm có thể bị: huỷ kết quả, thu hồi Xu / huy hiệu, loại khỏi thử thách, khoá tài khoản.
$md$),

('quy-che-cho-bib-doi-tac', 'POLICY', 'Quy chế Chợ BIB & Đối tác', '🎫', 'RaceHub chỉ kết nối, không giữ tiền', 40, true, date '2026-10-01', $md$
> Bản nháp — cần luật sư rà (có thể phải đăng ký sàn thương mại điện tử với Bộ Công Thương).

## Vai trò của RaceHub

RaceHub là nơi **kết nối** runner với nhau (Chợ BIB) và với HLV / cửa hàng / dịch vụ đã xác minh (Đối tác). RaceHub **không bán hàng, không nhận hay giữ tiền** của các bên.

## Chợ BIB

- Chỉ đăng BIB được phép chuyển nhượng theo điều lệ của giải. Người đăng tự chịu trách nhiệm.
- Giao dịch, thanh toán do hai bên tự thoả thuận.

## Đối tác

- Đối tác được admin xác minh trước khi hiện.
- Thông tin sản phẩm / dịch vụ do đối tác cung cấp và chịu trách nhiệm.

## Tranh chấp

Báo cho chúng tôi tại [Báo cáo vi phạm & khiếu nại](/help/bao-cao-vi-pham). Chúng tôi hỗ trợ cung cấp thông tin, gỡ tin vi phạm, khoá tài khoản lừa đảo.

Chủ sở hữu: {{company_name}} · MST {{tax_code}} · {{address}}.
$md$),

('thanh-toan-hoan-tien', 'POLICY', 'Thanh toán & hoàn tiền', '💳', 'Nạp Xu, VIP, CLB Pro', 50, true, date '2026-10-01', $md$
> Bản nháp — admin / luật sư bổ sung.

## Thanh toán

- Thanh toán bằng chuyển khoản VietQR tới tài khoản của {{company_name}}. RaceHub không lưu thông tin thẻ / tài khoản ngân hàng của bạn.
- Đơn được kích hoạt sau khi xác nhận nhận tiền.
- Gói **không tự gia hạn**.

## Hoàn tiền

- Chuyển khoản nhưng đơn chưa được kích hoạt: liên hệ hỗ trợ để kiểm tra và hoàn tiền.
- Gói đã kích hoạt / Xu đã dùng: không hoàn, trừ khi lỗi từ phía RaceHub hoặc theo quy định pháp luật.

Liên hệ: {{support_email}} · {{support_phone}}.
$md$),

('suc-khoe-an-toan', 'POLICY', 'Sức khoẻ & an toàn khi chạy', '❤️', 'Chạy vừa sức, an toàn trên đường', 60, false, date '2026-10-01', $md$
- RaceHub **không phải** thiết bị hay lời khuyên y tế. Hỏi bác sĩ trước khi bắt đầu tập nếu bạn có bệnh tim mạch, huyết áp, đang mang thai hoặc đang điều trị.
- Dừng ngay khi đau ngực, choáng, khó thở.
- Thử thách **không bắt buộc** chạy quá sức; hãy tăng km từ từ.
- Chạy nơi an toàn, chú ý giao thông; buổi tối mặc đồ phản quang.
- Không nhìn điện thoại khi chạy trên đường.
$md$),

('lien-he', 'SUPPORT', 'Liên hệ hỗ trợ', '💬', 'Báo lỗi, hỏi đáp, góp ý', 10, false, null, $md$
- Email: {{support_email}}
- Điện thoại: {{support_phone}}

Khi báo lỗi, hãy gửi kèm: ảnh chụp màn hình, thời gian xảy ra, tên thiết bị. Không gửi mật khẩu hay mã OTP cho bất kỳ ai — RaceHub không bao giờ hỏi.

{{company_name}} · MST {{tax_code}} · {{address}}
$md$),

('bao-cao-vi-pham', 'SUPPORT', 'Báo cáo vi phạm & khiếu nại', '🚩', 'Nội dung xấu, lừa đảo, khiếu nại quyết định', 20, false, null, $md$
## Báo cáo trong app

Bấm **Báo cáo** trên hồ sơ runner (Quanh đây) hoặc tin Chợ BIB. Người bị báo cáo không biết ai báo cáo.

Bài viết / tin nhắn trong CLB: báo ban quản trị CLB (họ có quyền gỡ), hoặc gửi cho chúng tôi theo cách dưới đây.

## Báo cáo qua email

Gửi tới {{report_email}} (hoặc {{support_email}}): đường link / ảnh chụp nội dung, lý do, thời gian.

## Khiếu nại quyết định

Nếu nội dung / tài khoản của bạn bị gỡ hoặc khoá mà bạn cho là nhầm, gửi khiếu nại kèm tên tài khoản. Chúng tôi phản hồi trong thời gian sớm nhất.
$md$),

('du-lieu-cua-toi', 'SUPPORT', 'Dữ liệu của tôi', '🔐', 'Đồng ý, tải về, xoá dữ liệu', 30, false, null, $md$
Theo Luật Bảo vệ dữ liệu cá nhân, bạn có quyền biết, đồng ý, rút lại đồng ý, xem, sửa, yêu cầu xoá dữ liệu của mình.

## Tự làm trong app

- **Chia sẻ bài Strava** cho CLB / BXH: Cài đặt → Quyền riêng tư (bật / tắt bất cứ lúc nào).
- **Quanh đây** (vị trí gần đúng): tắt trong màn Quanh đây → dữ liệu vị trí bị xoá ngay.
- **Thông báo đẩy:** Cài đặt → Thông báo.
- **Ngắt Strava:** trang Tôi → Strava.
- **Xoá tài khoản:** menu ☰ → Xoá tài khoản.

Từ chối các đồng ý tuỳ chọn **không** ảnh hưởng việc dùng các tính năng còn lại.

## Yêu cầu khác (tải về dữ liệu, sửa, khiếu nại)

Liên hệ người phụ trách dữ liệu cá nhân: {{dpo_contact}} (hoặc {{support_email}}).

Chi tiết: [Chính sách quyền riêng tư](/privacy).
$md$)
on conflict (slug) do nothing;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001007400_strava_share_default_on.sql
-- ===================================================================
-- 007400: Bài Strava hiện cho CLB & bảng xếp hạng NGAY khi runner kết nối Strava — không hỏi riêng nữa.
-- Quyết định sản phẩm (09/2026): bấm "Connect with Strava" (có dòng thông báo ngay dưới nút) được coi là đồng ý chia sẻ
-- quãng đường / thời gian bài chạy trong RaceHub. Runner vẫn TẮT được bất cứ lúc nào ở Cài đặt → Quyền riêng tư
-- (quyền rút lại đồng ý theo Luật Bảo vệ dữ liệu cá nhân) — chỉ lựa chọn TẮT rõ ràng (strava_share = false) mới ẩn bài.
-- Bản đồ tuyến, từng km, nhịp tim bài Strava vẫn chỉ chủ bài xem (006700). Admin vẫn chuyển được chính sách chung
-- (Quản trị → Hệ thống → Strava) sang "chỉ chủ bài" nếu Strava yêu cầu.
-- Áp dụng ngay cho bài cũ: bài Strava của người chưa từng trả lời được chia sẻ lại → trigger tự đưa vào bảng tin CLB,
-- thử thách, giải chạy đang diễn ra.
-- Cần 007000. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT. Chạy lại nhiều lần vẫn an toàn.

create or replace function private.activity_shared(p_user uuid, p_source text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when coalesce(p_source, '') <> 'STRAVA' then true
    when private.strava_share_policy() = 'ALL' then true
    when private.strava_share_policy() = 'OWNER_ONLY' then false
    else coalesce((select s.strava_share from public.profile_settings s where s.user_id = p_user), true) end
$$;

create or replace function public.my_strava_sharing() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  return jsonb_build_object(
    'policy', private.strava_share_policy(),
    'consent', coalesce((select s.strava_share from public.profile_settings s where s.user_id = v_uid), true),
    'connected', exists (select 1 from public.connected_accounts c where c.user_id = v_uid and c.provider = 'STRAVA'),
    'strava_runs', (select count(*) from public.activities a where a.user_id = v_uid and a.source = 'STRAVA'),
    'hidden_runs', (select count(*) from public.activities a where a.user_id = v_uid and a.source = 'STRAVA' and not a.shared));
end $$;

create or replace function public.admin_strava_sharing_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_connected integer := (select count(*) from public.connected_accounts c where c.provider = 'STRAVA');
  v_out integer := (select count(*) from public.profile_settings s where s.strava_share is false
                      and exists (select 1 from public.connected_accounts c where c.user_id = s.user_id and c.provider = 'STRAVA'));
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'policy', private.strava_share_policy(),
    'connected', v_connected,
    'opted_in', v_connected - v_out,
    'opted_out', v_out,
    'hidden_runs', (select count(*) from public.activities a where a.source = 'STRAVA' and not a.shared));
end $$;

revoke all on function private.activity_shared(uuid, text) from public, anon, authenticated;
revoke all on function public.my_strava_sharing(), public.admin_strava_sharing_stats() from public, anon;
grant execute on function public.my_strava_sharing(), public.admin_strava_sharing_stats() to authenticated;

-- Trang hướng dẫn "Chạy & ghi bài" (007300): đổi đoạn giải thích cũ nếu admin chưa sửa đoạn này
update public.help_pages
   set body = replace(replace(body, '## Bài Strava không hiện cho người khác?', '## Bài Strava có hiện cho CLB không?'),
     'Theo quy định API của Strava, bài từ Strava chỉ hiện trên bảng tin / BXH khi **bạn đồng ý chia sẻ** (Cài đặt → Quyền riêng tư). Chưa đồng ý, bài vẫn tính Xu / XP / huy hiệu cho chính bạn.',
     'Khi kết nối Strava, bài chạy của bạn tự hiện trên bảng tin CLB và bảng xếp hạng (chỉ quãng đường, thời gian; bản đồ và nhịp tim chỉ bạn xem). Muốn ẩn: **Cài đặt → Quyền riêng tư → Tắt**. Bài đã ẩn vẫn tính Xu / XP / huy hiệu cho chính bạn.'),
       updated_at = now()
 where slug = 'chay-va-ghi-bai' and body like '%khi **bạn đồng ý chia sẻ**%';

-- Chia sẻ lại bài Strava của người chưa từng chọn TẮT → trigger phía sau đưa vào CLB / thử thách / giải chạy
select private.strava_reshare(null);

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001007500_plan_credits_fix.sql
-- ===================================================================
-- 007500: Sửa lỗi "Không tính được phí" khi tạo thử thách / giải chạy cho CLB Pro + báo giá biết gói đang dùng.
-- Sự cố (09/2026): CLB được admin bật Pro bằng tay (NO BEER NO RUN) → tạo thử thách báo "Không tính được phí".
-- Nguyên nhân: private.issue_credits (003800) có biến vòng lặp tên "c" trùng bí danh bảng "clubs c" trong câu lấy pro_until
-- → lỗi 'record "c" is not assigned yet' mỗi lần báo giá / tạo cho CLB Pro không có đơn mua gói.
-- Sửa: đổi tên biến. Báo giá quote_challenge trả thêm:
--   plan: gói đang hiệu lực của bên trả phí (VIP / CLB Pro) — để giao diện ẩn phần phí khi đã được gói bao;
--   best_pass_slots: quy mô lớn nhất mà lượt tạo miễn phí còn lại bao được.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT. Chạy lại nhiều lần vẫn an toàn.

create or replace function private.issue_credits(p_owner_type text, p_owner uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_plan jsonb := private.active_plan(p_owner);
  v_code text;
  v_until timestamptz;
  v_month timestamptz := private.vn_month_start(now());
  v_next timestamptz := private.vn_month_start(private.vn_month_start(now()) + interval '32 days');
  r_credit record;
  n integer := 0;
begin
  if v_plan <> 'null'::jsonb then
    v_code := v_plan->>'plan_code'; v_until := (v_plan->>'ends_at')::timestamptz;
  elsif p_owner_type = 'CLUB' and private.club_is_pro(p_owner) then           -- CLB Pro do admin bật tay
    v_code := 'CLUB_PRO'; v_until := coalesce((select cl.pro_until from public.clubs cl where cl.id = p_owner), v_next);
  else
    return 0;
  end if;
  for r_credit in select pc.capacity, pc.per_month from public.plan_credits pc where pc.plan_code = v_code loop
    insert into public.challenge_passes (owner_type, owner_id, max_slots, total, remaining, expires_at, note, source_key)
    values (p_owner_type, p_owner, r_credit.capacity, r_credit.per_month, r_credit.per_month, least(v_next, v_until),
            'Lượt tạo ' || coalesce((select p.name from public.plans p where p.code = v_code), v_code) || ' tháng '
              || to_char(v_month at time zone 'Asia/Ho_Chi_Minh', 'MM/YYYY'),
            'credit:' || p_owner || ':' || v_code || ':' || to_char(v_month at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM') || ':' || r_credit.capacity)
    on conflict (source_key) where source_key is not null do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Gói đang hiệu lực của một người / CLB (CLB Pro bật tay cũng tính)
create or replace function private.plan_badge(p_owner uuid, p_is_club boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select case
    when private.active_plan(p_owner) <> 'null'::jsonb
      then jsonb_build_object('code', private.active_plan(p_owner)->>'plan_code', 'name', private.active_plan(p_owner)->>'name')
    when p_is_club and private.club_is_pro(p_owner)
      then jsonb_build_object('code', 'CLUB_PRO', 'name', coalesce((select p.name from public.plans p where p.code = 'CLUB_PRO'), 'CLB Pro'))
    else null end
$$;

create or replace function public.quote_challenge(p_max_slots integer, p_format text default 'RANKED', p_club_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_slots integer := case when p_format = 'DUEL' then 2 when p_format = 'SOLO_GOAL' then 1 else greatest(coalesce(p_max_slots, 1), 1) end;
  v_fee integer := private.challenge_creation_fee(p_format = 'TEAM', v_slots, now(), now() + interval '1 day');
  v_payer uuid := case when p_club_id is not null and public.club_is_staff(p_club_id) then p_club_id else v_uid end;
  v_pass public.challenge_passes;
begin
  perform private.issue_credits(case when v_payer = v_uid then 'USER' else 'CLUB' end, v_payer);
  v_pass := (select t.x from (select x, row_number() over (order by x.expires_at nulls last, x.max_slots, x.created_at) as rn
                                from public.challenge_passes x
                               where x.owner_id = v_payer and x.remaining > 0 and x.max_slots >= v_slots
                                 and (x.expires_at is null or x.expires_at > now())) t where t.rn = 1);
  return jsonb_build_object(
    'fee', v_fee, 'tier', private.capacity_tier(v_slots), 'custom', private.capacity_tier(v_slots)->>'xu' is null,
    'payer', case when v_payer = v_uid then 'USER' else 'CLUB' end,
    'payer_balance', private.balance(v_payer), 'wallet_balance', private.balance(v_uid),
    'pass', case when v_pass.id is null or v_fee = 0 then null
                 else jsonb_build_object('id', v_pass.id, 'remaining', v_pass.remaining, 'max_slots', v_pass.max_slots,
                                         'expires_at', v_pass.expires_at, 'note', v_pass.note) end,
    'plan', private.plan_badge(v_payer, v_payer <> v_uid),
    'best_pass_slots', coalesce((select max(x.max_slots) from public.challenge_passes x
                                  where x.owner_id = v_payer and x.remaining > 0 and (x.expires_at is null or x.expires_at > now())), 0),
    'xu_vnd', (private.economy_config()->>'xuVnd')::numeric,
    'policy', private.economy_config());
end $$;

revoke all on function private.issue_credits(text, uuid), private.plan_badge(uuid, boolean) from public, anon, authenticated;
revoke all on function public.quote_challenge(integer, text, uuid) from public, anon;
grant execute on function public.quote_challenge(integer, text, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
