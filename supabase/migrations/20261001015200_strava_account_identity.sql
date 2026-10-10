-- 015200: HIỂN THỊ TÀI KHOẢN STRAVA ĐÃ LIÊN KẾT
-- Trước đây chỉ lưu athlete id → người dùng không biết mình nối với Strava nào, admin không kiểm tra được.
-- Nay lưu thêm tên, username, ảnh đại diện (lấy từ Strava lúc nối / lúc đồng bộ):
--   • my_provider_connections() trả thêm tên, username, ảnh → trang Tôi hiển thị cho người dùng
--   • admin_user_detail() trả thêm object "strava" → Quản trị → Người dùng
-- Kết nối cũ chưa có tên: app tự bổ sung ở lần đồng bộ kế tiếp (set_provider_identity).

alter table public.connected_accounts add column if not exists external_name text;
alter table public.connected_accounts add column if not exists external_username text;
alter table public.connected_accounts add column if not exists external_avatar_url text;
alter table public.connected_accounts add column if not exists identity_synced_at timestamptz;

-- Chuẩn hóa thông tin hồ sơ nhà cung cấp: cắt độ dài, ảnh chỉ nhận https
create or replace function private.provider_identity_clean(p_identity jsonb) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'name', nullif(left(trim(coalesce(p_identity->>'name', '')), 80), ''),
    'username', nullif(left(trim(coalesce(p_identity->>'username', '')), 60), ''),
    'avatar_url', case when coalesce(p_identity->>'avatar_url', '') ~ '^https://' then left(p_identity->>'avatar_url', 500) end)
$$;

-- Nối tài khoản (chỉ server gọi): thêm p_identity {name, username, avatar_url}. Thay hàm 7 tham số cũ.
drop function if exists public.link_provider_connection(uuid, text, text, text, text, timestamptz, text[]);
create or replace function public.link_provider_connection(
  p_user_id uuid, p_provider text, p_external_user_id text, p_access_token text,
  p_refresh_token text, p_expires_at timestamptz, p_scopes text[] default null, p_identity jsonb default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_id jsonb := private.provider_identity_clean(p_identity);
begin
  if exists (select 1 from public.connected_accounts
              where provider = p_provider and provider_user_id = p_external_user_id and user_id <> p_user_id) then
    raise exception 'PROVIDER_ACCOUNT_CONFLICT';
  end if;
  delete from public.connected_accounts where user_id = p_user_id and provider = p_provider;
  insert into public.connected_accounts (user_id, provider, provider_user_id, access_token, refresh_token, expires_at,
                                         external_name, external_username, external_avatar_url, identity_synced_at)
  values (p_user_id, p_provider, p_external_user_id, p_access_token, p_refresh_token, p_expires_at,
          v_id->>'name', v_id->>'username', v_id->>'avatar_url', case when p_identity is not null then now() end);
  if p_provider = 'STRAVA' then
    update public.profiles set strava_connected = true, strava_athlete_id = p_external_user_id, updated_at = now()
     where id = p_user_id;
  end if;
end $$;
revoke all on function public.link_provider_connection(uuid, text, text, text, text, timestamptz, text[], jsonb) from public, anon, authenticated;
grant execute on function public.link_provider_connection(uuid, text, text, text, text, timestamptz, text[], jsonb) to service_role;

-- Bổ sung / cập nhật tên + ảnh cho kết nối đã có (chỉ server gọi)
create or replace function public.set_provider_identity(p_user_id uuid, p_provider text, p_identity jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_id jsonb := private.provider_identity_clean(p_identity);
begin
  update public.connected_accounts
     set external_name = v_id->>'name', external_username = v_id->>'username',
         external_avatar_url = v_id->>'avatar_url', identity_synced_at = now()
   where user_id = p_user_id and provider = p_provider;
end $$;
revoke all on function public.set_provider_identity(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.set_provider_identity(uuid, text, jsonb) to service_role;

-- Người dùng tự xem nguồn đã kết nối (không lộ token)
drop function if exists public.my_provider_connections();
create or replace function public.my_provider_connections() returns table (
  provider text, provider_user_id text, connected_at timestamptz, last_synced_at timestamptz,
  external_name text, external_username text, external_avatar_url text)
language sql stable security definer set search_path = public as $$
  select provider, provider_user_id, created_at, last_synced_at, external_name, external_username, external_avatar_url
    from public.connected_accounts where user_id = auth.uid()
$$;
revoke all on function public.my_provider_connections() from public, anon;
grant execute on function public.my_provider_connections() to authenticated;

-- Admin: hồ sơ người dùng kèm tài khoản Strava đã nối (bản 005600 + khóa "strava")
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
    'strava', (select jsonb_build_object('athlete_id', c.provider_user_id, 'name', c.external_name, 'username', c.external_username,
                      'avatar_url', c.external_avatar_url, 'connected_at', c.created_at, 'last_synced_at', c.last_synced_at)
                 from public.connected_accounts c where c.user_id = pr.id and c.provider = 'STRAVA' limit 1),
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

revoke all on function public.admin_user_detail(uuid) from public, anon;
grant execute on function public.admin_user_detail(uuid) to authenticated;

notify pgrst, 'reload schema';
