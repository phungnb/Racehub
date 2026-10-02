-- RaceHub — PHẦN 18/21 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 011500, 011600, 011700
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

-- ===================================================================
-- 20261001011600_victory_studio.sql
-- ===================================================================
-- 011600: RACEHUB VICTORY STUDIO — ẢNH VINH DANH (giai đoạn 1)
--   • Nguồn thành tích của runner: thử thách · bài chạy đạt mốc (5K, 10K, Half, Marathon, kỷ lục cá nhân) · cột mốc tổng km ·
--     Level · huy hiệu. Số liệu do MÁY CHỦ điền từ dữ liệu đã xác nhận — runner chỉ đổi mẫu, màu, ảnh, lời chúc.
--   • Vinh danh theo thử thách linh hoạt: runner chọn thông số muốn hiện (kết quả, km, thời gian, buổi, hạng…);
--     BTC / ban quản trị CLB / admin vinh danh bất kỳ người tham gia nào với danh hiệu tự đặt ("Runner bền bỉ nhất"…),
--     không cần cấu hình hạng mục trước. Hạng mục vinh danh đã công bố (004900) tự hiện trên ảnh của người được vinh danh.
--   • Mã xác thực 8 ký tự + QR → trang công khai /v/<mã> để ai cũng kiểm tra được thành tích.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create table if not exists public.victory_certificates (
  code text primary key check (code ~ '^[A-Z0-9]{8}$'),
  user_id uuid not null references public.profiles(id) on delete cascade,
  issued_by uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('CHALLENGE', 'RUN', 'TOTAL_KM', 'LEVEL', 'BADGE')),
  ref text not null check (char_length(ref) between 1 and 64),
  award text check (award is null or char_length(award) between 1 and 60),
  facts jsonb not null,
  design jsonb,
  exports integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_export_at timestamptz,
  revoked_at timestamptz
);
create unique index if not exists victory_certificates_uidx on public.victory_certificates (user_id, kind, ref, (coalesce(award, '')));
create index if not exists victory_certificates_issuer_idx on public.victory_certificates (issued_by, created_at desc);
alter table public.victory_certificates enable row level security;
revoke all on public.victory_certificates from anon, authenticated;

-- ---------------------------------------------------------------------
-- Định dạng số (kiểu Việt Nam: dấu phẩy thập phân)
-- ---------------------------------------------------------------------
create or replace function private.vic_num(p numeric, p_digits integer default 2) returns text
language sql immutable as $$
  select replace(trim_scale(round(coalesce(p, 0), p_digits))::text, '.', ',')
$$;
create or replace function private.vic_km(p_meters numeric) returns text
language sql immutable as $$
  select replace(to_char(round(coalesce(p_meters, 0) / 1000.0, 2), 'FM999999990.00'), '.', ',') || ' km'
$$;
create or replace function private.vic_dur(p_seconds numeric) returns text
language sql immutable as $$
  select case when coalesce(p_seconds, 0) >= 3600
              then floor(p_seconds / 3600)::int || ':' || lpad((floor(p_seconds / 60)::int % 60)::text, 2, '0') || ':' || lpad((round(p_seconds)::int % 60)::text, 2, '0')
              else floor(coalesce(p_seconds, 0) / 60)::int || ':' || lpad((round(coalesce(p_seconds, 0))::int % 60)::text, 2, '0') end
$$;
create or replace function private.vic_stat(p_key text, p_label text, p_value text) returns jsonb
language sql immutable as $$
  select case when p_value is null or p_value = '' then null else jsonb_build_object('key', p_key, 'label', p_label, 'value', p_value) end
$$;
create or replace function private.vic_date(p timestamptz) returns text
language sql immutable as $$
  select to_char(p at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY')
$$;

-- Kết quả thử thách theo mục tiêu
create or replace function private.vic_score(p_objective text, p_value numeric) returns text
language sql immutable as $$
  select case coalesce(p_objective, 'DISTANCE')
    when 'DISTANCE' then private.vic_num(p_value, 2) || ' km'
    when 'RUNS' then round(coalesce(p_value, 0))::text || ' buổi'
    when 'DURATION' then private.vic_dur(coalesce(p_value, 0) * 60)
    when 'STREAK_DAYS' then round(coalesce(p_value, 0))::text || ' ngày'
    else round(coalesce(p_value, 0))::text || ' hạng mục' end
$$;

-- Ai được vinh danh người khác trong một thử thách: người tạo, ban quản trị CLB của thử thách, admin hệ thống
-- (nhận text, so sánh id::text để không phải ép kiểu khi mã không phải uuid)
create or replace function private.victory_can_manage(p_kind text, p_ref text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_kind = 'CHALLENGE' and exists (select 1 from public.challenges c
                  where c.id::text = lower(p_ref)
                    and (c.created_by = auth.uid() or public.is_system_admin()
                         or (c.target_club_id is not null and public.club_is_staff(c.target_club_id))))
$$;

-- ---------------------------------------------------------------------
-- Số liệu chính thức của một thành tích (máy chủ tính, không nhận từ người dùng)
-- ---------------------------------------------------------------------
create or replace function private.victory_facts(p_uid uuid, p_kind text, p_ref text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c public.challenges;
  p public.challenge_participants;
  a public.activities;
  v_ended boolean;
  v_total integer;
  v_rank integer;
  v_state text;
  v_club text;
  v_dist numeric;
  v_km numeric;
  v_mile text;
  v_mile_km numeric;
  v_pace numeric;
  v_pr boolean;
  v_target numeric;
  v_runs integer;
  v_first timestamptz;
  v_reached timestamptz;
  v_level integer;
  v_xp integer;
  v_title text;
  v_desc text;
  v_icon text;
  v_tier text;
  v_at timestamptz;
begin
  if p_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_kind = 'CHALLENGE' then
    if p_ref !~ '^[0-9a-f-]{36}$' then raise exception 'NOT_FOUND'; end if;
    c := (select x from public.challenges x where x.id = p_ref::uuid);
    if c.id is null or c.status = 'CANCELLED' then raise exception 'NOT_FOUND'; end if;
    p := (select x from public.challenge_participants x where x.challenge_id = c.id and x.profile_id = p_uid and x.status <> 'LEFT');
    if p.id is null then raise exception 'NOT_PARTICIPANT'; end if;
    if coalesce(p.current_progress, 0) <= 0 and p.completed_at is null then raise exception 'NO_RESULT'; end if;
    v_ended := c.status = 'FINISHED' or c.end_date < now();
    v_total := (select count(*) from public.challenge_participants x where x.challenge_id = c.id and x.status <> 'LEFT');
    v_rank := coalesce(p.final_rank, 1 + (select count(*) from public.challenge_participants x
                                           where x.challenge_id = c.id and x.status <> 'LEFT' and x.current_progress > p.current_progress))::int;
    v_state := case when p.completed_at is not null then 'COMPLETED' when v_ended then 'FINISHED' else 'IN_PROGRESS' end;
    v_club := (select cl.name from public.clubs cl where cl.id = c.target_club_id);
    v_target := coalesce(nullif(c.target_value, 0), nullif(c.target_km, 0));
    return jsonb_build_object(
      'kind', 'CHALLENGE', 'ref', c.id, 'state', v_state,
      'headline', case v_state when 'COMPLETED' then 'Hoàn thành thử thách' when 'FINISHED' then 'Về đích thử thách' else 'Đang chinh phục' end,
      'title', c.title,
      'subtitle', case when v_ended then 'Kết thúc ' || private.vic_date(c.end_date) else 'Đến ' || private.vic_date(c.end_date) end,
      'date', private.vic_date(coalesce(p.completed_at, case when v_ended then c.end_date end, now())),
      'club', v_club,
      'link', '/challenges/' || c.id,
      'stats', coalesce((select jsonb_agg(s order by o) from (values
          (1, private.vic_stat('score', 'Kết quả', private.vic_score(c.objective, p.current_progress))),
          (2, case when v_total > 1 then private.vic_stat('rank', case when v_ended then 'Thứ hạng' else 'Hạng tạm tính' end, v_rank || '/' || v_total) end),
          (3, case when coalesce(p.distance_m, 0) > 0 and coalesce(c.objective, 'DISTANCE') <> 'DISTANCE' then private.vic_stat('km', 'Quãng đường', private.vic_km(p.distance_m)) end),
          (4, case when coalesce(p.moving_s, 0) > 0 then private.vic_stat('time', 'Thời gian', private.vic_dur(p.moving_s)) end),
          (5, case when coalesce(p.run_count, 0) > 0 and coalesce(c.objective, 'DISTANCE') <> 'RUNS' then private.vic_stat('runs', 'Buổi chạy', p.run_count::text) end),
          (6, case when coalesce(p.streak_days, 0) > 0 and coalesce(c.objective, 'DISTANCE') <> 'STREAK_DAYS' then private.vic_stat('days', 'Ngày chạy', p.streak_days::text) end),
          (7, case when coalesce(p.distance_m, 0) >= 1000 and coalesce(p.moving_s, 0) > 0
                   then private.vic_stat('pace', 'Pace TB', private.pace_text(p.moving_s / (p.distance_m / 1000.0)) || '/km') end),
          (8, case when v_target is not null and coalesce(c.objective, 'DISTANCE') in ('DISTANCE', 'RUNS', 'DURATION', 'STREAK_DAYS')
                   then private.vic_stat('goal', 'Mục tiêu', private.vic_score(c.objective, v_target)) end),
          (9, case when p.completed_at is not null then private.vic_stat('done', 'Hoàn thành', private.vic_date(p.completed_at)) end)
        ) t(o, s) where s is not null), '[]'::jsonb),
      -- Hạng mục vinh danh BTC đã công bố
      'honors', coalesce((select jsonb_agg(coalesce((select cat->>'title' from jsonb_array_elements(h.categories) cat where cat->>'key' = ho.category),
                                                     ho.category) || case when ho.category like 'CUSTOM%' then '' else ' · Hạng ' || ho.rank end
                                            order by ho.category, ho.rank)
                           from public.challenge_honorees ho join public.challenge_honors h on h.challenge_id = ho.challenge_id and h.status = 'PUBLISHED'
                          where ho.challenge_id = c.id and ho.user_id = p_uid), '[]'::jsonb));

  elsif p_kind = 'RUN' then
    if p_ref !~ '^[0-9a-f-]{36}$' then raise exception 'NOT_FOUND'; end if;
    a := (select x from public.activities x where x.id = p_ref::uuid and x.user_id = p_uid);
    if a.id is null or not public.activity_is_countable(a.status, a.validation_status) then raise exception 'NOT_FOUND'; end if;
    v_dist := coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0);
    v_km := v_dist / 1000.0;
    if v_km < 1 or coalesce(a.moving_time_s, 0) <= 0 then raise exception 'NOT_ELIGIBLE'; end if;
    v_mile := case when v_km >= 42.195 then 'Marathon' when v_km >= 21.0975 then 'Half Marathon' when v_km >= 10 then '10K' when v_km >= 5 then '5K' end;
    v_mile_km := case when v_km >= 42.195 then 42.195 when v_km >= 21.0975 then 21.0975 when v_km >= 10 then 10 when v_km >= 5 then 5 end;
    v_pace := a.moving_time_s / v_km;
    -- Kỷ lục cá nhân: pace nhanh nhất trong các bài cùng mốc trở lên
    v_pr := v_mile is not null and not exists (
      select 1 from public.activities b
       where b.user_id = p_uid and b.id <> a.id and public.activity_is_countable(b.status, b.validation_status)
         and coalesce(nullif(b.moving_distance_m, 0), b.distance_m, 0) >= v_mile_km * 1000 and coalesce(b.moving_time_s, 0) > 0
         and b.moving_time_s / (coalesce(nullif(b.moving_distance_m, 0), b.distance_m) / 1000.0) < v_pace);
    return jsonb_build_object(
      'kind', 'RUN', 'ref', a.id, 'state', case when v_pr then 'PR' else 'DONE' end,
      'headline', case when v_pr then 'Kỷ lục cá nhân' when v_mile is not null then 'Chinh phục ' || v_mile else 'Hoàn thành bài chạy' end,
      'title', coalesce(v_mile, private.vic_km(v_dist)),
      'subtitle', coalesce(nullif(trim(a.title), ''), 'Chạy bộ'),
      'date', private.vic_date(a.started_at),
      'club', null, 'link', '/activities/' || a.id,
      'stats', coalesce((select jsonb_agg(s order by o) from (values
          (1, private.vic_stat('km', 'Quãng đường', private.vic_km(v_dist))),
          (2, private.vic_stat('time', 'Thời gian', private.vic_dur(a.moving_time_s))),
          (3, private.vic_stat('pace', 'Pace', private.pace_text(v_pace) || '/km')),
          (4, case when coalesce(a.elevation_gain_m, 0) >= 1 then private.vic_stat('elev', 'Leo cao', round(a.elevation_gain_m)::text || ' m') end)
        ) t(o, s) where s is not null), '[]'::jsonb),
      'honors', '[]'::jsonb);

  elsif p_kind = 'TOTAL_KM' then
    if p_ref not in ('50', '100', '200', '300', '500', '1000', '2000', '3000', '5000', '10000') then raise exception 'NOT_FOUND'; end if;
    v_dist := (select coalesce(sum(coalesce(nullif(x.moving_distance_m, 0), x.distance_m, 0)), 0) from public.activities x
                where x.user_id = p_uid and public.activity_is_countable(x.status, x.validation_status));
    if v_dist < p_ref::numeric * 1000 then raise exception 'NOT_ELIGIBLE'; end if;
    v_runs := (select count(*) from public.activities x where x.user_id = p_uid and public.activity_is_countable(x.status, x.validation_status));
    v_first := (select min(x.started_at) from public.activities x where x.user_id = p_uid and public.activity_is_countable(x.status, x.validation_status));
    v_reached := (select min(t.started_at) from (
                    select x.started_at, sum(coalesce(nullif(x.moving_distance_m, 0), x.distance_m, 0)) over (order by x.started_at, x.id) as cum
                      from public.activities x where x.user_id = p_uid and public.activity_is_countable(x.status, x.validation_status)) t
                   where t.cum >= p_ref::numeric * 1000);
    return jsonb_build_object(
      'kind', 'TOTAL_KM', 'ref', p_ref, 'state', 'DONE',
      'headline', 'Cột mốc hành trình', 'title', p_ref || ' KM', 'subtitle', 'Tổng quãng đường chạy trên RaceHub',
      'date', private.vic_date(coalesce(v_reached, now())), 'club', null, 'link', '/me',
      'stats', coalesce((select jsonb_agg(s order by o) from (values
          (1, private.vic_stat('km', 'Tổng quãng đường', private.vic_km(v_dist))),
          (2, private.vic_stat('runs', 'Buổi chạy', v_runs::text)),
          (3, private.vic_stat('since', 'Từ ngày', private.vic_date(v_first)))
        ) t(o, s) where s is not null), '[]'::jsonb),
      'honors', '[]'::jsonb);

  elsif p_kind = 'LEVEL' then
    if p_ref !~ '^[0-9]{1,2}$' then raise exception 'NOT_FOUND'; end if;
    v_level := (select coalesce(x.level, 1) from public.profiles x where x.id = p_uid);
    v_xp := (select coalesce(x.xp, 0) from public.profiles x where x.id = p_uid);
    if p_ref::int < 2 or p_ref::int > coalesce(v_level, 1) then raise exception 'NOT_ELIGIBLE'; end if;
    return jsonb_build_object(
      'kind', 'LEVEL', 'ref', p_ref, 'state', 'DONE',
      'headline', 'Lên cấp', 'title', 'Level ' || p_ref, 'subtitle', private.level_name(p_ref::int),
      'date', private.vic_date(now()), 'club', null, 'link', '/me',
      'stats', jsonb_build_array(
          private.vic_stat('level', 'Cấp độ', p_ref),
          private.vic_stat('title', 'Danh hiệu', private.level_name(p_ref::int)),
          private.vic_stat('xp', 'Tổng XP', v_xp::text)),
      'honors', '[]'::jsonb);

  elsif p_kind = 'BADGE' then
    v_title := (select x.title from public.achievements x join public.user_achievements u on u.achievement_id = x.id
                 where x.code = p_ref and u.user_id = p_uid);
    if v_title is null then raise exception 'NOT_FOUND'; end if;
    v_desc := (select x.description from public.achievements x where x.code = p_ref);
    v_icon := (select x.icon from public.achievements x where x.code = p_ref);
    v_tier := (select x.tier from public.achievements x where x.code = p_ref);
    v_at := (select min(u.unlocked_at) from public.achievements x join public.user_achievements u on u.achievement_id = x.id
              where x.code = p_ref and u.user_id = p_uid);
    return jsonb_build_object(
      'kind', 'BADGE', 'ref', p_ref, 'state', 'DONE', 'icon', v_icon,
      'headline', 'Huy hiệu mới', 'title', v_title, 'subtitle', v_desc,
      'date', private.vic_date(v_at), 'club', null, 'link', '/me?tab=badges',
      'stats', coalesce((select jsonb_agg(s order by o) from (values
          (1, private.vic_stat('badge', 'Huy hiệu', v_title)),
          (2, private.vic_stat('tier', 'Hạng', case lower(coalesce(v_tier, '')) when 'bronze' then 'Đồng' when 'silver' then 'Bạc'
                                                   when 'gold' then 'Vàng' when 'platinum' then 'Bạch kim' when 'diamond' then 'Kim cương' else v_tier end)),
          (3, private.vic_stat('at', 'Mở khóa', private.vic_date(v_at)))
        ) t(o, s) where s is not null), '[]'::jsonb),
      'honors', '[]'::jsonb);
  end if;
  raise exception 'NOT_FOUND';
end $$;

create or replace function private.victory_person(p_uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url, 'level', coalesce(p.level, 1))
    from public.profiles p where p.id = p_uid
$$;

-- ---------------------------------------------------------------------
-- Thành tích tạo được ảnh (màn chọn đầu tiên của Victory Studio)
-- ---------------------------------------------------------------------
create or replace function public.victory_sources() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_total numeric := (select coalesce(sum(coalesce(nullif(x.moving_distance_m, 0), x.distance_m, 0)), 0) from public.activities x
                       where x.user_id = v_uid and public.activity_is_countable(x.status, x.validation_status));
begin
  return jsonb_build_object(
    'challenges', coalesce((select jsonb_agg(jsonb_build_object('ref', t.id, 'title', t.title, 'state', t.state, 'date', private.vic_date(t.at),
                             'subtitle', t.sub) order by t.at desc)
      from (select c.id, c.title, coalesce(p.completed_at, least(c.end_date, now())) as at,
                   case when p.completed_at is not null then 'COMPLETED' when c.status = 'FINISHED' or c.end_date < now() then 'FINISHED' else 'IN_PROGRESS' end as state,
                   private.vic_score(c.objective, p.current_progress) as sub,
                   row_number() over (order by coalesce(p.completed_at, least(c.end_date, now())) desc) as rn
              from public.challenge_participants p join public.challenges c on c.id = p.challenge_id
             where p.profile_id = v_uid and p.status <> 'LEFT' and c.status <> 'CANCELLED'
               and (coalesce(p.current_progress, 0) > 0 or p.completed_at is not null)) t where t.rn <= 30), '[]'::jsonb),
    'runs', coalesce((select jsonb_agg(jsonb_build_object('ref', t.id, 'title', t.mile, 'subtitle', t.title || ' · ' || private.vic_km(t.dist),
                        'date', private.vic_date(t.started_at)) order by t.started_at desc)
      from (select a.id, coalesce(nullif(trim(a.title), ''), 'Chạy bộ') as title, a.started_at, coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0) as dist,
                   case when coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0) >= 42195 then 'Marathon'
                        when coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0) >= 21097.5 then 'Half Marathon'
                        when coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0) >= 10000 then '10K' else '5K' end as mile,
                   row_number() over (order by a.started_at desc) as rn
              from public.activities a
             where a.user_id = v_uid and public.activity_is_countable(a.status, a.validation_status)
               and coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0) >= 5000 and coalesce(a.moving_time_s, 0) > 0
               and a.started_at > now() - interval '400 days') t where t.rn <= 20), '[]'::jsonb),
    'totals', coalesce((select jsonb_agg(jsonb_build_object('ref', m::text, 'title', m || ' KM') order by m desc)
      from unnest(array[50, 100, 200, 300, 500, 1000, 2000, 3000, 5000, 10000]) m where m * 1000 <= v_total), '[]'::jsonb),
    'total_km', round(v_total / 1000.0, 1),
    'levels', coalesce((select jsonb_agg(jsonb_build_object('ref', l::text, 'title', 'Level ' || l, 'subtitle', private.level_name(l)) order by l desc)
      from generate_series(2, (select coalesce(x.level, 1) from public.profiles x where x.id = v_uid)) l), '[]'::jsonb),
    'badges', coalesce((select jsonb_agg(jsonb_build_object('ref', t.code, 'title', t.title, 'icon', t.icon, 'date', private.vic_date(t.unlocked_at))
                          order by t.unlocked_at desc)
      from (select x.code, x.title, x.icon, u.unlocked_at, row_number() over (order by u.unlocked_at desc) as rn
              from public.user_achievements u join public.achievements x on x.id = u.achievement_id where u.user_id = v_uid) t
     where t.rn <= 30), '[]'::jsonb),
    -- Thử thách mình quản lý → vinh danh người khác
    'managed', coalesce((select jsonb_agg(jsonb_build_object('ref', t.id, 'title', t.title, 'date', private.vic_date(t.end_date),
                           'participants', t.n) order by t.end_date desc)
      from (select c.id, c.title, c.end_date,
                   (select count(*) from public.challenge_participants x where x.challenge_id = c.id and x.status <> 'LEFT') as n,
                   row_number() over (order by c.end_date desc) as rn
              from public.challenges c
             where c.status <> 'CANCELLED' and c.start_date < now()
               and (c.created_by = v_uid or (c.target_club_id is not null and public.club_is_staff(c.target_club_id)))) t
     where t.rn <= 30), '[]'::jsonb));
end $$;

-- Xem trước số liệu (chưa cấp mã). p_user: vinh danh người khác (chỉ thử thách, chỉ người quản lý thử thách)
create or replace function public.victory_facts(p_kind text, p_ref text, p_user uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); v_target uuid := coalesce(p_user, v_uid);
begin
  if v_target <> v_uid and not private.victory_can_manage(p_kind, p_ref) then
    raise exception 'FORBIDDEN';
  end if;
  return private.victory_facts(v_target, p_kind, p_ref)
      || jsonb_build_object('person', private.victory_person(v_target), 'can_award', private.victory_can_manage(p_kind, p_ref));
end $$;

-- Cấp (hoặc làm mới) mã xác thực cho ảnh chính thức
create or replace function public.issue_victory(p_kind text, p_ref text, p_user uuid default null, p_award text default null, p_design jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_target uuid := coalesce(p_user, v_uid);
  v_award text := nullif(left(trim(coalesce(p_award, '')), 60), '');
  v_manage boolean := private.victory_can_manage(p_kind, p_ref);
  v_facts jsonb;
  v_code text;
  v_new boolean;
begin
  if v_target <> v_uid and not v_manage then raise exception 'FORBIDDEN'; end if;
  if v_award is not null and not v_manage then raise exception 'FORBIDDEN'; end if;
  if (select count(*) from public.victory_certificates x where x.issued_by = v_uid and x.updated_at > now() - interval '1 day') >= 300 then
    raise exception 'RATE_LIMITED';
  end if;
  v_facts := private.victory_facts(v_target, p_kind, p_ref);
  v_code := (select x.code from public.victory_certificates x
              where x.user_id = v_target and x.kind = p_kind and x.ref = p_ref and coalesce(x.award, '') = coalesce(v_award, ''));
  v_new := v_code is null;
  if v_new then
    v_code := upper(substr(md5(gen_random_uuid()::text), 1, 8));
    while exists (select 1 from public.victory_certificates x where x.code = v_code) loop
      v_code := upper(substr(md5(gen_random_uuid()::text), 1, 8));
    end loop;
    insert into public.victory_certificates (code, user_id, issued_by, kind, ref, award, facts, design)
    values (v_code, v_target, v_uid, p_kind, p_ref, v_award, v_facts,
            case when p_design is not null and length(p_design::text) <= 4000 then p_design end);
    if v_target <> v_uid then
      perform private.notify(v_target, null, 'VICTORY', coalesce(v_award, v_facts->>'headline') || ' 🏅',
        private.display_name(v_uid) || ' vinh danh bạn trong thử thách ' || coalesce(v_facts->>'title', ''), '/v/' || v_code, v_uid, true);
    end if;
  else
    update public.victory_certificates set facts = v_facts, revoked_at = null, updated_at = now(),
           design = case when p_design is not null and length(p_design::text) <= 4000 then p_design else design end
     where code = v_code;
  end if;
  return jsonb_build_object('code', v_code, 'new', v_new, 'facts', v_facts, 'award', v_award, 'person', private.victory_person(v_target));
end $$;

-- Ghi nhận một lần xuất ảnh (lịch sử + thiết kế đã dùng)
create or replace function public.record_victory_export(p_code text, p_design jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  update public.victory_certificates
     set exports = exports + 1, last_export_at = now(),
         design = case when p_design is not null and length(p_design::text) <= 4000 then p_design else design end
   where code = upper(p_code) and (user_id = v_uid or issued_by = v_uid);
end $$;

-- Trang xác thực công khai: ai có mã / quét QR đều xem được
create or replace function public.verify_victory(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('code', v.code, 'kind', v.kind, 'facts', v.facts, 'award', v.award,
           'person', private.victory_person(v.user_id),
           'issued_by', case when v.issued_by is not null and v.issued_by <> v.user_id then private.display_name(v.issued_by) end,
           'created_at', v.created_at, 'updated_at', v.updated_at)
    from public.victory_certificates v
   where v.code = upper(trim(coalesce(p_code, ''))) and v.revoked_at is null
$$;

-- Ảnh vinh danh của tôi (mình được vinh danh hoặc mình đã vinh danh người khác)
create or replace function public.my_victories() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'kind', t.kind, 'ref', t.ref, 'award', t.award, 'facts', t.facts,
            'person', private.victory_person(t.user_id), 'mine', t.user_id = auth.uid(), 'exports', t.exports, 'created_at', t.created_at)
          order by t.updated_at desc), '[]'::jsonb)
    from (select v.*, row_number() over (order by v.updated_at desc) as rn from public.victory_certificates v
           where (v.user_id = auth.uid() or v.issued_by = auth.uid()) and v.revoked_at is null) t
   where t.rn <= 60
$$;

-- Thu hồi mã (người được vinh danh, người cấp, admin)
create or replace function public.revoke_victory(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  update public.victory_certificates set revoked_at = now()
   where code = upper(p_code) and (user_id = v_uid or issued_by = v_uid or public.is_system_admin());
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

revoke all on function private.vic_num(numeric, integer), private.vic_km(numeric), private.vic_dur(numeric), private.vic_stat(text, text, text),
  private.vic_date(timestamptz), private.vic_score(text, numeric), private.victory_can_manage(text, text), private.victory_facts(uuid, text, text),
  private.victory_person(uuid) from public, anon, authenticated;
revoke all on function public.victory_sources(), public.victory_facts(text, text, uuid), public.issue_victory(text, text, uuid, text, jsonb),
  public.record_victory_export(text, jsonb), public.verify_victory(text), public.my_victories(), public.revoke_victory(text) from public, anon;
grant execute on function public.victory_sources(), public.victory_facts(text, text, uuid), public.issue_victory(text, text, uuid, text, jsonb),
  public.record_victory_export(text, jsonb), public.verify_victory(text), public.my_victories(), public.revoke_victory(text) to authenticated;
grant execute on function public.verify_victory(text) to anon;

-- ===================================================================
-- 20261001011700_feedback_round3.sql
-- ===================================================================
-- 011700: GÓP Ý VÒNG 3
--   1. Thách đấu CLB: sau khi ban quản trị đăng ký CLB, THÀNH VIÊN tự đăng ký tham gia; chỉ người đã đăng ký mới được tính
--      (thách đấu tạo trước file này giữ cách tính cũ — mọi thành viên). BXH chi tiết từng CLB trong giải (ngày chạy, pace, km).
--   2. Tin nhắn 1-1: thả cảm xúc (emoji) cho từng tin.
--   3. Kiến thức: runner soạn bài / ebook chạy bộ → admin duyệt → đăng; bài được đăng tự cộng Xu (mặc định 30 Xu, admin đổi ở
--      Chính sách kinh tế, khóa contentRewardXu). Tác giả xem trước bài của mình khi chưa đăng.
--   4. Quản trị: tìm tài khoản theo email để cấp quyền admin.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

-- ---------------------------------------------------------------------
-- 1. Thách đấu CLB — thành viên đăng ký
-- ---------------------------------------------------------------------
-- Cột mới để trống cho thách đấu cũ (= không cần đăng ký), mặc định bật cho thách đấu tạo từ nay
alter table public.club_cups add column if not exists require_signup boolean;
alter table public.club_cups alter column require_signup set default true;

create table if not exists public.club_cup_members (
  cup_id uuid not null references public.club_cups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (cup_id, user_id)
);
create index if not exists club_cup_members_club_idx on public.club_cup_members (cup_id, club_id);
alter table public.club_cup_members enable row level security;
revoke all on public.club_cup_members from anon, authenticated;

-- Ai đăng ký CLB vào giải (kể cả người tạo giải cho CLB chủ nhà) tự có tên thi đấu cho CLB đó
create or replace function private.cup_entry_autosignup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.registered_by is not null
     and coalesce((select u.require_signup from public.club_cups u where u.id = new.cup_id), false)
     and exists (select 1 from public.club_members m where m.club_id = new.club_id and m.user_id = new.registered_by and m.status = 'APPROVED') then
    insert into public.club_cup_members (cup_id, user_id, club_id) values (new.cup_id, new.registered_by, new.club_id)
    on conflict (cup_id, user_id) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists trg_cup_entry_autosignup on public.club_cup_entries;
create trigger trg_cup_entry_autosignup after insert on public.club_cup_entries
  for each row execute function private.cup_entry_autosignup();

-- Người được tính cho từng CLB: thành viên đã duyệt (+ đã đăng ký nếu giải yêu cầu); người ở nhiều CLB chỉ tính cho CLB vào sớm nhất
create or replace function private.cup_counted(p_cup uuid)
returns table (club_id uuid, user_id uuid, joined_at timestamptz)
language sql stable security definer set search_path = public as $$
  select x.club_id, x.user_id, x.joined_at from (
    select m.club_id, m.user_id, m.joined_at,
           row_number() over (partition by m.user_id order by m.joined_at nulls first, m.club_id) as k
      from public.club_members m
      join public.club_cup_entries ce on ce.club_id = m.club_id and ce.cup_id = p_cup
     where m.status = 'APPROVED'
       and (not coalesce((select u.require_signup from public.club_cups u where u.id = p_cup), false)
            or exists (select 1 from public.club_cup_members cm where cm.cup_id = p_cup and cm.user_id = m.user_id and cm.club_id = m.club_id))) x
   where x.k = 1
$$;

create or replace function private.cup_standings(p_cup uuid, p_start timestamptz, p_end timestamptz, p_metric text) returns jsonb
language sql stable security definer set search_path = public as $$
  with e as (
    select ce.club_id from public.club_cup_entries ce where ce.cup_id = p_cup
  ), m1 as (
    select * from private.cup_counted(p_cup)
  ), runs as (
    select m1.club_id, a.user_id, sum(a.distance_m) as meters
      from public.activities a join m1 on m1.user_id = a.user_id
     where p_end > p_start
       and a.validation_status = 'APPROVED' and coalesce(a.status, '') <> 'DELETED'
       and a.started_at >= p_start and a.started_at < p_end
       and a.started_at >= coalesce(m1.joined_at, '-infinity'::timestamptz)
     group by m1.club_id, a.user_id
  ), agg as (
    select e.club_id,
           (select count(*) from m1 where m1.club_id = e.club_id) as members,
           (select count(*) from runs r where r.club_id = e.club_id) as runners,
           coalesce((select sum(r.meters) from runs r where r.club_id = e.club_id), 0) as meters
      from e
  ), scored as (
    select agg.*, round(agg.meters / 1000.0, 2) as km,
           round(agg.meters / 1000.0 / greatest(agg.members, 1), 2) as avg_km
      from agg
  ), ranked as (
    select s.*, rank() over (order by case when p_metric = 'TOTAL_KM' then s.km else s.avg_km end desc) as rnk from scored s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'rank', r.rnk, 'club_id', c.id, 'name', c.name, 'avatar_url', c.avatar_url, 'accent_color', c.accent_color,
           'members', r.members, 'runners', r.runners, 'km', r.km, 'avg_km', r.avg_km,
           'score', case when p_metric = 'TOTAL_KM' then r.km else r.avg_km end)
         order by r.rnk, c.name), '[]'::jsonb)
    from ranked r join public.clubs c on c.id = r.club_id
$$;

create or replace function private.cup_json(u public.club_cups, p_full boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', u.id, 'title', u.title, 'description', u.description, 'prize', u.prize, 'metric', u.metric,
    'start_at', u.start_at, 'end_at', u.end_at, 'reg_close_at', u.reg_close_at, 'max_clubs', u.max_clubs,
    'status', u.status, 'review_note', u.review_note, 'created_at', u.created_at, 'settled_at', u.settled_at,
    'require_signup', coalesce(u.require_signup, false),
    'host', (select jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url, 'accent_color', c.accent_color)
               from public.clubs c where c.id = u.host_club_id),
    'creator', (select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url)
                  from public.profiles p where p.id = u.created_by),
    'clubs', (select count(*) from public.club_cup_entries ce where ce.cup_id = u.id),
    'my_clubs', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url, 'accent_color', c.accent_color,
                         'staff', m.role in ('OWNER', 'CAPTAIN'),
                         'joined', exists (select 1 from public.club_cup_entries ce where ce.cup_id = u.id and ce.club_id = c.id),
                         'signed_up', exists (select 1 from public.club_cup_members cm where cm.cup_id = u.id and cm.club_id = c.id and cm.user_id = auth.uid()))
                       order by c.name), '[]'::jsonb)
                   from public.club_members m join public.clubs c on c.id = m.club_id
                  where m.user_id = auth.uid() and m.status = 'APPROVED'),
    'my_signup', (select cm.club_id from public.club_cup_members cm where cm.cup_id = u.id and cm.user_id = auth.uid()),
    'can_manage', u.created_by = auth.uid() or public.is_system_admin()
                  or (u.host_club_id is not null and public.club_is_staff(u.host_club_id)),
    'can_review', public.is_system_admin(),
    'standings', case when p_full then coalesce(u.result->'standings',
                   private.cup_standings(u.id, u.start_at, least(u.end_at, greatest(now(), u.start_at)), u.metric)) end)
$$;

-- Ban quản trị đăng ký CLB (như cũ) — thông báo nhắc thành viên tự đăng ký
create or replace function public.join_club_cup(p_cup_id uuid, p_club_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  u public.club_cups := (select x from public.club_cups x where x.id = p_cup_id for update);
  v_club text := (select c.name from public.clubs c where c.id = p_club_id);
begin
  if u.id is null or not private.cup_visible(u) then raise exception 'CUP_NOT_FOUND'; end if;
  if v_club is null then raise exception 'CLUB_NOT_FOUND'; end if;
  if not public.club_is_staff(p_club_id) then raise exception 'CLUB_STAFF_REQUIRED'; end if;
  if u.status <> 'OPEN' then raise exception 'CUP_NOT_OPEN'; end if;
  if now() > u.reg_close_at then raise exception 'REGISTRATION_CLOSED'; end if;
  if exists (select 1 from public.club_cup_entries ce where ce.cup_id = u.id and ce.club_id = p_club_id) then raise exception 'ALREADY_JOINED'; end if;
  if (select count(*) from public.club_cup_entries ce where ce.cup_id = u.id) >= u.max_clubs then raise exception 'CUP_FULL'; end if;
  insert into public.club_cup_entries (cup_id, club_id, registered_by) values (u.id, p_club_id, v_uid);
  perform private.notify_club(p_club_id, false, 'CLUB_CUP', v_club || ' tham gia thách đấu "' || u.title || '"',
    case when coalesce(u.require_signup, false)
         then 'Bấm "Đăng ký thi đấu" trong trang thách đấu để km của bạn được tính cho CLB (từ ' || to_char(u.start_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI') || ').'
         else 'Mọi km hợp lệ từ ' || to_char(u.start_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI') || ' đều tính cho CLB. Chạy thôi!' end,
    '/cups/' || u.id, v_uid);
  if u.created_by is not null and u.created_by <> v_uid then
    perform private.notify(u.created_by, null, 'CLUB_CUP', v_club || ' đã đăng ký "' || u.title || '"', null, '/cups/' || u.id, v_uid, false);
  end if;
  return private.cup_json((select x from public.club_cups x where x.id = u.id), true);
end $$;

-- Thành viên đăng ký thi đấu cho CLB của mình (CLB đã vào giải); mỗi người một CLB trong một giải
create or replace function public.join_cup_as_member(p_cup_id uuid, p_club_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  u public.club_cups := (select x from public.club_cups x where x.id = p_cup_id);
  v_mine uuid;
begin
  if u.id is null or not private.cup_visible(u) then raise exception 'CUP_NOT_FOUND'; end if;
  if u.status <> 'OPEN' or now() >= u.end_at then raise exception 'CUP_NOT_OPEN'; end if;
  if not exists (select 1 from public.club_cup_entries ce where ce.cup_id = u.id and ce.club_id = p_club_id) then raise exception 'CLUB_NOT_IN_CUP'; end if;
  if not exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = v_uid and m.status = 'APPROVED') then
    raise exception 'NOT_A_MEMBER';
  end if;
  v_mine := (select cm.club_id from public.club_cup_members cm where cm.cup_id = u.id and cm.user_id = v_uid);
  if v_mine = p_club_id then return private.cup_json(u, true); end if;
  if v_mine is not null then raise exception 'ALREADY_SIGNED_UP'; end if;
  insert into public.club_cup_members (cup_id, user_id, club_id) values (u.id, v_uid, p_club_id);
  return private.cup_json(u, true);
end $$;

-- Rút đăng ký (chỉ trước giờ bắt đầu)
create or replace function public.leave_cup_as_member(p_cup_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); u public.club_cups := (select x from public.club_cups x where x.id = p_cup_id);
begin
  if u.id is null or not private.cup_visible(u) then raise exception 'CUP_NOT_FOUND'; end if;
  if now() >= u.start_at then raise exception 'CUP_STARTED'; end if;
  delete from public.club_cup_members where cup_id = u.id and user_id = v_uid;
  return private.cup_json(u, true);
end $$;

-- BXH chi tiết một CLB trong giải: từng người được tính — km, số ngày chạy, số buổi, pace TB
create or replace function public.club_cup_club_board(p_cup_id uuid, p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  u public.club_cups := (select x from public.club_cups x where x.id = p_cup_id);
  v_end timestamptz;
begin
  if u.id is null or not private.cup_visible(u) then raise exception 'CUP_NOT_FOUND'; end if;
  if not exists (select 1 from public.club_cup_entries ce where ce.cup_id = u.id and ce.club_id = p_club_id) then raise exception 'CLUB_NOT_IN_CUP'; end if;
  v_end := least(u.end_at, greatest(now(), u.start_at));
  return (select jsonb_build_object(
    'club', (select jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url, 'accent_color', c.accent_color)
               from public.clubs c where c.id = p_club_id),
    'rows', coalesce(jsonb_agg(jsonb_build_object('rank', t.rnk, 'user_id', t.user_id, 'display_name', pr.display_name, 'avatar_url', pr.avatar_url,
              'km', round(t.meters / 1000.0, 2), 'runs', t.runs, 'days', t.days, 'moving_s', t.moving_s,
              'pace_s', case when t.meters > 0 then round(t.moving_s / (t.meters / 1000.0)) end)
            order by t.rnk, pr.display_name), '[]'::jsonb))
    from (select m.user_id,
                 coalesce(sum(a.distance_m), 0) as meters, count(a.id) as runs,
                 count(distinct (a.started_at at time zone 'Asia/Ho_Chi_Minh')::date) as days,
                 coalesce(sum(coalesce(nullif(a.moving_time_s, 0), a.elapsed_time_s)), 0) as moving_s,
                 rank() over (order by coalesce(sum(a.distance_m), 0) desc) as rnk
            from private.cup_counted(u.id) m
            left join public.activities a on a.user_id = m.user_id and a.validation_status = 'APPROVED' and coalesce(a.status, '') <> 'DELETED'
                  and a.started_at >= u.start_at and a.started_at < v_end and a.started_at >= coalesce(m.joined_at, '-infinity'::timestamptz)
           where m.club_id = p_club_id
           group by m.user_id) t
    join public.profiles pr on pr.id = t.user_id);
end $$;

-- ---------------------------------------------------------------------
-- 2. Tin nhắn 1-1: cảm xúc
-- ---------------------------------------------------------------------
create table if not exists public.direct_message_reactions (
  message_id uuid not null references public.direct_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.direct_message_reactions enable row level security;
revoke all on public.direct_message_reactions from anon, authenticated;

create or replace function private.dm_json(m public.direct_messages, p_uid uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', m.id, 'sender_id', m.sender_id, 'mine', m.sender_id = p_uid, 'created_at', m.created_at,
    'deleted', m.deleted_at is not null, 'body', case when m.deleted_at is null then m.body else null end,
    'reactions', coalesce((select jsonb_agg(jsonb_build_object('emoji', r.emoji, 'count', r.n, 'mine', r.mine) order by r.first_at)
                             from (select x.emoji, count(*) as n, bool_or(x.user_id = p_uid) as mine, min(x.created_at) as first_at
                                     from public.direct_message_reactions x where x.message_id = m.id group by x.emoji) r), '[]'::jsonb))
$$;

-- Thả / đổi / bỏ cảm xúc (bấm lại đúng emoji đang chọn = bỏ)
create or replace function public.react_direct_message(p_id uuid, p_emoji text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  m public.direct_messages := (select x from public.direct_messages x where x.id = p_id);
  v_emoji text := nullif(trim(coalesce(p_emoji, '')), '');
begin
  if m.id is null or m.deleted_at is not null
     or not exists (select 1 from public.direct_threads t where t.id = m.thread_id and v_uid in (t.user_a, t.user_b)) then
    raise exception 'NOT_FOUND';
  end if;
  if v_emoji is null or char_length(v_emoji) > 16 then raise exception 'INVALID_EMOJI'; end if;
  if exists (select 1 from public.direct_message_reactions r where r.message_id = m.id and r.user_id = v_uid and r.emoji = v_emoji) then
    delete from public.direct_message_reactions where message_id = m.id and user_id = v_uid;
  else
    insert into public.direct_message_reactions (message_id, user_id, emoji) values (m.id, v_uid, v_emoji)
    on conflict (message_id, user_id) do update set emoji = excluded.emoji, created_at = now();
  end if;
  return private.dm_json(m, v_uid);
end $$;

-- ---------------------------------------------------------------------
-- 3. Kiến thức: runner soạn bài / ebook, admin duyệt, thưởng Xu khi đăng
-- ---------------------------------------------------------------------
alter table public.content_articles add column if not exists attachment_url text;
alter table public.content_articles drop constraint if exists content_articles_attachment_chk;
alter table public.content_articles add constraint content_articles_attachment_chk
  check (attachment_url is null or (attachment_url ~ '^https://' and char_length(attachment_url) <= 500));
alter table public.content_articles drop constraint if exists content_articles_content_type_check;
alter table public.content_articles add constraint content_articles_content_type_check check (content_type in ('ARTICLE', 'NEWS', 'EBOOK'));
alter table public.content_articles add column if not exists reward_xu numeric not null default 0;

-- Ảnh bìa + ebook PDF: mọi runner tải được vào thư mục của mình (≤ 10 MB)
update storage.buckets set file_size_limit = 10485760,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
 where id = 'content-media';
create or replace function public.can_upload_content_media(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (storage.foldername(p_name))[1] = auth.uid()::text
$$;

alter table public.game_events drop constraint if exists game_events_kind_check;
alter table public.game_events add constraint game_events_kind_check
  check (kind in ('RUN', 'QUEST', 'BADGE', 'STREAK', 'LEVEL_UP', 'LEAGUE', 'CHEER_IN', 'CHECKIN', 'REFERRAL', 'GIFT_IN', 'COMEBACK', 'CONTENT'));

-- Hồ sơ tác giả cộng đồng của runner (tạo khi soạn bài đầu tiên)
create or replace function private.community_author(p_uid uuid) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  insert into public.content_authors (user_id, name, kind, avatar_url)
  select p.id, case when char_length(trim(coalesce(p.display_name, ''))) >= 2 then left(trim(p.display_name), 80) else 'Runner RaceHub' end, 'COMMUNITY', p.avatar_url
    from public.profiles p where p.id = p_uid
  on conflict (user_id) do nothing;
  return (select au.id from public.content_authors au where au.user_id = p_uid);
end $$;

-- Soạn / sửa bài của mình (nháp hoặc gửi duyệt). p: {id?, title, summary, body, cover_image_url, category_id,
-- content_type: ARTICLE | EBOOK, attachment_url, submit: boolean}. Bài đã đăng không sửa được (liên hệ ban biên tập).
create or replace function public.knowledge_submit(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  a public.content_articles := (select x from public.content_articles x where x.id::text = nullif(p->>'id', ''));
  v_title text := trim(coalesce(p->>'title', ''));
  v_body text := coalesce(p->>'body', '');
  v_cat text := coalesce(nullif(p->>'category_id', ''), 'BEGINNER');
  v_type text := case when upper(coalesce(p->>'content_type', '')) = 'EBOOK' then 'EBOOK' else 'ARTICLE' end;
  v_att text := nullif(trim(coalesce(p->>'attachment_url', '')), '');
  v_cover text := nullif(trim(coalesce(p->>'cover_image_url', '')), '');
  v_submit boolean := coalesce((p->>'submit')::boolean, false);
  v_status text;
  v_id uuid;
  v_slug text;
begin
  if nullif(p->>'id', '') is not null and (a.id is null or a.created_by is distinct from v_uid) then raise exception 'ARTICLE_NOT_FOUND'; end if;
  if a.id is not null and a.status not in ('DRAFT', 'REVIEW') then raise exception 'ALREADY_PUBLISHED'; end if;
  if char_length(v_title) not between 5 and 140 then raise exception 'TITLE_TOO_SHORT'; end if;
  if not exists (select 1 from public.content_categories c where c.id = v_cat) then raise exception 'INVALID_CATEGORY'; end if;
  if v_att is not null and v_att !~ '^https://' then raise exception 'INVALID_URL'; end if;
  if v_cover is not null and v_cover !~ '^https://' then raise exception 'INVALID_URL'; end if;
  if char_length(v_body) > 60000 then raise exception 'BODY_TOO_LONG'; end if;
  if v_submit and ((v_type = 'ARTICLE' and char_length(trim(v_body)) < 300) or (v_type = 'EBOOK' and (v_att is null or char_length(trim(v_body)) < 50))) then
    raise exception 'BODY_TOO_SHORT';
  end if;
  if a.id is null then
    if (select count(*) from public.content_articles x where x.created_by = v_uid and x.created_at > now() - interval '1 day') >= 10 then
      raise exception 'RATE_LIMITED';
    end if;
    v_id := gen_random_uuid();
    v_slug := trim(both '-' from left(trim(both '-' from regexp_replace(regexp_replace(coalesce(private.slugify(v_title), ''), '[^a-z0-9-]+', '', 'g'), '-{2,}', '-', 'g')), 80));
    insert into public.content_articles (id, slug, title, summary, body, cover_image_url, category_id, author_id, content_type,
      reading_time_minutes, needs_expert_review, attachment_url, created_by, status)
    values (v_id, coalesce(nullif(v_slug, ''), 'bai-viet') || '-' || substr(md5(v_id::text), 1, 5),
      v_title, nullif(left(trim(coalesce(p->>'summary', '')), 300), ''), v_body, v_cover, v_cat, private.community_author(v_uid), v_type,
      private.reading_minutes(v_body), (select c.needs_expert from public.content_categories c where c.id = v_cat), v_att, v_uid,
      case when v_submit then 'REVIEW' else 'DRAFT' end);
  else
    v_id := a.id;
    update public.content_articles set title = v_title, summary = nullif(left(trim(coalesce(p->>'summary', '')), 300), ''), body = v_body,
      cover_image_url = v_cover, category_id = v_cat, content_type = v_type, attachment_url = v_att,
      reading_time_minutes = private.reading_minutes(v_body),
      needs_expert_review = (select c.needs_expert from public.content_categories c where c.id = v_cat),
      status = case when v_submit then 'REVIEW' else 'DRAFT' end, updated_at = now()
     where id = v_id;
  end if;
  v_status := (select x.status from public.content_articles x where x.id = v_id);
  -- Báo admin khi có bài chờ duyệt (lần gửi đầu)
  if v_submit and (a.id is null or a.status <> 'REVIEW') then
    perform private.notify(pr.id, null, 'CONTENT', 'Bài viết cộng đồng chờ duyệt', '"' || v_title || '" — ' || private.display_name(v_uid), '/learn/studio', v_uid, false)
       from public.profiles pr where pr.role = 'SYSTEM_ADMIN' or pr.is_admin is true;
  end if;
  return jsonb_build_object('id', v_id, 'status', v_status);
end $$;

-- Bài tôi đã soạn (mọi trạng thái)
create or replace function public.knowledge_my_submissions() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'slug', a.slug, 'title', a.title, 'summary', a.summary, 'body', a.body,
            'category_id', a.category_id, 'content_type', a.content_type, 'cover_image_url', a.cover_image_url, 'attachment_url', a.attachment_url,
            'status', a.status, 'review_note', a.review_note, 'reward_xu', a.reward_xu, 'published_at', a.published_at, 'updated_at', a.updated_at)
          order by a.updated_at desc), '[]'::jsonb)
    from public.content_articles a where a.created_by = auth.uid()
$$;

-- Xóa bài nháp / đang chờ duyệt của mình
create or replace function public.knowledge_delete_submission(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.content_articles where id = p_id and created_by = private.require_uid() and status in ('DRAFT', 'REVIEW');
  if not found then raise exception 'ARTICLE_NOT_FOUND'; end if;
end $$;

-- Danh mục cho người soạn bài
create or replace function public.knowledge_categories() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'needs_expert', c.needs_expert) order by c.sort), '[]'::jsonb)
    from public.content_categories c
$$;

-- Bài của runner (không phải ban nội dung) được đăng lần đầu → cộng Xu cho tác giả
create or replace function private.content_reward_on_publish() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_xu numeric := coalesce((private.economy_config()->>'contentRewardXu')::numeric, 30);
begin
  if new.status = 'PUBLISHED' and old.status is distinct from 'PUBLISHED' and new.created_by is not null
     and private.content_role(new.created_by) is null and new.reward_xu = 0 and v_xu > 0 then
    if private.award(new.created_by, 'CONTENT', 'Bài viết được đăng', left(new.title, 160), v_xu, 0, 'content:' || new.id::text, null,
                     jsonb_build_object('article_id', new.id, 'slug', new.slug)) then
      update public.content_articles set reward_xu = v_xu where id = new.id;
      perform private.notify(new.created_by, null, 'CONTENT', 'Bài viết của bạn đã được đăng · +' || v_xu || ' Xu 🎉', new.title,
        '/learn/' || new.slug, null, true);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_content_reward on public.content_articles;
create trigger trg_content_reward after update of status on public.content_articles
  for each row execute function private.content_reward_on_publish();

-- Ban biên tập sửa bài ebook trong trình soạn CMS (chưa có lựa chọn Ebook) → giữ nguyên loại Ebook
create or replace function private.content_keep_ebook() returns trigger
language plpgsql as $$
begin
  if old.content_type = 'EBOOK' and new.content_type = 'ARTICLE' then new.content_type := 'EBOOK'; end if;
  return new;
end $$;
drop trigger if exists trg_content_keep_ebook on public.content_articles;
create trigger trg_content_keep_ebook before update of content_type on public.content_articles
  for each row execute function private.content_keep_ebook();

-- Người viết xem trước bài của mình khi chưa đăng; thêm tệp ebook + cờ bài cộng đồng
create or replace function public.knowledge_article(p_slug text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  a public.content_articles := (select x from public.content_articles x where x.slug = p_slug);
  v_live boolean;
  v_role text := private.content_role(v_uid);
begin
  if a.id is null then raise exception 'ARTICLE_NOT_FOUND'; end if;
  v_live := private.content_live(a);
  if not v_live and v_role is null and a.created_by is distinct from v_uid then raise exception 'ARTICLE_NOT_FOUND'; end if;
  if v_live then
    insert into public.content_read_history (user_id, article_id) values (v_uid, a.id)
    on conflict (user_id, article_id) do update set last_at = now();
    insert into public.content_user_events (user_id, article_id, kind, day)
    values (v_uid, a.id, 'VIEW', (now() at time zone 'Asia/Ho_Chi_Minh')::date) on conflict do nothing;
    if found then perform private.content_bump(a.id, 'VIEW'); end if;
  end if;
  return private.content_card(a, v_uid) || jsonb_build_object(
    'body', a.body, 'preview', not v_live, 'status', a.status, 'updated_at', a.updated_at, 'source_url', a.source_url,
    'attachment_url', a.attachment_url, 'community', a.created_by is not null and private.content_role(a.created_by) is null,
    'ctas', a.ctas, 'needs_expert_review', a.needs_expert_review, 'expert_reviewed_at', a.expert_reviewed_at,
    'expert_name', (select private.display_name(a.expert_reviewed_by)),
    'category', (select jsonb_build_object('id', c.id, 'name', c.name, 'icon', c.icon, 'market_kind', c.market_kind)
                   from public.content_categories c where c.id = a.category_id),
    'author', (select jsonb_build_object('id', au.id, 'name', au.name, 'title', au.title, 'bio', au.bio, 'avatar_url', au.avatar_url,
                 'kind', au.kind, 'verified', au.verified, 'partner_id', au.partner_id)
                 from public.content_authors au where au.id = a.author_id),
    'tags', (select coalesce(jsonb_agg(jsonb_build_object('slug', t.slug, 'name', t.name) order by t.name), '[]'::jsonb)
               from public.content_article_tags at join public.content_tags t on t.id = at.tag_id where at.article_id = a.id),
    'sources', (select coalesce(jsonb_agg(jsonb_build_object('title', s.title, 'url', s.url, 'publisher', s.publisher) order by s.sort), '[]'::jsonb)
                  from public.content_sources s where s.article_id = a.id),
    'my_feedback', (select jsonb_build_object('helpful', r.helpful, 'comment', r.comment) from public.content_reviews r
                     where r.article_id = a.id and r.user_id = v_uid),
    'series', case when a.series_id is not null then (
       select jsonb_build_object('id', s.id, 'title', s.title,
         'items', (select coalesce(jsonb_agg(jsonb_build_object('slug', x.slug, 'title', x.title,
                     'completed', exists (select 1 from public.content_read_history h where h.article_id = x.id and h.user_id = v_uid and h.completed_at is not null))
                     order by x.series_order, x.published_at), '[]'::jsonb)
                   from public.content_articles x where x.series_id = s.id and private.content_live(x)))
         from public.content_series s where s.id = a.series_id) end,
    'related', (select coalesce(jsonb_agg(private.content_card(y.x, v_uid) order by y.rn), '[]'::jsonb) from (
                  select x, row_number() over (order by
                           (select count(*) from public.content_article_tags t1 join public.content_article_tags t2 on t2.tag_id = t1.tag_id
                             where t1.article_id = a.id and t2.article_id = x.id) desc,
                           (x.category_id = a.category_id) desc, x.published_at desc) rn
                    from public.content_articles x where x.id <> a.id and private.content_live(x)) y where y.rn <= 4));
end $$;

-- ---------------------------------------------------------------------
-- 4. Quản trị: tìm tài khoản theo email (để cấp quyền admin)
-- ---------------------------------------------------------------------
create or replace function public.admin_find_user_by_email(p_email text) returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform private.require_admin();
  return (select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url, 'email', u.email,
            'role', p.role, 'last_sign_in_at', u.last_sign_in_at)
            from auth.users u join public.profiles p on p.id = u.id
           where lower(u.email) = lower(trim(coalesce(p_email, ''))));
end $$;

revoke all on function private.cup_counted(uuid), private.cup_entry_autosignup(), private.content_keep_ebook(), private.community_author(uuid), private.content_reward_on_publish() from public, anon, authenticated;
revoke all on function public.join_cup_as_member(uuid, uuid), public.leave_cup_as_member(uuid), public.club_cup_club_board(uuid, uuid),
  public.react_direct_message(uuid, text), public.knowledge_submit(jsonb), public.knowledge_my_submissions(),
  public.knowledge_delete_submission(uuid), public.knowledge_categories(), public.admin_find_user_by_email(text) from public, anon;
grant execute on function public.join_cup_as_member(uuid, uuid), public.leave_cup_as_member(uuid), public.club_cup_club_board(uuid, uuid),
  public.react_direct_message(uuid, text), public.knowledge_submit(jsonb), public.knowledge_my_submissions(),
  public.knowledge_delete_submission(uuid), public.knowledge_categories(), public.admin_find_user_by_email(text) to authenticated;

commit;
