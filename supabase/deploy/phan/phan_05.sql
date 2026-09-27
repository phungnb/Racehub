-- RaceHub — PHẦN 05/14 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 005300, 005400, 005500, 005600, 005700, 005800
-- Supabase → SQL Editor → New query → dán TOÀN BỘ phần này → Run. Lỗi thì không có gì thay đổi; chạy lại vẫn an toàn.
-- Xong thì chạy phần tiếp theo.
begin;
-- ===================================================================
-- 20261001005300_market_partners.sql
-- ===================================================================
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

-- ===================================================================
-- 20261001005400_challenge_rules_lists.sql
-- ===================================================================
-- 005400: Thử thách — thể lệ bổ sung + danh sách gọn.
-- • Thể lệ bổ sung (không bắt buộc) do người tạo điền: thưởng, phạt, lệ phí / đóng góp, điều kiện tham gia, liên hệ BTC,
--   và tối đa 5 mục tự đặt tên. Sửa được khi thử thách còn mở; nếu đã bắt đầu thì người tham gia được báo "BTC cập nhật thể lệ".
--   RaceHub không thu tiền hộ: lệ phí / phạt (nếu có) do BTC tự thu, app chỉ hiển thị.
-- • Danh sách thử thách: thử thách ĐÃ HỦY không còn nằm ở tab "Của tôi", "Khám phá", "CLB" (chỉ còn trong "Đã kết thúc").
--   Giải chạy ảo đã hủy cũng rời tab "Của tôi" (vẫn xem được ở "Đã qua").
-- Cần 000600, 002700. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

alter table public.challenges add column if not exists rules_info jsonb not null default '{}'::jsonb;
alter table public.challenges add column if not exists rules_updated_at timestamptz;

-- Chuẩn hóa thể lệ: chỉ giữ khóa hợp lệ, cắt độ dài, bỏ mục rỗng
create or replace function private.challenge_rules_clean(p jsonb) returns jsonb
language plpgsql immutable as $$
declare v_out jsonb := '{}'::jsonb; k text; v text; n int;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return v_out; end if;
  foreach k in array array['prizes', 'penalties', 'fees', 'conduct', 'contact'] loop
    v := nullif(trim(coalesce(p->>k, '')), '');
    n := case k when 'contact' then 200 when 'fees' then 600 else 1500 end;
    if v is not null then v_out := v_out || jsonb_build_object(k, left(v, n)); end if;
  end loop;
  if jsonb_typeof(p->'custom') = 'array' then
    if jsonb_array_length(p->'custom') > 5 then raise exception 'TOO_MANY_RULES'; end if;
    v_out := v_out || jsonb_build_object('custom', (
      select coalesce(jsonb_agg(jsonb_build_object('title', left(trim(e->>'title'), 60), 'body', left(trim(e->>'body'), 1500)) order by o), '[]'::jsonb)
        from jsonb_array_elements(p->'custom') with ordinality t(e, o)
       where char_length(trim(coalesce(e->>'title', ''))) >= 2 and char_length(trim(coalesce(e->>'body', ''))) >= 1));
    if v_out->'custom' = '[]'::jsonb then v_out := v_out - 'custom'; end if;
  end if;
  return v_out;
end $$;

create or replace function public.set_challenge_rules(p_challenge_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
  v_new jsonb := private.challenge_rules_clean(p);
  r record;
begin
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if c.created_by is distinct from v_uid and not (c.target_club_id is not null and public.club_is_staff(c.target_club_id))
     and not public.is_system_admin() then
    raise exception 'FORBIDDEN';
  end if;
  if c.status <> 'ACTIVE' or c.end_date <= now() then raise exception 'CHALLENGE_CLOSED'; end if;
  if v_new = c.rules_info then return v_new; end if;
  update public.challenges set rules_info = v_new, rules_updated_at = now() where id = c.id;
  -- Đã bắt đầu: báo người tham gia (trừ người sửa)
  if now() >= c.start_date then
    for r in select p2.profile_id from public.challenge_participants p2
              where p2.challenge_id = c.id and p2.status <> 'LEFT' and p2.profile_id <> v_uid loop
      perform private.notify(r.profile_id, c.target_club_id, 'CHALLENGE_RULES', 'BTC cập nhật thể lệ: ' || c.title,
        'Xem lại phần Luật chơi để nắm thể lệ mới.', '/challenges/' || c.id, v_uid, false);
    end loop;
  end if;
  return v_new;
end $$;

-- Danh sách thử thách: như 000600, bỏ thử thách đã hủy khỏi tab Của tôi / Khám phá / CLB; giới hạn 60 bằng row_number
create or replace function public.list_challenges(p_tab text default 'MINE', p_club_id uuid default null)
returns table (
  id uuid, title text, description text, format text, objective text, game_mode text, target_value numeric,
  start_date timestamptz, end_date timestamptz, status text, target_audience text, target_club_id uuid,
  club_name text, club_accent text, reward_xu numeric, participant_count integer, max_slots integer,
  my_status text, my_score numeric, my_rank integer, total_score numeric, created_by uuid
)
language sql stable security definer set search_path = public as $$
  with base as (
    select c.*,
           (select count(*)::int from public.challenge_participants p where p.challenge_id = c.id and p.status <> 'LEFT') as n,
           (select coalesce(sum(p.current_progress), 0) from public.challenge_participants p where p.challenge_id = c.id and p.status <> 'LEFT') as total,
           me.status as my_status, me.current_progress as my_score,
           case when me.id is not null then (select count(*)::int + 1 from public.challenge_participants o
                  where o.challenge_id = c.id and o.status <> 'LEFT' and o.current_progress > me.current_progress) end as my_rank
      from public.challenges c
      left join public.challenge_participants me on me.challenge_id = c.id and me.profile_id = auth.uid()
     where c.status in ('ACTIVE', 'FINISHED', 'CANCELLED')
       and case upper(coalesce(p_tab, 'MINE'))
         when 'MINE' then c.status <> 'CANCELLED'
                          and ((me.id is not null and me.status <> 'LEFT') or c.created_by = auth.uid())
                          and (c.status = 'ACTIVE' or c.end_date > now() - interval '30 days')
         when 'DISCOVER' then c.target_audience = 'PUBLIC' and c.status = 'ACTIVE' and c.end_date > now()
                          and (c.format <> 'TEAM' or c.start_date > now())
                          and (me.id is null or me.status = 'LEFT')
         when 'CLUB' then c.status <> 'CANCELLED'
                          and c.target_audience = 'CLUB_ONLY' and public.club_is_member(c.target_club_id)
                          and (p_club_id is null or c.target_club_id = p_club_id)
                          and (c.status = 'ACTIVE' or c.end_date > now() - interval '60 days')
         when 'ENDED' then me.id is not null and (c.status <> 'ACTIVE' or c.end_date <= now())
         else false end
  ), ranked as (
    select b.*, row_number() over (
             order by (b.status = 'ACTIVE' and b.end_date > now()) desc,
                      case when upper(coalesce(p_tab, 'MINE')) = 'DISCOVER' then -b.n else 0 end,
                      b.end_date) as rn
      from base b
  )
  select b.id, b.title, b.description, b.format, b.objective, b.game_mode, b.target_value, b.start_date, b.end_date,
         b.status, b.target_audience, b.target_club_id, cl.name, cl.accent_color, b.reward_xu, b.n, b.max_slots,
         b.my_status, b.my_score, b.my_rank, round(b.total, 2), b.created_by
    from ranked b left join public.clubs cl on cl.id = b.target_club_id
   where b.rn <= 60
   order by b.rn
$$;

-- Giải chạy ảo: như 002700, tab "Của tôi" bỏ giải đã hủy
create or replace function public.list_races(p_scope text default 'UPCOMING') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return (select coalesce(jsonb_agg(private.race_card(t.race) order by
            case when upper(p_scope) = 'PAST' then extract(epoch from (t.race).end_at) * -1 else extract(epoch from (t.race).start_at) end), '[]'::jsonb)
    from (select x as race, row_number() over (order by x.start_at desc) as rn from public.virtual_races x
           where private.race_visible(x)
             and case upper(coalesce(p_scope, 'UPCOMING'))
                   when 'MINE' then x.status <> 'CANCELLED'
                                and exists (select 1 from public.race_registrations g where g.race_id = x.id and g.user_id = auth.uid() and g.status <> 'WITHDRAWN')
                   when 'PAST' then x.end_at < now()
                   else x.end_at >= now() and x.status = 'PUBLISHED' end) t
   where t.rn <= 100);
end $$;

revoke all on function private.challenge_rules_clean(jsonb) from public, anon, authenticated;
revoke all on function public.set_challenge_rules(uuid, jsonb) from public, anon;
grant execute on function public.set_challenge_rules(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001005500_social_login_invites.sql
-- ===================================================================
-- 005500: Đăng nhập Google / Apple + lời mời chuyên nghiệp.
-- • Hồ sơ mới: lấy tên / ảnh từ Google, Apple (full_name, name, picture) hoặc tên nhập lúc đăng ký email (display_name).
--   Trước đây đăng ký email luôn ra tên = phần trước @ của email. Email ẩn của Apple (privaterelay) → "Runner".
-- • Mã giới thiệu ngắn, dễ đọc (8 ký tự, không có 0/O/1/I): link mời /join/<mã> thay cho /join/<uuid dài>.
--   Nhập mã ở màn đăng ký hoặc Tôi → Mời bạn bè (trong 14 ngày đầu). Link cũ /join/<uuid> vẫn dùng được.
-- • my_referral(): mã, số bạn đã mời / đã nhận thưởng / Xu đã nhận, luật thưởng hiện hành.
-- • Xem trước lời mời khi CHƯA đăng nhập: referral_preview (tên người mời), club_invite_preview (tên, logo, số thành viên CLB).
-- Cần 000300, 003400, 003700. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 1. Hồ sơ mới từ đăng ký email / Google / Apple
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_name text := coalesce(
    nullif(left(trim(m->>'display_name'), 60), ''), nullif(left(trim(m->>'full_name'), 60), ''), nullif(left(trim(m->>'name'), 60), ''),
    case when new.email is not null and new.email not ilike '%privaterelay.appleid.com' and new.email not ilike '%@phone.racehub.vn'
         then nullif(split_part(new.email, '@', 1), '') end,
    'Runner');
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, v_name, coalesce(nullif(m->>'avatar_url', ''), nullif(m->>'picture', '')))
  on conflict (id) do nothing;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2. Mã giới thiệu ngắn
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists referral_code text;
create unique index if not exists profiles_referral_code_key on public.profiles (referral_code);

-- 8 ký tự từ bảng 32 chữ dễ đọc, suy ra cố định từ id (2^40 tổ hợp) — chạy lại vẫn ra đúng mã cũ
create or replace function private.referral_code_for(p_id uuid, p_salt int default 0) returns text
language sql immutable as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', ((n >> (5 * i)) & 31)::int + 1, 1), '' order by i)
    from (select ('x' || substr(md5(p_id::text || case when p_salt > 0 then ':' || p_salt else '' end), 1, 10))::bit(40)::bigint as n) s,
         generate_series(0, 7) as i
$$;

create or replace function private.assign_referral_code() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_code text; v_salt int := 0;
begin
  if new.referral_code is not null then return new; end if;
  loop
    v_code := private.referral_code_for(new.id, v_salt);
    exit when not exists (select 1 from public.profiles p where p.referral_code = v_code and p.id <> new.id);
    v_salt := v_salt + 1;
  end loop;
  new.referral_code := v_code;
  return new;
end $$;
drop trigger if exists trg_assign_referral_code on public.profiles;
create trigger trg_assign_referral_code before insert or update of referral_code on public.profiles
  for each row execute function private.assign_referral_code();
-- Cấp mã cho tài khoản cũ (trigger tự tính mã khi đặt về null)
update public.profiles set referral_code = null where referral_code is null;

-- Tìm người mời theo mã ngắn hoặc uuid (link cũ)
create or replace function private.referrer_by_code(p_code text) returns uuid
language sql stable security definer set search_path = public as $$
  select p.id from public.profiles p
   where p.referral_code = upper(trim(coalesce(p_code, '')))
      or (trim(coalesce(p_code, '')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and p.id = trim(p_code)::uuid)
$$;

create or replace function public.apply_referral_code(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ref uuid := private.referrer_by_code(p_code);
begin
  perform private.require_uid();
  if v_ref is null then raise exception 'REFERRER_NOT_FOUND'; end if;
  return public.apply_referral(v_ref) || jsonb_build_object('referrer_name', private.display_name(v_ref));
end $$;

create or replace function public.referral_preview(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when r.id is null then null else jsonb_build_object(
    'display_name', r.display_name, 'avatar_url', r.avatar_url, 'code', r.referral_code,
    'referee_xu', coalesce((private.economy_config()->'referral'->>'refereeXu')::numeric, 0),
    'min_km', coalesce((private.economy_config()->'referral'->>'minKm')::numeric, 3)) end
    from (select p.id, p.display_name, p.avatar_url, p.referral_code from public.profiles p where p.id = private.referrer_by_code(p_code)) r
    right join (select 1) one on true
$$;

create or replace function public.my_referral() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  me public.profiles := (select p from public.profiles p where p.id = v_uid);
  cfg jsonb := private.economy_config()->'referral';
begin
  return jsonb_build_object(
    'code', me.referral_code,
    'invited', (select count(*) from public.profiles p where p.referred_by = v_uid),
    'rewarded', (select count(*) from public.ledger_transactions t join public.ledger_entries e on e.transaction_id = t.id
                  where t.type = 'REFERRAL_INVITER' and e.account_id = v_uid and e.amount > 0),
    'xu_earned', (select coalesce(sum(e.amount), 0) from public.ledger_transactions t join public.ledger_entries e on e.transaction_id = t.id
                  where t.type = 'REFERRAL_INVITER' and e.account_id = v_uid and e.amount > 0),
    'friends', (select coalesce(jsonb_agg(jsonb_build_object('display_name', x.display_name, 'avatar_url', x.avatar_url, 'joined_at', x.created_at,
                  'rewarded', exists (select 1 from public.ledger_transactions t where t.idempotency_key = 'referral_inviter:' || x.id)) order by x.created_at desc), '[]'::jsonb)
                  from (select p.id, p.display_name, p.avatar_url, p.created_at, row_number() over (order by p.created_at desc) as rn
                          from public.profiles p where p.referred_by = v_uid) x where x.rn <= 50),
    'referred_by', (select jsonb_build_object('display_name', r.display_name, 'avatar_url', r.avatar_url) from public.profiles r where r.id = me.referred_by),
    'can_enter_code', me.referred_by is null and me.created_at >= now() - interval '14 days',
    'enter_until', case when me.referred_by is null then me.created_at + interval '14 days' end,
    'rules', jsonb_build_object('inviter_xu', coalesce((cfg->>'inviterXu')::numeric, 0), 'referee_xu', coalesce((cfg->>'refereeXu')::numeric, 0),
                                'min_km', coalesce((cfg->>'minKm')::numeric, 3), 'monthly_cap', coalesce((cfg->>'monthlyCap')::int, 10)));
end $$;

-- ---------------------------------------------------------------------
-- 3. Xem trước lời mời CLB (chưa đăng nhập cũng xem được; không trả mã mời)
-- ---------------------------------------------------------------------
create or replace function public.club_invite_preview(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when c.id is null then null else jsonb_build_object(
    'id', c.id, 'name', c.name, 'description', left(c.description, 280), 'avatar_url', c.avatar_url, 'accent_color', c.accent_color,
    'member_count', c.member_count, 'join_policy', c.join_policy, 'plan', c.plan,
    'full', c.member_count >= coalesce(c.member_limit, 2147483647),
    'my_status', (select m.status from public.club_members m where m.club_id = c.id and m.user_id = auth.uid())) end
    from (select x.* from public.clubs x where x.invite_code = lower(trim(coalesce(p_code, '')))) c
    right join (select 1) one on true
$$;

revoke all on function private.referral_code_for(uuid, int), private.assign_referral_code(), private.referrer_by_code(text) from public, anon, authenticated;
revoke all on function public.apply_referral_code(text), public.my_referral(), public.referral_preview(text), public.club_invite_preview(text) from public, anon;
grant execute on function public.apply_referral_code(text), public.my_referral() to authenticated;
grant execute on function public.referral_preview(text), public.club_invite_preview(text) to anon, authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001005600_admin_console.sql
-- ===================================================================
-- 005600: Trang Quản trị toàn diện.
-- • admin_inbox: "Việc cần xử lý" — đơn chờ xác nhận, bài chờ duyệt, hồ sơ đối tác, thách đấu CLB chờ duyệt, lỗi hệ thống 24 giờ, người mới.
-- • Người dùng: admin_user_detail (hồ sơ, email, lần đăng nhập cuối, gói VIP, số dư, CLB, bài chạy, giao dịch gần đây, nhật ký),
--   admin_set_user_ban (khóa / mở tài khoản: chặn đăng nhập + đăng xuất mọi thiết bị), admin_set_user_role (cấp / gỡ quyền admin).
-- • Thử thách: admin_list_challenges (tìm, lọc trạng thái), admin_cancel_challenge (hủy bất kỳ lúc nào, hoàn tiền treo, báo người tham gia).
-- • Nhật ký quản trị: admin_audit_list (lọc theo hành động / người làm, xem trang trước).
-- Mọi thao tác ghi admin_audit_log (không sửa / xóa được). Cần 000600, 003800, 004100, 004400, 005300.
-- Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

alter table public.profiles add column if not exists banned_at timestamptz;
alter table public.profiles add column if not exists banned_reason text;

-- ---------------------------------------------------------------------
-- 1. Việc cần xử lý
-- ---------------------------------------------------------------------
create or replace function public.admin_inbox() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'orders', (select count(*) from public.orders o where o.status = 'PENDING' and (o.expires_at is null or o.expires_at > now())),
    'reviews', (select count(*) from public.activities a where a.validation_status = 'PENDING' and coalesce(a.status, '') <> 'DELETED'),
    'partners', (select count(*) from public.partners p where p.status = 'PENDING'),
    'cups', (select count(*) from public.club_cups c where c.status = 'PENDING_REVIEW'),
    'errors', (select count(distinct e.code) from private.client_errors e where e.last_at > now() - interval '24 hours'),
    'new_users_7d', (select count(*) from public.profiles p where p.created_at > now() - interval '7 days'),
    'active_7d', (select count(distinct a.user_id) from public.activities a where a.started_at > now() - interval '7 days'),
    'banned', (select count(*) from public.profiles p where p.banned_at is not null));
end $$;

-- ---------------------------------------------------------------------
-- 2. Người dùng
-- ---------------------------------------------------------------------
create or replace function public.admin_user_detail(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  pr public.profiles := (select x from public.profiles x where x.id = p_user);
  au jsonb := (select to_jsonb(u) from auth.users u where u.id = p_user);
begin
  perform private.require_admin();
  if pr.id is null then raise exception 'USER_NOT_FOUND'; end if;
  return jsonb_build_object(
    'id', pr.id, 'display_name', pr.display_name, 'avatar_url', pr.avatar_url, 'role', coalesce(pr.role, 'MEMBER'),
    'level', pr.level, 'xp', pr.xp, 'balance', private.balance(pr.id), 'created_at', pr.created_at,
    'email', au->>'email', 'last_sign_in_at', au->>'last_sign_in_at', 'banned_until', au->>'banned_until',
    'banned_at', pr.banned_at, 'banned_reason', pr.banned_reason,
    'strava_connected', coalesce((to_jsonb(pr)->>'strava_connected')::boolean, false),
    'referral_code', to_jsonb(pr)->>'referral_code',
    'referred_by', (select r.display_name from public.profiles r where r.id = (to_jsonb(pr)->>'referred_by')::uuid),
    'plan', private.active_plan(pr.id),
    'stats', jsonb_build_object(
      'runs', (select count(*) from public.activities a where a.user_id = pr.id and a.validation_status = 'APPROVED'),
      'km', (select round(coalesce(sum(coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0)), 0) / 1000.0, 1)
               from public.activities a where a.user_id = pr.id and a.validation_status = 'APPROVED'),
      'pending_runs', (select count(*) from public.activities a where a.user_id = pr.id and a.validation_status = 'PENDING'),
      'last_run_at', (select max(a.started_at) from public.activities a where a.user_id = pr.id),
      'challenges', (select count(*) from public.challenge_participants c where c.profile_id = pr.id and c.status <> 'LEFT'),
      'orders_paid_vnd', (select coalesce(sum(o.amount_vnd), 0) from public.orders o where o.buyer_id = pr.id and o.status = 'PAID')),
    'clubs', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'role', m.role, 'status', m.status) order by c.name), '[]'::jsonb)
                from public.club_members m join public.clubs c on c.id = m.club_id where m.user_id = pr.id and m.status in ('APPROVED', 'PENDING')),
    'ledger', (select coalesce(jsonb_agg(jsonb_build_object('type', x.type, 'description', x.description, 'amount', x.amount, 'at', x.created_at) order by x.created_at desc), '[]'::jsonb)
                 from (select t.type, t.reason as description, e.amount, t.created_at, row_number() over (order by t.created_at desc) as rn
                         from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id where e.account_id = pr.id) x where x.rn <= 15),
    'audit', (select coalesce(jsonb_agg(jsonb_build_object('action', x.action, 'actor', x.actor, 'reason', x.reason, 'at', x.created_at) order by x.created_at desc), '[]'::jsonb)
                from (select l.action, private.display_name(l.actor_id) as actor, coalesce(l.reason, l.new_value->>'reason', l.new_value->>'note') as reason, l.created_at,
                             row_number() over (order by l.created_at desc) as rn
                        from public.admin_audit_log l where l.target in ('user:' || pr.id, pr.id::text)) x where x.rn <= 15));
end $$;

create or replace function public.admin_set_user_ban(p_user uuid, p_ban boolean, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_admin uuid := private.require_admin();
  pr public.profiles := (select x from public.profiles x where x.id = p_user);
begin
  if pr.id is null then raise exception 'USER_NOT_FOUND'; end if;
  if p_user = v_admin then raise exception 'CANNOT_TARGET_SELF'; end if;
  if p_ban and (pr.role = 'SYSTEM_ADMIN' or coalesce((to_jsonb(pr)->>'is_admin')::boolean, false)) then raise exception 'CANNOT_BAN_ADMIN'; end if;
  if p_ban and char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if p_ban then
    update auth.users set banned_until = now() + interval '100 years' where id = p_user;
    delete from auth.sessions where user_id = p_user;                     -- đăng xuất mọi thiết bị
    update public.profiles set banned_at = now(), banned_reason = left(trim(p_reason), 300) where id = p_user;
  else
    update auth.users set banned_until = null where id = p_user;
    update public.profiles set banned_at = null, banned_reason = null where id = p_user;
  end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value, reason)
  values (v_admin, case when p_ban then 'USER_BAN' else 'USER_UNBAN' end, 'user:' || p_user, jsonb_build_object('reason', p_reason), p_reason);
  return jsonb_build_object('banned', p_ban);
end $$;

create or replace function public.admin_set_user_role(p_user uuid, p_role text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  v_role text := upper(coalesce(p_role, ''));
  v_old text := (select coalesce(p.role, 'MEMBER') from public.profiles p where p.id = p_user);
begin
  if v_old is null then raise exception 'USER_NOT_FOUND'; end if;
  if v_role not in ('SYSTEM_ADMIN', 'MEMBER') then raise exception 'INVALID_ROLE'; end if;
  if p_user = v_admin and v_role <> 'SYSTEM_ADMIN' then raise exception 'CANNOT_TARGET_SELF'; end if;
  if v_role = 'SYSTEM_ADMIN' and (select p.banned_at from public.profiles p where p.id = p_user) is not null then raise exception 'USER_BANNED'; end if;
  if v_old = v_role then return jsonb_build_object('role', v_role); end if;
  update public.profiles set role = v_role where id = p_user;
  insert into public.admin_audit_log (actor_id, action, target, old_value, new_value, reason)
  values (v_admin, 'USER_ROLE', 'user:' || p_user, jsonb_build_object('role', v_old), jsonb_build_object('role', v_role), p_reason);
  perform private.notify(p_user, null, 'SYSTEM',
    case when v_role = 'SYSTEM_ADMIN' then 'Bạn được cấp quyền quản trị RaceHub' else 'Quyền quản trị RaceHub của bạn đã được gỡ' end,
    coalesce(p_reason, ''), case when v_role = 'SYSTEM_ADMIN' then '/admin' else '/me' end, v_admin, true);
  return jsonb_build_object('role', v_role);
end $$;

-- ---------------------------------------------------------------------
-- 3. Thử thách
-- ---------------------------------------------------------------------
create or replace function public.admin_list_challenges(p_query text default '', p_status text default 'ALL') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := trim(coalesce(p_query, ''));
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'title', x.title, 'status', x.status, 'format', x.format, 'audience', x.target_audience,
      'start_date', x.start_date, 'end_date', x.end_date, 'reward_xu', x.reward_xu, 'participants', x.n,
      'creator', private.display_name(x.created_by), 'club', x.club_name, 'cancelled_reason', x.cancelled_reason) order by x.rn), '[]'::jsonb)
    from (select c.*, cl.name as club_name,
                 (select count(*) from public.challenge_participants p where p.challenge_id = c.id and p.status <> 'LEFT') as n,
                 row_number() over (order by (c.status = 'ACTIVE' and c.end_date > now()) desc, c.start_date desc) as rn
            from public.challenges c left join public.clubs cl on cl.id = c.target_club_id
           where (upper(coalesce(p_status, 'ALL')) = 'ALL'
                  or (upper(p_status) = 'LIVE' and c.status = 'ACTIVE' and c.start_date <= now() and c.end_date > now())
                  or (upper(p_status) = 'UPCOMING' and c.status = 'ACTIVE' and c.start_date > now())
                  or (upper(p_status) = 'ENDED' and (c.status = 'FINISHED' or (c.status = 'ACTIVE' and c.end_date <= now())))
                  or (upper(p_status) = 'CANCELLED' and c.status = 'CANCELLED'))
             and (q = '' or c.id::text = q or private.search_match(private.search_hay(c.title || ' ' || coalesce(cl.name, '') || ' ' || coalesce(private.display_name(c.created_by), '')), q))) x
   where x.rn <= 100);
end $$;

create or replace function public.admin_cancel_challenge(p_challenge_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
  r record;
begin
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if c.status <> 'ACTIVE' then raise exception 'CHALLENGE_CLOSED'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  update public.challenges set status = 'CANCELLED', cancelled_reason = left(trim(p_reason), 300), settled_at = now() where id = c.id;
  perform private.challenge_refund_escrow(c);
  for r in select p.profile_id from public.challenge_participants p where p.challenge_id = c.id
           union select c.created_by where c.created_by is not null loop
    perform private.notify(r.profile_id, c.target_club_id, 'CHALLENGE_CANCELLED', 'RaceHub đã hủy thử thách: ' || c.title,
      trim(p_reason), '/challenges/' || c.id, v_admin, true);
  end loop;
  insert into public.admin_audit_log (actor_id, action, target, new_value, reason)
  values (v_admin, 'CHALLENGE_CANCEL', 'challenge:' || c.id, jsonb_build_object('title', c.title), p_reason);
  return jsonb_build_object('cancelled', true);
end $$;

-- ---------------------------------------------------------------------
-- 4. Nhật ký quản trị
-- ---------------------------------------------------------------------
create or replace function public.admin_audit_list(p_action text default null, p_actor uuid default null, p_before bigint default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'action', x.action, 'target', x.target, 'actor_id', x.actor_id,
      'actor', private.display_name(x.actor_id), 'old_value', x.old_value, 'new_value', x.new_value, 'reason', x.reason, 'at', x.created_at) order by x.id desc), '[]'::jsonb)
    from (select l.*, row_number() over (order by l.id desc) as rn from public.admin_audit_log l
           where (p_action is null or l.action ilike p_action || '%')
             and (p_actor is null or l.actor_id = p_actor)
             and (p_before is null or l.id < p_before)) x
   where x.rn <= 100);
end $$;

revoke all on function public.admin_inbox(), public.admin_user_detail(uuid), public.admin_set_user_ban(uuid, boolean, text),
  public.admin_set_user_role(uuid, text, text), public.admin_list_challenges(text, text), public.admin_cancel_challenge(uuid, text),
  public.admin_audit_list(text, uuid, bigint) from public, anon;
grant execute on function public.admin_inbox(), public.admin_user_detail(uuid), public.admin_set_user_ban(uuid, boolean, text),
  public.admin_set_user_role(uuid, text, text), public.admin_list_challenges(text, text), public.admin_cancel_challenge(uuid, text),
  public.admin_audit_list(text, uuid, bigint) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001005700_club_roles_cleanup.sql
-- ===================================================================
-- 005700: Sửa dứt điểm lỗi trao quyền Chủ nhiệm (mã UNK-…).
-- Nguyên nhân: bảng club_members trên production còn ràng buộc CŨ club_members_role_check (chỉ cho OWNER / ADMIN / MEMBER)
-- song song ràng buộc mới club_members_role_chk (OWNER / CAPTAIN / MEMBER). Migration 000500 có xóa ràng buộc cũ,
-- nhưng nếu file 500 từng dừng giữa chừng trên SQL Editor thì nó vẫn còn → đổi chủ nhiệm cũ thành CAPTAIN bị chặn.
-- Việc làm: đổi vai trò cũ ADMIN / VICE → CAPTAIN, xóa các ràng buộc cũ, giữ lại ràng buộc mới.
-- Chạy riêng được, chạy lại nhiều lần vẫn an toàn. Sau đó chạy lại 003500 (Kiểm tra hệ thống).

alter table public.club_members drop constraint if exists club_members_role_check;
alter table public.club_members drop constraint if exists club_members_status_check;
update public.club_members set role = 'CAPTAIN' where role in ('ADMIN', 'VICE');
alter table public.club_members drop constraint if exists club_members_role_chk;
alter table public.club_members add constraint club_members_role_chk check (role in ('OWNER', 'CAPTAIN', 'MEMBER'));

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001005800_outfit_studio.sql
-- ===================================================================
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

commit;
