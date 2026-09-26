-- RaceHub — PHẦN 04/10 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 004900, 005000, 005100, 005200
-- Supabase → SQL Editor → New query → dán TOÀN BỘ phần này → Run. Lỗi thì không có gì thay đổi; chạy lại vẫn an toàn.
-- Xong thì chạy phần tiếp theo.
begin;
-- ===================================================================
-- 20261001004900_challenge_honors.sql
-- ===================================================================
-- 004900: Vinh danh thử thách (tính năng CLB Pro / VIP).
-- • BTC bật mục Vinh danh, chọn hạng mục: Top thành tích · Nhiều km nhất · Chạy đều nhất (số ngày) · Chuỗi ngày liên tiếp dài nhất ·
--   Bứt phá nhất (km trong thử thách so với cùng khoảng thời gian trước đó) · Được tiếp sức nhiều nhất (quà) · Giải BTC tự đặt (chọn tay).
-- • Thiết kế ảnh vinh danh bằng engine lớp (như BIB): ảnh nhóm theo hạng mục + ảnh cá nhân; khung ảnh runner (lớp 'photo').
-- • Chỉ công bố sau khi thử thách kết thúc ≥ 24 giờ (thời gian khiếu nại / duyệt bài). Công bố lại được (giữ ảnh / lựa chọn ẩn của runner).
-- • Runner được vinh danh tự tải ảnh đẹp hơn, hoặc ẨN mình khỏi ảnh công khai. BTC tải ảnh thay được (runner vẫn ẩn được).
-- • Người được vinh danh: thông báo + huy hiệu "Được vinh danh" (không có XP — XP chỉ từ km).
-- Cần 004800. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 1. Bảng
-- ---------------------------------------------------------------------
create table if not exists public.challenge_honors (
  challenge_id uuid primary key references public.challenges(id) on delete cascade,
  enabled boolean not null default true,
  categories jsonb not null default '[]'::jsonb,
  design jsonb,
  card_design jsonb,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED')),
  published_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
create table if not exists public.challenge_honorees (
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  category text not null,
  rank integer not null check (rank between 1 and 10),
  user_id uuid not null references public.profiles(id) on delete cascade,
  value numeric,
  created_at timestamptz not null default now(),
  primary key (challenge_id, category, rank)
);
create index if not exists challenge_honorees_user_idx on public.challenge_honorees (user_id);
-- Lựa chọn của từng runner trong một thử thách: ảnh riêng, ẩn khỏi ảnh công khai
create table if not exists public.challenge_honor_prefs (
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  photo_url text,
  photo_by uuid references public.profiles(id) on delete set null,
  hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);
alter table public.challenge_honors enable row level security;
alter table public.challenge_honorees enable row level security;
alter table public.challenge_honor_prefs enable row level security;

insert into public.achievements (code, title, description, category, tier, icon, rule, xp_reward, xu_reward, sort)
values ('HONORED', 'Được vinh danh', 'Có tên trong bảng vinh danh của một thử thách', 'EVENT', 'GOLD', 'Crown', null, 0, 0, 70)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 2. Kho ảnh vinh danh: honor-media/<challenge_id>/<user_id>/<file>
--    BTC thử thách tải được; người tham gia tải ảnh của chính mình
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('honor-media', 'honor-media', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create or replace function public.can_upload_honor_media(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when (storage.foldername(p_name))[1] !~ '^[0-9a-fA-F-]{36}$' then false
    when (storage.foldername(p_name))[2] is distinct from auth.uid()::text then false
    else exists (select 1 from public.challenges c where c.id = ((storage.foldername(p_name))[1])::uuid
                  and (private.challenge_is_manager(c)
                       or exists (select 1 from public.challenge_participants p where p.challenge_id = c.id and p.profile_id = auth.uid())))
    end
$$;
drop policy if exists honor_media_insert on storage.objects;
create policy honor_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'honor-media' and public.can_upload_honor_media(name));
drop policy if exists honor_media_delete on storage.objects;
create policy honor_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'honor-media' and (storage.foldername(name))[2] = auth.uid()::text);

create or replace function private.honor_media_ok(p_challenge uuid, p_url text) returns boolean
language sql immutable as $$
  select p_url is null or p_url ~ ('/storage/v1/object/public/honor-media/' || p_challenge::text || '/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$')
$$;

-- ---------------------------------------------------------------------
-- 3. Quyền: CLB Pro (thử thách của CLB) hoặc người tạo có gói VIP; admin luôn được
-- ---------------------------------------------------------------------
create or replace function private.honor_allowed(c public.challenges) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_system_admin()
      or (c.target_club_id is not null and private.club_is_pro(c.target_club_id))
      or (c.created_by is not null and private.user_vip_tier(c.created_by) > 0)
$$;

-- ---------------------------------------------------------------------
-- 4. Thiết kế (lớp) — như BIB, thêm lớp khung ảnh runner 'photo'
-- ---------------------------------------------------------------------
create or replace function private.honor_layers(p_challenge uuid, arr jsonb, p_binds text[]) returns jsonb
language plpgsql stable as $$
declare
  v_fonts text[] := array['sans', 'montserrat', 'inter', 'lexend', 'unbounded', 'impact', 'dela', 'paytone', 'sigmar', 'bungee', 'bungee_shade',
    'rowdies', 'condensed', 'athletic', 'saira', 'roboto_c', 'asap_c', 'fjalla', 'mono', 'tech', 'exo', 'kanit', 'tourney', 'protest', 'stencil',
    'slab', 'alfa', 'serif', 'cormorant', 'garamond', 'yeseva', 'script', 'vibes', 'allura', 'pacifico', 'lobster', 'graffiti', 'brush', 'bangers', 'patrick'];
  v_fx text[] := array['none', 'outline', 'stroke', 'shadow', 'glow', 'extrude', 'marker', 'box', 'pill', 'slant', 'underline', 'gold', 'gradient'];
begin
  if arr is null or jsonb_typeof(arr) = 'null' then return '[]'::jsonb; end if;
  if jsonb_typeof(arr) <> 'array' or jsonb_array_length(arr) > 60 then raise exception 'INVALID_HONOR_DESIGN'; end if;
  if exists (select 1 from jsonb_array_elements(arr) e
              where e->>'type' in ('image', 'qr', 'photo') and not private.honor_media_ok(p_challenge, e->>'src')) then
    raise exception 'INVALID_HONOR_IMAGE';
  end if;
  return (select coalesce(jsonb_agg(x.j order by x.ord), '[]'::jsonb) from (
    select e.ord,
      jsonb_build_object(
        'id', case when e.v->>'id' ~ '^[A-Za-z0-9_-]{1,24}$' then e.v->>'id' else 'l' || e.ord::text end,
        'type', e.v->>'type',
        'x', private.bib_num(e.v->'x', -0.2, 1.2, 0.5), 'y', private.bib_num(e.v->'y', -0.2, 1.2, 0.5),
        'rot', private.bib_num(e.v->'rot', -180, 180, 0), 'opacity', private.bib_num(e.v->'opacity', 0.05, 1, 1),
        'hidden', private.bib_bool(e.v->'hidden', false), 'locked', private.bib_bool(e.v->'locked', false))
      || case e.v->>'type'
        when 'text' then jsonb_build_object(
          'bind', case when e.v->>'bind' = any (p_binds || 'custom'::text) then e.v->>'bind' else 'custom' end,
          'text', private.design_str(e.v->'text', 120),
          'font', private.bib_pick(e.v->>'font', v_fonts, 'sans'),
          'size', private.bib_num(e.v->'size', 8, 800, 48), 'w', private.bib_num(e.v->'w', 0.03, 1.2, 0.8),
          'align', private.bib_pick(e.v->>'align', array['left', 'center', 'right'], 'center'),
          'color', private.design_paint(e.v->'color', 'text'),
          'italic', private.bib_bool(e.v->'italic', false), 'upper', private.bib_bool(e.v->'upper', false),
          'spacing', private.bib_num(e.v->'spacing', -0.1, 1, 0),
          'fx', private.bib_pick(e.v->>'fx', v_fx, 'none'),
          'fx_color', private.design_paint(e.v->'fx_color', 'accent'))
        when 'image' then jsonb_build_object(
          'role', private.bib_pick(e.v->>'role', array['logo', 'sponsor', 'image', 'signature'], 'image'),
          'src', e.v->>'src', 'name', trim(private.design_str(e.v->'name', 40)),
          'w', private.bib_num(e.v->'w', 0.02, 1.2, 0.16), 'h', private.bib_num(e.v->'h', 0.02, 1.2, 0.12))
        when 'qr' then jsonb_build_object(
          'source', private.bib_pick(e.v->>'source', array['verify', 'race', 'club', 'fee', 'link', 'image'], 'race'),
          'src', e.v->>'src', 'url', private.design_str(e.v->'url', 400),
          'w', private.bib_num(e.v->'w', 0.05, 0.6, 0.14),
          'label', private.design_str(e.v->'label', 40), 'card', private.bib_bool(e.v->'card', true))
        when 'photo' then jsonb_build_object(
          'bind', case when e.v->>'bind' = any (p_binds || 'custom'::text) then e.v->>'bind' else 'custom' end,
          'src', e.v->>'src',
          'shape', private.bib_pick(e.v->>'shape', array['circle', 'round', 'square', 'hex', 'arch', 'shield'], 'circle'),
          'w', private.bib_num(e.v->'w', 0.03, 1.2, 0.2), 'h', private.bib_num(e.v->'h', 0.03, 1.2, 0.2),
          'zoom', private.bib_num(e.v->'zoom', 1, 4, 1), 'ox', private.bib_num(e.v->'ox', -1, 1, 0), 'oy', private.bib_num(e.v->'oy', -1, 1, 0),
          'border', private.bib_num(e.v->'border', 0, 40, 6), 'border_color', private.design_paint(e.v->'border_color', 'accent'),
          'shadow', private.bib_bool(e.v->'shadow', true))
        else jsonb_build_object(
          'shape', private.bib_pick(e.v->>'shape', array['rect', 'round', 'pill', 'circle', 'line', 'slash', 'laurel', 'seal'], 'rect'),
          'w', private.bib_num(e.v->'w', 0.005, 1.5, 0.3), 'h', private.bib_num(e.v->'h', 0.003, 1.5, 0.1),
          'fill', private.design_paint(e.v->'fill', 'band'))
      end as j
    from jsonb_array_elements(arr) with ordinality as e(v, ord)
    where e.v->>'type' in ('text', 'image', 'qr', 'shape', 'photo')) x);
end $$;

create or replace function private.honor_design(p_challenge uuid, d jsonb) returns jsonb
language plpgsql stable as $$
declare
  v_binds text[] := array['challenge', 'org', 'category', 'date', 'me_name', 'me_value', 'me_rank', 'me'];
  i int;
begin
  if d is null or jsonb_typeof(d) = 'null' then return null; end if;
  if jsonb_typeof(d) <> 'object' then raise exception 'INVALID_HONOR_DESIGN'; end if;
  for i in 1..10 loop v_binds := v_binds || array['r' || i, 'r' || i || '_name', 'r' || i || '_value']; end loop;
  if not private.honor_media_ok(p_challenge, d->>'bg_url') then raise exception 'INVALID_HONOR_IMAGE'; end if;
  return jsonb_build_object(
    'v', 2,
    'format', private.bib_pick(d->>'format', array['square', 'portrait', 'story', 'wide'], 'portrait'),
    'template', private.bib_pick(d->>'template', array['podium', 'rays', 'confetti', 'speed', 'gold', 'neon', 'paper', 'gradient', 'stadium', 'minimal'], 'podium'),
    'colors', private.design_colors(d->'colors'),
    'bg_url', d->>'bg_url', 'bg_opacity', private.bib_num(d->'bg_opacity', 0, 1, 1),
    'decor', private.bib_bool(d->'decor', true),
    'layers', private.honor_layers(p_challenge, d->'layers', v_binds));
end $$;

-- ---------------------------------------------------------------------
-- 5. Tính danh sách vinh danh theo cấu hình
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
    elsif k like 'CUSTOM%' then
      return query select k, x.ord::int, x.pid, null::numeric from (
        select u.v::uuid as pid, u.ord
          from jsonb_array_elements_text(coalesce(cat->'users', '[]'::jsonb)) with ordinality as u(v, ord)
         where exists (select 1 from public.challenge_participants p where p.challenge_id = c.id and p.profile_id = u.v::uuid and p.status <> 'LEFT')) x
       where x.ord <= 10;
    end if;
  end loop;
end $$;

-- Cấu hình hạng mục: tối đa 8; khóa hợp lệ; số người 1..10; giải tự đặt ≤ 10 người
create or replace function private.honor_categories(p jsonb) returns jsonb
language plpgsql immutable as $$
declare v_out jsonb := '[]'::jsonb; cat jsonb; k text; seen text[] := '{}';
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 8 then raise exception 'INVALID_HONOR_CATEGORIES'; end if;
  for cat in select * from jsonb_array_elements(p) loop
    k := cat->>'key';
    if k is null or not (k = any (array['TOP', 'KM', 'DAYS', 'STREAK', 'BREAKTHROUGH', 'SUPPORTED']) or k ~ '^CUSTOM[1-5]$') or k = any (seen) then
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

create or replace function private.honor_row(p_challenge uuid, p_manage boolean, p_category text, p_rank integer, p_user uuid, p_value numeric)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'category', p_category, 'rank', p_rank, 'user_id', p_user, 'value', p_value,
    'hidden', coalesce(pf.hidden, false), 'is_me', p_user = auth.uid(),
    'display_name', case when coalesce(pf.hidden, false) then 'VĐV ẩn danh' else private.display_name(p_user) end,
    'avatar_url', case when coalesce(pf.hidden, false) then null else (select p.avatar_url from public.profiles p where p.id = p_user) end,
    'photo_url', case when coalesce(pf.hidden, false) then null else pf.photo_url end,
    'own_photo', case when p_user = auth.uid() or p_manage then pf.photo_url end)
    from (select 1) one
    left join public.challenge_honor_prefs pf on pf.challenge_id = p_challenge and pf.user_id = p_user
$$;

-- ---------------------------------------------------------------------
-- 6. RPC
-- ---------------------------------------------------------------------
create or replace function public.challenge_honor(p_challenge_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
  h public.challenge_honors := (select x from public.challenge_honors x where x.challenge_id = p_challenge_id);
  v_manage boolean;
  v_rows jsonb;
begin
  if c.id is null or not public.challenge_visible(c.id) then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  v_manage := auth.uid() is not null and private.challenge_is_manager(c);
  if h.challenge_id is not null and h.status = 'PUBLISHED' then
    v_rows := (select coalesce(jsonb_agg(private.honor_row(c.id, v_manage, r.category, r.rank, r.user_id, r.value) order by r.category, r.rank), '[]'::jsonb)
                 from public.challenge_honorees r where r.challenge_id = c.id);
  elsif v_manage then
    -- bản nháp: BTC xem trước danh sách tính từ dữ liệu hiện tại
    v_rows := (select coalesce(jsonb_agg(private.honor_row(c.id, v_manage, r.category, r.rank, r.user_id, r.value) order by r.category, r.rank), '[]'::jsonb)
                 from private.honor_compute(c, coalesce(h.categories, '[{"key":"TOP","count":3}]'::jsonb)) r);
  end if;
  return jsonb_build_object(
    'enabled', coalesce(h.enabled, false), 'status', coalesce(h.status, 'DRAFT'), 'published_at', h.published_at,
    'categories', coalesce(h.categories, '[]'::jsonb), 'design', h.design, 'card_design', h.card_design,
    'can_manage', v_manage, 'allowed', private.honor_allowed(c),
    'ended', now() >= c.end_date, 'review_until', c.end_date + interval '24 hours',
    'honorees', case when v_manage or (h.enabled and h.status = 'PUBLISHED') then coalesce(v_rows, '[]'::jsonb) else '[]'::jsonb end,
    'preview', not (h.challenge_id is not null and h.status = 'PUBLISHED'));
end $$;

create or replace function public.save_challenge_honor(p_challenge_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
begin
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if not private.challenge_is_manager(c) then raise exception 'FORBIDDEN'; end if;
  if not private.honor_allowed(c) then raise exception 'HONOR_PRO_REQUIRED'; end if;
  insert into public.challenge_honors (challenge_id, enabled, categories, design, card_design, updated_by, updated_at)
  values (c.id, private.bib_bool(p->'enabled', true), private.honor_categories(coalesce(p->'categories', '[]'::jsonb)),
          private.honor_design(c.id, p->'design'), private.honor_design(c.id, p->'card_design'), v_uid, now())
  on conflict (challenge_id) do update set
    enabled = excluded.enabled, categories = excluded.categories, design = excluded.design, card_design = excluded.card_design,
    updated_by = v_uid, updated_at = now();
  return public.challenge_honor(c.id);
end $$;

-- Chốt & công bố: sau khi kết thúc ≥ 24 giờ. Công bố lại được (tính lại từ dữ liệu mới nhất).
create or replace function public.publish_challenge_honor(p_challenge_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
  h public.challenge_honors := (select x from public.challenge_honors x where x.challenge_id = p_challenge_id);
  v_badge uuid := (select a.id from public.achievements a where a.code = 'HONORED');
  v_prev uuid[];
  r record;
begin
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if not private.challenge_is_manager(c) then raise exception 'FORBIDDEN'; end if;
  if not private.honor_allowed(c) then raise exception 'HONOR_PRO_REQUIRED'; end if;
  if c.status = 'CANCELLED' then raise exception 'HONOR_NOT_AVAILABLE'; end if;
  if h.challenge_id is null or not h.enabled or jsonb_array_length(h.categories) = 0 then raise exception 'HONOR_NOT_CONFIGURED'; end if;
  if now() < c.end_date + interval '24 hours' then raise exception 'HONOR_REVIEW_PENDING'; end if;

  v_prev := array(select distinct x.user_id from public.challenge_honorees x where x.challenge_id = c.id);
  delete from public.challenge_honorees x where x.challenge_id = c.id;
  insert into public.challenge_honorees (challenge_id, category, rank, user_id, value)
  select c.id, t.category, t.rank, t.user_id, t.value from private.honor_compute(c, h.categories) t
  on conflict do nothing;
  update public.challenge_honors set status = 'PUBLISHED', published_at = now(), updated_by = v_uid, updated_at = now() where challenge_id = c.id;

  -- Người mới được vinh danh: thông báo + huy hiệu
  for r in select distinct x.user_id from public.challenge_honorees x
            where x.challenge_id = c.id and not (x.user_id = any (v_prev)) loop
    perform private.notify(r.user_id, null, 'HONOR', 'Bạn được vinh danh 🏆',
      'Bạn có tên trong bảng vinh danh "' || c.title || '". Tải ảnh vinh danh để chia sẻ!', '/challenges/' || c.id || '?tab=honor', v_uid, true);
    if v_badge is not null then
      insert into public.user_achievements (user_id, achievement_id) values (r.user_id, v_badge) on conflict do nothing;
    end if;
  end loop;
  return public.challenge_honor(c.id);
end $$;

create or replace function public.unpublish_challenge_honor(p_challenge_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
begin
  perform private.require_uid();
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if not private.challenge_is_manager(c) then raise exception 'FORBIDDEN'; end if;
  update public.challenge_honors set status = 'DRAFT', updated_at = now() where challenge_id = c.id;
  return public.challenge_honor(c.id);
end $$;

-- Ảnh / ẩn danh của một runner: chính runner (ảnh + ẩn) hoặc BTC (chỉ ảnh)
create or replace function public.set_honor_pref(p_challenge_id uuid, p_user_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
  v_self boolean := p_user_id = v_uid;
begin
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if not v_self and not private.challenge_is_manager(c) then raise exception 'FORBIDDEN'; end if;
  if not v_self and p ? 'hidden' then raise exception 'FORBIDDEN'; end if;              -- chỉ chính runner được ẩn mình
  if not exists (select 1 from public.challenge_participants x where x.challenge_id = c.id and x.profile_id = p_user_id) then
    raise exception 'NOT_A_PARTICIPANT';
  end if;
  if p ? 'photo_url' and not private.honor_media_ok(c.id, p->>'photo_url') then raise exception 'INVALID_HONOR_IMAGE'; end if;
  insert into public.challenge_honor_prefs (challenge_id, user_id, photo_url, photo_by, hidden, updated_at)
  values (c.id, p_user_id, p->>'photo_url', case when p ? 'photo_url' then v_uid end, private.bib_bool(p->'hidden', false), now())
  on conflict (challenge_id, user_id) do update set
    photo_url = case when p ? 'photo_url' then excluded.photo_url else challenge_honor_prefs.photo_url end,
    photo_by = case when p ? 'photo_url' then v_uid else challenge_honor_prefs.photo_by end,
    hidden = case when p ? 'hidden' then excluded.hidden else challenge_honor_prefs.hidden end,
    updated_at = now();
  if p ? 'photo_url' and not v_self and p->>'photo_url' is not null then
    perform private.notify(p_user_id, null, 'HONOR', 'BTC đã chọn ảnh vinh danh cho bạn',
      'Thử thách "' || c.title || '". Bạn có thể đổi ảnh khác hoặc ẩn mình khỏi ảnh công khai.', '/challenges/' || c.id || '?tab=honor', v_uid, false);
  end if;
  return public.challenge_honor(c.id);
end $$;

revoke all on function private.honor_media_ok(uuid, text), private.honor_allowed(public.challenges), private.honor_layers(uuid, jsonb, text[]),
  private.honor_design(uuid, jsonb), private.honor_compute(public.challenges, jsonb), private.honor_categories(jsonb),
  private.honor_row(uuid, boolean, text, integer, uuid, numeric) from public, anon, authenticated;
revoke all on function public.challenge_honor(uuid), public.save_challenge_honor(uuid, jsonb), public.publish_challenge_honor(uuid),
  public.unpublish_challenge_honor(uuid), public.set_honor_pref(uuid, uuid, jsonb), public.can_upload_honor_media(text) from public, anon;
grant execute on function public.challenge_honor(uuid) to anon, authenticated;
grant execute on function public.save_challenge_honor(uuid, jsonb), public.publish_challenge_honor(uuid),
  public.unpublish_challenge_honor(uuid), public.set_honor_pref(uuid, uuid, jsonb), public.can_upload_honor_media(text) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001005000_club_ownership_fix.sql
-- ===================================================================
-- 005000: Sửa lỗi trao quyền Chủ nhiệm / Chủ nhiệm rời CLB.
-- Lỗi gốc (hàm cũ trên production): chủ nhiệm cũ bị đổi sang vai trò 'VICE' — vai trò không tồn tại
-- (club_members chỉ nhận OWNER / CAPTAIN / MEMBER) → vi phạm CHECK → "Không thực hiện được".
-- Rời CLB khi là chủ nhiệm: tự chọn người kế nhiệm theo 'VICE' → không bao giờ tìm được.
-- Bản mới: chủ nhiệm cũ thành Quản trị viên (CAPTAIN); người nhận phải là thành viên đã duyệt;
-- cập nhật clubs.owner_id; ghi nhật ký; báo cho chủ nhiệm mới.
-- Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

create or replace function public.transfer_club_ownership(p_club_id uuid, p_new_owner_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_club text := (select c.name from public.clubs c where c.id = p_club_id);
begin
  if v_club is null then raise exception 'CLUB_NOT_FOUND'; end if;
  if p_new_owner_id is null or p_new_owner_id = v_uid then raise exception 'CANNOT_TRANSFER_TO_SELF'; end if;
  if not exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = v_uid and m.role = 'OWNER' and m.status = 'APPROVED') then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if not exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = p_new_owner_id and m.status = 'APPROVED') then
    raise exception 'TARGET_NOT_MEMBER';
  end if;
  update public.club_members set role = 'CAPTAIN' where club_id = p_club_id and user_id = v_uid;
  update public.club_members set role = 'OWNER' where club_id = p_club_id and user_id = p_new_owner_id;
  update public.clubs set owner_id = p_new_owner_id where id = p_club_id;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'CLUB_TRANSFER_OWNER', 'club:' || p_club_id, jsonb_build_object('from', v_uid, 'to', p_new_owner_id));
  perform private.notify(p_new_owner_id, p_club_id, 'CLUB_ROLE', 'Bạn là Chủ nhiệm mới của ' || v_club,
    'Quyền Chủ nhiệm CLB đã được trao cho bạn.', '/clubs/' || p_club_id, v_uid, true);
end $$;

create or replace function public.leave_club(p_club_id uuid, p_new_owner_id uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_role text := (select m.role from public.club_members m where m.club_id = p_club_id and m.user_id = v_uid);
  v_next uuid;
begin
  if v_role is null then raise exception 'NOT_A_MEMBER'; end if;
  if v_role <> 'OWNER' then
    delete from public.club_members where club_id = p_club_id and user_id = v_uid;
    return;
  end if;
  if not exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id <> v_uid and m.status = 'APPROVED') then
    raise exception 'LAST_MEMBER_MUST_DELETE';
  end if;
  if p_new_owner_id is not null then
    if p_new_owner_id = v_uid then raise exception 'CANNOT_TRANSFER_TO_SELF'; end if;
    if not exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = p_new_owner_id and m.status = 'APPROVED') then
      raise exception 'TARGET_NOT_MEMBER';
    end if;
    v_next := p_new_owner_id;
  else
    -- tự chọn Quản trị viên vào CLB sớm nhất
    v_next := (select x.user_id from (
      select m.user_id, row_number() over (order by m.joined_at, m.user_id) as rn
        from public.club_members m
       where m.club_id = p_club_id and m.user_id <> v_uid and m.status = 'APPROVED' and m.role = 'CAPTAIN') x where x.rn = 1);
    if v_next is null then raise exception 'MUST_ASSIGN_NEW_OWNER'; end if;
  end if;
  -- mỗi CLB chỉ một Chủ nhiệm (club_members_single_owner): rời trước, nâng người kế nhiệm sau
  delete from public.club_members where club_id = p_club_id and user_id = v_uid;
  update public.club_members set role = 'OWNER' where club_id = p_club_id and user_id = v_next;
  update public.clubs set owner_id = v_next where id = p_club_id;
  perform private.notify(v_next, p_club_id, 'CLUB_ROLE', 'Bạn là Chủ nhiệm mới',
    'Chủ nhiệm cũ đã rời CLB và trao quyền cho bạn.', '/clubs/' || p_club_id, v_uid, true);
end $$;

revoke all on function public.transfer_club_ownership(uuid, uuid), public.leave_club(uuid, uuid) from public, anon;
grant execute on function public.transfer_club_ownership(uuid, uuid), public.leave_club(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001005100_item_promotions.sql
-- ===================================================================
-- 005100: Khuyến mãi vật phẩm (Xu) — Vật phẩm · Giá gốc · Chương trình tách riêng.
-- • 8 loại: FREE (tặng miễn phí) · TRIAL (dùng thử đồ nhân vật N ngày) · SALE (giảm %) · FLASH (giảm % ngắn hạn, số lượng thật)
--   · BUNDLE (gói nhiều đồ nhân vật, giá gói) · EVENT (giảm % theo dịp, gom nhóm) · FIRST_PURCHASE (lần mua đầu) · COMEBACK (runner quay lại).
-- • Áp cho vật phẩm nhân vật (AVATAR) và quà tặng (GIFT). Mỗi vật phẩm chỉ MỘT chương trình đang chạy (không cộng dồn → không về 0 Xu).
-- • Giới hạn: tổng số lượt (đếm thật, không nhập tay), số lượt / người, nhóm được hưởng (tất cả / người mới / quay lại / VIP).
-- • Quà tặng giảm giá / miễn phí: Tỏa sáng của người nhận tính theo XU THỰC TRẢ (quà miễn phí = 0) → không nuôi Tỏa sáng bằng quà free.
-- • Không có vật phẩm "DÙNG" tăng XP / km (XP chỉ từ km). Dùng thử chỉ là đồ trang trí, hết hạn tự tháo.
-- Cần 004700. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 1. Bảng
-- ---------------------------------------------------------------------
create table if not exists public.item_promotions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('FREE', 'TRIAL', 'SALE', 'FLASH', 'BUNDLE', 'EVENT', 'FIRST_PURCHASE', 'COMEBACK')),
  title text not null check (char_length(title) between 2 and 80),
  badge text check (badge is null or char_length(badge) <= 24),
  item_type text check (item_type in ('AVATAR', 'GIFT')),
  item_code text,
  bundle_items text[],                                -- BUNDLE: mã đồ nhân vật
  discount_pct integer not null default 0 check (discount_pct between 0 and 100),
  fixed_price integer check (fixed_price is null or fixed_price >= 0),
  quantity_limit integer check (quantity_limit is null or quantity_limit > 0),
  per_user_limit integer check (per_user_limit is null or per_user_limit > 0),
  trial_days integer check (trial_days is null or trial_days between 1 and 30),
  segment text not null default 'ALL' check (segment in ('ALL', 'NEW', 'COMEBACK', 'VIP')),
  event_key text check (event_key is null or char_length(event_key) <= 40),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create index if not exists item_promotions_item_idx on public.item_promotions (item_type, item_code) where is_active;
create table if not exists public.item_promo_redemptions (
  id uuid primary key default gen_random_uuid(),
  promo_id uuid not null references public.item_promotions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  qty integer not null default 1,
  xu_paid integer not null default 0,
  ref text unique,
  created_at timestamptz not null default now()
);
create index if not exists item_promo_redemptions_idx on public.item_promo_redemptions (promo_id, user_id);
alter table public.item_promotions enable row level security;
alter table public.item_promo_redemptions enable row level security;

-- Dùng thử: đồ hết hạn tự tháo
alter table public.user_inventory add column if not exists expires_at timestamptz;
-- Quà: amount = Xu thực trả (có thể 0 khi miễn phí), list_amount = giá gốc
alter table public.cheers drop constraint if exists cheers_amount_chk;
alter table public.cheers add constraint cheers_amount_chk check (amount between 0 and 100000000);
alter table public.cheers add column if not exists list_amount numeric(12, 1);
alter table public.cheers add column if not exists promo_id uuid references public.item_promotions(id) on delete set null;

-- ---------------------------------------------------------------------
-- 2. Ai được hưởng + giá cuối
-- ---------------------------------------------------------------------
create or replace function private.promo_segment_ok(p_user uuid, p_segment text) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_segment
    when 'ALL' then true
    when 'NEW' then coalesce((select p.created_at >= now() - interval '14 days' from public.profiles p where p.id = p_user), false)
    when 'VIP' then private.user_vip_tier(p_user) > 0
    -- quay lại: tài khoản ≥ 30 ngày, không có bài hợp lệ trong 14 ngày trước tuần này
    when 'COMEBACK' then coalesce((select p.created_at <= now() - interval '30 days' from public.profiles p where p.id = p_user), false)
      and not exists (select 1 from public.activities a where a.user_id = p_user and a.validation_status = 'APPROVED'
                        and a.started_at >= now() - interval '21 days' and a.started_at < now() - interval '7 days')
    else false end
$$;

create or replace function private.promo_used(p_promo uuid, p_user uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(sum(r.qty), 0)::int from public.item_promo_redemptions r where r.promo_id = p_promo and (p_user is null or r.user_id = p_user)
$$;

-- Người đã từng mua bằng Xu (vật phẩm / quà) — cho FIRST_PURCHASE
create or replace function private.has_purchased(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_inventory i where i.user_id = p_user and i.acquired_reason in ('PURCHASE', 'PROMO'))
      or exists (select 1 from public.cheers c where c.from_user = p_user and c.gift_code is not null and c.amount > 0)
$$;

create or replace function private.promo_live(p public.item_promotions) returns boolean
language sql stable as $$
  select p.is_active and p.starts_at <= now() and (p.ends_at is null or p.ends_at > now())
     and (p.quantity_limit is null or private.promo_used(p.id, null) < p.quantity_limit)
$$;

-- Chương trình đang áp cho một vật phẩm với một người (null nếu không có). qty = số lượng muốn mua (quà)
drop function if exists private.item_offer(uuid, text, text, integer, integer);
create or replace function private.item_offer(p_user uuid, p_type text, p_code text, p_base numeric, p_qty integer default 1) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  -- mỗi vật phẩm chỉ một chương trình chạy cùng lúc (admin chặn chồng lấn); thứ tự chỉ để chắc chắn
  p public.item_promotions := (select q.x from (
                                 select x, row_number() over (order by case x.kind when 'FLASH' then 1 when 'EVENT' then 2 when 'FIRST_PURCHASE' then 3
                                                      when 'COMEBACK' then 3 when 'FREE' then 4 when 'TRIAL' then 5 else 6 end, x.created_at) as rn
                                   from public.item_promotions x
                                  where x.item_type = p_type and x.item_code = p_code and x.kind <> 'BUNDLE' and private.promo_live(x)) q
                                where q.rn = 1);
  v_unit integer;
  v_left integer;
  v_eligible boolean;
begin
  if p.id is null then return null; end if;
  v_eligible := p_user is not null and private.promo_segment_ok(p_user, p.segment)
    and (p.kind <> 'FIRST_PURCHASE' or not private.has_purchased(p_user))
    and (p.per_user_limit is null or private.promo_used(p.id, p_user) + coalesce(p_qty, 1) <= p.per_user_limit);
  v_unit := case p.kind when 'FREE' then 0 when 'TRIAL' then 0
                        else greatest(0, round(p_base * (100 - p.discount_pct) / 100.0))::int end;
  p_base := round(p_base);
  v_left := case when p.quantity_limit is null then null else p.quantity_limit - private.promo_used(p.id, null) end;
  return jsonb_build_object('promo_id', p.id, 'kind', p.kind, 'title', p.title, 'badge', coalesce(p.badge, case p.kind
            when 'FREE' then 'MIỄN PHÍ' when 'TRIAL' then 'DÙNG THỬ' when 'FLASH' then 'FLASH SALE' when 'FIRST_PURCHASE' then 'LẦN ĐẦU'
            when 'COMEBACK' then 'CHÀO MỪNG TRỞ LẠI' else '-' || p.discount_pct || '%' end),
    'base', p_base, 'price', v_unit, 'discount_pct', case when p_base > 0 then round(100 - v_unit * 100.0 / p_base) else 0 end,
    'ends_at', p.ends_at, 'left', v_left, 'sold', private.promo_used(p.id, null), 'limit', p.quantity_limit,
    'per_user_limit', p.per_user_limit, 'used', case when p_user is null then 0 else private.promo_used(p.id, p_user) end,
    'trial_days', p.trial_days, 'eligible', v_eligible, 'segment', p.segment, 'event_key', p.event_key);
end $$;

-- ---------------------------------------------------------------------
-- 3. Mua vật phẩm nhân vật: giá theo chương trình; dùng thử; gói
-- ---------------------------------------------------------------------
create or replace function public.buy_avatar_item(p_code text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  i public.avatar_items := (select x from public.avatar_items x where x.code = p_code and x.is_active);
  v_level integer;
  o jsonb;
  v_price integer;
  v_trial boolean := false;
  v_owned public.user_inventory;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if exists (select 1 from public.ledger_transactions where idempotency_key = 'shop:' || p_idempotency_key)
     or exists (select 1 from public.item_promo_redemptions where ref = 'shop:' || p_idempotency_key) then
    return jsonb_build_object('duplicate', true, 'balance', private.balance(v_uid));
  end if;
  if i.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if coalesce(i.metadata->>'acquire', '') = 'shine' then raise exception 'SHINE_ONLY'; end if;
  perform pg_advisory_xact_lock(hashtextextended('shop:' || v_uid, 0));
  v_owned := (select x from public.user_inventory x where x.user_id = v_uid and x.item_id = i.id);
  if v_owned.id is not null and (v_owned.expires_at is null or v_owned.expires_at > now()) and v_owned.acquired_reason <> 'TRIAL' then
    raise exception 'ALREADY_OWNED';
  end if;
  v_level := coalesce((select level from public.profiles where id = v_uid), 1);
  if v_level < i.unlock_level then raise exception 'LEVEL_TOO_LOW'; end if;

  o := private.item_offer(v_uid, 'AVATAR', i.code, i.price_xu, 1);
  if o is not null and (o->>'eligible')::boolean and o->>'kind' <> 'TRIAL' then v_price := (o->>'price')::int;
  else v_price := i.price_xu; o := null; end if;

  if v_price > 0 then
    if private.balance(v_uid) < v_price then raise exception 'INSUFFICIENT_BALANCE'; end if;
    perform private.ledger_post('SHOP_ITEM', 'shop:' || p_idempotency_key, 'Mua ' || i.name || case when o is not null then ' (' || (o->>'title') || ')' else '' end,
      v_uid, private.debit_entries(v_uid, v_price, private.system_account()));
  end if;
  if o is not null then
    insert into public.item_promo_redemptions (promo_id, user_id, qty, xu_paid, ref) values ((o->>'promo_id')::uuid, v_uid, 1, v_price, 'shop:' || p_idempotency_key);
  end if;
  delete from public.user_inventory where user_id = v_uid and item_id = i.id;          -- mua đứt thay cho bản dùng thử
  insert into public.user_inventory (user_id, item_id, acquired_reason)
  values (v_uid, i.id, case when o is not null then 'PROMO' when v_price > 0 then 'PURCHASE' else 'FREE' end);
  return jsonb_build_object('code', i.code, 'paid', v_price, 'balance', private.balance(v_uid));
end $$;

create or replace function public.try_avatar_item(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  i public.avatar_items := (select x from public.avatar_items x where x.code = p_code and x.is_active);
  o jsonb;
  v_until timestamptz;
begin
  if i.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  o := private.item_offer(v_uid, 'AVATAR', i.code, i.price_xu, 1);
  if o is null or o->>'kind' <> 'TRIAL' then raise exception 'PROMO_NOT_AVAILABLE'; end if;
  if not (o->>'eligible')::boolean then raise exception 'PROMO_LIMIT_REACHED'; end if;
  if exists (select 1 from public.user_inventory x where x.user_id = v_uid and x.item_id = i.id) then raise exception 'ALREADY_OWNED'; end if;
  -- mỗi người dùng thử một món một lần (kể cả đã hết hạn, bị tháo)
  if exists (select 1 from public.item_promo_redemptions r join public.item_promotions p on p.id = r.promo_id
              where r.user_id = v_uid and p.kind = 'TRIAL' and p.item_code = i.code) then raise exception 'TRIAL_USED'; end if;
  v_until := now() + make_interval(days => coalesce((o->>'trial_days')::int, 3));
  insert into public.user_inventory (user_id, item_id, acquired_reason, expires_at) values (v_uid, i.id, 'TRIAL', v_until);
  insert into public.item_promo_redemptions (promo_id, user_id, qty, xu_paid, ref) values ((o->>'promo_id')::uuid, v_uid, 1, 0, 'trial:' || v_uid || ':' || i.code);
  return jsonb_build_object('code', i.code, 'expires_at', v_until);
end $$;

create or replace function public.buy_item_bundle(p_promo_id uuid, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  p public.item_promotions := (select x from public.item_promotions x where x.id = p_promo_id and x.kind = 'BUNDLE');
  v_price integer;
  c text;
  v_n integer := 0;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if exists (select 1 from public.item_promo_redemptions where ref = 'bundle:' || p_idempotency_key) then
    return jsonb_build_object('duplicate', true, 'balance', private.balance(v_uid));
  end if;
  if p.id is null or not private.promo_live(p) then raise exception 'PROMO_NOT_AVAILABLE'; end if;
  if not private.promo_segment_ok(v_uid, p.segment) then raise exception 'PROMO_NOT_ELIGIBLE'; end if;
  if private.promo_used(p.id, v_uid) >= coalesce(p.per_user_limit, 1) then raise exception 'PROMO_LIMIT_REACHED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('shop:' || v_uid, 0));
  v_price := coalesce(p.fixed_price, 0);
  if v_price > 0 then
    if private.balance(v_uid) < v_price then raise exception 'INSUFFICIENT_BALANCE'; end if;
    perform private.ledger_post('SHOP_ITEM', 'bundle:' || p_idempotency_key, 'Mua gói ' || p.title, v_uid,
      private.debit_entries(v_uid, v_price, private.system_account()));
  end if;
  foreach c in array coalesce(p.bundle_items, '{}') loop
    delete from public.user_inventory x using public.avatar_items i
     where x.user_id = v_uid and x.item_id = i.id and i.code = c and x.acquired_reason = 'TRIAL';
    insert into public.user_inventory (user_id, item_id, acquired_reason)
    select v_uid, i.id, 'PROMO' from public.avatar_items i
     where i.code = c and i.is_active and not exists (select 1 from public.user_inventory x where x.user_id = v_uid and x.item_id = i.id);
    if found then v_n := v_n + 1; end if;
  end loop;
  insert into public.item_promo_redemptions (promo_id, user_id, qty, xu_paid, ref) values (p.id, v_uid, 1, v_price, 'bundle:' || p_idempotency_key);
  return jsonb_build_object('items', v_n, 'paid', v_price, 'balance', private.balance(v_uid));
end $$;

-- Hết hạn dùng thử → tháo khỏi người + xóa khỏi tủ đồ
create or replace function private.expire_trials(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if not exists (select 1 from public.user_inventory where user_id = p_user and expires_at is not null and expires_at <= now()) then return; end if;
  foreach k in array private.character_slots() loop
    execute format('update public.user_equipment e set %1$I = null where e.user_id = $1 and %1$I in
                     (select x.item_id from public.user_inventory x where x.user_id = $1 and x.expires_at is not null and x.expires_at <= now())',
                   k || '_item_id') using p_user;
  end loop;
  delete from public.user_inventory where user_id = p_user and expires_at is not null and expires_at <= now();
end $$;

create or replace function private.ensure_character(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k text; v_id uuid;
begin
  insert into public.user_avatar (user_id) values (p_user) on conflict (user_id) do nothing;
  perform private.expire_trials(p_user);
  perform private.grant_free_items(p_user);
  insert into public.user_equipment (user_id) values (p_user) on conflict (user_id) do nothing;
  foreach k in array private.character_slots() loop
    v_id := (select (to_jsonb(e) ->> (k || '_item_id'))::uuid from public.user_equipment e where e.user_id = p_user);
    if v_id is not null and exists (select 1 from public.avatar_items where id = v_id and is_active) then continue; end if;
    if k = any(private.character_required_slots()) then
      v_id := (select id from public.avatar_items where code = k || '_original');
    else
      if v_id is null then continue; end if;
      v_id := null;
    end if;
    execute format('update public.user_equipment set %I = $1, updated_at = now() where user_id = $2', k || '_item_id') using v_id, p_user;
  end loop;
end $$;

-- Tủ đồ / cửa hàng kèm chương trình đang áp + hạn dùng thử + gói đang bán
create or replace function public.character_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); v_items jsonb;
begin
  perform private.ensure_character(v_uid);
  v_items := (select coalesce(jsonb_agg(private.item_json(i) || jsonb_build_object(
                  'owned', inv.item_id is not null and inv.acquired_reason <> 'TRIAL',
                  'trial_until', case when inv.acquired_reason = 'TRIAL' then inv.expires_at end,
                  'offer', private.item_offer(v_uid, 'AVATAR', i.code, i.price_xu, 1)) order by i.category, i.sort, i.name), '[]'::jsonb)
                from public.avatar_items i
                left join public.user_inventory inv on inv.item_id = i.id and inv.user_id = v_uid
               where i.is_active and i.code is not null);
  return (private.character_look(v_uid) - 'items') || jsonb_build_object(
    'level', coalesce((select level from public.profiles where id = v_uid), 1),
    'balance', private.balance(v_uid),
    'gender_set', (select gender is not null from public.profiles where id = v_uid),
    'items', v_items,
    'bundles', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'badge', p.badge, 'price', p.fixed_price,
                  'base', (select coalesce(sum(i.price_xu), 0) from public.avatar_items i where i.code = any (p.bundle_items)),
                  'items', p.bundle_items, 'ends_at', p.ends_at, 'bought', private.promo_used(p.id, v_uid) >= coalesce(p.per_user_limit, 1),
                  'left', case when p.quantity_limit is null then null else p.quantity_limit - private.promo_used(p.id, null) end) order by p.created_at desc), '[]'::jsonb)
                  from public.item_promotions p
                 where p.kind = 'BUNDLE' and private.promo_live(p) and private.promo_segment_ok(v_uid, p.segment)));
end $$;

-- ---------------------------------------------------------------------
-- 4. Quà tặng theo giá khuyến mãi (Tỏa sáng = Xu thực trả)
-- ---------------------------------------------------------------------
create or replace function public.gift_catalog() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'gifts', (select coalesce(jsonb_agg(jsonb_build_object('code', g.code, 'name', g.name, 'emoji', g.emoji, 'price_xu', g.price_xu,
                'tier', g.tier, 'description', g.description, 'vip_tier', g.vip_tier, 'seasonal', g.season_from is not null,
                'locked', g.vip_tier > private.user_vip_tier(auth.uid()),
                'offer', private.item_offer(auth.uid(), 'GIFT', g.code, g.price_xu, 1)) order by g.sort, g.price_xu), '[]'::jsonb)
              from public.gift_catalog g where g.is_active and private.gift_in_season(g, private.vn_day(now()))),
    'daily_cap', coalesce((private.economy_config()->>'giftDailyCapXu')::int, 20000),
    'sent_today', coalesce((select sum(c.amount) from public.cheers c where c.from_user = auth.uid() and c.gift_code is not null
                             and c.created_at >= private.vn_start(private.vn_day(now()))), 0))
$$;

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
    if v_club is null or not public.club_is_member(v_club) or v_author is distinct from p_to_user then raise exception 'FORBIDDEN'; end if;
  end if;
  if p_activity_id is not null and not exists (select 1 from public.activities where id = p_activity_id and user_id = p_to_user) then
    raise exception 'FORBIDDEN';
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
  insert into public.cheers (from_user, to_user, amount, list_amount, promo_id, message, activity_id, post_id, club_id, idempotency_key, gift_code, qty)
  values (v_uid, p_to_user, v_total, v_list, v_promo, v_msg, p_activity_id, p_post_id, v_club, p_idempotency_key, g.code, v_qty)
  returning id into v_id;
  if v_promo is not null then
    insert into public.item_promo_redemptions (promo_id, user_id, qty, xu_paid, ref) values (v_promo, v_uid, v_qty, v_total, 'gift:' || p_idempotency_key);
  end if;
  if p_post_id is not null then update public.club_posts set cheer_xu = cheer_xu + v_total where id = p_post_id; end if;

  v_name := private.display_name(v_uid);
  perform private.award(p_to_user, 'GIFT_IN', v_name || ' tặng bạn ' || case when v_qty > 1 then v_qty || ' × ' else '' end || g.emoji || ' ' || g.name,
    v_msg, 0, 0, 'gift_in:' || v_id, p_activity_id, jsonb_build_object('from', v_uid, 'gift', g.code, 'emoji', g.emoji, 'qty', v_qty, 'tier', g.tier));
  perform private.notify(p_to_user, v_club, 'GIFT', v_name || ' tặng bạn ' || case when v_qty > 1 then v_qty || ' × ' else '' end || g.emoji || ' ' || g.name,
    coalesce(v_msg, g.description), case when p_activity_id is not null then '/activities/' || p_activity_id
                                         when v_club is not null then '/clubs/' || v_club else '/me' end, v_uid, g.tier in ('HYPE', 'LEGEND'));
  return jsonb_build_object('gift_id', v_id, 'total_xu', v_total, 'list_xu', v_list, 'emoji', g.emoji, 'tier', g.tier, 'qty', v_qty,
    'balance', private.balance(v_uid));
end $$;

-- ---------------------------------------------------------------------
-- 5. Admin
-- ---------------------------------------------------------------------
create or replace function private.promo_json(p public.item_promotions) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(p) || jsonb_build_object(
    'live', private.promo_live(p), 'sold', private.promo_used(p.id, null),
    'buyers', (select count(distinct r.user_id) from public.item_promo_redemptions r where r.promo_id = p.id),
    'xu_paid', (select coalesce(sum(r.xu_paid), 0) from public.item_promo_redemptions r where r.promo_id = p.id),
    'item_name', case p.item_type when 'AVATAR' then (select i.name from public.avatar_items i where i.code = p.item_code)
                                  when 'GIFT' then (select g.emoji || ' ' || g.name from public.gift_catalog g where g.code = p.item_code) end,
    'base_price', case p.item_type when 'AVATAR' then (select i.price_xu from public.avatar_items i where i.code = p.item_code)
                                   when 'GIFT' then (select g.price_xu from public.gift_catalog g where g.code = p.item_code) end)
$$;

create or replace function public.admin_list_item_promotions() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'promotions', (select coalesce(jsonb_agg(private.promo_json(p) order by private.promo_live(p) desc, p.created_at desc), '[]'::jsonb)
                     from public.item_promotions p where p.created_at >= now() - interval '180 days' or p.is_active),
    'avatar_items', (select coalesce(jsonb_agg(jsonb_build_object('code', i.code, 'name', i.name, 'price_xu', i.price_xu, 'slot', i.category,
                       'rarity', i.rarity) order by i.category, i.price_xu), '[]'::jsonb)
                       from public.avatar_items i where i.is_active and i.code is not null and i.price_xu > 0
                        and coalesce(i.metadata->>'acquire', '') <> 'shine'),
    'gifts', (select coalesce(jsonb_agg(jsonb_build_object('code', g.code, 'name', g.emoji || ' ' || g.name, 'price_xu', g.price_xu) order by g.price_xu), '[]'::jsonb)
                from public.gift_catalog g where g.is_active));
end $$;

create or replace function public.admin_save_item_promotion(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_kind text := upper(coalesce(p->>'kind', ''));
  v_type text := nullif(upper(coalesce(p->>'item_type', '')), '');
  v_code text := nullif(p->>'item_code', '');
  v_items text[];
  v_start timestamptz := coalesce(nullif(p->>'starts_at', '')::timestamptz, now());
  v_end timestamptz := nullif(p->>'ends_at', '')::timestamptz;
  v_pct integer := coalesce((p->>'discount_pct')::int, 0);
  r public.item_promotions;
begin
  if v_kind not in ('FREE', 'TRIAL', 'SALE', 'FLASH', 'BUNDLE', 'EVENT', 'FIRST_PURCHASE', 'COMEBACK') then raise exception 'INVALID_PROMO'; end if;
  if char_length(trim(coalesce(p->>'title', ''))) < 2 then raise exception 'INVALID_PROMO_TITLE'; end if;
  if v_end is not null and v_end <= v_start then raise exception 'INVALID_TIME_RANGE'; end if;
  if v_kind = 'FLASH' and (v_end is null or v_end > v_start + interval '72 hours') then raise exception 'FLASH_TOO_LONG'; end if;
  if v_kind in ('SALE', 'FLASH', 'EVENT', 'FIRST_PURCHASE', 'COMEBACK') and (v_pct < 5 or v_pct > 90) then
    -- quà miễn phí dùng loại FREE; không cho giảm 100% qua SALE
    raise exception 'INVALID_DISCOUNT';
  end if;
  if v_kind = 'BUNDLE' then
    v_items := array(select distinct x from jsonb_array_elements_text(coalesce(p->'bundle_items', '[]'::jsonb)) x);
    if cardinality(v_items) < 2 or cardinality(v_items) > 12
       or exists (select 1 from unnest(v_items) c where not exists (select 1 from public.avatar_items i where i.code = c and i.is_active)) then
      raise exception 'INVALID_BUNDLE';
    end if;
    if coalesce((p->>'fixed_price')::int, -1) < 0 then raise exception 'INVALID_BUNDLE'; end if;
    v_type := null; v_code := null;
  else
    if v_type not in ('AVATAR', 'GIFT') then raise exception 'INVALID_PROMO'; end if;
    if v_type = 'AVATAR' and not exists (select 1 from public.avatar_items i where i.code = v_code and i.is_active) then raise exception 'ITEM_NOT_FOUND'; end if;
    if v_type = 'GIFT' and not exists (select 1 from public.gift_catalog g where g.code = v_code and g.is_active) then raise exception 'GIFT_NOT_AVAILABLE'; end if;
    if v_kind = 'TRIAL' and v_type <> 'AVATAR' then raise exception 'TRIAL_AVATAR_ONLY'; end if;
    if v_kind = 'FREE' and coalesce((p->>'per_user_limit')::int, 0) < 1 then raise exception 'FREE_NEEDS_LIMIT'; end if;   -- chống farm
    -- mỗi vật phẩm chỉ một chương trình đang chạy (khoảng thời gian chồng nhau)
    if exists (select 1 from public.item_promotions x
                where x.is_active and x.item_type = v_type and x.item_code = v_code and x.id is distinct from v_id
                  and x.starts_at < coalesce(v_end, 'infinity'::timestamptz) and coalesce(x.ends_at, 'infinity'::timestamptz) > v_start) then
      raise exception 'PROMO_OVERLAP';
    end if;
  end if;

  insert into public.item_promotions as t (id, kind, title, badge, item_type, item_code, bundle_items, discount_pct, fixed_price, quantity_limit,
    per_user_limit, trial_days, segment, event_key, starts_at, ends_at, is_active, created_by)
  values (coalesce(v_id, gen_random_uuid()), v_kind, trim(p->>'title'), nullif(left(trim(coalesce(p->>'badge', '')), 24), ''), v_type, v_code, v_items,
    case when v_kind in ('FREE', 'TRIAL', 'BUNDLE') then 0 else v_pct end,
    case when v_kind = 'BUNDLE' then (p->>'fixed_price')::int end,
    nullif((p->>'quantity_limit')::int, 0), nullif((p->>'per_user_limit')::int, 0),
    case when v_kind = 'TRIAL' then least(30, greatest(1, coalesce((p->>'trial_days')::int, 3))) end,
    coalesce(nullif(upper(p->>'segment'), ''), case v_kind when 'COMEBACK' then 'COMEBACK' else 'ALL' end),
    nullif(left(trim(coalesce(p->>'event_key', '')), 40), ''), v_start, v_end, coalesce((p->>'is_active')::boolean, true), v_uid)
  on conflict (id) do update set kind = excluded.kind, title = excluded.title, badge = excluded.badge, item_type = excluded.item_type,
    item_code = excluded.item_code, bundle_items = excluded.bundle_items, discount_pct = excluded.discount_pct, fixed_price = excluded.fixed_price,
    quantity_limit = excluded.quantity_limit, per_user_limit = excluded.per_user_limit, trial_days = excluded.trial_days, segment = excluded.segment,
    event_key = excluded.event_key, starts_at = excluded.starts_at, ends_at = excluded.ends_at, is_active = excluded.is_active
  returning * into r;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SAVE_ITEM_PROMO', 'promo:' || r.id, p);
  return private.promo_json(r);
end $$;

create or replace function public.admin_end_item_promotion(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_admin();
begin
  update public.item_promotions set is_active = false, ends_at = least(coalesce(ends_at, now()), now()) where id = p_id;
  insert into public.admin_audit_log (actor_id, action, target) values (v_uid, 'END_ITEM_PROMO', 'promo:' || p_id);
end $$;

revoke all on function private.promo_segment_ok(uuid, text), private.promo_used(uuid, uuid), private.has_purchased(uuid),
  private.promo_live(public.item_promotions), private.item_offer(uuid, text, text, numeric, integer), private.expire_trials(uuid),
  private.promo_json(public.item_promotions) from public, anon, authenticated;
revoke all on function public.buy_avatar_item(text, text), public.try_avatar_item(text), public.buy_item_bundle(uuid, text),
  public.admin_list_item_promotions(), public.admin_save_item_promotion(jsonb), public.admin_end_item_promotion(uuid) from public, anon;
grant execute on function public.buy_avatar_item(text, text), public.try_avatar_item(text), public.buy_item_bundle(uuid, text),
  public.admin_list_item_promotions(), public.admin_save_item_promotion(jsonb), public.admin_end_item_promotion(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001005200_sponsor_vouchers.sql
-- ===================================================================
-- 005200: Voucher tài trợ trên thử thách / nhiệm vụ (bước đầu của Market — RaceHub KHÔNG giữ tiền).
-- • Nhà tài trợ (shop, HLV, dịch vụ) đưa voucher; runner hoàn thành thử thách / đạt Top N / hoàn thành nhiệm vụ → nhận mã.
-- • Hai kiểu mã: POOL (danh sách mã riêng, mỗi người một mã, hết kho thì dừng) · SHARED (một mã chung cho mọi người đạt điều kiện).
-- • Ai tạo: admin (mọi thử thách / nhiệm vụ) hoặc Ban tổ chức thử thách đó (chỉ cho thử thách của mình).
-- • Voucher KHÔNG phải XP, không phải Xu. Người nhận xem ở Tôi → Voucher, tự đánh dấu đã dùng.
-- • Mã chỉ người nhận xem được; BTC / admin xem số lượng phát, còn lại.
-- Cần 004600. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

create table if not exists public.voucher_campaigns (
  id uuid primary key default gen_random_uuid(),
  sponsor_name text not null check (char_length(sponsor_name) between 2 and 60),
  sponsor_logo text check (sponsor_logo is null or (sponsor_logo ~ '^https://' and char_length(sponsor_logo) <= 500)),
  title text not null check (char_length(title) between 3 and 80),
  terms text check (terms is null or char_length(terms) <= 500),
  redeem_url text check (redeem_url is null or (redeem_url ~ '^https://' and char_length(redeem_url) <= 500)),
  target_type text not null check (target_type in ('CHALLENGE', 'QUEST')),
  target_id uuid not null,
  condition text not null default 'COMPLETE' check (condition in ('COMPLETE', 'TOP_N')),
  top_n integer check (top_n is null or top_n between 1 and 100),
  code_mode text not null default 'POOL' check (code_mode in ('POOL', 'SHARED')),
  shared_code text check (shared_code is null or char_length(shared_code) between 3 and 40),
  valid_until timestamptz,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists voucher_campaigns_target_idx on public.voucher_campaigns (target_type, target_id) where is_active;
create table if not exists public.voucher_codes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.voucher_campaigns(id) on delete cascade,
  code text not null check (char_length(code) between 3 and 40),
  claimed_by uuid references public.profiles(id) on delete set null,
  claimed_at timestamptz,
  unique (campaign_id, code)
);
create index if not exists voucher_codes_free_idx on public.voucher_codes (campaign_id) where claimed_by is null;
create table if not exists public.voucher_grants (
  campaign_id uuid not null references public.voucher_campaigns(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  code text not null,
  issued_at timestamptz not null default now(),
  used_at timestamptz,
  primary key (campaign_id, user_id)
);
create index if not exists voucher_grants_user_idx on public.voucher_grants (user_id, issued_at desc);
alter table public.voucher_campaigns enable row level security;
alter table public.voucher_codes enable row level security;
alter table public.voucher_grants enable row level security;

-- ---------------------------------------------------------------------
-- 1. Phát voucher
-- ---------------------------------------------------------------------
create or replace function private.issue_voucher(c public.voucher_campaigns, p_user uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_code text; v_id uuid;
begin
  if not c.is_active or (c.valid_until is not null and c.valid_until <= now()) then return false; end if;
  if exists (select 1 from public.voucher_grants g where g.campaign_id = c.id and g.user_id = p_user) then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('voucher:' || c.id, 0));
  if c.code_mode = 'SHARED' then
    v_code := c.shared_code;
  else
    v_id := (select x.id from (select v.id, row_number() over (order by v.code) as rn from public.voucher_codes v
                                where v.campaign_id = c.id and v.claimed_by is null) x where x.rn = 1);
    if v_id is null then return false; end if;                          -- hết kho mã
    update public.voucher_codes set claimed_by = p_user, claimed_at = now() where id = v_id returning code into v_code;
  end if;
  if v_code is null then return false; end if;
  insert into public.voucher_grants (campaign_id, user_id, code) values (c.id, p_user, v_code) on conflict do nothing;
  perform private.notify(p_user, null, 'VOUCHER', 'Bạn nhận voucher từ ' || c.sponsor_name || ' 🎟️', c.title, '/me/vouchers', null, true);
  return true;
end $$;

create or replace function private.voucher_on_challenge() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.voucher_campaigns;
begin
  begin
    if new.completed_at is not null and old.completed_at is null and new.status <> 'LEFT' then
      for c in select * from public.voucher_campaigns v where v.target_type = 'CHALLENGE' and v.target_id = new.challenge_id
                 and v.condition = 'COMPLETE' and v.is_active loop
        perform private.issue_voucher(c, new.profile_id);
      end loop;
    end if;
    if new.final_rank is not null and old.final_rank is distinct from new.final_rank and new.status <> 'LEFT' then
      for c in select * from public.voucher_campaigns v where v.target_type = 'CHALLENGE' and v.target_id = new.challenge_id
                 and v.condition = 'TOP_N' and v.is_active and new.final_rank <= v.top_n loop
        perform private.issue_voucher(c, new.profile_id);
      end loop;
    end if;
  exception when others then
    raise warning 'voucher_on_challenge % lỗi: % %', new.id, sqlstate, sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists trg_zz_voucher_challenge on public.challenge_participants;
create trigger trg_zz_voucher_challenge after update of completed_at, final_rank on public.challenge_participants
  for each row execute function private.voucher_on_challenge();

create or replace function private.voucher_on_quest() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.voucher_campaigns;
begin
  begin
    if new.completed_at is not null and (tg_op = 'INSERT' or old.completed_at is null) then
      for c in select * from public.voucher_campaigns v where v.target_type = 'QUEST' and v.target_id = new.quest_id and v.is_active loop
        perform private.issue_voucher(c, new.user_id);
      end loop;
    end if;
  exception when others then
    raise warning 'voucher_on_quest lỗi: % %', sqlstate, sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists trg_zz_voucher_quest on public.user_quest_progress;
create trigger trg_zz_voucher_quest after insert or update of completed_at on public.user_quest_progress
  for each row execute function private.voucher_on_quest();

-- ---------------------------------------------------------------------
-- 2. Quyền quản lý chiến dịch: admin, hoặc BTC thử thách (chỉ thử thách của mình)
-- ---------------------------------------------------------------------
create or replace function private.voucher_can_manage(p_type text, p_target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_system_admin()
      or (p_type = 'CHALLENGE' and exists (select 1 from public.challenges c where c.id = p_target and private.challenge_is_manager(c)))
$$;

create or replace function private.voucher_json(v public.voucher_campaigns, p_manage boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', v.id, 'sponsor_name', v.sponsor_name, 'sponsor_logo', v.sponsor_logo, 'title', v.title, 'terms', v.terms,
    'redeem_url', v.redeem_url, 'target_type', v.target_type, 'target_id', v.target_id, 'condition', v.condition, 'top_n', v.top_n,
    'code_mode', v.code_mode, 'valid_until', v.valid_until, 'is_active', v.is_active,
    'issued', (select count(*) from public.voucher_grants g where g.campaign_id = v.id),
    'remaining', case when v.code_mode = 'POOL' then (select count(*) from public.voucher_codes c where c.campaign_id = v.id and c.claimed_by is null) end,
    'mine', (select jsonb_build_object('code', g.code, 'issued_at', g.issued_at, 'used_at', g.used_at)
               from public.voucher_grants g where g.campaign_id = v.id and g.user_id = auth.uid()))
    || case when p_manage then jsonb_build_object('shared_code', v.shared_code,
         'total', case when v.code_mode = 'POOL' then (select count(*) from public.voucher_codes c where c.campaign_id = v.id) end) else '{}'::jsonb end
$$;

create or replace function public.save_voucher_campaign(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_type text := upper(coalesce(p->>'target_type', ''));
  v_target uuid := nullif(p->>'target_id', '')::uuid;
  v_old public.voucher_campaigns := (select x from public.voucher_campaigns x where x.id = v_id);
  r public.voucher_campaigns;
begin
  if v_old.id is not null then v_type := v_old.target_type; v_target := v_old.target_id; end if;
  if v_type not in ('CHALLENGE', 'QUEST') or v_target is null then raise exception 'INVALID_VOUCHER'; end if;
  if not private.voucher_can_manage(v_type, v_target) then raise exception 'FORBIDDEN'; end if;
  if v_type = 'CHALLENGE' and not exists (select 1 from public.challenges c where c.id = v_target) then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if v_type = 'QUEST' and not exists (select 1 from public.quests q where q.id = v_target) then raise exception 'QUEST_NOT_FOUND'; end if;
  if coalesce(p->>'condition', 'COMPLETE') = 'TOP_N' and (v_type <> 'CHALLENGE' or coalesce((p->>'top_n')::int, 0) not between 1 and 100) then
    raise exception 'INVALID_VOUCHER';
  end if;
  if coalesce(p->>'code_mode', 'POOL') = 'SHARED' and char_length(trim(coalesce(p->>'shared_code', ''))) < 3 then raise exception 'INVALID_VOUCHER_CODE'; end if;
  if nullif(p->>'redeem_url', '') is not null and (p->>'redeem_url') !~ '^https://' then raise exception 'INVALID_URL'; end if;
  if nullif(p->>'sponsor_logo', '') is not null and (p->>'sponsor_logo') !~ '^https://' then raise exception 'INVALID_URL'; end if;

  insert into public.voucher_campaigns as t (id, sponsor_name, sponsor_logo, title, terms, redeem_url, target_type, target_id, condition, top_n,
    code_mode, shared_code, valid_until, is_active, created_by)
  values (coalesce(v_id, gen_random_uuid()), trim(p->>'sponsor_name'), nullif(trim(coalesce(p->>'sponsor_logo', '')), ''), trim(p->>'title'),
    nullif(trim(coalesce(p->>'terms', '')), ''), nullif(trim(coalesce(p->>'redeem_url', '')), ''), v_type, v_target,
    coalesce(p->>'condition', 'COMPLETE'), case when p->>'condition' = 'TOP_N' then (p->>'top_n')::int end,
    coalesce(p->>'code_mode', 'POOL'), case when p->>'code_mode' = 'SHARED' then upper(trim(p->>'shared_code')) end,
    nullif(p->>'valid_until', '')::timestamptz, coalesce((p->>'is_active')::boolean, true), v_uid)
  on conflict (id) do update set sponsor_name = excluded.sponsor_name, sponsor_logo = excluded.sponsor_logo, title = excluded.title,
    terms = excluded.terms, redeem_url = excluded.redeem_url, condition = excluded.condition, top_n = excluded.top_n,
    code_mode = excluded.code_mode, shared_code = excluded.shared_code, valid_until = excluded.valid_until, is_active = excluded.is_active
  returning * into r;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SAVE_VOUCHER', 'voucher:' || r.id, p - 'shared_code');
  return private.voucher_json(r, true);
end $$;

-- Dán danh sách mã (mỗi dòng một mã); bỏ trùng; tối đa 5.000 mã / lần
create or replace function public.add_voucher_codes(p_campaign_id uuid, p_codes text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.voucher_campaigns := (select x from public.voucher_campaigns x where x.id = p_campaign_id);
  v_n integer;
begin
  if c.id is null then raise exception 'INVALID_VOUCHER'; end if;
  if not private.voucher_can_manage(c.target_type, c.target_id) then raise exception 'FORBIDDEN'; end if;
  if c.code_mode <> 'POOL' then raise exception 'INVALID_VOUCHER'; end if;
  if cardinality(p_codes) > 5000 then raise exception 'TOO_MANY_CODES'; end if;
  insert into public.voucher_codes (campaign_id, code)
  select c.id, x.code from (select distinct upper(trim(u)) as code from unnest(p_codes) u) x
   where char_length(x.code) between 3 and 40
  on conflict (campaign_id, code) do nothing;
  get diagnostics v_n = row_count;
  -- Người đã đạt điều kiện trước khi có mã: phát bù (thử thách đã hoàn thành / Top N; nhiệm vụ đã hoàn thành trong kỳ còn hiệu lực)
  if c.target_type = 'CHALLENGE' then
    perform private.issue_voucher(c, p.profile_id) from public.challenge_participants p
     where p.challenge_id = c.target_id and p.status <> 'LEFT'
       and ((c.condition = 'COMPLETE' and p.completed_at is not null) or (c.condition = 'TOP_N' and p.final_rank <= c.top_n));
  end if;
  return jsonb_build_object('added', v_n) || private.voucher_json(c, true);
end $$;

create or replace function public.list_voucher_campaigns(p_target_type text, p_target_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_manage boolean := auth.uid() is not null and private.voucher_can_manage(upper(p_target_type), p_target_id);
begin
  if upper(p_target_type) = 'CHALLENGE' and not public.challenge_visible(p_target_id) then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  return (select coalesce(jsonb_agg(private.voucher_json(v, v_manage) order by v.created_at), '[]'::jsonb)
            from public.voucher_campaigns v
           where v.target_type = upper(p_target_type) and v.target_id = p_target_id and (v.is_active or v_manage));
end $$;

create or replace function public.admin_list_voucher_campaigns() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(private.voucher_json(v, true) || jsonb_build_object('target_name',
            case v.target_type when 'CHALLENGE' then (select c.title from public.challenges c where c.id = v.target_id)
                               else (select q.title from public.quests q where q.id = v.target_id) end) order by v.created_at desc), '[]'::jsonb)
            from public.voucher_campaigns v);
end $$;

create or replace function public.my_vouchers() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('campaign_id', v.id, 'sponsor_name', v.sponsor_name, 'sponsor_logo', v.sponsor_logo,
      'title', v.title, 'terms', v.terms, 'redeem_url', v.redeem_url, 'valid_until', v.valid_until, 'code', g.code,
      'issued_at', g.issued_at, 'used_at', g.used_at, 'target_type', v.target_type, 'target_id', v.target_id,
      'target_name', case v.target_type when 'CHALLENGE' then (select c.title from public.challenges c where c.id = v.target_id)
                                        else (select q.title from public.quests q where q.id = v.target_id) end)
      order by (g.used_at is not null), g.issued_at desc), '[]'::jsonb)
    from public.voucher_grants g join public.voucher_campaigns v on v.id = g.campaign_id
   where g.user_id = auth.uid()
$$;

create or replace function public.mark_voucher_used(p_campaign_id uuid, p_used boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  update public.voucher_grants set used_at = case when p_used then now() end where campaign_id = p_campaign_id and user_id = v_uid;
  if not found then raise exception 'VOUCHER_NOT_FOUND'; end if;
end $$;

revoke all on function private.issue_voucher(public.voucher_campaigns, uuid), private.voucher_on_challenge(), private.voucher_on_quest(),
  private.voucher_can_manage(text, uuid), private.voucher_json(public.voucher_campaigns, boolean) from public, anon, authenticated;
revoke all on function public.save_voucher_campaign(jsonb), public.add_voucher_codes(uuid, text[]), public.list_voucher_campaigns(text, uuid),
  public.admin_list_voucher_campaigns(), public.my_vouchers(), public.mark_voucher_used(uuid, boolean) from public, anon;
grant execute on function public.save_voucher_campaign(jsonb), public.add_voucher_codes(uuid, text[]), public.list_voucher_campaigns(text, uuid),
  public.admin_list_voucher_campaigns(), public.my_vouchers(), public.mark_voucher_used(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';

commit;
