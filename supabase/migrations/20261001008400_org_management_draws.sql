-- 008400: Cơ chế quản lý Doanh nghiệp (học từ FoxSteps) + quay thưởng dùng chung toàn app.
-- Doanh nghiệp = nhiều nhóm nhỏ gộp lại. Bổ sung:
-- • Tên miền email công ty (tích chọn ở Cài đặt): email đúng tên miền → tự duyệt; tuỳ chọn "chỉ nhận email công ty".
-- • Nhập danh sách nhân viên từ Excel/CSV: email, đơn vị (nhiều cấp "Vùng / Chi nhánh / Phòng"), mã nhân viên, vai trò.
--   Người chưa có tài khoản → lời mời chờ, tự áp khi họ vào bằng mã mời. Tuỳ chọn gỡ người không còn trong danh sách.
-- • Đơn vị nhiều cấp (tối đa 4 cấp); BXH đơn vị cộng dồn cả đơn vị con.
-- • Trưởng đơn vị (UNIT_ADMIN) — như ban quản trị CLB: duyệt / gỡ / gán đơn vị, xem báo cáo trong đơn vị mình (và đơn vị con).
-- • Chiến dịch: trần km mỗi ngày, ngày hội ×2 / ×3, chốt kết quả + duyệt top N trước khi trao giải (loại có lý do),
--   chứng nhận hoàn thành (thiết kế như chứng nhận giải chạy ảo).
-- • Bảng tin tổ chức (mô hình như CLB): bài đăng, ảnh, thích, bình luận, ghim; tuỳ chọn chỉ quản trị được đăng.
-- • Chế độ riêng tư (tích chọn): thành viên chỉ thấy BXH đơn vị + thứ hạng của chính mình, không thấy tên người khác.
-- • Quay thưởng dùng chung: chiến dịch tổ chức, thử thách, CLB, giải chạy ảo, toàn hệ thống (admin). Chạy một lần,
--   không quay lại; thứ tự trúng = md5(seed || user_id) — công bố seed + mã băm danh sách để ai cũng kiểm tra được.
-- Cần 008300. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT. Chạy lại nhiều lần vẫn an toàn.

-- ---------------------------------------------------------------------
-- 1. Cột / bảng mới
-- ---------------------------------------------------------------------
alter table public.organizations add column if not exists email_domains text[] not null default '{}';
alter table public.organizations add column if not exists domain_auto_approve boolean not null default false;
alter table public.organizations add column if not exists domain_only boolean not null default false;
alter table public.organizations add column if not exists privacy_mode boolean not null default false;
alter table public.organizations add column if not exists member_posts boolean not null default true;

alter table public.org_members drop constraint if exists org_members_role_check;
alter table public.org_members add constraint org_members_role_check check (role in ('OWNER', 'ADMIN', 'UNIT_ADMIN', 'MEMBER'));

alter table public.org_units add column if not exists parent_id uuid references public.org_units(id) on delete cascade;
drop index if exists public.org_units_name_key;
create unique index if not exists org_units_name_parent_key
  on public.org_units (org_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

create table if not exists public.org_pending_invites (
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  unit_id uuid references public.org_units(id) on delete set null,
  employee_code text check (employee_code is null or char_length(employee_code) <= 40),
  role text not null default 'MEMBER' check (role in ('MEMBER', 'UNIT_ADMIN')),
  created_at timestamptz not null default now(),
  primary key (org_id, email)
);

alter table public.org_campaigns add column if not exists daily_cap_km numeric check (daily_cap_km is null or daily_cap_km between 1 and 300);
alter table public.org_campaigns add column if not exists review_top integer not null default 0 check (review_top between 0 and 200);
alter table public.org_campaigns add column if not exists boost_days jsonb not null default '[]'::jsonb;
alter table public.org_campaigns add column if not exists cert_enabled boolean not null default false;
alter table public.org_campaigns add column if not exists cert_design jsonb;
alter table public.org_campaigns add column if not exists locked_at timestamptz;
alter table public.org_campaigns add column if not exists locked_by uuid references public.profiles(id) on delete set null;

create table if not exists public.org_campaign_results (
  campaign_id uuid not null references public.org_campaigns(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  unit_id uuid references public.org_units(id) on delete set null,
  direct boolean not null default true,
  value numeric not null default 0,
  km numeric not null default 0,
  runs integer not null default 0,
  active_days integer not null default 0,
  rank integer not null,
  review_status text not null default 'OK' check (review_status in ('OK', 'PENDING', 'DQ')),
  review_note text check (review_note is null or char_length(review_note) <= 300),
  reviewed_by uuid references public.profiles(id) on delete set null,
  primary key (campaign_id, user_id)
);

create table if not exists public.org_posts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  kind text not null default 'POST' check (kind in ('POST', 'ANNOUNCEMENT', 'CAMPAIGN', 'DRAW')),
  body text not null check (char_length(body) between 1 and 2000),
  image_url text check (image_url is null or image_url ~ '^https://'),
  meta jsonb not null default '{}'::jsonb,
  is_pinned boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists org_posts_feed_idx on public.org_posts (org_id, is_pinned desc, created_at desc);
create table if not exists public.org_post_likes (
  post_id uuid not null references public.org_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create table if not exists public.org_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.org_posts(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists org_post_comments_idx on public.org_post_comments (post_id, created_at);

create table if not exists public.lucky_draws (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('ORG_CAMPAIGN', 'CHALLENGE', 'CLUB', 'RACE', 'SYSTEM')),
  ref_id uuid,
  title text not null check (char_length(title) between 3 and 120),
  rule text not null default 'COMPLETED' check (rule in ('COMPLETED', 'ACTIVE', 'ALL')),
  prizes jsonb not null,
  exclude_winners boolean not null default true,
  status text not null default 'READY' check (status in ('READY', 'DONE', 'CANCELLED')),
  seed text,
  entrant_count integer,
  entrants_hash text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  run_by uuid references public.profiles(id) on delete set null,
  run_at timestamptz,
  check ((scope = 'SYSTEM') = (ref_id is null))
);
create index if not exists lucky_draws_ref_idx on public.lucky_draws (scope, ref_id, created_at desc);
create table if not exists public.lucky_draw_winners (
  draw_id uuid not null references public.lucky_draws(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  prize text not null,
  position integer not null,
  primary key (draw_id, user_id)
);

alter table public.org_pending_invites enable row level security;
alter table public.org_campaign_results enable row level security;
alter table public.org_posts enable row level security;
alter table public.org_post_likes enable row level security;
alter table public.org_post_comments enable row level security;
alter table public.lucky_draws enable row level security;
alter table public.lucky_draw_winners enable row level security;
revoke all on public.org_pending_invites, public.org_campaign_results, public.org_posts, public.org_post_likes, public.org_post_comments,
  public.lucky_draws, public.lucky_draw_winners from anon, authenticated;

-- Ảnh bài đăng của thành viên: org-media/<org_id>/posts/<user_id>/...
drop policy if exists org_media_post_insert on storage.objects;
create policy org_media_post_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'org-media' and (storage.foldername(name))[2] = 'posts' and (storage.foldername(name))[3] = auth.uid()::text
              and public.org_is_member(((storage.foldername(name))[1])::uuid));

-- ---------------------------------------------------------------------
-- 2. Đơn vị nhiều cấp + trưởng đơn vị
-- ---------------------------------------------------------------------
create or replace function private.org_subtree(p_unit uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  with recursive t as (
    select u.id, 1 as lvl from public.org_units u where u.id = p_unit
    union all
    select u.id, t.lvl + 1 from public.org_units u join t on u.parent_id = t.id where t.lvl < 10
  )
  select coalesce(array_agg(t.id), '{}'::uuid[]) from t
$$;

create or replace function private.org_unit_depth(p_unit uuid) returns integer
language sql stable security definer set search_path = public as $$
  with recursive t as (
    select u.id, u.parent_id, 1 as lvl from public.org_units u where u.id = p_unit
    union all
    select u.id, u.parent_id, t.lvl + 1 from public.org_units u join t on u.id = t.parent_id where t.lvl < 10
  )
  select coalesce(max(t.lvl), 0) from t
$$;

-- Đơn vị người gọi được quản lý: null = toàn tổ chức (quản trị); mảng rỗng = không quản lý đơn vị nào
create or replace function private.org_my_units(p_org uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select case when public.org_is_admin(p_org) then null
              else coalesce((select private.org_subtree(m.unit_id) from public.org_members m
                              where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'APPROVED'
                                and m.role = 'UNIT_ADMIN' and m.unit_id is not null), '{}'::uuid[]) end
$$;

create or replace function private.org_can_manage(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select private.org_my_units(p_org) is null or cardinality(private.org_my_units(p_org)) > 0
$$;

create or replace function private.user_email(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select lower(u.email) from auth.users u where u.id = p_user
$$;

-- Thông tin công khai trong tổ chức (thêm cài đặt 008400)
create or replace function private.org_json(o public.organizations) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', o.id, 'name', o.name, 'kind', o.kind, 'description', o.description, 'logo_url', o.logo_url,
    'cover_url', o.cover_url, 'cover_position', o.cover_position, 'tagline', o.tagline, 'theme', o.theme,
    'join_policy', o.join_policy, 'unit_label', o.unit_label, 'allow_self_unit', o.allow_self_unit,
    'status', o.status, 'active_until', o.active_until, 'active', private.org_active(o.id),
    'seat_limit', o.seat_limit, 'seats_used', private.org_seats_used(o.id), 'club_limit', o.club_limit,
    'include_club_pro', o.include_club_pro,
    'club_count', (select count(*)::int from public.org_clubs oc where oc.org_id = o.id and oc.status = 'APPROVED'),
    'email_domains', to_jsonb(o.email_domains), 'domain_auto_approve', o.domain_auto_approve, 'domain_only', o.domain_only,
    'privacy_mode', o.privacy_mode, 'member_posts', o.member_posts,
    'created_at', o.created_at)
$$;

create or replace function public.org_detail(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  o public.organizations := (select x from public.organizations x where x.id = p_org);
  v_admin boolean := public.org_is_admin(p_org);
  v_units uuid[] := private.org_my_units(p_org);
  me public.org_members := (select m from public.org_members m where m.org_id = p_org and m.user_id = v_uid);
begin
  if o.id is null then raise exception 'ORG_NOT_FOUND'; end if;
  if not public.org_is_member(p_org) then raise exception 'NOT_A_MEMBER'; end if;
  return private.org_json(o) || jsonb_build_object(
    'my_role', coalesce(private.org_role(p_org), 'MEMBER'), 'is_admin', v_admin, 'is_system_admin', public.is_system_admin(),
    'is_unit_admin', not v_admin and cardinality(v_units) > 0, 'managed_units', case when v_admin then null else to_jsonb(v_units) end,
    'my_unit_id', me.unit_id, 'is_real_member', me.status = 'APPROVED',
    'units', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'parent_id', u.parent_id,
                 'members', (select count(*)::int from public.org_members m where m.unit_id = u.id and m.status = 'APPROVED')) order by u.sort, u.name)
               from public.org_units u where u.org_id = p_org), '[]'::jsonb),
    'clubs', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url, 'accent_color', c.accent_color,
                 'member_count', c.member_count, 'status', oc.status, 'pro_granted', oc.pro_granted) order by oc.status, c.name)
               from public.org_clubs oc join public.clubs c on c.id = oc.club_id
              where oc.org_id = p_org and (oc.status = 'APPROVED' or v_admin)), '[]'::jsonb),
    'pending_members', case when v_admin or cardinality(v_units) > 0 then
                         (select count(*)::int from public.org_members m where m.org_id = p_org and m.status = 'PENDING'
                             and (v_admin or m.unit_id = any(v_units))) end,
    'pending_invites', case when v_admin then (select count(*)::int from public.org_pending_invites i where i.org_id = p_org) end,
    'invite_code', case when v_admin or cardinality(v_units) > 0 then o.invite_code end,
    'billing', case when v_admin then jsonb_build_object('legal_name', o.legal_name, 'tax_code', o.tax_code, 'contact_name', o.contact_name,
                                                         'contact_phone', o.contact_phone, 'contact_email', o.contact_email) end);
end $$;

create or replace function public.org_invite_preview(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  o public.organizations := (select x from public.organizations x where x.invite_code = upper(trim(coalesce(p_code, ''))));
  v_email text := private.user_email(v_uid);
  v_invited boolean;
  v_domain_ok boolean;
begin
  if o.id is null then return null; end if;
  v_invited := exists (select 1 from public.org_pending_invites i where i.org_id = o.id and i.email = v_email);
  v_domain_ok := split_part(coalesce(v_email, ''), '@', 2) = any(o.email_domains);
  return jsonb_build_object('id', o.id, 'name', o.name, 'kind', o.kind, 'logo_url', o.logo_url, 'cover_url', o.cover_url,
    'cover_position', o.cover_position, 'theme', o.theme, 'tagline', o.tagline, 'description', o.description,
    'join_policy', o.join_policy, 'unit_label', o.unit_label, 'allow_self_unit', o.allow_self_unit,
    'active', private.org_active(o.id), 'full', private.org_seats_used(o.id) >= o.seat_limit,
    'member_count', private.org_seats_used(o.id),
    'units', case when o.allow_self_unit then coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'parent_id', u.parent_id) order by u.sort, u.name)
                                                          from public.org_units u where u.org_id = o.id), '[]'::jsonb) else '[]'::jsonb end,
    'domain_only', o.domain_only, 'email_domains', to_jsonb(o.email_domains), 'invited', v_invited,
    'auto_approve', v_invited or o.join_policy = 'OPEN' or (o.domain_auto_approve and v_domain_ok),
    'blocked', o.domain_only and not v_domain_ok and not v_invited,
    'my_status', (select m.status from public.org_members m where m.org_id = o.id and m.user_id = v_uid));
end $$;

create or replace function public.join_org(p_code text, p_unit uuid default null, p_employee_code text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  o public.organizations := (select x from public.organizations x where x.invite_code = upper(trim(coalesce(p_code, ''))));
  v_email text := private.user_email(v_uid);
  inv public.org_pending_invites;
  v_domain_ok boolean;
  v_status text;
  v_unit uuid;
  a record;
begin
  if o.id is null then raise exception 'INVALID_CODE'; end if;
  if not private.org_active(o.id) then raise exception 'ORG_INACTIVE'; end if;
  perform pg_advisory_xact_lock(hashtext('org_seats:' || o.id));
  v_status := (select m.status from public.org_members m where m.org_id = o.id and m.user_id = v_uid);
  if v_status is not null then return jsonb_build_object('org_id', o.id, 'status', v_status, 'duplicate', true); end if;
  inv := (select i from public.org_pending_invites i where i.org_id = o.id and i.email = v_email);
  v_domain_ok := split_part(coalesce(v_email, ''), '@', 2) = any(o.email_domains);
  if o.domain_only and not v_domain_ok and inv.email is null then raise exception 'DOMAIN_REQUIRED'; end if;
  v_unit := coalesce(inv.unit_id, case when o.allow_self_unit then (select u.id from public.org_units u where u.id = p_unit and u.org_id = o.id) end);
  v_status := case when inv.email is not null or o.join_policy = 'OPEN' or (o.domain_auto_approve and v_domain_ok) then 'APPROVED' else 'PENDING' end;
  if v_status = 'APPROVED' and private.org_seats_used(o.id) >= o.seat_limit then raise exception 'ORG_FULL'; end if;
  insert into public.org_members (org_id, user_id, role, status, unit_id, employee_code)
  values (o.id, v_uid, coalesce(inv.role, 'MEMBER'), v_status, v_unit,
          coalesce(inv.employee_code, nullif(left(trim(coalesce(p_employee_code, '')), 40), '')));
  delete from public.org_pending_invites where org_id = o.id and email = v_email;
  if v_status = 'PENDING' then
    for a in select m.user_id from public.org_members m
              where m.org_id = o.id and m.status = 'APPROVED'
                and (m.role in ('OWNER', 'ADMIN') or (m.role = 'UNIT_ADMIN' and v_unit = any(private.org_subtree(m.unit_id)))) loop
      perform private.notify(a.user_id, null, 'ORG_JOIN_REQUEST', private.display_name(v_uid) || ' xin vào ' || o.name,
        'Duyệt ở mục Thành viên của tổ chức.', '/orgs/' || o.id || '?tab=members', v_uid, false);
    end loop;
  end if;
  return jsonb_build_object('org_id', o.id, 'status', v_status);
end $$;

create or replace function public.update_org(p_org uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_domains text[];
begin
  if not public.org_is_admin(p_org) then raise exception 'FORBIDDEN'; end if;
  if p ? 'name' and char_length(trim(coalesce(p->>'name', ''))) < 2 then raise exception 'ORG_NAME_REQUIRED'; end if;
  if p ? 'tagline' and char_length(coalesce(p->>'tagline', '')) > 80 then raise exception 'TAGLINE_TOO_LONG'; end if;
  if p ? 'unit_label' and char_length(trim(coalesce(p->>'unit_label', ''))) not between 2 and 30 then raise exception 'INVALID_UNIT_LABEL'; end if;
  if (p ? 'cover_url' and coalesce(p->>'cover_url', '') <> '' and p->>'cover_url' !~ '^https://')
     or (p ? 'logo_url' and coalesce(p->>'logo_url', '') <> '' and p->>'logo_url' !~ '^https://') then raise exception 'INVALID_URL'; end if;
  if p ? 'email_domains' then
    v_domains := (select coalesce(array_agg(distinct lower(trim(both '@ ' from d.v))), '{}'::text[])
                    from jsonb_array_elements_text(coalesce(p->'email_domains', '[]'::jsonb)) d(v) where trim(d.v) <> '');
    if cardinality(v_domains) > 10 or exists (select 1 from unnest(v_domains) x where x !~ '^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$')
      then raise exception 'INVALID_DOMAIN'; end if;
    if exists (select 1 from unnest(v_domains) x where x in ('gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com'))
      then raise exception 'PUBLIC_DOMAIN'; end if;
  end if;
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
    email_domains = case when p ? 'email_domains' then v_domains else email_domains end,
    domain_auto_approve = coalesce((p->>'domain_auto_approve')::boolean, domain_auto_approve),
    domain_only = coalesce((p->>'domain_only')::boolean, domain_only),
    privacy_mode = coalesce((p->>'privacy_mode')::boolean, privacy_mode),
    member_posts = coalesce((p->>'member_posts')::boolean, member_posts),
    legal_name = case when p ? 'legal_name' then nullif(left(trim(coalesce(p->>'legal_name', '')), 200), '') else legal_name end,
    tax_code = case when p ? 'tax_code' then nullif(left(trim(coalesce(p->>'tax_code', '')), 20), '') else tax_code end,
    contact_name = case when p ? 'contact_name' then nullif(left(trim(coalesce(p->>'contact_name', '')), 80), '') else contact_name end,
    contact_phone = case when p ? 'contact_phone' then nullif(left(trim(coalesce(p->>'contact_phone', '')), 20), '') else contact_phone end,
    contact_email = case when p ? 'contact_email' then nullif(left(trim(coalesce(p->>'contact_email', '')), 120), '') else contact_email end
   where id = p_org;
  if coalesce((select o.domain_only and cardinality(o.email_domains) = 0 from public.organizations o where o.id = p_org), false) then
    raise exception 'DOMAIN_REQUIRED_LIST';
  end if;
  return public.org_detail(p_org);
end $$;

drop function if exists public.save_org_unit(uuid, uuid, text);
create or replace function public.save_org_unit(p_org uuid, p_id uuid, p_name text, p_parent uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id; v_name text := trim(coalesce(p_name, ''));
begin
  if not public.org_is_admin(p_org) then raise exception 'FORBIDDEN'; end if;
  if char_length(v_name) not between 1 and 80 then raise exception 'INVALID_NAME'; end if;
  if p_parent is not null then
    if not exists (select 1 from public.org_units u where u.id = p_parent and u.org_id = p_org) then raise exception 'NOT_FOUND'; end if;
    if p_id is not null and p_parent = any(private.org_subtree(p_id)) then raise exception 'UNIT_CYCLE'; end if;
    if private.org_unit_depth(p_parent) >= 4 then raise exception 'UNIT_DEPTH'; end if;
  end if;
  if exists (select 1 from public.org_units u where u.org_id = p_org and lower(u.name) = lower(v_name)
               and u.parent_id is not distinct from p_parent and u.id is distinct from p_id) then
    raise exception 'UNIT_EXISTS';
  end if;
  if p_id is null and (select count(*) from public.org_units u where u.org_id = p_org) >= 500 then raise exception 'UNIT_LIMIT'; end if;
  if v_id is null then
    insert into public.org_units (org_id, name, parent_id, sort)
    values (p_org, v_name, p_parent, coalesce((select max(u.sort) from public.org_units u where u.org_id = p_org), 0) + 1)
    returning id into v_id;
  else
    update public.org_units set name = v_name, parent_id = p_parent where id = p_id and org_id = p_org;
    if not found then raise exception 'NOT_FOUND'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.org_members_list(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_units uuid[] := private.org_my_units(p_org);
  v_admin boolean := v_units is null;
begin
  if not public.org_is_member(p_org) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', private.display_name(m.user_id), 'avatar_url', pr.avatar_url,
             'role', m.role, 'status', m.status, 'unit_id', m.unit_id, 'unit_name', u.name, 'joined_at', m.joined_at,
             'employee_code', case when v_admin or m.unit_id = any(v_units) then m.employee_code end,
             'manageable', m.role <> 'OWNER' and (v_admin or (m.role = 'MEMBER' and m.unit_id = any(v_units))))
             order by (m.status = 'PENDING') desc, case m.role when 'OWNER' then 0 when 'ADMIN' then 1 when 'UNIT_ADMIN' then 2 else 3 end,
                      private.display_name(m.user_id))
           from public.org_members m join public.profiles pr on pr.id = m.user_id left join public.org_units u on u.id = m.unit_id
          where m.org_id = p_org and (m.status = 'APPROVED' or v_admin or m.unit_id = any(v_units))), '[]'::jsonb);
end $$;

create or replace function public.set_org_member(p_org uuid, p_user uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_units uuid[] := private.org_my_units(p_org);
  v_admin boolean := v_units is null;
  m public.org_members := (select x from public.org_members x where x.org_id = p_org and x.user_id = p_user);
  v_org text := (select o.name from public.organizations o where o.id = p_org);
  v_unit uuid;
begin
  if not v_admin and cardinality(v_units) = 0 then raise exception 'FORBIDDEN'; end if;
  if m.user_id is null then raise exception 'MEMBER_NOT_FOUND'; end if;
  -- Trưởng đơn vị: chỉ thành viên thường trong đơn vị mình
  if not v_admin and (m.role <> 'MEMBER' or m.unit_id is null or not (m.unit_id = any(v_units))) then raise exception 'FORBIDDEN'; end if;
  if p->>'action' = 'REMOVE' then
    if m.role = 'OWNER' then raise exception 'OWNER_CANNOT_LEAVE'; end if;
    delete from public.org_members where org_id = p_org and user_id = p_user;
    return;
  end if;
  perform pg_advisory_xact_lock(hashtext('org_seats:' || p_org));
  if p ? 'unit_id' then
    v_unit := (select u.id from public.org_units u where u.id = nullif(p->>'unit_id', '')::uuid and u.org_id = p_org);
    if not v_admin and (v_unit is null or not (v_unit = any(v_units))) then raise exception 'FORBIDDEN'; end if;
    update public.org_members set unit_id = v_unit where org_id = p_org and user_id = p_user;
  end if;
  if p->>'status' = 'APPROVED' and m.status = 'PENDING' then
    if private.org_seats_used(p_org) >= (select o.seat_limit from public.organizations o where o.id = p_org) then raise exception 'ORG_FULL'; end if;
    update public.org_members set status = 'APPROVED', joined_at = now() where org_id = p_org and user_id = p_user;
    perform private.notify(p_user, null, 'ORG_APPROVED', 'Bạn đã vào ' || coalesce(v_org, 'tổ chức'), 'Xem chiến dịch đang diễn ra.',
      '/orgs/' || p_org, v_uid, false);
  end if;
  if p->>'role' in ('ADMIN', 'UNIT_ADMIN', 'MEMBER') then
    if not v_admin or m.role = 'OWNER' then raise exception 'FORBIDDEN'; end if;
    if p->>'role' = 'UNIT_ADMIN' and (select x.unit_id from public.org_members x where x.org_id = p_org and x.user_id = p_user) is null then
      raise exception 'UNIT_REQUIRED';
    end if;
    update public.org_members set role = p->>'role' where org_id = p_org and user_id = p_user;
  end if;
  if p ? 'employee_code' then
    update public.org_members set employee_code = nullif(left(trim(coalesce(p->>'employee_code', '')), 40), '') where org_id = p_org and user_id = p_user;
  end if;
end $$;

-- Tìm / tạo đơn vị theo đường dẫn "Vùng 1 / Chi nhánh A / Phòng KT"
create or replace function private.org_unit_path(p_org uuid, p_path text, p_create boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_parent uuid := null;
  v_id uuid;
  seg text;
  n integer := 0;
begin
  for seg in select trim(s.x) from unnest(regexp_split_to_array(coalesce(p_path, ''), '\s*[/>]\s*')) with ordinality as s(x, i)
              where trim(s.x) <> '' order by s.i loop
    n := n + 1;
    if n > 4 then raise exception 'UNIT_DEPTH'; end if;
    v_id := (select u.id from public.org_units u where u.org_id = p_org and u.parent_id is not distinct from v_parent
               and lower(u.name) = lower(left(seg, 80)));
    if v_id is null then
      if not p_create then return null; end if;
      insert into public.org_units (org_id, name, parent_id, sort)
      values (p_org, left(seg, 80), v_parent, coalesce((select max(u.sort) from public.org_units u where u.org_id = p_org), 0) + 1)
      returning id into v_id;
    end if;
    v_parent := v_id;
  end loop;
  return v_parent;
end $$;

-- Nhập danh sách từ Excel / CSV (quản trị tổ chức)
create or replace function public.org_import_members(p_org uuid, p_rows jsonb, p_opts jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_create boolean := coalesce((p_opts->>'create_units')::boolean, true);
  v_remove boolean := coalesce((p_opts->>'remove_missing')::boolean, false);
  v_seats integer := (select o.seat_limit from public.organizations o where o.id = p_org);
  r jsonb;
  v_email text;
  v_user uuid;
  v_unit uuid;
  v_role text;
  v_code text;
  v_cur public.org_members;
  v_units_before integer := (select count(*) from public.org_units u where u.org_id = p_org);
  v_emails text[] := '{}';
  n_added integer := 0; n_updated integer := 0; n_invited integer := 0; n_removed integer := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  if not public.org_is_admin(p_org) then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then raise exception 'INVALID_ROWS'; end if;
  perform pg_advisory_xact_lock(hashtext('org_seats:' || p_org));
  for r in select x from jsonb_array_elements(p_rows) x loop
    v_email := lower(trim(coalesce(r->>'email', '')));
    if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      v_errors := v_errors || jsonb_build_object('email', left(v_email, 120), 'error', 'INVALID_EMAIL');
      continue;
    end if;
    v_emails := v_emails || v_email;
    begin
      v_unit := case when coalesce(trim(r->>'unit'), '') <> '' then private.org_unit_path(p_org, r->>'unit', v_create) end;
    exception when others then
      v_errors := v_errors || jsonb_build_object('email', v_email, 'error', 'UNIT_DEPTH');
      continue;
    end;
    v_role := case when upper(coalesce(r->>'role', '')) in ('UNIT_ADMIN', 'TRUONG_DON_VI') and v_unit is not null then 'UNIT_ADMIN' else 'MEMBER' end;
    v_code := nullif(left(trim(coalesce(r->>'employee_code', '')), 40), '');
    v_user := (select u.id from auth.users u where lower(u.email) = v_email);
    if v_user is null then
      insert into public.org_pending_invites (org_id, email, unit_id, employee_code, role) values (p_org, v_email, v_unit, v_code, v_role)
      on conflict (org_id, email) do update set unit_id = excluded.unit_id, employee_code = excluded.employee_code, role = excluded.role;
      n_invited := n_invited + 1;
      continue;
    end if;
    v_cur := (select m from public.org_members m where m.org_id = p_org and m.user_id = v_user);
    if v_cur.user_id is null or v_cur.status = 'PENDING' then
      if private.org_seats_used(p_org) >= v_seats then
        v_errors := v_errors || jsonb_build_object('email', v_email, 'error', 'ORG_FULL');
        continue;
      end if;
      insert into public.org_members (org_id, user_id, role, status, unit_id, employee_code)
      values (p_org, v_user, v_role, 'APPROVED', v_unit, v_code)
      on conflict (org_id, user_id) do update set status = 'APPROVED', unit_id = coalesce(excluded.unit_id, org_members.unit_id),
             employee_code = coalesce(excluded.employee_code, org_members.employee_code), role = excluded.role, joined_at = now();
      n_added := n_added + 1;
      perform private.notify(v_user, null, 'ORG_APPROVED', 'Bạn đã được thêm vào ' || (select o.name from public.organizations o where o.id = p_org),
        'Xem chiến dịch đang diễn ra.', '/orgs/' || p_org, v_uid, false);
    else
      update public.org_members set unit_id = coalesce(v_unit, unit_id), employee_code = coalesce(v_code, employee_code),
             role = case when role in ('OWNER', 'ADMIN') then role else v_role end
       where org_id = p_org and user_id = v_user;
      n_updated := n_updated + 1;
    end if;
  end loop;
  if v_remove then
    n_removed := (select count(*)::int from public.org_members m where m.org_id = p_org and m.role in ('MEMBER', 'UNIT_ADMIN')
                    and not (coalesce(private.user_email(m.user_id), '') = any(v_emails)));
    delete from public.org_members m where m.org_id = p_org and m.role in ('MEMBER', 'UNIT_ADMIN')
       and not (coalesce(private.user_email(m.user_id), '') = any(v_emails));
    delete from public.org_pending_invites i where i.org_id = p_org and not (i.email = any(v_emails));
  end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'ORG_IMPORT', 'org:' || p_org, jsonb_build_object('rows', jsonb_array_length(p_rows), 'added', n_added, 'updated', n_updated,
          'invited', n_invited, 'removed', n_removed, 'remove_missing', v_remove));
  return jsonb_build_object('added', n_added, 'updated', n_updated, 'invited', n_invited, 'removed', n_removed,
    'units_created', (select count(*)::int from public.org_units u where u.org_id = p_org) - v_units_before, 'errors', v_errors);
end $$;

create or replace function public.org_pending_invites_list(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.org_is_admin(p_org) then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('email', i.email, 'unit_name', u.name, 'employee_code', i.employee_code, 'role', i.role,
             'created_at', i.created_at) order by i.created_at desc)
           from public.org_pending_invites i left join public.org_units u on u.id = i.unit_id where i.org_id = p_org), '[]'::jsonb);
end $$;

create or replace function public.delete_org_pending_invite(p_org uuid, p_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.org_is_admin(p_org) then raise exception 'FORBIDDEN'; end if;
  delete from public.org_pending_invites where org_id = p_org and email = lower(trim(coalesce(p_email, '')));
end $$;

-- ---------------------------------------------------------------------
-- 3. Chiến dịch: trần km / ngày, ngày hội ×2 / ×3, chốt kết quả + duyệt top N
-- ---------------------------------------------------------------------
-- Số liệu theo ngày (giờ VN): km mỗi ngày bị chặn ở trần; ngày hội nhân hệ số cho km / số buổi (số ngày chạy không nhân)
create or replace function private.org_day_stats(p_user uuid, p_from timestamptz, p_to timestamptz, p_min_km numeric, p_cap numeric, p_boost jsonb)
returns table (dist_value numeric, runs_value numeric, km numeric, runs integer, active_days integer)
language sql stable security definer set search_path = public as $$
  with d as (
    select (x.started_at at time zone 'Asia/Ho_Chi_Minh')::date as day, sum(x.distance_m) / 1000.0 as km, count(*)::int as runs
      from public.activities x
     where x.user_id = p_user and x.validation_status = 'APPROVED' and x.shared
       and public.activity_is_countable(x.status, x.validation_status)
       and x.started_at >= p_from and x.started_at < p_to and coalesce(x.distance_m, 0) >= coalesce(p_min_km, 0) * 1000
     group by 1
  ), e as (
    select d.day, d.runs, least(d.km, coalesce(p_cap, d.km)) as ckm,
           coalesce((select max(least(greatest((b->>'mult')::numeric, 1), 3)) from jsonb_array_elements(coalesce(p_boost, '[]'::jsonb)) b
                      where (b->>'date') = to_char(d.day, 'YYYY-MM-DD')), 1) as mult
      from d
  )
  select coalesce(round(sum(e.ckm * e.mult), 2), 0), coalesce(sum(e.runs * e.mult), 0), coalesce(round(sum(e.ckm), 2), 0),
         coalesce(sum(e.runs), 0)::int, count(*)::int
    from e
$$;

create or replace function private.org_campaign_rows(c public.org_campaigns)
returns table (user_id uuid, unit_id uuid, direct boolean, value numeric, km numeric, runs integer, active_days integer)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if c.locked_at is not null then
    return query select r.user_id, r.unit_id, r.direct, r.value, r.km, r.runs, r.active_days
                   from public.org_campaign_results r where r.campaign_id = c.id and r.review_status <> 'DQ';
  else
    return query select pp.user_id, pp.unit_id, pp.direct,
                        case c.metric when 'DISTANCE' then s.dist_value when 'RUNS' then s.runs_value else s.active_days::numeric end,
                        s.km, s.runs, s.active_days
                   from private.org_people(c.org_id) pp
                   cross join lateral private.org_day_stats(pp.user_id, c.starts_at, least(c.ends_at, now()), c.min_run_km, c.daily_cap_km, c.boost_days) s;
  end if;
end $$;

create or replace function private.org_clean_boost(p jsonb, p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('date', t.day, 'mult', t.mult) order by t.day), '[]'::jsonb)
    from (select distinct on (b->>'date') b->>'date' as day, least(greatest(coalesce((b->>'mult')::int, 2), 2), 3) as mult
            from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) b
           where coalesce(b->>'date', '') ~ '^\d{4}-\d{2}-\d{2}$'
             and (b->>'date')::date between (p_from at time zone 'Asia/Ho_Chi_Minh')::date and ((p_to - interval '1 second') at time zone 'Asia/Ho_Chi_Minh')::date
           order by b->>'date') t
$$;

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
  v_boost jsonb;
  r record;
begin
  if not public.org_is_admin(p_org) then raise exception 'FORBIDDEN'; end if;
  if not private.org_active(p_org) then raise exception 'ORG_INACTIVE'; end if;
  if char_length(v_title) not between 3 and 120 then raise exception 'TITLE_REQUIRED'; end if;
  if v_metric not in ('DISTANCE', 'RUNS', 'ACTIVE_DAYS') then raise exception 'INVALID_METRIC'; end if;
  if v_start is null or v_end is null or v_end <= v_start or v_end - v_start > interval '366 days' then raise exception 'INVALID_TIME_RANGE'; end if;
  if p_id is not null and (select c.locked_at from public.org_campaigns c where c.id = p_id) is not null then raise exception 'CAMPAIGN_LOCKED'; end if;
  v_boost := private.org_clean_boost(p->'boost_days', v_start, v_end);
  if jsonb_array_length(v_boost) > 20 then raise exception 'TOO_MANY_BOOST_DAYS'; end if;
  if v_id is null then
    insert into public.org_campaigns (org_id, title, description, metric, starts_at, ends_at, goal_total, goal_per_person, min_run_km,
                                      daily_cap_km, review_top, boost_days, cert_enabled, created_by)
    values (p_org, v_title, nullif(left(trim(coalesce(p->>'description', '')), 2000), ''), v_metric, v_start, v_end,
            nullif(p->>'goal_total', '')::numeric, nullif(p->>'goal_per_person', '')::numeric,
            coalesce(nullif(p->>'min_run_km', '')::numeric, 1), nullif(p->>'daily_cap_km', '')::numeric,
            coalesce(nullif(p->>'review_top', '')::int, 0), v_boost, coalesce((p->>'cert_enabled')::boolean, false), v_uid)
    returning id into v_id;
    insert into public.org_posts (org_id, author_id, kind, body, meta, is_pinned)
    values (p_org, v_uid, 'CAMPAIGN', 'Chiến dịch mới: ' || v_title || coalesce(E'\n' || nullif(left(trim(coalesce(p->>'description', '')), 400), ''), ''),
            jsonb_build_object('campaign_id', v_id), false);
    for r in select pp.user_id from private.org_people(p_org) pp loop
      perform private.notify(r.user_id, null, 'ORG_CAMPAIGN', coalesce(v_org, 'Tổ chức') || ': ' || v_title,
        'Chiến dịch mới — bài chạy hợp lệ của bạn được tính tự động.', '/orgs/' || p_org || '/campaigns/' || v_id, v_uid, false);
    end loop;
  else
    update public.org_campaigns set title = v_title, description = nullif(left(trim(coalesce(p->>'description', '')), 2000), ''),
           metric = v_metric, starts_at = v_start, ends_at = v_end,
           goal_total = nullif(p->>'goal_total', '')::numeric, goal_per_person = nullif(p->>'goal_per_person', '')::numeric,
           min_run_km = coalesce(nullif(p->>'min_run_km', '')::numeric, 1), daily_cap_km = nullif(p->>'daily_cap_km', '')::numeric,
           review_top = coalesce(nullif(p->>'review_top', '')::int, 0), boost_days = v_boost,
           cert_enabled = coalesce((p->>'cert_enabled')::boolean, cert_enabled)
     where id = p_id and org_id = p_org;
    if not found then raise exception 'NOT_FOUND'; end if;
  end if;
  return v_id;
end $$;

-- Chốt kết quả sau khi kết thúc: lưu bảng cố định; top N chờ duyệt trước khi trao giải
create or replace function public.lock_org_campaign(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.org_campaigns := (select x from public.org_campaigns x where x.id = p_id for update);
begin
  if c.id is null or not public.org_is_admin(c.org_id) then raise exception 'FORBIDDEN'; end if;
  if c.locked_at is not null then raise exception 'CAMPAIGN_LOCKED'; end if;
  if c.ends_at > now() then raise exception 'CAMPAIGN_NOT_ENDED'; end if;
  insert into public.org_campaign_results (campaign_id, user_id, unit_id, direct, value, km, runs, active_days, rank, review_status)
  select c.id, t.user_id, t.unit_id, t.direct, t.value, t.km, t.runs, t.active_days, t.rn,
         case when t.rn <= c.review_top and t.value > 0 then 'PENDING' else 'OK' end
    from (select r.*, row_number() over (order by r.value desc, r.km desc, r.user_id) as rn from private.org_campaign_rows(c) r) t
  on conflict (campaign_id, user_id) do nothing;
  update public.org_campaigns set locked_at = now(), locked_by = v_uid where id = p_id;
  return jsonb_build_object('locked', true, 'pending', (select count(*)::int from public.org_campaign_results r where r.campaign_id = p_id and r.review_status = 'PENDING'));
end $$;

create or replace function public.review_campaign_result(p_campaign uuid, p_user uuid, p_ok boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.org_campaigns := (select x from public.org_campaigns x where x.id = p_campaign);
begin
  if c.id is null or not public.org_is_admin(c.org_id) then raise exception 'FORBIDDEN'; end if;
  if c.locked_at is null then raise exception 'CAMPAIGN_NOT_LOCKED'; end if;
  if not p_ok and char_length(trim(coalesce(p_note, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  update public.org_campaign_results set review_status = case when p_ok then 'OK' else 'DQ' end,
         review_note = nullif(left(trim(coalesce(p_note, '')), 300), ''), reviewed_by = v_uid
   where campaign_id = p_campaign and user_id = p_user;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not p_ok then
    perform private.notify(p_user, null, 'ORG_CAMPAIGN_DQ', 'Kết quả chiến dịch “' || c.title || '” không được công nhận',
      left(trim(p_note), 300), '/orgs/' || c.org_id || '/campaigns/' || c.id, v_uid, true);
  end if;
end $$;

create or replace function public.org_campaign_board(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c public.org_campaigns := (select x from public.org_campaigns x where x.id = p_id);
  o public.organizations;
  v_admin boolean;
  v_hide boolean;
begin
  if c.id is null then raise exception 'NOT_FOUND'; end if;
  if not (public.org_is_member(c.org_id) or exists (select 1 from private.org_people(c.org_id) pp where pp.user_id = auth.uid())) then
    raise exception 'NOT_A_MEMBER';
  end if;
  o := (select x from public.organizations x where x.id = c.org_id);
  v_admin := public.org_is_admin(c.org_id);
  v_hide := o.privacy_mode and not v_admin;
  return (
    with recursive tree as (
      select u.id as anc, u.id as des, 1 as lvl from public.org_units u where u.org_id = c.org_id
      union all
      select t.anc, ch.id, t.lvl + 1 from tree t join public.org_units ch on ch.parent_id = t.des where t.lvl < 10
    ),
    rows as (select * from private.org_campaign_rows(c)),
    ranked as (select r.*, row_number() over (order by r.value desc, r.km desc, r.user_id) as rn from rows r),
    units as (
      select u.id, u.name, u.parent_id, count(r.user_id)::int as members, count(r.user_id) filter (where r.value > 0)::int as active,
             coalesce(sum(r.value), 0) as total
        from public.org_units u join tree t on t.anc = u.id left join rows r on r.unit_id = t.des
       where u.org_id = c.org_id group by u.id, u.name, u.parent_id
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
      'campaign', to_jsonb(c) - 'cert_design' || jsonb_build_object('org_name', o.name, 'org_logo', o.logo_url, 'has_cert_design', c.cert_design is not null,
                                                  'cert_design', case when v_admin then c.cert_design end),
      'is_admin', v_admin, 'privacy_mode', o.privacy_mode, 'hidden', v_hide, 'locked', c.locked_at is not null,
      'pending_reviews', case when v_admin then (select count(*)::int from public.org_campaign_results x where x.campaign_id = c.id and x.review_status = 'PENDING') end,
      'disqualified', case when v_admin then coalesce((select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'name', private.display_name(x.user_id),
                        'value', x.value, 'note', x.review_note)) from public.org_campaign_results x where x.campaign_id = c.id and x.review_status = 'DQ'), '[]'::jsonb) end,
      'total', (select coalesce(sum(r.value), 0) from rows r),
      'total_km', (select coalesce(sum(r.km), 0) from rows r),
      'participants', (select count(*)::int from rows),
      'active', (select count(*)::int from rows r where r.value > 0),
      'completed', (select count(*)::int from rows r where c.goal_per_person is not null and r.value >= c.goal_per_person),
      'me', (select jsonb_build_object('rank', k.rn, 'value', k.value, 'km', k.km, 'runs', k.runs, 'active_days', k.active_days,
                                       'completed', c.goal_per_person is not null and k.value >= c.goal_per_person)
               from ranked k where k.user_id = auth.uid()),
      'people', case when v_hide then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('rank', k.rn, 'user_id', k.user_id,
                   'name', private.display_name(k.user_id), 'avatar_url', pr.avatar_url, 'unit_name', u.name, 'value', k.value, 'km', k.km,
                   'runs', k.runs, 'active_days', k.active_days, 'completed', c.goal_per_person is not null and k.value >= c.goal_per_person,
                   'review_status', case when v_admin then res.review_status end) order by k.rn)
                 from ranked k join public.profiles pr on pr.id = k.user_id left join public.org_units u on u.id = k.unit_id
                 left join public.org_campaign_results res on res.campaign_id = c.id and res.user_id = k.user_id
                where k.rn <= 500), '[]'::jsonb) end,
      'units', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'parent_id', x.parent_id, 'members', x.members,
                   'active', x.active, 'total', x.total, 'avg', case when x.members > 0 then round(x.total / x.members, 2) else 0 end)
                   order by x.total desc) from units x), '[]'::jsonb),
      'clubs', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'avatar_url', x.avatar_url, 'accent_color', x.accent_color,
                   'members', x.members, 'active', x.active, 'total', x.total,
                   'avg', case when x.members > 0 then round(x.total / x.members, 2) else 0 end) order by x.total desc) from clubs x), '[]'::jsonb)));
end $$;

-- Báo cáo: quản trị xem toàn tổ chức, trưởng đơn vị xem đơn vị mình (kể cả đơn vị con)
create or replace function public.org_report(p_org uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_units uuid[] := private.org_my_units(p_org);
begin
  if not private.org_can_manage(p_org) then raise exception 'FORBIDDEN'; end if;
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
           left join public.org_units u on u.id = pp.unit_id
          where v_units is null or pp.unit_id = any(v_units)), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- 4. Chứng nhận hoàn thành chiến dịch (thiết kế như chứng nhận giải chạy ảo)
-- ---------------------------------------------------------------------
create or replace function public.set_org_campaign_cert(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c public.org_campaigns := (select x from public.org_campaigns x where x.id = p_id);
  v_prefix text;
begin
  if c.id is null or not public.org_is_admin(c.org_id) then raise exception 'FORBIDDEN'; end if;
  if p is null or jsonb_typeof(p) = 'null' then
    update public.org_campaigns set cert_design = null where id = p_id;
    return null;
  end if;
  if jsonb_typeof(p) <> 'object' or length(p::text) > 200000 or jsonb_array_length(coalesce(p->'layers', '[]'::jsonb)) > 40 then
    raise exception 'INVALID_CERT_DESIGN';
  end if;
  -- Ảnh chỉ lấy từ kho ảnh của tổ chức
  v_prefix := '/storage/v1/object/public/org-media/' || c.org_id::text || '/';
  if exists (select 1 from (select p->>'bg_url' as u union all select p->>'art_url'
                            union all select l->>'src' from jsonb_array_elements(coalesce(p->'layers', '[]'::jsonb)) l) x
              where x.u is not null and (x.u !~ '^https://' or position(v_prefix in x.u) = 0)) then
    raise exception 'INVALID_CERT_IMAGE';
  end if;
  update public.org_campaigns set cert_design = p, cert_enabled = true where id = p_id;
  return p;
end $$;

-- Dữ liệu chứng nhận của tôi: đạt mục tiêu cá nhân (hoặc có chạy, khi chiến dịch không đặt mục tiêu và đã kết thúc)
create or replace function public.org_campaign_certificate(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.org_campaigns := (select x from public.org_campaigns x where x.id = p_id);
  o public.organizations;
  me jsonb;
  v_total integer;
begin
  if c.id is null then raise exception 'NOT_FOUND'; end if;
  if not c.cert_enabled then raise exception 'CERT_DISABLED'; end if;
  o := (select x from public.organizations x where x.id = c.org_id);
  me := (select to_jsonb(k) from (select r.*, row_number() over (order by r.value desc, r.km desc, r.user_id) as rn from private.org_campaign_rows(c) r) k
          where k.user_id = v_uid);
  v_total := (select count(*)::int from private.org_campaign_rows(c));
  if me is null
     or (c.goal_per_person is not null and (me->>'value')::numeric < c.goal_per_person)
     or (c.goal_per_person is null and ((me->>'value')::numeric <= 0 or c.ends_at > now())) then
    raise exception 'NOT_ELIGIBLE';
  end if;
  return jsonb_build_object('design', c.cert_design, 'campaign', c.title, 'metric', c.metric, 'org_name', o.name, 'org_logo', o.logo_url,
    'name', private.display_name(v_uid), 'unit_name', (select u.name from public.org_units u where u.id = (me->>'unit_id')::uuid),
    'value', (me->>'value')::numeric, 'km', (me->>'km')::numeric, 'runs', (me->>'runs')::int, 'active_days', (me->>'active_days')::int,
    'rank', (me->>'rn')::int, 'participants', v_total, 'date', least(c.ends_at, now()), 'starts_at', c.starts_at, 'ends_at', c.ends_at);
end $$;

-- ---------------------------------------------------------------------
-- 5. Bảng tin tổ chức (mô hình như CLB)
-- ---------------------------------------------------------------------
create or replace function private.org_post_json(x public.org_posts) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(x) || jsonb_build_object('author_name', private.display_name(x.author_id),
    'author_avatar', (select pr.avatar_url from public.profiles pr where pr.id = x.author_id),
    'likes', (select count(*)::int from public.org_post_likes l where l.post_id = x.id),
    'liked', exists (select 1 from public.org_post_likes l where l.post_id = x.id and l.user_id = auth.uid()),
    'comments', (select count(*)::int from public.org_post_comments cm where cm.post_id = x.id),
    'can_delete', x.author_id = auth.uid() or public.org_is_admin(x.org_id))
$$;

create or replace function public.org_feed(p_org uuid, p_before timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.org_is_member(p_org) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(private.org_post_json(t.x) order by t.rn)
           from (select x, row_number() over (order by (x.is_pinned and p_before is null) desc, x.created_at desc) as rn
                   from public.org_posts x where x.org_id = p_org and (p_before is null or x.created_at < p_before)) t
          where t.rn <= 20), '[]'::jsonb);
end $$;

create or replace function public.create_org_post(p_org uuid, p_body text, p_image_url text default null, p_announce boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_manage boolean := private.org_can_manage(p_org);
  v_post public.org_posts;
begin
  if not public.org_is_member(p_org) then raise exception 'NOT_A_MEMBER'; end if;
  if not v_manage and not coalesce((select o.member_posts from public.organizations o where o.id = p_org), false) then raise exception 'POSTS_ADMIN_ONLY'; end if;
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 2000 then raise exception 'EMPTY_POST'; end if;
  if p_image_url is not null and position('/storage/v1/object/public/org-media/' || p_org::text || '/' in p_image_url) = 0 then raise exception 'INVALID_IMAGE_PATH'; end if;
  if (select count(*) from public.org_posts x where x.author_id = v_uid and x.created_at > now() - interval '1 day') >= 20 then raise exception 'RATE_LIMITED'; end if;
  insert into public.org_posts (org_id, author_id, kind, body, image_url, is_pinned)
  values (p_org, v_uid, case when p_announce and v_manage then 'ANNOUNCEMENT' else 'POST' end, trim(p_body), p_image_url, p_announce and v_manage)
  returning * into v_post;
  return private.org_post_json(v_post);
end $$;

create or replace function public.delete_org_post(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare x public.org_posts := (select p from public.org_posts p where p.id = p_id);
begin
  if x.id is null then raise exception 'POST_NOT_FOUND'; end if;
  if not (x.author_id = auth.uid() or public.org_is_admin(x.org_id)) then raise exception 'FORBIDDEN'; end if;
  delete from public.org_posts where id = p_id;
end $$;

create or replace function public.pin_org_post(p_id uuid, p_pin boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := (select p.org_id from public.org_posts p where p.id = p_id);
begin
  if v_org is null or not public.org_is_admin(v_org) then raise exception 'FORBIDDEN'; end if;
  update public.org_posts set is_pinned = coalesce(p_pin, false) where id = p_id;
end $$;

create or replace function public.toggle_org_post_like(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_org uuid := (select p.org_id from public.org_posts p where p.id = p_id);
begin
  if v_org is null or not public.org_is_member(v_org) then raise exception 'NOT_A_MEMBER'; end if;
  if exists (select 1 from public.org_post_likes l where l.post_id = p_id and l.user_id = v_uid) then
    delete from public.org_post_likes where post_id = p_id and user_id = v_uid;
    return false;
  end if;
  insert into public.org_post_likes (post_id, user_id) values (p_id, v_uid);
  return true;
end $$;

create or replace function public.org_post_comments(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := (select p.org_id from public.org_posts p where p.id = p_id);
begin
  if v_org is null or not public.org_is_member(v_org) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', cm.id, 'body', cm.body, 'created_at', cm.created_at, 'author_id', cm.author_id,
             'author_name', private.display_name(cm.author_id), 'author_avatar', pr.avatar_url,
             'can_delete', cm.author_id = auth.uid() or public.org_is_admin(v_org)) order by cm.created_at)
           from public.org_post_comments cm left join public.profiles pr on pr.id = cm.author_id where cm.post_id = p_id), '[]'::jsonb);
end $$;

create or replace function public.add_org_post_comment(p_id uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  x public.org_posts := (select p from public.org_posts p where p.id = p_id);
begin
  if x.id is null or not public.org_is_member(x.org_id) then raise exception 'NOT_A_MEMBER'; end if;
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 1000 then raise exception 'EMPTY_COMMENT'; end if;
  insert into public.org_post_comments (post_id, author_id, body) values (p_id, v_uid, trim(p_body));
  if x.author_id is not null and x.author_id <> v_uid then
    perform private.notify(x.author_id, null, 'ORG_POST_COMMENT', private.display_name(v_uid) || ' bình luận bài của bạn',
      left(trim(p_body), 120), '/orgs/' || x.org_id || '?tab=feed', v_uid, false);
  end if;
end $$;

create or replace function public.delete_org_post_comment(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  cm public.org_post_comments := (select x from public.org_post_comments x where x.id = p_id);
  v_org uuid := (select p.org_id from public.org_posts p where p.id = cm.post_id);
begin
  if cm.id is null then raise exception 'NOT_FOUND'; end if;
  if not (cm.author_id = auth.uid() or public.org_is_admin(v_org)) then raise exception 'FORBIDDEN'; end if;
  delete from public.org_post_comments where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- 6. Quay thưởng dùng chung toàn app
-- ---------------------------------------------------------------------
create or replace function private.draw_can_manage(p_scope text, p_ref uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_scope
    when 'ORG_CAMPAIGN' then coalesce((select public.org_is_admin(c.org_id) from public.org_campaigns c where c.id = p_ref), false)
    when 'CHALLENGE' then coalesce((select private.challenge_is_manager(c) from public.challenges c where c.id = p_ref), false)
    when 'CLUB' then public.club_is_staff(p_ref)
    when 'RACE' then coalesce((select private.race_is_manager(r) from public.virtual_races r where r.id = p_ref), false)
    when 'SYSTEM' then public.is_system_admin()
    else false end
$$;

create or replace function private.draw_can_view(p_scope text, p_ref uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (private.draw_can_manage(p_scope, p_ref) or case p_scope
    when 'ORG_CAMPAIGN' then coalesce((select public.org_is_member(c.org_id)
                                              or exists (select 1 from private.org_people(c.org_id) pp where pp.user_id = auth.uid())
                                         from public.org_campaigns c where c.id = p_ref), false)
    when 'CHALLENGE' then public.challenge_visible(p_ref)
    when 'CLUB' then public.club_is_member(p_ref)
    when 'RACE' then coalesce((select private.race_visible(r) from public.virtual_races r where r.id = p_ref), false)
    else true end)
$$;

-- Danh sách người đủ điều kiện (COMPLETED: hoàn thành · ACTIVE: có chạy · ALL: mọi người tham gia)
create or replace function private.draw_entrants(p_scope text, p_ref uuid, p_rule text)
returns table (user_id uuid)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare c public.org_campaigns;
begin
  if p_scope = 'ORG_CAMPAIGN' then
    c := (select x from public.org_campaigns x where x.id = p_ref);
    return query select r.user_id from private.org_campaign_rows(c) r
                  where p_rule = 'ALL' or (p_rule = 'ACTIVE' and r.value > 0)
                     or (p_rule = 'COMPLETED' and (case when c.goal_per_person is null then r.value > 0 else r.value >= c.goal_per_person end));
  elsif p_scope = 'CHALLENGE' then
    return query select p.profile_id from public.challenge_participants p
                  where p.challenge_id = p_ref and p.profile_id is not null and coalesce(p.status, 'JOINED') <> 'LEFT'
                    and (p_rule = 'ALL' or (p_rule = 'ACTIVE' and (coalesce(p.current_progress, 0) > 0 or p.distance_m > 0 or p.run_count > 0))
                         or (p_rule = 'COMPLETED' and (p.completed_at is not null or p.status = 'COMPLETED')));
  elsif p_scope = 'RACE' then
    return query select g.user_id from public.race_registrations g
                  where g.race_id = p_ref and g.status <> 'WITHDRAWN' and (p_rule = 'ALL' or g.status = 'FINISHED');
  elsif p_scope = 'CLUB' then
    return query select m.user_id from public.club_members m
                  where m.club_id = p_ref and m.status = 'APPROVED'
                    and (p_rule = 'ALL' or exists (select 1 from public.activities x where x.user_id = m.user_id and x.validation_status = 'APPROVED'
                                                     and public.activity_is_countable(x.status, x.validation_status) and x.started_at > now() - interval '30 days'));
  else
    return query select pr.id from public.profiles pr
                  where p_rule = 'ALL' or exists (select 1 from public.activities x where x.user_id = pr.id and x.validation_status = 'APPROVED'
                                                    and public.activity_is_countable(x.status, x.validation_status) and x.started_at > now() - interval '30 days');
  end if;
end $$;

create or replace function private.draw_json(d public.lucky_draws, p_manage boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(d) - 'created_by' - 'run_by' || jsonb_build_object('can_manage', p_manage,
    'creator_name', private.display_name(d.created_by),
    'winners', coalesce((select jsonb_agg(jsonb_build_object('user_id', w.user_id, 'name', private.display_name(w.user_id),
                  'avatar_url', pr.avatar_url, 'prize', w.prize, 'position', w.position, 'me', w.user_id = auth.uid()) order by w.position)
                from public.lucky_draw_winners w join public.profiles pr on pr.id = w.user_id where w.draw_id = d.id), '[]'::jsonb),
    'eligible_now', case when p_manage and d.status = 'READY' then
                      (select count(*)::int from private.draw_entrants(d.scope, d.ref_id, d.rule) e
                        where not (d.exclude_winners and exists (select 1 from public.lucky_draw_winners w join public.lucky_draws x on x.id = w.draw_id
                                                                  where x.scope = d.scope and x.ref_id is not distinct from d.ref_id and w.user_id = e.user_id))) end)
$$;

create or replace function public.lucky_draws_for(p_scope text, p_ref uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_manage boolean := private.draw_can_manage(p_scope, p_ref);
begin
  if not private.draw_can_view(p_scope, p_ref) then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(private.draw_json(d, v_manage) order by d.created_at desc)
           from public.lucky_draws d where d.scope = p_scope and d.ref_id is not distinct from p_ref
            and (d.status <> 'CANCELLED' or v_manage)), '[]'::jsonb);
end $$;

create or replace function public.create_lucky_draw(p_scope text, p_ref uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_title text := trim(coalesce(p->>'title', ''));
  v_prizes jsonb;
  d public.lucky_draws;
begin
  if p_scope not in ('ORG_CAMPAIGN', 'CHALLENGE', 'CLUB', 'RACE', 'SYSTEM') then raise exception 'INVALID_SCOPE'; end if;
  if not private.draw_can_manage(p_scope, p_ref) then raise exception 'FORBIDDEN'; end if;
  if char_length(v_title) not between 3 and 120 then raise exception 'TITLE_REQUIRED'; end if;
  v_prizes := (select coalesce(jsonb_agg(jsonb_build_object('name', left(trim(x->>'name'), 80), 'qty', least(greatest(coalesce((x->>'qty')::int, 1), 1), 100))), '[]'::jsonb)
                 from jsonb_array_elements(case when jsonb_typeof(p->'prizes') = 'array' then p->'prizes' else '[]'::jsonb end) x
                where char_length(trim(coalesce(x->>'name', ''))) > 0);
  if jsonb_array_length(v_prizes) not between 1 and 10 then raise exception 'INVALID_PRIZES'; end if;
  if (select sum((x->>'qty')::int) from jsonb_array_elements(v_prizes) x) > 200 then raise exception 'INVALID_PRIZES'; end if;
  if (select count(*) from public.lucky_draws x where x.scope = p_scope and x.ref_id is not distinct from p_ref and x.status = 'READY') >= 5 then
    raise exception 'TOO_MANY_DRAWS';
  end if;
  insert into public.lucky_draws (scope, ref_id, title, rule, prizes, exclude_winners, created_by)
  values (p_scope, case when p_scope = 'SYSTEM' then null else p_ref end, v_title,
          case when p->>'rule' in ('COMPLETED', 'ACTIVE', 'ALL') then p->>'rule' else 'COMPLETED' end, v_prizes,
          coalesce((p->>'exclude_winners')::boolean, true), v_uid)
  returning * into d;
  return private.draw_json(d, true);
end $$;

create or replace function public.cancel_lucky_draw(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d public.lucky_draws := (select x from public.lucky_draws x where x.id = p_id);
begin
  if d.id is null or not private.draw_can_manage(d.scope, d.ref_id) then raise exception 'FORBIDDEN'; end if;
  if d.status <> 'READY' then raise exception 'DRAW_CLOSED'; end if;
  update public.lucky_draws set status = 'CANCELLED' where id = p_id;
end $$;

-- Quay: chỉ một lần. Thứ tự = md5(seed || user_id); công bố seed + mã băm danh sách để đối chiếu
create or replace function public.run_lucky_draw(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := private.require_uid();
  d public.lucky_draws := (select x from public.lucky_draws x where x.id = p_id for update);
  v_seed text := encode(extensions.gen_random_bytes(16), 'hex');
  v_slots text[];
  v_pool uuid[];
  v_count integer;
  v_hash text;
  v_org uuid;
  v_title text;
  w record;
begin
  if d.id is null or not private.draw_can_manage(d.scope, d.ref_id) then raise exception 'FORBIDDEN'; end if;
  if d.status <> 'READY' then raise exception 'DRAW_CLOSED'; end if;
  -- mỗi suất quà thành một ô: [Giải nhất, Giải nhì, Giải nhì, …]
  v_slots := (select array_agg(x.name order by x.ord, g.n)
                from (select e->>'name' as name, (e->>'qty')::int as qty, row_number() over () as ord
                        from jsonb_array_elements(d.prizes) e) x
                cross join lateral generate_series(1, x.qty) g(n));
  v_pool := (select array_agg(distinct e.user_id) from private.draw_entrants(d.scope, d.ref_id, d.rule) e
              where e.user_id is not null
                and not (d.exclude_winners and exists (select 1 from public.lucky_draw_winners lw join public.lucky_draws x on x.id = lw.draw_id
                                                        where x.scope = d.scope and x.ref_id is not distinct from d.ref_id and lw.user_id = e.user_id)));
  v_count := coalesce(cardinality(v_pool), 0);
  if v_count = 0 then raise exception 'NO_ENTRANTS'; end if;
  v_hash := (select md5(string_agg(u::text, ',' order by u)) from unnest(v_pool) u);
  insert into public.lucky_draw_winners (draw_id, user_id, prize, position)
  select d.id, t.u, v_slots[t.rn], t.rn
    from (select u, row_number() over (order by md5(v_seed || u::text)) as rn from unnest(v_pool) u) t
   where t.rn <= cardinality(v_slots);
  update public.lucky_draws set status = 'DONE', seed = v_seed, entrant_count = v_count, entrants_hash = v_hash, run_by = v_uid, run_at = now()
   where id = d.id returning * into d;
  for w in select lw.user_id, lw.prize from public.lucky_draw_winners lw where lw.draw_id = d.id loop
    perform private.notify(w.user_id, case when d.scope = 'CLUB' then d.ref_id end, 'LUCKY_DRAW_WIN', 'Chúc mừng! Bạn trúng ' || w.prize,
      d.title, case d.scope when 'ORG_CAMPAIGN' then '/orgs/' || (select c.org_id from public.org_campaigns c where c.id = d.ref_id) || '/campaigns/' || d.ref_id
                             when 'CHALLENGE' then '/challenges/' || d.ref_id when 'CLUB' then '/clubs/' || d.ref_id || '/hall'
                             when 'RACE' then '/races/' || d.ref_id else '/notifications' end, v_uid, true);
  end loop;
  -- Đăng kết quả lên bảng tin
  v_title := 'Kết quả ' || d.title || ': ' || (select string_agg(private.display_name(lw.user_id) || ' (' || lw.prize || ')', ', ' order by lw.position)
                                                  from public.lucky_draw_winners lw where lw.draw_id = d.id);
  if d.scope = 'ORG_CAMPAIGN' then
    v_org := (select c.org_id from public.org_campaigns c where c.id = d.ref_id);
    insert into public.org_posts (org_id, author_id, kind, body, meta) values (v_org, v_uid, 'DRAW', left(v_title, 2000), jsonb_build_object('draw_id', d.id));
  elsif d.scope = 'CLUB' then
    insert into public.club_posts (club_id, author_id, kind, title, body, is_pinned)
    values (d.ref_id, v_uid, 'ANNOUNCEMENT', left('Quay thưởng: ' || d.title, 120), left(v_title, 2000), false);
  end if;
  return private.draw_json(d, true);
end $$;

-- ---------------------------------------------------------------------
-- 7. Quyền
-- ---------------------------------------------------------------------
revoke all on function private.org_subtree(uuid), private.org_unit_depth(uuid), private.org_my_units(uuid), private.org_can_manage(uuid),
  private.user_email(uuid), private.org_unit_path(uuid, text, boolean), private.org_day_stats(uuid, timestamptz, timestamptz, numeric, numeric, jsonb),
  private.org_clean_boost(jsonb, timestamptz, timestamptz), private.org_post_json(public.org_posts), private.draw_can_manage(text, uuid),
  private.draw_can_view(text, uuid), private.draw_entrants(text, uuid, text), private.draw_json(public.lucky_draws, boolean)
  from public, anon, authenticated;

revoke all on function public.save_org_unit(uuid, uuid, text, uuid), public.org_import_members(uuid, jsonb, jsonb), public.org_pending_invites_list(uuid),
  public.delete_org_pending_invite(uuid, text), public.lock_org_campaign(uuid), public.review_campaign_result(uuid, uuid, boolean, text),
  public.set_org_campaign_cert(uuid, jsonb), public.org_campaign_certificate(uuid), public.org_feed(uuid, timestamptz),
  public.create_org_post(uuid, text, text, boolean), public.delete_org_post(uuid), public.pin_org_post(uuid, boolean),
  public.toggle_org_post_like(uuid), public.org_post_comments(uuid), public.add_org_post_comment(uuid, text), public.delete_org_post_comment(uuid),
  public.lucky_draws_for(text, uuid), public.create_lucky_draw(text, uuid, jsonb), public.cancel_lucky_draw(uuid), public.run_lucky_draw(uuid)
  from public, anon;
grant execute on function public.save_org_unit(uuid, uuid, text, uuid), public.org_import_members(uuid, jsonb, jsonb), public.org_pending_invites_list(uuid),
  public.delete_org_pending_invite(uuid, text), public.lock_org_campaign(uuid), public.review_campaign_result(uuid, uuid, boolean, text),
  public.set_org_campaign_cert(uuid, jsonb), public.org_campaign_certificate(uuid), public.org_feed(uuid, timestamptz),
  public.create_org_post(uuid, text, text, boolean), public.delete_org_post(uuid), public.pin_org_post(uuid, boolean),
  public.toggle_org_post_like(uuid), public.org_post_comments(uuid), public.add_org_post_comment(uuid, text), public.delete_org_post_comment(uuid),
  public.lucky_draws_for(text, uuid), public.create_lucky_draw(text, uuid, jsonb), public.cancel_lucky_draw(uuid), public.run_lucky_draw(uuid)
  to authenticated;

notify pgrst, 'reload schema';
