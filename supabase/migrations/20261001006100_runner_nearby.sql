-- 006100: Runner Nearby (Quanh đây) — V1, xem docs/RUNNER_NEARBY.md.
-- • Mặc định TẮT; bật cần đồng ý riêng (phiên bản đồng ý) + ≥ 3 bài chạy hợp lệ.
-- • Vị trí chỉ lưu Ô LƯỚI ~1 km (làm tròn 0,01°), KHÔNG lưu toạ độ gốc, có hạn (24 giờ / 7 / 30 ngày).
-- • Khoảng cách hiển thị: số km (≥ 1) tính giữa tâm 2 ô + độ lệch cố định cho từng cặp (±0,5 km) → không dò tam giác được;
--   đổi vị trí ≤ 3 lần / 24 giờ, tìm ≤ 60 lần / giờ.
-- • Ai thấy tôi: VERIFIED (mặc định: người cũng đã đủ điều kiện) / SAME_GENDER / CLUBS (chung CLB).
-- • Kết nối 2 chiều (phải chấp nhận), ≤ 15 lời mời / ngày, bị từ chối thì 30 ngày không gửi lại. Chưa có nhắn tin riêng:
--   "Rủ chạy" = mời vào buổi chạy công khai / CLB. Chặn hai chiều, báo cáo (3 người báo cáo → tự ẩn chờ admin).
-- • CLB: điểm tập công khai (ô lưới) + sự kiện CLB công khai (người ngoài đăng ký được).
-- Cần 001500, 005600. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 1. Bảng
-- ---------------------------------------------------------------------
create table if not exists public.runner_discovery_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default false,
  visible_to text not null default 'VERIFIED' check (visible_to in ('VERIFIED', 'SAME_GENDER', 'CLUBS')),
  purposes text[] not null default array['BUDDY']::text[],
  goals text[] not null default '{}'::text[],
  time_slots text[] not null default '{}'::text[],
  share_pace boolean not null default true,
  radius_km integer not null default 10 check (radius_km in (2, 5, 10, 20)),
  bio text check (bio is null or char_length(bio) <= 140),
  consent_version text,
  consent_at timestamptz,
  suspended_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.runner_location_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  cell_lat numeric(6, 2) not null check (cell_lat between -90 and 90),
  cell_lng numeric(6, 2) not null check (cell_lng between -180 and 180),
  source text not null check (source in ('DEVICE', 'AREA')),
  area_label text check (area_label is null or char_length(area_label) <= 60),
  moves integer not null default 0,
  moves_since timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists runner_presence_cell_idx on public.runner_location_presence (cell_lat, cell_lng);

create table if not exists public.runner_connection_requests (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.profiles(id) on delete cascade,
  to_id uuid not null references public.profiles(id) on delete cascade,
  message text check (message is null or char_length(message) <= 140),
  status text not null default 'PENDING' check (status in ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (from_id <> to_id)
);
create unique index if not exists runner_request_pending_uq on public.runner_connection_requests (from_id, to_id) where status = 'PENDING';
create index if not exists runner_request_to_idx on public.runner_connection_requests (to_id, status);

create table if not exists public.runner_connections (
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);
create index if not exists runner_connections_b_idx on public.runner_connections (user_b);

create table if not exists public.user_blocks (
  blocker uuid not null references public.profiles(id) on delete cascade,
  blocked uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked);

create table if not exists public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid not null references public.profiles(id) on delete cascade,
  target uuid not null references public.profiles(id) on delete cascade,
  context text not null default 'NEARBY' check (context in ('NEARBY', 'CONNECTION', 'CLUB', 'OTHER')),
  reason text not null check (reason in ('SPAM', 'HARASSMENT', 'FAKE', 'UNSAFE', 'OTHER')),
  note text check (note is null or char_length(note) <= 500),
  status text not null default 'OPEN' check (status in ('OPEN', 'RESOLVED', 'DISMISSED')),
  resolution text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check (reporter <> target)
);
create index if not exists user_reports_status_idx on public.user_reports (status, created_at desc);

-- Nhật ký lượt tìm (giới hạn tần suất, phát hiện dò vị trí) — giữ 7 ngày
create table if not exists public.runner_nearby_searches (
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists runner_searches_idx on public.runner_nearby_searches (user_id, created_at desc);

-- Mọi đọc / ghi qua RPC
alter table public.runner_discovery_settings enable row level security;
alter table public.runner_location_presence enable row level security;
alter table public.runner_connection_requests enable row level security;
alter table public.runner_connections enable row level security;
alter table public.user_blocks enable row level security;
alter table public.user_reports enable row level security;
alter table public.runner_nearby_searches enable row level security;
revoke all on public.runner_discovery_settings, public.runner_location_presence, public.runner_connection_requests,
  public.runner_connections, public.user_blocks, public.user_reports, public.runner_nearby_searches from anon, authenticated;

-- CLB: điểm tập công khai; sự kiện CLB công khai
alter table public.clubs add column if not exists area_label text;
alter table public.clubs add column if not exists cell_lat numeric(6, 2);
alter table public.clubs add column if not exists cell_lng numeric(6, 2);
alter table public.club_events add column if not exists visibility text not null default 'CLUB';
alter table public.club_events drop constraint if exists club_events_visibility_chk;
alter table public.club_events add constraint club_events_visibility_chk check (visibility in ('CLUB', 'PUBLIC'));

-- ---------------------------------------------------------------------
-- 2. Hàm phụ
-- ---------------------------------------------------------------------
create or replace function private.nearby_consent_version() returns text language sql immutable as $$ select 'nearby-v1' $$;

-- Số bài chạy hợp lệ (điều kiện bật)
create or replace function private.valid_runs(p_user uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.activities a
   where a.user_id = p_user and a.validation_status = 'APPROVED' and coalesce(a.status, '') <> 'DELETED'
$$;

create or replace function private.nearby_eligible(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select private.valid_runs(p_user) >= 3
     and not exists (select 1 from public.profiles p where p.id = p_user and p.banned_at is not null)
$$;

-- Pace điển hình (giây / km): trung vị 28 ngày, bài hợp lệ ≥ 1 km
create or replace function private.typical_pace(p_user uuid) returns integer
language sql stable security definer set search_path = public as $$
  select round(percentile_cont(0.5) within group (order by a.moving_time_s / (a.distance_m / 1000.0)))::int
    from public.activities a
   where a.user_id = p_user and a.validation_status = 'APPROVED' and coalesce(a.status, '') <> 'DELETED'
     and a.distance_m >= 1000 and a.moving_time_s > 0 and a.started_at > now() - interval '28 days'
$$;

create or replace function private.is_blocked(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_blocks b where (b.blocker = p_a and b.blocked = p_b) or (b.blocker = p_b and b.blocked = p_a))
$$;

create or replace function private.are_connected(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.runner_connections c where c.user_a = least(p_a, p_b) and c.user_b = greatest(p_a, p_b))
$$;

create or replace function private.share_club(p_a uuid, p_b uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.club_members m1 join public.club_members m2 on m2.club_id = m1.club_id
   where m1.user_id = p_a and m2.user_id = p_b and m1.status = 'APPROVED' and m2.status = 'APPROVED'
$$;

-- Người xem có được thấy người này theo "ai thấy tôi" không
create or replace function private.nearby_visible(p_viewer uuid, p_target uuid, p_mode text) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_mode
    when 'SAME_GENDER' then exists (select 1 from public.profiles a join public.profiles b on b.id = p_target
                                     where a.id = p_viewer and a.gender is not null and a.gender = b.gender)
    when 'CLUBS' then private.share_club(p_viewer, p_target) > 0
    else true end
$$;

-- Khoảng cách (km) giữa tâm 2 ô lưới
create or replace function private.cell_km(a_lat numeric, a_lng numeric, b_lat numeric, b_lng numeric) returns numeric
language sql immutable as $$
  select 6371 * 2 * asin(sqrt(power(sin(radians((b_lat - a_lat)::float8) / 2), 2)
    + cos(radians(a_lat::float8)) * cos(radians(b_lat::float8)) * power(sin(radians((b_lng - a_lng)::float8) / 2), 2)))::numeric
$$;

-- Km hiển thị: làm tròn 1 km, cộng độ lệch cố định theo cặp (±0,5) → cùng một người luôn thấy cùng một số, không dò được
create or replace function private.shown_km(p_km numeric, p_a uuid, p_b uuid) returns integer
language sql immutable as $$
  select greatest(1, round(p_km + ((abs(hashtext(least(p_a, p_b)::text || greatest(p_a, p_b)::text)) % 100) / 100.0 - 0.5))::int)
$$;

create or replace function private.first_name(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  -- tên gọi + chữ cái đầu họ: "Nguyễn Văn An" → "An N."
  select case when n is null or n = '' then 'Runner'
              when position(' ' in n) = 0 then n
              else regexp_replace(n, '^.*\s', '') || ' ' || left(n, 1) || '.' end
    from (select trim(coalesce((select display_name from public.profiles where id = p_user), '')) as n) x
$$;

-- ---------------------------------------------------------------------
-- 3. Cài đặt + vị trí của tôi
-- ---------------------------------------------------------------------
create or replace function public.my_discovery() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  s public.runner_discovery_settings := (select x from public.runner_discovery_settings x where x.user_id = v_uid);
  p public.runner_location_presence := (select x from public.runner_location_presence x where x.user_id = v_uid);
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
    'incoming', (select count(*) from public.runner_connection_requests r where r.to_id = v_uid and r.status = 'PENDING'),
    'connections', (select count(*) from public.runner_connections c where c.user_a = v_uid or c.user_b = v_uid));
end $$;

-- p: {enabled, consent, visible_to, purposes[], goals[], time_slots[], share_pace, radius_km, bio}
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
begin
  if v_vis not in ('VERIFIED', 'SAME_GENDER', 'CLUBS') then raise exception 'INVALID_SETTINGS'; end if;
  if v_radius not in (2, 5, 10, 20) then raise exception 'INVALID_SETTINGS'; end if;
  if not (v_purposes <@ array['BUDDY', 'CLUB', 'COACH']) or not (v_goals <@ array['5K', '10K', 'HM', 'FM', 'TRAIL'])
     or not (v_slots <@ array['EARLY', 'MORNING', 'NOON', 'EVENING', 'WEEKEND']) then raise exception 'INVALID_SETTINGS'; end if;
  if v_enabled then
    if coalesce(v_consent, '') <> private.nearby_consent_version() then raise exception 'CONSENT_REQUIRED'; end if;
    if not private.nearby_eligible(v_uid) then raise exception 'NOT_ELIGIBLE'; end if;
    if s.suspended_at is not null then raise exception 'NEARBY_SUSPENDED'; end if;
  end if;
  insert into public.runner_discovery_settings as t (user_id, enabled, visible_to, purposes, goals, time_slots, share_pace, radius_km, bio,
                                                     consent_version, consent_at, updated_at)
  values (v_uid, v_enabled, v_vis, v_purposes, v_goals, v_slots, coalesce((p->>'share_pace')::boolean, s.share_pace, true), v_radius,
          case when p ? 'bio' then nullif(left(trim(coalesce(p->>'bio', '')), 140), '') else s.bio end,
          v_consent, case when v_consent is distinct from s.consent_version then now() else s.consent_at end, now())
  on conflict (user_id) do update set enabled = excluded.enabled, visible_to = excluded.visible_to, purposes = excluded.purposes,
    goals = excluded.goals, time_slots = excluded.time_slots, share_pace = excluded.share_pace, radius_km = excluded.radius_km,
    bio = excluded.bio, consent_version = excluded.consent_version, consent_at = excluded.consent_at, updated_at = now();
  -- Tắt = xoá vị trí ngay
  if not v_enabled then delete from public.runner_location_presence where user_id = v_uid; end if;
  return public.my_discovery();
end $$;

-- Công bố vị trí gần đúng: làm tròn về ô ~1 km trước khi lưu; đổi ô tối đa 3 lần / 24 giờ
create or replace function public.set_presence(p_lat double precision, p_lng double precision, p_source text, p_area text default null, p_hours integer default 168)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  s public.runner_discovery_settings := (select x from public.runner_discovery_settings x where x.user_id = v_uid);
  p public.runner_location_presence := (select x from public.runner_location_presence x where x.user_id = v_uid);
  v_lat numeric(6, 2) := round(p_lat::numeric, 2);
  v_lng numeric(6, 2) := round(p_lng::numeric, 2);
  v_moves integer;
begin
  if not coalesce(s.enabled, false) or s.suspended_at is not null then raise exception 'NEARBY_DISABLED'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'INVALID_LOCATION'; end if;
  if p_source not in ('DEVICE', 'AREA') then raise exception 'INVALID_LOCATION'; end if;
  if p_hours not in (24, 168, 720) then raise exception 'INVALID_LOCATION'; end if;
  v_moves := case when p.user_id is null then 0 when p.moves_since > now() - interval '24 hours' then p.moves else 0 end;
  if p.user_id is not null and (p.cell_lat <> v_lat or p.cell_lng <> v_lng) then
    if v_moves >= 3 then raise exception 'TOO_MANY_MOVES'; end if;
    v_moves := v_moves + 1;
  end if;
  insert into public.runner_location_presence as t (user_id, cell_lat, cell_lng, source, area_label, moves, moves_since, updated_at, expires_at)
  values (v_uid, v_lat, v_lng, p_source, nullif(left(trim(coalesce(p_area, '')), 60), ''), v_moves,
          case when p.user_id is null or p.moves_since <= now() - interval '24 hours' then now() else p.moves_since end,
          now(), now() + make_interval(hours => p_hours))
  on conflict (user_id) do update set cell_lat = excluded.cell_lat, cell_lng = excluded.cell_lng, source = excluded.source,
    area_label = excluded.area_label, moves = excluded.moves, moves_since = excluded.moves_since, updated_at = now(), expires_at = excluded.expires_at;
  return public.my_discovery();
end $$;

create or replace function public.clear_presence() returns void
language sql security definer set search_path = public as $$
  delete from public.runner_location_presence where user_id = private.require_uid()
$$;

-- ---------------------------------------------------------------------
-- 4. Tìm runner phù hợp
-- ---------------------------------------------------------------------
-- p: {radius_km, pace: ALL|FAST|MID|EASY|UNKNOWN, purpose, goal, slot, offset}
create or replace function public.nearby_runners(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  s public.runner_discovery_settings := (select x from public.runner_discovery_settings x where x.user_id = v_uid);
  me public.runner_location_presence := (select x from public.runner_location_presence x where x.user_id = v_uid and x.expires_at > now());
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
  if me.user_id is null then raise exception 'NO_PRESENCE'; end if;
  if v_radius not in (2, 5, 10, 20) then v_radius := 10; end if;
  if (select count(*) from public.runner_nearby_searches x where x.user_id = v_uid and x.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'TOO_MANY_SEARCHES';
  end if;
  insert into public.runner_nearby_searches (user_id) values (v_uid);
  delete from public.runner_nearby_searches where created_at < now() - interval '7 days';
  delete from public.runner_location_presence where expires_at < now() - interval '1 day';
  v_dlat := v_radius / 111.0 + 0.01;
  v_dlng := v_radius / (111.0 * greatest(cos(radians(me.cell_lat::float8)), 0.2)) + 0.01;

  return (
    with cand as (
      select o.user_id as id, ds, o, private.cell_km(me.cell_lat, me.cell_lng, o.cell_lat, o.cell_lng) as km,
             case when ds.share_pace then private.typical_pace(o.user_id) end as pace
        from public.runner_location_presence o
        join public.runner_discovery_settings ds on ds.user_id = o.user_id
       where o.user_id <> v_uid and o.expires_at > now() and ds.enabled and ds.suspended_at is null
         and o.cell_lat between me.cell_lat - v_dlat and me.cell_lat + v_dlat
         and o.cell_lng between me.cell_lng - v_dlng and me.cell_lng + v_dlng
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
        -- pace 30 · khung giờ 20 · mục tiêu 15 · mục đích 10 · cộng đồng 15 · khoảng cách 10
        (case when f.pace is null or v_my_pace is null then 12 else greatest(0, 30 - greatest(0, abs(f.pace - v_my_pace) - 20) * 30 / 70.0) end
         + least(20, 10 * cardinality(array(select unnest((f.ds).time_slots) intersect select unnest(s.time_slots))))
         + least(15, 8 * cardinality(array(select unnest((f.ds).goals) intersect select unnest(s.goals))))
         + case when 'BUDDY' = any((f.ds).purposes) and 'BUDDY' = any(s.purposes) then 10 else 3 end
         + least(15, 10 * least(f.clubs, 1) + 3 * f.mutual)
         + case when f.km < 2 then 10 when f.km < 5 then 8 when f.km < 10 then 5 else 2 end
         + (abs(hashtext(f.id::text || current_date::text)) % 5)) as score
        from f
    )
    select jsonb_build_object('items', coalesce(jsonb_agg(y.x order by y.rn), '[]'::jsonb),
      'total', (select count(*) from sc), 'nearby_total', (select count(*) from cand))
      from (
        select row_number() over (order by sc.score desc, sc.id) as rn, jsonb_build_object(
          'id', sc.id, 'name', private.first_name(sc.id),
          'avatar_url', (select avatar_url from public.profiles where id = sc.id),
          'level', (select level from public.profiles where id = sc.id),
          'km', private.shown_km(sc.km, v_uid, sc.id), 'area_label', (sc.o).area_label,
          'pace_s', sc.pace, 'goals', to_jsonb((sc.ds).goals), 'time_slots', to_jsonb((sc.ds).time_slots),
          'purposes', to_jsonb((sc.ds).purposes), 'bio', (sc.ds).bio, 'clubs', sc.clubs, 'mutual', sc.mutual,
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
            case when sc.mutual > 0 then 'MUTUAL' end], null))) as x
          from sc
      ) y(rn, x)
     where y.rn > v_offset and y.rn <= v_offset + 30
  );
end $$;

-- Buổi chạy công khai của CLB gần tôi (điểm hẹn là nơi công cộng → hiện km với 1 số lẻ)
create or replace function public.nearby_events(p_radius_km integer default 20) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  me public.runner_location_presence := (select x from public.runner_location_presence x where x.user_id = v_uid and x.expires_at > now());
begin
  if me.user_id is null then raise exception 'NO_PRESENCE'; end if;
  return (select coalesce(jsonb_agg(private.event_json(e, v_uid) || jsonb_build_object(
            'club_name', c.name, 'club_avatar', c.avatar_url,
            'km', round(private.cell_km(me.cell_lat, me.cell_lng, e.lat::numeric, e.lng::numeric), 1),
            'is_member', exists (select 1 from public.club_members m where m.club_id = e.club_id and m.user_id = v_uid and m.status = 'APPROVED'))
          order by e.starts_at), '[]'::jsonb)
            from public.club_events e join public.clubs c on c.id = e.club_id
           where e.visibility = 'PUBLIC' and e.status = 'SCHEDULED' and e.lat is not null
             and e.starts_at > now() - interval '1 hour' and e.starts_at < now() + interval '14 days'
             and private.cell_km(me.cell_lat, me.cell_lng, e.lat::numeric, e.lng::numeric) <= least(greatest(p_radius_km, 2), 50));
end $$;

create or replace function public.nearby_clubs(p_radius_km integer default 20) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  me public.runner_location_presence := (select x from public.runner_location_presence x where x.user_id = v_uid and x.expires_at > now());
begin
  if me.user_id is null then raise exception 'NO_PRESENCE'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url, 'accent_color', c.accent_color,
            'member_count', c.member_count, 'area_label', c.area_label, 'join_policy', c.join_policy,
            'km', round(private.cell_km(me.cell_lat, me.cell_lng, c.cell_lat, c.cell_lng)),
            'is_member', exists (select 1 from public.club_members m where m.club_id = c.id and m.user_id = v_uid and m.status = 'APPROVED'),
            'upcoming', (select count(*) from public.club_events e where e.club_id = c.id and e.visibility = 'PUBLIC' and e.status = 'SCHEDULED' and e.starts_at > now()))
          order by private.cell_km(me.cell_lat, me.cell_lng, c.cell_lat, c.cell_lng)), '[]'::jsonb)
            from public.clubs c
           where c.cell_lat is not null
             and private.cell_km(me.cell_lat, me.cell_lng, c.cell_lat, c.cell_lng) <= least(greatest(p_radius_km, 2), 50));
end $$;

-- ---------------------------------------------------------------------
-- 5. Kết nối
-- ---------------------------------------------------------------------
create or replace function public.send_connection(p_to uuid, p_message text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  s public.runner_discovery_settings := (select x from public.runner_discovery_settings x where x.user_id = v_uid);
  t public.runner_discovery_settings := (select x from public.runner_discovery_settings x where x.user_id = p_to);
  v_msg text := nullif(left(trim(coalesce(p_message, '')), 140), '');
  v_in public.runner_connection_requests := (select r from public.runner_connection_requests r where r.from_id = p_to and r.to_id = v_uid and r.status = 'PENDING');
  r public.runner_connection_requests;
begin
  if p_to = v_uid then raise exception 'INVALID_TARGET'; end if;
  if not coalesce(s.enabled, false) or s.suspended_at is not null then raise exception 'NEARBY_DISABLED'; end if;
  if t.user_id is null or not t.enabled or t.suspended_at is not null or not private.nearby_visible(v_uid, p_to, t.visible_to) then
    raise exception 'TARGET_UNAVAILABLE';
  end if;
  if private.is_blocked(v_uid, p_to) then raise exception 'TARGET_UNAVAILABLE'; end if;
  if private.are_connected(v_uid, p_to) then raise exception 'ALREADY_CONNECTED'; end if;
  if v_msg is not null and v_msg ~* '(https?://|www\.|\.com|\.vn|zalo|telegram|t\.me)' then raise exception 'NO_LINKS'; end if;
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
  insert into public.runner_connection_requests (from_id, to_id, message) values (v_uid, p_to, v_msg) returning * into r;
  perform private.notify(p_to, null, 'RUNNER_CONNECT', private.first_name(v_uid) || ' muốn kết nối chạy cùng bạn',
    coalesce(v_msg, 'Xem lời mời trong Quanh đây.'), '/nearby/connections', v_uid, true);
  return jsonb_build_object('id', r.id, 'status', r.status);
end $$;

create or replace function public.respond_connection(p_id uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  r public.runner_connection_requests := (select x from public.runner_connection_requests x where x.id = p_id);
begin
  if r.id is null or r.to_id <> v_uid then raise exception 'REQUEST_NOT_FOUND'; end if;
  if r.status <> 'PENDING' then raise exception 'REQUEST_CLOSED'; end if;
  if upper(p_action) = 'ACCEPT' then
    if private.is_blocked(r.from_id, r.to_id) then raise exception 'TARGET_UNAVAILABLE'; end if;
    update public.runner_connection_requests set status = 'ACCEPTED', responded_at = now() where id = r.id;
    insert into public.runner_connections (user_a, user_b) values (least(r.from_id, r.to_id), greatest(r.from_id, r.to_id)) on conflict do nothing;
    perform private.notify(r.from_id, null, 'RUNNER_CONNECTED', private.first_name(v_uid) || ' đã chấp nhận kết nối',
      'Rủ nhau một buổi chạy nhé!', '/nearby/connections', v_uid, true);
    return jsonb_build_object('id', r.id, 'status', 'ACCEPTED');
  elsif upper(p_action) = 'DECLINE' then
    update public.runner_connection_requests set status = 'DECLINED', responded_at = now() where id = r.id;
    return jsonb_build_object('id', r.id, 'status', 'DECLINED');
  end if;
  raise exception 'INVALID_ACTION';
end $$;

create or replace function public.cancel_connection_request(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update public.runner_connection_requests set status = 'CANCELLED', responded_at = now()
   where id = p_id and from_id = private.require_uid() and status = 'PENDING'
$$;

create or replace function public.remove_connection(p_user uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.runner_connections where user_a = least(private.require_uid(), p_user) and user_b = greatest(private.require_uid(), p_user)
$$;

create or replace function private.person_json(p_user uuid, p_viewer uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'name', case when private.are_connected(p_user, p_viewer) then p.display_name else private.first_name(p.id) end,
    'avatar_url', p.avatar_url, 'level', p.level,
    'pace_s', case when coalesce((select share_pace from public.runner_discovery_settings where user_id = p.id), false) then private.typical_pace(p.id) end,
    'goals', coalesce((select to_jsonb(goals) from public.runner_discovery_settings where user_id = p.id), '[]'::jsonb),
    'time_slots', coalesce((select to_jsonb(time_slots) from public.runner_discovery_settings where user_id = p.id), '[]'::jsonb),
    'bio', (select bio from public.runner_discovery_settings where user_id = p.id))
    from public.profiles p where p.id = p_user
$$;

create or replace function public.my_connections() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  return jsonb_build_object(
    'connections', (select coalesce(jsonb_agg(private.person_json(case when c.user_a = v_uid then c.user_b else c.user_a end, v_uid)
                       || jsonb_build_object('since', c.created_at) order by c.created_at desc), '[]'::jsonb)
                      from public.runner_connections c where (c.user_a = v_uid or c.user_b = v_uid)
                       and not private.is_blocked(c.user_a, c.user_b)),
    'incoming', (select coalesce(jsonb_agg(private.person_json(r.from_id, v_uid) || jsonb_build_object('request_id', r.id, 'message', r.message, 'at', r.created_at)
                    order by r.created_at desc), '[]'::jsonb)
                   from public.runner_connection_requests r where r.to_id = v_uid and r.status = 'PENDING' and not private.is_blocked(r.from_id, v_uid)),
    'outgoing', (select coalesce(jsonb_agg(private.person_json(r.to_id, v_uid) || jsonb_build_object('request_id', r.id, 'message', r.message, 'at', r.created_at)
                    order by r.created_at desc), '[]'::jsonb)
                   from public.runner_connection_requests r where r.from_id = v_uid and r.status = 'PENDING'),
    'blocked', (select coalesce(jsonb_agg(jsonb_build_object('id', b.blocked, 'name', private.first_name(b.blocked), 'at', b.created_at) order by b.created_at desc), '[]'::jsonb)
                  from public.user_blocks b where b.blocker = v_uid));
end $$;

-- "Rủ chạy": mời người đã kết nối vào buổi chạy công khai / sự kiện CLB mình tham gia, hoặc vào CLB của mình
create or replace function public.invite_to_run(p_user uuid, p_event_id uuid default null, p_club_id uuid default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  e public.club_events;
  v_note text := nullif(left(trim(coalesce(p_note, '')), 140), '');
begin
  if not private.are_connected(v_uid, p_user) or private.is_blocked(v_uid, p_user) then raise exception 'NOT_CONNECTED'; end if;
  if (select count(*) from public.notifications n where n.actor_id = v_uid and n.kind = 'RUNNER_INVITE' and n.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'TOO_MANY_REQUESTS';
  end if;
  if p_event_id is not null then
    e := (select x from public.club_events x where x.id = p_event_id);
    if e.id is null or e.status <> 'SCHEDULED' or e.starts_at < now() then raise exception 'EVENT_NOT_FOUND'; end if;
    if e.visibility <> 'PUBLIC' and not exists (select 1 from public.club_members m where m.club_id = e.club_id and m.user_id = p_user and m.status = 'APPROVED') then
      raise exception 'EVENT_NOT_PUBLIC';
    end if;
    perform private.notify(p_user, e.club_id, 'RUNNER_INVITE', private.first_name(v_uid) || ' rủ bạn chạy: ' || e.title,
      coalesce(v_note, to_char(e.starts_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM') || coalesce(' · ' || e.location_name, '')),
      case when e.visibility = 'PUBLIC' then '/nearby/events/' || e.id else '/clubs/' || e.club_id || '/events/' || e.id end, v_uid, true);
  elsif p_club_id is not null then
    if not exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = v_uid and m.status = 'APPROVED') then raise exception 'FORBIDDEN'; end if;
    perform private.notify(p_user, p_club_id, 'RUNNER_INVITE', private.first_name(v_uid) || ' rủ bạn vào CLB ' || (select name from public.clubs where id = p_club_id),
      v_note, '/clubs/' || p_club_id, v_uid, true);
  else
    raise exception 'INVALID_INVITE';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. Chặn / báo cáo
-- ---------------------------------------------------------------------
create or replace function public.block_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  if p_user = v_uid then raise exception 'INVALID_TARGET'; end if;
  insert into public.user_blocks (blocker, blocked) values (v_uid, p_user) on conflict do nothing;
  delete from public.runner_connections where user_a = least(v_uid, p_user) and user_b = greatest(v_uid, p_user);
  update public.runner_connection_requests set status = 'CANCELLED', responded_at = now()
   where status = 'PENDING' and ((from_id = v_uid and to_id = p_user) or (from_id = p_user and to_id = v_uid));
end $$;

create or replace function public.unblock_user(p_user uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.user_blocks where blocker = private.require_uid() and blocked = p_user
$$;

create or replace function public.report_user(p_user uuid, p_reason text, p_note text default null, p_context text default 'NEARBY') returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  if p_user = v_uid then raise exception 'INVALID_TARGET'; end if;
  if upper(p_reason) not in ('SPAM', 'HARASSMENT', 'FAKE', 'UNSAFE', 'OTHER') then raise exception 'INVALID_REASON'; end if;
  if exists (select 1 from public.user_reports r where r.reporter = v_uid and r.target = p_user and r.status = 'OPEN') then return; end if;
  insert into public.user_reports (reporter, target, context, reason, note)
  values (v_uid, p_user, coalesce(upper(p_context), 'NEARBY'), upper(p_reason), nullif(left(trim(coalesce(p_note, '')), 500), ''));
  -- 3 người khác nhau cùng báo cáo → tự ẩn khỏi Quanh đây chờ admin
  if (select count(distinct r.reporter) from public.user_reports r where r.target = p_user and r.status = 'OPEN') >= 3 then
    update public.runner_discovery_settings set suspended_at = coalesce(suspended_at, now()) where user_id = p_user;
    delete from public.runner_location_presence where user_id = p_user;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 7. CLB: điểm tập, sự kiện công khai, người ngoài đăng ký
-- ---------------------------------------------------------------------
create or replace function public.set_club_location(p_club_id uuid, p_lat double precision, p_lng double precision, p_area text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.club_is_staff(p_club_id) and not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  if p_lat is null then
    update public.clubs set cell_lat = null, cell_lng = null, area_label = null where id = p_club_id;
    return;
  end if;
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'INVALID_LOCATION'; end if;
  update public.clubs set cell_lat = round(p_lat::numeric, 2), cell_lng = round(p_lng::numeric, 2),
    area_label = nullif(left(trim(coalesce(p_area, '')), 60), '') where id = p_club_id;
end $$;

-- Vị trí CLB hiện tại (ban quản trị xem để sửa; người khác chỉ thấy km qua nearby_clubs)
create or replace function public.club_place(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.clubs := (select x from public.clubs x where x.id = p_club_id);
begin
  if c.id is null then raise exception 'CLUB_NOT_FOUND'; end if;
  if not public.club_is_staff(c.id) and not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object('area_label', c.area_label, 'lat', c.cell_lat, 'lng', c.cell_lng);
end $$;

create or replace function public.set_club_event_visibility(p_event_id uuid, p_visibility text) returns void
language plpgsql security definer set search_path = public as $$
declare e public.club_events := (select x from public.club_events x where x.id = p_event_id);
begin
  if e.id is null then raise exception 'EVENT_NOT_FOUND'; end if;
  if not public.club_is_staff(e.club_id) and not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  if upper(p_visibility) not in ('CLUB', 'PUBLIC') then raise exception 'INVALID_VISIBILITY'; end if;
  if upper(p_visibility) = 'PUBLIC' and e.lat is null then raise exception 'EVENT_NEEDS_LOCATION'; end if;
  update public.club_events set visibility = upper(p_visibility) where id = e.id;
end $$;

-- Đăng ký buổi chạy công khai (không cần là thành viên CLB)
create or replace function public.rsvp_public_event(p_event_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  e public.club_events := (select x from public.club_events x where x.id = p_event_id);
begin
  if e.id is null or e.visibility <> 'PUBLIC' then raise exception 'EVENT_NOT_FOUND'; end if;
  if p_status not in ('GOING', 'MAYBE', 'NOT_GOING') then raise exception 'INVALID_STATUS'; end if;
  if e.status = 'CANCELLED' then raise exception 'EVENT_CANCELLED'; end if;
  if now() > e.starts_at + make_interval(mins => e.duration_min) then raise exception 'EVENT_ENDED'; end if;
  if p_status = 'GOING' and e.capacity is not null
     and (select count(*) from public.club_event_rsvps where event_id = e.id and status = 'GOING' and user_id <> v_uid) >= e.capacity then
    raise exception 'EVENT_FULL';
  end if;
  insert into public.club_event_rsvps (event_id, user_id, status) values (e.id, v_uid, p_status)
  on conflict (event_id, user_id) do update set status = excluded.status, updated_at = now();
  return private.event_json(e, v_uid);
end $$;

-- Sự kiện CLB: kèm chế độ công khai
create or replace function private.event_json(e public.club_events, p_uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', e.id, 'club_id', e.club_id, 'title', e.title, 'description', e.description, 'starts_at', e.starts_at,
    'ends_at', e.starts_at + make_interval(mins => e.duration_min), 'duration_min', e.duration_min,
    'location_name', e.location_name, 'lat', e.lat, 'lng', e.lng, 'distance_km', e.distance_km, 'pace_text', e.pace_text,
    'capacity', e.capacity, 'status', e.status, 'visibility', e.visibility, 'cancel_reason', e.cancel_reason,
    'created_by', e.created_by, 'creator_name', (select display_name from public.profiles where id = e.created_by),
    'going_count', (select count(*) from public.club_event_rsvps r where r.event_id = e.id and r.status = 'GOING'),
    'maybe_count', (select count(*) from public.club_event_rsvps r where r.event_id = e.id and r.status = 'MAYBE'),
    'checked_in_count', (select count(*) from public.club_event_rsvps r where r.event_id = e.id and r.checked_in_at is not null),
    'my_status', (select r.status from public.club_event_rsvps r where r.event_id = e.id and r.user_id = p_uid),
    'my_checked_in_at', (select r.checked_in_at from public.club_event_rsvps r where r.event_id = e.id and r.user_id = p_uid))
$$;

-- Chi tiết sự kiện: người ngoài CLB xem được sự kiện CÔNG KHAI (không kèm danh sách người tham gia)
create or replace function public.club_event(p_event_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e public.club_events := (select x from public.club_events x where x.id = p_event_id);
  v_uid uuid := private.require_uid();
  v_member boolean;
begin
  if e.id is null then raise exception 'EVENT_NOT_FOUND'; end if;
  v_member := exists (select 1 from public.club_members m where m.club_id = e.club_id and m.user_id = v_uid and m.status = 'APPROVED');
  if not v_member and e.visibility <> 'PUBLIC' and not public.is_system_admin() then
    perform private.require_member(e.club_id);
  end if;
  return private.event_json(e, v_uid) || jsonb_build_object(
    'is_member', v_member,
    'club_name', (select c.name from public.clubs c where c.id = e.club_id),
    'club_avatar', (select c.avatar_url from public.clubs c where c.id = e.club_id),
    'can_manage', public.club_is_staff(e.club_id),
    'checkin_open', e.status = 'SCHEDULED' and now() between e.starts_at - interval '2 hours'
                                                          and e.starts_at + make_interval(mins => e.duration_min) + interval '2 hours',
    'attendees', case when v_member or public.is_system_admin() then (select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', r.user_id, 'display_name', p.display_name, 'avatar_url', p.avatar_url, 'status', r.status,
        'checked_in_at', r.checked_in_at, 'checkin_method', r.checkin_method)
        order by (r.checked_in_at is null), r.status, p.display_name), '[]'::jsonb)
      from public.club_event_rsvps r join public.profiles p on p.id = r.user_id
     where r.event_id = e.id and r.status <> 'NOT_GOING') else '[]'::jsonb end);
end $$;

-- ---------------------------------------------------------------------
-- 8. Quản trị báo cáo
-- ---------------------------------------------------------------------
create or replace function public.admin_list_reports(p_status text default 'OPEN') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'reporter', r.reporter, 'reporter_name', private.display_name(r.reporter),
            'target', r.target, 'target_name', private.display_name(r.target), 'context', r.context, 'reason', r.reason, 'note', r.note,
            'status', r.status, 'resolution', r.resolution, 'created_at', r.created_at, 'resolved_at', r.resolved_at,
            'target_reports', (select count(distinct x.reporter) from public.user_reports x where x.target = r.target),
            'target_suspended', exists (select 1 from public.runner_discovery_settings s where s.user_id = r.target and s.suspended_at is not null))
          order by r.created_at desc), '[]'::jsonb)
            from public.user_reports r where upper(coalesce(p_status, 'ALL')) = 'ALL' or r.status = upper(p_status));
end $$;

-- p_action: DISMISS (không vi phạm, gỡ ẩn) | SUSPEND (khoá Quanh đây) | BAN (khoá tài khoản — dùng admin_set_user_ban)
create or replace function public.admin_resolve_report(p_id uuid, p_action text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  r public.user_reports := (select x from public.user_reports x where x.id = p_id);
begin
  if r.id is null then raise exception 'REPORT_NOT_FOUND'; end if;
  if upper(p_action) = 'DISMISS' then
    update public.user_reports set status = 'DISMISSED', resolution = coalesce(nullif(trim(p_note), ''), 'Không vi phạm'), resolved_by = v_admin, resolved_at = now()
     where target = r.target and status = 'OPEN';
    update public.runner_discovery_settings set suspended_at = null where user_id = r.target;
  elsif upper(p_action) = 'SUSPEND' then
    update public.user_reports set status = 'RESOLVED', resolution = coalesce(nullif(trim(p_note), ''), 'Khoá Quanh đây'), resolved_by = v_admin, resolved_at = now()
     where target = r.target and status = 'OPEN';
    insert into public.runner_discovery_settings (user_id, enabled, suspended_at) values (r.target, false, now())
    on conflict (user_id) do update set enabled = false, suspended_at = now();
    delete from public.runner_location_presence where user_id = r.target;
  else
    raise exception 'INVALID_ACTION';
  end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_admin, 'USER_REPORT_' || upper(p_action), 'profile:' || r.target, jsonb_build_object('report', r.id, 'note', p_note));
end $$;

-- Việc cần xử lý: + báo cáo người dùng
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
    'errors', (select count(distinct e.code) from private.client_errors e where e.last_at > now() - interval '24 hours'),
    'new_users_7d', (select count(*) from public.profiles p where p.created_at > now() - interval '7 days'),
    'active_7d', (select count(distinct a.user_id) from public.activities a where a.started_at > now() - interval '7 days'),
    'banned', (select count(*) from public.profiles p where p.banned_at is not null));
end $$;

-- ---------------------------------------------------------------------
-- 9. Quyền
-- ---------------------------------------------------------------------
revoke all on function private.nearby_consent_version(), private.valid_runs(uuid), private.nearby_eligible(uuid), private.typical_pace(uuid),
  private.is_blocked(uuid, uuid), private.are_connected(uuid, uuid), private.share_club(uuid, uuid), private.nearby_visible(uuid, uuid, text),
  private.cell_km(numeric, numeric, numeric, numeric), private.shown_km(numeric, uuid, uuid), private.first_name(uuid), private.person_json(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.my_discovery(), public.set_discovery(jsonb), public.set_presence(double precision, double precision, text, text, integer),
  public.clear_presence(), public.nearby_runners(jsonb), public.nearby_events(integer), public.nearby_clubs(integer),
  public.send_connection(uuid, text), public.respond_connection(uuid, text), public.cancel_connection_request(uuid), public.remove_connection(uuid),
  public.my_connections(), public.invite_to_run(uuid, uuid, uuid, text), public.block_user(uuid), public.unblock_user(uuid),
  public.report_user(uuid, text, text, text), public.set_club_location(uuid, double precision, double precision, text),
  public.set_club_event_visibility(uuid, text), public.club_place(uuid), public.rsvp_public_event(uuid, text), public.admin_list_reports(text),
  public.admin_resolve_report(uuid, text, text) from public, anon;
grant execute on function public.my_discovery(), public.set_discovery(jsonb), public.set_presence(double precision, double precision, text, text, integer),
  public.clear_presence(), public.nearby_runners(jsonb), public.nearby_events(integer), public.nearby_clubs(integer),
  public.send_connection(uuid, text), public.respond_connection(uuid, text), public.cancel_connection_request(uuid), public.remove_connection(uuid),
  public.my_connections(), public.invite_to_run(uuid, uuid, uuid, text), public.block_user(uuid), public.unblock_user(uuid),
  public.report_user(uuid, text, text, text), public.set_club_location(uuid, double precision, double precision, text),
  public.set_club_event_visibility(uuid, text), public.club_place(uuid), public.rsvp_public_event(uuid, text), public.admin_list_reports(text),
  public.admin_resolve_report(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
