-- =====================================================================
-- 20261001000300 — RPC quản trị (thay cho client ghi bảng trực tiếp)
--   * review_activity(): duyệt / từ chối bài chạy chờ xác thực
--   * admin_publish_config(): lưu cấu hình kinh tế có phiên bản
-- =====================================================================

create or replace function private.can_review_activities()
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_role text;
begin
  if public.is_system_admin() then return true; end if;
  -- Tương thích quyền cũ: profiles.role = 'CLUB_ADMIN' được duyệt bài (canReviewActivities)
  if private.column_exists('profiles', 'role') then
    execute 'select role from public.profiles where id = $1' into v_role using auth.uid();
    return v_role in ('SYSTEM_ADMIN', 'CLUB_ADMIN');
  end if;
  return false;
end $$;

create or replace function public.review_activity(p_activity_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_sets text := '';
  v_rows int;
begin
  if p_decision not in ('APPROVED', 'REJECTED') then raise exception 'INVALID_DECISION'; end if;
  if not private.can_review_activities() then raise exception 'FORBIDDEN'; end if;

  if private.column_exists('activities', 'validation_status') then
    v_sets := format('validation_status = %L', p_decision);
  end if;
  if private.column_exists('activities', 'status') then
    v_sets := v_sets || case when v_sets = '' then '' else ', ' end
           || format('status = %L', case when p_decision = 'APPROVED' then 'COMPLETED' else 'REJECTED' end);
  end if;
  if v_sets = '' then raise exception 'SCHEMA_MISMATCH: activities thiếu cột trạng thái'; end if;

  execute format('update public.activities set %s where id = $1', v_sets) using p_activity_id;
  get diagnostics v_rows = row_count;   -- EXECUTE không cập nhật FOUND
  if v_rows = 0 then raise exception 'ACTIVITY_NOT_FOUND'; end if;

  insert into private.audit_log (actor_id, action, target, data)
  values (v_uid, 'activity.reviewed', p_activity_id::text, jsonb_build_object('decision', p_decision, 'note', p_note));
end $$;
revoke execute on function public.review_activity(uuid, text, text) from public, anon;
grant execute on function public.review_activity(uuid, text, text) to authenticated;

create or replace function public.admin_publish_config(p_config_key text, p_config_value jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid();
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(p_config_value) <> 'object' then raise exception 'INVALID_CONFIG'; end if;
  if not private.table_exists('system_config_versions') then
    raise exception 'SCHEMA_MISMATCH: thiếu bảng system_config_versions';
  end if;

  -- Giữ nguyên hành vi cũ (1 dòng / config_key, upsert) — lịch sử nằm trong audit_log
  execute $q$
    insert into public.system_config_versions (config_key, version, status, config_value, created_by)
    values ($1, extract(epoch from now())::bigint, 'PUBLISHED', $2, $3)
    on conflict (config_key) do update set
      version = excluded.version, status = excluded.status,
      config_value = excluded.config_value, created_by = excluded.created_by $q$
  using p_config_key, p_config_value, v_uid;

  insert into private.audit_log (actor_id, action, target, data)
  values (v_uid, 'config.published', p_config_key, p_config_value);
end $$;
revoke execute on function public.admin_publish_config(text, jsonb) from public, anon;
grant execute on function public.admin_publish_config(text, jsonb) to authenticated;
