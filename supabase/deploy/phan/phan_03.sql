-- RaceHub — PHẦN 03/14 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 004600, 004700, 004800
-- Supabase → SQL Editor → New query → dán TOÀN BỘ phần này → Run. Lỗi thì không có gì thay đổi; chạy lại vẫn an toàn.
-- Xong thì chạy phần tiếp theo.
begin;
-- ===================================================================
-- 20261001004600_quest_engine_v2.sql
-- ===================================================================
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

-- ===================================================================
-- 20261001004700_shine_economy.sql
-- ===================================================================
-- 004700: Ví Tỏa sáng — quà nhận được có chỗ tiêu, và người được yêu quý có dấu hiệu riêng.
-- • Tỏa sáng TÍCH LŨY = tổng giá trị quà đã nhận (danh tiếng, không bao giờ giảm) → BẬC TỎA SÁNG hiện quanh ảnh đại diện:
--   Lấp lánh ≥ 500 · Rạng rỡ ≥ 2.000 · Chói sáng ≥ 10.000 · Huyền thoại ≥ 50.000.
-- • Tỏa sáng KHẢ DỤNG = phần được tính để đổi (ví, giảm khi đổi). Chống gian lận:
--   – chỉ tính quà từ người tặng hợp lệ (tài khoản ≥ 14 ngày và ≥ 3 bài chạy hợp lệ);
--   – mỗi người tặng góp tối đa 300 Tỏa sáng khả dụng cho một người nhận mỗi tuần;
--   – đổi lượt tạo thử thách cần Tỏa sáng từ ≥ 5 người khác nhau trong 30 ngày;
--   – giá đổi ≈ 30–35% giá trị Xu → nuôi tài khoản ảo để đổi luôn lỗ.
-- • Cửa hàng Tỏa sáng: lượt tạo thử thách ≤ 20 / ≤ 50 người, khiên giữ chuỗi, vật phẩm nhân vật CHỈ đổi bằng Tỏa sáng.
-- • Lời cảm ơn miễn phí gửi người đã tặng mình (5 lần / ngày). Huy hiệu theo số người tặng khác nhau (5 / 20 / 50).
-- • Tường quà: bộ sưu tập theo độ hiếm, ẩn / hiện công khai. Thử thách: "Được tiếp sức nhiều nhất".
-- Cần file 004600. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 1. Cấu hình + bảng
-- ---------------------------------------------------------------------
create or replace function private.shine_config() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('tiers', jsonb_build_array(500, 2000, 10000, 50000), 'perSenderWeeklyCap', 300,
                            'minSenderAgeDays', 14, 'minSenderRuns', 3, 'thanksPerDay', 5)
      || coalesce((select value::jsonb from private.app_settings where key = 'shine_config'), '{}'::jsonb)
$$;

create or replace function private.shine_tier(p_total numeric) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from jsonb_array_elements(private.shine_config()->'tiers') t where coalesce(p_total, 0) >= t::text::numeric
$$;

alter table public.profiles add column if not exists shine_total numeric(14, 1) not null default 0;
alter table public.profiles add column if not exists gift_wall_public boolean not null default true;
grant update (gift_wall_public) on public.profiles to authenticated;

create table if not exists public.shine_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  from_user uuid references public.profiles(id) on delete set null,
  cheer_id uuid unique,
  gift_amount numeric(14, 1) not null,
  countable numeric(14, 1) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists shine_entries_user_idx on public.shine_entries (user_id, created_at desc);
create index if not exists shine_entries_pair_idx on public.shine_entries (user_id, from_user, created_at);

create table if not exists public.shine_shop (
  code text primary key check (code ~ '^[A-Z0-9_]{2,32}$'),
  name text not null check (char_length(name) between 2 and 80),
  description text,
  kind text not null check (kind in ('PASS', 'SHIELD', 'COSMETIC')),
  cost integer not null check (cost between 1 and 10000000),
  period_limit integer check (period_limit is null or period_limit > 0),
  limit_period text not null default 'MONTH' check (limit_period in ('WEEK', 'MONTH')),
  min_senders integer not null default 0 check (min_senders >= 0),
  params jsonb not null default '{}'::jsonb,   -- PASS: {max_slots, days}; COSMETIC: {item_code}; mọi loại: xu_value (để admin so sánh)
  is_active boolean not null default true,
  sort integer not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists public.shine_spends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_code text not null references public.shine_shop(code),
  cost integer not null,
  ref text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists shine_spends_user_idx on public.shine_spends (user_id, created_at desc);

create table if not exists public.shine_thanks (
  from_user uuid not null references public.profiles(id) on delete cascade,
  to_user uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  created_at timestamptz not null default now(),
  primary key (from_user, to_user, day)
);

alter table public.shine_entries enable row level security;
alter table public.shine_shop enable row level security;
alter table public.shine_spends enable row level security;
alter table public.shine_thanks enable row level security;
revoke all on public.shine_entries, public.shine_shop, public.shine_spends, public.shine_thanks from anon, authenticated;

insert into public.shine_shop (code, name, description, kind, cost, period_limit, limit_period, min_senders, params, sort) values
  ('PASS_20', 'Lượt tạo thử thách ≤ 20 người', 'Tạo một thử thách miễn phí cho tối đa 20 người, dùng trong 30 ngày', 'PASS', 500, 2, 'MONTH', 5,
   '{"max_slots": 20, "days": 30, "xu_value": 150}', 1),
  ('PASS_50', 'Lượt tạo thử thách ≤ 50 người', 'Tạo một thử thách miễn phí cho tối đa 50 người, dùng trong 30 ngày', 'PASS', 1400, 1, 'MONTH', 5,
   '{"max_slots": 50, "days": 30, "xu_value": 400}', 2),
  ('SHIELD', 'Khiên giữ chuỗi', 'Giữ chuỗi tuần khi lỡ một tuần', 'SHIELD', 700, 1, 'MONTH', 0, '{"xu_value": 200}', 3)
on conflict (code) do nothing;

-- Vật phẩm nhân vật chỉ đổi bằng Tỏa sáng: không mua bằng Xu được
create or replace function public.buy_avatar_item(p_code text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  i public.avatar_items := (select x from public.avatar_items x where x.code = p_code and x.is_active);
  v_level integer;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if exists (select 1 from public.ledger_transactions where idempotency_key = 'shop:' || p_idempotency_key) then
    return jsonb_build_object('duplicate', true, 'balance', private.balance(v_uid));
  end if;
  if i.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if coalesce(i.metadata->>'acquire', '') = 'shine' then raise exception 'SHINE_ONLY'; end if;
  if exists (select 1 from public.user_inventory where user_id = v_uid and item_id = i.id) then raise exception 'ALREADY_OWNED'; end if;
  v_level := coalesce((select level from public.profiles where id = v_uid), 1);
  if v_level < i.unlock_level then raise exception 'LEVEL_TOO_LOW'; end if;
  if i.price_xu > 0 then
    if private.balance(v_uid) < i.price_xu then raise exception 'INSUFFICIENT_BALANCE'; end if;
    perform private.ledger_post('SHOP_ITEM', 'shop:' || p_idempotency_key, 'Mua ' || i.name, v_uid,
      private.debit_entries(v_uid, i.price_xu, private.system_account()));
  end if;
  insert into public.user_inventory (user_id, item_id, acquired_reason)
  values (v_uid, i.id, case when i.price_xu > 0 then 'PURCHASE' else 'FREE' end)
  on conflict (user_id, item_id) do nothing;
  return jsonb_build_object('code', i.code, 'balance', private.balance(v_uid));
end $$;

create or replace function private.item_json(i public.avatar_items) returns jsonb
language sql immutable as $$
  select jsonb_build_object('code', i.code, 'name', i.name, 'description', i.description, 'slot', i.category, 'rarity', i.rarity,
    'render_kind', i.render_kind, 'layer_urls', i.layer_urls, 'color', i.color, 'price_xu', i.price_xu,
    'unlock_level', i.unlock_level, 'is_default', i.is_default, 'acquire', coalesce(i.metadata->>'acquire', 'xu'))
$$;

-- Huy hiệu theo số người tặng khác nhau
insert into public.achievements (code, title, description, category, tier, icon, rule, xp_reward, xu_reward, sort) values
  ('FANS_5', 'Được quý mến', 'Nhận quà từ 5 runner khác nhau', 'SOCIAL', 'BRONZE', 'HandHeart', '{"type":"GIFT_FANS","gte":5}', 0, 0, 60),
  ('FANS_20', 'Ngôi sao cộng đồng', 'Nhận quà từ 20 runner khác nhau', 'SOCIAL', 'SILVER', 'Star', '{"type":"GIFT_FANS","gte":20}', 0, 0, 61),
  ('FANS_50', 'Người truyền lửa', 'Nhận quà từ 50 runner khác nhau', 'SOCIAL', 'GOLD', 'Flame', '{"type":"GIFT_FANS","gte":50}', 0, 0, 62)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 2. Ghi nhận khi có quà
-- ---------------------------------------------------------------------
create or replace function private.shine_sender_ok(p_from uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.created_at <= now() - make_interval(days => (private.shine_config()->>'minSenderAgeDays')::int)
                     from public.profiles p where p.id = p_from), false)
     and (select count(*) from public.activities a where a.user_id = p_from and a.validation_status = 'APPROVED'
             and public.activity_is_countable(a.status, a.validation_status)) >= (private.shine_config()->>'minSenderRuns')::int
$$;

create or replace function private.shine_fans(p_user uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(distinct e.from_user)::int from public.shine_entries e where e.user_id = p_user and e.countable > 0
$$;

create or replace function private.shine_on_gift() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_used numeric; v_cap numeric := (private.shine_config()->>'perSenderWeeklyCap')::numeric; v_count numeric := 0;
  v_old numeric; v_new numeric; v_fans integer; a record; v_names text[] := array['', 'Lấp lánh', 'Rạng rỡ', 'Chói sáng', 'Huyền thoại'];
begin
  if new.gift_code is null or new.to_user is null or new.from_user is null or new.from_user = new.to_user then return new; end if;
  begin
    if private.shine_sender_ok(new.from_user) then
      v_used := (select coalesce(sum(e.countable), 0) from public.shine_entries e
                  where e.user_id = new.to_user and e.from_user = new.from_user and e.created_at >= private.vn_start(private.vn_week(now())));
      v_count := greatest(least(new.amount, v_cap - v_used), 0);
    end if;
    insert into public.shine_entries (user_id, from_user, cheer_id, gift_amount, countable, created_at)
    values (new.to_user, new.from_user, new.id, new.amount, v_count, coalesce(new.created_at, now()))
    on conflict (cheer_id) do nothing;

    v_old := (select shine_total from public.profiles where id = new.to_user);
    update public.profiles set shine_total = shine_total + new.amount where id = new.to_user returning shine_total into v_new;
    if private.shine_tier(v_new) > private.shine_tier(v_old) then
      perform private.notify(new.to_user, null, 'SHINE', 'Bạn đã đạt Tỏa sáng ' || v_names[private.shine_tier(v_new) + 1] || ' ✨',
        'Ảnh đại diện của bạn có khung mới. Cảm ơn cộng đồng đã tiếp sức!', '/me/shine', null, true);
    end if;

    -- Huy hiệu người hâm mộ (đếm người tặng hợp lệ khác nhau)
    v_fans := private.shine_fans(new.to_user);
    for a in select x.* from public.achievements x
              where x.is_active and x.rule->>'type' = 'GIFT_FANS' and (x.rule->>'gte')::int <= v_fans
                and not exists (select 1 from public.user_achievements u where u.user_id = new.to_user and u.achievement_id = x.id) loop
      insert into public.user_achievements (user_id, achievement_id) values (new.to_user, a.id) on conflict do nothing;
      perform private.award(new.to_user, 'BADGE', 'Huy hiệu: ' || a.title, a.description, 0, 0, 'badge:' || a.code || ':' || new.to_user, null,
        jsonb_build_object('code', a.code, 'tier', a.tier, 'icon', a.icon));
      perform private.notify(new.to_user, null, 'BADGE', 'Huy hiệu mới: ' || a.title, a.description, '/me?tab=badges', null, true);
    end loop;
  exception when others then
    raise warning 'shine_on_gift % lỗi: % %', new.id, sqlstate, sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists trg_shine_on_gift on public.cheers;
create trigger trg_shine_on_gift after insert on public.cheers for each row execute function private.shine_on_gift();

-- Dữ liệu cũ: tính lại Tỏa sáng tích lũy và phần khả dụng của các quà đã tặng trước đây (áp đúng trần tuần)
insert into public.shine_entries (user_id, from_user, cheer_id, gift_amount, countable, created_at)
select t.to_user, t.from_user, t.id, t.amount,
       case when t.ok then greatest(least(t.amount, 300 - (t.cum - t.amount)), 0) else 0 end, t.created_at
  from (select c.id, c.to_user, c.from_user, c.amount, c.created_at, private.shine_sender_ok(c.from_user) as ok,
               sum(c.amount) over (partition by c.to_user, c.from_user, private.vn_week(c.created_at) order by c.created_at, c.id) as cum
          from public.cheers c
         where c.gift_code is not null and c.to_user is not null and c.from_user is not null and c.from_user <> c.to_user) t
on conflict (cheer_id) do nothing;
update public.profiles p set shine_total = s.total
  from (select c.to_user, sum(c.amount) as total from public.cheers c where c.gift_code is not null group by c.to_user) s
 where s.to_user = p.id and p.shine_total is distinct from s.total;

-- ---------------------------------------------------------------------
-- 3. Người dùng
-- ---------------------------------------------------------------------
create or replace function private.shine_available(p_user uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(countable) from public.shine_entries where user_id = p_user), 0)
       - coalesce((select sum(cost) from public.shine_spends where user_id = p_user), 0)
$$;

create or replace function public.my_shine() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_total numeric := (select shine_total from public.profiles where id = v_uid);
  v_avail numeric := private.shine_available(v_uid);
  v_senders integer := (select count(distinct from_user) from public.shine_entries where user_id = v_uid and countable > 0 and created_at >= now() - interval '30 days');
  cfg jsonb := private.shine_config();
begin
  return jsonb_build_object(
    'total', v_total, 'available', v_avail, 'tier', private.shine_tier(v_total), 'tiers', cfg->'tiers',
    'fans', private.shine_fans(v_uid), 'senders_30d', v_senders, 'per_sender_weekly_cap', cfg->'perSenderWeeklyCap',
    'shop', (select coalesce(jsonb_agg(jsonb_build_object(
               'code', s.code, 'name', s.name, 'description', s.description, 'kind', s.kind, 'cost', s.cost,
               'period_limit', s.period_limit, 'limit_period', s.limit_period, 'min_senders', s.min_senders, 'params', s.params,
               'item', case when s.kind = 'COSMETIC' then (select private.item_json(i) || jsonb_build_object('owned', exists (select 1 from public.user_inventory u where u.user_id = v_uid and u.item_id = i.id))
                                                             from public.avatar_items i where i.code = s.params->>'item_code') end,
               'used', (select count(*) from public.shine_spends x where x.user_id = v_uid and x.item_code = s.code
                          and x.created_at >= private.vn_start(case s.limit_period when 'WEEK' then private.vn_week(now()) else date_trunc('month', private.vn_day(now()))::date end)))
               order by s.sort, s.cost), '[]'::jsonb) from public.shine_shop s where s.is_active),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('code', x.item_code, 'name', s.name, 'cost', x.cost, 'at', x.created_at) order by x.created_at desc), '[]'::jsonb)
                  from (select * , row_number() over (order by created_at desc) rn from public.shine_spends where user_id = v_uid) x
                  join public.shine_shop s on s.code = x.item_code where x.rn <= 20),
    'supporters', (select coalesce(jsonb_agg(jsonb_build_object('user_id', t.from_user, 'display_name', private.display_name(t.from_user),
                     'avatar_url', (select p.avatar_url from public.profiles p where p.id = t.from_user), 'amount', t.s, 'last_at', t.last_at,
                     'thanked_today', exists (select 1 from public.shine_thanks k where k.from_user = v_uid and k.to_user = t.from_user and k.day = private.vn_day(now())))
                     order by t.last_at desc), '[]'::jsonb)
                     from (select e.from_user, sum(e.gift_amount) as s, max(e.created_at) as last_at, row_number() over (order by max(e.created_at) desc) as rn
                             from public.shine_entries e where e.user_id = v_uid and e.from_user is not null and e.created_at >= now() - interval '30 days'
                            group by e.from_user) t where t.rn <= 20),
    'thanks_left', greatest((cfg->>'thanksPerDay')::int - (select count(*) from public.shine_thanks k where k.from_user = v_uid and k.day = private.vn_day(now())), 0));
end $$;

create or replace function public.redeem_shine(p_code text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  s public.shine_shop := (select x from public.shine_shop x where x.code = upper(coalesce(p_code, '')) and x.is_active);
  v_used integer; v_senders integer; v_item uuid; st public.user_streaks; v_spend uuid; v_max integer;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if exists (select 1 from public.shine_spends where ref = 'shine:' || p_idempotency_key) then
    return jsonb_build_object('duplicate', true, 'available', private.shine_available(v_uid));
  end if;
  if s.code is null then raise exception 'SHINE_ITEM_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended('shine:' || v_uid, 0));
  if private.shine_available(v_uid) < s.cost then raise exception 'INSUFFICIENT_SHINE'; end if;
  if s.period_limit is not null then
    v_used := (select count(*) from public.shine_spends x where x.user_id = v_uid and x.item_code = s.code
                 and x.created_at >= private.vn_start(case s.limit_period when 'WEEK' then private.vn_week(now()) else date_trunc('month', private.vn_day(now()))::date end));
    if v_used >= s.period_limit then raise exception 'SHINE_LIMIT'; end if;
  end if;
  if s.min_senders > 0 then
    v_senders := (select count(distinct from_user) from public.shine_entries where user_id = v_uid and countable > 0 and created_at >= now() - interval '30 days');
    if v_senders < s.min_senders then raise exception 'SHINE_NEED_SENDERS'; end if;
  end if;

  insert into public.shine_spends (user_id, item_code, cost, ref) values (v_uid, s.code, s.cost, 'shine:' || p_idempotency_key) returning id into v_spend;
  if s.kind = 'PASS' then
    insert into public.challenge_passes (owner_type, owner_id, max_slots, total, remaining, expires_at, note, granted_by, source_key)
    values ('USER', v_uid, coalesce((s.params->>'max_slots')::int, 20), 1, 1, now() + make_interval(days => coalesce((s.params->>'days')::int, 30)),
            'Đổi từ Tỏa sáng', null, 'shine:' || v_spend);
  elsif s.kind = 'SHIELD' then
    perform private.ensure_streak(v_uid);
    st := (select x from public.user_streaks x where x.user_id = v_uid);
    v_max := (private.game_config()->>'maxShields')::int;
    if st.shields >= v_max then raise exception 'SHIELD_LIMIT'; end if;
    update public.user_streaks set shields = shields + 1, updated_at = now() where user_id = v_uid;
  else
    v_item := (select i.id from public.avatar_items i where i.code = s.params->>'item_code');
    if v_item is null then raise exception 'ITEM_NOT_FOUND'; end if;
    if exists (select 1 from public.user_inventory where user_id = v_uid and item_id = v_item) then raise exception 'ALREADY_OWNED'; end if;
    insert into public.user_inventory (user_id, item_id, acquired_reason) values (v_uid, v_item, 'SHINE');
  end if;
  return jsonb_build_object('code', s.code, 'name', s.name, 'cost', s.cost, 'available', private.shine_available(v_uid));
end $$;

-- Lời cảm ơn miễn phí tới người đã tặng mình trong 30 ngày (không có giá trị kinh tế)
create or replace function public.send_thanks(p_to_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); v_day date := private.vn_day(now()); v_left integer;
begin
  if p_to_user is null or p_to_user = v_uid then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.cheers c where c.to_user = v_uid and c.from_user = p_to_user and c.gift_code is not null
                   and c.created_at >= now() - interval '30 days') then raise exception 'NOT_A_SUPPORTER'; end if;
  v_left := (private.shine_config()->>'thanksPerDay')::int - (select count(*) from public.shine_thanks where from_user = v_uid and day = v_day);
  if v_left <= 0 then raise exception 'THANKS_LIMIT'; end if;
  insert into public.shine_thanks (from_user, to_user, day) values (v_uid, p_to_user, v_day) on conflict do nothing;
  if not found then raise exception 'ALREADY_THANKED'; end if;
  perform private.notify(p_to_user, null, 'THANKS', private.display_name(v_uid) || ' cảm ơn bạn đã tiếp sức 💛',
    'Món quà của bạn đã tiếp thêm năng lượng cho buổi chạy.', '/me/shine', v_uid, false);
  return jsonb_build_object('thanks_left', v_left - 1);
end $$;

-- Tường quà: thêm bậc, số người hâm mộ, bộ sưu tập theo độ hiếm; chủ hồ sơ có thể ẩn chi tiết
create or replace function public.gift_wall(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_total numeric := coalesce((select shine_total from public.profiles where id = p_user), 0);
  v_public boolean := coalesce((select gift_wall_public from public.profiles where id = p_user), true);
  v_me boolean := p_user = auth.uid();
begin
  if not v_public and not v_me then
    return jsonb_build_object('hidden', true, 'shine', v_total, 'tier', private.shine_tier(v_total), 'count', 0, 'gifts', '[]'::jsonb, 'top_supporters', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'hidden', false, 'public', v_public,
    'shine', v_total, 'tier', private.shine_tier(v_total), 'fans', private.shine_fans(p_user),
    'count', coalesce((select sum(c.qty) from public.cheers c where c.to_user = p_user and c.gift_code is not null), 0),
    'gifts', (select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'name', t.name, 'emoji', t.emoji, 'tier', t.tier, 'count', t.n)
                                         order by t.price desc), '[]'::jsonb)
                from (select g.code, g.name, g.emoji, g.tier, g.price_xu as price, sum(c.qty) as n
                        from public.cheers c join public.gift_catalog g on g.code = c.gift_code
                       where c.to_user = p_user group by g.code, g.name, g.emoji, g.tier, g.price_xu) t),
    -- Bộ sưu tập: đã nhận bao nhiêu loại / tổng số loại theo từng tầng
    'collection', (select coalesce(jsonb_agg(jsonb_build_object('tier', x.tier, 'owned', x.owned, 'total', x.total) order by x.o), '[]'::jsonb)
                     from (select g.tier, count(*) as total,
                                  count(*) filter (where exists (select 1 from public.cheers c where c.to_user = p_user and c.gift_code = g.code)) as owned,
                                  min(g.price_xu) as o
                             from public.gift_catalog g where g.is_active or exists (select 1 from public.cheers c where c.to_user = p_user and c.gift_code = g.code)
                            group by g.tier) x),
    'top_supporters', (select coalesce(jsonb_agg(jsonb_build_object('user_id', t.from_user, 'display_name', private.display_name(t.from_user),
                                                  'avatar_url', (select p.avatar_url from public.profiles p where p.id = t.from_user), 'shine', t.s)
                                                  order by t.s desc), '[]'::jsonb)
                         from (select c.from_user, sum(c.amount) as s, row_number() over (order by sum(c.amount) desc) as rn
                                 from public.cheers c where c.to_user = p_user and c.gift_code is not null group by c.from_user) t
                        where t.rn <= 5));
end $$;

-- Thử thách: 3 người được tiếp sức nhiều nhất trong thời gian thử thách
create or replace function public.challenge_top_supported(p_challenge_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_from timestamptz := (select ch.start_date from public.challenges ch where ch.id = p_challenge_id);
  v_to timestamptz := (select ch.end_date from public.challenges ch where ch.id = p_challenge_id);
begin
  if not exists (select 1 from public.challenges ch where ch.id = p_challenge_id) then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('user_id', t.to_user, 'display_name', private.display_name(t.to_user),
            'avatar_url', (select p.avatar_url from public.profiles p where p.id = t.to_user), 'shine', t.s, 'gifts', t.n,
            'tier', private.shine_tier((select p.shine_total from public.profiles p where p.id = t.to_user))) order by t.s desc), '[]'::jsonb)
            from (select cp.profile_id as to_user, sum(ch.amount) as s, sum(ch.qty) as n, row_number() over (order by sum(ch.amount) desc) as rn
                    from public.challenge_participants cp
                    join public.cheers ch on ch.to_user = cp.profile_id and ch.gift_code is not null
                                         and ch.created_at >= coalesce(v_from, '-infinity'::timestamptz)
                                         and ch.created_at < coalesce(v_to, 'infinity'::timestamptz)
                   where cp.challenge_id = p_challenge_id and cp.status <> 'LEFT'
                   group by cp.profile_id) t
           where t.rn <= 3);
end $$;

-- Tiến độ huy hiệu người hâm mộ trong danh sách huy hiệu
create or replace function public.my_achievements()
returns table (code text, title text, description text, category text, tier text, icon text, xp_reward integer, xu_reward numeric,
               target numeric, progress numeric, unlocked_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); st jsonb := private.player_stats(v_uid) || jsonb_build_object('GIFT_FANS', private.shine_fans(v_uid));
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
-- 4. Admin
-- ---------------------------------------------------------------------
create or replace function public.admin_shine_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_admin();
begin
  return jsonb_build_object(
    'config', private.shine_config(),
    'items', (select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object(
                'redeemed_30d', (select count(*) from public.shine_spends x where x.item_code = s.code and x.created_at >= now() - interval '30 days'),
                'item_name', (select i.name from public.avatar_items i where i.code = s.params->>'item_code')) order by s.sort, s.cost), '[]'::jsonb)
                from public.shine_shop s),
    'gifted_30d', (select coalesce(sum(gift_amount), 0) from public.shine_entries where created_at >= now() - interval '30 days'),
    'countable_30d', (select coalesce(sum(countable), 0) from public.shine_entries where created_at >= now() - interval '30 days'),
    'spent_30d', (select coalesce(sum(cost), 0) from public.shine_spends where created_at >= now() - interval '30 days'),
    'xu_equiv_30d', (select coalesce(sum(coalesce((s.params->>'xu_value')::numeric, 0)), 0) from public.shine_spends x join public.shine_shop s on s.code = x.item_code
                      where x.created_at >= now() - interval '30 days'),
    'tiers_count', (select jsonb_agg(jsonb_build_object('tier', t.tier, 'users', t.n) order by t.tier)
                      from (select private.shine_tier(shine_total) as tier, count(*) as n from public.profiles where shine_total > 0 group by 1) t));
end $$;

create or replace function public.admin_save_shine_item(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  v_code text := upper(trim(coalesce(p->>'code', '')));
  v_kind text := upper(coalesce(p->>'kind', ''));
  v_params jsonb := case when jsonb_typeof(p->'params') = 'object' then p->'params' else '{}'::jsonb end;
begin
  if v_code !~ '^[A-Z0-9_]{2,32}$' then raise exception 'INVALID_CODE'; end if;
  if v_kind not in ('PASS', 'SHIELD', 'COSMETIC') then raise exception 'INVALID_KIND'; end if;
  if char_length(trim(coalesce(p->>'name', ''))) not between 2 and 80 then raise exception 'INVALID_TITLE'; end if;
  if coalesce((p->>'cost')::int, 0) not between 1 and 10000000 then raise exception 'INVALID_AMOUNT'; end if;
  if v_kind = 'PASS' and coalesce((v_params->>'max_slots')::int, 0) not between 2 and 1000 then raise exception 'INVALID_PASSES'; end if;
  if v_kind = 'COSMETIC' then
    if not exists (select 1 from public.avatar_items i where i.code = v_params->>'item_code') then raise exception 'ITEM_NOT_FOUND'; end if;
    -- Vật phẩm đã vào cửa hàng Tỏa sáng thì không bán bằng Xu nữa
    update public.avatar_items set metadata = coalesce(metadata, '{}'::jsonb) || '{"acquire": "shine"}' where code = v_params->>'item_code';
  end if;
  insert into public.shine_shop (code, name, description, kind, cost, period_limit, limit_period, min_senders, params, is_active, sort)
  values (v_code, trim(p->>'name'), nullif(trim(coalesce(p->>'description', '')), ''), v_kind, (p->>'cost')::int,
          nullif((p->>'period_limit')::int, 0), coalesce(nullif(upper(p->>'limit_period'), ''), 'MONTH'), greatest(coalesce((p->>'min_senders')::int, 0), 0),
          v_params, coalesce((p->>'is_active')::boolean, true), coalesce((p->>'sort')::int, 100))
  on conflict (code) do update set name = excluded.name, description = excluded.description, kind = excluded.kind, cost = excluded.cost,
    period_limit = excluded.period_limit, limit_period = excluded.limit_period, min_senders = excluded.min_senders, params = excluded.params,
    is_active = excluded.is_active, sort = excluded.sort;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SAVE_SHINE_ITEM', v_code, p);
  return v_code;
end $$;

create or replace function public.admin_set_shine_config(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_admin(); v jsonb := '{}'::jsonb; k text;
begin
  foreach k in array array['perSenderWeeklyCap', 'minSenderAgeDays', 'minSenderRuns', 'thanksPerDay'] loop
    if p ? k then
      if jsonb_typeof(p->k) <> 'number' or (p->>k)::numeric < 0 or (p->>k)::numeric > 1000000 then raise exception 'INVALID_LIMIT'; end if;
      v := v || jsonb_build_object(k, (p->>k)::numeric);
    end if;
  end loop;
  if p ? 'tiers' then
    if jsonb_typeof(p->'tiers') <> 'array' or jsonb_array_length(p->'tiers') <> 4
       or exists (select 1 from jsonb_array_elements(p->'tiers') with ordinality t(v, i)
                   where jsonb_typeof(t.v) <> 'number' or t.v::text::numeric <= 0
                      or (t.i > 1 and t.v::text::numeric <= (p->'tiers'->((t.i - 2)::int))::text::numeric)) then raise exception 'INVALID_LIMIT'; end if;
    v := v || jsonb_build_object('tiers', p->'tiers');
  end if;
  insert into private.app_settings (key, value) values ('shine_config', (private.shine_config() || v)::text)
  on conflict (key) do update set value = excluded.value;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SHINE_CONFIG', 'shine_config', v);
  return private.shine_config();
end $$;

revoke all on function private.shine_config(), private.shine_tier(numeric), private.shine_sender_ok(uuid), private.shine_fans(uuid),
  private.shine_available(uuid), private.shine_on_gift() from public, anon, authenticated;
revoke all on function public.my_shine(), public.redeem_shine(text, text), public.send_thanks(uuid), public.challenge_top_supported(uuid),
  public.admin_shine_overview(), public.admin_save_shine_item(jsonb), public.admin_set_shine_config(jsonb) from public, anon;
grant execute on function public.my_shine(), public.redeem_shine(text, text), public.send_thanks(uuid), public.challenge_top_supported(uuid),
  public.admin_shine_overview(), public.admin_save_shine_item(jsonb), public.admin_set_shine_config(jsonb) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001004800_design_layers.sql
-- ===================================================================
-- 004800: Thiết kế BIB bản 2 + Giấy chứng nhận do BTC thiết kế.
-- • Mọi thứ trên BIB / chứng nhận là LỚP kéo thả: chữ (gắn trường dữ liệu hoặc chữ tự nhập, 40 font tiếng Việt, hiệu ứng
--   viền / bóng / phát sáng / bôi dạ quang / nền khối / băng chéo…), ảnh (logo, nhà tài trợ, chữ ký), mã QR (xác thực VĐV,
--   trang giải, đơn vị tổ chức, phí tham gia, đường link, ảnh QR tải lên), hình trang trí (khối, đường kẻ, nguyệt quế, con dấu).
-- • virtual_races.cert_design + set_race_cert_design: mẫu chứng nhận (khổ dọc 4:5 / ngang A4).
-- • race_design_assets: BTC lấy sẵn QR nhận tiền / tài khoản ngân hàng đã lưu của CLB để in "QR phí tham gia".
-- • Ảnh hợp lệ: kho race-media của giải, hoặc ảnh trong thư mục club-media của CLB tổ chức (QR ngân hàng đã lưu).
-- Cần 002900 → 003200. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

alter table public.virtual_races add column if not exists cert_design jsonb;

-- ---------------------------------------------------------------------
-- 1. Hàm làm sạch dùng chung
-- ---------------------------------------------------------------------
create or replace function private.design_src_ok(r public.virtual_races, p_url text) returns boolean
language sql stable as $$
  select p_url is null
      or private.race_media_ok(r.id, p_url)
      or (r.club_id is not null and char_length(p_url) <= 500 and p_url ~ '^https://'
          and position('/storage/v1/object/public/club-media/' || r.club_id::text || '/' in p_url) > 0)
$$;

-- Màu: một màu trong bảng màu (bg, band, number, text, accent) hoặc #rrggbb; sai → mặc định
create or replace function private.design_paint(v jsonb, def text) returns text
language sql immutable as $$
  select case
    when jsonb_typeof(v) <> 'string' then def
    when (v #>> '{}') ~ '^#[0-9a-fA-F]{6}$' then lower(v #>> '{}')
    when (v #>> '{}') = any (array['bg', 'band', 'number', 'text', 'accent']) then v #>> '{}'
    else def end
$$;

create or replace function private.design_str(v jsonb, n int) returns text
language sql immutable as $$
  select case when jsonb_typeof(v) = 'string' then left(v #>> '{}', n) else '' end
$$;

-- Danh sách lớp: tối đa 40; lớp lạ bị bỏ; lựa chọn sai → INVALID_BIB_DESIGN; ảnh ngoài kho → INVALID_BIB_IMAGE
create or replace function private.design_layers(r public.virtual_races, arr jsonb, p_binds text[]) returns jsonb
language plpgsql stable as $$
declare
  v_fonts text[] := array['sans', 'montserrat', 'inter', 'lexend', 'unbounded', 'impact', 'dela', 'paytone', 'sigmar', 'bungee', 'bungee_shade',
    'rowdies', 'condensed', 'athletic', 'saira', 'roboto_c', 'asap_c', 'fjalla', 'mono', 'tech', 'exo', 'kanit', 'tourney', 'protest', 'stencil',
    'slab', 'alfa', 'serif', 'cormorant', 'garamond', 'yeseva', 'script', 'vibes', 'allura', 'pacifico', 'lobster', 'graffiti', 'brush', 'bangers', 'patrick'];
  v_fx text[] := array['none', 'outline', 'stroke', 'shadow', 'glow', 'extrude', 'marker', 'box', 'pill', 'slant', 'underline', 'gold', 'gradient'];
begin
  if arr is null or jsonb_typeof(arr) = 'null' then return '[]'::jsonb; end if;
  if jsonb_typeof(arr) <> 'array' or jsonb_array_length(arr) > 40 then raise exception 'INVALID_BIB_DESIGN'; end if;
  if exists (select 1 from jsonb_array_elements(arr) e
              where e->>'type' in ('image', 'qr') and not private.design_src_ok(r, e->>'src')) then
    raise exception 'INVALID_BIB_IMAGE';
  end if;
  return (select coalesce(jsonb_agg(x.j order by x.ord), '[]'::jsonb) from (
    select e.ord,
      jsonb_build_object(
        'id', case when e.v->>'id' ~ '^[A-Za-z0-9_-]{1,24}$' then e.v->>'id' else 'l' || e.ord::text end,
        'type', e.v->>'type',
        'x', private.bib_num(e.v->'x', -0.2, 1.2, 0.5), 'y', private.bib_num(e.v->'y', -0.2, 1.2, 0.5),
        'rot', private.bib_num(e.v->'rot', -180, 180, 0), 'opacity', private.bib_num(e.v->'opacity', 0.05, 1, 1),
        'hidden', private.bib_bool(e.v->'hidden', false), 'locked', private.bib_bool(e.v->'locked', false))
      || case e.v->>'type'
        when 'text' then jsonb_build_object(
          'bind', case when e.v->>'bind' = any (p_binds || 'custom'::text) then e.v->>'bind' else 'custom' end,
          'text', private.design_str(e.v->'text', 120),
          'font', private.bib_pick(e.v->>'font', v_fonts, 'sans'),
          'size', private.bib_num(e.v->'size', 8, 800, 48), 'w', private.bib_num(e.v->'w', 0.03, 1.2, 0.8),
          'align', private.bib_pick(e.v->>'align', array['left', 'center', 'right'], 'center'),
          'color', private.design_paint(e.v->'color', 'text'),
          'italic', private.bib_bool(e.v->'italic', false), 'upper', private.bib_bool(e.v->'upper', false),
          'spacing', private.bib_num(e.v->'spacing', -0.1, 1, 0),
          'fx', private.bib_pick(e.v->>'fx', v_fx, 'none'),
          'fx_color', private.design_paint(e.v->'fx_color', 'accent'))
        when 'image' then jsonb_build_object(
          'role', private.bib_pick(e.v->>'role', array['logo', 'sponsor', 'image', 'signature'], 'image'),
          'src', e.v->>'src', 'name', trim(private.design_str(e.v->'name', 40)),
          'w', private.bib_num(e.v->'w', 0.02, 1.2, 0.16), 'h', private.bib_num(e.v->'h', 0.02, 1.2, 0.12))
        when 'qr' then jsonb_build_object(
          'source', private.bib_pick(e.v->>'source', array['verify', 'race', 'club', 'fee', 'link', 'image'], 'verify'),
          'src', e.v->>'src', 'url', private.design_str(e.v->'url', 400),
          'w', private.bib_num(e.v->'w', 0.05, 0.6, 0.14),
          'label', private.design_str(e.v->'label', 40), 'card', private.bib_bool(e.v->'card', true))
        else jsonb_build_object(
          'shape', private.bib_pick(e.v->>'shape', array['rect', 'round', 'pill', 'circle', 'line', 'slash', 'laurel', 'seal'], 'rect'),
          'w', private.bib_num(e.v->'w', 0.005, 1.5, 0.3), 'h', private.bib_num(e.v->'h', 0.003, 1.5, 0.1),
          'fill', private.design_paint(e.v->'fill', 'band'))
      end as j
    from jsonb_array_elements(arr) with ordinality as e(v, ord)
    where e.v->>'type' in ('text', 'image', 'qr', 'shape')) x);
end $$;

create or replace function private.design_colors(c jsonb) returns jsonb
language plpgsql immutable as $$
declare k text; v_out jsonb := '{}'::jsonb;
begin
  if c is null or jsonb_typeof(c) <> 'object' then return v_out; end if;
  foreach k in array array['bg', 'band', 'number', 'text', 'accent'] loop
    if c ? k then
      if coalesce(c->>k, '') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_BIB_DESIGN'; end if;
      v_out := v_out || jsonb_build_object(k, lower(c->>k));
    end if;
  end loop;
  return v_out;
end $$;

create or replace function private.design_fit(f jsonb) returns jsonb
language sql immutable as $$
  select jsonb_build_object('zoom', private.bib_num(f->'zoom', 0.5, 3, 1), 'x', private.bib_num(f->'x', -1, 1, 0), 'y', private.bib_num(f->'y', -1, 1, 0))
$$;

-- ---------------------------------------------------------------------
-- 2. Lưu thiết kế BIB (bản 2 — bản 1 cũ vẫn hiển thị được, app tự chuyển đổi)
-- ---------------------------------------------------------------------
create or replace function public.set_race_bib_design(p_race_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  r public.virtual_races := (select x from public.virtual_races x where x.id = p_race_id);
  v_tpl text := coalesce(p->>'template', 'classic');
  v_out jsonb;
begin
  if r.id is null then raise exception 'RACE_NOT_FOUND'; end if;
  if not private.race_is_manager(r) then raise exception 'FORBIDDEN'; end if;
  if coalesce(p->>'v', '1') <> '2' then raise exception 'APP_OUTDATED'; end if;
  if v_tpl not in ('classic', 'marathon', 'stripe', 'split', 'gradient', 'speed', 'neon', 'minimal') then raise exception 'INVALID_BIB_DESIGN'; end if;
  if not private.race_media_ok(r.id, p->>'bg_url') or not private.race_media_ok(r.id, p->>'art_url') then raise exception 'INVALID_BIB_IMAGE'; end if;
  v_out := jsonb_build_object(
    'v', 2, 'template', v_tpl, 'colors', private.design_colors(p->'colors'),
    'bg_url', p->>'bg_url', 'bg_opacity', private.bib_num(p->'bg_opacity', 0, 1, 0.35),
    'art_url', p->>'art_url', 'use_art', private.bib_bool(p->'use_art', false) and p->>'art_url' is not null,
    'art_fit', private.design_fit(coalesce(p->'art_fit', '{}'::jsonb)),
    'decor', private.bib_bool(p->'decor', true), 'strip', private.bib_bool(p->'strip', false), 'pins', private.bib_bool(p->'pins', true),
    'layers', private.design_layers(r, p->'layers', array['number', 'name', 'org', 'race', 'distance', 'dates']));
  update public.virtual_races set bib_design = v_out where id = r.id;
  return v_out;
end $$;

-- ---------------------------------------------------------------------
-- 3. Thiết kế giấy chứng nhận
-- ---------------------------------------------------------------------
create or replace function public.set_race_cert_design(p_race_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  r public.virtual_races := (select x from public.virtual_races x where x.id = p_race_id);
  v_out jsonb;
begin
  if r.id is null then raise exception 'RACE_NOT_FOUND'; end if;
  if not private.race_is_manager(r) then raise exception 'FORBIDDEN'; end if;
  if p is null or jsonb_typeof(p) = 'null' then
    update public.virtual_races set cert_design = null where id = r.id;       -- về mẫu mặc định
    return null;
  end if;
  if not private.race_media_ok(r.id, p->>'bg_url') or not private.race_media_ok(r.id, p->>'art_url') then raise exception 'INVALID_BIB_IMAGE'; end if;
  v_out := jsonb_build_object(
    'v', 2,
    'format', private.bib_pick(p->>'format', array['portrait', 'landscape'], 'portrait'),
    'template', private.bib_pick(p->>'template', array['midnight', 'ivory', 'bold', 'minimal'], 'midnight'),
    'colors', private.design_colors(p->'colors'),
    'bg_url', p->>'bg_url', 'bg_opacity', private.bib_num(p->'bg_opacity', 0, 1, 0.3),
    'art_url', p->>'art_url', 'use_art', private.bib_bool(p->'use_art', false) and p->>'art_url' is not null,
    'art_fit', private.design_fit(coalesce(p->'art_fit', '{}'::jsonb)),
    'decor', private.bib_bool(p->'decor', true),
    'layers', private.design_layers(r, p->'layers', array['name', 'race', 'org', 'distance', 'time', 'pace', 'rank', 'date', 'bib']));
  update public.virtual_races set cert_design = v_out where id = r.id;
  return v_out;
end $$;

-- ---------------------------------------------------------------------
-- 4. Tài nguyên có sẵn cho trình thiết kế (chỉ BTC): QR nhận tiền / tài khoản ngân hàng của CLB tổ chức
-- ---------------------------------------------------------------------
create or replace function public.race_design_assets(p_race_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  r public.virtual_races := (select x from public.virtual_races x where x.id = p_race_id);
begin
  if r.id is null then raise exception 'RACE_NOT_FOUND'; end if;
  if not private.race_is_manager(r) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'club', (select jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url) from public.clubs c where c.id = r.club_id),
    'bank_qr_url', (select c.bank_qr_url from public.clubs c where c.id = r.club_id),
    'bank', (select case when c.bank_bin is null or c.bank_account_no is null then null
                         else jsonb_build_object('bin', c.bank_bin, 'account_no', c.bank_account_no, 'account_name', c.bank_account_name) end
               from public.clubs c where c.id = r.club_id));
end $$;

-- ---------------------------------------------------------------------
-- 5. Chi tiết giải kèm thiết kế chứng nhận (thay bản 002700)
-- ---------------------------------------------------------------------
create or replace function public.race_detail(p_race_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.virtual_races := (select x from public.virtual_races x where x.id = p_race_id);
begin
  if r.id is null or not private.race_visible(r) then raise exception 'RACE_NOT_FOUND'; end if;
  return private.race_card(r) || jsonb_build_object('cert_design', r.cert_design, 'per_distance', (
    select coalesce(jsonb_agg(jsonb_build_object('distance_km', d,
             'registered', (select count(*) from public.race_registrations g where g.race_id = r.id and g.distance_km = d and g.status <> 'WITHDRAWN'),
             'finished', (select count(*) from public.race_registrations g where g.race_id = r.id and g.distance_km = d and g.status = 'FINISHED'))
             order by d), '[]'::jsonb)
      from unnest(r.distances) as d));
end $$;

revoke all on function private.design_src_ok(public.virtual_races, text), private.design_paint(jsonb, text), private.design_str(jsonb, int),
  private.design_layers(public.virtual_races, jsonb, text[]), private.design_colors(jsonb), private.design_fit(jsonb)
  from public, anon, authenticated;
revoke all on function public.set_race_bib_design(uuid, jsonb), public.set_race_cert_design(uuid, jsonb), public.race_design_assets(uuid) from public, anon;
grant execute on function public.set_race_bib_design(uuid, jsonb), public.set_race_cert_design(uuid, jsonb), public.race_design_assets(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
