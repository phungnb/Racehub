-- 003600: Thách đấu CLB — nhiều CLB cùng tranh tài trong một khoảng thời gian (khác "CLB đấu CLB" 1–1 của 002600).
-- • Ai tạo:
--     - Ban quản trị CLB (Chủ nhiệm / Quản trị viên) tạo dưới tên CLB mình → mở đăng ký ngay, CLB chủ nhà tự vào.
--     - Admin hệ thống tạo → mở ngay (có thể không gắn CLB chủ nhà).
--     - Người dùng thường tạo → CHỜ ADMIN DUYỆT; admin duyệt / từ chối (có lý do), người tạo được báo.
-- • Ai đăng ký: chỉ ban quản trị của CLB đó (có "chìa khóa" CLB) mới đăng ký / rút CLB khỏi thách đấu.
-- • Tính điểm: tổng km hoặc km trung bình mỗi thành viên, chỉ bài APPROVED trong khung giờ, sau khi người đó vào CLB.
--   Một người ở nhiều CLB cùng tham gia → chỉ tính cho CLB họ vào sớm nhất (không "đếm hai lần").
-- • Hết giờ + 2 giờ → tất toán (cron hằng ngày + khi có người mở trang), báo hạng cho thành viên các CLB.
-- Cần file 002600 (và chạy lại 003500 để trang Kiểm tra hệ thống nhận file này). Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

create table if not exists public.club_cups (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  prize text,
  metric text not null default 'AVG_KM',
  start_at timestamptz not null,
  end_at timestamptz not null,
  reg_close_at timestamptz not null,
  max_clubs integer not null default 20,
  host_club_id uuid references public.clubs(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  status text not null default 'PENDING_REVIEW',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  result jsonb,
  settled_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.club_cups drop constraint if exists club_cups_metric_chk;
alter table public.club_cups add constraint club_cups_metric_chk check (metric in ('TOTAL_KM', 'AVG_KM'));
alter table public.club_cups drop constraint if exists club_cups_status_chk;
alter table public.club_cups add constraint club_cups_status_chk
  check (status in ('PENDING_REVIEW', 'OPEN', 'REJECTED', 'CANCELLED', 'FINISHED'));
alter table public.club_cups drop constraint if exists club_cups_time_chk;
alter table public.club_cups add constraint club_cups_time_chk check (end_at > start_at and reg_close_at <= end_at);
alter table public.club_cups drop constraint if exists club_cups_max_chk;
alter table public.club_cups add constraint club_cups_max_chk check (max_clubs between 2 and 200);
create index if not exists club_cups_status_idx on public.club_cups (status, start_at desc);

create table if not exists public.club_cup_entries (
  cup_id uuid not null references public.club_cups(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  registered_by uuid references public.profiles(id) on delete set null,
  registered_at timestamptz not null default now(),
  primary key (cup_id, club_id)
);
create index if not exists club_cup_entries_club_idx on public.club_cup_entries (club_id);

-- Chỉ đọc / ghi qua RPC
alter table public.club_cups enable row level security;
alter table public.club_cup_entries enable row level security;
revoke all on public.club_cups, public.club_cup_entries from anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Bảng điểm: mỗi CLB tham gia; người ở nhiều CLB chỉ tính cho CLB vào sớm nhất
-- ---------------------------------------------------------------------
create or replace function private.cup_standings(p_cup uuid, p_start timestamptz, p_end timestamptz, p_metric text) returns jsonb
language sql stable security definer set search_path = public as $$
  with e as (
    select ce.club_id from public.club_cup_entries ce where ce.cup_id = p_cup
  ), mem as (
    select m.club_id, m.user_id, m.joined_at,
           row_number() over (partition by m.user_id order by m.joined_at nulls first, m.club_id) as k
      from public.club_members m join e on e.club_id = m.club_id
     where m.status = 'APPROVED'
  ), m1 as (
    select * from mem where k = 1
  ), runs as (
    select m1.club_id, a.user_id, sum(a.distance_m) as meters
      from public.activities a join m1 on m1.user_id = a.user_id
     where p_end > p_start
       and a.validation_status = 'APPROVED' and coalesce(a.status, '') <> 'DELETED'
       and a.started_at >= p_start and a.started_at < p_end
       and a.started_at >= coalesce(m1.joined_at, '-infinity'::timestamptz)
     group by m1.club_id, a.user_id
  ), agg as (
    select e.club_id,
           (select count(*) from m1 where m1.club_id = e.club_id) as members,
           (select count(*) from runs r where r.club_id = e.club_id) as runners,
           coalesce((select sum(r.meters) from runs r where r.club_id = e.club_id), 0) as meters
      from e
  ), scored as (
    select agg.*, round(agg.meters / 1000.0, 2) as km,
           round(agg.meters / 1000.0 / greatest(agg.members, 1), 2) as avg_km
      from agg
  ), ranked as (
    select s.*, rank() over (order by case when p_metric = 'TOTAL_KM' then s.km else s.avg_km end desc) as rnk from scored s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'rank', r.rnk, 'club_id', c.id, 'name', c.name, 'avatar_url', c.avatar_url, 'accent_color', c.accent_color,
           'members', r.members, 'runners', r.runners, 'km', r.km, 'avg_km', r.avg_km,
           'score', case when p_metric = 'TOTAL_KM' then r.km else r.avg_km end)
         order by r.rnk, c.name), '[]'::jsonb)
    from ranked r join public.clubs c on c.id = r.club_id
$$;

create or replace function private.cup_json(u public.club_cups, p_full boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', u.id, 'title', u.title, 'description', u.description, 'prize', u.prize, 'metric', u.metric,
    'start_at', u.start_at, 'end_at', u.end_at, 'reg_close_at', u.reg_close_at, 'max_clubs', u.max_clubs,
    'status', u.status, 'review_note', u.review_note, 'created_at', u.created_at, 'settled_at', u.settled_at,
    'host', (select jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url, 'accent_color', c.accent_color)
               from public.clubs c where c.id = u.host_club_id),
    'creator', (select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url)
                  from public.profiles p where p.id = u.created_by),
    'clubs', (select count(*) from public.club_cup_entries ce where ce.cup_id = u.id),
    -- CLB của tôi đã vào / CLB tôi quản trị (để đăng ký)
    'my_clubs', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url, 'accent_color', c.accent_color,
                         'staff', m.role in ('OWNER', 'CAPTAIN'),
                         'joined', exists (select 1 from public.club_cup_entries ce where ce.cup_id = u.id and ce.club_id = c.id))
                       order by c.name), '[]'::jsonb)
                   from public.club_members m join public.clubs c on c.id = m.club_id
                  where m.user_id = auth.uid() and m.status = 'APPROVED'),
    'can_manage', u.created_by = auth.uid() or public.is_system_admin()
                  or (u.host_club_id is not null and public.club_is_staff(u.host_club_id)),
    'can_review', public.is_system_admin(),
    'standings', case when p_full then coalesce(u.result->'standings',
                   private.cup_standings(u.id, u.start_at, least(u.end_at, greatest(now(), u.start_at)), u.metric)) end)
$$;

create or replace function private.cup_visible(u public.club_cups) returns boolean
language sql stable security definer set search_path = public as $$
  select u.status in ('OPEN', 'FINISHED', 'CANCELLED') or u.created_by = auth.uid() or public.is_system_admin()
      or (u.host_club_id is not null and public.club_is_staff(u.host_club_id))
$$;

-- ---------------------------------------------------------------------
-- 2. Tạo: BQT CLB / admin → mở ngay; người thường → chờ admin duyệt
-- ---------------------------------------------------------------------
create or replace function public.create_club_cup(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_id uuid := gen_random_uuid();
  v_host uuid := nullif(p->>'host_club_id', '')::uuid;
  v_admin boolean := public.is_system_admin();
  v_title text := trim(coalesce(p->>'title', ''));
  v_start timestamptz := (p->>'start_at')::timestamptz;
  v_end timestamptz := (p->>'end_at')::timestamptz;
  v_close timestamptz := coalesce(nullif(p->>'reg_close_at', '')::timestamptz, (p->>'start_at')::timestamptz);
  v_metric text := upper(coalesce(p->>'metric', 'AVG_KM'));
  v_max integer := coalesce((p->>'max_clubs')::integer, 20);
  v_status text;
  v_name text := private.display_name(private.require_uid());
  a record;
begin
  if char_length(v_title) < 3 or char_length(v_title) > 120 then raise exception 'INVALID_TITLE'; end if;
  if v_metric not in ('TOTAL_KM', 'AVG_KM') then raise exception 'INVALID_METRIC'; end if;
  if v_start is null or v_end is null or v_end <= v_start then raise exception 'INVALID_TIME_RANGE'; end if;
  if v_start < now() - interval '10 minutes' then raise exception 'START_IN_PAST'; end if;
  if v_end - v_start < interval '1 day' or v_end - v_start > interval '93 days' then raise exception 'INVALID_DURATION'; end if;
  if v_close < now() or v_close > v_end then raise exception 'INVALID_REG_CLOSE'; end if;
  if v_max < 2 or v_max > 200 then raise exception 'INVALID_MAX'; end if;
  if v_host is not null and not public.club_is_staff(v_host) and not v_admin then raise exception 'FORBIDDEN'; end if;
  if (select count(*) from public.club_cups u where u.created_by = v_uid and u.created_at > now() - interval '1 day') >= 5 then
    raise exception 'RATE_LIMITED';
  end if;

  v_status := case when v_admin or v_host is not null then 'OPEN' else 'PENDING_REVIEW' end;
  insert into public.club_cups (id, title, description, prize, metric, start_at, end_at, reg_close_at, max_clubs, host_club_id, created_by, status,
                                reviewed_by, reviewed_at)
  values (v_id, v_title, nullif(left(trim(coalesce(p->>'description', '')), 1000), ''), nullif(left(trim(coalesce(p->>'prize', '')), 200), ''),
          v_metric, v_start, v_end, v_close, v_max, v_host, v_uid, v_status,
          case when v_status = 'OPEN' then v_uid end, case when v_status = 'OPEN' then now() end);

  if v_host is not null then
    insert into public.club_cup_entries (cup_id, club_id, registered_by) values (v_id, v_host, v_uid);
  end if;
  if v_status = 'PENDING_REVIEW' then
    for a in select pr.id from public.profiles pr where pr.role = 'SYSTEM_ADMIN' loop
      perform private.notify(a.id, null, 'CLUB_CUP', 'Thách đấu CLB chờ duyệt: ' || v_title,
        v_name || ' vừa tạo. Vào Quản trị → Thách đấu để duyệt.', '/cups/' || v_id, v_uid, true);
    end loop;
  end if;
  return private.cup_json((select u from public.club_cups u where u.id = v_id), false);
end $$;

-- Admin duyệt / từ chối thách đấu do người dùng thường tạo
create or replace function public.review_club_cup(p_cup_id uuid, p_approve boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  u public.club_cups := (select x from public.club_cups x where x.id = p_cup_id);
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  if u.id is null then raise exception 'CUP_NOT_FOUND'; end if;
  if u.status <> 'PENDING_REVIEW' then raise exception 'CUP_NOT_PENDING'; end if;
  if not p_approve and char_length(trim(coalesce(p_note, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if p_approve and u.reg_close_at < now() then raise exception 'INVALID_REG_CLOSE'; end if;
  update public.club_cups set status = case when p_approve then 'OPEN' else 'REJECTED' end,
         reviewed_by = v_uid, reviewed_at = now(), review_note = nullif(trim(coalesce(p_note, '')), '')
   where id = u.id;
  if u.created_by is not null then
    perform private.notify(u.created_by, null, 'CLUB_CUP',
      case when p_approve then 'Thách đấu "' || u.title || '" đã được duyệt' else 'Thách đấu "' || u.title || '" chưa được duyệt' end,
      case when p_approve then 'Ban quản trị các CLB có thể đăng ký ngay.' else trim(p_note) end,
      '/cups/' || u.id, v_uid, true);
  end if;
  return private.cup_json((select x from public.club_cups x where x.id = u.id), false);
end $$;

-- Người tạo / BQT CLB chủ nhà / admin hủy trước giờ bắt đầu
create or replace function public.cancel_club_cup(p_cup_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  u public.club_cups := (select x from public.club_cups x where x.id = p_cup_id);
  e record;
begin
  if u.id is null then raise exception 'CUP_NOT_FOUND'; end if;
  if not (u.created_by = v_uid or public.is_system_admin() or (u.host_club_id is not null and public.club_is_staff(u.host_club_id))) then
    raise exception 'FORBIDDEN';
  end if;
  if u.status not in ('PENDING_REVIEW', 'OPEN') then raise exception 'CUP_NOT_OPEN'; end if;
  if u.status = 'OPEN' and now() >= u.start_at and not public.is_system_admin() then raise exception 'CUP_STARTED'; end if;
  update public.club_cups set status = 'CANCELLED' where id = u.id;
  for e in select ce.club_id from public.club_cup_entries ce where ce.cup_id = u.id loop
    perform private.notify_club(e.club_id, true, 'CLUB_CUP', 'Thách đấu "' || u.title || '" đã hủy', null, '/cups/' || u.id, v_uid);
  end loop;
  return private.cup_json((select x from public.club_cups x where x.id = u.id), false);
end $$;

-- ---------------------------------------------------------------------
-- 3. Đăng ký / rút CLB — chỉ ban quản trị của CLB đó
-- ---------------------------------------------------------------------
create or replace function public.join_club_cup(p_cup_id uuid, p_club_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  u public.club_cups := (select x from public.club_cups x where x.id = p_cup_id for update);
  v_club text := (select c.name from public.clubs c where c.id = p_club_id);
begin
  if u.id is null or not private.cup_visible(u) then raise exception 'CUP_NOT_FOUND'; end if;
  if v_club is null then raise exception 'CLUB_NOT_FOUND'; end if;
  if not public.club_is_staff(p_club_id) then raise exception 'CLUB_STAFF_REQUIRED'; end if;
  if u.status <> 'OPEN' then raise exception 'CUP_NOT_OPEN'; end if;
  if now() > u.reg_close_at then raise exception 'REGISTRATION_CLOSED'; end if;
  if exists (select 1 from public.club_cup_entries ce where ce.cup_id = u.id and ce.club_id = p_club_id) then raise exception 'ALREADY_JOINED'; end if;
  if (select count(*) from public.club_cup_entries ce where ce.cup_id = u.id) >= u.max_clubs then raise exception 'CUP_FULL'; end if;
  insert into public.club_cup_entries (cup_id, club_id, registered_by) values (u.id, p_club_id, v_uid);
  perform private.notify_club(p_club_id, false, 'CLUB_CUP', v_club || ' tham gia thách đấu "' || u.title || '"',
    'Mọi km hợp lệ từ ' || to_char(u.start_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI') || ' đều tính cho CLB. Chạy thôi!',
    '/cups/' || u.id, v_uid);
  if u.created_by is not null and u.created_by <> v_uid then
    perform private.notify(u.created_by, null, 'CLUB_CUP', v_club || ' đã đăng ký "' || u.title || '"', null, '/cups/' || u.id, v_uid, false);
  end if;
  return private.cup_json((select x from public.club_cups x where x.id = u.id), true);
end $$;

create or replace function public.leave_club_cup(p_cup_id uuid, p_club_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  u public.club_cups := (select x from public.club_cups x where x.id = p_cup_id);
begin
  if u.id is null then raise exception 'CUP_NOT_FOUND'; end if;
  if not public.club_is_staff(p_club_id) then raise exception 'CLUB_STAFF_REQUIRED'; end if;
  if now() >= u.start_at then raise exception 'CUP_STARTED'; end if;
  delete from public.club_cup_entries where cup_id = u.id and club_id = p_club_id;
  return private.cup_json((select x from public.club_cups x where x.id = u.id), true);
end $$;

-- ---------------------------------------------------------------------
-- 4. Xem
-- ---------------------------------------------------------------------
-- p_scope: ACTIVE (đang mở đăng ký / đang diễn ra), MINE (CLB tôi tham gia / tôi tạo), DONE (đã xong), REVIEW (admin: chờ duyệt)
create or replace function public.list_club_cups(p_scope text default 'ACTIVE') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  if p_scope = 'REVIEW' and not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(private.cup_json(x.cup, false) order by x.rn), '[]'::jsonb) from (
    select u as cup, row_number() over (order by
             case when p_scope = 'DONE' then extract(epoch from u.end_at) * -1 else extract(epoch from u.start_at) end) as rn
      from public.club_cups u
     where private.cup_visible(u)
       and case p_scope
             when 'ACTIVE' then u.status = 'OPEN' and u.end_at > now() - interval '2 hours'
             when 'DONE' then u.status in ('FINISHED', 'CANCELLED') or (u.status = 'OPEN' and u.end_at <= now() - interval '2 hours')
             when 'REVIEW' then u.status = 'PENDING_REVIEW'
             else u.created_by = v_uid
               or exists (select 1 from public.club_cup_entries ce join public.club_members m on m.club_id = ce.club_id
                           where ce.cup_id = u.id and m.user_id = v_uid and m.status = 'APPROVED')
           end) x
   where x.rn <= 60);
end $$;

create or replace function public.club_cup(p_cup_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u public.club_cups := (select x from public.club_cups x where x.id = p_cup_id);
begin
  if u.id is null or not private.cup_visible(u) then raise exception 'CUP_NOT_FOUND'; end if;
  if u.status = 'OPEN' and u.end_at < now() - interval '2 hours' then
    perform public.settle_due_club_cups();
    u := (select x from public.club_cups x where x.id = p_cup_id);
  end if;
  return private.cup_json(u, true);
end $$;

-- ---------------------------------------------------------------------
-- 5. Tất toán (cron hằng ngày + khi mở trang). Idempotent.
-- ---------------------------------------------------------------------
create or replace function public.settle_due_club_cups() returns integer
language plpgsql security definer set search_path = public as $$
declare
  u record; s jsonb; r jsonb; n integer := 0; v_total integer; v_msg text;
begin
  for u in select * from public.club_cups x where x.status = 'OPEN' and x.end_at < now() - interval '2 hours'
           for update skip locked loop
    s := private.cup_standings(u.id, u.start_at, u.end_at, u.metric);
    update public.club_cups set status = 'FINISHED', settled_at = now(), result = jsonb_build_object('standings', s) where id = u.id;
    v_total := jsonb_array_length(s);
    for r in select value from jsonb_array_elements(s) loop
      v_msg := case when (r->>'rank')::int = 1 then 'CLB vô địch "' || u.title || '"! 🏆'
                    else 'CLB xếp hạng ' || (r->>'rank') || '/' || v_total || ' tại "' || u.title || '"' end;
      perform private.notify_club((r->>'club_id')::uuid, false, 'CLUB_CUP', v_msg,
        case when u.metric = 'TOTAL_KM' then 'Tổng ' || (r->>'km') || ' km' else (r->>'avg_km') || ' km trung bình / thành viên' end
          || ' · ' || (r->>'runners') || ' người chạy', '/cups/' || u.id, null);
    end loop;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 6. Quyền
-- ---------------------------------------------------------------------
revoke all on function private.cup_standings(uuid, timestamptz, timestamptz, text), private.cup_json(public.club_cups, boolean),
  private.cup_visible(public.club_cups) from public, anon, authenticated;
revoke all on function public.create_club_cup(jsonb), public.review_club_cup(uuid, boolean, text), public.cancel_club_cup(uuid),
  public.join_club_cup(uuid, uuid), public.leave_club_cup(uuid, uuid), public.list_club_cups(text), public.club_cup(uuid),
  public.settle_due_club_cups() from public, anon;
grant execute on function public.create_club_cup(jsonb), public.review_club_cup(uuid, boolean, text), public.cancel_club_cup(uuid),
  public.join_club_cup(uuid, uuid), public.leave_club_cup(uuid, uuid), public.list_club_cups(text), public.club_cup(uuid) to authenticated;
revoke all on function public.settle_due_club_cups() from authenticated;

notify pgrst, 'reload schema';
