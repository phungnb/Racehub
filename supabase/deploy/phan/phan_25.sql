-- RaceHub — PHẦN 25/26 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 014300, 014400, 014500, 014600, 014800
-- Supabase → SQL Editor → New query → dán TOÀN BỘ phần này → Run. Lỗi thì không có gì thay đổi; chạy lại vẫn an toàn.
-- Xong thì chạy phần tiếp theo.
begin;
-- ===================================================================
-- 20261001014300_club_event_feed_post.sql
-- ===================================================================
-- Lịch CLB mới tạo → tự lên bảng tin CLB (club_posts.kind = 'NEWS', chuyên mục EVENT, meta.event_id).
-- Trước đây create_club_event chỉ gửi thông báo, không có bài trên bảng tin nên lịch vừa tạo không hiện ở đó.
-- Dùng trigger để không phải sao lại các RPC tạo/sửa/hủy: sửa lịch thì cập nhật bài, hủy lịch thì gỡ bài.

create or replace function private.club_event_post_body(e public.club_events) returns text
language sql immutable set search_path = public as $$
  select to_char(e.starts_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM/YYYY')
      || coalesce(E'\n' || e.location_name, '')
      || coalesce(E'\n' || nullif(trim(e.description), ''), '')
$$;

create or replace function private.club_event_to_post() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'SCHEDULED' then
      insert into public.club_posts (club_id, author_id, kind, title, body, meta)
      values (new.club_id, new.created_by, 'NEWS', 'Lịch chạy: ' || new.title, private.club_event_post_body(new),
              jsonb_build_object('category', 'EVENT', 'event_id', new.id));
    end if;
  elsif new.status = 'CANCELLED' then
    delete from public.club_posts where kind = 'NEWS' and meta->>'event_id' = new.id::text;
  else
    update public.club_posts set title = 'Lịch chạy: ' || new.title, body = private.club_event_post_body(new)
     where kind = 'NEWS' and meta->>'event_id' = new.id::text;
  end if;
  return new;
end $$;

drop trigger if exists club_event_post_trg on public.club_events;
create trigger club_event_post_trg after insert or update of title, description, starts_at, location_name, status
  on public.club_events for each row execute function private.club_event_to_post();

revoke all on function private.club_event_to_post() from public, anon, authenticated;

-- Lịch sắp tới đã tạo trước đây
insert into public.club_posts (club_id, author_id, kind, title, body, meta, created_at)
select e.club_id, e.created_by, 'NEWS', 'Lịch chạy: ' || e.title, private.club_event_post_body(e),
       jsonb_build_object('category', 'EVENT', 'event_id', e.id), e.created_at
  from public.club_events e
 where e.status = 'SCHEDULED' and e.starts_at > now()
   and not exists (select 1 from public.club_posts p where p.kind = 'NEWS' and p.meta->>'event_id' = e.id::text);

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001014400_order_payment_reminder.sql
-- ===================================================================
-- Admin nhắc người mua hoàn tất thanh toán đơn đang chờ: gửi thông báo trong app (không tự động hàng loạt).
alter table public.orders add column if not exists reminded_at timestamptz;

create or replace function public.admin_remind_order(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  o public.orders := (select x from public.orders x where x.id = p_order_id for update);
  v_plan text; v_what text; v_body text;
begin
  if o.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.status <> 'PENDING' or o.expires_at <= now() then raise exception 'ORDER_NOT_PENDING'; end if;
  if o.reminded_at is not null and o.reminded_at > now() - interval '6 hours' then raise exception 'ORDER_REMIND_TOO_SOON'; end if;
  if o.kind = 'PLAN' then
    v_plan := coalesce((select name from public.plans where code = o.plan_code), 'gói');
    v_what := 'kích hoạt ' || v_plan || coalesce(' ' || o.months || ' tháng', '');
  else
    v_what := 'nhận ' || (o.xu + o.bonus_xu) || ' Xu';
  end if;
  v_body := 'Hãy liên hệ với RaceHub và hoàn thành thủ tục thanh toán để ' || v_what
         || '. Chuyển khoản đúng nội dung ' || o.code || ' hoặc nhắn admin qua mục Liên hệ trong trang Gói.';
  perform private.notify(o.buyer_id, null, 'ORDER_REMINDER', 'Đơn ' || o.code || ' đang chờ thanh toán', v_body, '/goi', v_uid, true);
  update public.orders set reminded_at = now() where id = o.id;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'REMIND_ORDER', o.code, jsonb_build_object('kind', o.kind, 'amount_vnd', o.amount_vnd));
  return private.order_json((select x from public.orders x where x.id = o.id));
end $$;

revoke all on function public.admin_remind_order(uuid) from public, anon;
grant execute on function public.admin_remind_order(uuid) to authenticated;
notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001014500_admin_delete_rejected_runs.sql
-- ===================================================================
-- Admin xóa hàng loạt bài chạy đang ở trạng thái BỊ LOẠI (REJECTED) khỏi danh sách duyệt.
-- Xóa MỀM (status = 'DELETED', giống người dùng xóa bài): giữ nguyên dòng để lịch sử quyết định chống gian lận còn nguyên.
-- Bài bị loại chưa từng cộng Xu / XP / điểm thử thách nên xóa không hoàn hay trừ gì. Bài không còn ở trạng thái bị loại thì bỏ qua.
create or replace function public.admin_delete_rejected_activities(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  v_ids uuid[];
begin
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'NO_IDS'; end if;
  if array_length(p_ids, 1) > 500 then raise exception 'TOO_MANY'; end if;
  with d as (
    update public.activities a
       set status = 'DELETED', updated_at = now()
     where a.id = any (p_ids) and a.validation_status = 'REJECTED' and coalesce(a.status, '') <> 'DELETED'
    returning a.id)
  select coalesce(array_agg(id), '{}') into v_ids from d;
  if cardinality(v_ids) > 0 then
    insert into public.admin_audit_log (actor_id, action, target, new_value)
    values (v_uid, 'DELETE_REJECTED_ACTIVITIES', cardinality(v_ids)::text,
            jsonb_build_object('requested', cardinality(p_ids), 'deleted_ids', to_jsonb(v_ids)));
  end if;
  return jsonb_build_object('requested', cardinality(p_ids), 'deleted', cardinality(v_ids));
end $$;

revoke all on function public.admin_delete_rejected_activities(uuid[]) from public, anon;
grant execute on function public.admin_delete_rejected_activities(uuid[]) to authenticated;
notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001014600_admin_banned_users.sql
-- ===================================================================
-- Danh sách tài khoản đang khóa cho admin (thẻ "N tài khoản đang khóa" ở Tổng quan bấm được).
-- Khớp cách đếm của admin_inbox: profiles.banned_at is not null.
-- Phân loại: SELF_DELETED = người dùng tự xóa (banned_reason = 'ACCOUNT_DELETED'), ADMIN = admin khóa tay.
create or replace function public.admin_banned_users() returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', pr.id, 'name', pr.display_name, 'avatar_url', pr.avatar_url, 'email', u.email,
      'banned_at', pr.banned_at, 'reason', pr.banned_reason,
      'kind', case when pr.banned_reason = 'ACCOUNT_DELETED' then 'SELF_DELETED' else 'ADMIN' end,
      'banned_by', (select private.display_name(l.actor_id) from public.admin_audit_log l
                     where l.action = 'USER_BAN' and l.target in ('user:' || pr.id, pr.id::text)
                     order by l.created_at desc limit 1)
    ) order by pr.banned_at desc)
    from public.profiles pr left join auth.users u on u.id = pr.id
    where pr.banned_at is not null), '[]'::jsonb);
end $$;

revoke all on function public.admin_banned_users() from public, anon;
grant execute on function public.admin_banned_users() to authenticated;
notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001014800_event_checkin_window.sql
-- ===================================================================
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

commit;
