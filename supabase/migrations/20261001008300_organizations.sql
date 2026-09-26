-- 008300: RaceHub Doanh nghiệp / Liên CLB (gói Enterprise — báo giá riêng, tham khảo Tucana Free → Pro → Enterprise).
-- Khách hàng: doanh nghiệp (phong trào sức khoẻ nhân viên), liên đoàn / hệ thống nhiều CLB, trường học.
-- • Tổ chức (organizations): thương hiệu riêng (logo, ảnh bìa, chủ đề), đơn vị con (phòng ban / chi nhánh / lớp),
--   thành viên vào bằng mã mời (tự duyệt hoặc chờ duyệt), giới hạn số chỗ (seat) theo hợp đồng, thời hạn gói.
-- • CLB thành viên (org_clubs): tổ chức mời CLB, ban quản trị CLB đồng ý. Gói có "tài trợ CLB Pro" → CLB thành viên
--   tự lên Pro tới hết hạn hợp đồng; rời tổ chức / hết hạn → trả lại gói cũ của CLB.
-- • Chiến dịch (org_campaigns): tổng km / số buổi / số ngày chạy trong khoảng thời gian, mục tiêu chung + mục tiêu mỗi người;
--   BXH cá nhân, theo đơn vị, theo CLB. Người tham gia = thành viên tổ chức + thành viên các CLB thuộc tổ chức.
--   Chỉ tính bài HỢP LỆ + ĐANG CHIA SẺ (tắt chia sẻ bài nào thì bài đó không vào BXH tổ chức).
-- • Báo cáo cho bộ phận nhân sự / ban tổ chức: km, số buổi, số ngày chạy của từng người trong khoảng ngày (xuất CSV ở giao diện).
-- • Yêu cầu báo giá (org_leads): gửi được cả khi chưa đăng nhập (trang /doanh-nghiep), admin xử lý ở Quản trị → Doanh nghiệp.
-- • RaceHub không giữ tiền: hợp đồng + hoá đơn ngoài app; admin bật / gia hạn gói, có nhật ký.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT. Chạy lại nhiều lần vẫn an toàn.

-- ---------------------------------------------------------------------
-- 1. Bảng
-- ---------------------------------------------------------------------
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  kind text not null default 'COMPANY' check (kind in ('COMPANY', 'FEDERATION', 'SCHOOL', 'OTHER')),
  description text check (description is null or char_length(description) <= 2000),
  logo_url text check (logo_url is null or logo_url ~ '^https://'),
  cover_url text check (cover_url is null or cover_url ~ '^https://'),
  cover_position integer not null default 50 check (cover_position between 0 and 100),
  tagline text check (tagline is null or char_length(tagline) <= 80),
  theme text check (theme is null or theme in ('AURORA', 'SUNSET', 'OCEAN', 'FOREST', 'GOLD', 'NIGHT')),
  invite_code text not null unique,
  join_policy text not null default 'APPROVAL' check (join_policy in ('OPEN', 'APPROVAL')),
  unit_label text not null default 'Phòng ban' check (char_length(unit_label) between 2 and 30),
  allow_self_unit boolean not null default true,
  seat_limit integer not null default 50 check (seat_limit between 2 and 100000),
  club_limit integer not null default 0 check (club_limit between 0 and 10000),
  include_club_pro boolean not null default false,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED')),
  active_until timestamptz,
  legal_name text check (legal_name is null or char_length(legal_name) <= 200),
  tax_code text check (tax_code is null or char_length(tax_code) <= 20),
  contact_name text check (contact_name is null or char_length(contact_name) <= 80),
  contact_phone text check (contact_phone is null or char_length(contact_phone) <= 20),
  contact_email text check (contact_email is null or char_length(contact_email) <= 120),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.org_units (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists org_units_name_key on public.org_units (org_id, lower(name));

create table if not exists public.org_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'MEMBER' check (role in ('OWNER', 'ADMIN', 'MEMBER')),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED')),
  unit_id uuid references public.org_units(id) on delete set null,
  employee_code text check (employee_code is null or char_length(employee_code) <= 40),
  joined_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index if not exists org_members_user_idx on public.org_members (user_id);

create table if not exists public.org_clubs (
  org_id uuid not null references public.organizations(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED')),
  invited_by uuid references public.profiles(id) on delete set null,
  responded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  pro_granted boolean not null default false,
  prev_plan text,
  prev_pro_until timestamptz,
  granted_until timestamptz,
  primary key (org_id, club_id)
);
create unique index if not exists org_clubs_one_org on public.org_clubs (club_id) where status = 'APPROVED';

create table if not exists public.org_campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  description text check (description is null or char_length(description) <= 2000),
  metric text not null default 'DISTANCE' check (metric in ('DISTANCE', 'RUNS', 'ACTIVE_DAYS')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  goal_total numeric check (goal_total is null or goal_total > 0),
  goal_per_person numeric check (goal_per_person is null or goal_per_person > 0),
  min_run_km numeric not null default 1 check (min_run_km between 0 and 100),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CANCELLED')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists org_campaigns_org_idx on public.org_campaigns (org_id, starts_at desc);

create table if not exists public.org_leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  contact_name text not null check (char_length(contact_name) between 2 and 80),
  org_name text not null check (char_length(org_name) between 2 and 120),
  kind text not null default 'COMPANY' check (kind in ('COMPANY', 'FEDERATION', 'SCHOOL', 'OTHER')),
  size integer check (size is null or size between 1 and 1000000),
  phone text not null check (phone ~ '^[0-9+ .()-]{8,20}$'),
  email text check (email is null or char_length(email) <= 120),
  note text check (note is null or char_length(note) <= 1000),
  status text not null default 'NEW' check (status in ('NEW', 'CONTACTED', 'WON', 'LOST')),
  admin_note text check (admin_note is null or char_length(admin_note) <= 1000),
  org_id uuid references public.organizations(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists org_leads_created_idx on public.org_leads (created_at desc);

alter table public.organizations enable row level security;
alter table public.org_units enable row level security;
alter table public.org_members enable row level security;
alter table public.org_clubs enable row level security;
alter table public.org_campaigns enable row level security;
alter table public.org_leads enable row level security;
revoke all on public.organizations, public.org_units, public.org_members, public.org_clubs, public.org_campaigns, public.org_leads
  from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Quyền trong tổ chức (admin hệ thống toàn quyền, như CLB — 007100)
-- ---------------------------------------------------------------------
create or replace function private.org_role(p_org uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when public.is_system_admin() then 'OWNER'
              else (select m.role from public.org_members m
                     where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'APPROVED') end
$$;

create or replace function public.org_is_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(private.org_role(p_org) in ('OWNER', 'ADMIN'), false)
$$;

create or replace function public.org_is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select private.org_role(p_org) is not null
$$;

create or replace function private.org_active(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.organizations o
                  where o.id = p_org and o.status = 'ACTIVE' and (o.active_until is null or o.active_until > now()))
$$;

create or replace function private.org_seats_used(p_org uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.org_members m where m.org_id = p_org and m.status = 'APPROVED'
$$;

create or replace function private.org_new_code() returns text
language sql volatile security definer set search_path = public, extensions as $$
  select upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 8))
$$;

-- Thông tin công khai trong tổ chức (thành viên / người có mã mời xem được)
create or replace function private.org_json(o public.organizations) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', o.id, 'name', o.name, 'kind', o.kind, 'description', o.description, 'logo_url', o.logo_url,
    'cover_url', o.cover_url, 'cover_position', o.cover_position, 'tagline', o.tagline, 'theme', o.theme,
    'join_policy', o.join_policy, 'unit_label', o.unit_label, 'allow_self_unit', o.allow_self_unit,
    'status', o.status, 'active_until', o.active_until, 'active', private.org_active(o.id),
    'seat_limit', o.seat_limit, 'seats_used', private.org_seats_used(o.id), 'club_limit', o.club_limit,
    'include_club_pro', o.include_club_pro,
    'club_count', (select count(*)::int from public.org_clubs oc where oc.org_id = o.id and oc.status = 'APPROVED'),
    'created_at', o.created_at)
$$;

-- Người tham gia chiến dịch / báo cáo: thành viên trực tiếp + thành viên các CLB thuộc tổ chức
create or replace function private.org_people(p_org uuid)
returns table (user_id uuid, unit_id uuid, direct boolean)
language sql stable security definer set search_path = public as $$
  select p.user_id, max(p.unit_id::text)::uuid, bool_or(p.direct)
    from (select m.user_id, m.unit_id, true as direct from public.org_members m where m.org_id = p_org and m.status = 'APPROVED'
          union all
          select cm.user_id, null::uuid, false from public.org_clubs oc
            join public.club_members cm on cm.club_id = oc.club_id and cm.status = 'APPROVED'
           where oc.org_id = p_org and oc.status = 'APPROVED') p
   group by p.user_id
$$;

-- Số liệu chạy của một người trong khoảng thời gian (bài hợp lệ + đang chia sẻ, từ min_km mỗi bài)
create or replace function private.org_person_stats(p_user uuid, p_from timestamptz, p_to timestamptz, p_min_km numeric)
returns table (km numeric, runs integer, active_days integer)
language sql stable security definer set search_path = public as $$
  select coalesce(round(sum(x.distance_m) / 1000.0, 2), 0), count(*)::int,
         count(distinct (x.started_at at time zone 'Asia/Ho_Chi_Minh')::date)::int
    from public.activities x
   where x.user_id = p_user and x.validation_status = 'APPROVED' and x.shared
     and public.activity_is_countable(x.status, x.validation_status)
     and x.started_at >= p_from and x.started_at < p_to and coalesce(x.distance_m, 0) >= coalesce(p_min_km, 0) * 1000
$$;

-- ---------------------------------------------------------------------
-- 3. CLB Pro do tổ chức tài trợ: cấp khi CLB thuộc tổ chức đang hiệu lực + gói có tài trợ; trả lại gói cũ khi thôi
-- ---------------------------------------------------------------------
create or replace function private.org_sync_club_pro(p_org uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  o public.organizations := (select x from public.organizations x where x.id = p_org);
  v_on boolean := o.id is not null and o.include_club_pro and private.org_active(p_org);
  r record;
  v_until timestamptz;
  n integer := 0;
begin
  for r in select oc.*, c.plan, c.pro_until from public.org_clubs oc join public.clubs c on c.id = oc.club_id
            where oc.org_id = p_org loop
    if v_on and r.status = 'APPROVED' then
      v_until := case when r.pro_granted and r.prev_plan = 'PRO' and r.prev_pro_until is null then null
                      when not r.pro_granted and r.plan = 'PRO' and r.pro_until is null then null
                      when o.active_until is null then null
                      else greatest(coalesce(case when r.pro_granted then r.prev_pro_until else r.pro_until end, now()), o.active_until) end;
      update public.org_clubs set pro_granted = true, granted_until = v_until,
             prev_plan = case when r.pro_granted then r.prev_plan else r.plan end,
             prev_pro_until = case when r.pro_granted then r.prev_pro_until else r.pro_until end
       where org_id = r.org_id and club_id = r.club_id;
      update public.clubs set plan = 'PRO', pro_until = v_until where id = r.club_id;
      n := n + 1;
    elsif r.pro_granted then
      -- Trả lại gói cũ, trừ khi CLB đã tự gia hạn dài hơn phần tổ chức cấp
      if r.plan = 'PRO' and r.pro_until is not distinct from r.granted_until then
        update public.clubs set plan = coalesce(r.prev_plan, 'FREE'),
               pro_until = case when coalesce(r.prev_plan, 'FREE') = 'PRO' then r.prev_pro_until end
         where id = r.club_id;
      end if;
      update public.org_clubs set pro_granted = false, granted_until = null, prev_plan = null, prev_pro_until = null
       where org_id = r.org_id and club_id = r.club_id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 4. Yêu cầu báo giá (khách chưa đăng nhập cũng gửi được)
-- ---------------------------------------------------------------------
create or replace function public.request_enterprise_quote(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_phone text := regexp_replace(trim(coalesce(p->>'phone', '')), '\s+', ' ', 'g');
  v_id uuid;
  a record;
begin
  if char_length(trim(coalesce(p->>'contact_name', ''))) < 2 then raise exception 'NAME_REQUIRED'; end if;
  if char_length(trim(coalesce(p->>'org_name', ''))) < 2 then raise exception 'ORG_NAME_REQUIRED'; end if;
  if v_phone !~ '^[0-9+ .()-]{8,20}$' then raise exception 'INVALID_PHONE'; end if;
  if (select count(*) from public.org_leads l where l.phone = v_phone and l.created_at > now() - interval '1 day') >= 3 then
    raise exception 'RATE_LIMITED';
  end if;
  v_id := gen_random_uuid();
  insert into public.org_leads (id, user_id, contact_name, org_name, kind, size, phone, email, note)
  values (v_id, auth.uid(), left(trim(p->>'contact_name'), 80), left(trim(p->>'org_name'), 120),
          case when p->>'kind' in ('COMPANY', 'FEDERATION', 'SCHOOL', 'OTHER') then p->>'kind' else 'OTHER' end,
          case when coalesce(p->>'size', '') ~ '^[0-9]{1,7}$' then greatest((p->>'size')::int, 1) end, v_phone,
          nullif(left(trim(coalesce(p->>'email', '')), 120), ''), nullif(left(trim(coalesce(p->>'note', '')), 1000), ''));
  for a in select pr.id from public.profiles pr where pr.role = 'SYSTEM_ADMIN' loop
    perform private.notify(a.id, null, 'ENTERPRISE_LEAD', 'Yêu cầu báo giá Doanh nghiệp: ' || left(trim(p->>'org_name'), 80),
      left(trim(p->>'contact_name'), 80) || ' · ' || v_phone, '/admin?tab=enterprise', auth.uid(), true);
  end loop;
  return jsonb_build_object('id', v_id);
end $$;

-- ---------------------------------------------------------------------
-- 5. Admin hệ thống: tạo tổ chức theo hợp đồng, gia hạn, xử lý báo giá
-- ---------------------------------------------------------------------
create or replace function public.admin_org_leads(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(to_jsonb(l) || jsonb_build_object('org_name_linked', (select o.name from public.organizations o where o.id = l.org_id))
                                    order by l.created_at desc)
                     from public.org_leads l where p_status is null or l.status = p_status), '[]'::jsonb);
end $$;

create or replace function public.admin_set_org_lead(p_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_admin uuid := private.require_admin();
begin
  if p_status not in ('NEW', 'CONTACTED', 'WON', 'LOST') then raise exception 'INVALID_STATUS'; end if;
  update public.org_leads set status = p_status, admin_note = coalesce(nullif(left(trim(coalesce(p_note, '')), 1000), ''), admin_note)
   where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_admin, 'ORG_LEAD_STATUS', 'org_lead:' || p_id, jsonb_build_object('status', p_status, 'note', p_note));
end $$;

create or replace function public.admin_list_orgs() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(private.org_json(o) || jsonb_build_object(
                     'owner_name', (select string_agg(private.display_name(m.user_id), ', ') from public.org_members m
                                     where m.org_id = o.id and m.role = 'OWNER'),
                     'legal_name', o.legal_name, 'tax_code', o.tax_code, 'contact_name', o.contact_name,
                     'contact_phone', o.contact_phone, 'contact_email', o.contact_email) order by o.created_at desc)
                     from public.organizations o), '[]'::jsonb);
end $$;

create or replace function public.admin_create_org(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  v_owner uuid := (select u.id from auth.users u where lower(u.email) = lower(trim(coalesce(p->>'owner_email', ''))));
  v_id uuid;
  v_name text := trim(coalesce(p->>'name', ''));
  v_code text := private.org_new_code();
begin
  if char_length(v_name) < 2 then raise exception 'ORG_NAME_REQUIRED'; end if;
  if v_owner is null then raise exception 'OWNER_NOT_FOUND'; end if;
  v_id := gen_random_uuid();
  insert into public.organizations (id, name, kind, seat_limit, club_limit, include_club_pro, active_until, invite_code,
                                    legal_name, tax_code, contact_name, contact_phone, contact_email, created_by)
  values (v_id, left(v_name, 120), case when p->>'kind' in ('COMPANY', 'FEDERATION', 'SCHOOL', 'OTHER') then p->>'kind' else 'COMPANY' end,
          coalesce(nullif(p->>'seat_limit', '')::int, 50), coalesce(nullif(p->>'club_limit', '')::int, 0),
          coalesce((p->>'include_club_pro')::boolean, false), nullif(p->>'active_until', '')::timestamptz, v_code,
          nullif(trim(coalesce(p->>'legal_name', '')), ''), nullif(trim(coalesce(p->>'tax_code', '')), ''),
          nullif(trim(coalesce(p->>'contact_name', '')), ''), nullif(trim(coalesce(p->>'contact_phone', '')), ''),
          nullif(trim(coalesce(p->>'contact_email', '')), ''), v_admin);
  insert into public.org_members (org_id, user_id, role, status) values (v_id, v_owner, 'OWNER', 'APPROVED');
  if nullif(p->>'lead_id', '') is not null then
    update public.org_leads set status = 'WON', org_id = v_id where id = (p->>'lead_id')::uuid;
  end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_admin, 'ORG_CREATE', 'org:' || v_id, p - 'owner_email' || jsonb_build_object('owner_id', v_owner));
  perform private.notify(v_owner, null, 'ORG_CREATED', 'Tổ chức ' || left(v_name, 80) || ' đã sẵn sàng',
    'Bạn là quản trị viên. Mời thành viên bằng mã ' || v_code || ' và tạo chiến dịch đầu tiên.', '/orgs/' || v_id, v_admin, true);
  return jsonb_build_object('id', v_id, 'invite_code', v_code);
end $$;

create or replace function public.admin_update_org(p_org uuid, p jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  v_old public.organizations := (select o from public.organizations o where o.id = p_org);
begin
  if v_old.id is null then raise exception 'ORG_NOT_FOUND'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  update public.organizations set
    seat_limit = coalesce(nullif(p->>'seat_limit', '')::int, seat_limit),
    club_limit = coalesce(nullif(p->>'club_limit', '')::int, club_limit),
    include_club_pro = coalesce((p->>'include_club_pro')::boolean, include_club_pro),
    active_until = case when p ? 'active_until' then nullif(p->>'active_until', '')::timestamptz else active_until end,
    status = case when p->>'status' in ('ACTIVE', 'SUSPENDED') then p->>'status' else status end,
    kind = case when p->>'kind' in ('COMPANY', 'FEDERATION', 'SCHOOL', 'OTHER') then p->>'kind' else kind end
   where id = p_org;
  perform private.org_sync_club_pro(p_org);
  insert into public.admin_audit_log (actor_id, action, target, old_value, new_value, reason)
  values (v_admin, 'ORG_UPDATE', 'org:' || p_org, to_jsonb(v_old), p, p_reason);
  return private.org_json((select o from public.organizations o where o.id = p_org));
end $$;

-- Cron hằng ngày: hết hạn hợp đồng → trả gói cũ cho CLB được tài trợ
create or replace function public.expire_org_plans() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in select distinct oc.org_id from public.org_clubs oc where oc.pro_granted loop
    if not private.org_active(r.org_id) then n := n + private.org_sync_club_pro(r.org_id); end if;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 6. Tổ chức của tôi, chi tiết, mời / vào / rời
-- ---------------------------------------------------------------------
create or replace function public.my_orgs() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  return coalesce((select jsonb_agg(private.org_json(o) || jsonb_build_object('my_role', m.role, 'my_status', m.status) order by o.name)
                     from public.org_members m join public.organizations o on o.id = m.org_id where m.user_id = v_uid), '[]'::jsonb);
end $$;

create or replace function public.org_detail(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  o public.organizations := (select x from public.organizations x where x.id = p_org);
  v_admin boolean := public.org_is_admin(p_org);
  me public.org_members := (select m from public.org_members m where m.org_id = p_org and m.user_id = v_uid);
begin
  if o.id is null then raise exception 'ORG_NOT_FOUND'; end if;
  if not public.org_is_member(p_org) then raise exception 'NOT_A_MEMBER'; end if;
  return private.org_json(o) || jsonb_build_object(
    'my_role', coalesce(private.org_role(p_org), 'MEMBER'), 'is_admin', v_admin, 'is_system_admin', public.is_system_admin(),
    'my_unit_id', me.unit_id, 'is_real_member', me.status = 'APPROVED',
    'units', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name,
                 'members', (select count(*)::int from public.org_members m where m.unit_id = u.id and m.status = 'APPROVED')) order by u.sort, u.name)
               from public.org_units u where u.org_id = p_org), '[]'::jsonb),
    'clubs', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url, 'accent_color', c.accent_color,
                 'member_count', c.member_count, 'status', oc.status, 'pro_granted', oc.pro_granted) order by oc.status, c.name)
               from public.org_clubs oc join public.clubs c on c.id = oc.club_id
              where oc.org_id = p_org and (oc.status = 'APPROVED' or v_admin)), '[]'::jsonb),
    'pending_members', case when v_admin then (select count(*)::int from public.org_members m where m.org_id = p_org and m.status = 'PENDING') end,
    'invite_code', case when v_admin then o.invite_code end,
    'billing', case when v_admin then jsonb_build_object('legal_name', o.legal_name, 'tax_code', o.tax_code, 'contact_name', o.contact_name,
                                                         'contact_phone', o.contact_phone, 'contact_email', o.contact_email) end);
end $$;

create or replace function public.org_invite_preview(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  o public.organizations := (select x from public.organizations x where x.invite_code = upper(trim(coalesce(p_code, ''))));
begin
  if o.id is null then return null; end if;
  return jsonb_build_object('id', o.id, 'name', o.name, 'kind', o.kind, 'logo_url', o.logo_url, 'cover_url', o.cover_url,
    'cover_position', o.cover_position, 'theme', o.theme, 'tagline', o.tagline, 'description', o.description,
    'join_policy', o.join_policy, 'unit_label', o.unit_label, 'allow_self_unit', o.allow_self_unit,
    'active', private.org_active(o.id), 'full', private.org_seats_used(o.id) >= o.seat_limit,
    'member_count', private.org_seats_used(o.id),
    'units', case when o.allow_self_unit then coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.sort, u.name)
                                                          from public.org_units u where u.org_id = o.id), '[]'::jsonb) else '[]'::jsonb end,
    'my_status', (select m.status from public.org_members m where m.org_id = o.id and m.user_id = v_uid));
end $$;

create or replace function public.join_org(p_code text, p_unit uuid default null, p_employee_code text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  o public.organizations := (select x from public.organizations x where x.invite_code = upper(trim(coalesce(p_code, ''))));
  v_status text;
  v_unit uuid;
  a record;
begin
  if o.id is null then raise exception 'INVALID_CODE'; end if;
  if not private.org_active(o.id) then raise exception 'ORG_INACTIVE'; end if;
  perform pg_advisory_xact_lock(hashtext('org_seats:' || o.id));
  v_status := (select m.status from public.org_members m where m.org_id = o.id and m.user_id = v_uid);
  if v_status is not null then return jsonb_build_object('org_id', o.id, 'status', v_status, 'duplicate', true); end if;
  v_unit := case when o.allow_self_unit then (select u.id from public.org_units u where u.id = p_unit and u.org_id = o.id) end;
  v_status := case when o.join_policy = 'OPEN' then 'APPROVED' else 'PENDING' end;
  if v_status = 'APPROVED' and private.org_seats_used(o.id) >= o.seat_limit then raise exception 'ORG_FULL'; end if;
  insert into public.org_members (org_id, user_id, role, status, unit_id, employee_code)
  values (o.id, v_uid, 'MEMBER', v_status, v_unit, nullif(left(trim(coalesce(p_employee_code, '')), 40), ''));
  if v_status = 'PENDING' then
    for a in select m.user_id from public.org_members m where m.org_id = o.id and m.status = 'APPROVED' and m.role in ('OWNER', 'ADMIN') loop
      perform private.notify(a.user_id, null, 'ORG_JOIN_REQUEST', private.display_name(v_uid) || ' xin vào ' || o.name,
        'Duyệt ở mục Thành viên của tổ chức.', '/orgs/' || o.id || '?tab=members', v_uid, false);
    end loop;
  end if;
  return jsonb_build_object('org_id', o.id, 'status', v_status);
end $$;

create or replace function public.leave_org(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  if (select m.role from public.org_members m where m.org_id = p_org and m.user_id = v_uid) = 'OWNER' then
    raise exception 'OWNER_CANNOT_LEAVE';
  end if;
  delete from public.org_members where org_id = p_org and user_id = v_uid;
end $$;

create or replace function public.rotate_org_invite(p_org uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_code text := private.org_new_code();
begin
  if not public.org_is_admin(p_org) then raise exception 'FORBIDDEN'; end if;
  update public.organizations set invite_code = v_code where id = p_org;
  return v_code;
end $$;

create or replace function public.update_org(p_org uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.org_is_admin(p_org) then raise exception 'FORBIDDEN'; end if;
  if p ? 'name' and char_length(trim(coalesce(p->>'name', ''))) < 2 then raise exception 'ORG_NAME_REQUIRED'; end if;
  if p ? 'tagline' and char_length(coalesce(p->>'tagline', '')) > 80 then raise exception 'TAGLINE_TOO_LONG'; end if;
  if p ? 'unit_label' and char_length(trim(coalesce(p->>'unit_label', ''))) not between 2 and 30 then raise exception 'INVALID_UNIT_LABEL'; end if;
  if (p ? 'cover_url' and coalesce(p->>'cover_url', '') <> '' and p->>'cover_url' !~ '^https://')
     or (p ? 'logo_url' and coalesce(p->>'logo_url', '') <> '' and p->>'logo_url' !~ '^https://') then raise exception 'INVALID_URL'; end if;
  update public.organizations set
    name = case when p ? 'name' then left(trim(p->>'name'), 120) else name end,
    description = case when p ? 'description' then nullif(left(trim(coalesce(p->>'description', '')), 2000), '') else description end,
    logo_url = case when p ? 'logo_url' then nullif(p->>'logo_url', '') else logo_url end,
    cover_url = case when p ? 'cover_url' then nullif(p->>'cover_url', '') else cover_url end,
    cover_position = case when p ? 'cover_position' then least(greatest(coalesce((p->>'cover_position')::int, 50), 0), 100) else cover_position end,
    tagline = case when p ? 'tagline' then nullif(trim(coalesce(p->>'tagline', '')), '') else tagline end,
    theme = case when p ? 'theme' then case when p->>'theme' in ('AURORA', 'SUNSET', 'OCEAN', 'FOREST', 'GOLD', 'NIGHT') then p->>'theme' end else theme end,
    join_policy = case when p->>'join_policy' in ('OPEN', 'APPROVAL') then p->>'join_policy' else join_policy end,
    unit_label = case when p ? 'unit_label' then trim(p->>'unit_label') else unit_label end,
    allow_self_unit = coalesce((p->>'allow_self_unit')::boolean, allow_self_unit),
    legal_name = case when p ? 'legal_name' then nullif(left(trim(coalesce(p->>'legal_name', '')), 200), '') else legal_name end,
    tax_code = case when p ? 'tax_code' then nullif(left(trim(coalesce(p->>'tax_code', '')), 20), '') else tax_code end,
    contact_name = case when p ? 'contact_name' then nullif(left(trim(coalesce(p->>'contact_name', '')), 80), '') else contact_name end,
    contact_phone = case when p ? 'contact_phone' then nullif(left(trim(coalesce(p->>'contact_phone', '')), 20), '') else contact_phone end,
    contact_email = case when p ? 'contact_email' then nullif(left(trim(coalesce(p->>'contact_email', '')), 120), '') else contact_email end
   where id = p_org;
  return public.org_detail(p_org);
end $$;

-- ---------------------------------------------------------------------
-- 7. Đơn vị (phòng ban / chi nhánh / lớp) + thành viên
-- ---------------------------------------------------------------------
create or replace function public.save_org_unit(p_org uuid, p_id uuid, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id; v_name text := trim(coalesce(p_name, ''));
begin
  if not public.org_is_admin(p_org) then raise exception 'FORBIDDEN'; end if;
  if char_length(v_name) not between 1 and 80 then raise exception 'INVALID_NAME'; end if;
  if exists (select 1 from public.org_units u where u.org_id = p_org and lower(u.name) = lower(v_name) and u.id is distinct from p_id) then
    raise exception 'UNIT_EXISTS';
  end if;
  if (select count(*) from public.org_units u where u.org_id = p_org) >= 500 and p_id is null then raise exception 'UNIT_LIMIT'; end if;
  if v_id is null then
    v_id := gen_random_uuid();
    insert into public.org_units (id, org_id, name, sort)
    values (v_id, p_org, v_name, coalesce((select max(u.sort) from public.org_units u where u.org_id = p_org), 0) + 1);
  else
    update public.org_units set name = v_name where id = p_id and org_id = p_org;
    if not found then raise exception 'NOT_FOUND'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.delete_org_unit(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := (select u.org_id from public.org_units u where u.id = p_id);
begin
  if v_org is null or not public.org_is_admin(v_org) then raise exception 'FORBIDDEN'; end if;
  delete from public.org_units where id = p_id;
end $$;

create or replace function public.org_members_list(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_admin boolean := public.org_is_admin(p_org);
begin
  if not public.org_is_member(p_org) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', private.display_name(m.user_id), 'avatar_url', pr.avatar_url,
             'role', m.role, 'status', m.status, 'unit_id', m.unit_id, 'unit_name', u.name, 'joined_at', m.joined_at,
             'employee_code', case when v_admin then m.employee_code end)
             order by (m.status = 'PENDING') desc, case m.role when 'OWNER' then 0 when 'ADMIN' then 1 else 2 end, private.display_name(m.user_id))
           from public.org_members m join public.profiles pr on pr.id = m.user_id left join public.org_units u on u.id = m.unit_id
          where m.org_id = p_org and (m.status = 'APPROVED' or v_admin)), '[]'::jsonb);
end $$;

create or replace function public.set_org_member(p_org uuid, p_user uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  m public.org_members := (select x from public.org_members x where x.org_id = p_org and x.user_id = p_user);
  v_org text := (select o.name from public.organizations o where o.id = p_org);
begin
  if not public.org_is_admin(p_org) then raise exception 'FORBIDDEN'; end if;
  if m.user_id is null then raise exception 'MEMBER_NOT_FOUND'; end if;
  if p->>'action' = 'REMOVE' then
    if m.role = 'OWNER' then raise exception 'OWNER_CANNOT_LEAVE'; end if;
    delete from public.org_members where org_id = p_org and user_id = p_user;
    return;
  end if;
  perform pg_advisory_xact_lock(hashtext('org_seats:' || p_org));
  if p->>'status' = 'APPROVED' and m.status = 'PENDING' then
    if private.org_seats_used(p_org) >= (select o.seat_limit from public.organizations o where o.id = p_org) then raise exception 'ORG_FULL'; end if;
    update public.org_members set status = 'APPROVED', joined_at = now() where org_id = p_org and user_id = p_user;
    perform private.notify(p_user, null, 'ORG_APPROVED', 'Bạn đã vào ' || coalesce(v_org, 'tổ chức'), 'Xem chiến dịch đang diễn ra.',
      '/orgs/' || p_org, v_uid, false);
  end if;
  if p->>'role' in ('ADMIN', 'MEMBER') then
    if m.role = 'OWNER' then raise exception 'FORBIDDEN'; end if;
    update public.org_members set role = p->>'role' where org_id = p_org and user_id = p_user;
  end if;
  if p ? 'unit_id' then
    update public.org_members set unit_id = (select u.id from public.org_units u where u.id = nullif(p->>'unit_id', '')::uuid and u.org_id = p_org)
     where org_id = p_org and user_id = p_user;
  end if;
  if p ? 'employee_code' then
    update public.org_members set employee_code = nullif(left(trim(coalesce(p->>'employee_code', '')), 40), '') where org_id = p_org and user_id = p_user;
  end if;
end $$;

create or replace function public.set_my_org_unit(p_org uuid, p_unit uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  if not coalesce((select o.allow_self_unit from public.organizations o where o.id = p_org), false) then raise exception 'FORBIDDEN'; end if;
  update public.org_members set unit_id = (select u.id from public.org_units u where u.id = p_unit and u.org_id = p_org)
   where org_id = p_org and user_id = v_uid;
  if not found then raise exception 'NOT_A_MEMBER'; end if;
end $$;

-- ---------------------------------------------------------------------
-- 8. CLB thuộc tổ chức (liên đoàn / hệ thống CLB)
-- ---------------------------------------------------------------------
create or replace function public.org_invite_club(p_org uuid, p_club uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  o public.organizations := (select x from public.organizations x where x.id = p_org);
begin
  if not public.org_is_admin(p_org) then raise exception 'FORBIDDEN'; end if;
  if not private.org_active(p_org) then raise exception 'ORG_INACTIVE'; end if;
  if not exists (select 1 from public.clubs c where c.id = p_club) then raise exception 'CLUB_NOT_FOUND'; end if;
  if exists (select 1 from public.org_clubs oc where oc.club_id = p_club and oc.status = 'APPROVED') then raise exception 'CLUB_IN_ORG'; end if;
  if exists (select 1 from public.org_clubs oc where oc.org_id = p_org and oc.club_id = p_club) then raise exception 'ALREADY_INVITED'; end if;
  if (select count(*) from public.org_clubs oc where oc.org_id = p_org) >= o.club_limit then raise exception 'ORG_CLUB_LIMIT'; end if;
  insert into public.org_clubs (org_id, club_id, invited_by) values (p_org, p_club, v_uid);
  perform private.notify_club(p_club, true, 'ORG_CLUB_INVITE', o.name || ' mời CLB tham gia tổ chức',
    case when o.include_club_pro then 'Tham gia: CLB được nâng Pro miễn phí trong thời hạn hợp đồng của tổ chức.' else 'Mở Cài đặt CLB để trả lời.' end,
    '/clubs/' || p_club || '/settings', v_uid);
end $$;

create or replace function public.respond_org_invite(p_org uuid, p_club uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_status text := (select oc.status from public.org_clubs oc where oc.org_id = p_org and oc.club_id = p_club);
  a record;
begin
  if not public.club_is_staff(p_club) then raise exception 'FORBIDDEN'; end if;
  if v_status is distinct from 'PENDING' then raise exception 'INVITE_NOT_FOUND'; end if;
  if not p_accept then
    delete from public.org_clubs where org_id = p_org and club_id = p_club;
    return;
  end if;
  if exists (select 1 from public.org_clubs oc where oc.club_id = p_club and oc.status = 'APPROVED') then raise exception 'CLUB_IN_ORG'; end if;
  update public.org_clubs set status = 'APPROVED', responded_by = v_uid where org_id = p_org and club_id = p_club;
  perform private.org_sync_club_pro(p_org);
  for a in select m.user_id from public.org_members m where m.org_id = p_org and m.status = 'APPROVED' and m.role in ('OWNER', 'ADMIN') loop
    perform private.notify(a.user_id, p_club, 'ORG_CLUB_JOINED', (select c.name from public.clubs c where c.id = p_club) || ' đã vào tổ chức',
      'Thành viên CLB được tính vào chiến dịch của tổ chức.', '/orgs/' || p_org || '?tab=units', v_uid, false);
  end loop;
end $$;

create or replace function public.remove_org_club(p_org uuid, p_club uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.org_is_admin(p_org) or public.club_is_staff(p_club)) then raise exception 'FORBIDDEN'; end if;
  update public.org_clubs set status = 'PENDING' where org_id = p_org and club_id = p_club;   -- để đồng bộ trả gói trước khi xoá
  perform private.org_sync_club_pro(p_org);
  delete from public.org_clubs where org_id = p_org and club_id = p_club;
end $$;

-- Cho màn Cài đặt CLB: tổ chức đang thuộc + lời mời đang chờ
create or replace function public.club_orgs(p_club uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_staff boolean := public.club_is_staff(p_club);
begin
  if not public.club_is_member(p_club) then raise exception 'NOT_A_MEMBER'; end if;
  return jsonb_build_object('is_staff', v_staff,
    'current', (select private.org_json(o) || jsonb_build_object('pro_granted', oc.pro_granted, 'granted_until', oc.granted_until)
                  from public.org_clubs oc join public.organizations o on o.id = oc.org_id
                 where oc.club_id = p_club and oc.status = 'APPROVED'),
    'invites', case when v_staff then coalesce((select jsonb_agg(private.org_json(o) order by oc.created_at desc)
                  from public.org_clubs oc join public.organizations o on o.id = oc.org_id
                 where oc.club_id = p_club and oc.status = 'PENDING'), '[]'::jsonb) else '[]'::jsonb end);
end $$;

-- ---------------------------------------------------------------------
-- 9. Chiến dịch + bảng xếp hạng
-- ---------------------------------------------------------------------
create or replace function public.save_org_campaign(p_org uuid, p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_id uuid := p_id;
  v_title text := trim(coalesce(p->>'title', ''));
  v_start timestamptz := nullif(p->>'starts_at', '')::timestamptz;
  v_end timestamptz := nullif(p->>'ends_at', '')::timestamptz;
  v_metric text := coalesce(p->>'metric', 'DISTANCE');
  v_org text := (select o.name from public.organizations o where o.id = p_org);
  r record;
begin
  if not public.org_is_admin(p_org) then raise exception 'FORBIDDEN'; end if;
  if not private.org_active(p_org) then raise exception 'ORG_INACTIVE'; end if;
  if char_length(v_title) not between 3 and 120 then raise exception 'TITLE_REQUIRED'; end if;
  if v_metric not in ('DISTANCE', 'RUNS', 'ACTIVE_DAYS') then raise exception 'INVALID_METRIC'; end if;
  if v_start is null or v_end is null or v_end <= v_start or v_end - v_start > interval '366 days' then raise exception 'INVALID_TIME_RANGE'; end if;
  if v_id is null then
    v_id := gen_random_uuid();
    insert into public.org_campaigns (id, org_id, title, description, metric, starts_at, ends_at, goal_total, goal_per_person, min_run_km, created_by)
    values (v_id, p_org, v_title, nullif(left(trim(coalesce(p->>'description', '')), 2000), ''), v_metric, v_start, v_end,
            nullif(p->>'goal_total', '')::numeric, nullif(p->>'goal_per_person', '')::numeric,
            coalesce(nullif(p->>'min_run_km', '')::numeric, 1), v_uid);
    for r in select pp.user_id from private.org_people(p_org) pp loop
      perform private.notify(r.user_id, null, 'ORG_CAMPAIGN', coalesce(v_org, 'Tổ chức') || ': ' || v_title,
        'Chiến dịch mới — bài chạy hợp lệ của bạn được tính tự động.', '/orgs/' || p_org || '/campaigns/' || v_id, v_uid, false);
    end loop;
  else
    update public.org_campaigns set title = v_title, description = nullif(left(trim(coalesce(p->>'description', '')), 2000), ''),
           metric = v_metric, starts_at = v_start, ends_at = v_end,
           goal_total = nullif(p->>'goal_total', '')::numeric, goal_per_person = nullif(p->>'goal_per_person', '')::numeric,
           min_run_km = coalesce(nullif(p->>'min_run_km', '')::numeric, 1)
     where id = p_id and org_id = p_org;
    if not found then raise exception 'NOT_FOUND'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.cancel_org_campaign(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := (select c.org_id from public.org_campaigns c where c.id = p_id);
begin
  if v_org is null or not public.org_is_admin(v_org) then raise exception 'FORBIDDEN'; end if;
  update public.org_campaigns set status = 'CANCELLED' where id = p_id;
end $$;

create or replace function private.org_campaign_rows(c public.org_campaigns)
returns table (user_id uuid, unit_id uuid, direct boolean, value numeric, km numeric, runs integer, active_days integer)
language sql stable security definer set search_path = public as $$
  select pp.user_id, pp.unit_id, pp.direct,
         case c.metric when 'DISTANCE' then s.km when 'RUNS' then s.runs::numeric else s.active_days::numeric end,
         s.km, s.runs, s.active_days
    from private.org_people(c.org_id) pp
    cross join lateral private.org_person_stats(pp.user_id, c.starts_at, least(c.ends_at, now()), c.min_run_km) s
$$;

create or replace function public.org_campaigns(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.org_is_member(p_org) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(to_jsonb(c) || (
             select jsonb_build_object('total', coalesce(sum(r.value), 0), 'participants', count(*)::int,
                                       'active', count(*) filter (where r.value > 0)::int,
                                       'my_value', max(r.value) filter (where r.user_id = auth.uid()))
               from private.org_campaign_rows(c) r) order by (c.status = 'ACTIVE' and c.ends_at > now()) desc, c.starts_at desc)
           from public.org_campaigns c where c.org_id = p_org and c.status = 'ACTIVE'), '[]'::jsonb);
end $$;

create or replace function public.org_campaign_board(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c public.org_campaigns := (select x from public.org_campaigns x where x.id = p_id);
begin
  if c.id is null then raise exception 'NOT_FOUND'; end if;
  if not (public.org_is_member(c.org_id) or exists (select 1 from private.org_people(c.org_id) pp where pp.user_id = auth.uid())) then
    raise exception 'NOT_A_MEMBER';
  end if;
  return (
    with rows as (select * from private.org_campaign_rows(c)),
    ranked as (select r.*, row_number() over (order by r.value desc, r.km desc, r.user_id) as rn from rows r),
    units as (
      select u.id, u.name, count(r.user_id)::int as members, count(r.user_id) filter (where r.value > 0)::int as active,
             coalesce(sum(r.value), 0) as total
        from public.org_units u left join rows r on r.unit_id = u.id
       where u.org_id = c.org_id group by u.id, u.name
    ),
    clubs as (
      select cl.id, cl.name, cl.avatar_url, cl.accent_color, count(r.user_id)::int as members,
             count(r.user_id) filter (where r.value > 0)::int as active, coalesce(sum(r.value), 0) as total
        from public.org_clubs oc join public.clubs cl on cl.id = oc.club_id
        join public.club_members cm on cm.club_id = cl.id and cm.status = 'APPROVED'
        left join rows r on r.user_id = cm.user_id
       where oc.org_id = c.org_id and oc.status = 'APPROVED' group by cl.id, cl.name, cl.avatar_url, cl.accent_color
    )
    select jsonb_build_object(
      'campaign', to_jsonb(c) || jsonb_build_object('org_name', (select o.name from public.organizations o where o.id = c.org_id)),
      'is_admin', public.org_is_admin(c.org_id),
      'total', (select coalesce(sum(r.value), 0) from rows r),
      'total_km', (select coalesce(sum(r.km), 0) from rows r),
      'participants', (select count(*)::int from rows),
      'active', (select count(*)::int from rows r where r.value > 0),
      'completed', (select count(*)::int from rows r where c.goal_per_person is not null and r.value >= c.goal_per_person),
      'me', (select jsonb_build_object('rank', k.rn, 'value', k.value, 'km', k.km, 'runs', k.runs, 'active_days', k.active_days)
               from ranked k where k.user_id = auth.uid()),
      'people', coalesce((select jsonb_agg(jsonb_build_object('rank', k.rn, 'user_id', k.user_id, 'name', private.display_name(k.user_id),
                   'avatar_url', pr.avatar_url, 'unit_name', u.name, 'value', k.value, 'km', k.km, 'runs', k.runs, 'active_days', k.active_days,
                   'completed', c.goal_per_person is not null and k.value >= c.goal_per_person) order by k.rn)
                 from ranked k join public.profiles pr on pr.id = k.user_id left join public.org_units u on u.id = k.unit_id
                where k.rn <= 500), '[]'::jsonb),
      'units', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'members', x.members, 'active', x.active, 'total', x.total,
                   'avg', case when x.members > 0 then round(x.total / x.members, 2) else 0 end) order by x.total desc) from units x), '[]'::jsonb),
      'clubs', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'avatar_url', x.avatar_url, 'accent_color', x.accent_color,
                   'members', x.members, 'active', x.active, 'total', x.total,
                   'avg', case when x.members > 0 then round(x.total / x.members, 2) else 0 end) order by x.total desc) from clubs x), '[]'::jsonb)));
end $$;

-- ---------------------------------------------------------------------
-- 10. Báo cáo cho ban quản trị tổ chức (xuất CSV ở giao diện)
-- ---------------------------------------------------------------------
create or replace function public.org_report(p_org uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.org_is_admin(p_org) then raise exception 'FORBIDDEN'; end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '400 days' then raise exception 'INVALID_TIME_RANGE'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', pp.user_id, 'name', private.display_name(pp.user_id), 'direct', pp.direct,
             'unit_name', u.name, 'employee_code', m.employee_code,
             'clubs', (select string_agg(cl.name, ', ' order by cl.name) from public.org_clubs oc join public.clubs cl on cl.id = oc.club_id
                        join public.club_members cm on cm.club_id = cl.id and cm.user_id = pp.user_id and cm.status = 'APPROVED'
                       where oc.org_id = p_org and oc.status = 'APPROVED'),
             'km', s.km, 'runs', s.runs, 'active_days', s.active_days) order by s.km desc, private.display_name(pp.user_id))
           from private.org_people(p_org) pp
           cross join lateral private.org_person_stats(pp.user_id, p_from, p_to, 0) s
           left join public.org_members m on m.org_id = p_org and m.user_id = pp.user_id
           left join public.org_units u on u.id = pp.unit_id), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- 11. Ảnh logo / ảnh bìa tổ chức: bucket org-media, thư mục <org_id>/..., chỉ quản trị tổ chức tải lên
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('org-media', 'org-media', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
drop policy if exists org_media_insert on storage.objects;
create policy org_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'org-media' and public.org_is_admin(((storage.foldername(name))[1])::uuid));

-- ---------------------------------------------------------------------
-- 12. Quyền
-- ---------------------------------------------------------------------
revoke all on function private.org_role(uuid), private.org_active(uuid), private.org_seats_used(uuid), private.org_new_code(),
  private.org_json(public.organizations), private.org_people(uuid), private.org_person_stats(uuid, timestamptz, timestamptz, numeric),
  private.org_sync_club_pro(uuid), private.org_campaign_rows(public.org_campaigns) from public, anon, authenticated;

revoke all on function public.request_enterprise_quote(jsonb) from public;
grant execute on function public.request_enterprise_quote(jsonb) to anon, authenticated;

revoke all on function public.expire_org_plans() from public, anon, authenticated;
grant execute on function public.expire_org_plans() to service_role;

revoke all on function public.org_is_admin(uuid), public.org_is_member(uuid), public.admin_org_leads(text), public.admin_set_org_lead(uuid, text, text),
  public.admin_list_orgs(), public.admin_create_org(jsonb), public.admin_update_org(uuid, jsonb, text), public.my_orgs(), public.org_detail(uuid),
  public.org_invite_preview(text), public.join_org(text, uuid, text), public.leave_org(uuid), public.rotate_org_invite(uuid), public.update_org(uuid, jsonb),
  public.save_org_unit(uuid, uuid, text), public.delete_org_unit(uuid), public.org_members_list(uuid), public.set_org_member(uuid, uuid, jsonb),
  public.set_my_org_unit(uuid, uuid), public.org_invite_club(uuid, uuid), public.respond_org_invite(uuid, uuid, boolean),
  public.remove_org_club(uuid, uuid), public.club_orgs(uuid), public.save_org_campaign(uuid, uuid, jsonb), public.cancel_org_campaign(uuid),
  public.org_campaigns(uuid), public.org_campaign_board(uuid), public.org_report(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.org_is_admin(uuid), public.org_is_member(uuid), public.admin_org_leads(text), public.admin_set_org_lead(uuid, text, text),
  public.admin_list_orgs(), public.admin_create_org(jsonb), public.admin_update_org(uuid, jsonb, text), public.my_orgs(), public.org_detail(uuid),
  public.org_invite_preview(text), public.join_org(text, uuid, text), public.leave_org(uuid), public.rotate_org_invite(uuid), public.update_org(uuid, jsonb),
  public.save_org_unit(uuid, uuid, text), public.delete_org_unit(uuid), public.org_members_list(uuid), public.set_org_member(uuid, uuid, jsonb),
  public.set_my_org_unit(uuid, uuid), public.org_invite_club(uuid, uuid), public.respond_org_invite(uuid, uuid, boolean),
  public.remove_org_club(uuid, uuid), public.club_orgs(uuid), public.save_org_campaign(uuid, uuid, jsonb), public.cancel_org_campaign(uuid),
  public.org_campaigns(uuid), public.org_campaign_board(uuid), public.org_report(uuid, timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';
