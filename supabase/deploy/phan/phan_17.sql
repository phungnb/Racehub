-- RaceHub — PHẦN 17/18 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 010700, 010800, 010900
-- Supabase → SQL Editor → New query → dán TOÀN BỘ phần này → Run. Lỗi thì không có gì thay đổi; chạy lại vẫn an toàn.
-- Xong thì chạy phần tiếp theo.
begin;
-- ===================================================================
-- 20261001010700_challenge_conquest.sql
-- ===================================================================
-- 010700: THỬ THÁCH — CHINH PHỤC THỜI GIAN / PACE NHIỀU HẠNG MỤC, HẠN ĐĂNG KÝ, BXH CHI TIẾT THEO NGÀY, NGÀY VÀNG RIÊNG
--   • Chinh phục thời gian (BEST_TIME) / Chinh phục pace (BEST_PACE): một thử thách có nhiều hạng mục (5K, 10K, Half, Full, tự đặt).
--       - FIXED: người tạo đặt mục tiêu cho từng hạng mục (VD 10K dưới 55 phút), người chơi chọn hạng mục để đăng ký.
--       - SELF : người chơi tự đăng ký mục tiêu của mình cho từng hạng mục.
--     Kết quả = bài chạy tốt nhất có cự ly ≥ hạng mục (thời gian quy đổi theo pace trung bình — cách tính như Giải chạy).
--     Hoàn thành khi đạt mọi hạng mục đã đăng ký. BXH lọc theo từng hạng mục.
--   • Hạn đăng ký: người tạo sửa được; tham gia trễ vẫn được tính mọi bài chạy từ ngày bắt đầu.
--   • BXH chi tiết: bấm một người → km từng ngày, từng bài (bài chỉ hiện nếu người đó để công khai hoạt động).
--   • Ngày vàng riêng cho từng thử thách (×1,5 / ×2 / ×3 km trong ngày), cộng dồn với ngày vàng CLB theo mức cao hơn.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

-- ---------------------------------------------------------------------
-- 1. Bảng
-- ---------------------------------------------------------------------
alter table public.challenges drop constraint if exists challenges_objective_chk;
alter table public.challenges add constraint challenges_objective_chk
  check (objective in ('DISTANCE', 'RUNS', 'DURATION', 'STREAK_DAYS', 'BEST_TIME', 'BEST_PACE'));
alter table public.challenges add column if not exists conquest_mode text;
alter table public.challenges drop constraint if exists challenges_conquest_mode_chk;
alter table public.challenges add constraint challenges_conquest_mode_chk check (conquest_mode is null or conquest_mode in ('FIXED', 'SELF'));

create table if not exists public.challenge_categories (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  position integer not null default 0,
  label text not null check (char_length(label) between 1 and 40),
  distance_m numeric not null check (distance_m between 400 and 250000),
  -- BEST_TIME: số giây cho cả cự ly; BEST_PACE: số giây mỗi km. null = người chơi tự đặt (SELF)
  target_s integer check (target_s is null or target_s > 0),
  created_at timestamptz not null default now()
);
create index if not exists challenge_categories_challenge_idx on public.challenge_categories (challenge_id, position);

create table if not exists public.challenge_category_entries (
  participant_id uuid not null references public.challenge_participants(id) on delete cascade,
  category_id uuid not null references public.challenge_categories(id) on delete cascade,
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_s integer check (target_s is null or target_s > 0),
  best_time_s integer,
  best_pace_s integer,
  best_activity_id uuid references public.activities(id) on delete set null,
  best_at timestamptz,
  achieved_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (participant_id, category_id)
);
create index if not exists challenge_category_entries_cat_idx on public.challenge_category_entries (category_id);

create table if not exists public.challenge_boost_days (
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  day date not null,
  multiplier numeric not null check (multiplier in (1.5, 2, 3)),
  title text not null check (char_length(title) between 2 and 80),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (challenge_id, day)
);

alter table public.challenge_categories enable row level security;
alter table public.challenge_category_entries enable row level security;
alter table public.challenge_boost_days enable row level security;
revoke all on public.challenge_categories, public.challenge_category_entries, public.challenge_boost_days from anon, authenticated;
grant select on public.challenge_categories, public.challenge_category_entries, public.challenge_boost_days to authenticated;
drop policy if exists challenge_categories_select on public.challenge_categories;
create policy challenge_categories_select on public.challenge_categories for select to authenticated using (public.challenge_visible(challenge_id));
drop policy if exists challenge_category_entries_select on public.challenge_category_entries;
create policy challenge_category_entries_select on public.challenge_category_entries for select to authenticated using (public.challenge_visible(challenge_id));
drop policy if exists challenge_boost_days_select on public.challenge_boost_days;
create policy challenge_boost_days_select on public.challenge_boost_days for select to authenticated using (public.challenge_visible(challenge_id));

-- ---------------------------------------------------------------------
-- 2. Tính điểm: bản 002000 + nhánh chinh phục thời gian / pace
-- ---------------------------------------------------------------------
create or replace function private.challenge_recompute_participant(p_participant_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  p public.challenge_participants := (select x from public.challenge_participants x where x.id = p_participant_id);
  c public.challenges;
  v_dist numeric; v_moving bigint; v_runs integer; v_days integer; v_score numeric; v_target numeric;
begin
  if p.id is null then return; end if;
  perform 1 from public.challenge_participants where id = p.id for update;
  c := (select x from public.challenges x where x.id = p.challenge_id);

  v_dist := (select coalesce(sum(e.counted_m), 0) from public.challenge_progress_events e where e.participant_id = p.id);
  v_moving := (select coalesce(sum(e.moving_s), 0) from public.challenge_progress_events e where e.participant_id = p.id);
  v_runs := (select count(*) from public.challenge_progress_events e where e.participant_id = p.id and e.counted_m > 0);
  v_days := (select count(*) from (
               select e.day from public.challenge_progress_events e where e.participant_id = p.id
                group by e.day having sum(e.distance_m) >= greatest(coalesce(c.min_km, 0), 0.2) * 1000) d);

  if c.objective in ('BEST_TIME', 'BEST_PACE') then
    -- Kết quả tốt nhất cho từng hạng mục: bài có cự ly ≥ hạng mục, quy đổi theo pace trung bình
    update public.challenge_category_entries
       set best_time_s = null, best_pace_s = null, best_activity_id = null, best_at = null, achieved_at = null
     where participant_id = p.id;
    update public.challenge_category_entries ce
       set best_time_s = b.t, best_pace_s = b.pace, best_activity_id = b.aid, best_at = b.at,
           achieved_at = case when coalesce(ce.target_s, b.cat_target) is not null
                                   and (case when c.objective = 'BEST_PACE' then b.pace else b.t end) <= coalesce(ce.target_s, b.cat_target)
                              then b.at end
      from (select distinct on (cat.id) cat.id as cat_id, cat.target_s as cat_target,
                   round(e.moving_s * cat.distance_m / e.distance_m)::int as t,
                   round(e.moving_s * 1000.0 / e.distance_m)::int as pace,
                   e.activity_id as aid, a.started_at as at
              from public.challenge_categories cat
              join public.challenge_progress_events e on e.participant_id = p.id
                                                       and e.distance_m >= cat.distance_m * 0.99 and e.moving_s > 0
              join public.activities a on a.id = e.activity_id
             where cat.challenge_id = c.id
             order by cat.id, e.moving_s / e.distance_m, a.started_at) b
     where ce.participant_id = p.id and ce.category_id = b.cat_id;
    v_score := (select count(*) from public.challenge_category_entries ce where ce.participant_id = p.id and ce.achieved_at is not null);
    v_target := (select count(*) from public.challenge_category_entries ce where ce.participant_id = p.id);
  else
    v_score := case c.objective
      when 'RUNS' then v_runs
      when 'DURATION' then round(v_moving / 60.0, 1)
      when 'STREAK_DAYS' then v_days
      else round(v_dist / 1000.0, 2) end;

    v_target := coalesce(c.target_value, 0);
    if c.pledge_enabled then
      v_target := coalesce(p.pledge_km, 0);           -- chưa đăng ký mục tiêu → chưa thể hoàn thành
      if v_target > 0 and c.pledge_cap_pct is not null then
        v_score := least(v_score, round(v_target * (1 + c.pledge_cap_pct / 100.0), 2));
      end if;
    end if;
  end if;

  update public.challenge_participants
     set distance_m = v_dist, moving_s = v_moving, run_count = v_runs, streak_days = v_days,
         current_progress = v_score,
         completed_at = case when v_target > 0 and v_score >= v_target then coalesce(completed_at, now()) end,
         status = case when status = 'LEFT' then 'LEFT'
                       when v_target > 0 and v_score >= v_target then 'COMPLETED'
                       else 'JOINED' end,
         updated_at = now()
   where id = p.id;
end $$;

-- ---------------------------------------------------------------------
-- 3. Ngày vàng riêng của thử thách (bản 008500 + nhân theo ngày vàng thử thách)
-- ---------------------------------------------------------------------
create or replace function private.challenge_boost(p_challenge uuid, p_day date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select b.multiplier from public.challenge_boost_days b where b.challenge_id = p_challenge and b.day = p_day), 1)
$$;

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
     or not public.activity_is_countable(a.status, a.validation_status) or not a.shared or a.review_skipped then
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
    -- Ngày vàng: của riêng thử thách hoặc của CLB tổ chức — lấy mức cao hơn; chỉ nhân với thử thách tính theo km
    v_boost := case when r.objective = 'DISTANCE'
                    then greatest(private.challenge_boost(r.id, v_day),
                                  case when r.target_club_id is not null then private.club_boost(r.target_club_id, v_day) else 1 end)
                    else 1 end;

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

-- Quản lý ngày vàng của thử thách: chỉ ngày tương lai trong thời gian thử thách, tối đa 10 ngày
create or replace function public.challenge_boost_days(p_challenge_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.challenge_visible(p_challenge_id) then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('day', b.day, 'multiplier', b.multiplier, 'title', b.title) order by b.day), '[]'::jsonb)
            from public.challenge_boost_days b where b.challenge_id = p_challenge_id);
end $$;

create or replace function public.set_challenge_boost_day(p_challenge_id uuid, p_day date, p_multiplier numeric, p_title text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
  v_title text := trim(coalesce(p_title, ''));
  v_new boolean;
  m record;
begin
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if not private.challenge_is_manager(c) then raise exception 'FORBIDDEN'; end if;
  if c.status <> 'ACTIVE' then raise exception 'CHALLENGE_CLOSED'; end if;
  if c.objective <> 'DISTANCE' then raise exception 'BOOST_NOT_SUPPORTED'; end if;
  if p_day is null or p_day <= private.vn_today()
     or p_day < (c.start_date at time zone 'Asia/Ho_Chi_Minh')::date or p_day > (c.end_date at time zone 'Asia/Ho_Chi_Minh')::date then
    raise exception 'BOOST_DAY_TOO_LATE';
  end if;
  if p_multiplier is null then
    delete from public.challenge_boost_days where challenge_id = c.id and day = p_day;
    return public.challenge_boost_days(c.id);
  end if;
  if p_multiplier not in (1.5, 2, 3) then raise exception 'INVALID_MULTIPLIER'; end if;
  if char_length(v_title) not between 2 and 80 then raise exception 'INVALID_TITLE'; end if;
  v_new := not exists (select 1 from public.challenge_boost_days b where b.challenge_id = c.id and b.day = p_day);
  if v_new and (select count(*) from public.challenge_boost_days b where b.challenge_id = c.id) >= 10 then raise exception 'BOOST_DAYS_LIMIT'; end if;
  insert into public.challenge_boost_days (challenge_id, day, multiplier, title, created_by) values (c.id, p_day, p_multiplier, v_title, v_uid)
  on conflict (challenge_id, day) do update set multiplier = excluded.multiplier, title = excluded.title;
  if v_new then
    for m in select profile_id from public.challenge_participants where challenge_id = c.id and status <> 'LEFT' and profile_id <> v_uid loop
      perform private.notify(m.profile_id, c.target_club_id, 'CHALLENGE_BOOST',
        'Ngày vàng ×' || trim(to_char(p_multiplier, 'FM9.9')) || ' ngày ' || to_char(p_day, 'DD/MM') || ': ' || c.title,
        v_title || ' — km chạy trong ngày được nhân ×' || trim(to_char(p_multiplier, 'FM9.9')) || '.', '/challenges/' || c.id, v_uid, false);
    end loop;
  end if;
  return public.challenge_boost_days(c.id);
end $$;

-- ---------------------------------------------------------------------
-- 4. Chinh phục: người tạo đặt hạng mục; người chơi đăng ký hạng mục (+ mục tiêu riêng nếu SELF)
-- p = { objective: 'BEST_TIME' | 'BEST_PACE', mode: 'FIXED' | 'SELF', categories: [{ label, distance_km, target_s }] }
-- ---------------------------------------------------------------------
create or replace function public.set_challenge_conquest(p_challenge_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
  v_obj text := upper(coalesce(p->>'objective', ''));
  v_mode text := upper(coalesce(p->>'mode', 'FIXED'));
  v_cats jsonb := case when jsonb_typeof(p->'categories') = 'array' then p->'categories' else '[]'::jsonb end;
  v_n integer := jsonb_array_length(case when jsonb_typeof(p->'categories') = 'array' then p->'categories' else '[]'::jsonb end);
  v_min_m numeric;
begin
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if not private.challenge_is_manager(c) then raise exception 'FORBIDDEN'; end if;
  if c.status <> 'ACTIVE' or now() >= c.end_date then raise exception 'CHALLENGE_CLOSED'; end if;
  if c.format <> 'SOLO_GOAL' then raise exception 'CONQUEST_NOT_SUPPORTED'; end if;
  if v_obj not in ('BEST_TIME', 'BEST_PACE') or v_mode not in ('FIXED', 'SELF') then raise exception 'INVALID_CONQUEST'; end if;
  if v_n not between 1 and 8 then raise exception 'INVALID_CONQUEST'; end if;
  if exists (select 1 from public.challenge_category_entries e where e.challenge_id = c.id) then raise exception 'CONQUEST_LOCKED'; end if;
  begin
    if exists (select 1 from jsonb_array_elements(v_cats) x
                where char_length(trim(coalesce(x->>'label', ''))) not between 1 and 40
                   or (x->>'distance_km')::numeric not between 0.4 and 250
                   or (v_mode = 'FIXED' and coalesce((x->>'target_s')::int, 0) <= 0)
                   or (v_mode = 'FIXED' and v_obj = 'BEST_PACE' and (x->>'target_s')::int not between 120 and 1500)
                   or (v_mode = 'FIXED' and v_obj = 'BEST_TIME' and (x->>'target_s')::int not between 60 and 172800)) then
      raise exception 'INVALID_CONQUEST';
    end if;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'INVALID_CONQUEST';
  end;
  delete from public.challenge_categories where challenge_id = c.id;
  insert into public.challenge_categories (challenge_id, position, label, distance_m, target_s)
  select c.id, t.ord, trim(t.x->>'label'), round((t.x->>'distance_km')::numeric * 1000),
         case when v_mode = 'FIXED' then (t.x->>'target_s')::int end
    from jsonb_array_elements(v_cats) with ordinality as t(x, ord);
  v_min_m := (select min(distance_m) from public.challenge_categories where challenge_id = c.id);
  update public.challenges
     set objective = v_obj, conquest_mode = v_mode, target_value = 1, target_type = v_obj, target_km = 0,
         pledge_enabled = false, reward_split = 'FINISHERS', game_mode = 'ACCUMULATE',
         -- bài ngắn hơn hạng mục nhỏ nhất không thể cho kết quả → không cần ghi nhận
         min_km = round(v_min_m * 0.99 / 1000.0, 2)
   where id = c.id;
  return public.challenge_conquest_board(c.id);
end $$;

create or replace function public.set_my_conquest(p_challenge_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
  v_pid uuid := (select x.id from public.challenge_participants x where x.challenge_id = p_challenge_id and x.profile_id = v_uid and x.status <> 'LEFT');
  v_items jsonb := case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end;
  v_started boolean;
begin
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if c.objective not in ('BEST_TIME', 'BEST_PACE') then raise exception 'CONQUEST_NOT_SUPPORTED'; end if;
  if v_pid is null then raise exception 'NOT_JOINED'; end if;
  if c.status <> 'ACTIVE' or now() >= c.end_date then raise exception 'CHALLENGE_CLOSED'; end if;
  if jsonb_array_length(v_items) = 0 then raise exception 'INVALID_CONQUEST'; end if;
  begin
    if exists (select 1 from jsonb_array_elements(v_items) x
                where not exists (select 1 from public.challenge_categories cat where cat.id = (x->>'category_id')::uuid and cat.challenge_id = c.id)
                   or (c.conquest_mode = 'SELF' and coalesce((x->>'target_s')::int, 0) <= 0)
                   or (c.conquest_mode = 'SELF' and c.objective = 'BEST_PACE' and (x->>'target_s')::int not between 120 and 1500)
                   or (c.conquest_mode = 'SELF' and c.objective = 'BEST_TIME' and (x->>'target_s')::int not between 60 and 172800)) then
      raise exception 'INVALID_CONQUEST';
    end if;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'INVALID_CONQUEST';
  end;
  v_started := now() >= c.start_date;
  -- Sau giờ xuất phát: được thêm hạng mục mới (người tham gia trễ) nhưng không bỏ / đổi mục tiêu đã đăng ký
  if v_started and exists (
       select 1 from public.challenge_category_entries e
        where e.participant_id = v_pid
          and (not exists (select 1 from jsonb_array_elements(v_items) x where (x->>'category_id')::uuid = e.category_id)
               or (c.conquest_mode = 'SELF' and e.target_s is distinct from
                     (select (x->>'target_s')::int from jsonb_array_elements(v_items) x where (x->>'category_id')::uuid = e.category_id)))) then
    raise exception 'CONQUEST_TARGET_LOCKED';
  end if;
  delete from public.challenge_category_entries e
   where e.participant_id = v_pid
     and not exists (select 1 from jsonb_array_elements(v_items) x where (x->>'category_id')::uuid = e.category_id);
  insert into public.challenge_category_entries (participant_id, category_id, challenge_id, user_id, target_s)
  select v_pid, (x->>'category_id')::uuid, c.id, v_uid, case when c.conquest_mode = 'SELF' then (x->>'target_s')::int end
    from jsonb_array_elements(v_items) x
  on conflict (participant_id, category_id) do update set target_s = excluded.target_s;
  perform private.challenge_recompute_participant(v_pid);
  return public.challenge_conquest_board(c.id);
end $$;

-- BXH chinh phục: các hạng mục (số người đăng ký / đã đạt), từng người theo hạng mục (nhanh nhất trước)
create or replace function public.challenge_conquest_board(p_challenge_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
begin
  if c.id is null or not public.challenge_visible(c.id) then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  return jsonb_build_object(
    'objective', c.objective, 'mode', c.conquest_mode,
    'categories', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', cat.id, 'label', cat.label, 'distance_m', cat.distance_m, 'target_s', cat.target_s,
                     'entrants', (select count(*) from public.challenge_category_entries e join public.challenge_participants pp on pp.id = e.participant_id
                                   where e.category_id = cat.id and pp.status <> 'LEFT'),
                     'achieved', (select count(*) from public.challenge_category_entries e join public.challenge_participants pp on pp.id = e.participant_id
                                   where e.category_id = cat.id and pp.status <> 'LEFT' and e.achieved_at is not null))
                     order by cat.position), '[]'::jsonb)
                     from public.challenge_categories cat where cat.challenge_id = c.id),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
               'category_id', r.category_id, 'user_id', r.user_id, 'display_name', r.display_name, 'avatar_url', r.avatar_url, 'level', r.level,
               'target_s', r.target_s_eff, 'best_time_s', r.best_time_s, 'best_pace_s', r.best_pace_s, 'best_activity_id', r.best_activity_id,
               'best_at', r.best_at, 'achieved', r.achieved_at is not null, 'rank', r.rk, 'me', r.user_id = v_uid)
               order by r.category_id, r.rk nulls last, r.display_name), '[]'::jsonb)
               from (select e.*, coalesce(e.target_s, cat.target_s) as target_s_eff, pr.display_name, pr.avatar_url, coalesce(pr.level, 1) as level,
                            case when e.best_time_s is not null then rank() over (partition by e.category_id, (e.best_time_s is not null)
                                                                                     order by e.best_time_s, e.best_at) end as rk
                       from public.challenge_category_entries e
                       join public.challenge_categories cat on cat.id = e.category_id
                       join public.challenge_participants pp on pp.id = e.participant_id and pp.status <> 'LEFT'
                       join public.profiles pr on pr.id = e.user_id
                      where e.challenge_id = c.id) r),
    'mine', (select coalesce(jsonb_agg(jsonb_build_object('category_id', e.category_id, 'target_s', e.target_s,
               'best_time_s', e.best_time_s, 'best_pace_s', e.best_pace_s, 'achieved', e.achieved_at is not null)), '[]'::jsonb)
               from public.challenge_category_entries e where e.challenge_id = c.id and e.user_id = v_uid)
  );
end $$;

-- ---------------------------------------------------------------------
-- 5. Hạn đăng ký: người tạo sửa được; tham gia trễ vẫn tính mọi bài từ ngày bắt đầu
-- ---------------------------------------------------------------------
create or replace function public.set_challenge_reg_deadline(p_challenge_id uuid, p_deadline timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
begin
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if not private.challenge_is_manager(c) then raise exception 'FORBIDDEN'; end if;
  if c.status <> 'ACTIVE' or now() >= c.end_date then raise exception 'CHALLENGE_CLOSED'; end if;
  if p_deadline is null or p_deadline > c.end_date or p_deadline < now() - interval '1 minute' then raise exception 'INVALID_DEADLINE'; end if;
  if c.format = 'TEAM' and p_deadline > c.start_date then raise exception 'INVALID_DEADLINE'; end if;
  update public.challenges set reg_deadline = p_deadline where id = c.id;
  return jsonb_build_object('reg_deadline', p_deadline);
end $$;

-- Bản 000600 + chặn đăng ký sau hạn (người tạo luôn vào được); viết lại không dùng SELECT INTO / LIMIT / RETURNING INTO
create or replace function public.join_challenge(p_challenge_id uuid, p_code text default null, p_team_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.challenges;
  v_team uuid := p_team_id;
  v_pid uuid;
  v_cur public.challenge_participants;
  a record;
begin
  perform 1 from public.challenges where id = p_challenge_id for update;
  c := (select x from public.challenges x where x.id = p_challenge_id);
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if c.status <> 'ACTIVE' or now() >= c.end_date then raise exception 'CHALLENGE_CLOSED'; end if;
  if c.format = 'TEAM' and now() >= c.start_date then raise exception 'TEAM_ROSTER_LOCKED'; end if;
  if c.reg_deadline is not null and now() >= c.reg_deadline and c.created_by is distinct from v_uid then raise exception 'REGISTRATION_CLOSED'; end if;

  -- Quyền vào
  if c.target_audience = 'CLUB_ONLY' and not public.club_is_member(c.target_club_id) then raise exception 'CLUB_MEMBERS_ONLY'; end if;
  if c.target_audience = 'INVITE_ONLY' and c.created_by is distinct from v_uid
     and not exists (select 1 from public.challenge_invites where challenge_id = c.id and code = lower(trim(coalesce(p_code, '')))) then
    raise exception 'INVALID_INVITE';
  end if;

  v_cur := (select x from public.challenge_participants x where x.challenge_id = c.id and x.profile_id = v_uid);
  if v_cur.id is not null and v_cur.status <> 'LEFT' then raise exception 'ALREADY_JOINED'; end if;

  if (select count(*) from public.challenge_participants where challenge_id = c.id and status <> 'LEFT') >= coalesce(c.max_slots, 10000) then
    raise exception 'CHALLENGE_FULL';
  end if;

  if c.format = 'TEAM' then
    if v_team is null then   -- chưa chọn đội → vào đội ít người nhất
      v_team := (select x.id from (
                   select t.id, row_number() over (order by count(p.id), t.position) as rn
                     from public.challenge_teams t
                     left join public.challenge_participants p on p.team_id = t.id and p.status <> 'LEFT'
                    where t.challenge_id = c.id group by t.id, t.position) x
                  where x.rn = 1);
    end if;
    if not exists (select 1 from public.challenge_teams where id = v_team and challenge_id = c.id) then raise exception 'INVALID_TEAM'; end if;
    if coalesce(c.fixed_team_size, 0) > 0 and (select count(*) from public.challenge_participants
         where team_id = v_team and status <> 'LEFT') >= c.fixed_team_size then raise exception 'TEAM_FULL'; end if;
  else
    v_team := null;
  end if;

  if v_cur.id is not null then
    v_pid := v_cur.id;
    update public.challenge_participants set status = 'JOINED', team_id = v_team, joined_at = now() where id = v_pid;
  else
    v_pid := gen_random_uuid();
    insert into public.challenge_participants (id, challenge_id, profile_id, status, team_id)
    values (v_pid, c.id, v_uid, 'JOINED', v_team);
  end if;

  -- Tính luôn các bài chạy đã có trong thời gian thử thách (tham gia trễ vẫn được tính từ ngày bắt đầu)
  for a in select id from public.activities
            where user_id = v_uid and validation_status = 'APPROVED'
              and started_at >= c.start_date and started_at < least(c.end_date, now() + interval '1 day')
  loop
    perform private.challenge_apply_activity(a.id, v_pid);
  end loop;

  if c.created_by is not null and c.created_by <> v_uid then
    perform private.notify(c.created_by, c.target_club_id, 'CHALLENGE_JOINED',
      private.display_name(v_uid) || case when c.format = 'DUEL' then ' đã nhận lời thách đấu: ' else ' đã tham gia ' end || c.title,
      null, '/challenges/' || c.id, v_uid, c.format = 'DUEL');
  end if;

  return jsonb_build_object('participant_id', v_pid, 'team_id', v_team);
end $$;

-- ---------------------------------------------------------------------
-- 6. BXH chi tiết: một người trong thử thách — km từng ngày, từng bài
-- ---------------------------------------------------------------------
create or replace function public.challenge_member_days(p_challenge_id uuid, p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
  p public.challenge_participants := (select x from public.challenge_participants x where x.challenge_id = p_challenge_id and x.profile_id = p_user_id);
  v_acts boolean;
begin
  perform private.require_uid();
  if c.id is null or not public.challenge_visible(c.id) then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if p.id is null then raise exception 'NOT_JOINED'; end if;
  -- Bài chạy cụ thể chỉ hiện khi người đó cho xem hoạt động (km theo ngày vẫn hiện như trên BXH)
  v_acts := p_user_id = auth.uid() or public.can_view_activities(p_user_id);
  return jsonb_build_object(
    'user', (select jsonb_build_object('id', pr.id, 'display_name', pr.display_name, 'avatar_url', pr.avatar_url, 'level', coalesce(pr.level, 1))
               from public.profiles pr where pr.id = p_user_id),
    'summary', jsonb_build_object('km', round(p.distance_m / 1000.0, 2), 'runs', p.run_count, 'moving_s', p.moving_s,
                                  'days', (select count(distinct e.day) from public.challenge_progress_events e where e.participant_id = p.id),
                                  'score', p.current_progress, 'completed_at', p.completed_at, 'joined_at', p.joined_at),
    'show_activities', v_acts,
    'days', (select coalesce(jsonb_agg(jsonb_build_object(
               'day', d.day, 'km', d.km, 'counted_km', d.counted_km, 'runs', d.runs, 'moving_s', d.moving_s, 'boost', d.boost,
               'activities', case when v_acts then d.acts else '[]'::jsonb end) order by d.day desc), '[]'::jsonb)
               from (select e.day, round(sum(e.distance_m) / 1000.0, 2) as km, round(sum(e.counted_m) / 1000.0, 2) as counted_km,
                            count(*) as runs, sum(e.moving_s) as moving_s, max(e.boost) as boost,
                            jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'started_at', a.started_at,
                                                         'distance_m', e.distance_m, 'moving_s', e.moving_s) order by a.started_at) as acts
                       from public.challenge_progress_events e join public.activities a on a.id = e.activity_id
                      where e.participant_id = p.id group by e.day) d)
  );
end $$;

revoke all on function private.challenge_boost(uuid, date) from public, anon, authenticated;
revoke all on function public.challenge_boost_days(uuid), public.set_challenge_boost_day(uuid, date, numeric, text),
  public.set_challenge_conquest(uuid, jsonb), public.set_my_conquest(uuid, jsonb), public.challenge_conquest_board(uuid),
  public.set_challenge_reg_deadline(uuid, timestamptz), public.challenge_member_days(uuid, uuid) from public, anon;
grant execute on function public.challenge_boost_days(uuid), public.set_challenge_boost_day(uuid, date, numeric, text),
  public.set_challenge_conquest(uuid, jsonb), public.set_my_conquest(uuid, jsonb), public.challenge_conquest_board(uuid),
  public.set_challenge_reg_deadline(uuid, timestamptz), public.challenge_member_days(uuid, uuid) to authenticated;

-- ===================================================================
-- 20261001010800_ledger_hardening.sql
-- ===================================================================
-- 010800: KHÓA CHỐNG TRỪ XU HAI LẦN, TÀI KHOẢN QUẢN TRỊ KHÔNG NHẬN XU, SỬA LỖI BXH ĐẤU CLB
--   • Sổ cái: khóa theo mã giao dịch TRƯỚC khi kiểm tra trùng → hai yêu cầu cùng mã (bấm 2 lần, mạng gửi lại) chỉ ghi 1 lần,
--     lần sau nhận lại đúng giao dịch cũ (không báo lỗi). Khóa từng ví theo thứ tự cố định, kiểm tra số dư sau khi khóa.
--   • Lưới an toàn cuối: ví người dùng không bao giờ âm — kể cả khi có đoạn code ghi thẳng vào sổ cái (kiểm tra lúc chốt giao dịch).
--   • Tài khoản quản trị hệ thống không được cộng Xu (thưởng chạy, nhiệm vụ, giới thiệu, khuyến mãi…): phần Xu đó không phát hành.
--     Hoàn tiền (…REFUND) vẫn trả lại bình thường.
--   • Sửa lỗi "cannot cast type record to club_battles" ở tab BXH → Đấu CLB.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create unique index if not exists ledger_transactions_idempotency_uidx on public.ledger_transactions (idempotency_key);

-- Tài khoản quản trị hệ thống (không nhận Xu)
create or replace function private.is_admin_account(p_account uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = p_account and p.role = 'SYSTEM_ADMIN')
$$;

create or replace function private.ledger_post(
  p_type text, p_idempotency_key text, p_reason text, p_created_by uuid, p_entries jsonb,
  p_ref uuid default null, p_allow_negative boolean default false
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_tx uuid;
  v_e record;
  v_entries jsonb := p_entries;
  v_bal numeric;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 3 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  -- 1. Cùng mã giao dịch → xếp hàng; ai tới sau nhận lại giao dịch đã ghi
  perform pg_advisory_xact_lock(hashtextextended('ledger-key:' || p_idempotency_key, 0));
  v_tx := (select t.id from public.ledger_transactions t where t.idempotency_key = p_idempotency_key);
  if v_tx is not null then return v_tx; end if;

  if jsonb_typeof(v_entries) <> 'array' or jsonb_array_length(v_entries) < 2 then raise exception 'LEDGER_INVALID_ENTRIES'; end if;
  if (select coalesce(sum((e->>'amount')::numeric), 0) from jsonb_array_elements(v_entries) e) <> 0 then raise exception 'LEDGER_UNBALANCED'; end if;

  -- 2. Tài khoản quản trị không nhận Xu: phần cộng cho admin trả về tài khoản hệ thống (không phát hành); hoàn tiền giữ nguyên
  if p_type not like '%REFUND%' then
    v_entries := (select jsonb_agg(case when (e->>'amount')::numeric > 0 and private.is_admin_account((e->>'account_id')::uuid)
                                        then jsonb_set(e, '{account_id}', to_jsonb(private.system_account()::text)) else e end)
                    from jsonb_array_elements(v_entries) e);
  end if;
  if p_allow_negative then perform set_config('racehub.ledger_allow_negative', 'on', true); end if;

  -- 3. Khóa từng ví theo thứ tự cố định (tránh deadlock), rồi mới kiểm tra số dư
  for v_e in
    select distinct (e->>'account_id')::uuid as acc, e->>'coin_kind' as kind
      from jsonb_array_elements(v_entries) e
     order by 1, 2
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_e.acc::text || ':' || v_e.kind, 0));
  end loop;

  v_tx := gen_random_uuid();
  insert into public.ledger_transactions (id, type, idempotency_key, reason, created_by, campaign_id)
  values (v_tx, p_type, p_idempotency_key, p_reason, p_created_by, p_ref);

  for v_e in
    select (e->>'account_id')::uuid as acc, e->>'coin_kind' as kind, sum((e->>'amount')::numeric) as amt
      from jsonb_array_elements(v_entries) e
     group by 1, 2
  loop
    if v_e.kind not in ('BONUS', 'PAID') then raise exception 'LEDGER_INVALID_COIN_KIND'; end if;
    if v_e.amt = 0 then continue; end if;
    if v_e.amt < 0 and v_e.acc <> private.system_account() and not p_allow_negative then
      v_bal := (select coalesce(sum(le.amount), 0) from public.ledger_entries le where le.account_id = v_e.acc and le.coin_kind = v_e.kind);
      if v_bal + v_e.amt < 0 then raise exception 'INSUFFICIENT_BALANCE'; end if;
    end if;
    insert into public.ledger_entries (transaction_id, account_id, coin_kind, amount)
    values (v_tx, v_e.acc, v_e.kind, v_e.amt);
  end loop;

  -- 4. Đồng bộ bản sao số dư
  update public.profiles p set xu = s.total
    from (select account_id, sum(amount) as total from public.ledger_entries
           where account_id in (select (e->>'account_id')::uuid from jsonb_array_elements(v_entries) e)
           group by account_id) s
   where p.id = s.account_id;
  update public.clubs c set treasury_balance = s.total
    from (select account_id, sum(amount) as total from public.ledger_entries
           where account_id in (select (e->>'account_id')::uuid from jsonb_array_elements(v_entries) e)
           group by account_id) s
   where c.id = s.account_id;

  return v_tx;
end $$;

-- Lưới an toàn: ví (trừ tài khoản hệ thống) không được âm khi chốt giao dịch
create or replace function private.ledger_no_negative() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.amount < 0 and new.account_id <> private.system_account()
     and coalesce(current_setting('racehub.ledger_allow_negative', true), '') <> 'on'
     and (select coalesce(sum(le.amount), 0) from public.ledger_entries le
           where le.account_id = new.account_id and le.coin_kind = new.coin_kind) < 0 then
    raise exception 'INSUFFICIENT_BALANCE';
  end if;
  return null;
end $$;
drop trigger if exists trg_ledger_no_negative on public.ledger_entries;
create constraint trigger trg_ledger_no_negative after insert on public.ledger_entries
  deferrable initially deferred for each row execute function private.ledger_no_negative();

-- Sự kiện thưởng: quản trị viên vẫn có XP, huy hiệu nhưng không hiện "+Xu"
create or replace function private.award(
  p_user uuid, p_kind text, p_title text, p_subtitle text, p_xu numeric, p_xp integer, p_key text,
  p_activity uuid default null, p_payload jsonb default '{}'::jsonb
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_rows integer; v_xu numeric := case when private.is_admin_account(p_user) then 0 else coalesce(p_xu, 0) end;
begin
  insert into public.game_events (user_id, kind, title, subtitle, xu, xp, activity_id, payload, dedupe_key)
  values (p_user, p_kind, left(p_title, 160), left(p_subtitle, 200), v_xu, coalesce(p_xp, 0), p_activity,
          coalesce(p_payload, '{}'::jsonb), p_key)
  on conflict (dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return false; end if;
  if v_xu > 0 then
    perform private.ledger_post('GAME_' || p_kind, 'game:' || p_key, p_title, p_user,
      jsonb_build_array(
        jsonb_build_object('account_id', p_user, 'coin_kind', 'BONUS', 'amount', v_xu),
        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -v_xu)),
      p_activity);
  end if;
  perform private.add_xp(p_user, p_xp, p_activity);
  return true;
end $$;

-- Sửa: truyền đúng kiểu club_battles (bản cũ kèm cột rn → lỗi "cannot cast type record to club_battles")
create or replace function public.club_battles_of(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return (select coalesce(jsonb_agg(private.club_battle_json(t.b)
                   order by case (t.b).status when 'ACCEPTED' then 0 when 'PENDING' then 1 else 2 end, (t.b).start_at desc), '[]'::jsonb)
            from (select x as b, row_number() over (order by x.created_at desc) as rn
                    from public.club_battles x where p_club_id in (x.challenger_id, x.opponent_id)) t
           where t.rn <= 30);
end $$;

revoke all on function private.is_admin_account(uuid), private.ledger_no_negative() from public, anon, authenticated;

-- ===================================================================
-- 20261001010900_race_board_wording.sql
-- ===================================================================
-- 010900: BXH GIẢI CHẠY THEO TỪNG CỰ LY — AI HOÀN THÀNH, AI CHƯA; ĐỔI "MỐC" → "MỤC TIÊU"
--   • race_results_v2(race, cự ly): mọi VĐV đã đăng ký cự ly đó (trừ người rút tên): người hoàn thành xếp theo thành tích,
--     người chưa hoàn thành xếp sau; kèm số người đăng ký / hoàn thành. Ai xem được giải thì xem được bảng.
--   • Thử thách tuần đã tạo: câu mô tả "Chọn mốc km…" đổi thành "Chọn mục tiêu km…" (cả bài đăng trên bảng tin CLB).
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create or replace function public.race_results_v2(p_race_id uuid, p_distance_km numeric) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r public.virtual_races := (select x from public.virtual_races x where x.id = p_race_id);
  v_km numeric := round(p_distance_km, 2);
begin
  if r.id is null or not private.race_visible(r) then raise exception 'RACE_NOT_FOUND'; end if;
  return jsonb_build_object(
    'registered', (select count(*) from public.race_registrations g where g.race_id = r.id and g.distance_km = v_km and g.status <> 'WITHDRAWN'),
    'finished', (select count(*) from public.race_registrations g where g.race_id = r.id and g.distance_km = v_km and g.status = 'FINISHED'),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
               'rank', case when t.status = 'FINISHED' then t.rn end, 'user_id', t.user_id, 'display_name', p.display_name,
               'avatar_url', p.avatar_url, 'bib', t.bib, 'status', t.status,
               'finish_time_s', t.finish_time_s, 'pace_s', case when t.finish_time_s is not null then round(t.finish_time_s / t.distance_km) end,
               'finished_at', t.finished_at, 'activity_id', t.finish_activity_id, 'is_me', t.user_id = auth.uid())
               order by (t.status <> 'FINISHED'), t.rn, t.bib), '[]'::jsonb)
               from (select g.*, row_number() over (order by (g.status <> 'FINISHED'), g.finish_time_s nulls last, g.finished_at, g.bib) as rn
                       from public.race_registrations g
                      where g.race_id = r.id and g.distance_km = v_km and g.status <> 'WITHDRAWN') t
               join public.profiles p on p.id = t.user_id
              where t.rn <= 1000 or t.user_id = auth.uid())
  );
end $$;

revoke all on function public.race_results_v2(uuid, numeric) from public, anon;
grant execute on function public.race_results_v2(uuid, numeric) to authenticated;

-- "Mốc" → "Mục tiêu" trong mô tả thử thách tuần đã tạo trước đây
update public.challenges
   set description = replace(replace(description, 'Chọn mốc km của bạn cho tuần này', 'Chọn mục tiêu km của bạn cho tuần này'),
                             'Hoàn thành mốc đã đăng ký là chiến thắng', 'Hoàn thành mục tiêu đã đăng ký là chiến thắng')
 where description like '%Chọn mốc km của bạn cho tuần này%' or description like '%Hoàn thành mốc đã đăng ký%';
update public.club_posts
   set body = replace(replace(body, 'Chọn mốc km của bạn cho tuần này', 'Chọn mục tiêu km của bạn cho tuần này'),
                      'Hoàn thành mốc đã đăng ký là chiến thắng', 'Hoàn thành mục tiêu đã đăng ký là chiến thắng')
 where kind = 'CHALLENGE' and (body like '%Chọn mốc km của bạn cho tuần này%' or body like '%Hoàn thành mốc đã đăng ký%');

commit;
