-- 017000: Quét Strava từ 1/1/2026 chạy nền, chia nhỏ theo thời gian (Đại sảnh CLB).
-- Ban quản trị CLB bấm một lần → mỗi thành viên đã nối Strava có một việc PENDING. Mỗi lần thành viên mở app (đồng bộ ngầm) hoặc cron hằng ngày,
-- máy chủ lấy tiếp 1 lô (≤ 3 trang × 100 bài) cho đến hết; gặp hạn mức Strava thì dừng, lần sau chạy tiếp đúng trang.
-- Bảng chỉ máy chủ (service role) ghi; người dùng chỉ đọc việc của mình. Chạy lại nhiều lần vẫn an toàn.
create table if not exists public.strava_scan_jobs (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  since timestamptz not null,
  next_page integer not null default 1 check (next_page >= 1),
  status text not null default 'PENDING' check (status in ('PENDING', 'DONE', 'FAILED')),
  imported integer not null default 0,
  note text,
  requested_by uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists strava_scan_jobs_pending_idx on public.strava_scan_jobs (updated_at) where status = 'PENDING';
alter table public.strava_scan_jobs enable row level security;
drop policy if exists strava_scan_jobs_own on public.strava_scan_jobs;
create policy strava_scan_jobs_own on public.strava_scan_jobs for select to authenticated using (user_id = auth.uid());
revoke all on public.strava_scan_jobs from public, anon;
grant select on public.strava_scan_jobs to authenticated;

-- Ban quản trị tạo việc cho mọi thành viên đã duyệt có nối Strava (đã có việc thì giữ nguyên, không quét lại)
create or replace function public.club_request_strava_scan(p_club_id uuid, p_since timestamptz default '2026-01-01T00:00:00+07:00') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_new integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.club_is_staff(p_club_id) then raise exception 'FORBIDDEN'; end if;
  with ins as (
    insert into public.strava_scan_jobs (user_id, since, requested_by)
    select m.user_id, p_since, v_uid
      from public.club_members m
      join public.connected_accounts c on c.user_id = m.user_id and c.provider = 'STRAVA'
     where m.club_id = p_club_id and m.status = 'APPROVED'
    on conflict (user_id) do nothing
    returning 1)
  select count(*)::int into v_new from ins;
  return public.club_strava_scan_status(p_club_id) || jsonb_build_object('queued', v_new);
end $$;

create or replace function public.club_strava_scan_status(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.club_is_staff(p_club_id) then raise exception 'FORBIDDEN'; end if;
  return (
    select jsonb_build_object(
      'members', count(*)::int,
      'connected', count(c.user_id)::int,
      'pending', count(*) filter (where j.status = 'PENDING')::int,
      'done', count(*) filter (where j.status = 'DONE')::int,
      'failed', count(*) filter (where j.status = 'FAILED')::int,
      'imported', coalesce(sum(j.imported), 0)::int)
      from public.club_members m
      left join public.connected_accounts c on c.user_id = m.user_id and c.provider = 'STRAVA'
      left join public.strava_scan_jobs j on j.user_id = m.user_id
     where m.club_id = p_club_id and m.status = 'APPROVED');
end $$;
revoke all on function public.club_request_strava_scan(uuid, timestamptz) from public, anon;
revoke all on function public.club_strava_scan_status(uuid) from public, anon;
grant execute on function public.club_request_strava_scan(uuid, timestamptz) to authenticated;
grant execute on function public.club_strava_scan_status(uuid) to authenticated;

notify pgrst, 'reload schema';
