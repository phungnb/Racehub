-- 013400: Chỉnh sửa lần 7 — luật bài đồng bộ từ đối tác (Strava / Garmin / COROS), Phụng chốt 06/10/2026:
--   "Luật GPS nhảy nếu Strava có GPS (mặc dù nhảy) thì RaceHub vẫn ghi nhận; chỉ không ghi nhận trường hợp nhập tay;
--    cảnh báo chạy máy (hoàn toàn không có GPS)".
-- Góp ý: "Bài GPS nhảy được ghi nhận ngay: hiện tại cập nhật xong nhưng BQT vẫn phải duyệt". Nguyên nhân (sau 013100 / lần 6):
--   • fraud.ts: dấu hiệu tốc độ (PACE_CURVE, VEHICLE_BURST…) do GPS trôi trải vài điểm chỉ bị hạ MỘT mức (DISQUALIFY → SUSPECT
--     vẫn chờ duyệt), và GPS_TELEPORT / GPS_DISTANCE_GAIN vẫn được đếm là một "cảnh báo độc lập" (+ 1 cảnh báo khác = chờ duyệt).
--     Sửa ở bộ phân tích (ac-2026.10.7): dấu hiệu do GPS nhảy chỉ còn là cảnh báo, không bao giờ giữ bài.
--   • SQL (bản này): pace TB tính trên km Strava ĐÃ cộng cú nhảy → "nhanh hơn kỷ lục" → chờ duyệt; "vận tốc tối đa" một điểm
--     (bài không có phân tích) → chờ duyệt. Nay: kiểm pace theo quãng đường đã bỏ cú nhảy; vận tốc tối đa chỉ là cảnh báo.
-- 1. ingest_provider_activity: nhập tay → REJECTED "Bài nhập tay không được ghi nhận." (không km / thử thách / BXH / Xu);
--    chạy máy / không có GPS → APPROVED + cảnh báo TREADMILL; GPS nhảy → APPROVED + cảnh báo. Km của đối tác giữ nguyên.
--    Bài đã nhập trước 013400 KHÔNG bị xét lại (bài đang chờ duyệt vẫn do ban quản trị quyết định).
-- 2. restore_activity: không khôi phục bài nhập tay của đối tác (MANUAL_NOT_COUNTED); rejected_activities trả thêm 'manual'.
-- 3. warned_activities(): "Bài có cảnh báo" — bài ĐÃ ghi nhận nhưng có cảnh báo (GPS nhảy, chạy máy…) cho admin hệ thống
--    (p_club_id null) và Ban quản trị CLB (chỉ bài của thành viên CLB mình).
-- Giữ nguyên chữ ký các hàm cũ. Cần 013100. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT,
-- không RETURNING INTO. Chạy lại an toàn.

-- ---------------------------------------------------------------------
-- 1. Nhập bài từ đối tác (bản 012600 + luật lần 7)
-- ---------------------------------------------------------------------
create or replace function public.ingest_provider_activity(
  p_user_id uuid, p_source text, p_external_id text, p_activity jsonb
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  cfg jsonb := private.economy_config();
  v_sport text := coalesce(p_activity->>'sport_type', 'Run');
  v_started timestamptz := (p_activity->>'started_at')::timestamptz;
  v_elapsed integer := greatest(coalesce((p_activity->>'elapsed_s')::numeric, 0), 0)::integer;
  v_moving integer := greatest(coalesce((p_activity->>'moving_s')::numeric, 0), 0)::integer;
  v_distance numeric := greatest(coalesce((p_activity->>'distance_m')::numeric, 0), 0);
  v_max_speed numeric := (p_activity->>'max_speed_mps')::numeric;
  v_manual boolean := coalesce((p_activity->>'manual')::boolean, false);
  v_has_gps boolean := coalesce((p_activity->>'has_gps')::boolean, true);
  v_ended timestamptz;
  v_pace integer;
  v_connected_at timestamptz;
  v_status text := 'APPROVED';
  v_reason text := 'Hợp lệ (đồng bộ tự động).';
  v_history_only boolean := false;
  v_existing public.activities%rowtype;
  v_id uuid;
  a public.activities%rowtype;
  v_level text;
  v_score integer := 0;
  v_risk jsonb := case when jsonb_typeof(p_activity->'risk') = 'object' then p_activity->'risk' end;
  -- 013400: cảnh báo lưu kèm bài (risk.flags của bộ phân tích + cảnh báo máy chủ tự thêm: chạy máy, vận tốc tối đa một điểm)
  v_flags jsonb := case when jsonb_typeof(p_activity->'risk'->'flags') = 'array' then p_activity->'risk'->'flags' else '[]'::jsonb end;
  -- Quãng đường đã bỏ cú nhảy / đoạn trôi GPS (bộ phân tích, chỉ để kiểm pace TB — km của đối tác KHÔNG đổi)
  v_clean numeric := case when jsonb_typeof(p_activity->'analysis') = 'object' then nullif((p_activity->'analysis'->>'clean_distance_m')::numeric, 0) end;
  v_check_pace integer;
  v_no_gps boolean;
begin
  if p_source not in ('STRAVA', 'GARMIN', 'COROS') then raise exception 'INVALID_SOURCE'; end if;
  if p_external_id is null or v_started is null then raise exception 'INVALID_ACTIVITY'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then raise exception 'USER_NOT_FOUND'; end if;

  -- Đã có → chỉ cập nhật tiêu đề (Strava gửi aspect "update" khi đổi tên)
  v_existing := (select x from public.activities x where x.source = p_source and x.source_activity_id = p_external_id);
  if v_existing.id is not null then
    if v_existing.user_id <> p_user_id then raise exception 'ACTIVITY_OWNER_MISMATCH'; end if;
    update public.activities
       set title = left(coalesce(nullif(trim(p_activity->>'title'), ''), title), 120), updated_at = now()
     where id = v_existing.id and title is distinct from left(coalesce(nullif(trim(p_activity->>'title'), ''), title), 120);
    return jsonb_build_object('result', case when found then 'UPDATED' else 'DUPLICATE' end,
                              'activity_id', v_existing.id, 'validation_status', v_existing.validation_status);
  end if;

  -- Không phải chạy bộ / quá ngắn → bỏ qua, không lưu
  if v_sport not in ('Run', 'TrailRun', 'VirtualRun') then
    return jsonb_build_object('result', 'SKIPPED', 'reason', 'NOT_RUN');
  end if;
  if v_distance < 200 or v_moving <= 0 then
    return jsonb_build_object('result', 'SKIPPED', 'reason', 'TOO_SHORT');
  end if;
  if v_started > now() + interval '10 minutes' then
    return jsonb_build_object('result', 'SKIPPED', 'reason', 'FUTURE_START');
  end if;

  v_ended := v_started + make_interval(secs => greatest(v_elapsed, v_moving));
  -- 012600: km của đối tác (Strava…) giữ nguyên — cú nhảy GPS chỉ dùng để phân loại hợp lệ / nghi vấn (fraud.ts)
  v_pace := round(v_moving / (v_distance / 1000.0));
  -- 013400: pace TB "nhanh hơn kỷ lục" chỉ vì GPS nhảy cộng thêm km → kiểm theo quãng đường đã bỏ cú nhảy (nếu có phân tích)
  v_check_pace := case when v_has_gps and v_clean is not null and v_clean < v_distance
                       then round(v_moving / (v_clean / 1000.0)) else v_pace end;
  v_no_gps := v_sport = 'VirtualRun' or not v_has_gps;

  -- Cùng một buổi chạy đã được ghi từ nguồn khác (vd GPS trong app) → không tính 2 lần.
  -- 009900: trừ khi bài này dài hơn hẳn các bài trùng giờ đang được tính (vd đồng hồ ghi đủ 2 giờ, điện thoại chỉ ghi một đoạn)
  if exists (select 1 from public.activities
              where user_id = p_user_id and coalesce(status, '') <> 'DELETED'
                and started_at < v_ended and coalesce(ended_at, started_at) > v_started)
     and v_distance <= 1.1 * private.overlap_meters(private.overlap_ids(p_user_id, v_started, v_ended)) then
    return jsonb_build_object('result', 'SKIPPED', 'reason', 'OVERLAPS_EXISTING_ACTIVITY');
  end if;

  -- Luật hợp lệ — 013400, Chỉnh sửa lần 7 (Phụng chốt 06/10/2026): "GPS nhảy nếu Strava có GPS (mặc dù nhảy) thì RaceHub vẫn
  -- ghi nhận; chỉ không ghi nhận trường hợp nhập tay; cảnh báo chạy máy (hoàn toàn không có GPS)".
  -- Chỉ bài NGHI GIAN LẬN (dấu hiệu không do GPS nhảy) mới chờ duyệt; bài chạy chậm / đi bộ vẫn được ghi nhận ngay
  if v_manual or v_risk->>'verdict' = 'REJECT' then
    -- Nhập tay: không có dữ liệu thiết bị → KHÔNG ghi nhận (không km, thử thách, BXH, Xu). Lưu lại để người chạy thấy lý do.
    v_status := 'REJECTED';
    v_reason := 'Bài nhập tay không được ghi nhận.';
    if not v_flags @> '[{"code": "MANUAL"}]'::jsonb then
      v_flags := v_flags || jsonb_build_array(jsonb_build_object('code', 'MANUAL', 'severity', 'SEVERE', 'tier', 'DISQUALIFY',
                   'message', 'Bài nhập tay không được ghi nhận'));
    end if;
  elsif v_check_pace < (cfg->>'minValidPace')::numeric * 60 then
    v_status := 'PENDING'; v_level := 'HIGH'; v_score := 75;
    v_reason := 'Pace trung bình ' || (v_check_pace / 60) || ':' || lpad((v_check_pace % 60)::text, 2, '0') || '/km — nhanh hơn kỷ lục thế giới.';
  -- 012400: "vận tốc tối đa" của Strava là MỘT điểm (hay do GPS nhảy). 013400: bài có GPS → ghi nhận, chỉ cảnh báo
  -- (có risk thì bộ phân tích — cửa sổ trượt + đường cong pace, fraud.ts — đã xét)
  elsif v_risk is null and not v_no_gps and v_max_speed is not null and v_max_speed > 12 then
    v_flags := v_flags || jsonb_build_array(jsonb_build_object('code', 'VEHICLE_BURST', 'severity', 'HIGH', 'tier', 'WARN', 'gpsJump', true,
                 'message', 'Vận tốc tối đa một điểm ' || round(v_max_speed * 3.6) || ' km/h (GPS nhảy) — bài vẫn được ghi nhận'));
  end if;
  -- Chạy máy / hoàn toàn không có GPS → vẫn ghi nhận, kèm cảnh báo cho ban quản trị (trước 013400: chờ duyệt)
  if v_status <> 'REJECTED' and v_no_gps then
    if not v_flags @> '[{"code": "TREADMILL"}]'::jsonb then
      v_flags := v_flags || jsonb_build_array(jsonb_build_object('code', 'TREADMILL', 'severity', 'HIGH', 'tier', 'WARN',
                   'message', case when v_sport = 'VirtualRun' then 'Chạy máy / chạy ảo — không có tuyến GPS để đối chiếu; bài vẫn được ghi nhận'
                                   else 'Bài hoàn toàn không có GPS — không đối chiếu được quãng đường; bài vẫn được ghi nhận' end));
    end if;
    if v_status = 'APPROVED' then v_reason := 'Hợp lệ (đồng bộ tự động) — cảnh báo: chạy máy / không có GPS.'; end if;
  end if;
  -- Bộ phân tích gian lận (máy chủ ứng dụng, xem features/activity/model/fraud.ts) → chờ ban quản trị xác minh.
  -- fraud.ts (ac-2026.10.7) không bao giờ kết luận REVIEW chỉ vì GPS nhảy / chạy máy.
  if v_status = 'APPROVED' and v_risk->>'verdict' = 'REVIEW' then
    v_status := 'PENDING';
    v_level := coalesce(v_risk->>'level', 'HIGH');
    v_score := coalesce((v_risk->>'score')::int, 65);
    v_reason := coalesce(nullif(v_risk->>'reason', ''), 'Dữ liệu bài chạy bất thường') || '.';
  end if;
  if v_status = 'PENDING' then
    v_reason := left('Mức nghi vấn: ' || private.risk_label(v_level) || '. ' || v_reason
                     || ' Bài được tính sau khi ban quản trị CLB hoặc admin xác minh.', 500);
  end if;

  -- Bài chạy trước khi kết nối: lưu lịch sử, không thưởng (tránh "đổ" hàng tháng dữ liệu cũ lấy Xu)
  v_connected_at := (select max(ca.created_at) from public.connected_accounts ca
                      where ca.user_id = p_user_id and ca.provider = p_source);
  v_history_only := v_connected_at is not null and v_started < v_connected_at;

  v_id := gen_random_uuid();
  -- Kết quả phân tích chi tiết (dữ liệu gốc rút gọn + bằng chứng) → trigger lưu vào activity_analyses cùng lúc với bài
  perform set_config('racehub.analysis', coalesce((p_activity->'analysis')::text, ''), true);
  perform set_config('racehub.reported_distance', v_distance::text, true);
  insert into public.activities (
    id, user_id, title, source, source_activity_id, sport_type, started_at, ended_at,
    elapsed_time_s, moving_time_s, distance_m, moving_distance_m, avg_pace_s,
    avg_speed_mps, max_speed_mps, avg_heartrate, elevation_gain_m, is_manual, device_name,
    status, validation_status, validation_reason, review_detail, rewarded_at, earned_xu, earned_xp,
    risk_score, risk_level, risk_flags)
  values (
    v_id, p_user_id, left(coalesce(nullif(trim(p_activity->>'title'), ''), 'Buổi chạy'), 120), p_source, p_external_id, v_sport,
    v_started, v_ended, v_elapsed, v_moving, v_distance, v_distance, v_pace,
    (p_activity->>'avg_speed_mps')::numeric, v_max_speed, (p_activity->>'avg_heartrate')::numeric,
    coalesce((p_activity->>'elevation_gain_m')::numeric, 0), v_manual, left(p_activity->>'device_name', 80),
    case v_status when 'APPROVED' then 'READY' when 'PENDING' then 'PROCESSING' else 'REJECTED' end, v_status,
    case when v_history_only then v_reason || ' Bài chạy trước khi kết nối — chỉ lưu lịch sử.' else v_reason end,
    null,
    case when v_history_only then now() end,
    case when v_history_only then 0 end,
    case when v_history_only then 0 end,
    case when v_status = 'PENDING' then v_score else (v_risk->>'score')::int end,
    case when v_status = 'PENDING' then v_level else v_risk->>'level' end,
    case when v_flags = '[]'::jsonb then v_risk->'flags' else v_flags end)
  on conflict (source, source_activity_id) where source_activity_id is not null do nothing;

  if not exists (select 1 from public.activities x where x.id = v_id) then  -- request song song đã chèn trước
    v_id := (select x.id from public.activities x where x.source = p_source and x.source_activity_id = p_external_id);
    return jsonb_build_object('result', 'DUPLICATE', 'activity_id', v_id);
  end if;

  a := (select x from public.activities x where x.id = v_id);   -- trigger đã trả thưởng nếu APPROVED
  return jsonb_build_object('result', 'IMPORTED', 'activity_id', v_id,
    'validation_status', a.validation_status, 'reason', a.validation_reason,
    'history_only', v_history_only,
    'earned_xu', coalesce(a.earned_xu, 0), 'earned_xp', coalesce(a.earned_xp, 0));
end $$;

-- ---------------------------------------------------------------------
-- 2. Khôi phục bài bị loại: không áp cho bài nhập tay (bản 012500 + kiểm tra nhập tay)
-- ---------------------------------------------------------------------
create or replace function public.restore_activity(p_activity_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  a public.activities := (select x from public.activities x where x.id = p_activity_id);
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if a.id is null or coalesce(a.status, '') = 'DELETED' then raise exception 'ACTIVITY_NOT_FOUND'; end if;
  if a.validation_status <> 'REJECTED' then raise exception 'ACTIVITY_NOT_REJECTED'; end if;
  -- 013400: bài nhập tay từ đối tác không bao giờ được ghi nhận (Phụng chốt 06/10/2026) → không khôi phục
  if coalesce(a.is_manual, false) and a.source in ('STRAVA', 'GARMIN', 'COROS') then raise exception 'MANUAL_NOT_COUNTED'; end if;
  if a.user_id = v_uid or not private.can_review_activity(a.user_id) then raise exception 'FORBIDDEN'; end if;
  if v_note is null or length(v_note) < 5 then raise exception 'NOTE_REQUIRED'; end if;
  -- Bài bị loại vì trùng giờ với bài khác đang được tính → khôi phục sẽ tính 2 lần
  if exists (select 1 from public.activities x
              where x.user_id = a.user_id and x.id <> a.id and x.validation_status = 'APPROVED'
                and coalesce(x.status, '') <> 'DELETED'
                and x.started_at < coalesce(a.ended_at, a.started_at) and coalesce(x.ended_at, x.started_at) > a.started_at) then
    raise exception 'OVERLAPS_COUNTED_RUN';
  end if;

  perform set_config('racehub.decision_kind', 'RESTORE', true);
  update public.activities
     set validation_status = 'APPROVED', status = 'READY',
         validation_reason = 'Đã khôi phục sau khi xem xét lại.',
         review_detail = left('Khôi phục: ' || v_note || coalesce(' · Trước đó: ' || coalesce(review_detail, validation_reason), ''), 500),
         reviewed_by = v_uid, reviewed_at = now(), updated_at = now()
   where id = a.id;                      -- APPROVED → trigger trả thưởng + cộng vào thử thách
  perform set_config('racehub.decision_kind', '', true);

  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'RESTORE_ACTIVITY', a.id::text, jsonb_build_object('note', v_note));

  perform private.notify(a.user_id, null, 'RUN_REVIEW', 'Bài chạy đã được khôi phục',
    round(coalesce(a.distance_m, 0) / 1000.0, 2) || ' km — đã xem xét lại và ghi nhận, cộng Xu, XP và thử thách.',
    '/activities/' || a.id, v_uid, true);
end $$;

/** Bài bị loại trong N ngày gần đây mà người gọi được quyền xem lại (BQT CLB của người chạy hoặc admin) */
create or replace function public.rejected_activities(p_club_id uuid default null, p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if p_club_id is not null and not public.club_is_staff(p_club_id) then raise exception 'FORBIDDEN'; end if;
  if p_club_id is null and not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'title', a.title, 'distance_m', a.distance_m, 'moving_time_s', a.moving_time_s,
      'started_at', a.started_at, 'created_at', a.created_at, 'source', a.source,
      'validation_reason', coalesce(a.review_detail, a.validation_reason), 'risk_score', a.risk_score, 'risk_level', a.risk_level,
      'risk_flags', a.risk_flags, 'user_id', a.user_id, 'can_review', a.user_id <> auth.uid(), 'reviewed_at', a.reviewed_at,
      'overlap', coalesce(a.validation_reason, '') like 'Trùng giờ%',
      'manual', coalesce(a.is_manual, false) and a.source in ('STRAVA', 'GARMIN', 'COROS'),
      'profiles', jsonb_build_object('display_name', pr.display_name, 'avatar_url', pr.avatar_url))
      order by coalesce(a.reviewed_at, a.updated_at, a.created_at) desc), '[]'::jsonb)
    from public.activities a
    join public.profiles pr on pr.id = a.user_id
   where a.validation_status = 'REJECTED' and coalesce(a.status, '') <> 'DELETED'
     and coalesce(a.reviewed_at, a.updated_at, a.created_at) > now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 180))
     and (p_club_id is null or exists (select 1 from public.club_members m
                                        where m.club_id = p_club_id and m.user_id = a.user_id and m.status = 'APPROVED')));
end $$;

-- ---------------------------------------------------------------------
-- 3. Bài có cảnh báo (đã ghi nhận) — admin hệ thống / Ban quản trị CLB
-- ---------------------------------------------------------------------
create index if not exists activities_warned_idx on public.activities (started_at desc)
  where validation_status = 'APPROVED' and risk_flags is not null;

/** Mức của một dấu hiệu: tier (012500) hoặc suy từ severity như màn duyệt bài (PendingRunCard) */
create or replace function private.flag_tier(f jsonb) returns text
language sql immutable as $$
  select coalesce(f->>'tier', case f->>'severity' when 'SEVERE' then 'SUSPECT' when 'HIGH' then 'WARN' else 'NOTE' end)
$$;

/** Bài đã ghi nhận nhưng có cảnh báo (GPS nhảy, chạy máy…) trong N ngày — mới nhất trước, tối đa 300 bài.
 *  p_club_id null: toàn hệ thống (chỉ admin hệ thống); có p_club_id: bài của thành viên CLB (Ban quản trị CLB hoặc admin). */
create or replace function public.warned_activities(p_club_id uuid default null, p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if p_club_id is not null and not public.club_is_staff(p_club_id) then raise exception 'FORBIDDEN'; end if;
  if p_club_id is null and not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', w.id, 'title', w.title, 'distance_m', w.distance_m, 'moving_time_s', w.moving_time_s,
      'started_at', w.started_at, 'created_at', w.created_at, 'source', w.source, 'user_id', w.user_id,
      'risk_score', w.risk_score, 'risk_level', w.risk_level, 'reviewed', w.reviewed_by is not null,
      'warnings', w.warnings,
      'profiles', jsonb_build_object('display_name', pr.display_name, 'avatar_url', pr.avatar_url))
      order by w.started_at desc), '[]'::jsonb)
    from (select a.*, row_number() over (order by a.started_at desc, a.id) as rn,
                 (select jsonb_agg(jsonb_build_object('code', f->>'code', 'tier', private.flag_tier(f), 'message', f->>'message',
                                                      'gpsJump', coalesce((f->>'gpsJump')::boolean, f->>'code' in ('GPS_TELEPORT', 'GPS_DISTANCE_GAIN'))))
                    from jsonb_array_elements(case when jsonb_typeof(a.risk_flags) = 'array' then a.risk_flags else '[]'::jsonb end) f where private.flag_tier(f) <> 'NOTE') as warnings
            from public.activities a
           where a.validation_status = 'APPROVED' and a.risk_flags is not null and jsonb_typeof(a.risk_flags) = 'array'
             and coalesce(a.status, '') <> 'DELETED'
             and a.started_at > now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 180))
             and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(a.risk_flags) = 'array' then a.risk_flags else '[]'::jsonb end) f where private.flag_tier(f) <> 'NOTE')
             and (p_club_id is null or exists (select 1 from public.club_members m
                                                where m.club_id = p_club_id and m.user_id = a.user_id and m.status = 'APPROVED'))) w
    join public.profiles pr on pr.id = w.user_id
   where w.rn <= 300);
end $$;

revoke all on function public.ingest_provider_activity(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_provider_activity(uuid, text, text, jsonb) to service_role;
revoke all on function private.flag_tier(jsonb) from public, anon, authenticated;
revoke all on function public.restore_activity(uuid, text), public.rejected_activities(uuid, integer),
  public.warned_activities(uuid, integer) from public, anon;
grant execute on function public.restore_activity(uuid, text), public.rejected_activities(uuid, integer),
  public.warned_activities(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
