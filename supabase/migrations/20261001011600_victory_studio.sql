-- 011600: RACEHUB VICTORY STUDIO — ẢNH VINH DANH (giai đoạn 1)
--   • Nguồn thành tích của runner: thử thách · bài chạy đạt mốc (5K, 10K, Half, Marathon, kỷ lục cá nhân) · cột mốc tổng km ·
--     Level · huy hiệu. Số liệu do MÁY CHỦ điền từ dữ liệu đã xác nhận — runner chỉ đổi mẫu, màu, ảnh, lời chúc.
--   • Vinh danh theo thử thách linh hoạt: runner chọn thông số muốn hiện (kết quả, km, thời gian, buổi, hạng…);
--     BTC / ban quản trị CLB / admin vinh danh bất kỳ người tham gia nào với danh hiệu tự đặt ("Runner bền bỉ nhất"…),
--     không cần cấu hình hạng mục trước. Hạng mục vinh danh đã công bố (004900) tự hiện trên ảnh của người được vinh danh.
--   • Mã xác thực 8 ký tự + QR → trang công khai /v/<mã> để ai cũng kiểm tra được thành tích.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create table if not exists public.victory_certificates (
  code text primary key check (code ~ '^[A-Z0-9]{8}$'),
  user_id uuid not null references public.profiles(id) on delete cascade,
  issued_by uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('CHALLENGE', 'RUN', 'TOTAL_KM', 'LEVEL', 'BADGE')),
  ref text not null check (char_length(ref) between 1 and 64),
  award text check (award is null or char_length(award) between 1 and 60),
  facts jsonb not null,
  design jsonb,
  exports integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_export_at timestamptz,
  revoked_at timestamptz
);
create unique index if not exists victory_certificates_uidx on public.victory_certificates (user_id, kind, ref, (coalesce(award, '')));
create index if not exists victory_certificates_issuer_idx on public.victory_certificates (issued_by, created_at desc);
alter table public.victory_certificates enable row level security;
revoke all on public.victory_certificates from anon, authenticated;

-- ---------------------------------------------------------------------
-- Định dạng số (kiểu Việt Nam: dấu phẩy thập phân)
-- ---------------------------------------------------------------------
create or replace function private.vic_num(p numeric, p_digits integer default 2) returns text
language sql immutable as $$
  select replace(trim_scale(round(coalesce(p, 0), p_digits))::text, '.', ',')
$$;
create or replace function private.vic_km(p_meters numeric) returns text
language sql immutable as $$
  select replace(to_char(round(coalesce(p_meters, 0) / 1000.0, 2), 'FM999999990.00'), '.', ',') || ' km'
$$;
create or replace function private.vic_dur(p_seconds numeric) returns text
language sql immutable as $$
  select case when coalesce(p_seconds, 0) >= 3600
              then floor(p_seconds / 3600)::int || ':' || lpad((floor(p_seconds / 60)::int % 60)::text, 2, '0') || ':' || lpad((round(p_seconds)::int % 60)::text, 2, '0')
              else floor(coalesce(p_seconds, 0) / 60)::int || ':' || lpad((round(coalesce(p_seconds, 0))::int % 60)::text, 2, '0') end
$$;
create or replace function private.vic_stat(p_key text, p_label text, p_value text) returns jsonb
language sql immutable as $$
  select case when p_value is null or p_value = '' then null else jsonb_build_object('key', p_key, 'label', p_label, 'value', p_value) end
$$;
create or replace function private.vic_date(p timestamptz) returns text
language sql immutable as $$
  select to_char(p at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY')
$$;

-- Kết quả thử thách theo mục tiêu
create or replace function private.vic_score(p_objective text, p_value numeric) returns text
language sql immutable as $$
  select case coalesce(p_objective, 'DISTANCE')
    when 'DISTANCE' then private.vic_num(p_value, 2) || ' km'
    when 'RUNS' then round(coalesce(p_value, 0))::text || ' buổi'
    when 'DURATION' then private.vic_dur(coalesce(p_value, 0) * 60)
    when 'STREAK_DAYS' then round(coalesce(p_value, 0))::text || ' ngày'
    else round(coalesce(p_value, 0))::text || ' hạng mục' end
$$;

-- Ai được vinh danh người khác trong một thử thách: người tạo, ban quản trị CLB của thử thách, admin hệ thống
-- (nhận text, so sánh id::text để không phải ép kiểu khi mã không phải uuid)
create or replace function private.victory_can_manage(p_kind text, p_ref text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_kind = 'CHALLENGE' and exists (select 1 from public.challenges c
                  where c.id::text = lower(p_ref)
                    and (c.created_by = auth.uid() or public.is_system_admin()
                         or (c.target_club_id is not null and public.club_is_staff(c.target_club_id))))
$$;

-- ---------------------------------------------------------------------
-- Số liệu chính thức của một thành tích (máy chủ tính, không nhận từ người dùng)
-- ---------------------------------------------------------------------
create or replace function private.victory_facts(p_uid uuid, p_kind text, p_ref text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c public.challenges;
  p public.challenge_participants;
  a public.activities;
  v_ended boolean;
  v_total integer;
  v_rank integer;
  v_state text;
  v_club text;
  v_dist numeric;
  v_km numeric;
  v_mile text;
  v_mile_km numeric;
  v_pace numeric;
  v_pr boolean;
  v_target numeric;
  v_runs integer;
  v_first timestamptz;
  v_reached timestamptz;
  v_level integer;
  v_xp integer;
  v_title text;
  v_desc text;
  v_icon text;
  v_tier text;
  v_at timestamptz;
begin
  if p_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_kind = 'CHALLENGE' then
    if p_ref !~ '^[0-9a-f-]{36}$' then raise exception 'NOT_FOUND'; end if;
    c := (select x from public.challenges x where x.id = p_ref::uuid);
    if c.id is null or c.status = 'CANCELLED' then raise exception 'NOT_FOUND'; end if;
    p := (select x from public.challenge_participants x where x.challenge_id = c.id and x.profile_id = p_uid and x.status <> 'LEFT');
    if p.id is null then raise exception 'NOT_PARTICIPANT'; end if;
    if coalesce(p.current_progress, 0) <= 0 and p.completed_at is null then raise exception 'NO_RESULT'; end if;
    v_ended := c.status = 'FINISHED' or c.end_date < now();
    v_total := (select count(*) from public.challenge_participants x where x.challenge_id = c.id and x.status <> 'LEFT');
    v_rank := coalesce(p.final_rank, 1 + (select count(*) from public.challenge_participants x
                                           where x.challenge_id = c.id and x.status <> 'LEFT' and x.current_progress > p.current_progress))::int;
    v_state := case when p.completed_at is not null then 'COMPLETED' when v_ended then 'FINISHED' else 'IN_PROGRESS' end;
    v_club := (select cl.name from public.clubs cl where cl.id = c.target_club_id);
    v_target := coalesce(nullif(c.target_value, 0), nullif(c.target_km, 0));
    return jsonb_build_object(
      'kind', 'CHALLENGE', 'ref', c.id, 'state', v_state,
      'headline', case v_state when 'COMPLETED' then 'Hoàn thành thử thách' when 'FINISHED' then 'Về đích thử thách' else 'Đang chinh phục' end,
      'title', c.title,
      'subtitle', case when v_ended then 'Kết thúc ' || private.vic_date(c.end_date) else 'Đến ' || private.vic_date(c.end_date) end,
      'date', private.vic_date(coalesce(p.completed_at, case when v_ended then c.end_date end, now())),
      'club', v_club,
      'link', '/challenges/' || c.id,
      'stats', coalesce((select jsonb_agg(s order by o) from (values
          (1, private.vic_stat('score', 'Kết quả', private.vic_score(c.objective, p.current_progress))),
          (2, case when v_total > 1 then private.vic_stat('rank', case when v_ended then 'Thứ hạng' else 'Hạng tạm tính' end, v_rank || '/' || v_total) end),
          (3, case when coalesce(p.distance_m, 0) > 0 and coalesce(c.objective, 'DISTANCE') <> 'DISTANCE' then private.vic_stat('km', 'Quãng đường', private.vic_km(p.distance_m)) end),
          (4, case when coalesce(p.moving_s, 0) > 0 then private.vic_stat('time', 'Thời gian', private.vic_dur(p.moving_s)) end),
          (5, case when coalesce(p.run_count, 0) > 0 and coalesce(c.objective, 'DISTANCE') <> 'RUNS' then private.vic_stat('runs', 'Buổi chạy', p.run_count::text) end),
          (6, case when coalesce(p.streak_days, 0) > 0 and coalesce(c.objective, 'DISTANCE') <> 'STREAK_DAYS' then private.vic_stat('days', 'Ngày chạy', p.streak_days::text) end),
          (7, case when coalesce(p.distance_m, 0) >= 1000 and coalesce(p.moving_s, 0) > 0
                   then private.vic_stat('pace', 'Pace TB', private.pace_text(p.moving_s / (p.distance_m / 1000.0)) || '/km') end),
          (8, case when v_target is not null and coalesce(c.objective, 'DISTANCE') in ('DISTANCE', 'RUNS', 'DURATION', 'STREAK_DAYS')
                   then private.vic_stat('goal', 'Mục tiêu', private.vic_score(c.objective, v_target)) end),
          (9, case when p.completed_at is not null then private.vic_stat('done', 'Hoàn thành', private.vic_date(p.completed_at)) end)
        ) t(o, s) where s is not null), '[]'::jsonb),
      -- Hạng mục vinh danh BTC đã công bố
      'honors', coalesce((select jsonb_agg(coalesce((select cat->>'title' from jsonb_array_elements(h.categories) cat where cat->>'key' = ho.category),
                                                     ho.category) || case when ho.category like 'CUSTOM%' then '' else ' · Hạng ' || ho.rank end
                                            order by ho.category, ho.rank)
                           from public.challenge_honorees ho join public.challenge_honors h on h.challenge_id = ho.challenge_id and h.status = 'PUBLISHED'
                          where ho.challenge_id = c.id and ho.user_id = p_uid), '[]'::jsonb));

  elsif p_kind = 'RUN' then
    if p_ref !~ '^[0-9a-f-]{36}$' then raise exception 'NOT_FOUND'; end if;
    a := (select x from public.activities x where x.id = p_ref::uuid and x.user_id = p_uid);
    if a.id is null or not public.activity_is_countable(a.status, a.validation_status) then raise exception 'NOT_FOUND'; end if;
    v_dist := coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0);
    v_km := v_dist / 1000.0;
    if v_km < 1 or coalesce(a.moving_time_s, 0) <= 0 then raise exception 'NOT_ELIGIBLE'; end if;
    v_mile := case when v_km >= 42.195 then 'Marathon' when v_km >= 21.0975 then 'Half Marathon' when v_km >= 10 then '10K' when v_km >= 5 then '5K' end;
    v_mile_km := case when v_km >= 42.195 then 42.195 when v_km >= 21.0975 then 21.0975 when v_km >= 10 then 10 when v_km >= 5 then 5 end;
    v_pace := a.moving_time_s / v_km;
    -- Kỷ lục cá nhân: pace nhanh nhất trong các bài cùng mốc trở lên
    v_pr := v_mile is not null and not exists (
      select 1 from public.activities b
       where b.user_id = p_uid and b.id <> a.id and public.activity_is_countable(b.status, b.validation_status)
         and coalesce(nullif(b.moving_distance_m, 0), b.distance_m, 0) >= v_mile_km * 1000 and coalesce(b.moving_time_s, 0) > 0
         and b.moving_time_s / (coalesce(nullif(b.moving_distance_m, 0), b.distance_m) / 1000.0) < v_pace);
    return jsonb_build_object(
      'kind', 'RUN', 'ref', a.id, 'state', case when v_pr then 'PR' else 'DONE' end,
      'headline', case when v_pr then 'Kỷ lục cá nhân' when v_mile is not null then 'Chinh phục ' || v_mile else 'Hoàn thành bài chạy' end,
      'title', coalesce(v_mile, private.vic_km(v_dist)),
      'subtitle', coalesce(nullif(trim(a.title), ''), 'Chạy bộ'),
      'date', private.vic_date(a.started_at),
      'club', null, 'link', '/activities/' || a.id,
      'stats', coalesce((select jsonb_agg(s order by o) from (values
          (1, private.vic_stat('km', 'Quãng đường', private.vic_km(v_dist))),
          (2, private.vic_stat('time', 'Thời gian', private.vic_dur(a.moving_time_s))),
          (3, private.vic_stat('pace', 'Pace', private.pace_text(v_pace) || '/km')),
          (4, case when coalesce(a.elevation_gain_m, 0) >= 1 then private.vic_stat('elev', 'Leo cao', round(a.elevation_gain_m)::text || ' m') end)
        ) t(o, s) where s is not null), '[]'::jsonb),
      'honors', '[]'::jsonb);

  elsif p_kind = 'TOTAL_KM' then
    if p_ref not in ('50', '100', '200', '300', '500', '1000', '2000', '3000', '5000', '10000') then raise exception 'NOT_FOUND'; end if;
    v_dist := (select coalesce(sum(coalesce(nullif(x.moving_distance_m, 0), x.distance_m, 0)), 0) from public.activities x
                where x.user_id = p_uid and public.activity_is_countable(x.status, x.validation_status));
    if v_dist < p_ref::numeric * 1000 then raise exception 'NOT_ELIGIBLE'; end if;
    v_runs := (select count(*) from public.activities x where x.user_id = p_uid and public.activity_is_countable(x.status, x.validation_status));
    v_first := (select min(x.started_at) from public.activities x where x.user_id = p_uid and public.activity_is_countable(x.status, x.validation_status));
    v_reached := (select min(t.started_at) from (
                    select x.started_at, sum(coalesce(nullif(x.moving_distance_m, 0), x.distance_m, 0)) over (order by x.started_at, x.id) as cum
                      from public.activities x where x.user_id = p_uid and public.activity_is_countable(x.status, x.validation_status)) t
                   where t.cum >= p_ref::numeric * 1000);
    return jsonb_build_object(
      'kind', 'TOTAL_KM', 'ref', p_ref, 'state', 'DONE',
      'headline', 'Cột mốc hành trình', 'title', p_ref || ' KM', 'subtitle', 'Tổng quãng đường chạy trên RaceHub',
      'date', private.vic_date(coalesce(v_reached, now())), 'club', null, 'link', '/me',
      'stats', coalesce((select jsonb_agg(s order by o) from (values
          (1, private.vic_stat('km', 'Tổng quãng đường', private.vic_km(v_dist))),
          (2, private.vic_stat('runs', 'Buổi chạy', v_runs::text)),
          (3, private.vic_stat('since', 'Từ ngày', private.vic_date(v_first)))
        ) t(o, s) where s is not null), '[]'::jsonb),
      'honors', '[]'::jsonb);

  elsif p_kind = 'LEVEL' then
    if p_ref !~ '^[0-9]{1,2}$' then raise exception 'NOT_FOUND'; end if;
    v_level := (select coalesce(x.level, 1) from public.profiles x where x.id = p_uid);
    v_xp := (select coalesce(x.xp, 0) from public.profiles x where x.id = p_uid);
    if p_ref::int < 2 or p_ref::int > coalesce(v_level, 1) then raise exception 'NOT_ELIGIBLE'; end if;
    return jsonb_build_object(
      'kind', 'LEVEL', 'ref', p_ref, 'state', 'DONE',
      'headline', 'Lên cấp', 'title', 'Level ' || p_ref, 'subtitle', private.level_name(p_ref::int),
      'date', private.vic_date(now()), 'club', null, 'link', '/me',
      'stats', jsonb_build_array(
          private.vic_stat('level', 'Cấp độ', p_ref),
          private.vic_stat('title', 'Danh hiệu', private.level_name(p_ref::int)),
          private.vic_stat('xp', 'Tổng XP', v_xp::text)),
      'honors', '[]'::jsonb);

  elsif p_kind = 'BADGE' then
    v_title := (select x.title from public.achievements x join public.user_achievements u on u.achievement_id = x.id
                 where x.code = p_ref and u.user_id = p_uid);
    if v_title is null then raise exception 'NOT_FOUND'; end if;
    v_desc := (select x.description from public.achievements x where x.code = p_ref);
    v_icon := (select x.icon from public.achievements x where x.code = p_ref);
    v_tier := (select x.tier from public.achievements x where x.code = p_ref);
    v_at := (select min(u.unlocked_at) from public.achievements x join public.user_achievements u on u.achievement_id = x.id
              where x.code = p_ref and u.user_id = p_uid);
    return jsonb_build_object(
      'kind', 'BADGE', 'ref', p_ref, 'state', 'DONE', 'icon', v_icon,
      'headline', 'Huy hiệu mới', 'title', v_title, 'subtitle', v_desc,
      'date', private.vic_date(v_at), 'club', null, 'link', '/me?tab=badges',
      'stats', coalesce((select jsonb_agg(s order by o) from (values
          (1, private.vic_stat('badge', 'Huy hiệu', v_title)),
          (2, private.vic_stat('tier', 'Hạng', case lower(coalesce(v_tier, '')) when 'bronze' then 'Đồng' when 'silver' then 'Bạc'
                                                   when 'gold' then 'Vàng' when 'platinum' then 'Bạch kim' when 'diamond' then 'Kim cương' else v_tier end)),
          (3, private.vic_stat('at', 'Mở khóa', private.vic_date(v_at)))
        ) t(o, s) where s is not null), '[]'::jsonb),
      'honors', '[]'::jsonb);
  end if;
  raise exception 'NOT_FOUND';
end $$;

create or replace function private.victory_person(p_uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url, 'level', coalesce(p.level, 1))
    from public.profiles p where p.id = p_uid
$$;

-- ---------------------------------------------------------------------
-- Thành tích tạo được ảnh (màn chọn đầu tiên của Victory Studio)
-- ---------------------------------------------------------------------
create or replace function public.victory_sources() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_total numeric := (select coalesce(sum(coalesce(nullif(x.moving_distance_m, 0), x.distance_m, 0)), 0) from public.activities x
                       where x.user_id = v_uid and public.activity_is_countable(x.status, x.validation_status));
begin
  return jsonb_build_object(
    'challenges', coalesce((select jsonb_agg(jsonb_build_object('ref', t.id, 'title', t.title, 'state', t.state, 'date', private.vic_date(t.at),
                             'subtitle', t.sub) order by t.at desc)
      from (select c.id, c.title, coalesce(p.completed_at, least(c.end_date, now())) as at,
                   case when p.completed_at is not null then 'COMPLETED' when c.status = 'FINISHED' or c.end_date < now() then 'FINISHED' else 'IN_PROGRESS' end as state,
                   private.vic_score(c.objective, p.current_progress) as sub,
                   row_number() over (order by coalesce(p.completed_at, least(c.end_date, now())) desc) as rn
              from public.challenge_participants p join public.challenges c on c.id = p.challenge_id
             where p.profile_id = v_uid and p.status <> 'LEFT' and c.status <> 'CANCELLED'
               and (coalesce(p.current_progress, 0) > 0 or p.completed_at is not null)) t where t.rn <= 30), '[]'::jsonb),
    'runs', coalesce((select jsonb_agg(jsonb_build_object('ref', t.id, 'title', t.mile, 'subtitle', t.title || ' · ' || private.vic_km(t.dist),
                        'date', private.vic_date(t.started_at)) order by t.started_at desc)
      from (select a.id, coalesce(nullif(trim(a.title), ''), 'Chạy bộ') as title, a.started_at, coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0) as dist,
                   case when coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0) >= 42195 then 'Marathon'
                        when coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0) >= 21097.5 then 'Half Marathon'
                        when coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0) >= 10000 then '10K' else '5K' end as mile,
                   row_number() over (order by a.started_at desc) as rn
              from public.activities a
             where a.user_id = v_uid and public.activity_is_countable(a.status, a.validation_status)
               and coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0) >= 5000 and coalesce(a.moving_time_s, 0) > 0
               and a.started_at > now() - interval '400 days') t where t.rn <= 20), '[]'::jsonb),
    'totals', coalesce((select jsonb_agg(jsonb_build_object('ref', m::text, 'title', m || ' KM') order by m desc)
      from unnest(array[50, 100, 200, 300, 500, 1000, 2000, 3000, 5000, 10000]) m where m * 1000 <= v_total), '[]'::jsonb),
    'total_km', round(v_total / 1000.0, 1),
    'levels', coalesce((select jsonb_agg(jsonb_build_object('ref', l::text, 'title', 'Level ' || l, 'subtitle', private.level_name(l)) order by l desc)
      from generate_series(2, (select coalesce(x.level, 1) from public.profiles x where x.id = v_uid)) l), '[]'::jsonb),
    'badges', coalesce((select jsonb_agg(jsonb_build_object('ref', t.code, 'title', t.title, 'icon', t.icon, 'date', private.vic_date(t.unlocked_at))
                          order by t.unlocked_at desc)
      from (select x.code, x.title, x.icon, u.unlocked_at, row_number() over (order by u.unlocked_at desc) as rn
              from public.user_achievements u join public.achievements x on x.id = u.achievement_id where u.user_id = v_uid) t
     where t.rn <= 30), '[]'::jsonb),
    -- Thử thách mình quản lý → vinh danh người khác
    'managed', coalesce((select jsonb_agg(jsonb_build_object('ref', t.id, 'title', t.title, 'date', private.vic_date(t.end_date),
                           'participants', t.n) order by t.end_date desc)
      from (select c.id, c.title, c.end_date,
                   (select count(*) from public.challenge_participants x where x.challenge_id = c.id and x.status <> 'LEFT') as n,
                   row_number() over (order by c.end_date desc) as rn
              from public.challenges c
             where c.status <> 'CANCELLED' and c.start_date < now()
               and (c.created_by = v_uid or (c.target_club_id is not null and public.club_is_staff(c.target_club_id)))) t
     where t.rn <= 30), '[]'::jsonb));
end $$;

-- Xem trước số liệu (chưa cấp mã). p_user: vinh danh người khác (chỉ thử thách, chỉ người quản lý thử thách)
create or replace function public.victory_facts(p_kind text, p_ref text, p_user uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); v_target uuid := coalesce(p_user, v_uid);
begin
  if v_target <> v_uid and not private.victory_can_manage(p_kind, p_ref) then
    raise exception 'FORBIDDEN';
  end if;
  return private.victory_facts(v_target, p_kind, p_ref)
      || jsonb_build_object('person', private.victory_person(v_target), 'can_award', private.victory_can_manage(p_kind, p_ref));
end $$;

-- Cấp (hoặc làm mới) mã xác thực cho ảnh chính thức
create or replace function public.issue_victory(p_kind text, p_ref text, p_user uuid default null, p_award text default null, p_design jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_target uuid := coalesce(p_user, v_uid);
  v_award text := nullif(left(trim(coalesce(p_award, '')), 60), '');
  v_manage boolean := private.victory_can_manage(p_kind, p_ref);
  v_facts jsonb;
  v_code text;
  v_new boolean;
begin
  if v_target <> v_uid and not v_manage then raise exception 'FORBIDDEN'; end if;
  if v_award is not null and not v_manage then raise exception 'FORBIDDEN'; end if;
  if (select count(*) from public.victory_certificates x where x.issued_by = v_uid and x.updated_at > now() - interval '1 day') >= 300 then
    raise exception 'RATE_LIMITED';
  end if;
  v_facts := private.victory_facts(v_target, p_kind, p_ref);
  v_code := (select x.code from public.victory_certificates x
              where x.user_id = v_target and x.kind = p_kind and x.ref = p_ref and coalesce(x.award, '') = coalesce(v_award, ''));
  v_new := v_code is null;
  if v_new then
    v_code := upper(substr(md5(gen_random_uuid()::text), 1, 8));
    while exists (select 1 from public.victory_certificates x where x.code = v_code) loop
      v_code := upper(substr(md5(gen_random_uuid()::text), 1, 8));
    end loop;
    insert into public.victory_certificates (code, user_id, issued_by, kind, ref, award, facts, design)
    values (v_code, v_target, v_uid, p_kind, p_ref, v_award, v_facts,
            case when p_design is not null and length(p_design::text) <= 4000 then p_design end);
    if v_target <> v_uid then
      perform private.notify(v_target, null, 'VICTORY', coalesce(v_award, v_facts->>'headline') || ' 🏅',
        private.display_name(v_uid) || ' vinh danh bạn trong thử thách ' || coalesce(v_facts->>'title', ''), '/v/' || v_code, v_uid, true);
    end if;
  else
    update public.victory_certificates set facts = v_facts, revoked_at = null, updated_at = now(),
           design = case when p_design is not null and length(p_design::text) <= 4000 then p_design else design end
     where code = v_code;
  end if;
  return jsonb_build_object('code', v_code, 'new', v_new, 'facts', v_facts, 'award', v_award, 'person', private.victory_person(v_target));
end $$;

-- Ghi nhận một lần xuất ảnh (lịch sử + thiết kế đã dùng)
create or replace function public.record_victory_export(p_code text, p_design jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  update public.victory_certificates
     set exports = exports + 1, last_export_at = now(),
         design = case when p_design is not null and length(p_design::text) <= 4000 then p_design else design end
   where code = upper(p_code) and (user_id = v_uid or issued_by = v_uid);
end $$;

-- Trang xác thực công khai: ai có mã / quét QR đều xem được
create or replace function public.verify_victory(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('code', v.code, 'kind', v.kind, 'facts', v.facts, 'award', v.award,
           'person', private.victory_person(v.user_id),
           'issued_by', case when v.issued_by is not null and v.issued_by <> v.user_id then private.display_name(v.issued_by) end,
           'created_at', v.created_at, 'updated_at', v.updated_at)
    from public.victory_certificates v
   where v.code = upper(trim(coalesce(p_code, ''))) and v.revoked_at is null
$$;

-- Ảnh vinh danh của tôi (mình được vinh danh hoặc mình đã vinh danh người khác)
create or replace function public.my_victories() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'kind', t.kind, 'ref', t.ref, 'award', t.award, 'facts', t.facts,
            'person', private.victory_person(t.user_id), 'mine', t.user_id = auth.uid(), 'exports', t.exports, 'created_at', t.created_at)
          order by t.updated_at desc), '[]'::jsonb)
    from (select v.*, row_number() over (order by v.updated_at desc) as rn from public.victory_certificates v
           where (v.user_id = auth.uid() or v.issued_by = auth.uid()) and v.revoked_at is null) t
   where t.rn <= 60
$$;

-- Thu hồi mã (người được vinh danh, người cấp, admin)
create or replace function public.revoke_victory(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  update public.victory_certificates set revoked_at = now()
   where code = upper(p_code) and (user_id = v_uid or issued_by = v_uid or public.is_system_admin());
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

revoke all on function private.vic_num(numeric, integer), private.vic_km(numeric), private.vic_dur(numeric), private.vic_stat(text, text, text),
  private.vic_date(timestamptz), private.vic_score(text, numeric), private.victory_can_manage(text, text), private.victory_facts(uuid, text, text),
  private.victory_person(uuid) from public, anon, authenticated;
revoke all on function public.victory_sources(), public.victory_facts(text, text, uuid), public.issue_victory(text, text, uuid, text, jsonb),
  public.record_victory_export(text, jsonb), public.verify_victory(text), public.my_victories(), public.revoke_victory(text) from public, anon;
grant execute on function public.victory_sources(), public.victory_facts(text, text, uuid), public.issue_victory(text, text, uuid, text, jsonb),
  public.record_victory_export(text, jsonb), public.verify_victory(text), public.my_victories(), public.revoke_victory(text) to authenticated;
grant execute on function public.verify_victory(text) to anon;
