-- =====================================================================
-- 20261001000700 — KINH TẾ XU & ĐIỀU PHỐI CỦA ADMIN (ADR-014)
--
--   * Chính sách một chỗ (economy_global_config): giá trị tham chiếu 1 Xu ≈ xuVnd đồng,
--     thưởng chạy "1 km đầu + mỗi km tiếp theo", trần ngày, biểu phí thử thách theo số người
--   * Phí tạo thử thách: ≤ 5 người miễn phí · 6–10 người 3 Xu/người · trên 10 người 5 Xu/người
--     (mặc định; admin sửa được). Thử thách CLB cũng trả phí — trừ vào QUỸ CLB
--   * Vé tạo thử thách miễn phí (challenge_passes) admin tặng cho cá nhân hoặc CLB
--   * Admin: tìm tài khoản, cộng/trừ Xu cho cá nhân hoặc quỹ CLB (bắt buộc lý do, có nhật ký,
--     báo cho người nhận), tặng/thu hồi vé, xem tổng quan dòng Xu
-- Idempotent: chạy lại nhiều lần không lỗi.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Chính sách mặc định (giá trị admin đã lưu sẽ ghi đè từng khóa)
-- ---------------------------------------------------------------------
create or replace function private.economy_config() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'xuVnd', 1000,
           'firstKmXu', 1, 'extraKmXu', 0.2, 'maxDailyReward', 10, 'kmRate', 1,
           'xpPerKm', 10, 'minValidPace', 3.0, 'maxValidPace', 15.0,
           'refBonusInviter', 100, 'refBonusReferee', 50, 'refMinKmRequired', 3.0,
           'challengeFee', jsonb_build_object('freeMaxSlots', 5, 'midMaxSlots', 10, 'midRatePerSlot', 3, 'ratePerSlot', 5))
         || coalesce((select config_value - 'tiers' from public.system_config_versions
                       where config_key = 'economy_global_config' and status = 'PUBLISHED'
                       order by version desc limit 1), '{}'::jsonb)
$$;

-- Phí tạo thử thách theo số người tối đa (giữ chữ ký cũ để các hàm khác không phải đổi)
create or replace function private.challenge_creation_fee(p_team boolean, p_max_slots integer, p_start timestamptz, p_end timestamptz)
returns integer language plpgsql stable security definer set search_path = public as $$
declare
  f jsonb := coalesce(private.economy_config()->'challengeFee', '{}'::jsonb);
  v_free integer := coalesce((f->>'freeMaxSlots')::int, 5);
  v_mid integer := coalesce((f->>'midMaxSlots')::int, 10);
  v_mid_rate numeric := coalesce((f->>'midRatePerSlot')::numeric, 3);
  v_rate numeric := coalesce((f->>'ratePerSlot')::numeric, 5);
  n integer := greatest(coalesce(p_max_slots, 1), 1);
begin
  if n <= v_free then return 0; end if;
  if n <= v_mid then return ceil(n * v_mid_rate)::int; end if;
  return ceil(n * v_rate)::int;
end $$;

-- ---------------------------------------------------------------------
-- 2. Vé tạo thử thách miễn phí
-- ---------------------------------------------------------------------
create table if not exists public.challenge_passes (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null check (owner_type in ('USER', 'CLUB')),
  owner_id uuid not null,
  max_slots integer not null check (max_slots between 1 and 10000),
  total integer not null check (total between 1 and 100),
  remaining integer not null check (remaining between 0 and total),
  expires_at timestamptz,
  note text check (note is null or char_length(note) <= 200),
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists challenge_passes_owner_idx on public.challenge_passes (owner_id) where remaining > 0;
alter table public.challenges add column if not exists pass_id uuid references public.challenge_passes(id) on delete set null;

alter table public.challenge_passes enable row level security;
revoke all on public.challenge_passes from anon, authenticated;
grant select on public.challenge_passes to authenticated;
drop policy if exists challenge_passes_select on public.challenge_passes;
create policy challenge_passes_select on public.challenge_passes for select to authenticated
  using (owner_id = auth.uid() or (owner_type = 'CLUB' and public.club_is_member(owner_id)) or public.is_system_admin());

-- ---------------------------------------------------------------------
-- 3. Thưởng bài chạy theo chính sách mới + tạo thử thách có phí cho cả CLB và vé miễn phí
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
  select * from public.activities where id = p_activity_id for update
    into a;
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
  select coalesce(sum(earned_xu), 0)
    from public.activities
   where user_id = a.user_id and rewarded_at is not null
     and started_at >= v_day_start and started_at < v_day_start + interval '1 day'
    into v_today_xu;
  -- 1 km đầu = firstKmXu, mỗi km tiếp theo = extraKmXu (Module 3 · FR21); bài dưới 1 km không có Xu
  v_xu := round(least(
            case when v_km >= 1 then (cfg->>'firstKmXu')::numeric + (v_km - 1) * (cfg->>'extraKmXu')::numeric else 0 end,
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

  -- Tiến độ thử thách: do trigger trg_challenge_progress xử lý (migration 000600)

  update public.activities
     set rewarded_at = now(), earned_xu = v_xu, earned_xp = v_xp, status = 'COMPLETED', updated_at = now()
   where id = a.id;

  -- Thưởng người giới thiệu khi bạn mới chạy đủ số km tối thiểu (chống tạo tài khoản ảo)
  select id, referred_by from public.profiles where id = a.user_id
    into v_prof;
  if v_prof.referred_by is not null then
    select coalesce(sum(coalesce(nullif(moving_distance_m, 0), distance_m, 0)), 0) / 1000.0
      from public.activities where user_id = a.user_id and rewarded_at is not null
    into v_total_km;
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

create or replace function public.create_challenge_v2(p jsonb, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := private.require_uid();
  v_key text := 'challenge_create:' || v_uid || ':' || coalesce(p_idempotency_key, '');
  v_existing uuid;
  v_title text := trim(coalesce(p->>'title', ''));
  v_desc text := nullif(trim(coalesce(p->>'description', '')), '');
  v_format text := coalesce(p->>'format', 'RANKED');
  v_objective text := coalesce(p->>'objective', 'DISTANCE');
  v_mode text := p->>'game_mode';
  v_target numeric := coalesce((p->>'target_value')::numeric, 0);
  v_min_km numeric := coalesce((p->>'min_km')::numeric, 0);
  v_min_pace numeric := coalesce((p->>'min_pace')::numeric, 3);
  v_max_pace numeric := coalesce((p->>'max_pace')::numeric, 15);
  v_cap numeric := nullif((p->>'daily_cap_km')::numeric, 0);
  v_start timestamptz := (p->>'start_date')::timestamptz;
  v_end timestamptz := (p->>'end_date')::timestamptz;
  v_slots integer := coalesce((p->>'max_slots')::int, 100);
  v_audience text := coalesce(p->>'audience', 'PUBLIC');
  v_club uuid := (p->>'club_id')::uuid;
  v_team_size integer := greatest(coalesce((p->>'team_size')::int, 0), 0);
  v_reward numeric := round(coalesce((p->>'reward_xu')::numeric, 0), 1);
  v_source text := coalesce(p->>'reward_source', 'NONE');
  v_split text := coalesce(p->>'reward_split', 'WINNER');
  v_teams text[];
  v_fee integer := 0;
  v_id uuid;
  v_code text;
  v_club_name text;
  i integer;
  m record;
  v_colors text[] := array['#b6ff3b', '#38bdf8', '#f472b6', '#fb923c', '#a78bfa', '#facc15', '#34d399', '#f87171'];
  v_payer uuid;
  v_pass uuid;
  v_fee_waived integer := 0;
  v_need_user numeric;
  v_need_club numeric;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  select campaign_id from public.ledger_transactions where idempotency_key = v_key
    into v_existing;
  if found then
    return jsonb_build_object('challenge_id', v_existing, 'duplicate', true,
                              'invite_code', (select code from public.challenge_invites where challenge_id = v_existing));
  end if;

  -- Kiểm tra dữ liệu (không tin client)
  if char_length(v_title) not between 3 and 120 then raise exception 'INVALID_TITLE'; end if;
  if v_desc is not null and char_length(v_desc) > 2000 then raise exception 'DESC_TOO_LONG'; end if;
  if v_format not in ('SOLO_GOAL', 'RANKED', 'DUEL', 'TEAM', 'COLLECTIVE') then raise exception 'INVALID_FORMAT'; end if;
  if v_objective not in ('DISTANCE', 'RUNS', 'DURATION', 'STREAK_DAYS') then raise exception 'INVALID_OBJECTIVE'; end if;
  if v_start is null or v_end is null or v_end <= v_start then raise exception 'INVALID_TIME_RANGE'; end if;
  if v_end - v_start > interval '366 days' or v_end - v_start < interval '1 hour' then raise exception 'INVALID_TIME_RANGE'; end if;
  if v_end <= now() then raise exception 'INVALID_TIME_RANGE'; end if;
  if v_target < 0 or v_min_km < 0 or v_min_km > 100 or coalesce(v_cap, 0) < 0 then raise exception 'INVALID_DISTANCE'; end if;
  if v_min_pace <= 0 or v_max_pace < v_min_pace or v_max_pace > 30 then raise exception 'INVALID_PACE'; end if;
  if v_format in ('SOLO_GOAL', 'COLLECTIVE') and v_target <= 0 then raise exception 'TARGET_REQUIRED'; end if;
  if v_objective = 'STREAK_DAYS' and (v_min_km <= 0 or v_target > ceil(extract(epoch from v_end - v_start) / 86400)) then
    raise exception 'INVALID_STREAK';
  end if;
  if v_format = 'DUEL' then v_slots := 2; end if;
  if v_slots not between 1 and 10000 then raise exception 'INVALID_MAX_SLOTS'; end if;

  if v_format = 'TEAM' then
    if v_mode not in ('TEAM_SUM', 'TEAM_AVG', 'TEAM_GAP', 'LAST_MEMBER') then raise exception 'INVALID_GAME_MODE'; end if;
    select array_agg(trim(v)) from jsonb_array_elements_text(coalesce(p->'team_names', '[]'::jsonb)) as t(v)
     where trim(v) <> ''
    into v_teams;
    if coalesce(array_length(v_teams, 1), 0) not between 2 and 8 then raise exception 'INVALID_TEAMS'; end if;
    if exists (select 1 from unnest(v_teams) as t(v) where char_length(v) > 40) then raise exception 'INVALID_TEAMS'; end if;
    if v_start < now() + interval '10 minutes' then raise exception 'TEAM_START_TOO_SOON'; end if;
    if v_team_size > 0 then v_slots := least(v_slots, v_team_size * array_length(v_teams, 1)); end if;
  else
    v_mode := case v_objective when 'STREAK_DAYS' then 'STREAK' else 'ACCUMULATE' end;
  end if;

  if v_audience not in ('PUBLIC', 'CLUB_ONLY', 'INVITE_ONLY') then raise exception 'INVALID_AUDIENCE'; end if;
  if v_audience = 'CLUB_ONLY' then
    if v_club is null or not public.club_is_staff(v_club) then raise exception 'FORBIDDEN'; end if;
    select name from public.clubs where id = v_club
    into v_club_name;
  else
    v_club := null;
  end if;

  if v_reward < 0 or v_reward > 100000 then raise exception 'INVALID_AMOUNT'; end if;
  if v_reward = 0 then v_source := 'NONE'; end if;
  if v_source not in ('NONE', 'CREATOR', 'CLUB') then raise exception 'INVALID_REWARD'; end if;
  if v_source = 'CLUB' and v_club is null then raise exception 'FORBIDDEN'; end if;
  if v_split not in ('WINNER', 'TOP3', 'FINISHERS', 'TEAM') then raise exception 'INVALID_REWARD'; end if;
  v_split := case when v_format = 'TEAM' then 'TEAM'
                  when v_format in ('SOLO_GOAL', 'COLLECTIVE') then 'FINISHERS'
                  when v_format = 'DUEL' then 'WINNER'
                  when v_split in ('WINNER', 'TOP3') then v_split else 'WINNER' end;

  -- Phí khởi tạo theo số người tối đa (Admin → Chính sách). Thử thách CLB trả bằng quỹ CLB.
  v_fee := private.challenge_creation_fee(v_format = 'TEAM', v_slots, v_start, v_end);
  v_payer := coalesce(v_club, v_uid);
  -- Vé tạo miễn phí do admin tặng: dùng vé sắp hết hạn trước, vé nhỏ nhất đủ số người
  if v_fee > 0 then
    select id from public.challenge_passes
     where owner_id = v_payer and remaining > 0 and max_slots >= v_slots and (expires_at is null or expires_at > now())
     order by expires_at nulls last, max_slots, created_at limit 1 for update
    into v_pass;
    if v_pass is not null then v_fee_waived := v_fee; v_fee := 0; end if;
  end if;
  v_need_user := case when v_club is null then v_fee else 0 end + case when v_source = 'CREATOR' then v_reward else 0 end;
  v_need_club := case when v_club is not null then v_fee else 0 end + case when v_source = 'CLUB' then v_reward else 0 end;
  if v_need_user > private.balance(v_uid) then raise exception 'INSUFFICIENT_BALANCE'; end if;
  if v_club is not null and v_need_club > private.balance(v_club) then raise exception 'INSUFFICIENT_TREASURY'; end if;

  insert into public.challenges (
    title, description, format, objective, challenge_type, game_mode, target_type, target_value, target_km,
    min_km, min_pace, max_pace, daily_cap_km, fixed_team_size, min_members, target_audience, target_club_id,
    creator_role, start_date, end_date, reg_deadline, max_slots, calculated_fee, fee_charged,
    reward_xu, reward_source, reward_split, status, created_by)
  values (
    v_title, v_desc, v_format, v_objective, case when v_format = 'TEAM' then 'TEAM' else 'INDIVIDUAL' end, v_mode,
    v_objective, v_target, case when v_objective = 'DISTANCE' then v_target else 0 end,
    v_min_km, v_min_pace, v_max_pace, v_cap, v_team_size, 1, v_audience, v_club,
    case when v_club is not null then 'CLUB' else 'MEMBER' end, v_start, v_end,
    case when v_format in ('TEAM') then v_start else v_end end, v_slots, v_fee, v_fee,
    v_reward, v_source, v_split, 'ACTIVE', v_uid)
  returning id into v_id;

  -- Phí + dấu idempotency (cùng khóa → trả lại thử thách này)
  if v_fee > 0 then
    perform private.ledger_post('CHALLENGE_CREATION_FEE', v_key,
      case when v_club is not null then 'Phí tạo thử thách (quỹ CLB)' else 'Phí khởi tạo thử thách' end, v_uid,
      private.debit_entries(v_payer, v_fee, private.system_account()), v_id);
    if v_club is not null then
      insert into public.club_treasury_log (club_id, user_id, amount, kind, note)
      values (v_club, v_uid, -v_fee, 'SPEND', left('Phí tạo thử thách: ' || v_title, 200));
    end if;
  else
    insert into public.ledger_transactions (type, idempotency_key, reason, created_by, campaign_id)
    values ('CHALLENGE_CREATION_FEE', v_key, 'Miễn phí', v_uid, v_id);
  end if;

  -- Ký quỹ giải thưởng (giữ ở tài khoản hệ thống tới khi tất toán)
  if v_source = 'CREATOR' then
    perform private.ledger_post('CHALLENGE_ESCROW', 'challenge_escrow:' || v_id, 'Treo thưởng thử thách', v_uid,
      private.debit_entries(v_uid, v_reward, private.system_account()), v_id);
  elsif v_source = 'CLUB' then
    perform private.ledger_post('CHALLENGE_ESCROW', 'challenge_escrow:' || v_id, 'Treo thưởng thử thách (quỹ CLB)', v_uid,
      private.debit_entries(v_club, v_reward, private.system_account()), v_id);
    insert into public.club_treasury_log (club_id, user_id, amount, kind, note)
    values (v_club, v_uid, -v_reward, 'REWARD', left('Treo thưởng: ' || v_title, 200));
  end if;

  if v_format = 'TEAM' then
    for i in 1 .. array_length(v_teams, 1) loop
      insert into public.challenge_teams (challenge_id, name, color, position)
      values (v_id, v_teams[i], v_colors[1 + (i - 1) % array_length(v_colors, 1)], i);
    end loop;
  end if;

  if v_audience <> 'PUBLIC' or v_format = 'DUEL' then
    loop
      v_code := substr(md5(gen_random_uuid()::text), 1, 8);
      exit when not exists (select 1 from public.challenge_invites where code = v_code);
    end loop;
    insert into public.challenge_invites (challenge_id, code) values (v_id, v_code);
  end if;

  -- Người tạo tự vào (trừ thử thách đội — người tạo chọn đội sau — và thử thách CLB do ban quản trị tổ chức)
  if v_format <> 'TEAM' and v_club is null then
    insert into public.challenge_participants (challenge_id, profile_id, status) values (v_id, v_uid, 'JOINED');
  end if;

  -- Thử thách nội bộ CLB: đăng lên bảng tin + báo cả CLB
  if v_club is not null then
    insert into public.club_posts (club_id, author_id, kind, title, body, meta, is_pinned)
    values (v_club, v_uid, 'CHALLENGE', v_title, coalesce(v_desc, ''),
            jsonb_build_object('challenge_id', v_id, 'format', v_format, 'objective', v_objective,
                               'target_value', v_target, 'start_date', v_start, 'end_date', v_end,
                               'reward_xu', v_reward), false);
    for m in select user_id from public.club_members where club_id = v_club and status = 'APPROVED' loop
      perform private.notify(m.user_id, v_club, 'CHALLENGE_NEW',
        'Thử thách mới trong ' || coalesce(v_club_name, 'CLB') || ': ' || v_title,
        case when v_reward > 0 then 'Giải thưởng ' || v_reward || ' Xu. Vào tham gia ngay!' else 'Vào tham gia ngay!' end,
        '/challenges/' || v_id, v_uid, true);
    end loop;
  end if;

  if v_pass is not null then
    update public.challenge_passes set remaining = remaining - 1, updated_at = now() where id = v_pass;
    update public.challenges set pass_id = v_pass where id = v_id;
  end if;

  return jsonb_build_object('challenge_id', v_id, 'fee', v_fee, 'fee_waived', v_fee_waived, 'pass_used', v_pass is not null,
                            'invite_code', v_code, 'remaining_balance', private.balance(v_uid));
end $$;

-- Báo giá trước khi tạo: phí, ai trả, số dư, có vé miễn phí dùng được không
create or replace function public.quote_challenge(p_max_slots integer, p_format text default 'RANKED', p_club_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_slots integer := case when p_format = 'DUEL' then 2 when p_format = 'SOLO_GOAL' then 1 else greatest(coalesce(p_max_slots, 1), 1) end;
  v_fee integer := private.challenge_creation_fee(p_format = 'TEAM', v_slots, now(), now() + interval '1 day');
  v_payer uuid := case when p_club_id is not null and public.club_is_staff(p_club_id) then p_club_id else v_uid end;
  v_pass record;
  f jsonb := private.economy_config();
begin
  select id, remaining, max_slots, expires_at from public.challenge_passes
   where owner_id = v_payer and remaining > 0 and max_slots >= v_slots and (expires_at is null or expires_at > now())
   order by expires_at nulls last, max_slots, created_at limit 1
    into v_pass;
  return jsonb_build_object(
    'fee', v_fee,
    'payer', case when v_payer = v_uid then 'USER' else 'CLUB' end,
    'payer_balance', private.balance(v_payer),
    'wallet_balance', private.balance(v_uid),
    'pass', case when v_pass.id is null or v_fee = 0 then null
                 else jsonb_build_object('id', v_pass.id, 'remaining', v_pass.remaining, 'max_slots', v_pass.max_slots, 'expires_at', v_pass.expires_at) end,
    'xu_vnd', (f->>'xuVnd')::numeric,
    'policy', f->'challengeFee');
end $$;

create or replace function public.preview_challenge_fee(p_format text, p_max_slots integer, p_start timestamptz, p_end timestamptz, p_club boolean)
returns integer language sql stable security definer set search_path = public as $$
  select private.challenge_creation_fee(p_format = 'TEAM',
    case when p_format = 'DUEL' then 2 when p_format = 'SOLO_GOAL' then 1 else p_max_slots end, p_start, p_end)
$$;

-- Chính sách công khai cho mọi người xem (trang "Xu là gì", màn tạo thử thách)
create or replace function public.economy_policy() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('xuVnd', c->'xuVnd', 'firstKmXu', c->'firstKmXu', 'extraKmXu', c->'extraKmXu',
                            'maxDailyReward', c->'maxDailyReward', 'challengeFee', c->'challengeFee')
    from (select private.economy_config() as c) x
$$;

create or replace function public.my_challenge_passes()
returns table (id uuid, owner_type text, owner_id uuid, owner_name text, max_slots integer, remaining integer, total integer,
               expires_at timestamptz, note text)
language sql stable security definer set search_path = public as $$
  select p.id, p.owner_type, p.owner_id,
         case when p.owner_type = 'CLUB' then (select name from public.clubs where id = p.owner_id) else 'Bạn' end,
         p.max_slots, p.remaining, p.total, p.expires_at, p.note
    from public.challenge_passes p
   where p.remaining > 0 and (p.expires_at is null or p.expires_at > now())
     and (p.owner_id = auth.uid() or (p.owner_type = 'CLUB' and public.club_is_staff(p.owner_id)))
   order by p.expires_at nulls last
$$;

-- ---------------------------------------------------------------------
-- 4. Công cụ admin
-- ---------------------------------------------------------------------
-- Tìm người dùng (tên, email, id) và CLB (tên, id) để điều phối Xu
create or replace function public.admin_search_accounts(p_query text)
returns table (kind text, id uuid, name text, subtitle text, balance numeric)
language plpgsql stable security definer set search_path = public, auth as $$
declare q text := trim(coalesce(p_query, ''));
begin
  perform private.require_admin();
  if char_length(q) < 2 then return; end if;
  return query
  (select 'USER'::text, pr.id, coalesce(pr.display_name, 'Runner'), coalesce(u.email, ''), private.balance(pr.id)
     from public.profiles pr left join auth.users u on u.id = pr.id
    where pr.display_name ilike '%' || q || '%' or u.email ilike '%' || q || '%' or pr.id::text = q
    order by pr.display_name limit 15)
  union all
  (select 'CLUB'::text, c.id, c.name, c.member_count || ' thành viên', private.balance(c.id)
     from public.clubs c
    where c.name ilike '%' || q || '%' or c.id::text = q
    order by c.member_count desc limit 10);
end $$;

-- Cộng (số dương) hoặc trừ (số âm) Xu cho một người hoặc quỹ CLB. Bắt buộc lý do; idempotent theo khóa.
create or replace function public.admin_grant_xu(
  p_target_type text, p_target_id uuid, p_amount numeric, p_coin_kind text, p_reason text, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  v_amount numeric := round(coalesce(p_amount, 0), 1);
  v_kind text := coalesce(p_coin_kind, 'BONUS');
  v_reason text := trim(coalesce(p_reason, ''));
  v_tx uuid;
  v_name text;
  s record;
begin
  if v_amount = 0 or abs(v_amount) > 1000000 then raise exception 'INVALID_AMOUNT'; end if;
  if v_kind not in ('BONUS', 'PAID') then raise exception 'INVALID_COIN_KIND'; end if;
  if char_length(v_reason) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if p_target_type = 'USER' then
    select display_name from public.profiles where id = p_target_id
    into v_name;
    if not found then raise exception 'USER_NOT_FOUND'; end if;
  elsif p_target_type = 'CLUB' then
    select name from public.clubs where id = p_target_id
    into v_name;
    if not found then raise exception 'CLUB_NOT_FOUND'; end if;
  else
    raise exception 'INVALID_TARGET';
  end if;
  -- Gửi lại cùng khóa (mạng chập chờn, bấm 2 lần): trả kết quả cũ, không báo / ghi nhật ký lần 2
  select id from public.ledger_transactions where idempotency_key = 'admin_grant:' || p_idempotency_key
    into v_tx;
  if found then
    return jsonb_build_object('transaction_id', v_tx, 'balance', private.balance(p_target_id), 'duplicate', true);
  end if;

  -- Trừ: không cho số dư âm (ledger_post tự chặn)
  v_tx := private.ledger_post(case when v_amount > 0 then 'ADMIN_GRANT' else 'ADMIN_DEDUCT' end,
    'admin_grant:' || p_idempotency_key, v_reason, v_admin,
    jsonb_build_array(
      jsonb_build_object('account_id', p_target_id, 'coin_kind', v_kind, 'amount', v_amount),
      jsonb_build_object('account_id', private.system_account(), 'coin_kind', v_kind, 'amount', -v_amount)),
    case when p_target_type = 'CLUB' then p_target_id end);
  update public.ledger_transactions set approved_by = v_admin where id = v_tx;

  if p_target_type = 'CLUB' then
    insert into public.club_treasury_log (club_id, user_id, amount, kind, note)
    values (p_target_id, v_admin, v_amount, case when v_amount > 0 then 'CONTRIBUTE' else 'SPEND' end,
            left(case when v_amount > 0 then 'RaceHub tặng: ' else 'RaceHub điều chỉnh: ' end || v_reason, 200));
    for s in select user_id from public.club_members where club_id = p_target_id and status = 'APPROVED' and role in ('OWNER', 'CAPTAIN') loop
      perform private.notify(s.user_id, p_target_id, 'ADMIN_XU',
        case when v_amount > 0 then 'Quỹ ' || v_name || ' được RaceHub tặng ' || v_amount || ' Xu'
             else 'Quỹ ' || v_name || ' được điều chỉnh ' || v_amount || ' Xu' end,
        v_reason, '/clubs/' || p_target_id || '/treasury', null, true);
    end loop;
  else
    perform private.notify(p_target_id, null, 'ADMIN_XU',
      case when v_amount > 0 then 'RaceHub tặng bạn ' || v_amount || ' Xu' else 'Ví của bạn được điều chỉnh ' || v_amount || ' Xu' end,
      v_reason, '/me', null, true);
  end if;

  insert into public.admin_audit_log (actor_id, action, target, new_value, reason)
  values (v_admin, 'ADMIN_GRANT_XU', p_target_type || ':' || p_target_id,
          jsonb_build_object('amount', v_amount, 'coin_kind', v_kind, 'tx', v_tx, 'name', v_name), v_reason);
  return jsonb_build_object('transaction_id', v_tx, 'balance', private.balance(p_target_id));
end $$;

-- Tặng vé tạo thử thách miễn phí
create or replace function public.admin_grant_challenge_pass(
  p_target_type text, p_target_id uuid, p_quantity integer, p_max_slots integer, p_expires_at timestamptz, p_note text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_admin uuid := private.require_admin(); v_id uuid; v_name text; s record;
begin
  if coalesce(p_quantity, 0) not between 1 and 100 then raise exception 'INVALID_AMOUNT'; end if;
  if coalesce(p_max_slots, 0) not between 1 and 10000 then raise exception 'INVALID_MAX_SLOTS'; end if;
  if p_expires_at is not null and p_expires_at <= now() then raise exception 'INVALID_TIME_RANGE'; end if;
  if p_target_type = 'USER' then
    select display_name from public.profiles where id = p_target_id
    into v_name;
    if not found then raise exception 'USER_NOT_FOUND'; end if;
  elsif p_target_type = 'CLUB' then
    select name from public.clubs where id = p_target_id
    into v_name;
    if not found then raise exception 'CLUB_NOT_FOUND'; end if;
  else
    raise exception 'INVALID_TARGET';
  end if;

  insert into public.challenge_passes (owner_type, owner_id, max_slots, total, remaining, expires_at, note, granted_by)
  values (p_target_type, p_target_id, p_max_slots, p_quantity, p_quantity, p_expires_at, nullif(trim(coalesce(p_note, '')), ''), v_admin)
  returning id into v_id;

  if p_target_type = 'CLUB' then
    for s in select user_id from public.club_members where club_id = p_target_id and status = 'APPROVED' and role in ('OWNER', 'CAPTAIN') loop
      perform private.notify(s.user_id, p_target_id, 'ADMIN_PASS',
        v_name || ' nhận ' || p_quantity || ' vé tạo thử thách miễn phí',
        'Mỗi vé dùng cho thử thách tối đa ' || p_max_slots || ' người', '/challenges/new?club=' || p_target_id, null, true);
    end loop;
  else
    perform private.notify(p_target_id, null, 'ADMIN_PASS', 'Bạn nhận ' || p_quantity || ' vé tạo thử thách miễn phí',
      'Mỗi vé dùng cho thử thách tối đa ' || p_max_slots || ' người', '/challenges/new', null, true);
  end if;

  insert into public.admin_audit_log (actor_id, action, target, new_value, reason)
  values (v_admin, 'GRANT_CHALLENGE_PASS', p_target_type || ':' || p_target_id,
          jsonb_build_object('pass_id', v_id, 'quantity', p_quantity, 'max_slots', p_max_slots, 'expires_at', p_expires_at, 'name', v_name), p_note);
  return v_id;
end $$;

create or replace function public.admin_revoke_challenge_pass(p_pass_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_admin uuid := private.require_admin(); p public.challenge_passes;
begin
  if char_length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'REASON_REQUIRED'; end if;
  update public.challenge_passes set remaining = 0, updated_at = now() where id = p_pass_id returning * into p;
  if not found then raise exception 'PASS_NOT_FOUND'; end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value, reason)
  values (v_admin, 'REVOKE_CHALLENGE_PASS', p.owner_type || ':' || p.owner_id, jsonb_build_object('pass_id', p.id), trim(p_reason));
end $$;

create or replace function public.admin_list_passes()
returns table (id uuid, owner_type text, owner_id uuid, owner_name text, max_slots integer, remaining integer, total integer,
               expires_at timestamptz, note text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return query
  select p.id, p.owner_type, p.owner_id,
         case when p.owner_type = 'CLUB' then (select c.name from public.clubs c where c.id = p.owner_id)
              else (select pr.display_name from public.profiles pr where pr.id = p.owner_id) end,
         p.max_slots, p.remaining, p.total, p.expires_at, p.note, p.created_at
    from public.challenge_passes p
   order by (p.remaining > 0 and (p.expires_at is null or p.expires_at > now())) desc, p.created_at desc
   limit 200;
end $$;

-- Tổng quan dòng Xu (30 ngày) + nhật ký điều phối gần nhất
create or replace function public.admin_economy_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform private.require_admin();
  v := jsonb_build_object(
    'policy', private.economy_config(),
    'wallets', (select coalesce(sum(e.amount), 0) from public.ledger_entries e join public.profiles p on p.id = e.account_id),
    'treasuries', (select coalesce(sum(e.amount), 0) from public.ledger_entries e join public.clubs c on c.id = e.account_id),
    'escrow', (select coalesce(sum(reward_xu), 0) from public.challenges where status = 'ACTIVE' and reward_source <> 'NONE'),
    'minted_30d', (select coalesce(sum(e.amount), 0) from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
                    where t.type = 'RUN_REWARD' and e.amount > 0 and t.created_at > now() - interval '30 days'),
    'granted_30d', (select coalesce(sum(e.amount), 0) from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
                     where t.type in ('ADMIN_GRANT', 'ADMIN_ADJUST', 'CLUB_FUND_TOPUP') and e.amount > 0
                       and e.account_id <> private.system_account() and t.created_at > now() - interval '30 days'),
    'fees_30d', (select coalesce(sum(e.amount), 0) from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
                  where t.type = 'CHALLENGE_CREATION_FEE' and e.account_id = private.system_account() and t.created_at > now() - interval '30 days'),
    'active_passes', (select coalesce(sum(remaining), 0) from public.challenge_passes where remaining > 0 and (expires_at is null or expires_at > now())),
    'recent', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
                 select l.id, l.action, l.target, l.new_value, l.reason, l.created_at, private.display_name(l.actor_id) as actor
                   from public.admin_audit_log l
                  where l.action in ('ADMIN_GRANT_XU', 'ADJUST_USER_XU', 'TOPUP_CLUB_FUND', 'GRANT_CHALLENGE_PASS', 'REVOKE_CHALLENGE_PASS', 'PUBLISH_CONFIG')
                  order by l.created_at desc limit 30) x)
  );
  return v;
end $$;

-- Lưu chính sách: kiểm tra đủ các khóa mới
create or replace function public.admin_publish_config(p_config_key text, p_config_value jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare v_admin uuid := private.require_admin(); v_next integer; v_old jsonb; f jsonb := p_config_value->'challengeFee';
begin
  if p_config_key not in ('economy_global_config', 'challenge_fee_model_b') then raise exception 'UNSUPPORTED_CONFIG_KEY'; end if;
  if jsonb_typeof(p_config_value) <> 'object' then raise exception 'INVALID_CONFIG'; end if;
  if p_config_key = 'economy_global_config' and (
       coalesce((p_config_value->>'kmRate')::numeric, 0) not between 0 and 100 or
       coalesce((p_config_value->>'firstKmXu')::numeric, 0) not between 0 and 100 or
       coalesce((p_config_value->>'extraKmXu')::numeric, 0) not between 0 and 100 or
       coalesce((p_config_value->>'maxDailyReward')::numeric, 0) not between 0 and 10000 or
       coalesce((p_config_value->>'xuVnd')::numeric, 1000) not between 1 and 1000000 or
       coalesce((p_config_value->>'minValidPace')::numeric, 3) <= 0 or
       coalesce((p_config_value->>'maxValidPace')::numeric, 15) < coalesce((p_config_value->>'minValidPace')::numeric, 3) or
       (f is not null and (
          coalesce((f->>'freeMaxSlots')::int, 0) < 0 or
          coalesce((f->>'midMaxSlots')::int, 0) < coalesce((f->>'freeMaxSlots')::int, 0) or
          coalesce((f->>'midRatePerSlot')::numeric, 0) < 0 or coalesce((f->>'ratePerSlot')::numeric, 0) < 0))) then
    raise exception 'INVALID_CONFIG';
  end if;

  perform pg_advisory_xact_lock(hashtext('config:' || p_config_key));
  select config_value from public.system_config_versions
   where config_key = p_config_key and status = 'PUBLISHED' order by version desc limit 1
    into v_old;
  select coalesce(max(version), 0) + 1 from public.system_config_versions where config_key = p_config_key
    into v_next;
  update public.system_config_versions set status = 'ARCHIVED' where config_key = p_config_key and status = 'PUBLISHED';
  insert into public.system_config_versions (config_key, version, status, config_value, created_by)
  values (p_config_key, v_next, 'PUBLISHED', p_config_value, v_admin);
  insert into public.admin_audit_log (actor_id, action, target, old_value, new_value)
  values (v_admin, 'PUBLISH_CONFIG', p_config_key || ' v' || v_next, v_old, p_config_value);
  return v_next;
end $$;

-- ---------------------------------------------------------------------
-- 5. Quyền thực thi
-- ---------------------------------------------------------------------
revoke all on function public.quote_challenge(integer, text, uuid), public.economy_policy(), public.my_challenge_passes(),
  public.admin_search_accounts(text), public.admin_grant_xu(text, uuid, numeric, text, text, text),
  public.admin_grant_challenge_pass(text, uuid, integer, integer, timestamptz, text),
  public.admin_revoke_challenge_pass(uuid, text), public.admin_list_passes(), public.admin_economy_overview(),
  public.admin_publish_config(text, jsonb), public.preview_challenge_fee(text, integer, timestamptz, timestamptz, boolean)
  from public, anon;
grant execute on function public.quote_challenge(integer, text, uuid), public.economy_policy(), public.my_challenge_passes(),
  public.admin_search_accounts(text), public.admin_grant_xu(text, uuid, numeric, text, text, text),
  public.admin_grant_challenge_pass(text, uuid, integer, integer, timestamptz, text),
  public.admin_revoke_challenge_pass(uuid, text), public.admin_list_passes(), public.admin_economy_overview(),
  public.admin_publish_config(text, jsonb), public.preview_challenge_fee(text, integer, timestamptz, timestamptz, boolean)
  to authenticated;
revoke all on function private.economy_config(), private.challenge_creation_fee(boolean, integer, timestamptz, timestamptz),
  private.reward_activity(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
