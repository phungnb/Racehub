-- =====================================================================
-- RaceHub — LƯỢC ĐỒ CSDL ĐÍCH (TARGET SCHEMA) — TÀI LIỆU THAM CHIẾU
-- =====================================================================
-- ⚠️  ĐÂY KHÔNG PHẢI MIGRATION. Không chạy file này lên database đang có dữ liệu.
--     Cách dùng:
--       1. `supabase db pull` để đưa schema hiện tại vào supabase/migrations/.
--       2. Viết từng migration nhỏ để chuyển dần sang lược đồ này
--          (xem mục "Kế hoạch migrate" trong database.md).
--     Trên một project Supabase MỚI (môi trường dev), có thể chạy toàn bộ file
--     để thử nghiệm.
--
-- Quy ước:
--   * Khóa chính uuid (gen_random_uuid) trừ bảng log dùng bigint identity.
--   * Thời gian: timestamptz, lưu UTC.
--   * Trạng thái dùng text + CHECK (dễ thêm/bớt giá trị hơn Postgres ENUM).
--   * Khoảng cách: mét (int). Thời gian: giây (int). Pace: giây/km (int).
--   * Tiền ảo (Xu): numeric(18,2) — đủ cho thưởng 0.2 Xu/km, tính chính xác.
--   * Cột "tài sản" (xp, level, trust_score, balance, progress…) KHÔNG có
--     policy UPDATE cho client — chỉ thay đổi qua hàm SECURITY DEFINER.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron;     -- job định kỳ
create extension if not exists pgmq;        -- hàng đợi (Supabase Queues)
create extension if not exists pg_trgm;     -- tìm kiếm tên gần đúng

create schema if not exists private;        -- bảng bí mật, không expose qua API
revoke all on schema private from anon, authenticated;

-- ---------------------------------------------------------------------
-- 0. HẠ TẦNG: outbox sự kiện, hàng đợi ingest, audit
-- ---------------------------------------------------------------------
create table public.domain_events (
  id            bigint generated always as identity primary key,
  type          text not null,                 -- 'activity.verified', 'challenge.settled', ...
  aggregate     text not null,                 -- 'activity', 'challenge', 'user', ...
  aggregate_id  uuid not null,
  actor_id      uuid,
  payload       jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  processed_at  timestamptz
);
create index on public.domain_events (processed_at) where processed_at is null;

create table private.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  action      text not null,
  target      text,
  data        jsonb,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 1. IDENTITY & PROFILE (Module 1)
-- ---------------------------------------------------------------------
create table public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  handle            text unique check (handle ~ '^[a-z0-9_.]{3,30}$'),   -- mã ID để kết bạn
  display_name      text not null check (char_length(display_name) between 1 and 60),
  avatar_url        text,
  gender            text check (gender in ('male','female','other')),
  birth_date        date,
  province_code     text,                     -- mã tỉnh/thành, dùng cho BXH khu vực
  bio               text check (char_length(bio) <= 300),
  goal_km_month     int check (goal_km_month between 0 and 2000),
  goal_days_week    smallint check (goal_days_week between 0 and 7),
  -- Tài sản / chỉ số hệ thống: chỉ hàm server được ghi
  xp                bigint   not null default 0 check (xp >= 0),
  level             smallint not null default 1 check (level between 1 and 5),
  trust_score       smallint not null default 80 check (trust_score between 0 and 100),
  referred_by       uuid references public.profiles(id),
  onboarding_step   smallint not null default 0,
  is_banned         boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index profiles_name_trgm on public.profiles using gin (display_name gin_trgm_ops);

-- Vai trò hệ thống (thay cho profiles.role dạng text tự do)
create table public.user_roles (
  user_id  uuid references public.profiles(id) on delete cascade,
  role     text check (role in ('SYSTEM_ADMIN','MODERATOR','ORGANIZER')),
  granted_by uuid references public.profiles(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.profile_settings (
  user_id              uuid primary key references public.profiles(id) on delete cascade,
  profile_visibility   text not null default 'PUBLIC' check (profile_visibility in ('PUBLIC','FRIENDS','PRIVATE')),
  activity_visibility  text not null default 'PUBLIC' check (activity_visibility in ('PUBLIC','FRIENDS','PRIVATE')),
  hide_start_end_m     int  not null default 200,   -- ẩn điểm đầu/cuối lộ trình (bảo vệ địa chỉ nhà)
  units                text not null default 'metric' check (units in ('metric','imperial')),
  language             text not null default 'vi',
  notif_prefs          jsonb not null default '{}'
);

-- Token của nhà cung cấp dữ liệu: KHÔNG bao giờ trả về client
create table private.provider_connections (
  user_id            uuid references public.profiles(id) on delete cascade,
  provider           text check (provider in ('STRAVA','GARMIN','COROS','GOOGLE_FIT','APPLE_HEALTH')),
  external_user_id   text not null,
  access_token       text not null,
  refresh_token      text,
  expires_at         timestamptz,
  scopes             text[],
  connected_at       timestamptz not null default now(),
  primary key (user_id, provider),
  unique (provider, external_user_id)      -- 1 tài khoản Strava ↔ 1 user RaceHub
);
-- View an toàn cho client: chỉ biết đã kết nối hay chưa
create view public.my_connections with (security_invoker = false) as
  select provider, external_user_id, connected_at
  from private.provider_connections where user_id = auth.uid();

create table private.oauth_states (
  nonce       text primary key,              -- 32 byte ngẫu nhiên
  user_id     uuid not null references public.profiles(id) on delete cascade,
  provider    text not null,
  expires_at  timestamptz not null default now() + interval '10 minutes'
);

create table public.push_tokens (
  token       text primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  platform    text check (platform in ('web','ios','android')),
  updated_at  timestamptz not null default now()
);

-- Tự tạo profile + ví khi có user mới (thay cho client insert xu: 500)
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1), 'Runner'));
  insert into public.profile_settings (user_id) values (new.id);
  insert into public.user_stats (user_id) values (new.id);
  insert into public.ledger_accounts (owner_type, owner_id, code) values ('USER', new.id, 'WALLET');
  -- Thưởng chào mừng đi qua ledger, không set số dư trực tiếp
  perform public.post_ledger_transaction(
    'WELCOME_BONUS', 'welcome:' || new.id,
    jsonb_build_array(
      jsonb_build_object('account', private.system_account('MINT'), 'amount', -500),
      jsonb_build_object('account', private.user_wallet(new.id),   'amount',  500)));
  return new;
end $$;
-- create trigger on_auth_user_created after insert on auth.users
--   for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------
-- 2. SOCIAL GRAPH (Module 4.2)
-- ---------------------------------------------------------------------
create table public.friendships (
  user_low      uuid references public.profiles(id) on delete cascade,
  user_high     uuid references public.profiles(id) on delete cascade,
  status        text not null default 'PENDING' check (status in ('PENDING','ACCEPTED','BLOCKED')),
  requested_by  uuid not null references public.profiles(id),
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  primary key (user_low, user_high),
  check (user_low < user_high)             -- mỗi cặp chỉ 1 dòng
);

-- ---------------------------------------------------------------------
-- 3. ACTIVITY & VERIFICATION (Module 2.3, 2.4, 7)
-- ---------------------------------------------------------------------
create table public.activity_ingest_jobs (
  id              bigint generated always as identity primary key,
  provider        text not null,
  external_id     text not null,
  owner_external  text not null,
  aspect          text not null check (aspect in ('create','update','delete')),
  status          text not null default 'QUEUED' check (status in ('QUEUED','RUNNING','DONE','FAILED','SKIPPED')),
  attempts        smallint not null default 0,
  last_error      text,
  received_at     timestamptz not null default now(),
  unique (provider, external_id, aspect)
);

create table public.activities (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  source            text not null check (source in ('APP_GPS','STRAVA','GARMIN','COROS','MANUAL')),
  external_id       text,                             -- id bên Strava/Garmin
  title             text,
  sport_type        text not null default 'RUN' check (sport_type in ('RUN','TRAIL_RUN','TREADMILL','WALK','OTHER')),
  start_time        timestamptz not null,
  timezone          text,
  distance_m        int not null check (distance_m >= 0),
  moving_time_s     int not null check (moving_time_s >= 0),
  elapsed_time_s    int not null check (elapsed_time_s >= moving_time_s),
  avg_pace_s        int generated always as (case when distance_m > 0 then (moving_time_s * 1000 / distance_m) end) stored,
  elev_gain_m       int,
  avg_hr            smallint,
  max_hr            smallint,
  avg_cadence       smallint,
  calories          int,
  device_name       text,
  summary_polyline  text,                             -- polyline rút gọn để vẽ mini-map
  status            text not null default 'PENDING_VERIFY'
                    check (status in ('PENDING_VERIFY','VERIFIED','UNDER_REVIEW','REJECTED','DELETED')),
  verify_score      smallint,                         -- 0..100 (điểm tin cậy của riêng bài chạy)
  verify_flags      jsonb not null default '[]',      -- ['SPEED_SPIKE','GPS_GAP','NO_HR',...]
  visibility        text not null default 'PUBLIC' check (visibility in ('PUBLIC','FRIENDS','PRIVATE')),
  created_at        timestamptz not null default now(),
  verified_at       timestamptz,
  unique (source, external_id)                        -- chống import trùng
);
create index on public.activities (user_id, start_time desc);
create index on public.activities (status) where status in ('PENDING_VERIFY','UNDER_REVIEW');

-- Dữ liệu chuỗi thời gian (GPS/HR). Tách bảng vì lớn, ít đọc.
create table public.activity_streams (
  activity_id  uuid primary key references public.activities(id) on delete cascade,
  time_s       int[]     not null,
  latlng       float8[]  ,          -- [lat1,lng1,lat2,lng2,...]
  altitude_m   real[],
  heartrate    smallint[],
  cadence      smallint[],
  raw_hash     text                  -- hash dữ liệu gốc: phát hiện file GPX bị chỉnh
);

create table public.activity_splits (
  activity_id  uuid references public.activities(id) on delete cascade,
  km_index     smallint,
  pace_s       int not null,
  avg_hr       smallint,
  elev_diff_m  real,
  primary key (activity_id, km_index)
);

create table public.personal_bests (
  user_id      uuid references public.profiles(id) on delete cascade,
  distance_key text check (distance_key in ('1K','5K','10K','HM','FM')),
  time_s       int not null,
  activity_id  uuid not null references public.activities(id) on delete cascade,
  achieved_at  timestamptz not null,
  primary key (user_id, distance_key)
);

-- Thống kê tổng hợp (cập nhật bởi engine, client chỉ đọc) — FR5
create table public.user_stats (
  user_id               uuid primary key references public.profiles(id) on delete cascade,
  total_distance_m      bigint not null default 0,
  total_moving_s        bigint not null default 0,
  activity_count        int    not null default 0,
  current_streak_days   int    not null default 0,
  longest_streak_days   int    not null default 0,
  last_activity_date    date,
  challenges_joined     int    not null default 0,
  challenges_completed  int    not null default 0,
  cheers_received       int    not null default 0,
  updated_at            timestamptz not null default now()
);

create table public.activity_reports (      -- FR18
  id           uuid primary key default gen_random_uuid(),
  activity_id  uuid not null references public.activities(id) on delete cascade,
  reporter_id  uuid not null references public.profiles(id),
  reason       text not null check (reason in ('VEHICLE','GPS_SPOOF','WRONG_OWNER','DUPLICATE','OTHER')),
  note         text,
  status       text not null default 'OPEN' check (status in ('OPEN','ACCEPTED','DISMISSED')),
  created_at   timestamptz not null default now(),
  unique (activity_id, reporter_id)
);

create table public.activity_reviews (
  id           uuid primary key default gen_random_uuid(),
  activity_id  uuid not null references public.activities(id) on delete cascade,
  reviewer_id  uuid not null references public.profiles(id),
  decision     text not null check (decision in ('APPROVE','REJECT')),
  note         text,
  created_at   timestamptz not null default now()
);

create table public.trust_score_events (   -- FR19
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  delta       smallint not null,
  reason      text not null,               -- 'ACTIVITY_VERIFIED', 'FRAUD_CONFIRMED', 'ADMIN_ADJUST'
  ref_id      uuid,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4. ECONOMY — SỔ CÁI KÉP (Module 3.1) — xem ADR-002
-- ---------------------------------------------------------------------
create table public.ledger_accounts (
  id           uuid primary key default gen_random_uuid(),
  owner_type   text not null check (owner_type in ('USER','CLUB','CHALLENGE','SYSTEM')),
  owner_id     uuid,                                   -- null với SYSTEM
  code         text not null,                          -- USER:'WALLET' | CLUB:'TREASURY','DEPOSIT' | CHALLENGE:'ESCROW' | SYSTEM:'MINT','BURN','PLATFORM_FEE','SHOP_REVENUE'
  balance      numeric(18,2) not null default 0,
  allow_negative boolean not null default false,       -- chỉ SYSTEM:MINT được âm (nguồn phát hành Xu)
  created_at   timestamptz not null default now(),
  unique nulls not distinct (owner_type, owner_id, code),
  check (allow_negative or balance >= 0)
);
-- Tài khoản hệ thống. MINT là nguồn phát hành (được âm), BURN là nơi hủy Xu.
insert into public.ledger_accounts (owner_type, owner_id, code, allow_negative) values
  ('SYSTEM', null, 'MINT', true), ('SYSTEM', null, 'BURN', false),
  ('SYSTEM', null, 'PLATFORM_FEE', false), ('SYSTEM', null, 'SHOP_REVENUE', false);

create table public.ledger_transactions (
  id               uuid primary key default gen_random_uuid(),
  type             text not null,          -- 'RUN_REWARD','MISSION_REWARD','CHALLENGE_STAKE','CHALLENGE_PAYOUT','CHALLENGE_REFUND','PLATFORM_FEE','SHOP_PURCHASE','CHEER','CLUB_CONTRIBUTION','CLUB_DEPOSIT','REFERRAL','TOPUP','ADMIN_ADJUST','REVERSAL', ...
  idempotency_key  text not null unique,   -- vd 'activity:<id>:run_reward'
  reverses_id      uuid references public.ledger_transactions(id),
  metadata         jsonb not null default '{}',
  created_by       uuid,
  created_at       timestamptz not null default now()
);

create table public.ledger_entries (
  id              bigint generated always as identity primary key,
  transaction_id  uuid not null references public.ledger_transactions(id),
  account_id      uuid not null references public.ledger_accounts(id),
  amount          numeric(18,2) not null check (amount <> 0),   -- + ghi có, - ghi nợ
  balance_after   numeric(18,2) not null,
  created_at      timestamptz not null default now()
);
create index on public.ledger_entries (account_id, id desc);

-- Chặn sửa/xóa lịch sử: chỉ được INSERT
create or replace function private.forbid_mutation() returns trigger language plpgsql as $$
begin raise exception 'LEDGER_IMMUTABLE'; end $$;
create trigger ledger_entries_immutable before update or delete on public.ledger_entries
  for each row execute function private.forbid_mutation();
create trigger ledger_tx_immutable before update or delete on public.ledger_transactions
  for each row execute function private.forbid_mutation();

create or replace function private.user_wallet(p_user uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.ledger_accounts where owner_type='USER' and owner_id=p_user and code='WALLET'
$$;
create or replace function private.system_account(p_code text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.ledger_accounts where owner_type='SYSTEM' and code=p_code
$$;

-- Hàm DUY NHẤT được phép thay đổi số dư.
-- p_legs: [{account: uuid, amount: numeric}, ...] — tổng phải = 0.
-- Idempotent: gọi lại cùng key trả về transaction cũ, không ghi thêm.
create or replace function public.post_ledger_transaction(
  p_type text, p_idempotency_key text, p_legs jsonb, p_metadata jsonb default '{}', p_reverses uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tx uuid; v_leg jsonb; v_sum numeric := 0; v_bal numeric;
begin
  select id into v_tx from public.ledger_transactions where idempotency_key = p_idempotency_key;
  if found then return v_tx; end if;

  select coalesce(sum((l->>'amount')::numeric), 0) into v_sum from jsonb_array_elements(p_legs) l;
  if v_sum <> 0 then raise exception 'LEDGER_UNBALANCED'; end if;

  insert into public.ledger_transactions (type, idempotency_key, metadata, created_by, reverses_id)
  values (p_type, p_idempotency_key, p_metadata, auth.uid(), p_reverses) returning id into v_tx;

  -- Khóa tài khoản theo thứ tự id để tránh deadlock
  for v_leg in select l from jsonb_array_elements(p_legs) l order by l->>'account' loop
    update public.ledger_accounts
       set balance = balance + (v_leg->>'amount')::numeric
     where id = (v_leg->>'account')::uuid
     returning balance into v_bal;
    if not found then raise exception 'LEDGER_ACCOUNT_NOT_FOUND'; end if;
    insert into public.ledger_entries (transaction_id, account_id, amount, balance_after)
    values (v_tx, (v_leg->>'account')::uuid, (v_leg->>'amount')::numeric, v_bal);
  end loop;           -- CHECK (balance >= 0) trên ledger_accounts tự chặn khi không đủ tiền
  return v_tx;
exception when check_violation then
  raise exception 'INSUFFICIENT_BALANCE';
end $$;
revoke execute on function public.post_ledger_transaction from anon, authenticated;  -- chỉ gọi từ hàm khác

-- View số dư cho client
create view public.my_wallet with (security_invoker = false) as
  select a.balance from public.ledger_accounts a
  where a.owner_type='USER' and a.owner_id = auth.uid() and a.code='WALLET';

-- Cấu hình kinh tế có phiên bản (FR39) — kế thừa system_config_versions hiện có
create table public.config_versions (
  key         text not null,                 -- 'economy', 'xp_rules', 'fee_tiers', 'anticheat'
  version     int  not null,
  value       jsonb not null,
  status      text not null default 'DRAFT' check (status in ('DRAFT','PUBLISHED','ARCHIVED')),
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  primary key (key, version)
);
create unique index config_one_published on public.config_versions (key) where status = 'PUBLISHED';

create table public.missions (                -- FR21: nhiệm vụ ngày/tuần
  id           uuid primary key default gen_random_uuid(),
  code         text unique not null,          -- 'DAILY_CHECKIN','DAILY_RUN_3K','WEEKLY_30K',...
  period       text not null check (period in ('DAILY','WEEKLY','ONCE','SPONSORED')),
  title        text not null,
  criteria     jsonb not null,                -- {"metric":"distance_m","gte":3000}
  reward_xu    numeric(18,2) not null default 0,
  reward_xp    int not null default 0,
  sponsor_id   uuid,                          -- nhiệm vụ nhãn hàng (Brand Mission)
  active       boolean not null default true
);

create table public.user_missions (
  user_id       uuid references public.profiles(id) on delete cascade,
  mission_id    uuid references public.missions(id),
  period_start  date not null,
  progress      numeric not null default 0,
  completed_at  timestamptz,
  claimed_at    timestamptz,
  primary key (user_id, mission_id, period_start)
);

create table public.payments (                 -- nạp Xu / phí giải ảo (Giai đoạn 4)
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id),
  purpose        text not null check (purpose in ('TOPUP','EVENT_FEE','PREMIUM')),
  provider       text not null check (provider in ('VNPAY','MOMO','STRIPE')),
  amount_vnd     bigint not null check (amount_vnd > 0),
  xu_amount      numeric(18,2),
  ref_id         uuid,                          -- event_registration_id ...
  status         text not null default 'PENDING' check (status in ('PENDING','PAID','FAILED','REFUNDED')),
  provider_ref   text unique,
  created_at     timestamptz not null default now(),
  paid_at        timestamptz
);

-- ---------------------------------------------------------------------
-- 5. PROGRESSION: XP, LEVEL, BADGE (Module 1.3)
-- ---------------------------------------------------------------------
create table public.level_definitions (
  level        smallint primary key,
  name         text not null,                 -- 'Người Mới Bắt Đầu', ...
  min_xp       bigint not null,
  decay_rule   jsonb                          -- {"window_days":30,"min_activities":5,"check_every_days":30} | null
);
insert into public.level_definitions values
  (1,'Người Mới Bắt Đầu',0,null),
  (2,'Người Chạy Đều Đặn',1000,null),
  (3,'Vận Động Viên Cơ Bản',5000,'{"window_days":60,"min_activities":3,"check_every_days":30}'),
  (4,'Runner Nghiêm Túc',15000,'{"window_days":30,"min_activities":5,"check_every_days":30}'),
  (5,'Huyền Thoại Đường Chạy',40000,'{"window_days":30,"min_activities":5,"check_every_days":30}');

create table public.xp_events (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  amount           int not null,
  reason           text not null,             -- 'FIRST_KM','KM','STREAK_DAY','FRIEND_ADDED','CHEER_SENT','PB','CHALLENGE_DONE','DUEL_WON','WEEKLY_TOP1',...
  ref_id           uuid,
  idempotency_key  text not null unique,
  created_at       timestamptz not null default now()
);

create table public.level_checks (            -- cơ chế hạ cấp
  user_id         uuid primary key references public.profiles(id) on delete cascade,
  level_since     timestamptz not null default now(),
  next_check_at   timestamptz,
  warned_at       timestamptz
);

create table public.badges (
  id        uuid primary key default gen_random_uuid(),
  code      text unique not null,
  name      text not null,
  kind      text not null check (kind in ('BADGE','MEDAL')),   -- MEDAL = huy chương sự kiện
  icon_url  text,
  criteria  jsonb
);
create table public.user_badges (
  user_id     uuid references public.profiles(id) on delete cascade,
  badge_id    uuid references public.badges(id),
  ref_id      uuid,                           -- challenge/event đạt được
  awarded_at  timestamptz not null default now(),
  primary key (user_id, badge_id, ref_id)
);

-- ---------------------------------------------------------------------
-- 6. SHOP & AVATAR (Module 3.2, 3.3)
-- ---------------------------------------------------------------------
create table public.items (
  id              uuid primary key default gen_random_uuid(),
  sku             text unique not null,
  name            text not null,
  description     text,
  category        text not null check (category in ('OUTFIT','EFFECT','CHEER','FUNCTIONAL')),
  slot            text check (slot in ('hair','top','bottom','shoes','hat','glasses','watch','accessory','aura','trail')),
  rarity          text not null default 'COMMON' check (rarity in ('COMMON','RARE','EPIC','LEGENDARY')),
  price_xu        numeric(18,2),                -- null = không bán (chỉ thưởng)
  level_required  smallint not null default 1,
  is_exclusive    boolean not null default false,   -- khóa khi user bị hạ cấp
  cheer_xp_sender   int,                        -- chỉ với CHEER
  cheer_xp_receiver int,
  effect          jsonb,                        -- FUNCTIONAL: {"xp_multiplier":1.2,"duration_h":24}
  asset_2d_url    text,
  partner_sku     text,                         -- Digital Twin (FR42)
  stock           int,                          -- null = không giới hạn
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

create table public.user_items (               -- "Tủ đồ"
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  item_id       uuid not null references public.items(id),
  quantity      int not null default 1 check (quantity >= 0),   -- CHEER/FUNCTIONAL là tiêu hao
  acquired_via  text not null check (acquired_via in ('PURCHASE','REWARD','LEVEL_UNLOCK','DIGITAL_TWIN','ADMIN')),
  acquired_at   timestamptz not null default now(),
  unique (user_id, item_id)
);

create table public.avatar_profiles (          -- thay cho user_avatar (bỏ level/xp/coins trùng lặp)
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  gender      text not null default 'male' check (gender in ('male','female')),
  body_type   text,
  skin_tone   text,
  hair_style  text,
  hair_color  text,
  updated_at  timestamptz not null default now()
);

create table public.avatar_loadouts (          -- thay cho user_equipment (10 cột) → 1 dòng/slot
  user_id       uuid references public.profiles(id) on delete cascade,
  slot          text,
  user_item_id  uuid not null references public.user_items(id) on delete cascade,
  primary key (user_id, slot)
);

-- ---------------------------------------------------------------------
-- 7. CLUB (Module 4.2 + "Căn cứ đồng đội")
-- ---------------------------------------------------------------------
create table public.clubs (
  id               uuid primary key default gen_random_uuid(),
  slug             text unique,
  name             text not null,
  description      text,
  type             text not null default 'FRIENDS' check (type in ('COMPANY','FRIENDS','REGION','SPECIALTY','OFFICIAL')),
  avatar_url       text,
  cover_url        text,
  province_code    text,
  owner_id         uuid not null references public.profiles(id),
  join_policy      text not null default 'APPROVAL' check (join_policy in ('OPEN','APPROVAL','INVITE_ONLY')),
  invite_code      text unique not null default encode(extensions.gen_random_bytes(6),'hex'),
  member_count     int not null default 0,       -- cache, cập nhật bằng trigger
  member_limit     int not null default 200,
  tier             text not null default 'BRONZE' check (tier in ('BRONZE','SILVER','GOLD','DIAMOND')),
  activity_score   int not null default 0,
  zero_score_since date,
  status           text not null default 'ACTIVE' check (status in ('ACTIVE','WARNED','DISSOLVED','SUSPENDED')),
  announcement     text,
  created_at       timestamptz not null default now()
  -- Quỹ và tiền ký quỹ nằm trong ledger_accounts (owner_type='CLUB', code 'TREASURY'/'DEPOSIT')
);

create table public.club_members (
  id          uuid primary key default gen_random_uuid(),
  club_id     uuid not null references public.clubs(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        text not null default 'MEMBER'
              check (role in ('OWNER','VICE_OWNER','COACH','CAPTAIN','CONTENT_ADMIN','CHALLENGE_ADMIN','MEMBER')),
  status      text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED','BANNED','LEFT')),
  joined_at   timestamptz not null default now(),
  unique (club_id, user_id)
);
create index on public.club_members (user_id) where status = 'APPROVED';

create table public.club_role_permissions (
  role             text not null,
  permission_code  text not null,       -- 'club.delete','member.approve','challenge.create','treasury.withdraw','plan.manage','announcement.post'
  primary key (role, permission_code)
);

create table public.club_announcements (
  id           uuid primary key default gen_random_uuid(),
  club_id      uuid not null references public.clubs(id) on delete cascade,
  author_id    uuid references public.profiles(id),
  title        text not null,
  content      text not null,
  is_pinned    boolean not null default false,
  published_at timestamptz not null default now()
);

create table public.club_score_events (
  id          bigint generated always as identity primary key,
  club_id     uuid not null references public.clubs(id) on delete cascade,
  points      int not null,                 -- +10 bài chạy, +5 tương tác, +50 thử thách nội bộ >50%
  reason      text not null,
  ref_id      uuid,
  created_at  timestamptz not null default now()
);

create table public.club_reports (
  id           uuid primary key default gen_random_uuid(),
  club_id      uuid not null references public.clubs(id) on delete cascade,
  reporter_id  uuid not null references public.profiles(id),
  reason       text not null,
  status       text not null default 'OPEN',
  created_at   timestamptz not null default now(),
  unique (club_id, reporter_id)
);

-- ---------------------------------------------------------------------
-- 8. CHALLENGE ENGINE (Module 2) — xem ADR-004
-- ---------------------------------------------------------------------
create table public.challenges (
  id                 uuid primary key default gen_random_uuid(),
  slug               text unique,
  title              text not null,
  description        text,
  cover_url          text,
  -- Thể thức (cách tổ chức) × Mục tiêu (cách tính điểm)
  format             text not null check (format in (
                       'SOLO_GOAL',     -- 2.1 Chinh phục bản thân
                       'DUEL',          -- 2.2 Đối kháng 1-1
                       'GROUP',         -- nhóm riêng tư / mở đăng ký, mỗi người tự tính
                       'TEAM_VS',       -- 2.3/2.8 Đối kháng đồng đội / CLB
                       'RELAY',         -- 2.4 Tiếp sức
                       'COMMUNITY',     -- 2.5 Tập thể: cả cộng đồng cùng đạt 1 mục tiêu
                       'SECRET',        -- 2.6 Bí mật (PIN)
                       'HUNTER',        -- 2.7 Săn mồi
                       'EVENT')),       -- FR13 Giải ảo của BTC
  objective          text not null check (objective in (
                       'VOLUME',        -- tích lũy km
                       'DISTANCE',      -- 1 bài chạy ≥ X km
                       'PERFORMANCE',   -- ≥ X km trong ≤ T giây
                       'PACE',          -- Pace Breaker
                       'NEGATIVE_SPLIT',
                       'STREAK',        -- chuỗi ngày
                       'SESSIONS',      -- số buổi
                       'TIME',          -- tổng thời gian chạy
                       'AVG_PACE')),    -- pace trung bình tốt nhất
  rules              jsonb not null,    -- tham số theo format/objective, validate bằng JSON Schema (xem api.md §4)
  scope              text not null default 'PUBLIC' check (scope in ('PUBLIC','PRIVATE','CLUB','INVITE')),
  club_id            uuid references public.clubs(id),
  event_id           uuid,              -- FK tới events (GĐ 4)
  creator_id         uuid not null references public.profiles(id),
  creator_kind       text not null default 'USER' check (creator_kind in ('USER','CLUB','SYSTEM','ORGANIZER')),
  status             text not null default 'DRAFT' check (status in
                       ('DRAFT','PENDING_REVIEW','OPEN','READY','LIVE','SETTLING','DISPUTED','SETTLED','CANCELLED')),
  -- Kinh tế
  funding            text not null default 'NONE' check (funding in ('NONE','ENTRY_STAKE','SPONSOR','CLUB_TREASURY')),
  stake_xu           numeric(18,2) not null default 0 check (stake_xu >= 0),   -- mức cọc mỗi người (ENTRY_STAKE)
  sponsor_pool_xu    numeric(18,2) not null default 0,                         -- chủ kèo / quỹ CLB tài trợ
  prize_split        text not null default 'WINNER_TAKES_ALL'
                     check (prize_split in ('WINNER_TAKES_ALL','EQUAL_WINNERS','PRO_RATA','TOP_N','MVP_BONUS')),
  platform_fee_bps   int not null default 500,      -- 5%
  creation_fee_xu    numeric(18,2) not null default 0,  -- theo fee tier
  extra_rewards_text text,                           -- "Bên thua mời cafe" — chỉ hiển thị
  -- Điều kiện tham gia
  min_level          smallint not null default 1,
  max_participants   int,
  pin_hash           text,                           -- SECRET / PRIVATE: bcrypt(pin)
  join_deadline      timestamptz,
  require_ready      boolean not null default false, -- DUEL: cả 2 bấm "Sẵn sàng"
  -- Thời gian
  start_at           timestamptz not null,
  end_at             timestamptz not null,
  daily_window       tstzrange,                      -- HUNTER: 04:00–08:00 (lưu theo giờ VN trong rules)
  started_at         timestamptz,
  settled_at         timestamptz,
  created_at         timestamptz not null default now(),
  check (end_at > start_at)
);
create index on public.challenges (status, start_at);
create index on public.challenges (club_id) where club_id is not null;

create table public.challenge_teams (
  id            uuid primary key default gen_random_uuid(),
  challenge_id  uuid not null references public.challenges(id) on delete cascade,
  name          text not null,
  captain_id    uuid references public.profiles(id),
  club_id       uuid references public.clubs(id),   -- đấu CLB vs CLB
  max_size      int,
  locked_size   int,            -- mẫu số chốt tại started_at (luật "quân số tự do")
  score         numeric not null default 0,
  total_time_s  int,            -- RELAY: xếp hạng theo tổng thời gian
  penalty_s     int not null default 0,
  rank          int
);

create table public.challenge_participants (
  id              uuid primary key default gen_random_uuid(),
  challenge_id    uuid not null references public.challenges(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  team_id         uuid references public.challenge_teams(id) on delete set null,
  role            text not null default 'PARTICIPANT' check (role in ('PARTICIPANT','CAPTAIN','PREY','HUNTER')),
  status          text not null default 'JOINED' check (status in
                    ('INVITED','JOINED','READY','COMPLETED','FAILED','DISQUALIFIED','WITHDRAWN')),
  progress        numeric not null default 0,  -- đơn vị theo objective (m, giây, ngày, buổi)
  score           numeric not null default 0,  -- giá trị dùng để xếp hạng
  best_value      numeric,                      -- pace tốt nhất / thời gian tốt nhất
  pending_review  boolean not null default false,  -- có bài đang UNDER_REVIEW → hiển thị xám
  rank            int,
  stake_tx_id     uuid references public.ledger_transactions(id),
  joined_at       timestamptz not null default now(),
  ready_at        timestamptz,
  completed_at    timestamptz,
  unique (challenge_id, user_id)
);
create index on public.challenge_participants (challenge_id, score desc);
create index on public.challenge_participants (user_id, status);

-- Bài chạy nào được tính vào thử thách nào, đóng góp bao nhiêu → audit & đảo ngược khi bài bị REJECT
create table public.challenge_contributions (
  challenge_id    uuid references public.challenges(id) on delete cascade,
  activity_id     uuid references public.activities(id) on delete cascade,
  participant_id  uuid not null references public.challenge_participants(id) on delete cascade,
  value           numeric not null,
  counted_at      timestamptz not null default now(),
  primary key (challenge_id, activity_id)
);

create table public.relay_legs (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.challenge_teams(id) on delete cascade,
  leg_no        smallint not null,
  runner_id     uuid not null references public.profiles(id),
  target_m      int not null,
  unlocked_at   timestamptz,        -- server mở khóa khi chặng trước xong
  started_at    timestamptz,
  finished_at   timestamptz,
  activity_id   uuid references public.activities(id),
  elapsed_s     int,
  penalty_s     int not null default 0,
  status        text not null default 'LOCKED' check (status in ('LOCKED','UNLOCKED','RUNNING','DONE','ABANDONED')),
  unique (team_id, leg_no)
);

create table public.challenge_invites (
  challenge_id  uuid references public.challenges(id) on delete cascade,
  invitee_id    uuid references public.profiles(id) on delete cascade,
  invited_by    uuid not null references public.profiles(id),
  status        text not null default 'PENDING' check (status in ('PENDING','ACCEPTED','DECLINED','EXPIRED')),
  created_at    timestamptz not null default now(),
  primary key (challenge_id, invitee_id)
);

-- ---------------------------------------------------------------------
-- 9. LIVE, FEED, CHEER, NOTIFICATION, CHAT (Module 4)
-- ---------------------------------------------------------------------
create table public.live_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  challenge_id    uuid references public.challenges(id),
  relay_leg_id    uuid references public.relay_legs(id),
  status          text not null default 'LIVE' check (status in ('LIVE','PAUSED','ENDED','ABANDONED')),
  visibility      text not null default 'FRIENDS' check (visibility in ('PUBLIC','FRIENDS','CLUB','PRIVATE')),
  share_location  boolean not null default false,
  last_distance_m int not null default 0,
  last_point      jsonb,                         -- {lat,lng,t} — cập nhật thưa (60s)
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  activity_id     uuid references public.activities(id)
);
create index on public.live_sessions (user_id) where status = 'LIVE';

create table public.feed_items (
  id            uuid primary key default gen_random_uuid(),
  actor_id      uuid not null references public.profiles(id) on delete cascade,
  verb          text not null check (verb in ('ACTIVITY','PB','CHALLENGE_COMPLETED','CHALLENGE_WON','CHALLENGE_CREATED',
                                             'LEVEL_UP','RARE_ITEM','LIVE','POST','BRAND_MISSION','CLUB_ANNOUNCEMENT')),
  activity_id   uuid references public.activities(id) on delete cascade,
  challenge_id  uuid references public.challenges(id) on delete cascade,
  club_id       uuid references public.clubs(id) on delete cascade,
  body          text,
  media         jsonb not null default '[]',
  payload       jsonb not null default '{}',      -- dữ liệu dựng thẻ: km, pace, hạng, tên vật phẩm...
  visibility    text not null default 'PUBLIC' check (visibility in ('PUBLIC','FRIENDS','CLUB','PRIVATE')),
  like_count    int not null default 0,
  comment_count int not null default 0,
  cheer_count   int not null default 0,
  cheer_xu      numeric(18,2) not null default 0,
  created_at    timestamptz not null default now()
);
create index on public.feed_items (actor_id, created_at desc);
create index on public.feed_items (club_id, created_at desc) where club_id is not null;
create index on public.feed_items (created_at desc) where visibility = 'PUBLIC';

create table public.reactions (
  feed_item_id  uuid references public.feed_items(id) on delete cascade,
  user_id       uuid references public.profiles(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (feed_item_id, user_id)
);

create table public.comments (
  id            uuid primary key default gen_random_uuid(),
  feed_item_id  uuid not null references public.feed_items(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  body          text not null check (char_length(body) between 1 and 1000),
  created_at    timestamptz not null default now()
);

create table public.cheers (
  id               uuid primary key default gen_random_uuid(),
  sender_id        uuid not null references public.profiles(id),
  receiver_id      uuid not null references public.profiles(id),
  item_id          uuid not null references public.items(id),
  feed_item_id     uuid references public.feed_items(id) on delete set null,
  live_session_id  uuid references public.live_sessions(id) on delete set null,
  message          text check (char_length(message) <= 140),
  xu_amount        numeric(18,2) not null,
  ledger_tx_id     uuid not null references public.ledger_transactions(id),
  created_at       timestamptz not null default now(),
  check (sender_id <> receiver_id)
);
create index on public.cheers (receiver_id, created_at desc);

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  category    text not null check (category in ('SOCIAL','CHALLENGE','SYSTEM','WALLET','CLUB')),
  type        text not null,          -- 'CHEER_RECEIVED','DUEL_INVITE','LEVEL_DECAY_WARNING',...
  title       text not null,
  body        text,
  data        jsonb not null default '{}',   -- deep link: {"route":"/challenges/abc"}
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);

create table public.conversations (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('DIRECT','GROUP','CLUB','CHALLENGE')),
  club_id       uuid references public.clubs(id) on delete cascade,
  challenge_id  uuid references public.challenges(id) on delete cascade,
  title         text,
  created_at    timestamptz not null default now()
);
create table public.conversation_members (
  conversation_id  uuid references public.conversations(id) on delete cascade,
  user_id          uuid references public.profiles(id) on delete cascade,
  last_read_at     timestamptz,
  muted            boolean not null default false,
  primary key (conversation_id, user_id)
);
create table public.messages (
  id               bigint generated always as identity primary key,
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  sender_id        uuid references public.profiles(id) on delete set null,
  body             text,
  attachment       jsonb,
  created_at       timestamptz not null default now()
);
create index on public.messages (conversation_id, id desc);

-- ---------------------------------------------------------------------
-- 10. LEADERBOARD (Module 4.4)
-- ---------------------------------------------------------------------
-- BXH "hiện tại" = materialized view refresh 5 phút; BXH kỳ trước = snapshot bất biến.
create materialized view public.lb_distance_week as
  select a.user_id, p.province_code, sum(a.distance_m) as distance_m, count(*) as runs,
         rank() over (order by sum(a.distance_m) desc) as rank
  from public.activities a join public.profiles p on p.id = a.user_id
  where a.status = 'VERIFIED' and a.start_time >= date_trunc('week', now())
  group by a.user_id, p.province_code;
create unique index on public.lb_distance_week (user_id);

create table public.leaderboard_snapshots (
  board_key     text not null,          -- 'global:distance:week', 'region:HN:distance:month', 'club:<id>:xp:week'
  period_start  date not null,
  rows          jsonb not null,         -- top 100: [{user_id, value, rank}]
  created_at    timestamptz not null default now(),
  primary key (board_key, period_start)
);

-- ---------------------------------------------------------------------
-- 11. ORGANIZER & MARKETPLACE (Module 5.1, 6) — Giai đoạn 4, rút gọn
-- ---------------------------------------------------------------------
create table public.organizers (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles(id),
  name       text not null,
  verified   boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.events (
  id             uuid primary key default gen_random_uuid(),
  organizer_id   uuid not null references public.organizers(id),
  challenge_id   uuid unique references public.challenges(id),   -- phần tính điểm dùng lại Challenge Engine
  slug           text unique not null,
  fee_vnd        bigint not null default 0,
  capacity       int,
  medal_badge_id uuid references public.badges(id),
  landing        jsonb not null default '{}',      -- nội dung trang đăng ký riêng
  status         text not null default 'DRAFT'
);
create table public.event_registrations (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id),
  user_id     uuid not null references public.profiles(id),
  payment_id  uuid references public.payments(id),
  bib_no      text,
  status      text not null default 'PENDING' check (status in ('PENDING','CONFIRMED','CANCELLED','REFUNDED')),
  created_at  timestamptz not null default now(),
  unique (event_id, user_id)
);
create table public.partners (id uuid primary key default gen_random_uuid(), name text not null, logo_url text);
create table public.vouchers (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references public.partners(id),
  title       text not null,
  price_xu    numeric(18,2) not null,
  stock       int,
  valid_until timestamptz
);
create table public.voucher_redemptions (
  id          uuid primary key default gen_random_uuid(),
  voucher_id  uuid not null references public.vouchers(id),
  user_id     uuid not null references public.profiles(id),
  code        text not null,
  ledger_tx_id uuid not null references public.ledger_transactions(id),
  created_at  timestamptz not null default now()
);

-- =====================================================================
-- 12. ROW LEVEL SECURITY — mẫu chính sách
-- =====================================================================
-- Nguyên tắc: bật RLS cho MỌI bảng public. Không có policy = không truy cập.
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

create or replace function public.is_system_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'SYSTEM_ADMIN')
$$;

create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.friendships
                 where user_low = least(a,b) and user_high = greatest(a,b) and status = 'ACCEPTED')
$$;

-- profiles: ai cũng đọc được thông tin công khai; chỉ tự sửa CỘT AN TOÀN
create policy profiles_read on public.profiles for select using (true);
create policy profiles_update_self on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (handle, display_name, avatar_url, gender, birth_date, province_code, bio,
              goal_km_month, goal_days_week) on public.profiles to authenticated;
-- → client KHÔNG thể update xp, level, trust_score, is_banned dù policy cho phép dòng đó.

-- activities: theo quyền riêng tư; không có INSERT/UPDATE cho client (dùng RPC)
create policy activities_read on public.activities for select using (
  user_id = auth.uid()
  or (status = 'VERIFIED' and (visibility = 'PUBLIC'
      or (visibility = 'FRIENDS' and public.are_friends(auth.uid(), user_id))))
  or public.is_system_admin()
);

-- ledger: chỉ xem bút toán của tài khoản mình
create policy ledger_accounts_read on public.ledger_accounts for select
  using (owner_type = 'USER' and owner_id = auth.uid());
create policy ledger_entries_read on public.ledger_entries for select
  using (account_id = private.user_wallet(auth.uid()));

-- challenges: công khai / thành viên CLB / người tham gia / người được mời
create policy challenges_read on public.challenges for select using (
  scope = 'PUBLIC' and status <> 'DRAFT'
  or creator_id = auth.uid()
  or exists (select 1 from public.challenge_participants cp where cp.challenge_id = challenges.id and cp.user_id = auth.uid())
  or exists (select 1 from public.challenge_invites ci where ci.challenge_id = challenges.id and ci.invitee_id = auth.uid())
  or (scope = 'CLUB' and exists (select 1 from public.club_members m
        where m.club_id = challenges.club_id and m.user_id = auth.uid() and m.status = 'APPROVED'))
);
-- Lưu ý SECRET: description/rules của thử thách bí mật chỉ trả qua RPC get_challenge() sau khi mở PIN.

create policy notifications_own on public.notifications for select using (user_id = auth.uid());
create policy notifications_mark_read on public.notifications for update using (user_id = auth.uid());
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy messages_member on public.messages for select using (
  exists (select 1 from public.conversation_members m where m.conversation_id = messages.conversation_id and m.user_id = auth.uid()));

-- =====================================================================
-- 13. VÍ DỤ RPC NGHIỆP VỤ (mẫu chuẩn cho mọi command)
-- =====================================================================
-- Mẫu: SECURITY DEFINER + search_path rỗng + auth.uid() + idempotency + lỗi có mã.
create or replace function public.join_challenge(p_challenge_id uuid, p_team_id uuid default null,
                                                 p_pin text default null, p_idempotency_key text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  c     public.challenges%rowtype;
  v_participant uuid;
  v_escrow uuid;
  v_tx uuid;
  v_count int;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into c from public.challenges where id = p_challenge_id for update;
  if not found then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if c.status not in ('OPEN') then raise exception 'CHALLENGE_NOT_OPEN'; end if;
  if c.join_deadline is not null and now() > c.join_deadline then raise exception 'JOIN_DEADLINE_PASSED'; end if;
  if c.pin_hash is not null and (p_pin is null or extensions.crypt(p_pin, c.pin_hash) <> c.pin_hash) then
    raise exception 'INVALID_PIN';
  end if;
  if (select level from public.profiles where id = v_uid) < c.min_level then raise exception 'LEVEL_TOO_LOW'; end if;
  if c.scope = 'CLUB' and not exists (select 1 from public.club_members
       where club_id = c.club_id and user_id = v_uid and status = 'APPROVED') then
    raise exception 'CLUB_MEMBERS_ONLY';
  end if;

  select count(*) into v_count from public.challenge_participants where challenge_id = c.id and status <> 'WITHDRAWN';
  if c.max_participants is not null and v_count >= c.max_participants then raise exception 'CHALLENGE_FULL'; end if;

  insert into public.challenge_participants (challenge_id, user_id, team_id)
  values (c.id, v_uid, p_team_id)
  on conflict (challenge_id, user_id) do nothing
  returning id into v_participant;
  if v_participant is null then raise exception 'ALREADY_JOINED'; end if;

  if c.funding = 'ENTRY_STAKE' and c.stake_xu > 0 then
    select id into v_escrow from public.ledger_accounts
      where owner_type = 'CHALLENGE' and owner_id = c.id and code = 'ESCROW';
    v_tx := public.post_ledger_transaction(
      'CHALLENGE_STAKE',
      coalesce(p_idempotency_key, 'stake:' || c.id || ':' || v_uid),
      jsonb_build_array(
        jsonb_build_object('account', private.user_wallet(v_uid), 'amount', -c.stake_xu),
        jsonb_build_object('account', v_escrow,                  'amount',  c.stake_xu)),
      jsonb_build_object('challenge_id', c.id));
    update public.challenge_participants set stake_tx_id = v_tx where id = v_participant;
  end if;

  insert into public.domain_events (type, aggregate, aggregate_id, actor_id, payload)
  values ('challenge.joined', 'challenge', c.id, v_uid, jsonb_build_object('participant_id', v_participant));

  return jsonb_build_object('participant_id', v_participant, 'stake_tx_id', v_tx);
end $$;
grant execute on function public.join_challenge to authenticated;

-- =====================================================================
-- 14. JOB ĐỊNH KỲ (pg_cron) — tên hàm được mô tả trong README §4.5
-- =====================================================================
-- select cron.schedule('settle-challenges',   '* * * * *',   $$select private.settle_due_challenges()$$);
-- select cron.schedule('refresh-lb',          '*/5 * * * *', $$refresh materialized view concurrently public.lb_distance_week$$);
-- select cron.schedule('level-decay',         '0 1 * * *',   $$select private.run_level_decay()$$);
-- select cron.schedule('club-score',          '30 1 * * *',  $$select private.run_club_activity_score()$$);
-- select cron.schedule('missions-rollover',   '0 17 * * *',  $$select private.rollover_missions()$$);  -- 00:00 giờ VN
