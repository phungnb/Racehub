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
