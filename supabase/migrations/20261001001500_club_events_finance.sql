-- =====================================================================
-- 20261001001500 — CLB HOÀN CHỈNH: SỰ KIỆN, ĐIỂM DANH, THU CHI, BÌNH CHỌN (Sprint 5 · CLB-20 → CLB-24)
--
--   * Sự kiện chạy nhóm: ban quản trị tạo; thành viên báo tham gia (RSVP); nhắc trước 12 giờ
--   * Điểm danh: QR ký HMAC hết hạn 15 phút (link mở bằng camera điện thoại)
--                + tự điểm danh từ bài chạy (±30 phút quanh giờ hẹn, ≤ 500 m nếu có GPS)
--                + ban quản trị điểm danh tay
--   * Thu chi (tiền VND, tách khỏi quỹ Xu): tài khoản ngân hàng CLB (VietQR), kỳ thu phí, thành viên báo
--     đã chuyển → thủ quỹ xác nhận, khoản thu/chi có ảnh hóa đơn, hủy có lý do; tất cả công khai trong CLB
--   * Bình chọn: câu hỏi + 2–10 lựa chọn, một hoặc nhiều lựa chọn, hạn chót, ẩn kết quả tới khi đóng
--   * Huy hiệu chạy nhóm 1 / 5 / 20 lần
-- Phụ thuộc: 000500 (CLB), 000800 (game). Idempotent.
-- Viết để chạy được trong SQL Editor của Supabase: không dùng SELECT ... INTO, khối DO, LIMIT.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Bảng
-- ---------------------------------------------------------------------
create table if not exists public.club_events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  title text not null check (char_length(title) between 3 and 80),
  description text check (description is null or char_length(description) <= 1000),
  starts_at timestamptz not null,
  duration_min integer not null default 90 check (duration_min between 15 and 720),
  location_name text check (location_name is null or char_length(location_name) <= 120),
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  distance_km numeric(5, 1) check (distance_km is null or (distance_km > 0 and distance_km <= 200)),
  pace_text text check (pace_text is null or char_length(pace_text) <= 40),
  capacity integer check (capacity is null or capacity between 2 and 1000),
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED', 'CANCELLED')),
  cancel_reason text,
  reminded_at timestamptz,
  created_at timestamptz not null default now(),
  check ((lat is null) = (lng is null))
);
create index if not exists club_events_club_idx on public.club_events (club_id, starts_at);

-- Khóa ký QR điểm danh: nằm ở schema private, thành viên không đọc được
create table if not exists private.club_event_secrets (
  event_id uuid primary key references public.club_events(id) on delete cascade,
  secret text not null
);

create table if not exists public.club_event_rsvps (
  event_id uuid not null references public.club_events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('GOING', 'MAYBE', 'NOT_GOING')),
  checked_in_at timestamptz,
  checkin_method text check (checkin_method is null or checkin_method in ('QR', 'AUTO', 'STAFF')),
  activity_id uuid,
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index if not exists club_event_rsvps_user_idx on public.club_event_rsvps (user_id) where checked_in_at is not null;

alter table public.clubs add column if not exists bank_bin text;
alter table public.clubs add column if not exists bank_account_no text;
alter table public.clubs add column if not exists bank_account_name text;

create table if not exists public.club_dues (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 80),
  amount_vnd integer not null check (amount_vnd between 1000 and 100000000),
  due_date date,
  note text check (note is null or char_length(note) <= 300),
  created_by uuid references public.profiles(id) on delete set null,
  reminded_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists club_dues_club_idx on public.club_dues (club_id, created_at desc);

create table if not exists public.club_due_payments (
  due_id uuid not null references public.club_dues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'UNPAID' check (status in ('UNPAID', 'CLAIMED', 'CONFIRMED', 'EXEMPT')),
  claimed_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (due_id, user_id)
);

create table if not exists public.club_cash_entries (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  kind text not null check (kind in ('DUE', 'INCOME', 'EXPENSE')),
  amount_vnd bigint not null check (amount_vnd > 0 and amount_vnd <= 1000000000),
  title text not null check (char_length(title) between 2 and 80),
  note text check (note is null or char_length(note) <= 300),
  receipt_url text check (receipt_url is null or receipt_url ~ '^https://'),
  due_id uuid references public.club_dues(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles(id) on delete set null,
  void_reason text
);
create index if not exists club_cash_entries_club_idx on public.club_cash_entries (club_id, created_at desc);
create unique index if not exists club_cash_entries_due_uidx on public.club_cash_entries (due_id, user_id)
  where kind = 'DUE' and voided_at is null;

create table if not exists public.club_polls (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  question text not null check (char_length(question) between 3 and 200),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 10),
  multi boolean not null default false,
  hide_results boolean not null default false,
  closes_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists club_polls_club_idx on public.club_polls (club_id, created_at desc);

create table if not exists public.club_poll_votes (
  poll_id uuid not null references public.club_polls(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  choices integer[] not null check (cardinality(choices) between 1 and 10),
  voted_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);

-- Đọc: thành viên CLB (qua RLS); ghi: chỉ qua RPC
alter table public.club_events enable row level security;
alter table public.club_event_rsvps enable row level security;
alter table public.club_dues enable row level security;
alter table public.club_due_payments enable row level security;
alter table public.club_cash_entries enable row level security;
alter table public.club_polls enable row level security;
alter table public.club_poll_votes enable row level security;

drop policy if exists club_events_read on public.club_events;
create policy club_events_read on public.club_events for select to authenticated using (public.club_is_member(club_id));
drop policy if exists club_event_rsvps_read on public.club_event_rsvps;
create policy club_event_rsvps_read on public.club_event_rsvps for select to authenticated
  using (exists (select 1 from public.club_events e where e.id = event_id and public.club_is_member(e.club_id)));
drop policy if exists club_dues_read on public.club_dues;
create policy club_dues_read on public.club_dues for select to authenticated using (public.club_is_member(club_id));
drop policy if exists club_due_payments_read on public.club_due_payments;
create policy club_due_payments_read on public.club_due_payments for select to authenticated
  using (exists (select 1 from public.club_dues d where d.id = due_id and public.club_is_member(d.club_id)));
drop policy if exists club_cash_entries_read on public.club_cash_entries;
create policy club_cash_entries_read on public.club_cash_entries for select to authenticated using (public.club_is_member(club_id));
drop policy if exists club_polls_read on public.club_polls;
create policy club_polls_read on public.club_polls for select to authenticated using (public.club_is_member(club_id));
-- Phiếu bầu: chỉ thấy phiếu của mình (kết quả xem qua RPC, tôn trọng "ẩn kết quả")
drop policy if exists club_poll_votes_read on public.club_poll_votes;
create policy club_poll_votes_read on public.club_poll_votes for select to authenticated using (user_id = auth.uid());

revoke all on public.club_events, public.club_event_rsvps, public.club_dues, public.club_due_payments,
  public.club_cash_entries, public.club_polls, public.club_poll_votes from anon;
revoke insert, update, delete on public.club_events, public.club_event_rsvps, public.club_dues, public.club_due_payments,
  public.club_cash_entries, public.club_polls, public.club_poll_votes from authenticated;
grant select on public.club_events, public.club_event_rsvps, public.club_dues, public.club_due_payments,
  public.club_cash_entries, public.club_polls, public.club_poll_votes to authenticated;
revoke all on private.club_event_secrets from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Hàm nội bộ
-- ---------------------------------------------------------------------
create or replace function private.require_member(p_club uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  if not public.club_is_member(p_club) then raise exception 'NOT_A_MEMBER'; end if;
  return v_uid;
end $$;

create or replace function private.require_staff(p_club uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  if not public.club_is_staff(p_club) then raise exception 'FORBIDDEN'; end if;
  return v_uid;
end $$;

-- Chữ ký QR: 24 ký tự hex đầu của HMAC-SHA256(event_id.exp, secret)
create or replace function private.event_sig(p_event uuid, p_exp bigint) returns text
language sql stable security definer set search_path = public, extensions as $$
  select left(encode(extensions.hmac(p_event::text || '.' || p_exp::text, s.secret, 'sha256'), 'hex'), 24)
    from private.club_event_secrets s where s.event_id = p_event
$$;

create or replace function private.event_json(e public.club_events, p_uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', e.id, 'club_id', e.club_id, 'title', e.title, 'description', e.description, 'starts_at', e.starts_at,
    'ends_at', e.starts_at + make_interval(mins => e.duration_min), 'duration_min', e.duration_min,
    'location_name', e.location_name, 'lat', e.lat, 'lng', e.lng, 'distance_km', e.distance_km, 'pace_text', e.pace_text,
    'capacity', e.capacity, 'status', e.status, 'cancel_reason', e.cancel_reason,
    'created_by', e.created_by, 'creator_name', (select display_name from public.profiles where id = e.created_by),
    'going_count', (select count(*) from public.club_event_rsvps r where r.event_id = e.id and r.status = 'GOING'),
    'maybe_count', (select count(*) from public.club_event_rsvps r where r.event_id = e.id and r.status = 'MAYBE'),
    'checked_in_count', (select count(*) from public.club_event_rsvps r where r.event_id = e.id and r.checked_in_at is not null),
    'my_status', (select r.status from public.club_event_rsvps r where r.event_id = e.id and r.user_id = p_uid),
    'my_checked_in_at', (select r.checked_in_at from public.club_event_rsvps r where r.event_id = e.id and r.user_id = p_uid))
$$;

-- Điểm danh (dùng chung cho QR / tự động / ban quản trị). Trả về true nếu là lần điểm danh mới.
create or replace function private.event_mark_checkin(p_event uuid, p_user uuid, p_method text, p_activity uuid default null)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_new boolean;
begin
  v_new := not exists (select 1 from public.club_event_rsvps where event_id = p_event and user_id = p_user and checked_in_at is not null);
  insert into public.club_event_rsvps (event_id, user_id, status, checked_in_at, checkin_method, activity_id)
  values (p_event, p_user, 'GOING', now(), p_method, p_activity)
  on conflict (event_id, user_id) do update set
    status = 'GOING',
    checked_in_at = coalesce(public.club_event_rsvps.checked_in_at, now()),
    checkin_method = coalesce(public.club_event_rsvps.checkin_method, excluded.checkin_method),
    activity_id = coalesce(public.club_event_rsvps.activity_id, excluded.activity_id),
    updated_at = now();
  if v_new then
    begin
      perform private.evaluate_achievements(p_user);       -- huy hiệu chạy nhóm
    exception when others then null;
    end;
  end if;
  return v_new;
end $$;

-- Nhắc sự kiện trong 12 giờ tới (idempotent theo reminded_at). p_club null = mọi CLB.
create or replace function private.remind_events(p_club uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare e record; r record; v_count integer := 0;
begin
  for e in select * from public.club_events
            where status = 'SCHEDULED' and reminded_at is null
              and starts_at between now() and now() + interval '12 hours'
              and (p_club is null or club_id = p_club)
            for update skip locked loop
    for r in select user_id from public.club_event_rsvps where event_id = e.id and status in ('GOING', 'MAYBE') loop
      perform private.notify(r.user_id, e.club_id, 'CLUB_EVENT', 'Sắp tới: ' || e.title,
        to_char(e.starts_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM') || coalesce(' · ' || e.location_name, ''),
        '/clubs/' || e.club_id || '/events/' || e.id, null, true);
    end loop;
    update public.club_events set reminded_at = now() where id = e.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- 3. RPC sự kiện
-- ---------------------------------------------------------------------
-- p: {title, description, starts_at, duration_min, location_name, lat, lng, distance_km, pace_text, capacity}
create or replace function private.event_fields(p jsonb) returns public.club_events
language plpgsql immutable as $$
declare e public.club_events;
begin
  begin
    e.title := trim(p->>'title');
    e.description := nullif(trim(coalesce(p->>'description', '')), '');
    e.starts_at := (p->>'starts_at')::timestamptz;
    e.duration_min := coalesce((p->>'duration_min')::integer, 90);
    e.location_name := nullif(trim(coalesce(p->>'location_name', '')), '');
    e.lat := nullif(p->>'lat', '')::double precision;
    e.lng := nullif(p->>'lng', '')::double precision;
    e.distance_km := nullif(p->>'distance_km', '')::numeric;
    e.pace_text := nullif(trim(coalesce(p->>'pace_text', '')), '');
    e.capacity := nullif(p->>'capacity', '')::integer;
  exception when others then
    raise exception 'INVALID_EVENT';
  end;
  if e.title is null or char_length(e.title) not between 3 and 80 then raise exception 'INVALID_TITLE'; end if;
  if e.starts_at is null then raise exception 'INVALID_TIME'; end if;
  if e.duration_min not between 15 and 720 then raise exception 'INVALID_EVENT'; end if;
  if (e.lat is null) <> (e.lng is null) then raise exception 'INVALID_LOCATION'; end if;
  if e.distance_km is not null and (e.distance_km <= 0 or e.distance_km > 200) then raise exception 'INVALID_EVENT'; end if;
  if e.capacity is not null and e.capacity not between 2 and 1000 then raise exception 'INVALID_EVENT'; end if;
  return e;
end $$;

create or replace function public.create_club_event(p_club_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := private.require_staff(p_club_id);
  f public.club_events := private.event_fields(p);
  v_id uuid := gen_random_uuid();
  m record;
begin
  if f.starts_at < now() - interval '1 hour' then raise exception 'INVALID_TIME'; end if;
  insert into public.club_events (id, club_id, created_by, title, description, starts_at, duration_min, location_name, lat, lng,
                                  distance_km, pace_text, capacity)
  values (v_id, p_club_id, v_uid, f.title, f.description, f.starts_at, f.duration_min, f.location_name, f.lat, f.lng,
          f.distance_km, f.pace_text, f.capacity);
  insert into private.club_event_secrets (event_id, secret) values (v_id, encode(extensions.gen_random_bytes(24), 'hex'));
  -- người tạo mặc định tham gia
  insert into public.club_event_rsvps (event_id, user_id, status) values (v_id, v_uid, 'GOING');
  for m in select user_id from public.club_members where club_id = p_club_id and status = 'APPROVED' and user_id <> v_uid loop
    perform private.notify(m.user_id, p_club_id, 'CLUB_EVENT', 'Sự kiện mới: ' || f.title,
      to_char(f.starts_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM') || coalesce(' · ' || f.location_name, ''),
      '/clubs/' || p_club_id || '/events/' || v_id, v_uid, true);
  end loop;
  return private.event_json((select e from public.club_events e where e.id = v_id), v_uid);
end $$;

create or replace function public.update_club_event(p_event_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e public.club_events := (select x from public.club_events x where x.id = p_event_id);
  v_uid uuid;
  f public.club_events := private.event_fields(p);
begin
  if e.id is null then raise exception 'EVENT_NOT_FOUND'; end if;
  v_uid := private.require_staff(e.club_id);
  if e.status = 'CANCELLED' then raise exception 'EVENT_CANCELLED'; end if;
  update public.club_events set title = f.title, description = f.description, starts_at = f.starts_at,
         duration_min = f.duration_min, location_name = f.location_name, lat = f.lat, lng = f.lng,
         distance_km = f.distance_km, pace_text = f.pace_text, capacity = f.capacity,
         reminded_at = case when f.starts_at <> e.starts_at then null else reminded_at end
   where id = p_event_id;
  return private.event_json((select x from public.club_events x where x.id = p_event_id), v_uid);
end $$;

create or replace function public.cancel_club_event(p_event_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  e public.club_events := (select x from public.club_events x where x.id = p_event_id);
  v_uid uuid;
  r record;
begin
  if e.id is null then raise exception 'EVENT_NOT_FOUND'; end if;
  v_uid := private.require_staff(e.club_id);
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  update public.club_events set status = 'CANCELLED', cancel_reason = trim(p_reason) where id = p_event_id;
  for r in select user_id from public.club_event_rsvps where event_id = p_event_id and status in ('GOING', 'MAYBE') and user_id <> v_uid loop
    perform private.notify(r.user_id, e.club_id, 'CLUB_EVENT', 'Đã hủy: ' || e.title, trim(p_reason),
      '/clubs/' || e.club_id || '/events/' || e.id, v_uid, true);
  end loop;
end $$;

create or replace function public.rsvp_club_event(p_event_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e public.club_events := (select x from public.club_events x where x.id = p_event_id);
  v_uid uuid;
begin
  if e.id is null then raise exception 'EVENT_NOT_FOUND'; end if;
  v_uid := private.require_member(e.club_id);
  if p_status not in ('GOING', 'MAYBE', 'NOT_GOING') then raise exception 'INVALID_STATUS'; end if;
  if e.status = 'CANCELLED' then raise exception 'EVENT_CANCELLED'; end if;
  if now() > e.starts_at + make_interval(mins => e.duration_min) then raise exception 'EVENT_ENDED'; end if;
  if p_status = 'GOING' and e.capacity is not null
     and (select count(*) from public.club_event_rsvps where event_id = e.id and status = 'GOING' and user_id <> v_uid) >= e.capacity then
    raise exception 'EVENT_FULL';
  end if;
  insert into public.club_event_rsvps (event_id, user_id, status) values (e.id, v_uid, p_status)
  on conflict (event_id, user_id) do update set status = excluded.status, updated_at = now();
  return private.event_json(e, v_uid);
end $$;

-- Danh sách sự kiện: UPCOMING (chưa kết thúc) tăng dần; PAST giảm dần (tối đa 50)
create or replace function public.club_events(p_club_id uuid, p_scope text default 'UPCOMING') returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_member(p_club_id);
begin
  perform private.remind_events(p_club_id);             -- nhắc lười: không phải chờ cron
  if p_scope = 'PAST' then
    return (select coalesce(jsonb_agg(private.event_json(x, v_uid) order by x.starts_at desc), '[]'::jsonb)
              from (select e.*, row_number() over (order by e.starts_at desc) as rn
                      from public.club_events e
                     where e.club_id = p_club_id and e.starts_at + make_interval(mins => e.duration_min) < now()) q
              join public.club_events x on x.id = q.id
             where q.rn <= 50);
  end if;
  return (select coalesce(jsonb_agg(private.event_json(e, v_uid) order by e.starts_at), '[]'::jsonb)
            from public.club_events e
           where e.club_id = p_club_id and e.starts_at + make_interval(mins => e.duration_min) >= now());
end $$;

create or replace function public.club_event(p_event_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e public.club_events := (select x from public.club_events x where x.id = p_event_id);
  v_uid uuid;
begin
  if e.id is null then raise exception 'EVENT_NOT_FOUND'; end if;
  v_uid := private.require_member(e.club_id);
  return private.event_json(e, v_uid) || jsonb_build_object(
    'can_manage', public.club_is_staff(e.club_id),
    'checkin_open', e.status = 'SCHEDULED' and now() between e.starts_at - interval '2 hours'
                                                          and e.starts_at + make_interval(mins => e.duration_min) + interval '2 hours',
    'attendees', (select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', r.user_id, 'display_name', p.display_name, 'avatar_url', p.avatar_url, 'status', r.status,
        'checked_in_at', r.checked_in_at, 'checkin_method', r.checkin_method)
        order by (r.checked_in_at is null), r.status, p.display_name), '[]'::jsonb)
      from public.club_event_rsvps r join public.profiles p on p.id = r.user_id
     where r.event_id = e.id and r.status <> 'NOT_GOING'));
end $$;

-- Ban quản trị lấy mã QR điểm danh (hết hạn sau 15 phút; màn hình tự làm mới)
create or replace function public.event_checkin_token(p_event_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e public.club_events := (select x from public.club_events x where x.id = p_event_id);
  v_exp bigint := extract(epoch from now() + interval '15 minutes')::bigint;
begin
  if e.id is null then raise exception 'EVENT_NOT_FOUND'; end if;
  perform private.require_staff(e.club_id);
  if e.status = 'CANCELLED' then raise exception 'EVENT_CANCELLED'; end if;
  return jsonb_build_object('token', e.id || '.' || v_exp || '.' || private.event_sig(e.id, v_exp),
                            'expires_at', to_timestamp(v_exp));
end $$;

-- Thành viên quét QR → điểm danh
create or replace function public.checkin_club_event(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_parts text[] := string_to_array(coalesce(p_token, ''), '.');
  v_event uuid;
  v_exp bigint;
  e public.club_events;
begin
  if cardinality(v_parts) <> 3 then raise exception 'INVALID_TOKEN'; end if;
  begin
    v_event := v_parts[1]::uuid;
    v_exp := v_parts[2]::bigint;
  exception when others then
    raise exception 'INVALID_TOKEN';
  end;
  e := (select x from public.club_events x where x.id = v_event);
  if e.id is null or private.event_sig(v_event, v_exp) is distinct from v_parts[3] then raise exception 'INVALID_TOKEN'; end if;
  if extract(epoch from now()) > v_exp then raise exception 'TOKEN_EXPIRED'; end if;
  if not public.club_is_member(e.club_id) then raise exception 'NOT_A_MEMBER'; end if;
  if e.status = 'CANCELLED' then raise exception 'EVENT_CANCELLED'; end if;
  if now() not between e.starts_at - interval '2 hours' and e.starts_at + make_interval(mins => e.duration_min) + interval '2 hours' then
    raise exception 'CHECKIN_CLOSED';
  end if;
  return jsonb_build_object('new', private.event_mark_checkin(e.id, v_uid, 'QR'), 'event_id', e.id, 'club_id', e.club_id, 'title', e.title);
end $$;

create or replace function public.staff_checkin(p_event_id uuid, p_user_id uuid, p_checked boolean) returns void
language plpgsql security definer set search_path = public as $$
declare e public.club_events := (select x from public.club_events x where x.id = p_event_id);
begin
  if e.id is null then raise exception 'EVENT_NOT_FOUND'; end if;
  perform private.require_staff(e.club_id);
  if not exists (select 1 from public.club_members where club_id = e.club_id and user_id = p_user_id and status = 'APPROVED') then
    raise exception 'NOT_A_MEMBER';
  end if;
  if p_checked then
    perform private.event_mark_checkin(e.id, p_user_id, 'STAFF');
  else
    update public.club_event_rsvps set checked_in_at = null, checkin_method = null, activity_id = null, updated_at = now()
     where event_id = e.id and user_id = p_user_id;
  end if;
end $$;

-- Tự điểm danh từ bài chạy: bắt đầu trong ±30 phút quanh giờ hẹn;
-- sự kiện có tọa độ + bài có GPS → điểm xuất phát cách ≤ 500 m; thiếu tọa độ → chỉ người đã báo tham gia / có thể
create or replace function private.event_auto_checkin() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  e record;
  v_lat numeric;
  v_lng numeric;
begin
  if new.user_id is null or new.rewarded_at is null or old.rewarded_at is not null or new.started_at is null then return new; end if;
  begin
    v_lat := (select (array_agg(t.latitude order by t.sequence))[1] from public.activity_track_points t where t.activity_id = new.id);
    v_lng := (select (array_agg(t.longitude order by t.sequence))[1] from public.activity_track_points t where t.activity_id = new.id);
    for e in select ev.* from public.club_events ev
               join public.club_members m on m.club_id = ev.club_id and m.user_id = new.user_id and m.status = 'APPROVED'
              where ev.status = 'SCHEDULED'
                and new.started_at between ev.starts_at - interval '30 minutes' and ev.starts_at + interval '30 minutes' loop
      if e.lat is not null and v_lat is not null then
        if private.haversine_m(v_lat, v_lng, e.lat::numeric, e.lng::numeric) <= 500 then
          perform private.event_mark_checkin(e.id, new.user_id, 'AUTO', new.id);
        end if;
      elsif exists (select 1 from public.club_event_rsvps r where r.event_id = e.id and r.user_id = new.user_id and r.status in ('GOING', 'MAYBE')) then
        perform private.event_mark_checkin(e.id, new.user_id, 'AUTO', new.id);
      end if;
    end loop;
  exception when others then
    raise warning 'event_auto_checkin: %', sqlerrm;         -- không bao giờ chặn việc ghi bài chạy
  end;
  return new;
end $$;
-- Hoãn tới cuối giao dịch: bài chạy GPS được thưởng ngay lúc chèn, trước khi các điểm GPS được lưu
drop trigger if exists trg_event_auto_checkin on public.activities;
create constraint trigger trg_event_auto_checkin after update of rewarded_at on public.activities
  deferrable initially deferred
  for each row execute function private.event_auto_checkin();

-- Cron (service_role): nhắc mọi sự kiện trong 12 giờ tới
create or replace function public.remind_upcoming_events() returns integer
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return private.remind_events(null);
end $$;

-- ---------------------------------------------------------------------
-- 4. RPC thu chi (VND)
-- ---------------------------------------------------------------------
create or replace function public.set_club_bank(p_club_id uuid, p_bin text, p_account text, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_staff(p_club_id);
begin
  if p_bin is null and p_account is null then
    update public.clubs set bank_bin = null, bank_account_no = null, bank_account_name = null where id = p_club_id;
    return;
  end if;
  if coalesce(p_bin, '') !~ '^\d{6}$' then raise exception 'INVALID_BANK'; end if;
  if coalesce(p_account, '') !~ '^[0-9A-Za-z]{4,20}$' then raise exception 'INVALID_BANK'; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 2 and 60 then raise exception 'INVALID_BANK'; end if;
  update public.clubs set bank_bin = p_bin, bank_account_no = p_account, bank_account_name = upper(trim(p_name)) where id = p_club_id;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'CLUB_SET_BANK', 'club:' || p_club_id, jsonb_build_object('bin', p_bin, 'account', p_account));
end $$;

create or replace function public.create_club_due(p_club_id uuid, p_title text, p_amount integer, p_due_date date, p_note text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_staff(p_club_id); v_id uuid := gen_random_uuid(); m record;
begin
  if char_length(trim(coalesce(p_title, ''))) not between 3 and 80 then raise exception 'INVALID_TITLE'; end if;
  if coalesce(p_amount, 0) not between 1000 and 100000000 then raise exception 'INVALID_AMOUNT'; end if;
  insert into public.club_dues (id, club_id, title, amount_vnd, due_date, note, created_by)
  values (v_id, p_club_id, trim(p_title), p_amount, p_due_date, nullif(trim(coalesce(p_note, '')), ''), v_uid);
  insert into public.club_due_payments (due_id, user_id)
  select v_id, user_id from public.club_members where club_id = p_club_id and status = 'APPROVED';
  for m in select user_id from public.club_members where club_id = p_club_id and status = 'APPROVED' and user_id <> v_uid loop
    perform private.notify(m.user_id, p_club_id, 'CLUB_DUE', 'Thu phí: ' || trim(p_title),
      to_char(p_amount, 'FM999G999G999') || 'đ' || coalesce(' · hạn ' || to_char(p_due_date, 'DD/MM'), ''),
      '/clubs/' || p_club_id || '/treasury?due=' || v_id, v_uid, true);
  end loop;
  return v_id;
end $$;

-- Thành viên báo đã chuyển khoản
create or replace function public.claim_due_paid(p_due_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d public.club_dues := (select x from public.club_dues x where x.id = p_due_id); v_uid uuid; s record;
begin
  if d.id is null then raise exception 'DUE_NOT_FOUND'; end if;
  v_uid := private.require_member(d.club_id);
  if d.closed_at is not null then raise exception 'DUE_CLOSED'; end if;
  insert into public.club_due_payments (due_id, user_id, status, claimed_at) values (d.id, v_uid, 'CLAIMED', now())
  on conflict (due_id, user_id) do update set status = 'CLAIMED', claimed_at = now(), updated_at = now()
    where public.club_due_payments.status = 'UNPAID';
  for s in select user_id from public.club_members where club_id = d.club_id and status = 'APPROVED' and role in ('OWNER', 'CAPTAIN') loop
    perform private.notify(s.user_id, d.club_id, 'CLUB_DUE', private.display_name(v_uid) || ' báo đã đóng phí',
      d.title || ' · ' || to_char(d.amount_vnd, 'FM999G999G999') || 'đ — kiểm tra tài khoản và xác nhận',
      '/clubs/' || d.club_id || '/treasury?due=' || d.id, v_uid, false);
  end loop;
end $$;

-- Thủ quỹ (ban quản trị) xác nhận / bỏ xác nhận / miễn phí
create or replace function public.set_due_payment(p_due_id uuid, p_user_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare d public.club_dues := (select x from public.club_dues x where x.id = p_due_id); v_uid uuid;
begin
  if d.id is null then raise exception 'DUE_NOT_FOUND'; end if;
  v_uid := private.require_staff(d.club_id);
  if p_status not in ('UNPAID', 'CONFIRMED', 'EXEMPT') then raise exception 'INVALID_STATUS'; end if;
  insert into public.club_due_payments (due_id, user_id, status) values (d.id, p_user_id, p_status)
  on conflict (due_id, user_id) do update set status = excluded.status, updated_at = now(),
    confirmed_at = case when excluded.status = 'CONFIRMED' then now() else null end,
    confirmed_by = case when excluded.status = 'CONFIRMED' then v_uid else null end;
  update public.club_due_payments set confirmed_at = now(), confirmed_by = v_uid
   where due_id = d.id and user_id = p_user_id and p_status = 'CONFIRMED' and confirmed_at is null;
  if p_status = 'CONFIRMED' then
    insert into public.club_cash_entries (club_id, kind, amount_vnd, title, due_id, user_id, created_by)
    values (d.club_id, 'DUE', d.amount_vnd, d.title, d.id, p_user_id, v_uid)
    on conflict (due_id, user_id) where kind = 'DUE' and voided_at is null do nothing;
    perform private.notify(p_user_id, d.club_id, 'CLUB_DUE', 'Đã xác nhận đóng phí', d.title,
      '/clubs/' || d.club_id || '/treasury?due=' || d.id, v_uid, false);
  else
    update public.club_cash_entries set voided_at = now(), voided_by = v_uid, void_reason = 'Bỏ xác nhận đóng phí'
     where due_id = d.id and user_id = p_user_id and kind = 'DUE' and voided_at is null;
  end if;
end $$;

-- Nhắc người chưa đóng (tối đa 1 lần / 12 giờ)
create or replace function public.remind_due(p_due_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare d public.club_dues := (select x from public.club_dues x where x.id = p_due_id); v_uid uuid; r record; v_n integer := 0;
begin
  if d.id is null then raise exception 'DUE_NOT_FOUND'; end if;
  v_uid := private.require_staff(d.club_id);
  if d.reminded_at is not null and d.reminded_at > now() - interval '12 hours' then raise exception 'REMIND_TOO_SOON'; end if;
  for r in select user_id from public.club_due_payments where due_id = d.id and status = 'UNPAID' loop
    perform private.notify(r.user_id, d.club_id, 'CLUB_DUE', 'Nhắc đóng phí: ' || d.title,
      to_char(d.amount_vnd, 'FM999G999G999') || 'đ' || coalesce(' · hạn ' || to_char(d.due_date, 'DD/MM'), ''),
      '/clubs/' || d.club_id || '/treasury?due=' || d.id, v_uid, true);
    v_n := v_n + 1;
  end loop;
  update public.club_dues set reminded_at = now() where id = d.id;
  return v_n;
end $$;

create or replace function public.close_club_due(p_due_id uuid, p_closed boolean) returns void
language plpgsql security definer set search_path = public as $$
declare d public.club_dues := (select x from public.club_dues x where x.id = p_due_id);
begin
  if d.id is null then raise exception 'DUE_NOT_FOUND'; end if;
  perform private.require_staff(d.club_id);
  update public.club_dues set closed_at = case when p_closed then now() else null end where id = d.id;
end $$;

-- Khoản thu / chi khác (có ảnh hóa đơn)
create or replace function public.add_cash_entry(p_club_id uuid, p_kind text, p_amount bigint, p_title text, p_note text, p_receipt_url text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_staff(p_club_id); v_id uuid := gen_random_uuid();
begin
  if p_kind not in ('INCOME', 'EXPENSE') then raise exception 'INVALID_KIND'; end if;
  if coalesce(p_amount, 0) not between 1000 and 1000000000 then raise exception 'INVALID_AMOUNT'; end if;
  if char_length(trim(coalesce(p_title, ''))) not between 2 and 80 then raise exception 'INVALID_TITLE'; end if;
  if p_receipt_url is not null and p_receipt_url !~ '^https://' then raise exception 'INVALID_RECEIPT'; end if;
  insert into public.club_cash_entries (id, club_id, kind, amount_vnd, title, note, receipt_url, created_by)
  values (v_id, p_club_id, p_kind, p_amount, trim(p_title), nullif(trim(coalesce(p_note, '')), ''), p_receipt_url, v_uid);
  return v_id;
end $$;

create or replace function public.void_cash_entry(p_entry_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.club_cash_entries := (select x from public.club_cash_entries x where x.id = p_entry_id); v_uid uuid;
begin
  if c.id is null then raise exception 'ENTRY_NOT_FOUND'; end if;
  v_uid := private.require_staff(c.club_id);
  if c.voided_at is not null then raise exception 'ENTRY_VOIDED'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'REASON_REQUIRED'; end if;
  update public.club_cash_entries set voided_at = now(), voided_by = v_uid, void_reason = trim(p_reason) where id = c.id;
  if c.kind = 'DUE' then
    update public.club_due_payments set status = 'UNPAID', confirmed_at = null, confirmed_by = null, updated_at = now()
     where due_id = c.due_id and user_id = c.user_id;
  end if;
end $$;

-- Tổng quan thu chi cho màn Quỹ
create or replace function public.club_finance(p_club_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_member(p_club_id);
begin
  return (select jsonb_build_object(
    'can_manage', public.club_is_staff(p_club_id),
    'bank', case when c.bank_bin is null then null
                 else jsonb_build_object('bin', c.bank_bin, 'account_no', c.bank_account_no, 'account_name', c.bank_account_name) end,
    'balance', (select coalesce(sum(case when e.kind = 'EXPENSE' then -e.amount_vnd else e.amount_vnd end), 0)
                  from public.club_cash_entries e where e.club_id = p_club_id and e.voided_at is null),
    'income_30d', (select coalesce(sum(e.amount_vnd), 0) from public.club_cash_entries e
                    where e.club_id = p_club_id and e.voided_at is null and e.kind <> 'EXPENSE' and e.created_at > now() - interval '30 days'),
    'expense_30d', (select coalesce(sum(e.amount_vnd), 0) from public.club_cash_entries e
                     where e.club_id = p_club_id and e.voided_at is null and e.kind = 'EXPENSE' and e.created_at > now() - interval '30 days'),
    'dues', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id, 'title', d.title, 'amount_vnd', d.amount_vnd, 'due_date', d.due_date, 'note', d.note,
        'closed', d.closed_at is not null, 'created_at', d.created_at, 'reminded_at', d.reminded_at,
        'total', (select count(*) from public.club_due_payments p where p.due_id = d.id and p.status <> 'EXEMPT'),
        'confirmed', (select count(*) from public.club_due_payments p where p.due_id = d.id and p.status = 'CONFIRMED'),
        'claimed', (select count(*) from public.club_due_payments p where p.due_id = d.id and p.status = 'CLAIMED'),
        'my_status', (select p.status from public.club_due_payments p where p.due_id = d.id and p.user_id = v_uid))
        order by (d.closed_at is not null), d.created_at desc), '[]'::jsonb)
      from public.club_dues d where d.club_id = p_club_id),
    'entries', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', q.id, 'kind', q.kind, 'amount_vnd', q.amount_vnd, 'title', q.title, 'note', q.note, 'receipt_url', q.receipt_url,
        'user_name', (select display_name from public.profiles where id = q.user_id),
        'created_by_name', (select display_name from public.profiles where id = q.created_by),
        'created_at', q.created_at, 'voided_at', q.voided_at, 'void_reason', q.void_reason)
        order by q.created_at desc), '[]'::jsonb)
      from (select e.*, row_number() over (order by e.created_at desc) as rn
              from public.club_cash_entries e where e.club_id = p_club_id) q
     where q.rn <= 200))
    from public.clubs c where c.id = p_club_id);
end $$;

create or replace function public.club_due_detail(p_due_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d public.club_dues := (select x from public.club_dues x where x.id = p_due_id); v_uid uuid;
begin
  if d.id is null then raise exception 'DUE_NOT_FOUND'; end if;
  v_uid := private.require_member(d.club_id);
  return jsonb_build_object(
    'id', d.id, 'club_id', d.club_id, 'title', d.title, 'amount_vnd', d.amount_vnd, 'due_date', d.due_date, 'note', d.note,
    'closed', d.closed_at is not null, 'reminded_at', d.reminded_at,
    'my_status', (select p.status from public.club_due_payments p where p.due_id = d.id and p.user_id = v_uid),
    'members', (select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', p.user_id, 'display_name', pr.display_name, 'avatar_url', pr.avatar_url, 'status', p.status,
        'claimed_at', p.claimed_at, 'confirmed_at', p.confirmed_at)
        order by case p.status when 'CLAIMED' then 0 when 'UNPAID' then 1 when 'CONFIRMED' then 2 else 3 end, pr.display_name), '[]'::jsonb)
      from public.club_due_payments p join public.profiles pr on pr.id = p.user_id where p.due_id = d.id));
end $$;

-- ---------------------------------------------------------------------
-- 5. RPC bình chọn
-- ---------------------------------------------------------------------
create or replace function public.create_club_poll(p_club_id uuid, p_question text, p_options text[], p_multi boolean,
                                                   p_closes_at timestamptz, p_hide_results boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_member(p_club_id); v_id uuid := gen_random_uuid(); v_opts jsonb; m record;
begin
  if char_length(trim(coalesce(p_question, ''))) not between 3 and 200 then raise exception 'INVALID_QUESTION'; end if;
  v_opts := (select coalesce(jsonb_agg(trim(o) order by i), '[]'::jsonb)
               from unnest(p_options) with ordinality as t(o, i) where char_length(trim(coalesce(o, ''))) between 1 and 80);
  if jsonb_array_length(v_opts) not between 2 and 10 or jsonb_array_length(v_opts) <> cardinality(p_options) then
    raise exception 'INVALID_OPTIONS';
  end if;
  if p_closes_at is not null and p_closes_at <= now() then raise exception 'INVALID_TIME'; end if;
  if (select count(*) from public.club_polls where created_by = v_uid and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'RATE_LIMITED';
  end if;
  insert into public.club_polls (id, club_id, created_by, question, options, multi, hide_results, closes_at)
  values (v_id, p_club_id, v_uid, trim(p_question), v_opts, coalesce(p_multi, false), coalesce(p_hide_results, false), p_closes_at);
  for m in select user_id from public.club_members where club_id = p_club_id and status = 'APPROVED' and user_id <> v_uid loop
    perform private.notify(m.user_id, p_club_id, 'CLUB_POLL', private.display_name(v_uid) || ' tạo bình chọn', trim(p_question),
      '/clubs/' || p_club_id || '/events', v_uid, false);
  end loop;
  return v_id;
end $$;

create or replace function public.vote_club_poll(p_poll_id uuid, p_choices integer[]) returns void
language plpgsql security definer set search_path = public as $$
declare p public.club_polls := (select x from public.club_polls x where x.id = p_poll_id); v_uid uuid; v_n integer;
begin
  if p.id is null then raise exception 'POLL_NOT_FOUND'; end if;
  v_uid := private.require_member(p.club_id);
  if p.closed_at is not null or (p.closes_at is not null and p.closes_at <= now()) then raise exception 'POLL_CLOSED'; end if;
  v_n := jsonb_array_length(p.options);
  if coalesce(cardinality(p_choices), 0) = 0 then
    delete from public.club_poll_votes where poll_id = p.id and user_id = v_uid;       -- bỏ phiếu
    return;
  end if;
  if (not p.multi and cardinality(p_choices) > 1)
     or exists (select 1 from unnest(p_choices) c where c < 0 or c >= v_n)
     or (select count(distinct c) from unnest(p_choices) c) <> cardinality(p_choices) then
    raise exception 'INVALID_CHOICES';
  end if;
  insert into public.club_poll_votes (poll_id, user_id, choices) values (p.id, v_uid, p_choices)
  on conflict (poll_id, user_id) do update set choices = excluded.choices, voted_at = now();
end $$;

create or replace function public.close_club_poll(p_poll_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p public.club_polls := (select x from public.club_polls x where x.id = p_poll_id); v_uid uuid;
begin
  if p.id is null then raise exception 'POLL_NOT_FOUND'; end if;
  v_uid := private.require_member(p.club_id);
  if p.created_by is distinct from v_uid and not public.club_is_staff(p.club_id) then raise exception 'FORBIDDEN'; end if;
  update public.club_polls set closed_at = coalesce(closed_at, now()) where id = p.id;
end $$;

-- Danh sách bình chọn: kết quả ẩn khi "ẩn kết quả" và chưa đóng (trừ người tạo / ban quản trị)
create or replace function public.club_polls(p_club_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_member(p_club_id); v_staff boolean := public.club_is_staff(p_club_id);
begin
  return (select coalesce(jsonb_agg(x.j order by x.open desc, x.created_at desc), '[]'::jsonb) from (
    select q.created_at,
           (q.closed_at is null and (q.closes_at is null or q.closes_at > now())) as open,
           jsonb_build_object(
             'id', q.id, 'question', q.question, 'options', q.options, 'multi', q.multi, 'hide_results', q.hide_results,
             'closes_at', q.closes_at, 'closed', not (q.closed_at is null and (q.closes_at is null or q.closes_at > now())),
             'created_at', q.created_at, 'creator_name', (select display_name from public.profiles where id = q.created_by),
             'can_close', q.created_by = v_uid or v_staff,
             'voters', (select count(*) from public.club_poll_votes v where v.poll_id = q.id),
             'my_choices', (select to_jsonb(v.choices) from public.club_poll_votes v where v.poll_id = q.id and v.user_id = v_uid),
             'counts', case when q.hide_results and q.closed_at is null and (q.closes_at is null or q.closes_at > now())
                                 and q.created_by is distinct from v_uid and not v_staff then null
                            else (select jsonb_agg((select count(*) from public.club_poll_votes v where v.poll_id = q.id and i - 1 = any(v.choices)) order by i)
                                    from generate_series(1, jsonb_array_length(q.options)) i) end) as j
      from (select p.*, row_number() over (order by p.created_at desc) as rn from public.club_polls p where p.club_id = p_club_id) q
     where q.rn <= 30) x);
end $$;

-- ---------------------------------------------------------------------
-- 6. Huy hiệu chạy nhóm (thống kê người chơi thêm GROUP_RUNS)
-- ---------------------------------------------------------------------
create or replace function private.player_stats(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_runs jsonb; v_ch jsonb;
begin
  v_runs := (select jsonb_build_object(
           'TOTAL_KM', coalesce(sum(private.run_km(a)), 0),
           'RUN_COUNT', count(*),
           'LONGEST_RUN_KM', coalesce(max(private.run_km(a)), 0),
           'EARLY_RUNS', count(*) filter (where extract(hour from a.started_at at time zone 'Asia/Ho_Chi_Minh') < 6),
           'NIGHT_RUNS', count(*) filter (where extract(hour from a.started_at at time zone 'Asia/Ho_Chi_Minh') >= 20))
    from public.activities a
   where a.user_id = p_user and a.rewarded_at is not null and a.validation_status = 'APPROVED' and coalesce(a.status, '') <> 'DELETED');
  v_ch := (select jsonb_build_object(
           'CHALLENGES_FINISHED', count(*) filter (where p.current_progress > 0),
           'TEAM_CHALLENGES_FINISHED', count(*) filter (where p.current_progress > 0 and c.format = 'TEAM'),
           'CHALLENGE_WINS', count(*) filter (where p.final_rank = 1 and p.current_progress > 0 and c.format in ('RANKED', 'DUEL')))
    from public.challenge_participants p join public.challenges c on c.id = p.challenge_id
   where p.profile_id = p_user and p.status <> 'LEFT' and c.status = 'FINISHED');
  return v_runs || v_ch || jsonb_build_object(
    'BEST_STREAK_WEEKS', coalesce((select best_weeks from public.user_streaks where user_id = p_user), 0),
    'CHEERS_SENT', (select count(*) from public.cheers where from_user = p_user),
    'CHEERS_RECEIVED', (select count(*) from public.cheers where to_user = p_user),
    'CLUBS_JOINED', (select count(*) from public.club_members where user_id = p_user and status = 'APPROVED'),
    'GROUP_RUNS', (select count(*) from public.club_event_rsvps where user_id = p_user and checked_in_at is not null),
    'LEVEL', coalesce((select level from public.profiles where id = p_user), 1));
end $$;

insert into public.achievements (code, title, description, category, tier, icon, rule, xp_reward, xu_reward, sort) values
  ('GROUP_RUN_1', 'Chạy cùng hội', 'Điểm danh buổi chạy nhóm đầu tiên của CLB', 'SOCIAL', 'BRONZE', 'UsersRound', '{"type":"GROUP_RUNS","gte":1}', 50, 0, 43),
  ('GROUP_RUN_5', 'Dân chạy nhóm', 'Điểm danh 5 buổi chạy nhóm', 'SOCIAL', 'SILVER', 'UsersRound', '{"type":"GROUP_RUNS","gte":5}', 150, 2, 44),
  ('GROUP_RUN_20', 'Linh hồn CLB', 'Điểm danh 20 buổi chạy nhóm', 'SOCIAL', 'GOLD', 'UsersRound', '{"type":"GROUP_RUNS","gte":20}', 400, 5, 45)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 7. Quyền thực thi
-- ---------------------------------------------------------------------
revoke all on function public.create_club_event(uuid, jsonb), public.update_club_event(uuid, jsonb), public.cancel_club_event(uuid, text),
  public.rsvp_club_event(uuid, text), public.club_events(uuid, text), public.club_event(uuid), public.event_checkin_token(uuid),
  public.checkin_club_event(text), public.staff_checkin(uuid, uuid, boolean), public.remind_upcoming_events(),
  public.set_club_bank(uuid, text, text, text), public.create_club_due(uuid, text, integer, date, text), public.claim_due_paid(uuid),
  public.set_due_payment(uuid, uuid, text), public.remind_due(uuid), public.close_club_due(uuid, boolean),
  public.add_cash_entry(uuid, text, bigint, text, text, text), public.void_cash_entry(uuid, text), public.club_finance(uuid),
  public.club_due_detail(uuid), public.create_club_poll(uuid, text, text[], boolean, timestamptz, boolean),
  public.vote_club_poll(uuid, integer[]), public.close_club_poll(uuid), public.club_polls(uuid)
  from public, anon;
grant execute on function public.create_club_event(uuid, jsonb), public.update_club_event(uuid, jsonb), public.cancel_club_event(uuid, text),
  public.rsvp_club_event(uuid, text), public.club_events(uuid, text), public.club_event(uuid), public.event_checkin_token(uuid),
  public.checkin_club_event(text), public.staff_checkin(uuid, uuid, boolean),
  public.set_club_bank(uuid, text, text, text), public.create_club_due(uuid, text, integer, date, text), public.claim_due_paid(uuid),
  public.set_due_payment(uuid, uuid, text), public.remind_due(uuid), public.close_club_due(uuid, boolean),
  public.add_cash_entry(uuid, text, bigint, text, text, text), public.void_cash_entry(uuid, text), public.club_finance(uuid),
  public.club_due_detail(uuid), public.create_club_poll(uuid, text, text[], boolean, timestamptz, boolean),
  public.vote_club_poll(uuid, integer[]), public.close_club_poll(uuid), public.club_polls(uuid)
  to authenticated;
grant execute on function public.remind_upcoming_events() to service_role;
revoke all on function private.require_member(uuid), private.require_staff(uuid), private.event_sig(uuid, bigint),
  private.event_json(public.club_events, uuid), private.event_mark_checkin(uuid, uuid, text, uuid), private.remind_events(uuid),
  private.event_fields(jsonb), private.event_auto_checkin() from public, anon, authenticated;

notify pgrst, 'reload schema';
