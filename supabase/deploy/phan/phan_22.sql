-- RaceHub — PHẦN 22/25 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 013100, 013200
-- Supabase → SQL Editor → New query → dán TOÀN BỘ phần này → Run. Lỗi thì không có gì thay đổi; chạy lại vẫn an toàn.
-- Xong thì chạy phần tiếp theo.
begin;
-- ===================================================================
-- 20261001013100_feedback_round6.sql
-- ===================================================================
-- 013100: Chỉnh sửa lần 6.
-- 1. Bảng tin "Đang theo dõi" thích / bình luận / tặng quà ngay tại chỗ như "Cộng đồng":
--    following_feed trả kèm bài AUTO_RUN của buổi chạy (ưu tiên bài ở CLB mình tham gia). Người theo dõi runner được tương tác
--    với bài chạy (AUTO_RUN) của runner đó dù khác CLB — private.can_engage_post thay cho kiểm tra thành viên CLB trong các hàm
--    thích / bình luận / thích bình luận / xem lượt tương tác / tặng quà (bài viết thường của CLB vẫn chỉ thành viên CLB).
-- 2. Bài chạy chờ duyệt (từ Strava / Garmin / COROS): báo ngay cho người chạy kèm lý do; người chạy gửi được giải trình
--    (activities.owner_note) để ban quản trị CLB / admin đọc khi duyệt.
-- 3. Vinh danh thử thách theo cự ly: hạng mục DIST<mét> (VD DIST21097 = Top Half Marathon) — bài tốt nhất có cự ly ≥ hạng mục
--    trong thời gian thử thách, thời gian quy đổi theo pace trung bình.
-- 4. Người tạo / ban tổ chức sửa được thử thách TRƯỚC khi bắt đầu: tên, mô tả, mục tiêu, luật km / pace, thời gian.
--    Không đổi thể thức, số người, đối tượng, giải thưởng (liên quan phí và ký quỹ); thời lượng mới không dài hơn thời lượng đã trả phí.
-- Cần 013000. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

-- ---------------------------------------------------------------------
-- 1. Bảng tin "Đang theo dõi"
-- ---------------------------------------------------------------------
/** Được thích / bình luận / tặng quà trên bài này: thành viên CLB, hoặc người theo dõi chủ bài (chỉ bài chạy AUTO_RUN, bài đang chia sẻ) */
create or replace function private.can_engage_post(p public.club_posts) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and p.id is not null and (public.club_is_member(p.club_id)
    or (p.kind = 'AUTO_RUN' and p.author_id is not null and p.activity_id is not null
        and (p.author_id = auth.uid()
             or (private.is_following(auth.uid(), p.author_id) and not private.is_blocked(auth.uid(), p.author_id)
                 and exists (select 1 from public.activities a where a.id = p.activity_id and a.shared and public.can_view_activities(a.user_id))))))
$$;

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
            'user', jsonb_build_object('id', pr.id, 'display_name', pr.display_name, 'avatar_url', pr.avatar_url, 'level', coalesce(pr.level, 1)),
            -- 013100: bài AUTO_RUN của buổi chạy (cùng dạng community_feed) để thích / bình luận / tặng quà tại chỗ
            'post', case when cp.id is null then null else jsonb_build_object(
              'id', cp.id, 'club_id', cp.club_id, 'author_id', cp.author_id, 'kind', cp.kind, 'title', cp.title, 'body', cp.body,
              'image_paths', coalesce(to_jsonb(cp.image_paths), '[]'::jsonb), 'activity_id', cp.activity_id, 'meta', coalesce(cp.meta, '{}'::jsonb),
              'is_pinned', false, 'reaction_count', cp.reaction_count, 'comment_count', cp.comment_count, 'cheer_xu', cp.cheer_xu,
              'gift_count', cp.gift_count, 'created_at', cp.created_at,
              'reacted', exists (select 1 from public.club_post_reactions r where r.post_id = cp.id and r.user_id = v_uid),
              'author', jsonb_build_object('id', pr.id, 'display_name', pr.display_name, 'level', coalesce(pr.level, 1), 'avatar_url', pr.avatar_url),
              'club', jsonb_build_object('id', cl.id, 'name', cl.name, 'avatar_url', cl.avatar_url, 'accent_color', cl.accent_color)) end)
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
    left join lateral (
      select x.* from (select p.*, row_number() over (order by public.club_is_member(p.club_id) desc, p.created_at, p.id) as prn
                         from public.club_posts p
                        where p.activity_id = t.id and p.kind = 'AUTO_RUN' and p.deleted_at is null) x
       where x.prn = 1) cp on true
    left join public.clubs cl on cl.id = cp.club_id
   where t.rn <= v_limit);
end $$;

-- Các hàm tương tác: thay "thành viên CLB" bằng private.can_engage_post (giữ nguyên phần còn lại của bản gần nhất)
create or replace function public.post_engagement(p_post_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  p public.club_posts := (select x from public.club_posts x where x.id = p_post_id and x.deleted_at is null);
begin
  if p.id is null then raise exception 'POST_NOT_FOUND'; end if;
  if not private.can_engage_post(p) then raise exception 'NOT_A_MEMBER'; end if;
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

create or replace function public.toggle_post_reaction(p_post_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); p public.club_posts; v_on boolean;
begin
  perform 1 from public.club_posts where id = p_post_id and deleted_at is null for update;
  p := (select x from public.club_posts x where x.id = p_post_id and x.deleted_at is null);
  if p.id is null then raise exception 'POST_NOT_FOUND'; end if;
  if not private.can_engage_post(p) then raise exception 'NOT_A_MEMBER'; end if;

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

create or replace function public.club_post_comment_thread(p_post_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); p public.club_posts := (select x from public.club_posts x where x.id = p_post_id and x.deleted_at is null);
begin
  if p.id is null then raise exception 'POST_NOT_FOUND'; end if;
  if not private.can_engage_post(p) and not public.is_system_admin() then raise exception 'NOT_A_MEMBER'; end if;
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
  if not private.can_engage_post(p) then raise exception 'NOT_A_MEMBER'; end if;
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
  if not private.can_engage_post(p) then raise exception 'NOT_A_MEMBER'; end if;
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

create or replace function public.send_gift(
  p_to_user uuid, p_gift_code text, p_qty integer default 1, p_message text default null, p_post_id uuid default null,
  p_activity_id uuid default null, p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  g public.gift_catalog := (select x from public.gift_catalog x where x.code = p_gift_code);
  v_qty integer := coalesce(p_qty, 1);
  v_total integer;
  v_list integer;
  v_msg text := nullif(trim(coalesce(p_message, '')), '');
  v_club uuid;
  v_author uuid;
  v_act uuid;
  v_id uuid := (select c.id from public.cheers c where c.idempotency_key = p_idempotency_key);
  v_sent numeric;
  v_name text;
  o jsonb;
  v_promo uuid;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if v_id is not null then return jsonb_build_object('gift_id', v_id, 'duplicate', true); end if;
  if g.code is null or not g.is_active or not private.gift_in_season(g, private.vn_day(now())) then raise exception 'GIFT_NOT_AVAILABLE'; end if;
  if g.vip_tier > private.user_vip_tier(v_uid) then raise exception 'VIP_REQUIRED'; end if;
  if v_qty not in (1, 5, 10, 99) then raise exception 'INVALID_QTY'; end if;
  if p_to_user is null or p_to_user = v_uid then raise exception 'CANNOT_GIFT_SELF'; end if;
  if not exists (select 1 from public.profiles where id = p_to_user) then raise exception 'USER_NOT_FOUND'; end if;
  if v_msg is not null and char_length(v_msg) > 140 then raise exception 'MESSAGE_TOO_LONG'; end if;
  if p_post_id is not null then
    v_club := (select cp.club_id from public.club_posts cp where cp.id = p_post_id and cp.deleted_at is null);
    v_author := (select cp.author_id from public.club_posts cp where cp.id = p_post_id and cp.deleted_at is null);
    if v_club is null or not private.can_engage_post((select cp from public.club_posts cp where cp.id = p_post_id)) or v_author is distinct from p_to_user then raise exception 'FORBIDDEN'; end if;
  end if;
  if p_activity_id is not null and not exists (select 1 from public.activities where id = p_activity_id and user_id = p_to_user) then
    raise exception 'FORBIDDEN';
  end if;
  -- Quà theo mốc: chỉ tặng trên bài chạy của người nhận đạt đúng mốc
  if g.context is not null then
    v_act := coalesce(p_activity_id, (select cp.activity_id from public.club_posts cp where cp.id = p_post_id));
    if v_act is null or not exists (select 1 from public.activities where id = v_act and user_id = p_to_user)
       or not private.gift_context_ok(v_act, g.context) then
      raise exception 'GIFT_CONTEXT_REQUIRED';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('gift:' || v_uid, 0));
  v_list := g.price_xu * v_qty;
  o := private.item_offer(v_uid, 'GIFT', g.code, g.price_xu, v_qty);
  if o is not null and (o->>'eligible')::boolean and o->>'kind' <> 'TRIAL'
     and (o->>'left' is null or (o->>'left')::int >= v_qty) then
    v_total := (o->>'price')::int * v_qty;
    v_promo := (o->>'promo_id')::uuid;
  else
    v_total := v_list;
  end if;
  v_sent := coalesce((select sum(c.amount) from public.cheers c where c.from_user = v_uid and c.gift_code is not null
                       and c.created_at >= private.vn_start(private.vn_day(now()))), 0);
  if v_sent + v_total > coalesce((private.economy_config()->>'giftDailyCapXu')::int, 20000) then raise exception 'GIFT_DAILY_LIMIT'; end if;
  if private.balance(v_uid) < v_total then raise exception 'INSUFFICIENT_BALANCE'; end if;

  -- Đốt Xu: người tặng → hệ thống. Người nhận KHÔNG nhận Xu.
  if v_total > 0 then
    perform private.ledger_post('GIFT', 'gift:' || p_idempotency_key, 'Tặng ' || v_qty || ' × ' || g.name || ' cho ' || private.display_name(p_to_user), v_uid,
      private.debit_entries(v_uid, v_total, private.system_account()));
  end if;
  v_id := gen_random_uuid();
  insert into public.cheers (id, from_user, to_user, amount, list_amount, promo_id, message, activity_id, post_id, club_id, idempotency_key, gift_code, qty)
  values (v_id, v_uid, p_to_user, v_total, v_list, v_promo, v_msg, p_activity_id, p_post_id, v_club, p_idempotency_key, g.code, v_qty);
  if v_promo is not null then
    insert into public.item_promo_redemptions (promo_id, user_id, qty, xu_paid, ref) values (v_promo, v_uid, v_qty, v_total, 'gift:' || p_idempotency_key);
  end if;
  if p_post_id is not null then update public.club_posts set cheer_xu = cheer_xu + v_total where id = p_post_id; end if;

  v_name := private.display_name(v_uid);
  perform private.award(p_to_user, 'GIFT_IN', v_name || ' tặng bạn ' || case when v_qty > 1 then v_qty || ' × ' else '' end || g.emoji || ' ' || g.name,
    v_msg, 0, 0, 'gift_in:' || v_id, p_activity_id, jsonb_build_object('from', v_uid, 'gift', g.code, 'emoji', g.emoji, 'qty', v_qty, 'tier', g.tier,
      'kind', g.kind, 'art_url', g.art_url));
  perform private.notify(p_to_user, v_club, 'GIFT', v_name || ' tặng bạn ' || case when v_qty > 1 then v_qty || ' × ' else '' end || g.emoji || ' ' || g.name,
    coalesce(v_msg, g.description), case when p_activity_id is not null then '/activities/' || p_activity_id
                                         when v_club is not null then '/clubs/' || v_club else '/me' end, v_uid, g.kind = 'ANIMATED');
  return jsonb_build_object('gift_id', v_id, 'total_xu', v_total, 'list_xu', v_list, 'emoji', g.emoji, 'tier', g.tier, 'kind', g.kind,
    'art_url', g.art_url, 'price_xu', g.price_xu, 'qty', v_qty, 'balance', private.balance(v_uid));
end $$;
-- ---------------------------------------------------------------------
-- 2. Bài chạy chờ duyệt: báo người chạy kèm lý do + giải trình
-- ---------------------------------------------------------------------
alter table public.activities add column if not exists owner_note text;
alter table public.activities add column if not exists owner_note_at timestamptz;

/** Lý do chờ duyệt viết cho người chạy: bỏ phần "Mức nghi vấn: …." đầu câu và câu "Bài được tính sau khi…" cuối câu */
create or replace function private.pending_reason_text(p_reason text) returns text
language sql immutable as $$
  select nullif(trim(regexp_replace(regexp_replace(coalesce(p_reason, ''), '^Mức nghi vấn: [^.]*\.\s*', ''), '\s*Bài được tính sau khi.*$', '')), '')
$$;

create or replace function private.run_pending_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_reason text;
begin
  if new.validation_status is distinct from 'PENDING' or new.user_id is null then return new; end if;
  if tg_op = 'UPDATE' and old.validation_status is not distinct from 'PENDING' then return new; end if;
  -- Bài ghi trong app: người chạy thấy ngay trên màn hình kết quả. Bài cũ / bài trước khi kết nối: không báo.
  if new.source = 'DIRECT_GPS' or new.rewarded_at is not null or coalesce(new.started_at, now()) < now() - interval '2 days' then return new; end if;
  begin
    -- validation_reason là lời báo ngắn cho người chạy (friendly_review, 009700); không có thì dùng lý do chi tiết của hệ thống
    v_reason := coalesce(private.pending_reason_text(new.validation_reason), private.pending_reason_text(new.review_detail),
                         'Dữ liệu bài chạy cần được xác minh.');
    perform private.notify(new.user_id, null, 'RUN_PENDING',
      'Bài chạy "' || left(coalesce(nullif(new.title, ''), 'Buổi chạy'), 60) || '" đang chờ xác minh',
      left(v_reason, 200) || ' Bạn có thể gửi giải trình ngay trong bài chạy.', '/activities/' || new.id, null, true);
  exception when others then
    raise warning 'run_pending_notify % lỗi: % %', new.id, sqlstate, sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists trg_zz_run_pending on public.activities;
create trigger trg_zz_run_pending after insert or update of validation_status on public.activities
  for each row execute function private.run_pending_notify();

/** Người chạy giải trình cho bài đang chờ xác minh (5–500 ký tự; gửi lại thì thay bản cũ) */
create or replace function public.explain_pending_run(p_activity_id uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  a public.activities := (select x from public.activities x where x.id = p_activity_id for update);
  v_note text := trim(coalesce(p_note, ''));
begin
  if a.id is null or a.user_id <> v_uid then raise exception 'FORBIDDEN'; end if;
  if a.validation_status <> 'PENDING' then raise exception 'ACTIVITY_NOT_PENDING'; end if;
  if char_length(v_note) not between 5 and 500 then raise exception 'INVALID_NOTE'; end if;
  if a.owner_note_at is not null and a.owner_note_at > now() - interval '10 seconds' then raise exception 'RATE_LIMITED'; end if;
  update public.activities set owner_note = v_note, owner_note_at = now() where id = a.id;
  return jsonb_build_object('owner_note', v_note, 'owner_note_at', now());
end $$;

create or replace function public.activity_review_info(p_activity uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a public.activities := (select x from public.activities x where x.id = p_activity);
begin
  if a.id is null or a.user_id is distinct from auth.uid() then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object('status', a.validation_status, 'reason', a.validation_reason,
    'can_accept_verified', private.can_accept_verified(a),
    'gap_distance_m', round(private.gap_meters(a.risk_flags)),
    'verified_distance_m', greatest(round(coalesce(a.distance_m, 0) - private.gap_meters(a.risk_flags)), 0),
    'owner_note', a.owner_note, 'owner_note_at', a.owner_note_at);
end $$;

create or replace function public.club_pending_activities(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.club_is_staff(p_club_id) and not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'title', a.title, 'distance_m', a.distance_m, 'moving_time_s', a.moving_time_s,
      'started_at', a.started_at, 'created_at', a.created_at, 'source', a.source,
      'validation_reason', coalesce(a.review_detail, a.validation_reason), 'risk_score', a.risk_score, 'risk_level', a.risk_level, 'risk_flags', a.risk_flags,
      'user_id', a.user_id, 'can_review', a.user_id <> auth.uid(), 'owner_note', a.owner_note,
      'profiles', jsonb_build_object('display_name', pr.display_name, 'avatar_url', pr.avatar_url))
      order by a.created_at desc), '[]'::jsonb)
    from public.activities a
    join public.club_members m on m.user_id = a.user_id and m.club_id = p_club_id and m.status = 'APPROVED'
    join public.profiles pr on pr.id = a.user_id
   where a.validation_status = 'PENDING' and coalesce(a.status, '') <> 'DELETED'
     and (a.shared or public.is_system_admin()));
end $$;

-- ---------------------------------------------------------------------
-- 3. Vinh danh theo cự ly (bản 004900 + hạng mục DIST<mét>)
-- ---------------------------------------------------------------------
create or replace function private.honor_compute(c public.challenges, p_cats jsonb)
returns table (category text, rank integer, user_id uuid, value numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  cat jsonb;
  k text;
  n int;
  v_len interval := c.end_date - c.start_date;
begin
  for cat in select * from jsonb_array_elements(coalesce(p_cats, '[]'::jsonb)) loop
    k := cat->>'key';
    n := least(10, greatest(1, coalesce((cat->>'count')::int, 3)));
    if k = 'TOP' then
      return query select k, x.rn::int, x.pid, x.v from (
        select p.profile_id as pid, p.current_progress as v,
               row_number() over (order by p.current_progress desc, p.completed_at asc nulls last, p.joined_at) as rn
          from public.challenge_participants p
         where p.challenge_id = c.id and p.status <> 'LEFT' and p.current_progress > 0) x where x.rn <= n;
    elsif k = 'KM' then
      return query select k, x.rn::int, x.pid, x.v from (
        select p.profile_id as pid, round(p.distance_m / 1000.0, 2) as v,
               row_number() over (order by p.distance_m desc, p.joined_at) as rn
          from public.challenge_participants p
         where p.challenge_id = c.id and p.status <> 'LEFT' and p.distance_m > 0) x where x.rn <= n;
    elsif k = 'DAYS' then
      return query select k, x.rn::int, x.pid, x.v from (
        select p.profile_id as pid, p.streak_days::numeric as v,
               row_number() over (order by p.streak_days desc, p.distance_m desc) as rn
          from public.challenge_participants p
         where p.challenge_id = c.id and p.status <> 'LEFT' and p.streak_days > 0) x where x.rn <= n;
    elsif k = 'STREAK' then
      -- chuỗi ngày chạy liên tiếp dài nhất (khoảng trống & đảo)
      return query select k, x.rn::int, x.pid, x.v from (
        select s.pid, s.best::numeric as v, row_number() over (order by s.best desc, s.km desc) as rn
          from (select g.pid, max(g.len) as best, max(g.km) as km
                  from (select d.pid, d.km, count(*) over (partition by d.pid, d.grp) as len
                          from (select p.profile_id as pid, p.distance_m as km, e.day,
                                       e.day - (row_number() over (partition by p.id order by e.day))::int as grp
                                  from public.challenge_participants p
                                  join (select distinct participant_id, day from public.challenge_progress_events where challenge_id = c.id) e
                                    on e.participant_id = p.id
                                 where p.challenge_id = c.id and p.status <> 'LEFT') d) g
                 group by g.pid) s
         where s.best >= 2) x where x.rn <= n;
    elsif k = 'BREAKTHROUGH' then
      -- km trong thử thách trừ km cùng độ dài trước khi bắt đầu; cần ≥ 5 km trong thử thách
      return query select k, x.rn::int, x.pid, x.v from (
        select b.pid, round(b.gain, 2) as v, row_number() over (order by b.gain desc) as rn
          from (select p.profile_id as pid,
                       p.distance_m / 1000.0 - coalesce((select sum(coalesce(a.moving_distance_m, a.distance_m)) / 1000.0 from public.activities a
                                                           where a.user_id = p.profile_id and a.validation_status = 'APPROVED'
                                                             and a.started_at >= c.start_date - v_len and a.started_at < c.start_date), 0) as gain
                  from public.challenge_participants p
                 where p.challenge_id = c.id and p.status <> 'LEFT' and p.distance_m >= 5000) b
         where b.gain > 0) x where x.rn <= n;
    elsif k = 'SUPPORTED' then
      return query select k, x.rn::int, x.pid, x.v from (
        select t.pid, t.s as v, row_number() over (order by t.s desc) as rn
          from (select cp.profile_id as pid, sum(ch.amount) as s
                  from public.challenge_participants cp
                  join public.cheers ch on ch.to_user = cp.profile_id and ch.gift_code is not null
                                       and ch.created_at >= c.start_date and ch.created_at < c.end_date
                 where cp.challenge_id = c.id and cp.status <> 'LEFT'
                 group by cp.profile_id) t) x where x.rn <= n;
    elsif k ~ '^DIST[0-9]{3,6}$' then
      -- 013100: vinh danh theo cự ly — bài tốt nhất có cự ly ≥ D trong thời gian thử thách, thời gian quy đổi theo pace trung bình
      -- (cách tính như Chinh phục thời gian / Giải chạy). VD bài 21,3 km trong 1:52:00 tính cho 21,097 km là 1:50:56.
      return query select k, x.rn::int, x.pid, x.v from (
        select b.pid, b.best as v, row_number() over (order by b.best, b.at) as rn
          from (select p.profile_id as pid,
                       min(round(a.mt * substr(k, 5)::numeric / a.dist)) as best, min(a.started_at) as at
                  from public.challenge_participants p
                  join (select x.user_id, x.started_at, coalesce(nullif(x.moving_distance_m, 0), x.distance_m) as dist,
                               coalesce(nullif(x.moving_time_s, 0), x.elapsed_time_s) as mt
                          from public.activities x
                         where x.started_at >= c.start_date and x.started_at < c.end_date
                           and x.validation_status = 'APPROVED' and public.activity_is_countable(x.status, x.validation_status)) a
                    on a.user_id = p.profile_id and a.dist >= substr(k, 5)::numeric and a.mt > 0
                 where p.challenge_id = c.id and p.status <> 'LEFT'
                 group by p.profile_id) b) x where x.rn <= n;
    elsif k like 'CUSTOM%' then
      return query select k, x.ord::int, x.pid, null::numeric from (
        select u.v::uuid as pid, u.ord
          from jsonb_array_elements_text(coalesce(cat->'users', '[]'::jsonb)) with ordinality as u(v, ord)
         where exists (select 1 from public.challenge_participants p where p.challenge_id = c.id and p.profile_id = u.v::uuid and p.status <> 'LEFT')) x
       where x.ord <= 10;
    end if;
  end loop;
end $$;

create or replace function private.honor_categories(p jsonb) returns jsonb
language plpgsql immutable as $$
declare v_out jsonb := '[]'::jsonb; cat jsonb; k text; seen text[] := '{}';
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 8 then raise exception 'INVALID_HONOR_CATEGORIES'; end if;
  for cat in select * from jsonb_array_elements(p) loop
    k := cat->>'key';
    if k is null or not (k = any (array['TOP', 'KM', 'DAYS', 'STREAK', 'BREAKTHROUGH', 'SUPPORTED']) or k ~ '^CUSTOM[1-5]$'
                         or (k ~ '^DIST[0-9]{3,6}$' and substr(k, 5)::int between 400 and 250000)) or k = any (seen) then
      raise exception 'INVALID_HONOR_CATEGORIES';
    end if;
    if k like 'CUSTOM%' and (jsonb_typeof(coalesce(cat->'users', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(cat->'users', '[]'::jsonb)) > 10
        or exists (select 1 from jsonb_array_elements_text(coalesce(cat->'users', '[]'::jsonb)) u where u !~ '^[0-9a-fA-F-]{36}$')) then
      raise exception 'INVALID_HONOR_CATEGORIES';
    end if;
    seen := seen || k;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'key', k,
      'title', coalesce(nullif(left(trim(coalesce(cat->>'title', '')), 60), ''), k),
      'count', least(10, greatest(1, coalesce(private.bib_num(cat->'count', 1, 10, 3), 3)))::int,
      'users', case when k like 'CUSTOM%' then coalesce(cat->'users', '[]'::jsonb) else null end));
  end loop;
  return v_out;
end $$;
-- ---------------------------------------------------------------------
-- 4. Sửa thử thách trước khi bắt đầu
-- ---------------------------------------------------------------------
create or replace function public.update_challenge(p_challenge_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.challenges;
  v_title text;
  v_desc text;
  v_target numeric;
  v_min_km numeric;
  v_min_pace numeric;
  v_max_pace numeric;
  v_cap numeric;
  v_start timestamptz;
  v_end timestamptz;
  m record;
begin
  perform 1 from public.challenges where id = p_challenge_id for update;
  c := (select x from public.challenges x where x.id = p_challenge_id);
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if not private.challenge_is_manager(c) then raise exception 'FORBIDDEN'; end if;
  if c.status <> 'ACTIVE' then raise exception 'CHALLENGE_CLOSED'; end if;
  if now() >= c.start_date then raise exception 'CHALLENGE_STARTED'; end if;

  v_title := trim(coalesce(p->>'title', c.title));
  v_desc := case when p ? 'description' then nullif(trim(coalesce(p->>'description', '')), '') else c.description end;
  v_target := coalesce((p->>'target_value')::numeric, c.target_value);
  v_min_km := coalesce((p->>'min_km')::numeric, c.min_km);
  v_min_pace := coalesce((p->>'min_pace')::numeric, c.min_pace);
  v_max_pace := coalesce((p->>'max_pace')::numeric, c.max_pace);
  v_cap := case when p ? 'daily_cap_km' then nullif((p->>'daily_cap_km')::numeric, 0) else c.daily_cap_km end;
  v_start := coalesce((p->>'start_date')::timestamptz, c.start_date);
  v_end := coalesce((p->>'end_date')::timestamptz, c.end_date);

  -- Kiểm tra như lúc tạo (create_challenge_v2)
  if char_length(v_title) not between 3 and 120 then raise exception 'INVALID_TITLE'; end if;
  if v_desc is not null and char_length(v_desc) > 2000 then raise exception 'DESC_TOO_LONG'; end if;
  if v_end <= v_start or v_end - v_start < interval '1 hour' then raise exception 'INVALID_TIME_RANGE'; end if;
  if v_start < now() then raise exception 'INVALID_TIME_RANGE'; end if;
  if c.format = 'TEAM' and v_start < now() + interval '10 minutes' then raise exception 'TEAM_START_TOO_SOON'; end if;
  -- Phí khởi tạo đã trả theo thời lượng: không cho kéo dài hơn
  if v_end - v_start > c.end_date - c.start_date then raise exception 'DURATION_TOO_LONG'; end if;
  if v_target < 0 or v_min_km < 0 or v_min_km > 100 or coalesce(v_cap, 0) < 0 then raise exception 'INVALID_DISTANCE'; end if;
  if v_min_pace <= 0 or v_max_pace < v_min_pace or v_max_pace > 30 then raise exception 'INVALID_PACE'; end if;
  if c.format in ('SOLO_GOAL', 'COLLECTIVE') and c.objective not in ('BEST_TIME', 'BEST_PACE') and v_target <= 0 then raise exception 'TARGET_REQUIRED'; end if;
  if c.objective = 'STREAK_DAYS' and (v_min_km <= 0 or v_target > ceil(extract(epoch from v_end - v_start) / 86400)) then
    raise exception 'INVALID_STREAK';
  end if;

  update public.challenges
     set title = v_title, description = v_desc, target_value = v_target,
         target_km = case when objective = 'DISTANCE' then v_target else target_km end,
         min_km = v_min_km, min_pace = v_min_pace, max_pace = v_max_pace, daily_cap_km = v_cap,
         start_date = v_start, end_date = v_end,
         reg_deadline = case when format = 'TEAM' then least(coalesce(reg_deadline, v_start), v_start)
                             when reg_deadline is null or reg_deadline = c.end_date or reg_deadline > v_end then v_end
                             else reg_deadline end
   where id = c.id;

  -- Bài giới thiệu thử thách trên bảng tin CLB
  update public.club_posts
     set title = v_title, body = coalesce(v_desc, ''),
         meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('target_value', v_target, 'start_date', v_start, 'end_date', v_end)
   where kind = 'CHALLENGE' and deleted_at is null and meta->>'challenge_id' = c.id::text;

  for m in select profile_id from public.challenge_participants
            where challenge_id = c.id and profile_id is not null and coalesce(status, 'JOINED') <> 'LEFT' loop
    perform private.notify(m.profile_id, null, 'CHALLENGE_UPDATED', 'Thử thách "' || left(v_title, 80) || '" vừa được cập nhật',
      'Xem lại thời gian và luật trước khi bắt đầu.', '/challenges/' || c.id, v_uid, true);
  end loop;

  return jsonb_build_object('id', c.id, 'title', v_title, 'start_date', v_start, 'end_date', v_end);
end $$;

-- ---------------------------------------------------------------------
-- 5. Quyền
-- ---------------------------------------------------------------------
revoke all on function private.can_engage_post(public.club_posts), private.pending_reason_text(text), private.run_pending_notify()
  from public, anon, authenticated;
revoke all on function public.explain_pending_run(uuid, text), public.update_challenge(uuid, jsonb) from public, anon;
grant execute on function public.explain_pending_run(uuid, text), public.update_challenge(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001013200_club_avatar_storage_fix.sql
-- ===================================================================
-- 013200: Chỉnh sửa lần 7 — quản trị CLB không đổi được ảnh đại diện CLB.
-- Nguyên nhân: update_club (008900) tự dọn file ảnh cũ bằng "delete from storage.objects". Supabase nay CHẶN xoá thẳng bảng
-- storage ("Direct deletion from storage tables is not allowed. Use the Storage API instead.") → cả giao dịch đổi ảnh bị huỷ,
-- ảnh mới đã tải lên cũng bị app xoá lại. Lỗi chỉ xảy ra khi CLB đã có ảnh cũ (avatar_path khác null) — đúng lúc "đổi" ảnh.
-- Sửa: bỏ việc xoá file trong SQL; app tự xoá file cũ qua Storage API (supabase.storage.remove) sau khi đổi thành công —
-- chính sách club_avatars_staff_delete (008900) vẫn chỉ cho Ban quản trị CLB xoá file trong thư mục của CLB mình.
-- Giữ nguyên chữ ký, kiểu trả về, kiểm tra quyền (chủ / đội trưởng / admin hệ thống) và quyền gọi của update_club.
-- Cần 008900. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create or replace function public.update_club(p_club_id uuid, p_name text default null, p_description text default null,
                                              p_avatar_url text default null, p_avatar_path text default null) returns public.clubs
language plpgsql security definer set search_path = public as $$
declare
  v_club public.clubs;
begin
  if coalesce(public.club_role(p_club_id), '') not in ('OWNER', 'CAPTAIN') then raise exception 'FORBIDDEN'; end if;
  if p_name is not null then
    if trim(p_name) = '' then raise exception 'NAME_REQUIRED'; end if;
    if char_length(trim(p_name)) > 60 then raise exception 'NAME_TOO_LONG'; end if;
  end if;
  if p_description is not null and char_length(p_description) > 300 then raise exception 'DESC_TOO_LONG'; end if;
  begin
    update public.clubs
       set name        = coalesce(nullif(trim(coalesce(p_name, '')), ''), name),
           description = case when p_description is null then description else nullif(trim(p_description), '') end,
           avatar_url  = case when p_avatar_url is null then avatar_url else nullif(trim(p_avatar_url), '') end,
           avatar_path = case when p_avatar_url is null then avatar_path else nullif(trim(coalesce(p_avatar_path, '')), '') end
     where id = p_club_id;
  exception when unique_violation then
    raise exception 'NAME_TAKEN';
  end;
  v_club := (select c from public.clubs c where c.id = p_club_id);
  if v_club.id is null then raise exception 'CLUB_NOT_FOUND'; end if;
  -- 013200: KHÔNG xoá file ảnh cũ ở đây (Supabase cấm xoá thẳng bảng kho ảnh) — app xoá qua Storage API
  return v_club;
end $$;

revoke execute on function public.update_club(uuid, text, text, text, text) from public, anon;
grant execute on function public.update_club(uuid, text, text, text, text) to authenticated;

commit;
