-- RaceHub — PHẦN 17/19 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 010700, 010800, 010900, 011000, 011100, 011200, 011300, 011400
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

-- ===================================================================
-- 20261001011000_gift_catalog_v2.sql
-- ===================================================================
-- 011000: KHO QUÀ V2 — QUÀ TĨNH / QUÀ HIỆU ỨNG ĐỘNG, QUÀ THEO MỐC, 45 QUÀ MỚI, ẢNH RIÊNG
--   • Mỗi quà có loại: STATIC (quà tĩnh — hình đứng yên cạnh bài) hoặc ANIMATED (quà động — hoạt ảnh khi tặng;
--     dưới 1.000 Xu chạy trong khung bài, từ 1.000 Xu toàn màn hình). App chia bảng quà thành 2 tab theo loại.
--   • Ảnh riêng cho quà (art_url, ảnh tĩnh hoặc WebP động): admin tải lên ở Quản trị → Quà tặng. Chưa có ảnh → dùng emoji.
--   • Quà theo mốc (context): chỉ tặng được trên bài chạy hợp lệ đạt mốc — KM5 (≥ 5 km), KM10, HALF (≥ 21 km),
--     FULL (≥ 42 km), ULTRA (≥ 45 km), PR (kỷ lục cá nhân: dài nhất từ trước tới nay, hoặc pace nhanh nhất ở bài ≥ 5 km).
--   • 45 quà mới (28 tĩnh, 17 động). "Huy chương" đổi tên thành "Huy chương vàng". "Siêu tân tinh" tạo sẵn nhưng tắt —
--     chỉ bật vào dịp đặc biệt. Quà Tết (hoa đào, hoa mai, pháo hoa giao thừa) tự hiện 15/1–28/2.
--   • Không có quốc kỳ, sao vàng, bản đồ Việt Nam trong kho quà.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn
-- (không ghi đè những gì admin đã sửa sau lần chạy đầu).

alter table public.gift_catalog add column if not exists kind text not null default 'STATIC';
alter table public.gift_catalog add column if not exists art_url text;
alter table public.gift_catalog add column if not exists context text;
alter table public.gift_catalog drop constraint if exists gift_catalog_kind_chk;
alter table public.gift_catalog add constraint gift_catalog_kind_chk check (kind in ('STATIC', 'ANIMATED'));
alter table public.gift_catalog drop constraint if exists gift_catalog_art_chk;
alter table public.gift_catalog add constraint gift_catalog_art_chk check (art_url is null or (art_url ~ '^https://' and char_length(art_url) <= 500));
alter table public.gift_catalog drop constraint if exists gift_catalog_context_chk;
alter table public.gift_catalog add constraint gift_catalog_context_chk check (context is null or context in ('KM5', 'KM10', 'HALF', 'FULL', 'ULTRA', 'PR'));

-- Chỉ lần chạy đầu: đánh dấu quà động có sẵn, đổi tên huy chương, phượng hoàng có biểu tượng riêng (không lẫn với đại bàng)
update public.gift_catalog set kind = 'ANIMATED'
 where code in ('fireworks', 'laurel', 'golden_shoes', 'rocket', 'rainbow', 'phoenix', 'crown')
   and not exists (select 1 from private.app_settings s where s.key = 'gift_v2_seeded');
update public.gift_catalog set name = 'Huy chương vàng'
 where code = 'medal' and name = 'Huy chương' and not exists (select 1 from private.app_settings s where s.key = 'gift_v2_seeded');
update public.gift_catalog set emoji = '🐦‍🔥'
 where code = 'phoenix' and emoji = '🦅' and not exists (select 1 from private.app_settings s where s.key = 'gift_v2_seeded');
insert into private.app_settings (key, value) values ('gift_v2_seeded', 'true') on conflict (key) do nothing;

insert into public.gift_catalog (code, name, emoji, price_xu, tier, description, kind, context, season_from, season_to, is_active, sort) values
  -- Quà tĩnh
  ('heart',          'Trái tim',              '❤️', 2,     'CHEER',  'Thương lắm, cố lên!',                        'STATIC',   null,    null, null, true, 100),
  ('sun',            'Mặt trời',              '☀️', 3,     'CHEER',  'Chào buổi chạy sáng',                        'STATIC',   null,    null, null, true, 101),
  ('confetti',       'Pháo giấy',             '🎊', 5,     'CHEER',  'Chúc mừng nho nhỏ',                          'STATIC',   null,    null, null, true, 102),
  ('fist',           'Nắm đấm quyết tâm',     '👊', 5,     'CHEER',  'Không bỏ cuộc!',                             'STATIC',   null,    null, null, true, 103),
  ('handshake',      'Bắt tay',               '🤝', 5,     'CHEER',  'Rất vui được chạy cùng',                     'STATIC',   null,    null, null, true, 104),
  ('cheer_flag',     'Cờ cổ vũ',              '🚩', 10,    'CHEER',  'Phất cờ bên đường chạy',                     'STATIC',   null,    null, null, true, 105),
  ('coconut',        'Nước dừa',              '🥥', 15,    'CHEER',  'Mát lành sau buổi chạy nắng',                'STATIC',   null,    null, null, true, 106),
  ('cold_towel',     'Khăn lạnh',             '🧊', 15,    'CHEER',  'Hạ nhiệt giữa trưa hè',                      'STATIC',   null,    null, null, true, 107),
  ('choco_milk',     'Sữa chocolate phục hồi','🥛', 20,    'CHEER',  'Bữa phục hồi kinh điển của runner',          'STATIC',   null,    null, null, true, 108),
  ('caffeine_gel',   'Gel caffeine',          '⚡', 25,    'CHEER',  'Tỉnh táo cho những km cuối',                 'STATIC',   null,    null, null, true, 109),
  ('pho',            'Bát phở hồi sức',       '🍜', 30,    'BOOST',  'Phở nóng sau long run',                      'STATIC',   null,    null, null, true, 110),
  ('foam_roller',    'Con lăn massage',       '🪵', 30,    'BOOST',  'Lăn cơ, thả lỏng bắp chân',                  'STATIC',   null,    null, null, true, 111),
  ('bronze_medal',   'Huy chương đồng',       '🥉', 30,    'BOOST',  'Một buổi chạy đáng khen',                    'STATIC',   null,    null, null, true, 112),
  ('thanks_pacer',   'Cảm ơn pacer',          '🎈', 30,    'BOOST',  'Cảm ơn người giữ nhịp cho cả nhóm',          'STATIC',   null,    null, null, true, 113),
  ('congrats_5k',    'Chúc mừng 5K',          '🎽', 30,    'BOOST',  'Chỉ tặng trên bài chạy từ 5 km',             'STATIC',   'KM5',   null, null, true, 114),
  ('foot_massage',   'Massage chân',          '💆', 50,    'BOOST',  'Đôi chân xứng đáng được nghỉ ngơi',          'STATIC',   null,    null, null, true, 115),
  ('silver_medal',   'Huy chương bạc',        '🥈', 50,    'BOOST',  'Chạy đẹp lắm!',                              'STATIC',   null,    null, null, true, 116),
  ('conical_hat',    'Nón lá runner',         '👒', 50,    'BOOST',  'Chất Việt trên mọi cung đường',              'STATIC',   null,    null, null, true, 117),
  ('thanks_crew',    'Tri ân hậu cần',        '🙌', 50,    'BOOST',  'Cảm ơn đội nước, đội y tế, đội hậu cần',     'STATIC',   null,    null, null, true, 118),
  ('team_star',      'Ngôi sao đồng đội',     '⭐', 50,    'BOOST',  'Đồng đội tuyệt vời nhất',                    'STATIC',   null,    null, null, true, 119),
  ('peach_blossom',  'Hoa đào',               '🌸', 50,    'BOOST',  'Quà Tết — xuân chạy khỏe',                   'STATIC',   null,    '2000-01-15', '2000-02-28', true, 120),
  ('apricot_blossom','Hoa mai',               '🌼', 50,    'BOOST',  'Quà Tết — năm mới rực rỡ',                   'STATIC',   null,    '2000-01-15', '2000-02-28', true, 121),
  ('congrats_10k',   'Chúc mừng 10K',         '🏃', 50,    'BOOST',  'Chỉ tặng trên bài chạy từ 10 km',            'STATIC',   'KM10',  null, null, true, 122),
  ('marathon_kit',   'Bộ hồi phục marathon',  '🎁', 100,   'BOOST',  'Đủ đồ phục hồi sau 42 km',                   'STATIC',   null,    null, null, true, 123),
  ('pr_flag',        'Cờ PR',                 '🏁', 100,   'BOOST',  'Chỉ tặng trên bài lập kỷ lục cá nhân',       'STATIC',   'PR',    null, null, true, 124),
  ('lotus',          'Hoa sen vàng',          '🪷', 100,   'BOOST',  'Thanh cao, bền bỉ',                          'STATIC',   null,    null, null, true, 125),
  ('pathfinder',     'Người dẫn đường',       '🧭', 100,   'BOOST',  'Cảm ơn người mở đường cho cả nhóm',          'STATIC',   null,    null, null, true, 126),
  ('congrats_half',  'Chúc mừng Half',        '🎗️', 100,   'BOOST',  'Chỉ tặng trên bài chạy từ 21 km',            'STATIC',   'HALF',  null, null, true, 127),
  -- Quà hiệu ứng động
  ('shooting_star',  'Sao băng',              '🌠', 100,   'HYPE',   'Một vệt sáng cho buổi chạy đẹp',             'ANIMATED', null,    null, null, true, 200),
  ('torch',          'Ngọn đuốc bền bỉ',      '🔥', 150,   'HYPE',   'Giữ lửa ngày qua ngày',                      'ANIMATED', null,    null, null, true, 201),
  ('thunder',        'Sấm sét',               '🌩️', 200,   'HYPE',   'Tốc độ như sấm',                             'ANIMATED', null,    null, null, true, 202),
  ('club_shield',    'Khiên CLB',             '🛡️', 200,   'HYPE',   'Niềm tự hào của CLB',                        'ANIMATED', null,    null, null, true, 203),
  ('fire_leader',    'Thủ lĩnh truyền lửa',   '📣', 200,   'HYPE',   'Người thắp lửa cho cả đội',                  'ANIMATED', null,    null, null, true, 204),
  ('nye_fireworks',  'Pháo hoa giao thừa',    '🎇', 200,   'HYPE',   'Quà Tết — đón năm mới',                      'ANIMATED', null,    '2000-01-15', '2000-02-28', true, 205),
  ('congrats_full',  'Chúc mừng Full',        '🎖️', 200,   'HYPE',   'Chỉ tặng trên bài chạy từ 42 km',            'ANIMATED', 'FULL',  null, null, true, 206),
  ('festival_drum',  'Trống hội',             '🥁', 300,   'HYPE',   'Rộn ràng ngày hội chạy',                     'ANIMATED', null,    null, null, true, 207),
  ('club_banner',    'Cờ vinh danh CLB',      '🎌', 300,   'HYPE',   'Vinh danh CLB trên đường đua',               'ANIMATED', null,    null, null, true, 208),
  ('congrats_ultra', 'Chúc mừng Ultra',       '⛰️', 300,   'HYPE',   'Chỉ tặng trên bài chạy từ 45 km',            'ANIMATED', 'ULTRA', null, null, true, 209),
  ('light_gate',     'Cổng ánh sáng',         '✨', 500,   'HYPE',   'Cổng về đích rực sáng',                      'ANIMATED', null,    null, null, true, 210),
  ('star_rain',      'Mưa sao',               '💫', 500,   'HYPE',   'Cả bầu trời chúc mừng',                      'ANIMATED', null,    null, null, true, 211),
  ('bronze_drum',    'Trống đồng',            '🪘', 500,   'HYPE',   'Hồn Việt ngân vang',                         'ANIMATED', null,    null, null, true, 212),
  ('team_cup',       'Cúp đồng đội',          '🏵️', 500,   'HYPE',   'Chiến thắng của cả đội',                     'ANIMATED', null,    null, null, true, 213),
  ('speed_eagle',    'Đại bàng tốc độ',       '🦅', 1000,  'LEGEND', 'Sải cánh trên mọi cung đường',               'ANIMATED', null,    null, null, true, 214),
  ('thang_long_dragon','Rồng Thăng Long',     '🐉', 2000,  'LEGEND', 'Rồng bay — khí thế ngút trời',               'ANIMATED', null,    null, null, true, 215),
  ('supernova',      'Siêu tân tinh',         '💥', 10000, 'LEGEND', 'Chỉ mở bán vào dịp đặc biệt',                'ANIMATED', null,    null, null, false, 216)
on conflict (code) do nothing;

-- Bài chạy có đạt mốc của quà không (quà không gắn mốc → luôn được)
create or replace function private.gift_context_ok(p_activity_id uuid, p_context text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  a public.activities := (select x from public.activities x where x.id = p_activity_id);
  v_km numeric;
begin
  if p_context is null then return true; end if;
  if a.id is null or a.validation_status is distinct from 'APPROVED' or not public.activity_is_countable(a.status, a.validation_status) then
    return false;
  end if;
  v_km := greatest(coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0), 0) / 1000.0;
  if p_context = 'KM5' then return v_km >= 5; end if;
  if p_context = 'KM10' then return v_km >= 10; end if;
  if p_context = 'HALF' then return v_km >= 21; end if;
  if p_context = 'FULL' then return v_km >= 42; end if;
  if p_context = 'ULTRA' then return v_km >= 45; end if;
  if p_context <> 'PR' or v_km < 1 then return false; end if;
  -- Kỷ lục cá nhân: phải có bài hợp lệ trước đó để so; dài nhất từ trước tới nay, hoặc pace nhanh nhất ở bài ≥ 5 km
  if not exists (select 1 from public.activities b where b.user_id = a.user_id and b.id <> a.id and b.started_at < a.started_at
                   and b.validation_status = 'APPROVED' and public.activity_is_countable(b.status, b.validation_status)) then
    return false;
  end if;
  return not exists (select 1 from public.activities b where b.user_id = a.user_id and b.id <> a.id and b.started_at < a.started_at
                       and b.validation_status = 'APPROVED' and public.activity_is_countable(b.status, b.validation_status)
                       and greatest(coalesce(nullif(b.moving_distance_m, 0), b.distance_m, 0), 0) >= v_km * 1000)
      or (v_km >= 5 and coalesce(a.avg_pace_s, 0) > 0
          and not exists (select 1 from public.activities b where b.user_id = a.user_id and b.id <> a.id and b.started_at < a.started_at
                            and b.validation_status = 'APPROVED' and public.activity_is_countable(b.status, b.validation_status)
                            and greatest(coalesce(nullif(b.moving_distance_m, 0), b.distance_m, 0), 0) >= 5000
                            and coalesce(b.avg_pace_s, 0) > 0 and b.avg_pace_s <= a.avg_pace_s));
end $$;

create or replace function private.gift_json(g public.gift_catalog) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('code', g.code, 'name', g.name, 'emoji', g.emoji, 'price_xu', g.price_xu,
    'tier', g.tier, 'kind', g.kind, 'art_url', g.art_url, 'context', g.context, 'description', g.description, 'vip_tier', g.vip_tier,
    'seasonal', g.season_from is not null, 'locked', g.vip_tier > private.user_vip_tier(auth.uid()),
    'offer', private.item_offer(auth.uid(), 'GIFT', g.code, g.price_xu, 1))
$$;

-- Bảng quà cho một bài chạy / bài đăng: quà theo mốc chỉ hiện khi bài đạt mốc
create or replace function public.gift_catalog_for(p_post_id uuid default null, p_activity_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_act uuid := coalesce(p_activity_id, (select cp.activity_id from public.club_posts cp where cp.id = p_post_id and cp.deleted_at is null));
begin
  perform private.require_uid();
  return jsonb_build_object(
    'gifts', (select coalesce(jsonb_agg(private.gift_json(g) order by g.price_xu, g.sort), '[]'::jsonb)
                from public.gift_catalog g
               where g.is_active and private.gift_in_season(g, private.vn_day(now()))
                 and (g.context is null or (v_act is not null and private.gift_context_ok(v_act, g.context)))),
    'daily_cap', coalesce((private.economy_config()->>'giftDailyCapXu')::int, 20000),
    'sent_today', coalesce((select sum(c.amount) from public.cheers c where c.from_user = auth.uid() and c.gift_code is not null
                             and c.created_at >= private.vn_start(private.vn_day(now()))), 0));
end $$;

-- Bảng quà chung (bản app cũ): không kèm quà theo mốc
create or replace function public.gift_catalog() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'gifts', (select coalesce(jsonb_agg(private.gift_json(g) order by g.sort, g.price_xu), '[]'::jsonb)
              from public.gift_catalog g where g.is_active and g.context is null and private.gift_in_season(g, private.vn_day(now()))),
    'daily_cap', coalesce((private.economy_config()->>'giftDailyCapXu')::int, 20000),
    'sent_today', coalesce((select sum(c.amount) from public.cheers c where c.from_user = auth.uid() and c.gift_code is not null
                             and c.created_at >= private.vn_start(private.vn_day(now()))), 0))
$$;

create or replace function public.send_gift(
  p_to_user uuid, p_gift_code text, p_qty integer default 1, p_message text default null, p_post_id uuid default null,
  p_activity_id uuid default null, p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  g public.gift_catalog := (select x from public.gift_catalog x where x.code = p_gift_code);
  v_qty integer := coalesce(p_qty, 1);
  v_total integer;
  v_list integer;
  v_msg text := nullif(trim(coalesce(p_message, '')), '');
  v_club uuid;
  v_author uuid;
  v_act uuid;
  v_id uuid := (select c.id from public.cheers c where c.idempotency_key = p_idempotency_key);
  v_sent numeric;
  v_name text;
  o jsonb;
  v_promo uuid;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if v_id is not null then return jsonb_build_object('gift_id', v_id, 'duplicate', true); end if;
  if g.code is null or not g.is_active or not private.gift_in_season(g, private.vn_day(now())) then raise exception 'GIFT_NOT_AVAILABLE'; end if;
  if g.vip_tier > private.user_vip_tier(v_uid) then raise exception 'VIP_REQUIRED'; end if;
  if v_qty not in (1, 5, 10, 99) then raise exception 'INVALID_QTY'; end if;
  if p_to_user is null or p_to_user = v_uid then raise exception 'CANNOT_GIFT_SELF'; end if;
  if not exists (select 1 from public.profiles where id = p_to_user) then raise exception 'USER_NOT_FOUND'; end if;
  if v_msg is not null and char_length(v_msg) > 140 then raise exception 'MESSAGE_TOO_LONG'; end if;
  if p_post_id is not null then
    v_club := (select cp.club_id from public.club_posts cp where cp.id = p_post_id and cp.deleted_at is null);
    v_author := (select cp.author_id from public.club_posts cp where cp.id = p_post_id and cp.deleted_at is null);
    if v_club is null or not public.club_is_member(v_club) or v_author is distinct from p_to_user then raise exception 'FORBIDDEN'; end if;
  end if;
  if p_activity_id is not null and not exists (select 1 from public.activities where id = p_activity_id and user_id = p_to_user) then
    raise exception 'FORBIDDEN';
  end if;
  -- Quà theo mốc: chỉ tặng trên bài chạy của người nhận đạt đúng mốc
  if g.context is not null then
    v_act := coalesce(p_activity_id, (select cp.activity_id from public.club_posts cp where cp.id = p_post_id));
    if v_act is null or not exists (select 1 from public.activities where id = v_act and user_id = p_to_user)
       or not private.gift_context_ok(v_act, g.context) then
      raise exception 'GIFT_CONTEXT_REQUIRED';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('gift:' || v_uid, 0));
  v_list := g.price_xu * v_qty;
  o := private.item_offer(v_uid, 'GIFT', g.code, g.price_xu, v_qty);
  if o is not null and (o->>'eligible')::boolean and o->>'kind' <> 'TRIAL'
     and (o->>'left' is null or (o->>'left')::int >= v_qty) then
    v_total := (o->>'price')::int * v_qty;
    v_promo := (o->>'promo_id')::uuid;
  else
    v_total := v_list;
  end if;
  v_sent := coalesce((select sum(c.amount) from public.cheers c where c.from_user = v_uid and c.gift_code is not null
                       and c.created_at >= private.vn_start(private.vn_day(now()))), 0);
  if v_sent + v_total > coalesce((private.economy_config()->>'giftDailyCapXu')::int, 20000) then raise exception 'GIFT_DAILY_LIMIT'; end if;
  if private.balance(v_uid) < v_total then raise exception 'INSUFFICIENT_BALANCE'; end if;

  -- Đốt Xu: người tặng → hệ thống. Người nhận KHÔNG nhận Xu.
  if v_total > 0 then
    perform private.ledger_post('GIFT', 'gift:' || p_idempotency_key, 'Tặng ' || v_qty || ' × ' || g.name || ' cho ' || private.display_name(p_to_user), v_uid,
      private.debit_entries(v_uid, v_total, private.system_account()));
  end if;
  v_id := gen_random_uuid();
  insert into public.cheers (id, from_user, to_user, amount, list_amount, promo_id, message, activity_id, post_id, club_id, idempotency_key, gift_code, qty)
  values (v_id, v_uid, p_to_user, v_total, v_list, v_promo, v_msg, p_activity_id, p_post_id, v_club, p_idempotency_key, g.code, v_qty);
  if v_promo is not null then
    insert into public.item_promo_redemptions (promo_id, user_id, qty, xu_paid, ref) values (v_promo, v_uid, v_qty, v_total, 'gift:' || p_idempotency_key);
  end if;
  if p_post_id is not null then update public.club_posts set cheer_xu = cheer_xu + v_total where id = p_post_id; end if;

  v_name := private.display_name(v_uid);
  perform private.award(p_to_user, 'GIFT_IN', v_name || ' tặng bạn ' || case when v_qty > 1 then v_qty || ' × ' else '' end || g.emoji || ' ' || g.name,
    v_msg, 0, 0, 'gift_in:' || v_id, p_activity_id, jsonb_build_object('from', v_uid, 'gift', g.code, 'emoji', g.emoji, 'qty', v_qty, 'tier', g.tier,
      'kind', g.kind, 'art_url', g.art_url));
  perform private.notify(p_to_user, v_club, 'GIFT', v_name || ' tặng bạn ' || case when v_qty > 1 then v_qty || ' × ' else '' end || g.emoji || ' ' || g.name,
    coalesce(v_msg, g.description), case when p_activity_id is not null then '/activities/' || p_activity_id
                                         when v_club is not null then '/clubs/' || v_club else '/me' end, v_uid, g.kind = 'ANIMATED');
  return jsonb_build_object('gift_id', v_id, 'total_xu', v_total, 'list_xu', v_list, 'emoji', g.emoji, 'tier', g.tier, 'kind', g.kind,
    'art_url', g.art_url, 'price_xu', g.price_xu, 'qty', v_qty, 'balance', private.balance(v_uid));
end $$;

-- Admin: thêm loại quà, ảnh riêng, mốc
create or replace function public.admin_save_gift(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_admin();
begin
  insert into public.gift_catalog (code, name, emoji, price_xu, tier, description, vip_tier, season_from, season_to, is_active, sort, kind, art_url, context)
  values (lower(trim(p->>'code')), trim(p->>'name'), trim(p->>'emoji'), (p->>'price_xu')::int, upper(p->>'tier'), nullif(trim(coalesce(p->>'description', '')), ''),
          coalesce((p->>'vip_tier')::int, 0), nullif(p->>'season_from', '')::date, nullif(p->>'season_to', '')::date,
          coalesce((p->>'is_active')::boolean, true), coalesce((p->>'sort')::int, 0),
          coalesce(nullif(upper(p->>'kind'), ''), 'STATIC'), nullif(trim(coalesce(p->>'art_url', '')), ''), nullif(upper(coalesce(p->>'context', '')), ''))
  on conflict (code) do update set name = excluded.name, emoji = excluded.emoji, price_xu = excluded.price_xu, tier = excluded.tier,
    description = excluded.description, vip_tier = excluded.vip_tier, season_from = excluded.season_from, season_to = excluded.season_to,
    is_active = excluded.is_active, sort = excluded.sort, kind = excluded.kind, art_url = excluded.art_url, context = excluded.context;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SAVE_GIFT', p->>'code', p);
end $$;

revoke all on function private.gift_context_ok(uuid, text), private.gift_json(public.gift_catalog) from public, anon, authenticated;
revoke all on function public.gift_catalog_for(uuid, uuid) from public, anon;
grant execute on function public.gift_catalog_for(uuid, uuid), public.gift_catalog(), public.send_gift(uuid, text, integer, text, uuid, uuid, text) to authenticated;
grant execute on function public.admin_save_gift(jsonb) to authenticated;

-- ===================================================================
-- 20261001011100_app_store_mode.sql
-- ===================================================================
-- 011100: CHẾ ĐỘ APP CỬA HÀNG — ẨN MUA BÁN TRONG APP iOS/ANDROID, LIÊN HỆ ADMIN (ZALO / TELEGRAM)
--   • Chính sách vận hành có thêm công tắc features.nativePurchases (mặc định TẮT): tắt thì app iOS/Android ẩn mọi chỗ mua gói,
--     nạp Xu, giá tiền (quy định App Store 3.1.1 / 3.1.3, Google Play Payments). Web giữ nguyên. Bật lại khi đã có thanh toán
--     qua Apple / Google (In-App Purchase). Admin đổi ở Quản trị → Hệ thống → Chính sách vận hành.
--   • Thông tin công ty có thêm Zalo và Telegram hỗ trợ (cạnh email, điện thoại) — hiện ở menu "Liên hệ hỗ trợ" và trang Gói trên web.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create or replace function private.ops_defaults() returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'features', jsonb_build_object('nearby', true, 'market', true, 'bibMarket', true, 'knowledge', true, 'races', true, 'cups', true, 'orgs', true, 'nativePurchases', false),
    'tracking', jsonb_build_object('autoPauseAfterS', 10, 'longStopAskMin', 10, 'longStopAutoStopMin', 30, 'trimTailMin', 2),
    'antiCheat', jsonb_build_object('dailyRunLimit', 20, 'minPaceMin', 3, 'vehicleKmh', 25, 'vehicleS', 30, 'severeKmh', 20, 'severeS', 120,
                                    'highKmh', 17, 'highS', 180, 'spikeKmh', 43, 'spikeMax', 3, 'autoApproveMaxScore', 0, 'gapReviewPct', 50),
    'content', jsonb_build_object('enterprise', jsonb_build_object(
      'title', 'Phong trào chạy bộ cho cả tổ chức',
      'subtitle', 'Chiến dịch, bảng xếp hạng phòng ban, quản lý nhiều CLB và báo cáo cho nhân sự — tự động từ Strava và GPS, không cần bảng tính.',
      'features', jsonb_build_array(
        jsonb_build_object('title', 'Chiến dịch sức khoẻ', 'text', 'Tạo chiến dịch theo tổng km, số buổi hoặc số ngày chạy; mục tiêu chung cả tổ chức và mục tiêu mỗi người.'),
        jsonb_build_object('title', 'Xếp hạng theo đơn vị', 'text', 'Phòng ban, chi nhánh, lớp hoặc CLB thi đua với nhau — tính cả tổng và bình quân đầu người cho công bằng.'),
        jsonb_build_object('title', 'Quản lý nhiều CLB', 'text', 'Liên đoàn mời CLB tham gia; thành viên CLB tự được tính vào chiến dịch. Có thể tài trợ CLB Pro cho cả hệ thống.'),
        jsonb_build_object('title', 'Báo cáo cho nhân sự', 'text', 'km, số buổi, số ngày chạy của từng người theo khoảng ngày; mã nhân viên, đơn vị; xuất Excel.'),
        jsonb_build_object('title', 'Thương hiệu riêng', 'text', 'Logo, ảnh bìa, màu chủ đề, khẩu hiệu; bảng tin nội bộ như một CLB lớn; chứng nhận hoàn thành thiết kế theo mẫu công ty.'),
        jsonb_build_object('title', 'Quản lý như phòng nhân sự', 'text', 'Tự duyệt theo email công ty, nhập danh sách từ Excel, đơn vị nhiều cấp, trưởng đơn vị tự quản lý người của mình.'),
        jsonb_build_object('title', 'Trao giải minh bạch', 'text', 'Chốt kết quả, duyệt top trước khi trao, ngày hội ×2 / ×3, quay thưởng may mắn có mã kiểm chứng.'),
        jsonb_build_object('title', 'Chống gian lận, tôn trọng riêng tư', 'text', 'Chỉ tính bài chạy hợp lệ (GPS, pace, duyệt); người chạy tắt chia sẻ bài nào thì bài đó không vào bảng.'))),
      'plans', private.plan_content_defaults()))
$$;

-- Các khoá thông tin pháp nhân / liên hệ (giữ đồng bộ với features/help/model/help.ts)
create or replace function private.site_info_keys() returns text[]
language sql immutable as $$
  select array['company_name', 'tax_code', 'address', 'support_email', 'support_phone', 'support_zalo', 'support_telegram',
               'dpo_contact', 'min_age', 'report_email', 'business_license']
$$;

-- ===================================================================
-- 20261001011200_cancelled_challenge_posts.sql
-- ===================================================================
-- 011200: THỬ THÁCH ĐÃ HỦY KHÔNG CÒN HIỆN TRÊN TRANG CHỦ / BẢNG TIN CLB
--   • Hủy thử thách (người tạo, ban quản trị CLB hay admin — mọi đường hủy) → bài "Thử thách mới" trên bảng tin CLB tự ẩn,
--     nên không còn hiện ở Bảng tin cộng đồng (trang chủ) và bảng tin CLB. Trang chi tiết thử thách vẫn mở được (báo "đã bị hủy").
--   • Dọn luôn bài của các thử thách đã hủy trước đây.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create or replace function private.hide_cancelled_challenge_posts() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.club_posts set deleted_at = now()
   where kind = 'CHALLENGE' and deleted_at is null and meta->>'challenge_id' = new.id::text;
  return null;
end $$;
revoke all on function private.hide_cancelled_challenge_posts() from public, anon, authenticated;

drop trigger if exists trg_hide_cancelled_challenge_posts on public.challenges;
create trigger trg_hide_cancelled_challenge_posts after update of status on public.challenges
  for each row when (new.status = 'CANCELLED' and old.status is distinct from 'CANCELLED')
  execute function private.hide_cancelled_challenge_posts();

update public.club_posts p set deleted_at = now()
  from public.challenges c
 where p.kind = 'CHALLENGE' and p.deleted_at is null and c.status = 'CANCELLED' and p.meta->>'challenge_id' = c.id::text;

-- ===================================================================
-- 20261001011300_admin_runner_xu.sql
-- ===================================================================
-- 011300: TÀI KHOẢN QUẢN TRỊ CŨNG LÀ VĐV — VẪN NHẬN XU TỪ CHẠY BỘ VÀ NẠP TIỀN, CHỈ CHẶN XU TỰ CẤP
--   Admin dùng Strava chính để chạy như mọi người: thưởng bài chạy, điểm danh, chuỗi tuần, lên cấp, huy hiệu, league,
--   giải thưởng thử thách (Xu người tạo treo, không phát hành mới), Xu nạp bằng tiền (VietQR / cửa hàng) và hoàn tiền → NHẬN bình thường.
--   Vẫn CHẶN nguồn admin có thể tự cấp cho mình: khuyến mãi / mã khuyến mãi, cộng tay (ADMIN_GRANT), thưởng giới thiệu,
--   thưởng nhiệm vụ (admin tự tạo được nhiệm vụ) → phần đó không phát hành (về tài khoản hệ thống).
--   Admin KHÔNG tự xác nhận đơn nạp / mua gói của chính mình (cần admin khác xác nhận) — chặn "in Xu" không trả tiền.
-- Thay luật "admin không nhận Xu" của 010800. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT. Chạy lại an toàn.

-- Loại giao dịch admin vẫn được cộng Xu vào ví của mình
create or replace function private.admin_credit_allowed(p_type text) returns boolean
language sql immutable as $$
  select p_type like '%REFUND%' or p_type = any (array[
    'RUN_REWARD', 'LEVEL_UP_XU', 'GAME_CHECKIN', 'GAME_STREAK', 'GAME_COMEBACK', 'GAME_BADGE', 'GAME_LEAGUE',
    'CHALLENGE_PRIZE', 'XU_PURCHASE', 'XU_PURCHASE_BONUS', 'IAP_TOPUP_VND', 'RATE_CONVERSION'])
$$;
revoke all on function private.admin_credit_allowed(text) from public, anon, authenticated;

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

  -- 2. Tài khoản quản trị không nhận Xu TỰ CẤP (khuyến mãi, cộng tay, giới thiệu, nhiệm vụ): phần đó về tài khoản hệ thống.
  --    Xu kiếm theo luật (chạy bộ, điểm danh, chuỗi, lên cấp…), Xu nạp bằng tiền và hoàn tiền vẫn nhận như người thường.
  --    Admin không tự nạp Xu cho mình (tự xác nhận đơn của chính mình = in Xu không cần trả tiền).
  if not private.admin_credit_allowed(p_type) or p_type like 'XU_PURCHASE%' then
    v_entries := (select jsonb_agg(case when (e->>'amount')::numeric > 0 and private.is_admin_account((e->>'account_id')::uuid)
                                         and (not private.admin_credit_allowed(p_type) or (e->>'account_id')::uuid = p_created_by)
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

create or replace function private.award(
  p_user uuid, p_kind text, p_title text, p_subtitle text, p_xu numeric, p_xp integer, p_key text,
  p_activity uuid default null, p_payload jsonb default '{}'::jsonb
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_rows integer; v_xu numeric := case when private.is_admin_account(p_user) and not private.admin_credit_allowed('GAME_' || p_kind) then 0 else coalesce(p_xu, 0) end;
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

-- Xác nhận đơn: không tự xác nhận đơn của chính mình
create or replace function public.admin_confirm_order(p_order_id uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_admin(); o public.orders := (select x from public.orders x where x.id = p_order_id for update);
begin
  if o.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.status = 'PAID' then return private.order_json(o); end if;
  if o.status <> 'PENDING' then raise exception 'ORDER_NOT_PENDING'; end if;
  -- Đơn của chính mình (người mua hoặc chủ ví / gói) phải do admin khác xác nhận
  if o.buyer_id = v_uid or o.owner_id = v_uid then raise exception 'SELF_CONFIRM_FORBIDDEN'; end if;
  update public.orders set status = 'PAID', paid_at = now(), confirmed_by = v_uid, note = nullif(trim(coalesce(p_note, '')), '') where id = o.id;
  if o.kind = 'PLAN' then
    perform private.grant_subscription(o.owner_type, o.owner_id, o.plan_code, o.months, 'ORDER', o.id, 'Đơn ' || o.code, v_uid);
  else
    perform private.ledger_post('XU_PURCHASE', 'order:' || o.id, 'Nạp Xu — đơn ' || o.code, v_uid,
      jsonb_build_array(jsonb_build_object('account_id', o.owner_id, 'coin_kind', 'PAID', 'amount', o.xu),
                        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'PAID', 'amount', -o.xu)), o.id);
    if o.bonus_xu > 0 then
      perform private.ledger_post('XU_PURCHASE_BONUS', 'order_bonus:' || o.id, 'Tặng thêm khi nạp — đơn ' || o.code, v_uid,
        jsonb_build_array(jsonb_build_object('account_id', o.owner_id, 'coin_kind', 'BONUS', 'amount', o.bonus_xu),
                          jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -o.bonus_xu)), o.id);
    end if;
    perform private.notify(o.owner_id, null, 'ADMIN_XU', 'Đã nạp ' || (o.xu + o.bonus_xu) || ' Xu', 'Đơn ' || o.code || ' đã được xác nhận.', '/wallet', v_uid, true);
  end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'CONFIRM_ORDER', o.code, jsonb_build_object('kind', o.kind, 'amount_vnd', o.amount_vnd, 'plan', o.plan_code, 'xu', o.xu));
  return private.order_json((select x from public.orders x where x.id = o.id));
end $$;

-- ===================================================================
-- 20261001011400_admin_list.sql
-- ===================================================================
-- 011400: DANH SÁCH QUẢN TRỊ VIÊN HỆ THỐNG
--   Quản trị → Người dùng hiện "Quản trị viên hiện tại" (tên, email, lần đăng nhập gần nhất, ngày được cấp quyền) để biết ai đang
--   có toàn quyền. Cấp thêm / gỡ quyền: mở hồ sơ người dùng → "Cấp quyền admin" / "Gỡ quyền admin" (đã có, ghi nhật ký).
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create or replace function public.admin_list_admins() returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url,
            'email', u.email, 'last_sign_in_at', u.last_sign_in_at, 'is_me', p.id = auth.uid(),
            'granted_at', (select max(l.created_at) from public.admin_audit_log l
                            where l.action = 'USER_ROLE' and l.target = 'user:' || p.id and l.new_value->>'role' = 'SYSTEM_ADMIN'))
          order by p.display_name), '[]'::jsonb)
    from public.profiles p left join auth.users u on u.id = p.id
   where p.role = 'SYSTEM_ADMIN' or p.is_admin is true);
end $$;

revoke all on function public.admin_list_admins() from public, anon;
grant execute on function public.admin_list_admins() to authenticated;

commit;
