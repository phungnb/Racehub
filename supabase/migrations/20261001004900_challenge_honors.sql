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
