-- Nhắc runner 3 ngày chưa có bài chạy (Phụng yêu cầu 2026-10-06).
-- Luật cố định, không AI (ADR-018): runner có bài hợp lệ gần nhất cách đây 3–30 ngày, chưa bị khóa,
-- và chưa được nhắc trong 7 ngày qua thì nhận 1 thông báo (chuông + push theo cài đặt "Thành tích").
-- Giờ gửi do cron quyết định (10:30 UTC = 17:30 giờ VN). Idempotent: chạy lại trong ngày không nhắc thêm.

-- Loại thông báo mới thuộc nhóm "game" để dùng chung công tắc "Thành tích", không đổi bảng cài đặt push
create or replace function private.push_category(p_kind text) returns text
language sql immutable as $$
  select case
    when p_kind like 'CLUB\_%' or p_kind = 'CHAT_MENTION' then 'club'
    when p_kind like 'POST\_%' or p_kind = 'CHEER' then 'social'
    when p_kind like 'CHALLENGE\_%' then 'challenge'
    when p_kind in ('BADGE', 'LEVEL_UP', 'LEAGUE', 'RUN_REMINDER') then 'game'
    else 'system'
  end
$$;

create or replace function public.send_run_reminders() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in
    select u.user_id, u.last_run
      from (select a.user_id, max(a.started_at) as last_run
              from public.activities a
             where a.validation_status = 'APPROVED' and coalesce(a.status, '') <> 'DELETED'
             group by a.user_id) u
      join public.profiles p on p.id = u.user_id
     where p.banned_at is null
       and u.last_run <= now() - interval '3 days'
       and u.last_run >  now() - interval '30 days'
       and not exists (select 1 from public.notifications x
                        where x.user_id = u.user_id and x.kind = 'RUN_REMINDER' and x.created_at > now() - interval '7 days')
     order by u.last_run desc
     limit 500
  loop
    perform private.notify(r.user_id, null, 'RUN_REMINDER',
      'Đã vài ngày chưa thấy bạn chạy',
      'Một buổi nhẹ 20–30 phút cũng đủ giữ nhịp. Mở RaceHub để xem thử thách đang chờ bạn.',
      '/me');
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.send_run_reminders() from public, anon, authenticated;
grant execute on function public.send_run_reminders() to service_role;
revoke all on function private.push_category(text) from public, anon, authenticated;

notify pgrst, 'reload schema';
