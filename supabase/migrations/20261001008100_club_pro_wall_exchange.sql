-- 008100: (1) "Tường nhà" CLB Pro — ảnh bìa, khẩu hiệu, chủ đề màu; (2) Thư mời giao lưu offline giữa các CLB.
-- (1) CLB Pro còn hạn: ban quản trị đặt ảnh bìa (vị trí lấy nét dọc 0–100%), khẩu hiệu ≤ 80 ký tự, chủ đề nền. Hết Pro:
--     dữ liệu giữ nguyên nhưng giao diện quay về dạng thường (club_branding trả về active = false).
-- (2) Ban quản trị CLB A gửi thư mời tới CLB B (tiêu đề, giờ, địa điểm, cự ly, pace, số khách tối đa, lời mời). Ban quản trị
--     B nhận thông báo → Nhận lời / Từ chối (kèm lời nhắn). Nhận lời: tự tạo buổi chạy trong LỊCH của CẢ HAI CLB (RSVP, điểm
--     danh QR như buổi chạy thường), đăng bảng tin + báo thành viên hai bên. Huỷ sau khi nhận lời → huỷ cả hai buổi.
--     Chặn spam: mỗi cặp CLB chỉ 1 lời mời đang chờ; mỗi CLB tối đa 5 lời mời đang chờ.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT. Chạy lại nhiều lần vẫn an toàn.

-- ---------------------------------------------------------------------
-- 1. Tường nhà CLB Pro
-- ---------------------------------------------------------------------
alter table public.clubs add column if not exists cover_url text;
alter table public.clubs add column if not exists cover_position integer not null default 50;
alter table public.clubs add column if not exists tagline text;
alter table public.clubs add column if not exists theme text;
alter table public.clubs drop constraint if exists clubs_cover_url_check;
alter table public.clubs add constraint clubs_cover_url_check check (cover_url is null or cover_url ~ '^https://');
alter table public.clubs drop constraint if exists clubs_cover_position_check;
alter table public.clubs add constraint clubs_cover_position_check check (cover_position between 0 and 100);
alter table public.clubs drop constraint if exists clubs_tagline_check;
alter table public.clubs add constraint clubs_tagline_check check (tagline is null or char_length(tagline) <= 80);
alter table public.clubs drop constraint if exists clubs_theme_check;
alter table public.clubs add constraint clubs_theme_check check (theme is null or theme in ('AURORA', 'SUNSET', 'OCEAN', 'FOREST', 'GOLD', 'NIGHT'));
-- Cột mới của clubs mặc định không đọc được (003400) → mở rõ ràng
grant select (cover_url, cover_position, tagline, theme) on public.clubs to anon, authenticated;

create or replace function public.set_club_branding(p_club_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_cover text := nullif(trim(coalesce(p->>'cover_url', '')), '');
  v_tag text := nullif(trim(coalesce(p->>'tagline', '')), '');
  v_theme text := nullif(upper(trim(coalesce(p->>'theme', ''))), '');
begin
  if not public.club_is_staff(p_club_id) then raise exception 'FORBIDDEN'; end if;
  if not private.club_is_pro(p_club_id) and (v_cover is not null or v_tag is not null or v_theme is not null) then raise exception 'PRO_REQUIRED'; end if;
  if v_cover is not null and v_cover !~ '^https://' then raise exception 'INVALID_URL'; end if;
  if v_tag is not null and char_length(v_tag) > 80 then raise exception 'TAGLINE_TOO_LONG'; end if;
  if v_theme is not null and v_theme not in ('AURORA', 'SUNSET', 'OCEAN', 'FOREST', 'GOLD', 'NIGHT') then raise exception 'INVALID_THEME'; end if;
  update public.clubs set cover_url = v_cover, tagline = v_tag, theme = v_theme,
         cover_position = least(greatest(coalesce((p->>'cover_position')::int, 50), 0), 100)
   where id = p_club_id;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'CLUB_BRANDING', p_club_id::text, jsonb_build_object('cover', v_cover is not null, 'tagline', v_tag, 'theme', v_theme));
  return jsonb_build_object('cover_url', v_cover, 'tagline', v_tag, 'theme', v_theme);
end $$;

-- Trang công khai (008000) thêm ảnh bìa / khẩu hiệu / chủ đề
create or replace function public.club_public_page(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', c.id, 'slug', c.slug, 'name', c.name, 'description', c.description, 'avatar_url', c.avatar_url,
    'accent_color', c.accent_color, 'member_count', c.member_count, 'join_policy', c.join_policy, 'founded_at', c.created_at,
    'cover_url', c.cover_url, 'cover_position', c.cover_position, 'tagline', c.tagline, 'theme', c.theme,
    'events_held', (select count(*) from public.club_events e where e.club_id = c.id and e.starts_at < now()),
    'events_upcoming', (select count(*) from public.club_events e where e.club_id = c.id and e.starts_at >= now()),
    'challenges_held', (select count(*) from public.challenges ch where ch.target_club_id = c.id and ch.status <> 'CANCELLED'))
    from public.clubs c
   where c.slug = lower(trim(coalesce(p_slug, ''))) and c.plan = 'PRO' and (c.pro_until is null or c.pro_until > now())
$$;

-- ---------------------------------------------------------------------
-- 2. Thư mời giao lưu giữa các CLB
-- ---------------------------------------------------------------------
alter table public.club_events add column if not exists exchange_id uuid;

create table if not exists public.club_exchange_invites (
  id uuid primary key default gen_random_uuid(),
  from_club uuid not null references public.clubs(id) on delete cascade,
  to_club uuid not null references public.clubs(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  title text not null check (char_length(title) between 3 and 80),
  message text check (message is null or char_length(message) <= 1000),
  starts_at timestamptz not null,
  duration_min integer not null default 90 check (duration_min between 15 and 720),
  location_name text not null check (char_length(location_name) between 2 and 120),
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  distance_km numeric(5, 1) check (distance_km is null or (distance_km > 0 and distance_km <= 200)),
  pace_text text check (pace_text is null or char_length(pace_text) <= 40),
  guest_capacity integer check (guest_capacity is null or guest_capacity between 2 and 1000),
  status text not null default 'PENDING' check (status in ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED')),
  response_note text check (response_note is null or char_length(response_note) <= 300),
  responded_by uuid references public.profiles(id) on delete set null,
  responded_at timestamptz,
  host_event_id uuid references public.club_events(id) on delete set null,
  guest_event_id uuid references public.club_events(id) on delete set null,
  created_at timestamptz not null default now(),
  check (from_club <> to_club),
  check ((lat is null) = (lng is null))
);
create index if not exists club_exchange_from_idx on public.club_exchange_invites (from_club, created_at desc);
create index if not exists club_exchange_to_idx on public.club_exchange_invites (to_club, created_at desc);
alter table public.club_exchange_invites enable row level security;
revoke all on public.club_exchange_invites from anon, authenticated;

create or replace function private.exchange_json(x public.club_exchange_invites) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(x) || jsonb_build_object(
    'from', (select jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url, 'accent_color', c.accent_color,
                                       'member_count', c.member_count) from public.clubs c where c.id = x.from_club),
    'to', (select jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url, 'accent_color', c.accent_color,
                                     'member_count', c.member_count) from public.clubs c where c.id = x.to_club),
    'sender_name', private.display_name(x.created_by), 'responder_name', private.display_name(x.responded_by))
$$;

create or replace function public.send_club_exchange(p_from_club uuid, p_to_club uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_start timestamptz := nullif(p->>'starts_at', '')::timestamptz;
  v_from text := (select c.name from public.clubs c where c.id = p_from_club);
  x public.club_exchange_invites;
begin
  if not public.club_is_staff(p_from_club) then raise exception 'FORBIDDEN'; end if;
  if p_to_club is null or p_to_club = p_from_club or not exists (select 1 from public.clubs c where c.id = p_to_club) then raise exception 'CLUB_NOT_FOUND'; end if;
  if v_start is null or v_start < now() + interval '2 hours' or v_start > now() + interval '180 days' then raise exception 'INVALID_TIME_RANGE'; end if;
  if exists (select 1 from public.club_exchange_invites e where e.from_club = p_from_club and e.to_club = p_to_club and e.status = 'PENDING') then
    raise exception 'EXCHANGE_PENDING';
  end if;
  if (select count(*) from public.club_exchange_invites e where e.from_club = p_from_club and e.status = 'PENDING') >= 5 then
    raise exception 'EXCHANGE_LIMIT';
  end if;
  insert into public.club_exchange_invites (from_club, to_club, created_by, title, message, starts_at, duration_min, location_name,
                                            lat, lng, distance_km, pace_text, guest_capacity)
  values (p_from_club, p_to_club, v_uid, trim(coalesce(p->>'title', '')), nullif(trim(coalesce(p->>'message', '')), ''), v_start,
          coalesce(nullif(p->>'duration_min', '')::int, 90), trim(coalesce(p->>'location_name', '')),
          nullif(p->>'lat', '')::double precision, nullif(p->>'lng', '')::double precision,
          nullif(p->>'distance_km', '')::numeric, nullif(trim(coalesce(p->>'pace_text', '')), ''), nullif(p->>'guest_capacity', '')::int)
  returning * into x;
  perform private.notify_club(p_to_club, true, 'CLUB_EXCHANGE', v_from || ' mời CLB giao lưu: ' || x.title,
    to_char(x.starts_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM') || ' · ' || x.location_name || '. Mở thư mời để nhận lời.',
    '/clubs/' || p_to_club || '/exchange', v_uid);
  return private.exchange_json(x);
end $$;

create or replace function public.respond_club_exchange(p_invite_id uuid, p_accept boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  x public.club_exchange_invites := (select i from public.club_exchange_invites i where i.id = p_invite_id for update);
  v_from text;
  v_to text;
  v_host uuid;
  v_guest uuid;
  v_desc text;
begin
  if x.id is null then raise exception 'EXCHANGE_NOT_FOUND'; end if;
  if not public.club_is_staff(x.to_club) then raise exception 'FORBIDDEN'; end if;
  if x.status <> 'PENDING' then raise exception 'EXCHANGE_CLOSED'; end if;
  if p_accept and x.starts_at <= now() then raise exception 'EXCHANGE_EXPIRED'; end if;
  v_from := (select c.name from public.clubs c where c.id = x.from_club);
  v_to := (select c.name from public.clubs c where c.id = x.to_club);
  if not p_accept then
    update public.club_exchange_invites set status = 'DECLINED', responded_by = v_uid, responded_at = now(),
           response_note = nullif(left(trim(coalesce(p_note, '')), 300), '') where id = x.id returning * into x;
    perform private.notify_club(x.from_club, true, 'CLUB_EXCHANGE', v_to || ' chưa nhận lời giao lưu',
      coalesce(x.response_note, x.title), '/clubs/' || x.from_club || '/exchange', v_uid);
    return private.exchange_json(x);
  end if;

  v_desc := coalesce(x.message || E'\n\n', '') || 'Buổi giao lưu ' || v_from || ' × ' || v_to || '.';
  insert into public.club_events (club_id, created_by, title, description, starts_at, duration_min, location_name, lat, lng,
                                  distance_km, pace_text, capacity, exchange_id)
  values (x.from_club, x.created_by, left('Giao lưu × ' || v_to, 80), left(v_desc, 1000), x.starts_at, x.duration_min, x.location_name,
          x.lat, x.lng, x.distance_km, x.pace_text, null, x.id)
  returning id into v_host;
  insert into public.club_events (club_id, created_by, title, description, starts_at, duration_min, location_name, lat, lng,
                                  distance_km, pace_text, capacity, exchange_id)
  values (x.to_club, v_uid, left('Giao lưu × ' || v_from, 80), left(v_desc, 1000), x.starts_at, x.duration_min, x.location_name,
          x.lat, x.lng, x.distance_km, x.pace_text, x.guest_capacity, x.id)
  returning id into v_guest;
  insert into private.club_event_secrets (event_id, secret) values (v_host, encode(extensions.gen_random_bytes(24), 'hex')), (v_guest, encode(extensions.gen_random_bytes(24), 'hex'))
  on conflict (event_id) do nothing;
  update public.club_exchange_invites set status = 'ACCEPTED', responded_by = v_uid, responded_at = now(),
         response_note = nullif(left(trim(coalesce(p_note, '')), 300), ''), host_event_id = v_host, guest_event_id = v_guest
   where id = x.id returning * into x;

  insert into public.club_posts (club_id, author_id, kind, title, body, is_pinned)
  values (x.from_club, x.created_by, 'ANNOUNCEMENT', 'Giao lưu với ' || v_to || ' — ' || x.title,
          to_char(x.starts_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI "ngày" DD/MM') || ' tại ' || x.location_name || '. Đăng ký ở tab Lịch.', false),
         (x.to_club, v_uid, 'ANNOUNCEMENT', 'Giao lưu với ' || v_from || ' — ' || x.title,
          to_char(x.starts_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI "ngày" DD/MM') || ' tại ' || x.location_name || '. Đăng ký ở tab Lịch.', false);
  perform private.notify_club(x.from_club, false, 'CLUB_EXCHANGE', v_to || ' đã nhận lời giao lưu!', x.title || ' · ' || x.location_name,
    '/clubs/' || x.from_club || '/events/' || v_host, v_uid);
  perform private.notify_club(x.to_club, false, 'CLUB_EXCHANGE', 'Giao lưu với ' || v_from || ': ' || x.title, x.location_name || ' — đăng ký tham gia ở tab Lịch',
    '/clubs/' || x.to_club || '/events/' || v_guest, v_uid);
  return private.exchange_json(x);
end $$;

create or replace function public.cancel_club_exchange(p_invite_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  x public.club_exchange_invites := (select i from public.club_exchange_invites i where i.id = p_invite_id for update);
  v_reason text := trim(coalesce(p_reason, ''));
begin
  if x.id is null then raise exception 'EXCHANGE_NOT_FOUND'; end if;
  if not (public.club_is_staff(x.from_club) or (x.status = 'ACCEPTED' and public.club_is_staff(x.to_club))) then raise exception 'FORBIDDEN'; end if;
  if x.status not in ('PENDING', 'ACCEPTED') then raise exception 'EXCHANGE_CLOSED'; end if;
  if char_length(v_reason) < 3 then raise exception 'REASON_REQUIRED'; end if;
  update public.club_events set status = 'CANCELLED', cancel_reason = left('Huỷ giao lưu: ' || v_reason, 300)
   where id in (x.host_event_id, x.guest_event_id) and status <> 'CANCELLED';
  update public.club_exchange_invites set status = 'CANCELLED', response_note = left(v_reason, 300) where id = x.id returning * into x;
  perform private.notify_club(case when public.club_is_staff(x.from_club) then x.to_club else x.from_club end, true, 'CLUB_EXCHANGE',
    'Đã huỷ giao lưu: ' || x.title, v_reason, '/clubs/' || case when public.club_is_staff(x.from_club) then x.to_club else x.from_club end || '/exchange', v_uid);
  return private.exchange_json(x);
end $$;

-- Thư mời của một CLB: gửi đi + nhận được (ban quản trị); thành viên chỉ thấy các buổi đã nhận lời
create or replace function public.club_exchanges(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_staff boolean := public.club_is_staff(p_club_id);
begin
  if not public.club_is_member(p_club_id) then raise exception 'NOT_A_MEMBER'; end if;
  return jsonb_build_object('is_staff', v_staff,
    'incoming', coalesce((select jsonb_agg(private.exchange_json(x) order by x.created_at desc) from public.club_exchange_invites x
                           where x.to_club = p_club_id and (v_staff or x.status = 'ACCEPTED')), '[]'::jsonb),
    'outgoing', coalesce((select jsonb_agg(private.exchange_json(x) order by x.created_at desc) from public.club_exchange_invites x
                           where x.from_club = p_club_id and (v_staff or x.status = 'ACCEPTED')), '[]'::jsonb));
end $$;

revoke all on function private.exchange_json(public.club_exchange_invites) from public, anon, authenticated;
revoke all on function public.set_club_branding(uuid, jsonb), public.send_club_exchange(uuid, uuid, jsonb), public.respond_club_exchange(uuid, boolean, text),
  public.cancel_club_exchange(uuid, text), public.club_exchanges(uuid) from public, anon;
grant execute on function public.set_club_branding(uuid, jsonb), public.send_club_exchange(uuid, uuid, jsonb), public.respond_club_exchange(uuid, boolean, text),
  public.cancel_club_exchange(uuid, text), public.club_exchanges(uuid) to authenticated;
revoke all on function public.club_public_page(text) from public;
grant execute on function public.club_public_page(text) to anon, authenticated;

notify pgrst, 'reload schema';
