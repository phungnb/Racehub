-- 004300: Admin tạo nhiệm vụ có thưởng + khuyến mãi hàng loạt.
-- 1. Nhiệm vụ: admin tạo / sửa / tắt nhiệm vụ ngày, tuần, tháng hoặc SỰ KIỆN (trong một khoảng ngày), thưởng Xu khi hoàn thành.
--    Chỉ số mới: TOTAL_KM (tổng km trong kỳ), RUN_COUNT (số bài trong kỳ). Có thể giới hạn cho VIP từ bậc N.
--    XP vẫn chỉ đến từ km — nhiệm vụ chỉ thưởng Xu.
-- 2. Khuyến mãi (Quản trị → Khuyến mãi):
--    • GRANT — tặng hàng loạt theo nhóm người nhận (tất cả, đang chạy, lâu không chạy, người mới, VIP, gói miễn phí,
--      thành viên CLB, từ cấp N, danh sách chọn tay). Phần thưởng: Xu / lượt tạo / gói VIP. Mỗi người nhận một lần mỗi đợt.
--    • CODE — mã khuyến mãi người dùng tự nhập ở Ví (giới hạn tổng lượt, hạn dùng, chỉ cho nhóm nào). Chống dò mã: 10 lần sai / giờ.
--    • SALE — giảm giá gói (% ) và / hoặc tặng thêm Xu khi nạp (%) trong một khoảng thời gian; áp thẳng vào đơn hàng.
-- Cần file 004200. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 1. Nhiệm vụ do admin tạo
-- ---------------------------------------------------------------------
alter table public.quests add column if not exists starts_at timestamptz;
alter table public.quests add column if not exists ends_at timestamptz;
alter table public.quests add column if not exists min_vip_tier integer not null default 0;
alter table public.quests add column if not exists created_by uuid references public.profiles(id) on delete set null;
alter table public.quests drop constraint if exists quests_period_check;
alter table public.quests add constraint quests_period_check check (period in ('DAILY', 'WEEKLY', 'MONTHLY', 'EVENT'));
alter table public.quests drop constraint if exists quests_metric_check;
alter table public.quests add constraint quests_metric_check check (metric in ('CHECKIN', 'RUN_KM', 'CHEERS_SENT', 'WEEK_KM', 'WEEK_RUN_DAYS',
  'CHALLENGE_JOINS', 'CHEERS_RECEIVED', 'TOTAL_KM', 'RUN_COUNT'));

create or replace function private.quest_period_start(p_period text, p_starts timestamptz, p_at timestamptz) returns date
language sql stable security definer set search_path = public as $$
  select case p_period when 'DAILY' then private.vn_day(p_at) when 'WEEKLY' then private.vn_week(p_at)
              when 'MONTHLY' then date_trunc('month', private.vn_day(p_at))::date
              else coalesce(private.vn_day(p_starts), date '2000-01-01') end
$$;

create or replace function private.quest_progress(
  p_user uuid, p_metric text, p_value numeric, p_mode text default 'ADD', p_at timestamptz default now(), p_activity uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare q record; v_start date; v_prog numeric; v_done timestamptz; v_tier integer := private.user_vip_tier(p_user);
begin
  for q in select * from public.quests x where x.metric = p_metric and x.is_active
             and (x.starts_at is null or p_at >= x.starts_at) and (x.ends_at is null or p_at < x.ends_at)
             and x.min_vip_tier <= v_tier loop
    v_start := private.quest_period_start(q.period, q.starts_at, p_at);
    insert into public.user_quest_progress (user_id, quest_id, period_start) values (p_user, q.id, v_start) on conflict do nothing;
    update public.user_quest_progress
       set progress = case p_mode when 'ADD' then progress + p_value when 'MAX' then greatest(progress, p_value) else p_value end, updated_at = now()
     where user_id = p_user and quest_id = q.id and period_start = v_start
    returning progress, completed_at into v_prog, v_done;
    if v_done is null and v_prog >= q.target then
      update public.user_quest_progress set completed_at = now() where user_id = p_user and quest_id = q.id and period_start = v_start;
      perform private.award(p_user, 'QUEST', 'Nhiệm vụ: ' || q.title,
        case q.period when 'DAILY' then 'Nhiệm vụ ngày' when 'WEEKLY' then 'Nhiệm vụ tuần' when 'MONTHLY' then 'Nhiệm vụ tháng' else 'Nhiệm vụ sự kiện' end,
        q.reward_xu, 0, 'quest:' || q.id || ':' || p_user || ':' || v_start, p_activity,
        jsonb_build_object('quest_id', q.id, 'code', q.code, 'period', q.period, 'period_start', v_start, 'icon', q.icon));
    end if;
  end loop;
end $$;

-- Chỉ số mới: cộng dồn km và số bài theo kỳ của nhiệm vụ
create or replace function private.quest_totals_on_reward() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is null or old.rewarded_at is not null or new.rewarded_at is null or new.validation_status <> 'APPROVED' then return new; end if;
  begin
    perform private.quest_progress(new.user_id, 'TOTAL_KM', private.run_km(new), 'ADD', coalesce(new.started_at, now()), new.id);
    perform private.quest_progress(new.user_id, 'RUN_COUNT', 1, 'ADD', coalesce(new.started_at, now()), new.id);
  exception when others then
    raise warning 'quest_totals_on_reward % lỗi: % %', new.id, sqlstate, sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists trg_quest_totals_on_reward on public.activities;
create trigger trg_quest_totals_on_reward after update of rewarded_at on public.activities
  for each row execute function private.quest_totals_on_reward();

-- Nhiệm vụ của tôi (đúng kỳ, đang trong khung thời gian, có khóa VIP)
create or replace function public.my_quests() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); v_tier integer := private.user_vip_tier(v_uid);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', q.id, 'code', q.code, 'period', q.period, 'metric', q.metric, 'title', q.title, 'description', q.description, 'icon', q.icon,
            'target', q.target, 'reward_xu', q.reward_xu, 'starts_at', q.starts_at, 'ends_at', q.ends_at, 'min_vip_tier', q.min_vip_tier,
            'locked', q.min_vip_tier > v_tier, 'progress', least(coalesce(p.progress, 0), q.target), 'completed', p.completed_at is not null)
            order by case q.period when 'EVENT' then 0 when 'DAILY' then 1 when 'WEEKLY' then 2 else 3 end, q.sort, q.created_at), '[]'::jsonb)
            from public.quests q
            left join public.user_quest_progress p on p.quest_id = q.id and p.user_id = v_uid
                 and p.period_start = private.quest_period_start(q.period, q.starts_at, now())
           where q.is_active and (q.starts_at is null or q.starts_at <= now()) and (q.ends_at is null or q.ends_at > now()));
end $$;

create or replace function public.admin_list_quests() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(q) || jsonb_build_object(
            'completions', (select count(*) from public.user_quest_progress p where p.quest_id = q.id and p.completed_at is not null),
            'xu_paid', coalesce((select sum(e.xu) from public.game_events e where e.kind = 'QUEST' and e.payload->>'quest_id' = q.id::text), 0))
            order by q.is_active desc, q.created_at desc), '[]'::jsonb) from public.quests q);
end $$;

create or replace function public.admin_save_quest(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  v_id uuid := coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid());
  v_title text := trim(coalesce(p->>'title', ''));
  v_period text := upper(coalesce(p->>'period', 'DAILY'));
  v_metric text := upper(coalesce(p->>'metric', 'TOTAL_KM'));
  v_target numeric := (p->>'target')::numeric;
  v_xu numeric := round(coalesce((p->>'reward_xu')::numeric, 0), 1);
  v_start timestamptz := nullif(p->>'starts_at', '')::timestamptz;
  v_end timestamptz := nullif(p->>'ends_at', '')::timestamptz;
begin
  if char_length(v_title) not between 2 and 80 then raise exception 'INVALID_TITLE'; end if;
  if v_period not in ('DAILY', 'WEEKLY', 'MONTHLY', 'EVENT') then raise exception 'INVALID_PERIOD'; end if;
  if v_metric not in ('CHECKIN', 'RUN_KM', 'TOTAL_KM', 'RUN_COUNT', 'WEEK_KM', 'WEEK_RUN_DAYS', 'CHALLENGE_JOINS') then raise exception 'INVALID_METRIC'; end if;
  if v_metric in ('WEEK_KM', 'WEEK_RUN_DAYS') and v_period <> 'WEEKLY' then raise exception 'INVALID_METRIC'; end if;
  if v_target is null or v_target <= 0 or v_target > 100000 then raise exception 'INVALID_TARGET'; end if;
  if v_xu < 0 or v_xu > 100000 then raise exception 'INVALID_AMOUNT'; end if;
  if v_period = 'EVENT' and (v_start is null or v_end is null) then raise exception 'INVALID_TIME_RANGE'; end if;
  if v_end is not null and v_start is not null and (v_end <= v_start or v_end - v_start > interval '366 days') then raise exception 'INVALID_TIME_RANGE'; end if;
  insert into public.quests (id, code, period, metric, target, title, description, icon, reward_xu, reward_xp, sort, is_active, starts_at, ends_at, min_vip_tier, created_by)
  values (v_id, coalesce(nullif(p->>'code', ''), 'ADM_' || upper(substr(replace(v_id::text, '-', ''), 1, 8))), v_period, v_metric, v_target, v_title,
          nullif(trim(coalesce(p->>'description', '')), ''), coalesce(nullif(p->>'icon', ''), 'Target'), v_xu, 0, coalesce((p->>'sort')::int, 100),
          coalesce((p->>'is_active')::boolean, true), v_start, v_end, least(greatest(coalesce((p->>'min_vip_tier')::int, 0), 0), 3), v_uid)
  on conflict (id) do update set period = excluded.period, metric = excluded.metric, target = excluded.target, title = excluded.title,
    description = excluded.description, icon = excluded.icon, reward_xu = excluded.reward_xu, reward_xp = 0, sort = excluded.sort,
    is_active = excluded.is_active, starts_at = excluded.starts_at, ends_at = excluded.ends_at, min_vip_tier = excluded.min_vip_tier;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SAVE_QUEST', v_id::text, p);
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 2. Khuyến mãi
-- ---------------------------------------------------------------------
create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('GRANT', 'CODE', 'SALE')),
  title text not null check (char_length(title) between 2 and 120),
  message text check (message is null or char_length(message) <= 300),
  reward jsonb not null default '{}'::jsonb,          -- {xu, passes: {qty, max_slots, days}, plan: {code, months}}
  segment jsonb,                                      -- nhóm người nhận (GRANT) / được dùng mã (CODE)
  code text unique check (code is null or code ~ '^[A-Z0-9_-]{4,24}$'),
  max_uses integer check (max_uses is null or max_uses > 0),
  discount_pct integer not null default 0 check (discount_pct between 0 and 90),
  bonus_pct integer not null default 0 check (bonus_pct between 0 and 300),
  applies_to text not null default 'ALL' check (applies_to in ('ALL', 'PLAN', 'XU')),
  plan_code text references public.plans(code),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  is_active boolean not null default true,
  recipients integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.promotion_redemptions (
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (promotion_id, user_id)
);
create table if not exists private.promo_attempts (user_id uuid not null, at timestamptz not null default now());
create index if not exists promo_attempts_idx on private.promo_attempts (user_id, at);
alter table public.orders add column if not exists promotion_id uuid references public.promotions(id) on delete set null;
alter table public.orders add column if not exists list_price_vnd integer;
alter table public.promotions enable row level security;
alter table public.promotion_redemptions enable row level security;
revoke all on public.promotions, public.promotion_redemptions from anon, authenticated;
revoke all on private.promo_attempts from public, anon, authenticated;

-- Nhóm người nhận
create or replace function private.in_segment(p_user uuid, seg jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select case when seg is null or seg = 'null'::jsonb then true else
    case upper(coalesce(seg->>'type', 'ALL'))
      when 'ALL' then true
      when 'ACTIVE' then exists (select 1 from public.activities a where a.user_id = p_user and a.validation_status = 'APPROVED'
                                   and a.started_at >= now() - make_interval(days => coalesce((seg->>'days')::int, 30)))
      when 'INACTIVE' then exists (select 1 from public.activities a where a.user_id = p_user and a.validation_status = 'APPROVED')
                       and not exists (select 1 from public.activities a where a.user_id = p_user and a.validation_status = 'APPROVED'
                                   and a.started_at >= now() - make_interval(days => coalesce((seg->>'days')::int, 30)))
      when 'NEW' then (select p.created_at from public.profiles p where p.id = p_user) >= now() - make_interval(days => coalesce((seg->>'days')::int, 14))
      when 'VIP' then private.user_vip_tier(p_user) >= greatest(coalesce((seg->>'min_tier')::int, 1), 1)
      when 'FREE' then private.user_vip_tier(p_user) = 0
      when 'CLUB' then exists (select 1 from public.club_members m where m.user_id = p_user and m.status = 'APPROVED'
                                 and m.club_id = nullif(seg->>'club_id', '')::uuid)
      when 'LEVEL' then coalesce((select p.level from public.profiles p where p.id = p_user), 1) >= coalesce((seg->>'min_level')::int, 1)
      when 'USERS' then p_user::text in (select jsonb_array_elements_text(coalesce(seg->'ids', '[]'::jsonb)))
      else false end end
$$;

create or replace function private.valid_reward(r jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(coalesce(r, '{}'::jsonb)) = 'object'
     and coalesce((r->>'xu')::numeric, 0) between 0 and 1000000
     and (r->'passes' is null or r->'passes' = 'null'::jsonb or (
          coalesce((r->'passes'->>'qty')::int, 0) between 1 and 100 and coalesce((r->'passes'->>'max_slots')::int, 0) between 1 and 10000
          and coalesce((r->'passes'->>'days')::int, 30) between 1 and 365))
     and (r->'plan' is null or r->'plan' = 'null'::jsonb or ((r->'plan'->>'months')::int in (1, 3, 6, 12)))
     and (coalesce((r->>'xu')::numeric, 0) > 0 or (r->'passes' is not null and r->'passes' <> 'null'::jsonb)
          or (r->'plan' is not null and r->'plan' <> 'null'::jsonb))
$$;

-- Gói tặng phải là gói cá nhân (VIP), không phải CLB Pro
create or replace function private.reward_plan_ok(r jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select r->'plan' is null or r->'plan' = 'null'::jsonb
      or exists (select 1 from public.plans x where x.code = upper(r->'plan'->>'code') and x.owner_type = 'USER')
$$;

-- Trao phần thưởng một lần cho một người (khóa chống lặp theo đợt + người)
create or replace function private.give_promo_reward(pr public.promotions, p_user uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb := pr.reward; v_parts text[] := '{}';
begin
  if coalesce((r->>'xu')::numeric, 0) > 0 then
    perform private.ledger_post('PROMO', 'promo:' || pr.id || ':' || p_user, left(pr.title, 200), p_actor,
      jsonb_build_array(jsonb_build_object('account_id', p_user, 'coin_kind', 'BONUS', 'amount', (r->>'xu')::numeric),
                        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -(r->>'xu')::numeric)), pr.id);
    v_parts := v_parts || ((r->>'xu') || ' Xu');
  end if;
  if r->'passes' is not null and r->'passes' <> 'null'::jsonb then
    insert into public.challenge_passes (owner_type, owner_id, max_slots, total, remaining, expires_at, note, granted_by, source_key)
    values ('USER', p_user, (r->'passes'->>'max_slots')::int, (r->'passes'->>'qty')::int, (r->'passes'->>'qty')::int,
            now() + make_interval(days => coalesce((r->'passes'->>'days')::int, 30)), left(pr.title, 200), p_actor, 'promo:' || pr.id || ':' || p_user)
    on conflict (source_key) where source_key is not null do nothing;
    v_parts := v_parts || ((r->'passes'->>'qty') || ' lượt tạo ≤' || (r->'passes'->>'max_slots') || ' người');
  end if;
  if r->'plan' is not null and r->'plan' <> 'null'::jsonb then
    perform private.grant_subscription('USER', p_user, upper(r->'plan'->>'code'), (r->'plan'->>'months')::int, 'ADMIN', null, left(pr.title, 200), p_actor);
    v_parts := v_parts || ('gói ' || upper(r->'plan'->>'code') || ' ' || (r->'plan'->>'months') || ' tháng');
  end if;
  perform private.notify(p_user, null, 'PROMO', pr.title,
    coalesce(nullif(trim(coalesce(pr.message, '')), ''), 'Bạn nhận: ' || array_to_string(v_parts, ', ')), '/wallet', p_actor, true);
end $$;

create or replace function public.admin_preview_segment(p_segment jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select jsonb_build_object('count', count(*),
            'sample', coalesce(jsonb_agg(t.display_name) filter (where t.rn <= 5), '[]'::jsonb))
            from (select p.display_name, row_number() over (order by p.created_at desc) as rn
                    from public.profiles p where private.in_segment(p.id, p_segment)) t);
end $$;

-- Tặng hàng loạt: tạo đợt + trao ngay cho mọi người trong nhóm (tối đa 50.000 người mỗi đợt)
create or replace function public.admin_run_grant(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  pr public.promotions;
  u record;
  n integer := 0;
begin
  if not private.valid_reward(p->'reward') or not private.reward_plan_ok(p->'reward') then raise exception 'INVALID_REWARD'; end if;
  if (select count(*) from public.profiles x where private.in_segment(x.id, p->'segment')) > 50000 then raise exception 'SEGMENT_TOO_LARGE'; end if;
  insert into public.promotions (kind, title, message, reward, segment, created_by)
  values ('GRANT', trim(coalesce(p->>'title', '')), nullif(trim(coalesce(p->>'message', '')), ''), p->'reward', coalesce(p->'segment', '{"type":"ALL"}'::jsonb), v_uid)
  returning * into pr;
  for u in select x.id from public.profiles x where private.in_segment(x.id, pr.segment) loop
    insert into public.promotion_redemptions (promotion_id, user_id) values (pr.id, u.id) on conflict do nothing;
    if found then
      perform private.give_promo_reward(pr, u.id, v_uid);
      n := n + 1;
    end if;
  end loop;
  update public.promotions set recipients = n where id = pr.id;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'PROMO_GRANT', pr.id::text, p || jsonb_build_object('recipients', n));
  return jsonb_build_object('promotion_id', pr.id, 'recipients', n);
end $$;

-- Mã khuyến mãi / đợt giảm giá: tạo, sửa, bật tắt
create or replace function public.admin_save_promo(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  v_id uuid := coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid());
  v_kind text := upper(coalesce(p->>'kind', ''));
  v_code text := nullif(upper(trim(coalesce(p->>'code', ''))), '');
begin
  if v_kind not in ('CODE', 'SALE') then raise exception 'INVALID_KIND'; end if;
  if v_kind = 'CODE' and (v_code is null or not private.valid_reward(p->'reward') or not private.reward_plan_ok(p->'reward')) then raise exception 'INVALID_REWARD'; end if;
  if v_kind = 'SALE' and coalesce((p->>'discount_pct')::int, 0) = 0 and coalesce((p->>'bonus_pct')::int, 0) = 0 then raise exception 'INVALID_SALE'; end if;
  insert into public.promotions (id, kind, title, message, reward, segment, code, max_uses, discount_pct, bonus_pct, applies_to, plan_code,
                                 starts_at, ends_at, is_active, created_by)
  values (v_id, v_kind, trim(coalesce(p->>'title', '')), nullif(trim(coalesce(p->>'message', '')), ''),
          case when v_kind = 'CODE' then p->'reward' else '{}'::jsonb end, case when p->'segment' = 'null'::jsonb then null else p->'segment' end,
          case when v_kind = 'CODE' then v_code end, nullif(p->>'max_uses', '')::int,
          coalesce((p->>'discount_pct')::int, 0), coalesce((p->>'bonus_pct')::int, 0), upper(coalesce(p->>'applies_to', 'ALL')),
          nullif(p->>'plan_code', ''), coalesce(nullif(p->>'starts_at', '')::timestamptz, now()), nullif(p->>'ends_at', '')::timestamptz,
          coalesce((p->>'is_active')::boolean, true), v_uid)
  on conflict (id) do update set title = excluded.title, message = excluded.message, reward = excluded.reward, segment = excluded.segment,
    code = excluded.code, max_uses = excluded.max_uses, discount_pct = excluded.discount_pct, bonus_pct = excluded.bonus_pct,
    applies_to = excluded.applies_to, plan_code = excluded.plan_code, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
    is_active = excluded.is_active;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SAVE_PROMO', v_id::text, p);
  return v_id;
end $$;

create or replace function public.admin_list_promotions() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(x) || jsonb_build_object('creator', private.display_name(x.created_by),
            'orders', (select count(*) from public.orders o where o.promotion_id = x.id and o.status = 'PAID')) order by x.created_at desc), '[]'::jsonb)
            from public.promotions x);
end $$;

-- Người dùng nhập mã
create or replace function public.redeem_promo_code(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  pr public.promotions := (select x from public.promotions x where x.kind = 'CODE' and x.code = upper(trim(coalesce(p_code, ''))) for update);
begin
  if (select count(*) from private.promo_attempts a where a.user_id = v_uid and a.at > now() - interval '1 hour') >= 10 then
    raise exception 'TOO_MANY_ATTEMPTS';
  end if;
  if pr.id is null or not pr.is_active or pr.starts_at > now() or (pr.ends_at is not null and pr.ends_at <= now()) then
    insert into private.promo_attempts (user_id) values (v_uid);     -- trả lỗi (không raise) để lần thử sai được ghi lại
    return jsonb_build_object('error', 'PROMO_INVALID');
  end if;
  if pr.max_uses is not null and pr.recipients >= pr.max_uses then raise exception 'PROMO_USED_UP'; end if;
  if not private.in_segment(v_uid, pr.segment) then raise exception 'PROMO_NOT_ELIGIBLE'; end if;
  insert into public.promotion_redemptions (promotion_id, user_id) values (pr.id, v_uid) on conflict do nothing;
  if not found then raise exception 'PROMO_ALREADY_USED'; end if;
  perform private.give_promo_reward(pr, v_uid, null);
  update public.promotions set recipients = recipients + 1 where id = pr.id;
  return jsonb_build_object('title', pr.title, 'reward', pr.reward, 'balance', private.balance(v_uid));
end $$;

-- Đợt giảm giá đang chạy tốt nhất cho một món (gói hoặc nạp Xu)
create or replace function private.best_sale(p_kind text, p_plan text) returns public.promotions
language sql stable security definer set search_path = public as $$
  select t.x from (select x, row_number() over (order by x.discount_pct desc, x.bonus_pct desc, x.created_at desc) as rn
                     from public.promotions x
                    where x.kind = 'SALE' and x.is_active and x.starts_at <= now() and (x.ends_at is null or x.ends_at > now())
                      and x.applies_to in ('ALL', p_kind) and (x.plan_code is null or x.plan_code = p_plan)) t
   where t.rn = 1
$$;

create or replace function public.active_sales() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'message', x.message, 'discount_pct', x.discount_pct,
           'bonus_pct', x.bonus_pct, 'applies_to', x.applies_to, 'plan_code', x.plan_code, 'ends_at', x.ends_at) order by x.discount_pct desc), '[]'::jsonb)
    from public.promotions x
   where x.kind = 'SALE' and x.is_active and x.starts_at <= now() and (x.ends_at is null or x.ends_at > now())
$$;

-- Đơn hàng áp đợt giảm giá / tặng thêm Xu (thay bản 003800)
create or replace function public.create_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_kind text := upper(coalesce(p->>'kind', ''));
  v_plan public.plans := (select x from public.plans x where x.code = p->>'plan_code' and x.active);
  v_months integer := coalesce((p->>'months')::int, 1);
  v_list integer;
  v_price integer;
  v_pkg public.xu_packages := (select x from public.xu_packages x where x.id = nullif(p->>'package_id', '')::uuid and x.active);
  v_owner uuid;
  v_owner_type text;
  v_sale public.promotions;
  v_bonus integer;
  v_id uuid := gen_random_uuid();
begin
  if (select count(*) from public.orders o where o.buyer_id = v_uid and o.status = 'PENDING' and o.expires_at > now()) >= 5 then
    raise exception 'TOO_MANY_PENDING_ORDERS';
  end if;
  if v_kind = 'PLAN' then
    if v_plan.code is null then raise exception 'INVALID_PLAN'; end if;
    v_list := (select pp.price_vnd from public.plan_prices pp where pp.plan_code = v_plan.code and pp.months = v_months and pp.active);
    if v_list is null then raise exception 'INVALID_MONTHS'; end if;
    v_owner_type := v_plan.owner_type;
    if v_owner_type = 'CLUB' then
      v_owner := nullif(p->>'club_id', '')::uuid;
      if v_owner is null or not public.club_is_staff(v_owner) then raise exception 'CLUB_STAFF_REQUIRED'; end if;
    else
      v_owner := v_uid;
    end if;
    v_sale := private.best_sale('PLAN', v_plan.code);
    v_price := greatest(1000, (round(v_list * (100 - coalesce(v_sale.discount_pct, 0)) / 100.0 / 1000) * 1000)::int);
    insert into public.orders (id, code, buyer_id, kind, plan_code, months, owner_type, owner_id, amount_vnd, list_price_vnd, promotion_id)
    values (v_id, 'RH' || nextval('public.order_code_seq'), v_uid, 'PLAN', v_plan.code, v_months, v_owner_type, v_owner, v_price, v_list,
            case when coalesce(v_sale.discount_pct, 0) > 0 then v_sale.id end);
  elsif v_kind = 'XU' then
    if v_pkg.id is null then raise exception 'INVALID_PACKAGE'; end if;
    v_sale := private.best_sale('XU', null);
    v_price := greatest(1000, (round(v_pkg.price_vnd * (100 - coalesce(v_sale.discount_pct, 0)) / 100.0 / 1000) * 1000)::int);
    v_bonus := v_pkg.bonus_xu + floor(v_pkg.xu * coalesce(v_sale.bonus_pct, 0) / 100.0)::int;
    insert into public.orders (id, code, buyer_id, kind, package_id, owner_type, owner_id, amount_vnd, xu, bonus_xu, list_price_vnd, promotion_id)
    values (v_id, 'RH' || nextval('public.order_code_seq'), v_uid, 'XU', v_pkg.id, 'USER', v_uid, v_price, v_pkg.xu, v_bonus, v_pkg.price_vnd,
            case when coalesce(v_sale.discount_pct, 0) > 0 or coalesce(v_sale.bonus_pct, 0) > 0 then v_sale.id end);
  else
    raise exception 'INVALID_ORDER';
  end if;
  return private.order_json((select o from public.orders o where o.id = v_id));
end $$;

-- ---------------------------------------------------------------------
-- Quyền
-- ---------------------------------------------------------------------
revoke all on function private.quest_period_start(text, timestamptz, timestamptz), private.quest_totals_on_reward(),
  private.in_segment(uuid, jsonb), private.valid_reward(jsonb), private.reward_plan_ok(jsonb), private.give_promo_reward(public.promotions, uuid, uuid),
  private.best_sale(text, text) from public, anon, authenticated;
revoke all on function public.my_quests(), public.admin_list_quests(), public.admin_save_quest(jsonb), public.admin_preview_segment(jsonb),
  public.admin_run_grant(jsonb), public.admin_save_promo(jsonb), public.admin_list_promotions(), public.redeem_promo_code(text),
  public.active_sales() from public, anon;
grant execute on function public.my_quests(), public.admin_list_quests(), public.admin_save_quest(jsonb), public.admin_preview_segment(jsonb),
  public.admin_run_grant(jsonb), public.admin_save_promo(jsonb), public.admin_list_promotions(), public.redeem_promo_code(text),
  public.active_sales() to authenticated;

notify pgrst, 'reload schema';
