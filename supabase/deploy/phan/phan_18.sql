-- RaceHub — PHẦN 18/19 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 011500
-- Supabase → SQL Editor → New query → dán TOÀN BỘ phần này → Run. Lỗi thì không có gì thay đổi; chạy lại vẫn an toàn.
-- Xong thì chạy phần tiếp theo.
begin;
-- ===================================================================
-- 20261001011500_social_follow_dm.sql
-- ===================================================================
-- 011500: MẠNG XÃ HỘI RUNNER — THÔNG BÁO HOẠT ĐỘNG MỚI, SỬA BÌNH LUẬN, THEO DÕI RUNNER, TIN NHẮN 1-1
--   1. Thông báo khi bài chạy từ Strava / đồng hồ về: câu chúc mừng thay cho "Bài chạy … đã về RaceHub".
--   2. Người viết bình luận được SỬA bình luận của mình (hiện "đã sửa"); xóa như cũ (người viết hoặc ban quản trị).
--   3. Theo dõi runner (một chiều như Strava): bảng tin "Đang theo dõi" hiện hoạt động của người mình theo dõi (và của mình),
--      tôn trọng quyền riêng tư sẵn có (Công khai / Chỉ CLB / Riêng tư, bài Strava chưa đồng ý chia sẻ thì không hiện).
--      Người được theo dõi nhận thông báo. Chặn nhau → tự bỏ theo dõi hai chiều.
--   4. Tin nhắn 1-1 giữa hai runner: nhắn được khi người nhận theo dõi mình, hoặc hai người là bạn kết nối, hoặc cùng CLB,
--      hoặc người nhận đã từng nhắn cho mình. Có chặn, báo cáo (ngữ cảnh DM), thu hồi tin; giới hạn 60 tin / giờ.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

-- ---------------------------------------------------------------------
-- 1. Thông báo hoạt động mới
-- ---------------------------------------------------------------------
create or replace function private.run_synced_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_km numeric;
  v_xu numeric;
  v_xp numeric;
  v_more integer;
  v_pace text;
  v_body text;
  v_km_text text;
  v_title text;
begin
  if new.user_id is null or new.source_activity_id is null or new.source = 'DIRECT_GPS' then return new; end if;
  if coalesce(new.started_at, now()) < now() - interval '2 days' then return new; end if;
  begin
    v_km := private.run_km(new);
    v_km_text := replace(to_char(round(v_km, 2), 'FM999990.00'), '.', ',') || ' km';
    -- Trigger này tên "zz" nên chạy sau các trigger cộng thưởng khác (thẻ bài chạy, nhiệm vụ, chuỗi, huy hiệu…)
    v_xu := (select coalesce(sum(e.xu), 0) from public.game_events e where e.activity_id = new.id and e.kind <> 'CHEER_IN');
    v_xp := (select coalesce(sum(e.xp), 0) from public.game_events e where e.activity_id = new.id);
    v_more := (select count(*) from public.game_events e where e.activity_id = new.id and e.kind <> 'RUN');
    v_pace := private.pace_text(case when v_km > 0 then coalesce(nullif(new.moving_time_s, 0), new.elapsed_time_s) / v_km end);
    v_body := concat_ws(' · ', v_km_text,
      case when v_pace is not null then 'Pace ' || v_pace || '/km' end,
      case when v_xu > 0 then '+' || replace(trim_scale(round(v_xu, 1))::text, '.', ',') || ' Xu' end,
      case when v_xp > 0 then '+' || round(v_xp)::text || ' XP' end,
      case when v_more > 0 then v_more || ' phần thưởng khác' end);
    v_title := (array['Chúc mừng! Bạn có hoạt động mới 🎉',
                      'Bạn đã hoàn thành thêm 1 hoạt động nữa rồi — chúc mừng bạn! 💪',
                      'Chúc mừng bạn có thêm hoạt động mới 🏃'])[1 + floor(random() * 3)::int];
    perform private.notify(new.user_id, null, 'RUN_SYNCED', v_title, v_body, '/feed?rewards=1', null, true);
  exception when others then
    raise warning 'run_synced_notify % lỗi: % %', new.id, sqlstate, sqlerrm;
  end;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2. Sửa bình luận (chỉ người viết)
-- ---------------------------------------------------------------------
alter table public.club_post_comments add column if not exists edited_at timestamptz;
alter table public.org_post_comments add column if not exists edited_at timestamptz;

create or replace function public.edit_post_comment(p_comment_id uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.club_post_comments := (select x from public.club_post_comments x where x.id = p_comment_id and x.deleted_at is null);
  v_body text := trim(coalesce(p_body, ''));
begin
  if c.id is null then raise exception 'COMMENT_NOT_FOUND'; end if;
  if c.author_id is distinct from v_uid then raise exception 'NOT_AUTHOR'; end if;
  if char_length(v_body) not between 1 and 1000 then raise exception 'EMPTY_COMMENT'; end if;
  if v_body = c.body then return; end if;
  update public.club_post_comments set body = v_body, edited_at = now() where id = c.id;
end $$;

create or replace function public.edit_org_post_comment(p_id uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.org_post_comments := (select x from public.org_post_comments x where x.id = p_id);
  v_body text := trim(coalesce(p_body, ''));
begin
  if c.id is null then raise exception 'COMMENT_NOT_FOUND'; end if;
  if c.author_id is distinct from v_uid then raise exception 'NOT_AUTHOR'; end if;
  if char_length(v_body) not between 1 and 1000 then raise exception 'EMPTY_COMMENT'; end if;
  if v_body = c.body then return; end if;
  update public.org_post_comments set body = v_body, edited_at = now() where id = c.id;
end $$;

-- Danh sách bình luận kèm "đã sửa" và quyền sửa
create or replace function public.club_post_comment_thread(p_post_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); p public.club_posts := (select x from public.club_posts x where x.id = p_post_id and x.deleted_at is null);
begin
  if p.id is null then raise exception 'POST_NOT_FOUND'; end if;
  if not public.club_is_member(p.club_id) and not public.is_system_admin() then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'parent_id', c.parent_id, 'author_id', c.author_id, 'body', c.body, 'created_at', c.created_at, 'edited_at', c.edited_at,
      'author_name', pr.display_name, 'author_avatar', pr.avatar_url, 'author_level', pr.level,
      'like_count', c.like_count,
      'liked', exists (select 1 from public.club_comment_likes l where l.comment_id = c.id and l.user_id = v_uid),
      'can_edit', c.author_id = v_uid,
      'can_delete', c.author_id = v_uid or public.club_is_staff(p.club_id)) order by c.created_at)
    from public.club_post_comments c left join public.profiles pr on pr.id = c.author_id
   where c.post_id = p_post_id and c.deleted_at is null), '[]'::jsonb);
end $$;

create or replace function public.org_post_comments(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := (select p.org_id from public.org_posts p where p.id = p_id);
begin
  if v_org is null or not public.org_is_member(v_org) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', cm.id, 'parent_id', cm.parent_id, 'body', cm.body, 'created_at', cm.created_at,
             'edited_at', cm.edited_at, 'author_id', cm.author_id, 'author_name', private.display_name(cm.author_id), 'author_avatar', pr.avatar_url,
             'like_count', (select count(*)::int from public.org_comment_likes l where l.comment_id = cm.id),
             'liked', exists (select 1 from public.org_comment_likes l where l.comment_id = cm.id and l.user_id = auth.uid()),
             'can_edit', cm.author_id = auth.uid(),
             'can_delete', cm.author_id = auth.uid() or public.org_is_admin(v_org)) order by cm.created_at)
           from public.org_post_comments cm left join public.profiles pr on pr.id = cm.author_id where cm.post_id = p_id), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- 3. Theo dõi runner
-- ---------------------------------------------------------------------
create table if not exists public.runner_follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followee_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index if not exists runner_follows_followee_idx on public.runner_follows (followee_id, created_at desc);
alter table public.runner_follows enable row level security;
revoke all on public.runner_follows from anon, authenticated;

create or replace function private.is_following(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.runner_follows f where f.follower_id = p_a and f.followee_id = p_b)
$$;

-- Bảng tin nhắn 1-1 (tạo trước vì private.can_dm đọc tới)
create table if not exists public.direct_threads (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  a_read_at timestamptz,
  b_read_at timestamptz,
  unique (user_a, user_b),
  check (user_a < user_b)
);
create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.direct_threads(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists direct_messages_thread_idx on public.direct_messages (thread_id, created_at desc);
create index if not exists direct_threads_b_idx on public.direct_threads (user_b, last_message_at desc);
alter table public.direct_threads enable row level security;
alter table public.direct_messages enable row level security;
revoke all on public.direct_threads, public.direct_messages from anon, authenticated;

-- Hai người được nhắn tin cho nhau không (A gửi cho B)
create or replace function private.can_dm(p_from uuid, p_to uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_from is not null and p_to is not null and p_from <> p_to
     and not private.is_blocked(p_from, p_to)
     and (private.is_following(p_to, p_from)
          or private.are_connected(p_from, p_to)
          or public.shares_club(p_from, p_to)
          or exists (select 1 from public.direct_messages m join public.direct_threads t on t.id = m.thread_id
                      where t.user_a = least(p_from, p_to) and t.user_b = greatest(p_from, p_to) and m.sender_id = p_to))
$$;

create or replace function public.follow_runner(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); v_new boolean;
begin
  if p_user is null or p_user = v_uid then raise exception 'INVALID_TARGET'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_user) then raise exception 'USER_NOT_FOUND'; end if;
  if private.is_blocked(v_uid, p_user) then raise exception 'BLOCKED'; end if;
  v_new := not private.is_following(v_uid, p_user);
  if v_new then
    if (select count(*) from public.runner_follows f where f.follower_id = v_uid and f.created_at > now() - interval '1 day') >= 200 then
      raise exception 'RATE_LIMITED';
    end if;
    insert into public.runner_follows (follower_id, followee_id) values (v_uid, p_user) on conflict do nothing;
    perform private.notify(p_user, null, 'FOLLOW', private.display_name(v_uid) || ' đã theo dõi bạn',
      case when private.is_following(p_user, v_uid) then 'Hai bạn đã theo dõi nhau — giờ có thể nhắn tin cho nhau.'
           else 'Theo dõi lại để xem hoạt động của nhau.' end, '/athletes/' || v_uid, v_uid, false);
  end if;
  return public.follow_status(p_user);
end $$;

create or replace function public.unfollow_runner(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  delete from public.runner_follows where follower_id = private.require_uid() and followee_id = p_user;
  return public.follow_status(p_user);
end $$;

create or replace function public.follow_status(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'following', private.is_following(auth.uid(), p_user),
    'followed_by', private.is_following(p_user, auth.uid()),
    'followers', (select count(*) from public.runner_follows f where f.followee_id = p_user),
    'following_count', (select count(*) from public.runner_follows f where f.follower_id = p_user),
    'blocked', private.is_blocked(auth.uid(), p_user),
    'blocked_by_me', exists (select 1 from public.user_blocks b where b.blocker = auth.uid() and b.blocked = p_user),
    'can_message', private.can_dm(auth.uid(), p_user))
$$;

-- Danh sách người theo dõi / đang theo dõi của một runner (ai cũng xem được nếu xem được hồ sơ)
create or replace function public.follow_list(p_user uuid, p_kind text default 'FOLLOWERS') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_uid();
  if not public.can_view_profile(p_user) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url,
            'level', coalesce(p.level, 1), 'following', private.is_following(auth.uid(), p.id), 'is_me', p.id = auth.uid())
            order by f.created_at desc)
    from public.runner_follows f
    join public.profiles p on p.id = case when upper(p_kind) = 'FOLLOWING' then f.followee_id else f.follower_id end
   where (upper(p_kind) = 'FOLLOWING' and f.follower_id = p_user) or (upper(p_kind) <> 'FOLLOWING' and f.followee_id = p_user)), '[]'::jsonb);
end $$;

-- Bảng tin "Đang theo dõi": hoạt động của người mình theo dõi + của chính mình, mới nhất trước
create or replace function public.following_feed(p_before timestamptz default null, p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 40);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', t.id, 'title', t.title, 'source', t.source, 'started_at', t.started_at,
            'distance_m', t.dist, 'moving_time_s', t.mt, 'avg_pace_s', t.avg_pace_s, 'elevation_gain_m', t.elevation_gain_m,
            'is_me', t.user_id = v_uid,
            'user', jsonb_build_object('id', pr.id, 'display_name', pr.display_name, 'avatar_url', pr.avatar_url, 'level', coalesce(pr.level, 1)))
          order by t.started_at desc), '[]'::jsonb)
    from (select a.id, a.user_id, a.title, a.source, a.started_at, a.avg_pace_s, a.elevation_gain_m,
                 coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0) as dist, coalesce(a.moving_time_s, a.elapsed_time_s, 0) as mt,
                 row_number() over (order by a.started_at desc, a.id) as rn
            from public.activities a
           where (a.user_id = v_uid or a.user_id in (select f.followee_id from public.runner_follows f where f.follower_id = v_uid))
             and a.started_at is not null and a.started_at < coalesce(p_before, now() + interval '1 day')
             and a.started_at > now() - interval '90 days'
             and public.activity_is_countable(a.status, a.validation_status)
             and (a.user_id = v_uid or (a.shared and public.can_view_activities(a.user_id) and not private.is_blocked(v_uid, a.user_id)))) t
    join public.profiles pr on pr.id = t.user_id
   where t.rn <= v_limit);
end $$;

-- Gợi ý người để theo dõi: cùng CLB, bạn kết nối, người theo dõi mình mà mình chưa theo dõi lại
create or replace function public.follow_suggestions() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'display_name', s.display_name, 'avatar_url', s.avatar_url,
            'level', s.level, 'reason', s.reason) order by s.score desc, s.display_name)
    from (select p.id, p.display_name, p.avatar_url, coalesce(p.level, 1) as level,
                 case when private.is_following(p.id, v_uid) then 'Đang theo dõi bạn'
                      when private.are_connected(p.id, v_uid) then 'Bạn kết nối' else 'Cùng CLB' end as reason,
                 (case when private.is_following(p.id, v_uid) then 3 else 0 end) + (case when private.are_connected(p.id, v_uid) then 2 else 0 end) as score,
                 row_number() over (order by p.id) as rn
            from public.profiles p
           where p.id <> v_uid and not private.is_following(v_uid, p.id) and not private.is_blocked(v_uid, p.id)
             and (private.is_following(p.id, v_uid) or private.are_connected(p.id, v_uid) or public.shares_club(v_uid, p.id))) s
   where s.rn <= 30), '[]'::jsonb);
end $$;

-- Chặn → bỏ theo dõi hai chiều (giữ nguyên phần cũ: xóa kết nối, hủy lời mời)
create or replace function public.block_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  if p_user = v_uid then raise exception 'INVALID_TARGET'; end if;
  insert into public.user_blocks (blocker, blocked) values (v_uid, p_user) on conflict do nothing;
  delete from public.runner_connections where user_a = least(v_uid, p_user) and user_b = greatest(v_uid, p_user);
  update public.runner_connection_requests set status = 'CANCELLED', responded_at = now()
   where status = 'PENDING' and ((from_id = v_uid and to_id = p_user) or (from_id = p_user and to_id = v_uid));
  delete from public.runner_follows where (follower_id = v_uid and followee_id = p_user) or (follower_id = p_user and followee_id = v_uid);
end $$;

-- ---------------------------------------------------------------------
-- 4. Tin nhắn 1-1
-- ---------------------------------------------------------------------
-- Báo cáo từ tin nhắn / bình luận
alter table public.user_reports drop constraint if exists user_reports_context_check;
alter table public.user_reports add constraint user_reports_context_check
  check (context in ('NEARBY', 'CONNECTION', 'CLUB', 'BIB', 'MARKET', 'OTHER', 'DM', 'COMMENT', 'PROFILE'));

create or replace function private.dm_json(m public.direct_messages, p_uid uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', m.id, 'sender_id', m.sender_id, 'mine', m.sender_id = p_uid, 'created_at', m.created_at,
    'deleted', m.deleted_at is not null, 'body', case when m.deleted_at is null then m.body else null end)
$$;

create or replace function public.send_direct_message(p_to uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_body text := trim(coalesce(p_body, ''));
  v_thread uuid;
  v_prev timestamptz;
  v_read timestamptz;
  m public.direct_messages;
begin
  if p_to is null or p_to = v_uid then raise exception 'INVALID_TARGET'; end if;
  if char_length(v_body) not between 1 and 2000 then raise exception 'EMPTY_MESSAGE'; end if;
  if private.is_blocked(v_uid, p_to) then raise exception 'BLOCKED'; end if;
  if not private.can_dm(v_uid, p_to) then raise exception 'DM_NOT_ALLOWED'; end if;
  if (select count(*) from public.direct_messages x where x.sender_id = v_uid and x.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'RATE_LIMITED';
  end if;
  insert into public.direct_threads (user_a, user_b) values (least(v_uid, p_to), greatest(v_uid, p_to)) on conflict (user_a, user_b) do nothing;
  v_thread := (select t.id from public.direct_threads t where t.user_a = least(v_uid, p_to) and t.user_b = greatest(v_uid, p_to));
  v_prev := (select t.last_message_at from public.direct_threads t where t.id = v_thread);
  v_read := (select case when t.user_a = p_to then t.a_read_at else t.b_read_at end from public.direct_threads t where t.id = v_thread);
  m.id := gen_random_uuid();
  insert into public.direct_messages (id, thread_id, sender_id, body) values (m.id, v_thread, v_uid, v_body);
  update public.direct_threads set last_message_at = now(),
         a_read_at = case when user_a = v_uid then now() else a_read_at end,
         b_read_at = case when user_b = v_uid then now() else b_read_at end
   where id = v_thread;
  -- Báo người nhận: một thông báo cho mỗi lượt tin chưa đọc (không dồn dập từng tin)
  if v_prev is null or v_read >= v_prev or v_prev < now() - interval '10 minutes' then
    perform private.notify(p_to, null, 'DM', private.display_name(v_uid) || ' nhắn tin cho bạn', left(v_body, 140),
      '/messages/' || v_uid, v_uid, true);
  end if;
  return private.dm_json((select x from public.direct_messages x where x.id = m.id), v_uid);
end $$;

-- Mở cuộc trò chuyện với một runner: tin nhắn (cũ → mới), đánh dấu đã đọc
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
                         where x.thread_id = t.id and x.created_at < coalesce(p_before, now() + interval '1 day')) r
                  join public.direct_messages m on m.id = r.id
                 where r.rn <= 60), '[]'::jsonb));
end $$;

-- Hộp thư: các cuộc trò chuyện, tin cuối, số tin chưa đọc
create or replace function public.direct_inbox() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
            'user', jsonb_build_object('id', pr.id, 'display_name', pr.display_name, 'avatar_url', pr.avatar_url),
            'last_message_at', t.last_message_at,
            'last', (select private.dm_json(m, v_uid) from (select x.id, row_number() over (order by x.created_at desc) as rn
                                                             from public.direct_messages x where x.thread_id = t.id) r
                       join public.direct_messages m on m.id = r.id where r.rn = 1),
            'unread', (select count(*) from public.direct_messages m where m.thread_id = t.id and m.sender_id <> v_uid and m.deleted_at is null
                         and m.created_at > coalesce(case when t.user_a = v_uid then t.a_read_at else t.b_read_at end, '-infinity'::timestamptz)))
          order by t.last_message_at desc nulls last)
    from public.direct_threads t
    join public.profiles pr on pr.id = case when t.user_a = v_uid then t.user_b else t.user_a end
   where (t.user_a = v_uid or t.user_b = v_uid) and t.last_message_at is not null
     and not exists (select 1 from public.user_blocks b where b.blocker = v_uid and b.blocked = pr.id)), '[]'::jsonb);
end $$;

create or replace function public.direct_unread_count() returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.direct_messages m join public.direct_threads t on t.id = m.thread_id
   where (t.user_a = auth.uid() or t.user_b = auth.uid()) and m.sender_id <> auth.uid() and m.deleted_at is null
     and m.created_at > coalesce(case when t.user_a = auth.uid() then t.a_read_at else t.b_read_at end, '-infinity'::timestamptz)
     and not exists (select 1 from public.user_blocks b where b.blocker = auth.uid() and b.blocked = m.sender_id)
$$;

-- Thu hồi tin nhắn của mình
create or replace function public.delete_direct_message(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.direct_messages := (select x from public.direct_messages x where x.id = p_id);
begin
  if m.id is null then raise exception 'NOT_FOUND'; end if;
  if m.sender_id is distinct from private.require_uid() then raise exception 'NOT_AUTHOR'; end if;
  update public.direct_messages set deleted_at = coalesce(deleted_at, now()) where id = p_id;
end $$;

revoke all on function private.is_following(uuid, uuid), private.can_dm(uuid, uuid), private.dm_json(public.direct_messages, uuid) from public, anon, authenticated;
revoke all on function public.edit_post_comment(uuid, text), public.edit_org_post_comment(uuid, text), public.follow_runner(uuid),
  public.unfollow_runner(uuid), public.follow_status(uuid), public.follow_list(uuid, text), public.following_feed(timestamptz, integer),
  public.follow_suggestions(), public.send_direct_message(uuid, text), public.direct_thread(uuid, timestamptz), public.direct_inbox(),
  public.direct_unread_count(), public.delete_direct_message(uuid) from public, anon;
grant execute on function public.edit_post_comment(uuid, text), public.edit_org_post_comment(uuid, text), public.follow_runner(uuid),
  public.unfollow_runner(uuid), public.follow_status(uuid), public.follow_list(uuid, text), public.following_feed(timestamptz, integer),
  public.follow_suggestions(), public.send_direct_message(uuid, text), public.direct_thread(uuid, timestamptz), public.direct_inbox(),
  public.direct_unread_count(), public.delete_direct_message(uuid) to authenticated;

commit;
