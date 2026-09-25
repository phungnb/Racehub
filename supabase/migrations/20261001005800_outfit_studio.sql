-- 005800: Outfit Studio — quản lý trang phục nhân vật 2D không cần sửa code (ADR-017 mở rộng).
-- • Vòng đời vật phẩm: Nháp → Chờ duyệt → Đang bán → Ngừng bán (người đã có vẫn mặc) → Gỡ hẳn.
-- • Bộ sưu tập (mùa, cấp, sự kiện, CLB, tài trợ) để nhóm vật phẩm trong Tủ đồ và Quản trị.
-- • Điều kiện mở khóa: cấp (1–8), huy hiệu, hoàn thành thử thách, chỉ thành viên CLB, khung thời gian bán, giới hạn số lượng.
--   Món 0 Xu có điều kiện (huy hiệu / thử thách / CLB / cấp) được tự phát khi đủ điều kiện.
-- • Vùng in trên áo: logo, tên CLB, dòng phụ, tên runner — vẽ lên áo đã đổi màu, giữ nếp vải (không cần họa sĩ cho từng CLB).
-- • Đồng phục CLB = vật phẩm bình thường (admin đặt giá) nhưng chỉ thành viên CLB mua / mặc được; rời CLB thì tự tháo.
--   Ban quản trị CLB gửi yêu cầu (màu, logo, chữ) → admin duyệt → vật phẩm tự lên Tủ đồ của thành viên.
-- • Áo thật KHÔNG bán ở đây: bán qua Shop đối tác ở Chợ Runner (RaceHub không nhận tiền).
-- Cần 000900, 001000, 001200, 005100. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 1. Bộ sưu tập + cột mới của vật phẩm
-- ---------------------------------------------------------------------
create table if not exists public.avatar_collections (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_]{3,40}$'),
  name text not null check (char_length(name) between 2 and 60),
  description text check (description is null or char_length(description) <= 200),
  kind text not null default 'SEASON' check (kind in ('CORE', 'LEVEL', 'SEASON', 'EVENT', 'CLUB', 'SPONSOR')),
  starts_at timestamptz,
  ends_at timestamptz,
  sort integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.avatar_collections enable row level security;
revoke all on public.avatar_collections from anon, authenticated;

alter table public.avatar_items add column if not exists status text;
alter table public.avatar_items add column if not exists collection_id uuid references public.avatar_collections(id) on delete set null;
alter table public.avatar_items add column if not exists club_id uuid references public.clubs(id) on delete cascade;
alter table public.avatar_items add column if not exists required_badge text;
alter table public.avatar_items add column if not exists required_challenge uuid references public.challenges(id) on delete set null;
alter table public.avatar_items add column if not exists available_from timestamptz;
alter table public.avatar_items add column if not exists available_to timestamptz;
alter table public.avatar_items add column if not exists supply_limit integer;
alter table public.avatar_items add column if not exists print jsonb;
-- Trạng thái của vật phẩm cũ: đang hiện → Đang bán, đang ẩn → Gỡ hẳn (giữ đúng hành vi cũ)
update public.avatar_items set status = case when is_active then 'PUBLISHED' else 'RETIRED' end where status is null;
alter table public.avatar_items alter column status set default 'PUBLISHED';
alter table public.avatar_items alter column status set not null;
alter table public.avatar_items drop constraint if exists avatar_items_status_chk;
alter table public.avatar_items add constraint avatar_items_status_chk check (status in ('DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED', 'RETIRED'));
alter table public.avatar_items drop constraint if exists avatar_items_supply_chk;
alter table public.avatar_items add constraint avatar_items_supply_chk check (supply_limit is null or supply_limit > 0);
-- 8 cấp (kinh tế v2)
alter table public.avatar_items drop constraint if exists avatar_items_unlock_level_check;
alter table public.avatar_items drop constraint if exists avatar_items_unlock_level_chk;
alter table public.avatar_items add constraint avatar_items_unlock_level_chk check (unlock_level between 1 and 8);
create index if not exists avatar_items_club_idx on public.avatar_items (club_id) where club_id is not null;

-- is_active = còn hiển thị / mặc được (Đang bán, Ngừng bán); Nháp / Chờ duyệt / Gỡ hẳn thì ẩn
create or replace function private.avatar_item_status_sync() returns trigger
language plpgsql as $$
begin
  new.is_active := new.status in ('PUBLISHED', 'ARCHIVED');
  return new;
end $$;
drop trigger if exists trg_avatar_item_status on public.avatar_items;
create trigger trg_avatar_item_status before insert or update of status on public.avatar_items
  for each row execute function private.avatar_item_status_sync();

-- ---------------------------------------------------------------------
-- 2. Điều kiện: ai được mua / nhận, ai được mặc
-- ---------------------------------------------------------------------
create or replace function private.is_club_member(p_user uuid, p_club uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.club_members m where m.club_id = p_club and m.user_id = p_user and m.status = 'APPROVED')
$$;

-- null = được mua / nhận; ngược lại là lý do khóa
create or replace function private.item_lock(p_user uuid, i public.avatar_items) returns text
language sql stable security definer set search_path = public as $$
  select case
    when i.status <> 'PUBLISHED' then 'NOT_FOR_SALE'
    when i.club_id is not null and not private.is_club_member(p_user, i.club_id) then 'CLUB_ONLY'
    when coalesce((select p.level from public.profiles p where p.id = p_user), 1) < i.unlock_level then 'LEVEL'
    when i.required_badge is not null and not exists (
      select 1 from public.user_achievements ua join public.achievements a on a.id = ua.achievement_id
       where ua.user_id = p_user and a.code = i.required_badge) then 'BADGE'
    when i.required_challenge is not null and not exists (
      select 1 from public.challenge_participants cp
       where cp.challenge_id = i.required_challenge and cp.profile_id = p_user and cp.completed_at is not null) then 'CHALLENGE'
    when i.available_from is not null and now() < i.available_from then 'NOT_YET'
    when i.available_to is not null and now() > i.available_to then 'ENDED'
    when i.supply_limit is not null and (select count(*) from public.user_inventory v
                                          where v.item_id = i.id and v.acquired_reason <> 'TRIAL') >= i.supply_limit then 'SOLD_OUT'
  end
$$;

-- Mặc được: vật phẩm còn hiển thị, và đồng phục CLB thì phải còn là thành viên
create or replace function private.item_wearable(p_user uuid, p_item uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.avatar_items i where i.id = p_item and i.is_active
                  and (i.club_id is null or private.is_club_member(p_user, i.club_id)))
$$;

create or replace function private.item_json(i public.avatar_items) returns jsonb
language sql immutable as $$
  select jsonb_build_object('code', i.code, 'name', i.name, 'description', i.description, 'slot', i.category, 'rarity', i.rarity,
    'render_kind', i.render_kind, 'layer_urls', i.layer_urls, 'color', i.color, 'price_xu', i.price_xu,
    'unlock_level', i.unlock_level, 'is_default', i.is_default, 'acquire', coalesce(i.metadata->>'acquire', 'xu'),
    'print', i.print, 'status', i.status, 'club_id', i.club_id, 'collection_id', i.collection_id,
    'required_badge', i.required_badge, 'required_challenge', i.required_challenge,
    'available_from', i.available_from, 'available_to', i.available_to, 'supply_limit', i.supply_limit)
$$;

-- Phát đồ 0 Xu khi đủ điều kiện: bộ mặc định, quà cấp, quà huy hiệu / thử thách, đồng phục CLB miễn phí
create or replace function private.grant_free_items(p_user uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare v_rows integer;
begin
  insert into public.user_inventory (user_id, item_id, acquired_reason)
  select p_user, i.id,
         case when i.is_default then 'DEFAULT' when i.club_id is not null then 'CLUB'
              when i.required_badge is not null then 'BADGE' when i.required_challenge is not null then 'CHALLENGE'
              else 'LEVEL_' || i.unlock_level end
    from public.avatar_items i
   where i.is_active and i.status = 'PUBLISHED' and i.code is not null and i.price_xu = 0
     and (i.is_default or i.unlock_level > 1 or i.required_badge is not null or i.required_challenge is not null or i.club_id is not null)
     and private.item_lock(p_user, i) is null
  on conflict (user_id, item_id) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

-- Như 005100 + tháo đồng phục CLB khi không còn là thành viên
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
    if v_id is not null and private.item_wearable(p_user, v_id) then continue; end if;
    if k = any(private.character_required_slots()) then
      v_id := (select id from public.avatar_items where code = k || '_original');
    else
      if v_id is null then continue; end if;
      v_id := null;
    end if;
    execute format('update public.user_equipment set %I = $1, updated_at = now() where user_id = $2', k || '_item_id') using v_id, p_user;
  end loop;
end $$;

-- Như 001000 + chặn mặc đồng phục CLB khi không phải thành viên
create or replace function public.save_character(p_look jsonb, p_equipped jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_gender text := p_look->>'gender';
  k text;
  v_code text;
  v_id uuid;
begin
  perform private.ensure_character(v_uid);
  if v_gender is not null and v_gender not in ('male', 'female') then raise exception 'INVALID_LOOK'; end if;
  update public.user_avatar set gender = coalesce(v_gender, gender), updated_at = now() where user_id = v_uid;

  if p_equipped is not null and jsonb_typeof(p_equipped) = 'object' then
    for k in select jsonb_object_keys(p_equipped) loop
      if not (k = any(private.character_slots())) then raise exception 'INVALID_SLOT'; end if;
      v_code := p_equipped->>k;
      if v_code is null then
        if k = any(private.character_required_slots()) then raise exception 'SLOT_REQUIRED'; end if;
        v_id := null;
      else
        v_id := (select i.id from public.avatar_items i
                   join public.user_inventory inv on inv.item_id = i.id and inv.user_id = v_uid
                  where i.code = v_code and i.category = k and i.is_active);
        if v_id is null then raise exception 'ITEM_NOT_OWNED'; end if;
        if not private.item_wearable(v_uid, v_id) then raise exception 'CLUB_ONLY'; end if;
      end if;
      execute format('update public.user_equipment set %I = $1, updated_at = now() where user_id = $2', k || '_item_id') using v_id, v_uid;
    end loop;
  end if;
  return private.character_look(v_uid);
end $$;

-- ---------------------------------------------------------------------
-- 3. Tủ đồ: như 005100 + ẩn đồ không dành cho mình, kèm lý do khóa, bộ sưu tập, số lượng còn
-- ---------------------------------------------------------------------
create or replace function public.character_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); v_items jsonb;
begin
  perform private.ensure_character(v_uid);
  v_items := (select coalesce(jsonb_agg(private.item_json(i) || jsonb_build_object(
                  'owned', inv.item_id is not null and inv.acquired_reason <> 'TRIAL',
                  'trial_until', case when inv.acquired_reason = 'TRIAL' then inv.expires_at end,
                  'offer', private.item_offer(v_uid, 'AVATAR', i.code, i.price_xu, 1),
                  'lock', case when inv.item_id is null then private.item_lock(v_uid, i) end,
                  'collection', (select jsonb_build_object('code', c.code, 'name', c.name, 'kind', c.kind) from public.avatar_collections c where c.id = i.collection_id),
                  'club_name', (select cl.name from public.clubs cl where cl.id = i.club_id),
                  'left', case when i.supply_limit is not null then greatest(0, i.supply_limit - (select count(*) from public.user_inventory v
                            where v.item_id = i.id and v.acquired_reason <> 'TRIAL')) end)
                order by i.category, i.sort, i.name), '[]'::jsonb)
                from public.avatar_items i
                left join public.user_inventory inv on inv.item_id = i.id and inv.user_id = v_uid
               where i.is_active and i.code is not null
                 -- đã có thì luôn thấy; chưa có: chỉ món đang bán, đồng phục chỉ thành viên CLB thấy
                 and (inv.item_id is not null
                      or (i.status = 'PUBLISHED' and (i.club_id is null or private.is_club_member(v_uid, i.club_id))
                          and (i.available_to is null or i.available_to > now() - interval '1 day'))));
  return (private.character_look(v_uid) - 'items') || jsonb_build_object(
    'level', coalesce((select level from public.profiles where id = v_uid), 1),
    'balance', private.balance(v_uid),
    'gender_set', (select gender is not null from public.profiles where id = v_uid),
    'display_name', private.display_name(v_uid),
    'items', v_items,
    'collections', (select coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'name', c.name, 'kind', c.kind, 'ends_at', c.ends_at) order by c.sort, c.name), '[]'::jsonb)
                      from public.avatar_collections c
                     where c.is_active and (c.starts_at is null or c.starts_at <= now()) and (c.ends_at is null or c.ends_at > now())
                       and exists (select 1 from public.avatar_items i where i.collection_id = c.id and i.status = 'PUBLISHED')),
    'bundles', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'badge', p.badge, 'price', p.fixed_price,
                  'base', (select coalesce(sum(i.price_xu), 0) from public.avatar_items i where i.code = any (p.bundle_items)),
                  'items', p.bundle_items, 'ends_at', p.ends_at, 'bought', private.promo_used(p.id, v_uid) >= coalesce(p.per_user_limit, 1),
                  'left', case when p.quantity_limit is null then null else p.quantity_limit - private.promo_used(p.id, null) end) order by p.created_at desc), '[]'::jsonb)
                  from public.item_promotions p
                 where p.kind = 'BUNDLE' and private.promo_live(p) and private.promo_segment_ok(v_uid, p.segment)));
end $$;

-- Như 005100, điều kiện mở khóa đầy đủ + giới hạn số lượng (khóa theo vật phẩm để không bán quá)
create or replace function public.buy_avatar_item(p_code text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  i public.avatar_items := (select x from public.avatar_items x where x.code = p_code and x.is_active);
  v_lock text;
  o jsonb;
  v_price integer;
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
  if i.supply_limit is not null then perform pg_advisory_xact_lock(hashtextextended('item:' || i.id, 0)); end if;
  v_owned := (select x from public.user_inventory x where x.user_id = v_uid and x.item_id = i.id);
  if v_owned.id is not null and (v_owned.expires_at is null or v_owned.expires_at > now()) and v_owned.acquired_reason <> 'TRIAL' then
    raise exception 'ALREADY_OWNED';
  end if;
  v_lock := private.item_lock(v_uid, i);
  if v_lock is not null then
    raise exception '%', case v_lock when 'LEVEL' then 'LEVEL_TOO_LOW' when 'CLUB_ONLY' then 'CLUB_ONLY' when 'BADGE' then 'BADGE_REQUIRED'
      when 'CHALLENGE' then 'CHALLENGE_REQUIRED' when 'NOT_YET' then 'NOT_YET_AVAILABLE' when 'ENDED' then 'SALE_ENDED'
      when 'SOLD_OUT' then 'SOLD_OUT' else 'NOT_FOR_SALE' end;
  end if;

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

-- ---------------------------------------------------------------------
-- 4. Vùng in trên áo
-- ---------------------------------------------------------------------
-- {logo_url, title, subtitle, personal: NONE|NAME, text_color, font: sport|sans|serif}
create or replace function private.clean_print(p jsonb) returns jsonb
language plpgsql immutable as $$
declare v_logo text := nullif(trim(coalesce(p->>'logo_url', '')), '');
begin
  if p is null or jsonb_typeof(p) <> 'object' then return null; end if;
  if v_logo is not null and v_logo !~ '^(/character/|https://)[^\s"<>]+\.(png|webp|jpe?g)(\?[^\s"<>]*)?$' then raise exception 'INVALID_PRINT'; end if;
  if coalesce(p->>'text_color', '#ffffff') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_PRINT'; end if;
  if coalesce(p->>'personal', 'NONE') not in ('NONE', 'NAME') then raise exception 'INVALID_PRINT'; end if;
  if coalesce(p->>'font', 'sport') not in ('sport', 'sans', 'serif') then raise exception 'INVALID_PRINT'; end if;
  if v_logo is null and nullif(trim(coalesce(p->>'title', '')), '') is null and nullif(trim(coalesce(p->>'subtitle', '')), '') is null
     and coalesce(p->>'personal', 'NONE') = 'NONE' then return null; end if;
  return jsonb_build_object('logo_url', v_logo, 'title', nullif(left(trim(coalesce(p->>'title', '')), 24), ''),
    'subtitle', nullif(left(trim(coalesce(p->>'subtitle', '')), 32), ''), 'personal', coalesce(p->>'personal', 'NONE'),
    'text_color', coalesce(p->>'text_color', '#ffffff'), 'font', coalesce(p->>'font', 'sport'));
end $$;

-- ---------------------------------------------------------------------
-- 5. Quản trị vật phẩm (thay 001200): vòng đời, bộ sưu tập, điều kiện, vùng in
-- ---------------------------------------------------------------------
create or replace function public.admin_save_avatar_item(p_item jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  v_code text := lower(trim(coalesce(p_item->>'code', '')));
  v_name text := trim(coalesce(p_item->>'name', ''));
  v_desc text := nullif(trim(coalesce(p_item->>'description', '')), '');
  v_slot text := p_item->>'slot';
  v_rarity text := coalesce(p_item->>'rarity', 'common');
  v_kind text := coalesce(p_item->>'render_kind', 'TINT');
  v_color text := nullif(p_item->>'color', '');
  v_layers jsonb := case when jsonb_typeof(p_item->'layer_urls') = 'object' then p_item->'layer_urls' end;
  v_price numeric := coalesce((p_item->>'price_xu')::numeric, 0);
  v_level integer := coalesce((p_item->>'unlock_level')::integer, 1);
  v_sort integer := coalesce((p_item->>'sort')::integer, 100);
  v_default boolean := coalesce((p_item->>'is_default')::boolean, false);
  -- tương thích bản cũ: is_active=false (không gửi status) → Gỡ hẳn
  v_status text := upper(coalesce(p_item->>'status', case when (p_item->>'is_active')::boolean is false then 'RETIRED' else 'PUBLISHED' end));
  v_collection uuid := (select c.id from public.avatar_collections c where c.code = nullif(p_item->>'collection', ''));
  v_club uuid := nullif(p_item->>'club_id', '')::uuid;
  v_badge text := nullif(trim(coalesce(p_item->>'required_badge', '')), '');
  v_challenge uuid := nullif(p_item->>'required_challenge', '')::uuid;
  v_from timestamptz := nullif(p_item->>'available_from', '')::timestamptz;
  v_to timestamptz := nullif(p_item->>'available_to', '')::timestamptz;
  v_supply integer := nullif(p_item->>'supply_limit', '')::integer;
  v_print jsonb := private.clean_print(p_item->'print');
  v_old public.avatar_items;
  k text;
  v_url text;
begin
  if v_code !~ '^[a-z0-9_]{3,48}$' then raise exception 'INVALID_CODE'; end if;
  if char_length(v_name) not between 2 and 60 then raise exception 'INVALID_NAME'; end if;
  if v_desc is not null and char_length(v_desc) > 160 then raise exception 'INVALID_DESCRIPTION'; end if;
  if v_slot is null or not (v_slot = any(private.character_slots())) then raise exception 'INVALID_SLOT'; end if;
  if v_rarity not in ('common', 'rare', 'epic', 'legendary') then raise exception 'INVALID_RARITY'; end if;
  if v_price < 0 or v_price > 100000 then raise exception 'INVALID_PRICE'; end if;
  if v_level not between 1 and 8 then raise exception 'INVALID_LEVEL'; end if;
  if v_status not in ('DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED', 'RETIRED') then raise exception 'INVALID_STATUS'; end if;
  if nullif(p_item->>'collection', '') is not null and v_collection is null then raise exception 'COLLECTION_NOT_FOUND'; end if;
  if v_club is not null and not exists (select 1 from public.clubs c where c.id = v_club) then raise exception 'CLUB_NOT_FOUND'; end if;
  if v_badge is not null and not exists (select 1 from public.achievements a where a.code = v_badge) then raise exception 'BADGE_NOT_FOUND'; end if;
  if v_challenge is not null and not exists (select 1 from public.challenges c where c.id = v_challenge) then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if v_from is not null and v_to is not null and v_to <= v_from then raise exception 'INVALID_TIME_RANGE'; end if;
  if v_supply is not null and v_supply < 1 then raise exception 'INVALID_SUPPLY'; end if;
  if v_print is not null and v_slot <> 'top' then raise exception 'PRINT_TOP_ONLY'; end if;

  if v_kind = 'TINT' then
    if not (v_slot = any(private.character_required_slots())) then raise exception 'TINT_SLOT_ONLY'; end if;
    if v_color is not null and v_color !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_COLOR'; end if;
    v_layers := null;
  elsif v_kind = 'LAYER' then
    if v_layers is null or v_layers = '{}'::jsonb then raise exception 'LAYER_REQUIRED'; end if;
    for k in select jsonb_object_keys(v_layers) loop
      if k not in ('male', 'female') then raise exception 'INVALID_LAYER'; end if;
      v_url := v_layers->>k;
      if v_url is null or v_url !~ '^(/character/|https://)[^\s"<>]+\.png(\?[^\s"<>]*)?$' then raise exception 'INVALID_LAYER'; end if;
    end loop;
    v_color := null;
  else
    raise exception 'INVALID_RENDER_KIND';
  end if;

  v_old := (select i from public.avatar_items i where i.code = v_code);
  if v_old.id is not null and v_old.category <> v_slot
     and exists (select 1 from public.user_inventory where item_id = v_old.id) then
    raise exception 'SLOT_LOCKED';
  end if;
  if v_status not in ('PUBLISHED', 'ARCHIVED') and v_code = v_slot || '_original' then raise exception 'ITEM_REQUIRED'; end if;
  -- đã có người sở hữu thì không đưa về Nháp / Chờ duyệt (họ sẽ mất đồ) — dùng Ngừng bán
  if v_old.id is not null and v_status in ('DRAFT', 'REVIEW') and exists (select 1 from public.user_inventory where item_id = v_old.id) then
    raise exception 'ITEM_HAS_OWNERS';
  end if;

  insert into public.avatar_items (code, name, description, category, rarity, asset_url, render_kind, color, layer_urls,
                                   price_xu, unlock_level, sort, is_default, status, collection_id, club_id, required_badge,
                                   required_challenge, available_from, available_to, supply_limit, print)
  values (v_code, v_name, v_desc, v_slot, v_rarity, lower(v_kind), v_kind, v_color, v_layers,
          v_price, v_level, v_sort, v_default, v_status, v_collection, v_club, v_badge, v_challenge, v_from, v_to, v_supply, v_print)
  on conflict (code) where code is not null do update set
    name = excluded.name, description = excluded.description, category = excluded.category, rarity = excluded.rarity,
    render_kind = excluded.render_kind, color = excluded.color, layer_urls = excluded.layer_urls,
    price_xu = excluded.price_xu, unlock_level = excluded.unlock_level, sort = excluded.sort, is_default = excluded.is_default,
    status = excluded.status, collection_id = excluded.collection_id, club_id = excluded.club_id, required_badge = excluded.required_badge,
    required_challenge = excluded.required_challenge, available_from = excluded.available_from, available_to = excluded.available_to,
    supply_limit = excluded.supply_limit, print = excluded.print;

  insert into public.admin_audit_log (actor_id, action, target, old_value, new_value)
  values (v_admin, case when v_old.id is null then 'AVATAR_ITEM_CREATE' else 'AVATAR_ITEM_UPDATE' end, 'avatar_item:' || v_code,
          case when v_old.id is null then null else private.item_json(v_old) end,
          private.item_json((select i from public.avatar_items i where i.code = v_code)));

  return private.item_json((select i from public.avatar_items i where i.code = v_code)) || jsonb_build_object('is_active', v_status in ('PUBLISHED', 'ARCHIVED'));
end $$;

-- Bản cũ (nút Bán / Ẩn): mở bán = Đang bán; ẩn = Gỡ hẳn
create or replace function public.admin_set_avatar_item_active(p_code text, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_admin uuid := private.require_admin(); v_slot text;
begin
  v_slot := (select category from public.avatar_items where code = p_code);
  if v_slot is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if not p_active and p_code = v_slot || '_original' then raise exception 'ITEM_REQUIRED'; end if;
  update public.avatar_items set status = case when p_active then 'PUBLISHED' else 'RETIRED' end where code = p_code;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_admin, case when p_active then 'AVATAR_ITEM_ENABLE' else 'AVATAR_ITEM_DISABLE' end, 'avatar_item:' || p_code,
          jsonb_build_object('is_active', p_active));
end $$;

create or replace function public.admin_set_avatar_item_status(p_code text, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  i public.avatar_items := (select x from public.avatar_items x where x.code = p_code);
  v_status text := upper(coalesce(p_status, ''));
begin
  if i.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if v_status not in ('DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED', 'RETIRED') then raise exception 'INVALID_STATUS'; end if;
  if v_status not in ('PUBLISHED', 'ARCHIVED') and p_code = i.category || '_original' then raise exception 'ITEM_REQUIRED'; end if;
  if v_status in ('DRAFT', 'REVIEW') and exists (select 1 from public.user_inventory where item_id = i.id) then raise exception 'ITEM_HAS_OWNERS'; end if;
  update public.avatar_items set status = v_status where id = i.id;
  insert into public.admin_audit_log (actor_id, action, target, old_value, new_value)
  values (v_admin, 'AVATAR_ITEM_STATUS', 'avatar_item:' || p_code, jsonb_build_object('status', i.status), jsonb_build_object('status', v_status));
end $$;

create or replace function public.admin_list_avatar_items() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(private.item_json(i) || jsonb_build_object(
            'is_active', i.is_active, 'sort', i.sort,
            'owners', (select count(*) from public.user_inventory inv where inv.item_id = i.id),
            'collection', (select c.code from public.avatar_collections c where c.id = i.collection_id),
            'club_name', (select cl.name from public.clubs cl where cl.id = i.club_id),
            'challenge_title', (select ch.title from public.challenges ch where ch.id = i.required_challenge))
          order by i.is_active desc, i.category, i.sort, i.name), '[]'::jsonb)
            from public.avatar_items i where i.code is not null);
end $$;

create or replace function public.admin_list_avatar_collections() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object('items', (select count(*) from public.avatar_items i where i.collection_id = c.id))
            order by c.is_active desc, c.sort, c.name), '[]'::jsonb) from public.avatar_collections c);
end $$;

create or replace function public.admin_save_avatar_collection(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  v_code text := lower(trim(coalesce(p->>'code', '')));
  r public.avatar_collections;
begin
  if v_code !~ '^[a-z0-9_]{3,40}$' then raise exception 'INVALID_CODE'; end if;
  if char_length(trim(coalesce(p->>'name', ''))) < 2 then raise exception 'INVALID_NAME'; end if;
  if coalesce(p->>'kind', 'SEASON') not in ('CORE', 'LEVEL', 'SEASON', 'EVENT', 'CLUB', 'SPONSOR') then raise exception 'INVALID_KIND'; end if;
  if nullif(p->>'starts_at', '') is not null and nullif(p->>'ends_at', '') is not null
     and (p->>'ends_at')::timestamptz <= (p->>'starts_at')::timestamptz then raise exception 'INVALID_TIME_RANGE'; end if;
  insert into public.avatar_collections as t (code, name, description, kind, starts_at, ends_at, sort, is_active)
  values (v_code, left(trim(p->>'name'), 60), nullif(left(trim(coalesce(p->>'description', '')), 200), ''), coalesce(p->>'kind', 'SEASON'),
          nullif(p->>'starts_at', '')::timestamptz, nullif(p->>'ends_at', '')::timestamptz, coalesce((p->>'sort')::int, 100),
          coalesce((p->>'is_active')::boolean, true))
  on conflict (code) do update set name = excluded.name, description = excluded.description, kind = excluded.kind,
    starts_at = excluded.starts_at, ends_at = excluded.ends_at, sort = excluded.sort, is_active = excluded.is_active
  returning * into r;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_admin, 'AVATAR_COLLECTION', 'avatar_collection:' || v_code, to_jsonb(r));
  return to_jsonb(r);
end $$;

-- ---------------------------------------------------------------------
-- 6. Đồng phục CLB: ban quản trị CLB gửi yêu cầu → admin duyệt (đặt giá) → vật phẩm chỉ thành viên CLB mua / mặc
-- ---------------------------------------------------------------------
create table if not exists public.club_uniform_requests (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  name text not null check (char_length(name) between 2 and 60),
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  print jsonb not null,
  note text check (note is null or char_length(note) <= 500),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  review_note text check (review_note is null or char_length(review_note) <= 300),
  item_code text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null
);
create index if not exists club_uniform_requests_idx on public.club_uniform_requests (status, created_at desc);
alter table public.club_uniform_requests enable row level security;
revoke all on public.club_uniform_requests from anon, authenticated;

-- Kho logo đồng phục: uniform-media/<club_id>/<file> — ban quản trị CLB tải lên
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('uniform-media', 'uniform-media', true, 2097152, array['image/png', 'image/webp', 'image/jpeg'])
on conflict (id) do nothing;
drop policy if exists uniform_media_insert on storage.objects;
create policy uniform_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'uniform-media' and (public.is_system_admin() or exists (
    select 1 from public.club_members m where m.club_id::text = (storage.foldername(name))[1]
      and m.user_id = auth.uid() and m.status = 'APPROVED' and m.role in ('OWNER', 'CAPTAIN'))));

create or replace function private.uniform_request_json(r public.club_uniform_requests) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(r) || jsonb_build_object('club_name', (select c.name from public.clubs c where c.id = r.club_id),
    'requested_by_name', private.display_name(r.requested_by),
    'item', (select private.item_json(i) || jsonb_build_object('owners', (select count(*) from public.user_inventory v where v.item_id = i.id))
               from public.avatar_items i where i.code = r.item_code))
$$;

create or replace function public.request_club_uniform(p_club_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_print jsonb := private.clean_print(p->'print');
  r public.club_uniform_requests;
begin
  if not public.club_is_staff(p_club_id) then raise exception 'FORBIDDEN'; end if;
  if char_length(trim(coalesce(p->>'name', ''))) < 2 then raise exception 'INVALID_NAME'; end if;
  if coalesce(p->>'color', '') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_COLOR'; end if;
  if v_print is null then raise exception 'INVALID_PRINT'; end if;
  if v_print->>'logo_url' is not null and v_print->>'logo_url' !~ ('/storage/v1/object/public/uniform-media/' || p_club_id::text || '/') then
    raise exception 'INVALID_PRINT';
  end if;
  if (select count(*) from public.club_uniform_requests x where x.club_id = p_club_id and x.status = 'PENDING') >= 3 then
    raise exception 'TOO_MANY_REQUESTS';
  end if;
  insert into public.club_uniform_requests (club_id, requested_by, name, color, print, note)
  values (p_club_id, v_uid, left(trim(p->>'name'), 60), p->>'color', v_print, nullif(left(trim(coalesce(p->>'note', '')), 500), ''))
  returning * into r;
  return private.uniform_request_json(r);
end $$;

create or replace function public.club_uniforms(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.club_is_staff(p_club_id) and not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(private.uniform_request_json(r) order by r.created_at desc), '[]'::jsonb)
            from public.club_uniform_requests r where r.club_id = p_club_id);
end $$;

create or replace function public.cancel_club_uniform_request(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.club_uniform_requests := (select x from public.club_uniform_requests x where x.id = p_id);
begin
  perform private.require_uid();
  if r.id is null or not public.club_is_staff(r.club_id) then raise exception 'FORBIDDEN'; end if;
  if r.status <> 'PENDING' then raise exception 'REQUEST_CLOSED'; end if;
  update public.club_uniform_requests set status = 'CANCELLED' where id = p_id;
end $$;

create or replace function public.admin_list_uniform_requests(p_status text default 'PENDING') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(private.uniform_request_json(r) order by r.created_at desc), '[]'::jsonb)
            from public.club_uniform_requests r where upper(coalesce(p_status, 'ALL')) = 'ALL' or r.status = upper(p_status));
end $$;

-- APPROVE: p = {price_xu, rarity, name?, code?, collection?, status?} → tạo vật phẩm áo TINT + vùng in, chỉ thành viên CLB
create or replace function public.admin_review_uniform_request(p_id uuid, p_action text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  r public.club_uniform_requests := (select x from public.club_uniform_requests x where x.id = p_id);
  v_code text;
  m record;
begin
  if r.id is null then raise exception 'REQUEST_NOT_FOUND'; end if;
  if r.status <> 'PENDING' then raise exception 'REQUEST_CLOSED'; end if;
  if upper(coalesce(p_action, '')) = 'REJECT' then
    if char_length(trim(coalesce(p->>'note', ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
    update public.club_uniform_requests set status = 'REJECTED', review_note = left(trim(p->>'note'), 300), reviewed_at = now(), reviewed_by = v_admin
     where id = r.id returning * into r;
    if r.requested_by is not null then
      perform private.notify(r.requested_by, r.club_id, 'CLUB_UNIFORM', 'Đồng phục "' || r.name || '" cần chỉnh sửa', r.review_note,
        '/clubs/' || r.club_id || '/settings', v_admin, true);
    end if;
    return private.uniform_request_json(r);
  end if;
  if upper(coalesce(p_action, '')) <> 'APPROVE' then raise exception 'INVALID_ACTION'; end if;

  v_code := lower(coalesce(nullif(p->>'code', ''), 'uni_' || substr(replace(r.id::text, '-', ''), 1, 10)));
  perform public.admin_save_avatar_item(jsonb_build_object(
    'code', v_code, 'name', coalesce(nullif(p->>'name', ''), r.name), 'description', 'Đồng phục ' || (select c.name from public.clubs c where c.id = r.club_id),
    'slot', 'top', 'render_kind', 'TINT', 'color', r.color, 'print', r.print, 'club_id', r.club_id,
    'price_xu', coalesce((p->>'price_xu')::numeric, 0), 'rarity', coalesce(p->>'rarity', 'rare'),
    'collection', p->>'collection', 'status', coalesce(p->>'status', 'PUBLISHED'), 'sort', 10));
  update public.club_uniform_requests set status = 'APPROVED', item_code = v_code, reviewed_at = now(), reviewed_by = v_admin,
    review_note = nullif(left(trim(coalesce(p->>'note', '')), 300), '')
   where id = r.id returning * into r;
  -- báo cả CLB
  for m in select cm.user_id from public.club_members cm where cm.club_id = r.club_id and cm.status = 'APPROVED' loop
    perform private.notify(m.user_id, r.club_id, 'CLUB_UNIFORM', 'CLB có đồng phục mới: ' || r.name,
      case when coalesce((p->>'price_xu')::numeric, 0) > 0 then 'Vào Tủ đồ để mặc đồng phục CLB.' else 'Đã có sẵn trong Tủ đồ của bạn.' end,
      '/character', v_admin, false);
  end loop;
  return private.uniform_request_json(r);
end $$;

revoke all on function private.avatar_item_status_sync(), private.is_club_member(uuid, uuid), private.item_lock(uuid, public.avatar_items),
  private.item_wearable(uuid, uuid), private.clean_print(jsonb), private.uniform_request_json(public.club_uniform_requests) from public, anon, authenticated;
revoke all on function public.admin_set_avatar_item_status(text, text), public.admin_list_avatar_collections(), public.admin_save_avatar_collection(jsonb),
  public.request_club_uniform(uuid, jsonb), public.club_uniforms(uuid), public.cancel_club_uniform_request(uuid),
  public.admin_list_uniform_requests(text), public.admin_review_uniform_request(uuid, text, jsonb) from public, anon;
grant execute on function public.admin_set_avatar_item_status(text, text), public.admin_list_avatar_collections(), public.admin_save_avatar_collection(jsonb),
  public.request_club_uniform(uuid, jsonb), public.club_uniforms(uuid), public.cancel_club_uniform_request(uuid),
  public.admin_list_uniform_requests(text), public.admin_review_uniform_request(uuid, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
