-- RaceHub — PHẦN 25/26 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 014300, 014400, 014500, 014600, 014700, 014800, 014900, 015000
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
-- 20261001014700_dm_delete.sql
-- ===================================================================
-- Xóa tin nhắn 1-1 kiểu Zalo (xóa mềm, không mất dữ liệu gốc):
--  * Thu hồi (xóa với mọi người): chỉ tin của mình, trong 24 giờ kể từ lúc gửi; hai bên thấy "Tin nhắn đã được thu hồi".
--  * Xóa ở phía tôi: ẩn một tin (của mình hoặc của người khác) chỉ với riêng mình.
--  * Xóa cuộc trò chuyện: ẩn toàn bộ tin tới thời điểm bấm, chỉ với riêng mình; tin mới sau đó vẫn hiện lại bình thường.
-- Mọi bảng mới bật RLS, không cấp quyền trực tiếp; chỉ đi qua RPC security definer có kiểm tra người tham gia.
create table if not exists public.direct_message_hidden (
  message_id uuid not null references public.direct_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.direct_message_hidden enable row level security;
revoke all on public.direct_message_hidden from anon, authenticated;

alter table public.direct_threads add column if not exists a_cleared_at timestamptz;
alter table public.direct_threads add column if not exists b_cleared_at timestamptz;

-- Tin nhắn người dùng này còn nhìn thấy: chưa bị xóa phía mình, và sau mốc xóa cuộc trò chuyện
create or replace function private.dm_visible(m public.direct_messages, p_uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.direct_message_hidden h where h.message_id = m.id and h.user_id = p_uid)
     and m.created_at > coalesce((select case when t.user_a = p_uid then t.a_cleared_at else t.b_cleared_at end
                                    from public.direct_threads t where t.id = m.thread_id), '-infinity'::timestamptz)
$$;
revoke all on function private.dm_visible(public.direct_messages, uuid) from public, anon, authenticated;

-- Mở cuộc trò chuyện: chỉ tin còn nhìn thấy
create or replace function public.direct_thread(p_user uuid, p_before timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  t public.direct_threads := (select x from public.direct_threads x where x.user_a = least(v_uid, p_user) and x.user_b = greatest(v_uid, p_user));
  pr public.profiles := (select x from public.profiles x where x.id = p_user);
begin
  if pr.id is null or p_user = v_uid then raise exception 'USER_NOT_FOUND'; end if;
  if t.id is not null then
    update public.direct_threads set a_read_at = case when user_a = v_uid then now() else a_read_at end,
                                     b_read_at = case when user_b = v_uid then now() else b_read_at end where id = t.id;
  end if;
  return jsonb_build_object(
    'user', jsonb_build_object('id', pr.id, 'display_name', pr.display_name, 'avatar_url', pr.avatar_url, 'level', coalesce(pr.level, 1)),
    'can_message', private.can_dm(v_uid, p_user),
    'blocked', private.is_blocked(v_uid, p_user),
    'blocked_by_me', exists (select 1 from public.user_blocks b where b.blocker = v_uid and b.blocked = p_user),
    'messages', coalesce((select jsonb_agg(private.dm_json(m, v_uid) order by m.created_at)
                  from (select x.id, row_number() over (order by x.created_at desc) as rn from public.direct_messages x
                         where x.thread_id = t.id and x.created_at < coalesce(p_before, now() + interval '1 day')
                           and private.dm_visible(x, v_uid)) r
                  join public.direct_messages m on m.id = r.id
                 where r.rn <= 60), '[]'::jsonb));
end $$;

-- Hộp thư: chỉ cuộc trò chuyện còn tin nhìn thấy; tin cuối và số chưa đọc cũng chỉ tính tin nhìn thấy
create or replace function public.direct_inbox() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
            'user', jsonb_build_object('id', pr.id, 'display_name', pr.display_name, 'avatar_url', pr.avatar_url),
            'last_message_at', (lm.x).created_at,
            'last', private.dm_json(lm.x, v_uid),
            'unread', (select count(*) from public.direct_messages m where m.thread_id = t.id and m.sender_id <> v_uid and m.deleted_at is null
                         and private.dm_visible(m, v_uid)
                         and m.created_at > coalesce(case when t.user_a = v_uid then t.a_read_at else t.b_read_at end, '-infinity'::timestamptz)))
          order by (lm.x).created_at desc)
    from public.direct_threads t
    join public.profiles pr on pr.id = case when t.user_a = v_uid then t.user_b else t.user_a end
    cross join lateral (select x from public.direct_messages x where x.thread_id = t.id and private.dm_visible(x, v_uid)
                         order by x.created_at desc limit 1) lm
   where (t.user_a = v_uid or t.user_b = v_uid) and t.last_message_at is not null
     and not exists (select 1 from public.user_blocks b where b.blocker = v_uid and b.blocked = pr.id)), '[]'::jsonb);
end $$;

create or replace function public.direct_unread_count() returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.direct_messages m join public.direct_threads t on t.id = m.thread_id
   where (t.user_a = auth.uid() or t.user_b = auth.uid()) and m.sender_id <> auth.uid() and m.deleted_at is null
     and private.dm_visible(m, auth.uid())
     and m.created_at > coalesce(case when t.user_a = auth.uid() then t.a_read_at else t.b_read_at end, '-infinity'::timestamptz)
     and not exists (select 1 from public.user_blocks b where b.blocker = auth.uid() and b.blocked = m.sender_id)
$$;

-- Thu hồi tin của mình: trong 24 giờ kể từ lúc gửi (quá hạn → RECALL_EXPIRED). Thu hồi lại tin đã thu hồi: không đổi gì.
create or replace function public.delete_direct_message(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.direct_messages := (select x from public.direct_messages x where x.id = p_id);
begin
  if m.id is null then raise exception 'NOT_FOUND'; end if;
  if m.sender_id is distinct from private.require_uid() then raise exception 'NOT_AUTHOR'; end if;
  if m.deleted_at is not null then return; end if;
  if m.created_at < now() - interval '24 hours' then raise exception 'RECALL_EXPIRED'; end if;
  update public.direct_messages set deleted_at = now() where id = p_id;
end $$;

-- Xóa ở phía tôi: ẩn một tin với riêng mình (người tham gia cuộc trò chuyện, tin của ai cũng được)
create or replace function public.hide_direct_message(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  m public.direct_messages := (select x from public.direct_messages x where x.id = p_id);
begin
  if m.id is null or not exists (select 1 from public.direct_threads t where t.id = m.thread_id and v_uid in (t.user_a, t.user_b)) then
    raise exception 'NOT_FOUND';
  end if;
  insert into public.direct_message_hidden (message_id, user_id) values (m.id, v_uid) on conflict do nothing;
end $$;

-- Xóa cả cuộc trò chuyện ở phía tôi: ẩn mọi tin tới bây giờ; người kia vẫn giữ nguyên
create or replace function public.clear_direct_thread(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  if p_user is null or p_user = v_uid then raise exception 'INVALID_TARGET'; end if;
  update public.direct_threads set a_cleared_at = case when user_a = v_uid then now() else a_cleared_at end,
                                   b_cleared_at = case when user_b = v_uid then now() else b_cleared_at end,
                                   a_read_at = case when user_a = v_uid then now() else a_read_at end,
                                   b_read_at = case when user_b = v_uid then now() else b_read_at end
   where user_a = least(v_uid, p_user) and user_b = greatest(v_uid, p_user);
end $$;

revoke all on function public.direct_thread(uuid, timestamptz), public.direct_inbox(), public.direct_unread_count(),
  public.delete_direct_message(uuid), public.hide_direct_message(uuid), public.clear_direct_thread(uuid) from public, anon;
grant execute on function public.direct_thread(uuid, timestamptz), public.direct_inbox(), public.direct_unread_count(),
  public.delete_direct_message(uuid), public.hide_direct_message(uuid), public.clear_direct_thread(uuid) to authenticated;
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

-- ===================================================================
-- 20261001014900_join_conquest.sql
-- ===================================================================
-- 014900: Thử thách chinh phục: tham gia BẮT BUỘC có hạng mục (như thử thách theo mục tiêu, 012000).
--   join_challenge_conquest(id, items, code): vào thử thách + đăng ký hạng mục trong CÙNG một giao dịch.
--   - Nhiều hạng mục: phải chọn ít nhất 1, không chọn thì không vào (CONQUEST_REQUIRED).
--   - Chỉ 1 hạng mục và không cần đặt mục tiêu riêng (FIXED / ANY): tự đăng ký hạng mục đó, items để trống.
--   - Chế độ SELF: luôn phải nhập mục tiêu của mình, kể cả khi chỉ có 1 hạng mục.
--   Dọn dữ liệu cũ: người đã tham gia nhưng chưa có hạng mục, ở thử thách chỉ có 1 hạng mục (FIXED / ANY) → tự đăng ký.
-- Chạy được trong SQL Editor, chạy lại an toàn.

create or replace function public.join_challenge_conquest(p_challenge_id uuid, p_items jsonb default null, p_code text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.challenges;
  v_items jsonb := case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end;
  v_cats uuid[];
  v_join jsonb;
begin
  perform private.require_uid();
  c := (select x from public.challenges x where x.id = p_challenge_id);
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if c.objective not in ('BEST_TIME', 'BEST_PACE') then raise exception 'CONQUEST_NOT_SUPPORTED'; end if;
  if jsonb_array_length(v_items) = 0 then
    v_cats := array(select id from public.challenge_categories where challenge_id = c.id);
    if coalesce(array_length(v_cats, 1), 0) = 1 and c.conquest_mode in ('FIXED', 'ANY') then
      v_items := jsonb_build_array(jsonb_build_object('category_id', v_cats[1]));
    else
      raise exception 'CONQUEST_REQUIRED';
    end if;
  end if;
  v_join := public.join_challenge(p_challenge_id, p_code, null);
  perform public.set_my_conquest(p_challenge_id, v_items);   -- sai hạng mục / mục tiêu → cả giao dịch hoàn tác, không vào
  return coalesce(v_join, '{}'::jsonb) || jsonb_build_object('categories', jsonb_array_length(v_items));
end $$;

revoke all on function public.join_challenge_conquest(uuid, jsonb, text) from public, anon;
grant execute on function public.join_challenge_conquest(uuid, jsonb, text) to authenticated;

-- Dọn dữ liệu cũ: thử thách chỉ có 1 hạng mục, không cần mục tiêu riêng → người đã tham gia mà chưa chọn được gán hạng mục đó
do $$
declare
  r record;
begin
  for r in
    select p.id as pid, p.profile_id, p.challenge_id, cat.id as cat_id
      from public.challenges c
      join public.challenge_categories cat on cat.challenge_id = c.id
      join public.challenge_participants p on p.challenge_id = c.id and p.status <> 'LEFT'
     where c.objective in ('BEST_TIME', 'BEST_PACE') and c.conquest_mode in ('FIXED', 'ANY')
       and (select count(*) from public.challenge_categories x where x.challenge_id = c.id) = 1
       and not exists (select 1 from public.challenge_category_entries e where e.participant_id = p.id)
  loop
    insert into public.challenge_category_entries (participant_id, category_id, challenge_id, user_id)
    values (r.pid, r.cat_id, r.challenge_id, r.profile_id) on conflict do nothing;
    perform private.challenge_recompute_participant(r.pid);
  end loop;
end $$;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001015000_feedback_bubble.sql
-- ===================================================================
-- 015000: HỘP THƯ GÓP Ý (bong bóng nổi trong app)
-- Người dùng gửi góp ý / điểm hài lòng / báo lỗi; admin xem và đánh dấu đã xử lý (Quản trị → Cộng đồng → Góp ý).
-- Chỉ ghi qua RPC (client không đụng bảng). Mỗi người tối đa 5 góp ý / 24 giờ. Chạy lại an toàn.
create table if not exists public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('IDEA', 'BUG', 'LOVE', 'OTHER')),
  rating smallint check (rating between 1 and 5),
  body text not null default '' check (char_length(body) <= 1000),
  platform text,
  page text,
  status text not null default 'NEW' check (status in ('NEW', 'DONE')),
  admin_note text,
  handled_by uuid references public.profiles(id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists app_feedback_status_idx on public.app_feedback (status, created_at desc);
create index if not exists app_feedback_user_idx on public.app_feedback (user_id, created_at desc);
alter table public.app_feedback enable row level security;
revoke all on public.app_feedback from anon, authenticated;

-- Gửi góp ý: cần điểm hài lòng HOẶC lời nhắn (≥ 3 ký tự)
create or replace function public.submit_feedback(p_kind text, p_rating integer default null, p_body text default null,
                                                  p_platform text default null, p_page text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_body text := trim(coalesce(p_body, ''));
begin
  if upper(coalesce(p_kind, '')) not in ('IDEA', 'BUG', 'LOVE', 'OTHER') then raise exception 'INVALID_FEEDBACK_KIND'; end if;
  if p_rating is not null and (p_rating < 1 or p_rating > 5) then raise exception 'INVALID_FEEDBACK_RATING'; end if;
  if char_length(v_body) > 1000 then raise exception 'FEEDBACK_TOO_LONG'; end if;
  if p_rating is null and char_length(v_body) < 3 then raise exception 'FEEDBACK_EMPTY'; end if;
  if (select count(*) from public.app_feedback f where f.user_id = v_uid and f.created_at > now() - interval '24 hours') >= 5 then
    raise exception 'FEEDBACK_RATE_LIMIT';
  end if;
  insert into public.app_feedback (user_id, kind, rating, body, platform, page)
  values (v_uid, upper(p_kind), p_rating, v_body, left(nullif(trim(coalesce(p_platform, '')), ''), 30), left(nullif(trim(coalesce(p_page, '')), ''), 120));
end $$;

-- Admin: danh sách góp ý (p_status: NEW | DONE | ALL) + số liệu tóm tắt
create or replace function public.admin_feedback_list(p_status text default 'NEW') returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'new_count', (select count(*) from public.app_feedback where status = 'NEW'),
    'avg_rating', (select round(avg(rating)::numeric, 2) from public.app_feedback where rating is not null),
    'rating_count', (select count(*) from public.app_feedback where rating is not null),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'user_id', x.user_id, 'name', private.display_name(x.user_id), 'email', u.email,
        'kind', x.kind, 'rating', x.rating, 'body', x.body, 'platform', x.platform, 'page', x.page,
        'status', x.status, 'admin_note', x.admin_note, 'handled_by', private.display_name(x.handled_by),
        'handled_at', x.handled_at, 'created_at', x.created_at) order by x.created_at desc)
      from (select * from public.app_feedback f
             where upper(coalesce(p_status, 'ALL')) = 'ALL' or f.status = upper(p_status)
             order by f.created_at desc limit 300) x
      left join auth.users u on u.id = x.user_id), '[]'::jsonb));
end $$;

-- Admin: đánh dấu đã xử lý / mở lại (kèm ghi chú)
create or replace function public.admin_feedback_set_status(p_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_admin uuid := private.require_admin();
begin
  if upper(coalesce(p_status, '')) not in ('NEW', 'DONE') then raise exception 'INVALID_FEEDBACK_STATUS'; end if;
  if not exists (select 1 from public.app_feedback where id = p_id) then raise exception 'FEEDBACK_NOT_FOUND'; end if;
  update public.app_feedback
     set status = upper(p_status), admin_note = nullif(trim(coalesce(p_note, '')), ''),
         handled_by = case when upper(p_status) = 'DONE' then v_admin end,
         handled_at = case when upper(p_status) = 'DONE' then now() end
   where id = p_id;
end $$;

revoke all on function public.submit_feedback(text, integer, text, text, text),
  public.admin_feedback_list(text), public.admin_feedback_set_status(uuid, text, text) from public, anon;
grant execute on function public.submit_feedback(text, integer, text, text, text),
  public.admin_feedback_list(text), public.admin_feedback_set_status(uuid, text, text) to authenticated;
notify pgrst, 'reload schema';

commit;
