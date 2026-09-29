-- 010500: THÍCH + QUÀ TẶNG MINH BẠCH, BẢNG TIN CỘNG ĐỒNG, XÓA THÔNG BÁO
--   • Bài đăng CLB đếm số lượt tặng quà (gift_count, tự cộng khi có quà mới) — ai cũng thấy bao nhiêu lượt thích, bao nhiêu lượt quà.
--   • post_engagement(post): ai đã thích, ai đã tặng quà gì (lời nhắn kèm quà chỉ người tặng / người nhận đọc được).
--   • community_feed(): bảng tin cộng đồng ở Trang chủ = bài chạy, cột mốc, bài viết từ mọi CLB mình tham gia
--     (một bài chạy đăng ở nhiều CLB chỉ hiện một lần).
--   • "Cổ vũ" đổi thành "Thích": thông báo "… đã thích buổi chạy của bạn".
--   • Xóa thông báo: từng cái, hoặc xóa hết thông báo đã đọc.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

-- ---------------------------------------------------------------------
-- 1. Số lượt tặng quà trên bài đăng
-- ---------------------------------------------------------------------
alter table public.club_posts add column if not exists gift_count integer not null default 0;

create or replace function private.cheer_count_post_gift() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.post_id is not null and new.gift_code is not null then
    update public.club_posts set gift_count = gift_count + greatest(coalesce(new.qty, 1), 1) where id = new.post_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_cheer_count_post_gift on public.cheers;
create trigger trg_cheer_count_post_gift after insert on public.cheers
  for each row execute function private.cheer_count_post_gift();

-- Số liệu cũ: đếm lại từ các lượt quà đã gửi
update public.club_posts p
   set gift_count = s.n
  from (select c.post_id, sum(greatest(coalesce(c.qty, 1), 1))::int as n
          from public.cheers c where c.post_id is not null and c.gift_code is not null group by c.post_id) s
 where p.id = s.post_id and p.gift_count is distinct from s.n;

-- ---------------------------------------------------------------------
-- 2. Ai đã thích, ai đã tặng quà (thành viên CLB của bài)
-- ---------------------------------------------------------------------
create or replace function public.post_engagement(p_post_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  p public.club_posts := (select x from public.club_posts x where x.id = p_post_id and x.deleted_at is null);
begin
  if p.id is null then raise exception 'POST_NOT_FOUND'; end if;
  if not public.club_is_member(p.club_id) then raise exception 'NOT_A_MEMBER'; end if;
  return jsonb_build_object(
    'like_count', p.reaction_count,
    'gift_count', p.gift_count,
    'likes', (select coalesce(jsonb_agg(jsonb_build_object(
                'user_id', t.user_id, 'display_name', pr.display_name, 'avatar_url', pr.avatar_url, 'level', coalesce(pr.level, 1),
                'at', t.created_at, 'me', t.user_id = v_uid) order by t.created_at desc), '[]'::jsonb)
                from (select r.user_id, r.created_at, row_number() over (order by r.created_at desc) as rn
                        from public.club_post_reactions r where r.post_id = p.id) t
                join public.profiles pr on pr.id = t.user_id
               where t.rn <= 500),
    'gifts', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', t.id, 'user_id', t.from_user, 'display_name', pr.display_name, 'avatar_url', pr.avatar_url, 'level', coalesce(pr.level, 1),
                'emoji', g.emoji, 'name', g.name, 'tier', g.tier, 'qty', t.qty, 'at', t.created_at, 'me', t.from_user = v_uid,
                -- lời nhắn là chuyện riêng của người tặng và người nhận
                'message', case when v_uid in (t.from_user, t.to_user) then t.message end) order by t.created_at desc), '[]'::jsonb)
                from (select c.id, c.from_user, c.to_user, c.gift_code, greatest(coalesce(c.qty, 1), 1) as qty, c.message, c.created_at,
                             row_number() over (order by c.created_at desc) as rn
                        from public.cheers c where c.post_id = p.id and c.gift_code is not null) t
                join public.profiles pr on pr.id = t.from_user
                join public.gift_catalog g on g.code = t.gift_code
               where t.rn <= 500),
    'gift_summary', (select coalesce(jsonb_agg(jsonb_build_object('emoji', s.emoji, 'name', s.name, 'qty', s.n) order by s.n desc, s.price desc), '[]'::jsonb)
                       from (select g.emoji, g.name, g.price_xu as price, sum(greatest(coalesce(c.qty, 1), 1)) as n
                               from public.cheers c join public.gift_catalog g on g.code = c.gift_code
                              where c.post_id = p.id group by g.emoji, g.name, g.price_xu) s),
    'gift_senders', (select count(distinct c.from_user) from public.cheers c where c.post_id = p.id and c.gift_code is not null)
  );
end $$;

-- ---------------------------------------------------------------------
-- 3. Bảng tin cộng đồng (Trang chủ): bài từ mọi CLB mình tham gia, mới nhất trước
-- ---------------------------------------------------------------------
create or replace function public.community_feed(p_before timestamptz default null, p_limit integer default 15) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_limit integer := least(greatest(coalesce(p_limit, 15), 1), 30);
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', x.id, 'club_id', x.club_id, 'author_id', x.author_id, 'kind', x.kind, 'title', x.title, 'body', x.body,
             'image_paths', coalesce(to_jsonb(x.image_paths), '[]'::jsonb), 'activity_id', x.activity_id, 'meta', coalesce(x.meta, '{}'::jsonb),
             'is_pinned', false, 'reaction_count', x.reaction_count, 'comment_count', x.comment_count, 'cheer_xu', x.cheer_xu,
             'gift_count', x.gift_count, 'created_at', x.created_at,
             'reacted', exists (select 1 from public.club_post_reactions r where r.post_id = x.id and r.user_id = v_uid),
             'author', case when pr.id is null then null else jsonb_build_object('id', pr.id, 'display_name', pr.display_name,
                                                                                 'level', coalesce(pr.level, 1), 'avatar_url', pr.avatar_url) end,
             'club', jsonb_build_object('id', cl.id, 'name', cl.name, 'avatar_url', cl.avatar_url, 'accent_color', cl.accent_color))
             order by x.created_at desc), '[]'::jsonb)
      from (
        select d.*, row_number() over (order by d.created_at desc, d.id) as page_rn
          from (
            select cp.*,
                   -- một bài chạy / cột mốc đăng ở nhiều CLB chỉ hiện một lần (bài đầu tiên)
                   row_number() over (partition by coalesce(cp.activity_id::text,
                                        case when cp.kind = 'MILESTONE' then cp.author_id::text || ':' || coalesce(cp.meta->>'code', '') || ':' || coalesce(cp.meta->>'total_km', '') end,
                                        cp.id::text)
                                      order by cp.created_at, cp.id) as dup_rn
              from public.club_posts cp
              join public.club_members m on m.club_id = cp.club_id and m.user_id = v_uid and m.status = 'APPROVED'
             where cp.deleted_at is null
               and cp.kind in ('AUTO_RUN', 'MILESTONE', 'POST', 'NEWS', 'ANNOUNCEMENT', 'CHALLENGE')
               and cp.created_at > now() - interval '60 days'
          ) d
         where d.dup_rn = 1 and (p_before is null or d.created_at < p_before)
      ) x
      left join public.profiles pr on pr.id = x.author_id
      join public.clubs cl on cl.id = x.club_id
     where x.page_rn <= v_limit
  );
end $$;

-- ---------------------------------------------------------------------
-- 4. "Cổ vũ" → "Thích" trong thông báo
-- ---------------------------------------------------------------------
create or replace function public.toggle_post_reaction(p_post_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); p public.club_posts; v_on boolean;
begin
  perform 1 from public.club_posts where id = p_post_id and deleted_at is null for update;
  p := (select x from public.club_posts x where x.id = p_post_id and x.deleted_at is null);
  if p.id is null then raise exception 'POST_NOT_FOUND'; end if;
  if not public.club_is_member(p.club_id) then raise exception 'NOT_A_MEMBER'; end if;

  delete from public.club_post_reactions where post_id = p_post_id and user_id = v_uid;
  if found then
    v_on := false;
  else
    insert into public.club_post_reactions (post_id, user_id) values (p_post_id, v_uid);
    v_on := true;
    -- Chỉ báo một lần cho mỗi người thích mỗi bài
    if not exists (select 1 from public.notifications
                    where user_id = p.author_id and actor_id = v_uid and kind = 'POST_CHEER'
                      and link = '/clubs/' || p.club_id || '?post=' || p.id) then
      perform private.notify(p.author_id, p.club_id, 'POST_CHEER',
        private.display_name(v_uid) || case when p.kind = 'AUTO_RUN' then ' đã thích buổi chạy của bạn'
                                            when p.kind = 'AUTO_JOIN' then ' chào mừng bạn vào CLB'
                                            else ' đã thích bài đăng của bạn' end,
        null, '/clubs/' || p.club_id || '?post=' || p.id, v_uid, false);
    end if;
  end if;

  update public.club_posts
     set reaction_count = (select count(*) from public.club_post_reactions where post_id = p_post_id)
   where id = p_post_id;
  return jsonb_build_object('reacted', v_on, 'count', (select x.reaction_count from public.club_posts x where x.id = p_post_id));
end $$;

-- ---------------------------------------------------------------------
-- 5. Xóa thông báo: theo danh sách, hoặc tất cả thông báo đã đọc
-- ---------------------------------------------------------------------
create or replace function public.delete_notifications(p_ids uuid[] default null, p_read_only boolean default false) returns integer
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); n integer;
begin
  if p_ids is null and not coalesce(p_read_only, false) then raise exception 'NOTHING_SELECTED'; end if;
  delete from public.notifications
   where user_id = v_uid
     and (p_ids is null or id = any(p_ids))
     and (not coalesce(p_read_only, false) or read_at is not null);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.post_engagement(uuid), public.community_feed(timestamptz, integer),
  public.delete_notifications(uuid[], boolean) from public, anon;
grant execute on function public.post_engagement(uuid), public.community_feed(timestamptz, integer),
  public.delete_notifications(uuid[], boolean) to authenticated;
revoke all on function private.cheer_count_post_gift() from public, anon, authenticated;
