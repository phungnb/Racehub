-- 009600: BẢNG ĐIỀU KHIỂN BAN QUẢN TRỊ CLB + TỔNG KẾT TUẦN / THÁNG TỰ ĐỘNG.
--   • club_admin_dashboard: một màn cho ban quản trị — đơn chờ duyệt, thành viên lâu không chạy, hoạt động tuần này so với tuần trước,
--     quỹ (số dư, khoản chờ xác nhận), buổi sắp tới, thử thách đang chạy, lượt quay thưởng, top điểm CLB, cài đặt tổng kết.
--   • Tổng kết: thêm tổng kết THÁNG, top điểm CLB (009400), số buổi / lượt điểm danh, cột mốc; ban quản trị bật / tắt từng loại
--     và bấm "Đăng ngay" cho kỳ vừa xong. Cron gọi hằng ngày, mỗi kỳ chỉ đăng một lần (khoá meta.week như 000500).
-- Cần 000500, 001500, 007000, 007800, 009300, 009400. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT,
-- không RETURNING INTO. Chạy lại an toàn.

create table if not exists public.club_ops (
  club_id uuid primary key references public.clubs(id) on delete cascade,
  recap_weekly boolean not null default true,
  recap_monthly boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.club_ops enable row level security;
revoke all on public.club_ops from anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Nội dung tổng kết một kỳ [p_start, p_end)
-- ---------------------------------------------------------------------
create or replace function private.club_recap_meta(p_club uuid, p_start timestamptz, p_end timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
  with runs as (
    select a.user_id, a.distance_m
      from public.club_members m
      join public.activities a on a.user_id = m.user_id and a.validation_status = 'APPROVED' and a.shared
       and coalesce(a.status, '') <> 'DELETED' and a.started_at >= p_start and a.started_at < p_end
     where m.club_id = p_club and m.status = 'APPROVED'
  ), per as (
    select r.user_id, sum(r.distance_m) as distance_m, row_number() over (order by sum(r.distance_m) desc) as rk from runs r group by r.user_id
  ), pts as (
    select d.user_id, sum(d.pts) as points, row_number() over (order by sum(d.pts) desc) as rk
      from (select r.user_id, r.day, least(sum(r.points), coalesce(max(r.daily_cap), sum(r.points))) as pts
              from private.club_point_rows(p_club, p_start) r where r.started_at < p_end group by r.user_id, r.day) d
     group by d.user_id having sum(d.pts) > 0
  )
  select jsonb_build_object(
    'distance_m', coalesce((select sum(distance_m) from runs), 0),
    'run_count', (select count(*) from runs),
    'active_members', (select count(distinct user_id) from runs),
    'new_members', (select count(*) from public.club_members where club_id = p_club and status = 'APPROVED' and joined_at >= p_start and joined_at < p_end),
    'top', coalesce((select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'name', private.display_name(p.user_id), 'distance_m', p.distance_m) order by p.rk)
                       from per p where p.rk <= 3), '[]'::jsonb),
    'points_top', coalesce((select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'name', private.display_name(p.user_id), 'points', p.points) order by p.rk)
                              from pts p where p.rk <= 3), '[]'::jsonb),
    'events', (select count(*) from public.club_events e where e.club_id = p_club and e.status <> 'CANCELLED' and e.starts_at >= p_start and e.starts_at < p_end),
    'checkins', (select count(*) from public.club_event_rsvps r join public.club_events e on e.id = r.event_id
                  where e.club_id = p_club and r.checked_in_at is not null and e.starts_at >= p_start and e.starts_at < p_end),
    'milestones', (select count(*) from public.club_posts x where x.club_id = p_club and x.kind = 'MILESTONE' and x.created_at >= p_start and x.created_at < p_end))
$$;

/** Đăng tổng kết một kỳ cho một CLB (kỳ đã kết thúc). Trả về id bài, null nếu đã có / không ai chạy */
create or replace function private.club_post_recap(p_club uuid, p_period text, p_start timestamptz) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_end timestamptz := case when p_period = 'MONTH' then p_start + interval '1 month' else p_start + interval '7 days' end;
  v_local timestamp := p_start at time zone 'Asia/Ho_Chi_Minh';
  v_key text := case when p_period = 'MONTH' then to_char(v_local, 'YYYY-"M"MM') else to_char(v_local, 'IYYY-"W"IW') end;
  v_meta jsonb;
  v_id uuid;
begin
  if exists (select 1 from public.club_posts x where x.club_id = p_club and x.kind = 'RECAP' and x.meta->>'week' = v_key) then return null; end if;
  v_meta := private.club_recap_meta(p_club, p_start, v_end);
  if (v_meta->>'run_count')::int = 0 then return null; end if;
  v_id := gen_random_uuid();
  insert into public.club_posts (id, club_id, kind, title, body, meta)
  values (v_id, p_club, 'RECAP',
          case when p_period = 'MONTH' then 'Tổng kết tháng ' || to_char(v_local, 'MM/YYYY') else 'Tổng kết tuần ' || to_char(v_local, 'DD/MM') end,
          '', v_meta || jsonb_build_object('week', v_key, 'period', p_period, 'from', p_start, 'to', v_end))
  on conflict (club_id, (meta->>'week')) where kind = 'RECAP' do nothing;
  if not found then return null; end if;
  return v_id;
end $$;

-- Cron (hằng ngày): tổng kết tuần trước cho CLB bật tổng kết tuần
create or replace function public.post_weekly_club_recaps() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_start timestamptz := private.period_start('WEEK') - interval '7 days';
  c record; n int := 0;
begin
  for c in select x.id from public.clubs x left join public.club_ops o on o.club_id = x.id where coalesce(o.recap_weekly, true) loop
    if private.club_post_recap(c.id, 'WEEK', v_start) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Cron (hằng ngày): tổng kết tháng trước cho CLB bật tổng kết tháng
create or replace function public.post_monthly_club_recaps() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_start timestamptz := ((date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') - interval '1 month') at time zone 'Asia/Ho_Chi_Minh');
  c record; n int := 0;
begin
  for c in select x.id from public.clubs x left join public.club_ops o on o.club_id = x.id where coalesce(o.recap_monthly, true) loop
    if private.club_post_recap(c.id, 'MONTH', v_start) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

/** Ban quản trị bấm "Đăng ngay": tổng kết tuần trước / tháng trước nếu chưa đăng */
create or replace function public.club_post_recap_now(p_club uuid, p_period text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_staff(p_club);
  v_id uuid;
begin
  if upper(coalesce(p_period, '')) not in ('WEEK', 'MONTH') then raise exception 'INVALID_PERIOD'; end if;
  v_id := private.club_post_recap(p_club, upper(p_period),
            case when upper(p_period) = 'MONTH' then ((date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') - interval '1 month') at time zone 'Asia/Ho_Chi_Minh')
                 else private.period_start('WEEK') - interval '7 days' end);
  if v_id is null then raise exception 'RECAP_NOT_POSTED'; end if;
  return v_id;
end $$;

create or replace function public.set_club_recap(p_club uuid, p_weekly boolean, p_monthly boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_staff(p_club);
begin
  insert into public.club_ops (club_id, recap_weekly, recap_monthly, updated_by, updated_at)
  values (p_club, coalesce(p_weekly, true), coalesce(p_monthly, true), v_uid, now())
  on conflict (club_id) do update set recap_weekly = excluded.recap_weekly, recap_monthly = excluded.recap_monthly,
                                      updated_by = excluded.updated_by, updated_at = now();
end $$;

-- ---------------------------------------------------------------------
-- 2. Bảng điều khiển ban quản trị
-- ---------------------------------------------------------------------
create or replace function public.club_admin_dashboard(p_club uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_staff(p_club);
  v_week timestamptz := private.period_start('WEEK');
begin
  return jsonb_build_object(
    'members', (select count(*) from public.club_members m where m.club_id = p_club and m.status = 'APPROVED'),
    'new_30d', (select count(*) from public.club_members m where m.club_id = p_club and m.status = 'APPROVED' and m.joined_at > now() - interval '30 days'),
    'pending', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', private.display_name(m.user_id), 'avatar_url', pr.avatar_url,
                                                            'requested_at', m.joined_at) order by m.joined_at)
                           from public.club_members m join public.profiles pr on pr.id = m.user_id
                          where m.club_id = p_club and m.status = 'PENDING'), '[]'::jsonb),
    -- Thành viên 30 ngày không có bài chạy hợp lệ: cần hỏi thăm
    'inactive', coalesce((select jsonb_agg(jsonb_build_object('user_id', t.user_id, 'name', private.display_name(t.user_id), 'avatar_url', t.avatar_url,
                                                             'last_run_at', t.last_run) order by t.last_run nulls first)
                            from (select m.user_id, pr.avatar_url,
                                         (select max(a.started_at) from public.activities a where a.user_id = m.user_id and a.validation_status = 'APPROVED'
                                            and coalesce(a.status, '') <> 'DELETED') as last_run
                                    from public.club_members m join public.profiles pr on pr.id = m.user_id
                                   where m.club_id = p_club and m.status = 'APPROVED' and m.joined_at < now() - interval '14 days') t
                           where t.last_run is null or t.last_run < now() - interval '30 days'), '[]'::jsonb),
    'this_week', private.club_recap_meta(p_club, v_week, now() + interval '1 minute'),
    'last_week', private.club_recap_meta(p_club, v_week - interval '7 days', v_week),
    'finance', jsonb_build_object(
      'balance', (select coalesce(sum(case when e.kind = 'EXPENSE' then -e.amount_vnd else e.amount_vnd end), 0)
                    from public.club_cash_entries e where e.club_id = p_club and e.voided_at is null),
      'claims', (select count(*) from public.club_due_payments p join public.club_dues d on d.id = p.due_id where d.club_id = p_club and p.status = 'CLAIMED'),
      'open_dues', (select count(*) from public.club_dues d where d.club_id = p_club and d.closed_at is null)),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at,
                                                           'going', (select count(*) from public.club_event_rsvps r where r.event_id = e.id and r.status = 'GOING'))
                                         order by e.starts_at)
                          from public.club_events e where e.club_id = p_club and e.status <> 'CANCELLED'
                           and e.starts_at > now() and e.starts_at < now() + interval '14 days'), '[]'::jsonb),
    'challenges', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'end_date', c.end_date,
                                                               'participants', (select count(*) from public.challenge_participants p where p.challenge_id = c.id and p.status <> 'LEFT'))
                                             order by c.end_date)
                              from public.challenges c where c.target_club_id = p_club and c.status = 'ACTIVE'), '[]'::jsonb),
    'draws', jsonb_build_object(
      'ready', (select count(*) from public.lucky_draws d where d.scope = 'CLUB' and d.ref_id = p_club and d.status = 'READY'),
      'live', (select count(*) from public.lucky_draws d where d.scope = 'CLUB' and d.ref_id = p_club and d.status = 'LIVE')),
    'points', jsonb_build_object(
      'has_rules', exists (select 1 from public.club_point_rules r where r.club_id = p_club),
      'top', coalesce((select jsonb_agg(jsonb_build_object('user_id', t.user_id, 'name', private.display_name(t.user_id), 'points', t.points) order by t.points desc)
                         from (select x.*, row_number() over (order by x.points desc) as rk from private.club_point_totals(p_club, v_week) x where x.points > 0) t
                        where t.rk <= 3), '[]'::jsonb)),
    'recap', jsonb_build_object(
      'weekly', coalesce((select o.recap_weekly from public.club_ops o where o.club_id = p_club), true),
      'monthly', coalesce((select o.recap_monthly from public.club_ops o where o.club_id = p_club), true)));
end $$;

revoke all on function private.club_recap_meta(uuid, timestamptz, timestamptz), private.club_post_recap(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.post_weekly_club_recaps(), public.post_monthly_club_recaps() from public, anon, authenticated;
grant execute on function public.post_weekly_club_recaps(), public.post_monthly_club_recaps() to service_role;
revoke all on function public.club_post_recap_now(uuid, text), public.set_club_recap(uuid, boolean, boolean), public.club_admin_dashboard(uuid) from public, anon;
grant execute on function public.club_post_recap_now(uuid, text), public.set_club_recap(uuid, boolean, boolean), public.club_admin_dashboard(uuid) to authenticated;

notify pgrst, 'reload schema';
