-- Trang chủ nhẹ hơn: my_game_state chỉ "bắt kịp" huy hiệu tối đa 1 lần / 10 phút cho mỗi người
-- (quét toàn bộ bài chạy). Huy hiệu từ bài chạy mới vẫn được chấm ngay khi bài được trả thưởng (game_after_run).
-- Không đổi cách tính XP, Xu, huy hiệu hay thử thách — chỉ đổi tần suất kiểm tra.
create table if not exists private.achievement_catchup (
  user_id uuid primary key references auth.users(id) on delete cascade,
  checked_at timestamptz not null default now()
);

create or replace function private.catch_up_achievements(p_uid uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  insert into private.achievement_catchup as c (user_id, checked_at) values (p_uid, now())
  on conflict (user_id) do update set checked_at = excluded.checked_at
   where c.checked_at < excluded.checked_at - interval '10 minutes';
  get diagnostics v_n = row_count;
  if v_n = 0 then return false; end if;
  perform private.evaluate_achievements(p_uid, null);
  return true;
end $$;

revoke all on function private.catch_up_achievements(uuid) from public, anon, authenticated;
revoke all on private.achievement_catchup from public, anon, authenticated;

create or replace function public.my_game_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_now timestamptz := now();
  v_today date := private.vn_day(v_now);
  v_week date := private.vn_week(v_now);
  cfg jsonb := private.game_config();
  s public.user_streaks;
  w_km numeric;
  w_runs integer;
  w_days integer;
  v_gap integer;
  v_alive boolean;
  v_daily integer := 0;
  v_prev date;
  d date;
  v_quests jsonb;
  v_league jsonb := null;
  v_group uuid;
  v_tier integer;
  v_events jsonb;
begin
  perform private.settle_leagues_due();
  perform private.catch_up_achievements(v_uid);                  -- bắt kịp huy hiệu (tối đa 1 lần / 10 phút)
  s := private.ensure_streak(v_uid);
  select ws.km, ws.runs, ws.days into w_km, w_runs, w_days from private.week_run_stats(v_uid, v_week) as ws;

  v_gap := case when s.last_week is null then null else (v_week - s.last_week) / 7 - 1 end;
  -- Còn chuỗi: tuần này đã đạt, hoặc tuần trước đạt, hoặc số tuần hụt ≤ số khiên
  v_alive := s.last_week is not null and (s.last_week = v_week or v_gap <= s.shields);

  -- Chuỗi ngày liên tiếp (hôm nay hoặc hôm qua còn chạy)
  for d in select distinct private.vn_day(a.started_at) as day from public.activities a
            where a.user_id = v_uid and a.rewarded_at is not null and a.validation_status = 'APPROVED'
              and coalesce(a.status, '') <> 'DELETED' and a.started_at > v_now - interval '400 days'
            order by 1 desc loop
    if v_prev is null then
      exit when d < v_today - 1;
    else
      exit when d <> v_prev - 1;
    end if;
    v_daily := v_daily + 1;
    v_prev := d;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id, 'code', q.code, 'period', q.period, 'metric', q.metric, 'title', q.title, 'description', q.description,
           'icon', q.icon, 'target', q.target, 'reward_xu', q.reward_xu, 'reward_xp', q.reward_xp,
           'progress', least(coalesce(p.progress, 0), q.target), 'completed', p.completed_at is not null)
           order by q.period, q.sort), '[]'::jsonb)
    from public.quests q
    left join public.user_quest_progress p on p.quest_id = q.id and p.user_id = v_uid
         and p.period_start = case q.period when 'DAILY' then v_today else v_week end
   where q.is_active
    into v_quests;

  select group_id from public.league_members where user_id = v_uid and week_start = v_week into v_group;
  v_tier := coalesce((select tier from public.user_league where user_id = v_uid), 1);
  if v_group is not null then
    with lb as (
      select lm.user_id, private.league_points(lm.user_id, v_week) as pts, lm.joined_at
        from public.league_members lm where lm.group_id = v_group),
    rk as (select user_id, pts, row_number() over (order by pts desc, joined_at) as rank from lb)
    select jsonb_build_object(
             'group_id', v_group, 'tier', v_tier, 'tier_name', private.league_name(v_tier),
             'size', (select count(*) from rk),
             'rank', (select rank from rk where user_id = v_uid),
             'points', (select pts from rk where user_id = v_uid),
             'promote', (select promote from private.league_zones((select count(*)::int from rk), v_tier)),
             'demote', (select demote from private.league_zones((select count(*)::int from rk), v_tier)),
             'ends_at', private.vn_start(v_week + 7))
      into v_league;
  end if;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at), '[]'::jsonb)
    from (select id, kind, title, subtitle, xu, xp, activity_id, payload, created_at from public.game_events
           where user_id = v_uid and seen_at is null and created_at > v_now - interval '7 days'
           order by created_at desc limit 12) e
    into v_events;

  return jsonb_build_object(
    'today', v_today, 'week_start', v_week,
    'checked_in', exists (select 1 from public.user_quest_progress p join public.quests q on q.id = p.quest_id
                           where p.user_id = v_uid and q.metric = 'CHECKIN' and p.period_start = v_today and p.progress >= 1),
    'week', jsonb_build_object('km', round(coalesce(w_km, 0), 2), 'runs', coalesce(w_runs, 0), 'days', coalesce(w_days, 0)),
    'streak', jsonb_build_object(
      'goal', s.weekly_goal, 'week_days', coalesce(w_days, 0), 'done_this_week', s.last_week = v_week,
      'current', case when v_alive then s.current_weeks else 0 end, 'best', s.best_weeks, 'alive', v_alive,
      'at_risk_weeks', greatest(coalesce(v_gap, 0), 0), 'shields', s.shields,
      'max_shields', (cfg->>'maxShields')::int, 'shield_price', (cfg->>'shieldPrice')::numeric, 'daily', v_daily),
    'quests', v_quests,
    'league', coalesce(v_league, jsonb_build_object('group_id', null, 'tier', v_tier, 'tier_name', private.league_name(v_tier))),
    'unseen', v_events);
end $$;
