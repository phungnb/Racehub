-- 013700: bài trùng giờ dài hơn nhưng nghi vấn → chờ duyệt; duyệt xong thì bài trùng giờ bị loại (Phụng yêu cầu 2026-10-07).
--   • Trước: bài mới dài hơn hẳn (> 110% tổng các bài đang tính trùng giờ) nhưng đang nghi vấn chờ xác minh bị loại ngay,
--     admin cũng không khôi phục được khi bài kia còn đang tính.
--   • Nay: bài đó nằm ở trạng thái CHỜ DUYỆT (chưa tính, chưa thưởng). Admin hoặc chủ nhiệm / đội trưởng CLB duyệt "Hợp lệ" thì các bài
--     trùng giờ (đang tính hoặc đang chờ) bị loại cùng lúc, thu hồi Xu / XP / nhiệm vụ / thử thách; duyệt "Không hợp lệ" thì bài kia giữ nguyên.
--   • Người chạy tự bấm "chỉ tính phần có GPS" không được dùng khi còn bài trùng giờ (tránh tính 2 lần, không qua người duyệt).
--   • Bài ngắn hơn / dài hơn không quá 10% vẫn bị loại như 009900.
-- Cần 009900, 002400, 009700. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create or replace function private.activity_overlap_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_end timestamptz;
  v_ids uuid[];
  v_old numeric;
  v_new numeric;
  v_id uuid;
begin
  if new.user_id is null or new.started_at is null or coalesce(new.status, '') = 'DELETED' then return new; end if;
  -- Hai máy gửi cùng lúc: bài sau chờ bài trước ghi xong rồi mới so
  perform pg_advisory_xact_lock(hashtextextended('activity_overlap:' || new.user_id::text, 0));
  v_end := coalesce(new.ended_at, new.started_at + make_interval(secs => greatest(coalesce(new.elapsed_time_s, new.moving_time_s, 0), 0)));

  -- Gửi lại đúng bài cũ (không có mã bài của nguồn) → không tạo bài mới
  if new.source_activity_id is null and exists (
       select 1 from public.activities x
        where x.user_id = new.user_id and x.source is not distinct from new.source and x.source_activity_id is null
          and x.started_at = new.started_at and coalesce(x.ended_at, x.started_at) = v_end) then
    raise exception 'ACTIVITY_DUPLICATE';
  end if;

  v_ids := private.overlap_ids(new.user_id, new.started_at, v_end, new.id);
  if cardinality(v_ids) = 0 then return new; end if;
  v_old := private.overlap_meters(v_ids);
  v_new := private.activity_meters(new.moving_distance_m, new.distance_m);

  if new.validation_status = 'APPROVED' and new.rewarded_at is null and v_new > v_old * 1.1 then
    -- Bài mới dài hơn hẳn → tính bài mới, bỏ các bài trùng giờ
    foreach v_id in array v_ids loop
      perform private.revoke_run_reward(v_id, 'Thu hồi thưởng — bài trùng giờ với bài dài hơn');
    end loop;
    update public.activities
       set validation_status = 'REJECTED', status = 'REJECTED', validation_reason = 'Trùng giờ với bài chạy khác.',
           review_detail = left('Trùng giờ với bài ' || new.id || ' (' || round(v_new / 1000.0, 2) || ' km) — chỉ tính bài dài hơn.', 500),
           updated_at = now()
     where id = any(v_ids);
    return new;
  end if;

  -- 013700: dài hơn hẳn nhưng đang nghi vấn chờ xác minh → giữ ở trạng thái chờ duyệt, không tính, không thay bài đang tính
  if new.validation_status = 'PENDING' and v_new > v_old * 1.1 then
    new.review_detail := left('Trùng giờ với ' || array_to_string(v_ids, ', ') || ' (' || round(v_old / 1000.0, 2) || ' km đang được tính). '
                              || 'Bài này dài hơn: nếu được duyệt hợp lệ, các bài trùng giờ sẽ bị loại'
                              || coalesce(' · ' || new.review_detail, '') || '.', 500);
    return new;
  end if;

  -- Ngược lại: lưu bài mới vào lịch sử nhưng không tính
  new.review_detail := left('Trùng giờ với ' || array_to_string(v_ids, ', ') || ' (' || round(v_old / 1000.0, 2) || ' km đang được tính)'
                            || coalesce(' · ' || new.review_detail, '') || '.', 500);
  new.validation_status := 'REJECTED';
  new.status := 'REJECTED';
  new.validation_reason := 'Trùng giờ với bài chạy khác.';
  return new;
end $$;

-- Duyệt bài chờ: "Hợp lệ" thì loại luôn các bài trùng giờ (đang tính hoặc đang chờ), thu hồi thưởng của chúng
create or replace function public.review_activity(p_activity_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  a public.activities := (select x from public.activities x where x.id = p_activity_id and x.validation_status = 'PENDING');
  v_end timestamptz;
  v_ids uuid[] := '{}';
  v_id uuid;
begin
  if p_status not in ('APPROVED', 'REJECTED') then raise exception 'INVALID_STATUS'; end if;
  if a.id is null then raise exception 'ACTIVITY_NOT_PENDING'; end if;
  if a.user_id = v_uid or not private.can_review_activity(a.user_id) then raise exception 'FORBIDDEN'; end if;

  if p_status = 'APPROVED' then
    perform pg_advisory_xact_lock(hashtextextended('activity_overlap:' || a.user_id::text, 0));
    v_end := coalesce(a.ended_at, a.started_at + make_interval(secs => greatest(coalesce(a.elapsed_time_s, a.moving_time_s, 0), 0)));
    v_ids := private.overlap_ids(a.user_id, a.started_at, v_end, a.id);
    foreach v_id in array v_ids loop
      perform private.revoke_run_reward(v_id, 'Thu hồi thưởng — bài trùng giờ đã được duyệt thay thế');
    end loop;
    if cardinality(v_ids) > 0 then
      update public.activities
         set validation_status = 'REJECTED', status = 'REJECTED', validation_reason = 'Trùng giờ với bài chạy khác.',
             review_detail = left('Trùng giờ với bài ' || a.id || ' đã được ban quản trị duyệt hợp lệ — chỉ tính bài đó.', 500),
             updated_at = now()
       where id = any(v_ids);
    end if;
  end if;

  update public.activities
     set validation_status = p_status,
         status = case when p_status = 'APPROVED' then 'READY' else 'REJECTED' end,
         reviewed_by = v_uid, reviewed_at = now(), updated_at = now()
   where id = a.id;                      -- APPROVED → trigger trả thưởng + cộng vào thử thách

  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'REVIEW_ACTIVITY', a.id::text, jsonb_build_object('status', p_status, 'rejected_overlaps', to_jsonb(v_ids)));

  perform private.notify(a.user_id, null, 'RUN_REVIEW',
    case when p_status = 'APPROVED' then 'Bài chạy đã được xác minh' else 'Bài chạy không được ghi nhận' end,
    round(coalesce(a.distance_m, 0) / 1000.0, 2) || ' km — ' ||
      case when p_status = 'APPROVED' then 'đã cộng Xu, XP và tính vào thử thách.'
           else 'ban quản trị xác định dữ liệu không hợp lệ.' end
      || case when cardinality(v_ids) > 0 then ' ' || cardinality(v_ids) || ' bài trùng giờ không còn được tính.' else '' end,
    '/activities/' || a.id, v_uid, true);
end $$;

-- Người chạy không tự duyệt "chỉ tính phần có GPS" khi còn bài trùng giờ (phải qua người duyệt)
create or replace function private.can_accept_verified(a public.activities) returns boolean
language sql stable security definer set search_path = public as $$
  select a.validation_status = 'PENDING' and coalesce(a.status, '') <> 'DELETED'
     and private.gap_meters(a.risk_flags) > 0 and coalesce(a.risk_score, 0) < 65
     and not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(a.risk_flags) = 'array' then a.risk_flags else '[]'::jsonb end) f
                      where f->>'code' <> 'GPS_GAP' and f->>'severity' in ('HIGH', 'SEVERE'))
     and cardinality(private.overlap_ids(a.user_id, a.started_at,
           coalesce(a.ended_at, a.started_at + make_interval(secs => greatest(coalesce(a.elapsed_time_s, a.moving_time_s, 0), 0))), a.id)) = 0
$$;

revoke all on function private.activity_overlap_guard(), private.can_accept_verified(public.activities) from public, anon, authenticated;
revoke all on function public.review_activity(uuid, text) from public, anon;
grant execute on function public.review_activity(uuid, text) to authenticated;

notify pgrst, 'reload schema';
