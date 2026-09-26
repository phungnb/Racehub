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
