-- =====================================================================
-- 001700 — Web Push: thông báo đẩy tới điện thoại / máy tính (PWA-02)
--
-- Luồng: private.notify(...) ghi public.notifications như cũ
--   → trigger lọc theo cài đặt của người nhận (loại thông báo, giờ yên lặng, có thiết bị không)
--   → đưa vào private.push_queue, và MỖI giao dịch gọi 1 lần pg_net tới /api/push/dispatch
--   → route Next.js lấy lô (push_claim_batch) và gửi bằng web-push (khóa VAPID nằm ở Vercel).
-- Chưa cấu hình (chưa gọi private.configure_push) thì mọi thứ vẫn chạy, chỉ là không gửi push.
--
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Bảng
-- ---------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique check (endpoint like 'https://%' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) between 20 and 200),
  auth text not null check (char_length(auth) between 8 and 100),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_own_read on public.push_subscriptions;
create policy push_subscriptions_own_read on public.push_subscriptions for select using (user_id = auth.uid());
revoke insert, update, delete on public.push_subscriptions from anon, authenticated;

create table if not exists public.push_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  club boolean not null default true,        -- sự kiện, thu quỹ, bình chọn, thông báo CLB, nhắc tên
  social boolean not null default true,      -- cổ vũ, bình luận
  challenge boolean not null default true,   -- thử thách
  game boolean not null default true,        -- huy hiệu, lên cấp, league
  quiet boolean not null default true,       -- không làm phiền ban đêm
  quiet_from smallint not null default 22 check (quiet_from between 0 and 23),
  quiet_to smallint not null default 6 check (quiet_to between 0 and 23),
  updated_at timestamptz not null default now()
);
alter table public.push_settings enable row level security;
drop policy if exists push_settings_own_read on public.push_settings;
create policy push_settings_own_read on public.push_settings for select using (user_id = auth.uid());
revoke insert, update, delete on public.push_settings from anon, authenticated;

create table if not exists private.push_queue (
  id bigint generated always as identity primary key,
  notification_id uuid not null references public.notifications(id) on delete cascade,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);
create index if not exists push_queue_pending_idx on private.push_queue (id) where claimed_at is null;

create table if not exists private.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
revoke all on private.push_queue, private.app_settings from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Lọc + xếp hàng
-- ---------------------------------------------------------------------
create or replace function private.push_category(p_kind text) returns text
language sql immutable as $$
  select case
    when p_kind like 'CLUB\_%' or p_kind = 'CHAT_MENTION' then 'club'
    when p_kind like 'POST\_%' or p_kind = 'CHEER' then 'social'
    when p_kind like 'CHALLENGE\_%' then 'challenge'
    when p_kind in ('BADGE', 'LEVEL_UP', 'LEAGUE') then 'game'
    else 'system'
  end
$$;

/** Giờ hiện tại (giờ VN) có nằm trong khoảng yên lặng [from, to) không; khoảng có thể qua nửa đêm */
create or replace function private.in_quiet_hours(p_from smallint, p_to smallint, p_at timestamptz) returns boolean
language sql immutable as $$
  select case
    when p_from = p_to then false
    when p_from < p_to then extract(hour from p_at at time zone 'Asia/Ho_Chi_Minh') >= p_from
                        and extract(hour from p_at at time zone 'Asia/Ho_Chi_Minh') < p_to
    else extract(hour from p_at at time zone 'Asia/Ho_Chi_Minh') >= p_from
      or extract(hour from p_at at time zone 'Asia/Ho_Chi_Minh') < p_to
  end
$$;

-- Gọi route gửi push (qua pg_net, chạy sau khi giao dịch commit). Không có pg_net / chưa cấu hình → bỏ qua.
create or replace function private.push_kick() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_url text := (select value from private.app_settings where key = 'push_dispatch_url');
  v_secret text := (select value from private.app_settings where key = 'push_secret');
begin
  if v_url is null or v_secret is null or to_regproc('net.http_post') is null then return; end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 8000)'
    using v_url, '{}'::jsonb, jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret);
end $$;

create or replace function private.after_notification_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s public.push_settings := (select x from public.push_settings x where x.user_id = new.user_id);
  v_cat text := private.push_category(new.kind);
begin
  if not exists (select 1 from public.push_subscriptions p where p.user_id = new.user_id) then return null; end if;
  if s.user_id is not null then
    if (v_cat = 'club' and not s.club) or (v_cat = 'social' and not s.social)
       or (v_cat = 'challenge' and not s.challenge) or (v_cat = 'game' and not s.game) then
      return null;
    end if;
  end if;
  -- Giờ yên lặng (mặc định 22h–6h): vẫn vào chuông thông báo, chỉ không rung máy. Thử thông báo thì luôn gửi.
  if new.kind <> 'PUSH_TEST' and coalesce(s.quiet, true)
     and private.in_quiet_hours(coalesce(s.quiet_from, 22::smallint), coalesce(s.quiet_to, 6::smallint), now()) then
    return null;
  end if;
  insert into private.push_queue (notification_id) values (new.id);
  -- Một giao dịch có thể tạo hàng trăm thông báo (tạo sự kiện cho cả CLB) → chỉ gọi route một lần
  if coalesce(current_setting('racehub.push_kicked', true), '') <> '1' then
    perform set_config('racehub.push_kicked', '1', true);
    perform private.push_kick();
  end if;
  return null;
end $$;

drop trigger if exists trg_notification_push on public.notifications;
create trigger trg_notification_push after insert on public.notifications
  for each row execute function private.after_notification_push();

-- ---------------------------------------------------------------------
-- 3. RPC cho người dùng
-- ---------------------------------------------------------------------
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  if coalesce(p_endpoint, '') !~ '^https://' or char_length(p_endpoint) > 1000 then raise exception 'INVALID_SUBSCRIPTION'; end if;
  if char_length(coalesce(p_p256dh, '')) not between 20 and 200 or char_length(coalesce(p_auth, '')) not between 8 and 100 then
    raise exception 'INVALID_SUBSCRIPTION';
  end if;
  -- Cùng máy đăng nhập tài khoản khác → thiết bị chuyển sang tài khoản mới
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, last_seen_at = now();
  -- Tối đa 10 thiết bị / người: bỏ thiết bị cũ nhất
  delete from public.push_subscriptions d
   where d.id in (select id from (select p.id, row_number() over (order by p.last_seen_at desc) as rn
                                    from public.push_subscriptions p where p.user_id = v_uid) x where x.rn > 10);
end $$;

create or replace function public.delete_push_subscription(p_endpoint text) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = v_uid;
end $$;

create or replace function public.my_push_settings() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  s public.push_settings := (select x from public.push_settings x where x.user_id = v_uid);
begin
  return jsonb_build_object(
    'club', coalesce(s.club, true), 'social', coalesce(s.social, true), 'challenge', coalesce(s.challenge, true),
    'game', coalesce(s.game, true), 'quiet', coalesce(s.quiet, true),
    'quiet_from', coalesce(s.quiet_from, 22), 'quiet_to', coalesce(s.quiet_to, 6),
    'devices', (select count(*) from public.push_subscriptions p where p.user_id = v_uid),
    'configured', exists (select 1 from private.app_settings a where a.key = 'push_dispatch_url'));
end $$;

create or replace function public.update_push_settings(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_from int := coalesce((p->>'quiet_from')::int, 22);
  v_to int := coalesce((p->>'quiet_to')::int, 6);
begin
  if v_from not between 0 and 23 or v_to not between 0 and 23 then raise exception 'INVALID_SETTINGS'; end if;
  insert into public.push_settings (user_id, club, social, challenge, game, quiet, quiet_from, quiet_to, updated_at)
  values (v_uid, coalesce((p->>'club')::boolean, true), coalesce((p->>'social')::boolean, true),
          coalesce((p->>'challenge')::boolean, true), coalesce((p->>'game')::boolean, true),
          coalesce((p->>'quiet')::boolean, true), v_from, v_to, now())
  on conflict (user_id) do update set
    club = excluded.club, social = excluded.social, challenge = excluded.challenge, game = excluded.game,
    quiet = excluded.quiet, quiet_from = excluded.quiet_from, quiet_to = excluded.quiet_to, updated_at = now();
  return public.my_push_settings();
end $$;

-- Gửi thử một thông báo tới mọi thiết bị của tôi (tối đa 1 lần / 30 giây)
create or replace function public.send_test_push() returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  if exists (select 1 from public.notifications n where n.user_id = v_uid and n.kind = 'PUSH_TEST'
              and n.created_at > now() - interval '30 seconds') then
    raise exception 'TOO_SOON';
  end if;
  insert into public.notifications (user_id, kind, title, body, link)
  values (v_uid, 'PUSH_TEST', 'Thông báo RaceHub đã bật', 'Bạn sẽ nhận nhắc buổi chạy, thu quỹ và thử thách tại đây.', '/notifications');
end $$;

-- ---------------------------------------------------------------------
-- 4. RPC cho route gửi push (chỉ service_role; kiểm tra khóa bí mật trong DB)
-- ---------------------------------------------------------------------
create or replace function private.check_push_token(p_token text) returns void
language plpgsql stable security definer set search_path = public as $$
declare v_secret text := (select value from private.app_settings where key = 'push_secret');
begin
  if v_secret is null or p_token is null or p_token <> v_secret then raise exception 'UNAUTHORIZED'; end if;
end $$;

create or replace function public.push_claim_batch(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ids bigint[];
begin
  perform private.check_push_token(p_token);
  delete from private.push_queue where created_at < now() - interval '2 days';
  v_ids := (select coalesce(array_agg(x.id), '{}') from (
              select q.id, row_number() over (order by q.id) as rn from private.push_queue q where q.claimed_at is null) x
             where x.rn <= 300);
  update private.push_queue set claimed_at = now() where id = any(v_ids);
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', n.user_id, 'kind', n.kind, 'title', n.title, 'body', n.body, 'link', n.link,
      'unread', (select count(*) from public.notifications u where u.user_id = n.user_id and u.read_at is null),
      'subscriptions', (select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
                          from public.push_subscriptions s where s.user_id = n.user_id))
      order by q.id), '[]'::jsonb)
    from private.push_queue q join public.notifications n on n.id = q.notification_id
   where q.id = any(v_ids));
end $$;

-- Xóa thiết bị hết hạn (trình duyệt trả 404/410)
create or replace function public.push_report(p_token text, p_dead text[]) returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  perform private.check_push_token(p_token);
  delete from public.push_subscriptions where endpoint = any(coalesce(p_dead, '{}'));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- 5. Cấu hình một lần (chạy trong SQL Editor):
--    select private.configure_push('https://<tên-miền-của-bạn>/api/push/dispatch');
-- Bật pg_net nếu chưa bật và tự sinh khóa bí mật (không cần biến môi trường riêng).
-- ---------------------------------------------------------------------
create or replace function private.configure_push(p_url text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if p_url is null then
    delete from private.app_settings where key = 'push_dispatch_url';
    return 'Đã tắt gửi push';
  end if;
  if p_url !~ '^https://[^/]+/api/push/dispatch$' then raise exception 'URL phải có dạng https://<tên-miền>/api/push/dispatch'; end if;
  begin
    create extension if not exists pg_net with schema extensions;
  exception when others then
    raise notice 'Không bật được pg_net tự động: %. Hãy bật trong Database → Extensions.', sqlerrm;
  end;
  insert into private.app_settings (key, value) values ('push_dispatch_url', p_url)
  on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into private.app_settings (key, value) values ('push_secret', encode(extensions.gen_random_bytes(24), 'hex'))
  on conflict (key) do nothing;
  return 'Đã cấu hình gửi push tới ' || p_url
    || case when to_regproc('net.http_post') is null then ' (CHÚ Ý: pg_net chưa bật)' else '' end;
end $$;

-- ---------------------------------------------------------------------
-- 6. Quyền
-- ---------------------------------------------------------------------
revoke all on function public.save_push_subscription(text, text, text, text), public.delete_push_subscription(text),
  public.my_push_settings(), public.update_push_settings(jsonb), public.send_test_push(),
  public.push_claim_batch(text), public.push_report(text, text[])
  from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text), public.delete_push_subscription(text),
  public.my_push_settings(), public.update_push_settings(jsonb), public.send_test_push()
  to authenticated;
revoke all on function public.push_claim_batch(text), public.push_report(text, text[]) from authenticated;
grant execute on function public.push_claim_batch(text), public.push_report(text, text[]) to service_role;
revoke all on function private.push_category(text), private.in_quiet_hours(smallint, smallint, timestamptz), private.push_kick(),
  private.after_notification_push(), private.check_push_token(text), private.configure_push(text)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
