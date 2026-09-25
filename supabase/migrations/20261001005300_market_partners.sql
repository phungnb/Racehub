-- 005300: Chợ Runner (Market giai đoạn 2) — hồ sơ HLV / Shop / Dịch vụ ĐÃ XÁC MINH. RaceHub KHÔNG giữ tiền.
-- • Runner đăng ký hồ sơ đối tác (HLV, cửa hàng, dịch vụ: massage, pacer, chụp ảnh…) → admin xác minh → hiện trên Chợ Runner.
-- • Hồ sơ: giới thiệu, chuyên môn, bảng dịch vụ + giá tham khảo, khu vực (tỉnh / thành, không lộ tọa độ), liên hệ trực tiếp
--   (điện thoại, Zalo, Facebook, website). Người dùng liên hệ và thanh toán TRỰC TIẾP với đối tác.
-- • HLV: hiện thành tích chạy thật trên RaceHub (cấp, tổng km 12 tháng, số bài) — uy tín từ dữ liệu, không tự khai.
-- • Chưa có đánh giá (chỉ mở khi có đặt lịch thật để chống đánh giá ảo).
-- Cần 003100 (tìm kiếm), 004100. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('COACH', 'SHOP', 'SERVICE')),
  name text not null check (char_length(name) between 2 and 80),
  tagline text check (tagline is null or char_length(tagline) <= 120),
  bio text check (bio is null or char_length(bio) <= 2000),
  avatar_url text,
  cover_url text,
  area text check (area is null or char_length(area) <= 40),
  address text check (address is null or char_length(address) <= 160),
  specialties text[] not null default '{}',
  services jsonb not null default '[]'::jsonb,
  contacts jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'HIDDEN')),
  review_note text check (review_note is null or char_length(review_note) <= 300),
  verified_at timestamptz,
  verified_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, kind)
);
create index if not exists partners_list_idx on public.partners (status, kind, area);
alter table public.partners enable row level security;

-- Kho ảnh: market-media/<user_id>/<file>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('market-media', 'market-media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
drop policy if exists market_media_insert on storage.objects;
create policy market_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'market-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists market_media_delete on storage.objects;
create policy market_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'market-media' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function private.market_media_ok(p_owner uuid, p_url text) returns boolean
language sql immutable as $$
  select p_url is null or p_url ~ ('/storage/v1/object/public/market-media/' || p_owner::text || '/[A-Za-z0-9._-]{1,120}$')
$$;

-- Liên hệ: chỉ giữ trường hợp lệ
create or replace function private.market_contacts(c jsonb) returns jsonb
language plpgsql immutable as $$
declare v_out jsonb := '{}'::jsonb; k text; v text;
begin
  if c is null or jsonb_typeof(c) <> 'object' then return v_out; end if;
  foreach k in array array['phone', 'zalo', 'facebook', 'website', 'email'] loop
    v := nullif(trim(coalesce(c->>k, '')), '');
    if v is null then continue; end if;
    if k in ('phone', 'zalo') and v ~ '^\+?[0-9 .]{8,16}$' then v_out := v_out || jsonb_build_object(k, regexp_replace(v, '[ .]', '', 'g'));
    elsif k in ('facebook', 'website', 'zalo') and v ~ '^https://[^\s]{4,}$' and char_length(v) <= 300 then v_out := v_out || jsonb_build_object(k, v);
    elsif k = 'email' and v ~* '^[^@\s]{1,64}@[^@\s]{3,100}$' then v_out := v_out || jsonb_build_object(k, lower(v));
    else raise exception 'INVALID_CONTACT';
    end if;
  end loop;
  return v_out;
end $$;

create or replace function private.market_services(s jsonb) returns jsonb
language plpgsql immutable as $$
begin
  if s is null or jsonb_typeof(s) <> 'array' then return '[]'::jsonb; end if;
  if jsonb_array_length(s) > 12 then raise exception 'TOO_MANY_SERVICES'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'name', left(trim(e->>'name'), 80), 'price', nullif(left(trim(coalesce(e->>'price', '')), 40), ''),
      'unit', nullif(left(trim(coalesce(e->>'unit', '')), 30), ''), 'description', nullif(left(trim(coalesce(e->>'description', '')), 300), ''))
      order by o), '[]'::jsonb)
    from jsonb_array_elements(s) with ordinality as t(e, o)
   where char_length(trim(coalesce(e->>'name', ''))) >= 2);
end $$;

-- Uy tín HLV từ dữ liệu chạy thật
create or replace function private.partner_runner_stats(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'level', (select p.level from public.profiles p where p.id = p_user),
    'km_12m', (select round(coalesce(sum(coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0)), 0) / 1000.0) from public.activities a
                where a.user_id = p_user and a.validation_status = 'APPROVED' and a.started_at >= now() - interval '365 days'),
    'runs_12m', (select count(*) from public.activities a where a.user_id = p_user and a.validation_status = 'APPROVED' and a.started_at >= now() - interval '365 days'),
    'member_since', (select p.created_at from public.profiles p where p.id = p_user))
$$;

create or replace function private.partner_json(p public.partners, p_full boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'kind', p.kind, 'name', p.name, 'tagline', p.tagline, 'avatar_url', p.avatar_url, 'cover_url', p.cover_url,
    'area', p.area, 'specialties', to_jsonb(p.specialties), 'verified', p.status = 'APPROVED' and p.verified_at is not null,
    'status', p.status, 'is_mine', p.owner_id = auth.uid(),
    'services_count', jsonb_array_length(p.services),
    'owner', jsonb_build_object('id', p.owner_id, 'display_name', private.display_name(p.owner_id),
                                'avatar_url', (select x.avatar_url from public.profiles x where x.id = p.owner_id)))
    || case when p_full then jsonb_build_object('bio', p.bio, 'address', p.address, 'services', p.services, 'contacts', p.contacts,
         'review_note', case when p.owner_id = auth.uid() or public.is_system_admin() then p.review_note end,
         'stats', case when p.kind = 'COACH' then private.partner_runner_stats(p.owner_id) end,
         'updated_at', p.updated_at) else '{}'::jsonb end
$$;

-- ---------------------------------------------------------------------
-- RPC
-- ---------------------------------------------------------------------
create or replace function public.list_partners(p_kind text default null, p_area text default null, p_query text default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(private.partner_json(x.p, false) order by x.rn), '[]'::jsonb)
    from (select p, row_number() over (order by p.verified_at desc nulls last, p.name) as rn
            from public.partners p
           where p.status = 'APPROVED'
             and (p_kind is null or p.kind = upper(p_kind))
             and (p_area is null or p.area = p_area)
             and (private.search_key(p_query) = '' or private.search_match(private.search_hay(p.name || ' ' || coalesce(p.tagline, '') || ' '
                                                        || array_to_string(p.specialties, ' ')), p_query))) x
   where x.rn <= 60
$$;

create or replace function public.get_partner(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p public.partners := (select x from public.partners x where x.id = p_id);
begin
  if p.id is null or (p.status <> 'APPROVED' and p.owner_id is distinct from auth.uid() and not public.is_system_admin()) then
    raise exception 'PARTNER_NOT_FOUND';
  end if;
  return private.partner_json(p, true);
end $$;

create or replace function public.my_partners() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(private.partner_json(p, true) order by p.created_at), '[]'::jsonb) from public.partners p where p.owner_id = auth.uid()
$$;

create or replace function public.save_partner(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_old public.partners := (select x from public.partners x where x.id = v_id);
  v_kind text := upper(coalesce(p->>'kind', v_old.kind));
  r public.partners;
begin
  if v_old.id is not null and v_old.owner_id <> v_uid then raise exception 'FORBIDDEN'; end if;
  if v_kind not in ('COACH', 'SHOP', 'SERVICE') then raise exception 'INVALID_PARTNER'; end if;
  if char_length(trim(coalesce(p->>'name', ''))) < 2 then raise exception 'INVALID_PARTNER'; end if;
  if not private.market_media_ok(v_uid, nullif(p->>'avatar_url', '')) or not private.market_media_ok(v_uid, nullif(p->>'cover_url', '')) then
    raise exception 'INVALID_PARTNER_IMAGE';
  end if;
  if v_old.id is null and exists (select 1 from public.partners x where x.owner_id = v_uid and x.kind = v_kind) then raise exception 'PARTNER_EXISTS'; end if;
  insert into public.partners as t (id, owner_id, kind, name, tagline, bio, avatar_url, cover_url, area, address, specialties, services, contacts, status)
  values (coalesce(v_id, gen_random_uuid()), v_uid, v_kind, left(trim(p->>'name'), 80), nullif(left(trim(coalesce(p->>'tagline', '')), 120), ''),
    nullif(left(trim(coalesce(p->>'bio', '')), 2000), ''), nullif(p->>'avatar_url', ''), nullif(p->>'cover_url', ''),
    nullif(left(trim(coalesce(p->>'area', '')), 40), ''), nullif(left(trim(coalesce(p->>'address', '')), 160), ''),
    array(select left(trim(x), 30) from jsonb_array_elements_text(coalesce(p->'specialties', '[]'::jsonb)) with ordinality s(x, o)
           where trim(x) <> '' and o <= 12),
    private.market_services(p->'services'), private.market_contacts(p->'contacts'), 'PENDING')
  on conflict (id) do update set name = excluded.name, tagline = excluded.tagline, bio = excluded.bio, avatar_url = excluded.avatar_url,
    cover_url = excluded.cover_url, area = excluded.area, address = excluded.address, specialties = excluded.specialties,
    services = excluded.services, contacts = excluded.contacts, updated_at = now(),
    -- bị từ chối rồi sửa → gửi duyệt lại; đang hiện thì giữ nguyên (admin có thể ẩn)
    status = case when t.status = 'REJECTED' then 'PENDING' else t.status end
  returning * into r;
  return private.partner_json(r, true);
end $$;

create or replace function public.admin_list_partners(p_status text default 'PENDING') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(private.partner_json(p, true) order by p.updated_at desc), '[]'::jsonb)
            from public.partners p where p_status = 'ALL' or p.status = upper(p_status));
end $$;

create or replace function public.admin_review_partner(p_id uuid, p_action text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  r public.partners;
  v_act text := upper(coalesce(p_action, ''));
begin
  if v_act not in ('APPROVE', 'REJECT', 'HIDE') then raise exception 'INVALID_ACTION'; end if;
  if v_act in ('REJECT', 'HIDE') and char_length(trim(coalesce(p_note, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  update public.partners set
    status = case v_act when 'APPROVE' then 'APPROVED' when 'REJECT' then 'REJECTED' else 'HIDDEN' end,
    verified_at = case when v_act = 'APPROVE' then now() else verified_at end,
    verified_by = case when v_act = 'APPROVE' then v_uid else verified_by end,
    review_note = nullif(left(trim(coalesce(p_note, '')), 300), '')
  where id = p_id returning * into r;
  if r.id is null then raise exception 'PARTNER_NOT_FOUND'; end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'PARTNER_' || v_act, 'partner:' || r.id, jsonb_build_object('note', p_note));
  perform private.notify(r.owner_id, null, 'MARKET',
    case v_act when 'APPROVE' then 'Hồ sơ "' || r.name || '" đã được xác minh ✓' when 'REJECT' then 'Hồ sơ "' || r.name || '" cần bổ sung'
               else 'Hồ sơ "' || r.name || '" đã bị ẩn' end,
    coalesce(p_note, 'Hồ sơ của bạn đã hiện trên Chợ Runner.'), '/market/' || r.id, v_uid, true);
  return private.partner_json(r, true);
end $$;

revoke all on function private.market_media_ok(uuid, text), private.market_contacts(jsonb), private.market_services(jsonb),
  private.partner_runner_stats(uuid), private.partner_json(public.partners, boolean) from public, anon, authenticated;
revoke all on function public.list_partners(text, text, text), public.get_partner(uuid), public.my_partners(), public.save_partner(jsonb),
  public.admin_list_partners(text), public.admin_review_partner(uuid, text, text) from public, anon;
grant execute on function public.list_partners(text, text, text), public.get_partner(uuid) to anon, authenticated;
grant execute on function public.my_partners(), public.save_partner(jsonb), public.admin_list_partners(text), public.admin_review_partner(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
