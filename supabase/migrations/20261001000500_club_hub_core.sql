-- =====================================================================
-- 20261001000500 — CLB LÀ MỘT KHÔNG GIAN RIÊNG (Sprint 2, trụ cột ③)
--
-- Bảng tin (club_posts + cảm xúc + bình luận), trò chuyện realtime
-- (club_messages), thông báo trong app (notifications), BXH CLB,
-- hộp thư CLB, bài tự sinh khi thành viên chạy xong / gia nhập.
-- Thiết kế: docs/architecture/adr/012-club-hub.md
--
-- Quy ước quyền: thành viên = club_members.status 'APPROVED';
-- ban quản trị (staff) = vai trò OWNER hoặc CAPTAIN (khớp club_rank()).
-- Mọi thao tác ghi đi qua RPC, trừ gửi tin chat (insert trực tiếp qua RLS
-- để giảm độ trễ, có trigger kiểm tra + giới hạn tốc độ).
-- Idempotent: chạy lại nhiều lần không lỗi.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Sửa lỗi production: hai cặp CHECK chồng nhau trên club_members
--    (role: {OWNER,ADMIN,MEMBER} ∩ {OWNER,CAPTAIN,MEMBER} → không gán được CAPTAIN;
--     status: bộ cũ thiếu BANNED → không cấm được thành viên)
-- ---------------------------------------------------------------------
alter table public.club_members drop constraint if exists club_members_role_check;
alter table public.club_members drop constraint if exists club_members_status_check;

alter table public.clubs add column if not exists accent_color text;
alter table public.clubs drop constraint if exists clubs_accent_color_chk;
alter table public.clubs add constraint clubs_accent_color_chk
  check (accent_color is null or accent_color ~ '^#[0-9a-fA-F]{6}$');

-- ---------------------------------------------------------------------
-- 1. Hàm quyền dùng trong RLS (public để policy gọi được; chỉ xét người gọi)
-- ---------------------------------------------------------------------
create or replace function public.club_is_member(p_club uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.club_members
                  where club_id = p_club and user_id = auth.uid() and status = 'APPROVED')
$$;

create or replace function public.club_is_staff(p_club uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.club_members
                  where club_id = p_club and user_id = auth.uid() and status = 'APPROVED'
                    and role in ('OWNER', 'CAPTAIN'))
$$;

-- ---------------------------------------------------------------------
-- 2. Bảng
-- ---------------------------------------------------------------------
create table if not exists public.club_posts (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  kind text not null default 'POST'
    check (kind in ('POST', 'ANNOUNCEMENT', 'AUTO_RUN', 'AUTO_JOIN', 'RECAP')),
  title text check (title is null or char_length(title) <= 120),
  body text not null default '' check (char_length(body) <= 4000),
  image_paths text[] not null default '{}' check (cardinality(image_paths) <= 4),
  activity_id uuid references public.activities(id) on delete cascade,
  meta jsonb not null default '{}'::jsonb,
  is_pinned boolean not null default false,
  reaction_count integer not null default 0,
  comment_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists club_posts_feed_idx on public.club_posts (club_id, created_at desc) where deleted_at is null;
create index if not exists club_posts_pinned_idx on public.club_posts (club_id) where is_pinned and deleted_at is null;
create unique index if not exists club_posts_auto_run_uidx on public.club_posts (club_id, activity_id) where kind = 'AUTO_RUN';
create unique index if not exists club_posts_recap_uidx on public.club_posts (club_id, (meta->>'week')) where kind = 'RECAP';

create table if not exists public.club_post_reactions (
  post_id uuid not null references public.club_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.club_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.club_posts(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists club_post_comments_post_idx on public.club_post_comments (post_id, created_at);

create table if not exists public.club_messages (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 2000),
  reply_to uuid references public.club_messages(id) on delete set null,
  activity_id uuid references public.activities(id) on delete set null,
  mentions uuid[] not null default '{}' check (cardinality(mentions) <= 20),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists club_messages_club_time_idx on public.club_messages (club_id, created_at desc, id desc);
create index if not exists club_messages_author_time_idx on public.club_messages (author_id, created_at desc);

create table if not exists public.club_message_reads (
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (club_id, user_id)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  club_id uuid references public.clubs(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  kind text not null,
  title text not null check (char_length(title) <= 160),
  body text check (body is null or char_length(body) <= 300),
  link text check (link is null or link like '/%'),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;

create table if not exists public.notification_settings (
  user_id uuid not null references public.profiles(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  level text not null default 'ALL' check (level in ('ALL', 'IMPORTANT', 'NONE')),
  updated_at timestamptz not null default now(),
  primary key (user_id, club_id)
);

-- ---------------------------------------------------------------------
-- 3. Quyền truy cập: đọc qua RLS, ghi qua RPC (chat: insert có kiểm soát)
-- ---------------------------------------------------------------------
alter table public.club_posts enable row level security;
alter table public.club_post_reactions enable row level security;
alter table public.club_post_comments enable row level security;
alter table public.club_messages enable row level security;
alter table public.club_message_reads enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_settings enable row level security;

revoke all on public.club_posts, public.club_post_reactions, public.club_post_comments, public.club_messages,
              public.club_message_reads, public.notifications, public.notification_settings from anon, authenticated;
grant select on public.club_posts, public.club_post_reactions, public.club_post_comments, public.club_messages,
                public.club_message_reads, public.notifications, public.notification_settings to authenticated;
grant insert (club_id, body, reply_to, activity_id, mentions) on public.club_messages to authenticated;

drop policy if exists club_posts_select on public.club_posts;
create policy club_posts_select on public.club_posts for select to authenticated
  using (deleted_at is null and public.club_is_member(club_id));

drop policy if exists club_post_reactions_select on public.club_post_reactions;
create policy club_post_reactions_select on public.club_post_reactions for select to authenticated
  using (exists (select 1 from public.club_posts p where p.id = post_id and public.club_is_member(p.club_id)));

drop policy if exists club_post_comments_select on public.club_post_comments;
create policy club_post_comments_select on public.club_post_comments for select to authenticated
  using (deleted_at is null and exists (select 1 from public.club_posts p
                                         where p.id = post_id and p.deleted_at is null and public.club_is_member(p.club_id)));

-- Tin đã xóa vẫn đọc được (hiện "Tin nhắn đã bị thu hồi"), nội dung bị xóa trắng khi thu hồi
drop policy if exists club_messages_select on public.club_messages;
create policy club_messages_select on public.club_messages for select to authenticated
  using (public.club_is_member(club_id));
drop policy if exists club_messages_insert on public.club_messages;
create policy club_messages_insert on public.club_messages for insert to authenticated
  with check (author_id = auth.uid() and public.club_is_member(club_id));

drop policy if exists club_message_reads_select on public.club_message_reads;
create policy club_message_reads_select on public.club_message_reads for select to authenticated
  using (user_id = auth.uid());

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());

drop policy if exists notification_settings_select on public.notification_settings;
create policy notification_settings_select on public.notification_settings for select to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 4. Gửi thông báo (tôn trọng mức thông báo theo CLB)
--    IMPORTANT = thông báo ghim, nhắc tên, duyệt / xin vào CLB
-- ---------------------------------------------------------------------
create or replace function private.notify(
  p_user uuid, p_club uuid, p_kind text, p_title text, p_body text, p_link text,
  p_actor uuid default null, p_important boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare v_level text;
begin
  if p_user is null or p_user = p_actor then return; end if;
  if p_club is not null then
    select level into v_level from public.notification_settings where user_id = p_user and club_id = p_club;
    if v_level = 'NONE' or (v_level = 'IMPORTANT' and not p_important) then return; end if;
  end if;
  insert into public.notifications (user_id, club_id, actor_id, kind, title, body, link)
  values (p_user, p_club, p_actor, p_kind, left(p_title, 160), left(p_body, 300), p_link);
end $$;

create or replace function private.display_name(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(display_name), ''), 'Một runner') from public.profiles where id = p_user
$$;

-- ---------------------------------------------------------------------
-- 5. Bảng tin: RPC
-- ---------------------------------------------------------------------
create or replace function public.create_club_post(
  p_club_id uuid, p_body text, p_title text default null, p_kind text default 'POST',
  p_image_paths text[] default '{}', p_pin boolean default false
) returns public.club_posts
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_body text := trim(coalesce(p_body, ''));
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_paths text[] := coalesce(p_image_paths, '{}');
  v_row public.club_posts;
  m record;
begin
  if not public.club_is_member(p_club_id) then raise exception 'NOT_A_MEMBER'; end if;
  if p_kind not in ('POST', 'ANNOUNCEMENT') then raise exception 'INVALID_POST_KIND'; end if;
  if (p_kind = 'ANNOUNCEMENT' or p_pin) and not public.club_is_staff(p_club_id) then raise exception 'FORBIDDEN'; end if;
  if char_length(v_body) = 0 and cardinality(v_paths) = 0 then raise exception 'EMPTY_POST'; end if;
  if char_length(v_body) > 4000 or char_length(coalesce(v_title, '')) > 120 or cardinality(v_paths) > 4 then
    raise exception 'POST_TOO_LONG';
  end if;
  -- Ảnh phải nằm trong thư mục của CLB và của chính người đăng: <club_id>/<user_id>/...
  if exists (select 1 from unnest(v_paths) p where p not like p_club_id::text || '/' || v_uid::text || '/%') then
    raise exception 'INVALID_IMAGE_PATH';
  end if;
  if (select count(*) from public.club_posts
       where author_id = v_uid and created_at > now() - interval '1 hour' and kind in ('POST', 'ANNOUNCEMENT')) >= 10 then
    raise exception 'RATE_LIMITED';
  end if;

  insert into public.club_posts (club_id, author_id, kind, title, body, image_paths, is_pinned)
  values (p_club_id, v_uid, p_kind, v_title, v_body, v_paths, p_pin or p_kind = 'ANNOUNCEMENT')
  returning * into v_row;

  if p_kind = 'ANNOUNCEMENT' then
    for m in select user_id from public.club_members where club_id = p_club_id and status = 'APPROVED' loop
      perform private.notify(m.user_id, p_club_id, 'CLUB_ANNOUNCEMENT',
        coalesce(v_title, 'Thông báo mới từ CLB'), left(v_body, 140),
        '/clubs/' || p_club_id, v_uid, true);
    end loop;
  end if;
  return v_row;
end $$;

create or replace function public.delete_club_post(p_post_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); p public.club_posts;
begin
  select * into p from public.club_posts where id = p_post_id and deleted_at is null;
  if not found then return; end if;
  if p.author_id is distinct from v_uid and not public.club_is_staff(p.club_id) then raise exception 'FORBIDDEN'; end if;
  update public.club_posts set deleted_at = now(), is_pinned = false, updated_at = now() where id = p_post_id;
end $$;

create or replace function public.pin_club_post(p_post_id uuid, p_pinned boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_club uuid;
begin
  perform private.require_uid();
  select club_id into v_club from public.club_posts where id = p_post_id and deleted_at is null;
  if v_club is null then raise exception 'POST_NOT_FOUND'; end if;
  if not public.club_is_staff(v_club) then raise exception 'FORBIDDEN'; end if;
  update public.club_posts set is_pinned = coalesce(p_pinned, false), updated_at = now() where id = p_post_id;
end $$;

-- Cổ vũ (thả tim) — bấm lần nữa để bỏ. Trả về trạng thái mới và tổng số
create or replace function public.toggle_post_reaction(p_post_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); p public.club_posts; v_on boolean;
begin
  select * into p from public.club_posts where id = p_post_id and deleted_at is null for update;
  if not found then raise exception 'POST_NOT_FOUND'; end if;
  if not public.club_is_member(p.club_id) then raise exception 'NOT_A_MEMBER'; end if;

  delete from public.club_post_reactions where post_id = p_post_id and user_id = v_uid;
  if found then
    v_on := false;
  else
    insert into public.club_post_reactions (post_id, user_id) values (p_post_id, v_uid);
    v_on := true;
    -- Chỉ báo một lần cho mỗi người cổ vũ mỗi bài
    if not exists (select 1 from public.notifications
                    where user_id = p.author_id and actor_id = v_uid and kind = 'POST_CHEER'
                      and link = '/clubs/' || p.club_id || '?post=' || p.id) then
      perform private.notify(p.author_id, p.club_id, 'POST_CHEER',
        private.display_name(v_uid) || case when p.kind = 'AUTO_RUN' then ' đã cổ vũ buổi chạy của bạn' else ' đã thích bài đăng của bạn' end,
        null, '/clubs/' || p.club_id || '?post=' || p.id, v_uid, false);
    end if;
  end if;

  update public.club_posts
     set reaction_count = (select count(*) from public.club_post_reactions where post_id = p_post_id)
   where id = p_post_id
  returning * into p;
  return jsonb_build_object('reacted', v_on, 'count', p.reaction_count);
end $$;

create or replace function public.add_post_comment(p_post_id uuid, p_body text) returns public.club_post_comments
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); p public.club_posts; c public.club_post_comments; v_body text := trim(coalesce(p_body, ''));
begin
  select * into p from public.club_posts where id = p_post_id and deleted_at is null;
  if not found then raise exception 'POST_NOT_FOUND'; end if;
  if not public.club_is_member(p.club_id) then raise exception 'NOT_A_MEMBER'; end if;
  if char_length(v_body) = 0 then raise exception 'EMPTY_COMMENT'; end if;
  if char_length(v_body) > 1000 then raise exception 'POST_TOO_LONG'; end if;
  if (select count(*) from public.club_post_comments where author_id = v_uid and created_at > now() - interval '1 minute') >= 10 then
    raise exception 'RATE_LIMITED';
  end if;

  insert into public.club_post_comments (post_id, author_id, body) values (p_post_id, v_uid, v_body) returning * into c;
  update public.club_posts
     set comment_count = (select count(*) from public.club_post_comments where post_id = p_post_id and deleted_at is null)
   where id = p_post_id;
  perform private.notify(p.author_id, p.club_id, 'POST_COMMENT',
    private.display_name(v_uid) || ' đã bình luận bài của bạn', left(v_body, 140),
    '/clubs/' || p.club_id || '?post=' || p.id, v_uid, false);
  return c;
end $$;

create or replace function public.delete_post_comment(p_comment_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); c public.club_post_comments; v_club uuid;
begin
  select * into c from public.club_post_comments where id = p_comment_id and deleted_at is null;
  if not found then return; end if;
  select club_id into v_club from public.club_posts where id = c.post_id;
  if c.author_id is distinct from v_uid and not public.club_is_staff(v_club) then raise exception 'FORBIDDEN'; end if;
  update public.club_post_comments set deleted_at = now() where id = p_comment_id;
  update public.club_posts
     set comment_count = (select count(*) from public.club_post_comments where post_id = c.post_id and deleted_at is null)
   where id = c.post_id;
end $$;

-- ---------------------------------------------------------------------
-- 6. Trò chuyện: kiểm tra khi gửi, thu hồi, đánh dấu đã đọc
-- ---------------------------------------------------------------------
create or replace function private.before_club_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.body := trim(coalesce(new.body, ''));
  new.created_at := now();
  new.deleted_at := null;
  if char_length(new.body) = 0 and new.activity_id is null then raise exception 'EMPTY_MESSAGE'; end if;
  if (select count(*) from public.club_messages
       where author_id = new.author_id and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'RATE_LIMITED';
  end if;
  if new.reply_to is not null and not exists (select 1 from public.club_messages where id = new.reply_to and club_id = new.club_id) then
    new.reply_to := null;
  end if;
  if new.activity_id is not null and not exists (select 1 from public.activities where id = new.activity_id and user_id = new.author_id) then
    raise exception 'FORBIDDEN';
  end if;
  -- Chỉ giữ người được nhắc là thành viên CLB (không nhắc chính mình)
  new.mentions := coalesce(array(
    select distinct m.user_id from public.club_members m
     where m.club_id = new.club_id and m.status = 'APPROVED'
       and m.user_id = any(coalesce(new.mentions, '{}')) and m.user_id <> new.author_id), '{}');
  return new;
end $$;

create or replace function private.after_club_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare u uuid; v_club text;
begin
  -- Người gửi coi như đã đọc tới tin của mình
  insert into public.club_message_reads (club_id, user_id, last_read_at) values (new.club_id, new.author_id, new.created_at)
  on conflict (club_id, user_id) do update set last_read_at = greatest(public.club_message_reads.last_read_at, excluded.last_read_at);

  if cardinality(new.mentions) > 0 then
    select name into v_club from public.clubs where id = new.club_id;
    foreach u in array new.mentions loop
      perform private.notify(u, new.club_id, 'CHAT_MENTION',
        private.display_name(new.author_id) || ' nhắc đến bạn trong ' || coalesce(v_club, 'CLB'),
        left(new.body, 140), '/clubs/' || new.club_id || '/chat', new.author_id, true);
    end loop;
  end if;
  return null;
end $$;

drop trigger if exists trg_before_club_message on public.club_messages;
create trigger trg_before_club_message before insert on public.club_messages
  for each row execute function private.before_club_message();
drop trigger if exists trg_after_club_message on public.club_messages;
create trigger trg_after_club_message after insert on public.club_messages
  for each row execute function private.after_club_message();

create or replace function public.delete_club_message(p_message_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); m public.club_messages;
begin
  select * into m from public.club_messages where id = p_message_id and deleted_at is null;
  if not found then return; end if;
  if m.author_id <> v_uid and not public.club_is_staff(m.club_id) then raise exception 'FORBIDDEN'; end if;
  update public.club_messages set deleted_at = now(), body = '', activity_id = null, mentions = '{}' where id = p_message_id;
end $$;

create or replace function public.mark_club_read(p_club_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  if not public.club_is_member(p_club_id) then return; end if;
  insert into public.club_message_reads (club_id, user_id, last_read_at) values (p_club_id, v_uid, now())
  on conflict (club_id, user_id) do update set last_read_at = now();
end $$;

-- ---------------------------------------------------------------------
-- 7. Hộp thư CLB: các CLB của tôi + tin chưa đọc + tin cuối
-- ---------------------------------------------------------------------
create or replace function public.my_clubs_inbox()
returns table (
  club_id uuid, name text, avatar_url text, accent_color text, role text, member_status text,
  member_count integer, unread_count integer, last_message_body text, last_message_author text,
  last_message_at timestamptz, pinned_title text
)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.avatar_url, c.accent_color, m.role, m.status, c.member_count,
         case when m.status <> 'APPROVED' then 0 else (
           select count(*)::int from public.club_messages x
            where x.club_id = c.id and x.deleted_at is null and x.author_id <> auth.uid()
              and x.created_at > coalesce((select r.last_read_at from public.club_message_reads r
                                            where r.club_id = c.id and r.user_id = auth.uid()), m.joined_at, '-infinity'))
         end,
         lm.body, private.display_name(lm.author_id), lm.created_at,
         (select coalesce(p.title, left(p.body, 80)) from public.club_posts p
           where p.club_id = c.id and p.is_pinned and p.deleted_at is null
           order by p.created_at desc limit 1)
    from public.club_members m
    join public.clubs c on c.id = m.club_id
    left join lateral (
      select x.body, x.author_id, x.created_at from public.club_messages x
       where x.club_id = c.id and x.deleted_at is null and m.status = 'APPROVED'
       order by x.created_at desc limit 1) lm on true
   where m.user_id = auth.uid() and m.status in ('APPROVED', 'PENDING')
   order by coalesce(lm.created_at, m.joined_at) desc nulls last
$$;

-- ---------------------------------------------------------------------
-- 8. BXH CLB: tuần (từ thứ Hai, giờ Việt Nam) / tháng / tất cả
-- ---------------------------------------------------------------------
create or replace function private.period_start(p_period text) returns timestamptz
language sql stable as $$
  select case upper(p_period)
    when 'WEEK' then date_trunc('week', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh'
    when 'MONTH' then date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh'
    else '-infinity'::timestamptz end
$$;

create or replace function public.club_leaderboard(p_club_id uuid, p_period text default 'WEEK')
returns table (
  rank integer, user_id uuid, display_name text, avatar_url text, level integer, role text,
  distance_m numeric, run_count integer, moving_s bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.club_is_member(p_club_id) then raise exception 'NOT_A_MEMBER'; end if;
  if upper(coalesce(p_period, '')) not in ('WEEK', 'MONTH', 'ALL') then raise exception 'INVALID_PERIOD'; end if;
  return query
  with totals as (
    select m.user_id, m.role,
           coalesce(sum(a.distance_m), 0)::numeric as distance_m,
           count(a.id)::int as run_count,
           coalesce(sum(a.moving_time_s), 0)::bigint as moving_s
      from public.club_members m
      left join public.activities a
        on a.user_id = m.user_id and a.validation_status = 'APPROVED'
       and coalesce(a.status, '') <> 'DELETED' and a.started_at >= private.period_start(p_period)
     where m.club_id = p_club_id and m.status = 'APPROVED'
     group by m.user_id, m.role
  )
  select (rank() over (order by t.distance_m desc))::int, t.user_id, private.display_name(t.user_id),
         pr.avatar_url, coalesce(pr.level, 1)::int, t.role, t.distance_m, t.run_count, t.moving_s
    from totals t join public.profiles pr on pr.id = t.user_id
   order by t.distance_m desc, t.run_count desc, pr.display_name;
end $$;

-- ---------------------------------------------------------------------
-- 9. Thông báo: đánh dấu đã đọc, chọn mức thông báo theo CLB
-- ---------------------------------------------------------------------
create or replace function public.mark_notifications_read(p_ids uuid[] default null) returns integer
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); n integer;
begin
  update public.notifications set read_at = now()
   where user_id = v_uid and read_at is null and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.set_club_notification_level(p_club_id uuid, p_level text) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  if p_level not in ('ALL', 'IMPORTANT', 'NONE') then raise exception 'INVALID_LEVEL'; end if;
  if not public.club_is_member(p_club_id) then raise exception 'NOT_A_MEMBER'; end if;
  insert into public.notification_settings (user_id, club_id, level) values (v_uid, p_club_id, p_level)
  on conflict (user_id, club_id) do update set level = excluded.level, updated_at = now();
end $$;

create or replace function public.set_club_accent(p_club_id uuid, p_color text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform private.require_uid();
  if not public.club_is_staff(p_club_id) then raise exception 'FORBIDDEN'; end if;
  if p_color is not null and p_color !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_COLOR'; end if;
  update public.clubs set accent_color = p_color where id = p_club_id;
end $$;

-- ---------------------------------------------------------------------
-- 10. Bài tự sinh
-- ---------------------------------------------------------------------
-- Bài chạy được duyệt → một bài AUTO_RUN trong mỗi CLB của người chạy.
-- Không đăng: bài cũ hơn 3 ngày (backfill), bài chỉ lưu lịch sử, người để chế độ riêng tư.
create or replace function private.club_posts_on_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_vis text;
begin
  if tg_op = 'UPDATE' and new.status = 'DELETED' and old.status is distinct from 'DELETED' then
    update public.club_posts set deleted_at = now(), is_pinned = false where activity_id = new.id and deleted_at is null;
    return null;
  end if;
  if new.validation_status is distinct from 'APPROVED' or coalesce(new.status, '') = 'DELETED' then return null; end if;
  if tg_op = 'UPDATE' and old.validation_status = 'APPROVED' then return null; end if;
  if new.started_at < now() - interval '3 days' then return null; end if;
  if coalesce(new.validation_reason, '') like '%chỉ lưu lịch sử%' then return null; end if;
  select activity_visibility into v_vis from public.profile_settings where user_id = new.user_id;
  if v_vis = 'PRIVATE' then return null; end if;

  insert into public.club_posts (club_id, author_id, kind, body, activity_id, meta, created_at)
  select m.club_id, new.user_id, 'AUTO_RUN', coalesce(new.title, ''), new.id,
         jsonb_build_object('distance_m', new.distance_m, 'moving_s', new.moving_time_s, 'avg_pace_s', new.avg_pace_s,
                            'elevation_gain_m', new.elevation_gain_m, 'source', new.source, 'started_at', new.started_at),
         now()
    from public.club_members m
   where m.user_id = new.user_id and m.status = 'APPROVED'
  on conflict (club_id, activity_id) where kind = 'AUTO_RUN' do nothing;
  return null;
end $$;

drop trigger if exists trg_club_posts_on_activity on public.activities;
create trigger trg_club_posts_on_activity after insert or update of validation_status, status on public.activities
  for each row execute function private.club_posts_on_activity();

-- Thành viên: xin vào → báo ban quản trị; được duyệt → báo người đó + bài chào mừng
create or replace function private.club_member_events() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_club public.clubs; s record;
begin
  select * into v_club from public.clubs where id = new.club_id;
  if new.status = 'PENDING' and (tg_op = 'INSERT' or old.status is distinct from 'PENDING') then
    for s in select user_id from public.club_members
              where club_id = new.club_id and status = 'APPROVED' and role in ('OWNER', 'CAPTAIN') loop
      perform private.notify(s.user_id, new.club_id, 'CLUB_JOIN_REQUEST',
        private.display_name(new.user_id) || ' xin gia nhập ' || v_club.name, null,
        '/clubs/' || new.club_id || '/members', new.user_id, true);
    end loop;
  elsif new.status = 'APPROVED' and (tg_op = 'INSERT' or old.status is distinct from 'APPROVED') then
    if tg_op = 'UPDATE' and old.status = 'PENDING' then
      perform private.notify(new.user_id, new.club_id, 'CLUB_APPROVED',
        'Bạn đã được duyệt vào ' || v_club.name, 'Vào CLB để chào mọi người nhé!',
        '/clubs/' || new.club_id, null, true);
    end if;
    if new.role <> 'OWNER' then
      insert into public.club_posts (club_id, author_id, kind, body)
      values (new.club_id, new.user_id, 'AUTO_JOIN', private.display_name(new.user_id) || ' vừa gia nhập CLB');
    end if;
  end if;
  return null;
end $$;

drop trigger if exists trg_club_member_events on public.club_members;
create trigger trg_club_member_events after insert or update of status on public.club_members
  for each row execute function private.club_member_events();

-- ---------------------------------------------------------------------
-- 11. Tổng kết tuần (chạy sáng thứ Hai qua /api/cron/club-recap, service_role)
-- ---------------------------------------------------------------------
create or replace function public.post_weekly_club_recaps() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_end timestamptz := private.period_start('WEEK');
  v_start timestamptz := v_end - interval '7 days';
  v_week text := to_char(v_start at time zone 'Asia/Ho_Chi_Minh', 'IYYY-"W"IW');
  c record; v_top jsonb; v_km numeric; v_runs int; v_active int; v_new int; n int := 0;
begin
  for c in select id from public.clubs loop
    select coalesce(sum(a.distance_m), 0), count(a.id), count(distinct a.user_id)
      into v_km, v_runs, v_active
      from public.club_members m
      join public.activities a on a.user_id = m.user_id and a.validation_status = 'APPROVED'
       and coalesce(a.status, '') <> 'DELETED' and a.started_at >= v_start and a.started_at < v_end
     where m.club_id = c.id and m.status = 'APPROVED';
    if v_runs = 0 then continue; end if;

    select coalesce(jsonb_agg(t order by t.distance_m desc), '[]'::jsonb) into v_top from (
      select m.user_id, private.display_name(m.user_id) as name, sum(a.distance_m) as distance_m
        from public.club_members m
        join public.activities a on a.user_id = m.user_id and a.validation_status = 'APPROVED'
         and coalesce(a.status, '') <> 'DELETED' and a.started_at >= v_start and a.started_at < v_end
       where m.club_id = c.id and m.status = 'APPROVED'
       group by m.user_id order by sum(a.distance_m) desc limit 3) t;
    select count(*) into v_new from public.club_members
     where club_id = c.id and status = 'APPROVED' and joined_at >= v_start and joined_at < v_end;

    insert into public.club_posts (club_id, kind, title, body, meta)
    values (c.id, 'RECAP', 'Tổng kết tuần ' || to_char(v_start at time zone 'Asia/Ho_Chi_Minh', 'DD/MM'),
            '', jsonb_build_object('week', v_week, 'distance_m', v_km, 'run_count', v_runs,
                                   'active_members', v_active, 'new_members', v_new, 'top', v_top))
    on conflict (club_id, (meta->>'week')) where kind = 'RECAP' do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 12. Chuyển dữ liệu cũ: club_announcements + clubs.announcement → bài ghim
-- ---------------------------------------------------------------------
insert into public.club_posts (id, club_id, author_id, kind, title, body, is_pinned, created_at, updated_at)
select a.id, a.club_id, a.author_id, 'ANNOUNCEMENT', left(a.title, 120), left(coalesce(a.content, ''), 4000),
       coalesce(a.is_pinned, false), coalesce(a.published_at, a.created_at, now()), coalesce(a.updated_at, now())
  from public.club_announcements a
 where a.club_id is not null and coalesce(a.status, 'PUBLISHED') <> 'DELETED'
on conflict (id) do nothing;

insert into public.club_posts (club_id, author_id, kind, body, is_pinned, meta, created_at)
select c.id, c.announced_by, 'ANNOUNCEMENT', left(c.announcement, 4000), true,
       jsonb_build_object('legacy', 'clubs.announcement'), coalesce(c.announced_at, now())
  from public.clubs c
 where nullif(trim(c.announcement), '') is not null
   and not exists (select 1 from public.club_posts p where p.club_id = c.id and p.meta->>'legacy' = 'clubs.announcement');

-- ---------------------------------------------------------------------
-- 13. Ảnh bài đăng: bucket club-media, thư mục <club_id>/<user_id>/...
--     Bucket công khai (đường dẫn chứa uuid, không đoán được); chỉ thành viên được tải lên.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('club-media', 'club-media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists club_media_insert on storage.objects;
create policy club_media_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'club-media'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.club_is_member(((storage.foldername(name))[1])::uuid)
  );
drop policy if exists club_media_delete on storage.objects;
create policy club_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'club-media' and (storage.foldername(name))[2] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- 14. Realtime + quyền thực thi
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['club_messages', 'club_posts', 'notifications'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

revoke all on function public.club_is_member(uuid), public.club_is_staff(uuid),
  public.create_club_post(uuid, text, text, text, text[], boolean), public.delete_club_post(uuid),
  public.pin_club_post(uuid, boolean), public.toggle_post_reaction(uuid), public.add_post_comment(uuid, text),
  public.delete_post_comment(uuid), public.delete_club_message(uuid), public.mark_club_read(uuid),
  public.my_clubs_inbox(), public.club_leaderboard(uuid, text), public.mark_notifications_read(uuid[]),
  public.set_club_notification_level(uuid, text), public.set_club_accent(uuid, text),
  public.post_weekly_club_recaps()
  from public, anon;
grant execute on function public.club_is_member(uuid), public.club_is_staff(uuid),
  public.create_club_post(uuid, text, text, text, text[], boolean), public.delete_club_post(uuid),
  public.pin_club_post(uuid, boolean), public.toggle_post_reaction(uuid), public.add_post_comment(uuid, text),
  public.delete_post_comment(uuid), public.delete_club_message(uuid), public.mark_club_read(uuid),
  public.my_clubs_inbox(), public.club_leaderboard(uuid, text), public.mark_notifications_read(uuid[]),
  public.set_club_notification_level(uuid, text), public.set_club_accent(uuid, text)
  to authenticated;
revoke all on function public.post_weekly_club_recaps() from authenticated;
grant execute on function public.post_weekly_club_recaps() to service_role;

revoke all on function private.notify(uuid, uuid, text, text, text, text, uuid, boolean), private.display_name(uuid),
  private.before_club_message(), private.after_club_message(), private.club_posts_on_activity(),
  private.club_member_events(), private.period_start(text)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
