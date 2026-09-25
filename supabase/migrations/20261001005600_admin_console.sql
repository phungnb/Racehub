-- 005600: Trang Quản trị toàn diện.
-- • admin_inbox: "Việc cần xử lý" — đơn chờ xác nhận, bài chờ duyệt, hồ sơ đối tác, thách đấu CLB chờ duyệt, lỗi hệ thống 24 giờ, người mới.
-- • Người dùng: admin_user_detail (hồ sơ, email, lần đăng nhập cuối, gói VIP, số dư, CLB, bài chạy, giao dịch gần đây, nhật ký),
--   admin_set_user_ban (khóa / mở tài khoản: chặn đăng nhập + đăng xuất mọi thiết bị), admin_set_user_role (cấp / gỡ quyền admin).
-- • Thử thách: admin_list_challenges (tìm, lọc trạng thái), admin_cancel_challenge (hủy bất kỳ lúc nào, hoàn tiền treo, báo người tham gia).
-- • Nhật ký quản trị: admin_audit_list (lọc theo hành động / người làm, xem trang trước).
-- Mọi thao tác ghi admin_audit_log (không sửa / xóa được). Cần 000600, 003800, 004100, 004400, 005300.
-- Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

alter table public.profiles add column if not exists banned_at timestamptz;
alter table public.profiles add column if not exists banned_reason text;

-- ---------------------------------------------------------------------
-- 1. Việc cần xử lý
-- ---------------------------------------------------------------------
create or replace function public.admin_inbox() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'orders', (select count(*) from public.orders o where o.status = 'PENDING' and (o.expires_at is null or o.expires_at > now())),
    'reviews', (select count(*) from public.activities a where a.validation_status = 'PENDING' and coalesce(a.status, '') <> 'DELETED'),
    'partners', (select count(*) from public.partners p where p.status = 'PENDING'),
    'cups', (select count(*) from public.club_cups c where c.status = 'PENDING_REVIEW'),
    'errors', (select count(distinct e.code) from private.client_errors e where e.last_at > now() - interval '24 hours'),
    'new_users_7d', (select count(*) from public.profiles p where p.created_at > now() - interval '7 days'),
    'active_7d', (select count(distinct a.user_id) from public.activities a where a.started_at > now() - interval '7 days'),
    'banned', (select count(*) from public.profiles p where p.banned_at is not null));
end $$;

-- ---------------------------------------------------------------------
-- 2. Người dùng
-- ---------------------------------------------------------------------
create or replace function public.admin_user_detail(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  pr public.profiles := (select x from public.profiles x where x.id = p_user);
  au jsonb := (select to_jsonb(u) from auth.users u where u.id = p_user);
begin
  perform private.require_admin();
  if pr.id is null then raise exception 'USER_NOT_FOUND'; end if;
  return jsonb_build_object(
    'id', pr.id, 'display_name', pr.display_name, 'avatar_url', pr.avatar_url, 'role', coalesce(pr.role, 'MEMBER'),
    'level', pr.level, 'xp', pr.xp, 'balance', private.balance(pr.id), 'created_at', pr.created_at,
    'email', au->>'email', 'last_sign_in_at', au->>'last_sign_in_at', 'banned_until', au->>'banned_until',
    'banned_at', pr.banned_at, 'banned_reason', pr.banned_reason,
    'strava_connected', coalesce((to_jsonb(pr)->>'strava_connected')::boolean, false),
    'referral_code', to_jsonb(pr)->>'referral_code',
    'referred_by', (select r.display_name from public.profiles r where r.id = (to_jsonb(pr)->>'referred_by')::uuid),
    'plan', private.active_plan(pr.id),
    'stats', jsonb_build_object(
      'runs', (select count(*) from public.activities a where a.user_id = pr.id and a.validation_status = 'APPROVED'),
      'km', (select round(coalesce(sum(coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0)), 0) / 1000.0, 1)
               from public.activities a where a.user_id = pr.id and a.validation_status = 'APPROVED'),
      'pending_runs', (select count(*) from public.activities a where a.user_id = pr.id and a.validation_status = 'PENDING'),
      'last_run_at', (select max(a.started_at) from public.activities a where a.user_id = pr.id),
      'challenges', (select count(*) from public.challenge_participants c where c.profile_id = pr.id and c.status <> 'LEFT'),
      'orders_paid_vnd', (select coalesce(sum(o.amount_vnd), 0) from public.orders o where o.buyer_id = pr.id and o.status = 'PAID')),
    'clubs', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'role', m.role, 'status', m.status) order by c.name), '[]'::jsonb)
                from public.club_members m join public.clubs c on c.id = m.club_id where m.user_id = pr.id and m.status in ('APPROVED', 'PENDING')),
    'ledger', (select coalesce(jsonb_agg(jsonb_build_object('type', x.type, 'description', x.description, 'amount', x.amount, 'at', x.created_at) order by x.created_at desc), '[]'::jsonb)
                 from (select t.type, t.reason as description, e.amount, t.created_at, row_number() over (order by t.created_at desc) as rn
                         from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id where e.account_id = pr.id) x where x.rn <= 15),
    'audit', (select coalesce(jsonb_agg(jsonb_build_object('action', x.action, 'actor', x.actor, 'reason', x.reason, 'at', x.created_at) order by x.created_at desc), '[]'::jsonb)
                from (select l.action, private.display_name(l.actor_id) as actor, coalesce(l.reason, l.new_value->>'reason', l.new_value->>'note') as reason, l.created_at,
                             row_number() over (order by l.created_at desc) as rn
                        from public.admin_audit_log l where l.target in ('user:' || pr.id, pr.id::text)) x where x.rn <= 15));
end $$;

create or replace function public.admin_set_user_ban(p_user uuid, p_ban boolean, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_admin uuid := private.require_admin();
  pr public.profiles := (select x from public.profiles x where x.id = p_user);
begin
  if pr.id is null then raise exception 'USER_NOT_FOUND'; end if;
  if p_user = v_admin then raise exception 'CANNOT_TARGET_SELF'; end if;
  if p_ban and (pr.role = 'SYSTEM_ADMIN' or coalesce((to_jsonb(pr)->>'is_admin')::boolean, false)) then raise exception 'CANNOT_BAN_ADMIN'; end if;
  if p_ban and char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if p_ban then
    update auth.users set banned_until = now() + interval '100 years' where id = p_user;
    delete from auth.sessions where user_id = p_user;                     -- đăng xuất mọi thiết bị
    update public.profiles set banned_at = now(), banned_reason = left(trim(p_reason), 300) where id = p_user;
  else
    update auth.users set banned_until = null where id = p_user;
    update public.profiles set banned_at = null, banned_reason = null where id = p_user;
  end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value, reason)
  values (v_admin, case when p_ban then 'USER_BAN' else 'USER_UNBAN' end, 'user:' || p_user, jsonb_build_object('reason', p_reason), p_reason);
  return jsonb_build_object('banned', p_ban);
end $$;

create or replace function public.admin_set_user_role(p_user uuid, p_role text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  v_role text := upper(coalesce(p_role, ''));
  v_old text := (select coalesce(p.role, 'MEMBER') from public.profiles p where p.id = p_user);
begin
  if v_old is null then raise exception 'USER_NOT_FOUND'; end if;
  if v_role not in ('SYSTEM_ADMIN', 'MEMBER') then raise exception 'INVALID_ROLE'; end if;
  if p_user = v_admin and v_role <> 'SYSTEM_ADMIN' then raise exception 'CANNOT_TARGET_SELF'; end if;
  if v_role = 'SYSTEM_ADMIN' and (select p.banned_at from public.profiles p where p.id = p_user) is not null then raise exception 'USER_BANNED'; end if;
  if v_old = v_role then return jsonb_build_object('role', v_role); end if;
  update public.profiles set role = v_role where id = p_user;
  insert into public.admin_audit_log (actor_id, action, target, old_value, new_value, reason)
  values (v_admin, 'USER_ROLE', 'user:' || p_user, jsonb_build_object('role', v_old), jsonb_build_object('role', v_role), p_reason);
  perform private.notify(p_user, null, 'SYSTEM',
    case when v_role = 'SYSTEM_ADMIN' then 'Bạn được cấp quyền quản trị RaceHub' else 'Quyền quản trị RaceHub của bạn đã được gỡ' end,
    coalesce(p_reason, ''), case when v_role = 'SYSTEM_ADMIN' then '/admin' else '/me' end, v_admin, true);
  return jsonb_build_object('role', v_role);
end $$;

-- ---------------------------------------------------------------------
-- 3. Thử thách
-- ---------------------------------------------------------------------
create or replace function public.admin_list_challenges(p_query text default '', p_status text default 'ALL') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := trim(coalesce(p_query, ''));
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'title', x.title, 'status', x.status, 'format', x.format, 'audience', x.target_audience,
      'start_date', x.start_date, 'end_date', x.end_date, 'reward_xu', x.reward_xu, 'participants', x.n,
      'creator', private.display_name(x.created_by), 'club', x.club_name, 'cancelled_reason', x.cancelled_reason) order by x.rn), '[]'::jsonb)
    from (select c.*, cl.name as club_name,
                 (select count(*) from public.challenge_participants p where p.challenge_id = c.id and p.status <> 'LEFT') as n,
                 row_number() over (order by (c.status = 'ACTIVE' and c.end_date > now()) desc, c.start_date desc) as rn
            from public.challenges c left join public.clubs cl on cl.id = c.target_club_id
           where (upper(coalesce(p_status, 'ALL')) = 'ALL'
                  or (upper(p_status) = 'LIVE' and c.status = 'ACTIVE' and c.start_date <= now() and c.end_date > now())
                  or (upper(p_status) = 'UPCOMING' and c.status = 'ACTIVE' and c.start_date > now())
                  or (upper(p_status) = 'ENDED' and (c.status = 'FINISHED' or (c.status = 'ACTIVE' and c.end_date <= now())))
                  or (upper(p_status) = 'CANCELLED' and c.status = 'CANCELLED'))
             and (q = '' or c.id::text = q or private.search_match(private.search_hay(c.title || ' ' || coalesce(cl.name, '') || ' ' || coalesce(private.display_name(c.created_by), '')), q))) x
   where x.rn <= 100);
end $$;

create or replace function public.admin_cancel_challenge(p_challenge_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
  r record;
begin
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if c.status <> 'ACTIVE' then raise exception 'CHALLENGE_CLOSED'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  update public.challenges set status = 'CANCELLED', cancelled_reason = left(trim(p_reason), 300), settled_at = now() where id = c.id;
  perform private.challenge_refund_escrow(c);
  for r in select p.profile_id from public.challenge_participants p where p.challenge_id = c.id
           union select c.created_by where c.created_by is not null loop
    perform private.notify(r.profile_id, c.target_club_id, 'CHALLENGE_CANCELLED', 'RaceHub đã hủy thử thách: ' || c.title,
      trim(p_reason), '/challenges/' || c.id, v_admin, true);
  end loop;
  insert into public.admin_audit_log (actor_id, action, target, new_value, reason)
  values (v_admin, 'CHALLENGE_CANCEL', 'challenge:' || c.id, jsonb_build_object('title', c.title), p_reason);
  return jsonb_build_object('cancelled', true);
end $$;

-- ---------------------------------------------------------------------
-- 4. Nhật ký quản trị
-- ---------------------------------------------------------------------
create or replace function public.admin_audit_list(p_action text default null, p_actor uuid default null, p_before bigint default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'action', x.action, 'target', x.target, 'actor_id', x.actor_id,
      'actor', private.display_name(x.actor_id), 'old_value', x.old_value, 'new_value', x.new_value, 'reason', x.reason, 'at', x.created_at) order by x.id desc), '[]'::jsonb)
    from (select l.*, row_number() over (order by l.id desc) as rn from public.admin_audit_log l
           where (p_action is null or l.action ilike p_action || '%')
             and (p_actor is null or l.actor_id = p_actor)
             and (p_before is null or l.id < p_before)) x
   where x.rn <= 100);
end $$;

revoke all on function public.admin_inbox(), public.admin_user_detail(uuid), public.admin_set_user_ban(uuid, boolean, text),
  public.admin_set_user_role(uuid, text, text), public.admin_list_challenges(text, text), public.admin_cancel_challenge(uuid, text),
  public.admin_audit_list(text, uuid, bigint) from public, anon;
grant execute on function public.admin_inbox(), public.admin_user_detail(uuid), public.admin_set_user_ban(uuid, boolean, text),
  public.admin_set_user_role(uuid, text, text), public.admin_list_challenges(text, text), public.admin_cancel_challenge(uuid, text),
  public.admin_audit_list(text, uuid, bigint) to authenticated;

notify pgrst, 'reload schema';
