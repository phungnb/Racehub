-- 002700: Giải chạy ảo (virtual race) + dashboard ban tổ chức.
-- • Ban tổ chức (admin hệ thống hoặc ban quản trị CLB) tạo giải: thời gian, hạn đăng ký, các cự ly (5/10/21/42 km…),
--   giới hạn số VĐV, tiền tố số BIB, công khai hoặc nội bộ CLB.
-- • VĐV đăng ký một cự ly → nhận số BIB (VD: NBNR-0007). Chạy trong thời gian giải, một bài hợp lệ (APPROVED)
--   dài ≥ cự ly là hoàn thành. Thành tích = thời gian quy đổi đúng cự ly theo pace của bài (lấy bài nhanh nhất).
-- • Kết quả tự cập nhật khi có bài mới / bài bị xóa hay bị từ chối. BTC xem danh sách đầy đủ, xuất CSV.
-- Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

create table if not exists public.virtual_races (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid references public.profiles(id) on delete set null,
  club_id uuid references public.clubs(id) on delete set null,
  title text not null,
  description text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  reg_close_at timestamptz not null,
  distances numeric[] not null,
  audience text not null default 'PUBLIC',
  max_participants integer,
  bib_prefix text not null default 'RH',
  next_bib integer not null default 0,
  status text not null default 'PUBLISHED',
  cancelled_reason text,
  created_at timestamptz not null default now()
);
alter table public.virtual_races drop constraint if exists virtual_races_chk;
alter table public.virtual_races add constraint virtual_races_chk check (
  end_at > start_at and reg_close_at <= end_at and audience in ('PUBLIC', 'CLUB_ONLY')
  and status in ('PUBLISHED', 'CANCELLED') and (audience = 'PUBLIC' or club_id is not null)
  and (max_participants is null or max_participants between 2 and 100000));
create index if not exists virtual_races_time_idx on public.virtual_races (start_at, end_at);

create table if not exists public.race_registrations (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.virtual_races(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  distance_km numeric not null,
  bib text not null,
  status text not null default 'REGISTERED',
  registered_at timestamptz not null default now(),
  finish_activity_id uuid references public.activities(id) on delete set null,
  finish_distance_m numeric,
  finish_moving_s integer,
  finish_time_s integer,
  finished_at timestamptz,
  unique (race_id, user_id),
  unique (race_id, bib)
);
alter table public.race_registrations drop constraint if exists race_registrations_status_chk;
alter table public.race_registrations add constraint race_registrations_status_chk check (status in ('REGISTERED', 'FINISHED', 'WITHDRAWN'));
create index if not exists race_registrations_user_idx on public.race_registrations (user_id);

-- Chỉ đọc / ghi qua RPC (kiểm tra quyền, quyền riêng tư)
alter table public.virtual_races enable row level security;
alter table public.race_registrations enable row level security;
revoke all on public.virtual_races, public.race_registrations from anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Quyền
-- ---------------------------------------------------------------------
create or replace function private.race_is_manager(r public.virtual_races) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (r.organizer_id = auth.uid() or public.is_system_admin()
    or (r.club_id is not null and public.club_is_staff(r.club_id)))
$$;

create or replace function private.race_visible(r public.virtual_races) returns boolean
language sql stable security definer set search_path = public as $$
  select r.audience = 'PUBLIC' or private.race_is_manager(r)
      or (r.club_id is not null and public.club_is_member(r.club_id))
      or exists (select 1 from public.race_registrations g where g.race_id = r.id and g.user_id = auth.uid())
$$;

-- ---------------------------------------------------------------------
-- 2. Chấm thành tích một VĐV: bài nhanh nhất (pace) trong thời gian giải, dài ≥ cự ly (dung sai 1%)
-- ---------------------------------------------------------------------
create or replace function private.race_evaluate(p_reg_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  g public.race_registrations := (select x from public.race_registrations x where x.id = p_reg_id);
  r public.virtual_races;
  best record;
  v_target numeric;
  v_was text;
begin
  if g.id is null or g.status = 'WITHDRAWN' then return; end if;
  r := (select x from public.virtual_races x where x.id = g.race_id);
  if r.status = 'CANCELLED' then return; end if;
  v_target := g.distance_km * 1000;
  v_was := g.status;
  for best in
    select a.id, a.distance_m, a.moving_time_s, a.started_at
      from public.activities a
     where a.user_id = g.user_id and a.validation_status = 'APPROVED' and coalesce(a.status, '') <> 'DELETED'
       and a.started_at >= r.start_at and a.started_at < r.end_at
       and a.distance_m >= v_target * 0.99 and coalesce(a.moving_time_s, 0) > 0
     order by a.moving_time_s / a.distance_m, a.started_at
  loop
    update public.race_registrations
       set status = 'FINISHED', finish_activity_id = best.id, finish_distance_m = best.distance_m,
           finish_moving_s = best.moving_time_s,
           finish_time_s = round(best.moving_time_s * v_target / best.distance_m),
           finished_at = best.started_at
     where id = g.id;
    if v_was <> 'FINISHED' then
      perform private.notify(g.user_id, r.club_id, 'RACE_FINISHED', 'Hoàn thành ' || r.title,
        'Cự ly ' || g.distance_km || ' km · BIB ' || g.bib || '. Xem thứ hạng và nhận giấy chứng nhận.', '/races/' || r.id, null, true);
    end if;
    return;                                  -- chỉ lấy bài tốt nhất
  end loop;
  update public.race_registrations
     set status = 'REGISTERED', finish_activity_id = null, finish_distance_m = null, finish_moving_s = null,
         finish_time_s = null, finished_at = null
   where id = g.id and status = 'FINISHED';
end $$;

create or replace function private.race_on_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare g record;
begin
  for g in select x.id from public.race_registrations x join public.virtual_races r on r.id = x.race_id
            where x.user_id = new.user_id and x.status <> 'WITHDRAWN' and r.status = 'PUBLISHED'
              and new.started_at >= r.start_at and new.started_at < r.end_at loop
    perform private.race_evaluate(g.id);
  end loop;
  return new;
end $$;

drop trigger if exists trg_race_on_activity on public.activities;
create trigger trg_race_on_activity
  after insert or update of validation_status, status, distance_m on public.activities
  for each row execute function private.race_on_activity();

-- ---------------------------------------------------------------------
-- 3. Ban tổ chức: tạo / hủy giải
-- p = {title, description, start_at, end_at, reg_close_at, distances: [5, 10, 21.1], audience, club_id,
--      max_participants, bib_prefix}
-- ---------------------------------------------------------------------
create or replace function public.create_virtual_race(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_id uuid := gen_random_uuid();
  v_club uuid := nullif(p->>'club_id', '')::uuid;
  v_title text := trim(coalesce(p->>'title', ''));
  v_start timestamptz := (p->>'start_at')::timestamptz;
  v_end timestamptz := (p->>'end_at')::timestamptz;
  v_close timestamptz := coalesce(nullif(p->>'reg_close_at', '')::timestamptz, (p->>'end_at')::timestamptz);
  v_aud text := upper(coalesce(p->>'audience', 'PUBLIC'));
  v_max integer := nullif(p->>'max_participants', '')::integer;
  v_prefix text := upper(coalesce(nullif(trim(p->>'bib_prefix'), ''), 'RH'));
  v_dist numeric[];
begin
  if not public.is_system_admin() and (v_club is null or not public.club_is_staff(v_club)) then raise exception 'FORBIDDEN'; end if;
  if length(v_title) < 3 or length(v_title) > 120 then raise exception 'INVALID_TITLE'; end if;
  if v_start is null or v_end is null or v_end <= v_start then raise exception 'INVALID_TIME_RANGE'; end if;
  if v_end < now() or v_end - v_start > interval '92 days' then raise exception 'INVALID_DURATION'; end if;
  if v_close > v_end or v_close < now() then raise exception 'INVALID_REG_CLOSE'; end if;
  if v_aud not in ('PUBLIC', 'CLUB_ONLY') or (v_aud = 'CLUB_ONLY' and v_club is null) then raise exception 'INVALID_AUDIENCE'; end if;
  if v_max is not null and (v_max < 2 or v_max > 100000) then raise exception 'INVALID_MAX'; end if;
  if v_prefix !~ '^[A-Z0-9]{1,6}$' then raise exception 'INVALID_BIB_PREFIX'; end if;
  v_dist := (select array_agg(d order by d) from (
               select distinct round((e)::numeric, 2) as d from jsonb_array_elements_text(coalesce(p->'distances', '[]'::jsonb)) as t(e)) s);
  if v_dist is null or array_length(v_dist, 1) > 6 or v_dist[1] < 1 or v_dist[array_length(v_dist, 1)] > 250 then
    raise exception 'INVALID_DISTANCES';
  end if;

  insert into public.virtual_races (id, organizer_id, club_id, title, description, start_at, end_at, reg_close_at, distances,
                                    audience, max_participants, bib_prefix)
  values (v_id, v_uid, v_club, v_title, nullif(left(trim(coalesce(p->>'description', '')), 3000), ''), v_start, v_end, v_close,
          v_dist, v_aud, v_max, v_prefix);
  return v_id;
end $$;

create or replace function public.cancel_virtual_race(p_race_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  r public.virtual_races := (select x from public.virtual_races x where x.id = p_race_id);
  g record;
begin
  if r.id is null then raise exception 'RACE_NOT_FOUND'; end if;
  if not private.race_is_manager(r) then raise exception 'FORBIDDEN'; end if;
  if r.status = 'CANCELLED' then return; end if;
  update public.virtual_races set status = 'CANCELLED', cancelled_reason = nullif(left(trim(coalesce(p_reason, '')), 300), '') where id = r.id;
  for g in select x.user_id from public.race_registrations x where x.race_id = r.id and x.status <> 'WITHDRAWN' loop
    perform private.notify(g.user_id, r.club_id, 'RACE_CANCELLED', 'Giải ' || r.title || ' đã hủy',
      coalesce(nullif(trim(p_reason), ''), 'Ban tổ chức đã hủy giải.'), '/races/' || r.id, v_uid, true);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. VĐV: đăng ký (nhận BIB) / đổi cự ly / rút tên
-- ---------------------------------------------------------------------
create or replace function public.register_race(p_race_id uuid, p_distance_km numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  r public.virtual_races;
  g public.race_registrations := (select x from public.race_registrations x where x.race_id = p_race_id and x.user_id = v_uid);
  v_bib text;
  v_n integer;
begin
  perform 1 from public.virtual_races where id = p_race_id for update;      -- cấp BIB tuần tự, không trùng
  r := (select x from public.virtual_races x where x.id = p_race_id);
  if r.id is null or not private.race_visible(r) then raise exception 'RACE_NOT_FOUND'; end if;
  if r.status = 'CANCELLED' then raise exception 'RACE_CANCELLED'; end if;
  if now() > r.reg_close_at or now() >= r.end_at then raise exception 'REGISTRATION_CLOSED'; end if;
  if not (round(p_distance_km, 2) = any(r.distances)) then raise exception 'INVALID_DISTANCE'; end if;
  if g.id is not null and g.status <> 'WITHDRAWN' then
    -- đổi cự ly (giữ nguyên BIB); đã hoàn thành thì chấm lại theo cự ly mới
    update public.race_registrations set distance_km = round(p_distance_km, 2) where id = g.id;
    perform private.race_evaluate(g.id);
    return public.race_detail(r.id);
  end if;
  if r.max_participants is not null and (select count(*) from public.race_registrations x
       where x.race_id = r.id and x.status <> 'WITHDRAWN') >= r.max_participants then
    raise exception 'RACE_FULL';
  end if;
  if g.id is not null then                 -- đăng ký lại sau khi rút: giữ BIB cũ
    update public.race_registrations set status = 'REGISTERED', distance_km = round(p_distance_km, 2), registered_at = now() where id = g.id;
  else
    v_n := r.next_bib + 1;
    update public.virtual_races set next_bib = v_n where id = r.id;
    v_bib := r.bib_prefix || '-' || lpad(v_n::text, 4, '0');
    insert into public.race_registrations (race_id, user_id, distance_km, bib) values (r.id, v_uid, round(p_distance_km, 2), v_bib);
  end if;
  -- đăng ký muộn (giải đã bắt đầu): tính luôn các bài đã chạy từ lúc khai mạc
  perform private.race_evaluate((select x.id from public.race_registrations x where x.race_id = r.id and x.user_id = v_uid));
  return public.race_detail(r.id);
end $$;

create or replace function public.withdraw_race(p_race_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  r public.virtual_races := (select x from public.virtual_races x where x.id = p_race_id);
begin
  if r.id is null then raise exception 'RACE_NOT_FOUND'; end if;
  if now() >= r.start_at then raise exception 'RACE_STARTED'; end if;
  update public.race_registrations set status = 'WITHDRAWN' where race_id = r.id and user_id = v_uid and status = 'REGISTERED';
  if not found then raise exception 'NOT_REGISTERED'; end if;
  return public.race_detail(r.id);
end $$;

-- ---------------------------------------------------------------------
-- 5. Xem: danh sách giải, chi tiết, kết quả, dashboard BTC
-- ---------------------------------------------------------------------
create or replace function private.race_card(r public.virtual_races) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.id, 'title', r.title, 'description', r.description, 'start_at', r.start_at, 'end_at', r.end_at,
    'reg_close_at', r.reg_close_at, 'distances', to_jsonb(r.distances), 'audience', r.audience, 'status', r.status,
    'cancelled_reason', r.cancelled_reason, 'max_participants', r.max_participants, 'bib_prefix', r.bib_prefix,
    'club', (select jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url, 'accent_color', c.accent_color)
               from public.clubs c where c.id = r.club_id),
    'organizer', (select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url)
                    from public.profiles p where p.id = r.organizer_id),
    'registered', (select count(*) from public.race_registrations g where g.race_id = r.id and g.status <> 'WITHDRAWN'),
    'finished', (select count(*) from public.race_registrations g where g.race_id = r.id and g.status = 'FINISHED'),
    'me', (select jsonb_build_object('id', g.id, 'bib', g.bib, 'display_name', (select pp.display_name from public.profiles pp where pp.id = g.user_id), 'distance_km', g.distance_km, 'status', g.status,
                                     'finish_time_s', g.finish_time_s, 'finish_distance_m', g.finish_distance_m,
                                     'finish_moving_s', g.finish_moving_s, 'finished_at', g.finished_at,
                                     'finish_activity_id', g.finish_activity_id, 'registered_at', g.registered_at,
                                     'rank', case when g.status = 'FINISHED' then
                                       (select count(*) + 1 from public.race_registrations o
                                         where o.race_id = r.id and o.distance_km = g.distance_km and o.status = 'FINISHED'
                                           and (o.finish_time_s < g.finish_time_s or (o.finish_time_s = g.finish_time_s and o.finished_at < g.finished_at))) end)
             from public.race_registrations g where g.race_id = r.id and g.user_id = auth.uid() and g.status <> 'WITHDRAWN'),
    'can_manage', private.race_is_manager(r))
$$;

create or replace function public.race_detail(p_race_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.virtual_races := (select x from public.virtual_races x where x.id = p_race_id);
begin
  if r.id is null or not private.race_visible(r) then raise exception 'RACE_NOT_FOUND'; end if;
  return private.race_card(r) || jsonb_build_object('per_distance', (
    select coalesce(jsonb_agg(jsonb_build_object('distance_km', d,
             'registered', (select count(*) from public.race_registrations g where g.race_id = r.id and g.distance_km = d and g.status <> 'WITHDRAWN'),
             'finished', (select count(*) from public.race_registrations g where g.race_id = r.id and g.distance_km = d and g.status = 'FINISHED'))
             order by d), '[]'::jsonb)
      from unnest(r.distances) as d));
end $$;

-- p_scope: UPCOMING (sắp / đang diễn ra) · MINE (đã đăng ký) · PAST (đã kết thúc)
create or replace function public.list_races(p_scope text default 'UPCOMING') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return (select coalesce(jsonb_agg(private.race_card(t.race) order by
            case when upper(p_scope) = 'PAST' then extract(epoch from (t.race).end_at) * -1 else extract(epoch from (t.race).start_at) end), '[]'::jsonb)
    from (select x as race, row_number() over (order by x.start_at desc) as rn from public.virtual_races x
           where private.race_visible(x)
             and case upper(coalesce(p_scope, 'UPCOMING'))
                   when 'MINE' then exists (select 1 from public.race_registrations g where g.race_id = x.id and g.user_id = auth.uid() and g.status <> 'WITHDRAWN')
                   when 'PAST' then x.end_at < now()
                   else x.end_at >= now() and x.status = 'PUBLISHED' end) t
   where t.rn <= 100);
end $$;

create or replace function public.race_results(p_race_id uuid, p_distance_km numeric) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.virtual_races := (select x from public.virtual_races x where x.id = p_race_id);
begin
  if r.id is null or not private.race_visible(r) then raise exception 'RACE_NOT_FOUND'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'rank', t.rn, 'user_id', t.user_id, 'display_name', p.display_name, 'avatar_url', p.avatar_url, 'bib', t.bib,
            'finish_time_s', t.finish_time_s, 'pace_s', round(t.finish_time_s / t.distance_km), 'finished_at', t.finished_at,
            'is_me', t.user_id = auth.uid()) order by t.rn), '[]'::jsonb)
    from (select g.*, row_number() over (order by g.finish_time_s, g.finished_at) as rn
            from public.race_registrations g
           where g.race_id = r.id and g.distance_km = round(p_distance_km, 2) and g.status = 'FINISHED') t
    join public.profiles p on p.id = t.user_id
   where t.rn <= 500 or t.user_id = auth.uid());
end $$;

-- Dashboard BTC: toàn bộ VĐV (kể cả chưa hoàn thành) để theo dõi và xuất CSV
create or replace function public.race_dashboard(p_race_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.virtual_races := (select x from public.virtual_races x where x.id = p_race_id);
begin
  if r.id is null then raise exception 'RACE_NOT_FOUND'; end if;
  if not private.race_is_manager(r) then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'bib', g.bib, 'display_name', p.display_name, 'user_id', g.user_id, 'distance_km', g.distance_km, 'status', g.status,
            'registered_at', g.registered_at, 'finish_time_s', g.finish_time_s, 'finish_distance_m', g.finish_distance_m,
            'finished_at', g.finished_at, 'activity_id', g.finish_activity_id)
            order by g.distance_km, g.status desc, g.finish_time_s nulls last, g.bib), '[]'::jsonb)
    from public.race_registrations g join public.profiles p on p.id = g.user_id
   where g.race_id = r.id);
end $$;

-- ---------------------------------------------------------------------
-- 6. Quyền
-- ---------------------------------------------------------------------
revoke all on function private.race_is_manager(public.virtual_races), private.race_visible(public.virtual_races),
  private.race_evaluate(uuid), private.race_on_activity(), private.race_card(public.virtual_races) from public, anon, authenticated;
revoke all on function public.create_virtual_race(jsonb), public.cancel_virtual_race(uuid, text), public.register_race(uuid, numeric),
  public.withdraw_race(uuid), public.race_detail(uuid), public.list_races(text), public.race_results(uuid, numeric),
  public.race_dashboard(uuid) from public, anon;
grant execute on function public.create_virtual_race(jsonb), public.cancel_virtual_race(uuid, text), public.register_race(uuid, numeric),
  public.withdraw_race(uuid), public.race_detail(uuid), public.list_races(text), public.race_results(uuid, numeric),
  public.race_dashboard(uuid) to authenticated;

notify pgrst, 'reload schema';
