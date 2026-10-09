-- RaceHub — PHẦN 25/26 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 014300, 014400, 014500, 014600, 014700
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

commit;
