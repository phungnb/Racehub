-- 003800: Gói trả phí (VIP Runner 1–3, CLB Pro) + lượt tạo thử thách hằng tháng + nạp Xu + đơn hàng VietQR
--         + quyền tạo giải chạy ảo do admin cấp + giải chạy ảo thu phí theo quy mô.
-- • Giá gói / số lượt tạo / gói nạp Xu nằm trong bảng — admin sửa ở Quản trị → Gói & giá (không phải sửa code).
-- • Lượt tạo (credit) theo từng MỨC QUY MÔ (≤20, ≤50, ≤100…), cấp đầu mỗi tháng, hết tháng là hết (không cộng dồn),
--   không chuyển / bán / đổi Xu. Dùng lại cơ chế "vé tạo miễn phí" (challenge_passes): vé nhỏ nhất đủ quy mô được dùng trước.
-- • Chưa có cổng thanh toán tự động: người mua tạo đơn → chuyển khoản VietQR đúng nội dung mã đơn → admin xác nhận →
--   hệ thống tự kích hoạt gói / cộng Xu nạp. Xu không đổi ra tiền mặt.
-- • Giải chạy ảo: chỉ admin, CLB được cấp quyền (ban quản trị tạo) hoặc cá nhân được cấp quyền. Phí theo số VĐV tối đa,
--   trả bằng ví CLB (giải CLB) hoặc ví cá nhân, hoặc bằng lượt tạo.
-- Cần file 003700. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 1. Bảng giá (admin quản lý)
-- ---------------------------------------------------------------------
create table if not exists public.plans (
  code text primary key,
  name text not null,
  owner_type text not null check (owner_type in ('USER', 'CLUB')),
  tier integer not null default 1,
  description text,
  perks jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  sort integer not null default 0
);
create table if not exists public.plan_prices (
  plan_code text not null references public.plans(code) on delete cascade,
  months integer not null check (months in (1, 3, 6, 12)),
  price_vnd integer not null check (price_vnd between 0 and 1000000000),
  active boolean not null default true,
  primary key (plan_code, months)
);
create table if not exists public.plan_credits (
  plan_code text not null references public.plans(code) on delete cascade,
  capacity integer not null check (capacity between 1 and 10000),
  per_month integer not null check (per_month between 1 and 100),
  primary key (plan_code, capacity)
);
create table if not exists public.xu_packages (
  id uuid primary key default gen_random_uuid(),
  xu integer not null check (xu between 1 and 10000000),
  bonus_xu integer not null default 0 check (bonus_xu between 0 and 10000000),
  price_vnd integer not null check (price_vnd between 1000 and 1000000000),
  active boolean not null default true,
  sort integer not null default 0
);

insert into public.plans (code, name, owner_type, tier, description, perks, sort) values
  ('VIP1', 'Runner Plus', 'USER', 1, 'Trải nghiệm nâng cao, tổ chức nhóm nhỏ',
   '["3 lượt tạo thử thách / tháng (2 × ≤20, 1 × ≤50)", "Huy hiệu VIP + khung hồ sơ", "Bộ trang phục VIP1", "Phân tích xu hướng tuần / tháng (sắp có)"]', 1),
  ('VIP2', 'Runner Pro', 'USER', 2, 'Tổ chức thử thách vừa, phân tích sâu',
   '["5 lượt tạo / tháng (2 × ≤50, 2 × ≤100, 1 × ≤200)", "Mọi quyền lợi Plus", "Mẫu & nhân bản thử thách (sắp có)", "PR 1K → 42K, phân bố pace (sắp có)"]', 2),
  ('VIP3', 'Runner Elite', 'USER', 3, 'Tổ chức cộng đồng, báo cáo cá nhân',
   '["8 lượt tạo / tháng (tới 1 × ≤1.000)", "Mọi quyền lợi Pro", "Huy hiệu / giao diện thử thách riêng (sắp có)", "Xuất báo cáo cá nhân PDF / Excel (sắp có)"]', 3),
  ('CLUB_PRO', 'CLB Pro', 'CLUB', 1, 'Công cụ quản trị cộng đồng — không giới hạn thành viên',
   '["2 lượt tạo thử thách ≤100 người / tháng", "Không giới hạn quản trị viên", "Link mời riêng /c/tên-clb", "Báo cáo chuyên cần xuất Excel", "Ví CLB, thương hiệu CLB"]', 4)
on conflict (code) do nothing;

insert into public.plan_prices (plan_code, months, price_vnd) values
  ('VIP1', 1, 29000), ('VIP1', 12, 299000), ('VIP2', 1, 59000), ('VIP2', 12, 599000), ('VIP3', 1, 99000), ('VIP3', 12, 999000),
  ('CLUB_PRO', 1, 129000), ('CLUB_PRO', 3, 349000), ('CLUB_PRO', 6, 649000), ('CLUB_PRO', 12, 999000)
on conflict (plan_code, months) do nothing;

insert into public.plan_credits (plan_code, capacity, per_month) values
  ('VIP1', 20, 2), ('VIP1', 50, 1),
  ('VIP2', 50, 2), ('VIP2', 100, 2), ('VIP2', 200, 1),
  ('VIP3', 50, 2), ('VIP3', 100, 2), ('VIP3', 200, 2), ('VIP3', 500, 1), ('VIP3', 1000, 1),
  ('CLUB_PRO', 100, 2)
on conflict (plan_code, capacity) do nothing;

insert into public.xu_packages (xu, bonus_xu, price_vnd, sort)
select v.xu, v.bonus, v.price, v.sort from (values (100, 0, 10000, 1), (500, 25, 50000, 2), (1000, 80, 100000, 3),
                                                  (2000, 200, 200000, 4), (5000, 600, 500000, 5)) v(xu, bonus, price, sort)
 where not exists (select 1 from public.xu_packages);

alter table public.plans enable row level security;
alter table public.plan_prices enable row level security;
alter table public.plan_credits enable row level security;
alter table public.xu_packages enable row level security;
revoke all on public.plans, public.plan_prices, public.plan_credits, public.xu_packages from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Đăng ký gói (subscription) + đơn hàng
-- ---------------------------------------------------------------------
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null check (owner_type in ('USER', 'CLUB')),
  owner_id uuid not null,
  plan_code text not null references public.plans(code),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  source text not null check (source in ('ORDER', 'ADMIN')),
  order_id uuid,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists subscriptions_owner_idx on public.subscriptions (owner_id, ends_at desc);

create sequence if not exists public.order_code_seq start 100001;
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('PLAN', 'XU')),
  plan_code text references public.plans(code),
  months integer,
  package_id uuid references public.xu_packages(id),
  owner_type text not null check (owner_type in ('USER', 'CLUB')),
  owner_id uuid not null,
  amount_vnd integer not null check (amount_vnd > 0),
  xu integer not null default 0,
  bonus_xu integer not null default 0,
  status text not null default 'PENDING' check (status in ('PENDING', 'PAID', 'CANCELLED')),
  note text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '3 days',
  paid_at timestamptz,
  confirmed_by uuid references public.profiles(id) on delete set null
);
create index if not exists orders_buyer_idx on public.orders (buyer_id, created_at desc);
create index if not exists orders_status_idx on public.orders (status, created_at desc);

alter table public.subscriptions enable row level security;
alter table public.orders enable row level security;
revoke all on public.subscriptions, public.orders from anon, authenticated;

-- Lượt tạo hằng tháng = vé tạo miễn phí có mã nguồn (không cấp trùng)
alter table public.challenge_passes add column if not exists source_key text;
create unique index if not exists challenge_passes_source_key on public.challenge_passes (source_key) where source_key is not null;

-- Gói đang dùng của một chủ sở hữu (VIP: bậc cao nhất; CLB: CLB_PRO)
create or replace function private.active_plan(p_owner uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select to_jsonb(x) from (
            select s.plan_code, p.name, p.tier, max(s.ends_at) as ends_at,
                   row_number() over (order by p.tier desc, max(s.ends_at) desc) as rn
              from public.subscriptions s join public.plans p on p.code = s.plan_code
             where s.owner_id = p_owner and s.starts_at <= now() and s.ends_at > now()
             group by s.plan_code, p.name, p.tier) x where x.rn = 1), 'null'::jsonb)
$$;

create or replace function private.vn_month_start(p_at timestamptz) returns timestamptz
language sql immutable as $$
  select date_trunc('month', p_at at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh'
$$;

-- Cấp lượt tạo của tháng hiện tại (idempotent)
create or replace function private.issue_credits(p_owner_type text, p_owner uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_plan jsonb := private.active_plan(p_owner);
  v_code text;
  v_until timestamptz;
  v_month timestamptz := private.vn_month_start(now());
  v_next timestamptz := private.vn_month_start(private.vn_month_start(now()) + interval '32 days');
  c record;
  n integer := 0;
begin
  if v_plan <> 'null'::jsonb then
    v_code := v_plan->>'plan_code'; v_until := (v_plan->>'ends_at')::timestamptz;
  elsif p_owner_type = 'CLUB' and private.club_is_pro(p_owner) then           -- CLB Pro do admin bật tay
    v_code := 'CLUB_PRO'; v_until := coalesce((select c.pro_until from public.clubs c where c.id = p_owner), v_next);
  else
    return 0;
  end if;
  for c in select pc.capacity, pc.per_month from public.plan_credits pc where pc.plan_code = v_code loop
    insert into public.challenge_passes (owner_type, owner_id, max_slots, total, remaining, expires_at, note, source_key)
    values (p_owner_type, p_owner, c.capacity, c.per_month, c.per_month, least(v_next, v_until),
            'Lượt tạo ' || (select p.name from public.plans p where p.code = v_code) || ' tháng ' || to_char(v_month at time zone 'Asia/Ho_Chi_Minh', 'MM/YYYY'),
            'credit:' || p_owner || ':' || v_code || ':' || to_char(v_month at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM') || ':' || c.capacity)
    on conflict (source_key) where source_key is not null do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Cron hằng ngày: cấp lượt tháng mới cho mọi gói đang hiệu lực + CLB Pro
create or replace function public.issue_due_credits() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in select distinct s.owner_type, s.owner_id from public.subscriptions s where s.starts_at <= now() and s.ends_at > now()
           union select 'CLUB', c.id from public.clubs c where private.club_is_pro(c.id) loop
    n := n + private.issue_credits(r.owner_type, r.owner_id);
  end loop;
  return n;
end $$;

-- Kích hoạt / gia hạn gói: nối tiếp gói cùng loại còn hạn
create or replace function private.grant_subscription(p_owner_type text, p_owner uuid, p_plan text, p_months integer, p_source text,
                                                       p_order uuid, p_note text, p_by uuid) returns public.subscriptions
language plpgsql security definer set search_path = public as $$
declare
  v_start timestamptz := greatest(now(), coalesce((select max(s.ends_at) from public.subscriptions s
                                                    where s.owner_id = p_owner and s.plan_code = p_plan and s.ends_at > now()), now()));
  v_row public.subscriptions;
  v_name text := (select p.name from public.plans p where p.code = p_plan);
begin
  if v_name is null or (select p.owner_type from public.plans p where p.code = p_plan) <> p_owner_type then raise exception 'INVALID_PLAN'; end if;
  if p_months not in (1, 3, 6, 12) then raise exception 'INVALID_MONTHS'; end if;
  insert into public.subscriptions (owner_type, owner_id, plan_code, starts_at, ends_at, source, order_id, note, created_by)
  values (p_owner_type, p_owner, p_plan, v_start, v_start + make_interval(months => p_months), p_source, p_order, p_note, p_by)
  returning * into v_row;
  if p_plan = 'CLUB_PRO' then
    update public.clubs set plan = 'PRO', pro_until = greatest(coalesce(pro_until, now()), v_row.ends_at) where id = p_owner;
    perform private.notify_club(p_owner, true, 'CLUB_PRO', 'CLB đã lên gói CLB Pro',
      'Hiệu lực tới ' || to_char(v_row.ends_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY') || '.', '/clubs/' || p_owner || '/settings', p_by);
  else
    perform private.notify(p_owner, null, 'VIP', 'Bạn đã là ' || v_name,
      'Hiệu lực tới ' || to_char(v_row.ends_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY') || '. Lượt tạo thử thách tháng này đã được cấp.', '/me/plan', p_by, true);
  end if;
  perform private.issue_credits(p_owner_type, p_owner);
  return v_row;
end $$;

-- ---------------------------------------------------------------------
-- 3. Người dùng: xem bảng giá, gói của tôi, tạo / hủy đơn
-- ---------------------------------------------------------------------
create or replace function private.payment_account() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'bank_bin', (select value from private.app_settings where key = 'pay_bank_bin'),
    'account_no', (select value from private.app_settings where key = 'pay_account_no'),
    'account_name', (select value from private.app_settings where key = 'pay_account_name'))
$$;

create or replace function public.pricing_catalog() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'plans', (select coalesce(jsonb_agg(jsonb_build_object(
                'code', p.code, 'name', p.name, 'owner_type', p.owner_type, 'tier', p.tier, 'description', p.description, 'perks', p.perks,
                'active', p.active,
                'prices', (select coalesce(jsonb_agg(jsonb_build_object('months', pp.months, 'price_vnd', pp.price_vnd, 'active', pp.active)
                                                      order by pp.months), '[]'::jsonb)
                             from public.plan_prices pp where pp.plan_code = p.code and (pp.active or public.is_system_admin())),
                'credits', (select coalesce(jsonb_agg(jsonb_build_object('capacity', pc.capacity, 'per_month', pc.per_month) order by pc.capacity), '[]'::jsonb)
                              from public.plan_credits pc where pc.plan_code = p.code))
              order by p.sort), '[]'::jsonb) from public.plans p where p.active or public.is_system_admin()),
    'packages', (select coalesce(jsonb_agg(to_jsonb(x) order by x.sort, x.xu), '[]'::jsonb) from public.xu_packages x where x.active or public.is_system_admin()),
    'payment', private.payment_account(),
    'xu_vnd', (private.economy_config()->>'xuVnd')::numeric,
    'capacity_tiers', private.economy_config()->'capacityTiers')
$$;

create or replace function private.order_json(o public.orders) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(o) || jsonb_build_object(
    'plan_name', (select p.name from public.plans p where p.code = o.plan_code),
    'owner_name', case o.owner_type when 'CLUB' then (select c.name from public.clubs c where c.id = o.owner_id)
                                    else private.display_name(o.owner_id) end,
    'buyer_name', private.display_name(o.buyer_id),
    'payment', private.payment_account())
$$;

create or replace function public.my_plan() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  perform private.issue_credits('USER', v_uid);
  return jsonb_build_object('plan', private.active_plan(v_uid),
    'credits', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'capacity', p.max_slots, 'remaining', p.remaining, 'total', p.total,
                                                             'expires_at', p.expires_at, 'note', p.note) order by p.max_slots), '[]'::jsonb)
                  from public.challenge_passes p where p.owner_id = v_uid and p.remaining > 0 and (p.expires_at is null or p.expires_at > now())),
    'orders', (select coalesce(jsonb_agg(private.order_json(t.o) order by t.rn), '[]'::jsonb)
                 from (select x as o, row_number() over (order by x.created_at desc) as rn from public.orders x where x.buyer_id = v_uid) t
                where t.rn <= 20));
end $$;

create or replace function public.club_plan_status(p_club_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.club_is_member(p_club_id) then raise exception 'NOT_A_MEMBER'; end if;
  perform private.issue_credits('CLUB', p_club_id);
  return jsonb_build_object('plan', private.active_plan(p_club_id), 'pro', private.club_is_pro(p_club_id),
    'pro_until', (select c.pro_until from public.clubs c where c.id = p_club_id),
    'credits', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'capacity', p.max_slots, 'remaining', p.remaining, 'total', p.total,
                                                             'expires_at', p.expires_at, 'note', p.note) order by p.max_slots), '[]'::jsonb)
                  from public.challenge_passes p where p.owner_id = p_club_id and p.remaining > 0 and (p.expires_at is null or p.expires_at > now())));
end $$;

create or replace function public.create_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_kind text := upper(coalesce(p->>'kind', ''));
  v_plan public.plans := (select x from public.plans x where x.code = p->>'plan_code' and x.active);
  v_months integer := coalesce((p->>'months')::int, 1);
  v_price integer;
  v_pkg public.xu_packages := (select x from public.xu_packages x where x.id = nullif(p->>'package_id', '')::uuid and x.active);
  v_owner uuid;
  v_owner_type text;
  v_id uuid := gen_random_uuid();
begin
  if (select count(*) from public.orders o where o.buyer_id = v_uid and o.status = 'PENDING' and o.expires_at > now()) >= 5 then
    raise exception 'TOO_MANY_PENDING_ORDERS';
  end if;
  if v_kind = 'PLAN' then
    if v_plan.code is null then raise exception 'INVALID_PLAN'; end if;
    v_price := (select pp.price_vnd from public.plan_prices pp where pp.plan_code = v_plan.code and pp.months = v_months and pp.active);
    if v_price is null then raise exception 'INVALID_MONTHS'; end if;
    v_owner_type := v_plan.owner_type;
    if v_owner_type = 'CLUB' then
      v_owner := nullif(p->>'club_id', '')::uuid;
      if v_owner is null or not public.club_is_staff(v_owner) then raise exception 'CLUB_STAFF_REQUIRED'; end if;
    else
      v_owner := v_uid;
    end if;
    insert into public.orders (id, code, buyer_id, kind, plan_code, months, owner_type, owner_id, amount_vnd)
    values (v_id, 'RH' || nextval('public.order_code_seq'), v_uid, 'PLAN', v_plan.code, v_months, v_owner_type, v_owner, v_price);
  elsif v_kind = 'XU' then
    if v_pkg.id is null then raise exception 'INVALID_PACKAGE'; end if;
    insert into public.orders (id, code, buyer_id, kind, package_id, owner_type, owner_id, amount_vnd, xu, bonus_xu)
    values (v_id, 'RH' || nextval('public.order_code_seq'), v_uid, 'XU', v_pkg.id, 'USER', v_uid, v_pkg.price_vnd, v_pkg.xu, v_pkg.bonus_xu);
  else
    raise exception 'INVALID_ORDER';
  end if;
  return private.order_json((select o from public.orders o where o.id = v_id));
end $$;

create or replace function public.cancel_order(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); o public.orders := (select x from public.orders x where x.id = p_order_id for update);
begin
  if o.id is null or (o.buyer_id <> v_uid and not public.is_system_admin()) then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.status <> 'PENDING' then raise exception 'ORDER_NOT_PENDING'; end if;
  update public.orders set status = 'CANCELLED' where id = o.id;
  return private.order_json((select x from public.orders x where x.id = o.id));
end $$;

-- ---------------------------------------------------------------------
-- 4. Admin: xác nhận đơn (kích hoạt gói / cộng Xu nạp), cấp gói tay, sửa bảng giá, tài khoản nhận tiền
-- ---------------------------------------------------------------------
create or replace function public.admin_list_orders(p_status text default 'PENDING') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(private.order_json(t.o) order by t.rn), '[]'::jsonb)
            from (select x as o, row_number() over (order by x.created_at desc) as rn from public.orders x
                   where p_status = 'ALL' or x.status = p_status) t where t.rn <= 100);
end $$;

create or replace function public.admin_confirm_order(p_order_id uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_admin(); o public.orders := (select x from public.orders x where x.id = p_order_id for update);
begin
  if o.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.status = 'PAID' then return private.order_json(o); end if;
  if o.status <> 'PENDING' then raise exception 'ORDER_NOT_PENDING'; end if;
  update public.orders set status = 'PAID', paid_at = now(), confirmed_by = v_uid, note = nullif(trim(coalesce(p_note, '')), '') where id = o.id;
  if o.kind = 'PLAN' then
    perform private.grant_subscription(o.owner_type, o.owner_id, o.plan_code, o.months, 'ORDER', o.id, 'Đơn ' || o.code, v_uid);
  else
    perform private.ledger_post('XU_PURCHASE', 'order:' || o.id, 'Nạp Xu — đơn ' || o.code, v_uid,
      jsonb_build_array(jsonb_build_object('account_id', o.owner_id, 'coin_kind', 'PAID', 'amount', o.xu),
                        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'PAID', 'amount', -o.xu)), o.id);
    if o.bonus_xu > 0 then
      perform private.ledger_post('XU_PURCHASE_BONUS', 'order_bonus:' || o.id, 'Tặng thêm khi nạp — đơn ' || o.code, v_uid,
        jsonb_build_array(jsonb_build_object('account_id', o.owner_id, 'coin_kind', 'BONUS', 'amount', o.bonus_xu),
                          jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -o.bonus_xu)), o.id);
    end if;
    perform private.notify(o.owner_id, null, 'ADMIN_XU', 'Đã nạp ' || (o.xu + o.bonus_xu) || ' Xu', 'Đơn ' || o.code || ' đã được xác nhận.', '/wallet', v_uid, true);
  end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'CONFIRM_ORDER', o.code, jsonb_build_object('kind', o.kind, 'amount_vnd', o.amount_vnd, 'plan', o.plan_code, 'xu', o.xu));
  return private.order_json((select x from public.orders x where x.id = o.id));
end $$;

create or replace function public.admin_grant_plan(p_owner_type text, p_owner_id uuid, p_plan text, p_months integer, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_admin(); s public.subscriptions;
begin
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  s := private.grant_subscription(upper(p_owner_type), p_owner_id, upper(p_plan), p_months, 'ADMIN', null, trim(p_reason), v_uid);
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'GRANT_PLAN', p_owner_id::text, jsonb_build_object('plan', s.plan_code, 'ends_at', s.ends_at, 'reason', trim(p_reason)));
  return to_jsonb(s);
end $$;

create or replace function public.admin_save_plan(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_admin(); v_code text := upper(trim(coalesce(p->>'code', ''))); e jsonb;
begin
  if not exists (select 1 from public.plans x where x.code = v_code) then raise exception 'INVALID_PLAN'; end if;
  update public.plans set name = coalesce(nullif(trim(p->>'name'), ''), name), description = coalesce(p->>'description', description),
         perks = coalesce(p->'perks', perks), active = coalesce((p->>'active')::boolean, active) where code = v_code;
  if p ? 'prices' then
    for e in select value from jsonb_array_elements(p->'prices') loop
      insert into public.plan_prices (plan_code, months, price_vnd, active)
      values (v_code, (e->>'months')::int, (e->>'price_vnd')::int, coalesce((e->>'active')::boolean, true))
      on conflict (plan_code, months) do update set price_vnd = excluded.price_vnd, active = excluded.active;
    end loop;
  end if;
  if p ? 'credits' then
    delete from public.plan_credits where plan_code = v_code;
    insert into public.plan_credits (plan_code, capacity, per_month)
    select v_code, (e->>'capacity')::int, (e->>'per_month')::int from jsonb_array_elements(p->'credits') e where (e->>'per_month')::int > 0;
  end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SAVE_PLAN', v_code, p);
end $$;

create or replace function public.admin_save_xu_package(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_admin(); v_id uuid := coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid());
begin
  insert into public.xu_packages (id, xu, bonus_xu, price_vnd, active, sort)
  values (v_id, (p->>'xu')::int, coalesce((p->>'bonus_xu')::int, 0), (p->>'price_vnd')::int, coalesce((p->>'active')::boolean, true), coalesce((p->>'sort')::int, 0))
  on conflict (id) do update set xu = excluded.xu, bonus_xu = excluded.bonus_xu, price_vnd = excluded.price_vnd, active = excluded.active, sort = excluded.sort;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SAVE_XU_PACKAGE', v_id::text, p);
  return v_id;
end $$;

create or replace function public.admin_set_payment_account(p_bank_bin text, p_account_no text, p_account_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_admin();
begin
  if coalesce(p_bank_bin, '') !~ '^[0-9]{6}$' or coalesce(p_account_no, '') !~ '^[0-9A-Za-z]{4,30}$' or length(trim(coalesce(p_account_name, ''))) < 3 then
    raise exception 'INVALID_BANK';
  end if;
  insert into private.app_settings (key, value) values ('pay_bank_bin', p_bank_bin), ('pay_account_no', p_account_no), ('pay_account_name', upper(trim(p_account_name)))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'SET_PAYMENT_ACCOUNT', p_bank_bin, jsonb_build_object('account_no', p_account_no, 'name', upper(trim(p_account_name))));
  return private.payment_account();
end $$;

-- ---------------------------------------------------------------------
-- 5. Giải chạy ảo: quyền tổ chức do admin cấp + phí theo quy mô
-- ---------------------------------------------------------------------
create table if not exists public.race_organizer_grants (
  owner_type text not null check (owner_type in ('USER', 'CLUB')),
  owner_id uuid not null,
  note text,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (owner_type, owner_id)
);
alter table public.race_organizer_grants enable row level security;
revoke all on public.race_organizer_grants from anon, authenticated;

alter table public.virtual_races add column if not exists fee_charged integer not null default 0;
alter table public.virtual_races add column if not exists pass_id uuid references public.challenge_passes(id) on delete set null;

create or replace function public.can_organize_race() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'admin', public.is_system_admin(),
    'personal', exists (select 1 from public.race_organizer_grants g where g.owner_type = 'USER' and g.owner_id = auth.uid()),
    'clubs', (select coalesce(jsonb_agg(g.owner_id), '[]'::jsonb) from public.race_organizer_grants g
               where g.owner_type = 'CLUB' and public.club_is_staff(g.owner_id)))
$$;

create or replace function public.admin_set_race_organizer(p_owner_type text, p_owner_id uuid, p_allow boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_admin();
begin
  if upper(p_owner_type) not in ('USER', 'CLUB') then raise exception 'INVALID_OWNER'; end if;
  if p_allow then
    insert into public.race_organizer_grants (owner_type, owner_id, note, granted_by) values (upper(p_owner_type), p_owner_id, p_note, v_uid)
    on conflict (owner_type, owner_id) do update set note = excluded.note, granted_by = excluded.granted_by, created_at = now();
    if upper(p_owner_type) = 'CLUB' then
      perform private.notify_club(p_owner_id, true, 'CLUB_PRO', 'CLB được cấp quyền tổ chức giải chạy ảo', null, '/races/new', v_uid);
    else
      perform private.notify(p_owner_id, null, 'VIP', 'Bạn được cấp quyền tổ chức giải chạy ảo', null, '/races/new', v_uid, true);
    end if;
  else
    delete from public.race_organizer_grants where owner_type = upper(p_owner_type) and owner_id = p_owner_id;
  end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'RACE_ORGANIZER', p_owner_id::text, jsonb_build_object('type', upper(p_owner_type), 'allow', p_allow, 'note', p_note));
end $$;

create or replace function public.admin_list_race_organizers() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('owner_type', g.owner_type, 'owner_id', g.owner_id, 'note', g.note, 'created_at', g.created_at,
            'name', case g.owner_type when 'CLUB' then (select c.name from public.clubs c where c.id = g.owner_id) else private.display_name(g.owner_id) end)
            order by g.created_at desc), '[]'::jsonb) from public.race_organizer_grants g);
end $$;

-- Báo giá tạo giải / thử thách theo quy mô cho người trả (ví CLB hoặc ví cá nhân), kèm lượt tạo dùng được
create or replace function public.quote_capacity(p_slots integer, p_club_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_payer uuid := coalesce(p_club_id, v_uid);
  v_fee integer := private.challenge_creation_fee(false, p_slots, now(), now());
  v_pass public.challenge_passes;
begin
  if p_club_id is not null and not public.club_is_staff(p_club_id) then raise exception 'FORBIDDEN'; end if;
  perform private.issue_credits(case when p_club_id is null then 'USER' else 'CLUB' end, v_payer);
  v_pass := (select t.x from (select x, row_number() over (order by x.expires_at nulls last, x.max_slots, x.created_at) as rn
                                from public.challenge_passes x
                               where x.owner_id = v_payer and x.remaining > 0 and x.max_slots >= greatest(coalesce(p_slots, 1), 1)
                                 and (x.expires_at is null or x.expires_at > now())) t where t.rn = 1);
  return jsonb_build_object('slots', p_slots, 'tier', private.capacity_tier(p_slots), 'fee', v_fee,
    'custom', private.capacity_tier(p_slots)->>'xu' is null,
    'payer', case when p_club_id is null then 'USER' else 'CLUB' end, 'payer_balance', private.balance(v_payer),
    'pass', case when v_pass.id is null or v_fee = 0 then null
                 else jsonb_build_object('id', v_pass.id, 'max_slots', v_pass.max_slots, 'remaining', v_pass.remaining, 'note', v_pass.note) end);
end $$;

-- Báo giá tạo thử thách (thay bản 000700): cấp lượt tháng trước khi báo, trả cấu hình v2 + mức quy mô
create or replace function public.quote_challenge(p_max_slots integer, p_format text default 'RANKED', p_club_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_slots integer := case when p_format = 'DUEL' then 2 when p_format = 'SOLO_GOAL' then 1 else greatest(coalesce(p_max_slots, 1), 1) end;
  v_fee integer := private.challenge_creation_fee(p_format = 'TEAM', v_slots, now(), now() + interval '1 day');
  v_payer uuid := case when p_club_id is not null and public.club_is_staff(p_club_id) then p_club_id else v_uid end;
  v_pass public.challenge_passes;
begin
  perform private.issue_credits(case when v_payer = v_uid then 'USER' else 'CLUB' end, v_payer);
  v_pass := (select t.x from (select x, row_number() over (order by x.expires_at nulls last, x.max_slots, x.created_at) as rn
                                from public.challenge_passes x
                               where x.owner_id = v_payer and x.remaining > 0 and x.max_slots >= v_slots
                                 and (x.expires_at is null or x.expires_at > now())) t where t.rn = 1);
  return jsonb_build_object(
    'fee', v_fee, 'tier', private.capacity_tier(v_slots), 'custom', private.capacity_tier(v_slots)->>'xu' is null,
    'payer', case when v_payer = v_uid then 'USER' else 'CLUB' end,
    'payer_balance', private.balance(v_payer), 'wallet_balance', private.balance(v_uid),
    'pass', case when v_pass.id is null or v_fee = 0 then null
                 else jsonb_build_object('id', v_pass.id, 'remaining', v_pass.remaining, 'max_slots', v_pass.max_slots,
                                         'expires_at', v_pass.expires_at, 'note', v_pass.note) end,
    'xu_vnd', (private.economy_config()->>'xuVnd')::numeric,
    'policy', private.economy_config());
end $$;

create or replace function public.create_virtual_race(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_id uuid := gen_random_uuid();
  v_club uuid := nullif(p->>'club_id', '')::uuid;
  v_title text := trim(coalesce(p->>'title', ''));
  v_start timestamptz := (p->>'start_at')::timestamptz;
  v_end timestamptz := (p->>'end_at')::timestamptz;
  v_close timestamptz := coalesce(nullif(p->>'reg_close_at', '')::timestamptz, (p->>'end_at')::timestamptz);
  v_aud text := upper(coalesce(p->>'audience', 'PUBLIC'));
  v_max integer := nullif(p->>'max_participants', '')::integer;
  v_prefix text := upper(coalesce(nullif(trim(p->>'bib_prefix'), ''), 'RH'));
  v_dist numeric[];
  v_admin boolean := public.is_system_admin();
  v_payer uuid;
  v_fee integer := 0;
  v_pass uuid;
begin
  if not v_admin then
    if v_club is not null then
      if not public.club_is_staff(v_club) then raise exception 'FORBIDDEN'; end if;
      if not exists (select 1 from public.race_organizer_grants g where g.owner_type = 'CLUB' and g.owner_id = v_club) then raise exception 'RACE_ORGANIZER_REQUIRED'; end if;
    elsif not exists (select 1 from public.race_organizer_grants g where g.owner_type = 'USER' and g.owner_id = v_uid) then
      raise exception 'RACE_ORGANIZER_REQUIRED';
    end if;
    if v_max is null then raise exception 'CAPACITY_REQUIRED'; end if;
  end if;
  if length(v_title) < 3 or length(v_title) > 120 then raise exception 'INVALID_TITLE'; end if;
  if v_start is null or v_end is null or v_end <= v_start then raise exception 'INVALID_TIME_RANGE'; end if;
  if v_end < now() or v_end - v_start > interval '92 days' then raise exception 'INVALID_DURATION'; end if;
  if v_close > v_end or v_close < now() then raise exception 'INVALID_REG_CLOSE'; end if;
  if v_aud not in ('PUBLIC', 'CLUB_ONLY') or (v_aud = 'CLUB_ONLY' and v_club is null) then raise exception 'INVALID_AUDIENCE'; end if;
  if v_max is not null and (v_max < 2 or v_max > 100000) then raise exception 'INVALID_MAX'; end if;
  if v_prefix !~ '^[A-Z0-9]{1,6}$' then raise exception 'INVALID_BIB_PREFIX'; end if;
  v_dist := (select array_agg(d order by d) from (
               select distinct round((e)::numeric, 2) as d from jsonb_array_elements_text(coalesce(p->'distances', '[]'::jsonb)) as t(e)) s);
  if v_dist is null or array_length(v_dist, 1) > 6 or v_dist[1] < 1 or v_dist[array_length(v_dist, 1)] > 250 then
    raise exception 'INVALID_DISTANCES';
  end if;

  -- Phí theo quy mô (admin miễn phí). Lượt tạo (vé) dùng trước, rồi mới trừ Xu.
  if not v_admin then
    v_payer := coalesce(v_club, v_uid);
    perform private.issue_credits(case when v_club is null then 'USER' else 'CLUB' end, v_payer);
    v_fee := private.challenge_creation_fee(false, v_max, v_start, v_end);
    if v_fee > 0 then
      v_pass := (select t.id from (select x.id, row_number() over (order by x.expires_at nulls last, x.max_slots, x.created_at) as rn
                                     from public.challenge_passes x
                                    where x.owner_id = v_payer and x.remaining > 0 and x.max_slots >= v_max
                                      and (x.expires_at is null or x.expires_at > now())) t where t.rn = 1);
      if v_pass is not null then
        update public.challenge_passes set remaining = remaining - 1, updated_at = now() where id = v_pass;
        v_fee := 0;
      elsif private.balance(v_payer) < v_fee then
        raise exception '%', case when v_club is null then 'INSUFFICIENT_BALANCE' else 'INSUFFICIENT_TREASURY' end;
      else
        perform private.ledger_post('RACE_FEE', 'race_fee:' || v_id, 'Phí tạo giải chạy ảo: ' || v_title, v_uid,
          private.debit_entries(v_payer, v_fee, private.system_account()), v_id);
        if v_club is not null then
          insert into public.club_treasury_log (club_id, user_id, amount, kind, note)
          values (v_club, v_uid, -v_fee, 'SPEND', left('Phí tạo giải: ' || v_title, 200));
        end if;
      end if;
    end if;
  end if;

  insert into public.virtual_races (id, organizer_id, club_id, title, description, start_at, end_at, reg_close_at, distances,
                                    audience, max_participants, bib_prefix, fee_charged, pass_id)
  values (v_id, v_uid, v_club, v_title, nullif(left(trim(coalesce(p->>'description', '')), 3000), ''), v_start, v_end, v_close,
          v_dist, v_aud, v_max, v_prefix, v_fee, v_pass);
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 6. Quyền
-- ---------------------------------------------------------------------
revoke all on function private.active_plan(uuid), private.vn_month_start(timestamptz), private.issue_credits(text, uuid),
  private.grant_subscription(text, uuid, text, integer, text, uuid, text, uuid), private.payment_account(), private.order_json(public.orders)
  from public, anon, authenticated;
revoke all on function public.issue_due_credits(), public.pricing_catalog(), public.my_plan(), public.club_plan_status(uuid),
  public.create_order(jsonb), public.cancel_order(uuid), public.admin_list_orders(text), public.admin_confirm_order(uuid, text),
  public.admin_grant_plan(text, uuid, text, integer, text), public.admin_save_plan(jsonb), public.admin_save_xu_package(jsonb),
  public.admin_set_payment_account(text, text, text), public.can_organize_race(), public.admin_set_race_organizer(text, uuid, boolean, text),
  public.admin_list_race_organizers(), public.quote_capacity(integer, uuid), public.create_virtual_race(jsonb) from public, anon;
grant execute on function public.pricing_catalog(), public.my_plan(), public.club_plan_status(uuid),
  public.create_order(jsonb), public.cancel_order(uuid), public.admin_list_orders(text), public.admin_confirm_order(uuid, text),
  public.admin_grant_plan(text, uuid, text, integer, text), public.admin_save_plan(jsonb), public.admin_save_xu_package(jsonb),
  public.admin_set_payment_account(text, text, text), public.can_organize_race(), public.admin_set_race_organizer(text, uuid, boolean, text),
  public.admin_list_race_organizers(), public.quote_capacity(integer, uuid), public.create_virtual_race(jsonb) to authenticated;

notify pgrst, 'reload schema';
