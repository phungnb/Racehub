-- RaceHub — PHẦN 21/26 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 012800, 012900, 013000
-- Supabase → SQL Editor → New query → dán TOÀN BỘ phần này → Run. Lỗi thì không có gì thay đổi; chạy lại vẫn an toàn.
-- Xong thì chạy phần tiếp theo.
begin;
-- ===================================================================
-- 20261001012800_nearby_v2_runner_hub.sql
-- ===================================================================
-- 012800: Quanh đây v2 + Hội quán runner. Xem docs/QUANH_DAY_HOI_QUAN.md.
-- Quanh đây v2 — runner không mở app liên tục như mạng xã hội, nên:
--   • "Khu hay chạy" tự động (tự bật, có đồng ý riêng): ước lượng ô ~2 km từ ĐIỂM XUẤT PHÁT các bài chạy hợp lệ 60 ngày
--     (cần ≥ 2 bài cùng ô). Không lưu điểm chính xác. Khi không công bố vị trí tạm thì dùng khu này → vẫn được tìm thấy
--     và vẫn thấy người khác mà không phải mở app hằng ngày.
--   • Bảng tin quanh đây: bài chạy gần đây (đã chia sẻ) của runner quanh mình + bài rủ chạy gần mình.
--   • Bài rủ chạy "gần tôi" báo cho tối đa 30 runner quanh đó (mỗi người ≤ 3 thông báo loại này / ngày).
-- Hội quán runner (toàn quốc, tự tham gia):
--   • Hồ sơ: tỉnh / thành, một dòng giới thiệu, mục tiêu, khung giờ, pace, thành tích ước tính 5K / 10K / HM / FM, số liệu 30 ngày.
--   • Danh bạ runner có lọc + điểm hợp nhau; bảng tin bài đăng (Tìm bạn chạy · Đi giải cùng · Cần pacer · Khoe thành tích · Hỏi đáp).
--   • "Quan tâm" bài đăng → hai bên nhắn tin được cho nhau; kết nối / theo dõi như Quanh đây.
--   • Chống spam: cần ≥ 3 bài chạy hợp lệ, ≤ 5 bài đăng / ngày, không chèn link / số điện thoại; 3 người báo cáo → bài tự ẩn.
-- Kèm: khoá thông tin công ty support_facebook (link nhóm Facebook cộng đồng).
-- Cần 006100, 007000, 011500. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 0. Thông tin công ty: thêm link nhóm Facebook (giữ đồng bộ với features/help/model/help.ts)
-- ---------------------------------------------------------------------
create or replace function private.site_info_keys() returns text[]
language sql immutable as $$
  select array['company_name', 'tax_code', 'address', 'support_email', 'support_phone', 'support_zalo', 'support_telegram',
               'support_facebook', 'dpo_contact', 'min_age', 'report_email', 'business_license']
$$;

-- ---------------------------------------------------------------------
-- 1. Bảng / cột
-- ---------------------------------------------------------------------
alter table public.runner_discovery_settings add column if not exists auto_area boolean not null default false;
alter table public.runner_discovery_settings add column if not exists auto_area_at timestamptz;
alter table public.runner_discovery_settings add column if not exists hub_listed boolean not null default false;
alter table public.runner_discovery_settings add column if not exists hub_consent_at timestamptz;
alter table public.runner_discovery_settings add column if not exists province text;
alter table public.runner_discovery_settings add column if not exists headline text;
alter table public.runner_discovery_settings drop constraint if exists runner_discovery_headline_chk;
alter table public.runner_discovery_settings add constraint runner_discovery_headline_chk check (headline is null or char_length(headline) <= 80);

-- Khu hay chạy (ô ~2 km, tính từ điểm xuất phát bài chạy) — chỉ có khi auto_area bật
create table if not exists public.runner_home_area (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  cell_lat numeric(6, 2) not null,
  cell_lng numeric(6, 2) not null,
  runs integer not null,
  last_run_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists runner_home_area_cell_idx on public.runner_home_area (cell_lat, cell_lng);

create table if not exists public.hub_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('BUDDY', 'RACE', 'PACER', 'SHARE', 'ASK')),
  body text not null check (char_length(body) between 5 and 500),
  province text,
  cell_lat numeric(6, 2),
  cell_lng numeric(6, 2),
  area_label text check (area_label is null or char_length(area_label) <= 60),
  goal text check (goal is null or goal in ('5K', '10K', 'HM', 'FM', 'TRAIL')),
  pace_s integer check (pace_s is null or pace_s between 150 and 1200),
  meet_at timestamptz,
  race_name text check (race_name is null or char_length(race_name) <= 80),
  activity_id uuid references public.activities(id) on delete set null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CLOSED', 'HIDDEN')),
  interest_count integer not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists hub_posts_feed_idx on public.hub_posts (status, created_at desc);
create index if not exists hub_posts_author_idx on public.hub_posts (author_id, created_at desc);
create index if not exists hub_posts_cell_idx on public.hub_posts (cell_lat, cell_lng) where cell_lat is not null;

create table if not exists public.hub_post_interests (
  post_id uuid not null references public.hub_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists hub_post_interests_user_idx on public.hub_post_interests (user_id);

create table if not exists public.hub_post_reports (
  post_id uuid not null references public.hub_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (reason in ('SPAM', 'HARASSMENT', 'FAKE', 'UNSAFE', 'OTHER')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.runner_home_area enable row level security;
alter table public.hub_posts enable row level security;
alter table public.hub_post_interests enable row level security;
alter table public.hub_post_reports enable row level security;
revoke all on public.runner_home_area, public.hub_posts, public.hub_post_interests, public.hub_post_reports from anon, authenticated;

-- Báo cáo người dùng: thêm ngữ cảnh Hội quán
alter table public.user_reports drop constraint if exists user_reports_context_check;
alter table public.user_reports add constraint user_reports_context_check
  check (context in ('NEARBY', 'CONNECTION', 'CLUB', 'BIB', 'MARKET', 'OTHER', 'DM', 'COMMENT', 'PROFILE', 'HUB'));

-- ---------------------------------------------------------------------
-- 2. Hàm phụ
-- ---------------------------------------------------------------------
-- 34 tỉnh / thành (giữ đồng bộ với shared/lib/provinces.ts)
create or replace function private.vn_provinces() returns text[]
language sql immutable as $$
  select array['Hà Nội', 'TP. Hồ Chí Minh', 'Hải Phòng', 'Đà Nẵng', 'Huế', 'Cần Thơ',
    'An Giang', 'Bắc Ninh', 'Cà Mau', 'Cao Bằng', 'Đắk Lắk', 'Điện Biên', 'Đồng Nai', 'Đồng Tháp', 'Gia Lai', 'Hà Tĩnh',
    'Hưng Yên', 'Khánh Hòa', 'Lai Châu', 'Lâm Đồng', 'Lạng Sơn', 'Lào Cai', 'Nghệ An', 'Ninh Bình', 'Phú Thọ', 'Quảng Ngãi',
    'Quảng Ninh', 'Quảng Trị', 'Sơn La', 'Tây Ninh', 'Thái Nguyên', 'Thanh Hóa', 'Tuyên Quang', 'Vĩnh Long']
$$;

-- Ô ~2 km (0,02°) — thô hơn ô vị trí tạm (0,01°) vì suy ra từ nơi xuất phát, thường là gần nhà
create or replace function private.home_cell(v numeric) returns numeric
language sql immutable as $$ select (round(v / 0.02) * 0.02)::numeric(6, 2) $$;

-- Không chèn link / số điện thoại / Zalo vào bài đăng, lời mời (chống lừa đảo, kéo ra ngoài)
create or replace function private.has_contact_or_link(p text) returns boolean
language sql immutable as $$
  select coalesce(p, '') ~* '(https?://|www\.|\.com|\.vn|\.net|zalo|telegram|t\.me|fb\.com|facebook)'
      or regexp_replace(coalesce(p, ''), '[\s\.\-]', '', 'g') ~ '(\+?84|0)\d{9}'
$$;

-- Tính lại khu hay chạy: ô có nhiều bài xuất phát nhất trong 60 ngày (≥ 2 bài), bài hợp lệ
create or replace function private.refresh_home_area(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_on boolean := coalesce((select s.auto_area and s.enabled and s.suspended_at is null from public.runner_discovery_settings s where s.user_id = p_user), false);
  v_best jsonb;
begin
  if not v_on then
    delete from public.runner_home_area where user_id = p_user;
    return;
  end if;
  v_best := (select to_jsonb(x) from (
      select private.home_cell(d.start_lat) as la, private.home_cell(d.start_lng) as ln, count(*)::int as n, max(a.started_at) as last_at,
             row_number() over (order by count(*) desc, max(a.started_at) desc) as rn
        from public.activities a join public.activity_details d on d.activity_id = a.id
       where a.user_id = p_user and a.validation_status = 'APPROVED' and coalesce(a.status, '') <> 'DELETED'
         and a.started_at > now() - interval '60 days' and d.start_lat is not null and d.start_lng is not null
         and d.start_lat between -90 and 90 and d.start_lng between -180 and 180
       group by 1, 2) x where x.rn = 1);
  if v_best is null or (v_best->>'n')::int < 2 then
    delete from public.runner_home_area where user_id = p_user;
    return;
  end if;
  insert into public.runner_home_area as h (user_id, cell_lat, cell_lng, runs, last_run_at, updated_at)
  values (p_user, (v_best->>'la')::numeric, (v_best->>'ln')::numeric, (v_best->>'n')::int, (v_best->>'last_at')::timestamptz, now())
  on conflict (user_id) do update set cell_lat = excluded.cell_lat, cell_lng = excluded.cell_lng, runs = excluded.runs,
    last_run_at = excluded.last_run_at, updated_at = now();
end $$;

-- Bài mới / bài được duyệt / có toạ độ xuất phát → cập nhật khu hay chạy (không bao giờ chặn việc lưu bài)
create or replace function private.home_area_on_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  -- Tách nhánh: mỗi bảng có cột khác nhau (new.user_id / new.activity_id)
  if tg_table_name = 'activities' then
    v_user := new.user_id;
  else
    v_user := (select a.user_id from public.activities a where a.id = new.activity_id);
  end if;
  if v_user is not null and exists (select 1 from public.runner_discovery_settings s where s.user_id = v_user and s.auto_area) then
    begin
      perform private.refresh_home_area(v_user);
    exception when others then null;
    end;
  end if;
  return null;
end $$;

drop trigger if exists home_area_activity_trg on public.activities;
create trigger home_area_activity_trg after update of validation_status on public.activities
  for each row when (new.validation_status is distinct from old.validation_status) execute function private.home_area_on_activity();
drop trigger if exists home_area_detail_trg on public.activity_details;
create trigger home_area_detail_trg after insert or update of start_lat, start_lng on public.activity_details
  for each row execute function private.home_area_on_activity();

-- Vị trí dùng cho Quanh đây của mọi người: vị trí tạm còn hạn (LIVE), không có thì khu hay chạy (HOME)
create or replace function private.nearby_locations() returns table (user_id uuid, cell_lat numeric, cell_lng numeric, area_label text, kind text)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.cell_lat, p.cell_lng, p.area_label, 'LIVE' from public.runner_location_presence p where p.expires_at > now()
  union all
  select h.user_id, h.cell_lat, h.cell_lng, null, 'HOME'
    from public.runner_home_area h join public.runner_discovery_settings s on s.user_id = h.user_id
   where s.auto_area and s.enabled and s.suspended_at is null
     and not exists (select 1 from public.runner_location_presence p where p.user_id = h.user_id and p.expires_at > now())
$$;

-- Vị trí của một người: {lat, lng, kind, area} hoặc null
create or replace function private.nearby_cell(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('lat', l.cell_lat, 'lng', l.cell_lng, 'kind', l.kind, 'area', l.area_label)
    from private.nearby_locations() l where l.user_id = p_user
$$;

-- Số liệu công khai của runner (chỉ bài hợp lệ, ĐÃ CHIA SẺ)
create or replace function private.runner_stats(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'km_30d', round(coalesce(sum(a.distance_m) filter (where a.started_at > now() - interval '30 days'), 0) / 1000.0, 1),
    'runs_30d', count(*) filter (where a.started_at > now() - interval '30 days'),
    'km_year', round(coalesce(sum(a.distance_m) filter (where a.started_at > now() - interval '365 days'), 0) / 1000.0),
    'longest_km', round(coalesce(max(a.distance_m) filter (where a.started_at > now() - interval '365 days'), 0) / 1000.0, 1),
    'last_run_at', max(a.started_at))
    from public.activities a
   where a.user_id = p_user and a.validation_status = 'APPROVED' and coalesce(a.status, '') <> 'DELETED' and a.shared
$$;

-- Thành tích ước tính 12 tháng: bài dài ≥ cự ly, quy pace trung bình về cự ly đó (luôn ≥ thực tế → không "nổ" thành tích)
create or replace function private.runner_prs(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with r as (
    select a.distance_m::numeric as d, a.moving_time_s::numeric as t from public.activities a
     where a.user_id = p_user and a.validation_status = 'APPROVED' and coalesce(a.status, '') <> 'DELETED' and a.shared
       and a.started_at > now() - interval '365 days' and a.distance_m > 0 and a.moving_time_s > 0
       and a.moving_time_s / (a.distance_m / 1000.0) >= 150)
  select jsonb_strip_nulls(jsonb_build_object(
    '5K', (select round(min(t * 5000 / d))::int from r where d >= 5000),
    '10K', (select round(min(t * 10000 / d))::int from r where d >= 10000),
    'HM', (select round(min(t * 21097 / d))::int from r where d >= 21097),
    'FM', (select round(min(t * 42195 / d))::int from r where d >= 42195)))
$$;

-- Điểm hợp nhau (0–100): pace 30 · tỉnh 15 · mục tiêu 15 · khung giờ 15 · mục đích 10 · còn chạy đều 10 · ngẫu nhiên theo ngày ≤ 5
create or replace function private.match_score(p_my_pace integer, p_pace integer, me public.runner_discovery_settings, o public.runner_discovery_settings,
  p_last_run timestamptz) returns integer
language sql stable as $$
  select round(
      (case when p_pace is null or p_my_pace is null then 12 else greatest(0, 30 - greatest(0, abs(p_pace - p_my_pace) - 20) * 30 / 70.0) end)
    + (case when me.province is not null and me.province = o.province then 15 else 0 end)
    + least(15, 8 * cardinality(array(select unnest(o.goals) intersect select unnest(coalesce(me.goals, '{}'::text[])))))
    + least(15, 8 * cardinality(array(select unnest(o.time_slots) intersect select unnest(coalesce(me.time_slots, '{}'::text[])))))
    + (case when o.purposes && coalesce(me.purposes, array['BUDDY']) then 10 else 3 end)
    + (case when p_last_run > now() - interval '7 days' then 10 when p_last_run > now() - interval '30 days' then 5 else 0 end)
    + (abs(hashtext(o.user_id::text || current_date::text)) % 5))::int
$$;

-- Người dùng có trong Hội quán không (tự tham gia, đủ điều kiện, không bị khoá)
create or replace function private.hub_member(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.runner_discovery_settings s where s.user_id = p_user and s.hub_listed and s.suspended_at is null)
     and private.nearby_eligible(p_user)
$$;

-- ---------------------------------------------------------------------
-- 3. Cài đặt (mở rộng 006100)
-- ---------------------------------------------------------------------
create or replace function public.my_discovery() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  s public.runner_discovery_settings := (select x from public.runner_discovery_settings x where x.user_id = v_uid);
  p public.runner_location_presence := (select x from public.runner_location_presence x where x.user_id = v_uid);
  h public.runner_home_area := (select x from public.runner_home_area x where x.user_id = v_uid);
begin
  return jsonb_build_object(
    'enabled', coalesce(s.enabled, false) and s.suspended_at is null,
    'suspended', s.suspended_at is not null,
    'visible_to', coalesce(s.visible_to, 'VERIFIED'), 'purposes', coalesce(to_jsonb(s.purposes), '["BUDDY"]'::jsonb),
    'goals', coalesce(to_jsonb(s.goals), '[]'::jsonb), 'time_slots', coalesce(to_jsonb(s.time_slots), '[]'::jsonb),
    'share_pace', coalesce(s.share_pace, true), 'radius_km', coalesce(s.radius_km, 10), 'bio', s.bio,
    'consented', s.consent_version = private.nearby_consent_version(),
    'valid_runs', private.valid_runs(v_uid), 'eligible', private.nearby_eligible(v_uid),
    'pace_s', private.typical_pace(v_uid),
    'presence', case when p.user_id is not null and p.expires_at > now() then jsonb_build_object(
      'source', p.source, 'area_label', p.area_label, 'updated_at', p.updated_at, 'expires_at', p.expires_at,
      'moves_left', greatest(0, 3 - case when p.moves_since > now() - interval '24 hours' then p.moves else 0 end)) end,
    'auto_area', coalesce(s.auto_area, false),
    'home', case when h.user_id is not null then jsonb_build_object('runs', h.runs, 'last_run_at', h.last_run_at, 'updated_at', h.updated_at) end,
    'located', private.nearby_cell(v_uid) is not null,
    'hub_listed', coalesce(s.hub_listed, false), 'province', s.province, 'headline', s.headline,
    'incoming', (select count(*) from public.runner_connection_requests r where r.to_id = v_uid and r.status = 'PENDING'),
    'connections', (select count(*) from public.runner_connections c where c.user_a = v_uid or c.user_b = v_uid));
end $$;

-- p: như 006100 + {auto_area, auto_consent, hub_listed, hub_consent, province, headline}
create or replace function public.set_discovery(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  s public.runner_discovery_settings := (select x from public.runner_discovery_settings x where x.user_id = v_uid);
  v_enabled boolean := coalesce((p->>'enabled')::boolean, s.enabled, false);
  v_vis text := coalesce(p->>'visible_to', s.visible_to, 'VERIFIED');
  v_radius integer := coalesce((p->>'radius_km')::int, s.radius_km, 10);
  v_purposes text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(p->'purposes') = 'array' then p->'purposes' end) x), s.purposes, array['BUDDY']);
  v_goals text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(p->'goals') = 'array' then p->'goals' end) x), s.goals, '{}');
  v_slots text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(p->'time_slots') = 'array' then p->'time_slots' end) x), s.time_slots, '{}');
  v_consent text := case when coalesce((p->>'consent')::boolean, false) then private.nearby_consent_version() else s.consent_version end;
  v_auto boolean := coalesce((p->>'auto_area')::boolean, s.auto_area, false);
  v_hub boolean := coalesce((p->>'hub_listed')::boolean, s.hub_listed, false);
  v_province text := case when p ? 'province' then nullif(trim(coalesce(p->>'province', '')), '') else s.province end;
  v_headline text := case when p ? 'headline' then nullif(left(trim(coalesce(p->>'headline', '')), 80), '') else s.headline end;
  v_auto_at timestamptz := s.auto_area_at;
  v_hub_at timestamptz := s.hub_consent_at;
begin
  if v_vis not in ('VERIFIED', 'SAME_GENDER', 'CLUBS') then raise exception 'INVALID_SETTINGS'; end if;
  if v_radius not in (2, 5, 10, 20) then raise exception 'INVALID_SETTINGS'; end if;
  if not (v_purposes <@ array['BUDDY', 'CLUB', 'COACH']) or not (v_goals <@ array['5K', '10K', 'HM', 'FM', 'TRAIL'])
     or not (v_slots <@ array['EARLY', 'MORNING', 'NOON', 'EVENING', 'WEEKEND']) then raise exception 'INVALID_SETTINGS'; end if;
  if v_province is not null and not (v_province = any (private.vn_provinces())) then raise exception 'INVALID_SETTINGS'; end if;
  if private.has_contact_or_link(v_headline) or private.has_contact_or_link(case when p ? 'bio' then p->>'bio' end) then raise exception 'NO_LINKS'; end if;
  if v_enabled then
    if coalesce(v_consent, '') <> private.nearby_consent_version() then raise exception 'CONSENT_REQUIRED'; end if;
    if not private.nearby_eligible(v_uid) then raise exception 'NOT_ELIGIBLE'; end if;
    if s.suspended_at is not null then raise exception 'NEARBY_SUSPENDED'; end if;
  end if;
  -- Khu hay chạy tự động: phải đồng ý riêng lần bật đầu tiên; chỉ có tác dụng khi Quanh đây đang bật
  if v_auto and not coalesce(s.auto_area, false) then
    if not coalesce((p->>'auto_consent')::boolean, false) then raise exception 'CONSENT_REQUIRED'; end if;
    v_auto_at := now();
  end if;
  -- Hội quán: đồng ý riêng (hồ sơ hiện toàn quốc) + đủ điều kiện
  if v_hub and not coalesce(s.hub_listed, false) then
    if not coalesce((p->>'hub_consent')::boolean, false) then raise exception 'CONSENT_REQUIRED'; end if;
    if not private.nearby_eligible(v_uid) then raise exception 'NOT_ELIGIBLE'; end if;
    if s.suspended_at is not null then raise exception 'NEARBY_SUSPENDED'; end if;
    v_hub_at := now();
  end if;
  insert into public.runner_discovery_settings as t (user_id, enabled, visible_to, purposes, goals, time_slots, share_pace, radius_km, bio,
                                                     consent_version, consent_at, auto_area, auto_area_at, hub_listed, hub_consent_at,
                                                     province, headline, updated_at)
  values (v_uid, v_enabled, v_vis, v_purposes, v_goals, v_slots, coalesce((p->>'share_pace')::boolean, s.share_pace, true), v_radius,
          case when p ? 'bio' then nullif(left(trim(coalesce(p->>'bio', '')), 140), '') else s.bio end,
          v_consent, case when v_consent is distinct from s.consent_version then now() else s.consent_at end,
          v_auto, v_auto_at, v_hub, v_hub_at, v_province, v_headline, now())
  on conflict (user_id) do update set enabled = excluded.enabled, visible_to = excluded.visible_to, purposes = excluded.purposes,
    goals = excluded.goals, time_slots = excluded.time_slots, share_pace = excluded.share_pace, radius_km = excluded.radius_km,
    bio = excluded.bio, consent_version = excluded.consent_version, consent_at = excluded.consent_at,
    auto_area = excluded.auto_area, auto_area_at = excluded.auto_area_at, hub_listed = excluded.hub_listed,
    hub_consent_at = excluded.hub_consent_at, province = excluded.province, headline = excluded.headline, updated_at = now();
  -- Tắt = xoá vị trí ngay; bật / tắt khu hay chạy = tính lại / xoá ngay
  if not v_enabled then delete from public.runner_location_presence where user_id = v_uid; end if;
  perform private.refresh_home_area(v_uid);
  -- Rời Hội quán = đóng các bài đang mở
  if not v_hub then update public.hub_posts set status = 'CLOSED' where author_id = v_uid and status = 'ACTIVE'; end if;
  return public.my_discovery();
end $$;

-- ---------------------------------------------------------------------
-- 4. Tìm runner quanh đây — dùng vị trí tạm HOẶC khu hay chạy (của cả mình và người khác)
-- ---------------------------------------------------------------------
create or replace function public.nearby_runners(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  s public.runner_discovery_settings := (select x from public.runner_discovery_settings x where x.user_id = v_uid);
  me jsonb := private.nearby_cell(v_uid);
  v_lat numeric := (me->>'lat')::numeric;
  v_lng numeric := (me->>'lng')::numeric;
  v_radius integer := coalesce((p->>'radius_km')::int, s.radius_km, 10);
  v_pace text := upper(coalesce(p->>'pace', 'ALL'));
  v_purpose text := nullif(nullif(upper(coalesce(p->>'purpose', '')), ''), 'ALL');
  v_goal text := nullif(nullif(upper(coalesce(p->>'goal', '')), ''), 'ALL');
  v_slot text := nullif(nullif(upper(coalesce(p->>'slot', '')), ''), 'ALL');
  v_offset integer := greatest(0, coalesce((p->>'offset')::int, 0));
  v_my_pace integer := private.typical_pace(v_uid);
  v_dlat numeric;
  v_dlng numeric;
begin
  if not coalesce(s.enabled, false) or s.suspended_at is not null then raise exception 'NEARBY_DISABLED'; end if;
  if me is null then raise exception 'NO_PRESENCE'; end if;
  if v_radius not in (2, 5, 10, 20) then v_radius := 10; end if;
  if (select count(*) from public.runner_nearby_searches x where x.user_id = v_uid and x.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'TOO_MANY_SEARCHES';
  end if;
  insert into public.runner_nearby_searches (user_id) values (v_uid);
  delete from public.runner_nearby_searches where created_at < now() - interval '7 days';
  delete from public.runner_location_presence where expires_at < now() - interval '1 day';
  v_dlat := v_radius / 111.0 + 0.02;
  v_dlng := v_radius / (111.0 * greatest(cos(radians(v_lat::float8)), 0.2)) + 0.02;

  return (
    with cand as (
      select o.user_id as id, ds, o.area_label, o.kind, private.cell_km(v_lat, v_lng, o.cell_lat, o.cell_lng) as km,
             case when ds.share_pace then private.typical_pace(o.user_id) end as pace,
             (select max(a.started_at) from public.activities a where a.user_id = o.user_id and a.validation_status = 'APPROVED'
                 and coalesce(a.status, '') <> 'DELETED' and a.shared) as last_run
        from private.nearby_locations() o
        join public.runner_discovery_settings ds on ds.user_id = o.user_id
       where o.user_id <> v_uid and ds.enabled and ds.suspended_at is null
         and o.cell_lat between v_lat - v_dlat and v_lat + v_dlat
         and o.cell_lng between v_lng - v_dlng and v_lng + v_dlng
         and not private.is_blocked(v_uid, o.user_id)
         and private.nearby_visible(v_uid, o.user_id, ds.visible_to)      -- họ cho mình thấy
         and private.nearby_visible(o.user_id, v_uid, s.visible_to)       -- mình cho họ thấy (công bằng 2 chiều)
         and private.nearby_eligible(o.user_id)
    ), f as (
      select c.*,
        private.share_club(v_uid, c.id) as clubs,
        (select count(*) from public.runner_connections a join public.runner_connections b
            on (b.user_a = case when a.user_a = v_uid then a.user_b else a.user_a end or b.user_b = case when a.user_a = v_uid then a.user_b else a.user_a end)
           where (a.user_a = v_uid or a.user_b = v_uid) and (b.user_a = c.id or b.user_b = c.id)) as mutual
        from cand c
       where c.km <= v_radius
         and (v_pace = 'ALL' or (v_pace = 'UNKNOWN' and c.pace is null)
              or (v_pace = 'FAST' and c.pace < 330) or (v_pace = 'MID' and c.pace between 330 and 420) or (v_pace = 'EASY' and c.pace > 420))
         and (v_purpose is null or v_purpose = any((c.ds).purposes))
         and (v_goal is null or v_goal = any((c.ds).goals))
         and (v_slot is null or v_slot = any((c.ds).time_slots))
    ), sc as (
      select f.*,
        -- pace 30 · khung giờ 20 · mục tiêu 15 · mục đích 10 · cộng đồng 15 · khoảng cách 10 · còn chạy đều 5
        (case when f.pace is null or v_my_pace is null then 12 else greatest(0, 30 - greatest(0, abs(f.pace - v_my_pace) - 20) * 30 / 70.0) end
         + least(20, 10 * cardinality(array(select unnest((f.ds).time_slots) intersect select unnest(s.time_slots))))
         + least(15, 8 * cardinality(array(select unnest((f.ds).goals) intersect select unnest(s.goals))))
         + case when 'BUDDY' = any((f.ds).purposes) and 'BUDDY' = any(s.purposes) then 10 else 3 end
         + least(15, 10 * least(f.clubs, 1) + 3 * f.mutual)
         + case when f.km < 2 then 10 when f.km < 5 then 8 when f.km < 10 then 5 else 2 end
         + case when f.last_run > now() - interval '7 days' then 5 else 0 end
         + (abs(hashtext(f.id::text || current_date::text)) % 5)) as score
        from f
    )
    select jsonb_build_object('items', coalesce(jsonb_agg(y.x order by y.rn), '[]'::jsonb),
      'total', (select count(*) from sc), 'nearby_total', (select count(*) from cand), 'my_kind', me->>'kind')
      from (
        select row_number() over (order by sc.score desc, sc.id) as rn, jsonb_build_object(
          'id', sc.id, 'name', private.first_name(sc.id),
          'avatar_url', (select avatar_url from public.profiles where id = sc.id),
          'level', (select level from public.profiles where id = sc.id),
          'km', private.shown_km(sc.km, v_uid, sc.id), 'area_label', sc.area_label, 'where', sc.kind,
          'last_run_days', case when sc.last_run is not null then greatest(0, (current_date - (sc.last_run at time zone 'Asia/Ho_Chi_Minh')::date)) end,
          'pace_s', sc.pace, 'goals', to_jsonb((sc.ds).goals), 'time_slots', to_jsonb((sc.ds).time_slots),
          'purposes', to_jsonb((sc.ds).purposes), 'bio', (sc.ds).bio, 'clubs', sc.clubs, 'mutual', sc.mutual,
          'hub', (sc.ds).hub_listed,
          'score', round(sc.score), 'connection',
            case when private.are_connected(v_uid, sc.id) then 'CONNECTED'
                 when exists (select 1 from public.runner_connection_requests r where r.from_id = v_uid and r.to_id = sc.id and r.status = 'PENDING') then 'PENDING_OUT'
                 when exists (select 1 from public.runner_connection_requests r where r.from_id = sc.id and r.to_id = v_uid and r.status = 'PENDING') then 'PENDING_IN'
                 else 'NONE' end,
          'reasons', to_jsonb(array_remove(array[
            case when sc.pace is not null and v_my_pace is not null and abs(sc.pace - v_my_pace) <= 30 then 'PACE' end,
            case when (sc.ds).time_slots && s.time_slots then 'SLOT' end,
            case when (sc.ds).goals && s.goals then 'GOAL' end,
            case when sc.clubs > 0 then 'CLUB' end,
            case when sc.mutual > 0 then 'MUTUAL' end,
            case when sc.last_run > now() - interval '7 days' then 'ACTIVE' end], null))) as x
          from sc
      ) y(rn, x)
     where y.rn > v_offset and y.rn <= v_offset + 30
  );
end $$;

create or replace function public.nearby_events(p_radius_km integer default 20) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  me jsonb := private.nearby_cell(v_uid);
  v_lat numeric := (me->>'lat')::numeric;
  v_lng numeric := (me->>'lng')::numeric;
begin
  if me is null then raise exception 'NO_PRESENCE'; end if;
  return (select coalesce(jsonb_agg(private.event_json(e, v_uid) || jsonb_build_object(
            'club_name', c.name, 'club_avatar', c.avatar_url,
            'km', round(private.cell_km(v_lat, v_lng, e.lat::numeric, e.lng::numeric), 1),
            'is_member', exists (select 1 from public.club_members m where m.club_id = e.club_id and m.user_id = v_uid and m.status = 'APPROVED'))
          order by e.starts_at), '[]'::jsonb)
            from public.club_events e join public.clubs c on c.id = e.club_id
           where e.visibility = 'PUBLIC' and e.status = 'SCHEDULED' and e.lat is not null
             and e.starts_at > now() - interval '1 hour' and e.starts_at < now() + interval '14 days'
             and private.cell_km(v_lat, v_lng, e.lat::numeric, e.lng::numeric) <= least(greatest(p_radius_km, 2), 50));
end $$;

create or replace function public.nearby_clubs(p_radius_km integer default 20) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  me jsonb := private.nearby_cell(v_uid);
  v_lat numeric := (me->>'lat')::numeric;
  v_lng numeric := (me->>'lng')::numeric;
begin
  if me is null then raise exception 'NO_PRESENCE'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url, 'accent_color', c.accent_color,
            'member_count', c.member_count, 'area_label', c.area_label, 'join_policy', c.join_policy,
            'km', round(private.cell_km(v_lat, v_lng, c.cell_lat, c.cell_lng)),
            'is_member', exists (select 1 from public.club_members m where m.club_id = c.id and m.user_id = v_uid and m.status = 'APPROVED'),
            'upcoming', (select count(*) from public.club_events e where e.club_id = c.id and e.visibility = 'PUBLIC' and e.status = 'SCHEDULED' and e.starts_at > now()))
          order by private.cell_km(v_lat, v_lng, c.cell_lat, c.cell_lng)), '[]'::jsonb)
            from public.clubs c
           where c.cell_lat is not null
             and private.cell_km(v_lat, v_lng, c.cell_lat, c.cell_lng) <= least(greatest(p_radius_km, 2), 50));
end $$;

-- ---------------------------------------------------------------------
-- 5. Bài đăng Hội quán
-- ---------------------------------------------------------------------
create or replace function private.hub_post_json(h public.hub_posts, p_viewer uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', h.id, 'kind', h.kind, 'body', h.body, 'province', h.province, 'area_label', h.area_label, 'near', h.cell_lat is not null,
    'goal', h.goal, 'pace_s', h.pace_s, 'meet_at', h.meet_at, 'race_name', h.race_name, 'status', h.status,
    'expires_at', h.expires_at, 'created_at', h.created_at, 'interest_count', h.interest_count,
    'interested', exists (select 1 from public.hub_post_interests i where i.post_id = h.id and i.user_id = p_viewer),
    'is_mine', h.author_id = p_viewer,
    'author', jsonb_build_object('id', p.id, 'name', p.display_name, 'avatar_url', p.avatar_url, 'level', p.level,
      'province', (select s.province from public.runner_discovery_settings s where s.user_id = p.id)),
    'activity', (select jsonb_build_object('distance_m', a.distance_m, 'moving_time_s', a.moving_time_s,
                   'day', (a.started_at at time zone 'Asia/Ho_Chi_Minh')::date)
                   from public.activities a where a.id = h.activity_id and a.shared and a.validation_status = 'APPROVED'))
    from public.profiles p where p.id = h.author_id
$$;

-- p: {kind, body, near (bool), province, goal, pace_s, meet_at, race_name, activity_id}
create or replace function public.create_hub_post(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  s public.runner_discovery_settings := (select x from public.runner_discovery_settings x where x.user_id = v_uid);
  v_kind text := upper(coalesce(p->>'kind', ''));
  v_body text := trim(coalesce(p->>'body', ''));
  v_near boolean := coalesce((p->>'near')::boolean, false);
  v_cell jsonb := case when v_near then private.nearby_cell(v_uid) end;
  v_province text := coalesce(nullif(trim(coalesce(p->>'province', '')), ''), s.province);
  v_goal text := nullif(upper(coalesce(p->>'goal', '')), '');
  v_pace integer := nullif(p->>'pace_s', '')::int;
  v_meet timestamptz := nullif(p->>'meet_at', '')::timestamptz;
  v_race text := nullif(left(trim(coalesce(p->>'race_name', '')), 80), '');
  v_act uuid := nullif(p->>'activity_id', '')::uuid;
  v_expires timestamptz;
  v_id uuid := gen_random_uuid();
  h public.hub_posts;
begin
  if not private.hub_member(v_uid) then raise exception 'HUB_NOT_JOINED'; end if;
  if v_kind not in ('BUDDY', 'RACE', 'PACER', 'SHARE', 'ASK') then raise exception 'INVALID_POST'; end if;
  if char_length(v_body) < 5 or char_length(v_body) > 500 then raise exception 'INVALID_POST'; end if;
  if private.has_contact_or_link(v_body) or private.has_contact_or_link(v_race) then raise exception 'NO_LINKS'; end if;
  if v_province is not null and not (v_province = any (private.vn_provinces())) then raise exception 'INVALID_POST'; end if;
  if v_goal is not null and v_goal not in ('5K', '10K', 'HM', 'FM', 'TRAIL') then raise exception 'INVALID_POST'; end if;
  if v_pace is not null and v_pace not between 150 and 1200 then raise exception 'INVALID_POST'; end if;
  if v_meet is not null and (v_meet < now() or v_meet > now() + interval '120 days') then raise exception 'INVALID_POST'; end if;
  if v_kind = 'RACE' and v_race is null then raise exception 'RACE_NAME_REQUIRED'; end if;
  if v_near and v_cell is null then raise exception 'NO_PRESENCE'; end if;
  if v_act is not null and not exists (select 1 from public.activities a where a.id = v_act and a.user_id = v_uid
                                          and a.validation_status = 'APPROVED' and a.shared) then raise exception 'ACTIVITY_NOT_FOUND'; end if;
  if (select count(*) from public.hub_posts x where x.author_id = v_uid and x.created_at > now() - interval '24 hours') >= 5 then
    raise exception 'TOO_MANY_POSTS';
  end if;
  v_expires := least(now() + interval '120 days', coalesce(v_meet + interval '1 day', now() + interval '14 days'));
  insert into public.hub_posts (id, author_id, kind, body, province, cell_lat, cell_lng, area_label, goal, pace_s, meet_at, race_name, activity_id, expires_at)
  values (v_id, v_uid, v_kind, v_body, v_province, (v_cell->>'lat')::numeric, (v_cell->>'lng')::numeric, v_cell->>'area', v_goal, v_pace, v_meet, v_race,
          v_act, v_expires);
  h := (select x from public.hub_posts x where x.id = v_id);
  -- Bài "gần tôi" rủ chạy / cần pacer: báo cho tối đa 30 runner gần nhất (≤ 10 km) đang bật Quanh đây; mỗi người ≤ 3 lần / ngày
  if v_cell is not null and v_kind in ('BUDDY', 'PACER') then
    perform private.notify(x.user_id, null, 'HUB_NEARBY', private.first_name(v_uid) || ' rủ chạy gần bạn',
              left(v_body, 120), '/hub?post=' || h.id, v_uid, false)
       from (select l.user_id, row_number() over (order by private.cell_km((v_cell->>'lat')::numeric, (v_cell->>'lng')::numeric, l.cell_lat, l.cell_lng)) as rn
               from private.nearby_locations() l join public.runner_discovery_settings ds on ds.user_id = l.user_id
              where l.user_id <> v_uid and ds.enabled and ds.suspended_at is null
                and private.cell_km((v_cell->>'lat')::numeric, (v_cell->>'lng')::numeric, l.cell_lat, l.cell_lng) <= 10
                and not private.is_blocked(v_uid, l.user_id)
                and private.nearby_visible(l.user_id, v_uid, s.visible_to)
                and private.nearby_visible(v_uid, l.user_id, ds.visible_to)
                and (select count(*) from public.notifications n where n.user_id = l.user_id and n.kind = 'HUB_NEARBY'
                       and n.created_at > now() - interval '24 hours') < 3) x
      where x.rn <= 30;
  end if;
  return private.hub_post_json(h, v_uid);
end $$;

create or replace function public.close_hub_post(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  update public.hub_posts set status = 'CLOSED' where id = p_id and author_id = v_uid and status = 'ACTIVE';
  if not found and not exists (select 1 from public.hub_posts where id = p_id and author_id = v_uid) then raise exception 'POST_NOT_FOUND'; end if;
end $$;

-- p: {kind, province, scope: ALL | NEAR | MINE, id (mở từ thông báo), offset}
create or replace function public.hub_feed(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_kind text := nullif(nullif(upper(coalesce(p->>'kind', '')), ''), 'ALL');
  v_province text := nullif(trim(coalesce(p->>'province', '')), '');
  v_scope text := upper(coalesce(p->>'scope', 'ALL'));
  v_offset integer := greatest(0, coalesce((p->>'offset')::int, 0));
  v_id uuid := nullif(p->>'id', '')::uuid;
  me jsonb := private.nearby_cell(v_uid);
begin
  if v_scope = 'NEAR' and me is null then raise exception 'NO_PRESENCE'; end if;
  return (
    with f as (
      select h, row_number() over (order by h.created_at desc, h.id) as rn,
             case when me is not null and h.cell_lat is not null
                  then private.shown_km(private.cell_km((me->>'lat')::numeric, (me->>'lng')::numeric, h.cell_lat, h.cell_lng), v_uid, h.author_id) end as km
        from public.hub_posts h
       where (v_kind is null or h.kind = v_kind)
         and (v_id is null or h.id = v_id)
         and (v_province is null or h.province = v_province)
         and (case when v_scope = 'MINE' then h.author_id = v_uid
                   else h.status = 'ACTIVE' and h.expires_at > now() and not private.is_blocked(v_uid, h.author_id) end)
         and (v_scope <> 'NEAR' or (h.cell_lat is not null
              and private.cell_km((me->>'lat')::numeric, (me->>'lng')::numeric, h.cell_lat, h.cell_lng) <= 20))
    )
    select jsonb_build_object('items', coalesce(jsonb_agg(private.hub_post_json(f.h, v_uid) || jsonb_build_object('km', f.km) order by f.rn)
                                          filter (where f.rn > v_offset and f.rn <= v_offset + 30), '[]'::jsonb),
                              'total', count(*))
      from f
  );
end $$;

-- "Quan tâm" (bấm lần nữa = bỏ): báo cho người đăng; hai bên nhắn tin được cho nhau
create or replace function public.toggle_hub_interest(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  h public.hub_posts := (select x from public.hub_posts x where x.id = p_id);
  v_on boolean;
begin
  if h.id is null or h.status <> 'ACTIVE' or h.expires_at < now() or private.is_blocked(v_uid, h.author_id) then raise exception 'POST_NOT_FOUND'; end if;
  if h.author_id = v_uid then raise exception 'INVALID_TARGET'; end if;
  v_on := not exists (select 1 from public.hub_post_interests i where i.post_id = h.id and i.user_id = v_uid);
  if v_on then
    if (select count(*) from public.hub_post_interests i where i.user_id = v_uid and i.created_at > now() - interval '24 hours') >= 30 then
      raise exception 'RATE_LIMITED';
    end if;
    insert into public.hub_post_interests (post_id, user_id) values (h.id, v_uid) on conflict do nothing;
    perform private.notify(h.author_id, null, 'HUB_INTEREST', private.display_name(v_uid) || ' quan tâm bài của bạn',
      left(h.body, 120), '/hub?post=' || h.id, v_uid, true);
  else
    delete from public.hub_post_interests where post_id = h.id and user_id = v_uid;
  end if;
  update public.hub_posts set interest_count = (select count(*) from public.hub_post_interests i where i.post_id = h.id) where id = h.id;
  return private.hub_post_json((select x from public.hub_posts x where x.id = h.id), v_uid);
end $$;

-- Người đăng xem ai quan tâm
create or replace function public.hub_interested(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  if not exists (select 1 from public.hub_posts h where h.id = p_id and h.author_id = v_uid) then raise exception 'POST_NOT_FOUND'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name, 'avatar_url', p.avatar_url, 'level', p.level,
            'pace_s', case when coalesce(s.share_pace, false) then private.typical_pace(p.id) end, 'province', s.province, 'at', i.created_at)
          order by i.created_at desc), '[]'::jsonb)
            from public.hub_post_interests i join public.profiles p on p.id = i.user_id
            left join public.runner_discovery_settings s on s.user_id = p.id
           where i.post_id = p_id and not private.is_blocked(v_uid, i.user_id));
end $$;

create or replace function public.report_hub_post(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  h public.hub_posts := (select x from public.hub_posts x where x.id = p_id);
begin
  if h.id is null then raise exception 'POST_NOT_FOUND'; end if;
  if h.author_id = v_uid then raise exception 'INVALID_TARGET'; end if;
  if upper(coalesce(p_reason, '')) not in ('SPAM', 'HARASSMENT', 'FAKE', 'UNSAFE', 'OTHER') then raise exception 'INVALID_REASON'; end if;
  insert into public.hub_post_reports (post_id, user_id, reason) values (h.id, v_uid, upper(p_reason)) on conflict do nothing;
  if not exists (select 1 from public.user_reports r where r.reporter = v_uid and r.target = h.author_id and r.status = 'OPEN') then
    insert into public.user_reports (reporter, target, context, reason, note)
    values (v_uid, h.author_id, 'HUB', upper(p_reason), 'Bài Hội quán: ' || left(h.body, 300));
  end if;
  -- 3 người khác nhau báo cáo → bài tự ẩn chờ admin
  if (select count(*) from public.hub_post_reports r where r.post_id = h.id) >= 3 then
    update public.hub_posts set status = 'HIDDEN' where id = h.id;
  end if;
end $$;

-- Admin: ẩn / hiện lại bài
create or replace function public.admin_set_hub_post(p_id uuid, p_hidden boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_admin uuid := private.require_admin();
begin
  update public.hub_posts set status = case when p_hidden then 'HIDDEN' else 'ACTIVE' end where id = p_id;
  if not found then raise exception 'POST_NOT_FOUND'; end if;
  if not p_hidden then delete from public.hub_post_reports where post_id = p_id; end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_admin, 'HUB_POST_' || case when p_hidden then 'HIDE' else 'SHOW' end, 'hub_post:' || p_id, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- 6. Danh bạ runner Hội quán
-- ---------------------------------------------------------------------
-- p: {province, goal, purpose, slot, pace: ALL|FAST|MID|EASY, q, sort: MATCH|ACTIVE|NEW, offset}
create or replace function public.hub_runners(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  s public.runner_discovery_settings := (select x from public.runner_discovery_settings x where x.user_id = v_uid);
  v_province text := nullif(trim(coalesce(p->>'province', '')), '');
  v_goal text := nullif(nullif(upper(coalesce(p->>'goal', '')), ''), 'ALL');
  v_purpose text := nullif(nullif(upper(coalesce(p->>'purpose', '')), ''), 'ALL');
  v_slot text := nullif(nullif(upper(coalesce(p->>'slot', '')), ''), 'ALL');
  v_pace text := upper(coalesce(p->>'pace', 'ALL'));
  v_q text := nullif(private.search_key(coalesce(p->>'q', '')), '');
  v_sort text := upper(coalesce(p->>'sort', 'MATCH'));
  v_offset integer := greatest(0, coalesce((p->>'offset')::int, 0));
  v_my_pace integer := private.typical_pace(v_uid);
begin
  return (
    with c as (
      select ds, ds.user_id as id, pr.display_name, pr.avatar_url, pr.level,
             case when ds.share_pace then private.typical_pace(ds.user_id) end as pace,
             (select max(a.started_at) from public.activities a where a.user_id = ds.user_id and a.validation_status = 'APPROVED'
                 and coalesce(a.status, '') <> 'DELETED' and a.shared) as last_run
        from public.runner_discovery_settings ds join public.profiles pr on pr.id = ds.user_id
       where ds.hub_listed and ds.suspended_at is null and pr.banned_at is null and ds.user_id <> v_uid
         and not private.is_blocked(v_uid, ds.user_id) and private.nearby_eligible(ds.user_id)
         and (v_province is null or ds.province = v_province)
         and (v_goal is null or v_goal = any(ds.goals))
         and (v_purpose is null or v_purpose = any(ds.purposes))
         and (v_slot is null or v_slot = any(ds.time_slots))
         and (v_q is null or private.search_key(pr.display_name || ' ' || coalesce(ds.headline, '')) like '%' || v_q || '%')
    ), f as (
      select c.*, private.match_score(v_my_pace, c.pace, s, c.ds, c.last_run) as score
        from c
       where v_pace = 'ALL' or (v_pace = 'FAST' and c.pace < 330) or (v_pace = 'MID' and c.pace between 330 and 420) or (v_pace = 'EASY' and c.pace > 420)
    ), r as (
      select f.*, row_number() over (order by
          case when v_sort = 'ACTIVE' then extract(epoch from coalesce(f.last_run, 'epoch'::timestamptz)) end desc nulls last,
          case when v_sort = 'NEW' then extract(epoch from (f.ds).hub_consent_at) end desc nulls last,
          f.score desc, f.id) as rn
        from f
    )
    select jsonb_build_object('total', (select count(*) from r), 'items', coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.display_name, 'avatar_url', r.avatar_url, 'level', r.level,
        'province', (r.ds).province, 'headline', (r.ds).headline, 'bio', (r.ds).bio,
        'goals', to_jsonb((r.ds).goals), 'time_slots', to_jsonb((r.ds).time_slots), 'purposes', to_jsonb((r.ds).purposes),
        'pace_s', r.pace, 'score', r.score,
        'last_run_days', case when r.last_run is not null then greatest(0, (current_date - (r.last_run at time zone 'Asia/Ho_Chi_Minh')::date)) end,
        'stats', private.runner_stats(r.id), 'prs', private.runner_prs(r.id),
        'connection', case when private.are_connected(v_uid, r.id) then 'CONNECTED'
                           when exists (select 1 from public.runner_connection_requests q where q.from_id = v_uid and q.to_id = r.id and q.status = 'PENDING') then 'PENDING_OUT'
                           when exists (select 1 from public.runner_connection_requests q where q.from_id = r.id and q.to_id = v_uid and q.status = 'PENDING') then 'PENDING_IN'
                           else 'NONE' end,
        'following', private.is_following(v_uid, r.id),
        'reasons', to_jsonb(array_remove(array[
            case when r.pace is not null and v_my_pace is not null and abs(r.pace - v_my_pace) <= 30 then 'PACE' end,
            case when s.province is not null and (r.ds).province = s.province then 'PROVINCE' end,
            case when (r.ds).goals && coalesce(s.goals, '{}'::text[]) then 'GOAL' end,
            case when (r.ds).time_slots && coalesce(s.time_slots, '{}'::text[]) then 'SLOT' end,
            case when r.last_run > now() - interval '7 days' then 'ACTIVE' end], null)))
        order by r.rn) filter (where r.rn > v_offset and r.rn <= v_offset + 30), '[]'::jsonb))
      from r
  );
end $$;

-- Hồ sơ Hội quán của tôi: cài đặt + số liệu + thành tích + bài đăng gần đây
create or replace function public.my_hub() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  s public.runner_discovery_settings := (select x from public.runner_discovery_settings x where x.user_id = v_uid);
begin
  return jsonb_build_object(
    'listed', coalesce(s.hub_listed, false) and s.suspended_at is null,
    'eligible', private.nearby_eligible(v_uid), 'valid_runs', private.valid_runs(v_uid), 'suspended', s.suspended_at is not null,
    'province', s.province, 'headline', s.headline, 'bio', s.bio,
    'goals', coalesce(to_jsonb(s.goals), '[]'::jsonb), 'time_slots', coalesce(to_jsonb(s.time_slots), '[]'::jsonb),
    'purposes', coalesce(to_jsonb(s.purposes), '["BUDDY"]'::jsonb), 'share_pace', coalesce(s.share_pace, true),
    'pace_s', private.typical_pace(v_uid), 'stats', private.runner_stats(v_uid), 'prs', private.runner_prs(v_uid),
    'located', private.nearby_cell(v_uid) is not null,
    'interests_in', (select count(*) from public.hub_post_interests i join public.hub_posts h on h.id = i.post_id
                      where h.author_id = v_uid and h.status = 'ACTIVE'),
    'posts', (select coalesce(jsonb_agg(private.hub_post_json(h, v_uid) order by h.created_at desc), '[]'::jsonb)
                from public.hub_posts h where h.author_id = v_uid and h.created_at > now() - interval '60 days'));
end $$;

-- ---------------------------------------------------------------------
-- 7. Bảng tin quanh đây: bài chạy gần đây của runner quanh mình + bài Hội quán gần mình
-- ---------------------------------------------------------------------
create or replace function public.nearby_feed(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  s public.runner_discovery_settings := (select x from public.runner_discovery_settings x where x.user_id = v_uid);
  me jsonb := private.nearby_cell(v_uid);
  v_lat numeric := (me->>'lat')::numeric;
  v_lng numeric := (me->>'lng')::numeric;
  v_radius integer := coalesce((p->>'radius_km')::int, s.radius_km, 10);
begin
  if not coalesce(s.enabled, false) or s.suspended_at is not null then raise exception 'NEARBY_DISABLED'; end if;
  if me is null then raise exception 'NO_PRESENCE'; end if;
  if v_radius not in (2, 5, 10, 20) then v_radius := 10; end if;
  return (
    with ppl as (
      select l.user_id, l.kind, private.cell_km(v_lat, v_lng, l.cell_lat, l.cell_lng) as km
        from private.nearby_locations() l join public.runner_discovery_settings ds on ds.user_id = l.user_id
       where l.user_id <> v_uid and ds.enabled and ds.suspended_at is null
         and private.cell_km(v_lat, v_lng, l.cell_lat, l.cell_lng) <= v_radius
         and not private.is_blocked(v_uid, l.user_id)
         and private.nearby_visible(v_uid, l.user_id, ds.visible_to)
         and private.nearby_visible(l.user_id, v_uid, s.visible_to)
         and private.nearby_eligible(l.user_id)
    ), runs as (
      -- Chỉ ngày (không giờ), quãng đường, pace — không tuyến, không điểm xuất phát
      select jsonb_build_object('type', 'RUN', 'at', a.started_at, 'day', (a.started_at at time zone 'Asia/Ho_Chi_Minh')::date,
               'user', jsonb_build_object('id', a.user_id, 'name', private.first_name(a.user_id),
                         'avatar_url', (select avatar_url from public.profiles where id = a.user_id),
                         'level', (select level from public.profiles where id = a.user_id)),
               'km', private.shown_km(ppl.km, v_uid, a.user_id), 'where', ppl.kind,
               'distance_m', a.distance_m, 'moving_time_s', a.moving_time_s,
               'connection', case when private.are_connected(v_uid, a.user_id) then 'CONNECTED' else 'NONE' end) as x,
             row_number() over (partition by a.user_id order by a.started_at desc) as k, a.started_at as t
        from public.activities a join ppl on ppl.user_id = a.user_id
       where a.validation_status = 'APPROVED' and coalesce(a.status, '') <> 'DELETED' and a.shared
         and a.started_at > now() - interval '7 days' and a.distance_m >= 1000
    ), posts as (
      select private.hub_post_json(h, v_uid) || jsonb_build_object('type', 'POST', 'at', h.created_at,
               'km', private.shown_km(private.cell_km(v_lat, v_lng, h.cell_lat, h.cell_lng), v_uid, h.author_id)) as x, h.created_at as t
        from public.hub_posts h
       where h.status = 'ACTIVE' and h.expires_at > now() and h.cell_lat is not null and h.author_id <> v_uid
         and private.cell_km(v_lat, v_lng, h.cell_lat, h.cell_lng) <= greatest(v_radius, 10)
         and not private.is_blocked(v_uid, h.author_id)
    ), allx as (
      select x, t from runs where k <= 2           -- mỗi người tối đa 2 bài để bảng tin không bị một người chiếm
      union all select x, t from posts
    )
    select jsonb_build_object('items', coalesce(jsonb_agg(z.x order by z.t desc), '[]'::jsonb), 'my_kind', me->>'kind', 'people', (select count(*) from ppl))
      from (select x, t, row_number() over (order by t desc) as rn from allx) z where z.rn <= 40
  );
end $$;

-- ---------------------------------------------------------------------
-- 8. Kết nối từ Hội quán + nhắn tin sau khi "Quan tâm"
-- ---------------------------------------------------------------------
create or replace function public.send_connection(p_to uuid, p_message text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  s public.runner_discovery_settings := (select x from public.runner_discovery_settings x where x.user_id = v_uid);
  t public.runner_discovery_settings := (select x from public.runner_discovery_settings x where x.user_id = p_to);
  v_msg text := nullif(left(trim(coalesce(p_message, '')), 140), '');
  v_in public.runner_connection_requests := (select r from public.runner_connection_requests r where r.from_id = p_to and r.to_id = v_uid and r.status = 'PENDING');
  v_id uuid := gen_random_uuid();
begin
  if p_to = v_uid then raise exception 'INVALID_TARGET'; end if;
  -- Người gửi: đang bật Quanh đây HOẶC đã vào Hội quán
  if s.user_id is null or s.suspended_at is not null or not (s.enabled or s.hub_listed) then raise exception 'NEARBY_DISABLED'; end if;
  -- Người nhận: vào Hội quán (ai cũng thấy) HOẶC bật Quanh đây và cho mình thấy
  if t.user_id is null or t.suspended_at is not null
     or not (t.hub_listed or (t.enabled and private.nearby_visible(v_uid, p_to, t.visible_to))) then
    raise exception 'TARGET_UNAVAILABLE';
  end if;
  if private.is_blocked(v_uid, p_to) then raise exception 'TARGET_UNAVAILABLE'; end if;
  if private.are_connected(v_uid, p_to) then raise exception 'ALREADY_CONNECTED'; end if;
  if v_msg is not null and private.has_contact_or_link(v_msg) then raise exception 'NO_LINKS'; end if;
  -- Họ đã mời mình → chấp nhận luôn
  if v_in.id is not null then return public.respond_connection(v_in.id, 'ACCEPT'); end if;
  if exists (select 1 from public.runner_connection_requests x where x.from_id = v_uid and x.to_id = p_to and x.status = 'PENDING') then
    raise exception 'ALREADY_REQUESTED';
  end if;
  if exists (select 1 from public.runner_connection_requests x where x.from_id = v_uid and x.to_id = p_to and x.status = 'DECLINED'
              and x.responded_at > now() - interval '30 days') then raise exception 'REQUEST_COOLDOWN'; end if;
  if (select count(*) from public.runner_connection_requests x where x.from_id = v_uid and x.created_at > now() - interval '24 hours') >= 15 then
    raise exception 'TOO_MANY_REQUESTS';
  end if;
  insert into public.runner_connection_requests (id, from_id, to_id, message) values (v_id, v_uid, p_to, v_msg);
  perform private.notify(p_to, null, 'RUNNER_CONNECT', private.first_name(v_uid) || ' muốn kết nối chạy cùng bạn',
    coalesce(v_msg, 'Xem lời mời trong Quanh đây.'), '/nearby/connections', v_uid, true);
  return jsonb_build_object('id', v_id, 'status', 'PENDING');
end $$;

-- Nhắn tin: như 011500 + hai người đã "gặp nhau" qua bài Hội quán (một người quan tâm bài của người kia)
create or replace function private.can_dm(p_from uuid, p_to uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_from is not null and p_to is not null and p_from <> p_to
     and not private.is_blocked(p_from, p_to)
     and (private.is_following(p_to, p_from)
          or private.are_connected(p_from, p_to)
          or public.shares_club(p_from, p_to)
          or exists (select 1 from public.direct_messages m join public.direct_threads t on t.id = m.thread_id
                      where t.user_a = least(p_from, p_to) and t.user_b = greatest(p_from, p_to) and m.sender_id = p_to)
          or exists (select 1 from public.hub_post_interests i join public.hub_posts h on h.id = i.post_id
                      where (h.author_id = p_from and i.user_id = p_to) or (h.author_id = p_to and i.user_id = p_from)))
$$;

-- ---------------------------------------------------------------------
-- 9. Quyền
-- ---------------------------------------------------------------------
revoke all on function private.vn_provinces(), private.home_cell(numeric), private.has_contact_or_link(text), private.refresh_home_area(uuid),
  private.home_area_on_activity(), private.nearby_locations(), private.nearby_cell(uuid), private.runner_stats(uuid), private.runner_prs(uuid),
  private.match_score(integer, integer, public.runner_discovery_settings, public.runner_discovery_settings, timestamptz), private.hub_member(uuid),
  private.hub_post_json(public.hub_posts, uuid), private.can_dm(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.create_hub_post(jsonb), public.close_hub_post(uuid), public.hub_feed(jsonb), public.toggle_hub_interest(uuid),
  public.hub_interested(uuid), public.report_hub_post(uuid, text), public.admin_set_hub_post(uuid, boolean), public.hub_runners(jsonb),
  public.my_hub(), public.nearby_feed(jsonb), public.my_discovery(), public.set_discovery(jsonb), public.nearby_runners(jsonb),
  public.nearby_events(integer), public.nearby_clubs(integer), public.send_connection(uuid, text) from public, anon;
grant execute on function public.create_hub_post(jsonb), public.close_hub_post(uuid), public.hub_feed(jsonb), public.toggle_hub_interest(uuid),
  public.hub_interested(uuid), public.report_hub_post(uuid, text), public.admin_set_hub_post(uuid, boolean), public.hub_runners(jsonb),
  public.my_hub(), public.nearby_feed(jsonb), public.my_discovery(), public.set_discovery(jsonb), public.nearby_runners(jsonb),
  public.nearby_events(integer), public.nearby_clubs(integer), public.send_connection(uuid, text) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001012900_cms_ebook.sql
-- ===================================================================
-- Trình soạn của ban nội dung (CMS) đăng được Ebook PDF như trang Viết bài của runner (011700).
-- Trước đây cms_save ép content_type về ARTICLE / NEWS và bỏ qua attachment_url:
-- admin không đăng được ebook, và sửa ebook của runner trong CMS làm mất loại Ebook.
-- p thêm: content_type 'EBOOK', attachment_url (https, ≤ 500 ký tự; bắt buộc với Ebook; vắng khóa = giữ tệp cũ).

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
  v_type text := case upper(coalesce(p->>'content_type', '')) when 'NEWS' then 'NEWS' when 'EBOOK' then 'EBOOK' else 'ARTICLE' end;
  -- Không gửi khóa attachment_url thì giữ tệp cũ (bản app cũ không biết khóa này)
  v_att text := case when p ? 'attachment_url' then nullif(trim(coalesce(p->>'attachment_url', '')), '') else a.attachment_url end;
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
  if v_att is not null and (v_att !~ '^https://' or char_length(v_att) > 500) then raise exception 'INVALID_URL'; end if;
  if v_type = 'EBOOK' and v_att is null then raise exception 'EBOOK_PDF_REQUIRED'; end if;
  -- Chuyên mục sức khoẻ / giáo án luôn cần duyệt chuyên môn; chỉ admin tắt được
  v_expert := (select c.needs_expert from public.content_categories c where c.id = v_cat)
              or coalesce((p->>'needs_expert_review')::boolean, a.needs_expert_review, false);
  if v_role = 'ADMIN' and (p ? 'needs_expert_review') then v_expert := (p->>'needs_expert_review')::boolean; end if;

  if a.id is null then
    insert into public.content_articles (slug, title, summary, body, cover_image_url, category_id, author_id, content_type, reading_time_minutes,
      source_url, source_name, is_featured, series_id, series_order, ctas, needs_expert_review, attachment_url, created_by)
    values (v_slug, v_title, nullif(left(trim(coalesce(p->>'summary', '')), 300), ''), v_body, nullif(p->>'cover_image_url', ''), v_cat,
      coalesce(nullif(p->>'author_id', '')::uuid, (select au.id from public.content_authors au where au.user_id = v_uid)),
      v_type, private.reading_minutes(v_body),
      nullif(p->>'source_url', ''), nullif(left(trim(coalesce(p->>'source_name', '')), 80), ''),
      v_editor and coalesce((p->>'is_featured')::boolean, false), nullif(p->>'series_id', ''), nullif(p->>'series_order', '')::int,
      private.clean_ctas(p->'ctas'), v_expert, v_att, v_uid)
    returning id into v_id;
  else
    v_id := a.id;
    update public.content_articles set slug = v_slug, title = v_title, summary = nullif(left(trim(coalesce(p->>'summary', '')), 300), ''),
      body = v_body, cover_image_url = nullif(p->>'cover_image_url', ''), category_id = v_cat,
      author_id = case when p ? 'author_id' then nullif(p->>'author_id', '')::uuid else author_id end,
      content_type = v_type, attachment_url = v_att,
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

-- ===================================================================
-- 20261001013000_ops_readonly.sql
-- ===================================================================
-- Trợ lý vận hành (ADR-018): schema `ops` chỉ gồm view tổng hợp + role `ops_reader` chỉ đọc được schema này.
-- Routine Claude kết nối bằng ops_reader để soạn báo cáo; không đọc được public / private / auth, không ghi được gì.
--
-- Sau khi chạy migration, Quản trị chính tự đặt mật khẩu (KHÔNG ghi vào repo, không gửi qua chat):
--   alter role ops_reader with login password '<mật khẩu mạnh>';
-- Chuỗi kết nối (Supabase → Connect → Session pooler), thay user thành ops_reader.<project-ref>,
-- rồi lưu làm biến môi trường RACEHUB_OPS_DB_URL trong cài đặt môi trường của project Claude.
-- Nghi lộ: alter role ops_reader with password '<mới>';  hoặc  alter role ops_reader nologin;
--
-- Danh sách tester kiểm thử kín (email trùng danh sách trong Play Console):
--   insert into ops.testers (email) values ('a@gmail.com'), ('b@gmail.com') on conflict do nothing;

create schema if not exists ops;
revoke all on schema ops from public;
do $$ begin
  -- Supabase có anon / authenticated; schema ops không mở cho app (không có trong API schemas)
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema ops from anon, authenticated'; end if;
end $$;

create table if not exists ops.testers (
  email text primary key check (email = lower(trim(email)) and email like '%@%' and char_length(email) <= 200),
  joined_on date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  note text check (note is null or char_length(note) <= 200),
  active boolean not null default true
);

-- Mỗi tester: có tài khoản chưa, lần đăng nhập / chạy / nhận thông báo gần nhất, số ngày im lặng.
-- App chưa ghi "lần mở app", nên dùng lần có dấu hiệu sống gần nhất trong 3 nguồn trên.
create or replace view ops.tester_activity as
select t.email, t.joined_on, t.note,
       u.id is not null as has_account,
       p.display_name,
       u.last_sign_in_at,
       r.last_run_at,
       coalesce(r.runs_7d, 0) as runs_7d,
       coalesce(r.km_7d, 0) as km_7d,
       s.last_push_seen_at,
       greatest(u.last_sign_in_at, r.last_run_at, s.last_push_seen_at) as last_signal_at,
       (now()::date - greatest(u.last_sign_in_at, r.last_run_at, s.last_push_seen_at)::date) as days_silent
  from ops.testers t
  left join auth.users u on lower(u.email) = t.email
  left join public.profiles p on p.id = u.id
  left join lateral (
    select max(a.started_at) as last_run_at,
           count(*) filter (where a.started_at >= now() - interval '7 days') as runs_7d,
           round(coalesce(sum(a.distance_m) filter (where a.started_at >= now() - interval '7 days'), 0) / 1000.0, 1) as km_7d
      from public.activities a where a.user_id = u.id) r on true
  left join lateral (select max(ps.last_seen_at) as last_push_seen_at from public.push_subscriptions ps where ps.user_id = u.id) s on true
 where t.active;

-- Số liệu theo tuần (thứ Hai → Chủ nhật, giờ VN), 8 tuần gần nhất.
create or replace view ops.weekly_metrics as
with w as (
  select generate_series(date_trunc('week', (now() at time zone 'Asia/Ho_Chi_Minh')) - interval '7 weeks',
                         date_trunc('week', (now() at time zone 'Asia/Ho_Chi_Minh')), interval '1 week') as week_start
)
select w.week_start::date as week_start,
       (select count(*) from public.profiles p
         where (p.created_at at time zone 'Asia/Ho_Chi_Minh') >= w.week_start
           and (p.created_at at time zone 'Asia/Ho_Chi_Minh') < w.week_start + interval '1 week') as new_users,
       (select count(distinct a.user_id) from public.activities a
         where (a.started_at at time zone 'Asia/Ho_Chi_Minh') >= w.week_start
           and (a.started_at at time zone 'Asia/Ho_Chi_Minh') < w.week_start + interval '1 week') as active_runners,
       (select count(*) from public.activities a
         where (a.started_at at time zone 'Asia/Ho_Chi_Minh') >= w.week_start
           and (a.started_at at time zone 'Asia/Ho_Chi_Minh') < w.week_start + interval '1 week') as runs,
       (select round(coalesce(sum(a.distance_m), 0) / 1000.0, 1) from public.activities a
         where (a.started_at at time zone 'Asia/Ho_Chi_Minh') >= w.week_start
           and (a.started_at at time zone 'Asia/Ho_Chi_Minh') < w.week_start + interval '1 week') as km,
       (select count(*) from public.challenges c
         where (c.created_at at time zone 'Asia/Ho_Chi_Minh') >= w.week_start
           and (c.created_at at time zone 'Asia/Ho_Chi_Minh') < w.week_start + interval '1 week') as new_challenges,
       (select count(*) from public.clubs c
         where (c.created_at at time zone 'Asia/Ho_Chi_Minh') >= w.week_start
           and (c.created_at at time zone 'Asia/Ho_Chi_Minh') < w.week_start + interval '1 week') as new_clubs
  from w;

-- Việc cần chủ dự án để ý. kind: CHALLENGE_ENDING | CHALLENGE_LOW_SIGNUP | CLUB_QUIET | USER_REPORT_OPEN
create or replace view ops.attention as
select 'CHALLENGE_ENDING'::text as kind, c.id as ref_id, c.title,
       format('Kết thúc %s, %s người tham gia', to_char(c.end_date at time zone 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI'),
              (select count(*) from public.challenge_participants cp where cp.challenge_id = c.id)) as detail,
       c.end_date as due_at
  from public.challenges c
 where c.status = 'ACTIVE' and c.end_date between now() and now() + interval '3 days'
union all
select 'CHALLENGE_LOW_SIGNUP', c.id, c.title,
       format('Hạn đăng ký %s, mới %s/%s người tối thiểu', to_char(c.reg_deadline at time zone 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI'),
              n.joined, coalesce(c.min_members, 1)),
       c.reg_deadline
  from public.challenges c
  cross join lateral (select count(*) as joined from public.challenge_participants cp where cp.challenge_id = c.id) n
 where c.status = 'ACTIVE' and c.reg_deadline between now() and now() + interval '2 days'
   and n.joined < greatest(coalesce(c.min_members, 1), 2)
union all
select 'CLUB_QUIET', c.id, c.name,
       format('%s thành viên, không ai chạy trong 14 ngày', c.member_count),
       null::timestamptz
  from public.clubs c
 where c.created_at < now() - interval '14 days'
   and not exists (select 1 from public.club_members m join public.activities a on a.user_id = m.user_id
                    where m.club_id = c.id and coalesce(m.status, 'APPROVED') = 'APPROVED' and a.started_at >= now() - interval '14 days')
union all
select 'USER_REPORT_OPEN', r.id, r.reason,
       format('Báo cáo %s (%s) chưa xử lý từ %s', r.reason, r.context, to_char(r.created_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM')),
       r.created_at
  from public.user_reports r
 where r.status = 'OPEN';

-- Role chỉ đọc. Tạo ở trạng thái nologin; Quản trị chính tự bật đăng nhập + đặt mật khẩu (xem đầu file).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'ops_reader') then
    create role ops_reader nologin noinherit;
  end if;
end $$;
alter role ops_reader set default_transaction_read_only = on;
alter role ops_reader set statement_timeout = '15s';
grant usage on schema ops to ops_reader;
grant select on ops.testers, ops.tester_activity, ops.weekly_metrics, ops.attention to ops_reader;

commit;
