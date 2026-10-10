-- Ban quản trị nhắc thành viên chưa đăng ký lịch CLB (thông báo đẩy "Chưa đăng ký: …").
-- Người nhận: thành viên đã duyệt chưa trả lời (hoặc còn dữ liệu cũ "Có thể"), trừ người bấm. Mỗi lịch nhắc tối đa 1 lần / 6 giờ.
alter table public.club_events add column if not exists nudged_at timestamptz;

create or replace function public.remind_club_event(p_event_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  e public.club_events := (select x from public.club_events x where x.id = p_event_id);
  v_uid uuid;
  r record;
  v_n integer := 0;
begin
  if e.id is null then raise exception 'EVENT_NOT_FOUND'; end if;
  v_uid := private.require_staff(e.club_id);
  if e.status = 'CANCELLED' then raise exception 'EVENT_CANCELLED'; end if;
  if e.starts_at + make_interval(mins => e.duration_min) < now() then raise exception 'EVENT_ENDED'; end if;
  if e.nudged_at is not null and e.nudged_at > now() - interval '6 hours' then raise exception 'EVENT_REMIND_TOO_SOON'; end if;
  for r in select m.user_id
             from public.club_members m
             left join public.club_event_rsvps s on s.event_id = e.id and s.user_id = m.user_id
            where m.club_id = e.club_id and m.status = 'APPROVED' and m.user_id <> v_uid
              and (s.user_id is null or s.status = 'MAYBE') loop
    perform private.notify(r.user_id, e.club_id, 'CLUB_EVENT', 'Chưa đăng ký: ' || e.title,
      to_char(e.starts_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM') || coalesce(' · ' || e.location_name, '') || ' · bấm để chọn Tham gia hoặc Không tham gia',
      '/clubs/' || e.club_id || '/events/' || e.id, v_uid, true);
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then update public.club_events set nudged_at = now() where id = e.id; end if;
  return v_n;
end $$;

revoke all on function public.remind_club_event(uuid) from public, anon;
grant execute on function public.remind_club_event(uuid) to authenticated;

notify pgrst, 'reload schema';
