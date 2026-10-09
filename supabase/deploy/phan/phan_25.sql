-- RaceHub — PHẦN 25/26 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 014300, 014400, 014500, 014600, 014900
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

commit;
