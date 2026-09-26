-- RaceHub — PHẦN 07/12 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 006200, 006300
-- Supabase → SQL Editor → New query → dán TOÀN BỘ phần này → Run. Lỗi thì không có gì thay đổi; chạy lại vẫn an toàn.
-- Xong thì chạy phần tiếp theo.
begin;
-- ===================================================================
-- 20261001006200_knowledge.sql
-- ===================================================================
-- 006200: RaceHub Knowledge — Trung tâm kiến thức & tin tức chạy bộ (docs/KNOWLEDGE.md).
-- • Hai loại nội dung: ARTICLE (kiến thức lâu dài) và NEWS (tin đang diễn ra); 8 chuyên mục.
-- • Vòng đời: DRAFT → REVIEW → SCHEDULED → PUBLISHED → ARCHIVED. Bài sức khoẻ / dinh dưỡng / chấn thương / giáo án
--   phải qua DUYỆT CHUYÊN MÔN (chuyên gia hoặc admin) mới xuất bản được; sửa nội dung sau khi duyệt → duyệt lại.
-- • Người đọc chỉ thấy bài đã xuất bản (và đã tới giờ đăng); mọi thao tác qua RPC, bảng khoá RLS.
-- • Đọc bài KHÔNG cộng Xu / XP (XP chỉ từ km). Hoàn thành chuỗi "Bắt đầu chạy bộ" → huy hiệu (không kèm XP / Xu).
-- • Ban nội dung: EDITOR (duyệt, xuất bản), WRITER (viết nháp, gửi duyệt), EXPERT (duyệt chuyên môn, viết). Admin toàn quyền.
-- Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 1. Bảng
-- ---------------------------------------------------------------------
create table if not exists public.content_categories (
  id text primary key,
  name text not null,
  description text,
  icon text not null default 'BookOpen',
  sort integer not null default 0,
  needs_expert boolean not null default false,     -- bài thuộc chuyên mục này mặc định phải duyệt chuyên môn
  market_kind text check (market_kind is null or market_kind in ('COACH', 'SHOP', 'SERVICE')),
  is_active boolean not null default true
);

create table if not exists public.content_authors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.profiles(id) on delete set null,
  name text not null check (char_length(name) between 2 and 80),
  title text check (title is null or char_length(title) <= 80),
  bio text check (bio is null or char_length(bio) <= 600),
  avatar_url text,
  kind text not null default 'EDITOR' check (kind in ('TEAM', 'EDITOR', 'COACH', 'EXPERT', 'COMMUNITY')),
  partner_id uuid references public.partners(id) on delete set null,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.content_staff (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null check (role in ('EDITOR', 'WRITER', 'EXPERT')),
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.content_series (
  id text primary key,
  title text not null,
  description text,
  badge_code text,
  is_active boolean not null default true
);

create table if not exists public.content_articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 90),
  title text not null check (char_length(title) between 5 and 140),
  summary text check (summary is null or char_length(summary) <= 300),
  body text not null default '' check (char_length(body) <= 60000),
  cover_image_url text,
  category_id text not null references public.content_categories(id),
  author_id uuid references public.content_authors(id) on delete set null,
  content_type text not null default 'ARTICLE' check (content_type in ('ARTICLE', 'NEWS')),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'REVIEW', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED')),
  published_at timestamptz,
  reading_time_minutes integer not null default 1,
  source_url text,                                   -- tin tổng hợp: link bài gốc
  source_name text,
  is_featured boolean not null default false,
  series_id text references public.content_series(id) on delete set null,
  series_order integer,
  ctas jsonb not null default '[]'::jsonb,           -- [{kind, target, label}] dẫn tới tính năng trong app
  needs_expert_review boolean not null default false,
  expert_reviewed_by uuid references public.profiles(id) on delete set null,
  expert_reviewed_at timestamptz,
  expert_note text,
  review_note text,                                  -- ghi chú biên tập / lý do trả về
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  views integer not null default 0,
  reads integer not null default 0,
  saves integer not null default 0,
  shares integer not null default 0,
  cta_clicks integer not null default 0,
  helpful_yes integer not null default 0,
  helpful_no integer not null default 0,
  read_seconds bigint not null default 0
);
create index if not exists content_articles_live_idx on public.content_articles (status, published_at desc);
create index if not exists content_articles_cat_idx on public.content_articles (category_id, published_at desc);

create table if not exists public.content_tags (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null
);
create table if not exists public.content_article_tags (
  article_id uuid not null references public.content_articles(id) on delete cascade,
  tag_id uuid not null references public.content_tags(id) on delete cascade,
  primary key (article_id, tag_id)
);
create table if not exists public.content_sources (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.content_articles(id) on delete cascade,
  title text not null,
  url text,
  publisher text,
  sort integer not null default 0
);
create table if not exists public.content_bookmarks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  article_id uuid not null references public.content_articles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, article_id)
);
create table if not exists public.content_read_history (
  user_id uuid not null references public.profiles(id) on delete cascade,
  article_id uuid not null references public.content_articles(id) on delete cascade,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  progress integer not null default 0 check (progress between 0 and 100),
  seconds integer not null default 0,
  completed_at timestamptz,
  primary key (user_id, article_id)
);
create table if not exists public.content_reviews (
  article_id uuid not null references public.content_articles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  helpful boolean not null,
  comment text check (comment is null or char_length(comment) <= 500),
  created_at timestamptz not null default now(),
  primary key (article_id, user_id)
);
-- Thống kê theo ngày (lượt xem / đọc xong / chia sẻ / bấm hành động) + chống đếm trùng mỗi người mỗi ngày
create table if not exists public.content_daily_stats (
  article_id uuid not null references public.content_articles(id) on delete cascade,
  day date not null,
  views integer not null default 0,
  reads integer not null default 0,
  shares integer not null default 0,
  cta_clicks integer not null default 0,
  primary key (article_id, day)
);
create table if not exists public.content_user_events (
  user_id uuid not null references public.profiles(id) on delete cascade,
  article_id uuid not null references public.content_articles(id) on delete cascade,
  kind text not null,
  day date not null,
  primary key (user_id, article_id, kind, day)
);

alter table public.content_categories enable row level security;
alter table public.content_authors enable row level security;
alter table public.content_staff enable row level security;
alter table public.content_series enable row level security;
alter table public.content_articles enable row level security;
alter table public.content_tags enable row level security;
alter table public.content_article_tags enable row level security;
alter table public.content_sources enable row level security;
alter table public.content_bookmarks enable row level security;
alter table public.content_read_history enable row level security;
alter table public.content_reviews enable row level security;
alter table public.content_daily_stats enable row level security;
alter table public.content_user_events enable row level security;
revoke all on public.content_categories, public.content_authors, public.content_staff, public.content_series, public.content_articles,
  public.content_tags, public.content_article_tags, public.content_sources, public.content_bookmarks, public.content_read_history,
  public.content_reviews, public.content_daily_stats, public.content_user_events from anon, authenticated;

-- Kho ảnh bài viết: content-media/<user_id>/<file> — chỉ ban nội dung / admin tải lên
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('content-media', 'content-media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create or replace function public.can_upload_content_media(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select (storage.foldername(p_name))[1] = auth.uid()::text
     and (public.is_system_admin() or exists (select 1 from public.content_staff s where s.user_id = auth.uid()))
$$;
revoke all on function public.can_upload_content_media(text) from public, anon;
grant execute on function public.can_upload_content_media(text) to authenticated;
drop policy if exists content_media_insert on storage.objects;
create policy content_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'content-media' and public.can_upload_content_media(name));

-- ---------------------------------------------------------------------
-- 2. Dữ liệu gốc: 8 chuyên mục, chuỗi người mới, huy hiệu, tác giả Ban biên tập
-- ---------------------------------------------------------------------
insert into public.content_categories (id, name, description, icon, sort, needs_expert, market_kind) values
  ('BEGINNER', 'Bắt đầu chạy bộ', 'Chọn giày, kỹ thuật cơ bản, cách bắt đầu chạy 5K', 'Sprout', 1, false, null),
  ('TRAINING', 'Giáo án & luyện tập', '5K, 10K, Half Marathon, Marathon; pace, interval, long run', 'ClipboardList', 2, true, 'COACH'),
  ('NUTRITION', 'Dinh dưỡng & phục hồi', 'Gel, nước, điện giải, giấc ngủ, nghỉ ngơi và phục hồi', 'Apple', 3, true, 'SERVICE'),
  ('INJURY', 'Phòng tránh chấn thương', 'Tải lượng tập, dấu hiệu cần nghỉ, khi nào nên gặp chuyên gia', 'HeartPulse', 4, true, 'SERVICE'),
  ('GEAR', 'Thiết bị & trang phục', 'Giày, đồng hồ, áo chạy, phụ kiện và kinh nghiệm lựa chọn', 'Footprints', 5, false, 'SHOP'),
  ('RACES', 'Giải chạy & sự kiện', 'Lịch giải, kinh nghiệm thi đấu, race review và kết quả', 'Medal', 6, false, null),
  ('STORIES', 'Câu chuyện Runner', 'Hành trình PR, hoàn thành FM, câu chuyện CLB và cộng đồng', 'Sparkles', 7, false, null),
  ('APP', 'Hướng dẫn RaceHub', 'XP, Xu, Challenge, Avatar, Market, Club và các tính năng app', 'Smartphone', 8, false, null)
on conflict (id) do update set name = excluded.name, description = excluded.description, icon = excluded.icon, sort = excluded.sort,
  market_kind = excluded.market_kind;

insert into public.achievements (code, title, description, category, tier, icon, rule, xp_reward, xu_reward, sort)
values ('LEARN_STARTER', 'Runner ham học', 'Đọc hết chuỗi bài "Bắt đầu chạy bộ" trong RaceHub Knowledge', 'LEARN', 'BRONZE', 'GraduationCap', null, 0, 0, 80)
on conflict (code) do nothing;

insert into public.content_series (id, title, description, badge_code) values
  ('STARTER', 'Bắt đầu chạy bộ', 'Chuỗi bài cho người mới: từ đôi giày đầu tiên tới 5 km đầu tiên', 'LEARN_STARTER')
on conflict (id) do nothing;

insert into public.content_authors (id, name, title, bio, kind, verified)
values ('00000000-0000-0000-0000-00000000c0a1', 'Ban biên tập RaceHub', 'Đội ngũ RaceHub',
        'Hướng dẫn sử dụng app và tin tức từ đội ngũ RaceHub.', 'TEAM', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 3. Hàm nội bộ
-- ---------------------------------------------------------------------
-- Vai trò nội dung của người gọi: ADMIN / EDITOR / WRITER / EXPERT / null
create or replace function private.content_role(p_uid uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from public.profiles where id = p_uid and (role = 'SYSTEM_ADMIN' or is_admin is true)) then 'ADMIN'
              else (select s.role from public.content_staff s where s.user_id = p_uid) end
$$;

create or replace function private.content_live(a public.content_articles) returns boolean
language sql stable as $$
  select a.status in ('PUBLISHED', 'SCHEDULED') and a.published_at is not null and a.published_at <= now()
$$;

-- ~200 từ / phút (tiếng Việt), tối thiểu 1 phút
create or replace function private.reading_minutes(p_body text) returns integer
language sql immutable as $$
  select greatest(1, round(coalesce(array_length(regexp_split_to_array(trim(coalesce(p_body, '')), '\s+'), 1), 0) / 200.0)::int)
$$;

create or replace function private.slugify(p text) returns text
language sql immutable as $$
  select left(trim(both '-' from regexp_replace(private.search_key(p), '\s+', '-', 'g')), 80)
$$;

-- Thẻ bài (danh sách): kèm trạng thái của người đọc
create or replace function private.content_card(a public.content_articles, p_uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', a.id, 'slug', a.slug, 'title', a.title, 'summary', a.summary, 'cover_image_url', a.cover_image_url,
    'category_id', a.category_id, 'category_name', (select c.name from public.content_categories c where c.id = a.category_id),
    'content_type', a.content_type, 'reading_time_minutes', a.reading_time_minutes, 'published_at', a.published_at,
    'author_name', (select au.name from public.content_authors au where au.id = a.author_id),
    'is_featured', a.is_featured, 'source_name', a.source_name,
    'saved', exists (select 1 from public.content_bookmarks b where b.user_id = p_uid and b.article_id = a.id),
    'progress', coalesce((select h.progress from public.content_read_history h where h.user_id = p_uid and h.article_id = a.id), 0),
    'completed', exists (select 1 from public.content_read_history h where h.user_id = p_uid and h.article_id = a.id and h.completed_at is not null))
$$;

-- Ghi thống kê ngày (đã chống trùng ở nơi gọi)
create or replace function private.content_bump(p_article uuid, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.content_daily_stats (article_id, day, views, reads, shares, cta_clicks)
  values (p_article, (now() at time zone 'Asia/Ho_Chi_Minh')::date,
          (p_kind = 'VIEW')::int, (p_kind = 'READ')::int, (p_kind = 'SHARE')::int, (p_kind = 'CTA')::int)
  on conflict (article_id, day) do update set
    views = content_daily_stats.views + (p_kind = 'VIEW')::int, reads = content_daily_stats.reads + (p_kind = 'READ')::int,
    shares = content_daily_stats.shares + (p_kind = 'SHARE')::int, cta_clicks = content_daily_stats.cta_clicks + (p_kind = 'CTA')::int;
  update public.content_articles set
    views = views + (p_kind = 'VIEW')::int, reads = reads + (p_kind = 'READ')::int,
    shares = shares + (p_kind = 'SHARE')::int, cta_clicks = cta_clicks + (p_kind = 'CTA')::int
   where id = p_article;
end $$;

-- Hành động cuối bài: chỉ các loại đã biết, tối đa 3
create or replace function private.clean_ctas(p jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind', x.kind, 'target', nullif(left(trim(coalesce(x.target, '')), 80), ''),
                                               'label', nullif(left(trim(coalesce(x.label, '')), 40), '')) order by x.n), '[]'::jsonb)
    from (select e->>'kind' as kind, e->>'target' as target, e->>'label' as label, n
            from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) with ordinality t(e, n)) x
   where x.kind in ('GOAL', 'CHALLENGES', 'CHALLENGE', 'RACES', 'RACE', 'MARKET', 'PARTNER', 'CLUBS', 'CLUB', 'NEARBY',
                    'CHARACTER', 'ONBOARDING', 'WALLET', 'ARTICLE', 'LINK')
     and (x.kind <> 'LINK' or coalesce(x.target, '') ~ '^/[^/\\]')
     and x.n <= 3
$$;

-- ---------------------------------------------------------------------
-- 4. Người đọc
-- ---------------------------------------------------------------------
create or replace function public.knowledge_home() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  return jsonb_build_object(
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description, 'icon', c.icon,
                      'count', (select count(*) from public.content_articles a where a.category_id = c.id and private.content_live(a)))
                    order by c.sort), '[]'::jsonb) from public.content_categories c where c.is_active),
    'featured', (select coalesce(jsonb_agg(private.content_card(y.a, v_uid) order by y.rn), '[]'::jsonb) from (
                   select a, row_number() over (order by a.is_featured desc, a.published_at desc) rn
                     from public.content_articles a where private.content_live(a) and a.content_type = 'ARTICLE') y where y.rn <= 4),
    'news', (select coalesce(jsonb_agg(private.content_card(y.a, v_uid) order by y.rn), '[]'::jsonb) from (
               select a, row_number() over (order by a.published_at desc) rn
                 from public.content_articles a where private.content_live(a) and a.content_type = 'NEWS') y where y.rn <= 5),
    'continue', (select coalesce(jsonb_agg(private.content_card(y.a, v_uid) order by y.rn), '[]'::jsonb) from (
                   select a, row_number() over (order by h.last_at desc) rn
                     from public.content_read_history h join public.content_articles a on a.id = h.article_id
                    where h.user_id = v_uid and h.completed_at is null and h.progress between 5 and 89 and private.content_live(a)) y where y.rn <= 3),
    'series', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'description', s.description, 'badge_code', s.badge_code,
                  'total', (select count(*) from public.content_articles a where a.series_id = s.id and private.content_live(a)),
                  'done', (select count(*) from public.content_articles a join public.content_read_history h on h.article_id = a.id
                            where a.series_id = s.id and private.content_live(a) and h.user_id = v_uid and h.completed_at is not null),
                  'next_slug', (select y.slug from (select a.slug, row_number() over (order by a.series_order, a.published_at) rn
                                  from public.content_articles a where a.series_id = s.id and private.content_live(a)
                                   and not exists (select 1 from public.content_read_history h where h.article_id = a.id and h.user_id = v_uid
                                                    and h.completed_at is not null)) y where y.rn = 1))), '[]'::jsonb)
                 from public.content_series s where s.is_active
                  and exists (select 1 from public.content_articles a where a.series_id = s.id and private.content_live(a))),
    'saved_count', (select count(*) from public.content_bookmarks b join public.content_articles a on a.id = b.article_id
                     where b.user_id = v_uid and private.content_live(a)));
end $$;

-- p: {category, type: ARTICLE|NEWS, tag, q, saved: bool, offset}
create or replace function public.knowledge_list(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_cat text := nullif(p->>'category', '');
  v_type text := nullif(upper(coalesce(p->>'type', '')), '');
  v_tag text := nullif(p->>'tag', '');
  v_q text := coalesce(p->>'q', '');
  v_saved boolean := coalesce((p->>'saved')::boolean, false);
  v_offset integer := greatest(0, coalesce((p->>'offset')::int, 0));
begin
  return (
    with f as (
      select a, case when private.search_key(v_q) = '' then 0 else private.search_rank(a.title, v_q) end as rk
        from public.content_articles a
       where private.content_live(a)
         and (v_cat is null or a.category_id = v_cat)
         and (v_type is null or a.content_type = v_type)
         and (v_tag is null or exists (select 1 from public.content_article_tags at join public.content_tags t on t.id = at.tag_id
                                        where at.article_id = a.id and t.slug = v_tag))
         and (not v_saved or exists (select 1 from public.content_bookmarks b where b.user_id = v_uid and b.article_id = a.id))
         and (private.search_key(v_q) = '' or private.search_match(
               private.search_hay(a.title) || ' ' || private.search_key(coalesce(a.summary, '')) || ' '
               || coalesce((select string_agg(private.search_key(t.name), ' ') from public.content_article_tags at
                              join public.content_tags t on t.id = at.tag_id where at.article_id = a.id), '') || ' ', v_q))
    ), r as (
      select f.a, row_number() over (order by f.rk, (f.a).published_at desc) as rn from f
    )
    select jsonb_build_object('total', (select count(*) from f),
      'items', coalesce((select jsonb_agg(private.content_card(r.a, v_uid) order by r.rn) from r
                          where r.rn > v_offset and r.rn <= v_offset + 20), '[]'::jsonb)));
end $$;

-- Mở bài: ghi lượt xem (mỗi người tối đa 1 lượt / ngày). Ban nội dung xem trước được bài chưa đăng.
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
  if not v_live and v_role is null then raise exception 'ARTICLE_NOT_FOUND'; end if;
  if v_live then
    insert into public.content_read_history (user_id, article_id) values (v_uid, a.id)
    on conflict (user_id, article_id) do update set last_at = now();
    insert into public.content_user_events (user_id, article_id, kind, day)
    values (v_uid, a.id, 'VIEW', (now() at time zone 'Asia/Ho_Chi_Minh')::date) on conflict do nothing;
    if found then perform private.content_bump(a.id, 'VIEW'); end if;
  end if;
  return private.content_card(a, v_uid) || jsonb_build_object(
    'body', a.body, 'preview', not v_live, 'status', a.status, 'updated_at', a.updated_at, 'source_url', a.source_url,
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

-- Tiến độ đọc (gọi khi cuộn / rời bài). Đọc xong = cuộn ≥ 90 % và đọc đủ lâu (≥ 30 % thời gian ước tính, tối đa 60 giây).
-- Không cộng Xu / XP. Hoàn thành cả chuỗi → huy hiệu của chuỗi.
create or replace function public.knowledge_progress(p_id uuid, p_progress integer, p_seconds integer default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  a public.content_articles := (select x from public.content_articles x where x.id = p_id);
  h public.content_read_history;
  v_done boolean := false;
  v_badge text;
  v_total integer;
  v_read integer;
begin
  if a.id is null or not private.content_live(a) then raise exception 'ARTICLE_NOT_FOUND'; end if;
  insert into public.content_read_history (user_id, article_id, progress, seconds)
  values (v_uid, a.id, least(100, greatest(0, coalesce(p_progress, 0))), least(600, greatest(0, coalesce(p_seconds, 0))))
  on conflict (user_id, article_id) do update set
    progress = greatest(content_read_history.progress, excluded.progress),
    seconds = least(content_read_history.seconds + excluded.seconds, 36000), last_at = now();
  update public.content_articles set read_seconds = read_seconds + least(600, greatest(0, coalesce(p_seconds, 0))) where id = a.id;
  h := (select x from public.content_read_history x where x.user_id = v_uid and x.article_id = a.id);
  if h.completed_at is null and h.progress >= 90 and h.seconds >= least(60, a.reading_time_minutes * 18) then
    update public.content_read_history set completed_at = now() where user_id = v_uid and article_id = a.id;
    perform private.content_bump(a.id, 'READ');
    v_done := true;
    if a.series_id is not null then
      v_total := (select count(*) from public.content_articles x where x.series_id = a.series_id and private.content_live(x));
      v_read := (select count(*) from public.content_articles x join public.content_read_history r on r.article_id = x.id
                  where x.series_id = a.series_id and private.content_live(x) and r.user_id = v_uid and r.completed_at is not null);
      v_badge := (select s.badge_code from public.content_series s where s.id = a.series_id);
      if v_total > 0 and v_read >= v_total and v_badge is not null
         and not exists (select 1 from public.user_achievements ua join public.achievements ac on ac.id = ua.achievement_id
                          where ua.user_id = v_uid and ac.code = v_badge) then
        insert into public.user_achievements (user_id, achievement_id)
        select v_uid, ac.id from public.achievements ac where ac.code = v_badge;
        perform private.notify(v_uid, null, 'BADGE', 'Huy hiệu mới: ' || coalesce((select title from public.achievements where code = v_badge), v_badge),
          'Bạn đã đọc hết chuỗi "' || (select title from public.content_series where id = a.series_id) || '".', '/learn', null, false);
      else
        v_badge := null;
      end if;
    end if;
  end if;
  return jsonb_build_object('progress', h.progress, 'completed', h.completed_at is not null or v_done, 'just_completed', v_done, 'badge', v_badge);
end $$;

create or replace function public.knowledge_bookmark(p_id uuid, p_on boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  a public.content_articles := (select x from public.content_articles x where x.id = p_id);
begin
  if a.id is null or (p_on and not private.content_live(a)) then raise exception 'ARTICLE_NOT_FOUND'; end if;
  if p_on then
    insert into public.content_bookmarks (user_id, article_id) values (v_uid, a.id) on conflict do nothing;
    if found then update public.content_articles set saves = saves + 1 where id = a.id; end if;
  else
    delete from public.content_bookmarks where user_id = v_uid and article_id = a.id;
    if found then update public.content_articles set saves = greatest(0, saves - 1) where id = a.id; end if;
  end if;
  return p_on;
end $$;

create or replace function public.knowledge_feedback(p_id uuid, p_helpful boolean, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  a public.content_articles := (select x from public.content_articles x where x.id = p_id);
begin
  if a.id is null or not private.content_live(a) then raise exception 'ARTICLE_NOT_FOUND'; end if;
  insert into public.content_reviews (article_id, user_id, helpful, comment)
  values (a.id, v_uid, p_helpful, nullif(left(trim(coalesce(p_comment, '')), 500), ''))
  on conflict (article_id, user_id) do update set helpful = excluded.helpful, comment = coalesce(excluded.comment, content_reviews.comment), created_at = now();
  update public.content_articles set
    helpful_yes = (select count(*) from public.content_reviews r where r.article_id = a.id and r.helpful),
    helpful_no = (select count(*) from public.content_reviews r where r.article_id = a.id and not r.helpful)
   where id = a.id;
end $$;

-- Chia sẻ / bấm hành động cuối bài: đếm tối đa 1 lần / người / ngày / loại
create or replace function public.knowledge_track(p_id uuid, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  a public.content_articles := (select x from public.content_articles x where x.id = p_id);
begin
  if upper(p_kind) not in ('SHARE', 'CTA') then raise exception 'INVALID_KIND'; end if;
  if a.id is null or not private.content_live(a) then return; end if;
  insert into public.content_user_events (user_id, article_id, kind, day)
  values (v_uid, a.id, upper(p_kind), (now() at time zone 'Asia/Ho_Chi_Minh')::date) on conflict do nothing;
  if found then perform private.content_bump(a.id, upper(p_kind)); end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. CMS (ban nội dung + admin)
-- ---------------------------------------------------------------------
create or replace function private.require_content_staff() returns text
language plpgsql stable security definer set search_path = public as $$
declare v_role text := private.content_role(private.require_uid());
begin
  if v_role is null then raise exception 'FORBIDDEN'; end if;
  return v_role;
end $$;

create or replace function public.cms_meta() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_role text := private.require_content_staff();
begin
  return jsonb_build_object('role', v_role,
    'categories', (select coalesce(jsonb_agg(to_jsonb(c) order by c.sort), '[]'::jsonb) from public.content_categories c),
    'authors', (select coalesce(jsonb_agg(to_jsonb(au) || jsonb_build_object('user_name', private.display_name(au.user_id)) order by au.name), '[]'::jsonb)
                  from public.content_authors au),
    'series', (select coalesce(jsonb_agg(to_jsonb(s) order by s.title), '[]'::jsonb) from public.content_series s),
    'tags', (select coalesce(jsonb_agg(jsonb_build_object('slug', t.slug, 'name', t.name) order by t.name), '[]'::jsonb) from public.content_tags t),
    'staff', (select coalesce(jsonb_agg(jsonb_build_object('user_id', s.user_id, 'name', private.display_name(s.user_id), 'role', s.role, 'at', s.created_at)
                 order by s.created_at), '[]'::jsonb) from public.content_staff s),
    'counts', (select jsonb_object_agg(x.status, x.n) from (select a.status, count(*) n from public.content_articles a group by a.status) x));
end $$;

-- p: {status, category, type, q, mine, offset}
create or replace function public.cms_list(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_role text := private.require_content_staff();
  v_status text := nullif(upper(coalesce(p->>'status', '')), 'ALL');
  v_cat text := nullif(p->>'category', '');
  v_type text := nullif(upper(coalesce(p->>'type', '')), '');
  v_q text := coalesce(p->>'q', '');
  v_mine boolean := coalesce((p->>'mine')::boolean, false);
  v_offset integer := greatest(0, coalesce((p->>'offset')::int, 0));
begin
  v_status := nullif(v_status, '');
  return (
    with f as (
      select a from public.content_articles a
       where (v_status is null or a.status = v_status or (v_status = 'EXPERT' and a.needs_expert_review and a.expert_reviewed_at is null
                                                          and a.status in ('REVIEW', 'DRAFT')))
         and (v_cat is null or a.category_id = v_cat) and (v_type is null or a.content_type = v_type)
         and (not v_mine or a.created_by = v_uid)
         and (private.search_key(v_q) = '' or private.search_match(private.search_hay(a.title) || ' ' || a.slug || ' ', v_q))
    ), r as (select f.a, row_number() over (order by (f.a).updated_at desc) rn from f)
    select jsonb_build_object('total', (select count(*) from f),
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', (r.a).id, 'slug', (r.a).slug, 'title', (r.a).title, 'status', (r.a).status,
          'content_type', (r.a).content_type, 'category_id', (r.a).category_id, 'published_at', (r.a).published_at, 'updated_at', (r.a).updated_at,
          'is_featured', (r.a).is_featured, 'cover_image_url', (r.a).cover_image_url,
          'author_name', (select au.name from public.content_authors au where au.id = (r.a).author_id),
          'created_by_name', private.display_name((r.a).created_by), 'mine', (r.a).created_by = v_uid,
          'needs_expert_review', (r.a).needs_expert_review, 'expert_reviewed_at', (r.a).expert_reviewed_at, 'review_note', (r.a).review_note,
          'live', private.content_live(r.a),
          'views', (r.a).views, 'reads', (r.a).reads, 'saves', (r.a).saves, 'cta_clicks', (r.a).cta_clicks,
          'helpful_yes', (r.a).helpful_yes, 'helpful_no', (r.a).helpful_no) order by r.rn)
        from r where r.rn > v_offset and r.rn <= v_offset + 30), '[]'::jsonb)));
end $$;

create or replace function public.cms_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_role text := private.require_content_staff();
  a public.content_articles := (select x from public.content_articles x where x.id = p_id);
begin
  if a.id is null then raise exception 'ARTICLE_NOT_FOUND'; end if;
  return to_jsonb(a) || jsonb_build_object(
    'tags', (select coalesce(jsonb_agg(t.name order by t.name), '[]'::jsonb) from public.content_article_tags at
               join public.content_tags t on t.id = at.tag_id where at.article_id = a.id),
    'sources', (select coalesce(jsonb_agg(jsonb_build_object('title', s.title, 'url', s.url, 'publisher', s.publisher) order by s.sort), '[]'::jsonb)
                  from public.content_sources s where s.article_id = a.id),
    'expert_name', private.display_name(a.expert_reviewed_by), 'created_by_name', private.display_name(a.created_by),
    'feedback', (select coalesce(jsonb_agg(jsonb_build_object('helpful', r.helpful, 'comment', r.comment, 'at', r.created_at) order by r.created_at desc), '[]'::jsonb)
                   from public.content_reviews r where r.article_id = a.id and r.comment is not null));
end $$;

-- Tạo / sửa bài. p: {id?, title, slug?, summary, body, cover_image_url, category_id, content_type, author_id, tags[], sources[],
--                    ctas[], is_featured, series_id, series_order, source_url, source_name, needs_expert_review}
-- WRITER / EXPERT chỉ sửa bài mình tạo khi còn DRAFT / REVIEW. Sửa nội dung sau khi đã duyệt chuyên môn → phải duyệt lại.
create or replace function public.cms_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_role text := private.require_content_staff();
  a public.content_articles := (select x from public.content_articles x where x.id = nullif(p->>'id', '')::uuid);
  v_id uuid;
  v_title text := trim(coalesce(p->>'title', ''));
  v_slug text := nullif(private.slugify(coalesce(nullif(p->>'slug', ''), p->>'title')), '');
  v_body text := coalesce(p->>'body', '');
  v_cat text := coalesce(nullif(p->>'category_id', ''), a.category_id);
  v_expert boolean;
  v_editor boolean := v_role in ('ADMIN', 'EDITOR');
begin
  if nullif(p->>'id', '') is not null and a.id is null then raise exception 'ARTICLE_NOT_FOUND'; end if;
  if a.id is not null and not v_editor and (a.created_by is distinct from v_uid or a.status not in ('DRAFT', 'REVIEW')) then
    raise exception 'FORBIDDEN';
  end if;
  if char_length(v_title) < 5 then raise exception 'TITLE_TOO_SHORT'; end if;
  if v_slug is null then raise exception 'INVALID_SLUG'; end if;
  if not exists (select 1 from public.content_categories c where c.id = v_cat) then raise exception 'INVALID_CATEGORY'; end if;
  if exists (select 1 from public.content_articles x where x.slug = v_slug and x.id is distinct from a.id) then raise exception 'SLUG_TAKEN'; end if;
  if nullif(p->>'cover_image_url', '') is not null and p->>'cover_image_url' !~ '^https://' then raise exception 'INVALID_URL'; end if;
  if nullif(p->>'source_url', '') is not null and p->>'source_url' !~ '^https?://' then raise exception 'INVALID_URL'; end if;
  -- Chuyên mục sức khoẻ / giáo án luôn cần duyệt chuyên môn; chỉ admin tắt được
  v_expert := (select c.needs_expert from public.content_categories c where c.id = v_cat)
              or coalesce((p->>'needs_expert_review')::boolean, a.needs_expert_review, false);
  if v_role = 'ADMIN' and (p ? 'needs_expert_review') then v_expert := (p->>'needs_expert_review')::boolean; end if;

  if a.id is null then
    insert into public.content_articles (slug, title, summary, body, cover_image_url, category_id, author_id, content_type, reading_time_minutes,
      source_url, source_name, is_featured, series_id, series_order, ctas, needs_expert_review, created_by)
    values (v_slug, v_title, nullif(left(trim(coalesce(p->>'summary', '')), 300), ''), v_body, nullif(p->>'cover_image_url', ''), v_cat,
      coalesce(nullif(p->>'author_id', '')::uuid, (select au.id from public.content_authors au where au.user_id = v_uid)),
      case when upper(coalesce(p->>'content_type', '')) = 'NEWS' then 'NEWS' else 'ARTICLE' end, private.reading_minutes(v_body),
      nullif(p->>'source_url', ''), nullif(left(trim(coalesce(p->>'source_name', '')), 80), ''),
      v_editor and coalesce((p->>'is_featured')::boolean, false), nullif(p->>'series_id', ''), nullif(p->>'series_order', '')::int,
      private.clean_ctas(p->'ctas'), v_expert, v_uid)
    returning id into v_id;
  else
    v_id := a.id;
    update public.content_articles set slug = v_slug, title = v_title, summary = nullif(left(trim(coalesce(p->>'summary', '')), 300), ''),
      body = v_body, cover_image_url = nullif(p->>'cover_image_url', ''), category_id = v_cat,
      author_id = case when p ? 'author_id' then nullif(p->>'author_id', '')::uuid else author_id end,
      content_type = case when upper(coalesce(p->>'content_type', '')) = 'NEWS' then 'NEWS' else 'ARTICLE' end,
      reading_time_minutes = private.reading_minutes(v_body),
      source_url = nullif(p->>'source_url', ''), source_name = nullif(left(trim(coalesce(p->>'source_name', '')), 80), ''),
      is_featured = case when v_editor then coalesce((p->>'is_featured')::boolean, is_featured) else is_featured end,
      series_id = nullif(p->>'series_id', ''), series_order = nullif(p->>'series_order', '')::int,
      ctas = private.clean_ctas(p->'ctas'), needs_expert_review = v_expert,
      -- nội dung chuyên môn đổi mà người sửa không phải chuyên gia → duyệt lại
      expert_reviewed_at = case when body is distinct from v_body and v_role not in ('ADMIN', 'EXPERT') then null else expert_reviewed_at end,
      expert_reviewed_by = case when body is distinct from v_body and v_role not in ('ADMIN', 'EXPERT') then null else expert_reviewed_by end,
      updated_at = now()
     where id = v_id;
    -- bài đang đăng mất duyệt chuyên môn → gỡ về chờ duyệt
    update public.content_articles set status = 'REVIEW', review_note = 'Nội dung đã đổi — cần duyệt chuyên môn lại'
     where id = v_id and needs_expert_review and expert_reviewed_at is null and status in ('SCHEDULED', 'PUBLISHED');
  end if;

  -- Tag: tạo mới nếu chưa có
  delete from public.content_article_tags where article_id = v_id;
  insert into public.content_tags (slug, name)
  select distinct private.slugify(t), left(trim(t), 40) from jsonb_array_elements_text(coalesce(p->'tags', '[]'::jsonb)) t
   where private.slugify(t) <> '' on conflict (slug) do nothing;
  insert into public.content_article_tags (article_id, tag_id)
  select distinct v_id, ct.id from jsonb_array_elements_text(coalesce(p->'tags', '[]'::jsonb)) t
    join public.content_tags ct on ct.slug = private.slugify(t)
  on conflict do nothing;
  -- Nguồn tham khảo
  delete from public.content_sources where article_id = v_id;
  insert into public.content_sources (article_id, title, url, publisher, sort)
  select v_id, left(trim(s->>'title'), 200), case when s->>'url' ~ '^https?://' then left(s->>'url', 500) end,
         nullif(left(trim(coalesce(s->>'publisher', '')), 80), ''), n::int
    from jsonb_array_elements(coalesce(p->'sources', '[]'::jsonb)) with ordinality x(s, n)
   where char_length(trim(coalesce(s->>'title', ''))) > 0 and n <= 20;
  return v_id;
end $$;

-- Chuyển trạng thái. WRITER / EXPERT: DRAFT ↔ REVIEW bài của mình. EDITOR / ADMIN: mọi trạng thái.
-- Xuất bản / hẹn giờ cần: có nội dung, (nếu cần) đã duyệt chuyên môn. p_at: giờ đăng (hẹn giờ).
create or replace function public.cms_set_status(p_id uuid, p_status text, p_at timestamptz default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_role text := private.require_content_staff();
  a public.content_articles := (select x from public.content_articles x where x.id = p_id);
  v_status text := upper(coalesce(p_status, ''));
begin
  if a.id is null then raise exception 'ARTICLE_NOT_FOUND'; end if;
  if v_status not in ('DRAFT', 'REVIEW', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED') then raise exception 'INVALID_STATUS'; end if;
  if v_role not in ('ADMIN', 'EDITOR') and (a.created_by is distinct from v_uid or v_status not in ('DRAFT', 'REVIEW')
                                             or a.status not in ('DRAFT', 'REVIEW')) then
    raise exception 'FORBIDDEN';
  end if;
  if v_status in ('SCHEDULED', 'PUBLISHED') then
    if char_length(trim(a.body)) < 50 and a.source_url is null then raise exception 'BODY_TOO_SHORT'; end if;
    if a.needs_expert_review and a.expert_reviewed_at is null then raise exception 'EXPERT_REVIEW_REQUIRED'; end if;
    if v_status = 'SCHEDULED' and (p_at is null or p_at <= now()) then raise exception 'INVALID_SCHEDULE'; end if;
  end if;
  update public.content_articles set status = v_status,
    published_at = case when v_status = 'PUBLISHED' then coalesce(case when a.status = 'PUBLISHED' then a.published_at end, now())
                        when v_status = 'SCHEDULED' then p_at else published_at end,
    review_note = case when p_note is not null then left(p_note, 300) when v_status in ('SCHEDULED', 'PUBLISHED') then null else review_note end,
    updated_at = now()
   where id = a.id;
  -- Trả về người viết khi biên tập viên trả bài
  if v_status = 'DRAFT' and a.status = 'REVIEW' and a.created_by is not null and a.created_by <> v_uid then
    perform private.notify(a.created_by, null, 'CONTENT', 'Bài viết cần chỉnh sửa', '"' || a.title || '": ' || coalesce(p_note, 'Xem ghi chú biên tập'),
      '/learn/studio', v_uid, false);
  end if;
  if v_status = 'PUBLISHED' and a.status <> 'PUBLISHED' and a.created_by is not null and a.created_by <> v_uid then
    perform private.notify(a.created_by, null, 'CONTENT', 'Bài viết đã được đăng', a.title, '/learn/' || a.slug, v_uid, false);
  end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'CONTENT_' || v_status, 'article:' || a.id, jsonb_build_object('title', a.title, 'from', a.status, 'at', p_at, 'note', p_note));
  return jsonb_build_object('status', v_status);
end $$;

-- Duyệt chuyên môn (chuyên gia / admin). Không đạt → trả về nháp kèm ghi chú.
create or replace function public.cms_expert_review(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_role text := private.require_content_staff();
  a public.content_articles := (select x from public.content_articles x where x.id = p_id);
begin
  if v_role not in ('ADMIN', 'EXPERT') then raise exception 'FORBIDDEN'; end if;
  if a.id is null then raise exception 'ARTICLE_NOT_FOUND'; end if;
  if a.created_by = v_uid and v_role <> 'ADMIN' then raise exception 'CANNOT_REVIEW_OWN'; end if;
  if p_approve then
    update public.content_articles set expert_reviewed_by = v_uid, expert_reviewed_at = now(), expert_note = nullif(left(trim(coalesce(p_note, '')), 300), ''),
      updated_at = now() where id = a.id;
  else
    if char_length(trim(coalesce(p_note, ''))) < 5 then raise exception 'NOTE_REQUIRED'; end if;
    update public.content_articles set expert_reviewed_by = null, expert_reviewed_at = null, expert_note = left(trim(p_note), 300),
      status = case when status in ('SCHEDULED', 'PUBLISHED') then 'REVIEW' else 'DRAFT' end,
      review_note = 'Chuyên gia góp ý: ' || left(trim(p_note), 280), updated_at = now() where id = a.id;
    if a.created_by is not null and a.created_by <> v_uid then
      perform private.notify(a.created_by, null, 'CONTENT', 'Chuyên gia góp ý bài viết', '"' || a.title || '": ' || left(trim(p_note), 200), '/learn/studio', v_uid, false);
    end if;
  end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, case when p_approve then 'CONTENT_EXPERT_APPROVE' else 'CONTENT_EXPERT_REJECT' end, 'article:' || a.id, jsonb_build_object('note', p_note));
end $$;

create or replace function public.cms_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_role text := private.require_content_staff();
  a public.content_articles := (select x from public.content_articles x where x.id = p_id);
begin
  if a.id is null then raise exception 'ARTICLE_NOT_FOUND'; end if;
  -- Bài đã từng đăng: chỉ lưu trữ (giữ link, thống kê); nháp chưa đăng: xoá được
  if a.published_at is not null and a.published_at <= now() then raise exception 'ARCHIVE_INSTEAD'; end if;
  if v_role not in ('ADMIN', 'EDITOR') and a.created_by is distinct from v_uid then raise exception 'FORBIDDEN'; end if;
  delete from public.content_articles where id = a.id;
end $$;

-- Tác giả (EDITOR / ADMIN). p: {id?, name, title, bio, avatar_url, kind, user_id, partner_id, verified}
create or replace function public.cms_save_author(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_role text := private.require_content_staff();
  v_id uuid := nullif(p->>'id', '')::uuid;
begin
  if v_role not in ('ADMIN', 'EDITOR') then raise exception 'FORBIDDEN'; end if;
  if char_length(trim(coalesce(p->>'name', ''))) < 2 then raise exception 'NAME_REQUIRED'; end if;
  if nullif(p->>'avatar_url', '') is not null and p->>'avatar_url' !~ '^https://' then raise exception 'INVALID_URL'; end if;
  if v_id is null then
    insert into public.content_authors (name, title, bio, avatar_url, kind, user_id, partner_id, verified)
    values (left(trim(p->>'name'), 80), nullif(left(trim(coalesce(p->>'title', '')), 80), ''), nullif(left(trim(coalesce(p->>'bio', '')), 600), ''),
      nullif(p->>'avatar_url', ''), coalesce(nullif(upper(p->>'kind'), ''), 'EDITOR'), nullif(p->>'user_id', '')::uuid,
      nullif(p->>'partner_id', '')::uuid, coalesce((p->>'verified')::boolean, false))
    returning id into v_id;
  else
    update public.content_authors set name = left(trim(p->>'name'), 80), title = nullif(left(trim(coalesce(p->>'title', '')), 80), ''),
      bio = nullif(left(trim(coalesce(p->>'bio', '')), 600), ''), avatar_url = nullif(p->>'avatar_url', ''),
      kind = coalesce(nullif(upper(p->>'kind'), ''), kind), user_id = nullif(p->>'user_id', '')::uuid,
      partner_id = nullif(p->>'partner_id', '')::uuid, verified = coalesce((p->>'verified')::boolean, verified)
     where id = v_id;
    if not found then raise exception 'AUTHOR_NOT_FOUND'; end if;
  end if;
  return v_id;
end $$;

-- Ban nội dung: chỉ admin thêm / bớt. p_role null = gỡ.
create or replace function public.cms_set_staff(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare v_admin uuid := private.require_admin();
begin
  if p_role is null or p_role = '' then
    delete from public.content_staff where user_id = p_user;
  else
    if upper(p_role) not in ('EDITOR', 'WRITER', 'EXPERT') then raise exception 'INVALID_ROLE'; end if;
    if not exists (select 1 from public.profiles where id = p_user) then raise exception 'USER_NOT_FOUND'; end if;
    insert into public.content_staff (user_id, role, added_by) values (p_user, upper(p_role), v_admin)
    on conflict (user_id) do update set role = excluded.role, added_by = excluded.added_by;
  end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_admin, 'CONTENT_STAFF', 'profile:' || p_user, jsonb_build_object('role', p_role));
end $$;

-- Thống kê nội dung (ban nội dung): tổng + theo ngày + bài nổi bật nhất
create or replace function public.cms_stats(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_role text := private.require_content_staff();
  v_from date := (now() at time zone 'Asia/Ho_Chi_Minh')::date - greatest(1, least(coalesce(p_days, 30), 365)) + 1;
begin
  return jsonb_build_object(
    'totals', (select jsonb_build_object('views', coalesce(sum(d.views), 0), 'reads', coalesce(sum(d.reads), 0),
                 'shares', coalesce(sum(d.shares), 0), 'cta_clicks', coalesce(sum(d.cta_clicks), 0))
                 from public.content_daily_stats d where d.day >= v_from),
    'saves', (select count(*) from public.content_bookmarks b where b.created_at >= v_from),
    'readers', (select count(distinct h.user_id) from public.content_read_history h where h.last_at >= v_from),
    'avg_read_seconds', (select coalesce(round(avg(h.seconds)), 0) from public.content_read_history h where h.last_at >= v_from and h.seconds > 0),
    'published', (select count(*) from public.content_articles a where private.content_live(a)),
    'days', (select coalesce(jsonb_agg(jsonb_build_object('day', g.day, 'views', coalesce(s.views, 0), 'reads', coalesce(s.reads, 0)) order by g.day), '[]'::jsonb)
               from (select generate_series(v_from, (now() at time zone 'Asia/Ho_Chi_Minh')::date, interval '1 day')::date as day) g
               left join (select d.day, sum(d.views) views, sum(d.reads) reads from public.content_daily_stats d where d.day >= v_from group by d.day) s on s.day = g.day),
    'top', (select coalesce(jsonb_agg(y.j order by y.rn), '[]'::jsonb) from (
              select jsonb_build_object('id', a.id, 'slug', a.slug, 'title', a.title, 'category_id', a.category_id,
                       'views', sum(d.views), 'reads', sum(d.reads), 'shares', sum(d.shares), 'cta_clicks', sum(d.cta_clicks),
                       'read_rate', round(100.0 * sum(d.reads) / greatest(sum(d.views), 1)),
                       'cta_rate', round(100.0 * sum(d.cta_clicks) / greatest(sum(d.views), 1))) j,
                     row_number() over (order by sum(d.views) desc) rn
                from public.content_daily_stats d join public.content_articles a on a.id = d.article_id
               where d.day >= v_from group by a.id) y where y.rn <= 10));
end $$;

-- Vai trò nội dung của tôi (để hiện nút CMS)
create or replace function public.my_content_role() returns text
language sql stable security definer set search_path = public as $$
  select private.content_role(auth.uid())
$$;

-- Việc cần xử lý: + bài chờ duyệt
create or replace function public.admin_inbox() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'orders', (select count(*) from public.orders o where o.status = 'PENDING' and (o.expires_at is null or o.expires_at > now())),
    'reviews', (select count(*) from public.activities a where a.validation_status = 'PENDING' and coalesce(a.status, '') <> 'DELETED'),
    'partners', (select count(*) from public.partners p where p.status = 'PENDING'),
    'cups', (select count(*) from public.club_cups c where c.status = 'PENDING_REVIEW'),
    'reports', (select count(distinct r.target) from public.user_reports r where r.status = 'OPEN'),
    'content', (select count(*) from public.content_articles a where a.status = 'REVIEW'),
    'errors', (select count(distinct e.code) from private.client_errors e where e.last_at > now() - interval '24 hours'),
    'new_users_7d', (select count(*) from public.profiles p where p.created_at > now() - interval '7 days'),
    'active_7d', (select count(distinct a.user_id) from public.activities a where a.started_at > now() - interval '7 days'),
    'banned', (select count(*) from public.profiles p where p.banned_at is not null));
end $$;

-- ---------------------------------------------------------------------
-- 6. Bài mẫu (chạy lại không ghi đè bài đã sửa)
--    • Hướng dẫn RaceHub: đăng ngay (nội dung về app).
--    • Chuỗi "Bắt đầu chạy bộ": để CHỜ DUYỆT — nội dung sức khoẻ / giáo án cần chuyên gia xem trước khi đăng.
-- ---------------------------------------------------------------------
insert into public.content_articles (slug, title, summary, body, category_id, author_id, content_type, status, published_at, reading_time_minutes,
  is_featured, series_id, series_order, ctas, needs_expert_review)
select x.slug, x.title, x.summary, x.body, x.cat, '00000000-0000-0000-0000-00000000c0a1', x.typ, x.st,
       case when x.st = 'PUBLISHED' then now() end, private.reading_minutes(x.body), x.feat, x.series, x.ord, x.ctas::jsonb, x.expert
  from (values
  ('xp-xu-level-hoat-dong-the-nao', 'XP, Xu và cấp độ trong RaceHub hoạt động thế nào?',
   'XP chỉ đến từ km chạy hợp lệ; Xu dùng cho vật phẩm, quà tặng và tính năng. Hiểu đúng để chơi công bằng.',
   E'## XP: thước đo quãng đường\n\nMỗi km chạy **hợp lệ** (đồng bộ từ Strava hoặc ghi trong app, qua kiểm tra chống gian lận) mới sinh ra XP. Không có cách nào khác để có XP — không mua được, không đọc bài, không bấm quảng cáo.\n\n- XP cộng dồn lên **cấp độ** của bạn.\n- Bài bị nghi đi xe hoặc GPS nhảy sẽ chờ duyệt, chưa tính XP.\n\n## Xu: đồng tiền trong game\n\nXu dùng để mua vật phẩm cho nhân vật, tặng quà cho bạn chạy và dùng một số tính năng. Xu có thể nhận từ nhiệm vụ, thử thách hoặc nạp thêm.\n\n> RaceHub không giữ tiền của bạn và không cho chuyển Xu giữa người dùng.\n\n## Mẹo\n\n1. Kết nối Strava để bài chạy tự về.\n2. Đặt **mục tiêu tuần** vừa sức để giữ chuỗi ngày chạy.\n3. Tham gia thử thách để có thêm động lực.',
   'APP', 'ARTICLE', 'PUBLISHED', true, null, null, '[{"kind":"GOAL","label":"Đặt mục tiêu tuần"},{"kind":"CHALLENGES","label":"Khám phá thử thách"}]', false),
  ('tham-gia-thu-thach-dau-tien', 'Tham gia thử thách đầu tiên của bạn',
   'Thử thách cá nhân, thử thách CLB, giải chạy ảo — chọn cái phù hợp và bắt đầu.',
   E'## Có những loại thử thách nào?\n\n- **Thử thách cộng đồng**: chạy đủ km trong thời gian quy định.\n- **Thử thách CLB**: đua cùng thành viên CLB, có thể chia đội.\n- **Giải chạy ảo**: đăng ký cự ly, chạy ở bất kỳ đâu, nhận BIB và chứng nhận.\n\n## Bắt đầu thế nào?\n\n1. Mở **Thử thách**, đọc kỹ thể lệ (thời gian, cách tính km, phần thưởng).\n2. Bấm tham gia. Bài chạy hợp lệ trong thời gian thử thách tự được tính.\n3. Theo dõi bảng xếp hạng và tiến độ của bạn.\n\n> Chọn mục tiêu vừa sức: hoàn thành một thử thách nhỏ tốt hơn bỏ dở một thử thách lớn.',
   'APP', 'ARTICLE', 'PUBLISHED', false, null, null, '[{"kind":"CHALLENGES","label":"Xem thử thách đang mở"},{"kind":"RACES","label":"Giải chạy ảo"}]', false),
  ('tim-ban-chay-voi-quanh-day', 'Tìm bạn chạy cùng pace với Quanh đây',
   'Tính năng mới: runner hợp pace, hợp giờ ở gần bạn, buổi chạy công khai của CLB — vị trí chỉ lưu gần đúng.',
   E'## Quanh đây là gì?\n\nQuanh đây giúp bạn tìm **runner cùng pace, cùng khung giờ, cùng mục tiêu** ở gần, cùng các buổi chạy công khai và CLB trong khu vực.\n\n## Quyền riêng tư\n\n- Chỉ lưu vùng khoảng 1 km bạn chọn, tự hết hạn.\n- Người khác chỉ thấy khoảng cách ước chừng.\n- Bạn chọn ai thấy mình; chặn, báo cáo bất cứ lúc nào.\n\n## An toàn khi gặp nhau\n\nKết nối xong, hãy rủ nhau vào **buổi chạy nhóm nơi công cộng** của CLB. Báo người thân lịch chạy và không chia sẻ địa chỉ nhà.',
   'APP', 'NEWS', 'PUBLISHED', false, null, null, '[{"kind":"NEARBY","label":"Mở Quanh đây"}]', false),
  ('nhan-vat-va-tu-do', 'Nhân vật và tủ đồ: thể hiện phong cách runner',
   'Chọn dáng nhân vật, phối đồ, mặc đồng phục CLB và mở khoá vật phẩm theo thành tích.',
   E'## Nhân vật của bạn\n\nMỗi runner có một nhân vật 2D. Vào **Nhân vật** để chọn dáng, màu da, kiểu tóc.\n\n## Tủ đồ\n\n- Vật phẩm mua bằng Xu hoặc mở khoá theo cấp độ, huy hiệu, thử thách.\n- CLB có thể thiết kế **đồng phục riêng** (áo, quần, tất, giày) cho thành viên.\n\n> Áo thật chỉ bán qua cửa hàng đối tác trong Chợ Runner — vật phẩm trong app là đồ trang trí cho nhân vật.',
   'APP', 'ARTICLE', 'PUBLISHED', false, null, null, '[{"kind":"CHARACTER","label":"Mở tủ đồ"}]', false),
  ('lo-trinh-0-den-5-km', 'Bắt đầu chạy bộ: lộ trình từ 0 đến 5 km',
   'Kết hợp đi bộ và chạy chậm trong 8 tuần để chạy liền 5 km mà không quá sức.',
   E'> Bản nháp — cần chuyên gia duyệt trước khi đăng.\n\n## Nguyên tắc\n\n- Chạy **chậm tới mức nói chuyện được**.\n- 3 buổi / tuần, xen ngày nghỉ.\n- Tăng dần, không tăng quá nhanh.\n\n## Gợi ý 8 tuần\n\n| Tuần | Mỗi buổi |\n|---|---|\n| 1–2 | Đi bộ 2 phút + chạy 1 phút × 8 |\n| 3–4 | Đi bộ 1 phút 30 + chạy 2 phút × 7 |\n| 5–6 | Đi bộ 1 phút + chạy 4 phút × 5 |\n| 7 | Chạy 10 phút × 2, đi bộ 2 phút giữa |\n| 8 | Chạy liền 25–35 phút |\n\n## Khi nào nên dừng?\n\nĐau nhói, đau tăng dần khi chạy, chóng mặt, tức ngực — dừng lại và hỏi ý kiến nhân viên y tế.',
   'BEGINNER', 'ARTICLE', 'REVIEW', true, 'STARTER', 1, '[{"kind":"GOAL","label":"Đặt mục tiêu tuần đầu tiên"},{"kind":"CLUBS","label":"Tìm CLB để chạy cùng"}]', true),
  ('chon-giay-chay-bo-dau-tien', 'Cách chọn giày chạy bộ đầu tiên',
   'Vừa chân, êm vừa phải, phù hợp mặt đường — thử giày buổi chiều và chạy thử trước khi mua.',
   E'## Những điều quan trọng\n\n- **Vừa chân**: mũi giày dư khoảng một đốt ngón tay.\n- **Thoải mái ngay khi thử**: giày chạy không cần \"đi cho quen\".\n- **Mặt đường**: đường nhựa dùng giày road; đường mòn dùng giày trail.\n\n## Mẹo khi mua\n\n1. Thử giày buổi chiều (chân nở hơn).\n2. Mang đúng loại tất bạn hay chạy.\n3. Chạy thử vài bước trong cửa hàng.\n\nHỏi cửa hàng đối tác trong Chợ Runner để được đo chân và tư vấn.',
   'BEGINNER', 'ARTICLE', 'REVIEW', false, 'STARTER', 2, '[{"kind":"MARKET","target":"SHOP","label":"Cửa hàng đối tác"}]', false),
  ('easy-tempo-interval-khac-nhau', 'Phân biệt Easy Run, Tempo và Interval',
   'Ba kiểu buổi chạy cơ bản: chạy nhẹ xây nền, tempo tăng ngưỡng, interval tăng tốc độ.',
   E'> Bản nháp — cần chuyên gia duyệt trước khi đăng.\n\n## Easy run\n\nChạy nhẹ, nói chuyện được thành câu. Chiếm phần lớn thời gian tập.\n\n## Tempo\n\nChạy \"khó chịu nhưng giữ được\" khoảng 20–30 phút. Chỉ nói được vài từ.\n\n## Interval\n\nCác quãng nhanh ngắn xen nghỉ, ví dụ 6 × 400 m. Chỉ nên tập khi đã có nền chạy nhẹ đều đặn.\n\n> Người mới: tập trung easy run 4–8 tuần trước khi thêm tempo / interval.',
   'TRAINING', 'ARTICLE', 'REVIEW', false, 'STARTER', 3, '[{"kind":"MARKET","target":"COACH","label":"Tìm HLV"}]', true),
  ('khi-nao-bo-sung-nuoc-va-gel', 'Khi nào nên bổ sung nước và gel?',
   'Chạy dưới 60 phút thường chỉ cần nước; chạy dài hơn cần tính tới năng lượng và điện giải.',
   E'> Bản nháp — cần chuyên gia dinh dưỡng duyệt trước khi đăng.\n\n## Nước\n\nUống theo cảm giác khát, chú ý thời tiết nóng ẩm.\n\n## Gel và năng lượng\n\nBuổi chạy trên 60–75 phút có thể cần bổ sung năng lượng. **Thử gel trong buổi tập**, không thử lần đầu trong ngày thi đấu.\n\n## Điện giải\n\nRa nhiều mồ hôi, chạy lâu trong trời nóng: cân nhắc nước điện giải.\n\n> Nội dung mang tính tham khảo chung, không thay cho tư vấn của chuyên gia dinh dưỡng / y tế.',
   'NUTRITION', 'ARTICLE', 'REVIEW', false, 'STARTER', 4, '[{"kind":"MARKET","target":"SERVICE","label":"Chuyên gia dinh dưỡng"}]', true)
  ) as x(slug, title, summary, body, cat, typ, st, feat, series, ord, ctas, expert)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------
-- 7. Quyền
-- ---------------------------------------------------------------------
revoke all on function private.content_role(uuid), private.content_live(public.content_articles), private.reading_minutes(text), private.slugify(text),
  private.content_card(public.content_articles, uuid), private.content_bump(uuid, text), private.clean_ctas(jsonb), private.require_content_staff()
  from public, anon, authenticated;
revoke all on function public.knowledge_home(), public.knowledge_list(jsonb), public.knowledge_article(text), public.knowledge_progress(uuid, integer, integer),
  public.knowledge_bookmark(uuid, boolean), public.knowledge_feedback(uuid, boolean, text), public.knowledge_track(uuid, text),
  public.cms_meta(), public.cms_list(jsonb), public.cms_get(uuid), public.cms_save(jsonb), public.cms_set_status(uuid, text, timestamptz, text),
  public.cms_expert_review(uuid, boolean, text), public.cms_delete(uuid), public.cms_save_author(jsonb), public.cms_set_staff(uuid, text),
  public.cms_stats(integer), public.my_content_role() from public, anon;
grant execute on function public.knowledge_home(), public.knowledge_list(jsonb), public.knowledge_article(text), public.knowledge_progress(uuid, integer, integer),
  public.knowledge_bookmark(uuid, boolean), public.knowledge_feedback(uuid, boolean, text), public.knowledge_track(uuid, text),
  public.cms_meta(), public.cms_list(jsonb), public.cms_get(uuid), public.cms_save(jsonb), public.cms_set_status(uuid, text, timestamptz, text),
  public.cms_expert_review(uuid, boolean, text), public.cms_delete(uuid), public.cms_save_author(jsonb), public.cms_set_staff(uuid, text),
  public.cms_stats(integer), public.my_content_role() to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001006300_club_news_albums.sql
-- ===================================================================
-- 006300: Quản lý CLB — Tin CLB của ban chủ nhiệm + Kho link ảnh CLB.
-- • Tin CLB (club_posts.kind = 'NEWS'): chỉ ban quản trị CLB đăng; có tiêu đề, chuyên mục (thông báo / sự kiện / giải chạy /
--   kết quả / tập luyện / khác), link kèm theo, ảnh; tuỳ chọn ghim đầu bảng tin và / hoặc gửi thông báo tới mọi thành viên.
--   Bảng tin có bộ lọc "Tin CLB" để runner không bị trôi tin giữa bài chạy tự động.
-- • Kho ảnh (club_albums): lưu LINK album (Google Photos, Drive, Facebook, iCloud, OneDrive, Flickr…) theo sự kiện / giải / buổi tập,
--   có ảnh bìa, ngày chụp, tìm kiếm không dấu, lọc theo loại và năm. Thành viên gửi link → ban quản trị duyệt; ban quản trị thêm trực tiếp.
-- Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 1. Tin CLB
-- ---------------------------------------------------------------------
alter table public.club_posts drop constraint if exists club_posts_kind_check;
alter table public.club_posts add constraint club_posts_kind_check
  check (kind in ('POST', 'ANNOUNCEMENT', 'AUTO_RUN', 'AUTO_JOIN', 'RECAP', 'CHALLENGE', 'NEWS'));

create or replace function private.news_categories() returns text[]
language sql immutable as $$ select array['NOTICE', 'EVENT', 'RACE', 'RESULT', 'TRAINING', 'OTHER'] $$;

-- p: {id?, title, body, category, link, image_paths[], pin, notify}
create or replace function public.publish_club_news(p_club_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_title text := trim(coalesce(p->>'title', ''));
  v_body text := trim(coalesce(p->>'body', ''));
  v_cat text := upper(coalesce(nullif(p->>'category', ''), 'NOTICE'));
  v_link text := nullif(trim(coalesce(p->>'link', '')), '');
  v_paths text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'image_paths', '[]'::jsonb)) x), '{}');
  v_pin boolean := coalesce((p->>'pin')::boolean, false);
  v_old public.club_posts;
  m record;
begin
  if not public.club_is_staff(p_club_id) then raise exception 'FORBIDDEN'; end if;
  if char_length(v_title) < 3 or char_length(v_title) > 120 then raise exception 'TITLE_REQUIRED'; end if;
  if char_length(v_body) > 4000 or cardinality(v_paths) > 4 then raise exception 'POST_TOO_LONG'; end if;
  if not (v_cat = any (private.news_categories())) then raise exception 'INVALID_CATEGORY'; end if;
  if v_link is not null and (v_link !~ '^https?://' or char_length(v_link) > 500) then raise exception 'INVALID_URL'; end if;
  if exists (select 1 from unnest(v_paths) x where x not like p_club_id::text || '/' || v_uid::text || '/%') then
    raise exception 'INVALID_IMAGE_PATH';
  end if;

  if v_id is null then
    if (select count(*) from public.club_posts where club_id = p_club_id and kind = 'NEWS' and created_at > now() - interval '24 hours') >= 20 then
      raise exception 'RATE_LIMITED';
    end if;
    insert into public.club_posts (club_id, author_id, kind, title, body, image_paths, is_pinned, meta)
    values (p_club_id, v_uid, 'NEWS', v_title, v_body, v_paths, v_pin, jsonb_build_object('category', v_cat, 'link', v_link))
    returning id into v_id;
    if coalesce((p->>'notify')::boolean, false) then
      for m in select user_id from public.club_members where club_id = p_club_id and status = 'APPROVED' and user_id <> v_uid loop
        perform private.notify(m.user_id, p_club_id, 'CLUB_NEWS', v_title, left(coalesce(nullif(v_body, ''), 'Tin mới từ CLB'), 140),
          '/clubs/' || p_club_id || '?post=' || v_id, v_uid, true);
      end loop;
    end if;
  else
    v_old := (select x from public.club_posts x where x.id = v_id);
    if v_old.id is null or v_old.club_id <> p_club_id or v_old.kind <> 'NEWS' then raise exception 'POST_NOT_FOUND'; end if;
    -- ảnh cũ giữ nguyên được (người đăng khác trong ban quản trị)
    if exists (select 1 from unnest(v_paths) x where x not like p_club_id::text || '/' || v_uid::text || '/%' and not (x = any (v_old.image_paths))) then
      raise exception 'INVALID_IMAGE_PATH';
    end if;
    update public.club_posts set title = v_title, body = v_body, image_paths = v_paths, is_pinned = v_pin,
      meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('category', v_cat, 'link', v_link, 'edited_at', now())
     where id = v_id;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 2. Kho link ảnh CLB
-- ---------------------------------------------------------------------
create table if not exists public.club_albums (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  url text not null check (url ~ '^https?://' and char_length(url) <= 500),
  description text check (description is null or char_length(description) <= 500),
  kind text not null default 'EVENT' check (kind in ('EVENT', 'RACE', 'TRAINING', 'SOCIAL', 'OTHER')),
  taken_on date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  event_id uuid references public.club_events(id) on delete set null,
  race_name text check (race_name is null or char_length(race_name) <= 120),
  cover_path text,
  photographer text check (photographer is null or char_length(photographer) <= 80),
  status text not null default 'APPROVED' check (status in ('PENDING', 'APPROVED')),
  created_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  opens integer not null default 0
);
create index if not exists club_albums_list_idx on public.club_albums (club_id, status, taken_on desc);
create index if not exists club_albums_event_idx on public.club_albums (event_id);
alter table public.club_albums enable row level security;
revoke all on public.club_albums from anon, authenticated;

create or replace function private.album_json(a public.club_albums) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', a.id, 'club_id', a.club_id, 'title', a.title, 'url', a.url, 'description', a.description, 'kind', a.kind,
    'taken_on', a.taken_on, 'event_id', a.event_id, 'event_title', (select e.title from public.club_events e where e.id = a.event_id),
    'race_name', a.race_name, 'cover_path', a.cover_path, 'photographer', a.photographer, 'status', a.status, 'opens', a.opens,
    'created_by', a.created_by, 'created_by_name', private.display_name(a.created_by), 'created_at', a.created_at)
$$;

-- p: {q, kind, year, event_id, offset}. Thành viên thấy album đã duyệt + album mình gửi đang chờ; ban quản trị thấy cả hàng chờ.
create or replace function public.club_albums(p_club_id uuid, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_staff boolean := public.club_is_staff(p_club_id);
  v_q text := coalesce(p->>'q', '');
  v_kind text := nullif(upper(coalesce(p->>'kind', '')), 'ALL');
  v_year integer := nullif(p->>'year', '')::int;
  v_event uuid := nullif(p->>'event_id', '')::uuid;
  v_offset integer := greatest(0, coalesce((p->>'offset')::int, 0));
begin
  if not public.club_is_member(p_club_id) and not public.is_system_admin() then raise exception 'NOT_A_MEMBER'; end if;
  v_kind := nullif(v_kind, '');
  return (
    with vis as (
      select a from public.club_albums a
       where a.club_id = p_club_id and (a.status = 'APPROVED' or v_staff or a.created_by = v_uid)
    ), f as (
      select v.a from vis v
       where (v_kind is null or (v.a).kind = v_kind)
         and (v_year is null or extract(year from (v.a).taken_on) = v_year)
         and (v_event is null or (v.a).event_id = v_event)
         and (private.search_key(v_q) = '' or private.search_match(
               private.search_hay((v.a).title) || ' ' || private.search_key(coalesce((v.a).race_name, '') || ' ' || coalesce((v.a).description, '')
               || ' ' || coalesce((select e.title from public.club_events e where e.id = (v.a).event_id), '') || ' ' || coalesce((v.a).photographer, '')) || ' ', v_q))
    ), r as (
      select f.a, row_number() over (order by ((f.a).status = 'PENDING') desc, (f.a).taken_on desc, (f.a).created_at desc) rn from f
    )
    select jsonb_build_object(
      'total', (select count(*) from f),
      'items', coalesce((select jsonb_agg(private.album_json(r.a) order by r.rn) from r where r.rn > v_offset and r.rn <= v_offset + 30), '[]'::jsonb),
      'years', (select coalesce(jsonb_agg(y order by y desc), '[]'::jsonb) from (select distinct extract(year from (v.a).taken_on)::int y from vis v) z),
      'pending', case when v_staff then (select count(*) from public.club_albums a where a.club_id = p_club_id and a.status = 'PENDING') else 0 end,
      'can_manage', v_staff));
end $$;

-- Thêm / sửa album. p: {id?, title, url, description, kind, taken_on, event_id, race_name, cover_path, photographer, notify}
-- Ban quản trị: đăng ngay. Thành viên: gửi chờ duyệt (tối đa 10 link / ngày), sửa được link của mình khi còn chờ.
create or replace function public.save_club_album(p_club_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_staff boolean := public.club_is_staff(p_club_id);
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_old public.club_albums := (select x from public.club_albums x where x.id = nullif(p->>'id', '')::uuid);
  v_title text := trim(coalesce(p->>'title', ''));
  v_url text := trim(coalesce(p->>'url', ''));
  v_kind text := upper(coalesce(nullif(p->>'kind', ''), 'EVENT'));
  v_event uuid := nullif(p->>'event_id', '')::uuid;
  v_cover text := nullif(p->>'cover_path', '');
  v_date date := coalesce(nullif(p->>'taken_on', '')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  m record;
begin
  if not public.club_is_member(p_club_id) then raise exception 'NOT_A_MEMBER'; end if;
  if char_length(v_title) < 3 or char_length(v_title) > 120 then raise exception 'TITLE_REQUIRED'; end if;
  if v_url !~ '^https?://[^\s/$.?#][^\s]*$' or char_length(v_url) > 500 then raise exception 'INVALID_URL'; end if;
  if v_kind not in ('EVENT', 'RACE', 'TRAINING', 'SOCIAL', 'OTHER') then raise exception 'INVALID_KIND'; end if;
  if v_date > (now() at time zone 'Asia/Ho_Chi_Minh')::date + 1 then raise exception 'INVALID_DATE'; end if;
  if v_event is not null and not exists (select 1 from public.club_events e where e.id = v_event and e.club_id = p_club_id) then
    raise exception 'EVENT_NOT_FOUND';
  end if;
  if v_cover is not null and v_cover is distinct from v_old.cover_path and v_cover not like p_club_id::text || '/' || v_uid::text || '/%' then
    raise exception 'INVALID_IMAGE_PATH';
  end if;

  if v_old.id is null then
    if v_id is not null then raise exception 'ALBUM_NOT_FOUND'; end if;
    if not v_staff and (select count(*) from public.club_albums a where a.created_by = v_uid and a.created_at > now() - interval '24 hours') >= 10 then
      raise exception 'RATE_LIMITED';
    end if;
    if exists (select 1 from public.club_albums a where a.club_id = p_club_id and a.url = v_url) then raise exception 'ALBUM_EXISTS'; end if;
    insert into public.club_albums (club_id, title, url, description, kind, taken_on, event_id, race_name, cover_path, photographer, status, created_by, approved_by)
    values (p_club_id, v_title, v_url, nullif(left(trim(coalesce(p->>'description', '')), 500), ''), v_kind, v_date, v_event,
      nullif(left(trim(coalesce(p->>'race_name', '')), 120), ''), v_cover, nullif(left(trim(coalesce(p->>'photographer', '')), 80), ''),
      case when v_staff then 'APPROVED' else 'PENDING' end, v_uid, case when v_staff then v_uid end)
    returning id into v_id;
    if v_staff and coalesce((p->>'notify')::boolean, false) then
      for m in select user_id from public.club_members where club_id = p_club_id and status = 'APPROVED' and user_id <> v_uid loop
        perform private.notify(m.user_id, p_club_id, 'CLUB_ALBUM', 'Album ảnh mới: ' || v_title, 'Xem ảnh trong tab Ảnh của CLB',
          '/clubs/' || p_club_id || '/photos', v_uid, false);
      end loop;
    elsif not v_staff then
      for m in select user_id from public.club_members where club_id = p_club_id and status = 'APPROVED' and role in ('OWNER', 'CAPTAIN') loop
        perform private.notify(m.user_id, p_club_id, 'CLUB_ALBUM', 'Link ảnh chờ duyệt', private.display_name(v_uid) || ' gửi album "' || v_title || '"',
          '/clubs/' || p_club_id || '/photos', v_uid, false);
      end loop;
    end if;
  else
    if v_old.club_id <> p_club_id then raise exception 'ALBUM_NOT_FOUND'; end if;
    if not v_staff and (v_old.created_by is distinct from v_uid or v_old.status <> 'PENDING') then raise exception 'FORBIDDEN'; end if;
    if exists (select 1 from public.club_albums a where a.club_id = p_club_id and a.url = v_url and a.id <> v_old.id) then raise exception 'ALBUM_EXISTS'; end if;
    update public.club_albums set title = v_title, url = v_url, description = nullif(left(trim(coalesce(p->>'description', '')), 500), ''),
      kind = v_kind, taken_on = v_date, event_id = v_event, race_name = nullif(left(trim(coalesce(p->>'race_name', '')), 120), ''),
      cover_path = v_cover, photographer = nullif(left(trim(coalesce(p->>'photographer', '')), 80), ''), updated_at = now()
     where id = v_old.id;
  end if;
  return v_id;
end $$;

-- Duyệt link thành viên gửi: đồng ý → hiện cho cả CLB; từ chối → xoá, báo người gửi
create or replace function public.review_club_album(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  a public.club_albums := (select x from public.club_albums x where x.id = p_id);
begin
  if a.id is null then raise exception 'ALBUM_NOT_FOUND'; end if;
  if not public.club_is_staff(a.club_id) then raise exception 'FORBIDDEN'; end if;
  if p_approve then
    update public.club_albums set status = 'APPROVED', approved_by = v_uid, updated_at = now() where id = a.id;
    if a.created_by is not null and a.created_by <> v_uid and a.status = 'PENDING' then
      perform private.notify(a.created_by, a.club_id, 'CLUB_ALBUM', 'Album của bạn đã được duyệt', a.title, '/clubs/' || a.club_id || '/photos', v_uid, false);
    end if;
  else
    delete from public.club_albums where id = a.id;
    if a.created_by is not null and a.created_by <> v_uid then
      perform private.notify(a.created_by, a.club_id, 'CLUB_ALBUM', 'Album chưa được duyệt', a.title || coalesce(': ' || nullif(trim(p_note), ''), ''),
        '/clubs/' || a.club_id || '/photos', v_uid, false);
    end if;
  end if;
end $$;

create or replace function public.delete_club_album(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  a public.club_albums := (select x from public.club_albums x where x.id = p_id);
begin
  if a.id is null then raise exception 'ALBUM_NOT_FOUND'; end if;
  if not public.club_is_staff(a.club_id) and a.created_by is distinct from v_uid then raise exception 'FORBIDDEN'; end if;
  delete from public.club_albums where id = a.id;
end $$;

-- Đếm lượt mở (để ban quản trị biết album nào được xem nhiều)
create or replace function public.open_club_album(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.club_albums := (select x from public.club_albums x where x.id = p_id);
begin
  if a.id is null or a.status <> 'APPROVED' or not public.club_is_member(a.club_id) then return; end if;
  update public.club_albums set opens = opens + 1 where id = a.id;
end $$;

-- ---------------------------------------------------------------------
-- 3. Quyền
-- ---------------------------------------------------------------------
revoke all on function private.news_categories(), private.album_json(public.club_albums) from public, anon, authenticated;
revoke all on function public.publish_club_news(uuid, jsonb), public.club_albums(uuid, jsonb), public.save_club_album(uuid, jsonb),
  public.review_club_album(uuid, boolean, text), public.delete_club_album(uuid), public.open_club_album(uuid) from public, anon;
grant execute on function public.publish_club_news(uuid, jsonb), public.club_albums(uuid, jsonb), public.save_club_album(uuid, jsonb),
  public.review_club_album(uuid, boolean, text), public.delete_club_album(uuid), public.open_club_album(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
