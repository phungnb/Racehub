-- 002200: Đua đội theo mục tiêu — tự tạo đội theo số người đăng ký.
-- Ban quản trị chỉ đặt "số người mỗi đội"; khi bấm chia đội, máy chủ tính số đội = làm tròn(số người ÷ số người mỗi đội)
-- (ít nhất 2), tạo lại các đội rồi chia sao cho tổng km đăng ký của các đội bằng nhau.
-- Thử thách "Đồng đội" cũ (đặt tên đội sẵn, tự chọn đội) giữ nguyên. Cần chạy file 002000 trước. Chạy lại nhiều lần vẫn an toàn.

alter table public.challenges add column if not exists pledge_team_size integer;
alter table public.challenges drop constraint if exists challenges_pledge_team_size_chk;
alter table public.challenges add constraint challenges_pledge_team_size_chk
  check (pledge_team_size is null or pledge_team_size between 2 and 50);

-- Bật mục tiêu tự đăng ký: thêm team_size (chỉ đua đội)
create or replace function public.set_challenge_pledge(p_challenge_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
  v_opts numeric[];
  v_min numeric := nullif((p->>'min_km')::numeric, 0);
  v_max numeric := nullif((p->>'max_km')::numeric, 0);
  v_cap numeric := (p->>'cap_pct')::numeric;
  v_size integer := nullif((p->>'team_size')::int, 0);
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
  if v_size is not null and (c.format <> 'TEAM' or v_size < 2 or v_size > 50) then raise exception 'INVALID_TEAM_SIZE'; end if;

  update public.challenges
     set pledge_enabled = true, pledge_options = v_opts,
         pledge_min_km = case when v_opts is null then v_min end, pledge_max_km = case when v_opts is null then v_max end,
         pledge_cap_pct = v_cap, pledge_team_size = v_size,
         game_mode = case when format = 'TEAM' then 'TEAM_SUM' else game_mode end,
         reward_split = case when format = 'SOLO_GOAL' then 'FINISHERS' else reward_split end
   where id = c.id;
  perform private.challenge_recompute_all(c.id);
  return jsonb_build_object('options', v_opts, 'min_km', v_min, 'max_km', v_max, 'cap_pct', v_cap, 'team_size', v_size);
end $$;

-- Chia đội: nếu có số người mỗi đội thì tạo lại đúng số đội trước khi chia cân bằng
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

  -- Đội tự động: số đội = làm tròn (số người ÷ số người mỗi đội), ít nhất 2 → tạo lại các đội cho đúng số
  if coalesce(c.pledge_team_size, 0) > 0 then
    n := (select count(*) from public.challenge_participants x where x.challenge_id = c.id and x.status <> 'LEFT');
    nt := greatest(2, round(n::numeric / c.pledge_team_size)::int);
    if nt <> (select count(*) from public.challenge_teams t2 where t2.challenge_id = c.id) then
      update public.challenge_participants set team_id = null where challenge_id = c.id;
      delete from public.challenge_teams where challenge_id = c.id;
      insert into public.challenge_teams (challenge_id, name, color, position)
      select c.id,
             case when g <= 8 then 'Đội ' || (array['Xanh lá', 'Xanh dương', 'Hồng', 'Cam', 'Tím', 'Vàng', 'Ngọc', 'Đỏ'])[g] else 'Đội ' || g end,
             (array['#b6ff3b', '#38bdf8', '#f472b6', '#fb923c', '#a78bfa', '#facc15', '#34d399', '#f87171'])[1 + (g - 1) % 8], g
        from generate_series(1, nt) g;
    end if;
  end if;

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

notify pgrst, 'reload schema';
