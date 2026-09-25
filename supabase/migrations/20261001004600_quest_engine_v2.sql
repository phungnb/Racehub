-- 004600: Nhiệm vụ v2 — động lực xỏ giày mỗi ngày / tuần / sự kiện.
-- 1. Nhiệm vụ BẬC: "Chạy 3 / 5 / 10 km" — chỉ trả tới bậc cao nhất đạt được (không cộng dồn nhiều nhiệm vụ trùng nhau).
-- 2. Kỳ MỘT LẦN (ONCE): nhiệm vụ cho người mới / cột mốc, tính từ lúc tạo nhiệm vụ.
-- 3. Chỉ số mới: số ngày chạy trong kỳ (mọi kỳ), số bài cuối tuần, số bài chạy sớm (trước N giờ), số thử thách
--    hoàn thành, km CỘNG ĐỒNG (cả RaceHub cùng chạy tới mục tiêu; ai góp ≥ N km đều nhận thưởng).
--    Tham số: min_km (bài tính từ bao nhiêu km, mặc định 1), before_hour (chạy sớm trước mấy giờ, mặc định 7).
-- 4. Thưởng ngoài Xu: vật phẩm nhân vật, huy hiệu sự kiện (giới hạn), lượt tạo thử thách. KHÔNG có XP (XP chỉ từ km).
-- 5. Trần Xu từ nhiệm vụ: ngày 5 Xu, tuần 25 Xu (chỉnh ở Quản trị → Nhiệm vụ). Tối đa nhiệm vụ đang bật:
--    ngày 3, tuần 4, tháng 5, sự kiện 6, một lần 6 — người dùng không bị ngợp.
-- 6. Admin: số liệu gợi ý (runner hoạt động, phân bố km / ngày chạy…) và ước tính số người hoàn thành + Xu chi ra
--    trước khi đăng nhiệm vụ.
-- Cần file 004500. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 1. Bảng
-- ---------------------------------------------------------------------
alter table public.quests add column if not exists category text not null default 'RUN';
alter table public.quests add column if not exists params jsonb not null default '{}'::jsonb;
alter table public.quests add column if not exists tiers jsonb;            -- [{"target": 3, "xu": 1}, {"target": 5, "xu": 2}, …] tăng dần
alter table public.quests add column if not exists reward_item text;       -- avatar_items.code
alter table public.quests add column if not exists reward_badge jsonb;     -- {"title", "icon", "tier"}
alter table public.quests add column if not exists reward_passes jsonb;    -- {"qty", "max_slots", "days"}
alter table public.user_quest_progress add column if not exists tier_paid integer not null default 0;

alter table public.quests drop constraint if exists quests_period_check;
alter table public.quests add constraint quests_period_check check (period in ('DAILY', 'WEEKLY', 'MONTHLY', 'EVENT', 'ONCE'));
alter table public.quests drop constraint if exists quests_metric_check;
alter table public.quests add constraint quests_metric_check check (metric in ('CHECKIN', 'RUN_KM', 'CHEERS_SENT', 'WEEK_KM', 'WEEK_RUN_DAYS',
  'CHALLENGE_JOINS', 'CHEERS_RECEIVED', 'TOTAL_KM', 'RUN_COUNT', 'ACTIVE_DAYS', 'WEEKEND_RUNS', 'EARLY_RUNS', 'CHALLENGE_FINISHES', 'COMMUNITY_KM'));
alter table public.quests drop constraint if exists quests_category_check;
alter table public.quests add constraint quests_category_check check (category in ('RUN', 'CONSISTENCY', 'CHALLENGE', 'COMMUNITY', 'NEWBIE', 'SOCIAL'));

-- Giới hạn chỉnh được (lưu ở private.app_settings, key quest_limits)
create or replace function private.quest_limits() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('dailyXuCap', 5, 'weeklyXuCap', 25, 'maxDaily', 3, 'maxWeekly', 4, 'maxMonthly', 5, 'maxEvent', 6, 'maxOnce', 6)
      || coalesce((select value::jsonb from private.app_settings where key = 'quest_limits'), '{}'::jsonb)
$$;

create or replace function private.quest_period_start(p_period text, p_starts timestamptz, p_at timestamptz) returns date
language sql stable security definer set search_path = public as $$
  select case p_period when 'DAILY' then private.vn_day(p_at) when 'WEEKLY' then private.vn_week(p_at)
              when 'MONTHLY' then date_trunc('month', private.vn_day(p_at))::date
              when 'ONCE' then date '2000-01-01'
              else coalesce(private.vn_day(p_starts), date '2000-01-01') end
$$;

-- Khung thời gian tính của một nhiệm vụ trong kỳ bắt đầu p_start
create or replace function private.quest_window_from(q public.quests, p_start date) returns timestamptz
language sql stable security definer set search_path = public as $$
  select greatest(case q.period when 'ONCE' then coalesce(q.starts_at, q.created_at) when 'EVENT' then coalesce(q.starts_at, q.created_at)
                              else private.vn_start(p_start) end,
                  coalesce(q.starts_at, '-infinity'::timestamptz))
$$;
create or replace function private.quest_window_to(q public.quests, p_start date) returns timestamptz
language sql stable security definer set search_path = public as $$
  select least(case q.period when 'DAILY' then private.vn_start(p_start + 1) when 'WEEKLY' then private.vn_start(p_start + 7)
                             when 'MONTHLY' then private.vn_start((p_start + interval '1 month')::date) else 'infinity'::timestamptz end,
               coalesce(q.ends_at, 'infinity'::timestamptz))
$$;

-- ---------------------------------------------------------------------
-- 2. Giá trị chỉ số theo người trong một khung thời gian (dùng cho tiến độ, cộng đồng và ước tính)
-- ---------------------------------------------------------------------
create or replace function private.metric_values(p_metric text, p_from timestamptz, p_to timestamptz, p_params jsonb default '{}'::jsonb, p_user uuid default null)
returns table (user_id uuid, val numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_min numeric := coalesce((p_params->>'min_km')::numeric, 1); v_hour integer := coalesce((p_params->>'before_hour')::int, 7);
begin
  if p_metric in ('CHALLENGE_FINISHES', 'CHALLENGE_JOINS') then
    return query
      select cp.profile_id, count(distinct cp.challenge_id)::numeric
        from public.challenge_participants cp
       where (p_user is null or cp.profile_id = p_user) and cp.status <> 'LEFT'
         and case when p_metric = 'CHALLENGE_FINISHES' then cp.completed_at >= p_from and cp.completed_at < p_to
                  else cp.joined_at >= p_from and cp.joined_at < p_to end
       group by cp.profile_id;
    return;
  end if;
  return query
    with r as (
      select a.user_id as uid, a.started_at, greatest(coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0), 0) / 1000.0 as km
        from public.activities a
       where a.user_id is not null and (p_user is null or a.user_id = p_user)
         and a.started_at >= p_from and a.started_at < p_to
         and public.activity_is_countable(a.status, a.validation_status) and a.validation_status = 'APPROVED'
    )
    select r.uid, (case p_metric
        when 'TOTAL_KM' then sum(r.km)
        when 'WEEK_KM' then sum(r.km)
        when 'COMMUNITY_KM' then sum(r.km)
        when 'RUN_KM' then max(r.km)
        when 'RUN_COUNT' then count(*) filter (where r.km >= v_min)
        when 'ACTIVE_DAYS' then count(distinct private.vn_day(r.started_at)) filter (where r.km >= v_min)
        when 'WEEK_RUN_DAYS' then count(distinct private.vn_day(r.started_at)) filter (where r.km >= v_min)
        when 'WEEKEND_RUNS' then count(*) filter (where r.km >= v_min and extract(isodow from r.started_at at time zone 'Asia/Ho_Chi_Minh') in (6, 7))
        when 'EARLY_RUNS' then count(*) filter (where r.km >= v_min and extract(hour from r.started_at at time zone 'Asia/Ho_Chi_Minh') < v_hour)
      end)::numeric
      from r group by r.uid;
end $$;

-- ---------------------------------------------------------------------
-- 3. Trả thưởng
-- ---------------------------------------------------------------------
-- Xu thực trả sau khi áp trần ngày / tuần (tháng, sự kiện, một lần: không trần — admin xem ước tính trước khi đăng)
create or replace function private.quest_capped_xu(p_user uuid, q public.quests, p_xu numeric) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare l jsonb := private.quest_limits(); v_used numeric; v_cap numeric;
begin
  if coalesce(p_xu, 0) <= 0 or q.period not in ('DAILY', 'WEEKLY') then return greatest(coalesce(p_xu, 0), 0); end if;
  v_cap := case q.period when 'DAILY' then (l->>'dailyXuCap')::numeric else (l->>'weeklyXuCap')::numeric end;
  v_used := (select coalesce(sum(e.xu), 0) from public.game_events e
              where e.user_id = p_user and e.kind = 'QUEST' and e.payload->>'period' = q.period
                and e.created_at >= private.vn_start(case q.period when 'DAILY' then private.vn_day(now()) else private.vn_week(now()) end));
  return greatest(least(p_xu, v_cap - v_used), 0);
end $$;

-- Phần thưởng kèm (khi hoàn thành hết nhiệm vụ): vật phẩm, huy hiệu sự kiện, lượt tạo. Trả về mô tả để hiện cho người chơi.
create or replace function private.quest_extras(p_user uuid, q public.quests, p_start date) returns text[]
language plpgsql security definer set search_path = public as $$
declare v_parts text[] := '{}'; v_item_id uuid; v_item_name text; v_badge uuid; v_code text := 'QB_' || upper(substr(replace(q.id::text, '-', ''), 1, 12)); v_rows integer;
begin
  if q.reward_item is not null then
    v_item_id := (select i.id from public.avatar_items i where i.code = q.reward_item);
    v_item_name := (select i.name from public.avatar_items i where i.code = q.reward_item);
    if v_item_id is not null then
      insert into public.user_inventory (user_id, item_id, acquired_reason)
      select p_user, v_item_id, 'quest' where not exists (select 1 from public.user_inventory u where u.user_id = p_user and u.item_id = v_item_id);
      v_parts := v_parts || ('Vật phẩm: ' || v_item_name);
    end if;
  end if;
  if q.reward_badge is not null and coalesce(q.reward_badge->>'title', '') <> '' then
    insert into public.achievements (code, title, description, category, tier, icon, rule, xp_reward, xu_reward, sort, is_active)
    values (v_code, q.reward_badge->>'title', 'Huy hiệu giới hạn: ' || q.title, 'EVENT', coalesce(q.reward_badge->>'tier', 'GOLD'),
            coalesce(q.reward_badge->>'icon', 'Medal'), null, 0, 0, 900, true)
    on conflict (code) do update set title = excluded.title, icon = excluded.icon, tier = excluded.tier;
    v_badge := (select a.id from public.achievements a where a.code = v_code);
    insert into public.user_achievements (user_id, achievement_id)
    select p_user, v_badge where not exists (select 1 from public.user_achievements u where u.user_id = p_user and u.achievement_id = v_badge);
    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      perform private.notify(p_user, null, 'BADGE', 'Huy hiệu mới: ' || (q.reward_badge->>'title'), 'Hoàn thành nhiệm vụ ' || q.title, '/me?tab=badges', null, true);
    end if;
    v_parts := v_parts || ('Huy hiệu: ' || (q.reward_badge->>'title'));
  end if;
  if q.reward_passes is not null and coalesce((q.reward_passes->>'qty')::int, 0) > 0 then
    insert into public.challenge_passes (owner_type, owner_id, max_slots, total, remaining, expires_at, note, granted_by, source_key)
    values ('USER', p_user, (q.reward_passes->>'max_slots')::int, (q.reward_passes->>'qty')::int, (q.reward_passes->>'qty')::int,
            now() + make_interval(days => coalesce((q.reward_passes->>'days')::int, 30)), left('Nhiệm vụ: ' || q.title, 200), null,
            'quest:' || q.id || ':' || p_user || ':' || p_start)
    on conflict (source_key) where source_key is not null do nothing;
    v_parts := v_parts || ((q.reward_passes->>'qty') || ' lượt tạo thử thách ≤' || (q.reward_passes->>'max_slots') || ' người');
  end if;
  return v_parts;
end $$;

-- Ghi nhận tiến độ p_prog cho một người; trả thưởng khi đạt (bậc hoặc cả nhiệm vụ). Gọi lại nhiều lần vẫn an toàn.
create or replace function private.quest_finish(p_user uuid, q public.quests, p_start date, p_prog numeric, p_activity uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_paid integer; v_done timestamptz; v_n integer; v_reached integer; v_xu numeric; v_final boolean; v_rows integer;
  v_label text; v_key text; v_extras text[] := '{}';
begin
  insert into public.user_quest_progress (user_id, quest_id, period_start, progress) values (p_user, q.id, p_start, coalesce(p_prog, 0))
  on conflict do nothing;
  perform 1 from public.user_quest_progress where user_id = p_user and quest_id = q.id and period_start = p_start for update;
  v_paid := (select x.tier_paid from public.user_quest_progress x where x.user_id = p_user and x.quest_id = q.id and x.period_start = p_start);
  v_done := (select x.completed_at from public.user_quest_progress x where x.user_id = p_user and x.quest_id = q.id and x.period_start = p_start);
  if v_done is not null then return; end if;

  if q.tiers is not null and jsonb_array_length(q.tiers) > 0 then
    v_n := jsonb_array_length(q.tiers);
    v_reached := (select count(*) from jsonb_array_elements(q.tiers) t where (t->>'target')::numeric <= p_prog);
    if v_reached <= v_paid then return; end if;
    v_xu := (select coalesce(sum((t.v->>'xu')::numeric), 0) from jsonb_array_elements(q.tiers) with ordinality t(v, i) where t.i > v_paid and t.i <= v_reached);
    v_final := v_reached >= v_n;
    update public.user_quest_progress set tier_paid = v_reached, completed_at = case when v_final then now() end
     where user_id = p_user and quest_id = q.id and period_start = p_start;
    v_label := q.title || case when v_final then '' else ' — bậc ' || v_reached || '/' || v_n end;
    v_key := 'quest:' || q.id || ':' || p_user || ':' || p_start || ':t' || v_reached;
  else
    if p_prog < q.target then return; end if;
    update public.user_quest_progress set completed_at = now()
     where user_id = p_user and quest_id = q.id and period_start = p_start and completed_at is null;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then return; end if;
    v_xu := q.reward_xu; v_final := true; v_label := q.title;
    v_key := 'quest:' || q.id || ':' || p_user || ':' || p_start;
  end if;

  if v_final then v_extras := private.quest_extras(p_user, q, p_start); end if;
  perform private.award(p_user, 'QUEST', 'Nhiệm vụ: ' || v_label,
    coalesce(nullif(array_to_string(v_extras, ' · '), ''),
      case q.period when 'DAILY' then 'Nhiệm vụ ngày' when 'WEEKLY' then 'Nhiệm vụ tuần' when 'MONTHLY' then 'Nhiệm vụ tháng'
                    when 'ONCE' then 'Cột mốc' else 'Nhiệm vụ sự kiện' end),
    private.quest_capped_xu(p_user, q, v_xu), 0, v_key, p_activity,
    jsonb_build_object('quest_id', q.id, 'code', q.code, 'period', q.period, 'period_start', p_start, 'icon', q.icon,
                       'xu_full', v_xu, 'extras', to_jsonb(v_extras)));
end $$;

-- Cập nhật tiến độ theo chỉ số. p_mode: ADD / MAX / SET như cũ; COMPUTE = tự tính từ bài chạy trong khung của từng nhiệm vụ.
create or replace function private.quest_progress(
  p_user uuid, p_metric text, p_value numeric, p_mode text default 'ADD', p_at timestamptz default now(), p_activity uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  q public.quests; v_start date; v_prog numeric; v_from timestamptz; v_to timestamptz; v_total numeric; v_mine numeric; v_min numeric;
  u record; v_tier integer := private.user_vip_tier(p_user);
begin
  for q in select * from public.quests x where x.metric = p_metric and x.is_active
             and (x.starts_at is null or p_at >= x.starts_at) and (x.ends_at is null or p_at < x.ends_at)
             and (x.period <> 'ONCE' or p_at >= x.created_at) loop
    v_start := private.quest_period_start(q.period, q.starts_at, p_at);

    if q.metric = 'COMMUNITY_KM' then
      -- Cả cộng đồng cùng chạy: tiến độ = tổng km mọi người; ai góp đủ min_km đều nhận thưởng khi đạt mục tiêu
      v_from := private.quest_window_from(q, v_start); v_to := private.quest_window_to(q, v_start);
      v_min := coalesce((q.params->>'min_km')::numeric, 1);
      v_total := (select coalesce(sum(m.val), 0) from private.metric_values('TOTAL_KM', v_from, v_to, '{}'::jsonb, null) m);
      if q.min_vip_tier <= v_tier then
        insert into public.user_quest_progress (user_id, quest_id, period_start, progress) values (p_user, q.id, v_start, v_total)
        on conflict (user_id, quest_id, period_start) do update set progress = excluded.progress, updated_at = now();
      end if;
      if v_total >= q.target then
        for u in select m.user_id from private.metric_values('TOTAL_KM', v_from, v_to, '{}'::jsonb, null) m where m.val >= v_min loop
          if private.user_vip_tier(u.user_id) >= q.min_vip_tier then
            perform private.quest_finish(u.user_id, q, v_start, v_total, case when u.user_id = p_user then p_activity end);
          end if;
        end loop;
      end if;
      continue;
    end if;

    if q.min_vip_tier > v_tier then continue; end if;
    if p_mode = 'COMPUTE' then
      v_prog := coalesce((select m.val from private.metric_values(q.metric, private.quest_window_from(q, v_start), private.quest_window_to(q, v_start), q.params, p_user) m), 0);
      insert into public.user_quest_progress (user_id, quest_id, period_start, progress) values (p_user, q.id, v_start, v_prog)
      on conflict (user_id, quest_id, period_start) do update set progress = greatest(public.user_quest_progress.progress, excluded.progress), updated_at = now()
      returning progress into v_prog;
    else
      insert into public.user_quest_progress (user_id, quest_id, period_start) values (p_user, q.id, v_start) on conflict do nothing;
      update public.user_quest_progress
         set progress = case p_mode when 'ADD' then progress + p_value when 'MAX' then greatest(progress, p_value) else p_value end, updated_at = now()
       where user_id = p_user and quest_id = q.id and period_start = v_start
      returning progress into v_prog;
    end if;
    perform private.quest_finish(p_user, q, v_start, v_prog, p_activity);
  end loop;
end $$;

-- Mỗi bài chạy được trả thưởng: tính lại các chỉ số theo khung (thay cách cộng dồn cũ của TOTAL_KM / RUN_COUNT)
create or replace function private.quest_totals_on_reward() returns trigger
language plpgsql security definer set search_path = public as $$
declare m text;
begin
  if new.user_id is null or old.rewarded_at is not null or new.rewarded_at is null or new.validation_status <> 'APPROVED' then return new; end if;
  foreach m in array array['TOTAL_KM', 'RUN_COUNT', 'ACTIVE_DAYS', 'WEEKEND_RUNS', 'EARLY_RUNS', 'COMMUNITY_KM'] loop
    begin
      perform private.quest_progress(new.user_id, m, 0, 'COMPUTE', coalesce(new.started_at, now()), new.id);
    exception when others then
      raise warning 'quest_totals_on_reward % % lỗi: % %', new.id, m, sqlstate, sqlerrm;
    end;
  end loop;
  return new;
end $$;
drop trigger if exists trg_quest_totals_on_reward on public.activities;
create trigger trg_quest_totals_on_reward after update of rewarded_at on public.activities
  for each row execute function private.quest_totals_on_reward();

-- Hoàn thành thử thách → nhiệm vụ "hoàn thành N thử thách"
create or replace function private.quest_on_challenge_finish() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.profile_id is null or new.completed_at is null or old.completed_at is not null then return new; end if;
  begin
    perform private.quest_progress(new.profile_id, 'CHALLENGE_FINISHES', 0, 'COMPUTE', new.completed_at, null);
  exception when others then
    raise warning 'quest_on_challenge_finish lỗi: % %', sqlstate, sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists trg_quest_on_challenge_finish on public.challenge_participants;
create trigger trg_quest_on_challenge_finish after update of completed_at on public.challenge_participants
  for each row execute function private.quest_on_challenge_finish();

-- ---------------------------------------------------------------------
-- 4. Người chơi
-- ---------------------------------------------------------------------
create or replace function public.my_quests() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); v_tier integer := private.user_vip_tier(v_uid);
begin
  return (select coalesce(jsonb_agg(x.j order by x.o1, x.o2, x.o3), '[]'::jsonb) from (
    select jsonb_build_object(
            'id', q.id, 'code', q.code, 'period', q.period, 'metric', q.metric, 'category', q.category, 'title', q.title,
            'description', q.description, 'icon', q.icon, 'target', q.target, 'reward_xu', q.reward_xu, 'tiers', q.tiers,
            'tier_paid', coalesce(p.tier_paid, 0), 'params', q.params,
            'reward_item', (select i.name from public.avatar_items i where i.code = q.reward_item),
            'reward_badge', q.reward_badge->>'title',
            'reward_passes', q.reward_passes,
            'starts_at', q.starts_at, 'ends_at', q.ends_at, 'min_vip_tier', q.min_vip_tier, 'locked', q.min_vip_tier > v_tier,
            'progress', least(case when q.metric = 'COMMUNITY_KM'
                                   then (select coalesce(sum(m.val), 0) from private.metric_values('TOTAL_KM', private.quest_window_from(q, s.st), private.quest_window_to(q, s.st), '{}'::jsonb, null) m)
                                   else coalesce(p.progress, 0) end, q.target),
            'mine', case when q.metric = 'COMMUNITY_KM'
                         then (select coalesce(sum(m.val), 0) from private.metric_values('TOTAL_KM', private.quest_window_from(q, s.st), private.quest_window_to(q, s.st), '{}'::jsonb, v_uid) m) end,
            'completed', p.completed_at is not null) as j,
           case q.period when 'EVENT' then 0 when 'ONCE' then 1 when 'DAILY' then 2 when 'WEEKLY' then 3 else 4 end as o1, q.sort as o2, q.created_at as o3
      from public.quests q
      cross join lateral (select private.quest_period_start(q.period, q.starts_at, now()) as st) s
      left join public.user_quest_progress p on p.quest_id = q.id and p.user_id = v_uid and p.period_start = s.st
     where q.is_active and (q.starts_at is null or q.starts_at <= now()) and (q.ends_at is null or q.ends_at > now())
       -- Nhiệm vụ một lần đã xong quá 3 ngày thì ẩn cho gọn
       and not (q.period = 'ONCE' and p.completed_at is not null and p.completed_at < now() - interval '3 days')) x);
end $$;

-- Huy hiệu sự kiện (không có luật tự động) chỉ hiện khi đã nhận
create or replace function public.my_achievements()
returns table (code text, title text, description text, category text, tier text, icon text, xp_reward integer, xu_reward numeric,
               target numeric, progress numeric, unlocked_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); st jsonb := private.player_stats(v_uid);
begin
  return query
  select a.code, a.title, a.description, a.category, a.tier, a.icon, a.xp_reward, a.xu_reward,
         coalesce((a.rule->>'gte')::numeric, 1),
         case when a.rule is null then 1 else least(coalesce((st->>(a.rule->>'type'))::numeric, 0), (a.rule->>'gte')::numeric) end,
         u.unlocked_at
    from public.achievements a
    left join public.user_achievements u on u.achievement_id = a.id and u.user_id = v_uid
   where a.is_active and (a.rule is not null or (a.category = 'EVENT' and u.unlocked_at is not null))
   order by a.sort, u.unlocked_at;
end $$;

-- ---------------------------------------------------------------------
-- 5. Admin
-- ---------------------------------------------------------------------
create or replace function public.admin_list_quests() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(q) || jsonb_build_object(
            'completions', (select count(*) from public.user_quest_progress p where p.quest_id = q.id and p.completed_at is not null),
            'participants', (select count(*) from public.user_quest_progress p where p.quest_id = q.id and p.progress > 0),
            'xu_paid', coalesce((select sum(e.xu) from public.game_events e where e.kind = 'QUEST' and e.payload->>'quest_id' = q.id::text), 0))
            order by q.is_active desc, q.created_at desc), '[]'::jsonb) from public.quests q);
end $$;

create or replace function public.admin_set_quest_limits(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_admin(); v jsonb := '{}'::jsonb; k text;
begin
  foreach k in array array['dailyXuCap', 'weeklyXuCap', 'maxDaily', 'maxWeekly', 'maxMonthly', 'maxEvent', 'maxOnce'] loop
    if p ? k then
      if jsonb_typeof(p->k) <> 'number' or (p->>k)::numeric < 0 or (p->>k)::numeric > 1000 then raise exception 'INVALID_LIMIT'; end if;
      v := v || jsonb_build_object(k, (p->>k)::numeric);
    end if;
  end loop;
  insert into private.app_settings (key, value) values ('quest_limits', (private.quest_limits() || v)::text)
  on conflict (key) do update set value = excluded.value;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'QUEST_LIMITS', 'quest_limits', v);
  return private.quest_limits();
end $$;

create or replace function public.admin_save_quest(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  v_id uuid := coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid());
  v_title text := trim(coalesce(p->>'title', ''));
  v_period text := upper(coalesce(p->>'period', 'DAILY'));
  v_metric text := upper(coalesce(p->>'metric', 'TOTAL_KM'));
  v_cat text := upper(coalesce(nullif(p->>'category', ''), 'RUN'));
  v_target numeric := (p->>'target')::numeric;
  v_xu numeric := round(coalesce((p->>'reward_xu')::numeric, 0), 1);
  v_start timestamptz := nullif(p->>'starts_at', '')::timestamptz;
  v_end timestamptz := nullif(p->>'ends_at', '')::timestamptz;
  v_active boolean := coalesce((p->>'is_active')::boolean, true);
  v_tiers jsonb := case when jsonb_typeof(p->'tiers') = 'array' and jsonb_array_length(p->'tiers') > 0 then p->'tiers' end;
  v_params jsonb := case when jsonb_typeof(p->'params') = 'object' then p->'params' else '{}'::jsonb end;
  v_item text := nullif(trim(coalesce(p->>'reward_item', '')), '');
  v_badge jsonb := case when jsonb_typeof(p->'reward_badge') = 'object' and coalesce(trim(p->'reward_badge'->>'title'), '') <> '' then p->'reward_badge' end;
  v_passes jsonb := case when jsonb_typeof(p->'reward_passes') = 'object' and coalesce((p->'reward_passes'->>'qty')::int, 0) > 0 then p->'reward_passes' end;
  l jsonb := private.quest_limits();
  v_max integer; v_count integer;
begin
  if char_length(v_title) not between 2 and 80 then raise exception 'INVALID_TITLE'; end if;
  if v_period not in ('DAILY', 'WEEKLY', 'MONTHLY', 'EVENT', 'ONCE') then raise exception 'INVALID_PERIOD'; end if;
  if v_cat not in ('RUN', 'CONSISTENCY', 'CHALLENGE', 'COMMUNITY', 'NEWBIE', 'SOCIAL') then raise exception 'INVALID_CATEGORY'; end if;
  if v_metric not in ('CHECKIN', 'RUN_KM', 'TOTAL_KM', 'RUN_COUNT', 'WEEK_KM', 'WEEK_RUN_DAYS', 'CHALLENGE_JOINS',
                      'ACTIVE_DAYS', 'WEEKEND_RUNS', 'EARLY_RUNS', 'CHALLENGE_FINISHES', 'COMMUNITY_KM') then raise exception 'INVALID_METRIC'; end if;
  if v_metric in ('WEEK_KM', 'WEEK_RUN_DAYS') and v_period <> 'WEEKLY' then raise exception 'INVALID_METRIC'; end if;
  if v_metric = 'COMMUNITY_KM' and v_period not in ('WEEKLY', 'MONTHLY', 'EVENT') then raise exception 'INVALID_METRIC'; end if;
  if v_metric = 'CHECKIN' and v_period <> 'DAILY' then raise exception 'INVALID_METRIC'; end if;
  if coalesce((v_params->>'min_km')::numeric, 1) not between 0 and 100 or coalesce((v_params->>'before_hour')::int, 7) not between 1 and 23 then
    raise exception 'INVALID_PARAMS';
  end if;
  -- Bậc: tăng dần, tối đa 5; mục tiêu = bậc cuối, Xu = tổng các bậc
  if v_tiers is not null then
    if v_metric = 'COMMUNITY_KM' or jsonb_array_length(v_tiers) > 5 then raise exception 'INVALID_TIERS'; end if;
    if exists (select 1 from jsonb_array_elements(v_tiers) with ordinality t(v, i)
                where (t.v->>'target') is null or (t.v->>'target')::numeric <= 0 or coalesce((t.v->>'xu')::numeric, 0) < 0
                   or (t.i > 1 and (t.v->>'target')::numeric <= (v_tiers->((t.i - 2)::int)->>'target')::numeric)) then
      raise exception 'INVALID_TIERS';
    end if;
    v_target := (v_tiers->(jsonb_array_length(v_tiers) - 1)->>'target')::numeric;
    v_xu := (select round(sum(coalesce((t->>'xu')::numeric, 0)), 1) from jsonb_array_elements(v_tiers) t);
  end if;
  if v_target is null or v_target <= 0 or v_target > 10000000 then raise exception 'INVALID_TARGET'; end if;
  if v_xu < 0 or v_xu > 100000 then raise exception 'INVALID_AMOUNT'; end if;
  if v_item is not null and not exists (select 1 from public.avatar_items i where i.code = v_item) then raise exception 'ITEM_NOT_FOUND'; end if;
  if v_badge is not null and char_length(trim(v_badge->>'title')) not between 2 and 60 then raise exception 'INVALID_BADGE'; end if;
  if v_passes is not null and ((v_passes->>'qty')::int not between 1 and 10 or coalesce((v_passes->>'max_slots')::int, 0) not between 2 and 1000
                               or coalesce((v_passes->>'days')::int, 30) not between 1 and 365) then raise exception 'INVALID_PASSES'; end if;
  if v_period = 'EVENT' and (v_start is null or v_end is null) then raise exception 'INVALID_TIME_RANGE'; end if;
  if v_end is not null and v_start is not null and (v_end <= v_start or v_end - v_start > interval '366 days') then raise exception 'INVALID_TIME_RANGE'; end if;

  -- Giới hạn số nhiệm vụ đang bật cùng loại (người dùng không bị ngợp)
  if v_active and (v_end is null or v_end > now()) then
    v_max := (l->>(case v_period when 'DAILY' then 'maxDaily' when 'WEEKLY' then 'maxWeekly' when 'MONTHLY' then 'maxMonthly'
                                  when 'EVENT' then 'maxEvent' else 'maxOnce' end))::int;
    v_count := (select count(*) from public.quests x
                 where x.id <> v_id and x.is_active and x.period = v_period and (x.ends_at is null or x.ends_at > now())
                   and (v_period <> 'EVENT' or (x.starts_at < v_end and x.ends_at > v_start)));
    if v_count >= v_max then raise exception 'TOO_MANY_ACTIVE'; end if;
  end if;

  insert into public.quests (id, code, period, metric, target, title, description, icon, reward_xu, reward_xp, sort, is_active, starts_at, ends_at,
                             min_vip_tier, created_by, category, params, tiers, reward_item, reward_badge, reward_passes)
  values (v_id, coalesce(nullif(p->>'code', ''), 'ADM_' || upper(substr(replace(v_id::text, '-', ''), 1, 8))), v_period, v_metric, v_target, v_title,
          nullif(trim(coalesce(p->>'description', '')), ''), coalesce(nullif(p->>'icon', ''), 'Target'), v_xu, 0, coalesce((p->>'sort')::int, 100),
          v_active, v_start, v_end, least(greatest(coalesce((p->>'min_vip_tier')::int, 0), 0), 3), v_uid,
          v_cat, v_params, v_tiers, v_item, v_badge, v_passes)
  on conflict (id) do update set period = excluded.period, metric = excluded.metric, target = excluded.target, title = excluded.title,
    description = excluded.description, icon = excluded.icon, reward_xu = excluded.reward_xu, reward_xp = 0, sort = excluded.sort,
    is_active = excluded.is_active, starts_at = excluded.starts_at, ends_at = excluded.ends_at, min_vip_tier = excluded.min_vip_tier,
    category = excluded.category, params = excluded.params, tiers = excluded.tiers, reward_item = excluded.reward_item,
    reward_badge = excluded.reward_badge, reward_passes = excluded.reward_passes;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SAVE_QUEST', v_id::text, p);
  return v_id;
end $$;

-- Số liệu gợi ý: ai đang chạy, chạy bao nhiêu — để đặt mục tiêu "vừa sức" (khoảng 60% người chạy đạt được)
create or replace function public.admin_quest_insights() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  v_wk date := private.vn_week(now());
  v_mo date := date_trunc('month', private.vn_day(now()))::date;
begin
  return (
    with runs as (
      select a.user_id, a.started_at, greatest(coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0), 0) / 1000.0 as km
        from public.activities a
       where a.user_id is not null and a.started_at >= now() - interval '120 days'
         and public.activity_is_countable(a.status, a.validation_status) and a.validation_status = 'APPROVED'
    ), last_run as (select user_id, max(started_at) as at from runs group by user_id),
    wk as (
      select user_id, private.vn_week(started_at) as w, sum(km) as km, count(distinct private.vn_day(started_at)) filter (where km >= 1) as days
        from runs where started_at >= private.vn_start(v_wk - 28) and started_at < private.vn_start(v_wk) group by 1, 2
    ), mo as (
      select user_id, sum(km) as km, count(distinct private.vn_day(started_at)) filter (where km >= 1) as days
        from runs where started_at >= private.vn_start((v_mo - interval '1 month')::date) and started_at < private.vn_start(v_mo) group by 1
    ), r30 as (select * from runs where started_at >= now() - interval '30 days')
    select jsonb_build_object(
      'users_total', (select count(*) from public.profiles),
      'new_users_14d', (select count(*) from public.profiles where created_at >= now() - interval '14 days'),
      'runners_7d', (select count(distinct user_id) from runs where started_at >= now() - interval '7 days'),
      'runners_30d', (select count(distinct user_id) from r30),
      'inactive_14_60', (select count(*) from last_run where at < now() - interval '14 days' and at >= now() - interval '60 days'),
      'week_km', (select jsonb_build_object('p40', percentile_cont(0.4) within group (order by km), 'p50', percentile_cont(0.5) within group (order by km),
                          'p75', percentile_cont(0.75) within group (order by km), 'p90', percentile_cont(0.9) within group (order by km), 'n', count(*)) from wk),
      'week_days', (select jsonb_build_object('p40', percentile_cont(0.4) within group (order by days), 'p50', percentile_cont(0.5) within group (order by days),
                          'p75', percentile_cont(0.75) within group (order by days)) from wk),
      'month_km', (select jsonb_build_object('p40', percentile_cont(0.4) within group (order by km), 'p50', percentile_cont(0.5) within group (order by km),
                          'p75', percentile_cont(0.75) within group (order by km), 'n', count(*)) from mo),
      'month_days', (select jsonb_build_object('p40', percentile_cont(0.4) within group (order by days), 'p50', percentile_cont(0.5) within group (order by days)) from mo),
      'run_km', (select jsonb_build_object('p50', percentile_cont(0.5) within group (order by km), 'p75', percentile_cont(0.75) within group (order by km),
                          'p90', percentile_cont(0.9) within group (order by km)) from r30),
      'early_share', (select round(avg(case when extract(hour from started_at at time zone 'Asia/Ho_Chi_Minh') < 7 then 1.0 else 0 end), 3) from r30),
      'weekend_share', (select round(avg(case when extract(isodow from started_at at time zone 'Asia/Ho_Chi_Minh') in (6, 7) then 1.0 else 0 end), 3) from r30),
      'community_km_30d', (select round(coalesce(sum(km), 0), 1) from r30),
      'quest_xu_30d', (select coalesce(sum(xu), 0) from public.game_events where kind = 'QUEST' and created_at >= now() - interval '30 days'),
      'run_xu_30d', (select coalesce(sum(xu), 0) from public.game_events where kind = 'RUN' and created_at >= now() - interval '30 days'),
      'limits', private.quest_limits()));
end $$;

-- Ước tính trước khi đăng: dựa trên các kỳ đã qua, bao nhiêu người sẽ đạt từng bậc và tốn bao nhiêu Xu
create or replace function public.admin_quest_estimate(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  v_period text := upper(coalesce(p->>'period', 'WEEKLY'));
  v_metric text := upper(coalesce(p->>'metric', 'TOTAL_KM'));
  v_params jsonb := case when jsonb_typeof(p->'params') = 'object' then p->'params' else '{}'::jsonb end;
  v_start timestamptz := nullif(p->>'starts_at', '')::timestamptz;
  v_end timestamptz := nullif(p->>'ends_at', '')::timestamptz;
  v_tiers jsonb := case when jsonb_typeof(p->'tiers') = 'array' and jsonb_array_length(p->'tiers') > 0 then p->'tiers'
                        else jsonb_build_array(jsonb_build_object('target', (p->>'target')::numeric, 'xu', coalesce((p->>'reward_xu')::numeric, 0))) end;
  v_len interval; v_samples integer; v_runs numeric; v_windows jsonb := '[]'::jsonb; w record; v_rows jsonb := '[]'::jsonb; t record;
  v_hits numeric; v_active numeric := 0; v_total numeric; v_periods numeric; v_xu numeric := 0; v_min numeric := coalesce((v_params->>'min_km')::numeric, 1);
  v_today date := private.vn_day(now());
begin
  if v_metric = 'CHECKIN' then return jsonb_build_object('supported', false); end if;
  v_len := case v_period when 'DAILY' then interval '1 day' when 'WEEKLY' then interval '7 days' when 'MONTHLY' then interval '1 month'
                         else coalesce(v_end - v_start, interval '7 days') end;
  v_samples := case v_period when 'DAILY' then 14 when 'WEEKLY' then 4 when 'MONTHLY' then 2 else 3 end;
  -- Các khung mẫu đã qua (kết thúc trước hôm nay / tuần này / tháng này)
  for w in select g as i,
                  case v_period when 'DAILY' then private.vn_start(v_today - g) when 'WEEKLY' then private.vn_start(private.vn_week(now()) - 7 * g)
                                when 'MONTHLY' then private.vn_start((date_trunc('month', v_today) - make_interval(months => g))::date)
                                else now() - v_len * g end as f
             from generate_series(1, v_samples) g loop
    v_windows := v_windows || jsonb_build_array(jsonb_build_object('from', w.f, 'to', w.f + v_len));
  end loop;

  for t in select (x.v->>'target')::numeric as target, coalesce((x.v->>'xu')::numeric, 0) as xu, x.i from jsonb_array_elements(v_tiers) with ordinality x(v, i) loop
    v_hits := 0; v_active := 0;
    for w in select (e->>'from')::timestamptz as f, (e->>'to')::timestamptz as tt from jsonb_array_elements(v_windows) e loop
      if v_metric = 'COMMUNITY_KM' then
        v_total := (select coalesce(sum(m.val), 0) from private.metric_values('TOTAL_KM', w.f, w.tt, '{}'::jsonb, null) m);
        v_hits := v_hits + case when v_total >= t.target
                                then (select count(*) from private.metric_values('TOTAL_KM', w.f, w.tt, '{}'::jsonb, null) m where m.val >= v_min) else 0 end;
      else
        v_hits := v_hits + (select count(*) from private.metric_values(v_metric, w.f, w.tt, v_params, null) m where m.val >= t.target);
      end if;
      v_active := v_active + (select count(*) from private.metric_values('TOTAL_KM', w.f, w.tt, '{}'::jsonb, null) m where m.val > 0);
    end loop;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object('target', t.target, 'xu', t.xu,
      'completers', round(v_hits / v_samples, 1), 'rate', case when v_active > 0 then round(v_hits / v_active, 3) else 0 end));
    v_xu := v_xu + (v_hits / v_samples) * t.xu;
  end loop;
  v_runs := round(v_active / v_samples, 1);
  -- Số kỳ trong thời gian chạy nhiệm vụ (nhiệm vụ không hạn: tính cho 30 ngày)
  v_periods := case v_period
    when 'DAILY' then greatest(1, ceil(extract(epoch from coalesce(v_end, now() + interval '30 days') - coalesce(v_start, now())) / 86400))
    when 'WEEKLY' then greatest(1, ceil(extract(epoch from coalesce(v_end, now() + interval '30 days') - coalesce(v_start, now())) / 604800))
    when 'MONTHLY' then greatest(1, ceil(extract(epoch from coalesce(v_end, now() + interval '30 days') - coalesce(v_start, now())) / 2592000))
    else 1 end;
  return jsonb_build_object('supported', true, 'samples', v_samples, 'active_runners', v_runs, 'tiers', v_rows,
    'xu_per_period', round(v_xu, 1), 'periods', v_periods, 'xu_total', round(v_xu * v_periods, 1),
    'open_ended', v_end is null and v_period in ('DAILY', 'WEEKLY', 'MONTHLY'), 'limits', private.quest_limits());
end $$;

revoke all on function private.quest_limits(), private.quest_window_from(public.quests, date), private.quest_window_to(public.quests, date),
  private.metric_values(text, timestamptz, timestamptz, jsonb, uuid), private.quest_capped_xu(uuid, public.quests, numeric),
  private.quest_extras(uuid, public.quests, date), private.quest_finish(uuid, public.quests, date, numeric, uuid),
  private.quest_on_challenge_finish() from public, anon, authenticated;
revoke all on function public.admin_set_quest_limits(jsonb), public.admin_quest_insights(), public.admin_quest_estimate(jsonb) from public, anon;
grant execute on function public.admin_set_quest_limits(jsonb), public.admin_quest_insights(), public.admin_quest_estimate(jsonb) to authenticated;

notify pgrst, 'reload schema';
