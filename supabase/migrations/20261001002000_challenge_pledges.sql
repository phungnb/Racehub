-- =====================================================================
-- 002000 — Thử thách theo MỤC TIÊU TỰ ĐĂNG KÝ (pledge)
--
-- 1) Thử thách tuần của CLB (format SOLO_GOAL): ban quản trị đặt tên + các mốc (21 / 42 / 60 / 100 km…),
--    mỗi thành viên tự chọn mốc của mình; hoàn thành = đạt mốc đã đăng ký; xếp hạng theo % mục tiêu.
-- 2) Đua đội theo mục tiêu (format TEAM, TEAM_SUM): thành viên đăng ký mục tiêu trước giờ xuất phát,
--    ban quản trị chia đội TỰ ĐỘNG CÂN BẰNG (tổng km đăng ký các đội gần bằng nhau) hoặc NGẪU NHIÊN có cân bằng,
--    hoặc tự xếp tay. Chống "đăng ký ít chạy nhiều": mỗi người chỉ được tính tối đa mục tiêu × (1 + % vượt).
--
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Cột mới
-- ---------------------------------------------------------------------
alter table public.challenges add column if not exists pledge_enabled boolean not null default false;
alter table public.challenges add column if not exists pledge_options numeric[];          -- các mốc cho chọn; null = nhập tự do
alter table public.challenges add column if not exists pledge_min_km numeric;
alter table public.challenges add column if not exists pledge_max_km numeric;
alter table public.challenges add column if not exists pledge_cap_pct numeric;             -- null = không giới hạn phần vượt
alter table public.challenges add column if not exists teams_assigned_at timestamptz;
alter table public.challenges drop constraint if exists challenges_pledge_chk;
alter table public.challenges add constraint challenges_pledge_chk check (
  (pledge_min_km is null or pledge_min_km > 0) and (pledge_max_km is null or pledge_max_km <= 5000)
  and (pledge_cap_pct is null or pledge_cap_pct between 0 and 500));

alter table public.challenge_participants add column if not exists pledge_km numeric;
alter table public.challenge_participants add column if not exists pledged_at timestamptz;
alter table public.challenge_participants drop constraint if exists challenge_participants_pledge_chk;
alter table public.challenge_participants add constraint challenge_participants_pledge_chk
  check (pledge_km is null or (pledge_km > 0 and pledge_km <= 5000));

-- ---------------------------------------------------------------------
-- 2. Tính tiến độ (thay bản 000600): mục tiêu = mốc tự đăng ký; trần phần vượt
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

create or replace function private.challenge_recompute_all(p_challenge_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from public.challenge_participants where challenge_id = p_challenge_id loop
    perform private.challenge_recompute_participant(r.id);
  end loop;
end $$;

create or replace function private.challenge_is_manager(c public.challenges) returns boolean
language sql stable security definer set search_path = public as $$
  select c.created_by = auth.uid() or (c.target_club_id is not null and public.club_is_staff(c.target_club_id))
$$;

-- ---------------------------------------------------------------------
-- 3. Ban quản trị: bật mục tiêu tự đăng ký cho thử thách
-- p = { options: [21, 42, 60, 100] (không bắt buộc), min_km, max_km, cap_pct (không bắt buộc) }
-- ---------------------------------------------------------------------
create or replace function public.set_challenge_pledge(p_challenge_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
  v_opts numeric[];
  v_min numeric := nullif((p->>'min_km')::numeric, 0);
  v_max numeric := nullif((p->>'max_km')::numeric, 0);
  v_cap numeric := (p->>'cap_pct')::numeric;
begin
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if not private.challenge_is_manager(c) then raise exception 'FORBIDDEN'; end if;
  if c.status <> 'ACTIVE' or now() >= c.end_date then raise exception 'CHALLENGE_CLOSED'; end if;
  if c.objective <> 'DISTANCE' or c.format not in ('SOLO_GOAL', 'TEAM') then raise exception 'PLEDGE_NOT_SUPPORTED'; end if;
  -- Đã có người đăng ký mục tiêu và đã xuất phát → không đổi luật giữa chừng
  if now() >= c.start_date and exists (select 1 from public.challenge_participants x
                                         where x.challenge_id = c.id and x.pledge_km is not null) then
    raise exception 'PLEDGE_RULES_LOCKED';
  end if;

  v_opts := (select array_agg(v order by v) from (
               select distinct round((e)::numeric, 1) as v from jsonb_array_elements_text(coalesce(p->'options', '[]'::jsonb)) as t(e)) s);
  if v_opts is not null and (array_length(v_opts, 1) > 8 or v_opts[1] <= 0 or v_opts[array_length(v_opts, 1)] > 5000) then
    raise exception 'INVALID_PLEDGE_OPTIONS';
  end if;
  if v_opts is null and (v_min is null or v_max is null or v_min > v_max or v_max > 5000) then
    raise exception 'INVALID_PLEDGE_OPTIONS';
  end if;
  if v_cap is not null and (v_cap < 0 or v_cap > 500) then raise exception 'INVALID_PLEDGE_CAP'; end if;

  update public.challenges
     set pledge_enabled = true, pledge_options = v_opts,
         pledge_min_km = case when v_opts is null then v_min end, pledge_max_km = case when v_opts is null then v_max end,
         pledge_cap_pct = v_cap,
         game_mode = case when format = 'TEAM' then 'TEAM_SUM' else game_mode end,
         reward_split = case when format = 'SOLO_GOAL' then 'FINISHERS' else reward_split end
   where id = c.id;
  perform private.challenge_recompute_all(c.id);
  return jsonb_build_object('options', v_opts, 'min_km', v_min, 'max_km', v_max, 'cap_pct', v_cap);
end $$;

-- ---------------------------------------------------------------------
-- 4. Thành viên: đăng ký / đổi mục tiêu
--    Được đổi trước giờ xuất phát. Thử thách cá nhân vào muộn: được đăng ký một lần sau khi đã bắt đầu.
--    Đua đội: khóa khi ban quản trị đã chia đội (đổi mục tiêu sẽ làm lệch cân bằng).
-- ---------------------------------------------------------------------
create or replace function public.set_my_pledge(p_challenge_id uuid, p_km numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
  me public.challenge_participants := (select x from public.challenge_participants x
                                        where x.challenge_id = p_challenge_id and x.profile_id = v_uid);
  v_km numeric := round(coalesce(p_km, 0), 1);
begin
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if not c.pledge_enabled then raise exception 'PLEDGE_NOT_SUPPORTED'; end if;
  if me.id is null or me.status = 'LEFT' then raise exception 'NOT_JOINED'; end if;
  if c.status <> 'ACTIVE' or now() >= c.end_date then raise exception 'CHALLENGE_CLOSED'; end if;
  if c.format = 'TEAM' and (now() >= c.start_date or c.teams_assigned_at is not null) then raise exception 'PLEDGE_LOCKED'; end if;
  if c.format <> 'TEAM' and now() >= c.start_date and me.pledge_km is not null then raise exception 'PLEDGE_LOCKED'; end if;
  if c.pledge_options is not null then
    if not (v_km = any(c.pledge_options)) then raise exception 'INVALID_PLEDGE'; end if;
  elsif v_km < coalesce(c.pledge_min_km, 1) or v_km > coalesce(c.pledge_max_km, 5000) then
    raise exception 'INVALID_PLEDGE';
  end if;

  update public.challenge_participants set pledge_km = v_km, pledged_at = now(), updated_at = now() where id = me.id;
  perform private.challenge_recompute_participant(me.id);
  return jsonb_build_object('pledge_km', v_km);
end $$;

-- ---------------------------------------------------------------------
-- 5. Ban quản trị: chia đội cân bằng theo tổng km đăng ký
--    p_method: 'BALANCE' (người mục tiêu lớn xếp trước) | 'RANDOM' (thứ tự ngẫu nhiên, vẫn cân bằng)
--    Bước 1: lần lượt đưa từng người vào đội có tổng nhỏ nhất (số người mỗi đội chênh tối đa 1)
--    Bước 2: đổi chỗ từng cặp giữa đội cao nhất và thấp nhất khi làm chênh lệch giảm
-- ---------------------------------------------------------------------
create or replace function public.assign_pledge_teams(p_challenge_id uuid, p_method text default 'BALANCE',
                                                      p_include_missing boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
  v_teams uuid[];
  v_list jsonb;
  v_missing integer;
  n integer; nt integer; cap integer;
  ids uuid[] := '{}'; pl numeric[] := '{}'; tm integer[] := '{}';
  sums numeric[] := '{}'; cnt integer[] := '{}';
  i integer; j integer; t integer; best integer; k integer;
  hi integer; lo integer; diff numeric; d numeric; gain numeric; bestgain numeric; bi integer; bj integer;
  m record;
begin
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if not private.challenge_is_manager(c) then raise exception 'FORBIDDEN'; end if;
  if c.format <> 'TEAM' or not c.pledge_enabled then raise exception 'PLEDGE_NOT_SUPPORTED'; end if;
  if c.status <> 'ACTIVE' or now() >= c.start_date then raise exception 'TEAM_ROSTER_LOCKED'; end if;
  if upper(coalesce(p_method, '')) not in ('BALANCE', 'RANDOM') then raise exception 'INVALID_METHOD'; end if;

  v_missing := (select count(*) from public.challenge_participants x
                 where x.challenge_id = c.id and x.status <> 'LEFT' and x.pledge_km is null);
  if v_missing > 0 and not p_include_missing then raise exception 'PLEDGES_MISSING:%', v_missing; end if;

  v_teams := (select array_agg(t2.id order by t2.position) from public.challenge_teams t2 where t2.challenge_id = c.id);
  nt := coalesce(array_length(v_teams, 1), 0);
  if nt < 2 then raise exception 'INVALID_TEAMS'; end if;

  v_list := (select jsonb_agg(jsonb_build_array(x.id, coalesce(x.pledge_km, 0))
                              order by case when upper(p_method) = 'RANDOM' then random() else -coalesce(x.pledge_km, 0) end, x.joined_at)
               from public.challenge_participants x where x.challenge_id = c.id and x.status <> 'LEFT');
  n := coalesce(jsonb_array_length(v_list), 0);
  if n < nt then raise exception 'NOT_ENOUGH_MEMBERS'; end if;
  cap := ceil(n::numeric / nt);

  for t in 1 .. nt loop sums := sums || 0::numeric; cnt := cnt || 0; end loop;
  for i in 1 .. n loop
    ids := ids || (v_list->(i - 1)->>0)::uuid;
    pl := pl || (v_list->(i - 1)->>1)::numeric;
    best := 0;
    for t in 1 .. nt loop
      if cnt[t] < cap and (best = 0 or sums[t] < sums[best]) then best := t; end if;
    end loop;
    tm := tm || best;
    sums[best] := sums[best] + pl[i];
    cnt[best] := cnt[best] + 1;
  end loop;

  for k in 1 .. 80 loop
    hi := 1; lo := 1;
    for t in 2 .. nt loop
      if sums[t] > sums[hi] then hi := t; end if;
      if sums[t] < sums[lo] then lo := t; end if;
    end loop;
    diff := sums[hi] - sums[lo];
    exit when diff < 0.1;
    bestgain := 0; bi := 0; bj := 0;
    for i in 1 .. n loop
      if tm[i] = hi then
        for j in 1 .. n loop
          if tm[j] = lo then
            d := pl[i] - pl[j];
            if d > 0 and d < diff then
              gain := diff - abs(diff - 2 * d);
              if gain > bestgain then bestgain := gain; bi := i; bj := j; end if;
            end if;
          end if;
        end loop;
      end if;
    end loop;
    exit when bestgain <= 0.01;
    tm[bi] := lo; tm[bj] := hi;
    sums[hi] := sums[hi] - pl[bi] + pl[bj];
    sums[lo] := sums[lo] - pl[bj] + pl[bi];
  end loop;

  for i in 1 .. n loop
    update public.challenge_participants set team_id = v_teams[tm[i]], updated_at = now() where id = ids[i];
  end loop;
  update public.challenges set teams_assigned_at = now() where id = c.id;

  for m in select x.profile_id, t2.name from public.challenge_participants x join public.challenge_teams t2 on t2.id = x.team_id
            where x.challenge_id = c.id and x.status <> 'LEFT' loop
    perform private.notify(m.profile_id, c.target_club_id, 'CHALLENGE_JOINED', 'Đã chia đội: ' || c.title,
      'Bạn ở đội ' || m.name || '. Mục tiêu đã khóa — chạy thôi!', '/challenges/' || c.id, v_uid, true);
  end loop;

  return public.challenge_pledge_board(c.id);
end $$;

-- Ban quản trị xếp tay một người sang đội khác (trước giờ xuất phát)
create or replace function public.move_pledge_member(p_challenge_id uuid, p_participant_id uuid, p_team_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
begin
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if not private.challenge_is_manager(c) then raise exception 'FORBIDDEN'; end if;
  if c.format <> 'TEAM' or c.status <> 'ACTIVE' or now() >= c.start_date then raise exception 'TEAM_ROSTER_LOCKED'; end if;
  if not exists (select 1 from public.challenge_teams t2 where t2.id = p_team_id and t2.challenge_id = c.id) then raise exception 'INVALID_TEAM'; end if;
  update public.challenge_participants set team_id = p_team_id, updated_at = now()
   where id = p_participant_id and challenge_id = c.id and status <> 'LEFT';
  if not found then raise exception 'NOT_JOINED'; end if;
  update public.challenges set teams_assigned_at = coalesce(teams_assigned_at, now()) where id = c.id;
  return public.challenge_pledge_board(c.id);
end $$;

-- ---------------------------------------------------------------------
-- 6. Bảng mục tiêu: từng người (km đăng ký, đã chạy, được tính, %) + từng đội (tổng đăng ký, tổng được tính)
-- ---------------------------------------------------------------------
create or replace function public.challenge_pledge_board(p_challenge_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
begin
  if c.id is null or not public.challenge_visible(c.id) then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  return jsonb_build_object(
    'can_manage', private.challenge_is_manager(c),
    'missing', (select count(*) from public.challenge_participants x
                 where x.challenge_id = c.id and x.status <> 'LEFT' and x.pledge_km is null),
    'members', (select coalesce(jsonb_agg(jsonb_build_object(
        'participant_id', x.id, 'user_id', x.profile_id, 'display_name', pr.display_name, 'avatar_url', pr.avatar_url,
        'team_id', x.team_id, 'pledge_km', x.pledge_km, 'km', round(x.distance_m / 1000.0, 2), 'counted_km', x.current_progress,
        'pct', case when x.pledge_km > 0 then round(x.current_progress / x.pledge_km * 100, 1) end,
        'completed', x.completed_at is not null)
        order by case when x.pledge_km > 0 then x.current_progress / x.pledge_km else -1 end desc, x.current_progress desc, pr.display_name), '[]'::jsonb)
      from public.challenge_participants x join public.profiles pr on pr.id = x.profile_id
     where x.challenge_id = c.id and x.status <> 'LEFT'),
    'teams', case when c.format = 'TEAM' then (
      select coalesce(jsonb_agg(jsonb_build_object(
          'team_id', t2.id, 'name', t2.name, 'color', t2.color,
          'members', (select count(*) from public.challenge_participants x where x.team_id = t2.id and x.status <> 'LEFT'),
          'pledge_total', (select coalesce(sum(x.pledge_km), 0) from public.challenge_participants x where x.team_id = t2.id and x.status <> 'LEFT'),
          'counted_total', (select coalesce(sum(x.current_progress), 0) from public.challenge_participants x where x.team_id = t2.id and x.status <> 'LEFT'))
          order by t2.position), '[]'::jsonb)
        from public.challenge_teams t2 where t2.challenge_id = c.id) end);
end $$;

-- ---------------------------------------------------------------------
-- 7. Quyền
-- ---------------------------------------------------------------------
revoke all on function public.set_challenge_pledge(uuid, jsonb), public.set_my_pledge(uuid, numeric),
  public.assign_pledge_teams(uuid, text, boolean), public.move_pledge_member(uuid, uuid, uuid),
  public.challenge_pledge_board(uuid) from public, anon;
grant execute on function public.set_challenge_pledge(uuid, jsonb), public.set_my_pledge(uuid, numeric),
  public.assign_pledge_teams(uuid, text, boolean), public.move_pledge_member(uuid, uuid, uuid),
  public.challenge_pledge_board(uuid) to authenticated;
revoke all on function private.challenge_recompute_all(uuid), private.challenge_is_manager(public.challenges)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
