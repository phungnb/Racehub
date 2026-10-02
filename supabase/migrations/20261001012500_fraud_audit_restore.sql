-- 012500: Chống gian lận — lưu vết, dữ liệu gốc, lịch sử quyết định, khôi phục bài loại nhầm.
--  1. activity_analyses: kết quả phân tích của mọi bài (phiên bản luật, mức, bằng chứng, dữ liệu gốc rút gọn khi bài có dấu hiệu)
--  2. activity_decisions: mọi lần đổi trạng thái hợp lệ (hệ thống / người duyệt / khôi phục) + lý do
--  3. restore_activity(): khôi phục bài bị loại nhầm (trả lại Xu, XP, thử thách như bài hợp lệ)
--  4. Strava: km tính theo quãng đường đã bỏ cú nhảy GPS (không loại bài vì GPS nhảy)
--  (GPS trong app: mất tín hiệu đơn thuần đã không bị coi là gian lận từ 009700/010000 — chỉ "chưa xác minh km",
--   người chạy tự chọn "chỉ tính phần có GPS"; giữ nguyên)
--  6. fraud_review_stats(): tỷ lệ báo nhầm thật (bài bị giữ rồi được duyệt hợp lệ / khôi phục)

-- ---------------------------------------------------------------------
-- 1–2. Bảng lưu vết (chỉ đọc qua RPC; người chạy không đọc trực tiếp)
-- ---------------------------------------------------------------------
create table if not exists public.activity_analyses (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  created_at timestamptz not null default now(),
  engine text not null,
  verdict text,
  basis text,
  score integer,
  level text,
  independent integer,
  reported_distance_m numeric,
  clean_distance_m numeric,
  flags jsonb,
  inputs jsonb,
  streams jsonb
);
create index if not exists activity_analyses_activity_idx on public.activity_analyses (activity_id, created_at desc);
alter table public.activity_analyses enable row level security;
revoke all on public.activity_analyses from anon, authenticated;

create table if not exists public.activity_decisions (
  id bigint generated always as identity primary key,
  activity_id uuid not null references public.activities(id) on delete cascade,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_kind text not null check (actor_kind in ('SYSTEM', 'REVIEWER', 'RESTORE')),
  from_status text,
  to_status text not null,
  reason text,
  detail text
);
create index if not exists activity_decisions_activity_idx on public.activity_decisions (activity_id, at desc);
create index if not exists activity_decisions_at_idx on public.activity_decisions (at desc);
alter table public.activity_decisions enable row level security;
revoke all on public.activity_decisions from anon, authenticated;

create or replace function private.activity_trace() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_an text;
  a jsonb;
  v_kind text;
begin
  if tg_op = 'INSERT' then
    v_an := nullif(current_setting('racehub.analysis', true), '');
    if v_an is not null then
      a := v_an::jsonb;
      perform set_config('racehub.analysis', '', true);
      insert into public.activity_analyses (activity_id, engine, verdict, basis, score, level, independent,
                                            reported_distance_m, clean_distance_m, flags, inputs, streams)
      values (new.id, coalesce(a->>'engine', 'unknown'), a->>'verdict', a->>'basis', (a->>'score')::int, a->>'level',
              (a->>'independent')::int, nullif(current_setting('racehub.reported_distance', true), '')::numeric,
              (a->>'clean_distance_m')::numeric, a->'flags', a->'inputs', a->'streams');
    elsif new.risk_flags is not null or new.validation_status = 'PENDING' then
      -- Bài ghi bằng GPS trong app (luật phía máy chủ): lưu kết quả; dữ liệu gốc đã nằm ở bảng điểm GPS
      insert into public.activity_analyses (activity_id, engine, verdict, score, level, flags, inputs)
      values (new.id, 'sql-' || lower(coalesce(new.source, 'unknown')),
              case when new.validation_status = 'PENDING' then 'REVIEW' else 'OK' end,
              new.risk_score, new.risk_level, new.risk_flags,
              jsonb_build_object('distance_m', new.distance_m, 'moving_time_s', new.moving_time_s));
    end if;
  elsif new.validation_status is not distinct from old.validation_status then
    return null;
  end if;

  v_kind := coalesce(nullif(current_setting('racehub.decision_kind', true), ''),
                     case when auth.uid() is null or auth.uid() = new.user_id then 'SYSTEM' else 'REVIEWER' end);
  insert into public.activity_decisions (activity_id, actor_id, actor_kind, from_status, to_status, reason, detail)
  values (new.id, auth.uid(), v_kind, case when tg_op = 'UPDATE' then old.validation_status end, new.validation_status,
          left(new.validation_reason, 500), left(new.review_detail, 500));
  return null;
end $$;

drop trigger if exists trg_zz_activity_trace on public.activities;
create trigger trg_zz_activity_trace after insert or update of validation_status on public.activities
  for each row execute function private.activity_trace();

-- ---------------------------------------------------------------------
-- 3. Khôi phục bài bị loại nhầm
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
      'profiles', jsonb_build_object('display_name', pr.display_name, 'avatar_url', pr.avatar_url))
      order by coalesce(a.reviewed_at, a.updated_at, a.created_at) desc), '[]'::jsonb)
    from public.activities a
    join public.profiles pr on pr.id = a.user_id
   where a.validation_status = 'REJECTED' and coalesce(a.status, '') <> 'DELETED'
     and coalesce(a.reviewed_at, a.updated_at, a.created_at) > now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 180))
     and (p_club_id is null or exists (select 1 from public.club_members m
                                        where m.club_id = p_club_id and m.user_id = a.user_id and m.status = 'APPROVED')));
end $$;

/** Hồ sơ kiểm tra một bài: các lần phân tích + lịch sử quyết định (cho người duyệt / admin) */
create or replace function public.activity_audit(p_activity_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  a public.activities := (select x from public.activities x where x.id = p_activity_id);
begin
  if a.id is null then raise exception 'ACTIVITY_NOT_FOUND'; end if;
  if a.user_id <> auth.uid() and not private.can_review_activity(a.user_id) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'analyses', (select coalesce(jsonb_agg(jsonb_build_object('at', x.created_at, 'engine', x.engine, 'verdict', x.verdict,
                   'basis', x.basis, 'score', x.score, 'level', x.level, 'independent', x.independent,
                   'reported_distance_m', x.reported_distance_m, 'clean_distance_m', x.clean_distance_m,
                   'flags', x.flags, 'inputs', x.inputs, 'has_streams', x.streams is not null) order by x.created_at desc), '[]'::jsonb)
                   from public.activity_analyses x where x.activity_id = a.id),
    'decisions', (select coalesce(jsonb_agg(jsonb_build_object('at', d.at, 'actor_kind', d.actor_kind,
                   'actor', private.display_name(d.actor_id), 'from', d.from_status, 'to', d.to_status,
                   'reason', d.reason, 'detail', case when a.user_id = auth.uid() then null else d.detail end) order by d.at), '[]'::jsonb)
                   from public.activity_decisions d where d.activity_id = a.id));
end $$;

/** Tỷ lệ báo nhầm thật: trong các bài hệ thống giữ lại (PENDING), bao nhiêu được người duyệt xác nhận hợp lệ / khôi phục */
create or replace function public.fraud_review_stats(p_days integer default 90) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_from timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 90), 1), 365));
begin
  perform private.require_admin();
  return (
    with held as (
      select distinct d.activity_id from public.activity_decisions d
       where d.at >= v_from and d.actor_kind = 'SYSTEM' and d.to_status = 'PENDING'),
    final as (
      select h.activity_id,
             (select d.to_status from public.activity_decisions d where d.activity_id = h.activity_id order by d.at desc, d.id desc limit 1) as last,
             exists (select 1 from public.activity_decisions d where d.activity_id = h.activity_id and d.actor_kind = 'RESTORE') as restored,
             (select a.risk_flags from public.activities a where a.id = h.activity_id) as flags
        from held h),
    codes as (
      select f->>'code' as code, count(*) as n, count(*) filter (where final.last = 'APPROVED') as approved
        from final, jsonb_array_elements(case when jsonb_typeof(final.flags) = 'array' then final.flags else '[]'::jsonb end) f
       group by 1)
    select jsonb_build_object(
      'days', p_days,
      'held', (select count(*) from final),
      'still_pending', (select count(*) from final where last = 'PENDING'),
      'approved_after_review', (select count(*) from final where last = 'APPROVED'),
      'rejected', (select count(*) from final where last = 'REJECTED'),
      'restored', (select count(*) from final where restored),
      'false_positive_rate', (select round(count(*) filter (where last = 'APPROVED')::numeric
                                       / nullif(count(*) filter (where last in ('APPROVED', 'REJECTED')), 0), 3) from final),
      'by_rule', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'held', n, 'approved', approved) order by n desc), '[]'::jsonb) from codes)));
end $$;

-- ---------------------------------------------------------------------
-- 4. Strava: km theo quãng đường đã bỏ cú nhảy GPS + lưu kết quả phân tích
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
  v_clean numeric := nullif(p_activity->'risk'->>'clean_distance_m', '')::numeric;
  v_reported numeric;
  v_note text;
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
  -- 012500: cú nhảy GPS cộng thêm km không có thật → tính theo quãng đường đã bỏ cú nhảy (không loại bài)
  if v_clean is not null and v_clean > 0 and v_distance - v_clean >= greatest(200, 0.03 * v_distance) then
    v_reported := v_distance;
    v_note := 'Bỏ ' || round(v_distance - v_clean) || ' m do GPS nhảy (Strava ' || round(v_distance / 1000.0, 2)
              || ' km → tính ' || round(v_clean / 1000.0, 2) || ' km).';
    v_distance := v_clean;
  end if;
  v_pace := round(v_moving / (v_distance / 1000.0));

  -- Cùng một buổi chạy đã được ghi từ nguồn khác (vd GPS trong app) → không tính 2 lần.
  -- 009900: trừ khi bài này dài hơn hẳn các bài trùng giờ đang được tính (vd đồng hồ ghi đủ 2 giờ, điện thoại chỉ ghi một đoạn)
  if exists (select 1 from public.activities
              where user_id = p_user_id and coalesce(status, '') <> 'DELETED'
                and started_at < v_ended and coalesce(ended_at, started_at) > v_started)
     and v_distance <= 1.1 * private.overlap_meters(private.overlap_ids(p_user_id, v_started, v_ended)) then
    return jsonb_build_object('result', 'SKIPPED', 'reason', 'OVERLAPS_EXISTING_ACTIVITY');
  end if;

  -- Luật hợp lệ
  -- Chỉ bài NGHI GIAN LẬN mới chờ duyệt; bài chạy chậm / đi bộ vẫn được ghi nhận ngay (thử thách tự lọc theo pace riêng)
  if v_manual then
    v_status := 'PENDING'; v_level := 'HIGH'; v_score := 70;
    v_reason := 'Bài nhập tay — không có dữ liệu thiết bị (GPS, thời gian thực) để xác minh.';
  elsif v_sport = 'VirtualRun' then
    v_status := 'PENDING'; v_level := 'MEDIUM'; v_score := 40;
    v_reason := 'Chạy máy / chạy ảo — không có tuyến GPS để đối chiếu quãng đường.';
  elsif not v_has_gps then
    v_status := 'PENDING'; v_level := 'MEDIUM'; v_score := 40;
    v_reason := 'Bài không có tuyến GPS — không đối chiếu được quãng đường.';
  elsif v_pace < (cfg->>'minValidPace')::numeric * 60 then
    v_status := 'PENDING'; v_level := 'HIGH'; v_score := 75;
    v_reason := 'Pace trung bình ' || (v_pace / 60) || ':' || lpad((v_pace % 60)::text, 2, '0') || '/km — nhanh hơn kỷ lục thế giới.';
  -- 012400: "vận tốc tối đa" của Strava là MỘT điểm (hay do GPS nhảy). Chỉ dùng khi bài KHÔNG được phân tích chi tiết
  -- (không có risk); có risk thì bộ phân tích (cửa sổ trượt + đường cong pace theo thời gian, fraud.ts) quyết định.
  elsif v_risk is null and v_max_speed is not null and v_max_speed > 12 then
    v_status := 'PENDING'; v_level := 'HIGH'; v_score := 70;
    v_reason := 'Vận tốc tối đa ' || round(v_max_speed * 3.6) || ' km/h — vượt khả năng chạy bộ (> 43 km/h).';
  end if;
  -- Bộ phân tích gian lận (máy chủ ứng dụng, xem features/activity/model/fraud.ts) → chờ ban quản trị xác minh
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
  perform set_config('racehub.reported_distance', coalesce(v_reported::text, ''), true);
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
    case v_status when 'APPROVED' then 'READY' else 'PROCESSING' end, v_status,
    case when v_history_only then v_reason || ' Bài chạy trước khi kết nối — chỉ lưu lịch sử.' else v_reason end,
    case when v_note is null then null when v_status = 'PENDING' then left(v_reason || ' · ' || v_note, 500) else v_note end,
    case when v_history_only then now() end,
    case when v_history_only then 0 end,
    case when v_history_only then 0 end,
    case when v_status = 'PENDING' then v_score else (v_risk->>'score')::int end,
    case when v_status = 'PENDING' then v_level else v_risk->>'level' end, v_risk->'flags')
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

revoke all on function private.activity_trace() from public, anon, authenticated;
revoke all on function public.restore_activity(uuid, text), public.rejected_activities(uuid, integer),
  public.activity_audit(uuid), public.fraud_review_stats(integer) from public, anon;
grant execute on function public.restore_activity(uuid, text), public.rejected_activities(uuid, integer),
  public.activity_audit(uuid), public.fraud_review_stats(integer) to authenticated;

notify pgrst, 'reload schema';
