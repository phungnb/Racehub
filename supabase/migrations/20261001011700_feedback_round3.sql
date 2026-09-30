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
