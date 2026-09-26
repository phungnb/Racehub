-- 007900: Cửa hàng CLB — đặt áo, BIB, mũ… ngay trong app (học từ Tucana) mà RaceHub KHÔNG giữ tiền.
-- • Ban quản trị CLB đăng sản phẩm (ảnh, giá, size, hạn chốt đơn, số lượng giới hạn).
-- • Thành viên đặt → app hiện mã VietQR chuyển THẲNG vào tài khoản ngân hàng của CLB (đã khai ở tab Quỹ), nội dung CK
--   là mã đơn. RaceHub chỉ ghi đơn; ban quản trị đối soát sao kê rồi bấm "Đã nhận tiền" → "Đã giao".
-- • Bảng tổng hợp size cho xưởng may, xuất CSV. Không có thanh toán qua RaceHub, không thu phí trên đơn.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT. Chạy lại nhiều lần vẫn an toàn.

create table if not exists public.club_products (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 80),
  description text check (description is null or char_length(description) <= 1000),
  image_url text check (image_url is null or image_url ~ '^https://'),
  price_vnd integer not null check (price_vnd between 0 and 50000000),
  sizes text[] not null default '{}' check (cardinality(sizes) <= 12),
  stock integer check (stock is null or stock between 1 and 100000),
  max_per_order integer not null default 5 check (max_per_order between 1 and 50),
  order_deadline timestamptz,
  status text not null default 'OPEN' check (status in ('OPEN', 'CLOSED', 'HIDDEN')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists club_products_club_idx on public.club_products (club_id, created_at desc);

create table if not exists public.club_orders (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  product_id uuid not null references public.club_products(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  items jsonb not null,                        -- [{ "size": "M", "qty": 2 }]
  quantity integer not null check (quantity between 1 and 50),
  amount_vnd bigint not null check (amount_vnd >= 0),
  note text check (note is null or char_length(note) <= 200),
  code text not null unique,
  status text not null default 'PENDING' check (status in ('PENDING', 'PAID', 'DELIVERED', 'CANCELLED')),
  status_note text,
  paid_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists club_orders_product_idx on public.club_orders (product_id, created_at desc);
create index if not exists club_orders_user_idx on public.club_orders (user_id, created_at desc);

alter table public.club_products enable row level security;
alter table public.club_orders enable row level security;
revoke all on public.club_products, public.club_orders from anon, authenticated;

create or replace function private.club_bank(p_club uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when c.bank_bin is null or c.bank_account_no is null then null
              else jsonb_build_object('bin', c.bank_bin, 'account_no', c.bank_account_no, 'account_name', c.bank_account_name) end
    from public.clubs c where c.id = p_club
$$;

create or replace function private.club_order_json(o public.club_orders) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', o.id, 'product_id', o.product_id, 'product_title', (select p.title from public.club_products p where p.id = o.product_id),
    'user_id', o.user_id, 'buyer', private.display_name(o.user_id), 'items', o.items, 'quantity', o.quantity, 'amount_vnd', o.amount_vnd,
    'note', o.note, 'code', o.code, 'status', o.status, 'status_note', o.status_note, 'paid_at', o.paid_at,
    'delivered_at', o.delivered_at, 'created_at', o.created_at)
$$;

-- Số đã đặt (không tính đơn huỷ) của một sản phẩm
create or replace function private.club_product_sold(p_product uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(sum(o.quantity), 0)::int from public.club_orders o where o.product_id = p_product and o.status <> 'CANCELLED'
$$;

-- Cửa hàng: sản phẩm + đơn của tôi (+ số liệu cho ban quản trị)
create or replace function public.club_shop(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_staff boolean := public.club_is_staff(p_club_id);
begin
  if not public.club_is_member(p_club_id) then raise exception 'NOT_A_MEMBER'; end if;
  return jsonb_build_object(
    'is_staff', v_staff,
    'bank', private.club_bank(p_club_id),
    'products', coalesce((select jsonb_agg(to_jsonb(p) - 'created_by'
                   || jsonb_build_object('sold', private.club_product_sold(p.id),
                        'open', p.status = 'OPEN' and (p.order_deadline is null or p.order_deadline > now())
                                and (p.stock is null or private.club_product_sold(p.id) < p.stock),
                        'pending', case when v_staff then (select count(*) from public.club_orders o where o.product_id = p.id and o.status = 'PENDING') end,
                        'paid', case when v_staff then (select count(*) from public.club_orders o where o.product_id = p.id and o.status in ('PAID', 'DELIVERED')) end)
                   order by (p.status = 'OPEN') desc, p.created_at desc)
                  from public.club_products p where p.club_id = p_club_id and (p.status <> 'HIDDEN' or v_staff)), '[]'::jsonb),
    'my_orders', coalesce((select jsonb_agg(private.club_order_json(o) order by o.created_at desc)
                  from public.club_orders o where o.club_id = p_club_id and o.user_id = v_uid), '[]'::jsonb));
end $$;

create or replace function public.save_club_product(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_club uuid := coalesce((select x.club_id from public.club_products x where x.id = v_id), nullif(p->>'club_id', '')::uuid);
  v_sizes text[] := coalesce((select array_agg(left(trim(s), 10)) from jsonb_array_elements_text(coalesce(p->'sizes', '[]'::jsonb)) s where trim(s) <> ''), '{}');
begin
  if v_club is null or not public.club_is_staff(v_club) then raise exception 'FORBIDDEN'; end if;
  if char_length(trim(coalesce(p->>'title', ''))) not between 2 and 80 then raise exception 'INVALID_TITLE'; end if;
  if coalesce((p->>'price_vnd')::bigint, -1) not between 0 and 50000000 then raise exception 'INVALID_PRICE'; end if;
  if coalesce(p->>'status', 'OPEN') not in ('OPEN', 'CLOSED', 'HIDDEN') then raise exception 'INVALID_STATUS'; end if;
  if v_id is null then
    v_id := gen_random_uuid();
    insert into public.club_products (id, club_id, title, description, image_url, price_vnd, sizes, stock, max_per_order, order_deadline, status, created_by)
    values (v_id, v_club, trim(p->>'title'), nullif(trim(coalesce(p->>'description', '')), ''), nullif(p->>'image_url', ''), (p->>'price_vnd')::int,
            v_sizes, nullif(p->>'stock', '')::int, coalesce(nullif(p->>'max_per_order', '')::int, 5), nullif(p->>'order_deadline', '')::timestamptz,
            coalesce(p->>'status', 'OPEN'), v_uid);
    if coalesce(p->>'status', 'OPEN') = 'OPEN' then
      perform private.notify_club(v_club, false, 'CLUB_SHOP', 'Cửa hàng CLB: ' || trim(p->>'title'),
        'Mở đặt hàng' || case when nullif(p->>'order_deadline', '') is not null
                              then ' tới ' || to_char((p->>'order_deadline')::timestamptz at time zone 'Asia/Ho_Chi_Minh', 'DD/MM') else '' end || '. Xem và đặt ngay trong CLB.',
        '/clubs/' || v_club || '/shop', v_uid);
    end if;
  else
    update public.club_products set title = trim(p->>'title'), description = nullif(trim(coalesce(p->>'description', '')), ''),
      image_url = nullif(p->>'image_url', ''), price_vnd = (p->>'price_vnd')::int, sizes = v_sizes, stock = nullif(p->>'stock', '')::int,
      max_per_order = coalesce(nullif(p->>'max_per_order', '')::int, 5), order_deadline = nullif(p->>'order_deadline', '')::timestamptz,
      status = coalesce(p->>'status', 'OPEN'), updated_at = now()
    where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.place_club_order(p_product_id uuid, p_items jsonb, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_new_id uuid;
  v_uid uuid := private.require_uid();
  pr public.club_products := (select x from public.club_products x where x.id = p_product_id for update);
  v_items jsonb;
  v_qty integer;
  v_code text;
  o public.club_orders;
begin
  if pr.id is null or pr.status = 'HIDDEN' then raise exception 'PRODUCT_NOT_FOUND'; end if;
  if not public.club_is_member(pr.club_id) then raise exception 'NOT_A_MEMBER'; end if;
  if pr.status <> 'OPEN' or (pr.order_deadline is not null and pr.order_deadline <= now()) then raise exception 'ORDERS_CLOSED'; end if;
  if private.club_bank(pr.club_id) is null then raise exception 'CLUB_BANK_MISSING'; end if;
  v_items := (select coalesce(jsonb_agg(jsonb_build_object('size', nullif(trim(coalesce(i->>'size', '')), ''), 'qty', (i->>'qty')::int)), '[]'::jsonb)
                from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i where coalesce((i->>'qty')::int, 0) > 0);
  v_qty := (select coalesce(sum((i->>'qty')::int), 0) from jsonb_array_elements(v_items) i);
  if v_qty < 1 or v_qty > pr.max_per_order then raise exception 'INVALID_QUANTITY'; end if;
  if cardinality(pr.sizes) > 0 and exists (select 1 from jsonb_array_elements(v_items) i where not ((i->>'size') = any (pr.sizes))) then
    raise exception 'INVALID_SIZE';
  end if;
  if pr.stock is not null and private.club_product_sold(pr.id) + v_qty > pr.stock then raise exception 'OUT_OF_STOCK'; end if;
  loop
    v_code := 'RH' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from public.club_orders x where x.code = v_code);
  end loop;
  v_new_id := gen_random_uuid();
  insert into public.club_orders (id, club_id, product_id, user_id, items, quantity, amount_vnd, note, code)
  values (v_new_id, pr.club_id, pr.id, v_uid, v_items, v_qty, pr.price_vnd::bigint * v_qty, nullif(left(trim(coalesce(p_note, '')), 200), ''), v_code);
  o := (select t from public.club_orders t where t.id = v_new_id);
  return private.club_order_json(o) || jsonb_build_object('bank', private.club_bank(pr.club_id));
end $$;

create or replace function public.cancel_my_club_order(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  o public.club_orders := (select x from public.club_orders x where x.id = p_order_id for update);
begin
  if o.id is null or o.user_id is distinct from v_uid then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.status <> 'PENDING' then raise exception 'ORDER_LOCKED'; end if;
  update public.club_orders set status = 'CANCELLED', status_note = 'Người đặt huỷ' where id = o.id;
  o := (select t from public.club_orders t where t.id = o.id);
  return private.club_order_json(o);
end $$;

-- Ban quản trị: danh sách đơn + tổng hợp size
create or replace function public.club_orders_admin(p_product_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pr public.club_products := (select x from public.club_products x where x.id = p_product_id);
begin
  if pr.id is null or not public.club_is_staff(pr.club_id) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'orders', coalesce((select jsonb_agg(private.club_order_json(o) order by o.created_at desc) from public.club_orders o where o.product_id = pr.id), '[]'::jsonb),
    'sizes', coalesce((select jsonb_agg(jsonb_build_object('size', t.size, 'qty', t.qty, 'paid_qty', t.paid_qty) order by t.size)
                from (select coalesce(i->>'size', '—') as size, sum((i->>'qty')::int) as qty,
                             sum(case when o.status in ('PAID', 'DELIVERED') then (i->>'qty')::int else 0 end) as paid_qty
                        from public.club_orders o cross join jsonb_array_elements(o.items) i
                       where o.product_id = pr.id and o.status <> 'CANCELLED'
                       group by coalesce(i->>'size', '—')) t), '[]'::jsonb),
    'totals', (select jsonb_build_object('orders', count(*) filter (where o.status <> 'CANCELLED'),
                        'paid_vnd', coalesce(sum(o.amount_vnd) filter (where o.status in ('PAID', 'DELIVERED')), 0),
                        'pending_vnd', coalesce(sum(o.amount_vnd) filter (where o.status = 'PENDING'), 0))
                 from public.club_orders o where o.product_id = pr.id));
end $$;

create or replace function public.set_club_order_status(p_order_id uuid, p_status text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  o public.club_orders := (select x from public.club_orders x where x.id = p_order_id for update);
  v_to text := upper(coalesce(p_status, ''));
begin
  if o.id is null or not public.club_is_staff(o.club_id) then raise exception 'FORBIDDEN'; end if;
  if not ((o.status = 'PENDING' and v_to in ('PAID', 'CANCELLED')) or (o.status = 'PAID' and v_to in ('DELIVERED', 'PENDING', 'CANCELLED'))
          or (o.status = 'DELIVERED' and v_to = 'PAID')) then
    raise exception 'INVALID_STATUS';
  end if;
  update public.club_orders set status = v_to, status_note = nullif(left(trim(coalesce(p_note, '')), 200), ''),
    paid_at = case when v_to = 'PAID' then coalesce(paid_at, now()) when v_to = 'PENDING' then null else paid_at end,
    delivered_at = case when v_to = 'DELIVERED' then now() when v_to = 'PAID' then null else delivered_at end
  where id = o.id;
  o := (select t from public.club_orders t where t.id = o.id);
  if o.user_id is not null and v_to in ('PAID', 'DELIVERED', 'CANCELLED') then
    perform private.notify(o.user_id, o.club_id, 'CLUB_SHOP',
      case v_to when 'PAID' then 'CLB đã nhận tiền đơn ' || o.code when 'DELIVERED' then 'Đơn ' || o.code || ' đã giao'
                else 'Đơn ' || o.code || ' đã bị huỷ' end,
      coalesce(nullif(trim(coalesce(p_note, '')), ''), (select p.title from public.club_products p where p.id = o.product_id)),
      '/clubs/' || o.club_id || '/shop', v_uid, true);
  end if;
  return private.club_order_json(o);
end $$;

revoke all on function private.club_bank(uuid), private.club_order_json(public.club_orders), private.club_product_sold(uuid) from public, anon, authenticated;
revoke all on function public.club_shop(uuid), public.save_club_product(jsonb), public.place_club_order(uuid, jsonb, text),
  public.cancel_my_club_order(uuid), public.club_orders_admin(uuid), public.set_club_order_status(uuid, text, text) from public, anon;
grant execute on function public.club_shop(uuid), public.save_club_product(jsonb), public.place_club_order(uuid, jsonb, text),
  public.cancel_my_club_order(uuid), public.club_orders_admin(uuid), public.set_club_order_status(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
