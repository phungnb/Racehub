-- =====================================================================
-- 001900 — Chi tiết bài chạy (GM-10): tuyến chạy, từng km, nhịp tim, so sánh
--
-- activity_details: dữ liệu "nặng" tách khỏi bảng activities
--   · polyline  : tuyến chạy mã hóa (Google polyline) — từ Strava; bài GPS trong app dùng activity_track_points
--   · splits    : từng km [{distance_m, moving_s, elev_m, hr}] — Strava splits_metric
--   · detailed  : đã lấy bản chi tiết (GET /activities/:id) chưa; bản tóm tắt chỉ có polyline rút gọn
-- Quyền riêng tư: xem bài theo can_view_activities, xem bản đồ theo can_view_map (chủ bài luôn xem được).
--
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT.
-- =====================================================================

create table if not exists public.activity_details (
  activity_id uuid primary key references public.activities(id) on delete cascade,
  polyline text check (polyline is null or char_length(polyline) <= 200000),
  splits jsonb check (splits is null or jsonb_typeof(splits) = 'array'),
  max_heartrate numeric,
  avg_cadence numeric,
  calories numeric,
  start_lat numeric,
  start_lng numeric,
  detailed boolean not null default false,
  fetched_at timestamptz not null default now()
);
alter table public.activity_details enable row level security;
-- Không có policy: chỉ đọc qua RPC activity_detail (đã kiểm tra quyền riêng tư)
revoke all on public.activity_details from anon, authenticated;

-- ---------------------------------------------------------------------
-- Ghi (service_role: đồng bộ Strava, webhook, route làm giàu dữ liệu)
-- ---------------------------------------------------------------------
create or replace function public.save_activity_detail(p_source text, p_external_id text, p_detail jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := (select a.id from public.activities a where a.source = p_source and a.source_activity_id = p_external_id);
  v_detailed boolean := coalesce((p_detail->>'detailed')::boolean, false);
  v_splits jsonb := case when jsonb_typeof(p_detail->'splits') = 'array' and jsonb_array_length(p_detail->'splits') > 0
                         then p_detail->'splits' end;
begin
  if v_id is null then return null; end if;
  insert into public.activity_details (activity_id, polyline, splits, max_heartrate, avg_cadence, calories, start_lat, start_lng, detailed, fetched_at)
  values (v_id, nullif(p_detail->>'polyline', ''), v_splits, (p_detail->>'max_heartrate')::numeric, (p_detail->>'avg_cadence')::numeric,
          (p_detail->>'calories')::numeric, (p_detail->>'start_lat')::numeric, (p_detail->>'start_lng')::numeric, v_detailed, now())
  on conflict (activity_id) do update set
    -- Bản tóm tắt (danh sách) không được ghi đè bản chi tiết đã có
    polyline = case when excluded.detailed or public.activity_details.polyline is null
                    then coalesce(excluded.polyline, public.activity_details.polyline) else public.activity_details.polyline end,
    splits = coalesce(excluded.splits, public.activity_details.splits),
    max_heartrate = coalesce(excluded.max_heartrate, public.activity_details.max_heartrate),
    avg_cadence = coalesce(excluded.avg_cadence, public.activity_details.avg_cadence),
    calories = coalesce(excluded.calories, public.activity_details.calories),
    start_lat = coalesce(excluded.start_lat, public.activity_details.start_lat),
    start_lng = coalesce(excluded.start_lng, public.activity_details.start_lng),
    detailed = public.activity_details.detailed or excluded.detailed,
    fetched_at = now();
  return v_id;
end $$;

-- Route làm giàu dữ liệu cần biết bài của ai + mã Strava (chỉ service_role)
create or replace function public.activity_source_ref(p_activity_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('user_id', a.user_id, 'source', a.source, 'external_id', a.source_activity_id,
                            'detailed', coalesce(d.detailed, false), 'fetched_at', d.fetched_at)
    from public.activities a left join public.activity_details d on d.activity_id = a.id
   where a.id = p_activity_id
$$;

-- ---------------------------------------------------------------------
-- Đọc: chi tiết một bài chạy
-- ---------------------------------------------------------------------
create or replace function public.activity_detail(p_activity_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  a public.activities := (select x from public.activities x where x.id = p_activity_id);
  d public.activity_details := (select x from public.activity_details x where x.activity_id = p_activity_id);
  v_mine boolean;
  v_map boolean;
begin
  if a.id is null or coalesce(a.status, '') = 'DELETED' then raise exception 'ACTIVITY_NOT_FOUND'; end if;
  v_mine := a.user_id = v_uid;
  if not v_mine and not (public.can_view_activities(a.user_id) and public.activity_is_countable(a.status, a.validation_status)) then
    raise exception 'ACTIVITY_NOT_FOUND';
  end if;
  v_map := v_mine or public.can_view_map(a.user_id);

  return jsonb_build_object(
    'id', a.id, 'title', a.title, 'source', a.source, 'sport_type', a.sport_type, 'device_name', a.device_name,
    'started_at', a.started_at, 'distance_m', coalesce(a.moving_distance_m, a.distance_m, 0),
    'moving_s', coalesce(a.moving_time_s, a.elapsed_time_s, 0), 'elapsed_s', coalesce(a.elapsed_time_s, 0),
    'avg_pace_s', a.avg_pace_s, 'elevation_gain_m', coalesce(a.elevation_gain_m, 0),
    'avg_heartrate', a.avg_heartrate, 'max_heartrate', d.max_heartrate, 'avg_cadence', d.avg_cadence, 'calories', d.calories,
    'validation_status', a.validation_status,
    'validation_reason', case when v_mine then a.validation_reason end,
    'earned_xu', a.earned_xu, 'earned_xp', a.earned_xp,
    'is_mine', v_mine,
    'owner', (select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url, 'level', p.level)
                from public.profiles p where p.id = a.user_id),
    'map_allowed', v_map,
    'polyline', case when v_map then d.polyline end,
    -- Bài GPS trong app: điểm GPS rút gọn ≤ ~1000 điểm [lat, lng, giây kể từ lúc bắt đầu, độ cao]
    'points', case when v_map and d.polyline is null then (
        select jsonb_agg(jsonb_build_array(s.latitude, s.longitude,
                 round(extract(epoch from (s.recorded_at - a.started_at))), s.altitude) order by s.sequence)
          from (select t.latitude, t.longitude, t.recorded_at, t.altitude, t.sequence,
                       row_number() over (order by t.sequence) as rn, count(*) over () as cnt
                  from public.activity_track_points t where t.activity_id = a.id) s
         where s.rn % greatest(ceil(s.cnt / 1000.0)::int, 1) = 0 or s.rn = s.cnt) end,
    'splits', d.splits,
    'needs_detail', v_mine and a.source = 'STRAVA' and not coalesce(d.detailed, false),
    'challenges', case when v_mine then (
        select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'counted_m', e.counted_m) order by e.created_at), '[]'::jsonb)
          from public.challenge_progress_events e join public.challenges c on c.id = e.challenge_id
         where e.activity_id = a.id) else '[]'::jsonb end,
    'cheers', (select jsonb_build_object('count', count(*), 'total', coalesce(sum(ch.amount), 0))
                 from public.cheers ch where ch.activity_id = a.id),
    -- So với 10 bài trước đó của chính người chạy (để hiện "dài hơn / nhanh hơn thường lệ")
    'compare', (select jsonb_build_object(
          'runs', count(*),
          'avg_distance_m', round(avg(coalesce(x.moving_distance_m, x.distance_m))),
          'avg_pace_s', round(avg(x.avg_pace_s) filter (where x.avg_pace_s > 0)),
          'longest_30d', coalesce(a.distance_m >= (select max(y.distance_m) from public.activities y
                              where y.user_id = a.user_id and y.id <> a.id and public.activity_is_countable(y.status, y.validation_status)
                                and y.started_at > a.started_at - interval '30 days' and y.started_at <= a.started_at), true))
        from (select z.*, row_number() over (order by z.started_at desc) as rn
                from public.activities z
               where z.user_id = a.user_id and z.id <> a.id and z.started_at < a.started_at
                 and public.activity_is_countable(z.status, z.validation_status)) x
       where x.rn <= 10)
  );
end $$;

revoke all on function public.save_activity_detail(text, text, jsonb), public.activity_source_ref(uuid) from public, anon, authenticated;
grant execute on function public.save_activity_detail(text, text, jsonb), public.activity_source_ref(uuid) to service_role;
revoke all on function public.activity_detail(uuid) from public, anon;
grant execute on function public.activity_detail(uuid) to authenticated;

notify pgrst, 'reload schema';
