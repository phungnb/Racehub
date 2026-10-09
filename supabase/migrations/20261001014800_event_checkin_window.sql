-- Điểm danh sự kiện CLB: chỉ mở trong khung giờ của sự kiện + điểm danh bằng GPS.
-- Trước đây: ban quản trị tích điểm danh tay được bất cứ lúc nào (kể cả sự kiện chưa diễn ra), QR/"mở điểm danh" từ 2 giờ trước đến 2 giờ sau khi kết thúc,
-- và thành viên không có cách tự điểm danh bằng vị trí (chỉ có tự động sau khi chạy xong).
-- Quy tắc mới:
--   * Khung điểm danh: từ 30 phút trước giờ hẹn đến khi sự kiện kết thúc (starts_at + duration_min). Sự kiện đã hủy thì không mở.
--   * Thành viên tự điểm danh bằng GPS: trong khung trên, cách điểm hẹn ≤ 300 m, sai số GPS ≤ 100 m; sự kiện phải có tọa độ.
--   * QR: cùng khung giờ.
--   * Ban quản trị điểm danh tay: chỉ khi sự kiện đã bắt đầu (không giới hạn lúc kết thúc để còn bổ sung sau buổi chạy). Bỏ điểm danh thì luôn được.
alter table public.club_event_rsvps drop constraint if exists club_event_rsvps_checkin_method_check;
alter table public.club_event_rsvps add constraint club_event_rsvps_checkin_method_check
  check (checkin_method is null or checkin_method in ('QR', 'AUTO', 'STAFF', 'GPS'));

create or replace function private.event_checkin_open(e public.club_events) returns boolean
language sql stable set search_path = public as $$
  select e.status = 'SCHEDULED'
     and now() between e.starts_at - interval '30 minutes' and e.starts_at + make_interval(mins => e.duration_min)
$$;

-- Chi tiết sự kiện: checkin_open theo khung giờ mới (còn lại giữ nguyên bản 006100)
create or replace function public.club_event(p_event_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e public.club_events := (select x from public.club_events x where x.id = p_event_id);
  v_uid uuid := private.require_uid();
  v_member boolean;
begin
  if e.id is null then raise exception 'EVENT_NOT_FOUND'; end if;
  v_member := exists (select 1 from public.club_members m where m.club_id = e.club_id and m.user_id = v_uid and m.status = 'APPROVED');
  if not v_member and e.visibility <> 'PUBLIC' and not public.is_system_admin() then
    perform private.require_member(e.club_id);
  end if;
  return private.event_json(e, v_uid) || jsonb_build_object(
    'is_member', v_member,
    'club_name', (select c.name from public.clubs c where c.id = e.club_id),
    'club_avatar', (select c.avatar_url from public.clubs c where c.id = e.club_id),
    'can_manage', public.club_is_staff(e.club_id),
    'checkin_open', private.event_checkin_open(e),
    'staff_can_mark', e.status = 'SCHEDULED' and now() >= e.starts_at,
    'attendees', case when v_member or public.is_system_admin() then (select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', r.user_id, 'display_name', p.display_name, 'avatar_url', p.avatar_url, 'status', r.status,
        'checked_in_at', r.checked_in_at, 'checkin_method', r.checkin_method)
        order by (r.checked_in_at is null), r.status, p.display_name), '[]'::jsonb)
      from public.club_event_rsvps r join public.profiles p on p.id = r.user_id
     where r.event_id = e.id and r.status <> 'NOT_GOING') else '[]'::jsonb end);
end $$;

-- QR: lấy mã và quét mã đều theo khung giờ mới
create or replace function public.event_checkin_token(p_event_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e public.club_events := (select x from public.club_events x where x.id = p_event_id);
  v_exp bigint := extract(epoch from now() + interval '15 minutes')::bigint;
begin
  if e.id is null then raise exception 'EVENT_NOT_FOUND'; end if;
  perform private.require_staff(e.club_id);
  if e.status = 'CANCELLED' then raise exception 'EVENT_CANCELLED'; end if;
  if not private.event_checkin_open(e) then raise exception 'CHECKIN_CLOSED'; end if;
  return jsonb_build_object('token', e.id || '.' || v_exp || '.' || private.event_sig(e.id, v_exp),
                            'expires_at', to_timestamp(v_exp));
end $$;

create or replace function public.checkin_club_event(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_parts text[] := string_to_array(coalesce(p_token, ''), '.');
  v_event uuid;
  v_exp bigint;
  e public.club_events;
begin
  if cardinality(v_parts) <> 3 then raise exception 'INVALID_TOKEN'; end if;
  begin
    v_event := v_parts[1]::uuid;
    v_exp := v_parts[2]::bigint;
  exception when others then
    raise exception 'INVALID_TOKEN';
  end;
  e := (select x from public.club_events x where x.id = v_event);
  if e.id is null or private.event_sig(v_event, v_exp) is distinct from v_parts[3] then raise exception 'INVALID_TOKEN'; end if;
  if extract(epoch from now()) > v_exp then raise exception 'TOKEN_EXPIRED'; end if;
  if not public.club_is_member(e.club_id) then raise exception 'NOT_A_MEMBER'; end if;
  if e.status = 'CANCELLED' then raise exception 'EVENT_CANCELLED'; end if;
  if not private.event_checkin_open(e) then raise exception 'CHECKIN_CLOSED'; end if;
  return jsonb_build_object('new', private.event_mark_checkin(e.id, v_uid, 'QR'), 'event_id', e.id, 'club_id', e.club_id, 'title', e.title);
end $$;

-- Thành viên tự điểm danh bằng vị trí GPS hiện tại
create or replace function public.gps_checkin_club_event(p_event_id uuid, p_lat double precision, p_lng double precision,
                                                         p_accuracy_m double precision default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  e public.club_events := (select x from public.club_events x where x.id = p_event_id);
  v_dist numeric;
begin
  if e.id is null then raise exception 'EVENT_NOT_FOUND'; end if;
  if not public.club_is_member(e.club_id) then raise exception 'NOT_A_MEMBER'; end if;
  if e.status = 'CANCELLED' then raise exception 'EVENT_CANCELLED'; end if;
  if not private.event_checkin_open(e) then raise exception 'CHECKIN_CLOSED'; end if;
  if e.lat is null or e.lng is null then raise exception 'NO_EVENT_LOCATION'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'INVALID_LOCATION'; end if;
  if p_accuracy_m is not null and p_accuracy_m > 100 then raise exception 'LOW_ACCURACY'; end if;
  v_dist := private.haversine_m(p_lat::numeric, p_lng::numeric, e.lat::numeric, e.lng::numeric);
  if v_dist > 300 then raise exception 'TOO_FAR'; end if;
  return jsonb_build_object('new', private.event_mark_checkin(e.id, v_uid, 'GPS'), 'event_id', e.id, 'club_id', e.club_id,
                            'title', e.title, 'distance_m', round(v_dist));
end $$;

-- Ban quản trị điểm danh tay: chỉ khi sự kiện đã bắt đầu
create or replace function public.staff_checkin(p_event_id uuid, p_user_id uuid, p_checked boolean) returns void
language plpgsql security definer set search_path = public as $$
declare e public.club_events := (select x from public.club_events x where x.id = p_event_id);
begin
  if e.id is null then raise exception 'EVENT_NOT_FOUND'; end if;
  perform private.require_staff(e.club_id);
  if not exists (select 1 from public.club_members where club_id = e.club_id and user_id = p_user_id and status = 'APPROVED') then
    raise exception 'NOT_A_MEMBER';
  end if;
  if p_checked then
    if e.status = 'CANCELLED' then raise exception 'EVENT_CANCELLED'; end if;
    if now() < e.starts_at then raise exception 'EVENT_NOT_STARTED'; end if;
    perform private.event_mark_checkin(e.id, p_user_id, 'STAFF');
  else
    update public.club_event_rsvps set checked_in_at = null, checkin_method = null, activity_id = null, updated_at = now()
     where event_id = e.id and user_id = p_user_id;
  end if;
end $$;

revoke all on function public.gps_checkin_club_event(uuid, double precision, double precision, double precision) from public, anon;
grant execute on function public.gps_checkin_club_event(uuid, double precision, double precision, double precision) to authenticated;
revoke all on function private.event_checkin_open(public.club_events) from public, anon, authenticated;
notify pgrst, 'reload schema';
