-- =====================================================================
-- 20261001000400 — TIẾP NHẬN BÀI CHẠY TỪ STRAVA (và sau này Garmin/COROS)
--
-- Luồng: webhook / nút "Đồng bộ" (server, service_role)
--        → ingest_provider_activity() → activities (APPROVED | PENDING)
--        → trigger trg_auto_reward → private.reward_activity() (Xu, XP, thử thách)
--
-- Nguyên tắc (tham khảo UpRace / Strava, xem docs/architecture/benchmark.md):
--   * Idempotent: khóa (source, source_activity_id) — webhook gửi trùng không ghi 2 lần
--   * Chỉ tính chạy bộ ngoài trời có GPS; bài nhập tay / chạy máy → chờ duyệt
--   * Không cộng 2 lần cùng một buổi chạy ghi bởi nhiều nguồn (GPS app + Strava)
--   * Bài chạy TRƯỚC thời điểm kết nối chỉ lưu làm lịch sử, không thưởng
--   * Bài bị xóa trên Strava → thu hồi Xu/XP đã thưởng
-- Phụ thuộc: 000200 (sổ cái, reward_activity), 000300 (link_provider_connection)
-- =====================================================================

alter table public.activities add column if not exists sport_type text;
alter table public.activities add column if not exists max_speed_mps numeric;
alter table public.activities add column if not exists avg_heartrate numeric;
alter table public.activities add column if not exists is_manual boolean not null default false;
alter table public.activities add column if not exists device_name text;
alter table public.connected_accounts add column if not exists last_synced_at timestamptz;

create unique index if not exists activities_source_external_uidx
  on public.activities (source, source_activity_id) where source_activity_id is not null;
create index if not exists activities_user_time_idx on public.activities (user_id, started_at, ended_at);

-- ---------------------------------------------------------------------
-- Tiếp nhận một bài chạy đã chuẩn hóa. Chỉ server (service_role) gọi.
-- p_activity: {title, sport_type, started_at, elapsed_s, moving_s, distance_m,
--              elevation_gain_m, avg_speed_mps, max_speed_mps, avg_heartrate,
--              manual, has_gps, device_name}
-- Trả về: {result: IMPORTED|UPDATED|DUPLICATE|SKIPPED, activity_id, validation_status, reason, earned_xu, earned_xp}
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
begin
  if p_source not in ('STRAVA', 'GARMIN', 'COROS') then raise exception 'INVALID_SOURCE'; end if;
  if p_external_id is null or v_started is null then raise exception 'INVALID_ACTIVITY'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then raise exception 'USER_NOT_FOUND'; end if;

  -- Đã có → chỉ cập nhật tiêu đề (Strava gửi aspect "update" khi đổi tên)
  select * into v_existing from public.activities where source = p_source and source_activity_id = p_external_id;
  if found then
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
  v_pace := round(v_moving / (v_distance / 1000.0));

  -- Cùng một buổi chạy đã được ghi từ nguồn khác (vd GPS trong app) → không tính 2 lần
  if exists (select 1 from public.activities
              where user_id = p_user_id and coalesce(status, '') <> 'DELETED'
                and started_at < v_ended and coalesce(ended_at, started_at) > v_started) then
    return jsonb_build_object('result', 'SKIPPED', 'reason', 'OVERLAPS_EXISTING_ACTIVITY');
  end if;

  -- Luật hợp lệ
  if v_manual then
    v_status := 'PENDING'; v_reason := 'Bài nhập tay (không có dữ liệu thiết bị) — chờ xác minh.';
  elsif v_sport = 'VirtualRun' then
    v_status := 'PENDING'; v_reason := 'Chạy máy / chạy ảo — chờ xác minh.';
  elsif not v_has_gps then
    v_status := 'PENDING'; v_reason := 'Thiếu dữ liệu GPS — chờ xác minh.';
  elsif v_pace < (cfg->>'minValidPace')::numeric * 60 then
    v_status := 'PENDING'; v_reason := 'Pace nhanh bất thường — chờ xác minh.';
  elsif v_pace > (cfg->>'maxValidPace')::numeric * 60 then
    v_status := 'PENDING'; v_reason := 'Pace chậm hơn giới hạn chạy bộ — chờ xác minh.';
  elsif v_max_speed is not null and v_max_speed > 12 then
    v_status := 'PENDING'; v_reason := 'Vận tốc tối đa > 43 km/h — chờ xác minh.';
  end if;

  -- Bài chạy trước khi kết nối: lưu lịch sử, không thưởng (tránh "đổ" hàng tháng dữ liệu cũ lấy Xu)
  select created_at into v_connected_at from public.connected_accounts
   where user_id = p_user_id and provider = p_source order by created_at desc limit 1;
  v_history_only := v_connected_at is not null and v_started < v_connected_at;

  insert into public.activities (
    user_id, title, source, source_activity_id, sport_type, started_at, ended_at,
    elapsed_time_s, moving_time_s, distance_m, moving_distance_m, avg_pace_s,
    avg_speed_mps, max_speed_mps, avg_heartrate, elevation_gain_m, is_manual, device_name,
    status, validation_status, validation_reason, rewarded_at, earned_xu, earned_xp)
  values (
    p_user_id, left(coalesce(nullif(trim(p_activity->>'title'), ''), 'Buổi chạy'), 120), p_source, p_external_id, v_sport,
    v_started, v_ended, v_elapsed, v_moving, v_distance, v_distance, v_pace,
    (p_activity->>'avg_speed_mps')::numeric, v_max_speed, (p_activity->>'avg_heartrate')::numeric,
    coalesce((p_activity->>'elevation_gain_m')::numeric, 0), v_manual, left(p_activity->>'device_name', 80),
    case v_status when 'APPROVED' then 'READY' else 'PROCESSING' end, v_status,
    case when v_history_only then v_reason || ' Bài chạy trước khi kết nối — chỉ lưu lịch sử.' else v_reason end,
    case when v_history_only then now() end,
    case when v_history_only then 0 end,
    case when v_history_only then 0 end)
  on conflict (source, source_activity_id) where source_activity_id is not null do nothing
  returning id into v_id;

  if v_id is null then  -- request song song đã chèn trước
    select id into v_id from public.activities where source = p_source and source_activity_id = p_external_id;
    return jsonb_build_object('result', 'DUPLICATE', 'activity_id', v_id);
  end if;

  select * into a from public.activities where id = v_id;   -- trigger đã trả thưởng nếu APPROVED
  return jsonb_build_object('result', 'IMPORTED', 'activity_id', v_id,
    'validation_status', a.validation_status, 'reason', a.validation_reason,
    'history_only', v_history_only,
    'earned_xu', coalesce(a.earned_xu, 0), 'earned_xp', coalesce(a.earned_xp, 0));
end $$;

-- ---------------------------------------------------------------------
-- Bài chạy bị xóa trên nguồn → đánh dấu DELETED, thu hồi Xu và XP đã thưởng
-- ---------------------------------------------------------------------
create or replace function public.remove_provider_activity(p_source text, p_external_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.activities%rowtype;
begin
  select * into a from public.activities
   where source = p_source and source_activity_id = p_external_id for update;
  if not found then return jsonb_build_object('result', 'NOT_FOUND'); end if;
  if a.status = 'DELETED' then return jsonb_build_object('result', 'ALREADY_DELETED', 'activity_id', a.id); end if;

  update public.activities
     set status = 'DELETED', validation_status = 'REJECTED',
         validation_reason = 'Đã bị xóa trên ' || p_source || '.', updated_at = now()
   where id = a.id;

  if coalesce(a.earned_xu, 0) > 0 then
    perform private.ledger_post('RUN_REWARD_REVERSAL', 'run_reward_reversal:' || a.id,
      'Thu hồi thưởng — bài chạy bị xóa', a.user_id,
      jsonb_build_array(
        jsonb_build_object('account_id', a.user_id, 'coin_kind', 'BONUS', 'amount', -a.earned_xu),
        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', a.earned_xu)),
      a.id, true);   -- cho phép âm: người dùng không được giữ Xu của bài chạy đã xóa
  end if;
  if coalesce(a.earned_xp, 0) > 0 then
    update public.profiles
       set xp = greatest(coalesce(xp, 0) - a.earned_xp, 0),
           level = private.level_for_xp(greatest(coalesce(xp, 0) - a.earned_xp, 0))
     where id = a.user_id;
  end if;

  return jsonb_build_object('result', 'DELETED', 'activity_id', a.id,
                            'reversed_xu', coalesce(a.earned_xu, 0), 'reversed_xp', coalesce(a.earned_xp, 0));
end $$;

-- Người dùng tự xem nguồn đã kết nối và lần đồng bộ gần nhất (không lộ token)
create or replace function public.my_provider_connections() returns table (provider text, provider_user_id text, connected_at timestamptz, last_synced_at timestamptz)
language sql stable security definer set search_path = public as $$
  select provider, provider_user_id, created_at, last_synced_at
    from public.connected_accounts where user_id = auth.uid()
$$;

revoke all on function public.ingest_provider_activity(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.remove_provider_activity(text, text) from public, anon, authenticated;
grant execute on function public.ingest_provider_activity(uuid, text, text, jsonb) to service_role;
grant execute on function public.remove_provider_activity(text, text) to service_role;
revoke all on function public.my_provider_connections() from public, anon;
grant execute on function public.my_provider_connections() to authenticated;

notify pgrst, 'reload schema';
