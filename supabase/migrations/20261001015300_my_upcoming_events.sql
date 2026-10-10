-- Khối "Sắp tới" ở trang chủ: lịch CLB chưa kết thúc của mọi CLB tôi là thành viên (đã duyệt), gần nhất trước.
-- Chỉ đọc; trả cùng dạng với club_events() kèm tên và màu CLB.
create or replace function public.my_upcoming_events(p_limit int default 5) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  return (select coalesce(jsonb_agg(x.j order by x.starts_at), '[]'::jsonb)
            from (select e.starts_at,
                         private.event_json(e, v_uid) || jsonb_build_object('club_name', c.name, 'club_accent', c.accent_color) as j
                    from public.club_events e
                    join public.club_members m on m.club_id = e.club_id and m.user_id = v_uid and m.status = 'APPROVED'
                    join public.clubs c on c.id = e.club_id
                   where e.status = 'SCHEDULED'
                     and e.starts_at + make_interval(mins => e.duration_min) >= now()
                   order by e.starts_at
                   limit greatest(1, least(coalesce(p_limit, 5), 20))) x);
end $$;

revoke all on function public.my_upcoming_events(int) from public, anon;
grant execute on function public.my_upcoming_events(int) to authenticated;

notify pgrst, 'reload schema';
