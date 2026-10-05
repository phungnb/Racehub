-- Trợ lý vận hành (ADR-018): schema `ops` chỉ gồm view tổng hợp + role `ops_reader` chỉ đọc được schema này.
-- Routine Claude kết nối bằng ops_reader để soạn báo cáo; không đọc được public / private / auth, không ghi được gì.
--
-- Sau khi chạy migration, Quản trị chính tự đặt mật khẩu (KHÔNG ghi vào repo, không gửi qua chat):
--   alter role ops_reader with login password '<mật khẩu mạnh>';
-- Chuỗi kết nối (Supabase → Connect → Session pooler), thay user thành ops_reader.<project-ref>,
-- rồi lưu làm biến môi trường RACEHUB_OPS_DB_URL trong cài đặt môi trường của project Claude.
-- Nghi lộ: alter role ops_reader with password '<mới>';  hoặc  alter role ops_reader nologin;
--
-- Danh sách tester kiểm thử kín (email trùng danh sách trong Play Console):
--   insert into ops.testers (email) values ('a@gmail.com'), ('b@gmail.com') on conflict do nothing;

create schema if not exists ops;
revoke all on schema ops from public;
do $$ begin
  -- Supabase có anon / authenticated; schema ops không mở cho app (không có trong API schemas)
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema ops from anon, authenticated'; end if;
end $$;

create table if not exists ops.testers (
  email text primary key check (email = lower(trim(email)) and email like '%@%' and char_length(email) <= 200),
  joined_on date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  note text check (note is null or char_length(note) <= 200),
  active boolean not null default true
);

-- Mỗi tester: có tài khoản chưa, lần đăng nhập / chạy / nhận thông báo gần nhất, số ngày im lặng.
-- App chưa ghi "lần mở app", nên dùng lần có dấu hiệu sống gần nhất trong 3 nguồn trên.
create or replace view ops.tester_activity as
select t.email, t.joined_on, t.note,
       u.id is not null as has_account,
       p.display_name,
       u.last_sign_in_at,
       r.last_run_at,
       coalesce(r.runs_7d, 0) as runs_7d,
       coalesce(r.km_7d, 0) as km_7d,
       s.last_push_seen_at,
       greatest(u.last_sign_in_at, r.last_run_at, s.last_push_seen_at) as last_signal_at,
       (now()::date - greatest(u.last_sign_in_at, r.last_run_at, s.last_push_seen_at)::date) as days_silent
  from ops.testers t
  left join auth.users u on lower(u.email) = t.email
  left join public.profiles p on p.id = u.id
  left join lateral (
    select max(a.started_at) as last_run_at,
           count(*) filter (where a.started_at >= now() - interval '7 days') as runs_7d,
           round(coalesce(sum(a.distance_m) filter (where a.started_at >= now() - interval '7 days'), 0) / 1000.0, 1) as km_7d
      from public.activities a where a.user_id = u.id) r on true
  left join lateral (select max(ps.last_seen_at) as last_push_seen_at from public.push_subscriptions ps where ps.user_id = u.id) s on true
 where t.active;

-- Số liệu theo tuần (thứ Hai → Chủ nhật, giờ VN), 8 tuần gần nhất.
create or replace view ops.weekly_metrics as
with w as (
  select generate_series(date_trunc('week', (now() at time zone 'Asia/Ho_Chi_Minh')) - interval '7 weeks',
                         date_trunc('week', (now() at time zone 'Asia/Ho_Chi_Minh')), interval '1 week') as week_start
)
select w.week_start::date as week_start,
       (select count(*) from public.profiles p
         where (p.created_at at time zone 'Asia/Ho_Chi_Minh') >= w.week_start
           and (p.created_at at time zone 'Asia/Ho_Chi_Minh') < w.week_start + interval '1 week') as new_users,
       (select count(distinct a.user_id) from public.activities a
         where (a.started_at at time zone 'Asia/Ho_Chi_Minh') >= w.week_start
           and (a.started_at at time zone 'Asia/Ho_Chi_Minh') < w.week_start + interval '1 week') as active_runners,
       (select count(*) from public.activities a
         where (a.started_at at time zone 'Asia/Ho_Chi_Minh') >= w.week_start
           and (a.started_at at time zone 'Asia/Ho_Chi_Minh') < w.week_start + interval '1 week') as runs,
       (select round(coalesce(sum(a.distance_m), 0) / 1000.0, 1) from public.activities a
         where (a.started_at at time zone 'Asia/Ho_Chi_Minh') >= w.week_start
           and (a.started_at at time zone 'Asia/Ho_Chi_Minh') < w.week_start + interval '1 week') as km,
       (select count(*) from public.challenges c
         where (c.created_at at time zone 'Asia/Ho_Chi_Minh') >= w.week_start
           and (c.created_at at time zone 'Asia/Ho_Chi_Minh') < w.week_start + interval '1 week') as new_challenges,
       (select count(*) from public.clubs c
         where (c.created_at at time zone 'Asia/Ho_Chi_Minh') >= w.week_start
           and (c.created_at at time zone 'Asia/Ho_Chi_Minh') < w.week_start + interval '1 week') as new_clubs
  from w;

-- Việc cần chủ dự án để ý. kind: CHALLENGE_ENDING | CHALLENGE_LOW_SIGNUP | CLUB_QUIET | USER_REPORT_OPEN
create or replace view ops.attention as
select 'CHALLENGE_ENDING'::text as kind, c.id as ref_id, c.title,
       format('Kết thúc %s, %s người tham gia', to_char(c.end_date at time zone 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI'),
              (select count(*) from public.challenge_participants cp where cp.challenge_id = c.id)) as detail,
       c.end_date as due_at
  from public.challenges c
 where c.status = 'ACTIVE' and c.end_date between now() and now() + interval '3 days'
union all
select 'CHALLENGE_LOW_SIGNUP', c.id, c.title,
       format('Hạn đăng ký %s, mới %s/%s người tối thiểu', to_char(c.reg_deadline at time zone 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI'),
              n.joined, coalesce(c.min_members, 1)),
       c.reg_deadline
  from public.challenges c
  cross join lateral (select count(*) as joined from public.challenge_participants cp where cp.challenge_id = c.id) n
 where c.status = 'ACTIVE' and c.reg_deadline between now() and now() + interval '2 days'
   and n.joined < greatest(coalesce(c.min_members, 1), 2)
union all
select 'CLUB_QUIET', c.id, c.name,
       format('%s thành viên, không ai chạy trong 14 ngày', c.member_count),
       null::timestamptz
  from public.clubs c
 where c.created_at < now() - interval '14 days'
   and not exists (select 1 from public.club_members m join public.activities a on a.user_id = m.user_id
                    where m.club_id = c.id and coalesce(m.status, 'APPROVED') = 'APPROVED' and a.started_at >= now() - interval '14 days')
union all
select 'USER_REPORT_OPEN', r.id, r.reason,
       format('Báo cáo %s (%s) chưa xử lý từ %s', r.reason, r.context, to_char(r.created_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM')),
       r.created_at
  from public.user_reports r
 where r.status = 'OPEN';

-- Role chỉ đọc. Tạo ở trạng thái nologin; Quản trị chính tự bật đăng nhập + đặt mật khẩu (xem đầu file).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'ops_reader') then
    create role ops_reader nologin noinherit;
  end if;
end $$;
alter role ops_reader set default_transaction_read_only = on;
alter role ops_reader set statement_timeout = '15s';
grant usage on schema ops to ops_reader;
grant select on ops.testers, ops.tester_activity, ops.weekly_metrics, ops.attention to ops_reader;
