-- RaceHub — PHẦN 19/20 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 011800, 011900, 012000, 012100, 012200, 012300
-- Supabase → SQL Editor → New query → dán TOÀN BỘ phần này → Run. Lỗi thì không có gì thay đổi; chạy lại vẫn an toàn.
-- Xong thì chạy phần tiếp theo.
begin;
-- ===================================================================
-- 20261001011800_feedback_round4.sql
-- ===================================================================
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

-- ===================================================================
-- 20261001011900_profiles_privacy.sql
-- ===================================================================
-- 011900: Vá lộ dữ liệu (kết quả quét bằng anon key, không đăng nhập).
--   profiles: còn 2 policy cũ "Allow public select profile" / "Public profiles are viewable by everyone" (USING true, cho cả anon)
--   → ai có anon key (nằm sẵn trong app web) đọc được MỌI cột của MỌI người: role, xu, strava_athlete_id, referral_code,
--   banned_reason… Token Strava đã được dọn từ 000100 (cột luôn null) nên không lộ token.
-- Sửa:
--   1. Khách chưa đăng nhập: không đọc được profiles.
--   2. Người đã đăng nhập: chỉ đọc CỘT CÔNG KHAI của người khác (id, tên, ảnh, level, giới tính, giới thiệu, ngày tham gia) — đủ cho các
--      chỗ app ghép tên / ảnh (bảng tin, bình luận, thành viên CLB, quỹ, thông báo).
--   3. Hồ sơ đầy đủ của CHÍNH MÌNH (Xu, XP, vai trò, Strava, mã giới thiệu…) đọc qua RPC my_account().
--   4. club_members, club_treasury_log, profile_settings, sổ cái: khách chưa đăng nhập bị từ chối hẳn (trước đây trả
--      200 + rỗng nhờ RLS; nay chặn thêm một lớp ở quyền bảng).
-- RPC SECURITY DEFINER (mọi màn hình khác) không bị ảnh hưởng. Chạy được trong SQL Editor, chạy lại an toàn.

-- 1 + 2. profiles
drop policy if exists "Allow public select profile" on public.profiles;
drop policy if exists "Public profiles are viewable by everyone" on public.profiles;
drop policy if exists "profiles_select_signed_in" on public.profiles;
create policy "profiles_select_signed_in" on public.profiles for select to authenticated using (true);

revoke select on public.profiles from anon, authenticated;
grant select (id, display_name, avatar_url, level, gender, bio, created_at) on public.profiles to authenticated;

-- 3. Hồ sơ đầy đủ của chính mình (bỏ các cột token cũ)
create or replace function public.my_account() returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(p) - 'strava_access_token' - 'strava_refresh_token' - 'strava_token_expires_at'
    from public.profiles p where p.id = auth.uid()
$$;
revoke all on function public.my_account() from public, anon;
grant execute on function public.my_account() to authenticated;

-- 4. Khách chưa đăng nhập không đọc các bảng riêng tư (RLS vẫn là lớp chính cho người đã đăng nhập)
revoke select on public.club_members, public.club_treasury_log, public.profile_settings,
  public.ledger_entries, public.ledger_transactions, public.wallet_transactions from anon;

-- ===================================================================
-- 20261001012000_pledge_required.sql
-- ===================================================================
-- 012000: Thử thách theo mục tiêu (pledge): tham gia BẮT BUỘC kèm mục tiêu.
--   join_challenge_pledge(id, km, code): vào thử thách + đặt mục tiêu trong CÙNG một giao dịch — mục tiêu không hợp lệ / đã khóa
--   thì không vào (không còn người "tham gia nhưng chưa đăng ký mục tiêu").
--   Người đã vào từ trước mà chưa có mục tiêu: app nhắc đăng ký (set_my_pledge vẫn dùng như cũ).
-- Chạy được trong SQL Editor, chạy lại an toàn.

create or replace function public.join_challenge_pledge(p_challenge_id uuid, p_km numeric, p_code text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_join jsonb;
begin
  perform private.require_uid();
  if not exists (select 1 from public.challenges where id = p_challenge_id) then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if not exists (select 1 from public.challenges where id = p_challenge_id and pledge_enabled) then raise exception 'PLEDGE_NOT_SUPPORTED'; end if;
  if p_km is null or p_km <= 0 then raise exception 'PLEDGE_REQUIRED'; end if;
  v_join := public.join_challenge(p_challenge_id, p_code, null);
  perform public.set_my_pledge(p_challenge_id, p_km);
  return coalesce(v_join, '{}'::jsonb) || jsonb_build_object('pledge_km', round(p_km, 1));
end $$;

revoke all on function public.join_challenge_pledge(uuid, numeric, text) from public, anon;
grant execute on function public.join_challenge_pledge(uuid, numeric, text) to authenticated;

-- ===================================================================
-- 20261001012100_perf_clubs_inbox.sql
-- ===================================================================
-- Tăng tốc danh sách CLB (tab CLB): đếm tin chưa đọc tối đa 100 (giao diện chỉ hiện "99+"),
-- không phải quét toàn bộ lịch sử chat của CLB chưa từng mở. Kết quả trả về giữ nguyên các cột.
create or replace function public.my_clubs_inbox()
returns table (
  club_id uuid, name text, avatar_url text, accent_color text, role text, member_status text,
  member_count integer, unread_count integer, last_message_body text, last_message_author text,
  last_message_at timestamptz, pinned_title text
)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.avatar_url, c.accent_color, m.role, m.status, c.member_count,
         case when m.status <> 'APPROVED' then 0 else (
           select count(*)::int from (
             select 1 from public.club_messages x
              where x.club_id = c.id and x.deleted_at is null and x.author_id <> (select auth.uid())
                and x.created_at > coalesce((select r.last_read_at from public.club_message_reads r
                                              where r.club_id = c.id and r.user_id = (select auth.uid())), m.joined_at, '-infinity')
              order by x.created_at desc
              limit 100) u)
         end,
         lm.body, private.display_name(lm.author_id), lm.created_at,
         (select coalesce(p.title, left(p.body, 80)) from public.club_posts p
           where p.club_id = c.id and p.is_pinned and p.deleted_at is null
           order by p.created_at desc limit 1)
    from public.club_members m
    join public.clubs c on c.id = m.club_id
    left join lateral (
      select x.body, x.author_id, x.created_at from public.club_messages x
       where x.club_id = c.id and x.deleted_at is null and m.status = 'APPROVED'
       order by x.created_at desc limit 1) lm on true
   where m.user_id = (select auth.uid()) and m.status in ('APPROVED', 'PENDING')
   order by coalesce(lm.created_at, m.joined_at) desc nulls last
$$;

-- ===================================================================
-- 20261001012200_perf_game_state.sql
-- ===================================================================
-- Trang chủ nhẹ hơn: my_game_state chỉ "bắt kịp" huy hiệu tối đa 1 lần / 10 phút cho mỗi người
-- (quét toàn bộ bài chạy). Huy hiệu từ bài chạy mới vẫn được chấm ngay khi bài được trả thưởng (game_after_run).
-- Không đổi cách tính XP, Xu, huy hiệu hay thử thách — chỉ đổi tần suất kiểm tra.
create table if not exists private.achievement_catchup (
  user_id uuid primary key references auth.users(id) on delete cascade,
  checked_at timestamptz not null default now()
);

create or replace function private.catch_up_achievements(p_uid uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  insert into private.achievement_catchup as c (user_id, checked_at) values (p_uid, now())
  on conflict (user_id) do update set checked_at = excluded.checked_at
   where c.checked_at < excluded.checked_at - interval '10 minutes';
  get diagnostics v_n = row_count;
  if v_n = 0 then return false; end if;
  perform private.evaluate_achievements(p_uid, null);
  return true;
end $$;

revoke all on function private.catch_up_achievements(uuid) from public, anon, authenticated;
revoke all on private.achievement_catchup from public, anon, authenticated;

create or replace function public.my_game_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_now timestamptz := now();
  v_today date := private.vn_day(v_now);
  v_week date := private.vn_week(v_now);
  cfg jsonb := private.game_config();
  s public.user_streaks;
  w_km numeric;
  w_runs integer;
  w_days integer;
  v_gap integer;
  v_alive boolean;
  v_daily integer := 0;
  v_prev date;
  d date;
  v_quests jsonb;
  v_league jsonb := null;
  v_group uuid;
  v_tier integer;
  v_events jsonb;
begin
  perform private.settle_leagues_due();
  perform private.catch_up_achievements(v_uid);                  -- bắt kịp huy hiệu (tối đa 1 lần / 10 phút)
  s := private.ensure_streak(v_uid);
  select ws.km, ws.runs, ws.days into w_km, w_runs, w_days from private.week_run_stats(v_uid, v_week) as ws;

  v_gap := case when s.last_week is null then null else (v_week - s.last_week) / 7 - 1 end;
  -- Còn chuỗi: tuần này đã đạt, hoặc tuần trước đạt, hoặc số tuần hụt ≤ số khiên
  v_alive := s.last_week is not null and (s.last_week = v_week or v_gap <= s.shields);

  -- Chuỗi ngày liên tiếp (hôm nay hoặc hôm qua còn chạy)
  for d in select distinct private.vn_day(a.started_at) as day from public.activities a
            where a.user_id = v_uid and a.rewarded_at is not null and a.validation_status = 'APPROVED'
              and coalesce(a.status, '') <> 'DELETED' and a.started_at > v_now - interval '400 days'
            order by 1 desc loop
    if v_prev is null then
      exit when d < v_today - 1;
    else
      exit when d <> v_prev - 1;
    end if;
    v_daily := v_daily + 1;
    v_prev := d;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id, 'code', q.code, 'period', q.period, 'metric', q.metric, 'title', q.title, 'description', q.description,
           'icon', q.icon, 'target', q.target, 'reward_xu', q.reward_xu, 'reward_xp', q.reward_xp,
           'progress', least(coalesce(p.progress, 0), q.target), 'completed', p.completed_at is not null)
           order by q.period, q.sort), '[]'::jsonb)
    from public.quests q
    left join public.user_quest_progress p on p.quest_id = q.id and p.user_id = v_uid
         and p.period_start = case q.period when 'DAILY' then v_today else v_week end
   where q.is_active
    into v_quests;

  select group_id from public.league_members where user_id = v_uid and week_start = v_week into v_group;
  v_tier := coalesce((select tier from public.user_league where user_id = v_uid), 1);
  if v_group is not null then
    with lb as (
      select lm.user_id, private.league_points(lm.user_id, v_week) as pts, lm.joined_at
        from public.league_members lm where lm.group_id = v_group),
    rk as (select user_id, pts, row_number() over (order by pts desc, joined_at) as rank from lb)
    select jsonb_build_object(
             'group_id', v_group, 'tier', v_tier, 'tier_name', private.league_name(v_tier),
             'size', (select count(*) from rk),
             'rank', (select rank from rk where user_id = v_uid),
             'points', (select pts from rk where user_id = v_uid),
             'promote', (select promote from private.league_zones((select count(*)::int from rk), v_tier)),
             'demote', (select demote from private.league_zones((select count(*)::int from rk), v_tier)),
             'ends_at', private.vn_start(v_week + 7))
      into v_league;
  end if;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at), '[]'::jsonb)
    from (select id, kind, title, subtitle, xu, xp, activity_id, payload, created_at from public.game_events
           where user_id = v_uid and seen_at is null and created_at > v_now - interval '7 days'
           order by created_at desc limit 12) e
    into v_events;

  return jsonb_build_object(
    'today', v_today, 'week_start', v_week,
    'checked_in', exists (select 1 from public.user_quest_progress p join public.quests q on q.id = p.quest_id
                           where p.user_id = v_uid and q.metric = 'CHECKIN' and p.period_start = v_today and p.progress >= 1),
    'week', jsonb_build_object('km', round(coalesce(w_km, 0), 2), 'runs', coalesce(w_runs, 0), 'days', coalesce(w_days, 0)),
    'streak', jsonb_build_object(
      'goal', s.weekly_goal, 'week_days', coalesce(w_days, 0), 'done_this_week', s.last_week = v_week,
      'current', case when v_alive then s.current_weeks else 0 end, 'best', s.best_weeks, 'alive', v_alive,
      'at_risk_weeks', greatest(coalesce(v_gap, 0), 0), 'shields', s.shields,
      'max_shields', (cfg->>'maxShields')::int, 'shield_price', (cfg->>'shieldPrice')::numeric, 'daily', v_daily),
    'quests', v_quests,
    'league', coalesce(v_league, jsonb_build_object('group_id', null, 'tier', v_tier, 'tier_name', private.league_name(v_tier))),
    'unseen', v_events);
end $$;

-- ===================================================================
-- 20261001012300_perf_rls_admin_check.sql
-- ===================================================================
-- Tăng tốc đọc dữ liệu: các chính sách RLS gọi is_system_admin() cho TỪNG DÒNG. Bọc thành (select public.is_system_admin())
-- để Postgres tính 1 lần cho cả câu truy vấn (khuyến nghị của Supabase). Quyền truy cập giữ nguyên tuyệt đối:
-- chỉ đổi cách viết biểu thức, không thêm/bớt điều kiện. Chạy lại nhiều lần an toàn (đã bọc thì bỏ qua).
do $$
declare
  r record;
  v_qual text;
  v_check text;
  pat constant text := '(?<!SELECT )(public\.)?is_system_admin\(\)';
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and (coalesce(qual, '') ~ pat or coalesce(with_check, '') ~ pat)
  loop
    v_qual := case when r.qual is null then null else regexp_replace(r.qual, pat, '( SELECT public.is_system_admin())', 'g') end;
    v_check := case when r.with_check is null then null else regexp_replace(r.with_check, pat, '( SELECT public.is_system_admin())', 'g') end;
    if v_qual is not null and v_check is not null then
      execute format('alter policy %I on %I.%I using (%s) with check (%s)', r.policyname, r.schemaname, r.tablename, v_qual, v_check);
    elsif v_qual is not null then
      execute format('alter policy %I on %I.%I using (%s)', r.policyname, r.schemaname, r.tablename, v_qual);
    else
      execute format('alter policy %I on %I.%I with check (%s)', r.policyname, r.schemaname, r.tablename, v_check);
    end if;
  end loop;
end $$;

-- club_is_member / club_is_staff được RLS gọi cho từng dòng. Kiểm tra thành viên (1 lần tra chỉ mục) TRƯỚC,
-- chỉ khi không phải thành viên mới kiểm tra quyền admin hệ thống (nhiều lượt tra cứu). Kết quả y hệt bản cũ.
create or replace function public.club_is_member(p_club uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.club_members
                  where club_id = p_club and user_id = auth.uid() and status = 'APPROVED') then true
    else public.is_system_admin()
  end
$$;

create or replace function public.club_is_staff(p_club uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.club_members
                  where club_id = p_club and user_id = auth.uid() and status = 'APPROVED'
                    and role in ('OWNER', 'CAPTAIN')) then true
    else public.is_system_admin()
  end
$$;

commit;
