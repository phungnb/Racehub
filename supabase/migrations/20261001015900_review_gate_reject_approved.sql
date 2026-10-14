-- Vá lỗ hổng chống gian lận (đánh giá khoa học 14/10/2026):
--  1. CLB tự lập (chỉ 2 tài khoản) duyệt/khôi phục bài cho nhau → chỉ BQT CLB có ít nhất 5 thành viên đã duyệt mới có quyền duyệt bài của thành viên.
--     Admin hệ thống không bị ảnh hưởng.
--  2. Admin loại được bài ĐÃ ghi nhận (trước đây chỉ có bài chờ duyệt) → trigger sẵn có thu hồi Xu, XP, thử thách, nhiệm vụ.

create or replace function private.can_review_activity(p_runner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_system_admin() or exists (
    select 1 from public.club_members me join public.club_members runner on runner.club_id = me.club_id
     where me.user_id = auth.uid() and me.status = 'APPROVED' and me.role in ('OWNER', 'CAPTAIN')
       and runner.user_id = p_runner and runner.status = 'APPROVED'
       and (select count(*) from public.club_members m where m.club_id = me.club_id and m.status = 'APPROVED') >= 5)
$$;

create or replace function public.admin_reject_activity(p_activity_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  a public.activities := (select x from public.activities x where x.id = p_activity_id for update);
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  if a.id is null or coalesce(a.status, '') = 'DELETED' then raise exception 'ACTIVITY_NOT_FOUND'; end if;
  if a.validation_status <> 'APPROVED' then raise exception 'ACTIVITY_NOT_APPROVED'; end if;
  if v_reason is null or length(v_reason) < 5 then raise exception 'NOTE_REQUIRED'; end if;

  perform private.revoke_run_reward(a.id, 'Thu hồi thưởng — bài đã ghi nhận bị ban quản trị loại');
  perform set_config('racehub.decision_kind', 'REVIEWER', true);
  update public.activities
     set validation_status = 'REJECTED', status = 'REJECTED',
         validation_reason = 'Bị loại sau khi đã ghi nhận.',
         review_detail = left('Loại: ' || v_reason, 500),
         reviewed_by = v_uid, reviewed_at = now(), updated_at = now()
   where id = a.id;                      -- trigger thu hồi thử thách, nhiệm vụ, huy hiệu
  perform set_config('racehub.decision_kind', '', true);

  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'REJECT_APPROVED_ACTIVITY', a.id::text, jsonb_build_object('reason', v_reason));

  perform private.notify(a.user_id, null, 'RUN_REVIEW', 'Bài chạy không còn được ghi nhận',
    round(coalesce(a.distance_m, 0) / 1000.0, 2) || ' km — ban quản trị xác định dữ liệu không hợp lệ; Xu, XP và thử thách liên quan đã được thu hồi.',
    '/activities/' || a.id, v_uid, true);
end $$;

revoke all on function public.admin_reject_activity(uuid, text) from public, anon;
grant execute on function public.admin_reject_activity(uuid, text) to authenticated;

notify pgrst, 'reload schema';
