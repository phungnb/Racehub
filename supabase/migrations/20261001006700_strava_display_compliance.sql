-- 006700: Tuân thủ Thoả thuận API Strava (hiệu lực 11/11/2024): dữ liệu Strava của một người chỉ được hiển thị cho
-- CHÍNH người đó trong app bên thứ ba. Bài đồng bộ từ Strava: người khác chỉ thấy số tổng (quãng đường, thời gian, pace)
-- — ẩn bản đồ tuyến, từng km, nhịp tim, nhịp bước, calo, thiết bị. Chủ bài vẫn xem đầy đủ.
-- Bài ghi bằng app RaceHub / nhập tay không bị ảnh hưởng. Chạy lại nhiều lần vẫn an toàn.
-- Còn lại cần chủ sản phẩm quyết định (xem docs/RUI_RO_VA_PHONG_NGUA.md): quãng đường Strava trên BXH / bảng tin CLB.

create or replace function public.activity_detail(p_activity_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  a public.activities := (select x from public.activities x where x.id = p_activity_id);
  d public.activity_details := (select x from public.activity_details x where x.activity_id = p_activity_id);
  v_mine boolean;
  v_map boolean;
  -- Bài đồng bộ từ Strava, người xem không phải chủ bài → chỉ số tổng, không chi tiết (API Agreement Strava 11/2024)
  v_strava_other boolean;
begin
  if a.id is null or coalesce(a.status, '') = 'DELETED' then raise exception 'ACTIVITY_NOT_FOUND'; end if;
  v_mine := a.user_id = v_uid;
  if not v_mine and not (public.can_view_activities(a.user_id) and public.activity_is_countable(a.status, a.validation_status)) then
    raise exception 'ACTIVITY_NOT_FOUND';
  end if;
  v_strava_other := not v_mine and a.source = 'STRAVA';
  v_map := v_mine or (not v_strava_other and public.can_view_map(a.user_id));

  return jsonb_build_object(
    'id', a.id, 'title', a.title, 'source', a.source, 'sport_type', a.sport_type, 'device_name', case when not v_strava_other then a.device_name end,
    'started_at', a.started_at, 'distance_m', coalesce(a.moving_distance_m, a.distance_m, 0),
    'moving_s', coalesce(a.moving_time_s, a.elapsed_time_s, 0), 'elapsed_s', coalesce(a.elapsed_time_s, 0),
    'avg_pace_s', a.avg_pace_s, 'elevation_gain_m', coalesce(a.elevation_gain_m, 0),
    'avg_heartrate', case when not v_strava_other then a.avg_heartrate end,
    'max_heartrate', case when not v_strava_other then d.max_heartrate end,
    'avg_cadence', case when not v_strava_other then d.avg_cadence end,
    'calories', case when not v_strava_other then d.calories end,
    'strava_limited', v_strava_other,
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
    'splits', case when not v_strava_other then d.splits end,
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

revoke all on function public.activity_detail(uuid) from public, anon;
grant execute on function public.activity_detail(uuid) to authenticated;

notify pgrst, 'reload schema';
