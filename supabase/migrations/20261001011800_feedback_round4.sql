-- 011800: Chỉnh sửa lần 4.
-- 1. Victory Studio lấy đúng "Mục tiêu đăng ký" (km runner tự đăng ký) ở thử thách tự đăng ký mục tiêu.
-- 2. Quản trị hệ thống 2 tầng:
--    - Quản trị chính (chủ hệ thống): CHỈ đặt được bằng key hệ thống (SQL Editor / service role), không đặt được từ app.
--      Chỉ Quản trị chính cấp / gỡ quyền admin và phân nhóm quyền; không ai trong app gỡ được Quản trị chính.
--    - Admin thường: chỉ làm được các nhóm quyền được giao (Người dùng, Kinh tế, Đơn hàng, CLB & doanh nghiệp, Thử thách,
--      Cửa hàng & khuyến mãi, Nội dung, Kiểm duyệt, Hệ thống, Nhật ký), có thể đặt hạn dùng; không tác động được admin khác.
--    Kiểm tra nhóm quyền đặt tập trung trong is_system_admin() / require_admin() theo tên hàm RPC đang gọi (request.path),
--    nên mọi hàm admin_* cũ đều được áp dụng mà không phải viết lại.
--    Đặt Quản trị chính (chạy trong SQL Editor):  select private.admin_set_owner('email-cua-ban@...');
-- 3. Victory Studio là tính năng trả phí: mở khi runner là VIP, thành viên CLB Pro, thành viên doanh nghiệp đang hoạt động,
--    hoặc thử thách do CLB Pro tổ chức. Gói Free vẫn dùng ảnh vinh danh thông thường (tab Vinh danh, ảnh chia sẻ bài chạy).
--    Admin mở cho mọi người bằng khóa victoryStudioFree = true trong chính sách kinh tế.
-- Chạy được trong SQL Editor: không DO $$, không SELECT … INTO, không LIMIT. Chạy lại nhiều lần vẫn an toàn.

-- ---------------------------------------------------------------------
-- 1. Victory: mục tiêu đăng ký
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
    -- Thử thách tự đăng ký mục tiêu: mục tiêu là số km runner đã đăng ký (chưa đăng ký → không hiện mục tiêu)
    if coalesce(c.pledge_enabled, false) then v_target := nullif(p.pledge_km, 0); end if;
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
          (8, case when v_target is not null and coalesce(c.pledge_enabled, false)
                   then private.vic_stat('goal', 'Mục tiêu đăng ký', private.vic_score('DISTANCE', v_target))
                   when v_target is not null and coalesce(c.objective, 'DISTANCE') in ('DISTANCE', 'RUNS', 'DURATION', 'STREAK_DAYS')
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

-- ---------------------------------------------------------------------
-- 2. Quản trị chính + nhóm quyền admin
-- ---------------------------------------------------------------------
create table if not exists public.admin_permissions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  is_owner boolean not null default false,
  scopes text[] not null default '{}',
  expires_at timestamptz,
  note text check (note is null or char_length(note) <= 200),
  granted_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.admin_permissions enable row level security;
revoke all on public.admin_permissions from anon, authenticated;

create or replace function private.admin_scope_list() returns text[]
language sql immutable as $$
  select array['USERS', 'ECONOMY', 'ORDERS', 'CLUBS', 'CHALLENGES', 'SHOP', 'CONTENT', 'MODERATION', 'SYSTEM', 'AUDIT']
$$;

-- Nhóm quyền của một hàm RPC quản trị (null = mọi admin đang hoạt động đều gọi được / hàm tự kiểm tra riêng)
create or replace function private.admin_scope_of(p_fn text) returns text
language sql immutable as $$
  select case
    when p_fn is null or (p_fn !~ '^admin_' and p_fn !~ '^cms_') then null
    when p_fn in ('admin_set_user_role', 'admin_set_permissions', 'admin_team', 'admin_list_admins', 'admin_inbox') then null
    when p_fn in ('admin_search_accounts', 'admin_user_detail', 'admin_set_user_ban', 'admin_account_risks', 'admin_find_user_by_email') then 'USERS'
    when p_fn ~ '^admin_(adjust_user_xu|grant_xu|economy_|publish_config|rollback_config|config_history|topup_club_fund|save_xu_package|set_payment_account|shine_overview|set_shine_config)' then 'ECONOMY'
    when p_fn ~ '^admin_(list_orders|confirm_order|grant_plan|save_plan)' then 'ORDERS'
    when p_fn ~ '^admin_(list_challenges|cancel_challenge|grant_challenge_pass|revoke_challenge_pass|list_passes|bib_listings|hide_bib|list_race_organizers|set_race_organizer)' then 'CHALLENGES'
    when p_fn ~ '^admin_(save_shine_item|preview_segment|run_grant|list_voucher_campaigns)'
      or p_fn ~ '^admin_.*(avatar|gift|promo|quest|uniform|partner)' then 'SHOP'
    when p_fn ~ '^admin_(help_|site_info_save|set_system_notice)' or p_fn ~ '^cms_' then 'CONTENT'
    when p_fn ~ '^admin_(list_reports|resolve_report|gps_qa_list)' then 'MODERATION'
    when p_fn = 'admin_audit_list' then 'AUDIT'
    when p_fn ~ '^admin_(list_clubs|set_club_plan)' or p_fn ~ '^admin_.*org' then 'CLUBS'
    else 'SYSTEM' end
$$;

-- Tên hàm RPC đang được gọi (PostgREST đặt request.path = /rpc/<tên>)
create or replace function private.rpc_fn() returns text
language sql stable as $$
  select nullif(substring(coalesce(current_setting('request.path', true), '') from '([a-z_0-9]+)$'), '')
$$;

create or replace function private.is_admin_owner(p_uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_permissions a join public.profiles p on p.id = a.user_id
                  where a.user_id = p_uid and a.is_owner and (p.role = 'SYSTEM_ADMIN' or p.is_admin is true))
$$;

create or replace function private.admin_owner_exists() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_permissions a join public.profiles p on p.id = a.user_id
                  where a.is_owner and (p.role = 'SYSTEM_ADMIN' or p.is_admin is true))
$$;

-- Admin đang hoạt động: có vai trò admin và quyền chưa hết hạn (Quản trị chính không hết hạn)
create or replace function private.admin_active(p_uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_uid is not null
     and exists (select 1 from public.profiles p where p.id = p_uid and (p.role = 'SYSTEM_ADMIN' or p.is_admin is true))
     and not exists (select 1 from public.admin_permissions a
                      where a.user_id = p_uid and not a.is_owner and a.expires_at is not null and a.expires_at <= now())
$$;

-- Có nhóm quyền? Quản trị chính: mọi nhóm. Admin cũ chưa được phân quyền (chưa có dòng): giữ toàn quyền như trước
-- cho tới khi Quản trị chính phân quyền lại.
create or replace function private.admin_has_scope(p_uid uuid, p_scope text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_scope is null
      or not exists (select 1 from public.admin_permissions a where a.user_id = p_uid)
      or exists (select 1 from public.admin_permissions a where a.user_id = p_uid and (a.is_owner or p_scope = any(a.scopes)))
$$;

create or replace function public.is_system_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select private.admin_active(auth.uid()) and private.admin_has_scope(auth.uid(), private.admin_scope_of(private.rpc_fn()))
$$;

create or replace function private.require_admin() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_uid();
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return auth.uid();
end $$;

-- Admin toàn quyền trong CLB chỉ khi có nhóm quyền CLB & doanh nghiệp
create or replace function public.club_role(p_club uuid, p_user uuid default auth.uid()) returns text
language sql stable security definer set search_path = public as $$
  select case
    when private.admin_active(p_user) and private.admin_has_scope(p_user, 'CLUBS') then 'OWNER'
    else (select (array_agg(m.role))[1] from public.club_members m
           where m.club_id = p_club and m.user_id = p_user and m.status = 'APPROVED') end
$$;

create or replace function private.notify_admin_owners(p_actor uuid, p_title text, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select a.user_id from public.admin_permissions a where a.is_owner and a.user_id is distinct from p_actor loop
    perform private.notify(r.user_id, null, 'SYSTEM', p_title, p_body, '/admin', p_actor, true);
  end loop;
end $$;

-- Đặt / bỏ Quản trị chính: CHỈ chạy được trong SQL Editor (người giữ key hệ thống). App không gọi được.
create or replace function private.admin_set_owner(p_email text, p_on boolean default true) returns text
language plpgsql security definer set search_path = public, auth as $$
declare
  v_uid uuid := (select u.id from auth.users u where lower(u.email) = lower(trim(coalesce(p_email, ''))));
begin
  if v_uid is null then raise exception 'USER_NOT_FOUND'; end if;
  if p_on then
    if (select count(*) from public.admin_permissions a where a.is_owner and a.user_id <> v_uid) >= 3 then raise exception 'OWNER_LIMIT'; end if;
    update public.profiles set role = 'SYSTEM_ADMIN' where id = v_uid;
    insert into public.admin_permissions (user_id, is_owner, scopes, expires_at, updated_at)
    values (v_uid, true, private.admin_scope_list(), null, now())
    on conflict (user_id) do update set is_owner = true, scopes = private.admin_scope_list(), expires_at = null, updated_at = now();
  else
    update public.admin_permissions set is_owner = false, updated_at = now() where user_id = v_uid;
  end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value, reason)
  values (v_uid, case when p_on then 'ADMIN_OWNER_SET' else 'ADMIN_OWNER_UNSET' end, 'user:' || v_uid,
          jsonb_build_object('owner', p_on), 'Đặt bằng key hệ thống (SQL Editor)');
  return case when p_on then 'OWNER_SET' else 'OWNER_UNSET' end;
end $$;

-- Cấp / gỡ quyền admin: chỉ Quản trị chính. Admin mới được cấp chưa có nhóm quyền nào (phân quyền ngay sau đó).
create or replace function public.admin_set_user_role(p_user uuid, p_role text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_uid();
  v_role text := upper(coalesce(p_role, ''));
  v_old text := (select coalesce(p.role, 'MEMBER') from public.profiles p where p.id = p_user);
  v_was boolean := private.admin_active(p_user) or exists (select 1 from public.profiles p where p.id = p_user and p.is_admin is true);
begin
  if not private.admin_active(v_admin) then raise exception 'FORBIDDEN'; end if;
  if not private.admin_owner_exists() then raise exception 'OWNER_REQUIRED'; end if;
  if not private.is_admin_owner(v_admin) then raise exception 'OWNER_ONLY'; end if;
  if v_old is null then raise exception 'USER_NOT_FOUND'; end if;
  if v_role not in ('SYSTEM_ADMIN', 'MEMBER') then raise exception 'INVALID_ROLE'; end if;
  if p_user = v_admin then raise exception 'CANNOT_TARGET_SELF'; end if;
  if private.is_admin_owner(p_user) then raise exception 'CANNOT_TARGET_OWNER'; end if;
  if v_role = 'SYSTEM_ADMIN' and (select p.banned_at from public.profiles p where p.id = p_user) is not null then raise exception 'USER_BANNED'; end if;
  if v_role = 'SYSTEM_ADMIN' and not exists (select 1 from auth.users u where u.id = p_user and coalesce(u.email, '') <> '') then
    raise exception 'EMAIL_REQUIRED';
  end if;
  if v_old = v_role and (v_role = 'SYSTEM_ADMIN' or not v_was) then return jsonb_build_object('role', v_role); end if;
  update public.profiles set role = v_role, is_admin = case when v_role = 'SYSTEM_ADMIN' then is_admin else false end where id = p_user;
  if v_role = 'SYSTEM_ADMIN' then
    insert into public.admin_permissions (user_id, is_owner, scopes, granted_by, updated_at)
    values (p_user, false, '{}', v_admin, now())
    on conflict (user_id) do update set scopes = '{}', expires_at = null, granted_by = v_admin, updated_at = now();
  else
    delete from public.admin_permissions where user_id = p_user and not is_owner;
  end if;
  insert into public.admin_audit_log (actor_id, action, target, old_value, new_value, reason)
  values (v_admin, 'USER_ROLE', 'user:' || p_user, jsonb_build_object('role', v_old), jsonb_build_object('role', v_role), p_reason);
  perform private.notify(p_user, null, 'SYSTEM',
    case when v_role = 'SYSTEM_ADMIN' then 'Bạn được cấp quyền quản trị RaceHub' else 'Quyền quản trị RaceHub của bạn đã được gỡ' end,
    coalesce(p_reason, ''), case when v_role = 'SYSTEM_ADMIN' then '/admin' else '/me' end, v_admin, true);
  perform private.notify_admin_owners(v_admin,
    case when v_role = 'SYSTEM_ADMIN' then 'Đã cấp quyền admin cho ' else 'Đã gỡ quyền admin của ' end || coalesce(private.display_name(p_user), 'runner'),
    'Người thực hiện: ' || coalesce(private.display_name(v_admin), '') || coalesce(' · ' || p_reason, ''));
  return jsonb_build_object('role', v_role);
end $$;

-- Phân nhóm quyền cho một admin (chỉ Quản trị chính; không áp cho Quản trị chính khác)
create or replace function public.admin_set_permissions(p_user uuid, p_scopes text[], p_expires_at timestamptz default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_uid();
  v_scopes text[] := (select coalesce(array_agg(distinct upper(s) order by upper(s)), '{}') from unnest(coalesce(p_scopes, '{}')) s);
  v_old jsonb := (select to_jsonb(a) - 'updated_at' from public.admin_permissions a where a.user_id = p_user);
begin
  if not private.admin_active(v_admin) then raise exception 'FORBIDDEN'; end if;
  if not private.admin_owner_exists() then raise exception 'OWNER_REQUIRED'; end if;
  if not private.is_admin_owner(v_admin) then raise exception 'OWNER_ONLY'; end if;
  if p_user = v_admin then raise exception 'CANNOT_TARGET_SELF'; end if;
  if private.is_admin_owner(p_user) then raise exception 'CANNOT_TARGET_OWNER'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_user and (p.role = 'SYSTEM_ADMIN' or p.is_admin is true)) then
    raise exception 'NOT_ADMIN';
  end if;
  if not v_scopes <@ private.admin_scope_list() then raise exception 'INVALID_SCOPE'; end if;
  if p_expires_at is not null and p_expires_at <= now() then raise exception 'INVALID_EXPIRY'; end if;
  insert into public.admin_permissions (user_id, is_owner, scopes, expires_at, note, granted_by, updated_at)
  values (p_user, false, v_scopes, p_expires_at, nullif(left(trim(coalesce(p_note, '')), 200), ''), v_admin, now())
  on conflict (user_id) do update set scopes = excluded.scopes, expires_at = excluded.expires_at, note = excluded.note,
                                      granted_by = v_admin, updated_at = now();
  insert into public.admin_audit_log (actor_id, action, target, old_value, new_value, reason)
  values (v_admin, 'ADMIN_SCOPES', 'user:' || p_user, v_old,
          jsonb_build_object('scopes', v_scopes, 'expires_at', p_expires_at), p_note);
  perform private.notify(p_user, null, 'SYSTEM', 'Quyền quản trị của bạn đã được cập nhật',
    case when cardinality(v_scopes) = 0 then 'Hiện chưa có nhóm quyền nào.' else 'Nhóm quyền: ' || array_to_string(v_scopes, ', ') end
      || coalesce(' · hết hạn ' || to_char(p_expires_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY'), ''), '/admin', v_admin, true);
  return jsonb_build_object('user_id', p_user, 'scopes', v_scopes, 'expires_at', p_expires_at);
end $$;

-- Đội quản trị: mọi admin đang hoạt động xem được (minh bạch), chỉ Quản trị chính sửa được
create or replace function public.admin_team() returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare v_uid uuid := private.require_uid();
begin
  if not private.admin_active(v_uid) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'owner_exists', private.admin_owner_exists(),
    'me', jsonb_build_object('id', v_uid, 'is_owner', private.is_admin_owner(v_uid),
            'legacy', not exists (select 1 from public.admin_permissions a where a.user_id = v_uid),
            'scopes', to_jsonb(case when private.is_admin_owner(v_uid) or not exists (select 1 from public.admin_permissions a where a.user_id = v_uid)
                                    then private.admin_scope_list()
                                    else (select a.scopes from public.admin_permissions a where a.user_id = v_uid) end),
            'expires_at', (select a.expires_at from public.admin_permissions a where a.user_id = v_uid and not a.is_owner)),
    'admins', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url,
                  'email', u.email, 'last_sign_in_at', u.last_sign_in_at, 'is_me', p.id = v_uid,
                  'is_owner', coalesce(a.is_owner, false), 'legacy', a.user_id is null,
                  'scopes', to_jsonb(case when coalesce(a.is_owner, false) or a.user_id is null then private.admin_scope_list() else a.scopes end),
                  'expires_at', case when not coalesce(a.is_owner, false) then a.expires_at end,
                  'expired', not coalesce(a.is_owner, false) and a.expires_at is not null and a.expires_at <= now(),
                  'note', a.note,
                  'granted_at', (select max(l.created_at) from public.admin_audit_log l
                                  where l.action = 'USER_ROLE' and l.target = 'user:' || p.id and l.new_value->>'role' = 'SYSTEM_ADMIN'))
                order by coalesce(a.is_owner, false) desc, p.display_name), '[]'::jsonb)
                 from public.profiles p left join auth.users u on u.id = p.id left join public.admin_permissions a on a.user_id = p.id
                where p.role = 'SYSTEM_ADMIN' or p.is_admin is true));
end $$;


-- ---------------------------------------------------------------------
-- 3. Victory Studio theo gói
-- ---------------------------------------------------------------------
-- Lý do được mở (null = gói Free, chưa mở)
create or replace function private.victory_via(p_uid uuid, p_challenge text default null) returns text
language sql stable security definer set search_path = public as $$
  select case
    when coalesce(private.economy_config()->>'victoryStudioFree', 'false') = 'true' then 'FREE'
    when private.admin_active(p_uid) then 'ADMIN'
    when private.user_vip_tier(p_uid) > 0 then 'VIP'
    when exists (select 1 from public.club_members m
                  where m.user_id = p_uid and m.status = 'APPROVED' and private.club_is_pro(m.club_id)) then 'CLUB_PRO'
    when exists (select 1 from public.org_members m
                  where m.user_id = p_uid and m.status = 'APPROVED' and private.org_active(m.org_id)) then 'ORG'
    when coalesce(p_challenge, '') ~ '^[0-9a-f-]{36}$' and exists (
           select 1 from public.challenges c
            where c.id::text = lower(p_challenge) and c.target_club_id is not null and private.club_is_pro(c.target_club_id)) then 'EVENT'
  end
$$;

create or replace function public.victory_access(p_challenge text default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('unlocked', v is not null, 'via', v)
    from (select private.victory_via(auth.uid(), p_challenge) as v) t
$$;

-- Cấp mã xác thực mới (xuất ảnh Victory Studio) chỉ khi đã mở; ảnh đã cấp trước đó vẫn làm mới / xác thực được
create or replace function private.victory_gate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if private.victory_via(coalesce(new.issued_by, new.user_id), case when new.kind = 'CHALLENGE' then new.ref end) is null then
    raise exception 'VICTORY_LOCKED';
  end if;
  return new;
end $$;
drop trigger if exists trg_victory_gate on public.victory_certificates;
create trigger trg_victory_gate before insert on public.victory_certificates for each row execute function private.victory_gate();

revoke all on function private.admin_scope_list(), private.admin_scope_of(text), private.rpc_fn(), private.is_admin_owner(uuid),
  private.admin_owner_exists(), private.admin_active(uuid), private.admin_has_scope(uuid, text), private.notify_admin_owners(uuid, text, text),
  private.admin_set_owner(text, boolean), private.victory_via(uuid, text), private.victory_gate() from public, anon, authenticated;
revoke all on function public.admin_set_permissions(uuid, text[], timestamptz, text), public.admin_team(),
  public.victory_access(text), public.admin_set_user_role(uuid, text, text) from public, anon;
grant execute on function public.admin_set_permissions(uuid, text[], timestamptz, text), public.admin_team(),
  public.victory_access(text), public.admin_set_user_role(uuid, text, text) to authenticated;
