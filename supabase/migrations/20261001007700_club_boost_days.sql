-- 007700: "Ngày vàng" ×1,5 / ×2 / ×3 của CLB — học từ Tucana.
-- Ban quản trị CLB chọn ngày đặc biệt (sinh nhật CLB, 30/4, trước giải lớn…): km chạy trong ngày đó (giờ VN) được NHÂN
-- khi tính thử thách nội bộ CLB (thử thách tính theo km) và bảng xếp hạng CLB (club_leaderboard_v2: km thật + km thưởng).
-- KHÔNG nhân XP, Xu, huy hiệu, giải chạy ảo, CLB đấu CLB / thách đấu nhiều CLB (công bằng giữa các CLB; XP chỉ từ km thật).
-- Phải đặt trước (từ ngày mai trở đi) để mọi người biết và bài đã tính không bị đổi; tối đa 4 ngày vàng mỗi tháng.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT. Chạy lại nhiều lần vẫn an toàn.

create table if not exists public.club_boost_days (
  club_id uuid not null references public.clubs(id) on delete cascade,
  day date not null,
  multiplier numeric not null check (multiplier in (1.5, 2, 3)),
  title text not null check (char_length(title) between 2 and 80),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (club_id, day)
);
alter table public.club_boost_days enable row level security;
revoke all on public.club_boost_days from anon, authenticated;

alter table public.challenge_progress_events add column if not exists boost numeric not null default 1;

create or replace function private.vn_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Ho_Chi_Minh')::date $$;

create or replace function private.club_boost(p_club uuid, p_day date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select b.multiplier from public.club_boost_days b where b.club_id = p_club and b.day = p_day), 1)
$$;

-- Thử thách: bản 007000 + nhân km ngày vàng cho thử thách nội bộ CLB tính theo km
create or replace function private.challenge_apply_activity(p_activity_id uuid, p_only_participant uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  a public.activities := (select x from public.activities x where x.id = p_activity_id);
  r record;
  v_day date;
  v_km numeric;
  v_already numeric;
  v_counted numeric;
  v_boost numeric;
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
      -- trần mỗi ngày tính trên km thật (chia lại hệ số đã nhân)
      v_already := (select coalesce(sum(e.counted_m / e.boost), 0) from public.challenge_progress_events e
                     where e.participant_id = r.pid and e.day = v_day and e.activity_id <> a.id);
      v_counted := least(v_counted, greatest(r.daily_cap_km * 1000 - v_already, 0));
    end if;
    v_boost := case when r.target_club_id is not null and r.objective = 'DISTANCE' then private.club_boost(r.target_club_id, v_day) else 1 end;

    insert into public.challenge_progress_events (challenge_id, participant_id, activity_id, day, distance_m, counted_m, moving_s, boost)
    values (r.id, r.pid, a.id, v_day, v_km * 1000, v_counted * v_boost, coalesce(a.moving_time_s, 0), v_boost)
    on conflict (participant_id, activity_id) do nothing;
    if found then
      perform private.challenge_recompute_participant(r.pid);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- BXH CLB kèm km thưởng ngày vàng (giữ nguyên club_leaderboard cũ để app bản cũ vẫn chạy)
create or replace function public.club_leaderboard_v2(p_club_id uuid, p_period text default 'WEEK') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.club_is_member(p_club_id) then raise exception 'NOT_A_MEMBER'; end if;
  if upper(coalesce(p_period, '')) not in ('WEEK', 'MONTH', 'ALL') then raise exception 'INVALID_PERIOD'; end if;
  return (
    with totals as (
      select m.user_id, m.role,
             coalesce(sum(a.distance_m), 0)::numeric as distance_m,
             coalesce(sum(a.distance_m * (b.multiplier - 1)), 0)::numeric as bonus_m,
             count(a.id)::int as run_count,
             coalesce(sum(a.moving_time_s), 0)::bigint as moving_s
        from public.club_members m
        left join public.activities a
          on a.user_id = m.user_id and a.validation_status = 'APPROVED' and a.shared
         and coalesce(a.status, '') <> 'DELETED' and a.started_at >= private.period_start(p_period)
        left join public.club_boost_days b
          on b.club_id = p_club_id and b.day = (a.started_at at time zone 'Asia/Ho_Chi_Minh')::date
       where m.club_id = p_club_id and m.status = 'APPROVED'
       group by m.user_id, m.role
    ), ranked as (
      select (rank() over (order by t.distance_m + t.bonus_m desc))::int as rank, t.*, pr.avatar_url, coalesce(pr.level, 1)::int as level,
             private.display_name(t.user_id) as display_name
        from totals t join public.profiles pr on pr.id = t.user_id
    )
    select coalesce(jsonb_agg(jsonb_build_object('rank', r.rank, 'user_id', r.user_id, 'display_name', r.display_name,
             'avatar_url', r.avatar_url, 'level', r.level, 'role', r.role, 'distance_m', r.distance_m, 'bonus_m', r.bonus_m,
             'run_count', r.run_count, 'moving_s', r.moving_s)
             order by r.distance_m + r.bonus_m desc, r.run_count desc, r.display_name), '[]'::jsonb)
      from ranked r);
end $$;

-- Danh sách ngày vàng (30 ngày trước → 1 năm tới)
create or replace function public.club_boost_days(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.club_is_member(p_club_id) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('day', b.day, 'multiplier', b.multiplier, 'title', b.title,
                                                       'editable', b.day > private.vn_today()) order by b.day)
                     from public.club_boost_days b
                    where b.club_id = p_club_id and b.day between private.vn_today() - 30 and private.vn_today() + 366), '[]'::jsonb);
end $$;

create or replace function public.set_club_boost_day(p_club_id uuid, p_day date, p_multiplier numeric, p_title text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_title text := trim(coalesce(p_title, ''));
  v_name text := (select c.name from public.clubs c where c.id = p_club_id);
  v_new boolean := not exists (select 1 from public.club_boost_days b where b.club_id = p_club_id and b.day = p_day);
begin
  if not public.club_is_staff(p_club_id) then raise exception 'FORBIDDEN'; end if;
  if p_day is null or p_day <= private.vn_today() or p_day > private.vn_today() + 366 then raise exception 'BOOST_DAY_TOO_LATE'; end if;
  if p_multiplier is null or p_multiplier not in (1.5, 2, 3) then raise exception 'INVALID_MULTIPLIER'; end if;
  if char_length(v_title) not between 2 and 80 then raise exception 'INVALID_TITLE'; end if;
  if v_new and (select count(*) from public.club_boost_days b where b.club_id = p_club_id
                   and date_trunc('month', b.day) = date_trunc('month', p_day)) >= 4 then
    raise exception 'BOOST_DAYS_LIMIT';
  end if;
  insert into public.club_boost_days (club_id, day, multiplier, title, created_by) values (p_club_id, p_day, p_multiplier, v_title, v_uid)
  on conflict (club_id, day) do update set multiplier = excluded.multiplier, title = excluded.title;
  if v_new then
    perform private.notify_club(p_club_id, false, 'CLUB_BOOST_DAY',
      'Ngày vàng ×' || trim(to_char(p_multiplier, 'FM9.9')) || ' ở ' || v_name || ': ' || to_char(p_day, 'DD/MM'),
      v_title || ' — km chạy trong ngày được nhân ×' || trim(to_char(p_multiplier, 'FM9.9')) || ' trên BXH và thử thách của CLB.',
      '/clubs/' || p_club_id || '/leaderboard', v_uid);
  end if;
  return public.club_boost_days(p_club_id);
end $$;

create or replace function public.delete_club_boost_day(p_club_id uuid, p_day date) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform private.require_uid();
  if not public.club_is_staff(p_club_id) then raise exception 'FORBIDDEN'; end if;
  if p_day <= private.vn_today() then raise exception 'BOOST_DAY_TOO_LATE'; end if;
  delete from public.club_boost_days where club_id = p_club_id and day = p_day;
  return public.club_boost_days(p_club_id);
end $$;

revoke all on function private.vn_today(), private.club_boost(uuid, date) from public, anon, authenticated;
revoke all on function public.club_leaderboard_v2(uuid, text), public.club_boost_days(uuid), public.set_club_boost_day(uuid, date, numeric, text),
  public.delete_club_boost_day(uuid, date) from public, anon;
grant execute on function public.club_leaderboard_v2(uuid, text), public.club_boost_days(uuid), public.set_club_boost_day(uuid, date, numeric, text),
  public.delete_club_boost_day(uuid, date) to authenticated;

notify pgrst, 'reload schema';
