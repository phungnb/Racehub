-- RaceHub — PHẦN 10/12 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 007600, 007700, 007800, 007900, 008000, 008100, 008200
-- Supabase → SQL Editor → New query → dán TOÀN BỘ phần này → Run. Lỗi thì không có gì thay đổi; chạy lại vẫn an toàn.
-- Xong thì chạy phần tiếp theo.
begin;
-- ===================================================================
-- 20261001007600_recurring_challenges.sql
-- ===================================================================
-- 007600: Thử thách tự lặp lại (hằng tuần / tháng / quý / năm) — học từ Tucana.
-- Ban quản trị tạo "Thử thách tuần của CLB" MỘT lần, bật lặp lại; trước khi kỳ hiện tại kết thúc ~1,5 ngày, cron hằng
-- ngày (/api/cron/challenges) tự tạo kỳ kế tiếp với cùng luật chơi (luật km/pace, mục tiêu tự đăng ký, nhịp tim, thể lệ).
-- Kỳ mới được tạo ĐÚNG như người tạo tự bấm tạo (gọi create_challenge_v2 dưới danh nghĩa người tạo): kiểm tra quyền
-- ban quản trị CLB, tính phí theo quy mô, dùng lượt miễn phí VIP / CLB Pro, trừ quỹ — không có đường tắt miễn phí.
-- Không tạo được (hết Xu / quỹ, không còn là ban quản trị…) → ghi lý do + báo người tạo; ngày sau cron thử lại.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT. Chạy lại nhiều lần vẫn an toàn.

alter table public.challenges add column if not exists recurrence text not null default 'NONE';
alter table public.challenges add column if not exists series_id uuid;
alter table public.challenges add column if not exists occurrence integer not null default 1;
alter table public.challenges add column if not exists recur_next_id uuid;
alter table public.challenges add column if not exists recur_error text;
alter table public.challenges drop constraint if exists challenges_recurrence_check;
alter table public.challenges add constraint challenges_recurrence_check check (recurrence in ('NONE', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'));
create index if not exists challenges_recurring_idx on public.challenges (end_date) where recurrence <> 'NONE' and recur_next_id is null;

create or replace function private.recurrence_step(p_recurrence text) returns interval
language sql immutable as $$
  select case p_recurrence when 'WEEKLY' then interval '7 days' when 'MONTHLY' then interval '1 month'
                           when 'QUARTERLY' then interval '3 months' when 'YEARLY' then interval '1 year' end
$$;

-- Bật / tắt lặp lại (ban quản trị thử thách). Tắt thì kỳ hiện tại vẫn chạy bình thường, chỉ không sinh kỳ mới.
create or replace function public.set_challenge_recurrence(p_challenge_id uuid, p_recurrence text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id for update);
  v_rec text := upper(coalesce(p_recurrence, 'NONE'));
begin
  perform private.require_uid();
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if not private.challenge_is_manager(c) then raise exception 'FORBIDDEN'; end if;
  if v_rec not in ('NONE', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY') then raise exception 'INVALID_RECURRENCE'; end if;
  if v_rec <> 'NONE' and c.format = 'DUEL' then raise exception 'RECURRENCE_NOT_SUPPORTED'; end if;
  if v_rec <> 'NONE' and c.status = 'CANCELLED' then raise exception 'CHALLENGE_CLOSED'; end if;
  if v_rec <> 'NONE' and c.end_date - c.start_date > private.recurrence_step(v_rec) then raise exception 'RECURRENCE_TOO_SHORT'; end if;
  update public.challenges set recurrence = v_rec, series_id = coalesce(series_id, id), recur_error = null where id = c.id;
  return jsonb_build_object('recurrence', v_rec, 'series_id', coalesce(c.series_id, c.id));
end $$;

-- Tạo kỳ kế tiếp cho một thử thách lặp lại (gọi từ cron, quyền service_role)
create or replace function private.spawn_next_occurrence(p_id uuid) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  c public.challenges := (select x from public.challenges x where x.id = p_id for update);
  v_step interval;
  v_start timestamptz;
  v_end timestamptz;
  v_base text;
  v_payload jsonb;
  v_old_claims text := current_setting('request.jwt.claims', true);
  v_old_sub text := current_setting('request.jwt.claim.sub', true);
  v_new uuid;
  v_n integer := 0;
begin
  if c.id is null or c.recurrence = 'NONE' or c.recur_next_id is not null or c.status = 'CANCELLED' or c.created_by is null then return null; end if;
  v_step := private.recurrence_step(c.recurrence);
  v_start := c.start_date + v_step;
  v_end := c.end_date + v_step;
  while v_end <= now() + interval '1 hour' and v_n < 60 loop          -- bỏ lỡ nhiều kỳ (cron dừng): nhảy tới kỳ còn hiệu lực
    v_start := v_start + v_step; v_end := v_end + v_step; v_n := v_n + 1;
  end loop;
  if c.format = 'TEAM' and v_start < now() + interval '15 minutes' then v_start := now() + interval '15 minutes'; end if;
  v_base := regexp_replace(c.title, '\s*·\s*Kỳ \d+$', '');
  v_payload := jsonb_build_object(
    'title', left(v_base, 108) || ' · Kỳ ' || (c.occurrence + 1), 'description', c.description, 'format', c.format,
    'objective', c.objective, 'game_mode', c.game_mode, 'target_value', c.target_value, 'min_km', c.min_km,
    'min_pace', c.min_pace, 'max_pace', c.max_pace, 'daily_cap_km', c.daily_cap_km,
    'start_date', v_start, 'end_date', v_end, 'max_slots', c.max_slots, 'audience', c.target_audience,
    'club_id', c.target_club_id, 'team_size', c.fixed_team_size, 'reward_xu', c.reward_xu,
    'reward_source', c.reward_source, 'reward_split', c.reward_split,
    'team_names', coalesce((select jsonb_agg(t.name order by t.position) from public.challenge_teams t where t.challenge_id = c.id), '[]'::jsonb));

  -- Tạo như chính người tạo bấm tạo: mọi kiểm tra quyền / phí / lượt / quỹ giữ nguyên
  perform set_config('request.jwt.claims', json_build_object('sub', c.created_by, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', c.created_by::text, true);
  begin
    v_new := (public.create_challenge_v2(v_payload, 'recur:' || c.id)->>'challenge_id')::uuid;
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_old_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(v_old_sub, ''), true);
    if c.recur_error is distinct from sqlerrm then
      update public.challenges set recur_error = left(sqlerrm, 200) where id = c.id;
      perform private.notify(c.created_by, c.target_club_id, 'CHALLENGE_RECUR_FAILED', 'Chưa tạo được kỳ mới: ' || left(c.title, 80),
        case when sqlerrm like '%INSUFFICIENT%' then 'Ví / quỹ CLB không đủ Xu cho phí tạo. Nạp thêm hoặc giảm quy mô — hệ thống thử lại mỗi ngày.'
             when sqlerrm like '%FORBIDDEN%' then 'Bạn không còn là ban quản trị CLB. Tắt lặp lại hoặc nhờ ban quản trị tạo.'
             else 'Hệ thống thử lại mỗi ngày. Lý do: ' || left(sqlerrm, 120) end,
        '/challenges/' || c.id, null, true);
    end if;
    return null;
  end;
  perform set_config('request.jwt.claims', coalesce(v_old_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_old_sub, ''), true);

  -- Chép phần thiết lập thêm (nhịp tim, mục tiêu tự đăng ký, thể lệ) và nối chuỗi kỳ
  update public.challenges n set
    require_hr = c.require_hr, rules_info = c.rules_info, rules_updated_at = case when c.rules_info <> '{}'::jsonb then now() end,
    pledge_enabled = c.pledge_enabled, pledge_options = c.pledge_options, pledge_min_km = c.pledge_min_km,
    pledge_max_km = c.pledge_max_km, pledge_cap_pct = c.pledge_cap_pct, pledge_team_size = c.pledge_team_size,
    game_mode = case when c.pledge_enabled and c.format = 'TEAM' then 'TEAM_SUM' else n.game_mode end,
    recurrence = c.recurrence, series_id = coalesce(c.series_id, c.id), occurrence = c.occurrence + 1
  where n.id = v_new;
  update public.challenges set recur_next_id = v_new, recur_error = null, series_id = coalesce(series_id, id) where id = c.id;
  return v_new;
end $$;

create or replace function public.spawn_recurring_challenges() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in select id from public.challenges
            where recurrence <> 'NONE' and recur_next_id is null and status <> 'CANCELLED'
              and end_date <= now() + interval '36 hours'
            order by end_date loop
    if private.spawn_next_occurrence(r.id) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Danh sách các kỳ trong một chuỗi (để xem lại kết quả kỳ trước)
create or replace function public.challenge_series(p_challenge_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'occurrence', x.occurrence, 'status', x.status,
                                              'start_date', x.start_date, 'end_date', x.end_date) order by x.occurrence desc), '[]'::jsonb)
    from public.challenges x
   where x.series_id = (select coalesce(c.series_id, c.id) from public.challenges c where c.id = p_challenge_id)
     and x.status <> 'CANCELLED'
$$;

revoke all on function private.recurrence_step(text), private.spawn_next_occurrence(uuid) from public, anon, authenticated;
revoke all on function public.set_challenge_recurrence(uuid, text), public.challenge_series(uuid), public.spawn_recurring_challenges() from public, anon;
grant execute on function public.set_challenge_recurrence(uuid, text), public.challenge_series(uuid) to authenticated;
revoke all on function public.spawn_recurring_challenges() from authenticated;
grant execute on function public.spawn_recurring_challenges() to service_role;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001007700_club_boost_days.sql
-- ===================================================================
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

-- ===================================================================
-- 20261001007800_hall_of_fame_milestones.sql
-- ===================================================================
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

-- ===================================================================
-- 20261001007900_club_shop.sql
-- ===================================================================
-- 007900: Cửa hàng CLB — đặt áo, BIB, mũ… ngay trong app (học từ Tucana) mà RaceHub KHÔNG giữ tiền.
-- • Ban quản trị CLB đăng sản phẩm (ảnh, giá, size, hạn chốt đơn, số lượng giới hạn).
-- • Thành viên đặt → app hiện mã VietQR chuyển THẲNG vào tài khoản ngân hàng của CLB (đã khai ở tab Quỹ), nội dung CK
--   là mã đơn. RaceHub chỉ ghi đơn; ban quản trị đối soát sao kê rồi bấm "Đã nhận tiền" → "Đã giao".
-- • Bảng tổng hợp size cho xưởng may, xuất CSV. Không có thanh toán qua RaceHub, không thu phí trên đơn.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT. Chạy lại nhiều lần vẫn an toàn.

create table if not exists public.club_products (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 80),
  description text check (description is null or char_length(description) <= 1000),
  image_url text check (image_url is null or image_url ~ '^https://'),
  price_vnd integer not null check (price_vnd between 0 and 50000000),
  sizes text[] not null default '{}' check (cardinality(sizes) <= 12),
  stock integer check (stock is null or stock between 1 and 100000),
  max_per_order integer not null default 5 check (max_per_order between 1 and 50),
  order_deadline timestamptz,
  status text not null default 'OPEN' check (status in ('OPEN', 'CLOSED', 'HIDDEN')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists club_products_club_idx on public.club_products (club_id, created_at desc);

create table if not exists public.club_orders (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  product_id uuid not null references public.club_products(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  items jsonb not null,                        -- [{ "size": "M", "qty": 2 }]
  quantity integer not null check (quantity between 1 and 50),
  amount_vnd bigint not null check (amount_vnd >= 0),
  note text check (note is null or char_length(note) <= 200),
  code text not null unique,
  status text not null default 'PENDING' check (status in ('PENDING', 'PAID', 'DELIVERED', 'CANCELLED')),
  status_note text,
  paid_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists club_orders_product_idx on public.club_orders (product_id, created_at desc);
create index if not exists club_orders_user_idx on public.club_orders (user_id, created_at desc);

alter table public.club_products enable row level security;
alter table public.club_orders enable row level security;
revoke all on public.club_products, public.club_orders from anon, authenticated;

create or replace function private.club_bank(p_club uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when c.bank_bin is null or c.bank_account_no is null then null
              else jsonb_build_object('bin', c.bank_bin, 'account_no', c.bank_account_no, 'account_name', c.bank_account_name) end
    from public.clubs c where c.id = p_club
$$;

create or replace function private.club_order_json(o public.club_orders) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', o.id, 'product_id', o.product_id, 'product_title', (select p.title from public.club_products p where p.id = o.product_id),
    'user_id', o.user_id, 'buyer', private.display_name(o.user_id), 'items', o.items, 'quantity', o.quantity, 'amount_vnd', o.amount_vnd,
    'note', o.note, 'code', o.code, 'status', o.status, 'status_note', o.status_note, 'paid_at', o.paid_at,
    'delivered_at', o.delivered_at, 'created_at', o.created_at)
$$;

-- Số đã đặt (không tính đơn huỷ) của một sản phẩm
create or replace function private.club_product_sold(p_product uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(sum(o.quantity), 0)::int from public.club_orders o where o.product_id = p_product and o.status <> 'CANCELLED'
$$;

-- Cửa hàng: sản phẩm + đơn của tôi (+ số liệu cho ban quản trị)
create or replace function public.club_shop(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_staff boolean := public.club_is_staff(p_club_id);
begin
  if not public.club_is_member(p_club_id) then raise exception 'NOT_A_MEMBER'; end if;
  return jsonb_build_object(
    'is_staff', v_staff,
    'bank', private.club_bank(p_club_id),
    'products', coalesce((select jsonb_agg(to_jsonb(p) - 'created_by'
                   || jsonb_build_object('sold', private.club_product_sold(p.id),
                        'open', p.status = 'OPEN' and (p.order_deadline is null or p.order_deadline > now())
                                and (p.stock is null or private.club_product_sold(p.id) < p.stock),
                        'pending', case when v_staff then (select count(*) from public.club_orders o where o.product_id = p.id and o.status = 'PENDING') end,
                        'paid', case when v_staff then (select count(*) from public.club_orders o where o.product_id = p.id and o.status in ('PAID', 'DELIVERED')) end)
                   order by (p.status = 'OPEN') desc, p.created_at desc)
                  from public.club_products p where p.club_id = p_club_id and (p.status <> 'HIDDEN' or v_staff)), '[]'::jsonb),
    'my_orders', coalesce((select jsonb_agg(private.club_order_json(o) order by o.created_at desc)
                  from public.club_orders o where o.club_id = p_club_id and o.user_id = v_uid), '[]'::jsonb));
end $$;

create or replace function public.save_club_product(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_club uuid := coalesce((select x.club_id from public.club_products x where x.id = v_id), nullif(p->>'club_id', '')::uuid);
  v_sizes text[] := coalesce((select array_agg(left(trim(s), 10)) from jsonb_array_elements_text(coalesce(p->'sizes', '[]'::jsonb)) s where trim(s) <> ''), '{}');
begin
  if v_club is null or not public.club_is_staff(v_club) then raise exception 'FORBIDDEN'; end if;
  if char_length(trim(coalesce(p->>'title', ''))) not between 2 and 80 then raise exception 'INVALID_TITLE'; end if;
  if coalesce((p->>'price_vnd')::bigint, -1) not between 0 and 50000000 then raise exception 'INVALID_PRICE'; end if;
  if coalesce(p->>'status', 'OPEN') not in ('OPEN', 'CLOSED', 'HIDDEN') then raise exception 'INVALID_STATUS'; end if;
  if v_id is null then
    insert into public.club_products (club_id, title, description, image_url, price_vnd, sizes, stock, max_per_order, order_deadline, status, created_by)
    values (v_club, trim(p->>'title'), nullif(trim(coalesce(p->>'description', '')), ''), nullif(p->>'image_url', ''), (p->>'price_vnd')::int,
            v_sizes, nullif(p->>'stock', '')::int, coalesce(nullif(p->>'max_per_order', '')::int, 5), nullif(p->>'order_deadline', '')::timestamptz,
            coalesce(p->>'status', 'OPEN'), v_uid)
    returning id into v_id;
    if coalesce(p->>'status', 'OPEN') = 'OPEN' then
      perform private.notify_club(v_club, false, 'CLUB_SHOP', 'Cửa hàng CLB: ' || trim(p->>'title'),
        'Mở đặt hàng' || case when nullif(p->>'order_deadline', '') is not null
                              then ' tới ' || to_char((p->>'order_deadline')::timestamptz at time zone 'Asia/Ho_Chi_Minh', 'DD/MM') else '' end || '. Xem và đặt ngay trong CLB.',
        '/clubs/' || v_club || '/shop', v_uid);
    end if;
  else
    update public.club_products set title = trim(p->>'title'), description = nullif(trim(coalesce(p->>'description', '')), ''),
      image_url = nullif(p->>'image_url', ''), price_vnd = (p->>'price_vnd')::int, sizes = v_sizes, stock = nullif(p->>'stock', '')::int,
      max_per_order = coalesce(nullif(p->>'max_per_order', '')::int, 5), order_deadline = nullif(p->>'order_deadline', '')::timestamptz,
      status = coalesce(p->>'status', 'OPEN'), updated_at = now()
    where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.place_club_order(p_product_id uuid, p_items jsonb, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  pr public.club_products := (select x from public.club_products x where x.id = p_product_id for update);
  v_items jsonb;
  v_qty integer;
  v_code text;
  o public.club_orders;
begin
  if pr.id is null or pr.status = 'HIDDEN' then raise exception 'PRODUCT_NOT_FOUND'; end if;
  if not public.club_is_member(pr.club_id) then raise exception 'NOT_A_MEMBER'; end if;
  if pr.status <> 'OPEN' or (pr.order_deadline is not null and pr.order_deadline <= now()) then raise exception 'ORDERS_CLOSED'; end if;
  if private.club_bank(pr.club_id) is null then raise exception 'CLUB_BANK_MISSING'; end if;
  v_items := (select coalesce(jsonb_agg(jsonb_build_object('size', nullif(trim(coalesce(i->>'size', '')), ''), 'qty', (i->>'qty')::int)), '[]'::jsonb)
                from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i where coalesce((i->>'qty')::int, 0) > 0);
  v_qty := (select coalesce(sum((i->>'qty')::int), 0) from jsonb_array_elements(v_items) i);
  if v_qty < 1 or v_qty > pr.max_per_order then raise exception 'INVALID_QUANTITY'; end if;
  if cardinality(pr.sizes) > 0 and exists (select 1 from jsonb_array_elements(v_items) i where not ((i->>'size') = any (pr.sizes))) then
    raise exception 'INVALID_SIZE';
  end if;
  if pr.stock is not null and private.club_product_sold(pr.id) + v_qty > pr.stock then raise exception 'OUT_OF_STOCK'; end if;
  loop
    v_code := 'RH' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from public.club_orders x where x.code = v_code);
  end loop;
  insert into public.club_orders (club_id, product_id, user_id, items, quantity, amount_vnd, note, code)
  values (pr.club_id, pr.id, v_uid, v_items, v_qty, pr.price_vnd::bigint * v_qty, nullif(left(trim(coalesce(p_note, '')), 200), ''), v_code)
  returning * into o;
  return private.club_order_json(o) || jsonb_build_object('bank', private.club_bank(pr.club_id));
end $$;

create or replace function public.cancel_my_club_order(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  o public.club_orders := (select x from public.club_orders x where x.id = p_order_id for update);
begin
  if o.id is null or o.user_id is distinct from v_uid then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.status <> 'PENDING' then raise exception 'ORDER_LOCKED'; end if;
  update public.club_orders set status = 'CANCELLED', status_note = 'Người đặt huỷ' where id = o.id returning * into o;
  return private.club_order_json(o);
end $$;

-- Ban quản trị: danh sách đơn + tổng hợp size
create or replace function public.club_orders_admin(p_product_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pr public.club_products := (select x from public.club_products x where x.id = p_product_id);
begin
  if pr.id is null or not public.club_is_staff(pr.club_id) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'orders', coalesce((select jsonb_agg(private.club_order_json(o) order by o.created_at desc) from public.club_orders o where o.product_id = pr.id), '[]'::jsonb),
    'sizes', coalesce((select jsonb_agg(jsonb_build_object('size', t.size, 'qty', t.qty, 'paid_qty', t.paid_qty) order by t.size)
                from (select coalesce(i->>'size', '—') as size, sum((i->>'qty')::int) as qty,
                             sum(case when o.status in ('PAID', 'DELIVERED') then (i->>'qty')::int else 0 end) as paid_qty
                        from public.club_orders o cross join jsonb_array_elements(o.items) i
                       where o.product_id = pr.id and o.status <> 'CANCELLED'
                       group by coalesce(i->>'size', '—')) t), '[]'::jsonb),
    'totals', (select jsonb_build_object('orders', count(*) filter (where o.status <> 'CANCELLED'),
                        'paid_vnd', coalesce(sum(o.amount_vnd) filter (where o.status in ('PAID', 'DELIVERED')), 0),
                        'pending_vnd', coalesce(sum(o.amount_vnd) filter (where o.status = 'PENDING'), 0))
                 from public.club_orders o where o.product_id = pr.id));
end $$;

create or replace function public.set_club_order_status(p_order_id uuid, p_status text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  o public.club_orders := (select x from public.club_orders x where x.id = p_order_id for update);
  v_to text := upper(coalesce(p_status, ''));
begin
  if o.id is null or not public.club_is_staff(o.club_id) then raise exception 'FORBIDDEN'; end if;
  if not ((o.status = 'PENDING' and v_to in ('PAID', 'CANCELLED')) or (o.status = 'PAID' and v_to in ('DELIVERED', 'PENDING', 'CANCELLED'))
          or (o.status = 'DELIVERED' and v_to = 'PAID')) then
    raise exception 'INVALID_STATUS';
  end if;
  update public.club_orders set status = v_to, status_note = nullif(left(trim(coalesce(p_note, '')), 200), ''),
    paid_at = case when v_to = 'PAID' then coalesce(paid_at, now()) when v_to = 'PENDING' then null else paid_at end,
    delivered_at = case when v_to = 'DELIVERED' then now() when v_to = 'PAID' then null else delivered_at end
  where id = o.id returning * into o;
  if o.user_id is not null and v_to in ('PAID', 'DELIVERED', 'CANCELLED') then
    perform private.notify(o.user_id, o.club_id, 'CLUB_SHOP',
      case v_to when 'PAID' then 'CLB đã nhận tiền đơn ' || o.code when 'DELIVERED' then 'Đơn ' || o.code || ' đã giao'
                else 'Đơn ' || o.code || ' đã bị huỷ' end,
      coalesce(nullif(trim(coalesce(p_note, '')), ''), (select p.title from public.club_products p where p.id = o.product_id)),
      '/clubs/' || o.club_id || '/shop', v_uid, true);
  end if;
  return private.club_order_json(o);
end $$;

revoke all on function private.club_bank(uuid), private.club_order_json(public.club_orders), private.club_product_sold(uuid) from public, anon, authenticated;
revoke all on function public.club_shop(uuid), public.save_club_product(jsonb), public.place_club_order(uuid, jsonb, text),
  public.cancel_my_club_order(uuid), public.club_orders_admin(uuid), public.set_club_order_status(uuid, text, text) from public, anon;
grant execute on function public.club_shop(uuid), public.save_club_product(jsonb), public.place_club_order(uuid, jsonb, text),
  public.cancel_my_club_order(uuid), public.club_orders_admin(uuid), public.set_club_order_status(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001008000_club_public_page.sql
-- ===================================================================
-- 008000: Trang công khai của CLB Pro — racehub.vn/c/<link-riêng> (học từ Tucana: "nhà" của CLB trên web).
-- Người chưa đăng nhập cũng xem được: tên, logo, màu, giới thiệu, số thành viên, năm thành lập, số buổi chạy nhóm /
-- thử thách đã tổ chức, nút Tham gia. KHÔNG có dữ liệu bài chạy / tên thành viên (quyền riêng tư + điều khoản Strava).
-- Chỉ CLB Pro còn hạn có link riêng (như resolve_club_slug của 002800).
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT. Chạy lại nhiều lần vẫn an toàn.

create or replace function public.club_public_page(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', c.id, 'slug', c.slug, 'name', c.name, 'description', c.description, 'avatar_url', c.avatar_url,
    'accent_color', c.accent_color, 'member_count', c.member_count, 'join_policy', c.join_policy, 'founded_at', c.created_at,
    'events_held', (select count(*) from public.club_events e where e.club_id = c.id and e.starts_at < now()),
    'events_upcoming', (select count(*) from public.club_events e where e.club_id = c.id and e.starts_at >= now()),
    'challenges_held', (select count(*) from public.challenges ch where ch.target_club_id = c.id and ch.status <> 'CANCELLED'))
    from public.clubs c
   where c.slug = lower(trim(coalesce(p_slug, ''))) and c.plan = 'PRO' and (c.pro_until is null or c.pro_until > now())
$$;

revoke all on function public.club_public_page(text) from public;
grant execute on function public.club_public_page(text) to anon, authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001008100_club_pro_wall_exchange.sql
-- ===================================================================
-- 008100: (1) "Tường nhà" CLB Pro — ảnh bìa, khẩu hiệu, chủ đề màu; (2) Thư mời giao lưu offline giữa các CLB.
-- (1) CLB Pro còn hạn: ban quản trị đặt ảnh bìa (vị trí lấy nét dọc 0–100%), khẩu hiệu ≤ 80 ký tự, chủ đề nền. Hết Pro:
--     dữ liệu giữ nguyên nhưng giao diện quay về dạng thường (club_branding trả về active = false).
-- (2) Ban quản trị CLB A gửi thư mời tới CLB B (tiêu đề, giờ, địa điểm, cự ly, pace, số khách tối đa, lời mời). Ban quản trị
--     B nhận thông báo → Nhận lời / Từ chối (kèm lời nhắn). Nhận lời: tự tạo buổi chạy trong LỊCH của CẢ HAI CLB (RSVP, điểm
--     danh QR như buổi chạy thường), đăng bảng tin + báo thành viên hai bên. Huỷ sau khi nhận lời → huỷ cả hai buổi.
--     Chặn spam: mỗi cặp CLB chỉ 1 lời mời đang chờ; mỗi CLB tối đa 5 lời mời đang chờ.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT. Chạy lại nhiều lần vẫn an toàn.

-- ---------------------------------------------------------------------
-- 1. Tường nhà CLB Pro
-- ---------------------------------------------------------------------
alter table public.clubs add column if not exists cover_url text;
alter table public.clubs add column if not exists cover_position integer not null default 50;
alter table public.clubs add column if not exists tagline text;
alter table public.clubs add column if not exists theme text;
alter table public.clubs drop constraint if exists clubs_cover_url_check;
alter table public.clubs add constraint clubs_cover_url_check check (cover_url is null or cover_url ~ '^https://');
alter table public.clubs drop constraint if exists clubs_cover_position_check;
alter table public.clubs add constraint clubs_cover_position_check check (cover_position between 0 and 100);
alter table public.clubs drop constraint if exists clubs_tagline_check;
alter table public.clubs add constraint clubs_tagline_check check (tagline is null or char_length(tagline) <= 80);
alter table public.clubs drop constraint if exists clubs_theme_check;
alter table public.clubs add constraint clubs_theme_check check (theme is null or theme in ('AURORA', 'SUNSET', 'OCEAN', 'FOREST', 'GOLD', 'NIGHT'));
-- Cột mới của clubs mặc định không đọc được (003400) → mở rõ ràng
grant select (cover_url, cover_position, tagline, theme) on public.clubs to anon, authenticated;

create or replace function public.set_club_branding(p_club_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_cover text := nullif(trim(coalesce(p->>'cover_url', '')), '');
  v_tag text := nullif(trim(coalesce(p->>'tagline', '')), '');
  v_theme text := nullif(upper(trim(coalesce(p->>'theme', ''))), '');
begin
  if not public.club_is_staff(p_club_id) then raise exception 'FORBIDDEN'; end if;
  if not private.club_is_pro(p_club_id) and (v_cover is not null or v_tag is not null or v_theme is not null) then raise exception 'PRO_REQUIRED'; end if;
  if v_cover is not null and v_cover !~ '^https://' then raise exception 'INVALID_URL'; end if;
  if v_tag is not null and char_length(v_tag) > 80 then raise exception 'TAGLINE_TOO_LONG'; end if;
  if v_theme is not null and v_theme not in ('AURORA', 'SUNSET', 'OCEAN', 'FOREST', 'GOLD', 'NIGHT') then raise exception 'INVALID_THEME'; end if;
  update public.clubs set cover_url = v_cover, tagline = v_tag, theme = v_theme,
         cover_position = least(greatest(coalesce((p->>'cover_position')::int, 50), 0), 100)
   where id = p_club_id;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'CLUB_BRANDING', p_club_id::text, jsonb_build_object('cover', v_cover is not null, 'tagline', v_tag, 'theme', v_theme));
  return jsonb_build_object('cover_url', v_cover, 'tagline', v_tag, 'theme', v_theme);
end $$;

-- Trang công khai (008000) thêm ảnh bìa / khẩu hiệu / chủ đề
create or replace function public.club_public_page(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', c.id, 'slug', c.slug, 'name', c.name, 'description', c.description, 'avatar_url', c.avatar_url,
    'accent_color', c.accent_color, 'member_count', c.member_count, 'join_policy', c.join_policy, 'founded_at', c.created_at,
    'cover_url', c.cover_url, 'cover_position', c.cover_position, 'tagline', c.tagline, 'theme', c.theme,
    'events_held', (select count(*) from public.club_events e where e.club_id = c.id and e.starts_at < now()),
    'events_upcoming', (select count(*) from public.club_events e where e.club_id = c.id and e.starts_at >= now()),
    'challenges_held', (select count(*) from public.challenges ch where ch.target_club_id = c.id and ch.status <> 'CANCELLED'))
    from public.clubs c
   where c.slug = lower(trim(coalesce(p_slug, ''))) and c.plan = 'PRO' and (c.pro_until is null or c.pro_until > now())
$$;

-- ---------------------------------------------------------------------
-- 2. Thư mời giao lưu giữa các CLB
-- ---------------------------------------------------------------------
alter table public.club_events add column if not exists exchange_id uuid;

create table if not exists public.club_exchange_invites (
  id uuid primary key default gen_random_uuid(),
  from_club uuid not null references public.clubs(id) on delete cascade,
  to_club uuid not null references public.clubs(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  title text not null check (char_length(title) between 3 and 80),
  message text check (message is null or char_length(message) <= 1000),
  starts_at timestamptz not null,
  duration_min integer not null default 90 check (duration_min between 15 and 720),
  location_name text not null check (char_length(location_name) between 2 and 120),
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  distance_km numeric(5, 1) check (distance_km is null or (distance_km > 0 and distance_km <= 200)),
  pace_text text check (pace_text is null or char_length(pace_text) <= 40),
  guest_capacity integer check (guest_capacity is null or guest_capacity between 2 and 1000),
  status text not null default 'PENDING' check (status in ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED')),
  response_note text check (response_note is null or char_length(response_note) <= 300),
  responded_by uuid references public.profiles(id) on delete set null,
  responded_at timestamptz,
  host_event_id uuid references public.club_events(id) on delete set null,
  guest_event_id uuid references public.club_events(id) on delete set null,
  created_at timestamptz not null default now(),
  check (from_club <> to_club),
  check ((lat is null) = (lng is null))
);
create index if not exists club_exchange_from_idx on public.club_exchange_invites (from_club, created_at desc);
create index if not exists club_exchange_to_idx on public.club_exchange_invites (to_club, created_at desc);
alter table public.club_exchange_invites enable row level security;
revoke all on public.club_exchange_invites from anon, authenticated;

create or replace function private.exchange_json(x public.club_exchange_invites) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(x) || jsonb_build_object(
    'from', (select jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url, 'accent_color', c.accent_color,
                                       'member_count', c.member_count) from public.clubs c where c.id = x.from_club),
    'to', (select jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url, 'accent_color', c.accent_color,
                                     'member_count', c.member_count) from public.clubs c where c.id = x.to_club),
    'sender_name', private.display_name(x.created_by), 'responder_name', private.display_name(x.responded_by))
$$;

create or replace function public.send_club_exchange(p_from_club uuid, p_to_club uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_start timestamptz := nullif(p->>'starts_at', '')::timestamptz;
  v_from text := (select c.name from public.clubs c where c.id = p_from_club);
  x public.club_exchange_invites;
begin
  if not public.club_is_staff(p_from_club) then raise exception 'FORBIDDEN'; end if;
  if p_to_club is null or p_to_club = p_from_club or not exists (select 1 from public.clubs c where c.id = p_to_club) then raise exception 'CLUB_NOT_FOUND'; end if;
  if v_start is null or v_start < now() + interval '2 hours' or v_start > now() + interval '180 days' then raise exception 'INVALID_TIME_RANGE'; end if;
  if exists (select 1 from public.club_exchange_invites e where e.from_club = p_from_club and e.to_club = p_to_club and e.status = 'PENDING') then
    raise exception 'EXCHANGE_PENDING';
  end if;
  if (select count(*) from public.club_exchange_invites e where e.from_club = p_from_club and e.status = 'PENDING') >= 5 then
    raise exception 'EXCHANGE_LIMIT';
  end if;
  insert into public.club_exchange_invites (from_club, to_club, created_by, title, message, starts_at, duration_min, location_name,
                                            lat, lng, distance_km, pace_text, guest_capacity)
  values (p_from_club, p_to_club, v_uid, trim(coalesce(p->>'title', '')), nullif(trim(coalesce(p->>'message', '')), ''), v_start,
          coalesce(nullif(p->>'duration_min', '')::int, 90), trim(coalesce(p->>'location_name', '')),
          nullif(p->>'lat', '')::double precision, nullif(p->>'lng', '')::double precision,
          nullif(p->>'distance_km', '')::numeric, nullif(trim(coalesce(p->>'pace_text', '')), ''), nullif(p->>'guest_capacity', '')::int)
  returning * into x;
  perform private.notify_club(p_to_club, true, 'CLUB_EXCHANGE', v_from || ' mời CLB giao lưu: ' || x.title,
    to_char(x.starts_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM') || ' · ' || x.location_name || '. Mở thư mời để nhận lời.',
    '/clubs/' || p_to_club || '/exchange', v_uid);
  return private.exchange_json(x);
end $$;

create or replace function public.respond_club_exchange(p_invite_id uuid, p_accept boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  x public.club_exchange_invites := (select i from public.club_exchange_invites i where i.id = p_invite_id for update);
  v_from text;
  v_to text;
  v_host uuid;
  v_guest uuid;
  v_desc text;
begin
  if x.id is null then raise exception 'EXCHANGE_NOT_FOUND'; end if;
  if not public.club_is_staff(x.to_club) then raise exception 'FORBIDDEN'; end if;
  if x.status <> 'PENDING' then raise exception 'EXCHANGE_CLOSED'; end if;
  if p_accept and x.starts_at <= now() then raise exception 'EXCHANGE_EXPIRED'; end if;
  v_from := (select c.name from public.clubs c where c.id = x.from_club);
  v_to := (select c.name from public.clubs c where c.id = x.to_club);
  if not p_accept then
    update public.club_exchange_invites set status = 'DECLINED', responded_by = v_uid, responded_at = now(),
           response_note = nullif(left(trim(coalesce(p_note, '')), 300), '') where id = x.id returning * into x;
    perform private.notify_club(x.from_club, true, 'CLUB_EXCHANGE', v_to || ' chưa nhận lời giao lưu',
      coalesce(x.response_note, x.title), '/clubs/' || x.from_club || '/exchange', v_uid);
    return private.exchange_json(x);
  end if;

  v_desc := coalesce(x.message || E'\n\n', '') || 'Buổi giao lưu ' || v_from || ' × ' || v_to || '.';
  insert into public.club_events (club_id, created_by, title, description, starts_at, duration_min, location_name, lat, lng,
                                  distance_km, pace_text, capacity, exchange_id)
  values (x.from_club, x.created_by, left('Giao lưu × ' || v_to, 80), left(v_desc, 1000), x.starts_at, x.duration_min, x.location_name,
          x.lat, x.lng, x.distance_km, x.pace_text, null, x.id)
  returning id into v_host;
  insert into public.club_events (club_id, created_by, title, description, starts_at, duration_min, location_name, lat, lng,
                                  distance_km, pace_text, capacity, exchange_id)
  values (x.to_club, v_uid, left('Giao lưu × ' || v_from, 80), left(v_desc, 1000), x.starts_at, x.duration_min, x.location_name,
          x.lat, x.lng, x.distance_km, x.pace_text, x.guest_capacity, x.id)
  returning id into v_guest;
  insert into private.club_event_secrets (event_id, secret) values (v_host, encode(extensions.gen_random_bytes(24), 'hex')), (v_guest, encode(extensions.gen_random_bytes(24), 'hex'))
  on conflict (event_id) do nothing;
  update public.club_exchange_invites set status = 'ACCEPTED', responded_by = v_uid, responded_at = now(),
         response_note = nullif(left(trim(coalesce(p_note, '')), 300), ''), host_event_id = v_host, guest_event_id = v_guest
   where id = x.id returning * into x;

  insert into public.club_posts (club_id, author_id, kind, title, body, is_pinned)
  values (x.from_club, x.created_by, 'ANNOUNCEMENT', 'Giao lưu với ' || v_to || ' — ' || x.title,
          to_char(x.starts_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI "ngày" DD/MM') || ' tại ' || x.location_name || '. Đăng ký ở tab Lịch.', false),
         (x.to_club, v_uid, 'ANNOUNCEMENT', 'Giao lưu với ' || v_from || ' — ' || x.title,
          to_char(x.starts_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI "ngày" DD/MM') || ' tại ' || x.location_name || '. Đăng ký ở tab Lịch.', false);
  perform private.notify_club(x.from_club, false, 'CLUB_EXCHANGE', v_to || ' đã nhận lời giao lưu!', x.title || ' · ' || x.location_name,
    '/clubs/' || x.from_club || '/events/' || v_host, v_uid);
  perform private.notify_club(x.to_club, false, 'CLUB_EXCHANGE', 'Giao lưu với ' || v_from || ': ' || x.title, x.location_name || ' — đăng ký tham gia ở tab Lịch',
    '/clubs/' || x.to_club || '/events/' || v_guest, v_uid);
  return private.exchange_json(x);
end $$;

create or replace function public.cancel_club_exchange(p_invite_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  x public.club_exchange_invites := (select i from public.club_exchange_invites i where i.id = p_invite_id for update);
  v_reason text := trim(coalesce(p_reason, ''));
begin
  if x.id is null then raise exception 'EXCHANGE_NOT_FOUND'; end if;
  if not (public.club_is_staff(x.from_club) or (x.status = 'ACCEPTED' and public.club_is_staff(x.to_club))) then raise exception 'FORBIDDEN'; end if;
  if x.status not in ('PENDING', 'ACCEPTED') then raise exception 'EXCHANGE_CLOSED'; end if;
  if char_length(v_reason) < 3 then raise exception 'REASON_REQUIRED'; end if;
  update public.club_events set status = 'CANCELLED', cancel_reason = left('Huỷ giao lưu: ' || v_reason, 300)
   where id in (x.host_event_id, x.guest_event_id) and status <> 'CANCELLED';
  update public.club_exchange_invites set status = 'CANCELLED', response_note = left(v_reason, 300) where id = x.id returning * into x;
  perform private.notify_club(case when public.club_is_staff(x.from_club) then x.to_club else x.from_club end, true, 'CLUB_EXCHANGE',
    'Đã huỷ giao lưu: ' || x.title, v_reason, '/clubs/' || case when public.club_is_staff(x.from_club) then x.to_club else x.from_club end || '/exchange', v_uid);
  return private.exchange_json(x);
end $$;

-- Thư mời của một CLB: gửi đi + nhận được (ban quản trị); thành viên chỉ thấy các buổi đã nhận lời
create or replace function public.club_exchanges(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_staff boolean := public.club_is_staff(p_club_id);
begin
  if not public.club_is_member(p_club_id) then raise exception 'NOT_A_MEMBER'; end if;
  return jsonb_build_object('is_staff', v_staff,
    'incoming', coalesce((select jsonb_agg(private.exchange_json(x) order by x.created_at desc) from public.club_exchange_invites x
                           where x.to_club = p_club_id and (v_staff or x.status = 'ACCEPTED')), '[]'::jsonb),
    'outgoing', coalesce((select jsonb_agg(private.exchange_json(x) order by x.created_at desc) from public.club_exchange_invites x
                           where x.from_club = p_club_id and (v_staff or x.status = 'ACCEPTED')), '[]'::jsonb));
end $$;

revoke all on function private.exchange_json(public.club_exchange_invites) from public, anon, authenticated;
revoke all on function public.set_club_branding(uuid, jsonb), public.send_club_exchange(uuid, uuid, jsonb), public.respond_club_exchange(uuid, boolean, text),
  public.cancel_club_exchange(uuid, text), public.club_exchanges(uuid) from public, anon;
grant execute on function public.set_club_branding(uuid, jsonb), public.send_club_exchange(uuid, uuid, jsonb), public.respond_club_exchange(uuid, boolean, text),
  public.cancel_club_exchange(uuid, text), public.club_exchanges(uuid) to authenticated;
revoke all on function public.club_public_page(text) from public;
grant execute on function public.club_public_page(text) to anon, authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001008200_club_challenge_quota.sql
-- ===================================================================
-- 008200: Hạn mức thử thách CLB theo gói (tham khảo Tucana: Free 30 thành viên / 2 sự kiện đồng thời → Pro → Enterprise)
-- và chặn "CLB một người" dùng miễn phí.
-- • Thử thách NỘI BỘ CLB (chỉ thành viên tham gia) được tạo MIỄN PHÍ trong hạn mức gói:
--     CLB Free: tối đa 2 thử thách đang diễn ra cùng lúc, mỗi thử thách ≤ 50 người,
--               và CLB phải có ≥ 5 thành viên THẬT (đã duyệt, có bài chạy hợp lệ trong 30 ngày).
--     CLB Pro : tối đa 20 thử thách đang diễn ra cùng lúc, mỗi thử thách ≤ 1.000 người, không cần điều kiện thành viên.
--   Ngoài hạn mức (CLB ít người chạy, quá số thử thách đồng thời, quá quy mô) → tính như cũ: lượt tạo của gói, rồi Xu từ quỹ CLB.
--   Không chặn ai: CLB vẫn tạo được, chỉ là mất phí → đủ động lực nâng Pro mà không làm hỏng việc của CLB.
-- • Thử thách công khai / cá nhân: giữ nguyên biểu phí theo quy mô + lượt VIP (một người lập CLB không lách được phí này,
--   vì thử thách CLB chỉ thành viên CLB mới vào được).
-- • Mọi con số nằm trong cấu hình kinh tế, khoá "clubChallenge" — admin sửa ở Quản trị → Chính sách.
-- • create_challenge_v2 được viết lại (bỏ SELECT INTO / LIMIT để chạy được trong SQL Editor), chỉ thêm phần hạn mức CLB.
-- Cần 0700, 2800, 3700, 3800, 7500. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT. Chạy lại an toàn.

create or replace function private.club_challenge_policy() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('freeMinActiveMembers', 5, 'activeWindowDays', 30, 'freeMaxSlots', 50, 'freeMaxOpen', 2,
                            'proMaxSlots', 1000, 'proMaxOpen', 20)
         || coalesce(case when jsonb_typeof(private.economy_config()->'clubChallenge') = 'object'
                          then private.economy_config()->'clubChallenge' end, '{}'::jsonb)
$$;

-- Admin chỉnh hạn mức ở Quản trị → Chính sách: kiểm tra giá trị như 003700 + khoá clubChallenge
create or replace function private.valid_economy_v2(c jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(c) = 'object'
     and coalesce((c->>'xuVnd')::numeric, 100) between 1 and 1000000
     and coalesce((c->>'xpPerKm')::numeric, 10) between 0 and 1000
     and coalesce((c->'run'->>'freeKm')::numeric, 2) between 0 and 100
     and coalesce((c->'run'->>'dailyCap')::numeric, 20) between 0 and 100000
     and not exists (select 1 from jsonb_array_elements(coalesce(c->'run'->'tiers', '[]'::jsonb)) e
                      where (e->>'upToKm')::numeric not between 0 and 1000 or (e->>'rate')::numeric not between 0 and 1000)
     and coalesce((c->>'checkinXu')::numeric, 1) between 0 and 10000
     and coalesce((c->>'giftDailyCapXu')::numeric, 20000) between 0 and 100000000
     and not exists (select 1 from jsonb_array_elements(coalesce(c->'capacityTiers', '[]'::jsonb)) e
                      where (e->>'max')::int not between 1 and 1000000 or (e->>'xu')::numeric not between 0 and 10000000)
     and not exists (select 1 from jsonb_array_elements(coalesce(c->'streakRewards', '[]'::jsonb)) e
                      where (e->>'weeks')::int not between 1 and 520 or (e->>'xu')::numeric not between 0 and 100000)
     and coalesce((c->'referral'->>'inviterXu')::numeric, 0) between 0 and 100000
     and coalesce((c->'referral'->>'refereeXu')::numeric, 0) between 0 and 100000
     and coalesce((c->'referral'->>'monthlyCap')::numeric, 10) between 0 and 1000
     and coalesce((c->'comeback'->>'xu')::numeric, 10) between 0 and 10000
     and coalesce((c->'comeback'->>'minRestDays')::numeric, 28) between 7 and 365
     and coalesce((c->'comeback'->>'cooldownDays')::numeric, 90) between 0 and 3650
     and coalesce((c->'game'->>'shieldPrice')::numeric, 200) between 0 and 100000
     and coalesce((c->'clubChallenge'->>'freeMinActiveMembers')::numeric, 5) between 0 and 10000
     and coalesce((c->'clubChallenge'->>'activeWindowDays')::numeric, 30) between 1 and 365
     and coalesce((c->'clubChallenge'->>'freeMaxSlots')::numeric, 50) between 0 and 10000
     and coalesce((c->'clubChallenge'->>'freeMaxOpen')::numeric, 2) between 0 and 10000
     and coalesce((c->'clubChallenge'->>'proMaxSlots')::numeric, 1000) between 0 and 10000
     and coalesce((c->'clubChallenge'->>'proMaxOpen')::numeric, 20) between 0 and 10000
$$;

-- Thành viên "thật": đã duyệt và có ít nhất một bài chạy hợp lệ trong N ngày gần nhất
create or replace function private.club_active_members(p_club uuid, p_days integer) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.club_members m
   where m.club_id = p_club and m.status = 'APPROVED'
     and exists (select 1 from public.activities x
                  where x.user_id = m.user_id and x.validation_status = 'APPROVED'
                    and public.activity_is_countable(x.status, x.validation_status)
                    and x.started_at >= now() - make_interval(days => greatest(p_days, 1)))
$$;

-- Thử thách nội bộ đang diễn ra (chưa kết thúc, chưa huỷ)
create or replace function private.club_open_challenges(p_club uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.challenges c
   where c.target_club_id = p_club and c.target_audience = 'CLUB_ONLY' and c.status = 'ACTIVE' and c.end_date > now()
$$;

create or replace function private.club_challenge_quota_json(p_club uuid, p_slots integer) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  pol jsonb := private.club_challenge_policy();
  v_pro boolean := private.club_is_pro(p_club);
  v_active integer := private.club_active_members(p_club, (pol->>'activeWindowDays')::int);
  v_open integer := private.club_open_challenges(p_club);
  v_min integer := case when v_pro then 0 else (pol->>'freeMinActiveMembers')::int end;
  v_max_open integer := (pol->>case when v_pro then 'proMaxOpen' else 'freeMaxOpen' end)::int;
  v_max_slots integer := (pol->>case when v_pro then 'proMaxSlots' else 'freeMaxSlots' end)::int;
  v_reason text := null;
begin
  if v_active < v_min then v_reason := 'NEED_ACTIVE_MEMBERS';
  elsif v_open >= v_max_open then v_reason := 'OPEN_LIMIT';
  elsif coalesce(p_slots, 1) > v_max_slots then v_reason := 'SLOTS_LIMIT';
  end if;
  return jsonb_build_object('plan', case when v_pro then 'PRO' else 'FREE' end, 'eligible', v_reason is null, 'reason', v_reason,
    'active_members', v_active, 'min_active_members', v_min, 'active_window_days', (pol->>'activeWindowDays')::int,
    'open', v_open, 'max_open', v_max_open, 'max_slots', v_max_slots,
    'free', jsonb_build_object('min_active_members', (pol->>'freeMinActiveMembers')::int, 'max_open', (pol->>'freeMaxOpen')::int,
                               'max_slots', (pol->>'freeMaxSlots')::int),
    'pro', jsonb_build_object('max_open', (pol->>'proMaxOpen')::int, 'max_slots', (pol->>'proMaxSlots')::int));
end $$;

-- Hạn mức thử thách của CLB (thành viên xem được — hiện ở Cài đặt CLB và trình tạo thử thách)
create or replace function public.club_challenge_quota(p_club_id uuid, p_slots integer default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_uid();
  if not public.club_is_member(p_club_id) then raise exception 'NOT_A_MEMBER'; end if;
  return private.club_challenge_quota_json(p_club_id, p_slots);
end $$;

-- Báo giá: thử thách nội bộ trong hạn mức → phí 0, kèm hạn mức để giao diện giải thích
create or replace function public.quote_challenge(p_max_slots integer, p_format text default 'RANKED', p_club_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_slots integer := case when p_format = 'DUEL' then 2 when p_format = 'SOLO_GOAL' then 1 else greatest(coalesce(p_max_slots, 1), 1) end;
  v_fee integer := private.challenge_creation_fee(p_format = 'TEAM', v_slots, now(), now() + interval '1 day');
  v_payer uuid := case when p_club_id is not null and public.club_is_staff(p_club_id) then p_club_id else v_uid end;
  v_quota jsonb := case when v_payer <> v_uid then private.club_challenge_quota_json(v_payer, v_slots) end;
  v_list_fee integer := v_fee;
  v_pass public.challenge_passes;
begin
  if v_fee > 0 and coalesce((v_quota->>'eligible')::boolean, false) then v_fee := 0; end if;
  perform private.issue_credits(case when v_payer = v_uid then 'USER' else 'CLUB' end, v_payer);
  v_pass := (select t.x from (select x, row_number() over (order by x.expires_at nulls last, x.max_slots, x.created_at) as rn
                                from public.challenge_passes x
                               where x.owner_id = v_payer and x.remaining > 0 and x.max_slots >= v_slots
                                 and (x.expires_at is null or x.expires_at > now())) t where t.rn = 1);
  return jsonb_build_object(
    'fee', v_fee, 'list_fee', v_list_fee, 'tier', private.capacity_tier(v_slots), 'custom', private.capacity_tier(v_slots)->>'xu' is null,
    'payer', case when v_payer = v_uid then 'USER' else 'CLUB' end,
    'payer_balance', private.balance(v_payer), 'wallet_balance', private.balance(v_uid),
    'pass', case when v_pass.id is null or v_fee = 0 then null
                 else jsonb_build_object('id', v_pass.id, 'remaining', v_pass.remaining, 'max_slots', v_pass.max_slots,
                                         'expires_at', v_pass.expires_at, 'note', v_pass.note) end,
    'plan', private.plan_badge(v_payer, v_payer <> v_uid),
    'club_quota', v_quota,
    'best_pass_slots', coalesce((select max(x.max_slots) from public.challenge_passes x
                                  where x.owner_id = v_payer and x.remaining > 0 and (x.expires_at is null or x.expires_at > now())), 0),
    'xu_vnd', (private.economy_config()->>'xuVnd')::numeric,
    'policy', private.economy_config());
end $$;

-- Tạo thử thách: như 000700, thêm hạn mức thử thách nội bộ CLB (008200)
create or replace function public.create_challenge_v2(p jsonb, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := private.require_uid();
  v_key text := 'challenge_create:' || v_uid || ':' || coalesce(p_idempotency_key, '');
  v_existing uuid;
  v_title text := trim(coalesce(p->>'title', ''));
  v_desc text := nullif(trim(coalesce(p->>'description', '')), '');
  v_format text := coalesce(p->>'format', 'RANKED');
  v_objective text := coalesce(p->>'objective', 'DISTANCE');
  v_mode text := p->>'game_mode';
  v_target numeric := coalesce((p->>'target_value')::numeric, 0);
  v_min_km numeric := coalesce((p->>'min_km')::numeric, 0);
  v_min_pace numeric := coalesce((p->>'min_pace')::numeric, 3);
  v_max_pace numeric := coalesce((p->>'max_pace')::numeric, 15);
  v_cap numeric := nullif((p->>'daily_cap_km')::numeric, 0);
  v_start timestamptz := (p->>'start_date')::timestamptz;
  v_end timestamptz := (p->>'end_date')::timestamptz;
  v_slots integer := coalesce((p->>'max_slots')::int, 100);
  v_audience text := coalesce(p->>'audience', 'PUBLIC');
  v_club uuid := (p->>'club_id')::uuid;
  v_team_size integer := greatest(coalesce((p->>'team_size')::int, 0), 0);
  v_reward numeric := round(coalesce((p->>'reward_xu')::numeric, 0), 1);
  v_source text := coalesce(p->>'reward_source', 'NONE');
  v_split text := coalesce(p->>'reward_split', 'WINNER');
  v_teams text[];
  v_fee integer := 0;
  v_id uuid;
  v_code text;
  v_club_name text;
  i integer;
  m record;
  v_colors text[] := array['#b6ff3b', '#38bdf8', '#f472b6', '#fb923c', '#a78bfa', '#facc15', '#34d399', '#f87171'];
  v_payer uuid;
  v_pass uuid;
  v_fee_waived integer := 0;
  v_need_user numeric;
  v_need_club numeric;
  v_quota jsonb;
  v_free_reason text;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if exists (select 1 from public.ledger_transactions lt where lt.idempotency_key = v_key) then
    v_existing := (select lt.campaign_id from public.ledger_transactions lt where lt.idempotency_key = v_key);
    return jsonb_build_object('challenge_id', v_existing, 'duplicate', true,
                              'invite_code', (select code from public.challenge_invites where challenge_id = v_existing));
  end if;

  -- Kiểm tra dữ liệu (không tin client)
  if char_length(v_title) not between 3 and 120 then raise exception 'INVALID_TITLE'; end if;
  if v_desc is not null and char_length(v_desc) > 2000 then raise exception 'DESC_TOO_LONG'; end if;
  if v_format not in ('SOLO_GOAL', 'RANKED', 'DUEL', 'TEAM', 'COLLECTIVE') then raise exception 'INVALID_FORMAT'; end if;
  if v_objective not in ('DISTANCE', 'RUNS', 'DURATION', 'STREAK_DAYS') then raise exception 'INVALID_OBJECTIVE'; end if;
  if v_start is null or v_end is null or v_end <= v_start then raise exception 'INVALID_TIME_RANGE'; end if;
  if v_end - v_start > interval '366 days' or v_end - v_start < interval '1 hour' then raise exception 'INVALID_TIME_RANGE'; end if;
  if v_end <= now() then raise exception 'INVALID_TIME_RANGE'; end if;
  if v_target < 0 or v_min_km < 0 or v_min_km > 100 or coalesce(v_cap, 0) < 0 then raise exception 'INVALID_DISTANCE'; end if;
  if v_min_pace <= 0 or v_max_pace < v_min_pace or v_max_pace > 30 then raise exception 'INVALID_PACE'; end if;
  if v_format in ('SOLO_GOAL', 'COLLECTIVE') and v_target <= 0 then raise exception 'TARGET_REQUIRED'; end if;
  if v_objective = 'STREAK_DAYS' and (v_min_km <= 0 or v_target > ceil(extract(epoch from v_end - v_start) / 86400)) then
    raise exception 'INVALID_STREAK';
  end if;
  if v_format = 'DUEL' then v_slots := 2; end if;
  if v_slots not between 1 and 10000 then raise exception 'INVALID_MAX_SLOTS'; end if;

  if v_format = 'TEAM' then
    if v_mode not in ('TEAM_SUM', 'TEAM_AVG', 'TEAM_GAP', 'LAST_MEMBER') then raise exception 'INVALID_GAME_MODE'; end if;
    v_teams := (select array_agg(trim(t.v)) from jsonb_array_elements_text(coalesce(p->'team_names', '[]'::jsonb)) as t(v)
                 where trim(t.v) <> '');
    if coalesce(array_length(v_teams, 1), 0) not between 2 and 8 then raise exception 'INVALID_TEAMS'; end if;
    if exists (select 1 from unnest(v_teams) as t(v) where char_length(v) > 40) then raise exception 'INVALID_TEAMS'; end if;
    if v_start < now() + interval '10 minutes' then raise exception 'TEAM_START_TOO_SOON'; end if;
    if v_team_size > 0 then v_slots := least(v_slots, v_team_size * array_length(v_teams, 1)); end if;
  else
    v_mode := case v_objective when 'STREAK_DAYS' then 'STREAK' else 'ACCUMULATE' end;
  end if;

  if v_audience not in ('PUBLIC', 'CLUB_ONLY', 'INVITE_ONLY') then raise exception 'INVALID_AUDIENCE'; end if;
  if v_audience = 'CLUB_ONLY' then
    if v_club is null or not public.club_is_staff(v_club) then raise exception 'FORBIDDEN'; end if;
    v_club_name := (select cl.name from public.clubs cl where cl.id = v_club);
  else
    v_club := null;
  end if;

  if v_reward < 0 or v_reward > 100000 then raise exception 'INVALID_AMOUNT'; end if;
  if v_reward = 0 then v_source := 'NONE'; end if;
  if v_source not in ('NONE', 'CREATOR', 'CLUB') then raise exception 'INVALID_REWARD'; end if;
  if v_source = 'CLUB' and v_club is null then raise exception 'FORBIDDEN'; end if;
  if v_split not in ('WINNER', 'TOP3', 'FINISHERS', 'TEAM') then raise exception 'INVALID_REWARD'; end if;
  v_split := case when v_format = 'TEAM' then 'TEAM'
                  when v_format in ('SOLO_GOAL', 'COLLECTIVE') then 'FINISHERS'
                  when v_format = 'DUEL' then 'WINNER'
                  when v_split in ('WINNER', 'TOP3') then v_split else 'WINNER' end;

  -- Phí khởi tạo theo số người tối đa (Admin → Chính sách). Thử thách CLB trả bằng quỹ CLB.
  v_fee := private.challenge_creation_fee(v_format = 'TEAM', v_slots, v_start, v_end);
  v_payer := coalesce(v_club, v_uid);
  -- 008200: thử thách nội bộ CLB miễn phí trong hạn mức gói (Free / Pro) — khoá theo CLB để hai người tạo cùng lúc không vượt hạn mức
  if v_club is not null and v_fee > 0 then
    perform pg_advisory_xact_lock(hashtext('club_challenge:' || v_club));
    v_quota := private.club_challenge_quota_json(v_club, v_slots);
    if (v_quota->>'eligible')::boolean then v_fee_waived := v_fee; v_fee := 0; v_free_reason := v_quota->>'plan'; end if;
  end if;
  -- Vé tạo miễn phí (gói VIP / Pro, admin tặng): dùng vé sắp hết hạn trước, vé nhỏ nhất đủ số người
  if v_fee > 0 then
    v_pass := (select t.id from (select x.id, row_number() over (order by x.expires_at nulls last, x.max_slots, x.created_at) as rn
                                   from public.challenge_passes x
                                  where x.owner_id = v_payer and x.remaining > 0 and x.max_slots >= v_slots
                                    and (x.expires_at is null or x.expires_at > now())) t where t.rn = 1);
    if v_pass is not null then
      perform 1 from public.challenge_passes x where x.id = v_pass for update;
      v_fee_waived := v_fee; v_fee := 0;
    end if;
  end if;
  v_need_user := case when v_club is null then v_fee else 0 end + case when v_source = 'CREATOR' then v_reward else 0 end;
  v_need_club := case when v_club is not null then v_fee else 0 end + case when v_source = 'CLUB' then v_reward else 0 end;
  if v_need_user > private.balance(v_uid) then raise exception 'INSUFFICIENT_BALANCE'; end if;
  if v_club is not null and v_need_club > private.balance(v_club) then raise exception 'INSUFFICIENT_TREASURY'; end if;

  insert into public.challenges (
    title, description, format, objective, challenge_type, game_mode, target_type, target_value, target_km,
    min_km, min_pace, max_pace, daily_cap_km, fixed_team_size, min_members, target_audience, target_club_id,
    creator_role, start_date, end_date, reg_deadline, max_slots, calculated_fee, fee_charged,
    reward_xu, reward_source, reward_split, status, created_by)
  values (
    v_title, v_desc, v_format, v_objective, case when v_format = 'TEAM' then 'TEAM' else 'INDIVIDUAL' end, v_mode,
    v_objective, v_target, case when v_objective = 'DISTANCE' then v_target else 0 end,
    v_min_km, v_min_pace, v_max_pace, v_cap, v_team_size, 1, v_audience, v_club,
    case when v_club is not null then 'CLUB' else 'MEMBER' end, v_start, v_end,
    case when v_format in ('TEAM') then v_start else v_end end, v_slots, v_fee, v_fee,
    v_reward, v_source, v_split, 'ACTIVE', v_uid)
  returning id into v_id;

  -- Phí + dấu idempotency (cùng khóa → trả lại thử thách này)
  if v_fee > 0 then
    perform private.ledger_post('CHALLENGE_CREATION_FEE', v_key,
      case when v_club is not null then 'Phí tạo thử thách (quỹ CLB)' else 'Phí khởi tạo thử thách' end, v_uid,
      private.debit_entries(v_payer, v_fee, private.system_account()), v_id);
    if v_club is not null then
      insert into public.club_treasury_log (club_id, user_id, amount, kind, note)
      values (v_club, v_uid, -v_fee, 'SPEND', left('Phí tạo thử thách: ' || v_title, 200));
    end if;
  else
    insert into public.ledger_transactions (type, idempotency_key, reason, created_by, campaign_id)
    values ('CHALLENGE_CREATION_FEE', v_key,
            case v_free_reason when 'PRO' then 'Miễn phí (hạn mức CLB Pro)' when 'FREE' then 'Miễn phí (hạn mức CLB)' else 'Miễn phí' end, v_uid, v_id);
  end if;

  -- Ký quỹ giải thưởng (giữ ở tài khoản hệ thống tới khi tất toán)
  if v_source = 'CREATOR' then
    perform private.ledger_post('CHALLENGE_ESCROW', 'challenge_escrow:' || v_id, 'Treo thưởng thử thách', v_uid,
      private.debit_entries(v_uid, v_reward, private.system_account()), v_id);
  elsif v_source = 'CLUB' then
    perform private.ledger_post('CHALLENGE_ESCROW', 'challenge_escrow:' || v_id, 'Treo thưởng thử thách (quỹ CLB)', v_uid,
      private.debit_entries(v_club, v_reward, private.system_account()), v_id);
    insert into public.club_treasury_log (club_id, user_id, amount, kind, note)
    values (v_club, v_uid, -v_reward, 'REWARD', left('Treo thưởng: ' || v_title, 200));
  end if;

  if v_format = 'TEAM' then
    for i in 1 .. array_length(v_teams, 1) loop
      insert into public.challenge_teams (challenge_id, name, color, position)
      values (v_id, v_teams[i], v_colors[1 + (i - 1) % array_length(v_colors, 1)], i);
    end loop;
  end if;

  if v_audience <> 'PUBLIC' or v_format = 'DUEL' then
    loop
      v_code := substr(md5(gen_random_uuid()::text), 1, 8);
      exit when not exists (select 1 from public.challenge_invites where code = v_code);
    end loop;
    insert into public.challenge_invites (challenge_id, code) values (v_id, v_code);
  end if;

  -- Người tạo tự vào (trừ thử thách đội — người tạo chọn đội sau — và thử thách CLB do ban quản trị tổ chức)
  if v_format <> 'TEAM' and v_club is null then
    insert into public.challenge_participants (challenge_id, profile_id, status) values (v_id, v_uid, 'JOINED');
  end if;

  -- Thử thách nội bộ CLB: đăng lên bảng tin + báo cả CLB
  if v_club is not null then
    insert into public.club_posts (club_id, author_id, kind, title, body, meta, is_pinned)
    values (v_club, v_uid, 'CHALLENGE', v_title, coalesce(v_desc, ''),
            jsonb_build_object('challenge_id', v_id, 'format', v_format, 'objective', v_objective,
                               'target_value', v_target, 'start_date', v_start, 'end_date', v_end,
                               'reward_xu', v_reward), false);
    for m in select user_id from public.club_members where club_id = v_club and status = 'APPROVED' loop
      perform private.notify(m.user_id, v_club, 'CHALLENGE_NEW',
        'Thử thách mới trong ' || coalesce(v_club_name, 'CLB') || ': ' || v_title,
        case when v_reward > 0 then 'Giải thưởng ' || v_reward || ' Xu. Vào tham gia ngay!' else 'Vào tham gia ngay!' end,
        '/challenges/' || v_id, v_uid, true);
    end loop;
  end if;

  if v_pass is not null then
    update public.challenge_passes set remaining = remaining - 1, updated_at = now() where id = v_pass and remaining > 0;
    update public.challenges set pass_id = v_pass where id = v_id;
  end if;

  return jsonb_build_object('challenge_id', v_id, 'fee', v_fee, 'fee_waived', v_fee_waived, 'pass_used', v_pass is not null, 'club_free', v_free_reason,
                            'invite_code', v_code, 'remaining_balance', private.balance(v_uid));
end $$;
-- Quyền lợi CLB Pro hiển thị (chỉ sửa khi admin chưa đổi câu chữ gốc)
update public.plans set perks = '["Thử thách nội bộ miễn phí: tới 20 thử thách cùng lúc, mỗi thử thách tới 1.000 người", "Không giới hạn quản trị viên", "Tường nhà CLB: ảnh bìa, khẩu hiệu, chủ đề màu", "Link mời riêng + trang công khai /c/tên-clb", "Báo cáo chuyên cần xuất Excel", "Cửa hàng CLB, giao lưu CLB"]'::jsonb
 where code = 'CLUB_PRO'
   and perks = '["2 lượt tạo thử thách ≤100 người / tháng", "Không giới hạn quản trị viên", "Link mời riêng /c/tên-clb", "Báo cáo chuyên cần xuất Excel", "Ví CLB, thương hiệu CLB"]'::jsonb;

revoke all on function private.club_challenge_policy(), private.club_active_members(uuid, integer), private.club_open_challenges(uuid),
  private.club_challenge_quota_json(uuid, integer) from public, anon, authenticated;
revoke all on function public.club_challenge_quota(uuid, integer), public.quote_challenge(integer, text, uuid),
  public.create_challenge_v2(jsonb, text) from public, anon;
grant execute on function public.club_challenge_quota(uuid, integer), public.quote_challenge(integer, text, uuid),
  public.create_challenge_v2(jsonb, text) to authenticated;

notify pgrst, 'reload schema';

commit;
