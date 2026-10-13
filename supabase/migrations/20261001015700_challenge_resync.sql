-- 015700: "Đồng bộ lại dữ liệu" cho thử thách (Ban quản trị CLB / người tạo / admin).
--   Thử thách kéo dài (vd 01/01 → 31/12) cần lấy lại bài chạy Strava từ ngày bắt đầu: app chia lô từng thành viên (/api/challenges/[id]/resync),
--   hai RPC dưới đây chỉ làm phần CSDL:
--   1. challenge_resync_targets: ai được phép bấm + danh sách thành viên đã nối Strava + khoảng thời gian cần lấy.
--   2. challenge_resync_apply: tính lại vào thử thách các bài APPROVED trong khoảng thời gian mà chưa có dòng tiến độ (idempotent).
-- Chạy riêng được ngay; chạy lại nhiều lần vẫn an toàn.

create or replace function public.challenge_resync_targets(p_challenge_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if not (private.challenge_is_manager(c) or public.is_system_admin()) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'title', c.title, 'status', c.status, 'start_date', c.start_date, 'end_date', c.end_date,
    'members', (select coalesce(jsonb_agg(jsonb_build_object('user_id', p.profile_id, 'name', pr.display_name) order by p.joined_at), '[]'::jsonb)
                  from public.challenge_participants p
                  join public.profiles pr on pr.id = p.profile_id
                 where p.challenge_id = c.id and p.status in ('JOINED', 'COMPLETED')
                   and exists (select 1 from public.connected_accounts ca where ca.user_id = p.profile_id and ca.provider = 'STRAVA')),
    'not_connected', (select count(*) from public.challenge_participants p
                       where p.challenge_id = c.id and p.status in ('JOINED', 'COMPLETED')
                         and not exists (select 1 from public.connected_accounts ca where ca.user_id = p.profile_id and ca.provider = 'STRAVA')));
end $$;

create or replace function public.challenge_resync_apply(p_challenge_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
  r record;
  n integer := 0;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if not (private.challenge_is_manager(c) or public.is_system_admin()) then raise exception 'FORBIDDEN'; end if;
  if c.status <> 'ACTIVE' then raise exception 'CHALLENGE_CLOSED'; end if;

  for r in
    select a.id as activity_id, p.id as participant_id
      from public.challenge_participants p
      join public.activities a on a.user_id = p.profile_id
     where p.challenge_id = c.id and p.status in ('JOINED', 'COMPLETED')
       and a.validation_status = 'APPROVED'
       and a.started_at >= c.start_date and a.started_at < least(c.end_date, now() + interval '1 day')
       and not exists (select 1 from public.challenge_progress_events e where e.participant_id = p.id and e.activity_id = a.id)
     order by a.started_at
  loop
    n := n + private.challenge_apply_activity(r.activity_id, r.participant_id);
  end loop;
  return jsonb_build_object('applied', n);
end $$;

revoke all on function public.challenge_resync_targets(uuid), public.challenge_resync_apply(uuid) from public, anon;
grant execute on function public.challenge_resync_targets(uuid), public.challenge_resync_apply(uuid) to authenticated;
