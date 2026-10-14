-- 016300: Cửa hàng đối tác — đăng sản phẩm (ảnh, giá, biến thể, tồn kho), giỏ hàng / đặt hàng, thanh toán, quản lý đơn.
-- • Đối tác (hồ sơ Chợ Runner, 005300) đăng sản phẩm ngay sau khi tạo hồ sơ; sản phẩm CHỈ hiện cho khách khi hồ sơ đã được xác minh.
-- • Sản phẩm: nhiều ảnh, giá + giá gốc (gạch), danh mục, SKU, biến thể (size / màu… mỗi biến thể có giá + tồn kho riêng).
-- • Khách chọn biến thể, thêm giỏ, đặt hàng: tên, điện thoại, địa chỉ giao. Server tự tính tiền, trừ tồn kho (khoá hàng chống bán lố).
-- • Thanh toán: chuyển khoản VietQR thẳng vào tài khoản của đối tác (nội dung = mã đơn) hoặc COD. RaceHub KHÔNG giữ tiền.
-- • Đối tác: đơn mới → xác nhận tiền → giao (mã vận đơn) → hoàn tất / huỷ (hoàn lại tồn kho). Khách theo dõi trong "Đơn của tôi".
-- Cần 005300, 000500 (private.notify). Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 1. Cài đặt cửa hàng trên hồ sơ đối tác
-- ---------------------------------------------------------------------
alter table public.partners add column if not exists shop_bank_bin text;
alter table public.partners add column if not exists shop_bank_account_no text;
alter table public.partners add column if not exists shop_bank_account_name text;
alter table public.partners add column if not exists ship_fee_vnd integer not null default 0 check (ship_fee_vnd between 0 and 500000);
alter table public.partners add column if not exists free_ship_over_vnd integer check (free_ship_over_vnd is null or free_ship_over_vnd between 0 and 50000000);
alter table public.partners add column if not exists cod_enabled boolean not null default false;
alter table public.partners add column if not exists shop_policy text check (shop_policy is null or char_length(shop_policy) <= 1000);

-- ---------------------------------------------------------------------
-- 2. Bảng sản phẩm / biến thể / đơn hàng
-- ---------------------------------------------------------------------
create table if not exists public.partner_products (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 100),
  description text check (description is null or char_length(description) <= 2000),
  images text[] not null default '{}' check (cardinality(images) <= 8),
  category text check (category is null or char_length(category) <= 30),
  price_vnd integer not null check (price_vnd between 0 and 50000000),
  compare_price_vnd integer check (compare_price_vnd is null or compare_price_vnd between 0 and 50000000),
  sku text check (sku is null or char_length(sku) <= 40),
  stock integer check (stock is null or stock between 0 and 1000000),      -- null = không giới hạn (sản phẩm không có biến thể)
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'HIDDEN')),
  sold integer not null default 0 check (sold >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists partner_products_partner_idx on public.partner_products (partner_id, status, created_at desc);

create table if not exists public.partner_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.partner_products(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  price_vnd integer check (price_vnd is null or price_vnd between 0 and 50000000),   -- null = dùng giá sản phẩm
  stock integer check (stock is null or stock between 0 and 1000000),
  sku text check (sku is null or char_length(sku) <= 40),
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists partner_variants_product_idx on public.partner_variants (product_id, position);

create table if not exists public.partner_orders (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  code text not null unique,
  items jsonb not null,                         -- ảnh chụp lúc đặt: [{product_id, variant_id, title, variant, price_vnd, qty, image}]
  quantity integer not null check (quantity between 1 and 200),
  subtotal_vnd bigint not null check (subtotal_vnd >= 0),
  ship_fee_vnd integer not null default 0 check (ship_fee_vnd >= 0),
  amount_vnd bigint not null check (amount_vnd >= 0),
  buyer_name text not null check (char_length(buyer_name) between 2 and 60),
  buyer_phone text not null check (buyer_phone ~ '^(0|\+84)[0-9]{9,10}$'),
  ship_address text not null check (char_length(ship_address) between 8 and 250),
  note text check (note is null or char_length(note) <= 300),
  payment_method text not null check (payment_method in ('BANK', 'COD')),
  status text not null default 'PENDING' check (status in ('PENDING', 'PAID', 'SHIPPING', 'DONE', 'CANCELLED')),
  status_note text,
  tracking_code text check (tracking_code is null or char_length(tracking_code) <= 60),
  paid_at timestamptz,
  shipped_at timestamptz,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists partner_orders_partner_idx on public.partner_orders (partner_id, created_at desc);
create index if not exists partner_orders_user_idx on public.partner_orders (user_id, created_at desc);

alter table public.partner_products enable row level security;
alter table public.partner_variants enable row level security;
alter table public.partner_orders enable row level security;
revoke all on public.partner_products, public.partner_variants, public.partner_orders from anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Hàm nội bộ
-- ---------------------------------------------------------------------
create or replace function private.shop_bank(p public.partners) returns jsonb
language sql immutable as $$
  select case when p.shop_bank_bin is null or p.shop_bank_account_no is null then null
              else jsonb_build_object('bin', p.shop_bank_bin, 'account_no', p.shop_bank_account_no, 'account_name', p.shop_bank_account_name) end
$$;

create or replace function private.shop_settings_json(p public.partners, p_owner boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ship_fee_vnd', p.ship_fee_vnd, 'free_ship_over_vnd', p.free_ship_over_vnd, 'cod_enabled', p.cod_enabled,
    'shop_policy', p.shop_policy, 'bank_ready', p.shop_bank_bin is not null and p.shop_bank_account_no is not null)
    || case when p_owner then jsonb_build_object('bank', private.shop_bank(p)) else '{}'::jsonb end
$$;

create or replace function private.shop_product_json(pr public.partner_products) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', pr.id, 'partner_id', pr.partner_id, 'title', pr.title, 'description', pr.description,
    'images', to_jsonb(pr.images), 'category', pr.category, 'price_vnd', pr.price_vnd, 'compare_price_vnd', pr.compare_price_vnd,
    'sku', pr.sku, 'stock', pr.stock, 'status', pr.status, 'sold', pr.sold, 'created_at', pr.created_at,
    'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'price_vnd', coalesce(v.price_vnd, pr.price_vnd),
                    'own_price', v.price_vnd, 'stock', v.stock, 'sku', v.sku) order by v.position, v.created_at)
                  from public.partner_variants v where v.product_id = pr.id), '[]'::jsonb),
    'price_min', coalesce((select min(coalesce(v.price_vnd, pr.price_vnd)) from public.partner_variants v where v.product_id = pr.id), pr.price_vnd),
    'price_max', coalesce((select max(coalesce(v.price_vnd, pr.price_vnd)) from public.partner_variants v where v.product_id = pr.id), pr.price_vnd),
    'in_stock', case when exists (select 1 from public.partner_variants v where v.product_id = pr.id)
                     then exists (select 1 from public.partner_variants v where v.product_id = pr.id and (v.stock is null or v.stock > 0))
                     else (pr.stock is null or pr.stock > 0) end)
$$;

create or replace function private.shop_order_json(o public.partner_orders) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', o.id, 'partner_id', o.partner_id, 'shop_name', (select p.name from public.partners p where p.id = o.partner_id),
    'user_id', o.user_id, 'code', o.code, 'items', o.items, 'quantity', o.quantity, 'subtotal_vnd', o.subtotal_vnd, 'ship_fee_vnd', o.ship_fee_vnd,
    'amount_vnd', o.amount_vnd, 'buyer_name', o.buyer_name, 'buyer_phone', o.buyer_phone, 'ship_address', o.ship_address, 'note', o.note,
    'payment_method', o.payment_method, 'status', o.status, 'status_note', o.status_note, 'tracking_code', o.tracking_code,
    'paid_at', o.paid_at, 'shipped_at', o.shipped_at, 'done_at', o.done_at, 'created_at', o.created_at,
    'bank', case when o.payment_method = 'BANK' and o.status = 'PENDING'
                 then (select private.shop_bank(p) from public.partners p where p.id = o.partner_id) end)
$$;

-- Hoàn lại tồn kho + số đã bán khi đơn bị huỷ
create or replace function private.shop_restore_stock(o public.partner_orders) returns void
language plpgsql security definer set search_path = public as $$
declare i jsonb;
begin
  for i in select e from jsonb_array_elements(o.items) e loop
    if nullif(i->>'variant_id', '') is not null then
      update public.partner_variants set stock = stock + (i->>'qty')::int where id = (i->>'variant_id')::uuid and stock is not null;
    else
      update public.partner_products set stock = stock + (i->>'qty')::int where id = (i->>'product_id')::uuid and stock is not null;
    end if;
    update public.partner_products set sold = greatest(sold - (i->>'qty')::int, 0) where id = (i->>'product_id')::uuid;
  end loop;
end $$;

-- Hồ sơ đối tác: thêm số sản phẩm đang bán (hiện trên danh sách Chợ)
create or replace function private.partner_json(p public.partners, p_full boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'kind', p.kind, 'name', p.name, 'tagline', p.tagline, 'avatar_url', p.avatar_url, 'cover_url', p.cover_url,
    'area', p.area, 'specialties', to_jsonb(p.specialties), 'verified', p.status = 'APPROVED' and p.verified_at is not null,
    'status', p.status, 'is_mine', p.owner_id = auth.uid(),
    'services_count', jsonb_array_length(p.services),
    'products_count', (select count(*) from public.partner_products x where x.partner_id = p.id and x.status = 'ACTIVE'),
    'owner', jsonb_build_object('id', p.owner_id, 'display_name', private.display_name(p.owner_id),
                                'avatar_url', (select x.avatar_url from public.profiles x where x.id = p.owner_id)))
    || case when p_full then jsonb_build_object('bio', p.bio, 'address', p.address, 'services', p.services, 'contacts', p.contacts,
         'review_note', case when p.owner_id = auth.uid() or public.is_system_admin() then p.review_note end,
         'stats', case when p.kind = 'COACH' then private.partner_runner_stats(p.owner_id) end,
         'updated_at', p.updated_at) else '{}'::jsonb end
$$;

-- ---------------------------------------------------------------------
-- 4. RPC — cửa hàng & sản phẩm
-- ---------------------------------------------------------------------
-- Cửa hàng của một đối tác: cài đặt + sản phẩm (khách: chỉ hàng đang bán, hồ sơ phải được xác minh)
create or replace function public.partner_shop(p_partner_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  p public.partners := (select x from public.partners x where x.id = p_partner_id);
  v_mine boolean;
begin
  if p.id is null then raise exception 'SHOP_NOT_FOUND'; end if;
  v_mine := p.owner_id = auth.uid();
  if p.status <> 'APPROVED' and not v_mine and not public.is_system_admin() then raise exception 'SHOP_NOT_FOUND'; end if;
  return jsonb_build_object(
    'partner', jsonb_build_object('id', p.id, 'name', p.name, 'avatar_url', p.avatar_url, 'area', p.area, 'kind', p.kind, 'status', p.status,
                                  'verified', p.status = 'APPROVED' and p.verified_at is not null, 'is_mine', v_mine),
    'settings', private.shop_settings_json(p, v_mine),
    'products', coalesce((select jsonb_agg(private.shop_product_json(x) order by (x.status = 'ACTIVE') desc, x.created_at desc)
                  from public.partner_products x where x.partner_id = p.id and (x.status = 'ACTIVE' or v_mine)), '[]'::jsonb));
end $$;

create or replace function public.get_shop_product(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  pr public.partner_products := (select x from public.partner_products x where x.id = p_id);
  p public.partners := (select x from public.partners x where x.id = pr.partner_id);
  v_mine boolean;
begin
  if pr.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
  v_mine := p.owner_id = auth.uid();
  if not v_mine and not public.is_system_admin() and (pr.status <> 'ACTIVE' or p.status <> 'APPROVED') then raise exception 'PRODUCT_NOT_FOUND'; end if;
  return jsonb_build_object(
    'product', private.shop_product_json(pr),
    'partner', jsonb_build_object('id', p.id, 'name', p.name, 'avatar_url', p.avatar_url, 'area', p.area, 'kind', p.kind, 'status', p.status,
                                  'verified', p.status = 'APPROVED' and p.verified_at is not null, 'is_mine', v_mine),
    'settings', private.shop_settings_json(p, v_mine));
end $$;

create or replace function public.save_partner_shop(p_partner_id uuid, s jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  p public.partners := (select x from public.partners x where x.id = p_partner_id);
  b jsonb := s->'bank';
  v_bin text; v_acc text; v_name text;
  v_fee integer := coalesce(nullif(s->>'ship_fee_vnd', '')::int, 0);
  v_free integer := nullif(s->>'free_ship_over_vnd', '')::int;
begin
  if p.id is null or p.owner_id <> v_uid then raise exception 'FORBIDDEN'; end if;
  if v_fee not between 0 and 500000 or (v_free is not null and v_free not between 0 and 50000000) then raise exception 'INVALID_SHIPPING'; end if;
  if b is not null and jsonb_typeof(b) = 'object' and coalesce(b->>'bin', '') <> '' then
    v_bin := b->>'bin'; v_acc := b->>'account_no'; v_name := upper(trim(coalesce(b->>'account_name', '')));
    if v_bin !~ '^\d{6}$' or coalesce(v_acc, '') !~ '^[0-9A-Za-z]{4,20}$' or char_length(v_name) not between 2 and 60 then raise exception 'INVALID_BANK'; end if;
  end if;
  update public.partners set ship_fee_vnd = v_fee, free_ship_over_vnd = v_free, cod_enabled = coalesce((s->>'cod_enabled')::boolean, false),
    shop_policy = nullif(left(trim(coalesce(s->>'shop_policy', '')), 1000), ''),
    shop_bank_bin = v_bin, shop_bank_account_no = v_acc, shop_bank_account_name = v_name
  where id = p.id;
  p := (select x from public.partners x where x.id = p.id);
  return private.shop_settings_json(p, true);
end $$;

create or replace function public.save_partner_product(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_old public.partner_products := (select x from public.partner_products x where x.id = v_id);
  v_partner uuid := coalesce(v_old.partner_id, nullif(p->>'partner_id', '')::uuid);
  v_owner uuid := (select x.owner_id from public.partners x where x.id = v_partner);
  v_images text[];
  v_price integer;
  v_compare integer := nullif(p->>'compare_price_vnd', '')::int;
  v_status text := coalesce(nullif(p->>'status', ''), 'ACTIVE');
  v_vars jsonb := coalesce(p->'variants', '[]'::jsonb);
  v_keep uuid[] := '{}';
  v jsonb;
  v_vid uuid;
  v_pos integer := 0;
  r public.partner_products;
begin
  if v_partner is null or v_owner is distinct from v_uid then raise exception 'FORBIDDEN'; end if;
  if char_length(trim(coalesce(p->>'title', ''))) not between 2 and 100 then raise exception 'INVALID_PRODUCT'; end if;
  v_price := coalesce(nullif(p->>'price_vnd', '')::int, -1);
  if v_price not between 0 and 50000000 or (v_compare is not null and (v_compare not between 0 and 50000000 or v_compare <= v_price)) then raise exception 'INVALID_PRICE'; end if;
  if v_status not in ('ACTIVE', 'HIDDEN') then raise exception 'INVALID_PRODUCT'; end if;
  if jsonb_typeof(v_vars) <> 'array' then v_vars := '[]'::jsonb; end if;
  if jsonb_array_length(v_vars) > 30 then raise exception 'TOO_MANY_VARIANTS'; end if;
  if jsonb_array_length(coalesce(p->'images', '[]'::jsonb)) > 8 then raise exception 'TOO_MANY_IMAGES'; end if;
  v_images := array(select u from jsonb_array_elements_text(coalesce(p->'images', '[]'::jsonb)) with ordinality t(u, o) where trim(u) <> '' order by o);
  if exists (select 1 from unnest(v_images) u where not private.market_media_ok(v_uid, u)) then raise exception 'INVALID_PARTNER_IMAGE'; end if;
  if v_old.id is null and (select count(*) from public.partner_products x where x.partner_id = v_partner) >= 200 then raise exception 'TOO_MANY_PRODUCTS'; end if;

  if v_old.id is null then
    v_id := gen_random_uuid();
    insert into public.partner_products (id, partner_id, title, description, images, category, price_vnd, compare_price_vnd, sku, stock, status)
    values (v_id, v_partner, trim(p->>'title'), nullif(left(trim(coalesce(p->>'description', '')), 2000), ''), v_images,
            nullif(left(trim(coalesce(p->>'category', '')), 30), ''), v_price, v_compare, nullif(left(trim(coalesce(p->>'sku', '')), 40), ''),
            nullif(p->>'stock', '')::int, v_status);
  else
    update public.partner_products set title = trim(p->>'title'), description = nullif(left(trim(coalesce(p->>'description', '')), 2000), ''),
      images = v_images, category = nullif(left(trim(coalesce(p->>'category', '')), 30), ''), price_vnd = v_price, compare_price_vnd = v_compare,
      sku = nullif(left(trim(coalesce(p->>'sku', '')), 40), ''), stock = nullif(p->>'stock', '')::int, status = v_status, updated_at = now()
    where id = v_id;
  end if;

  -- biến thể: giữ id cũ nếu có, thêm mới, xoá cái không còn trong danh sách
  for v in select e from jsonb_array_elements(v_vars) e loop
    if char_length(trim(coalesce(v->>'name', ''))) < 1 then continue; end if;
    v_pos := v_pos + 1;
    v_vid := (select x.id from public.partner_variants x where x.id = nullif(v->>'id', '')::uuid and x.product_id = v_id);
    if coalesce(nullif(v->>'price_vnd', '')::int, 0) not between 0 and 50000000 or coalesce(nullif(v->>'stock', '')::int, 0) not between 0 and 1000000 then
      raise exception 'INVALID_VARIANT';
    end if;
    if v_vid is null then
      v_vid := gen_random_uuid();
      insert into public.partner_variants (id, product_id, name, price_vnd, stock, sku, position)
      values (v_vid, v_id, left(trim(v->>'name'), 60), nullif(v->>'price_vnd', '')::int, nullif(v->>'stock', '')::int,
              nullif(left(trim(coalesce(v->>'sku', '')), 40), ''), v_pos);
    else
      update public.partner_variants set name = left(trim(v->>'name'), 60), price_vnd = nullif(v->>'price_vnd', '')::int,
        stock = nullif(v->>'stock', '')::int, sku = nullif(left(trim(coalesce(v->>'sku', '')), 40), ''), position = v_pos
      where id = v_vid;
    end if;
    v_keep := v_keep || v_vid;
  end loop;
  delete from public.partner_variants where product_id = v_id and not (id = any (v_keep));

  r := (select x from public.partner_products x where x.id = v_id);
  return private.shop_product_json(r);
end $$;

create or replace function public.delete_partner_product(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  pr public.partner_products := (select x from public.partner_products x where x.id = p_id);
begin
  if pr.id is null or (select x.owner_id from public.partners x where x.id = pr.partner_id) is distinct from v_uid then raise exception 'FORBIDDEN'; end if;
  delete from public.partner_products where id = pr.id;
end $$;

-- ---------------------------------------------------------------------
-- 5. RPC — đặt hàng, đơn của tôi, quản lý đơn
-- ---------------------------------------------------------------------
create or replace function public.place_partner_order(p_partner_id uuid, p_items jsonb, p_buyer jsonb, p_method text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  p public.partners := (select x from public.partners x where x.id = p_partner_id);
  v_method text := upper(coalesce(p_method, ''));
  v_name text := trim(coalesce(p_buyer->>'name', ''));
  v_phone text := regexp_replace(coalesce(p_buyer->>'phone', ''), '[ .-]', '', 'g');
  v_addr text := trim(coalesce(p_buyer->>'address', ''));
  r record;
  pr public.partner_products;
  va public.partner_variants;
  v_has_var boolean;
  v_unit integer;
  v_items jsonb := '[]'::jsonb;
  v_sub bigint := 0;
  v_qty integer := 0;
  v_ship integer;
  v_code text;
  v_id uuid := gen_random_uuid();
  o public.partner_orders;
begin
  if p.id is null or p.status <> 'APPROVED' then raise exception 'SHOP_NOT_FOUND'; end if;
  if p.owner_id = v_uid then raise exception 'OWN_SHOP'; end if;
  if v_method not in ('BANK', 'COD') then raise exception 'INVALID_PAYMENT'; end if;
  if v_method = 'BANK' and private.shop_bank(p) is null then raise exception 'BANK_MISSING'; end if;
  if v_method = 'COD' and not p.cod_enabled then raise exception 'COD_DISABLED'; end if;
  if char_length(v_name) not between 2 and 60 or v_phone !~ '^(0|\+84)[0-9]{9,10}$' or char_length(v_addr) not between 8 and 250 then raise exception 'INVALID_BUYER'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'EMPTY_CART'; end if;
  if jsonb_array_length(p_items) > 40 then raise exception 'EMPTY_CART'; end if;

  -- gộp dòng trùng; khoá hàng theo thứ tự cố định để không deadlock
  for r in
    select (i->>'product_id')::uuid as pid, nullif(i->>'variant_id', '')::uuid as vid, sum(coalesce((i->>'qty')::int, 0))::int as qty
      from jsonb_array_elements(p_items) i group by 1, 2 order by 1, 2
  loop
    if r.qty < 1 or r.qty > 20 then raise exception 'INVALID_QUANTITY'; end if;
    pr := (select x from public.partner_products x where x.id = r.pid and x.partner_id = p.id for update);
    if pr.id is null or pr.status <> 'ACTIVE' then raise exception 'PRODUCT_UNAVAILABLE'; end if;
    v_has_var := exists (select 1 from public.partner_variants x where x.product_id = pr.id);
    if v_has_var then
      if r.vid is null then raise exception 'VARIANT_REQUIRED'; end if;
      va := (select x from public.partner_variants x where x.id = r.vid and x.product_id = pr.id for update);
      if va.id is null then raise exception 'PRODUCT_UNAVAILABLE'; end if;
      if va.stock is not null and va.stock < r.qty then raise exception 'OUT_OF_STOCK: %', pr.title || ' (' || va.name || ')'; end if;
      if va.stock is not null then update public.partner_variants set stock = stock - r.qty where id = va.id; end if;
      v_unit := coalesce(va.price_vnd, pr.price_vnd);
    else
      if r.vid is not null then raise exception 'PRODUCT_UNAVAILABLE'; end if;
      if pr.stock is not null and pr.stock < r.qty then raise exception 'OUT_OF_STOCK: %', pr.title; end if;
      if pr.stock is not null then update public.partner_products set stock = stock - r.qty where id = pr.id; end if;
      v_unit := pr.price_vnd;
    end if;
    update public.partner_products set sold = sold + r.qty where id = pr.id;
    v_items := v_items || jsonb_build_object('product_id', pr.id, 'variant_id', case when v_has_var then va.id end, 'title', pr.title,
      'variant', case when v_has_var then va.name end, 'price_vnd', v_unit, 'qty', r.qty, 'image', pr.images[1]);
    v_sub := v_sub + v_unit::bigint * r.qty;
    v_qty := v_qty + r.qty;
  end loop;

  v_ship := case when p.free_ship_over_vnd is not null and v_sub >= p.free_ship_over_vnd then 0 else p.ship_fee_vnd end;
  loop
    v_code := 'RH' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from public.partner_orders x where x.code = v_code);
  end loop;
  insert into public.partner_orders (id, partner_id, user_id, code, items, quantity, subtotal_vnd, ship_fee_vnd, amount_vnd, buyer_name, buyer_phone,
                                     ship_address, note, payment_method)
  values (v_id, p.id, v_uid, v_code, v_items, v_qty, v_sub, v_ship, v_sub + v_ship, v_name, v_phone, v_addr,
          nullif(left(trim(coalesce(p_note, '')), 300), ''), v_method);
  o := (select t from public.partner_orders t where t.id = v_id);
  perform private.notify(p.owner_id, null, 'MARKET', 'Đơn mới ' || v_code || ' · ' || to_char(o.amount_vnd, 'FM999G999G999') || 'đ',
    v_name || ' đặt ' || v_qty || ' sản phẩm. Mở "Quản lý cửa hàng" để xác nhận.', '/market/me/shop/' || p.id, v_uid, true);
  return private.shop_order_json(o);
end $$;

create or replace function public.my_partner_orders() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(private.shop_order_json(o) order by o.created_at desc), '[]'::jsonb) from public.partner_orders o where o.user_id = auth.uid()
$$;

create or replace function public.cancel_my_partner_order(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  o public.partner_orders := (select x from public.partner_orders x where x.id = p_order_id for update);
begin
  if o.id is null or o.user_id is distinct from v_uid then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.status <> 'PENDING' then raise exception 'ORDER_LOCKED'; end if;
  update public.partner_orders set status = 'CANCELLED', status_note = 'Người mua huỷ' where id = o.id;
  perform private.shop_restore_stock(o);
  o := (select t from public.partner_orders t where t.id = o.id);
  perform private.notify((select p.owner_id from public.partners p where p.id = o.partner_id), null, 'MARKET', 'Đơn ' || o.code || ' đã bị khách huỷ',
    o.buyer_name, '/market/me/shop/' || o.partner_id, v_uid, true);
  return private.shop_order_json(o);
end $$;

create or replace function public.partner_orders_admin(p_partner_id uuid, p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p public.partners := (select x from public.partners x where x.id = p_partner_id);
begin
  if p.id is null or p.owner_id is distinct from auth.uid() then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'orders', coalesce((select jsonb_agg(private.shop_order_json(o) order by o.created_at desc) from public.partner_orders o
                         where o.partner_id = p.id and (p_status is null or o.status = upper(p_status))), '[]'::jsonb),
    'totals', (select jsonb_build_object('pending', count(*) filter (where o.status = 'PENDING'), 'paid', count(*) filter (where o.status = 'PAID'),
                        'shipping', count(*) filter (where o.status = 'SHIPPING'), 'done', count(*) filter (where o.status = 'DONE'),
                        'revenue_vnd', coalesce(sum(o.amount_vnd) filter (where o.status in ('PAID', 'SHIPPING', 'DONE')), 0),
                        'awaiting_vnd', coalesce(sum(o.amount_vnd) filter (where o.status = 'PENDING'), 0))
                 from public.partner_orders o where o.partner_id = p.id));
end $$;

create or replace function public.set_partner_order_status(p_order_id uuid, p_status text, p_note text default null, p_tracking text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  o public.partner_orders := (select x from public.partner_orders x where x.id = p_order_id for update);
  v_to text := upper(coalesce(p_status, ''));
begin
  if o.id is null or (select x.owner_id from public.partners x where x.id = o.partner_id) is distinct from v_uid then raise exception 'FORBIDDEN'; end if;
  if not ((o.status = 'PENDING' and v_to in ('PAID', 'SHIPPING', 'CANCELLED')) or (o.status = 'PAID' and v_to in ('SHIPPING', 'DONE', 'CANCELLED'))
          or (o.status = 'SHIPPING' and v_to in ('DONE', 'CANCELLED'))) then
    raise exception 'INVALID_STATUS';
  end if;
  if v_to = 'SHIPPING' and o.payment_method = 'BANK' and o.status = 'PENDING' then raise exception 'PAYMENT_NOT_CONFIRMED'; end if;
  update public.partner_orders set status = v_to, status_note = nullif(left(trim(coalesce(p_note, '')), 200), ''),
    tracking_code = case when v_to = 'SHIPPING' then nullif(left(trim(coalesce(p_tracking, '')), 60), '') else tracking_code end,
    paid_at = case when v_to = 'PAID' then coalesce(paid_at, now()) else paid_at end,
    shipped_at = case when v_to = 'SHIPPING' then now() else shipped_at end,
    done_at = case when v_to = 'DONE' then now() else done_at end
  where id = o.id;
  if v_to = 'CANCELLED' then perform private.shop_restore_stock(o); end if;
  o := (select t from public.partner_orders t where t.id = o.id);
  if o.user_id is not null then
    perform private.notify(o.user_id, null, 'MARKET',
      case v_to when 'PAID' then 'Cửa hàng đã nhận tiền đơn ' || o.code when 'SHIPPING' then 'Đơn ' || o.code || ' đang được giao'
                when 'DONE' then 'Đơn ' || o.code || ' đã hoàn tất' else 'Đơn ' || o.code || ' đã bị huỷ' end,
      coalesce(nullif(trim(coalesce(p_note, '')), ''), case when v_to = 'SHIPPING' and o.tracking_code is not null then 'Mã vận đơn: ' || o.tracking_code end,
               (select p.name from public.partners p where p.id = o.partner_id)),
      '/market/orders', v_uid, true);
  end if;
  return private.shop_order_json(o);
end $$;

revoke all on function private.shop_bank(public.partners), private.shop_settings_json(public.partners, boolean), private.shop_product_json(public.partner_products),
  private.shop_order_json(public.partner_orders), private.shop_restore_stock(public.partner_orders), private.partner_json(public.partners, boolean)
  from public, anon, authenticated;
revoke all on function public.partner_shop(uuid), public.get_shop_product(uuid), public.save_partner_shop(uuid, jsonb), public.save_partner_product(jsonb),
  public.delete_partner_product(uuid), public.place_partner_order(uuid, jsonb, jsonb, text, text), public.my_partner_orders(),
  public.cancel_my_partner_order(uuid), public.partner_orders_admin(uuid, text), public.set_partner_order_status(uuid, text, text, text) from public, anon;
grant execute on function public.partner_shop(uuid), public.get_shop_product(uuid) to anon, authenticated;
grant execute on function public.save_partner_shop(uuid, jsonb), public.save_partner_product(jsonb), public.delete_partner_product(uuid),
  public.place_partner_order(uuid, jsonb, jsonb, text, text), public.my_partner_orders(), public.cancel_my_partner_order(uuid),
  public.partner_orders_admin(uuid, text), public.set_partner_order_status(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
