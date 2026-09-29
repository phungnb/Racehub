-- 010400: BÌNH LUẬN CÓ "THÍCH" VÀ "TRẢ LỜI" (bảng tin CLB + bảng tin Doanh nghiệp)
--   • Thích một bình luận (bấm lại để bỏ); người viết bình luận nhận thông báo (tối đa một lần / người thích / ngày).
--   • Trả lời một bình luận: hiện thụt vào dưới bình luận gốc (một tầng, trả lời một câu trả lời vẫn về cùng bình luận gốc);
--     người được trả lời nhận thông báo.
--   • Danh sách bình luận trả kèm số lượt thích, mình đã thích chưa, mình có quyền xóa không (người viết / ban quản trị).
-- Hàm cũ add_post_comment(p_post_id, p_body) và add_org_post_comment(p_id, p_body) giữ nguyên cho app bản cũ.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

-- ---------------------------------------------------------------------
-- 1. CLB
-- ---------------------------------------------------------------------
alter table public.club_post_comments add column if not exists parent_id uuid references public.club_post_comments(id) on delete set null;
alter table public.club_post_comments add column if not exists like_count integer not null default 0;
create index if not exists club_post_comments_parent_idx on public.club_post_comments (parent_id) where parent_id is not null;

create table if not exists public.club_comment_likes (
  comment_id uuid not null references public.club_post_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
alter table public.club_comment_likes enable row level security;
revoke all on public.club_comment_likes from public, anon, authenticated;

/** Danh sách bình luận của một bài (thành viên CLB), cũ → mới */
create or replace function public.club_post_comment_thread(p_post_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); p public.club_posts := (select x from public.club_posts x where x.id = p_post_id and x.deleted_at is null);
begin
  if p.id is null then raise exception 'POST_NOT_FOUND'; end if;
  if not public.club_is_member(p.club_id) and not public.is_system_admin() then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'parent_id', c.parent_id, 'author_id', c.author_id, 'body', c.body, 'created_at', c.created_at,
      'author_name', pr.display_name, 'author_avatar', pr.avatar_url, 'author_level', pr.level,
      'like_count', c.like_count,
      'liked', exists (select 1 from public.club_comment_likes l where l.comment_id = c.id and l.user_id = v_uid),
      'can_delete', c.author_id = v_uid or public.club_is_staff(p.club_id)) order by c.created_at)
    from public.club_post_comments c left join public.profiles pr on pr.id = c.author_id
   where c.post_id = p_post_id and c.deleted_at is null), '[]'::jsonb);
end $$;

/** Viết bình luận / trả lời một bình luận (p_parent_id) */
create or replace function public.add_post_comment(p_post_id uuid, p_body text, p_parent_id uuid) returns public.club_post_comments
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  p public.club_posts := (select x from public.club_posts x where x.id = p_post_id and x.deleted_at is null);
  v_body text := trim(coalesce(p_body, ''));
  v_parent public.club_post_comments;
  v_to uuid;                            -- người được trả lời trực tiếp (nhận thông báo)
  c public.club_post_comments;
  v_id uuid := gen_random_uuid();
  v_link text;
begin
  if p.id is null then raise exception 'POST_NOT_FOUND'; end if;
  if not public.club_is_member(p.club_id) then raise exception 'NOT_A_MEMBER'; end if;
  if char_length(v_body) = 0 then raise exception 'EMPTY_COMMENT'; end if;
  if char_length(v_body) > 1000 then raise exception 'POST_TOO_LONG'; end if;
  if (select count(*) from public.club_post_comments where author_id = v_uid and created_at > now() - interval '1 minute') >= 10 then
    raise exception 'RATE_LIMITED';
  end if;
  if p_parent_id is not null then
    v_parent := (select x from public.club_post_comments x where x.id = p_parent_id and x.post_id = p_post_id and x.deleted_at is null);
    if v_parent.id is null then raise exception 'COMMENT_NOT_FOUND'; end if;
    v_to := v_parent.author_id;
    -- một tầng: trả lời một câu trả lời thì gắn vào bình luận gốc (thông báo vẫn gửi người mình trả lời)
    if v_parent.parent_id is not null then
      v_parent := coalesce((select x from public.club_post_comments x where x.id = v_parent.parent_id and x.deleted_at is null), v_parent);
    end if;
  end if;

  insert into public.club_post_comments (id, post_id, author_id, body, parent_id) values (v_id, p_post_id, v_uid, v_body, v_parent.id);
  c := (select x from public.club_post_comments x where x.id = v_id);
  update public.club_posts
     set comment_count = (select count(*) from public.club_post_comments where post_id = p_post_id and deleted_at is null)
   where id = p_post_id;

  v_link := '/clubs/' || p.club_id || '?post=' || p.id;
  if v_to is not null then
    perform private.notify(v_to, p.club_id, 'COMMENT_REPLY',
      private.display_name(v_uid) || ' đã trả lời bình luận của bạn', left(v_body, 140), v_link, v_uid, false);
  end if;
  if p.author_id is distinct from v_to then
    perform private.notify(p.author_id, p.club_id, 'POST_COMMENT',
      private.display_name(v_uid) || ' đã bình luận bài của bạn', left(v_body, 140), v_link, v_uid, false);
  end if;
  return c;
end $$;

/** Thích / bỏ thích một bình luận */
create or replace function public.toggle_post_comment_like(p_comment_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.club_post_comments := (select x from public.club_post_comments x where x.id = p_comment_id and x.deleted_at is null);
  p public.club_posts := (select x from public.club_posts x where x.id = c.post_id);
  v_liked boolean;
  v_count integer;
begin
  if c.id is null or p.id is null or p.deleted_at is not null then raise exception 'COMMENT_NOT_FOUND'; end if;
  if not public.club_is_member(p.club_id) then raise exception 'NOT_A_MEMBER'; end if;
  if exists (select 1 from public.club_comment_likes l where l.comment_id = c.id and l.user_id = v_uid) then
    delete from public.club_comment_likes where comment_id = c.id and user_id = v_uid;
    v_liked := false;
  else
    insert into public.club_comment_likes (comment_id, user_id) values (c.id, v_uid) on conflict do nothing;
    v_liked := true;
    if not exists (select 1 from public.notifications n where n.user_id = c.author_id and n.actor_id = v_uid and n.kind = 'COMMENT_LIKE'
                     and n.link = '/clubs/' || p.club_id || '?post=' || p.id and n.created_at > now() - interval '1 day') then
      perform private.notify(c.author_id, p.club_id, 'COMMENT_LIKE', private.display_name(v_uid) || ' đã thích bình luận của bạn',
        left(c.body, 140), '/clubs/' || p.club_id || '?post=' || p.id, v_uid, false);
    end if;
  end if;
  v_count := (select count(*) from public.club_comment_likes l where l.comment_id = c.id);
  update public.club_post_comments set like_count = v_count where id = c.id;
  return jsonb_build_object('liked', v_liked, 'count', v_count);
end $$;

-- ---------------------------------------------------------------------
-- 2. Doanh nghiệp / tổ chức
-- ---------------------------------------------------------------------
alter table public.org_post_comments add column if not exists parent_id uuid references public.org_post_comments(id) on delete cascade;
create table if not exists public.org_comment_likes (
  comment_id uuid not null references public.org_post_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
alter table public.org_comment_likes enable row level security;
revoke all on public.org_comment_likes from public, anon, authenticated;

-- Giữ kiểu trả về jsonb như bản 008400, thêm trả lời + lượt thích
create or replace function public.org_post_comments(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := (select p.org_id from public.org_posts p where p.id = p_id);
begin
  if v_org is null or not public.org_is_member(v_org) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', cm.id, 'parent_id', cm.parent_id, 'body', cm.body, 'created_at', cm.created_at,
             'author_id', cm.author_id, 'author_name', private.display_name(cm.author_id), 'author_avatar', pr.avatar_url,
             'like_count', (select count(*)::int from public.org_comment_likes l where l.comment_id = cm.id),
             'liked', exists (select 1 from public.org_comment_likes l where l.comment_id = cm.id and l.user_id = auth.uid()),
             'can_delete', cm.author_id = auth.uid() or public.org_is_admin(v_org)) order by cm.created_at)
           from public.org_post_comments cm left join public.profiles pr on pr.id = cm.author_id where cm.post_id = p_id), '[]'::jsonb);
end $$;

create or replace function public.add_org_post_comment(p_id uuid, p_body text, p_parent_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  x public.org_posts := (select p from public.org_posts p where p.id = p_id);
  v_parent public.org_post_comments;
  v_to uuid;
  v_link text;
begin
  if x.id is null or not public.org_is_member(x.org_id) then raise exception 'NOT_A_MEMBER'; end if;
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 1000 then raise exception 'EMPTY_COMMENT'; end if;
  if (select count(*) from public.org_post_comments where author_id = v_uid and created_at > now() - interval '1 minute') >= 10 then
    raise exception 'RATE_LIMITED';
  end if;
  if p_parent_id is not null then
    v_parent := (select c from public.org_post_comments c where c.id = p_parent_id and c.post_id = p_id);
    if v_parent.id is null then raise exception 'COMMENT_NOT_FOUND'; end if;
    v_to := v_parent.author_id;
    if v_parent.parent_id is not null then
      v_parent := coalesce((select c from public.org_post_comments c where c.id = v_parent.parent_id), v_parent);
    end if;
  end if;
  insert into public.org_post_comments (post_id, author_id, body, parent_id) values (p_id, v_uid, trim(p_body), v_parent.id);
  v_link := '/orgs/' || x.org_id || '?tab=feed';
  if v_to is not null then
    perform private.notify(v_to, null, 'COMMENT_REPLY', private.display_name(v_uid) || ' đã trả lời bình luận của bạn',
      left(trim(p_body), 120), v_link, v_uid, false);
  end if;
  if x.author_id is distinct from v_to then
    perform private.notify(x.author_id, null, 'ORG_POST_COMMENT', private.display_name(v_uid) || ' bình luận bài của bạn',
      left(trim(p_body), 120), v_link, v_uid, false);
  end if;
end $$;

create or replace function public.toggle_org_comment_like(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  cm public.org_post_comments := (select c from public.org_post_comments c where c.id = p_id);
  v_org uuid := (select p.org_id from public.org_posts p where p.id = cm.post_id);
  v_liked boolean;
begin
  if cm.id is null then raise exception 'COMMENT_NOT_FOUND'; end if;
  if not public.org_is_member(v_org) then raise exception 'NOT_A_MEMBER'; end if;
  if exists (select 1 from public.org_comment_likes l where l.comment_id = cm.id and l.user_id = v_uid) then
    delete from public.org_comment_likes where comment_id = cm.id and user_id = v_uid;
    v_liked := false;
  else
    insert into public.org_comment_likes (comment_id, user_id) values (cm.id, v_uid) on conflict do nothing;
    v_liked := true;
    if not exists (select 1 from public.notifications n where n.user_id = cm.author_id and n.actor_id = v_uid and n.kind = 'COMMENT_LIKE'
                     and n.link = '/orgs/' || v_org || '?tab=feed' and n.created_at > now() - interval '1 day') then
      perform private.notify(cm.author_id, null, 'COMMENT_LIKE', private.display_name(v_uid) || ' đã thích bình luận của bạn',
        left(cm.body, 120), '/orgs/' || v_org || '?tab=feed', v_uid, false);
    end if;
  end if;
  return jsonb_build_object('liked', v_liked, 'count', (select count(*)::int from public.org_comment_likes l where l.comment_id = cm.id));
end $$;

revoke all on function public.club_post_comment_thread(uuid), public.add_post_comment(uuid, text, uuid), public.toggle_post_comment_like(uuid),
  public.add_org_post_comment(uuid, text, uuid), public.toggle_org_comment_like(uuid) from public, anon;
grant execute on function public.club_post_comment_thread(uuid), public.add_post_comment(uuid, text, uuid), public.toggle_post_comment_like(uuid),
  public.add_org_post_comment(uuid, text, uuid), public.toggle_org_comment_like(uuid) to authenticated;

notify pgrst, 'reload schema';
