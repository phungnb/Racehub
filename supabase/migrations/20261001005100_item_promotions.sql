-- 005100: Khuyến mãi vật phẩm (Xu) — Vật phẩm · Giá gốc · Chương trình tách riêng.
-- • 8 loại: FREE (tặng miễn phí) · TRIAL (dùng thử đồ nhân vật N ngày) · SALE (giảm %) · FLASH (giảm % ngắn hạn, số lượng thật)
--   · BUNDLE (gói nhiều đồ nhân vật, giá gói) · EVENT (giảm % theo dịp, gom nhóm) · FIRST_PURCHASE (lần mua đầu) · COMEBACK (runner quay lại).
-- • Áp cho vật phẩm nhân vật (AVATAR) và quà tặng (GIFT). Mỗi vật phẩm chỉ MỘT chương trình đang chạy (không cộng dồn → không về 0 Xu).
-- • Giới hạn: tổng số lượt (đếm thật, không nhập tay), số lượt / người, nhóm được hưởng (tất cả / người mới / quay lại / VIP).
-- • Quà tặng giảm giá / miễn phí: Tỏa sáng của người nhận tính theo XU THỰC TRẢ (quà miễn phí = 0) → không nuôi Tỏa sáng bằng quà free.
-- • Không có vật phẩm "DÙNG" tăng XP / km (XP chỉ từ km). Dùng thử chỉ là đồ trang trí, hết hạn tự tháo.
-- Cần 004700. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 1. Bảng
-- ---------------------------------------------------------------------
create table if not exists public.item_promotions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('FREE', 'TRIAL', 'SALE', 'FLASH', 'BUNDLE', 'EVENT', 'FIRST_PURCHASE', 'COMEBACK')),
  title text not null check (char_length(title) between 2 and 80),
  badge text check (badge is null or char_length(badge) <= 24),
  item_type text check (item_type in ('AVATAR', 'GIFT')),
  item_code text,
  bundle_items text[],                                -- BUNDLE: mã đồ nhân vật
  discount_pct integer not null default 0 check (discount_pct between 0 and 100),
  fixed_price integer check (fixed_price is null or fixed_price >= 0),
  quantity_limit integer check (quantity_limit is null or quantity_limit > 0),
  per_user_limit integer check (per_user_limit is null or per_user_limit > 0),
  trial_days integer check (trial_days is null or trial_days between 1 and 30),
  segment text not null default 'ALL' check (segment in ('ALL', 'NEW', 'COMEBACK', 'VIP')),
  event_key text check (event_key is null or char_length(event_key) <= 40),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create index if not exists item_promotions_item_idx on public.item_promotions (item_type, item_code) where is_active;
create table if not exists public.item_promo_redemptions (
  id uuid primary key default gen_random_uuid(),
  promo_id uuid not null references public.item_promotions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  qty integer not null default 1,
  xu_paid integer not null default 0,
  ref text unique,
  created_at timestamptz not null default now()
);
create index if not exists item_promo_redemptions_idx on public.item_promo_redemptions (promo_id, user_id);
alter table public.item_promotions enable row level security;
alter table public.item_promo_redemptions enable row level security;

-- Dùng thử: đồ hết hạn tự tháo
alter table public.user_inventory add column if not exists expires_at timestamptz;
-- Quà: amount = Xu thực trả (có thể 0 khi miễn phí), list_amount = giá gốc
alter table public.cheers drop constraint if exists cheers_amount_chk;
alter table public.cheers add constraint cheers_amount_chk check (amount between 0 and 100000000);
alter table public.cheers add column if not exists list_amount numeric(12, 1);
alter table public.cheers add column if not exists promo_id uuid references public.item_promotions(id) on delete set null;

-- ---------------------------------------------------------------------
-- 2. Ai được hưởng + giá cuối
-- ---------------------------------------------------------------------
create or replace function private.promo_segment_ok(p_user uuid, p_segment text) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_segment
    when 'ALL' then true
    when 'NEW' then coalesce((select p.created_at >= now() - interval '14 days' from public.profiles p where p.id = p_user), false)
    when 'VIP' then private.user_vip_tier(p_user) > 0
    -- quay lại: tài khoản ≥ 30 ngày, không có bài hợp lệ trong 14 ngày trước tuần này
    when 'COMEBACK' then coalesce((select p.created_at <= now() - interval '30 days' from public.profiles p where p.id = p_user), false)
      and not exists (select 1 from public.activities a where a.user_id = p_user and a.validation_status = 'APPROVED'
                        and a.started_at >= now() - interval '21 days' and a.started_at < now() - interval '7 days')
    else false end
$$;

create or replace function private.promo_used(p_promo uuid, p_user uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(sum(r.qty), 0)::int from public.item_promo_redemptions r where r.promo_id = p_promo and (p_user is null or r.user_id = p_user)
$$;

-- Người đã từng mua bằng Xu (vật phẩm / quà) — cho FIRST_PURCHASE
create or replace function private.has_purchased(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_inventory i where i.user_id = p_user and i.acquired_reason in ('PURCHASE', 'PROMO'))
      or exists (select 1 from public.cheers c where c.from_user = p_user and c.gift_code is not null and c.amount > 0)
$$;

create or replace function private.promo_live(p public.item_promotions) returns boolean
language sql stable as $$
  select p.is_active and p.starts_at <= now() and (p.ends_at is null or p.ends_at > now())
     and (p.quantity_limit is null or private.promo_used(p.id, null) < p.quantity_limit)
$$;

-- Chương trình đang áp cho một vật phẩm với một người (null nếu không có). qty = số lượng muốn mua (quà)
drop function if exists private.item_offer(uuid, text, text, integer, integer);
create or replace function private.item_offer(p_user uuid, p_type text, p_code text, p_base numeric, p_qty integer default 1) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  -- mỗi vật phẩm chỉ một chương trình chạy cùng lúc (admin chặn chồng lấn); thứ tự chỉ để chắc chắn
  p public.item_promotions := (select q.x from (
                                 select x, row_number() over (order by case x.kind when 'FLASH' then 1 when 'EVENT' then 2 when 'FIRST_PURCHASE' then 3
                                                      when 'COMEBACK' then 3 when 'FREE' then 4 when 'TRIAL' then 5 else 6 end, x.created_at) as rn
                                   from public.item_promotions x
                                  where x.item_type = p_type and x.item_code = p_code and x.kind <> 'BUNDLE' and private.promo_live(x)) q
                                where q.rn = 1);
  v_unit integer;
  v_left integer;
  v_eligible boolean;
begin
  if p.id is null then return null; end if;
  v_eligible := p_user is not null and private.promo_segment_ok(p_user, p.segment)
    and (p.kind <> 'FIRST_PURCHASE' or not private.has_purchased(p_user))
    and (p.per_user_limit is null or private.promo_used(p.id, p_user) + coalesce(p_qty, 1) <= p.per_user_limit);
  v_unit := case p.kind when 'FREE' then 0 when 'TRIAL' then 0
                        else greatest(0, round(p_base * (100 - p.discount_pct) / 100.0))::int end;
  p_base := round(p_base);
  v_left := case when p.quantity_limit is null then null else p.quantity_limit - private.promo_used(p.id, null) end;
  return jsonb_build_object('promo_id', p.id, 'kind', p.kind, 'title', p.title, 'badge', coalesce(p.badge, case p.kind
            when 'FREE' then 'MIỄN PHÍ' when 'TRIAL' then 'DÙNG THỬ' when 'FLASH' then 'FLASH SALE' when 'FIRST_PURCHASE' then 'LẦN ĐẦU'
            when 'COMEBACK' then 'CHÀO MỪNG TRỞ LẠI' else '-' || p.discount_pct || '%' end),
    'base', p_base, 'price', v_unit, 'discount_pct', case when p_base > 0 then round(100 - v_unit * 100.0 / p_base) else 0 end,
    'ends_at', p.ends_at, 'left', v_left, 'sold', private.promo_used(p.id, null), 'limit', p.quantity_limit,
    'per_user_limit', p.per_user_limit, 'used', case when p_user is null then 0 else private.promo_used(p.id, p_user) end,
    'trial_days', p.trial_days, 'eligible', v_eligible, 'segment', p.segment, 'event_key', p.event_key);
end $$;

-- ---------------------------------------------------------------------
-- 3. Mua vật phẩm nhân vật: giá theo chương trình; dùng thử; gói
-- ---------------------------------------------------------------------
create or replace function public.buy_avatar_item(p_code text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  i public.avatar_items := (select x from public.avatar_items x where x.code = p_code and x.is_active);
  v_level integer;
  o jsonb;
  v_price integer;
  v_trial boolean := false;
  v_owned public.user_inventory;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if exists (select 1 from public.ledger_transactions where idempotency_key = 'shop:' || p_idempotency_key)
     or exists (select 1 from public.item_promo_redemptions where ref = 'shop:' || p_idempotency_key) then
    return jsonb_build_object('duplicate', true, 'balance', private.balance(v_uid));
  end if;
  if i.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if coalesce(i.metadata->>'acquire', '') = 'shine' then raise exception 'SHINE_ONLY'; end if;
  perform pg_advisory_xact_lock(hashtextextended('shop:' || v_uid, 0));
  v_owned := (select x from public.user_inventory x where x.user_id = v_uid and x.item_id = i.id);
  if v_owned.id is not null and (v_owned.expires_at is null or v_owned.expires_at > now()) and v_owned.acquired_reason <> 'TRIAL' then
    raise exception 'ALREADY_OWNED';
  end if;
  v_level := coalesce((select level from public.profiles where id = v_uid), 1);
  if v_level < i.unlock_level then raise exception 'LEVEL_TOO_LOW'; end if;

  o := private.item_offer(v_uid, 'AVATAR', i.code, i.price_xu, 1);
  if o is not null and (o->>'eligible')::boolean and o->>'kind' <> 'TRIAL' then v_price := (o->>'price')::int;
  else v_price := i.price_xu; o := null; end if;

  if v_price > 0 then
    if private.balance(v_uid) < v_price then raise exception 'INSUFFICIENT_BALANCE'; end if;
    perform private.ledger_post('SHOP_ITEM', 'shop:' || p_idempotency_key, 'Mua ' || i.name || case when o is not null then ' (' || (o->>'title') || ')' else '' end,
      v_uid, private.debit_entries(v_uid, v_price, private.system_account()));
  end if;
  if o is not null then
    insert into public.item_promo_redemptions (promo_id, user_id, qty, xu_paid, ref) values ((o->>'promo_id')::uuid, v_uid, 1, v_price, 'shop:' || p_idempotency_key);
  end if;
  delete from public.user_inventory where user_id = v_uid and item_id = i.id;          -- mua đứt thay cho bản dùng thử
  insert into public.user_inventory (user_id, item_id, acquired_reason)
  values (v_uid, i.id, case when o is not null then 'PROMO' when v_price > 0 then 'PURCHASE' else 'FREE' end);
  return jsonb_build_object('code', i.code, 'paid', v_price, 'balance', private.balance(v_uid));
end $$;

create or replace function public.try_avatar_item(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  i public.avatar_items := (select x from public.avatar_items x where x.code = p_code and x.is_active);
  o jsonb;
  v_until timestamptz;
begin
  if i.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  o := private.item_offer(v_uid, 'AVATAR', i.code, i.price_xu, 1);
  if o is null or o->>'kind' <> 'TRIAL' then raise exception 'PROMO_NOT_AVAILABLE'; end if;
  if not (o->>'eligible')::boolean then raise exception 'PROMO_LIMIT_REACHED'; end if;
  if exists (select 1 from public.user_inventory x where x.user_id = v_uid and x.item_id = i.id) then raise exception 'ALREADY_OWNED'; end if;
  -- mỗi người dùng thử một món một lần (kể cả đã hết hạn, bị tháo)
  if exists (select 1 from public.item_promo_redemptions r join public.item_promotions p on p.id = r.promo_id
              where r.user_id = v_uid and p.kind = 'TRIAL' and p.item_code = i.code) then raise exception 'TRIAL_USED'; end if;
  v_until := now() + make_interval(days => coalesce((o->>'trial_days')::int, 3));
  insert into public.user_inventory (user_id, item_id, acquired_reason, expires_at) values (v_uid, i.id, 'TRIAL', v_until);
  insert into public.item_promo_redemptions (promo_id, user_id, qty, xu_paid, ref) values ((o->>'promo_id')::uuid, v_uid, 1, 0, 'trial:' || v_uid || ':' || i.code);
  return jsonb_build_object('code', i.code, 'expires_at', v_until);
end $$;

create or replace function public.buy_item_bundle(p_promo_id uuid, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  p public.item_promotions := (select x from public.item_promotions x where x.id = p_promo_id and x.kind = 'BUNDLE');
  v_price integer;
  c text;
  v_n integer := 0;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if exists (select 1 from public.item_promo_redemptions where ref = 'bundle:' || p_idempotency_key) then
    return jsonb_build_object('duplicate', true, 'balance', private.balance(v_uid));
  end if;
  if p.id is null or not private.promo_live(p) then raise exception 'PROMO_NOT_AVAILABLE'; end if;
  if not private.promo_segment_ok(v_uid, p.segment) then raise exception 'PROMO_NOT_ELIGIBLE'; end if;
  if private.promo_used(p.id, v_uid) >= coalesce(p.per_user_limit, 1) then raise exception 'PROMO_LIMIT_REACHED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('shop:' || v_uid, 0));
  v_price := coalesce(p.fixed_price, 0);
  if v_price > 0 then
    if private.balance(v_uid) < v_price then raise exception 'INSUFFICIENT_BALANCE'; end if;
    perform private.ledger_post('SHOP_ITEM', 'bundle:' || p_idempotency_key, 'Mua gói ' || p.title, v_uid,
      private.debit_entries(v_uid, v_price, private.system_account()));
  end if;
  foreach c in array coalesce(p.bundle_items, '{}') loop
    delete from public.user_inventory x using public.avatar_items i
     where x.user_id = v_uid and x.item_id = i.id and i.code = c and x.acquired_reason = 'TRIAL';
    insert into public.user_inventory (user_id, item_id, acquired_reason)
    select v_uid, i.id, 'PROMO' from public.avatar_items i
     where i.code = c and i.is_active and not exists (select 1 from public.user_inventory x where x.user_id = v_uid and x.item_id = i.id);
    if found then v_n := v_n + 1; end if;
  end loop;
  insert into public.item_promo_redemptions (promo_id, user_id, qty, xu_paid, ref) values (p.id, v_uid, 1, v_price, 'bundle:' || p_idempotency_key);
  return jsonb_build_object('items', v_n, 'paid', v_price, 'balance', private.balance(v_uid));
end $$;

-- Hết hạn dùng thử → tháo khỏi người + xóa khỏi tủ đồ
create or replace function private.expire_trials(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if not exists (select 1 from public.user_inventory where user_id = p_user and expires_at is not null and expires_at <= now()) then return; end if;
  foreach k in array private.character_slots() loop
    execute format('update public.user_equipment e set %1$I = null where e.user_id = $1 and %1$I in
                     (select x.item_id from public.user_inventory x where x.user_id = $1 and x.expires_at is not null and x.expires_at <= now())',
                   k || '_item_id') using p_user;
  end loop;
  delete from public.user_inventory where user_id = p_user and expires_at is not null and expires_at <= now();
end $$;

create or replace function private.ensure_character(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k text; v_id uuid;
begin
  insert into public.user_avatar (user_id) values (p_user) on conflict (user_id) do nothing;
  perform private.expire_trials(p_user);
  perform private.grant_free_items(p_user);
  insert into public.user_equipment (user_id) values (p_user) on conflict (user_id) do nothing;
  foreach k in array private.character_slots() loop
    v_id := (select (to_jsonb(e) ->> (k || '_item_id'))::uuid from public.user_equipment e where e.user_id = p_user);
    if v_id is not null and exists (select 1 from public.avatar_items where id = v_id and is_active) then continue; end if;
    if k = any(private.character_required_slots()) then
      v_id := (select id from public.avatar_items where code = k || '_original');
    else
      if v_id is null then continue; end if;
      v_id := null;
    end if;
    execute format('update public.user_equipment set %I = $1, updated_at = now() where user_id = $2', k || '_item_id') using v_id, p_user;
  end loop;
end $$;

-- Tủ đồ / cửa hàng kèm chương trình đang áp + hạn dùng thử + gói đang bán
create or replace function public.character_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); v_items jsonb;
begin
  perform private.ensure_character(v_uid);
  v_items := (select coalesce(jsonb_agg(private.item_json(i) || jsonb_build_object(
                  'owned', inv.item_id is not null and inv.acquired_reason <> 'TRIAL',
                  'trial_until', case when inv.acquired_reason = 'TRIAL' then inv.expires_at end,
                  'offer', private.item_offer(v_uid, 'AVATAR', i.code, i.price_xu, 1)) order by i.category, i.sort, i.name), '[]'::jsonb)
                from public.avatar_items i
                left join public.user_inventory inv on inv.item_id = i.id and inv.user_id = v_uid
               where i.is_active and i.code is not null);
  return (private.character_look(v_uid) - 'items') || jsonb_build_object(
    'level', coalesce((select level from public.profiles where id = v_uid), 1),
    'balance', private.balance(v_uid),
    'gender_set', (select gender is not null from public.profiles where id = v_uid),
    'items', v_items,
    'bundles', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'badge', p.badge, 'price', p.fixed_price,
                  'base', (select coalesce(sum(i.price_xu), 0) from public.avatar_items i where i.code = any (p.bundle_items)),
                  'items', p.bundle_items, 'ends_at', p.ends_at, 'bought', private.promo_used(p.id, v_uid) >= coalesce(p.per_user_limit, 1),
                  'left', case when p.quantity_limit is null then null else p.quantity_limit - private.promo_used(p.id, null) end) order by p.created_at desc), '[]'::jsonb)
                  from public.item_promotions p
                 where p.kind = 'BUNDLE' and private.promo_live(p) and private.promo_segment_ok(v_uid, p.segment)));
end $$;

-- ---------------------------------------------------------------------
-- 4. Quà tặng theo giá khuyến mãi (Tỏa sáng = Xu thực trả)
-- ---------------------------------------------------------------------
create or replace function public.gift_catalog() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'gifts', (select coalesce(jsonb_agg(jsonb_build_object('code', g.code, 'name', g.name, 'emoji', g.emoji, 'price_xu', g.price_xu,
                'tier', g.tier, 'description', g.description, 'vip_tier', g.vip_tier, 'seasonal', g.season_from is not null,
                'locked', g.vip_tier > private.user_vip_tier(auth.uid()),
                'offer', private.item_offer(auth.uid(), 'GIFT', g.code, g.price_xu, 1)) order by g.sort, g.price_xu), '[]'::jsonb)
              from public.gift_catalog g where g.is_active and private.gift_in_season(g, private.vn_day(now()))),
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
  insert into public.cheers (from_user, to_user, amount, list_amount, promo_id, message, activity_id, post_id, club_id, idempotency_key, gift_code, qty)
  values (v_uid, p_to_user, v_total, v_list, v_promo, v_msg, p_activity_id, p_post_id, v_club, p_idempotency_key, g.code, v_qty)
  returning id into v_id;
  if v_promo is not null then
    insert into public.item_promo_redemptions (promo_id, user_id, qty, xu_paid, ref) values (v_promo, v_uid, v_qty, v_total, 'gift:' || p_idempotency_key);
  end if;
  if p_post_id is not null then update public.club_posts set cheer_xu = cheer_xu + v_total where id = p_post_id; end if;

  v_name := private.display_name(v_uid);
  perform private.award(p_to_user, 'GIFT_IN', v_name || ' tặng bạn ' || case when v_qty > 1 then v_qty || ' × ' else '' end || g.emoji || ' ' || g.name,
    v_msg, 0, 0, 'gift_in:' || v_id, p_activity_id, jsonb_build_object('from', v_uid, 'gift', g.code, 'emoji', g.emoji, 'qty', v_qty, 'tier', g.tier));
  perform private.notify(p_to_user, v_club, 'GIFT', v_name || ' tặng bạn ' || case when v_qty > 1 then v_qty || ' × ' else '' end || g.emoji || ' ' || g.name,
    coalesce(v_msg, g.description), case when p_activity_id is not null then '/activities/' || p_activity_id
                                         when v_club is not null then '/clubs/' || v_club else '/me' end, v_uid, g.tier in ('HYPE', 'LEGEND'));
  return jsonb_build_object('gift_id', v_id, 'total_xu', v_total, 'list_xu', v_list, 'emoji', g.emoji, 'tier', g.tier, 'qty', v_qty,
    'balance', private.balance(v_uid));
end $$;

-- ---------------------------------------------------------------------
-- 5. Admin
-- ---------------------------------------------------------------------
create or replace function private.promo_json(p public.item_promotions) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(p) || jsonb_build_object(
    'live', private.promo_live(p), 'sold', private.promo_used(p.id, null),
    'buyers', (select count(distinct r.user_id) from public.item_promo_redemptions r where r.promo_id = p.id),
    'xu_paid', (select coalesce(sum(r.xu_paid), 0) from public.item_promo_redemptions r where r.promo_id = p.id),
    'item_name', case p.item_type when 'AVATAR' then (select i.name from public.avatar_items i where i.code = p.item_code)
                                  when 'GIFT' then (select g.emoji || ' ' || g.name from public.gift_catalog g where g.code = p.item_code) end,
    'base_price', case p.item_type when 'AVATAR' then (select i.price_xu from public.avatar_items i where i.code = p.item_code)
                                   when 'GIFT' then (select g.price_xu from public.gift_catalog g where g.code = p.item_code) end)
$$;

create or replace function public.admin_list_item_promotions() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'promotions', (select coalesce(jsonb_agg(private.promo_json(p) order by private.promo_live(p) desc, p.created_at desc), '[]'::jsonb)
                     from public.item_promotions p where p.created_at >= now() - interval '180 days' or p.is_active),
    'avatar_items', (select coalesce(jsonb_agg(jsonb_build_object('code', i.code, 'name', i.name, 'price_xu', i.price_xu, 'slot', i.category,
                       'rarity', i.rarity) order by i.category, i.price_xu), '[]'::jsonb)
                       from public.avatar_items i where i.is_active and i.code is not null and i.price_xu > 0
                        and coalesce(i.metadata->>'acquire', '') <> 'shine'),
    'gifts', (select coalesce(jsonb_agg(jsonb_build_object('code', g.code, 'name', g.emoji || ' ' || g.name, 'price_xu', g.price_xu) order by g.price_xu), '[]'::jsonb)
                from public.gift_catalog g where g.is_active));
end $$;

create or replace function public.admin_save_item_promotion(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_kind text := upper(coalesce(p->>'kind', ''));
  v_type text := nullif(upper(coalesce(p->>'item_type', '')), '');
  v_code text := nullif(p->>'item_code', '');
  v_items text[];
  v_start timestamptz := coalesce(nullif(p->>'starts_at', '')::timestamptz, now());
  v_end timestamptz := nullif(p->>'ends_at', '')::timestamptz;
  v_pct integer := coalesce((p->>'discount_pct')::int, 0);
  r public.item_promotions;
begin
  if v_kind not in ('FREE', 'TRIAL', 'SALE', 'FLASH', 'BUNDLE', 'EVENT', 'FIRST_PURCHASE', 'COMEBACK') then raise exception 'INVALID_PROMO'; end if;
  if char_length(trim(coalesce(p->>'title', ''))) < 2 then raise exception 'INVALID_PROMO_TITLE'; end if;
  if v_end is not null and v_end <= v_start then raise exception 'INVALID_TIME_RANGE'; end if;
  if v_kind = 'FLASH' and (v_end is null or v_end > v_start + interval '72 hours') then raise exception 'FLASH_TOO_LONG'; end if;
  if v_kind in ('SALE', 'FLASH', 'EVENT', 'FIRST_PURCHASE', 'COMEBACK') and (v_pct < 5 or v_pct > 90) then
    -- quà miễn phí dùng loại FREE; không cho giảm 100% qua SALE
    raise exception 'INVALID_DISCOUNT';
  end if;
  if v_kind = 'BUNDLE' then
    v_items := array(select distinct x from jsonb_array_elements_text(coalesce(p->'bundle_items', '[]'::jsonb)) x);
    if cardinality(v_items) < 2 or cardinality(v_items) > 12
       or exists (select 1 from unnest(v_items) c where not exists (select 1 from public.avatar_items i where i.code = c and i.is_active)) then
      raise exception 'INVALID_BUNDLE';
    end if;
    if coalesce((p->>'fixed_price')::int, -1) < 0 then raise exception 'INVALID_BUNDLE'; end if;
    v_type := null; v_code := null;
  else
    if v_type not in ('AVATAR', 'GIFT') then raise exception 'INVALID_PROMO'; end if;
    if v_type = 'AVATAR' and not exists (select 1 from public.avatar_items i where i.code = v_code and i.is_active) then raise exception 'ITEM_NOT_FOUND'; end if;
    if v_type = 'GIFT' and not exists (select 1 from public.gift_catalog g where g.code = v_code and g.is_active) then raise exception 'GIFT_NOT_AVAILABLE'; end if;
    if v_kind = 'TRIAL' and v_type <> 'AVATAR' then raise exception 'TRIAL_AVATAR_ONLY'; end if;
    if v_kind = 'FREE' and coalesce((p->>'per_user_limit')::int, 0) < 1 then raise exception 'FREE_NEEDS_LIMIT'; end if;   -- chống farm
    -- mỗi vật phẩm chỉ một chương trình đang chạy (khoảng thời gian chồng nhau)
    if exists (select 1 from public.item_promotions x
                where x.is_active and x.item_type = v_type and x.item_code = v_code and x.id is distinct from v_id
                  and x.starts_at < coalesce(v_end, 'infinity'::timestamptz) and coalesce(x.ends_at, 'infinity'::timestamptz) > v_start) then
      raise exception 'PROMO_OVERLAP';
    end if;
  end if;

  insert into public.item_promotions as t (id, kind, title, badge, item_type, item_code, bundle_items, discount_pct, fixed_price, quantity_limit,
    per_user_limit, trial_days, segment, event_key, starts_at, ends_at, is_active, created_by)
  values (coalesce(v_id, gen_random_uuid()), v_kind, trim(p->>'title'), nullif(left(trim(coalesce(p->>'badge', '')), 24), ''), v_type, v_code, v_items,
    case when v_kind in ('FREE', 'TRIAL', 'BUNDLE') then 0 else v_pct end,
    case when v_kind = 'BUNDLE' then (p->>'fixed_price')::int end,
    nullif((p->>'quantity_limit')::int, 0), nullif((p->>'per_user_limit')::int, 0),
    case when v_kind = 'TRIAL' then least(30, greatest(1, coalesce((p->>'trial_days')::int, 3))) end,
    coalesce(nullif(upper(p->>'segment'), ''), case v_kind when 'COMEBACK' then 'COMEBACK' else 'ALL' end),
    nullif(left(trim(coalesce(p->>'event_key', '')), 40), ''), v_start, v_end, coalesce((p->>'is_active')::boolean, true), v_uid)
  on conflict (id) do update set kind = excluded.kind, title = excluded.title, badge = excluded.badge, item_type = excluded.item_type,
    item_code = excluded.item_code, bundle_items = excluded.bundle_items, discount_pct = excluded.discount_pct, fixed_price = excluded.fixed_price,
    quantity_limit = excluded.quantity_limit, per_user_limit = excluded.per_user_limit, trial_days = excluded.trial_days, segment = excluded.segment,
    event_key = excluded.event_key, starts_at = excluded.starts_at, ends_at = excluded.ends_at, is_active = excluded.is_active
  returning * into r;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SAVE_ITEM_PROMO', 'promo:' || r.id, p);
  return private.promo_json(r);
end $$;

create or replace function public.admin_end_item_promotion(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_admin();
begin
  update public.item_promotions set is_active = false, ends_at = least(coalesce(ends_at, now()), now()) where id = p_id;
  insert into public.admin_audit_log (actor_id, action, target) values (v_uid, 'END_ITEM_PROMO', 'promo:' || p_id);
end $$;

revoke all on function private.promo_segment_ok(uuid, text), private.promo_used(uuid, uuid), private.has_purchased(uuid),
  private.promo_live(public.item_promotions), private.item_offer(uuid, text, text, numeric, integer), private.expire_trials(uuid),
  private.promo_json(public.item_promotions) from public, anon, authenticated;
revoke all on function public.buy_avatar_item(text, text), public.try_avatar_item(text), public.buy_item_bundle(uuid, text),
  public.admin_list_item_promotions(), public.admin_save_item_promotion(jsonb), public.admin_end_item_promotion(uuid) from public, anon;
grant execute on function public.buy_avatar_item(text, text), public.try_avatar_item(text), public.buy_item_bundle(uuid, text),
  public.admin_list_item_promotions(), public.admin_save_item_promotion(jsonb), public.admin_end_item_promotion(uuid) to authenticated;

notify pgrst, 'reload schema';
