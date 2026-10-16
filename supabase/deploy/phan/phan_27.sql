-- RaceHub — PHẦN 27/28 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 016900, 017000, 017100, 017200, 017300
-- Supabase → SQL Editor → New query → dán TOÀN BỘ phần này → Run. Lỗi thì không có gì thay đổi; chạy lại vẫn an toàn.
-- Xong thì chạy phần tiếp theo.
begin;
-- ===================================================================
-- 20261001016900_race_calendar_table.sql
-- ===================================================================
-- 016900: Bảng tổng hợp giải chạy (offline + online) thay cho đăng từng bài rời.
-- • race_candidates thêm: kind (OFFLINE / ONLINE), reg_deadline (hạn đăng ký), reg_url (link đăng ký), race_url (link trang giải).
-- • Admin chọn nhiều dòng trong hàng chờ rồi "Đưa vào bảng" (status APPROVED, không cần tạo tin giải riêng cho từng giải).
-- • race_calendar(): mọi người đăng nhập đọc được bảng các giải đã duyệt, chưa kết thúc. Chỉ trả cột cần hiển thị.
-- Chạy lại nhiều lần vẫn an toàn.
alter table public.race_candidates add column if not exists kind text not null default 'OFFLINE';
alter table public.race_candidates add column if not exists reg_deadline date;
alter table public.race_candidates add column if not exists reg_url text;
alter table public.race_candidates add column if not exists race_url text;
alter table public.race_candidates drop constraint if exists race_candidates_kind_check;
alter table public.race_candidates add constraint race_candidates_kind_check check (kind in ('OFFLINE', 'ONLINE'));
alter table public.race_candidates drop constraint if exists race_candidates_reg_url_check;
alter table public.race_candidates add constraint race_candidates_reg_url_check
  check (reg_url is null or (reg_url ~* '^https?://[^[:space:]]+$' and char_length(reg_url) <= 1000));
alter table public.race_candidates drop constraint if exists race_candidates_race_url_check;
alter table public.race_candidates add constraint race_candidates_race_url_check
  check (race_url is null or (race_url ~* '^https?://[^[:space:]]+$' and char_length(race_url) <= 1000));

create or replace function public.race_calendar() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'kind', c.kind, 'title', c.title, 'location', c.location, 'race_date', c.race_date, 'end_date', c.end_date,
    'reg_deadline', c.reg_deadline, 'race_url', coalesce(c.race_url, split_part(c.url, '#', 1)), 'reg_url', c.reg_url,
    'distances', c.distances, 'organizer', c.organizer
  ) order by c.kind, c.race_date, c.title), '[]'::jsonb)
  from public.race_candidates c
  where c.status = 'APPROVED'
    and coalesce(c.end_date, c.race_date) >= (now() at time zone 'Asia/Ho_Chi_Minh')::date - 1
    and auth.uid() is not null;
$$;
revoke all on function public.race_calendar() from public, anon;
grant execute on function public.race_calendar() to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001017000_race_source_keep_approved.sql
-- ===================================================================
-- 017000: Xoá nguồn quét KHÔNG làm mất giải đã đưa vào bảng tổng hợp.
-- Trước: xoá nguồn → xoá hết giải đã tìm từ nguồn (kể cả giải đã duyệt). Nay: giải APPROVED được giữ lại (source_id về null);
-- chỉ các giải chưa duyệt / bị lọc / đã bỏ của nguồn đó mới bị xoá theo.
-- Chạy lại nhiều lần vẫn an toàn.
alter table public.race_candidates drop constraint if exists race_candidates_source_id_fkey;
alter table public.race_candidates add constraint race_candidates_source_id_fkey
  foreign key (source_id) references public.race_sources(id) on delete set null;

create or replace function private.race_source_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.race_candidates where source_id = old.id and status <> 'APPROVED';
  return old;
end $$;
drop trigger if exists trg_race_source_cleanup on public.race_sources;
create trigger trg_race_source_cleanup before delete on public.race_sources
  for each row execute function private.race_source_cleanup();

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001017100_strava_scan_jobs.sql
-- ===================================================================
-- 017100: Quét Strava từ 1/1/2026 chạy nền, chia nhỏ theo thời gian (Đại sảnh CLB).
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

-- ===================================================================
-- 20261001017200_long_run_bests.sql
-- ===================================================================
-- 017200: Thành tích Full / Half đầy đủ + nới sai số cự ly + thành tích cá nhân ở hồ sơ runner.
-- • Bài chạy tính là Full / Half khi cự ly từ 98,5% đến 106% mốc (Full: 41,56–44,73 km; Half: 20,78–22,36 km), nên 42,129 km và 42,7 km đều tính; thời gian quy về đúng cự ly.
-- • club_hall_of_fame trả `bests` = TẤT CẢ thành tích của từng người (nhanh nhất trước) thay cho `top3` (bấm tên VĐV trong Đại sảnh để xem).
-- • my_long_bests(): thành tích Full / Half của chính mình (hồ sơ runner), không phụ thuộc CLB. Chạy lại nhiều lần vẫn an toàn.

create or replace function public.club_hall_of_fame(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_year timestamptz := date_trunc('year', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh';
begin
  if not public.club_is_member(p_club_id) then raise exception 'NOT_A_MEMBER'; end if;
  return (
    with mem as (
      select m.user_id from public.club_members m where m.club_id = p_club_id and m.status = 'APPROVED'
    ), runs as (
      select x.id, x.user_id, x.distance_m, x.moving_time_s, x.started_at
        from public.activities x join mem on mem.user_id = x.user_id
       where x.validation_status = 'APPROVED' and x.shared and public.activity_is_countable(x.status, x.validation_status)
         and coalesce(x.distance_m, 0) > 0
    ), finishers as (
      select r.user_id, d.kind, count(*)::int as times, min(r.started_at) as first_at,
             min(case when r.distance_m >= d.need * 0.985 and r.distance_m <= d.need * 1.06 and r.moving_time_s > 0 then round(r.moving_time_s * d.need / r.distance_m) end)::int as best_s
        from runs r join (values ('FM', 42195::numeric), ('HM', 21097.5)) d(kind, need) on r.distance_m >= d.need * 0.985
       group by r.user_id, d.kind
    ), best3 as (
      select t.user_id, t.kind, jsonb_agg(jsonb_build_object('best_s', t.secs, 'at', t.started_at, 'km', round(t.distance_m / 1000, 2), 'activity_id', t.id) order by t.secs) as bests
        from (
          select r.id, r.user_id, d.kind, r.started_at, r.distance_m, round(r.moving_time_s * d.need / r.distance_m)::int as secs,
                 row_number() over (partition by r.user_id, d.kind order by r.moving_time_s * d.need / r.distance_m) as rn
            from runs r join (values ('FM', 42195::numeric), ('HM', 21097.5)) d(kind, need)
              on r.distance_m >= d.need * 0.985 and r.distance_m <= d.need * 1.06 and r.moving_time_s > 0
        ) t group by t.user_id, t.kind
    ), rec as (
      select d.label, d.need, r.user_id, min(round(r.moving_time_s * d.need / r.distance_m))::int as best_s
        from runs r join (values ('5K', 5000::numeric), ('10K', 10000), ('21K', 21097.5), ('42K', 42195)) d(label, need)
          on r.distance_m >= d.need and r.distance_m <= d.need * 1.05 and r.moving_time_s > 0
       group by d.label, d.need, r.user_id
    ), rec_ranked as (
      select rec.*, row_number() over (partition by rec.label order by rec.best_s) as rn from rec
    ), yr as (
      select mem.user_id, coalesce(sum(r.distance_m), 0) as distance_m, count(r.id)::int as runs,
             row_number() over (order by coalesce(sum(r.distance_m), 0) desc, private.display_name(mem.user_id)) as rn
        from mem left join runs r on r.user_id = mem.user_id and r.started_at >= v_year group by mem.user_id
    ), ms as (
      select um.user_id, um.code, um.reached_at, row_number() over (order by um.reached_at desc) as rn
        from public.user_milestones um join mem on mem.user_id = um.user_id
       where um.activity_id is not null
    )
    select jsonb_build_object(
      'marathon', coalesce((select jsonb_agg(jsonb_build_object('user_id', f.user_id, 'name', private.display_name(f.user_id),
                    'avatar_url', p.avatar_url, 'times', f.times, 'first_at', f.first_at, 'best_s', f.best_s,
                    'bests', coalesce(b.bests, '[]'::jsonb)) order by f.first_at)
                  from finishers f join public.profiles p on p.id = f.user_id
                  left join best3 b on b.user_id = f.user_id and b.kind = f.kind where f.kind = 'FM'), '[]'::jsonb),
      'half', coalesce((select jsonb_agg(jsonb_build_object('user_id', f.user_id, 'name', private.display_name(f.user_id),
                    'avatar_url', p.avatar_url, 'times', f.times, 'first_at', f.first_at, 'best_s', f.best_s,
                    'bests', coalesce(b.bests, '[]'::jsonb)) order by f.first_at)
                  from finishers f join public.profiles p on p.id = f.user_id
                  left join best3 b on b.user_id = f.user_id and b.kind = f.kind where f.kind = 'HM'), '[]'::jsonb),
      'records', coalesce((select jsonb_agg(jsonb_build_object('label', rr.label, 'rank', rr.rn, 'user_id', rr.user_id,
                    'name', private.display_name(rr.user_id), 'avatar_url', p.avatar_url, 'best_s', rr.best_s) order by rr.need, rr.rn)
                  from rec_ranked rr join public.profiles p on p.id = rr.user_id where rr.rn <= 3), '[]'::jsonb),
      'year', coalesce((select jsonb_agg(jsonb_build_object('rank', y.rn, 'user_id', y.user_id, 'name', private.display_name(y.user_id),
                    'avatar_url', p.avatar_url, 'distance_m', y.distance_m, 'runs', y.runs) order by y.rn)
                  from yr y join public.profiles p on p.id = y.user_id ), '[]'::jsonb),
      'milestones', coalesce((select jsonb_agg(jsonb_build_object('user_id', ms.user_id, 'name', private.display_name(ms.user_id),
                    'avatar_url', p.avatar_url, 'code', ms.code, 'label', d.label, 'reached_at', ms.reached_at) order by ms.reached_at desc)
                  from ms join public.profiles p on p.id = ms.user_id join private.milestone_defs() d on d.code = ms.code
                 where ms.rn <= 20), '[]'::jsonb),
      'year_start', v_year));
end $$;

revoke all on function private.milestone_defs(), private.countable_km_m(uuid), private.check_milestones(uuid, uuid),
  private.milestones_on_activity() from public, anon, authenticated;
revoke all on function public.club_hall_of_fame(uuid) from public, anon;
grant execute on function public.club_hall_of_fame(uuid) to authenticated;


create or replace function public.my_long_bests() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  return (
    with runs as (
      select x.id, x.title, x.distance_m, x.moving_time_s, x.started_at
        from public.activities x
       where x.user_id = v_uid and x.validation_status = 'APPROVED' and public.activity_is_countable(x.status, x.validation_status)
         and coalesce(x.distance_m, 0) > 0 and coalesce(x.moving_time_s, 0) > 0
    ), t as (
      select d.kind, r.id, r.title, r.started_at, r.distance_m, round(r.moving_time_s * d.need / r.distance_m)::int as secs
        from runs r join (values ('FM', 42195::numeric), ('HM', 21097.5)) d(kind, need)
          on r.distance_m >= d.need * 0.985 and r.distance_m <= d.need * 1.06
    )
    select jsonb_build_object(
      'fm', coalesce((select jsonb_agg(jsonb_build_object('best_s', secs, 'at', started_at, 'km', round(distance_m / 1000, 2), 'activity_id', id, 'title', title) order by secs) from t where kind = 'FM'), '[]'::jsonb),
      'hm', coalesce((select jsonb_agg(jsonb_build_object('best_s', secs, 'at', started_at, 'km', round(distance_m / 1000, 2), 'activity_id', id, 'title', title) order by secs) from t where kind = 'HM'), '[]'::jsonb)));
end $$;
revoke all on function public.my_long_bests() from public, anon;
grant execute on function public.my_long_bests() to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001017300_strava_scan_auto.sql
-- ===================================================================
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

commit;
