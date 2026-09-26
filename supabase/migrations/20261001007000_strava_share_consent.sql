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
