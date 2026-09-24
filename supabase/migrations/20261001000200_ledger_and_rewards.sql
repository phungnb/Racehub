-- =====================================================================
-- 20261001000200 — SỔ CÁI THỐNG NHẤT + THƯỞNG BÀI CHẠY PHÍA SERVER
--
-- Trước migration này có 2 nguồn số dư mâu thuẫn:
--   * profiles.xu        ← thưởng chạy, referral, quỹ CLB cập nhật trực tiếp
--   * sum(ledger_entries) ← create_challenge_with_ledger dùng để kiểm tra số dư
-- Từ đây: ledger_entries là NGUỒN SỰ THẬT; profiles.xu và clubs.treasury_balance
-- chỉ là bản sao (cache) được đồng bộ trong cùng transaction.
--
-- Quy ước tài khoản (giữ nguyên như code cũ):
--   account_id = user id | club id | '00000000-0000-0000-0000-000000000000' (hệ thống, được âm)
--   coin_kind  = 'BONUS' (Xu thưởng) | 'PAID' (Xu nạp)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Hạ tầng
-- ---------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Xu có phần lẻ (0,1 Xu) → amount phải là numeric (trước đây bigint làm mất phần lẻ)
alter table public.ledger_entries alter column amount type numeric(18,2) using amount::numeric(18,2);
alter table public.ledger_entries add column if not exists created_at timestamptz not null default now();
create index if not exists ledger_entries_account_idx on public.ledger_entries (account_id, coin_kind);
create index if not exists ledger_entries_tx_idx on public.ledger_entries (transaction_id);

-- Đánh dấu bài chạy đã được thưởng/tính điểm (chống xử lý 2 lần)
alter table public.activities add column if not exists rewarded_at timestamptz;
alter table public.activities add column if not exists earned_xu numeric(18,2);
alter table public.activities add column if not exists earned_xp integer;
create index if not exists activities_user_started_idx on public.activities (user_id, started_at desc);

-- Bài chạy cũ đã được hệ thống cũ thưởng (hoặc không đủ điều kiện) → đánh dấu để không thưởng lại
update public.activities set rewarded_at = coalesce(updated_at, created_at, now())
 where rewarded_at is null
   and not exists (select 1 from pg_class where relname = 'racehub_ledger_v1_marker');
create table if not exists private.racehub_ledger_v1_marker (applied_at timestamptz default now());

create or replace function private.system_account() returns uuid
language sql immutable as $$ select '00000000-0000-0000-0000-000000000000'::uuid $$;

-- ---------------------------------------------------------------------
-- 2. Ghi sổ — hàm DUY NHẤT được phép thay đổi số dư
--    p_entries: [{"account_id": uuid, "coin_kind": "BONUS"|"PAID", "amount": numeric}, ...]
--    * Idempotent: cùng idempotency_key → trả về transaction cũ, không ghi thêm
--    * Tổng amount phải = 0
--    * Khóa từng tài khoản bị trừ (advisory lock) để 2 giao dịch đồng thời không làm âm ví
-- ---------------------------------------------------------------------
create or replace function private.ledger_post(
  p_type text, p_idempotency_key text, p_reason text, p_created_by uuid, p_entries jsonb,
  p_ref uuid default null, p_allow_negative boolean default false
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_tx uuid;
  v_e record;
  v_sum numeric := 0;
  v_bal numeric;
begin
  select id into v_tx from public.ledger_transactions where idempotency_key = p_idempotency_key;
  if found then return v_tx; end if;

  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) < 2 then
    raise exception 'LEDGER_INVALID_ENTRIES';
  end if;
  select coalesce(sum((e->>'amount')::numeric), 0) into v_sum from jsonb_array_elements(p_entries) e;
  if v_sum <> 0 then raise exception 'LEDGER_UNBALANCED'; end if;

  -- Khóa theo thứ tự cố định để tránh deadlock
  for v_e in
    select distinct (e->>'account_id')::uuid as acc, e->>'coin_kind' as kind
      from jsonb_array_elements(p_entries) e
     order by 1, 2
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_e.acc::text || ':' || v_e.kind, 0));
  end loop;

  insert into public.ledger_transactions (type, idempotency_key, reason, created_by, campaign_id)
  values (p_type, p_idempotency_key, p_reason, p_created_by, p_ref)
  returning id into v_tx;

  for v_e in
    select (e->>'account_id')::uuid as acc, e->>'coin_kind' as kind, sum((e->>'amount')::numeric) as amt
      from jsonb_array_elements(p_entries) e
     group by 1, 2
  loop
    if v_e.kind not in ('BONUS', 'PAID') then raise exception 'LEDGER_INVALID_COIN_KIND'; end if;
    if v_e.amt = 0 then continue; end if;

    if v_e.amt < 0 and v_e.acc <> private.system_account() and not p_allow_negative then
      select coalesce(sum(amount), 0) into v_bal
        from public.ledger_entries where account_id = v_e.acc and coin_kind = v_e.kind;
      if v_bal + v_e.amt < 0 then raise exception 'INSUFFICIENT_BALANCE'; end if;
    end if;

    insert into public.ledger_entries (transaction_id, account_id, coin_kind, amount)
    values (v_tx, v_e.acc, v_e.kind, v_e.amt);
  end loop;

  -- Đồng bộ bản sao số dư
  update public.profiles p set xu = s.total
    from (select account_id, sum(amount) as total from public.ledger_entries
           where account_id in (select (e->>'account_id')::uuid from jsonb_array_elements(p_entries) e)
           group by account_id) s
   where p.id = s.account_id;
  update public.clubs c set treasury_balance = s.total
    from (select account_id, sum(amount) as total from public.ledger_entries
           where account_id in (select (e->>'account_id')::uuid from jsonb_array_elements(p_entries) e)
           group by account_id) s
   where c.id = s.account_id;

  return v_tx;
end $$;

create or replace function private.balance(p_account uuid, p_kind text default null)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from public.ledger_entries
   where account_id = p_account and (p_kind is null or coin_kind = p_kind)
$$;

-- Các bút toán trừ tiền của user: tiêu Xu thưởng (BONUS) trước, thiếu mới dùng Xu nạp (PAID)
create or replace function private.debit_entries(p_user uuid, p_amount numeric, p_credit_account uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_bonus numeric := greatest(private.balance(p_user, 'BONUS'), 0);
  v_from_bonus numeric := least(v_bonus, p_amount);
  v_from_paid numeric := p_amount - v_from_bonus;
  v jsonb := '[]'::jsonb;
begin
  if p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if v_from_bonus > 0 then
    v := v || jsonb_build_array(
      jsonb_build_object('account_id', p_user, 'coin_kind', 'BONUS', 'amount', -v_from_bonus),
      jsonb_build_object('account_id', p_credit_account, 'coin_kind', 'BONUS', 'amount', v_from_bonus));
  end if;
  if v_from_paid > 0 then
    v := v || jsonb_build_array(
      jsonb_build_object('account_id', p_user, 'coin_kind', 'PAID', 'amount', -v_from_paid),
      jsonb_build_object('account_id', p_credit_account, 'coin_kind', 'PAID', 'amount', v_from_paid));
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 3. Đối soát số dư đầu kỳ: đưa sổ cái về khớp số Xu người dùng đang thấy
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select p.id, round(coalesce(p.xu, 0), 2) - private.balance(p.id) as diff
      from public.profiles p
     where round(coalesce(p.xu, 0), 2) <> private.balance(p.id)
  loop
    perform private.ledger_post(
      'OPENING_BALANCE', 'opening_balance:v1:' || r.id, 'Đối soát số dư khi chuyển sang sổ cái', null,
      jsonb_build_array(
        jsonb_build_object('account_id', r.id, 'coin_kind', 'BONUS', 'amount', r.diff),
        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -r.diff)),
      null, true);
  end loop;

  for r in
    select c.id, round(coalesce(c.treasury_balance, 0), 2) - private.balance(c.id) as diff
      from public.clubs c
     where round(coalesce(c.treasury_balance, 0), 2) <> private.balance(c.id)
  loop
    perform private.ledger_post(
      'OPENING_BALANCE', 'opening_balance:v1:' || r.id, 'Đối soát quỹ CLB khi chuyển sang sổ cái', null,
      jsonb_build_array(
        jsonb_build_object('account_id', r.id, 'coin_kind', 'BONUS', 'amount', r.diff),
        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -r.diff)),
      null, true);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. Cấu hình kinh tế + cấp độ
-- ---------------------------------------------------------------------
-- Đọc economy_global_config (Admin → Kinh tế), có giá trị mặc định an toàn
create or replace function private.economy_config() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'kmRate', 1, 'xpPerKm', 10, 'maxDailyReward', 50,
           'minValidPace', 3.0, 'maxValidPace', 15.0,
           'refBonusInviter', 100, 'refBonusReferee', 50, 'refMinKmRequired', 3.0)
         || coalesce((select config_value from public.system_config_versions
                       where config_key = 'economy_global_config' and status = 'PUBLISHED'
                       order by version desc limit 1), '{}'::jsonb)
$$;

-- Bảng cấp độ theo tài liệu Module 1.3
create or replace function private.level_for_xp(p_xp numeric) returns integer
language sql immutable as $$
  select case when p_xp >= 40000 then 5 when p_xp >= 15000 then 4
              when p_xp >= 5000 then 3 when p_xp >= 1000 then 2 else 1 end
$$;

-- Công thức cũ (xp/500 + 1, không giới hạn) → theo tài liệu (Lv1–Lv5)
update public.profiles set level = private.level_for_xp(coalesce(xp, 0))
 where level is distinct from private.level_for_xp(coalesce(xp, 0));

-- ---------------------------------------------------------------------
-- 5. Thưởng + tính điểm thử thách cho MỘT bài chạy đã duyệt (idempotent)
-- ---------------------------------------------------------------------
create or replace function private.reward_activity(p_activity_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  a public.activities%rowtype;
  cfg jsonb := private.economy_config();
  v_km numeric;
  v_xu numeric := 0;
  v_xp integer := 0;
  v_today_xu numeric;
  v_day_start timestamptz;
  v_prof record;
  v_total_km numeric;
begin
  select * into a from public.activities where id = p_activity_id for update;
  if not found or a.rewarded_at is not null or a.user_id is null then
    return jsonb_build_object('earned_xu', coalesce(a.earned_xu, 0), 'earned_xp', coalesce(a.earned_xp, 0));
  end if;
  if not public.activity_is_countable(a.status, a.validation_status)
     or coalesce(a.validation_status, '') <> 'APPROVED' then
    return jsonb_build_object('earned_xu', 0, 'earned_xp', 0);
  end if;

  v_km := greatest(coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0), 0) / 1000.0;

  -- Xu: theo km, giới hạn trần mỗi ngày (giờ Việt Nam)
  v_day_start := date_trunc('day', coalesce(a.started_at, now()) at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh';
  select coalesce(sum(earned_xu), 0) into v_today_xu
    from public.activities
   where user_id = a.user_id and rewarded_at is not null
     and started_at >= v_day_start and started_at < v_day_start + interval '1 day';
  v_xu := round(least(v_km * (cfg->>'kmRate')::numeric,
                      greatest((cfg->>'maxDailyReward')::numeric - v_today_xu, 0)), 1);
  v_xp := round(v_km * (cfg->>'xpPerKm')::numeric);

  if v_xu > 0 then
    perform private.ledger_post('RUN_REWARD', 'run_reward:' || a.id, 'Thưởng bài chạy', a.user_id,
      jsonb_build_array(
        jsonb_build_object('account_id', a.user_id, 'coin_kind', 'BONUS', 'amount', v_xu),
        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -v_xu)),
      a.id);
  end if;

  update public.profiles
     set xp = coalesce(xp, 0) + v_xp,
         level = private.level_for_xp(coalesce(xp, 0) + v_xp)
   where id = a.user_id;

  -- Tiến độ thử thách: chỉ thử thách đang ACTIVE, bài chạy nằm trong thời gian và đạt điều kiện
  update public.challenge_participants cp
     set current_progress = round(coalesce(cp.current_progress, 0) + v_km, 2),
         status = case when c.target_km > 0 and coalesce(cp.current_progress, 0) + v_km >= c.target_km
                       then 'COMPLETED' else cp.status end
    from public.challenges c
   where c.id = cp.challenge_id
     and cp.profile_id = a.user_id
     and cp.status = 'JOINED'
     and c.status = 'ACTIVE'
     and a.started_at between c.start_date and c.end_date
     and v_km >= coalesce(c.min_km, 0)
     and (a.avg_pace_s is null or a.avg_pace_s = 0
          or a.avg_pace_s between coalesce(c.min_pace, 0) * 60 and coalesce(c.max_pace, 99) * 60);

  update public.activities
     set rewarded_at = now(), earned_xu = v_xu, earned_xp = v_xp, status = 'COMPLETED', updated_at = now()
   where id = a.id;

  -- Thưởng người giới thiệu khi bạn mới chạy đủ số km tối thiểu (chống tạo tài khoản ảo)
  select id, referred_by into v_prof from public.profiles where id = a.user_id;
  if v_prof.referred_by is not null then
    select coalesce(sum(coalesce(nullif(moving_distance_m, 0), distance_m, 0)), 0) / 1000.0 into v_total_km
      from public.activities where user_id = a.user_id and rewarded_at is not null;
    if v_total_km >= (cfg->>'refMinKmRequired')::numeric and (cfg->>'refBonusInviter')::numeric > 0 then
      perform private.ledger_post('REFERRAL_INVITER', 'referral_inviter:' || a.user_id,
        'Thưởng giới thiệu bạn bè', a.user_id,
        jsonb_build_array(
          jsonb_build_object('account_id', v_prof.referred_by, 'coin_kind', 'BONUS', 'amount', (cfg->>'refBonusInviter')::numeric),
          jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -(cfg->>'refBonusInviter')::numeric)));
    end if;
  end if;

  return jsonb_build_object('earned_xu', v_xu, 'earned_xp', v_xp);
end $$;

-- Trigger cũ tự cộng Xu cả khi validation_status IS NULL (client tự chèn bài chạy được) → chỉ khi APPROVED
create or replace function public.trigger_auto_reward_on_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform private.reward_activity(new.id);
  return new;
end $$;

drop trigger if exists trg_auto_reward on public.activities;
create trigger trg_auto_reward
  after insert or update of validation_status on public.activities
  for each row when (new.validation_status = 'APPROVED')
  execute function public.trigger_auto_reward_on_activity();
