-- 017300: Quét Strava từ 1/1/2026 tự chạy, không cần ai bấm.
-- Việc quét (strava_scan_jobs, 017100) được tạo tự động cho mọi người VỪA đã nối Strava VỪA là thành viên đã duyệt của một CLB:
--   • chạy một lần ngay trong migration này cho thành viên hiện có;
--   • trigger khi một người được duyệt vào CLB (kể cả chủ nhiệm CLB mới lập) hoặc nối Strava;
--   • việc đang FAILED (hết hạn Strava) tự về PENDING khi người đó nối lại.
-- Nút "Bật quét tự động" của ban quản trị vẫn dùng được (an toàn, không tạo trùng).
create or replace function public.strava_scan_enqueue(p_user_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user_id is null then return; end if;
  if not exists (select 1 from public.connected_accounts c where c.user_id = p_user_id and c.provider = 'STRAVA') then return; end if;
  if not exists (select 1 from public.club_members m where m.user_id = p_user_id and m.status = 'APPROVED') then return; end if;
  insert into public.strava_scan_jobs (user_id, since)
  values (p_user_id, '2026-01-01T00:00:00+07:00')
  on conflict (user_id) do update
     set status = 'PENDING', next_page = 1, note = null, updated_at = now()
   where public.strava_scan_jobs.status = 'FAILED';
end $$;
revoke all on function public.strava_scan_enqueue(uuid) from public, anon, authenticated;

create or replace function public.strava_scan_enqueue_on_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'APPROVED' then perform public.strava_scan_enqueue(new.user_id); end if;
  return new;
end $$;

create or replace function public.strava_scan_enqueue_on_connect() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.provider = 'STRAVA' then perform public.strava_scan_enqueue(new.user_id); end if;
  return new;
end $$;
revoke all on function public.strava_scan_enqueue_on_member() from public, anon, authenticated;
revoke all on function public.strava_scan_enqueue_on_connect() from public, anon, authenticated;

drop trigger if exists strava_scan_on_member on public.club_members;
create trigger strava_scan_on_member after insert or update of status on public.club_members
  for each row execute function public.strava_scan_enqueue_on_member();
drop trigger if exists strava_scan_on_connect on public.connected_accounts;
create trigger strava_scan_on_connect after insert or update on public.connected_accounts
  for each row execute function public.strava_scan_enqueue_on_connect();

-- Thành viên hiện có
select public.strava_scan_enqueue(u.user_id)
  from (select distinct m.user_id from public.club_members m
          join public.connected_accounts c on c.user_id = m.user_id and c.provider = 'STRAVA'
         where m.status = 'APPROVED') u;

notify pgrst, 'reload schema';
