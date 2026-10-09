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
