-- 010600: SỰ KIỆN CHẠY NHÓM — NHIỀU CỰ LY, BÁO THÀNH VIÊN KHI ĐỔI LỊCH
--   • Một buổi chạy có nhiều cự ly (VD 5 km pace 7:00, 10 km pace 6:00, 21 km pace 5:30): cột routes [{km, pace}], tối đa 6.
--     distance_km / pace_text giữ cự ly đầu tiên cho app bản cũ.
--   • Tạo sự kiện: cả CLB nhận thông báo (như trước). Sửa giờ / điểm hẹn / cự ly: cả CLB nhận thông báo "Đổi lịch".
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

alter table public.club_events add column if not exists routes jsonb not null default '[]'::jsonb;

-- Chuẩn hóa danh sách cự ly: [{km: 10, pace: "6:00–6:30"}] — bỏ dòng trống, km 0–200, pace ≤ 40 ký tự, tối đa 6
create or replace function private.event_routes(p jsonb) returns jsonb
language plpgsql immutable as $$
declare v jsonb;
begin
  begin
    v := (select coalesce(jsonb_agg(jsonb_build_object('km', round((x->>'km')::numeric, 1),
                                                       'pace', nullif(left(trim(coalesce(x->>'pace', '')), 40), '')) order by t.ord), '[]'::jsonb)
            from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) with ordinality as t(x, ord)
           where nullif(trim(coalesce(x->>'km', '')), '') is not null);
  exception when others then
    raise exception 'INVALID_EVENT';
  end;
  if jsonb_array_length(v) > 6 then raise exception 'INVALID_EVENT'; end if;
  if exists (select 1 from jsonb_array_elements(v) x where (x->>'km')::numeric <= 0 or (x->>'km')::numeric > 200) then
    raise exception 'INVALID_EVENT';
  end if;
  return v;
end $$;

-- Sự kiện CLB: kèm chế độ công khai + các cự ly
create or replace function private.event_json(e public.club_events, p_uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', e.id, 'club_id', e.club_id, 'title', e.title, 'description', e.description, 'starts_at', e.starts_at,
    'ends_at', e.starts_at + make_interval(mins => e.duration_min), 'duration_min', e.duration_min,
    'location_name', e.location_name, 'lat', e.lat, 'lng', e.lng, 'distance_km', e.distance_km, 'pace_text', e.pace_text,
    'routes', case when jsonb_array_length(coalesce(e.routes, '[]'::jsonb)) > 0 then e.routes
                   when e.distance_km is not null or e.pace_text is not null then jsonb_build_array(jsonb_build_object('km', e.distance_km, 'pace', e.pace_text))
                   else '[]'::jsonb end,
    'capacity', e.capacity, 'status', e.status, 'visibility', e.visibility, 'cancel_reason', e.cancel_reason,
    'created_by', e.created_by, 'creator_name', (select display_name from public.profiles where id = e.created_by),
    'going_count', (select count(*) from public.club_event_rsvps r where r.event_id = e.id and r.status = 'GOING'),
    'maybe_count', (select count(*) from public.club_event_rsvps r where r.event_id = e.id and r.status = 'MAYBE'),
    'checked_in_count', (select count(*) from public.club_event_rsvps r where r.event_id = e.id and r.checked_in_at is not null),
    'my_status', (select r.status from public.club_event_rsvps r where r.event_id = e.id and r.user_id = p_uid),
    'my_checked_in_at', (select r.checked_in_at from public.club_event_rsvps r where r.event_id = e.id and r.user_id = p_uid))
$$;

create or replace function public.create_club_event(p_club_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := private.require_staff(p_club_id);
  f public.club_events := private.event_fields(p);
  v_routes jsonb := private.event_routes(p->'routes');
  v_id uuid := gen_random_uuid();
  m record;
begin
  if f.starts_at < now() - interval '1 hour' then raise exception 'INVALID_TIME'; end if;
  if jsonb_array_length(v_routes) > 0 then
    f.distance_km := (v_routes->0->>'km')::numeric;
    f.pace_text := v_routes->0->>'pace';
  end if;
  insert into public.club_events (id, club_id, created_by, title, description, starts_at, duration_min, location_name, lat, lng,
                                  distance_km, pace_text, capacity, routes)
  values (v_id, p_club_id, v_uid, f.title, f.description, f.starts_at, f.duration_min, f.location_name, f.lat, f.lng,
          f.distance_km, f.pace_text, f.capacity, v_routes);
  insert into private.club_event_secrets (event_id, secret) values (v_id, encode(extensions.gen_random_bytes(24), 'hex'));
  -- người tạo mặc định tham gia
  insert into public.club_event_rsvps (event_id, user_id, status) values (v_id, v_uid, 'GOING');
  -- cả CLB nhận thông báo (thông báo quan trọng: vẫn tới cả người chỉ nhận tin quan trọng)
  for m in select user_id from public.club_members where club_id = p_club_id and status = 'APPROVED' and user_id <> v_uid loop
    perform private.notify(m.user_id, p_club_id, 'CLUB_EVENT', 'Sự kiện mới: ' || f.title,
      to_char(f.starts_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM') || coalesce(' · ' || f.location_name, ''),
      '/clubs/' || p_club_id || '/events/' || v_id, v_uid, true);
  end loop;
  return private.event_json((select e from public.club_events e where e.id = v_id), v_uid);
end $$;

create or replace function public.update_club_event(p_event_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e public.club_events := (select x from public.club_events x where x.id = p_event_id);
  v_uid uuid;
  f public.club_events := private.event_fields(p);
  v_routes jsonb := private.event_routes(p->'routes');
  v_changed boolean;
  m record;
begin
  if e.id is null then raise exception 'EVENT_NOT_FOUND'; end if;
  v_uid := private.require_staff(e.club_id);
  if e.status = 'CANCELLED' then raise exception 'EVENT_CANCELLED'; end if;
  if jsonb_array_length(v_routes) > 0 then
    f.distance_km := (v_routes->0->>'km')::numeric;
    f.pace_text := v_routes->0->>'pace';
  end if;
  v_changed := f.starts_at is distinct from e.starts_at or f.location_name is distinct from e.location_name
            or f.lat is distinct from e.lat or f.lng is distinct from e.lng or v_routes is distinct from coalesce(e.routes, '[]'::jsonb);
  update public.club_events set title = f.title, description = f.description, starts_at = f.starts_at,
         duration_min = f.duration_min, location_name = f.location_name, lat = f.lat, lng = f.lng,
         distance_km = f.distance_km, pace_text = f.pace_text, capacity = f.capacity, routes = v_routes,
         reminded_at = case when f.starts_at <> e.starts_at then null else reminded_at end
   where id = p_event_id;
  -- Đổi giờ / điểm hẹn / cự ly của buổi sắp diễn ra → báo cả CLB
  if v_changed and f.starts_at > now() then
    for m in select user_id from public.club_members where club_id = e.club_id and status = 'APPROVED' and user_id <> v_uid loop
      perform private.notify(m.user_id, e.club_id, 'CLUB_EVENT', 'Đổi lịch: ' || f.title,
        to_char(f.starts_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM') || coalesce(' · ' || f.location_name, ''),
        '/clubs/' || e.club_id || '/events/' || e.id, v_uid, true);
    end loop;
  end if;
  return private.event_json((select x from public.club_events x where x.id = p_event_id), v_uid);
end $$;

revoke all on function private.event_routes(jsonb) from public, anon, authenticated;
