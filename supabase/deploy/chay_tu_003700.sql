-- RaceHub: gộp 33 migration (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Cách chạy: Supabase → SQL Editor → New query → dán TOÀN BỘ file → Run.
-- Chạy trong một giao dịch: lỗi ở bất kỳ đâu thì không có gì thay đổi. Chạy lại nhiều lần vẫn an toàn.
-- Gồm: 003700, 003800, 003900, 004000, 004100, 004200, 004300, 004400, 004500, 004600, 004700, 004800, 004900, 005000, 005100, 005200, 005300, 005400, 005500, 005600, 005700, 005800, 005900, 006000, 006100, 006200, 006300, 006400, 006500, 006600, 006700, 006800, 003500
begin;
-- ===================================================================
-- 20261001003700_economy_v2.sql
-- ===================================================================
-- 003700: Kinh tế RaceHub v2 (đặc tả Economy Baseline v1.1).
-- • 1 Xu = 100đ (quy ước, không đổi ra tiền mặt). Chuyển đổi một lần: số dư mọi ví ×10, giá đồ ×10, thưởng treo ×10
--   → không ai mất giá trị. Có ghi sổ cái (RATE_CONVERSION).
-- • Xu chạy bộ tính theo tổng km trong NGÀY (giờ VN): km 1–2 = 0, km 3–10 = 2 Xu/km, km 11–20 = 1 Xu/km, >20 = 0,
--   trần 20 Xu/ngày; km lẻ tính theo tỷ lệ (3,5 km → 3 Xu).
-- • Điểm danh +1 Xu/ngày CHỈ khi có bài chạy hợp lệ (≥ 1 km) — không thưởng mở app / like / comment.
-- • Chuỗi tuần (đạt mục tiêu số ngày chạy / tuần): mốc 2 / 4 / 8 tuần liên tiếp → +10 / +20 / +50 Xu.
-- • XP CHỈ từ km chạy (10 XP/km). Nhiệm vụ, league, huy hiệu, cổ vũ không còn cho XP / Xu.
-- • 8 cấp độ (Tân Binh → Đỉnh Cao RaceHub); một số cấp thưởng Xu một lần.
-- • Giới thiệu bạn: chỉ thưởng khi bạn mới đã xác thực + chạy đủ 3 km; người mời 20 Xu (tối đa 10 người / tháng),
--   người mới 10 Xu.
-- • Phí tạo thử thách theo QUY MÔ (capacity), không theo thời gian: ≤5 miễn phí · ≤20: 150 · ≤50: 400 · ≤100: 800 ·
--   ≤200: 1.500 · ≤500: 3.500 · ≤1.000: 7.000 Xu (>1.000: admin cấp riêng).
-- • Không còn thưởng Xu do NGƯỜI DÙNG treo (chống chuyển Xu P2P trá hình); thưởng từ quỹ CLB vẫn được.
-- Mọi con số nằm trong cấu hình economy_global_config — admin sửa ở Quản trị → Chính sách, không phải sửa code.
-- Cần các file đến 003600. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 0. Cấu hình mặc định v2 (giá trị admin đã xuất bản ghi đè từng khóa)
-- ---------------------------------------------------------------------
create or replace function private.economy_defaults_v2() returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'econVersion', 2,
    'xuVnd', 100,
    'xpPerKm', 10,
    'minValidPace', 3.0, 'maxValidPace', 15.0,
    'run', jsonb_build_object('freeKm', 2, 'dailyCap', 20,
             'tiers', jsonb_build_array(jsonb_build_object('upToKm', 10, 'rate', 2), jsonb_build_object('upToKm', 20, 'rate', 1))),
    'checkinXu', 1, 'checkinMinKm', 1,
    'giftDailyCapXu', 20000,
    'streakRewards', jsonb_build_array(jsonb_build_object('weeks', 2, 'xu', 10), jsonb_build_object('weeks', 4, 'xu', 20),
                                       jsonb_build_object('weeks', 8, 'xu', 50)),
    'referral', jsonb_build_object('inviterXu', 20, 'refereeXu', 10, 'monthlyCap', 10, 'minKm', 3),
    'comeback', jsonb_build_object('minRestDays', 28, 'xu', 10, 'cooldownDays', 90),
    'levelUpXu', jsonb_build_object('2', 20, '3', 50, '4', 100, '5', 200, '6', 300, '7', 500, '8', 1000),
    'capacityTiers', jsonb_build_array(
       jsonb_build_object('max', 5, 'xu', 0), jsonb_build_object('max', 20, 'xu', 150), jsonb_build_object('max', 50, 'xu', 400),
       jsonb_build_object('max', 100, 'xu', 800), jsonb_build_object('max', 200, 'xu', 1500), jsonb_build_object('max', 500, 'xu', 3500),
       jsonb_build_object('max', 1000, 'xu', 7000)),
    'game', jsonb_build_object('shieldPrice', 200, 'maxShields', 2, 'defaultWeeklyGoal', 3, 'streakWeekXp', 0,
       'cheerXp', 0, 'leagueSize', 30, 'leagueRewardXu', jsonb_build_array(0, 0, 0), 'leagueRewardXp', jsonb_build_array(0, 0, 0)))
$$;

create or replace function private.economy_config() returns jsonb
language sql stable security definer set search_path = public as $$
  select private.economy_defaults_v2()
         || coalesce((select v.config_value - 'tiers' from (
                        select x.config_value, row_number() over (order by x.version desc) as rn
                          from public.system_config_versions x
                         where x.config_key = 'economy_global_config' and x.status = 'PUBLISHED') v
                       where v.rn = 1 and (v.config_value->>'econVersion')::int >= 2), '{}'::jsonb)
$$;

-- Cấu hình game (khiên, league…) lấy từ khóa "game" của cấu hình kinh tế
create or replace function private.game_config() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('cheerDailyCap', 50, 'cheerMaxPerDay', 30)
         || (private.economy_defaults_v2()->'game')
         || coalesce(private.economy_config()->'game', '{}'::jsonb)
$$;

-- ---------------------------------------------------------------------
-- 1. Cấp độ 1–8
-- ---------------------------------------------------------------------
create or replace function private.level_for_xp(p_xp numeric) returns integer
language sql immutable as $$
  select case when p_xp >= 200000 then 8 when p_xp >= 120000 then 7 when p_xp >= 70000 then 6 when p_xp >= 35000 then 5
              when p_xp >= 15000 then 4 when p_xp >= 5000 then 3 when p_xp >= 1000 then 2 else 1 end
$$;

create or replace function private.level_name(p_level integer) returns text
language sql immutable as $$
  select case p_level when 1 then 'Tân Binh' when 2 then 'Runner Triển Vọng' when 3 then 'Chân Chạy Kiên Trì'
                      when 4 then 'Chiến Binh Đường Nhựa' when 5 then 'Cao Thủ Sức Bền' when 6 then 'Quái Vật Cự Ly'
                      when 7 then 'Huyền Thoại' else 'Đỉnh Cao RaceHub' end
$$;

update public.profiles set level = private.level_for_xp(coalesce(xp, 0)) where level is distinct from private.level_for_xp(coalesce(xp, 0));

-- Loại sự kiện thưởng mới
alter table public.game_events drop constraint if exists game_events_kind_check;
alter table public.game_events add constraint game_events_kind_check
  check (kind in ('RUN', 'QUEST', 'BADGE', 'STREAK', 'LEVEL_UP', 'LEAGUE', 'CHEER_IN', 'CHECKIN', 'REFERRAL', 'GIFT_IN', 'COMEBACK'));

-- Lên cấp: thông báo + Xu một lần theo cấu hình levelUpXu
create or replace function private.level_up_event(p_user uuid, p_level integer, p_activity uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_xu numeric := coalesce((private.economy_config()->'levelUpXu'->>p_level::text)::numeric, 0); v_rows integer;
begin
  insert into public.game_events (user_id, kind, title, subtitle, xu, activity_id, payload, dedupe_key)
  values (p_user, 'LEVEL_UP', 'Lên cấp ' || p_level || ': ' || private.level_name(p_level),
          case when v_xu > 0 then 'Thưởng ' || trim_scale(v_xu) || ' Xu · mở khóa danh hiệu và vật phẩm mới' else 'Mở khóa danh hiệu và vật phẩm mới' end,
          v_xu, p_activity, jsonb_build_object('level', p_level), 'level:' || p_user || ':' || p_level)
  on conflict (dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return; end if;
  if v_xu > 0 then
    perform private.ledger_post('LEVEL_UP_XU', 'level_xu:' || p_user || ':' || p_level, 'Thưởng lên cấp ' || p_level, p_user,
      jsonb_build_array(jsonb_build_object('account_id', p_user, 'coin_kind', 'BONUS', 'amount', v_xu),
                        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -v_xu)), p_activity);
  end if;
  perform private.notify(p_user, null, 'LEVEL_UP', 'Chúc mừng! Bạn lên cấp ' || p_level,
    private.level_name(p_level) || case when v_xu > 0 then ' · +' || trim_scale(v_xu) || ' Xu' else '' end, '/me', null, true);
end $$;

-- ---------------------------------------------------------------------
-- 2. Xu chạy bộ: bậc thang theo tổng km trong ngày
-- ---------------------------------------------------------------------
create or replace function private.run_xu_for_km(p_km numeric, p_run jsonb) returns numeric
language plpgsql immutable as $$
declare t record; v_lower numeric := coalesce((p_run->>'freeKm')::numeric, 2); v_acc numeric := 0; v_km numeric := greatest(coalesce(p_km, 0), 0);
begin
  for t in select (e->>'upToKm')::numeric as up, (e->>'rate')::numeric as rate
             from jsonb_array_elements(coalesce(p_run->'tiers', '[]'::jsonb)) e order by (e->>'upToKm')::numeric loop
    if t.up > v_lower then
      v_acc := v_acc + greatest(least(v_km, t.up) - v_lower, 0) * t.rate;
      v_lower := t.up;
    end if;
  end loop;
  return v_acc;
end $$;

create or replace function private.reward_activity(p_activity_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  a public.activities := (select x from public.activities x where x.id = p_activity_id for update);
  cfg jsonb := private.economy_config();
  v_km numeric;
  v_prev_km numeric;
  v_today_xu numeric;
  v_xu numeric := 0;
  v_xp integer := 0;
  v_day date;
  v_start timestamptz;
begin
  if a.id is null or a.rewarded_at is not null or a.user_id is null then
    return jsonb_build_object('earned_xu', coalesce(a.earned_xu, 0), 'earned_xp', coalesce(a.earned_xp, 0));
  end if;
  if not public.activity_is_countable(a.status, a.validation_status) or coalesce(a.validation_status, '') <> 'APPROVED' then
    return jsonb_build_object('earned_xu', 0, 'earned_xp', 0);
  end if;

  v_km := greatest(coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0), 0) / 1000.0;
  v_day := private.vn_day(coalesce(a.started_at, now()));
  v_start := private.vn_start(v_day);
  v_prev_km := coalesce((select sum(greatest(coalesce(nullif(x.moving_distance_m, 0), x.distance_m, 0), 0)) / 1000.0
                           from public.activities x
                          where x.user_id = a.user_id and x.id <> a.id and x.rewarded_at is not null and x.validation_status = 'APPROVED'
                            and coalesce(x.status, '') <> 'DELETED' and x.started_at >= v_start and x.started_at < v_start + interval '1 day'), 0);
  v_today_xu := coalesce((select sum(x.earned_xu) from public.activities x
                          where x.user_id = a.user_id and x.id <> a.id and x.rewarded_at is not null
                            and x.started_at >= v_start and x.started_at < v_start + interval '1 day'), 0);
  v_xu := private.run_xu_for_km(v_prev_km + v_km, cfg->'run') - private.run_xu_for_km(v_prev_km, cfg->'run');
  v_xu := round(greatest(least(v_xu, coalesce((cfg->'run'->>'dailyCap')::numeric, 20) - v_today_xu), 0), 1);
  v_xp := round(v_km * coalesce((cfg->>'xpPerKm')::numeric, 10));

  if v_xu > 0 then
    perform private.ledger_post('RUN_REWARD', 'run_reward:' || a.id, 'Thưởng bài chạy', a.user_id,
      jsonb_build_array(jsonb_build_object('account_id', a.user_id, 'coin_kind', 'BONUS', 'amount', v_xu),
                        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -v_xu)), a.id);
  end if;
  update public.profiles set xp = coalesce(xp, 0) + v_xp, level = private.level_for_xp(coalesce(xp, 0) + v_xp) where id = a.user_id;
  update public.activities set rewarded_at = now(), earned_xu = v_xu, earned_xp = v_xp, status = 'COMPLETED', updated_at = now()
   where id = a.id;

  -- Điểm danh: bài chạy hợp lệ đầu tiên trong ngày (đủ km tối thiểu) → +checkinXu
  if v_km >= coalesce((cfg->>'checkinMinKm')::numeric, 1) and coalesce((cfg->>'checkinXu')::numeric, 0) > 0 then
    perform private.award(a.user_id, 'CHECKIN', 'Điểm danh ngày ' || to_char(v_day, 'DD/MM'), 'Có bài chạy hợp lệ hôm nay',
      (cfg->>'checkinXu')::numeric, 0, 'checkin:' || a.user_id || ':' || v_day, a.id, jsonb_build_object('day', v_day));
    perform private.quest_progress(a.user_id, 'CHECKIN', 1, 'SET', coalesce(a.started_at, now()), a.id);
  end if;

  perform private.referral_on_run(a.user_id);
  return jsonb_build_object('earned_xu', v_xu, 'earned_xp', v_xp);
end $$;

-- ---------------------------------------------------------------------
-- 3. Giới thiệu bạn: thưởng khi bạn mới xác thực + chạy đủ km; người mời tối đa N người / tháng
-- ---------------------------------------------------------------------
create or replace function private.referral_on_run(p_user uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  cfg jsonb := private.economy_config()->'referral';
  v_inviter uuid := (select p.referred_by from public.profiles p where p.id = p_user);
  v_km numeric;
  v_month timestamptz := date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh';
  v_count integer;
begin
  if v_inviter is null then return; end if;
  if not exists (select 1 from auth.users u where u.id = p_user and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)) then return; end if;
  v_km := coalesce((select sum(greatest(coalesce(nullif(x.moving_distance_m, 0), x.distance_m, 0), 0)) / 1000.0 from public.activities x
                     where x.user_id = p_user and x.rewarded_at is not null and x.validation_status = 'APPROVED' and coalesce(x.status, '') <> 'DELETED'), 0);
  if v_km < coalesce((cfg->>'minKm')::numeric, 3) then return; end if;

  if coalesce((cfg->>'refereeXu')::numeric, 0) > 0 then
    perform private.ledger_post('REFERRAL_REFEREE', 'referral_referee:' || p_user, 'Thưởng chào mừng qua lời mời', p_user,
      jsonb_build_array(jsonb_build_object('account_id', p_user, 'coin_kind', 'BONUS', 'amount', (cfg->>'refereeXu')::numeric),
                        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -(cfg->>'refereeXu')::numeric)));
  end if;
  if coalesce((cfg->>'inviterXu')::numeric, 0) > 0
     and not exists (select 1 from public.ledger_transactions t where t.idempotency_key = 'referral_inviter:' || p_user) then
    v_count := (select count(*) from public.ledger_transactions t join public.ledger_entries e on e.transaction_id = t.id
                 where t.type = 'REFERRAL_INVITER' and e.account_id = v_inviter and e.amount > 0 and t.created_at >= v_month);
    if v_count < coalesce((cfg->>'monthlyCap')::int, 10) then
      perform private.ledger_post('REFERRAL_INVITER', 'referral_inviter:' || p_user, 'Thưởng giới thiệu bạn bè', p_user,
        jsonb_build_array(jsonb_build_object('account_id', v_inviter, 'coin_kind', 'BONUS', 'amount', (cfg->>'inviterXu')::numeric),
                          jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -(cfg->>'inviterXu')::numeric)));
      perform private.notify(v_inviter, null, 'REFERRAL', 'Bạn nhận ' || trim_scale((cfg->>'inviterXu')::numeric) || ' Xu giới thiệu',
        private.display_name(p_user) || ' đã hoàn thành bài chạy đầu tiên.', '/wallet', p_user, false);
    end if;
  end if;
end $$;

-- Nhập mã giới thiệu: chỉ ghi nhận, CHƯA thưởng (thưởng khi chạy đủ km)
create or replace function public.apply_referral(p_referrer_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  cfg jsonb := private.economy_config()->'referral';
  v_created timestamptz := (select p.created_at from public.profiles p where p.id = private.require_uid());
begin
  if p_referrer_id = v_uid then raise exception 'CANNOT_REFER_SELF'; end if;
  if not exists (select 1 from public.profiles where id = p_referrer_id) then raise exception 'REFERRER_NOT_FOUND'; end if;
  if (select referred_by from public.profiles where id = v_uid) is not null then raise exception 'ALREADY_REFERRED'; end if;
  if v_created < now() - interval '14 days' then raise exception 'REFERRAL_WINDOW_EXPIRED'; end if;
  if exists (select 1 from public.profiles where id = p_referrer_id and referred_by = v_uid) then raise exception 'CANNOT_REFER_SELF'; end if;
  update public.profiles set referred_by = p_referrer_id where id = v_uid;
  perform private.referral_on_run(v_uid);
  return jsonb_build_object('success', true, 'referee_reward', (cfg->>'refereeXu')::numeric,
                            'referrer_reward', (cfg->>'inviterXu')::numeric, 'referrer_reward_after_km', (cfg->>'minKm')::numeric);
end $$;

-- ---------------------------------------------------------------------
-- 4. Chuỗi tuần: XP = 0 (XP chỉ từ km), Xu theo mốc
-- ---------------------------------------------------------------------
create or replace function private.streak_on_run(p_user uuid, p_at timestamptz, p_activity uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.user_streaks;
  w date := private.vn_week(p_at);
  v_days integer;
  v_gap integer;
  v_cur integer;
  v_used integer := 0;
  v_bonus numeric;
begin
  perform private.ensure_streak(p_user);
  s := (select x from public.user_streaks x where x.user_id = p_user for update);
  if s.last_week is not null and s.last_week >= w then return; end if;
  v_days := (select st.days from private.week_run_stats(p_user, w) st);
  if coalesce(v_days, 0) < s.weekly_goal then return; end if;

  v_gap := case when s.last_week is null then null else (w - s.last_week) / 7 - 1 end;
  if v_gap = 0 then v_cur := s.current_weeks + 1;
  elsif v_gap > 0 and v_gap <= s.shields then v_cur := s.current_weeks + 1; v_used := v_gap;
  else v_cur := 1;
  end if;
  update public.user_streaks
     set current_weeks = v_cur, best_weeks = greatest(best_weeks, v_cur), last_week = w,
         shields = shields - v_used, shields_used = shields_used + v_used, updated_at = now()
   where user_id = p_user;

  v_bonus := coalesce((select (e->>'xu')::numeric from jsonb_array_elements(coalesce(private.economy_config()->'streakRewards', '[]'::jsonb)) e
                        where (e->>'weeks')::int = v_cur), 0);
  perform private.award(p_user, 'STREAK', 'Chuỗi ' || v_cur || ' tuần',
    case when v_bonus > 0 then 'Đạt mốc ' || v_cur || ' tuần liên tiếp · +' || trim_scale(v_bonus) || ' Xu'
         when v_used > 0 then 'Khiên đã giữ chuỗi cho ' || v_used || ' tuần bị hụt'
         else 'Đạt mục tiêu ' || s.weekly_goal || ' ngày chạy trong tuần' end,
    v_bonus, 0, 'streak:' || p_user || ':' || w, p_activity,
    jsonb_build_object('weeks', v_cur, 'shields_used', v_used, 'week', w));
end $$;

-- Thu hồi khi bài chạy không còn hợp lệ: thêm điểm danh
create or replace function private.game_revoke_activity(p_activity uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e record;
begin
  for e in select * from public.game_events where activity_id = p_activity and kind in ('QUEST', 'BADGE', 'STREAK', 'CHECKIN', 'COMEBACK') loop
    if e.xu > 0 then
      perform private.ledger_post('GAME_REVERSAL', 'game_reversal:' || e.id, 'Thu hồi thưởng — bài chạy không còn hợp lệ', e.user_id,
        jsonb_build_array(
          jsonb_build_object('account_id', e.user_id, 'coin_kind', 'BONUS', 'amount', -e.xu),
          jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', e.xu)),
        p_activity, true);
    end if;
    if e.xp > 0 then
      update public.profiles set xp = greatest(coalesce(xp, 0) - e.xp, 0), level = private.level_for_xp(greatest(coalesce(xp, 0) - e.xp, 0))
       where id = e.user_id;
    end if;
    if e.kind = 'QUEST' then
      update public.user_quest_progress set completed_at = null, progress = 0, updated_at = now()
       where user_id = e.user_id and quest_id = (e.payload->>'quest_id')::uuid and period_start = (e.payload->>'period_start')::date;
    elsif e.kind = 'BADGE' then
      delete from public.user_achievements
       where user_id = e.user_id and achievement_id = (select id from public.achievements where code = e.payload->>'code');
    elsif e.kind = 'STREAK' then
      update public.user_streaks
         set current_weeks = greatest(current_weeks - 1, 0), last_week = case when last_week = (e.payload->>'week')::date then null else last_week end
       where user_id = e.user_id;
    end if;
    delete from public.game_events where id = e.id;
  end loop;
  delete from public.game_events where activity_id = p_activity and kind = 'RUN';
end $$;

-- Nút "Điểm danh" cũ: không còn thưởng khi mở app — chỉ báo hôm nay đã điểm danh (bằng bài chạy) chưa
create or replace function public.daily_checkin() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); v_day date := private.vn_day(now());
begin
  return jsonb_build_object('ok', true, 'checked', exists (select 1 from public.game_events g where g.dedupe_key = 'checkin:' || v_uid || ':' || v_day),
                            'xu', coalesce((private.economy_config()->>'checkinXu')::numeric, 1), 'balance', private.balance(v_uid));
end $$;

-- Nhiệm vụ / huy hiệu: không còn XP / Xu (XP chỉ từ km); bỏ nhiệm vụ điểm danh mở app và cổ vũ bằng Xu
update public.quests set reward_xu = 0, reward_xp = 0 where reward_xu <> 0 or reward_xp <> 0;
update public.quests set is_active = false where code in ('DAILY_CHEER', 'WEEK_15_CHEERS') and is_active;
-- Điểm danh giờ gắn với bài chạy: nhiệm vụ vẫn hiện để người dùng biết (Xu được cộng qua sự kiện CHECKIN, không qua nhiệm vụ)
update public.quests set title = 'Điểm danh bằng một bài chạy', description = 'Có bài chạy hợp lệ từ 1 km hôm nay — +1 Xu'
 where code = 'DAILY_CHECKIN';
update public.achievements set xp_reward = 0, xu_reward = 0 where xp_reward <> 0 or xu_reward <> 0;

-- ---------------------------------------------------------------------
-- 5. Phí tạo thử thách theo quy mô (capacity) — không theo thời gian
-- ---------------------------------------------------------------------
create or replace function private.capacity_tier(p_slots integer) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select t.e from (select e, row_number() over (order by (e->>'max')::int) as rn
                        from jsonb_array_elements(private.economy_config()->'capacityTiers') e
                       where (e->>'max')::int >= greatest(coalesce(p_slots, 1), 1)) t where t.rn = 1),
    jsonb_build_object('max', null, 'xu', null))
$$;

create or replace function private.challenge_creation_fee(p_team boolean, p_max_slots integer, p_start timestamptz, p_end timestamptz)
returns integer language plpgsql stable security definer set search_path = public as $$
declare t jsonb := private.capacity_tier(p_max_slots);
begin
  -- > 1.000 người: không bán bằng Xu — chỉ tạo được bằng vé admin cấp riêng (giá "vô cực" để vé được dùng thay)
  return coalesce((t->>'xu')::int, 2000000000);
end $$;

-- Không cho người dùng treo thưởng Xu (thưởng Xu chỉ từ quỹ CLB) — chống chuyển Xu P2P trá hình
create or replace function private.challenge_reward_guard() returns trigger
language plpgsql as $$
begin
  if new.reward_source = 'CREATOR' and coalesce(new.reward_xu, 0) > 0 then raise exception 'REWARD_NOT_ALLOWED'; end if;
  return new;
end $$;
drop trigger if exists trg_challenge_reward_guard on public.challenges;
create trigger trg_challenge_reward_guard before insert on public.challenges
  for each row execute function private.challenge_reward_guard();

-- Chính sách cho client (hiển thị bảng giá, công thức)
create or replace function public.economy_policy() returns jsonb
language sql stable security definer set search_path = public as $$
  select private.economy_config()
$$;

-- ---------------------------------------------------------------------
-- 6. Admin xuất bản cấu hình v2 (kiểm tra giá trị)
-- ---------------------------------------------------------------------
create or replace function private.valid_economy_v2(c jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(c) = 'object'
     and coalesce((c->>'xuVnd')::numeric, 100) between 1 and 1000000
     and coalesce((c->>'xpPerKm')::numeric, 10) between 0 and 1000
     and coalesce((c->'run'->>'freeKm')::numeric, 2) between 0 and 100
     and coalesce((c->'run'->>'dailyCap')::numeric, 20) between 0 and 100000
     and not exists (select 1 from jsonb_array_elements(coalesce(c->'run'->'tiers', '[]'::jsonb)) e
                      where (e->>'upToKm')::numeric not between 0 and 1000 or (e->>'rate')::numeric not between 0 and 1000)
     and coalesce((c->>'checkinXu')::numeric, 1) between 0 and 10000
     and coalesce((c->>'giftDailyCapXu')::numeric, 20000) between 0 and 100000000
     and not exists (select 1 from jsonb_array_elements(coalesce(c->'capacityTiers', '[]'::jsonb)) e
                      where (e->>'max')::int not between 1 and 1000000 or (e->>'xu')::numeric not between 0 and 10000000)
     and not exists (select 1 from jsonb_array_elements(coalesce(c->'streakRewards', '[]'::jsonb)) e
                      where (e->>'weeks')::int not between 1 and 520 or (e->>'xu')::numeric not between 0 and 100000)
     and coalesce((c->'referral'->>'inviterXu')::numeric, 0) between 0 and 100000
     and coalesce((c->'referral'->>'refereeXu')::numeric, 0) between 0 and 100000
     and coalesce((c->'referral'->>'monthlyCap')::numeric, 10) between 0 and 1000
     and coalesce((c->'comeback'->>'xu')::numeric, 10) between 0 and 10000
     and coalesce((c->'comeback'->>'minRestDays')::numeric, 28) between 7 and 365
     and coalesce((c->'comeback'->>'cooldownDays')::numeric, 90) between 0 and 3650
     and coalesce((c->'game'->>'shieldPrice')::numeric, 200) between 0 and 100000
$$;

create or replace function public.admin_publish_config(p_config_key text, p_config_value jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  v_next integer;
  v_old jsonb := (select v.config_value from (select x.config_value, row_number() over (order by x.version desc) as rn
                    from public.system_config_versions x where x.config_key = p_config_key and x.status = 'PUBLISHED') v where v.rn = 1);
  v_new jsonb := p_config_value;
begin
  if p_config_key <> 'economy_global_config' then raise exception 'UNSUPPORTED_CONFIG_KEY'; end if;
  v_new := private.economy_defaults_v2() || coalesce(v_new, '{}'::jsonb) || jsonb_build_object('econVersion', 2);
  if not private.valid_economy_v2(v_new) then raise exception 'INVALID_CONFIG'; end if;
  perform pg_advisory_xact_lock(hashtext('config:' || p_config_key));
  v_next := coalesce((select max(x.version) from public.system_config_versions x where x.config_key = p_config_key), 0) + 1;
  update public.system_config_versions set status = 'ARCHIVED' where config_key = p_config_key and status = 'PUBLISHED';
  insert into public.system_config_versions (config_key, version, status, config_value, created_by)
  values (p_config_key, v_next, 'PUBLISHED', v_new, v_admin);
  insert into public.admin_audit_log (actor_id, action, target, old_value, new_value)
  values (v_admin, 'PUBLISH_CONFIG', p_config_key || ' v' || v_next, v_old, v_new);
  return v_next;
end $$;

-- ---------------------------------------------------------------------
-- 7. Chuyển đổi một lần sang 1 Xu = 100đ (×10), có dấu để không chạy lại
-- ---------------------------------------------------------------------
create or replace function private.convert_xu_rate_v2() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  if exists (select 1 from private.app_settings where key = 'xu_rate_v2_done') then return 0; end if;
  for r in select e.account_id, e.coin_kind, sum(e.amount) as bal from public.ledger_entries e
            where e.account_id <> private.system_account() group by e.account_id, e.coin_kind having sum(e.amount) > 0 loop
    perform private.ledger_post('RATE_CONVERSION', 'rate_v2:' || r.account_id || ':' || r.coin_kind,
      'Đổi quy ước 1 Xu = 100đ (số dư ×10, giữ nguyên giá trị)', null,
      jsonb_build_array(jsonb_build_object('account_id', r.account_id, 'coin_kind', r.coin_kind, 'amount', r.bal * 9),
                        jsonb_build_object('account_id', private.system_account(), 'coin_kind', r.coin_kind, 'amount', -r.bal * 9)));
    n := n + 1;
  end loop;
  update public.avatar_items set price_xu = price_xu * 10 where price_xu > 0;
  update public.challenges set reward_xu = reward_xu * 10 where status in ('ACTIVE', 'UPCOMING', 'OPEN') and coalesce(reward_xu, 0) > 0;
  -- Cấu hình: xuất bản bản v2 (bỏ quy tắc cũ 1 Xu = 1.000đ)
  update public.system_config_versions set status = 'ARCHIVED' where config_key = 'economy_global_config' and status = 'PUBLISHED';
  insert into public.system_config_versions (config_key, version, status, config_value, created_by)
  values ('economy_global_config', coalesce((select max(x.version) from public.system_config_versions x where x.config_key = 'economy_global_config'), 0) + 1,
          'PUBLISHED', private.economy_defaults_v2(), null);
  insert into private.app_settings (key, value) values ('xu_rate_v2_done', now()::text);
  return n;
end $$;

select private.convert_xu_rate_v2();

-- ---------------------------------------------------------------------
-- 8. Quyền
-- ---------------------------------------------------------------------
revoke all on function private.economy_defaults_v2(), private.run_xu_for_km(numeric, jsonb), private.referral_on_run(uuid),
  private.capacity_tier(integer), private.challenge_reward_guard(), private.valid_economy_v2(jsonb), private.convert_xu_rate_v2()
  from public, anon, authenticated;
revoke all on function public.economy_policy(), public.admin_publish_config(text, jsonb), public.apply_referral(uuid), public.daily_checkin() from public, anon;
grant execute on function public.economy_policy(), public.admin_publish_config(text, jsonb), public.apply_referral(uuid), public.daily_checkin() to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001003800_plans_orders.sql
-- ===================================================================
-- 003800: Gói trả phí (VIP Runner 1–3, CLB Pro) + lượt tạo thử thách hằng tháng + nạp Xu + đơn hàng VietQR
--         + quyền tạo giải chạy ảo do admin cấp + giải chạy ảo thu phí theo quy mô.
-- • Giá gói / số lượt tạo / gói nạp Xu nằm trong bảng — admin sửa ở Quản trị → Gói & giá (không phải sửa code).
-- • Lượt tạo (credit) theo từng MỨC QUY MÔ (≤20, ≤50, ≤100…), cấp đầu mỗi tháng, hết tháng là hết (không cộng dồn),
--   không chuyển / bán / đổi Xu. Dùng lại cơ chế "vé tạo miễn phí" (challenge_passes): vé nhỏ nhất đủ quy mô được dùng trước.
-- • Chưa có cổng thanh toán tự động: người mua tạo đơn → chuyển khoản VietQR đúng nội dung mã đơn → admin xác nhận →
--   hệ thống tự kích hoạt gói / cộng Xu nạp. Xu không đổi ra tiền mặt.
-- • Giải chạy ảo: chỉ admin, CLB được cấp quyền (ban quản trị tạo) hoặc cá nhân được cấp quyền. Phí theo số VĐV tối đa,
--   trả bằng ví CLB (giải CLB) hoặc ví cá nhân, hoặc bằng lượt tạo.
-- Cần file 003700. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 1. Bảng giá (admin quản lý)
-- ---------------------------------------------------------------------
create table if not exists public.plans (
  code text primary key,
  name text not null,
  owner_type text not null check (owner_type in ('USER', 'CLUB')),
  tier integer not null default 1,
  description text,
  perks jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  sort integer not null default 0
);
create table if not exists public.plan_prices (
  plan_code text not null references public.plans(code) on delete cascade,
  months integer not null check (months in (1, 3, 6, 12)),
  price_vnd integer not null check (price_vnd between 0 and 1000000000),
  active boolean not null default true,
  primary key (plan_code, months)
);
create table if not exists public.plan_credits (
  plan_code text not null references public.plans(code) on delete cascade,
  capacity integer not null check (capacity between 1 and 10000),
  per_month integer not null check (per_month between 1 and 100),
  primary key (plan_code, capacity)
);
create table if not exists public.xu_packages (
  id uuid primary key default gen_random_uuid(),
  xu integer not null check (xu between 1 and 10000000),
  bonus_xu integer not null default 0 check (bonus_xu between 0 and 10000000),
  price_vnd integer not null check (price_vnd between 1000 and 1000000000),
  active boolean not null default true,
  sort integer not null default 0
);

insert into public.plans (code, name, owner_type, tier, description, perks, sort) values
  ('VIP1', 'Runner Plus', 'USER', 1, 'Trải nghiệm nâng cao, tổ chức nhóm nhỏ',
   '["3 lượt tạo thử thách / tháng (2 × ≤20, 1 × ≤50)", "Huy hiệu VIP + khung hồ sơ", "Bộ trang phục VIP1", "Phân tích xu hướng tuần / tháng (sắp có)"]', 1),
  ('VIP2', 'Runner Pro', 'USER', 2, 'Tổ chức thử thách vừa, phân tích sâu',
   '["5 lượt tạo / tháng (2 × ≤50, 2 × ≤100, 1 × ≤200)", "Mọi quyền lợi Plus", "Mẫu & nhân bản thử thách (sắp có)", "PR 1K → 42K, phân bố pace (sắp có)"]', 2),
  ('VIP3', 'Runner Elite', 'USER', 3, 'Tổ chức cộng đồng, báo cáo cá nhân',
   '["8 lượt tạo / tháng (tới 1 × ≤1.000)", "Mọi quyền lợi Pro", "Huy hiệu / giao diện thử thách riêng (sắp có)", "Xuất báo cáo cá nhân PDF / Excel (sắp có)"]', 3),
  ('CLUB_PRO', 'CLB Pro', 'CLUB', 1, 'Công cụ quản trị cộng đồng — không giới hạn thành viên',
   '["2 lượt tạo thử thách ≤100 người / tháng", "Không giới hạn quản trị viên", "Link mời riêng /c/tên-clb", "Báo cáo chuyên cần xuất Excel", "Ví CLB, thương hiệu CLB"]', 4)
on conflict (code) do nothing;

insert into public.plan_prices (plan_code, months, price_vnd) values
  ('VIP1', 1, 29000), ('VIP1', 12, 299000), ('VIP2', 1, 59000), ('VIP2', 12, 599000), ('VIP3', 1, 99000), ('VIP3', 12, 999000),
  ('CLUB_PRO', 1, 129000), ('CLUB_PRO', 3, 349000), ('CLUB_PRO', 6, 649000), ('CLUB_PRO', 12, 999000)
on conflict (plan_code, months) do nothing;

insert into public.plan_credits (plan_code, capacity, per_month) values
  ('VIP1', 20, 2), ('VIP1', 50, 1),
  ('VIP2', 50, 2), ('VIP2', 100, 2), ('VIP2', 200, 1),
  ('VIP3', 50, 2), ('VIP3', 100, 2), ('VIP3', 200, 2), ('VIP3', 500, 1), ('VIP3', 1000, 1),
  ('CLUB_PRO', 100, 2)
on conflict (plan_code, capacity) do nothing;

insert into public.xu_packages (xu, bonus_xu, price_vnd, sort)
select v.xu, v.bonus, v.price, v.sort from (values (100, 0, 10000, 1), (500, 25, 50000, 2), (1000, 80, 100000, 3),
                                                  (2000, 200, 200000, 4), (5000, 600, 500000, 5)) v(xu, bonus, price, sort)
 where not exists (select 1 from public.xu_packages);

alter table public.plans enable row level security;
alter table public.plan_prices enable row level security;
alter table public.plan_credits enable row level security;
alter table public.xu_packages enable row level security;
revoke all on public.plans, public.plan_prices, public.plan_credits, public.xu_packages from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Đăng ký gói (subscription) + đơn hàng
-- ---------------------------------------------------------------------
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null check (owner_type in ('USER', 'CLUB')),
  owner_id uuid not null,
  plan_code text not null references public.plans(code),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  source text not null check (source in ('ORDER', 'ADMIN')),
  order_id uuid,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists subscriptions_owner_idx on public.subscriptions (owner_id, ends_at desc);

create sequence if not exists public.order_code_seq start 100001;
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('PLAN', 'XU')),
  plan_code text references public.plans(code),
  months integer,
  package_id uuid references public.xu_packages(id),
  owner_type text not null check (owner_type in ('USER', 'CLUB')),
  owner_id uuid not null,
  amount_vnd integer not null check (amount_vnd > 0),
  xu integer not null default 0,
  bonus_xu integer not null default 0,
  status text not null default 'PENDING' check (status in ('PENDING', 'PAID', 'CANCELLED')),
  note text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '3 days',
  paid_at timestamptz,
  confirmed_by uuid references public.profiles(id) on delete set null
);
create index if not exists orders_buyer_idx on public.orders (buyer_id, created_at desc);
create index if not exists orders_status_idx on public.orders (status, created_at desc);

alter table public.subscriptions enable row level security;
alter table public.orders enable row level security;
revoke all on public.subscriptions, public.orders from anon, authenticated;

-- Lượt tạo hằng tháng = vé tạo miễn phí có mã nguồn (không cấp trùng)
alter table public.challenge_passes add column if not exists source_key text;
create unique index if not exists challenge_passes_source_key on public.challenge_passes (source_key) where source_key is not null;

-- Gói đang dùng của một chủ sở hữu (VIP: bậc cao nhất; CLB: CLB_PRO)
create or replace function private.active_plan(p_owner uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select to_jsonb(x) from (
            select s.plan_code, p.name, p.tier, max(s.ends_at) as ends_at,
                   row_number() over (order by p.tier desc, max(s.ends_at) desc) as rn
              from public.subscriptions s join public.plans p on p.code = s.plan_code
             where s.owner_id = p_owner and s.starts_at <= now() and s.ends_at > now()
             group by s.plan_code, p.name, p.tier) x where x.rn = 1), 'null'::jsonb)
$$;

create or replace function private.vn_month_start(p_at timestamptz) returns timestamptz
language sql immutable as $$
  select date_trunc('month', p_at at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh'
$$;

-- Cấp lượt tạo của tháng hiện tại (idempotent)
create or replace function private.issue_credits(p_owner_type text, p_owner uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_plan jsonb := private.active_plan(p_owner);
  v_code text;
  v_until timestamptz;
  v_month timestamptz := private.vn_month_start(now());
  v_next timestamptz := private.vn_month_start(private.vn_month_start(now()) + interval '32 days');
  c record;
  n integer := 0;
begin
  if v_plan <> 'null'::jsonb then
    v_code := v_plan->>'plan_code'; v_until := (v_plan->>'ends_at')::timestamptz;
  elsif p_owner_type = 'CLUB' and private.club_is_pro(p_owner) then           -- CLB Pro do admin bật tay
    v_code := 'CLUB_PRO'; v_until := coalesce((select c.pro_until from public.clubs c where c.id = p_owner), v_next);
  else
    return 0;
  end if;
  for c in select pc.capacity, pc.per_month from public.plan_credits pc where pc.plan_code = v_code loop
    insert into public.challenge_passes (owner_type, owner_id, max_slots, total, remaining, expires_at, note, source_key)
    values (p_owner_type, p_owner, c.capacity, c.per_month, c.per_month, least(v_next, v_until),
            'Lượt tạo ' || (select p.name from public.plans p where p.code = v_code) || ' tháng ' || to_char(v_month at time zone 'Asia/Ho_Chi_Minh', 'MM/YYYY'),
            'credit:' || p_owner || ':' || v_code || ':' || to_char(v_month at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM') || ':' || c.capacity)
    on conflict (source_key) where source_key is not null do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Cron hằng ngày: cấp lượt tháng mới cho mọi gói đang hiệu lực + CLB Pro
create or replace function public.issue_due_credits() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in select distinct s.owner_type, s.owner_id from public.subscriptions s where s.starts_at <= now() and s.ends_at > now()
           union select 'CLUB', c.id from public.clubs c where private.club_is_pro(c.id) loop
    n := n + private.issue_credits(r.owner_type, r.owner_id);
  end loop;
  return n;
end $$;

-- Kích hoạt / gia hạn gói: nối tiếp gói cùng loại còn hạn
create or replace function private.grant_subscription(p_owner_type text, p_owner uuid, p_plan text, p_months integer, p_source text,
                                                       p_order uuid, p_note text, p_by uuid) returns public.subscriptions
language plpgsql security definer set search_path = public as $$
declare
  v_start timestamptz := greatest(now(), coalesce((select max(s.ends_at) from public.subscriptions s
                                                    where s.owner_id = p_owner and s.plan_code = p_plan and s.ends_at > now()), now()));
  v_row public.subscriptions;
  v_name text := (select p.name from public.plans p where p.code = p_plan);
begin
  if v_name is null or (select p.owner_type from public.plans p where p.code = p_plan) <> p_owner_type then raise exception 'INVALID_PLAN'; end if;
  if p_months not in (1, 3, 6, 12) then raise exception 'INVALID_MONTHS'; end if;
  insert into public.subscriptions (owner_type, owner_id, plan_code, starts_at, ends_at, source, order_id, note, created_by)
  values (p_owner_type, p_owner, p_plan, v_start, v_start + make_interval(months => p_months), p_source, p_order, p_note, p_by)
  returning * into v_row;
  if p_plan = 'CLUB_PRO' then
    update public.clubs set plan = 'PRO', pro_until = greatest(coalesce(pro_until, now()), v_row.ends_at) where id = p_owner;
    perform private.notify_club(p_owner, true, 'CLUB_PRO', 'CLB đã lên gói CLB Pro',
      'Hiệu lực tới ' || to_char(v_row.ends_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY') || '.', '/clubs/' || p_owner || '/settings', p_by);
  else
    perform private.notify(p_owner, null, 'VIP', 'Bạn đã là ' || v_name,
      'Hiệu lực tới ' || to_char(v_row.ends_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY') || '. Lượt tạo thử thách tháng này đã được cấp.', '/me/plan', p_by, true);
  end if;
  perform private.issue_credits(p_owner_type, p_owner);
  return v_row;
end $$;

-- ---------------------------------------------------------------------
-- 3. Người dùng: xem bảng giá, gói của tôi, tạo / hủy đơn
-- ---------------------------------------------------------------------
create or replace function private.payment_account() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'bank_bin', (select value from private.app_settings where key = 'pay_bank_bin'),
    'account_no', (select value from private.app_settings where key = 'pay_account_no'),
    'account_name', (select value from private.app_settings where key = 'pay_account_name'))
$$;

create or replace function public.pricing_catalog() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'plans', (select coalesce(jsonb_agg(jsonb_build_object(
                'code', p.code, 'name', p.name, 'owner_type', p.owner_type, 'tier', p.tier, 'description', p.description, 'perks', p.perks,
                'active', p.active,
                'prices', (select coalesce(jsonb_agg(jsonb_build_object('months', pp.months, 'price_vnd', pp.price_vnd, 'active', pp.active)
                                                      order by pp.months), '[]'::jsonb)
                             from public.plan_prices pp where pp.plan_code = p.code and (pp.active or public.is_system_admin())),
                'credits', (select coalesce(jsonb_agg(jsonb_build_object('capacity', pc.capacity, 'per_month', pc.per_month) order by pc.capacity), '[]'::jsonb)
                              from public.plan_credits pc where pc.plan_code = p.code))
              order by p.sort), '[]'::jsonb) from public.plans p where p.active or public.is_system_admin()),
    'packages', (select coalesce(jsonb_agg(to_jsonb(x) order by x.sort, x.xu), '[]'::jsonb) from public.xu_packages x where x.active or public.is_system_admin()),
    'payment', private.payment_account(),
    'xu_vnd', (private.economy_config()->>'xuVnd')::numeric,
    'capacity_tiers', private.economy_config()->'capacityTiers')
$$;

create or replace function private.order_json(o public.orders) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(o) || jsonb_build_object(
    'plan_name', (select p.name from public.plans p where p.code = o.plan_code),
    'owner_name', case o.owner_type when 'CLUB' then (select c.name from public.clubs c where c.id = o.owner_id)
                                    else private.display_name(o.owner_id) end,
    'buyer_name', private.display_name(o.buyer_id),
    'payment', private.payment_account())
$$;

create or replace function public.my_plan() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  perform private.issue_credits('USER', v_uid);
  return jsonb_build_object('plan', private.active_plan(v_uid),
    'credits', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'capacity', p.max_slots, 'remaining', p.remaining, 'total', p.total,
                                                             'expires_at', p.expires_at, 'note', p.note) order by p.max_slots), '[]'::jsonb)
                  from public.challenge_passes p where p.owner_id = v_uid and p.remaining > 0 and (p.expires_at is null or p.expires_at > now())),
    'orders', (select coalesce(jsonb_agg(private.order_json(t.o) order by t.rn), '[]'::jsonb)
                 from (select x as o, row_number() over (order by x.created_at desc) as rn from public.orders x where x.buyer_id = v_uid) t
                where t.rn <= 20));
end $$;

create or replace function public.club_plan_status(p_club_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.club_is_member(p_club_id) then raise exception 'NOT_A_MEMBER'; end if;
  perform private.issue_credits('CLUB', p_club_id);
  return jsonb_build_object('plan', private.active_plan(p_club_id), 'pro', private.club_is_pro(p_club_id),
    'pro_until', (select c.pro_until from public.clubs c where c.id = p_club_id),
    'credits', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'capacity', p.max_slots, 'remaining', p.remaining, 'total', p.total,
                                                             'expires_at', p.expires_at, 'note', p.note) order by p.max_slots), '[]'::jsonb)
                  from public.challenge_passes p where p.owner_id = p_club_id and p.remaining > 0 and (p.expires_at is null or p.expires_at > now())));
end $$;

create or replace function public.create_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_kind text := upper(coalesce(p->>'kind', ''));
  v_plan public.plans := (select x from public.plans x where x.code = p->>'plan_code' and x.active);
  v_months integer := coalesce((p->>'months')::int, 1);
  v_price integer;
  v_pkg public.xu_packages := (select x from public.xu_packages x where x.id = nullif(p->>'package_id', '')::uuid and x.active);
  v_owner uuid;
  v_owner_type text;
  v_id uuid := gen_random_uuid();
begin
  if (select count(*) from public.orders o where o.buyer_id = v_uid and o.status = 'PENDING' and o.expires_at > now()) >= 5 then
    raise exception 'TOO_MANY_PENDING_ORDERS';
  end if;
  if v_kind = 'PLAN' then
    if v_plan.code is null then raise exception 'INVALID_PLAN'; end if;
    v_price := (select pp.price_vnd from public.plan_prices pp where pp.plan_code = v_plan.code and pp.months = v_months and pp.active);
    if v_price is null then raise exception 'INVALID_MONTHS'; end if;
    v_owner_type := v_plan.owner_type;
    if v_owner_type = 'CLUB' then
      v_owner := nullif(p->>'club_id', '')::uuid;
      if v_owner is null or not public.club_is_staff(v_owner) then raise exception 'CLUB_STAFF_REQUIRED'; end if;
    else
      v_owner := v_uid;
    end if;
    insert into public.orders (id, code, buyer_id, kind, plan_code, months, owner_type, owner_id, amount_vnd)
    values (v_id, 'RH' || nextval('public.order_code_seq'), v_uid, 'PLAN', v_plan.code, v_months, v_owner_type, v_owner, v_price);
  elsif v_kind = 'XU' then
    if v_pkg.id is null then raise exception 'INVALID_PACKAGE'; end if;
    insert into public.orders (id, code, buyer_id, kind, package_id, owner_type, owner_id, amount_vnd, xu, bonus_xu)
    values (v_id, 'RH' || nextval('public.order_code_seq'), v_uid, 'XU', v_pkg.id, 'USER', v_uid, v_pkg.price_vnd, v_pkg.xu, v_pkg.bonus_xu);
  else
    raise exception 'INVALID_ORDER';
  end if;
  return private.order_json((select o from public.orders o where o.id = v_id));
end $$;

create or replace function public.cancel_order(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); o public.orders := (select x from public.orders x where x.id = p_order_id for update);
begin
  if o.id is null or (o.buyer_id <> v_uid and not public.is_system_admin()) then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.status <> 'PENDING' then raise exception 'ORDER_NOT_PENDING'; end if;
  update public.orders set status = 'CANCELLED' where id = o.id;
  return private.order_json((select x from public.orders x where x.id = o.id));
end $$;

-- ---------------------------------------------------------------------
-- 4. Admin: xác nhận đơn (kích hoạt gói / cộng Xu nạp), cấp gói tay, sửa bảng giá, tài khoản nhận tiền
-- ---------------------------------------------------------------------
create or replace function public.admin_list_orders(p_status text default 'PENDING') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(private.order_json(t.o) order by t.rn), '[]'::jsonb)
            from (select x as o, row_number() over (order by x.created_at desc) as rn from public.orders x
                   where p_status = 'ALL' or x.status = p_status) t where t.rn <= 100);
end $$;

create or replace function public.admin_confirm_order(p_order_id uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_admin(); o public.orders := (select x from public.orders x where x.id = p_order_id for update);
begin
  if o.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.status = 'PAID' then return private.order_json(o); end if;
  if o.status <> 'PENDING' then raise exception 'ORDER_NOT_PENDING'; end if;
  update public.orders set status = 'PAID', paid_at = now(), confirmed_by = v_uid, note = nullif(trim(coalesce(p_note, '')), '') where id = o.id;
  if o.kind = 'PLAN' then
    perform private.grant_subscription(o.owner_type, o.owner_id, o.plan_code, o.months, 'ORDER', o.id, 'Đơn ' || o.code, v_uid);
  else
    perform private.ledger_post('XU_PURCHASE', 'order:' || o.id, 'Nạp Xu — đơn ' || o.code, v_uid,
      jsonb_build_array(jsonb_build_object('account_id', o.owner_id, 'coin_kind', 'PAID', 'amount', o.xu),
                        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'PAID', 'amount', -o.xu)), o.id);
    if o.bonus_xu > 0 then
      perform private.ledger_post('XU_PURCHASE_BONUS', 'order_bonus:' || o.id, 'Tặng thêm khi nạp — đơn ' || o.code, v_uid,
        jsonb_build_array(jsonb_build_object('account_id', o.owner_id, 'coin_kind', 'BONUS', 'amount', o.bonus_xu),
                          jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -o.bonus_xu)), o.id);
    end if;
    perform private.notify(o.owner_id, null, 'ADMIN_XU', 'Đã nạp ' || (o.xu + o.bonus_xu) || ' Xu', 'Đơn ' || o.code || ' đã được xác nhận.', '/wallet', v_uid, true);
  end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'CONFIRM_ORDER', o.code, jsonb_build_object('kind', o.kind, 'amount_vnd', o.amount_vnd, 'plan', o.plan_code, 'xu', o.xu));
  return private.order_json((select x from public.orders x where x.id = o.id));
end $$;

create or replace function public.admin_grant_plan(p_owner_type text, p_owner_id uuid, p_plan text, p_months integer, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_admin(); s public.subscriptions;
begin
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  s := private.grant_subscription(upper(p_owner_type), p_owner_id, upper(p_plan), p_months, 'ADMIN', null, trim(p_reason), v_uid);
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'GRANT_PLAN', p_owner_id::text, jsonb_build_object('plan', s.plan_code, 'ends_at', s.ends_at, 'reason', trim(p_reason)));
  return to_jsonb(s);
end $$;

create or replace function public.admin_save_plan(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_admin(); v_code text := upper(trim(coalesce(p->>'code', ''))); e jsonb;
begin
  if not exists (select 1 from public.plans x where x.code = v_code) then raise exception 'INVALID_PLAN'; end if;
  update public.plans set name = coalesce(nullif(trim(p->>'name'), ''), name), description = coalesce(p->>'description', description),
         perks = coalesce(p->'perks', perks), active = coalesce((p->>'active')::boolean, active) where code = v_code;
  if p ? 'prices' then
    for e in select value from jsonb_array_elements(p->'prices') loop
      insert into public.plan_prices (plan_code, months, price_vnd, active)
      values (v_code, (e->>'months')::int, (e->>'price_vnd')::int, coalesce((e->>'active')::boolean, true))
      on conflict (plan_code, months) do update set price_vnd = excluded.price_vnd, active = excluded.active;
    end loop;
  end if;
  if p ? 'credits' then
    delete from public.plan_credits where plan_code = v_code;
    insert into public.plan_credits (plan_code, capacity, per_month)
    select v_code, (e->>'capacity')::int, (e->>'per_month')::int from jsonb_array_elements(p->'credits') e where (e->>'per_month')::int > 0;
  end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SAVE_PLAN', v_code, p);
end $$;

create or replace function public.admin_save_xu_package(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_admin(); v_id uuid := coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid());
begin
  insert into public.xu_packages (id, xu, bonus_xu, price_vnd, active, sort)
  values (v_id, (p->>'xu')::int, coalesce((p->>'bonus_xu')::int, 0), (p->>'price_vnd')::int, coalesce((p->>'active')::boolean, true), coalesce((p->>'sort')::int, 0))
  on conflict (id) do update set xu = excluded.xu, bonus_xu = excluded.bonus_xu, price_vnd = excluded.price_vnd, active = excluded.active, sort = excluded.sort;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SAVE_XU_PACKAGE', v_id::text, p);
  return v_id;
end $$;

create or replace function public.admin_set_payment_account(p_bank_bin text, p_account_no text, p_account_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_admin();
begin
  if coalesce(p_bank_bin, '') !~ '^[0-9]{6}$' or coalesce(p_account_no, '') !~ '^[0-9A-Za-z]{4,30}$' or length(trim(coalesce(p_account_name, ''))) < 3 then
    raise exception 'INVALID_BANK';
  end if;
  insert into private.app_settings (key, value) values ('pay_bank_bin', p_bank_bin), ('pay_account_no', p_account_no), ('pay_account_name', upper(trim(p_account_name)))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'SET_PAYMENT_ACCOUNT', p_bank_bin, jsonb_build_object('account_no', p_account_no, 'name', upper(trim(p_account_name))));
  return private.payment_account();
end $$;

-- ---------------------------------------------------------------------
-- 5. Giải chạy ảo: quyền tổ chức do admin cấp + phí theo quy mô
-- ---------------------------------------------------------------------
create table if not exists public.race_organizer_grants (
  owner_type text not null check (owner_type in ('USER', 'CLUB')),
  owner_id uuid not null,
  note text,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (owner_type, owner_id)
);
alter table public.race_organizer_grants enable row level security;
revoke all on public.race_organizer_grants from anon, authenticated;

alter table public.virtual_races add column if not exists fee_charged integer not null default 0;
alter table public.virtual_races add column if not exists pass_id uuid references public.challenge_passes(id) on delete set null;

create or replace function public.can_organize_race() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'admin', public.is_system_admin(),
    'personal', exists (select 1 from public.race_organizer_grants g where g.owner_type = 'USER' and g.owner_id = auth.uid()),
    'clubs', (select coalesce(jsonb_agg(g.owner_id), '[]'::jsonb) from public.race_organizer_grants g
               where g.owner_type = 'CLUB' and public.club_is_staff(g.owner_id)))
$$;

create or replace function public.admin_set_race_organizer(p_owner_type text, p_owner_id uuid, p_allow boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_admin();
begin
  if upper(p_owner_type) not in ('USER', 'CLUB') then raise exception 'INVALID_OWNER'; end if;
  if p_allow then
    insert into public.race_organizer_grants (owner_type, owner_id, note, granted_by) values (upper(p_owner_type), p_owner_id, p_note, v_uid)
    on conflict (owner_type, owner_id) do update set note = excluded.note, granted_by = excluded.granted_by, created_at = now();
    if upper(p_owner_type) = 'CLUB' then
      perform private.notify_club(p_owner_id, true, 'CLUB_PRO', 'CLB được cấp quyền tổ chức giải chạy ảo', null, '/races/new', v_uid);
    else
      perform private.notify(p_owner_id, null, 'VIP', 'Bạn được cấp quyền tổ chức giải chạy ảo', null, '/races/new', v_uid, true);
    end if;
  else
    delete from public.race_organizer_grants where owner_type = upper(p_owner_type) and owner_id = p_owner_id;
  end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'RACE_ORGANIZER', p_owner_id::text, jsonb_build_object('type', upper(p_owner_type), 'allow', p_allow, 'note', p_note));
end $$;

create or replace function public.admin_list_race_organizers() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('owner_type', g.owner_type, 'owner_id', g.owner_id, 'note', g.note, 'created_at', g.created_at,
            'name', case g.owner_type when 'CLUB' then (select c.name from public.clubs c where c.id = g.owner_id) else private.display_name(g.owner_id) end)
            order by g.created_at desc), '[]'::jsonb) from public.race_organizer_grants g);
end $$;

-- Báo giá tạo giải / thử thách theo quy mô cho người trả (ví CLB hoặc ví cá nhân), kèm lượt tạo dùng được
create or replace function public.quote_capacity(p_slots integer, p_club_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_payer uuid := coalesce(p_club_id, v_uid);
  v_fee integer := private.challenge_creation_fee(false, p_slots, now(), now());
  v_pass public.challenge_passes;
begin
  if p_club_id is not null and not public.club_is_staff(p_club_id) then raise exception 'FORBIDDEN'; end if;
  perform private.issue_credits(case when p_club_id is null then 'USER' else 'CLUB' end, v_payer);
  v_pass := (select t.x from (select x, row_number() over (order by x.expires_at nulls last, x.max_slots, x.created_at) as rn
                                from public.challenge_passes x
                               where x.owner_id = v_payer and x.remaining > 0 and x.max_slots >= greatest(coalesce(p_slots, 1), 1)
                                 and (x.expires_at is null or x.expires_at > now())) t where t.rn = 1);
  return jsonb_build_object('slots', p_slots, 'tier', private.capacity_tier(p_slots), 'fee', v_fee,
    'custom', private.capacity_tier(p_slots)->>'xu' is null,
    'payer', case when p_club_id is null then 'USER' else 'CLUB' end, 'payer_balance', private.balance(v_payer),
    'pass', case when v_pass.id is null or v_fee = 0 then null
                 else jsonb_build_object('id', v_pass.id, 'max_slots', v_pass.max_slots, 'remaining', v_pass.remaining, 'note', v_pass.note) end);
end $$;

-- Báo giá tạo thử thách (thay bản 000700): cấp lượt tháng trước khi báo, trả cấu hình v2 + mức quy mô
create or replace function public.quote_challenge(p_max_slots integer, p_format text default 'RANKED', p_club_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_slots integer := case when p_format = 'DUEL' then 2 when p_format = 'SOLO_GOAL' then 1 else greatest(coalesce(p_max_slots, 1), 1) end;
  v_fee integer := private.challenge_creation_fee(p_format = 'TEAM', v_slots, now(), now() + interval '1 day');
  v_payer uuid := case when p_club_id is not null and public.club_is_staff(p_club_id) then p_club_id else v_uid end;
  v_pass public.challenge_passes;
begin
  perform private.issue_credits(case when v_payer = v_uid then 'USER' else 'CLUB' end, v_payer);
  v_pass := (select t.x from (select x, row_number() over (order by x.expires_at nulls last, x.max_slots, x.created_at) as rn
                                from public.challenge_passes x
                               where x.owner_id = v_payer and x.remaining > 0 and x.max_slots >= v_slots
                                 and (x.expires_at is null or x.expires_at > now())) t where t.rn = 1);
  return jsonb_build_object(
    'fee', v_fee, 'tier', private.capacity_tier(v_slots), 'custom', private.capacity_tier(v_slots)->>'xu' is null,
    'payer', case when v_payer = v_uid then 'USER' else 'CLUB' end,
    'payer_balance', private.balance(v_payer), 'wallet_balance', private.balance(v_uid),
    'pass', case when v_pass.id is null or v_fee = 0 then null
                 else jsonb_build_object('id', v_pass.id, 'remaining', v_pass.remaining, 'max_slots', v_pass.max_slots,
                                         'expires_at', v_pass.expires_at, 'note', v_pass.note) end,
    'xu_vnd', (private.economy_config()->>'xuVnd')::numeric,
    'policy', private.economy_config());
end $$;

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
  v_admin boolean := public.is_system_admin();
  v_payer uuid;
  v_fee integer := 0;
  v_pass uuid;
begin
  if not v_admin then
    if v_club is not null then
      if not public.club_is_staff(v_club) then raise exception 'FORBIDDEN'; end if;
      if not exists (select 1 from public.race_organizer_grants g where g.owner_type = 'CLUB' and g.owner_id = v_club) then raise exception 'RACE_ORGANIZER_REQUIRED'; end if;
    elsif not exists (select 1 from public.race_organizer_grants g where g.owner_type = 'USER' and g.owner_id = v_uid) then
      raise exception 'RACE_ORGANIZER_REQUIRED';
    end if;
    if v_max is null then raise exception 'CAPACITY_REQUIRED'; end if;
  end if;
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

  -- Phí theo quy mô (admin miễn phí). Lượt tạo (vé) dùng trước, rồi mới trừ Xu.
  if not v_admin then
    v_payer := coalesce(v_club, v_uid);
    perform private.issue_credits(case when v_club is null then 'USER' else 'CLUB' end, v_payer);
    v_fee := private.challenge_creation_fee(false, v_max, v_start, v_end);
    if v_fee > 0 then
      v_pass := (select t.id from (select x.id, row_number() over (order by x.expires_at nulls last, x.max_slots, x.created_at) as rn
                                     from public.challenge_passes x
                                    where x.owner_id = v_payer and x.remaining > 0 and x.max_slots >= v_max
                                      and (x.expires_at is null or x.expires_at > now())) t where t.rn = 1);
      if v_pass is not null then
        update public.challenge_passes set remaining = remaining - 1, updated_at = now() where id = v_pass;
        v_fee := 0;
      elsif private.balance(v_payer) < v_fee then
        raise exception '%', case when v_club is null then 'INSUFFICIENT_BALANCE' else 'INSUFFICIENT_TREASURY' end;
      else
        perform private.ledger_post('RACE_FEE', 'race_fee:' || v_id, 'Phí tạo giải chạy ảo: ' || v_title, v_uid,
          private.debit_entries(v_payer, v_fee, private.system_account()), v_id);
        if v_club is not null then
          insert into public.club_treasury_log (club_id, user_id, amount, kind, note)
          values (v_club, v_uid, -v_fee, 'SPEND', left('Phí tạo giải: ' || v_title, 200));
        end if;
      end if;
    end if;
  end if;

  insert into public.virtual_races (id, organizer_id, club_id, title, description, start_at, end_at, reg_close_at, distances,
                                    audience, max_participants, bib_prefix, fee_charged, pass_id)
  values (v_id, v_uid, v_club, v_title, nullif(left(trim(coalesce(p->>'description', '')), 3000), ''), v_start, v_end, v_close,
          v_dist, v_aud, v_max, v_prefix, v_fee, v_pass);
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 6. Quyền
-- ---------------------------------------------------------------------
revoke all on function private.active_plan(uuid), private.vn_month_start(timestamptz), private.issue_credits(text, uuid),
  private.grant_subscription(text, uuid, text, integer, text, uuid, text, uuid), private.payment_account(), private.order_json(public.orders)
  from public, anon, authenticated;
revoke all on function public.issue_due_credits(), public.pricing_catalog(), public.my_plan(), public.club_plan_status(uuid),
  public.create_order(jsonb), public.cancel_order(uuid), public.admin_list_orders(text), public.admin_confirm_order(uuid, text),
  public.admin_grant_plan(text, uuid, text, integer, text), public.admin_save_plan(jsonb), public.admin_save_xu_package(jsonb),
  public.admin_set_payment_account(text, text, text), public.can_organize_race(), public.admin_set_race_organizer(text, uuid, boolean, text),
  public.admin_list_race_organizers(), public.quote_capacity(integer, uuid), public.create_virtual_race(jsonb) from public, anon;
grant execute on function public.pricing_catalog(), public.my_plan(), public.club_plan_status(uuid),
  public.create_order(jsonb), public.cancel_order(uuid), public.admin_list_orders(text), public.admin_confirm_order(uuid, text),
  public.admin_grant_plan(text, uuid, text, integer, text), public.admin_save_plan(jsonb), public.admin_save_xu_package(jsonb),
  public.admin_set_payment_account(text, text, text), public.can_organize_race(), public.admin_set_race_organizer(text, uuid, boolean, text),
  public.admin_list_race_organizers(), public.quote_capacity(integer, uuid), public.create_virtual_race(jsonb) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001003900_gifts.sql
-- ===================================================================
-- 003900: Kho quà tặng ảo (thay "cổ vũ bằng Xu").
-- • Quy tắc 04: Xu KHÔNG chuyển P2P. Tặng quà = Xu của người tặng bị ĐỐT (về hệ thống); người nhận KHÔNG nhận Xu,
--   chỉ nhận quà hiện trên hồ sơ (tường quà) + "Điểm tỏa sáng" (tổng giá trị quà nhận, không quy đổi được).
-- • Kho quà theo 4 tầng (tham khảo TikTok LIVE / Bigo / Twitch Bits): Cổ vũ (1–10 Xu) · Tiếp sức (20–100) ·
--   Bùng nổ (200–1.000) · Huyền thoại (2.000–10.000). Quà càng lớn hiệu ứng càng lớn; quà nhỏ tặng combo ×5 / ×10.
--   Có quà theo mùa (Tết, Trung thu — tự bật theo ngày) và quà riêng cho VIP (chỉ là trang trí, không tăng thành tích).
--   Không có quà đồ uống có cồn.
-- • Admin sửa giá / tên / biểu tượng / bật tắt / thêm quà ở Quản trị → Quà tặng.
-- Cần file 003800. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

create table if not exists public.gift_catalog (
  code text primary key check (code ~ '^[a-z0-9_]{2,40}$'),
  name text not null check (char_length(name) between 2 and 40),
  emoji text not null check (char_length(emoji) between 1 and 16),
  price_xu integer not null check (price_xu between 1 and 1000000),
  tier text not null check (tier in ('CHEER', 'BOOST', 'HYPE', 'LEGEND')),
  description text check (description is null or char_length(description) <= 120),
  vip_tier integer not null default 0 check (vip_tier between 0 and 3),
  season_from date,                                 -- quà theo mùa: chỉ hiện trong khoảng ngày (bỏ năm → dùng tháng-ngày)
  season_to date,
  is_active boolean not null default true,
  sort integer not null default 0
);

insert into public.gift_catalog (code, name, emoji, price_xu, tier, description, vip_tier, season_from, season_to, sort) values
  ('clap',        'Vỗ tay',           '👏', 1,     'CHEER',  'Tràng pháo tay cổ vũ',                 0, null, null, 10),
  ('water',       'Nước suối',        '💧', 5,     'CHEER',  'Tiếp nước giữa đường chạy',            0, null, null, 11),
  ('banana',      'Chuối',            '🍌', 5,     'CHEER',  'Chống chuột rút',                       0, null, null, 12),
  ('coffee',      'Cà phê',           '☕', 10,    'CHEER',  'Ly cà phê sau buổi chạy sáng',          0, null, null, 13),
  ('rose',        'Hoa hồng',         '🌹', 10,    'CHEER',  'Tặng người truyền cảm hứng',            0, null, null, 14),
  ('energy_gel',  'Gel năng lượng',   '🔋', 20,    'BOOST',  'Nạp năng lượng cho km cuối',            0, null, null, 20),
  ('electrolyte', 'Điện giải',        '🧃', 30,    'BOOST',  'Bù khoáng sau buổi chạy dài',           0, null, null, 21),
  ('energy_drink','Nước tăng lực',    '🥤', 50,    'BOOST',  'Tăng tốc về đích',                      0, null, null, 22),
  ('medal',       'Huy chương',       '🏅', 80,    'BOOST',  'Ghi nhận một buổi chạy đẹp',            0, null, null, 23),
  ('trophy',      'Cúp',              '🏆', 100,   'BOOST',  'Nhà vô địch hôm nay',                   0, null, null, 24),
  ('fireworks',   'Pháo hoa',         '🎆', 200,   'HYPE',   'Ăn mừng thành tích mới',                0, null, null, 30),
  ('laurel',      'Vòng nguyệt quế',  '🌿', 300,   'HYPE',   'Vinh danh người chiến thắng',           0, null, null, 31),
  ('golden_shoes','Giày vàng',        '👟', 500,   'HYPE',   'Đôi chân không biết mỏi',               0, null, null, 32),
  ('rocket',      'Tên lửa',          '🚀', 1000,  'HYPE',   'Pace như tên lửa',                      0, null, null, 33),
  ('rainbow',     'Cầu vồng về đích', '🌈', 2000,  'LEGEND', 'Hiệu ứng toàn màn hình',                0, null, null, 40),
  ('phoenix',     'Phượng hoàng',     '🦅', 5000,  'LEGEND', 'Trở lại mạnh mẽ hơn',                   0, null, null, 41),
  ('crown',       'Vương miện',       '👑', 10000, 'LEGEND', 'Vua đường chạy',                        0, null, null, 42),
  ('vip_star',    'Ngôi sao VIP',     '🌟', 30,    'BOOST',  'Quà riêng thành viên VIP',              1, null, null, 25),
  ('lucky_money', 'Lì xì',            '🧧', 88,    'BOOST',  'Quà Tết — chúc năm mới chạy khỏe',      0, '2000-01-15', '2000-02-28', 50),
  ('lantern',     'Đèn lồng',         '🏮', 30,    'BOOST',  'Quà Trung thu',                         0, '2000-09-01', '2000-10-15', 51)
on conflict (code) do nothing;

alter table public.gift_catalog enable row level security;
revoke all on public.gift_catalog from anon, authenticated;

-- Quà được ghi vào bảng cheers (giữ tổng hiện có trên bài chạy / bài đăng); amount = tổng Xu đã đốt
alter table public.cheers drop constraint if exists cheers_amount_check;
alter table public.cheers alter column amount type numeric(12, 1);
alter table public.cheers drop constraint if exists cheers_amount_chk;
alter table public.cheers add constraint cheers_amount_chk check (amount between 1 and 100000000);
alter table public.cheers add column if not exists gift_code text references public.gift_catalog(code);
alter table public.cheers add column if not exists qty integer not null default 1;
create index if not exists cheers_to_user_idx on public.cheers (to_user, created_at desc);

create or replace function private.gift_in_season(g public.gift_catalog, p_day date) returns boolean
language sql immutable as $$
  select g.season_from is null or g.season_to is null
      or to_char(p_day, 'MM-DD') between to_char(g.season_from, 'MM-DD') and to_char(g.season_to, 'MM-DD')
$$;

create or replace function private.user_vip_tier(p_user uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((private.active_plan(p_user)->>'tier')::int, 0)
    * case when (private.active_plan(p_user)->>'plan_code') like 'VIP%' then 1 else 0 end
$$;

-- Danh sách quà cho người dùng (đang bán, đúng mùa; quà VIP hiện kèm khóa nếu chưa đủ bậc)
create or replace function public.gift_catalog() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'gifts', (select coalesce(jsonb_agg(jsonb_build_object('code', g.code, 'name', g.name, 'emoji', g.emoji, 'price_xu', g.price_xu,
                'tier', g.tier, 'description', g.description, 'vip_tier', g.vip_tier, 'seasonal', g.season_from is not null,
                'locked', g.vip_tier > private.user_vip_tier(auth.uid())) order by g.sort, g.price_xu), '[]'::jsonb)
              from public.gift_catalog g where g.is_active and private.gift_in_season(g, private.vn_day(now()))),
    'daily_cap', coalesce((private.economy_config()->>'giftDailyCapXu')::int, 20000),
    'sent_today', coalesce((select sum(c.amount) from public.cheers c where c.from_user = auth.uid() and c.gift_code is not null
                             and c.created_at >= private.vn_start(private.vn_day(now()))), 0))
$$;

create or replace function public.send_gift(
  p_to_user uuid, p_gift_code text, p_qty integer default 1, p_message text default null, p_post_id uuid default null,
  p_activity_id uuid default null, p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  g public.gift_catalog := (select x from public.gift_catalog x where x.code = p_gift_code);
  v_qty integer := coalesce(p_qty, 1);
  v_total integer;
  v_msg text := nullif(trim(coalesce(p_message, '')), '');
  v_club uuid;
  v_author uuid;
  v_id uuid := (select c.id from public.cheers c where c.idempotency_key = p_idempotency_key);
  v_sent numeric;
  v_name text;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if v_id is not null then return jsonb_build_object('gift_id', v_id, 'duplicate', true); end if;
  if g.code is null or not g.is_active or not private.gift_in_season(g, private.vn_day(now())) then raise exception 'GIFT_NOT_AVAILABLE'; end if;
  if g.vip_tier > private.user_vip_tier(v_uid) then raise exception 'VIP_REQUIRED'; end if;
  if v_qty not in (1, 5, 10, 99) then raise exception 'INVALID_QTY'; end if;
  if p_to_user is null or p_to_user = v_uid then raise exception 'CANNOT_GIFT_SELF'; end if;
  if not exists (select 1 from public.profiles where id = p_to_user) then raise exception 'USER_NOT_FOUND'; end if;
  if v_msg is not null and char_length(v_msg) > 140 then raise exception 'MESSAGE_TOO_LONG'; end if;
  if p_post_id is not null then
    v_club := (select cp.club_id from public.club_posts cp where cp.id = p_post_id and cp.deleted_at is null);
    v_author := (select cp.author_id from public.club_posts cp where cp.id = p_post_id and cp.deleted_at is null);
    if v_club is null or not public.club_is_member(v_club) or v_author is distinct from p_to_user then raise exception 'FORBIDDEN'; end if;
  end if;
  if p_activity_id is not null and not exists (select 1 from public.activities where id = p_activity_id and user_id = p_to_user) then
    raise exception 'FORBIDDEN';
  end if;

  v_total := g.price_xu * v_qty;
  perform pg_advisory_xact_lock(hashtextextended('gift:' || v_uid, 0));
  v_sent := coalesce((select sum(c.amount) from public.cheers c where c.from_user = v_uid and c.gift_code is not null
                       and c.created_at >= private.vn_start(private.vn_day(now()))), 0);
  if v_sent + v_total > coalesce((private.economy_config()->>'giftDailyCapXu')::int, 20000) then raise exception 'GIFT_DAILY_LIMIT'; end if;
  if private.balance(v_uid) < v_total then raise exception 'INSUFFICIENT_BALANCE'; end if;

  -- Đốt Xu: người tặng → hệ thống. Người nhận KHÔNG nhận Xu.
  perform private.ledger_post('GIFT', 'gift:' || p_idempotency_key, 'Tặng ' || v_qty || ' × ' || g.name || ' cho ' || private.display_name(p_to_user), v_uid,
    private.debit_entries(v_uid, v_total, private.system_account()));
  insert into public.cheers (from_user, to_user, amount, message, activity_id, post_id, club_id, idempotency_key, gift_code, qty)
  values (v_uid, p_to_user, v_total, v_msg, p_activity_id, p_post_id, v_club, p_idempotency_key, g.code, v_qty)
  returning id into v_id;
  if p_post_id is not null then update public.club_posts set cheer_xu = cheer_xu + v_total where id = p_post_id; end if;

  v_name := private.display_name(v_uid);
  perform private.award(p_to_user, 'GIFT_IN', v_name || ' tặng bạn ' || case when v_qty > 1 then v_qty || ' × ' else '' end || g.emoji || ' ' || g.name,
    v_msg, 0, 0, 'gift_in:' || v_id, p_activity_id, jsonb_build_object('from', v_uid, 'gift', g.code, 'emoji', g.emoji, 'qty', v_qty, 'tier', g.tier));
  perform private.notify(p_to_user, v_club, 'GIFT', v_name || ' tặng bạn ' || case when v_qty > 1 then v_qty || ' × ' else '' end || g.emoji || ' ' || g.name,
    coalesce(v_msg, g.description), case when p_activity_id is not null then '/activities/' || p_activity_id
                                         when v_club is not null then '/clubs/' || v_club else '/me' end, v_uid, g.tier in ('HYPE', 'LEGEND'));
  return jsonb_build_object('gift_id', v_id, 'total_xu', v_total, 'emoji', g.emoji, 'tier', g.tier, 'qty', v_qty, 'balance', private.balance(v_uid));
end $$;

-- Cổ vũ bằng Xu cũ (chuyển Xu cho người nhận) — ngừng: dùng quà tặng
create or replace function public.send_cheer(
  p_to_user uuid, p_amount numeric, p_message text default null, p_post_id uuid default null,
  p_activity_id uuid default null, p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'CHEER_REPLACED_BY_GIFTS';
end $$;

-- Tường quà trên hồ sơ: quà đã nhận (theo loại), điểm tỏa sáng, người tặng nhiều nhất
create or replace function public.gift_wall(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'shine', coalesce((select sum(c.amount) from public.cheers c where c.to_user = p_user and c.gift_code is not null), 0),
    'count', coalesce((select sum(c.qty) from public.cheers c where c.to_user = p_user and c.gift_code is not null), 0),
    'gifts', (select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'name', t.name, 'emoji', t.emoji, 'tier', t.tier, 'count', t.n)
                                         order by t.price desc), '[]'::jsonb)
                from (select g.code, g.name, g.emoji, g.tier, g.price_xu as price, sum(c.qty) as n
                        from public.cheers c join public.gift_catalog g on g.code = c.gift_code
                       where c.to_user = p_user group by g.code, g.name, g.emoji, g.tier, g.price_xu) t),
    'top_supporters', (select coalesce(jsonb_agg(jsonb_build_object('user_id', t.from_user, 'display_name', private.display_name(t.from_user),
                                                  'avatar_url', (select p.avatar_url from public.profiles p where p.id = t.from_user), 'shine', t.s)
                                                  order by t.s desc), '[]'::jsonb)
                         from (select c.from_user, sum(c.amount) as s, row_number() over (order by sum(c.amount) desc) as rn
                                 from public.cheers c where c.to_user = p_user and c.gift_code is not null group by c.from_user) t
                        where t.rn <= 5))
$$;

-- Admin: quản lý kho quà
create or replace function public.admin_save_gift(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_admin();
begin
  insert into public.gift_catalog (code, name, emoji, price_xu, tier, description, vip_tier, season_from, season_to, is_active, sort)
  values (lower(trim(p->>'code')), trim(p->>'name'), trim(p->>'emoji'), (p->>'price_xu')::int, upper(p->>'tier'), nullif(trim(coalesce(p->>'description', '')), ''),
          coalesce((p->>'vip_tier')::int, 0), nullif(p->>'season_from', '')::date, nullif(p->>'season_to', '')::date,
          coalesce((p->>'is_active')::boolean, true), coalesce((p->>'sort')::int, 0))
  on conflict (code) do update set name = excluded.name, emoji = excluded.emoji, price_xu = excluded.price_xu, tier = excluded.tier,
    description = excluded.description, vip_tier = excluded.vip_tier, season_from = excluded.season_from, season_to = excluded.season_to,
    is_active = excluded.is_active, sort = excluded.sort;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SAVE_GIFT', p->>'code', p);
end $$;

create or replace function public.admin_list_gifts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(g) || jsonb_build_object(
            'sent_30d', coalesce((select sum(c.qty) from public.cheers c where c.gift_code = g.code and c.created_at > now() - interval '30 days'), 0),
            'burn_30d', coalesce((select sum(c.amount) from public.cheers c where c.gift_code = g.code and c.created_at > now() - interval '30 days'), 0))
          order by g.sort, g.price_xu), '[]'::jsonb) from public.gift_catalog g);
end $$;

revoke all on function private.gift_in_season(public.gift_catalog, date), private.user_vip_tier(uuid) from public, anon, authenticated;
revoke all on function public.gift_catalog(), public.send_gift(uuid, text, integer, text, uuid, uuid, text), public.gift_wall(uuid),
  public.admin_save_gift(jsonb), public.admin_list_gifts() from public, anon;
grant execute on function public.gift_catalog(), public.send_gift(uuid, text, integer, text, uuid, uuid, text), public.gift_wall(uuid),
  public.admin_save_gift(jsonb), public.admin_list_gifts() to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001004000_vip_insights_metrics.sql
-- ===================================================================
-- 004000: Quyền lợi VIP thật (thay các dòng "sắp có") + chỉ số kinh tế cho admin.
-- • VIP1: my_trends() — xu hướng 12 tuần / 12 tháng (km, số buổi, thời gian, độ cao).
-- • VIP2: my_performance() — dữ liệu từng km để tính kỷ lục 1K → 42K và phân bố pace (tính ở máy khách);
--         my_challenge_templates() — thử thách mình đã tạo, dùng làm mẫu / nhân bản.
-- • VIP3: my_activity_export(from, to) — xuất toàn bộ bài chạy trong khoảng ngày (CSV / bản in PDF).
-- • Admin: admin_economy_metrics(months) — Xu phát ra / đốt / bán theo tháng, doanh thu, đơn hàng, lượt tạo, duyệt bài.
-- Kiểm tra quyền ở máy chủ: thiếu bậc VIP → VIP_REQUIRED (admin hệ thống luôn được xem).
-- Cần file 003900. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

create or replace function private.require_vip(p_tier integer) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  if not public.is_system_admin() and private.user_vip_tier(v_uid) < p_tier then raise exception 'VIP_REQUIRED'; end if;
  return v_uid;
end $$;

-- Bài được tính (đã duyệt, không xóa) của một người trong khoảng thời gian
create or replace function private.countable_runs(p_user uuid, p_from timestamptz, p_to timestamptz)
returns table (id uuid, started_at timestamptz, title text, source text, km numeric, moving_s integer, elapsed_s integer,
               elev_m numeric, avg_hr numeric, earned_xu numeric, earned_xp integer)
language sql stable security definer set search_path = public as $$
  select a.id, a.started_at, a.title, a.source,
         greatest(coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0), 0) / 1000.0,
         coalesce(a.moving_time_s, 0), coalesce(a.elapsed_time_s, 0), coalesce(a.elevation_gain_m, 0), a.avg_heartrate,
         coalesce(a.earned_xu, 0), coalesce(a.earned_xp, 0)
    from public.activities a
   where a.user_id = p_user and a.started_at >= p_from and a.started_at < p_to
     and public.activity_is_countable(a.status, a.validation_status) and a.validation_status = 'APPROVED'
$$;

-- ---------------------------------------------------------------------
-- VIP1: xu hướng tuần / tháng (giờ Việt Nam), đủ 12 kỳ kể cả kỳ không chạy
-- ---------------------------------------------------------------------
create or replace function public.my_trends() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_vip(1);
  v_today timestamp := (now() at time zone 'Asia/Ho_Chi_Minh');
  v_w0 timestamp := date_trunc('week', v_today) - interval '11 weeks';
  v_m0 timestamp := date_trunc('month', v_today) - interval '11 months';
begin
  return jsonb_build_object(
    'weeks', (select coalesce(jsonb_agg(jsonb_build_object('start', to_char(g.d, 'YYYY-MM-DD'), 'km', round(coalesce(s.km, 0), 2),
                'runs', coalesce(s.runs, 0), 'moving_s', coalesce(s.mv, 0), 'elev_m', round(coalesce(s.el, 0))) order by g.d), '[]'::jsonb)
                from generate_series(v_w0, date_trunc('week', v_today), interval '1 week') g(d)
                left join (select date_trunc('week', r.started_at at time zone 'Asia/Ho_Chi_Minh') as d, sum(r.km) as km, count(*) as runs,
                                  sum(r.moving_s) as mv, sum(r.elev_m) as el
                             from private.countable_runs(v_uid, v_w0 at time zone 'Asia/Ho_Chi_Minh', now() + interval '1 day') r group by 1) s on s.d = g.d),
    'months', (select coalesce(jsonb_agg(jsonb_build_object('start', to_char(g.d, 'YYYY-MM-DD'), 'km', round(coalesce(s.km, 0), 2),
                'runs', coalesce(s.runs, 0), 'moving_s', coalesce(s.mv, 0), 'elev_m', round(coalesce(s.el, 0))) order by g.d), '[]'::jsonb)
                from generate_series(v_m0, date_trunc('month', v_today), interval '1 month') g(d)
                left join (select date_trunc('month', r.started_at at time zone 'Asia/Ho_Chi_Minh') as d, sum(r.km) as km, count(*) as runs,
                                  sum(r.moving_s) as mv, sum(r.elev_m) as el
                             from private.countable_runs(v_uid, v_m0 at time zone 'Asia/Ho_Chi_Minh', now() + interval '1 day') r group by 1) s on s.d = g.d));
end $$;

-- ---------------------------------------------------------------------
-- VIP2: dữ liệu kỷ lục + pace — mỗi bài kèm thời gian từng km đủ (split ≥ 950 m), tối đa 1.000 bài gần nhất trong 3 năm
-- ---------------------------------------------------------------------
create or replace function public.my_performance() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_vip(2);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', t.id, 'started_at', t.started_at, 'title', t.title, 'km', round(t.km, 3), 'moving_s', t.moving_s,
            'splits', coalesce((select jsonb_agg((e->>'moving_s')::int order by ord)
                                  from public.activity_details d, jsonb_array_elements(d.splits) with ordinality as x(e, ord)
                                 where d.activity_id = t.id and coalesce((e->>'distance_m')::numeric, 0) >= 950
                                   and coalesce((e->>'moving_s')::numeric, 0) > 0), '[]'::jsonb))
            order by t.started_at desc), '[]'::jsonb)
            from (select r.*, row_number() over (order by r.started_at desc) as rn
                    from private.countable_runs(v_uid, now() - interval '3 years', now() + interval '1 day') r
                   where r.km >= 0.5 and r.moving_s > 0) t
           where t.rn <= 1000);
end $$;

-- VIP2: thử thách mình đã tạo (30 gần nhất) — đủ trường để dựng lại bản nháp trong trình tạo
create or replace function public.my_challenge_templates() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_vip(2);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', t.id, 'title', t.title, 'description', t.description, 'format', t.format, 'objective', t.objective,
            'game_mode', t.game_mode, 'target_value', t.target_value, 'min_km', t.min_km, 'min_pace', t.min_pace, 'max_pace', t.max_pace,
            'daily_cap_km', t.daily_cap_km, 'require_hr', t.require_hr, 'max_slots', t.max_slots, 'audience', t.target_audience,
            'club_id', t.target_club_id, 'team_size', t.fixed_team_size, 'reward_xu', t.reward_xu, 'reward_split', t.reward_split,
            'days', greatest(1, round(extract(epoch from (t.end_date - t.start_date)) / 86400)),
            'start_date', t.start_date, 'status', t.status,
            'pledge', jsonb_build_object('enabled', t.pledge_enabled, 'options', to_jsonb(coalesce(t.pledge_options, '{}'::numeric[])),
                                         'min_km', t.pledge_min_km, 'max_km', t.pledge_max_km, 'cap_pct', t.pledge_cap_pct, 'team_size', t.pledge_team_size),
            'team_names', (select coalesce(jsonb_agg(tm.name order by tm.position), '[]'::jsonb) from public.challenge_teams tm where tm.challenge_id = t.id))
            order by t.created_at desc), '[]'::jsonb)
            from (select c.*, row_number() over (order by c.created_at desc) as rn
                    from public.challenges c where c.created_by = v_uid and c.format is not null) t
           where t.rn <= 30);
end $$;

-- VIP3: xuất bài chạy trong khoảng ngày (tối đa 3 năm một lần)
create or replace function public.my_activity_export(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_vip(3);
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 1100 then raise exception 'INVALID_RANGE'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'started_at', r.started_at, 'title', r.title, 'source', r.source, 'km', round(r.km, 3), 'moving_s', r.moving_s,
            'elapsed_s', r.elapsed_s, 'elev_m', round(r.elev_m), 'avg_hr', round(r.avg_hr), 'xu', r.earned_xu, 'xp', r.earned_xp)
            order by r.started_at), '[]'::jsonb)
            from private.countable_runs(v_uid, private.vn_start(p_from), private.vn_start(p_to + 1)) r);
end $$;

-- ---------------------------------------------------------------------
-- Admin: chỉ số kinh tế theo tháng (giờ VN) + ảnh chụp hiện tại
-- ---------------------------------------------------------------------
create or replace function public.admin_economy_metrics(p_months integer default 6) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_sys uuid := private.system_account();
  v_n integer := least(greatest(coalesce(p_months, 6), 1), 24);
  v_m0 timestamp := date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') - make_interval(months => v_n - 1);
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'months', (select coalesce(jsonb_agg(jsonb_build_object(
        'month', to_char(g.m, 'YYYY-MM'),
        -- Xu phát ra cho người dùng (ròng, đã trừ thu hồi)
        'earn_run', coalesce(l.earn_run, 0), 'earn_game', coalesce(l.earn_game, 0), 'earn_referral', coalesce(l.earn_ref, 0),
        'earn_level', coalesce(l.earn_level, 0), 'admin_net', coalesce(l.admin_net, 0), 'purchased', coalesce(l.purchased, 0),
        -- Xu bị đốt (về hệ thống)
        'burn_fee', coalesce(l.burn_fee, 0), 'burn_gift', coalesce(l.burn_gift, 0), 'burn_shop', coalesce(l.burn_shop, 0),
        'revenue_vnd', coalesce(o.revenue, 0), 'revenue_plan_vnd', coalesce(o.rev_plan, 0), 'orders_paid', coalesce(o.paid, 0),
        'orders_created', coalesce(oc.created, 0), 'orders_expired', coalesce(oc.expired, 0), 'confirm_hours', o.confirm_h,
        'active_runners', coalesce(a.runners, 0), 'runs', coalesce(a.runs, 0), 'runs_review', coalesce(a.review, 0),
        'credits_issued', coalesce(c.issued, 0), 'credits_used', coalesce(c.used, 0),
        'subs_active', (select count(distinct s.owner_id) from public.subscriptions s
                         where s.starts_at <= least(now(), (g.m + interval '1 month') at time zone 'Asia/Ho_Chi_Minh')
                           and s.ends_at > least(now(), (g.m + interval '1 month') at time zone 'Asia/Ho_Chi_Minh') - interval '1 second'))
        order by g.m), '[]'::jsonb)
      from generate_series(v_m0, v_m0 + make_interval(months => v_n - 1), interval '1 month') g(m)
      left join (
        select date_trunc('month', t.created_at at time zone 'Asia/Ho_Chi_Minh') as m,
               sum(e.amount) filter (where e.account_id <> v_sys and t.type in ('RUN_REWARD', 'RUN_REWARD_REVERSAL')) as earn_run,
               sum(e.amount) filter (where e.account_id <> v_sys and (t.type like 'GAME\_%' escape '\')) as earn_game,
               sum(e.amount) filter (where e.account_id <> v_sys and t.type in ('REFERRAL_INVITER', 'REFERRAL_REFEREE')) as earn_ref,
               sum(e.amount) filter (where e.account_id <> v_sys and t.type = 'LEVEL_UP_XU') as earn_level,
               sum(e.amount) filter (where e.account_id <> v_sys and t.type in ('ADMIN_ADJUST', 'ADMIN_GRANT', 'ADMIN_DEDUCT', 'PROMO')) as admin_net,
               sum(e.amount) filter (where e.account_id <> v_sys and t.type in ('XU_PURCHASE', 'XU_PURCHASE_BONUS', 'IAP_TOPUP_VND')) as purchased,
               sum(e.amount) filter (where e.account_id = v_sys and t.type in ('CHALLENGE_CREATION_FEE', 'RACE_FEE')) as burn_fee,
               sum(e.amount) filter (where e.account_id = v_sys and t.type in ('GIFT', 'CHEER')) as burn_gift,
               sum(e.amount) filter (where e.account_id = v_sys and t.type in ('SHOP_SHIELD', 'SHOP_ITEM', 'SHOP_REFUND')) as burn_shop
          from public.ledger_transactions t join public.ledger_entries e on e.transaction_id = t.id
         where t.created_at >= v_m0 at time zone 'Asia/Ho_Chi_Minh'
         group by 1) l on l.m = g.m
      left join (
        select date_trunc('month', x.created_at at time zone 'Asia/Ho_Chi_Minh') as m, count(*) as created,
               count(*) filter (where x.status = 'PENDING' and x.expires_at <= now()) as expired
          from public.orders x where x.created_at >= v_m0 at time zone 'Asia/Ho_Chi_Minh' group by 1) oc on oc.m = g.m
      left join lateral (
        select sum(x.amount_vnd) as revenue, sum(x.amount_vnd) filter (where x.kind = 'PLAN') as rev_plan, count(*) as paid,
               round((avg(extract(epoch from (x.paid_at - x.created_at))) / 3600)::numeric, 1) as confirm_h
          from public.orders x
         where x.status = 'PAID' and date_trunc('month', x.paid_at at time zone 'Asia/Ho_Chi_Minh') = g.m) o on true
      left join (
        select date_trunc('month', x.started_at at time zone 'Asia/Ho_Chi_Minh') as m,
               count(distinct x.user_id) filter (where public.activity_is_countable(x.status, x.validation_status) and x.validation_status = 'APPROVED') as runners,
               count(*) as runs, count(*) filter (where x.validation_status = 'PENDING') as review
          from public.activities x where x.started_at >= v_m0 at time zone 'Asia/Ho_Chi_Minh' group by 1) a on a.m = g.m
      left join (
        select date_trunc('month', p.created_at at time zone 'Asia/Ho_Chi_Minh') as m, sum(p.total) as issued, sum(p.total - p.remaining) as used
          from public.challenge_passes p where p.source_key like 'credit:%' and p.created_at >= v_m0 at time zone 'Asia/Ho_Chi_Minh' group by 1) c on c.m = g.m),
    'snapshot', (select jsonb_build_object(
        'supply', coalesce(sum(b.bal), 0), 'holders', count(*) filter (where b.bal > 0),
        'median_balance', coalesce(percentile_cont(0.5) within group (order by b.bal) filter (where b.bal > 0), 0),
        'p90_balance', coalesce(percentile_cont(0.9) within group (order by b.bal) filter (where b.bal > 0), 0))
      from (select e.account_id, sum(e.amount) as bal from public.ledger_entries e join public.profiles p on p.id = e.account_id
             group by e.account_id) b),
    'config', private.economy_config());
end $$;

-- Quyền lợi đã có thật: bỏ chữ "(sắp có)" ở các dòng tương ứng — chỉ khi admin chưa sửa câu chữ
update public.plans set perks = replace(perks::text, '"Phân tích xu hướng tuần / tháng (sắp có)"', '"Phân tích xu hướng 12 tuần / 12 tháng"')::jsonb
 where perks::text like '%Phân tích xu hướng tuần / tháng (sắp có)%';
update public.plans set perks = replace(perks::text, '"Mẫu & nhân bản thử thách (sắp có)"', '"Nhân bản thử thách cũ làm mẫu"')::jsonb
 where perks::text like '%Mẫu & nhân bản thử thách (sắp có)%';
update public.plans set perks = replace(perks::text, '"PR 1K → 42K, phân bố pace (sắp có)"', '"Kỷ lục 1K → 42K, phân bố pace"')::jsonb
 where perks::text like '%PR 1K → 42K, phân bố pace (sắp có)%';
update public.plans set perks = replace(perks::text, '"Xuất báo cáo cá nhân PDF / Excel (sắp có)"', '"Xuất báo cáo cá nhân (in PDF, Excel CSV)"')::jsonb
 where perks::text like '%Xuất báo cáo cá nhân PDF / Excel (sắp có)%';

revoke all on function private.require_vip(integer), private.countable_runs(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.my_trends(), public.my_performance(), public.my_challenge_templates(), public.my_activity_export(date, date),
  public.admin_economy_metrics(integer) from public, anon;
grant execute on function public.my_trends(), public.my_performance(), public.my_challenge_templates(), public.my_activity_export(date, date),
  public.admin_economy_metrics(integer) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001004100_security_governance.sql
-- ===================================================================
-- 004100: Rà soát bảo mật + lưu vết không xóa được + sửa lệch kinh tế. Admin (SYSTEM_ADMIN) toàn quyền, không cần người thứ hai duyệt.
-- A. Bảo mật: khóa ghi trực tiếp vào các bảng cũ không còn dùng; bỏ quyền gọi hàm quản trị / CLB của khách chưa đăng nhập;
--    cố định search_path cho 3 hàm SECURITY DEFINER cũ; hàm cấp lượt hằng tháng chỉ cho máy chủ (service_role).
-- B. Lưu vết: nhật ký quản trị và sổ cái không sửa / xóa được (admin vẫn toàn quyền thao tác; chỉ là không xóa được dấu vết).
-- C. Kinh tế: bỏ XP thưởng khi chốt thử thách (XP chỉ từ km); thưởng từ quỹ CLB chỉ trao khi có ≥ 3 người có kết quả
--    (chống ban quản trị tự tạo thử thách rồi tự nhận quỹ), và mỗi lần treo tối đa 50% số dư quỹ.
-- Cần file 004000. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- A. Bảo mật
-- ---------------------------------------------------------------------
-- Bảng cũ (hệ thống quyền động, nhật ký cũ, mẫu cũ): app không ghi trực tiếp → thu quyền ghi (RLS đã chặn, đây là lớp thứ hai)
revoke insert, update, delete on public.achievements, public.audit_logs, public.challenge_templates, public.club_tournaments,
  public.permissions, public.roles, public.role_permissions, public.club_member_roles, public.club_announcements from anon, authenticated;
revoke delete on public.profiles, public.user_avatar from anon, authenticated;

-- Hàm SECURITY DEFINER cũ chưa cố định search_path (chống chiếm quyền bằng đối tượng trùng tên)
alter function public.delete_club(uuid, text) set search_path = public;
alter function public.delete_club(uuid) set search_path = public;
alter function public.equip_avatar_item(uuid, text) set search_path = public;
alter function public.execute_ledger_transaction(text, text, text, uuid, jsonb) set search_path = public;

-- Khách chưa đăng nhập không cần gọi các hàm quản trị / quản lý CLB (hàm vẫn tự kiểm tra, đây là lớp thứ hai)
revoke execute on function public.admin_set_club_plan(uuid, text, timestamptz, text), public.delete_club(uuid, text), public.delete_club(uuid),
  public.join_club(uuid), public.leave_club(uuid, uuid), public.remove_member(uuid), public.rotate_invite_code(uuid),
  public.set_club_announcement(uuid, text), public.set_club_slug(uuid, text), public.set_member_role(uuid, text),
  public.set_member_status(uuid, text), public.transfer_club_ownership(uuid, uuid), public.transfer_ownership(uuid, uuid),
  public.update_club(uuid, text, text, text, text), public.update_club_policy(uuid, text, integer),
  public.club_attendance_report(uuid, timestamptz, timestamptz), public.club_plan(uuid) from anon;

-- Việc định kỳ: chỉ máy chủ (cron) gọi
revoke execute on function public.issue_due_credits() from public, anon, authenticated;
grant execute on function public.issue_due_credits() to service_role;

-- ---------------------------------------------------------------------
-- B. Nhật ký quản trị và sổ cái: chỉ được thêm, không sửa / xóa (lưu vết, không giới hạn quyền admin)
-- ---------------------------------------------------------------------
create or replace function private.append_only() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'ledger_transactions' and tg_op = 'UPDATE'
     and to_jsonb(old)->>'approved_by' is null and (to_jsonb(new) - 'approved_by') = (to_jsonb(old) - 'approved_by') then
    return new;                                   -- ghi người duyệt ngay sau khi tạo giao dịch
  end if;
  raise exception 'APPEND_ONLY: % không được sửa hoặc xóa', tg_table_name;
end $$;
drop trigger if exists trg_append_only on public.admin_audit_log;
create trigger trg_append_only before update or delete on public.admin_audit_log for each row execute function private.append_only();
drop trigger if exists trg_append_only on public.ledger_entries;
create trigger trg_append_only before update or delete on public.ledger_entries for each row execute function private.append_only();
drop trigger if exists trg_append_only on public.ledger_transactions;
create trigger trg_append_only before update or delete on public.ledger_transactions for each row execute function private.append_only();

-- ---------------------------------------------------------------------
-- C1. Thưởng từ quỹ CLB: tối đa 50% số dư quỹ mỗi lần treo (chặn trước khi trừ quỹ)
-- ---------------------------------------------------------------------
create or replace function private.challenge_reward_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.reward_source = 'CREATOR' and coalesce(new.reward_xu, 0) > 0 then raise exception 'REWARD_NOT_ALLOWED'; end if;
  if new.reward_source = 'CLUB' and coalesce(new.reward_xu, 0) > 0 and new.target_club_id is not null
     and new.reward_xu > private.balance(new.target_club_id) * 0.5 then
    raise exception 'REWARD_TOO_LARGE';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- C2. Chốt thử thách: không cộng XP (XP chỉ từ km); thưởng quỹ CLB cần ≥ 3 người có kết quả, không thì hoàn quỹ
-- ---------------------------------------------------------------------
create or replace function private.settle_challenge(p_challenge_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id for update);
  v_pool numeric;
  v_users uuid[] := '{}';
  v_weights numeric[] := '{}';
  v_sumw numeric;
  v_amount numeric;
  v_paid numeric := 0;
  v_winners uuid[] := '{}';
  v_top numeric;
  v_names text;
  v_active integer;
  i integer;
  r record;
begin
  if c.id is null or c.status <> 'ACTIVE' or now() < c.end_date then return false; end if;

  update public.challenge_participants p set final_rank = x.rk
    from (select id, (rank() over (order by current_progress desc, completed_at asc nulls last))::int as rk
            from public.challenge_participants where challenge_id = c.id and status <> 'LEFT') x
   where p.id = x.id;

  if c.format = 'TEAM' then
    v_top := (select max(t.score) from private.challenge_team_scores(c.id) t);
    if coalesce(v_top, 0) > 0 then
      v_users := (select array_agg(p.profile_id) from public.challenge_participants p
                   where p.challenge_id = c.id and p.status <> 'LEFT'
                     and p.team_id in (select t.team_id from private.challenge_team_scores(c.id) t where t.score = v_top));
      v_weights := array_fill(1::numeric, array[coalesce(cardinality(v_users), 0)]);
      v_winners := v_users;
    end if;
  elsif c.format = 'SOLO_GOAL' then
    v_users := (select array_agg(profile_id) from public.challenge_participants where challenge_id = c.id and status <> 'LEFT' and completed_at is not null);
    v_weights := array_fill(1::numeric, array[coalesce(cardinality(v_users), 0)]);
  elsif c.format = 'COLLECTIVE' then
    if (select coalesce(sum(current_progress), 0) from public.challenge_participants where challenge_id = c.id and status <> 'LEFT') >= c.target_value then
      v_users := (select array_agg(profile_id) from public.challenge_participants where challenge_id = c.id and status <> 'LEFT' and current_progress > 0);
      v_weights := array_fill(1::numeric, array[coalesce(cardinality(v_users), 0)]);
    end if;
  elsif c.reward_split = 'TOP3' then
    v_users := (select array_agg(profile_id order by final_rank) from public.challenge_participants
                 where challenge_id = c.id and status <> 'LEFT' and final_rank <= 3 and current_progress > 0);
    v_weights := (select array_agg(case final_rank when 1 then 50 when 2 then 30 else 20 end::numeric order by final_rank) from public.challenge_participants
                   where challenge_id = c.id and status <> 'LEFT' and final_rank <= 3 and current_progress > 0);
    v_winners := (select array_agg(profile_id) from public.challenge_participants
                   where challenge_id = c.id and status <> 'LEFT' and final_rank = 1 and current_progress > 0);
  else
    v_users := (select array_agg(profile_id) from public.challenge_participants
                 where challenge_id = c.id and status <> 'LEFT' and final_rank = 1 and current_progress > 0);
    v_weights := array_fill(1::numeric, array[coalesce(cardinality(v_users), 0)]);
    v_winners := v_users;
  end if;
  v_users := coalesce(v_users, '{}'); v_weights := coalesce(v_weights, '{}'); v_winners := coalesce(v_winners, '{}');

  v_pool := case when c.reward_source <> 'NONE' then coalesce(c.reward_xu, 0) else 0 end;
  v_active := (select count(*) from public.challenge_participants where challenge_id = c.id and status <> 'LEFT' and current_progress > 0);
  if v_pool > 0 then
    if cardinality(v_users) = 0 or (c.reward_source = 'CLUB' and v_active < 3) then
      perform private.challenge_refund_escrow(c);
    else
      v_sumw := (select sum(w) from unnest(v_weights) w);
      for i in reverse cardinality(v_users) .. 1 loop
        v_amount := case when i = 1 then v_pool - v_paid else floor(v_pool * v_weights[i] / v_sumw * 10) / 10 end;
        if v_amount <= 0 then continue; end if;
        perform private.ledger_post('CHALLENGE_PRIZE', 'challenge_prize:' || c.id || ':' || v_users[i], 'Thưởng thử thách: ' || c.title, v_users[i],
          jsonb_build_array(jsonb_build_object('account_id', v_users[i], 'coin_kind', 'BONUS', 'amount', v_amount),
                            jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -v_amount)), c.id);
        update public.challenge_participants set reward_xu = reward_xu + v_amount where challenge_id = c.id and profile_id = v_users[i];
        v_paid := v_paid + v_amount;
      end loop;
    end if;
  end if;

  update public.challenges set status = 'FINISHED', settled_at = now() where id = c.id;

  for r in select profile_id, final_rank, reward_xu, completed_at from public.challenge_participants where challenge_id = c.id and status <> 'LEFT' loop
    perform private.notify(r.profile_id, c.target_club_id, 'CHALLENGE_RESULT', 'Kết quả: ' || c.title,
      case when r.profile_id = any(v_winners) then 'Chúc mừng! Bạn về nhất'
           when r.completed_at is not null then 'Bạn đã hoàn thành mục tiêu'
           else 'Bạn xếp hạng ' || r.final_rank end
      || case when r.reward_xu > 0 then ' · +' || r.reward_xu || ' Xu' else '' end,
      '/challenges/' || c.id, null, true);
  end loop;

  if c.target_club_id is not null then
    v_names := (select string_agg(private.display_name(u), ', ') from unnest(v_winners[1:5]) u);
    insert into public.club_posts (club_id, author_id, kind, title, body, meta)
    values (c.target_club_id, null, 'CHALLENGE', 'Kết quả: ' || c.title,
            case when v_names is not null then 'Chúc mừng ' || v_names || '!' else 'Thử thách đã kết thúc.' end
            || case when v_pool > 0 and v_paid = 0 then ' Thưởng đã hoàn lại quỹ CLB (cần ít nhất 3 người có kết quả).' else '' end,
            jsonb_build_object('challenge_id', c.id, 'result', true, 'format', c.format, 'reward_xu', v_paid));
  end if;
  return true;
end $$;

-- ---------------------------------------------------------------------
-- Quyền
-- ---------------------------------------------------------------------
revoke all on function private.append_only() from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001004200_form_comeback.sql
-- ===================================================================
-- 004200: Nghỉ dài ngày — KHÔNG hạ cấp. Cấp độ là thành tích trọn đời (XP chỉ tăng từ km, chỉ giảm khi bài bị thu hồi).
-- Thay vào đó:
-- • "Phong độ" (runner_form): trạng thái 28 ngày gần nhất — Đang lên / Ổn định / Chậm lại / Tạm nghỉ / Nghỉ dài / Chưa chạy.
--   Thứ hạng cạnh tranh vốn đã tự "hạ" theo thời gian: league tuần, bảng xếp hạng CLB theo tuần / tháng, chuỗi tuần.
-- • "Chào mừng trở lại": bài chạy hợp lệ đầu tiên sau ≥ minRestDays ngày nghỉ → +xu Xu (mặc định 28 ngày, 10 Xu),
--   mỗi người tối đa một lần mỗi cooldownDays ngày (mặc định 90) để không thành chỗ cày Xu. Thu hồi nếu bài bị hủy.
-- Cần file 004100 (và 003700 bản có COMEBACK). Chạy lại nhiều lần vẫn an toàn.

create or replace function private.runner_form(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with r as (
    select a.started_at, greatest(coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0), 0) / 1000.0 as km
      from public.activities a
     where a.user_id = p_user and a.validation_status = 'APPROVED' and public.activity_is_countable(a.status, a.validation_status)
  ), s as (
    select max(started_at) as last_at,
           coalesce(sum(km) filter (where started_at >= now() - interval '28 days'), 0) as km28,
           coalesce(sum(km) filter (where started_at >= now() - interval '56 days' and started_at < now() - interval '28 days'), 0) as km_prev,
           count(*) filter (where started_at >= now() - interval '28 days') as runs28
      from r
  )
  select jsonb_build_object(
    'status', case when s.last_at is null then 'NEW'
                   when s.last_at < now() - interval '60 days' then 'LONG_BREAK'
                   when s.last_at < now() - interval '21 days' then 'RESTING'
                   when s.last_at < now() - interval '7 days' then 'SLOWING'
                   when s.km_prev > 0 and s.km28 >= s.km_prev * 1.1 then 'RISING'
                   else 'STEADY' end,
    'last_run_at', s.last_at,
    'days_since', case when s.last_at is null then null else floor(extract(epoch from (now() - s.last_at)) / 86400)::int end,
    'km_28d', round(s.km28, 1), 'km_prev_28d', round(s.km_prev, 1), 'runs_28d', s.runs28,
    'comeback_xu', coalesce((private.economy_config()->'comeback'->>'xu')::numeric, 10),
    'comeback_days', coalesce((private.economy_config()->'comeback'->>'minRestDays')::int, 28))
  from s
$$;

-- Phong độ của mình hoặc người khác (chỉ trạng thái thô, không lộ bài chạy)
create or replace function public.runner_form(p_user uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  return private.runner_form(coalesce(p_user, v_uid));
end $$;

-- Thưởng quay lại: chạy khi bài được ghi nhận lần đầu (rewarded_at từ null → có giá trị)
create or replace function private.comeback_on_reward() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb := coalesce(private.economy_config()->'comeback', '{}'::jsonb);
  v_rest integer := coalesce((cfg->>'minRestDays')::int, 28);
  v_cool integer := coalesce((cfg->>'cooldownDays')::int, 90);
  v_xu numeric := coalesce((cfg->>'xu')::numeric, 10);
  v_prev timestamptz;
begin
  if new.user_id is null or old.rewarded_at is not null or new.rewarded_at is null or new.validation_status <> 'APPROVED' then return new; end if;
  v_prev := (select max(a.started_at) from public.activities a
              where a.user_id = new.user_id and a.id <> new.id and a.started_at < new.started_at
                and a.validation_status = 'APPROVED' and public.activity_is_countable(a.status, a.validation_status));
  if v_prev is null or new.started_at - v_prev < make_interval(days => v_rest) then return new; end if;
  if exists (select 1 from public.game_events g where g.user_id = new.user_id and g.kind = 'COMEBACK'
               and g.created_at > now() - make_interval(days => v_cool)) then return new; end if;
  perform private.award(new.user_id, 'COMEBACK', 'Chào mừng trở lại!',
    'Sau ' || floor(extract(epoch from (new.started_at - v_prev)) / 86400)::int || ' ngày nghỉ — chạy đều lại từ từ nhé',
    v_xu, 0, 'comeback:' || new.user_id || ':' || new.id, new.id,
    jsonb_build_object('rest_days', floor(extract(epoch from (new.started_at - v_prev)) / 86400)::int));
  return new;
end $$;
drop trigger if exists trg_comeback_on_reward on public.activities;
create trigger trg_comeback_on_reward after update of rewarded_at on public.activities
  for each row execute function private.comeback_on_reward();

revoke all on function private.runner_form(uuid), private.comeback_on_reward() from public, anon, authenticated;
revoke all on function public.runner_form(uuid) from public, anon;
grant execute on function public.runner_form(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001004300_admin_quests_promotions.sql
-- ===================================================================
-- 004300: Admin tạo nhiệm vụ có thưởng + khuyến mãi hàng loạt.
-- 1. Nhiệm vụ: admin tạo / sửa / tắt nhiệm vụ ngày, tuần, tháng hoặc SỰ KIỆN (trong một khoảng ngày), thưởng Xu khi hoàn thành.
--    Chỉ số mới: TOTAL_KM (tổng km trong kỳ), RUN_COUNT (số bài trong kỳ). Có thể giới hạn cho VIP từ bậc N.
--    XP vẫn chỉ đến từ km — nhiệm vụ chỉ thưởng Xu.
-- 2. Khuyến mãi (Quản trị → Khuyến mãi):
--    • GRANT — tặng hàng loạt theo nhóm người nhận (tất cả, đang chạy, lâu không chạy, người mới, VIP, gói miễn phí,
--      thành viên CLB, từ cấp N, danh sách chọn tay). Phần thưởng: Xu / lượt tạo / gói VIP. Mỗi người nhận một lần mỗi đợt.
--    • CODE — mã khuyến mãi người dùng tự nhập ở Ví (giới hạn tổng lượt, hạn dùng, chỉ cho nhóm nào). Chống dò mã: 10 lần sai / giờ.
--    • SALE — giảm giá gói (% ) và / hoặc tặng thêm Xu khi nạp (%) trong một khoảng thời gian; áp thẳng vào đơn hàng.
-- Cần file 004200. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 1. Nhiệm vụ do admin tạo
-- ---------------------------------------------------------------------
alter table public.quests add column if not exists starts_at timestamptz;
alter table public.quests add column if not exists ends_at timestamptz;
alter table public.quests add column if not exists min_vip_tier integer not null default 0;
alter table public.quests add column if not exists created_by uuid references public.profiles(id) on delete set null;
alter table public.quests drop constraint if exists quests_period_check;
alter table public.quests add constraint quests_period_check check (period in ('DAILY', 'WEEKLY', 'MONTHLY', 'EVENT'));
alter table public.quests drop constraint if exists quests_metric_check;
alter table public.quests add constraint quests_metric_check check (metric in ('CHECKIN', 'RUN_KM', 'CHEERS_SENT', 'WEEK_KM', 'WEEK_RUN_DAYS',
  'CHALLENGE_JOINS', 'CHEERS_RECEIVED', 'TOTAL_KM', 'RUN_COUNT'));

create or replace function private.quest_period_start(p_period text, p_starts timestamptz, p_at timestamptz) returns date
language sql stable security definer set search_path = public as $$
  select case p_period when 'DAILY' then private.vn_day(p_at) when 'WEEKLY' then private.vn_week(p_at)
              when 'MONTHLY' then date_trunc('month', private.vn_day(p_at))::date
              else coalesce(private.vn_day(p_starts), date '2000-01-01') end
$$;

create or replace function private.quest_progress(
  p_user uuid, p_metric text, p_value numeric, p_mode text default 'ADD', p_at timestamptz default now(), p_activity uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare q record; v_start date; v_prog numeric; v_done timestamptz; v_tier integer := private.user_vip_tier(p_user);
begin
  for q in select * from public.quests x where x.metric = p_metric and x.is_active
             and (x.starts_at is null or p_at >= x.starts_at) and (x.ends_at is null or p_at < x.ends_at)
             and x.min_vip_tier <= v_tier loop
    v_start := private.quest_period_start(q.period, q.starts_at, p_at);
    insert into public.user_quest_progress (user_id, quest_id, period_start) values (p_user, q.id, v_start) on conflict do nothing;
    update public.user_quest_progress
       set progress = case p_mode when 'ADD' then progress + p_value when 'MAX' then greatest(progress, p_value) else p_value end, updated_at = now()
     where user_id = p_user and quest_id = q.id and period_start = v_start
    returning progress, completed_at into v_prog, v_done;
    if v_done is null and v_prog >= q.target then
      update public.user_quest_progress set completed_at = now() where user_id = p_user and quest_id = q.id and period_start = v_start;
      perform private.award(p_user, 'QUEST', 'Nhiệm vụ: ' || q.title,
        case q.period when 'DAILY' then 'Nhiệm vụ ngày' when 'WEEKLY' then 'Nhiệm vụ tuần' when 'MONTHLY' then 'Nhiệm vụ tháng' else 'Nhiệm vụ sự kiện' end,
        q.reward_xu, 0, 'quest:' || q.id || ':' || p_user || ':' || v_start, p_activity,
        jsonb_build_object('quest_id', q.id, 'code', q.code, 'period', q.period, 'period_start', v_start, 'icon', q.icon));
    end if;
  end loop;
end $$;

-- Chỉ số mới: cộng dồn km và số bài theo kỳ của nhiệm vụ
create or replace function private.quest_totals_on_reward() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is null or old.rewarded_at is not null or new.rewarded_at is null or new.validation_status <> 'APPROVED' then return new; end if;
  begin
    perform private.quest_progress(new.user_id, 'TOTAL_KM', private.run_km(new), 'ADD', coalesce(new.started_at, now()), new.id);
    perform private.quest_progress(new.user_id, 'RUN_COUNT', 1, 'ADD', coalesce(new.started_at, now()), new.id);
  exception when others then
    raise warning 'quest_totals_on_reward % lỗi: % %', new.id, sqlstate, sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists trg_quest_totals_on_reward on public.activities;
create trigger trg_quest_totals_on_reward after update of rewarded_at on public.activities
  for each row execute function private.quest_totals_on_reward();

-- Nhiệm vụ của tôi (đúng kỳ, đang trong khung thời gian, có khóa VIP)
create or replace function public.my_quests() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); v_tier integer := private.user_vip_tier(v_uid);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', q.id, 'code', q.code, 'period', q.period, 'metric', q.metric, 'title', q.title, 'description', q.description, 'icon', q.icon,
            'target', q.target, 'reward_xu', q.reward_xu, 'starts_at', q.starts_at, 'ends_at', q.ends_at, 'min_vip_tier', q.min_vip_tier,
            'locked', q.min_vip_tier > v_tier, 'progress', least(coalesce(p.progress, 0), q.target), 'completed', p.completed_at is not null)
            order by case q.period when 'EVENT' then 0 when 'DAILY' then 1 when 'WEEKLY' then 2 else 3 end, q.sort, q.created_at), '[]'::jsonb)
            from public.quests q
            left join public.user_quest_progress p on p.quest_id = q.id and p.user_id = v_uid
                 and p.period_start = private.quest_period_start(q.period, q.starts_at, now())
           where q.is_active and (q.starts_at is null or q.starts_at <= now()) and (q.ends_at is null or q.ends_at > now()));
end $$;

create or replace function public.admin_list_quests() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(q) || jsonb_build_object(
            'completions', (select count(*) from public.user_quest_progress p where p.quest_id = q.id and p.completed_at is not null),
            'xu_paid', coalesce((select sum(e.xu) from public.game_events e where e.kind = 'QUEST' and e.payload->>'quest_id' = q.id::text), 0))
            order by q.is_active desc, q.created_at desc), '[]'::jsonb) from public.quests q);
end $$;

create or replace function public.admin_save_quest(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  v_id uuid := coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid());
  v_title text := trim(coalesce(p->>'title', ''));
  v_period text := upper(coalesce(p->>'period', 'DAILY'));
  v_metric text := upper(coalesce(p->>'metric', 'TOTAL_KM'));
  v_target numeric := (p->>'target')::numeric;
  v_xu numeric := round(coalesce((p->>'reward_xu')::numeric, 0), 1);
  v_start timestamptz := nullif(p->>'starts_at', '')::timestamptz;
  v_end timestamptz := nullif(p->>'ends_at', '')::timestamptz;
begin
  if char_length(v_title) not between 2 and 80 then raise exception 'INVALID_TITLE'; end if;
  if v_period not in ('DAILY', 'WEEKLY', 'MONTHLY', 'EVENT') then raise exception 'INVALID_PERIOD'; end if;
  if v_metric not in ('CHECKIN', 'RUN_KM', 'TOTAL_KM', 'RUN_COUNT', 'WEEK_KM', 'WEEK_RUN_DAYS', 'CHALLENGE_JOINS') then raise exception 'INVALID_METRIC'; end if;
  if v_metric in ('WEEK_KM', 'WEEK_RUN_DAYS') and v_period <> 'WEEKLY' then raise exception 'INVALID_METRIC'; end if;
  if v_target is null or v_target <= 0 or v_target > 100000 then raise exception 'INVALID_TARGET'; end if;
  if v_xu < 0 or v_xu > 100000 then raise exception 'INVALID_AMOUNT'; end if;
  if v_period = 'EVENT' and (v_start is null or v_end is null) then raise exception 'INVALID_TIME_RANGE'; end if;
  if v_end is not null and v_start is not null and (v_end <= v_start or v_end - v_start > interval '366 days') then raise exception 'INVALID_TIME_RANGE'; end if;
  insert into public.quests (id, code, period, metric, target, title, description, icon, reward_xu, reward_xp, sort, is_active, starts_at, ends_at, min_vip_tier, created_by)
  values (v_id, coalesce(nullif(p->>'code', ''), 'ADM_' || upper(substr(replace(v_id::text, '-', ''), 1, 8))), v_period, v_metric, v_target, v_title,
          nullif(trim(coalesce(p->>'description', '')), ''), coalesce(nullif(p->>'icon', ''), 'Target'), v_xu, 0, coalesce((p->>'sort')::int, 100),
          coalesce((p->>'is_active')::boolean, true), v_start, v_end, least(greatest(coalesce((p->>'min_vip_tier')::int, 0), 0), 3), v_uid)
  on conflict (id) do update set period = excluded.period, metric = excluded.metric, target = excluded.target, title = excluded.title,
    description = excluded.description, icon = excluded.icon, reward_xu = excluded.reward_xu, reward_xp = 0, sort = excluded.sort,
    is_active = excluded.is_active, starts_at = excluded.starts_at, ends_at = excluded.ends_at, min_vip_tier = excluded.min_vip_tier;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SAVE_QUEST', v_id::text, p);
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 2. Khuyến mãi
-- ---------------------------------------------------------------------
create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('GRANT', 'CODE', 'SALE')),
  title text not null check (char_length(title) between 2 and 120),
  message text check (message is null or char_length(message) <= 300),
  reward jsonb not null default '{}'::jsonb,          -- {xu, passes: {qty, max_slots, days}, plan: {code, months}}
  segment jsonb,                                      -- nhóm người nhận (GRANT) / được dùng mã (CODE)
  code text unique check (code is null or code ~ '^[A-Z0-9_-]{4,24}$'),
  max_uses integer check (max_uses is null or max_uses > 0),
  discount_pct integer not null default 0 check (discount_pct between 0 and 90),
  bonus_pct integer not null default 0 check (bonus_pct between 0 and 300),
  applies_to text not null default 'ALL' check (applies_to in ('ALL', 'PLAN', 'XU')),
  plan_code text references public.plans(code),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  is_active boolean not null default true,
  recipients integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.promotion_redemptions (
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (promotion_id, user_id)
);
create table if not exists private.promo_attempts (user_id uuid not null, at timestamptz not null default now());
create index if not exists promo_attempts_idx on private.promo_attempts (user_id, at);
alter table public.orders add column if not exists promotion_id uuid references public.promotions(id) on delete set null;
alter table public.orders add column if not exists list_price_vnd integer;
alter table public.promotions enable row level security;
alter table public.promotion_redemptions enable row level security;
revoke all on public.promotions, public.promotion_redemptions from anon, authenticated;
revoke all on private.promo_attempts from public, anon, authenticated;

-- Nhóm người nhận
create or replace function private.in_segment(p_user uuid, seg jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select case when seg is null or seg = 'null'::jsonb then true else
    case upper(coalesce(seg->>'type', 'ALL'))
      when 'ALL' then true
      when 'ACTIVE' then exists (select 1 from public.activities a where a.user_id = p_user and a.validation_status = 'APPROVED'
                                   and a.started_at >= now() - make_interval(days => coalesce((seg->>'days')::int, 30)))
      when 'INACTIVE' then exists (select 1 from public.activities a where a.user_id = p_user and a.validation_status = 'APPROVED')
                       and not exists (select 1 from public.activities a where a.user_id = p_user and a.validation_status = 'APPROVED'
                                   and a.started_at >= now() - make_interval(days => coalesce((seg->>'days')::int, 30)))
      when 'NEW' then (select p.created_at from public.profiles p where p.id = p_user) >= now() - make_interval(days => coalesce((seg->>'days')::int, 14))
      when 'VIP' then private.user_vip_tier(p_user) >= greatest(coalesce((seg->>'min_tier')::int, 1), 1)
      when 'FREE' then private.user_vip_tier(p_user) = 0
      when 'CLUB' then exists (select 1 from public.club_members m where m.user_id = p_user and m.status = 'APPROVED'
                                 and m.club_id = nullif(seg->>'club_id', '')::uuid)
      when 'LEVEL' then coalesce((select p.level from public.profiles p where p.id = p_user), 1) >= coalesce((seg->>'min_level')::int, 1)
      when 'USERS' then p_user::text in (select jsonb_array_elements_text(coalesce(seg->'ids', '[]'::jsonb)))
      else false end end
$$;

create or replace function private.valid_reward(r jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(coalesce(r, '{}'::jsonb)) = 'object'
     and coalesce((r->>'xu')::numeric, 0) between 0 and 1000000
     and (r->'passes' is null or r->'passes' = 'null'::jsonb or (
          coalesce((r->'passes'->>'qty')::int, 0) between 1 and 100 and coalesce((r->'passes'->>'max_slots')::int, 0) between 1 and 10000
          and coalesce((r->'passes'->>'days')::int, 30) between 1 and 365))
     and (r->'plan' is null or r->'plan' = 'null'::jsonb or ((r->'plan'->>'months')::int in (1, 3, 6, 12)))
     and (coalesce((r->>'xu')::numeric, 0) > 0 or (r->'passes' is not null and r->'passes' <> 'null'::jsonb)
          or (r->'plan' is not null and r->'plan' <> 'null'::jsonb))
$$;

-- Gói tặng phải là gói cá nhân (VIP), không phải CLB Pro
create or replace function private.reward_plan_ok(r jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select r->'plan' is null or r->'plan' = 'null'::jsonb
      or exists (select 1 from public.plans x where x.code = upper(r->'plan'->>'code') and x.owner_type = 'USER')
$$;

-- Trao phần thưởng một lần cho một người (khóa chống lặp theo đợt + người)
create or replace function private.give_promo_reward(pr public.promotions, p_user uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb := pr.reward; v_parts text[] := '{}';
begin
  if coalesce((r->>'xu')::numeric, 0) > 0 then
    perform private.ledger_post('PROMO', 'promo:' || pr.id || ':' || p_user, left(pr.title, 200), p_actor,
      jsonb_build_array(jsonb_build_object('account_id', p_user, 'coin_kind', 'BONUS', 'amount', (r->>'xu')::numeric),
                        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -(r->>'xu')::numeric)), pr.id);
    v_parts := v_parts || ((r->>'xu') || ' Xu');
  end if;
  if r->'passes' is not null and r->'passes' <> 'null'::jsonb then
    insert into public.challenge_passes (owner_type, owner_id, max_slots, total, remaining, expires_at, note, granted_by, source_key)
    values ('USER', p_user, (r->'passes'->>'max_slots')::int, (r->'passes'->>'qty')::int, (r->'passes'->>'qty')::int,
            now() + make_interval(days => coalesce((r->'passes'->>'days')::int, 30)), left(pr.title, 200), p_actor, 'promo:' || pr.id || ':' || p_user)
    on conflict (source_key) where source_key is not null do nothing;
    v_parts := v_parts || ((r->'passes'->>'qty') || ' lượt tạo ≤' || (r->'passes'->>'max_slots') || ' người');
  end if;
  if r->'plan' is not null and r->'plan' <> 'null'::jsonb then
    perform private.grant_subscription('USER', p_user, upper(r->'plan'->>'code'), (r->'plan'->>'months')::int, 'ADMIN', null, left(pr.title, 200), p_actor);
    v_parts := v_parts || ('gói ' || upper(r->'plan'->>'code') || ' ' || (r->'plan'->>'months') || ' tháng');
  end if;
  perform private.notify(p_user, null, 'PROMO', pr.title,
    coalesce(nullif(trim(coalesce(pr.message, '')), ''), 'Bạn nhận: ' || array_to_string(v_parts, ', ')), '/wallet', p_actor, true);
end $$;

create or replace function public.admin_preview_segment(p_segment jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select jsonb_build_object('count', count(*),
            'sample', coalesce(jsonb_agg(t.display_name) filter (where t.rn <= 5), '[]'::jsonb))
            from (select p.display_name, row_number() over (order by p.created_at desc) as rn
                    from public.profiles p where private.in_segment(p.id, p_segment)) t);
end $$;

-- Tặng hàng loạt: tạo đợt + trao ngay cho mọi người trong nhóm (tối đa 50.000 người mỗi đợt)
create or replace function public.admin_run_grant(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  pr public.promotions;
  u record;
  n integer := 0;
begin
  if not private.valid_reward(p->'reward') or not private.reward_plan_ok(p->'reward') then raise exception 'INVALID_REWARD'; end if;
  if (select count(*) from public.profiles x where private.in_segment(x.id, p->'segment')) > 50000 then raise exception 'SEGMENT_TOO_LARGE'; end if;
  insert into public.promotions (kind, title, message, reward, segment, created_by)
  values ('GRANT', trim(coalesce(p->>'title', '')), nullif(trim(coalesce(p->>'message', '')), ''), p->'reward', coalesce(p->'segment', '{"type":"ALL"}'::jsonb), v_uid)
  returning * into pr;
  for u in select x.id from public.profiles x where private.in_segment(x.id, pr.segment) loop
    insert into public.promotion_redemptions (promotion_id, user_id) values (pr.id, u.id) on conflict do nothing;
    if found then
      perform private.give_promo_reward(pr, u.id, v_uid);
      n := n + 1;
    end if;
  end loop;
  update public.promotions set recipients = n where id = pr.id;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'PROMO_GRANT', pr.id::text, p || jsonb_build_object('recipients', n));
  return jsonb_build_object('promotion_id', pr.id, 'recipients', n);
end $$;

-- Mã khuyến mãi / đợt giảm giá: tạo, sửa, bật tắt
create or replace function public.admin_save_promo(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  v_id uuid := coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid());
  v_kind text := upper(coalesce(p->>'kind', ''));
  v_code text := nullif(upper(trim(coalesce(p->>'code', ''))), '');
begin
  if v_kind not in ('CODE', 'SALE') then raise exception 'INVALID_KIND'; end if;
  if v_kind = 'CODE' and (v_code is null or not private.valid_reward(p->'reward') or not private.reward_plan_ok(p->'reward')) then raise exception 'INVALID_REWARD'; end if;
  if v_kind = 'SALE' and coalesce((p->>'discount_pct')::int, 0) = 0 and coalesce((p->>'bonus_pct')::int, 0) = 0 then raise exception 'INVALID_SALE'; end if;
  insert into public.promotions (id, kind, title, message, reward, segment, code, max_uses, discount_pct, bonus_pct, applies_to, plan_code,
                                 starts_at, ends_at, is_active, created_by)
  values (v_id, v_kind, trim(coalesce(p->>'title', '')), nullif(trim(coalesce(p->>'message', '')), ''),
          case when v_kind = 'CODE' then p->'reward' else '{}'::jsonb end, case when p->'segment' = 'null'::jsonb then null else p->'segment' end,
          case when v_kind = 'CODE' then v_code end, nullif(p->>'max_uses', '')::int,
          coalesce((p->>'discount_pct')::int, 0), coalesce((p->>'bonus_pct')::int, 0), upper(coalesce(p->>'applies_to', 'ALL')),
          nullif(p->>'plan_code', ''), coalesce(nullif(p->>'starts_at', '')::timestamptz, now()), nullif(p->>'ends_at', '')::timestamptz,
          coalesce((p->>'is_active')::boolean, true), v_uid)
  on conflict (id) do update set title = excluded.title, message = excluded.message, reward = excluded.reward, segment = excluded.segment,
    code = excluded.code, max_uses = excluded.max_uses, discount_pct = excluded.discount_pct, bonus_pct = excluded.bonus_pct,
    applies_to = excluded.applies_to, plan_code = excluded.plan_code, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
    is_active = excluded.is_active;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SAVE_PROMO', v_id::text, p);
  return v_id;
end $$;

create or replace function public.admin_list_promotions() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(x) || jsonb_build_object('creator', private.display_name(x.created_by),
            'orders', (select count(*) from public.orders o where o.promotion_id = x.id and o.status = 'PAID')) order by x.created_at desc), '[]'::jsonb)
            from public.promotions x);
end $$;

-- Người dùng nhập mã
create or replace function public.redeem_promo_code(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  pr public.promotions := (select x from public.promotions x where x.kind = 'CODE' and x.code = upper(trim(coalesce(p_code, ''))) for update);
begin
  if (select count(*) from private.promo_attempts a where a.user_id = v_uid and a.at > now() - interval '1 hour') >= 10 then
    raise exception 'TOO_MANY_ATTEMPTS';
  end if;
  if pr.id is null or not pr.is_active or pr.starts_at > now() or (pr.ends_at is not null and pr.ends_at <= now()) then
    insert into private.promo_attempts (user_id) values (v_uid);     -- trả lỗi (không raise) để lần thử sai được ghi lại
    return jsonb_build_object('error', 'PROMO_INVALID');
  end if;
  if pr.max_uses is not null and pr.recipients >= pr.max_uses then raise exception 'PROMO_USED_UP'; end if;
  if not private.in_segment(v_uid, pr.segment) then raise exception 'PROMO_NOT_ELIGIBLE'; end if;
  insert into public.promotion_redemptions (promotion_id, user_id) values (pr.id, v_uid) on conflict do nothing;
  if not found then raise exception 'PROMO_ALREADY_USED'; end if;
  perform private.give_promo_reward(pr, v_uid, null);
  update public.promotions set recipients = recipients + 1 where id = pr.id;
  return jsonb_build_object('title', pr.title, 'reward', pr.reward, 'balance', private.balance(v_uid));
end $$;

-- Đợt giảm giá đang chạy tốt nhất cho một món (gói hoặc nạp Xu)
create or replace function private.best_sale(p_kind text, p_plan text) returns public.promotions
language sql stable security definer set search_path = public as $$
  select t.x from (select x, row_number() over (order by x.discount_pct desc, x.bonus_pct desc, x.created_at desc) as rn
                     from public.promotions x
                    where x.kind = 'SALE' and x.is_active and x.starts_at <= now() and (x.ends_at is null or x.ends_at > now())
                      and x.applies_to in ('ALL', p_kind) and (x.plan_code is null or x.plan_code = p_plan)) t
   where t.rn = 1
$$;

create or replace function public.active_sales() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'message', x.message, 'discount_pct', x.discount_pct,
           'bonus_pct', x.bonus_pct, 'applies_to', x.applies_to, 'plan_code', x.plan_code, 'ends_at', x.ends_at) order by x.discount_pct desc), '[]'::jsonb)
    from public.promotions x
   where x.kind = 'SALE' and x.is_active and x.starts_at <= now() and (x.ends_at is null or x.ends_at > now())
$$;

-- Đơn hàng áp đợt giảm giá / tặng thêm Xu (thay bản 003800)
create or replace function public.create_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_kind text := upper(coalesce(p->>'kind', ''));
  v_plan public.plans := (select x from public.plans x where x.code = p->>'plan_code' and x.active);
  v_months integer := coalesce((p->>'months')::int, 1);
  v_list integer;
  v_price integer;
  v_pkg public.xu_packages := (select x from public.xu_packages x where x.id = nullif(p->>'package_id', '')::uuid and x.active);
  v_owner uuid;
  v_owner_type text;
  v_sale public.promotions;
  v_bonus integer;
  v_id uuid := gen_random_uuid();
begin
  if (select count(*) from public.orders o where o.buyer_id = v_uid and o.status = 'PENDING' and o.expires_at > now()) >= 5 then
    raise exception 'TOO_MANY_PENDING_ORDERS';
  end if;
  if v_kind = 'PLAN' then
    if v_plan.code is null then raise exception 'INVALID_PLAN'; end if;
    v_list := (select pp.price_vnd from public.plan_prices pp where pp.plan_code = v_plan.code and pp.months = v_months and pp.active);
    if v_list is null then raise exception 'INVALID_MONTHS'; end if;
    v_owner_type := v_plan.owner_type;
    if v_owner_type = 'CLUB' then
      v_owner := nullif(p->>'club_id', '')::uuid;
      if v_owner is null or not public.club_is_staff(v_owner) then raise exception 'CLUB_STAFF_REQUIRED'; end if;
    else
      v_owner := v_uid;
    end if;
    v_sale := private.best_sale('PLAN', v_plan.code);
    v_price := greatest(1000, (round(v_list * (100 - coalesce(v_sale.discount_pct, 0)) / 100.0 / 1000) * 1000)::int);
    insert into public.orders (id, code, buyer_id, kind, plan_code, months, owner_type, owner_id, amount_vnd, list_price_vnd, promotion_id)
    values (v_id, 'RH' || nextval('public.order_code_seq'), v_uid, 'PLAN', v_plan.code, v_months, v_owner_type, v_owner, v_price, v_list,
            case when coalesce(v_sale.discount_pct, 0) > 0 then v_sale.id end);
  elsif v_kind = 'XU' then
    if v_pkg.id is null then raise exception 'INVALID_PACKAGE'; end if;
    v_sale := private.best_sale('XU', null);
    v_price := greatest(1000, (round(v_pkg.price_vnd * (100 - coalesce(v_sale.discount_pct, 0)) / 100.0 / 1000) * 1000)::int);
    v_bonus := v_pkg.bonus_xu + floor(v_pkg.xu * coalesce(v_sale.bonus_pct, 0) / 100.0)::int;
    insert into public.orders (id, code, buyer_id, kind, package_id, owner_type, owner_id, amount_vnd, xu, bonus_xu, list_price_vnd, promotion_id)
    values (v_id, 'RH' || nextval('public.order_code_seq'), v_uid, 'XU', v_pkg.id, 'USER', v_uid, v_price, v_pkg.xu, v_bonus, v_pkg.price_vnd,
            case when coalesce(v_sale.discount_pct, 0) > 0 or coalesce(v_sale.bonus_pct, 0) > 0 then v_sale.id end);
  else
    raise exception 'INVALID_ORDER';
  end if;
  return private.order_json((select o from public.orders o where o.id = v_id));
end $$;

-- ---------------------------------------------------------------------
-- Quyền
-- ---------------------------------------------------------------------
revoke all on function private.quest_period_start(text, timestamptz, timestamptz), private.quest_totals_on_reward(),
  private.in_segment(uuid, jsonb), private.valid_reward(jsonb), private.reward_plan_ok(jsonb), private.give_promo_reward(public.promotions, uuid, uuid),
  private.best_sale(text, text) from public, anon, authenticated;
revoke all on function public.my_quests(), public.admin_list_quests(), public.admin_save_quest(jsonb), public.admin_preview_segment(jsonb),
  public.admin_run_grant(jsonb), public.admin_save_promo(jsonb), public.admin_list_promotions(), public.redeem_promo_code(text),
  public.active_sales() from public, anon;
grant execute on function public.my_quests(), public.admin_list_quests(), public.admin_save_quest(jsonb), public.admin_preview_segment(jsonb),
  public.admin_run_grant(jsonb), public.admin_save_promo(jsonb), public.admin_list_promotions(), public.redeem_promo_code(text),
  public.active_sales() to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001004400_system_notice_client_errors.sql
-- ===================================================================
-- 004400: Thông báo hệ thống + nhật ký lỗi phía người dùng.
-- 1. Admin đặt một thông báo chung (thông tin / cảnh báo / bảo trì) hiện ở đầu app cho mọi người, có hạn tự tắt.
--    public.system_notice() đọc được cả khi chưa đăng nhập (màn đăng nhập cũng thấy thông báo bảo trì).
-- 2. App tự gửi lỗi người dùng gặp (mất kết nối máy chủ, máy chủ lỗi, tính năng chưa cập nhật…) về đây, gộp theo
--    mã lỗi mỗi ngày — admin xem ở Quản trị → Hệ thống để biết sự cố trước khi người dùng báo.
--    Chống spam: mỗi người tối đa 30 lần gửi / giờ, toàn hệ thống tối đa 2.000 mã lỗi khác nhau / ngày.
-- Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 1. Thông báo hệ thống
-- ---------------------------------------------------------------------
create table if not exists private.system_notice (
  id integer primary key default 1 check (id = 1),
  level text not null check (level in ('INFO', 'WARNING', 'MAINTENANCE')),
  title text not null,
  message text,
  until timestamptz,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
revoke all on private.system_notice from public, anon, authenticated;

create or replace function public.system_notice() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('level', n.level, 'title', n.title, 'message', n.message, 'until', n.until, 'updated_at', n.updated_at)
  from private.system_notice n
  where n.id = 1 and (n.until is null or n.until > now())
$$;

create or replace function public.admin_set_system_notice(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  v_level text := upper(coalesce(p->>'level', ''));
  v_title text := trim(coalesce(p->>'title', ''));
  v_msg text := nullif(trim(coalesce(p->>'message', '')), '');
  v_until timestamptz := nullif(p->>'until', '')::timestamptz;
begin
  -- Gửi rỗng / level trống = tắt thông báo
  if p is null or v_level = '' then
    delete from private.system_notice where id = 1;
    insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SYSTEM_NOTICE_OFF', 'system_notice', '{}'::jsonb);
    return null;
  end if;
  if v_level not in ('INFO', 'WARNING', 'MAINTENANCE') then raise exception 'INVALID_LEVEL'; end if;
  if char_length(v_title) not between 2 and 80 then raise exception 'INVALID_TITLE'; end if;
  if char_length(coalesce(v_msg, '')) > 500 then raise exception 'INVALID_MESSAGE'; end if;
  if v_until is not null and v_until <= now() then raise exception 'INVALID_TIME_RANGE'; end if;
  insert into private.system_notice (id, level, title, message, until, updated_by, updated_at)
  values (1, v_level, v_title, v_msg, v_until, v_uid, now())
  on conflict (id) do update set level = excluded.level, title = excluded.title, message = excluded.message,
    until = excluded.until, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SYSTEM_NOTICE', 'system_notice', p);
  return public.system_notice();
end $$;

revoke all on function public.system_notice(), public.admin_set_system_notice(jsonb) from public;
grant execute on function public.system_notice() to anon, authenticated;
revoke all on function public.admin_set_system_notice(jsonb) from anon;
grant execute on function public.admin_set_system_notice(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Nhật ký lỗi phía người dùng (gộp theo ngày + mã lỗi)
-- ---------------------------------------------------------------------
create table if not exists private.client_errors (
  day date not null,
  code text not null,
  kind text not null,
  message text,
  path text,
  hits integer not null default 1,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  primary key (day, code)
);
create table if not exists private.client_error_users (
  day date not null,
  code text not null,
  user_id uuid not null,
  primary key (day, code, user_id)
);
create table if not exists private.client_error_hits (user_id uuid not null, at timestamptz not null default now());
create index if not exists client_error_hits_idx on private.client_error_hits (user_id, at);
revoke all on private.client_errors, private.client_error_users, private.client_error_hits from public, anon, authenticated;

create or replace function public.log_client_error(p_kind text, p_code text, p_message text default null, p_path text default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_day date := private.vn_day(now());
  v_kind text := upper(coalesce(p_kind, ''));
  v_code text := left(coalesce(p_code, ''), 16);
begin
  if v_uid is null then return false; end if;
  if v_kind not in ('OFFLINE', 'NETWORK', 'TIMEOUT', 'AUTH', 'FORBIDDEN', 'NOT_DEPLOYED', 'RATE_LIMIT', 'SERVER', 'UNKNOWN') then return false; end if;
  if v_code !~ '^[A-Z]{3}-[0-9A-Z]{3}$' then return false; end if;
  delete from private.client_error_hits where user_id = v_uid and at < now() - interval '1 hour';
  if (select count(*) from private.client_error_hits h where h.user_id = v_uid) >= 30 then return false; end if;
  if not exists (select 1 from private.client_errors e where e.day = v_day and e.code = v_code)
     and (select count(*) from private.client_errors e where e.day = v_day) >= 2000 then return false; end if;
  insert into private.client_error_hits (user_id) values (v_uid);
  insert into private.client_errors (day, code, kind, message, path)
  values (v_day, v_code, v_kind, left(p_message, 300), left(p_path, 120))
  on conflict (day, code) do update set hits = private.client_errors.hits + 1, last_at = now(),
    message = coalesce(excluded.message, private.client_errors.message), path = coalesce(excluded.path, private.client_errors.path);
  insert into private.client_error_users (day, code, user_id) values (v_day, v_code, v_uid) on conflict do nothing;
  -- Dọn dữ liệu cũ hơn 60 ngày
  delete from private.client_errors where day < v_day - 60;
  delete from private.client_error_users where day < v_day - 60;
  return true;
end $$;

create or replace function public.admin_client_errors(p_days integer default 7) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  v_from date := private.vn_day(now()) - (least(greatest(coalesce(p_days, 7), 1), 60) - 1);
begin
  return (
    select coalesce(jsonb_agg(to_jsonb(r) - 'rn' order by r.last_at desc), '[]'::jsonb)
    from (
      select g.*, row_number() over (order by g.last_at desc) rn
      from (
        select e.code, max(e.kind) kind, (array_agg(e.message order by e.last_at desc))[1] message,
               (array_agg(e.path order by e.last_at desc))[1] path, sum(e.hits)::integer hits,
               (select count(distinct u.user_id) from private.client_error_users u where u.code = e.code and u.day >= v_from)::integer users,
               count(*)::integer days, min(e.first_at) first_at, max(e.last_at) last_at
        from private.client_errors e
        where e.day >= v_from
        group by e.code
      ) g
    ) r
    where r.rn <= 200);
end $$;

revoke all on function public.log_client_error(text, text, text, text), public.admin_client_errors(integer) from public, anon;
grant execute on function public.log_client_error(text, text, text, text), public.admin_client_errors(integer) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001004500_run_synced_notify.sql
-- ===================================================================
-- 004500: "Bài chạy đã về" — chạy bằng đồng hồ / Strava xong là điện thoại báo ngay.
-- Khi một bài từ Strava / Garmin / COROS được cộng thưởng (hoặc được duyệt sau khi chờ xác minh), gửi một thông báo
-- (chuông + đẩy lên điện thoại) kèm km, pace, Xu, XP và số phần thưởng khác; bấm vào mở trang chủ và bật màn nhận thưởng.
-- Bài ghi bằng app không cần (người chạy đang xem màn tổng kết). Bài cũ hơn 2 ngày (nhập lại lịch sử) không báo.
-- Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

create or replace function private.pace_text(p_seconds numeric) returns text
language sql immutable as $$
  select case when p_seconds is null or p_seconds <= 0 or p_seconds > 3600 then null
              else floor(p_seconds / 60)::int || ':' || lpad((round(p_seconds)::int % 60)::text, 2, '0') end
$$;

create or replace function private.run_synced_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_km numeric;
  v_xu numeric;
  v_xp numeric;
  v_more integer;
  v_pace text;
  v_body text;
begin
  if new.user_id is null or new.source_activity_id is null or new.source = 'DIRECT_GPS' then return new; end if;
  if coalesce(new.started_at, now()) < now() - interval '2 days' then return new; end if;
  begin
    v_km := private.run_km(new);
    -- Trigger này tên "zz" nên chạy sau các trigger cộng thưởng khác (thẻ bài chạy, nhiệm vụ, chuỗi, huy hiệu…)
    v_xu := (select coalesce(sum(e.xu), 0) from public.game_events e where e.activity_id = new.id and e.kind <> 'CHEER_IN');
    v_xp := (select coalesce(sum(e.xp), 0) from public.game_events e where e.activity_id = new.id);
    v_more := (select count(*) from public.game_events e where e.activity_id = new.id and e.kind <> 'RUN');
    v_pace := private.pace_text(case when v_km > 0 then coalesce(nullif(new.moving_time_s, 0), new.elapsed_time_s) / v_km end);
    v_body := concat_ws(' · ',
      case when v_pace is not null then 'Pace ' || v_pace || '/km' end,
      case when v_xu > 0 then '+' || replace(trim_scale(round(v_xu, 1))::text, '.', ',') || ' Xu' end,
      case when v_xp > 0 then '+' || round(v_xp)::text || ' XP' end,
      case when v_more > 0 then v_more || ' phần thưởng khác' end);
    perform private.notify(new.user_id, null, 'RUN_SYNCED',
      'Bài chạy ' || replace(to_char(round(v_km, 2), 'FM999990.00'), '.', ',') || ' km đã về RaceHub',
      coalesce(nullif(v_body, ''), 'Mở app để xem tổng kết.'), '/feed?rewards=1', null, true);
  exception when others then
    raise warning 'run_synced_notify % lỗi: % %', new.id, sqlstate, sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists trg_zz_run_synced on public.activities;
create trigger trg_zz_run_synced after update of rewarded_at on public.activities
  for each row when (old.rewarded_at is null and new.rewarded_at is not null)
  execute function private.run_synced_notify();

revoke all on function private.run_synced_notify(), private.pace_text(numeric) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001004600_quest_engine_v2.sql
-- ===================================================================
-- 004600: Nhiệm vụ v2 — động lực xỏ giày mỗi ngày / tuần / sự kiện.
-- 1. Nhiệm vụ BẬC: "Chạy 3 / 5 / 10 km" — chỉ trả tới bậc cao nhất đạt được (không cộng dồn nhiều nhiệm vụ trùng nhau).
-- 2. Kỳ MỘT LẦN (ONCE): nhiệm vụ cho người mới / cột mốc, tính từ lúc tạo nhiệm vụ.
-- 3. Chỉ số mới: số ngày chạy trong kỳ (mọi kỳ), số bài cuối tuần, số bài chạy sớm (trước N giờ), số thử thách
--    hoàn thành, km CỘNG ĐỒNG (cả RaceHub cùng chạy tới mục tiêu; ai góp ≥ N km đều nhận thưởng).
--    Tham số: min_km (bài tính từ bao nhiêu km, mặc định 1), before_hour (chạy sớm trước mấy giờ, mặc định 7).
-- 4. Thưởng ngoài Xu: vật phẩm nhân vật, huy hiệu sự kiện (giới hạn), lượt tạo thử thách. KHÔNG có XP (XP chỉ từ km).
-- 5. Trần Xu từ nhiệm vụ: ngày 5 Xu, tuần 25 Xu (chỉnh ở Quản trị → Nhiệm vụ). Tối đa nhiệm vụ đang bật:
--    ngày 3, tuần 4, tháng 5, sự kiện 6, một lần 6 — người dùng không bị ngợp.
-- 6. Admin: số liệu gợi ý (runner hoạt động, phân bố km / ngày chạy…) và ước tính số người hoàn thành + Xu chi ra
--    trước khi đăng nhiệm vụ.
-- Cần file 004500. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 1. Bảng
-- ---------------------------------------------------------------------
alter table public.quests add column if not exists category text not null default 'RUN';
alter table public.quests add column if not exists params jsonb not null default '{}'::jsonb;
alter table public.quests add column if not exists tiers jsonb;            -- [{"target": 3, "xu": 1}, {"target": 5, "xu": 2}, …] tăng dần
alter table public.quests add column if not exists reward_item text;       -- avatar_items.code
alter table public.quests add column if not exists reward_badge jsonb;     -- {"title", "icon", "tier"}
alter table public.quests add column if not exists reward_passes jsonb;    -- {"qty", "max_slots", "days"}
alter table public.user_quest_progress add column if not exists tier_paid integer not null default 0;

alter table public.quests drop constraint if exists quests_period_check;
alter table public.quests add constraint quests_period_check check (period in ('DAILY', 'WEEKLY', 'MONTHLY', 'EVENT', 'ONCE'));
alter table public.quests drop constraint if exists quests_metric_check;
alter table public.quests add constraint quests_metric_check check (metric in ('CHECKIN', 'RUN_KM', 'CHEERS_SENT', 'WEEK_KM', 'WEEK_RUN_DAYS',
  'CHALLENGE_JOINS', 'CHEERS_RECEIVED', 'TOTAL_KM', 'RUN_COUNT', 'ACTIVE_DAYS', 'WEEKEND_RUNS', 'EARLY_RUNS', 'CHALLENGE_FINISHES', 'COMMUNITY_KM'));
alter table public.quests drop constraint if exists quests_category_check;
alter table public.quests add constraint quests_category_check check (category in ('RUN', 'CONSISTENCY', 'CHALLENGE', 'COMMUNITY', 'NEWBIE', 'SOCIAL'));

-- Giới hạn chỉnh được (lưu ở private.app_settings, key quest_limits)
create or replace function private.quest_limits() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('dailyXuCap', 5, 'weeklyXuCap', 25, 'maxDaily', 3, 'maxWeekly', 4, 'maxMonthly', 5, 'maxEvent', 6, 'maxOnce', 6)
      || coalesce((select value::jsonb from private.app_settings where key = 'quest_limits'), '{}'::jsonb)
$$;

create or replace function private.quest_period_start(p_period text, p_starts timestamptz, p_at timestamptz) returns date
language sql stable security definer set search_path = public as $$
  select case p_period when 'DAILY' then private.vn_day(p_at) when 'WEEKLY' then private.vn_week(p_at)
              when 'MONTHLY' then date_trunc('month', private.vn_day(p_at))::date
              when 'ONCE' then date '2000-01-01'
              else coalesce(private.vn_day(p_starts), date '2000-01-01') end
$$;

-- Khung thời gian tính của một nhiệm vụ trong kỳ bắt đầu p_start
create or replace function private.quest_window_from(q public.quests, p_start date) returns timestamptz
language sql stable security definer set search_path = public as $$
  select greatest(case q.period when 'ONCE' then coalesce(q.starts_at, q.created_at) when 'EVENT' then coalesce(q.starts_at, q.created_at)
                              else private.vn_start(p_start) end,
                  coalesce(q.starts_at, '-infinity'::timestamptz))
$$;
create or replace function private.quest_window_to(q public.quests, p_start date) returns timestamptz
language sql stable security definer set search_path = public as $$
  select least(case q.period when 'DAILY' then private.vn_start(p_start + 1) when 'WEEKLY' then private.vn_start(p_start + 7)
                             when 'MONTHLY' then private.vn_start((p_start + interval '1 month')::date) else 'infinity'::timestamptz end,
               coalesce(q.ends_at, 'infinity'::timestamptz))
$$;

-- ---------------------------------------------------------------------
-- 2. Giá trị chỉ số theo người trong một khung thời gian (dùng cho tiến độ, cộng đồng và ước tính)
-- ---------------------------------------------------------------------
create or replace function private.metric_values(p_metric text, p_from timestamptz, p_to timestamptz, p_params jsonb default '{}'::jsonb, p_user uuid default null)
returns table (user_id uuid, val numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_min numeric := coalesce((p_params->>'min_km')::numeric, 1); v_hour integer := coalesce((p_params->>'before_hour')::int, 7);
begin
  if p_metric in ('CHALLENGE_FINISHES', 'CHALLENGE_JOINS') then
    return query
      select cp.profile_id, count(distinct cp.challenge_id)::numeric
        from public.challenge_participants cp
       where (p_user is null or cp.profile_id = p_user) and cp.status <> 'LEFT'
         and case when p_metric = 'CHALLENGE_FINISHES' then cp.completed_at >= p_from and cp.completed_at < p_to
                  else cp.joined_at >= p_from and cp.joined_at < p_to end
       group by cp.profile_id;
    return;
  end if;
  return query
    with r as (
      select a.user_id as uid, a.started_at, greatest(coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0), 0) / 1000.0 as km
        from public.activities a
       where a.user_id is not null and (p_user is null or a.user_id = p_user)
         and a.started_at >= p_from and a.started_at < p_to
         and public.activity_is_countable(a.status, a.validation_status) and a.validation_status = 'APPROVED'
    )
    select r.uid, (case p_metric
        when 'TOTAL_KM' then sum(r.km)
        when 'WEEK_KM' then sum(r.km)
        when 'COMMUNITY_KM' then sum(r.km)
        when 'RUN_KM' then max(r.km)
        when 'RUN_COUNT' then count(*) filter (where r.km >= v_min)
        when 'ACTIVE_DAYS' then count(distinct private.vn_day(r.started_at)) filter (where r.km >= v_min)
        when 'WEEK_RUN_DAYS' then count(distinct private.vn_day(r.started_at)) filter (where r.km >= v_min)
        when 'WEEKEND_RUNS' then count(*) filter (where r.km >= v_min and extract(isodow from r.started_at at time zone 'Asia/Ho_Chi_Minh') in (6, 7))
        when 'EARLY_RUNS' then count(*) filter (where r.km >= v_min and extract(hour from r.started_at at time zone 'Asia/Ho_Chi_Minh') < v_hour)
      end)::numeric
      from r group by r.uid;
end $$;

-- ---------------------------------------------------------------------
-- 3. Trả thưởng
-- ---------------------------------------------------------------------
-- Xu thực trả sau khi áp trần ngày / tuần (tháng, sự kiện, một lần: không trần — admin xem ước tính trước khi đăng)
create or replace function private.quest_capped_xu(p_user uuid, q public.quests, p_xu numeric) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare l jsonb := private.quest_limits(); v_used numeric; v_cap numeric;
begin
  if coalesce(p_xu, 0) <= 0 or q.period not in ('DAILY', 'WEEKLY') then return greatest(coalesce(p_xu, 0), 0); end if;
  v_cap := case q.period when 'DAILY' then (l->>'dailyXuCap')::numeric else (l->>'weeklyXuCap')::numeric end;
  v_used := (select coalesce(sum(e.xu), 0) from public.game_events e
              where e.user_id = p_user and e.kind = 'QUEST' and e.payload->>'period' = q.period
                and e.created_at >= private.vn_start(case q.period when 'DAILY' then private.vn_day(now()) else private.vn_week(now()) end));
  return greatest(least(p_xu, v_cap - v_used), 0);
end $$;

-- Phần thưởng kèm (khi hoàn thành hết nhiệm vụ): vật phẩm, huy hiệu sự kiện, lượt tạo. Trả về mô tả để hiện cho người chơi.
create or replace function private.quest_extras(p_user uuid, q public.quests, p_start date) returns text[]
language plpgsql security definer set search_path = public as $$
declare v_parts text[] := '{}'; v_item_id uuid; v_item_name text; v_badge uuid; v_code text := 'QB_' || upper(substr(replace(q.id::text, '-', ''), 1, 12)); v_rows integer;
begin
  if q.reward_item is not null then
    v_item_id := (select i.id from public.avatar_items i where i.code = q.reward_item);
    v_item_name := (select i.name from public.avatar_items i where i.code = q.reward_item);
    if v_item_id is not null then
      insert into public.user_inventory (user_id, item_id, acquired_reason)
      select p_user, v_item_id, 'quest' where not exists (select 1 from public.user_inventory u where u.user_id = p_user and u.item_id = v_item_id);
      v_parts := v_parts || ('Vật phẩm: ' || v_item_name);
    end if;
  end if;
  if q.reward_badge is not null and coalesce(q.reward_badge->>'title', '') <> '' then
    insert into public.achievements (code, title, description, category, tier, icon, rule, xp_reward, xu_reward, sort, is_active)
    values (v_code, q.reward_badge->>'title', 'Huy hiệu giới hạn: ' || q.title, 'EVENT', coalesce(q.reward_badge->>'tier', 'GOLD'),
            coalesce(q.reward_badge->>'icon', 'Medal'), null, 0, 0, 900, true)
    on conflict (code) do update set title = excluded.title, icon = excluded.icon, tier = excluded.tier;
    v_badge := (select a.id from public.achievements a where a.code = v_code);
    insert into public.user_achievements (user_id, achievement_id)
    select p_user, v_badge where not exists (select 1 from public.user_achievements u where u.user_id = p_user and u.achievement_id = v_badge);
    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      perform private.notify(p_user, null, 'BADGE', 'Huy hiệu mới: ' || (q.reward_badge->>'title'), 'Hoàn thành nhiệm vụ ' || q.title, '/me?tab=badges', null, true);
    end if;
    v_parts := v_parts || ('Huy hiệu: ' || (q.reward_badge->>'title'));
  end if;
  if q.reward_passes is not null and coalesce((q.reward_passes->>'qty')::int, 0) > 0 then
    insert into public.challenge_passes (owner_type, owner_id, max_slots, total, remaining, expires_at, note, granted_by, source_key)
    values ('USER', p_user, (q.reward_passes->>'max_slots')::int, (q.reward_passes->>'qty')::int, (q.reward_passes->>'qty')::int,
            now() + make_interval(days => coalesce((q.reward_passes->>'days')::int, 30)), left('Nhiệm vụ: ' || q.title, 200), null,
            'quest:' || q.id || ':' || p_user || ':' || p_start)
    on conflict (source_key) where source_key is not null do nothing;
    v_parts := v_parts || ((q.reward_passes->>'qty') || ' lượt tạo thử thách ≤' || (q.reward_passes->>'max_slots') || ' người');
  end if;
  return v_parts;
end $$;

-- Ghi nhận tiến độ p_prog cho một người; trả thưởng khi đạt (bậc hoặc cả nhiệm vụ). Gọi lại nhiều lần vẫn an toàn.
create or replace function private.quest_finish(p_user uuid, q public.quests, p_start date, p_prog numeric, p_activity uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_paid integer; v_done timestamptz; v_n integer; v_reached integer; v_xu numeric; v_final boolean; v_rows integer;
  v_label text; v_key text; v_extras text[] := '{}';
begin
  insert into public.user_quest_progress (user_id, quest_id, period_start, progress) values (p_user, q.id, p_start, coalesce(p_prog, 0))
  on conflict do nothing;
  perform 1 from public.user_quest_progress where user_id = p_user and quest_id = q.id and period_start = p_start for update;
  v_paid := (select x.tier_paid from public.user_quest_progress x where x.user_id = p_user and x.quest_id = q.id and x.period_start = p_start);
  v_done := (select x.completed_at from public.user_quest_progress x where x.user_id = p_user and x.quest_id = q.id and x.period_start = p_start);
  if v_done is not null then return; end if;

  if q.tiers is not null and jsonb_array_length(q.tiers) > 0 then
    v_n := jsonb_array_length(q.tiers);
    v_reached := (select count(*) from jsonb_array_elements(q.tiers) t where (t->>'target')::numeric <= p_prog);
    if v_reached <= v_paid then return; end if;
    v_xu := (select coalesce(sum((t.v->>'xu')::numeric), 0) from jsonb_array_elements(q.tiers) with ordinality t(v, i) where t.i > v_paid and t.i <= v_reached);
    v_final := v_reached >= v_n;
    update public.user_quest_progress set tier_paid = v_reached, completed_at = case when v_final then now() end
     where user_id = p_user and quest_id = q.id and period_start = p_start;
    v_label := q.title || case when v_final then '' else ' — bậc ' || v_reached || '/' || v_n end;
    v_key := 'quest:' || q.id || ':' || p_user || ':' || p_start || ':t' || v_reached;
  else
    if p_prog < q.target then return; end if;
    update public.user_quest_progress set completed_at = now()
     where user_id = p_user and quest_id = q.id and period_start = p_start and completed_at is null;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then return; end if;
    v_xu := q.reward_xu; v_final := true; v_label := q.title;
    v_key := 'quest:' || q.id || ':' || p_user || ':' || p_start;
  end if;

  if v_final then v_extras := private.quest_extras(p_user, q, p_start); end if;
  perform private.award(p_user, 'QUEST', 'Nhiệm vụ: ' || v_label,
    coalesce(nullif(array_to_string(v_extras, ' · '), ''),
      case q.period when 'DAILY' then 'Nhiệm vụ ngày' when 'WEEKLY' then 'Nhiệm vụ tuần' when 'MONTHLY' then 'Nhiệm vụ tháng'
                    when 'ONCE' then 'Cột mốc' else 'Nhiệm vụ sự kiện' end),
    private.quest_capped_xu(p_user, q, v_xu), 0, v_key, p_activity,
    jsonb_build_object('quest_id', q.id, 'code', q.code, 'period', q.period, 'period_start', p_start, 'icon', q.icon,
                       'xu_full', v_xu, 'extras', to_jsonb(v_extras)));
end $$;

-- Cập nhật tiến độ theo chỉ số. p_mode: ADD / MAX / SET như cũ; COMPUTE = tự tính từ bài chạy trong khung của từng nhiệm vụ.
create or replace function private.quest_progress(
  p_user uuid, p_metric text, p_value numeric, p_mode text default 'ADD', p_at timestamptz default now(), p_activity uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  q public.quests; v_start date; v_prog numeric; v_from timestamptz; v_to timestamptz; v_total numeric; v_mine numeric; v_min numeric;
  u record; v_tier integer := private.user_vip_tier(p_user);
begin
  for q in select * from public.quests x where x.metric = p_metric and x.is_active
             and (x.starts_at is null or p_at >= x.starts_at) and (x.ends_at is null or p_at < x.ends_at)
             and (x.period <> 'ONCE' or p_at >= x.created_at) loop
    v_start := private.quest_period_start(q.period, q.starts_at, p_at);

    if q.metric = 'COMMUNITY_KM' then
      -- Cả cộng đồng cùng chạy: tiến độ = tổng km mọi người; ai góp đủ min_km đều nhận thưởng khi đạt mục tiêu
      v_from := private.quest_window_from(q, v_start); v_to := private.quest_window_to(q, v_start);
      v_min := coalesce((q.params->>'min_km')::numeric, 1);
      v_total := (select coalesce(sum(m.val), 0) from private.metric_values('TOTAL_KM', v_from, v_to, '{}'::jsonb, null) m);
      if q.min_vip_tier <= v_tier then
        insert into public.user_quest_progress (user_id, quest_id, period_start, progress) values (p_user, q.id, v_start, v_total)
        on conflict (user_id, quest_id, period_start) do update set progress = excluded.progress, updated_at = now();
      end if;
      if v_total >= q.target then
        for u in select m.user_id from private.metric_values('TOTAL_KM', v_from, v_to, '{}'::jsonb, null) m where m.val >= v_min loop
          if private.user_vip_tier(u.user_id) >= q.min_vip_tier then
            perform private.quest_finish(u.user_id, q, v_start, v_total, case when u.user_id = p_user then p_activity end);
          end if;
        end loop;
      end if;
      continue;
    end if;

    if q.min_vip_tier > v_tier then continue; end if;
    if p_mode = 'COMPUTE' then
      v_prog := coalesce((select m.val from private.metric_values(q.metric, private.quest_window_from(q, v_start), private.quest_window_to(q, v_start), q.params, p_user) m), 0);
      insert into public.user_quest_progress (user_id, quest_id, period_start, progress) values (p_user, q.id, v_start, v_prog)
      on conflict (user_id, quest_id, period_start) do update set progress = greatest(public.user_quest_progress.progress, excluded.progress), updated_at = now()
      returning progress into v_prog;
    else
      insert into public.user_quest_progress (user_id, quest_id, period_start) values (p_user, q.id, v_start) on conflict do nothing;
      update public.user_quest_progress
         set progress = case p_mode when 'ADD' then progress + p_value when 'MAX' then greatest(progress, p_value) else p_value end, updated_at = now()
       where user_id = p_user and quest_id = q.id and period_start = v_start
      returning progress into v_prog;
    end if;
    perform private.quest_finish(p_user, q, v_start, v_prog, p_activity);
  end loop;
end $$;

-- Mỗi bài chạy được trả thưởng: tính lại các chỉ số theo khung (thay cách cộng dồn cũ của TOTAL_KM / RUN_COUNT)
create or replace function private.quest_totals_on_reward() returns trigger
language plpgsql security definer set search_path = public as $$
declare m text;
begin
  if new.user_id is null or old.rewarded_at is not null or new.rewarded_at is null or new.validation_status <> 'APPROVED' then return new; end if;
  foreach m in array array['TOTAL_KM', 'RUN_COUNT', 'ACTIVE_DAYS', 'WEEKEND_RUNS', 'EARLY_RUNS', 'COMMUNITY_KM'] loop
    begin
      perform private.quest_progress(new.user_id, m, 0, 'COMPUTE', coalesce(new.started_at, now()), new.id);
    exception when others then
      raise warning 'quest_totals_on_reward % % lỗi: % %', new.id, m, sqlstate, sqlerrm;
    end;
  end loop;
  return new;
end $$;
drop trigger if exists trg_quest_totals_on_reward on public.activities;
create trigger trg_quest_totals_on_reward after update of rewarded_at on public.activities
  for each row execute function private.quest_totals_on_reward();

-- Hoàn thành thử thách → nhiệm vụ "hoàn thành N thử thách"
create or replace function private.quest_on_challenge_finish() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.profile_id is null or new.completed_at is null or old.completed_at is not null then return new; end if;
  begin
    perform private.quest_progress(new.profile_id, 'CHALLENGE_FINISHES', 0, 'COMPUTE', new.completed_at, null);
  exception when others then
    raise warning 'quest_on_challenge_finish lỗi: % %', sqlstate, sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists trg_quest_on_challenge_finish on public.challenge_participants;
create trigger trg_quest_on_challenge_finish after update of completed_at on public.challenge_participants
  for each row execute function private.quest_on_challenge_finish();

-- ---------------------------------------------------------------------
-- 4. Người chơi
-- ---------------------------------------------------------------------
create or replace function public.my_quests() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); v_tier integer := private.user_vip_tier(v_uid);
begin
  return (select coalesce(jsonb_agg(x.j order by x.o1, x.o2, x.o3), '[]'::jsonb) from (
    select jsonb_build_object(
            'id', q.id, 'code', q.code, 'period', q.period, 'metric', q.metric, 'category', q.category, 'title', q.title,
            'description', q.description, 'icon', q.icon, 'target', q.target, 'reward_xu', q.reward_xu, 'tiers', q.tiers,
            'tier_paid', coalesce(p.tier_paid, 0), 'params', q.params,
            'reward_item', (select i.name from public.avatar_items i where i.code = q.reward_item),
            'reward_badge', q.reward_badge->>'title',
            'reward_passes', q.reward_passes,
            'starts_at', q.starts_at, 'ends_at', q.ends_at, 'min_vip_tier', q.min_vip_tier, 'locked', q.min_vip_tier > v_tier,
            'progress', least(case when q.metric = 'COMMUNITY_KM'
                                   then (select coalesce(sum(m.val), 0) from private.metric_values('TOTAL_KM', private.quest_window_from(q, s.st), private.quest_window_to(q, s.st), '{}'::jsonb, null) m)
                                   else coalesce(p.progress, 0) end, q.target),
            'mine', case when q.metric = 'COMMUNITY_KM'
                         then (select coalesce(sum(m.val), 0) from private.metric_values('TOTAL_KM', private.quest_window_from(q, s.st), private.quest_window_to(q, s.st), '{}'::jsonb, v_uid) m) end,
            'completed', p.completed_at is not null) as j,
           case q.period when 'EVENT' then 0 when 'ONCE' then 1 when 'DAILY' then 2 when 'WEEKLY' then 3 else 4 end as o1, q.sort as o2, q.created_at as o3
      from public.quests q
      cross join lateral (select private.quest_period_start(q.period, q.starts_at, now()) as st) s
      left join public.user_quest_progress p on p.quest_id = q.id and p.user_id = v_uid and p.period_start = s.st
     where q.is_active and (q.starts_at is null or q.starts_at <= now()) and (q.ends_at is null or q.ends_at > now())
       -- Nhiệm vụ một lần đã xong quá 3 ngày thì ẩn cho gọn
       and not (q.period = 'ONCE' and p.completed_at is not null and p.completed_at < now() - interval '3 days')) x);
end $$;

-- Huy hiệu sự kiện (không có luật tự động) chỉ hiện khi đã nhận
create or replace function public.my_achievements()
returns table (code text, title text, description text, category text, tier text, icon text, xp_reward integer, xu_reward numeric,
               target numeric, progress numeric, unlocked_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); st jsonb := private.player_stats(v_uid);
begin
  return query
  select a.code, a.title, a.description, a.category, a.tier, a.icon, a.xp_reward, a.xu_reward,
         coalesce((a.rule->>'gte')::numeric, 1),
         case when a.rule is null then 1 else least(coalesce((st->>(a.rule->>'type'))::numeric, 0), (a.rule->>'gte')::numeric) end,
         u.unlocked_at
    from public.achievements a
    left join public.user_achievements u on u.achievement_id = a.id and u.user_id = v_uid
   where a.is_active and (a.rule is not null or (a.category = 'EVENT' and u.unlocked_at is not null))
   order by a.sort, u.unlocked_at;
end $$;

-- ---------------------------------------------------------------------
-- 5. Admin
-- ---------------------------------------------------------------------
create or replace function public.admin_list_quests() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(q) || jsonb_build_object(
            'completions', (select count(*) from public.user_quest_progress p where p.quest_id = q.id and p.completed_at is not null),
            'participants', (select count(*) from public.user_quest_progress p where p.quest_id = q.id and p.progress > 0),
            'xu_paid', coalesce((select sum(e.xu) from public.game_events e where e.kind = 'QUEST' and e.payload->>'quest_id' = q.id::text), 0))
            order by q.is_active desc, q.created_at desc), '[]'::jsonb) from public.quests q);
end $$;

create or replace function public.admin_set_quest_limits(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_admin(); v jsonb := '{}'::jsonb; k text;
begin
  foreach k in array array['dailyXuCap', 'weeklyXuCap', 'maxDaily', 'maxWeekly', 'maxMonthly', 'maxEvent', 'maxOnce'] loop
    if p ? k then
      if jsonb_typeof(p->k) <> 'number' or (p->>k)::numeric < 0 or (p->>k)::numeric > 1000 then raise exception 'INVALID_LIMIT'; end if;
      v := v || jsonb_build_object(k, (p->>k)::numeric);
    end if;
  end loop;
  insert into private.app_settings (key, value) values ('quest_limits', (private.quest_limits() || v)::text)
  on conflict (key) do update set value = excluded.value;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'QUEST_LIMITS', 'quest_limits', v);
  return private.quest_limits();
end $$;

create or replace function public.admin_save_quest(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  v_id uuid := coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid());
  v_title text := trim(coalesce(p->>'title', ''));
  v_period text := upper(coalesce(p->>'period', 'DAILY'));
  v_metric text := upper(coalesce(p->>'metric', 'TOTAL_KM'));
  v_cat text := upper(coalesce(nullif(p->>'category', ''), 'RUN'));
  v_target numeric := (p->>'target')::numeric;
  v_xu numeric := round(coalesce((p->>'reward_xu')::numeric, 0), 1);
  v_start timestamptz := nullif(p->>'starts_at', '')::timestamptz;
  v_end timestamptz := nullif(p->>'ends_at', '')::timestamptz;
  v_active boolean := coalesce((p->>'is_active')::boolean, true);
  v_tiers jsonb := case when jsonb_typeof(p->'tiers') = 'array' and jsonb_array_length(p->'tiers') > 0 then p->'tiers' end;
  v_params jsonb := case when jsonb_typeof(p->'params') = 'object' then p->'params' else '{}'::jsonb end;
  v_item text := nullif(trim(coalesce(p->>'reward_item', '')), '');
  v_badge jsonb := case when jsonb_typeof(p->'reward_badge') = 'object' and coalesce(trim(p->'reward_badge'->>'title'), '') <> '' then p->'reward_badge' end;
  v_passes jsonb := case when jsonb_typeof(p->'reward_passes') = 'object' and coalesce((p->'reward_passes'->>'qty')::int, 0) > 0 then p->'reward_passes' end;
  l jsonb := private.quest_limits();
  v_max integer; v_count integer;
begin
  if char_length(v_title) not between 2 and 80 then raise exception 'INVALID_TITLE'; end if;
  if v_period not in ('DAILY', 'WEEKLY', 'MONTHLY', 'EVENT', 'ONCE') then raise exception 'INVALID_PERIOD'; end if;
  if v_cat not in ('RUN', 'CONSISTENCY', 'CHALLENGE', 'COMMUNITY', 'NEWBIE', 'SOCIAL') then raise exception 'INVALID_CATEGORY'; end if;
  if v_metric not in ('CHECKIN', 'RUN_KM', 'TOTAL_KM', 'RUN_COUNT', 'WEEK_KM', 'WEEK_RUN_DAYS', 'CHALLENGE_JOINS',
                      'ACTIVE_DAYS', 'WEEKEND_RUNS', 'EARLY_RUNS', 'CHALLENGE_FINISHES', 'COMMUNITY_KM') then raise exception 'INVALID_METRIC'; end if;
  if v_metric in ('WEEK_KM', 'WEEK_RUN_DAYS') and v_period <> 'WEEKLY' then raise exception 'INVALID_METRIC'; end if;
  if v_metric = 'COMMUNITY_KM' and v_period not in ('WEEKLY', 'MONTHLY', 'EVENT') then raise exception 'INVALID_METRIC'; end if;
  if v_metric = 'CHECKIN' and v_period <> 'DAILY' then raise exception 'INVALID_METRIC'; end if;
  if coalesce((v_params->>'min_km')::numeric, 1) not between 0 and 100 or coalesce((v_params->>'before_hour')::int, 7) not between 1 and 23 then
    raise exception 'INVALID_PARAMS';
  end if;
  -- Bậc: tăng dần, tối đa 5; mục tiêu = bậc cuối, Xu = tổng các bậc
  if v_tiers is not null then
    if v_metric = 'COMMUNITY_KM' or jsonb_array_length(v_tiers) > 5 then raise exception 'INVALID_TIERS'; end if;
    if exists (select 1 from jsonb_array_elements(v_tiers) with ordinality t(v, i)
                where (t.v->>'target') is null or (t.v->>'target')::numeric <= 0 or coalesce((t.v->>'xu')::numeric, 0) < 0
                   or (t.i > 1 and (t.v->>'target')::numeric <= (v_tiers->((t.i - 2)::int)->>'target')::numeric)) then
      raise exception 'INVALID_TIERS';
    end if;
    v_target := (v_tiers->(jsonb_array_length(v_tiers) - 1)->>'target')::numeric;
    v_xu := (select round(sum(coalesce((t->>'xu')::numeric, 0)), 1) from jsonb_array_elements(v_tiers) t);
  end if;
  if v_target is null or v_target <= 0 or v_target > 10000000 then raise exception 'INVALID_TARGET'; end if;
  if v_xu < 0 or v_xu > 100000 then raise exception 'INVALID_AMOUNT'; end if;
  if v_item is not null and not exists (select 1 from public.avatar_items i where i.code = v_item) then raise exception 'ITEM_NOT_FOUND'; end if;
  if v_badge is not null and char_length(trim(v_badge->>'title')) not between 2 and 60 then raise exception 'INVALID_BADGE'; end if;
  if v_passes is not null and ((v_passes->>'qty')::int not between 1 and 10 or coalesce((v_passes->>'max_slots')::int, 0) not between 2 and 1000
                               or coalesce((v_passes->>'days')::int, 30) not between 1 and 365) then raise exception 'INVALID_PASSES'; end if;
  if v_period = 'EVENT' and (v_start is null or v_end is null) then raise exception 'INVALID_TIME_RANGE'; end if;
  if v_end is not null and v_start is not null and (v_end <= v_start or v_end - v_start > interval '366 days') then raise exception 'INVALID_TIME_RANGE'; end if;

  -- Giới hạn số nhiệm vụ đang bật cùng loại (người dùng không bị ngợp)
  if v_active and (v_end is null or v_end > now()) then
    v_max := (l->>(case v_period when 'DAILY' then 'maxDaily' when 'WEEKLY' then 'maxWeekly' when 'MONTHLY' then 'maxMonthly'
                                  when 'EVENT' then 'maxEvent' else 'maxOnce' end))::int;
    v_count := (select count(*) from public.quests x
                 where x.id <> v_id and x.is_active and x.period = v_period and (x.ends_at is null or x.ends_at > now())
                   and (v_period <> 'EVENT' or (x.starts_at < v_end and x.ends_at > v_start)));
    if v_count >= v_max then raise exception 'TOO_MANY_ACTIVE'; end if;
  end if;

  insert into public.quests (id, code, period, metric, target, title, description, icon, reward_xu, reward_xp, sort, is_active, starts_at, ends_at,
                             min_vip_tier, created_by, category, params, tiers, reward_item, reward_badge, reward_passes)
  values (v_id, coalesce(nullif(p->>'code', ''), 'ADM_' || upper(substr(replace(v_id::text, '-', ''), 1, 8))), v_period, v_metric, v_target, v_title,
          nullif(trim(coalesce(p->>'description', '')), ''), coalesce(nullif(p->>'icon', ''), 'Target'), v_xu, 0, coalesce((p->>'sort')::int, 100),
          v_active, v_start, v_end, least(greatest(coalesce((p->>'min_vip_tier')::int, 0), 0), 3), v_uid,
          v_cat, v_params, v_tiers, v_item, v_badge, v_passes)
  on conflict (id) do update set period = excluded.period, metric = excluded.metric, target = excluded.target, title = excluded.title,
    description = excluded.description, icon = excluded.icon, reward_xu = excluded.reward_xu, reward_xp = 0, sort = excluded.sort,
    is_active = excluded.is_active, starts_at = excluded.starts_at, ends_at = excluded.ends_at, min_vip_tier = excluded.min_vip_tier,
    category = excluded.category, params = excluded.params, tiers = excluded.tiers, reward_item = excluded.reward_item,
    reward_badge = excluded.reward_badge, reward_passes = excluded.reward_passes;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SAVE_QUEST', v_id::text, p);
  return v_id;
end $$;

-- Số liệu gợi ý: ai đang chạy, chạy bao nhiêu — để đặt mục tiêu "vừa sức" (khoảng 60% người chạy đạt được)
create or replace function public.admin_quest_insights() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  v_wk date := private.vn_week(now());
  v_mo date := date_trunc('month', private.vn_day(now()))::date;
begin
  return (
    with runs as (
      select a.user_id, a.started_at, greatest(coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0), 0) / 1000.0 as km
        from public.activities a
       where a.user_id is not null and a.started_at >= now() - interval '120 days'
         and public.activity_is_countable(a.status, a.validation_status) and a.validation_status = 'APPROVED'
    ), last_run as (select user_id, max(started_at) as at from runs group by user_id),
    wk as (
      select user_id, private.vn_week(started_at) as w, sum(km) as km, count(distinct private.vn_day(started_at)) filter (where km >= 1) as days
        from runs where started_at >= private.vn_start(v_wk - 28) and started_at < private.vn_start(v_wk) group by 1, 2
    ), mo as (
      select user_id, sum(km) as km, count(distinct private.vn_day(started_at)) filter (where km >= 1) as days
        from runs where started_at >= private.vn_start((v_mo - interval '1 month')::date) and started_at < private.vn_start(v_mo) group by 1
    ), r30 as (select * from runs where started_at >= now() - interval '30 days')
    select jsonb_build_object(
      'users_total', (select count(*) from public.profiles),
      'new_users_14d', (select count(*) from public.profiles where created_at >= now() - interval '14 days'),
      'runners_7d', (select count(distinct user_id) from runs where started_at >= now() - interval '7 days'),
      'runners_30d', (select count(distinct user_id) from r30),
      'inactive_14_60', (select count(*) from last_run where at < now() - interval '14 days' and at >= now() - interval '60 days'),
      'week_km', (select jsonb_build_object('p40', percentile_cont(0.4) within group (order by km), 'p50', percentile_cont(0.5) within group (order by km),
                          'p75', percentile_cont(0.75) within group (order by km), 'p90', percentile_cont(0.9) within group (order by km), 'n', count(*)) from wk),
      'week_days', (select jsonb_build_object('p40', percentile_cont(0.4) within group (order by days), 'p50', percentile_cont(0.5) within group (order by days),
                          'p75', percentile_cont(0.75) within group (order by days)) from wk),
      'month_km', (select jsonb_build_object('p40', percentile_cont(0.4) within group (order by km), 'p50', percentile_cont(0.5) within group (order by km),
                          'p75', percentile_cont(0.75) within group (order by km), 'n', count(*)) from mo),
      'month_days', (select jsonb_build_object('p40', percentile_cont(0.4) within group (order by days), 'p50', percentile_cont(0.5) within group (order by days)) from mo),
      'run_km', (select jsonb_build_object('p50', percentile_cont(0.5) within group (order by km), 'p75', percentile_cont(0.75) within group (order by km),
                          'p90', percentile_cont(0.9) within group (order by km)) from r30),
      'early_share', (select round(avg(case when extract(hour from started_at at time zone 'Asia/Ho_Chi_Minh') < 7 then 1.0 else 0 end), 3) from r30),
      'weekend_share', (select round(avg(case when extract(isodow from started_at at time zone 'Asia/Ho_Chi_Minh') in (6, 7) then 1.0 else 0 end), 3) from r30),
      'community_km_30d', (select round(coalesce(sum(km), 0), 1) from r30),
      'quest_xu_30d', (select coalesce(sum(xu), 0) from public.game_events where kind = 'QUEST' and created_at >= now() - interval '30 days'),
      'run_xu_30d', (select coalesce(sum(xu), 0) from public.game_events where kind = 'RUN' and created_at >= now() - interval '30 days'),
      'limits', private.quest_limits()));
end $$;

-- Ước tính trước khi đăng: dựa trên các kỳ đã qua, bao nhiêu người sẽ đạt từng bậc và tốn bao nhiêu Xu
create or replace function public.admin_quest_estimate(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  v_period text := upper(coalesce(p->>'period', 'WEEKLY'));
  v_metric text := upper(coalesce(p->>'metric', 'TOTAL_KM'));
  v_params jsonb := case when jsonb_typeof(p->'params') = 'object' then p->'params' else '{}'::jsonb end;
  v_start timestamptz := nullif(p->>'starts_at', '')::timestamptz;
  v_end timestamptz := nullif(p->>'ends_at', '')::timestamptz;
  v_tiers jsonb := case when jsonb_typeof(p->'tiers') = 'array' and jsonb_array_length(p->'tiers') > 0 then p->'tiers'
                        else jsonb_build_array(jsonb_build_object('target', (p->>'target')::numeric, 'xu', coalesce((p->>'reward_xu')::numeric, 0))) end;
  v_len interval; v_samples integer; v_runs numeric; v_windows jsonb := '[]'::jsonb; w record; v_rows jsonb := '[]'::jsonb; t record;
  v_hits numeric; v_active numeric := 0; v_total numeric; v_periods numeric; v_xu numeric := 0; v_min numeric := coalesce((v_params->>'min_km')::numeric, 1);
  v_today date := private.vn_day(now());
begin
  if v_metric = 'CHECKIN' then return jsonb_build_object('supported', false); end if;
  v_len := case v_period when 'DAILY' then interval '1 day' when 'WEEKLY' then interval '7 days' when 'MONTHLY' then interval '1 month'
                         else coalesce(v_end - v_start, interval '7 days') end;
  v_samples := case v_period when 'DAILY' then 14 when 'WEEKLY' then 4 when 'MONTHLY' then 2 else 3 end;
  -- Các khung mẫu đã qua (kết thúc trước hôm nay / tuần này / tháng này)
  for w in select g as i,
                  case v_period when 'DAILY' then private.vn_start(v_today - g) when 'WEEKLY' then private.vn_start(private.vn_week(now()) - 7 * g)
                                when 'MONTHLY' then private.vn_start((date_trunc('month', v_today) - make_interval(months => g))::date)
                                else now() - v_len * g end as f
             from generate_series(1, v_samples) g loop
    v_windows := v_windows || jsonb_build_array(jsonb_build_object('from', w.f, 'to', w.f + v_len));
  end loop;

  for t in select (x.v->>'target')::numeric as target, coalesce((x.v->>'xu')::numeric, 0) as xu, x.i from jsonb_array_elements(v_tiers) with ordinality x(v, i) loop
    v_hits := 0; v_active := 0;
    for w in select (e->>'from')::timestamptz as f, (e->>'to')::timestamptz as tt from jsonb_array_elements(v_windows) e loop
      if v_metric = 'COMMUNITY_KM' then
        v_total := (select coalesce(sum(m.val), 0) from private.metric_values('TOTAL_KM', w.f, w.tt, '{}'::jsonb, null) m);
        v_hits := v_hits + case when v_total >= t.target
                                then (select count(*) from private.metric_values('TOTAL_KM', w.f, w.tt, '{}'::jsonb, null) m where m.val >= v_min) else 0 end;
      else
        v_hits := v_hits + (select count(*) from private.metric_values(v_metric, w.f, w.tt, v_params, null) m where m.val >= t.target);
      end if;
      v_active := v_active + (select count(*) from private.metric_values('TOTAL_KM', w.f, w.tt, '{}'::jsonb, null) m where m.val > 0);
    end loop;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object('target', t.target, 'xu', t.xu,
      'completers', round(v_hits / v_samples, 1), 'rate', case when v_active > 0 then round(v_hits / v_active, 3) else 0 end));
    v_xu := v_xu + (v_hits / v_samples) * t.xu;
  end loop;
  v_runs := round(v_active / v_samples, 1);
  -- Số kỳ trong thời gian chạy nhiệm vụ (nhiệm vụ không hạn: tính cho 30 ngày)
  v_periods := case v_period
    when 'DAILY' then greatest(1, ceil(extract(epoch from coalesce(v_end, now() + interval '30 days') - coalesce(v_start, now())) / 86400))
    when 'WEEKLY' then greatest(1, ceil(extract(epoch from coalesce(v_end, now() + interval '30 days') - coalesce(v_start, now())) / 604800))
    when 'MONTHLY' then greatest(1, ceil(extract(epoch from coalesce(v_end, now() + interval '30 days') - coalesce(v_start, now())) / 2592000))
    else 1 end;
  return jsonb_build_object('supported', true, 'samples', v_samples, 'active_runners', v_runs, 'tiers', v_rows,
    'xu_per_period', round(v_xu, 1), 'periods', v_periods, 'xu_total', round(v_xu * v_periods, 1),
    'open_ended', v_end is null and v_period in ('DAILY', 'WEEKLY', 'MONTHLY'), 'limits', private.quest_limits());
end $$;

revoke all on function private.quest_limits(), private.quest_window_from(public.quests, date), private.quest_window_to(public.quests, date),
  private.metric_values(text, timestamptz, timestamptz, jsonb, uuid), private.quest_capped_xu(uuid, public.quests, numeric),
  private.quest_extras(uuid, public.quests, date), private.quest_finish(uuid, public.quests, date, numeric, uuid),
  private.quest_on_challenge_finish() from public, anon, authenticated;
revoke all on function public.admin_set_quest_limits(jsonb), public.admin_quest_insights(), public.admin_quest_estimate(jsonb) from public, anon;
grant execute on function public.admin_set_quest_limits(jsonb), public.admin_quest_insights(), public.admin_quest_estimate(jsonb) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001004700_shine_economy.sql
-- ===================================================================
-- 004700: Ví Tỏa sáng — quà nhận được có chỗ tiêu, và người được yêu quý có dấu hiệu riêng.
-- • Tỏa sáng TÍCH LŨY = tổng giá trị quà đã nhận (danh tiếng, không bao giờ giảm) → BẬC TỎA SÁNG hiện quanh ảnh đại diện:
--   Lấp lánh ≥ 500 · Rạng rỡ ≥ 2.000 · Chói sáng ≥ 10.000 · Huyền thoại ≥ 50.000.
-- • Tỏa sáng KHẢ DỤNG = phần được tính để đổi (ví, giảm khi đổi). Chống gian lận:
--   – chỉ tính quà từ người tặng hợp lệ (tài khoản ≥ 14 ngày và ≥ 3 bài chạy hợp lệ);
--   – mỗi người tặng góp tối đa 300 Tỏa sáng khả dụng cho một người nhận mỗi tuần;
--   – đổi lượt tạo thử thách cần Tỏa sáng từ ≥ 5 người khác nhau trong 30 ngày;
--   – giá đổi ≈ 30–35% giá trị Xu → nuôi tài khoản ảo để đổi luôn lỗ.
-- • Cửa hàng Tỏa sáng: lượt tạo thử thách ≤ 20 / ≤ 50 người, khiên giữ chuỗi, vật phẩm nhân vật CHỈ đổi bằng Tỏa sáng.
-- • Lời cảm ơn miễn phí gửi người đã tặng mình (5 lần / ngày). Huy hiệu theo số người tặng khác nhau (5 / 20 / 50).
-- • Tường quà: bộ sưu tập theo độ hiếm, ẩn / hiện công khai. Thử thách: "Được tiếp sức nhiều nhất".
-- Cần file 004600. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 1. Cấu hình + bảng
-- ---------------------------------------------------------------------
create or replace function private.shine_config() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('tiers', jsonb_build_array(500, 2000, 10000, 50000), 'perSenderWeeklyCap', 300,
                            'minSenderAgeDays', 14, 'minSenderRuns', 3, 'thanksPerDay', 5)
      || coalesce((select value::jsonb from private.app_settings where key = 'shine_config'), '{}'::jsonb)
$$;

create or replace function private.shine_tier(p_total numeric) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from jsonb_array_elements(private.shine_config()->'tiers') t where coalesce(p_total, 0) >= t::text::numeric
$$;

alter table public.profiles add column if not exists shine_total numeric(14, 1) not null default 0;
alter table public.profiles add column if not exists gift_wall_public boolean not null default true;
grant update (gift_wall_public) on public.profiles to authenticated;

create table if not exists public.shine_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  from_user uuid references public.profiles(id) on delete set null,
  cheer_id uuid unique,
  gift_amount numeric(14, 1) not null,
  countable numeric(14, 1) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists shine_entries_user_idx on public.shine_entries (user_id, created_at desc);
create index if not exists shine_entries_pair_idx on public.shine_entries (user_id, from_user, created_at);

create table if not exists public.shine_shop (
  code text primary key check (code ~ '^[A-Z0-9_]{2,32}$'),
  name text not null check (char_length(name) between 2 and 80),
  description text,
  kind text not null check (kind in ('PASS', 'SHIELD', 'COSMETIC')),
  cost integer not null check (cost between 1 and 10000000),
  period_limit integer check (period_limit is null or period_limit > 0),
  limit_period text not null default 'MONTH' check (limit_period in ('WEEK', 'MONTH')),
  min_senders integer not null default 0 check (min_senders >= 0),
  params jsonb not null default '{}'::jsonb,   -- PASS: {max_slots, days}; COSMETIC: {item_code}; mọi loại: xu_value (để admin so sánh)
  is_active boolean not null default true,
  sort integer not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists public.shine_spends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_code text not null references public.shine_shop(code),
  cost integer not null,
  ref text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists shine_spends_user_idx on public.shine_spends (user_id, created_at desc);

create table if not exists public.shine_thanks (
  from_user uuid not null references public.profiles(id) on delete cascade,
  to_user uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  created_at timestamptz not null default now(),
  primary key (from_user, to_user, day)
);

alter table public.shine_entries enable row level security;
alter table public.shine_shop enable row level security;
alter table public.shine_spends enable row level security;
alter table public.shine_thanks enable row level security;
revoke all on public.shine_entries, public.shine_shop, public.shine_spends, public.shine_thanks from anon, authenticated;

insert into public.shine_shop (code, name, description, kind, cost, period_limit, limit_period, min_senders, params, sort) values
  ('PASS_20', 'Lượt tạo thử thách ≤ 20 người', 'Tạo một thử thách miễn phí cho tối đa 20 người, dùng trong 30 ngày', 'PASS', 500, 2, 'MONTH', 5,
   '{"max_slots": 20, "days": 30, "xu_value": 150}', 1),
  ('PASS_50', 'Lượt tạo thử thách ≤ 50 người', 'Tạo một thử thách miễn phí cho tối đa 50 người, dùng trong 30 ngày', 'PASS', 1400, 1, 'MONTH', 5,
   '{"max_slots": 50, "days": 30, "xu_value": 400}', 2),
  ('SHIELD', 'Khiên giữ chuỗi', 'Giữ chuỗi tuần khi lỡ một tuần', 'SHIELD', 700, 1, 'MONTH', 0, '{"xu_value": 200}', 3)
on conflict (code) do nothing;

-- Vật phẩm nhân vật chỉ đổi bằng Tỏa sáng: không mua bằng Xu được
create or replace function public.buy_avatar_item(p_code text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  i public.avatar_items := (select x from public.avatar_items x where x.code = p_code and x.is_active);
  v_level integer;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if exists (select 1 from public.ledger_transactions where idempotency_key = 'shop:' || p_idempotency_key) then
    return jsonb_build_object('duplicate', true, 'balance', private.balance(v_uid));
  end if;
  if i.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if coalesce(i.metadata->>'acquire', '') = 'shine' then raise exception 'SHINE_ONLY'; end if;
  if exists (select 1 from public.user_inventory where user_id = v_uid and item_id = i.id) then raise exception 'ALREADY_OWNED'; end if;
  v_level := coalesce((select level from public.profiles where id = v_uid), 1);
  if v_level < i.unlock_level then raise exception 'LEVEL_TOO_LOW'; end if;
  if i.price_xu > 0 then
    if private.balance(v_uid) < i.price_xu then raise exception 'INSUFFICIENT_BALANCE'; end if;
    perform private.ledger_post('SHOP_ITEM', 'shop:' || p_idempotency_key, 'Mua ' || i.name, v_uid,
      private.debit_entries(v_uid, i.price_xu, private.system_account()));
  end if;
  insert into public.user_inventory (user_id, item_id, acquired_reason)
  values (v_uid, i.id, case when i.price_xu > 0 then 'PURCHASE' else 'FREE' end)
  on conflict (user_id, item_id) do nothing;
  return jsonb_build_object('code', i.code, 'balance', private.balance(v_uid));
end $$;

create or replace function private.item_json(i public.avatar_items) returns jsonb
language sql immutable as $$
  select jsonb_build_object('code', i.code, 'name', i.name, 'description', i.description, 'slot', i.category, 'rarity', i.rarity,
    'render_kind', i.render_kind, 'layer_urls', i.layer_urls, 'color', i.color, 'price_xu', i.price_xu,
    'unlock_level', i.unlock_level, 'is_default', i.is_default, 'acquire', coalesce(i.metadata->>'acquire', 'xu'))
$$;

-- Huy hiệu theo số người tặng khác nhau
insert into public.achievements (code, title, description, category, tier, icon, rule, xp_reward, xu_reward, sort) values
  ('FANS_5', 'Được quý mến', 'Nhận quà từ 5 runner khác nhau', 'SOCIAL', 'BRONZE', 'HandHeart', '{"type":"GIFT_FANS","gte":5}', 0, 0, 60),
  ('FANS_20', 'Ngôi sao cộng đồng', 'Nhận quà từ 20 runner khác nhau', 'SOCIAL', 'SILVER', 'Star', '{"type":"GIFT_FANS","gte":20}', 0, 0, 61),
  ('FANS_50', 'Người truyền lửa', 'Nhận quà từ 50 runner khác nhau', 'SOCIAL', 'GOLD', 'Flame', '{"type":"GIFT_FANS","gte":50}', 0, 0, 62)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 2. Ghi nhận khi có quà
-- ---------------------------------------------------------------------
create or replace function private.shine_sender_ok(p_from uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.created_at <= now() - make_interval(days => (private.shine_config()->>'minSenderAgeDays')::int)
                     from public.profiles p where p.id = p_from), false)
     and (select count(*) from public.activities a where a.user_id = p_from and a.validation_status = 'APPROVED'
             and public.activity_is_countable(a.status, a.validation_status)) >= (private.shine_config()->>'minSenderRuns')::int
$$;

create or replace function private.shine_fans(p_user uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(distinct e.from_user)::int from public.shine_entries e where e.user_id = p_user and e.countable > 0
$$;

create or replace function private.shine_on_gift() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_used numeric; v_cap numeric := (private.shine_config()->>'perSenderWeeklyCap')::numeric; v_count numeric := 0;
  v_old numeric; v_new numeric; v_fans integer; a record; v_names text[] := array['', 'Lấp lánh', 'Rạng rỡ', 'Chói sáng', 'Huyền thoại'];
begin
  if new.gift_code is null or new.to_user is null or new.from_user is null or new.from_user = new.to_user then return new; end if;
  begin
    if private.shine_sender_ok(new.from_user) then
      v_used := (select coalesce(sum(e.countable), 0) from public.shine_entries e
                  where e.user_id = new.to_user and e.from_user = new.from_user and e.created_at >= private.vn_start(private.vn_week(now())));
      v_count := greatest(least(new.amount, v_cap - v_used), 0);
    end if;
    insert into public.shine_entries (user_id, from_user, cheer_id, gift_amount, countable, created_at)
    values (new.to_user, new.from_user, new.id, new.amount, v_count, coalesce(new.created_at, now()))
    on conflict (cheer_id) do nothing;

    v_old := (select shine_total from public.profiles where id = new.to_user);
    update public.profiles set shine_total = shine_total + new.amount where id = new.to_user returning shine_total into v_new;
    if private.shine_tier(v_new) > private.shine_tier(v_old) then
      perform private.notify(new.to_user, null, 'SHINE', 'Bạn đã đạt Tỏa sáng ' || v_names[private.shine_tier(v_new) + 1] || ' ✨',
        'Ảnh đại diện của bạn có khung mới. Cảm ơn cộng đồng đã tiếp sức!', '/me/shine', null, true);
    end if;

    -- Huy hiệu người hâm mộ (đếm người tặng hợp lệ khác nhau)
    v_fans := private.shine_fans(new.to_user);
    for a in select x.* from public.achievements x
              where x.is_active and x.rule->>'type' = 'GIFT_FANS' and (x.rule->>'gte')::int <= v_fans
                and not exists (select 1 from public.user_achievements u where u.user_id = new.to_user and u.achievement_id = x.id) loop
      insert into public.user_achievements (user_id, achievement_id) values (new.to_user, a.id) on conflict do nothing;
      perform private.award(new.to_user, 'BADGE', 'Huy hiệu: ' || a.title, a.description, 0, 0, 'badge:' || a.code || ':' || new.to_user, null,
        jsonb_build_object('code', a.code, 'tier', a.tier, 'icon', a.icon));
      perform private.notify(new.to_user, null, 'BADGE', 'Huy hiệu mới: ' || a.title, a.description, '/me?tab=badges', null, true);
    end loop;
  exception when others then
    raise warning 'shine_on_gift % lỗi: % %', new.id, sqlstate, sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists trg_shine_on_gift on public.cheers;
create trigger trg_shine_on_gift after insert on public.cheers for each row execute function private.shine_on_gift();

-- Dữ liệu cũ: tính lại Tỏa sáng tích lũy và phần khả dụng của các quà đã tặng trước đây (áp đúng trần tuần)
insert into public.shine_entries (user_id, from_user, cheer_id, gift_amount, countable, created_at)
select t.to_user, t.from_user, t.id, t.amount,
       case when t.ok then greatest(least(t.amount, 300 - (t.cum - t.amount)), 0) else 0 end, t.created_at
  from (select c.id, c.to_user, c.from_user, c.amount, c.created_at, private.shine_sender_ok(c.from_user) as ok,
               sum(c.amount) over (partition by c.to_user, c.from_user, private.vn_week(c.created_at) order by c.created_at, c.id) as cum
          from public.cheers c
         where c.gift_code is not null and c.to_user is not null and c.from_user is not null and c.from_user <> c.to_user) t
on conflict (cheer_id) do nothing;
update public.profiles p set shine_total = s.total
  from (select c.to_user, sum(c.amount) as total from public.cheers c where c.gift_code is not null group by c.to_user) s
 where s.to_user = p.id and p.shine_total is distinct from s.total;

-- ---------------------------------------------------------------------
-- 3. Người dùng
-- ---------------------------------------------------------------------
create or replace function private.shine_available(p_user uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(countable) from public.shine_entries where user_id = p_user), 0)
       - coalesce((select sum(cost) from public.shine_spends where user_id = p_user), 0)
$$;

create or replace function public.my_shine() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_total numeric := (select shine_total from public.profiles where id = v_uid);
  v_avail numeric := private.shine_available(v_uid);
  v_senders integer := (select count(distinct from_user) from public.shine_entries where user_id = v_uid and countable > 0 and created_at >= now() - interval '30 days');
  cfg jsonb := private.shine_config();
begin
  return jsonb_build_object(
    'total', v_total, 'available', v_avail, 'tier', private.shine_tier(v_total), 'tiers', cfg->'tiers',
    'fans', private.shine_fans(v_uid), 'senders_30d', v_senders, 'per_sender_weekly_cap', cfg->'perSenderWeeklyCap',
    'shop', (select coalesce(jsonb_agg(jsonb_build_object(
               'code', s.code, 'name', s.name, 'description', s.description, 'kind', s.kind, 'cost', s.cost,
               'period_limit', s.period_limit, 'limit_period', s.limit_period, 'min_senders', s.min_senders, 'params', s.params,
               'item', case when s.kind = 'COSMETIC' then (select private.item_json(i) || jsonb_build_object('owned', exists (select 1 from public.user_inventory u where u.user_id = v_uid and u.item_id = i.id))
                                                             from public.avatar_items i where i.code = s.params->>'item_code') end,
               'used', (select count(*) from public.shine_spends x where x.user_id = v_uid and x.item_code = s.code
                          and x.created_at >= private.vn_start(case s.limit_period when 'WEEK' then private.vn_week(now()) else date_trunc('month', private.vn_day(now()))::date end)))
               order by s.sort, s.cost), '[]'::jsonb) from public.shine_shop s where s.is_active),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('code', x.item_code, 'name', s.name, 'cost', x.cost, 'at', x.created_at) order by x.created_at desc), '[]'::jsonb)
                  from (select * , row_number() over (order by created_at desc) rn from public.shine_spends where user_id = v_uid) x
                  join public.shine_shop s on s.code = x.item_code where x.rn <= 20),
    'supporters', (select coalesce(jsonb_agg(jsonb_build_object('user_id', t.from_user, 'display_name', private.display_name(t.from_user),
                     'avatar_url', (select p.avatar_url from public.profiles p where p.id = t.from_user), 'amount', t.s, 'last_at', t.last_at,
                     'thanked_today', exists (select 1 from public.shine_thanks k where k.from_user = v_uid and k.to_user = t.from_user and k.day = private.vn_day(now())))
                     order by t.last_at desc), '[]'::jsonb)
                     from (select e.from_user, sum(e.gift_amount) as s, max(e.created_at) as last_at, row_number() over (order by max(e.created_at) desc) as rn
                             from public.shine_entries e where e.user_id = v_uid and e.from_user is not null and e.created_at >= now() - interval '30 days'
                            group by e.from_user) t where t.rn <= 20),
    'thanks_left', greatest((cfg->>'thanksPerDay')::int - (select count(*) from public.shine_thanks k where k.from_user = v_uid and k.day = private.vn_day(now())), 0));
end $$;

create or replace function public.redeem_shine(p_code text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  s public.shine_shop := (select x from public.shine_shop x where x.code = upper(coalesce(p_code, '')) and x.is_active);
  v_used integer; v_senders integer; v_item uuid; st public.user_streaks; v_spend uuid; v_max integer;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if exists (select 1 from public.shine_spends where ref = 'shine:' || p_idempotency_key) then
    return jsonb_build_object('duplicate', true, 'available', private.shine_available(v_uid));
  end if;
  if s.code is null then raise exception 'SHINE_ITEM_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended('shine:' || v_uid, 0));
  if private.shine_available(v_uid) < s.cost then raise exception 'INSUFFICIENT_SHINE'; end if;
  if s.period_limit is not null then
    v_used := (select count(*) from public.shine_spends x where x.user_id = v_uid and x.item_code = s.code
                 and x.created_at >= private.vn_start(case s.limit_period when 'WEEK' then private.vn_week(now()) else date_trunc('month', private.vn_day(now()))::date end));
    if v_used >= s.period_limit then raise exception 'SHINE_LIMIT'; end if;
  end if;
  if s.min_senders > 0 then
    v_senders := (select count(distinct from_user) from public.shine_entries where user_id = v_uid and countable > 0 and created_at >= now() - interval '30 days');
    if v_senders < s.min_senders then raise exception 'SHINE_NEED_SENDERS'; end if;
  end if;

  insert into public.shine_spends (user_id, item_code, cost, ref) values (v_uid, s.code, s.cost, 'shine:' || p_idempotency_key) returning id into v_spend;
  if s.kind = 'PASS' then
    insert into public.challenge_passes (owner_type, owner_id, max_slots, total, remaining, expires_at, note, granted_by, source_key)
    values ('USER', v_uid, coalesce((s.params->>'max_slots')::int, 20), 1, 1, now() + make_interval(days => coalesce((s.params->>'days')::int, 30)),
            'Đổi từ Tỏa sáng', null, 'shine:' || v_spend);
  elsif s.kind = 'SHIELD' then
    perform private.ensure_streak(v_uid);
    st := (select x from public.user_streaks x where x.user_id = v_uid);
    v_max := (private.game_config()->>'maxShields')::int;
    if st.shields >= v_max then raise exception 'SHIELD_LIMIT'; end if;
    update public.user_streaks set shields = shields + 1, updated_at = now() where user_id = v_uid;
  else
    v_item := (select i.id from public.avatar_items i where i.code = s.params->>'item_code');
    if v_item is null then raise exception 'ITEM_NOT_FOUND'; end if;
    if exists (select 1 from public.user_inventory where user_id = v_uid and item_id = v_item) then raise exception 'ALREADY_OWNED'; end if;
    insert into public.user_inventory (user_id, item_id, acquired_reason) values (v_uid, v_item, 'SHINE');
  end if;
  return jsonb_build_object('code', s.code, 'name', s.name, 'cost', s.cost, 'available', private.shine_available(v_uid));
end $$;

-- Lời cảm ơn miễn phí tới người đã tặng mình trong 30 ngày (không có giá trị kinh tế)
create or replace function public.send_thanks(p_to_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); v_day date := private.vn_day(now()); v_left integer;
begin
  if p_to_user is null or p_to_user = v_uid then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.cheers c where c.to_user = v_uid and c.from_user = p_to_user and c.gift_code is not null
                   and c.created_at >= now() - interval '30 days') then raise exception 'NOT_A_SUPPORTER'; end if;
  v_left := (private.shine_config()->>'thanksPerDay')::int - (select count(*) from public.shine_thanks where from_user = v_uid and day = v_day);
  if v_left <= 0 then raise exception 'THANKS_LIMIT'; end if;
  insert into public.shine_thanks (from_user, to_user, day) values (v_uid, p_to_user, v_day) on conflict do nothing;
  if not found then raise exception 'ALREADY_THANKED'; end if;
  perform private.notify(p_to_user, null, 'THANKS', private.display_name(v_uid) || ' cảm ơn bạn đã tiếp sức 💛',
    'Món quà của bạn đã tiếp thêm năng lượng cho buổi chạy.', '/me/shine', v_uid, false);
  return jsonb_build_object('thanks_left', v_left - 1);
end $$;

-- Tường quà: thêm bậc, số người hâm mộ, bộ sưu tập theo độ hiếm; chủ hồ sơ có thể ẩn chi tiết
create or replace function public.gift_wall(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_total numeric := coalesce((select shine_total from public.profiles where id = p_user), 0);
  v_public boolean := coalesce((select gift_wall_public from public.profiles where id = p_user), true);
  v_me boolean := p_user = auth.uid();
begin
  if not v_public and not v_me then
    return jsonb_build_object('hidden', true, 'shine', v_total, 'tier', private.shine_tier(v_total), 'count', 0, 'gifts', '[]'::jsonb, 'top_supporters', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'hidden', false, 'public', v_public,
    'shine', v_total, 'tier', private.shine_tier(v_total), 'fans', private.shine_fans(p_user),
    'count', coalesce((select sum(c.qty) from public.cheers c where c.to_user = p_user and c.gift_code is not null), 0),
    'gifts', (select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'name', t.name, 'emoji', t.emoji, 'tier', t.tier, 'count', t.n)
                                         order by t.price desc), '[]'::jsonb)
                from (select g.code, g.name, g.emoji, g.tier, g.price_xu as price, sum(c.qty) as n
                        from public.cheers c join public.gift_catalog g on g.code = c.gift_code
                       where c.to_user = p_user group by g.code, g.name, g.emoji, g.tier, g.price_xu) t),
    -- Bộ sưu tập: đã nhận bao nhiêu loại / tổng số loại theo từng tầng
    'collection', (select coalesce(jsonb_agg(jsonb_build_object('tier', x.tier, 'owned', x.owned, 'total', x.total) order by x.o), '[]'::jsonb)
                     from (select g.tier, count(*) as total,
                                  count(*) filter (where exists (select 1 from public.cheers c where c.to_user = p_user and c.gift_code = g.code)) as owned,
                                  min(g.price_xu) as o
                             from public.gift_catalog g where g.is_active or exists (select 1 from public.cheers c where c.to_user = p_user and c.gift_code = g.code)
                            group by g.tier) x),
    'top_supporters', (select coalesce(jsonb_agg(jsonb_build_object('user_id', t.from_user, 'display_name', private.display_name(t.from_user),
                                                  'avatar_url', (select p.avatar_url from public.profiles p where p.id = t.from_user), 'shine', t.s)
                                                  order by t.s desc), '[]'::jsonb)
                         from (select c.from_user, sum(c.amount) as s, row_number() over (order by sum(c.amount) desc) as rn
                                 from public.cheers c where c.to_user = p_user and c.gift_code is not null group by c.from_user) t
                        where t.rn <= 5));
end $$;

-- Thử thách: 3 người được tiếp sức nhiều nhất trong thời gian thử thách
create or replace function public.challenge_top_supported(p_challenge_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_from timestamptz := (select ch.start_date from public.challenges ch where ch.id = p_challenge_id);
  v_to timestamptz := (select ch.end_date from public.challenges ch where ch.id = p_challenge_id);
begin
  if not exists (select 1 from public.challenges ch where ch.id = p_challenge_id) then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('user_id', t.to_user, 'display_name', private.display_name(t.to_user),
            'avatar_url', (select p.avatar_url from public.profiles p where p.id = t.to_user), 'shine', t.s, 'gifts', t.n,
            'tier', private.shine_tier((select p.shine_total from public.profiles p where p.id = t.to_user))) order by t.s desc), '[]'::jsonb)
            from (select cp.profile_id as to_user, sum(ch.amount) as s, sum(ch.qty) as n, row_number() over (order by sum(ch.amount) desc) as rn
                    from public.challenge_participants cp
                    join public.cheers ch on ch.to_user = cp.profile_id and ch.gift_code is not null
                                         and ch.created_at >= coalesce(v_from, '-infinity'::timestamptz)
                                         and ch.created_at < coalesce(v_to, 'infinity'::timestamptz)
                   where cp.challenge_id = p_challenge_id and cp.status <> 'LEFT'
                   group by cp.profile_id) t
           where t.rn <= 3);
end $$;

-- Tiến độ huy hiệu người hâm mộ trong danh sách huy hiệu
create or replace function public.my_achievements()
returns table (code text, title text, description text, category text, tier text, icon text, xp_reward integer, xu_reward numeric,
               target numeric, progress numeric, unlocked_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); st jsonb := private.player_stats(v_uid) || jsonb_build_object('GIFT_FANS', private.shine_fans(v_uid));
begin
  return query
  select a.code, a.title, a.description, a.category, a.tier, a.icon, a.xp_reward, a.xu_reward,
         coalesce((a.rule->>'gte')::numeric, 1),
         case when a.rule is null then 1 else least(coalesce((st->>(a.rule->>'type'))::numeric, 0), (a.rule->>'gte')::numeric) end,
         u.unlocked_at
    from public.achievements a
    left join public.user_achievements u on u.achievement_id = a.id and u.user_id = v_uid
   where a.is_active and (a.rule is not null or (a.category = 'EVENT' and u.unlocked_at is not null))
   order by a.sort, u.unlocked_at;
end $$;

-- ---------------------------------------------------------------------
-- 4. Admin
-- ---------------------------------------------------------------------
create or replace function public.admin_shine_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_admin();
begin
  return jsonb_build_object(
    'config', private.shine_config(),
    'items', (select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object(
                'redeemed_30d', (select count(*) from public.shine_spends x where x.item_code = s.code and x.created_at >= now() - interval '30 days'),
                'item_name', (select i.name from public.avatar_items i where i.code = s.params->>'item_code')) order by s.sort, s.cost), '[]'::jsonb)
                from public.shine_shop s),
    'gifted_30d', (select coalesce(sum(gift_amount), 0) from public.shine_entries where created_at >= now() - interval '30 days'),
    'countable_30d', (select coalesce(sum(countable), 0) from public.shine_entries where created_at >= now() - interval '30 days'),
    'spent_30d', (select coalesce(sum(cost), 0) from public.shine_spends where created_at >= now() - interval '30 days'),
    'xu_equiv_30d', (select coalesce(sum(coalesce((s.params->>'xu_value')::numeric, 0)), 0) from public.shine_spends x join public.shine_shop s on s.code = x.item_code
                      where x.created_at >= now() - interval '30 days'),
    'tiers_count', (select jsonb_agg(jsonb_build_object('tier', t.tier, 'users', t.n) order by t.tier)
                      from (select private.shine_tier(shine_total) as tier, count(*) as n from public.profiles where shine_total > 0 group by 1) t));
end $$;

create or replace function public.admin_save_shine_item(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  v_code text := upper(trim(coalesce(p->>'code', '')));
  v_kind text := upper(coalesce(p->>'kind', ''));
  v_params jsonb := case when jsonb_typeof(p->'params') = 'object' then p->'params' else '{}'::jsonb end;
begin
  if v_code !~ '^[A-Z0-9_]{2,32}$' then raise exception 'INVALID_CODE'; end if;
  if v_kind not in ('PASS', 'SHIELD', 'COSMETIC') then raise exception 'INVALID_KIND'; end if;
  if char_length(trim(coalesce(p->>'name', ''))) not between 2 and 80 then raise exception 'INVALID_TITLE'; end if;
  if coalesce((p->>'cost')::int, 0) not between 1 and 10000000 then raise exception 'INVALID_AMOUNT'; end if;
  if v_kind = 'PASS' and coalesce((v_params->>'max_slots')::int, 0) not between 2 and 1000 then raise exception 'INVALID_PASSES'; end if;
  if v_kind = 'COSMETIC' then
    if not exists (select 1 from public.avatar_items i where i.code = v_params->>'item_code') then raise exception 'ITEM_NOT_FOUND'; end if;
    -- Vật phẩm đã vào cửa hàng Tỏa sáng thì không bán bằng Xu nữa
    update public.avatar_items set metadata = coalesce(metadata, '{}'::jsonb) || '{"acquire": "shine"}' where code = v_params->>'item_code';
  end if;
  insert into public.shine_shop (code, name, description, kind, cost, period_limit, limit_period, min_senders, params, is_active, sort)
  values (v_code, trim(p->>'name'), nullif(trim(coalesce(p->>'description', '')), ''), v_kind, (p->>'cost')::int,
          nullif((p->>'period_limit')::int, 0), coalesce(nullif(upper(p->>'limit_period'), ''), 'MONTH'), greatest(coalesce((p->>'min_senders')::int, 0), 0),
          v_params, coalesce((p->>'is_active')::boolean, true), coalesce((p->>'sort')::int, 100))
  on conflict (code) do update set name = excluded.name, description = excluded.description, kind = excluded.kind, cost = excluded.cost,
    period_limit = excluded.period_limit, limit_period = excluded.limit_period, min_senders = excluded.min_senders, params = excluded.params,
    is_active = excluded.is_active, sort = excluded.sort;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SAVE_SHINE_ITEM', v_code, p);
  return v_code;
end $$;

create or replace function public.admin_set_shine_config(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_admin(); v jsonb := '{}'::jsonb; k text;
begin
  foreach k in array array['perSenderWeeklyCap', 'minSenderAgeDays', 'minSenderRuns', 'thanksPerDay'] loop
    if p ? k then
      if jsonb_typeof(p->k) <> 'number' or (p->>k)::numeric < 0 or (p->>k)::numeric > 1000000 then raise exception 'INVALID_LIMIT'; end if;
      v := v || jsonb_build_object(k, (p->>k)::numeric);
    end if;
  end loop;
  if p ? 'tiers' then
    if jsonb_typeof(p->'tiers') <> 'array' or jsonb_array_length(p->'tiers') <> 4
       or exists (select 1 from jsonb_array_elements(p->'tiers') with ordinality t(v, i)
                   where jsonb_typeof(t.v) <> 'number' or t.v::text::numeric <= 0
                      or (t.i > 1 and t.v::text::numeric <= (p->'tiers'->((t.i - 2)::int))::text::numeric)) then raise exception 'INVALID_LIMIT'; end if;
    v := v || jsonb_build_object('tiers', p->'tiers');
  end if;
  insert into private.app_settings (key, value) values ('shine_config', (private.shine_config() || v)::text)
  on conflict (key) do update set value = excluded.value;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SHINE_CONFIG', 'shine_config', v);
  return private.shine_config();
end $$;

revoke all on function private.shine_config(), private.shine_tier(numeric), private.shine_sender_ok(uuid), private.shine_fans(uuid),
  private.shine_available(uuid), private.shine_on_gift() from public, anon, authenticated;
revoke all on function public.my_shine(), public.redeem_shine(text, text), public.send_thanks(uuid), public.challenge_top_supported(uuid),
  public.admin_shine_overview(), public.admin_save_shine_item(jsonb), public.admin_set_shine_config(jsonb) from public, anon;
grant execute on function public.my_shine(), public.redeem_shine(text, text), public.send_thanks(uuid), public.challenge_top_supported(uuid),
  public.admin_shine_overview(), public.admin_save_shine_item(jsonb), public.admin_set_shine_config(jsonb) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001004800_design_layers.sql
-- ===================================================================
-- 004800: Thiết kế BIB bản 2 + Giấy chứng nhận do BTC thiết kế.
-- • Mọi thứ trên BIB / chứng nhận là LỚP kéo thả: chữ (gắn trường dữ liệu hoặc chữ tự nhập, 40 font tiếng Việt, hiệu ứng
--   viền / bóng / phát sáng / bôi dạ quang / nền khối / băng chéo…), ảnh (logo, nhà tài trợ, chữ ký), mã QR (xác thực VĐV,
--   trang giải, đơn vị tổ chức, phí tham gia, đường link, ảnh QR tải lên), hình trang trí (khối, đường kẻ, nguyệt quế, con dấu).
-- • virtual_races.cert_design + set_race_cert_design: mẫu chứng nhận (khổ dọc 4:5 / ngang A4).
-- • race_design_assets: BTC lấy sẵn QR nhận tiền / tài khoản ngân hàng đã lưu của CLB để in "QR phí tham gia".
-- • Ảnh hợp lệ: kho race-media của giải, hoặc ảnh trong thư mục club-media của CLB tổ chức (QR ngân hàng đã lưu).
-- Cần 002900 → 003200. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

alter table public.virtual_races add column if not exists cert_design jsonb;

-- ---------------------------------------------------------------------
-- 1. Hàm làm sạch dùng chung
-- ---------------------------------------------------------------------
create or replace function private.design_src_ok(r public.virtual_races, p_url text) returns boolean
language sql stable as $$
  select p_url is null
      or private.race_media_ok(r.id, p_url)
      or (r.club_id is not null and char_length(p_url) <= 500 and p_url ~ '^https://'
          and position('/storage/v1/object/public/club-media/' || r.club_id::text || '/' in p_url) > 0)
$$;

-- Màu: một màu trong bảng màu (bg, band, number, text, accent) hoặc #rrggbb; sai → mặc định
create or replace function private.design_paint(v jsonb, def text) returns text
language sql immutable as $$
  select case
    when jsonb_typeof(v) <> 'string' then def
    when (v #>> '{}') ~ '^#[0-9a-fA-F]{6}$' then lower(v #>> '{}')
    when (v #>> '{}') = any (array['bg', 'band', 'number', 'text', 'accent']) then v #>> '{}'
    else def end
$$;

create or replace function private.design_str(v jsonb, n int) returns text
language sql immutable as $$
  select case when jsonb_typeof(v) = 'string' then left(v #>> '{}', n) else '' end
$$;

-- Danh sách lớp: tối đa 40; lớp lạ bị bỏ; lựa chọn sai → INVALID_BIB_DESIGN; ảnh ngoài kho → INVALID_BIB_IMAGE
create or replace function private.design_layers(r public.virtual_races, arr jsonb, p_binds text[]) returns jsonb
language plpgsql stable as $$
declare
  v_fonts text[] := array['sans', 'montserrat', 'inter', 'lexend', 'unbounded', 'impact', 'dela', 'paytone', 'sigmar', 'bungee', 'bungee_shade',
    'rowdies', 'condensed', 'athletic', 'saira', 'roboto_c', 'asap_c', 'fjalla', 'mono', 'tech', 'exo', 'kanit', 'tourney', 'protest', 'stencil',
    'slab', 'alfa', 'serif', 'cormorant', 'garamond', 'yeseva', 'script', 'vibes', 'allura', 'pacifico', 'lobster', 'graffiti', 'brush', 'bangers', 'patrick'];
  v_fx text[] := array['none', 'outline', 'stroke', 'shadow', 'glow', 'extrude', 'marker', 'box', 'pill', 'slant', 'underline', 'gold', 'gradient'];
begin
  if arr is null or jsonb_typeof(arr) = 'null' then return '[]'::jsonb; end if;
  if jsonb_typeof(arr) <> 'array' or jsonb_array_length(arr) > 40 then raise exception 'INVALID_BIB_DESIGN'; end if;
  if exists (select 1 from jsonb_array_elements(arr) e
              where e->>'type' in ('image', 'qr') and not private.design_src_ok(r, e->>'src')) then
    raise exception 'INVALID_BIB_IMAGE';
  end if;
  return (select coalesce(jsonb_agg(x.j order by x.ord), '[]'::jsonb) from (
    select e.ord,
      jsonb_build_object(
        'id', case when e.v->>'id' ~ '^[A-Za-z0-9_-]{1,24}$' then e.v->>'id' else 'l' || e.ord::text end,
        'type', e.v->>'type',
        'x', private.bib_num(e.v->'x', -0.2, 1.2, 0.5), 'y', private.bib_num(e.v->'y', -0.2, 1.2, 0.5),
        'rot', private.bib_num(e.v->'rot', -180, 180, 0), 'opacity', private.bib_num(e.v->'opacity', 0.05, 1, 1),
        'hidden', private.bib_bool(e.v->'hidden', false), 'locked', private.bib_bool(e.v->'locked', false))
      || case e.v->>'type'
        when 'text' then jsonb_build_object(
          'bind', case when e.v->>'bind' = any (p_binds || 'custom'::text) then e.v->>'bind' else 'custom' end,
          'text', private.design_str(e.v->'text', 120),
          'font', private.bib_pick(e.v->>'font', v_fonts, 'sans'),
          'size', private.bib_num(e.v->'size', 8, 800, 48), 'w', private.bib_num(e.v->'w', 0.03, 1.2, 0.8),
          'align', private.bib_pick(e.v->>'align', array['left', 'center', 'right'], 'center'),
          'color', private.design_paint(e.v->'color', 'text'),
          'italic', private.bib_bool(e.v->'italic', false), 'upper', private.bib_bool(e.v->'upper', false),
          'spacing', private.bib_num(e.v->'spacing', -0.1, 1, 0),
          'fx', private.bib_pick(e.v->>'fx', v_fx, 'none'),
          'fx_color', private.design_paint(e.v->'fx_color', 'accent'))
        when 'image' then jsonb_build_object(
          'role', private.bib_pick(e.v->>'role', array['logo', 'sponsor', 'image', 'signature'], 'image'),
          'src', e.v->>'src', 'name', trim(private.design_str(e.v->'name', 40)),
          'w', private.bib_num(e.v->'w', 0.02, 1.2, 0.16), 'h', private.bib_num(e.v->'h', 0.02, 1.2, 0.12))
        when 'qr' then jsonb_build_object(
          'source', private.bib_pick(e.v->>'source', array['verify', 'race', 'club', 'fee', 'link', 'image'], 'verify'),
          'src', e.v->>'src', 'url', private.design_str(e.v->'url', 400),
          'w', private.bib_num(e.v->'w', 0.05, 0.6, 0.14),
          'label', private.design_str(e.v->'label', 40), 'card', private.bib_bool(e.v->'card', true))
        else jsonb_build_object(
          'shape', private.bib_pick(e.v->>'shape', array['rect', 'round', 'pill', 'circle', 'line', 'slash', 'laurel', 'seal'], 'rect'),
          'w', private.bib_num(e.v->'w', 0.005, 1.5, 0.3), 'h', private.bib_num(e.v->'h', 0.003, 1.5, 0.1),
          'fill', private.design_paint(e.v->'fill', 'band'))
      end as j
    from jsonb_array_elements(arr) with ordinality as e(v, ord)
    where e.v->>'type' in ('text', 'image', 'qr', 'shape')) x);
end $$;

create or replace function private.design_colors(c jsonb) returns jsonb
language plpgsql immutable as $$
declare k text; v_out jsonb := '{}'::jsonb;
begin
  if c is null or jsonb_typeof(c) <> 'object' then return v_out; end if;
  foreach k in array array['bg', 'band', 'number', 'text', 'accent'] loop
    if c ? k then
      if coalesce(c->>k, '') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_BIB_DESIGN'; end if;
      v_out := v_out || jsonb_build_object(k, lower(c->>k));
    end if;
  end loop;
  return v_out;
end $$;

create or replace function private.design_fit(f jsonb) returns jsonb
language sql immutable as $$
  select jsonb_build_object('zoom', private.bib_num(f->'zoom', 0.5, 3, 1), 'x', private.bib_num(f->'x', -1, 1, 0), 'y', private.bib_num(f->'y', -1, 1, 0))
$$;

-- ---------------------------------------------------------------------
-- 2. Lưu thiết kế BIB (bản 2 — bản 1 cũ vẫn hiển thị được, app tự chuyển đổi)
-- ---------------------------------------------------------------------
create or replace function public.set_race_bib_design(p_race_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  r public.virtual_races := (select x from public.virtual_races x where x.id = p_race_id);
  v_tpl text := coalesce(p->>'template', 'classic');
  v_out jsonb;
begin
  if r.id is null then raise exception 'RACE_NOT_FOUND'; end if;
  if not private.race_is_manager(r) then raise exception 'FORBIDDEN'; end if;
  if coalesce(p->>'v', '1') <> '2' then raise exception 'APP_OUTDATED'; end if;
  if v_tpl not in ('classic', 'marathon', 'stripe', 'split', 'gradient', 'speed', 'neon', 'minimal') then raise exception 'INVALID_BIB_DESIGN'; end if;
  if not private.race_media_ok(r.id, p->>'bg_url') or not private.race_media_ok(r.id, p->>'art_url') then raise exception 'INVALID_BIB_IMAGE'; end if;
  v_out := jsonb_build_object(
    'v', 2, 'template', v_tpl, 'colors', private.design_colors(p->'colors'),
    'bg_url', p->>'bg_url', 'bg_opacity', private.bib_num(p->'bg_opacity', 0, 1, 0.35),
    'art_url', p->>'art_url', 'use_art', private.bib_bool(p->'use_art', false) and p->>'art_url' is not null,
    'art_fit', private.design_fit(coalesce(p->'art_fit', '{}'::jsonb)),
    'decor', private.bib_bool(p->'decor', true), 'strip', private.bib_bool(p->'strip', false), 'pins', private.bib_bool(p->'pins', true),
    'layers', private.design_layers(r, p->'layers', array['number', 'name', 'org', 'race', 'distance', 'dates']));
  update public.virtual_races set bib_design = v_out where id = r.id;
  return v_out;
end $$;

-- ---------------------------------------------------------------------
-- 3. Thiết kế giấy chứng nhận
-- ---------------------------------------------------------------------
create or replace function public.set_race_cert_design(p_race_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  r public.virtual_races := (select x from public.virtual_races x where x.id = p_race_id);
  v_out jsonb;
begin
  if r.id is null then raise exception 'RACE_NOT_FOUND'; end if;
  if not private.race_is_manager(r) then raise exception 'FORBIDDEN'; end if;
  if p is null or jsonb_typeof(p) = 'null' then
    update public.virtual_races set cert_design = null where id = r.id;       -- về mẫu mặc định
    return null;
  end if;
  if not private.race_media_ok(r.id, p->>'bg_url') or not private.race_media_ok(r.id, p->>'art_url') then raise exception 'INVALID_BIB_IMAGE'; end if;
  v_out := jsonb_build_object(
    'v', 2,
    'format', private.bib_pick(p->>'format', array['portrait', 'landscape'], 'portrait'),
    'template', private.bib_pick(p->>'template', array['midnight', 'ivory', 'bold', 'minimal'], 'midnight'),
    'colors', private.design_colors(p->'colors'),
    'bg_url', p->>'bg_url', 'bg_opacity', private.bib_num(p->'bg_opacity', 0, 1, 0.3),
    'art_url', p->>'art_url', 'use_art', private.bib_bool(p->'use_art', false) and p->>'art_url' is not null,
    'art_fit', private.design_fit(coalesce(p->'art_fit', '{}'::jsonb)),
    'decor', private.bib_bool(p->'decor', true),
    'layers', private.design_layers(r, p->'layers', array['name', 'race', 'org', 'distance', 'time', 'pace', 'rank', 'date', 'bib']));
  update public.virtual_races set cert_design = v_out where id = r.id;
  return v_out;
end $$;

-- ---------------------------------------------------------------------
-- 4. Tài nguyên có sẵn cho trình thiết kế (chỉ BTC): QR nhận tiền / tài khoản ngân hàng của CLB tổ chức
-- ---------------------------------------------------------------------
create or replace function public.race_design_assets(p_race_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  r public.virtual_races := (select x from public.virtual_races x where x.id = p_race_id);
begin
  if r.id is null then raise exception 'RACE_NOT_FOUND'; end if;
  if not private.race_is_manager(r) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'club', (select jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url) from public.clubs c where c.id = r.club_id),
    'bank_qr_url', (select c.bank_qr_url from public.clubs c where c.id = r.club_id),
    'bank', (select case when c.bank_bin is null or c.bank_account_no is null then null
                         else jsonb_build_object('bin', c.bank_bin, 'account_no', c.bank_account_no, 'account_name', c.bank_account_name) end
               from public.clubs c where c.id = r.club_id));
end $$;

-- ---------------------------------------------------------------------
-- 5. Chi tiết giải kèm thiết kế chứng nhận (thay bản 002700)
-- ---------------------------------------------------------------------
create or replace function public.race_detail(p_race_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.virtual_races := (select x from public.virtual_races x where x.id = p_race_id);
begin
  if r.id is null or not private.race_visible(r) then raise exception 'RACE_NOT_FOUND'; end if;
  return private.race_card(r) || jsonb_build_object('cert_design', r.cert_design, 'per_distance', (
    select coalesce(jsonb_agg(jsonb_build_object('distance_km', d,
             'registered', (select count(*) from public.race_registrations g where g.race_id = r.id and g.distance_km = d and g.status <> 'WITHDRAWN'),
             'finished', (select count(*) from public.race_registrations g where g.race_id = r.id and g.distance_km = d and g.status = 'FINISHED'))
             order by d), '[]'::jsonb)
      from unnest(r.distances) as d));
end $$;

revoke all on function private.design_src_ok(public.virtual_races, text), private.design_paint(jsonb, text), private.design_str(jsonb, int),
  private.design_layers(public.virtual_races, jsonb, text[]), private.design_colors(jsonb), private.design_fit(jsonb)
  from public, anon, authenticated;
revoke all on function public.set_race_bib_design(uuid, jsonb), public.set_race_cert_design(uuid, jsonb), public.race_design_assets(uuid) from public, anon;
grant execute on function public.set_race_bib_design(uuid, jsonb), public.set_race_cert_design(uuid, jsonb), public.race_design_assets(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001004900_challenge_honors.sql
-- ===================================================================
-- 004900: Vinh danh thử thách (tính năng CLB Pro / VIP).
-- • BTC bật mục Vinh danh, chọn hạng mục: Top thành tích · Nhiều km nhất · Chạy đều nhất (số ngày) · Chuỗi ngày liên tiếp dài nhất ·
--   Bứt phá nhất (km trong thử thách so với cùng khoảng thời gian trước đó) · Được tiếp sức nhiều nhất (quà) · Giải BTC tự đặt (chọn tay).
-- • Thiết kế ảnh vinh danh bằng engine lớp (như BIB): ảnh nhóm theo hạng mục + ảnh cá nhân; khung ảnh runner (lớp 'photo').
-- • Chỉ công bố sau khi thử thách kết thúc ≥ 24 giờ (thời gian khiếu nại / duyệt bài). Công bố lại được (giữ ảnh / lựa chọn ẩn của runner).
-- • Runner được vinh danh tự tải ảnh đẹp hơn, hoặc ẨN mình khỏi ảnh công khai. BTC tải ảnh thay được (runner vẫn ẩn được).
-- • Người được vinh danh: thông báo + huy hiệu "Được vinh danh" (không có XP — XP chỉ từ km).
-- Cần 004800. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 1. Bảng
-- ---------------------------------------------------------------------
create table if not exists public.challenge_honors (
  challenge_id uuid primary key references public.challenges(id) on delete cascade,
  enabled boolean not null default true,
  categories jsonb not null default '[]'::jsonb,
  design jsonb,
  card_design jsonb,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED')),
  published_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
create table if not exists public.challenge_honorees (
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  category text not null,
  rank integer not null check (rank between 1 and 10),
  user_id uuid not null references public.profiles(id) on delete cascade,
  value numeric,
  created_at timestamptz not null default now(),
  primary key (challenge_id, category, rank)
);
create index if not exists challenge_honorees_user_idx on public.challenge_honorees (user_id);
-- Lựa chọn của từng runner trong một thử thách: ảnh riêng, ẩn khỏi ảnh công khai
create table if not exists public.challenge_honor_prefs (
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  photo_url text,
  photo_by uuid references public.profiles(id) on delete set null,
  hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);
alter table public.challenge_honors enable row level security;
alter table public.challenge_honorees enable row level security;
alter table public.challenge_honor_prefs enable row level security;

insert into public.achievements (code, title, description, category, tier, icon, rule, xp_reward, xu_reward, sort)
values ('HONORED', 'Được vinh danh', 'Có tên trong bảng vinh danh của một thử thách', 'EVENT', 'GOLD', 'Crown', null, 0, 0, 70)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 2. Kho ảnh vinh danh: honor-media/<challenge_id>/<user_id>/<file>
--    BTC thử thách tải được; người tham gia tải ảnh của chính mình
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('honor-media', 'honor-media', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create or replace function public.can_upload_honor_media(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when (storage.foldername(p_name))[1] !~ '^[0-9a-fA-F-]{36}$' then false
    when (storage.foldername(p_name))[2] is distinct from auth.uid()::text then false
    else exists (select 1 from public.challenges c where c.id = ((storage.foldername(p_name))[1])::uuid
                  and (private.challenge_is_manager(c)
                       or exists (select 1 from public.challenge_participants p where p.challenge_id = c.id and p.profile_id = auth.uid())))
    end
$$;
drop policy if exists honor_media_insert on storage.objects;
create policy honor_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'honor-media' and public.can_upload_honor_media(name));
drop policy if exists honor_media_delete on storage.objects;
create policy honor_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'honor-media' and (storage.foldername(name))[2] = auth.uid()::text);

create or replace function private.honor_media_ok(p_challenge uuid, p_url text) returns boolean
language sql immutable as $$
  select p_url is null or p_url ~ ('/storage/v1/object/public/honor-media/' || p_challenge::text || '/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$')
$$;

-- ---------------------------------------------------------------------
-- 3. Quyền: CLB Pro (thử thách của CLB) hoặc người tạo có gói VIP; admin luôn được
-- ---------------------------------------------------------------------
create or replace function private.honor_allowed(c public.challenges) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_system_admin()
      or (c.target_club_id is not null and private.club_is_pro(c.target_club_id))
      or (c.created_by is not null and private.user_vip_tier(c.created_by) > 0)
$$;

-- ---------------------------------------------------------------------
-- 4. Thiết kế (lớp) — như BIB, thêm lớp khung ảnh runner 'photo'
-- ---------------------------------------------------------------------
create or replace function private.honor_layers(p_challenge uuid, arr jsonb, p_binds text[]) returns jsonb
language plpgsql stable as $$
declare
  v_fonts text[] := array['sans', 'montserrat', 'inter', 'lexend', 'unbounded', 'impact', 'dela', 'paytone', 'sigmar', 'bungee', 'bungee_shade',
    'rowdies', 'condensed', 'athletic', 'saira', 'roboto_c', 'asap_c', 'fjalla', 'mono', 'tech', 'exo', 'kanit', 'tourney', 'protest', 'stencil',
    'slab', 'alfa', 'serif', 'cormorant', 'garamond', 'yeseva', 'script', 'vibes', 'allura', 'pacifico', 'lobster', 'graffiti', 'brush', 'bangers', 'patrick'];
  v_fx text[] := array['none', 'outline', 'stroke', 'shadow', 'glow', 'extrude', 'marker', 'box', 'pill', 'slant', 'underline', 'gold', 'gradient'];
begin
  if arr is null or jsonb_typeof(arr) = 'null' then return '[]'::jsonb; end if;
  if jsonb_typeof(arr) <> 'array' or jsonb_array_length(arr) > 60 then raise exception 'INVALID_HONOR_DESIGN'; end if;
  if exists (select 1 from jsonb_array_elements(arr) e
              where e->>'type' in ('image', 'qr', 'photo') and not private.honor_media_ok(p_challenge, e->>'src')) then
    raise exception 'INVALID_HONOR_IMAGE';
  end if;
  return (select coalesce(jsonb_agg(x.j order by x.ord), '[]'::jsonb) from (
    select e.ord,
      jsonb_build_object(
        'id', case when e.v->>'id' ~ '^[A-Za-z0-9_-]{1,24}$' then e.v->>'id' else 'l' || e.ord::text end,
        'type', e.v->>'type',
        'x', private.bib_num(e.v->'x', -0.2, 1.2, 0.5), 'y', private.bib_num(e.v->'y', -0.2, 1.2, 0.5),
        'rot', private.bib_num(e.v->'rot', -180, 180, 0), 'opacity', private.bib_num(e.v->'opacity', 0.05, 1, 1),
        'hidden', private.bib_bool(e.v->'hidden', false), 'locked', private.bib_bool(e.v->'locked', false))
      || case e.v->>'type'
        when 'text' then jsonb_build_object(
          'bind', case when e.v->>'bind' = any (p_binds || 'custom'::text) then e.v->>'bind' else 'custom' end,
          'text', private.design_str(e.v->'text', 120),
          'font', private.bib_pick(e.v->>'font', v_fonts, 'sans'),
          'size', private.bib_num(e.v->'size', 8, 800, 48), 'w', private.bib_num(e.v->'w', 0.03, 1.2, 0.8),
          'align', private.bib_pick(e.v->>'align', array['left', 'center', 'right'], 'center'),
          'color', private.design_paint(e.v->'color', 'text'),
          'italic', private.bib_bool(e.v->'italic', false), 'upper', private.bib_bool(e.v->'upper', false),
          'spacing', private.bib_num(e.v->'spacing', -0.1, 1, 0),
          'fx', private.bib_pick(e.v->>'fx', v_fx, 'none'),
          'fx_color', private.design_paint(e.v->'fx_color', 'accent'))
        when 'image' then jsonb_build_object(
          'role', private.bib_pick(e.v->>'role', array['logo', 'sponsor', 'image', 'signature'], 'image'),
          'src', e.v->>'src', 'name', trim(private.design_str(e.v->'name', 40)),
          'w', private.bib_num(e.v->'w', 0.02, 1.2, 0.16), 'h', private.bib_num(e.v->'h', 0.02, 1.2, 0.12))
        when 'qr' then jsonb_build_object(
          'source', private.bib_pick(e.v->>'source', array['verify', 'race', 'club', 'fee', 'link', 'image'], 'race'),
          'src', e.v->>'src', 'url', private.design_str(e.v->'url', 400),
          'w', private.bib_num(e.v->'w', 0.05, 0.6, 0.14),
          'label', private.design_str(e.v->'label', 40), 'card', private.bib_bool(e.v->'card', true))
        when 'photo' then jsonb_build_object(
          'bind', case when e.v->>'bind' = any (p_binds || 'custom'::text) then e.v->>'bind' else 'custom' end,
          'src', e.v->>'src',
          'shape', private.bib_pick(e.v->>'shape', array['circle', 'round', 'square', 'hex', 'arch', 'shield'], 'circle'),
          'w', private.bib_num(e.v->'w', 0.03, 1.2, 0.2), 'h', private.bib_num(e.v->'h', 0.03, 1.2, 0.2),
          'zoom', private.bib_num(e.v->'zoom', 1, 4, 1), 'ox', private.bib_num(e.v->'ox', -1, 1, 0), 'oy', private.bib_num(e.v->'oy', -1, 1, 0),
          'border', private.bib_num(e.v->'border', 0, 40, 6), 'border_color', private.design_paint(e.v->'border_color', 'accent'),
          'shadow', private.bib_bool(e.v->'shadow', true))
        else jsonb_build_object(
          'shape', private.bib_pick(e.v->>'shape', array['rect', 'round', 'pill', 'circle', 'line', 'slash', 'laurel', 'seal'], 'rect'),
          'w', private.bib_num(e.v->'w', 0.005, 1.5, 0.3), 'h', private.bib_num(e.v->'h', 0.003, 1.5, 0.1),
          'fill', private.design_paint(e.v->'fill', 'band'))
      end as j
    from jsonb_array_elements(arr) with ordinality as e(v, ord)
    where e.v->>'type' in ('text', 'image', 'qr', 'shape', 'photo')) x);
end $$;

create or replace function private.honor_design(p_challenge uuid, d jsonb) returns jsonb
language plpgsql stable as $$
declare
  v_binds text[] := array['challenge', 'org', 'category', 'date', 'me_name', 'me_value', 'me_rank', 'me'];
  i int;
begin
  if d is null or jsonb_typeof(d) = 'null' then return null; end if;
  if jsonb_typeof(d) <> 'object' then raise exception 'INVALID_HONOR_DESIGN'; end if;
  for i in 1..10 loop v_binds := v_binds || array['r' || i, 'r' || i || '_name', 'r' || i || '_value']; end loop;
  if not private.honor_media_ok(p_challenge, d->>'bg_url') then raise exception 'INVALID_HONOR_IMAGE'; end if;
  return jsonb_build_object(
    'v', 2,
    'format', private.bib_pick(d->>'format', array['square', 'portrait', 'story', 'wide'], 'portrait'),
    'template', private.bib_pick(d->>'template', array['podium', 'rays', 'confetti', 'speed', 'gold', 'neon', 'paper', 'gradient', 'stadium', 'minimal'], 'podium'),
    'colors', private.design_colors(d->'colors'),
    'bg_url', d->>'bg_url', 'bg_opacity', private.bib_num(d->'bg_opacity', 0, 1, 1),
    'decor', private.bib_bool(d->'decor', true),
    'layers', private.honor_layers(p_challenge, d->'layers', v_binds));
end $$;

-- ---------------------------------------------------------------------
-- 5. Tính danh sách vinh danh theo cấu hình
-- ---------------------------------------------------------------------
create or replace function private.honor_compute(c public.challenges, p_cats jsonb)
returns table (category text, rank integer, user_id uuid, value numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  cat jsonb;
  k text;
  n int;
  v_len interval := c.end_date - c.start_date;
begin
  for cat in select * from jsonb_array_elements(coalesce(p_cats, '[]'::jsonb)) loop
    k := cat->>'key';
    n := least(10, greatest(1, coalesce((cat->>'count')::int, 3)));
    if k = 'TOP' then
      return query select k, x.rn::int, x.pid, x.v from (
        select p.profile_id as pid, p.current_progress as v,
               row_number() over (order by p.current_progress desc, p.completed_at asc nulls last, p.joined_at) as rn
          from public.challenge_participants p
         where p.challenge_id = c.id and p.status <> 'LEFT' and p.current_progress > 0) x where x.rn <= n;
    elsif k = 'KM' then
      return query select k, x.rn::int, x.pid, x.v from (
        select p.profile_id as pid, round(p.distance_m / 1000.0, 2) as v,
               row_number() over (order by p.distance_m desc, p.joined_at) as rn
          from public.challenge_participants p
         where p.challenge_id = c.id and p.status <> 'LEFT' and p.distance_m > 0) x where x.rn <= n;
    elsif k = 'DAYS' then
      return query select k, x.rn::int, x.pid, x.v from (
        select p.profile_id as pid, p.streak_days::numeric as v,
               row_number() over (order by p.streak_days desc, p.distance_m desc) as rn
          from public.challenge_participants p
         where p.challenge_id = c.id and p.status <> 'LEFT' and p.streak_days > 0) x where x.rn <= n;
    elsif k = 'STREAK' then
      -- chuỗi ngày chạy liên tiếp dài nhất (khoảng trống & đảo)
      return query select k, x.rn::int, x.pid, x.v from (
        select s.pid, s.best::numeric as v, row_number() over (order by s.best desc, s.km desc) as rn
          from (select g.pid, max(g.len) as best, max(g.km) as km
                  from (select d.pid, d.km, count(*) over (partition by d.pid, d.grp) as len
                          from (select p.profile_id as pid, p.distance_m as km, e.day,
                                       e.day - (row_number() over (partition by p.id order by e.day))::int as grp
                                  from public.challenge_participants p
                                  join (select distinct participant_id, day from public.challenge_progress_events where challenge_id = c.id) e
                                    on e.participant_id = p.id
                                 where p.challenge_id = c.id and p.status <> 'LEFT') d) g
                 group by g.pid) s
         where s.best >= 2) x where x.rn <= n;
    elsif k = 'BREAKTHROUGH' then
      -- km trong thử thách trừ km cùng độ dài trước khi bắt đầu; cần ≥ 5 km trong thử thách
      return query select k, x.rn::int, x.pid, x.v from (
        select b.pid, round(b.gain, 2) as v, row_number() over (order by b.gain desc) as rn
          from (select p.profile_id as pid,
                       p.distance_m / 1000.0 - coalesce((select sum(coalesce(a.moving_distance_m, a.distance_m)) / 1000.0 from public.activities a
                                                           where a.user_id = p.profile_id and a.validation_status = 'APPROVED'
                                                             and a.started_at >= c.start_date - v_len and a.started_at < c.start_date), 0) as gain
                  from public.challenge_participants p
                 where p.challenge_id = c.id and p.status <> 'LEFT' and p.distance_m >= 5000) b
         where b.gain > 0) x where x.rn <= n;
    elsif k = 'SUPPORTED' then
      return query select k, x.rn::int, x.pid, x.v from (
        select t.pid, t.s as v, row_number() over (order by t.s desc) as rn
          from (select cp.profile_id as pid, sum(ch.amount) as s
                  from public.challenge_participants cp
                  join public.cheers ch on ch.to_user = cp.profile_id and ch.gift_code is not null
                                       and ch.created_at >= c.start_date and ch.created_at < c.end_date
                 where cp.challenge_id = c.id and cp.status <> 'LEFT'
                 group by cp.profile_id) t) x where x.rn <= n;
    elsif k like 'CUSTOM%' then
      return query select k, x.ord::int, x.pid, null::numeric from (
        select u.v::uuid as pid, u.ord
          from jsonb_array_elements_text(coalesce(cat->'users', '[]'::jsonb)) with ordinality as u(v, ord)
         where exists (select 1 from public.challenge_participants p where p.challenge_id = c.id and p.profile_id = u.v::uuid and p.status <> 'LEFT')) x
       where x.ord <= 10;
    end if;
  end loop;
end $$;

-- Cấu hình hạng mục: tối đa 8; khóa hợp lệ; số người 1..10; giải tự đặt ≤ 10 người
create or replace function private.honor_categories(p jsonb) returns jsonb
language plpgsql immutable as $$
declare v_out jsonb := '[]'::jsonb; cat jsonb; k text; seen text[] := '{}';
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 8 then raise exception 'INVALID_HONOR_CATEGORIES'; end if;
  for cat in select * from jsonb_array_elements(p) loop
    k := cat->>'key';
    if k is null or not (k = any (array['TOP', 'KM', 'DAYS', 'STREAK', 'BREAKTHROUGH', 'SUPPORTED']) or k ~ '^CUSTOM[1-5]$') or k = any (seen) then
      raise exception 'INVALID_HONOR_CATEGORIES';
    end if;
    if k like 'CUSTOM%' and (jsonb_typeof(coalesce(cat->'users', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(cat->'users', '[]'::jsonb)) > 10
        or exists (select 1 from jsonb_array_elements_text(coalesce(cat->'users', '[]'::jsonb)) u where u !~ '^[0-9a-fA-F-]{36}$')) then
      raise exception 'INVALID_HONOR_CATEGORIES';
    end if;
    seen := seen || k;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'key', k,
      'title', coalesce(nullif(left(trim(coalesce(cat->>'title', '')), 60), ''), k),
      'count', least(10, greatest(1, coalesce(private.bib_num(cat->'count', 1, 10, 3), 3)))::int,
      'users', case when k like 'CUSTOM%' then coalesce(cat->'users', '[]'::jsonb) else null end));
  end loop;
  return v_out;
end $$;

create or replace function private.honor_row(p_challenge uuid, p_manage boolean, p_category text, p_rank integer, p_user uuid, p_value numeric)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'category', p_category, 'rank', p_rank, 'user_id', p_user, 'value', p_value,
    'hidden', coalesce(pf.hidden, false), 'is_me', p_user = auth.uid(),
    'display_name', case when coalesce(pf.hidden, false) then 'VĐV ẩn danh' else private.display_name(p_user) end,
    'avatar_url', case when coalesce(pf.hidden, false) then null else (select p.avatar_url from public.profiles p where p.id = p_user) end,
    'photo_url', case when coalesce(pf.hidden, false) then null else pf.photo_url end,
    'own_photo', case when p_user = auth.uid() or p_manage then pf.photo_url end)
    from (select 1) one
    left join public.challenge_honor_prefs pf on pf.challenge_id = p_challenge and pf.user_id = p_user
$$;

-- ---------------------------------------------------------------------
-- 6. RPC
-- ---------------------------------------------------------------------
create or replace function public.challenge_honor(p_challenge_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
  h public.challenge_honors := (select x from public.challenge_honors x where x.challenge_id = p_challenge_id);
  v_manage boolean;
  v_rows jsonb;
begin
  if c.id is null or not public.challenge_visible(c.id) then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  v_manage := auth.uid() is not null and private.challenge_is_manager(c);
  if h.challenge_id is not null and h.status = 'PUBLISHED' then
    v_rows := (select coalesce(jsonb_agg(private.honor_row(c.id, v_manage, r.category, r.rank, r.user_id, r.value) order by r.category, r.rank), '[]'::jsonb)
                 from public.challenge_honorees r where r.challenge_id = c.id);
  elsif v_manage then
    -- bản nháp: BTC xem trước danh sách tính từ dữ liệu hiện tại
    v_rows := (select coalesce(jsonb_agg(private.honor_row(c.id, v_manage, r.category, r.rank, r.user_id, r.value) order by r.category, r.rank), '[]'::jsonb)
                 from private.honor_compute(c, coalesce(h.categories, '[{"key":"TOP","count":3}]'::jsonb)) r);
  end if;
  return jsonb_build_object(
    'enabled', coalesce(h.enabled, false), 'status', coalesce(h.status, 'DRAFT'), 'published_at', h.published_at,
    'categories', coalesce(h.categories, '[]'::jsonb), 'design', h.design, 'card_design', h.card_design,
    'can_manage', v_manage, 'allowed', private.honor_allowed(c),
    'ended', now() >= c.end_date, 'review_until', c.end_date + interval '24 hours',
    'honorees', case when v_manage or (h.enabled and h.status = 'PUBLISHED') then coalesce(v_rows, '[]'::jsonb) else '[]'::jsonb end,
    'preview', not (h.challenge_id is not null and h.status = 'PUBLISHED'));
end $$;

create or replace function public.save_challenge_honor(p_challenge_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
begin
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if not private.challenge_is_manager(c) then raise exception 'FORBIDDEN'; end if;
  if not private.honor_allowed(c) then raise exception 'HONOR_PRO_REQUIRED'; end if;
  insert into public.challenge_honors (challenge_id, enabled, categories, design, card_design, updated_by, updated_at)
  values (c.id, private.bib_bool(p->'enabled', true), private.honor_categories(coalesce(p->'categories', '[]'::jsonb)),
          private.honor_design(c.id, p->'design'), private.honor_design(c.id, p->'card_design'), v_uid, now())
  on conflict (challenge_id) do update set
    enabled = excluded.enabled, categories = excluded.categories, design = excluded.design, card_design = excluded.card_design,
    updated_by = v_uid, updated_at = now();
  return public.challenge_honor(c.id);
end $$;

-- Chốt & công bố: sau khi kết thúc ≥ 24 giờ. Công bố lại được (tính lại từ dữ liệu mới nhất).
create or replace function public.publish_challenge_honor(p_challenge_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
  h public.challenge_honors := (select x from public.challenge_honors x where x.challenge_id = p_challenge_id);
  v_badge uuid := (select a.id from public.achievements a where a.code = 'HONORED');
  v_prev uuid[];
  r record;
begin
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if not private.challenge_is_manager(c) then raise exception 'FORBIDDEN'; end if;
  if not private.honor_allowed(c) then raise exception 'HONOR_PRO_REQUIRED'; end if;
  if c.status = 'CANCELLED' then raise exception 'HONOR_NOT_AVAILABLE'; end if;
  if h.challenge_id is null or not h.enabled or jsonb_array_length(h.categories) = 0 then raise exception 'HONOR_NOT_CONFIGURED'; end if;
  if now() < c.end_date + interval '24 hours' then raise exception 'HONOR_REVIEW_PENDING'; end if;

  v_prev := array(select distinct x.user_id from public.challenge_honorees x where x.challenge_id = c.id);
  delete from public.challenge_honorees x where x.challenge_id = c.id;
  insert into public.challenge_honorees (challenge_id, category, rank, user_id, value)
  select c.id, t.category, t.rank, t.user_id, t.value from private.honor_compute(c, h.categories) t
  on conflict do nothing;
  update public.challenge_honors set status = 'PUBLISHED', published_at = now(), updated_by = v_uid, updated_at = now() where challenge_id = c.id;

  -- Người mới được vinh danh: thông báo + huy hiệu
  for r in select distinct x.user_id from public.challenge_honorees x
            where x.challenge_id = c.id and not (x.user_id = any (v_prev)) loop
    perform private.notify(r.user_id, null, 'HONOR', 'Bạn được vinh danh 🏆',
      'Bạn có tên trong bảng vinh danh "' || c.title || '". Tải ảnh vinh danh để chia sẻ!', '/challenges/' || c.id || '?tab=honor', v_uid, true);
    if v_badge is not null then
      insert into public.user_achievements (user_id, achievement_id) values (r.user_id, v_badge) on conflict do nothing;
    end if;
  end loop;
  return public.challenge_honor(c.id);
end $$;

create or replace function public.unpublish_challenge_honor(p_challenge_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
begin
  perform private.require_uid();
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if not private.challenge_is_manager(c) then raise exception 'FORBIDDEN'; end if;
  update public.challenge_honors set status = 'DRAFT', updated_at = now() where challenge_id = c.id;
  return public.challenge_honor(c.id);
end $$;

-- Ảnh / ẩn danh của một runner: chính runner (ảnh + ẩn) hoặc BTC (chỉ ảnh)
create or replace function public.set_honor_pref(p_challenge_id uuid, p_user_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
  v_self boolean := p_user_id = v_uid;
begin
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if not v_self and not private.challenge_is_manager(c) then raise exception 'FORBIDDEN'; end if;
  if not v_self and p ? 'hidden' then raise exception 'FORBIDDEN'; end if;              -- chỉ chính runner được ẩn mình
  if not exists (select 1 from public.challenge_participants x where x.challenge_id = c.id and x.profile_id = p_user_id) then
    raise exception 'NOT_A_PARTICIPANT';
  end if;
  if p ? 'photo_url' and not private.honor_media_ok(c.id, p->>'photo_url') then raise exception 'INVALID_HONOR_IMAGE'; end if;
  insert into public.challenge_honor_prefs (challenge_id, user_id, photo_url, photo_by, hidden, updated_at)
  values (c.id, p_user_id, p->>'photo_url', case when p ? 'photo_url' then v_uid end, private.bib_bool(p->'hidden', false), now())
  on conflict (challenge_id, user_id) do update set
    photo_url = case when p ? 'photo_url' then excluded.photo_url else challenge_honor_prefs.photo_url end,
    photo_by = case when p ? 'photo_url' then v_uid else challenge_honor_prefs.photo_by end,
    hidden = case when p ? 'hidden' then excluded.hidden else challenge_honor_prefs.hidden end,
    updated_at = now();
  if p ? 'photo_url' and not v_self and p->>'photo_url' is not null then
    perform private.notify(p_user_id, null, 'HONOR', 'BTC đã chọn ảnh vinh danh cho bạn',
      'Thử thách "' || c.title || '". Bạn có thể đổi ảnh khác hoặc ẩn mình khỏi ảnh công khai.', '/challenges/' || c.id || '?tab=honor', v_uid, false);
  end if;
  return public.challenge_honor(c.id);
end $$;

revoke all on function private.honor_media_ok(uuid, text), private.honor_allowed(public.challenges), private.honor_layers(uuid, jsonb, text[]),
  private.honor_design(uuid, jsonb), private.honor_compute(public.challenges, jsonb), private.honor_categories(jsonb),
  private.honor_row(uuid, boolean, text, integer, uuid, numeric) from public, anon, authenticated;
revoke all on function public.challenge_honor(uuid), public.save_challenge_honor(uuid, jsonb), public.publish_challenge_honor(uuid),
  public.unpublish_challenge_honor(uuid), public.set_honor_pref(uuid, uuid, jsonb), public.can_upload_honor_media(text) from public, anon;
grant execute on function public.challenge_honor(uuid) to anon, authenticated;
grant execute on function public.save_challenge_honor(uuid, jsonb), public.publish_challenge_honor(uuid),
  public.unpublish_challenge_honor(uuid), public.set_honor_pref(uuid, uuid, jsonb), public.can_upload_honor_media(text) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001005000_club_ownership_fix.sql
-- ===================================================================
-- 005000: Sửa lỗi trao quyền Chủ nhiệm / Chủ nhiệm rời CLB.
-- Lỗi gốc (hàm cũ trên production): chủ nhiệm cũ bị đổi sang vai trò 'VICE' — vai trò không tồn tại
-- (club_members chỉ nhận OWNER / CAPTAIN / MEMBER) → vi phạm CHECK → "Không thực hiện được".
-- Rời CLB khi là chủ nhiệm: tự chọn người kế nhiệm theo 'VICE' → không bao giờ tìm được.
-- Bản mới: chủ nhiệm cũ thành Quản trị viên (CAPTAIN); người nhận phải là thành viên đã duyệt;
-- cập nhật clubs.owner_id; ghi nhật ký; báo cho chủ nhiệm mới.
-- Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

create or replace function public.transfer_club_ownership(p_club_id uuid, p_new_owner_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_club text := (select c.name from public.clubs c where c.id = p_club_id);
begin
  if v_club is null then raise exception 'CLUB_NOT_FOUND'; end if;
  if p_new_owner_id is null or p_new_owner_id = v_uid then raise exception 'CANNOT_TRANSFER_TO_SELF'; end if;
  if not exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = v_uid and m.role = 'OWNER' and m.status = 'APPROVED') then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if not exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = p_new_owner_id and m.status = 'APPROVED') then
    raise exception 'TARGET_NOT_MEMBER';
  end if;
  update public.club_members set role = 'CAPTAIN' where club_id = p_club_id and user_id = v_uid;
  update public.club_members set role = 'OWNER' where club_id = p_club_id and user_id = p_new_owner_id;
  update public.clubs set owner_id = p_new_owner_id where id = p_club_id;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'CLUB_TRANSFER_OWNER', 'club:' || p_club_id, jsonb_build_object('from', v_uid, 'to', p_new_owner_id));
  perform private.notify(p_new_owner_id, p_club_id, 'CLUB_ROLE', 'Bạn là Chủ nhiệm mới của ' || v_club,
    'Quyền Chủ nhiệm CLB đã được trao cho bạn.', '/clubs/' || p_club_id, v_uid, true);
end $$;

create or replace function public.leave_club(p_club_id uuid, p_new_owner_id uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_role text := (select m.role from public.club_members m where m.club_id = p_club_id and m.user_id = v_uid);
  v_next uuid;
begin
  if v_role is null then raise exception 'NOT_A_MEMBER'; end if;
  if v_role <> 'OWNER' then
    delete from public.club_members where club_id = p_club_id and user_id = v_uid;
    return;
  end if;
  if not exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id <> v_uid and m.status = 'APPROVED') then
    raise exception 'LAST_MEMBER_MUST_DELETE';
  end if;
  if p_new_owner_id is not null then
    if p_new_owner_id = v_uid then raise exception 'CANNOT_TRANSFER_TO_SELF'; end if;
    if not exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = p_new_owner_id and m.status = 'APPROVED') then
      raise exception 'TARGET_NOT_MEMBER';
    end if;
    v_next := p_new_owner_id;
  else
    -- tự chọn Quản trị viên vào CLB sớm nhất
    v_next := (select x.user_id from (
      select m.user_id, row_number() over (order by m.joined_at, m.user_id) as rn
        from public.club_members m
       where m.club_id = p_club_id and m.user_id <> v_uid and m.status = 'APPROVED' and m.role = 'CAPTAIN') x where x.rn = 1);
    if v_next is null then raise exception 'MUST_ASSIGN_NEW_OWNER'; end if;
  end if;
  -- mỗi CLB chỉ một Chủ nhiệm (club_members_single_owner): rời trước, nâng người kế nhiệm sau
  delete from public.club_members where club_id = p_club_id and user_id = v_uid;
  update public.club_members set role = 'OWNER' where club_id = p_club_id and user_id = v_next;
  update public.clubs set owner_id = v_next where id = p_club_id;
  perform private.notify(v_next, p_club_id, 'CLUB_ROLE', 'Bạn là Chủ nhiệm mới',
    'Chủ nhiệm cũ đã rời CLB và trao quyền cho bạn.', '/clubs/' || p_club_id, v_uid, true);
end $$;

revoke all on function public.transfer_club_ownership(uuid, uuid), public.leave_club(uuid, uuid) from public, anon;
grant execute on function public.transfer_club_ownership(uuid, uuid), public.leave_club(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001005100_item_promotions.sql
-- ===================================================================
-- 005100: Khuyến mãi vật phẩm (Xu) — Vật phẩm · Giá gốc · Chương trình tách riêng.
-- • 8 loại: FREE (tặng miễn phí) · TRIAL (dùng thử đồ nhân vật N ngày) · SALE (giảm %) · FLASH (giảm % ngắn hạn, số lượng thật)
--   · BUNDLE (gói nhiều đồ nhân vật, giá gói) · EVENT (giảm % theo dịp, gom nhóm) · FIRST_PURCHASE (lần mua đầu) · COMEBACK (runner quay lại).
-- • Áp cho vật phẩm nhân vật (AVATAR) và quà tặng (GIFT). Mỗi vật phẩm chỉ MỘT chương trình đang chạy (không cộng dồn → không về 0 Xu).
-- • Giới hạn: tổng số lượt (đếm thật, không nhập tay), số lượt / người, nhóm được hưởng (tất cả / người mới / quay lại / VIP).
-- • Quà tặng giảm giá / miễn phí: Tỏa sáng của người nhận tính theo XU THỰC TRẢ (quà miễn phí = 0) → không nuôi Tỏa sáng bằng quà free.
-- • Không có vật phẩm "DÙNG" tăng XP / km (XP chỉ từ km). Dùng thử chỉ là đồ trang trí, hết hạn tự tháo.
-- Cần 004700. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 1. Bảng
-- ---------------------------------------------------------------------
create table if not exists public.item_promotions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('FREE', 'TRIAL', 'SALE', 'FLASH', 'BUNDLE', 'EVENT', 'FIRST_PURCHASE', 'COMEBACK')),
  title text not null check (char_length(title) between 2 and 80),
  badge text check (badge is null or char_length(badge) <= 24),
  item_type text check (item_type in ('AVATAR', 'GIFT')),
  item_code text,
  bundle_items text[],                                -- BUNDLE: mã đồ nhân vật
  discount_pct integer not null default 0 check (discount_pct between 0 and 100),
  fixed_price integer check (fixed_price is null or fixed_price >= 0),
  quantity_limit integer check (quantity_limit is null or quantity_limit > 0),
  per_user_limit integer check (per_user_limit is null or per_user_limit > 0),
  trial_days integer check (trial_days is null or trial_days between 1 and 30),
  segment text not null default 'ALL' check (segment in ('ALL', 'NEW', 'COMEBACK', 'VIP')),
  event_key text check (event_key is null or char_length(event_key) <= 40),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create index if not exists item_promotions_item_idx on public.item_promotions (item_type, item_code) where is_active;
create table if not exists public.item_promo_redemptions (
  id uuid primary key default gen_random_uuid(),
  promo_id uuid not null references public.item_promotions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  qty integer not null default 1,
  xu_paid integer not null default 0,
  ref text unique,
  created_at timestamptz not null default now()
);
create index if not exists item_promo_redemptions_idx on public.item_promo_redemptions (promo_id, user_id);
alter table public.item_promotions enable row level security;
alter table public.item_promo_redemptions enable row level security;

-- Dùng thử: đồ hết hạn tự tháo
alter table public.user_inventory add column if not exists expires_at timestamptz;
-- Quà: amount = Xu thực trả (có thể 0 khi miễn phí), list_amount = giá gốc
alter table public.cheers drop constraint if exists cheers_amount_chk;
alter table public.cheers add constraint cheers_amount_chk check (amount between 0 and 100000000);
alter table public.cheers add column if not exists list_amount numeric(12, 1);
alter table public.cheers add column if not exists promo_id uuid references public.item_promotions(id) on delete set null;

-- ---------------------------------------------------------------------
-- 2. Ai được hưởng + giá cuối
-- ---------------------------------------------------------------------
create or replace function private.promo_segment_ok(p_user uuid, p_segment text) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_segment
    when 'ALL' then true
    when 'NEW' then coalesce((select p.created_at >= now() - interval '14 days' from public.profiles p where p.id = p_user), false)
    when 'VIP' then private.user_vip_tier(p_user) > 0
    -- quay lại: tài khoản ≥ 30 ngày, không có bài hợp lệ trong 14 ngày trước tuần này
    when 'COMEBACK' then coalesce((select p.created_at <= now() - interval '30 days' from public.profiles p where p.id = p_user), false)
      and not exists (select 1 from public.activities a where a.user_id = p_user and a.validation_status = 'APPROVED'
                        and a.started_at >= now() - interval '21 days' and a.started_at < now() - interval '7 days')
    else false end
$$;

create or replace function private.promo_used(p_promo uuid, p_user uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(sum(r.qty), 0)::int from public.item_promo_redemptions r where r.promo_id = p_promo and (p_user is null or r.user_id = p_user)
$$;

-- Người đã từng mua bằng Xu (vật phẩm / quà) — cho FIRST_PURCHASE
create or replace function private.has_purchased(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_inventory i where i.user_id = p_user and i.acquired_reason in ('PURCHASE', 'PROMO'))
      or exists (select 1 from public.cheers c where c.from_user = p_user and c.gift_code is not null and c.amount > 0)
$$;

create or replace function private.promo_live(p public.item_promotions) returns boolean
language sql stable as $$
  select p.is_active and p.starts_at <= now() and (p.ends_at is null or p.ends_at > now())
     and (p.quantity_limit is null or private.promo_used(p.id, null) < p.quantity_limit)
$$;

-- Chương trình đang áp cho một vật phẩm với một người (null nếu không có). qty = số lượng muốn mua (quà)
drop function if exists private.item_offer(uuid, text, text, integer, integer);
create or replace function private.item_offer(p_user uuid, p_type text, p_code text, p_base numeric, p_qty integer default 1) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  -- mỗi vật phẩm chỉ một chương trình chạy cùng lúc (admin chặn chồng lấn); thứ tự chỉ để chắc chắn
  p public.item_promotions := (select q.x from (
                                 select x, row_number() over (order by case x.kind when 'FLASH' then 1 when 'EVENT' then 2 when 'FIRST_PURCHASE' then 3
                                                      when 'COMEBACK' then 3 when 'FREE' then 4 when 'TRIAL' then 5 else 6 end, x.created_at) as rn
                                   from public.item_promotions x
                                  where x.item_type = p_type and x.item_code = p_code and x.kind <> 'BUNDLE' and private.promo_live(x)) q
                                where q.rn = 1);
  v_unit integer;
  v_left integer;
  v_eligible boolean;
begin
  if p.id is null then return null; end if;
  v_eligible := p_user is not null and private.promo_segment_ok(p_user, p.segment)
    and (p.kind <> 'FIRST_PURCHASE' or not private.has_purchased(p_user))
    and (p.per_user_limit is null or private.promo_used(p.id, p_user) + coalesce(p_qty, 1) <= p.per_user_limit);
  v_unit := case p.kind when 'FREE' then 0 when 'TRIAL' then 0
                        else greatest(0, round(p_base * (100 - p.discount_pct) / 100.0))::int end;
  p_base := round(p_base);
  v_left := case when p.quantity_limit is null then null else p.quantity_limit - private.promo_used(p.id, null) end;
  return jsonb_build_object('promo_id', p.id, 'kind', p.kind, 'title', p.title, 'badge', coalesce(p.badge, case p.kind
            when 'FREE' then 'MIỄN PHÍ' when 'TRIAL' then 'DÙNG THỬ' when 'FLASH' then 'FLASH SALE' when 'FIRST_PURCHASE' then 'LẦN ĐẦU'
            when 'COMEBACK' then 'CHÀO MỪNG TRỞ LẠI' else '-' || p.discount_pct || '%' end),
    'base', p_base, 'price', v_unit, 'discount_pct', case when p_base > 0 then round(100 - v_unit * 100.0 / p_base) else 0 end,
    'ends_at', p.ends_at, 'left', v_left, 'sold', private.promo_used(p.id, null), 'limit', p.quantity_limit,
    'per_user_limit', p.per_user_limit, 'used', case when p_user is null then 0 else private.promo_used(p.id, p_user) end,
    'trial_days', p.trial_days, 'eligible', v_eligible, 'segment', p.segment, 'event_key', p.event_key);
end $$;

-- ---------------------------------------------------------------------
-- 3. Mua vật phẩm nhân vật: giá theo chương trình; dùng thử; gói
-- ---------------------------------------------------------------------
create or replace function public.buy_avatar_item(p_code text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  i public.avatar_items := (select x from public.avatar_items x where x.code = p_code and x.is_active);
  v_level integer;
  o jsonb;
  v_price integer;
  v_trial boolean := false;
  v_owned public.user_inventory;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if exists (select 1 from public.ledger_transactions where idempotency_key = 'shop:' || p_idempotency_key)
     or exists (select 1 from public.item_promo_redemptions where ref = 'shop:' || p_idempotency_key) then
    return jsonb_build_object('duplicate', true, 'balance', private.balance(v_uid));
  end if;
  if i.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if coalesce(i.metadata->>'acquire', '') = 'shine' then raise exception 'SHINE_ONLY'; end if;
  perform pg_advisory_xact_lock(hashtextextended('shop:' || v_uid, 0));
  v_owned := (select x from public.user_inventory x where x.user_id = v_uid and x.item_id = i.id);
  if v_owned.id is not null and (v_owned.expires_at is null or v_owned.expires_at > now()) and v_owned.acquired_reason <> 'TRIAL' then
    raise exception 'ALREADY_OWNED';
  end if;
  v_level := coalesce((select level from public.profiles where id = v_uid), 1);
  if v_level < i.unlock_level then raise exception 'LEVEL_TOO_LOW'; end if;

  o := private.item_offer(v_uid, 'AVATAR', i.code, i.price_xu, 1);
  if o is not null and (o->>'eligible')::boolean and o->>'kind' <> 'TRIAL' then v_price := (o->>'price')::int;
  else v_price := i.price_xu; o := null; end if;

  if v_price > 0 then
    if private.balance(v_uid) < v_price then raise exception 'INSUFFICIENT_BALANCE'; end if;
    perform private.ledger_post('SHOP_ITEM', 'shop:' || p_idempotency_key, 'Mua ' || i.name || case when o is not null then ' (' || (o->>'title') || ')' else '' end,
      v_uid, private.debit_entries(v_uid, v_price, private.system_account()));
  end if;
  if o is not null then
    insert into public.item_promo_redemptions (promo_id, user_id, qty, xu_paid, ref) values ((o->>'promo_id')::uuid, v_uid, 1, v_price, 'shop:' || p_idempotency_key);
  end if;
  delete from public.user_inventory where user_id = v_uid and item_id = i.id;          -- mua đứt thay cho bản dùng thử
  insert into public.user_inventory (user_id, item_id, acquired_reason)
  values (v_uid, i.id, case when o is not null then 'PROMO' when v_price > 0 then 'PURCHASE' else 'FREE' end);
  return jsonb_build_object('code', i.code, 'paid', v_price, 'balance', private.balance(v_uid));
end $$;

create or replace function public.try_avatar_item(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  i public.avatar_items := (select x from public.avatar_items x where x.code = p_code and x.is_active);
  o jsonb;
  v_until timestamptz;
begin
  if i.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  o := private.item_offer(v_uid, 'AVATAR', i.code, i.price_xu, 1);
  if o is null or o->>'kind' <> 'TRIAL' then raise exception 'PROMO_NOT_AVAILABLE'; end if;
  if not (o->>'eligible')::boolean then raise exception 'PROMO_LIMIT_REACHED'; end if;
  if exists (select 1 from public.user_inventory x where x.user_id = v_uid and x.item_id = i.id) then raise exception 'ALREADY_OWNED'; end if;
  -- mỗi người dùng thử một món một lần (kể cả đã hết hạn, bị tháo)
  if exists (select 1 from public.item_promo_redemptions r join public.item_promotions p on p.id = r.promo_id
              where r.user_id = v_uid and p.kind = 'TRIAL' and p.item_code = i.code) then raise exception 'TRIAL_USED'; end if;
  v_until := now() + make_interval(days => coalesce((o->>'trial_days')::int, 3));
  insert into public.user_inventory (user_id, item_id, acquired_reason, expires_at) values (v_uid, i.id, 'TRIAL', v_until);
  insert into public.item_promo_redemptions (promo_id, user_id, qty, xu_paid, ref) values ((o->>'promo_id')::uuid, v_uid, 1, 0, 'trial:' || v_uid || ':' || i.code);
  return jsonb_build_object('code', i.code, 'expires_at', v_until);
end $$;

create or replace function public.buy_item_bundle(p_promo_id uuid, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  p public.item_promotions := (select x from public.item_promotions x where x.id = p_promo_id and x.kind = 'BUNDLE');
  v_price integer;
  c text;
  v_n integer := 0;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if exists (select 1 from public.item_promo_redemptions where ref = 'bundle:' || p_idempotency_key) then
    return jsonb_build_object('duplicate', true, 'balance', private.balance(v_uid));
  end if;
  if p.id is null or not private.promo_live(p) then raise exception 'PROMO_NOT_AVAILABLE'; end if;
  if not private.promo_segment_ok(v_uid, p.segment) then raise exception 'PROMO_NOT_ELIGIBLE'; end if;
  if private.promo_used(p.id, v_uid) >= coalesce(p.per_user_limit, 1) then raise exception 'PROMO_LIMIT_REACHED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('shop:' || v_uid, 0));
  v_price := coalesce(p.fixed_price, 0);
  if v_price > 0 then
    if private.balance(v_uid) < v_price then raise exception 'INSUFFICIENT_BALANCE'; end if;
    perform private.ledger_post('SHOP_ITEM', 'bundle:' || p_idempotency_key, 'Mua gói ' || p.title, v_uid,
      private.debit_entries(v_uid, v_price, private.system_account()));
  end if;
  foreach c in array coalesce(p.bundle_items, '{}') loop
    delete from public.user_inventory x using public.avatar_items i
     where x.user_id = v_uid and x.item_id = i.id and i.code = c and x.acquired_reason = 'TRIAL';
    insert into public.user_inventory (user_id, item_id, acquired_reason)
    select v_uid, i.id, 'PROMO' from public.avatar_items i
     where i.code = c and i.is_active and not exists (select 1 from public.user_inventory x where x.user_id = v_uid and x.item_id = i.id);
    if found then v_n := v_n + 1; end if;
  end loop;
  insert into public.item_promo_redemptions (promo_id, user_id, qty, xu_paid, ref) values (p.id, v_uid, 1, v_price, 'bundle:' || p_idempotency_key);
  return jsonb_build_object('items', v_n, 'paid', v_price, 'balance', private.balance(v_uid));
end $$;

-- Hết hạn dùng thử → tháo khỏi người + xóa khỏi tủ đồ
create or replace function private.expire_trials(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if not exists (select 1 from public.user_inventory where user_id = p_user and expires_at is not null and expires_at <= now()) then return; end if;
  foreach k in array private.character_slots() loop
    execute format('update public.user_equipment e set %1$I = null where e.user_id = $1 and %1$I in
                     (select x.item_id from public.user_inventory x where x.user_id = $1 and x.expires_at is not null and x.expires_at <= now())',
                   k || '_item_id') using p_user;
  end loop;
  delete from public.user_inventory where user_id = p_user and expires_at is not null and expires_at <= now();
end $$;

create or replace function private.ensure_character(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k text; v_id uuid;
begin
  insert into public.user_avatar (user_id) values (p_user) on conflict (user_id) do nothing;
  perform private.expire_trials(p_user);
  perform private.grant_free_items(p_user);
  insert into public.user_equipment (user_id) values (p_user) on conflict (user_id) do nothing;
  foreach k in array private.character_slots() loop
    v_id := (select (to_jsonb(e) ->> (k || '_item_id'))::uuid from public.user_equipment e where e.user_id = p_user);
    if v_id is not null and exists (select 1 from public.avatar_items where id = v_id and is_active) then continue; end if;
    if k = any(private.character_required_slots()) then
      v_id := (select id from public.avatar_items where code = k || '_original');
    else
      if v_id is null then continue; end if;
      v_id := null;
    end if;
    execute format('update public.user_equipment set %I = $1, updated_at = now() where user_id = $2', k || '_item_id') using v_id, p_user;
  end loop;
end $$;

-- Tủ đồ / cửa hàng kèm chương trình đang áp + hạn dùng thử + gói đang bán
create or replace function public.character_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); v_items jsonb;
begin
  perform private.ensure_character(v_uid);
  v_items := (select coalesce(jsonb_agg(private.item_json(i) || jsonb_build_object(
                  'owned', inv.item_id is not null and inv.acquired_reason <> 'TRIAL',
                  'trial_until', case when inv.acquired_reason = 'TRIAL' then inv.expires_at end,
                  'offer', private.item_offer(v_uid, 'AVATAR', i.code, i.price_xu, 1)) order by i.category, i.sort, i.name), '[]'::jsonb)
                from public.avatar_items i
                left join public.user_inventory inv on inv.item_id = i.id and inv.user_id = v_uid
               where i.is_active and i.code is not null);
  return (private.character_look(v_uid) - 'items') || jsonb_build_object(
    'level', coalesce((select level from public.profiles where id = v_uid), 1),
    'balance', private.balance(v_uid),
    'gender_set', (select gender is not null from public.profiles where id = v_uid),
    'items', v_items,
    'bundles', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'badge', p.badge, 'price', p.fixed_price,
                  'base', (select coalesce(sum(i.price_xu), 0) from public.avatar_items i where i.code = any (p.bundle_items)),
                  'items', p.bundle_items, 'ends_at', p.ends_at, 'bought', private.promo_used(p.id, v_uid) >= coalesce(p.per_user_limit, 1),
                  'left', case when p.quantity_limit is null then null else p.quantity_limit - private.promo_used(p.id, null) end) order by p.created_at desc), '[]'::jsonb)
                  from public.item_promotions p
                 where p.kind = 'BUNDLE' and private.promo_live(p) and private.promo_segment_ok(v_uid, p.segment)));
end $$;

-- ---------------------------------------------------------------------
-- 4. Quà tặng theo giá khuyến mãi (Tỏa sáng = Xu thực trả)
-- ---------------------------------------------------------------------
create or replace function public.gift_catalog() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'gifts', (select coalesce(jsonb_agg(jsonb_build_object('code', g.code, 'name', g.name, 'emoji', g.emoji, 'price_xu', g.price_xu,
                'tier', g.tier, 'description', g.description, 'vip_tier', g.vip_tier, 'seasonal', g.season_from is not null,
                'locked', g.vip_tier > private.user_vip_tier(auth.uid()),
                'offer', private.item_offer(auth.uid(), 'GIFT', g.code, g.price_xu, 1)) order by g.sort, g.price_xu), '[]'::jsonb)
              from public.gift_catalog g where g.is_active and private.gift_in_season(g, private.vn_day(now()))),
    'daily_cap', coalesce((private.economy_config()->>'giftDailyCapXu')::int, 20000),
    'sent_today', coalesce((select sum(c.amount) from public.cheers c where c.from_user = auth.uid() and c.gift_code is not null
                             and c.created_at >= private.vn_start(private.vn_day(now()))), 0))
$$;

create or replace function public.send_gift(
  p_to_user uuid, p_gift_code text, p_qty integer default 1, p_message text default null, p_post_id uuid default null,
  p_activity_id uuid default null, p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  g public.gift_catalog := (select x from public.gift_catalog x where x.code = p_gift_code);
  v_qty integer := coalesce(p_qty, 1);
  v_total integer;
  v_list integer;
  v_msg text := nullif(trim(coalesce(p_message, '')), '');
  v_club uuid;
  v_author uuid;
  v_id uuid := (select c.id from public.cheers c where c.idempotency_key = p_idempotency_key);
  v_sent numeric;
  v_name text;
  o jsonb;
  v_promo uuid;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if v_id is not null then return jsonb_build_object('gift_id', v_id, 'duplicate', true); end if;
  if g.code is null or not g.is_active or not private.gift_in_season(g, private.vn_day(now())) then raise exception 'GIFT_NOT_AVAILABLE'; end if;
  if g.vip_tier > private.user_vip_tier(v_uid) then raise exception 'VIP_REQUIRED'; end if;
  if v_qty not in (1, 5, 10, 99) then raise exception 'INVALID_QTY'; end if;
  if p_to_user is null or p_to_user = v_uid then raise exception 'CANNOT_GIFT_SELF'; end if;
  if not exists (select 1 from public.profiles where id = p_to_user) then raise exception 'USER_NOT_FOUND'; end if;
  if v_msg is not null and char_length(v_msg) > 140 then raise exception 'MESSAGE_TOO_LONG'; end if;
  if p_post_id is not null then
    v_club := (select cp.club_id from public.club_posts cp where cp.id = p_post_id and cp.deleted_at is null);
    v_author := (select cp.author_id from public.club_posts cp where cp.id = p_post_id and cp.deleted_at is null);
    if v_club is null or not public.club_is_member(v_club) or v_author is distinct from p_to_user then raise exception 'FORBIDDEN'; end if;
  end if;
  if p_activity_id is not null and not exists (select 1 from public.activities where id = p_activity_id and user_id = p_to_user) then
    raise exception 'FORBIDDEN';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('gift:' || v_uid, 0));
  v_list := g.price_xu * v_qty;
  o := private.item_offer(v_uid, 'GIFT', g.code, g.price_xu, v_qty);
  if o is not null and (o->>'eligible')::boolean and o->>'kind' <> 'TRIAL'
     and (o->>'left' is null or (o->>'left')::int >= v_qty) then
    v_total := (o->>'price')::int * v_qty;
    v_promo := (o->>'promo_id')::uuid;
  else
    v_total := v_list;
  end if;
  v_sent := coalesce((select sum(c.amount) from public.cheers c where c.from_user = v_uid and c.gift_code is not null
                       and c.created_at >= private.vn_start(private.vn_day(now()))), 0);
  if v_sent + v_total > coalesce((private.economy_config()->>'giftDailyCapXu')::int, 20000) then raise exception 'GIFT_DAILY_LIMIT'; end if;
  if private.balance(v_uid) < v_total then raise exception 'INSUFFICIENT_BALANCE'; end if;

  -- Đốt Xu: người tặng → hệ thống. Người nhận KHÔNG nhận Xu.
  if v_total > 0 then
    perform private.ledger_post('GIFT', 'gift:' || p_idempotency_key, 'Tặng ' || v_qty || ' × ' || g.name || ' cho ' || private.display_name(p_to_user), v_uid,
      private.debit_entries(v_uid, v_total, private.system_account()));
  end if;
  insert into public.cheers (from_user, to_user, amount, list_amount, promo_id, message, activity_id, post_id, club_id, idempotency_key, gift_code, qty)
  values (v_uid, p_to_user, v_total, v_list, v_promo, v_msg, p_activity_id, p_post_id, v_club, p_idempotency_key, g.code, v_qty)
  returning id into v_id;
  if v_promo is not null then
    insert into public.item_promo_redemptions (promo_id, user_id, qty, xu_paid, ref) values (v_promo, v_uid, v_qty, v_total, 'gift:' || p_idempotency_key);
  end if;
  if p_post_id is not null then update public.club_posts set cheer_xu = cheer_xu + v_total where id = p_post_id; end if;

  v_name := private.display_name(v_uid);
  perform private.award(p_to_user, 'GIFT_IN', v_name || ' tặng bạn ' || case when v_qty > 1 then v_qty || ' × ' else '' end || g.emoji || ' ' || g.name,
    v_msg, 0, 0, 'gift_in:' || v_id, p_activity_id, jsonb_build_object('from', v_uid, 'gift', g.code, 'emoji', g.emoji, 'qty', v_qty, 'tier', g.tier));
  perform private.notify(p_to_user, v_club, 'GIFT', v_name || ' tặng bạn ' || case when v_qty > 1 then v_qty || ' × ' else '' end || g.emoji || ' ' || g.name,
    coalesce(v_msg, g.description), case when p_activity_id is not null then '/activities/' || p_activity_id
                                         when v_club is not null then '/clubs/' || v_club else '/me' end, v_uid, g.tier in ('HYPE', 'LEGEND'));
  return jsonb_build_object('gift_id', v_id, 'total_xu', v_total, 'list_xu', v_list, 'emoji', g.emoji, 'tier', g.tier, 'qty', v_qty,
    'balance', private.balance(v_uid));
end $$;

-- ---------------------------------------------------------------------
-- 5. Admin
-- ---------------------------------------------------------------------
create or replace function private.promo_json(p public.item_promotions) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(p) || jsonb_build_object(
    'live', private.promo_live(p), 'sold', private.promo_used(p.id, null),
    'buyers', (select count(distinct r.user_id) from public.item_promo_redemptions r where r.promo_id = p.id),
    'xu_paid', (select coalesce(sum(r.xu_paid), 0) from public.item_promo_redemptions r where r.promo_id = p.id),
    'item_name', case p.item_type when 'AVATAR' then (select i.name from public.avatar_items i where i.code = p.item_code)
                                  when 'GIFT' then (select g.emoji || ' ' || g.name from public.gift_catalog g where g.code = p.item_code) end,
    'base_price', case p.item_type when 'AVATAR' then (select i.price_xu from public.avatar_items i where i.code = p.item_code)
                                   when 'GIFT' then (select g.price_xu from public.gift_catalog g where g.code = p.item_code) end)
$$;

create or replace function public.admin_list_item_promotions() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'promotions', (select coalesce(jsonb_agg(private.promo_json(p) order by private.promo_live(p) desc, p.created_at desc), '[]'::jsonb)
                     from public.item_promotions p where p.created_at >= now() - interval '180 days' or p.is_active),
    'avatar_items', (select coalesce(jsonb_agg(jsonb_build_object('code', i.code, 'name', i.name, 'price_xu', i.price_xu, 'slot', i.category,
                       'rarity', i.rarity) order by i.category, i.price_xu), '[]'::jsonb)
                       from public.avatar_items i where i.is_active and i.code is not null and i.price_xu > 0
                        and coalesce(i.metadata->>'acquire', '') <> 'shine'),
    'gifts', (select coalesce(jsonb_agg(jsonb_build_object('code', g.code, 'name', g.emoji || ' ' || g.name, 'price_xu', g.price_xu) order by g.price_xu), '[]'::jsonb)
                from public.gift_catalog g where g.is_active));
end $$;

create or replace function public.admin_save_item_promotion(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_kind text := upper(coalesce(p->>'kind', ''));
  v_type text := nullif(upper(coalesce(p->>'item_type', '')), '');
  v_code text := nullif(p->>'item_code', '');
  v_items text[];
  v_start timestamptz := coalesce(nullif(p->>'starts_at', '')::timestamptz, now());
  v_end timestamptz := nullif(p->>'ends_at', '')::timestamptz;
  v_pct integer := coalesce((p->>'discount_pct')::int, 0);
  r public.item_promotions;
begin
  if v_kind not in ('FREE', 'TRIAL', 'SALE', 'FLASH', 'BUNDLE', 'EVENT', 'FIRST_PURCHASE', 'COMEBACK') then raise exception 'INVALID_PROMO'; end if;
  if char_length(trim(coalesce(p->>'title', ''))) < 2 then raise exception 'INVALID_PROMO_TITLE'; end if;
  if v_end is not null and v_end <= v_start then raise exception 'INVALID_TIME_RANGE'; end if;
  if v_kind = 'FLASH' and (v_end is null or v_end > v_start + interval '72 hours') then raise exception 'FLASH_TOO_LONG'; end if;
  if v_kind in ('SALE', 'FLASH', 'EVENT', 'FIRST_PURCHASE', 'COMEBACK') and (v_pct < 5 or v_pct > 90) then
    -- quà miễn phí dùng loại FREE; không cho giảm 100% qua SALE
    raise exception 'INVALID_DISCOUNT';
  end if;
  if v_kind = 'BUNDLE' then
    v_items := array(select distinct x from jsonb_array_elements_text(coalesce(p->'bundle_items', '[]'::jsonb)) x);
    if cardinality(v_items) < 2 or cardinality(v_items) > 12
       or exists (select 1 from unnest(v_items) c where not exists (select 1 from public.avatar_items i where i.code = c and i.is_active)) then
      raise exception 'INVALID_BUNDLE';
    end if;
    if coalesce((p->>'fixed_price')::int, -1) < 0 then raise exception 'INVALID_BUNDLE'; end if;
    v_type := null; v_code := null;
  else
    if v_type not in ('AVATAR', 'GIFT') then raise exception 'INVALID_PROMO'; end if;
    if v_type = 'AVATAR' and not exists (select 1 from public.avatar_items i where i.code = v_code and i.is_active) then raise exception 'ITEM_NOT_FOUND'; end if;
    if v_type = 'GIFT' and not exists (select 1 from public.gift_catalog g where g.code = v_code and g.is_active) then raise exception 'GIFT_NOT_AVAILABLE'; end if;
    if v_kind = 'TRIAL' and v_type <> 'AVATAR' then raise exception 'TRIAL_AVATAR_ONLY'; end if;
    if v_kind = 'FREE' and coalesce((p->>'per_user_limit')::int, 0) < 1 then raise exception 'FREE_NEEDS_LIMIT'; end if;   -- chống farm
    -- mỗi vật phẩm chỉ một chương trình đang chạy (khoảng thời gian chồng nhau)
    if exists (select 1 from public.item_promotions x
                where x.is_active and x.item_type = v_type and x.item_code = v_code and x.id is distinct from v_id
                  and x.starts_at < coalesce(v_end, 'infinity'::timestamptz) and coalesce(x.ends_at, 'infinity'::timestamptz) > v_start) then
      raise exception 'PROMO_OVERLAP';
    end if;
  end if;

  insert into public.item_promotions as t (id, kind, title, badge, item_type, item_code, bundle_items, discount_pct, fixed_price, quantity_limit,
    per_user_limit, trial_days, segment, event_key, starts_at, ends_at, is_active, created_by)
  values (coalesce(v_id, gen_random_uuid()), v_kind, trim(p->>'title'), nullif(left(trim(coalesce(p->>'badge', '')), 24), ''), v_type, v_code, v_items,
    case when v_kind in ('FREE', 'TRIAL', 'BUNDLE') then 0 else v_pct end,
    case when v_kind = 'BUNDLE' then (p->>'fixed_price')::int end,
    nullif((p->>'quantity_limit')::int, 0), nullif((p->>'per_user_limit')::int, 0),
    case when v_kind = 'TRIAL' then least(30, greatest(1, coalesce((p->>'trial_days')::int, 3))) end,
    coalesce(nullif(upper(p->>'segment'), ''), case v_kind when 'COMEBACK' then 'COMEBACK' else 'ALL' end),
    nullif(left(trim(coalesce(p->>'event_key', '')), 40), ''), v_start, v_end, coalesce((p->>'is_active')::boolean, true), v_uid)
  on conflict (id) do update set kind = excluded.kind, title = excluded.title, badge = excluded.badge, item_type = excluded.item_type,
    item_code = excluded.item_code, bundle_items = excluded.bundle_items, discount_pct = excluded.discount_pct, fixed_price = excluded.fixed_price,
    quantity_limit = excluded.quantity_limit, per_user_limit = excluded.per_user_limit, trial_days = excluded.trial_days, segment = excluded.segment,
    event_key = excluded.event_key, starts_at = excluded.starts_at, ends_at = excluded.ends_at, is_active = excluded.is_active
  returning * into r;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SAVE_ITEM_PROMO', 'promo:' || r.id, p);
  return private.promo_json(r);
end $$;

create or replace function public.admin_end_item_promotion(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_admin();
begin
  update public.item_promotions set is_active = false, ends_at = least(coalesce(ends_at, now()), now()) where id = p_id;
  insert into public.admin_audit_log (actor_id, action, target) values (v_uid, 'END_ITEM_PROMO', 'promo:' || p_id);
end $$;

revoke all on function private.promo_segment_ok(uuid, text), private.promo_used(uuid, uuid), private.has_purchased(uuid),
  private.promo_live(public.item_promotions), private.item_offer(uuid, text, text, numeric, integer), private.expire_trials(uuid),
  private.promo_json(public.item_promotions) from public, anon, authenticated;
revoke all on function public.buy_avatar_item(text, text), public.try_avatar_item(text), public.buy_item_bundle(uuid, text),
  public.admin_list_item_promotions(), public.admin_save_item_promotion(jsonb), public.admin_end_item_promotion(uuid) from public, anon;
grant execute on function public.buy_avatar_item(text, text), public.try_avatar_item(text), public.buy_item_bundle(uuid, text),
  public.admin_list_item_promotions(), public.admin_save_item_promotion(jsonb), public.admin_end_item_promotion(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001005200_sponsor_vouchers.sql
-- ===================================================================
-- 005200: Voucher tài trợ trên thử thách / nhiệm vụ (bước đầu của Market — RaceHub KHÔNG giữ tiền).
-- • Nhà tài trợ (shop, HLV, dịch vụ) đưa voucher; runner hoàn thành thử thách / đạt Top N / hoàn thành nhiệm vụ → nhận mã.
-- • Hai kiểu mã: POOL (danh sách mã riêng, mỗi người một mã, hết kho thì dừng) · SHARED (một mã chung cho mọi người đạt điều kiện).
-- • Ai tạo: admin (mọi thử thách / nhiệm vụ) hoặc Ban tổ chức thử thách đó (chỉ cho thử thách của mình).
-- • Voucher KHÔNG phải XP, không phải Xu. Người nhận xem ở Tôi → Voucher, tự đánh dấu đã dùng.
-- • Mã chỉ người nhận xem được; BTC / admin xem số lượng phát, còn lại.
-- Cần 004600. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

create table if not exists public.voucher_campaigns (
  id uuid primary key default gen_random_uuid(),
  sponsor_name text not null check (char_length(sponsor_name) between 2 and 60),
  sponsor_logo text check (sponsor_logo is null or (sponsor_logo ~ '^https://' and char_length(sponsor_logo) <= 500)),
  title text not null check (char_length(title) between 3 and 80),
  terms text check (terms is null or char_length(terms) <= 500),
  redeem_url text check (redeem_url is null or (redeem_url ~ '^https://' and char_length(redeem_url) <= 500)),
  target_type text not null check (target_type in ('CHALLENGE', 'QUEST')),
  target_id uuid not null,
  condition text not null default 'COMPLETE' check (condition in ('COMPLETE', 'TOP_N')),
  top_n integer check (top_n is null or top_n between 1 and 100),
  code_mode text not null default 'POOL' check (code_mode in ('POOL', 'SHARED')),
  shared_code text check (shared_code is null or char_length(shared_code) between 3 and 40),
  valid_until timestamptz,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists voucher_campaigns_target_idx on public.voucher_campaigns (target_type, target_id) where is_active;
create table if not exists public.voucher_codes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.voucher_campaigns(id) on delete cascade,
  code text not null check (char_length(code) between 3 and 40),
  claimed_by uuid references public.profiles(id) on delete set null,
  claimed_at timestamptz,
  unique (campaign_id, code)
);
create index if not exists voucher_codes_free_idx on public.voucher_codes (campaign_id) where claimed_by is null;
create table if not exists public.voucher_grants (
  campaign_id uuid not null references public.voucher_campaigns(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  code text not null,
  issued_at timestamptz not null default now(),
  used_at timestamptz,
  primary key (campaign_id, user_id)
);
create index if not exists voucher_grants_user_idx on public.voucher_grants (user_id, issued_at desc);
alter table public.voucher_campaigns enable row level security;
alter table public.voucher_codes enable row level security;
alter table public.voucher_grants enable row level security;

-- ---------------------------------------------------------------------
-- 1. Phát voucher
-- ---------------------------------------------------------------------
create or replace function private.issue_voucher(c public.voucher_campaigns, p_user uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_code text; v_id uuid;
begin
  if not c.is_active or (c.valid_until is not null and c.valid_until <= now()) then return false; end if;
  if exists (select 1 from public.voucher_grants g where g.campaign_id = c.id and g.user_id = p_user) then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('voucher:' || c.id, 0));
  if c.code_mode = 'SHARED' then
    v_code := c.shared_code;
  else
    v_id := (select x.id from (select v.id, row_number() over (order by v.code) as rn from public.voucher_codes v
                                where v.campaign_id = c.id and v.claimed_by is null) x where x.rn = 1);
    if v_id is null then return false; end if;                          -- hết kho mã
    update public.voucher_codes set claimed_by = p_user, claimed_at = now() where id = v_id returning code into v_code;
  end if;
  if v_code is null then return false; end if;
  insert into public.voucher_grants (campaign_id, user_id, code) values (c.id, p_user, v_code) on conflict do nothing;
  perform private.notify(p_user, null, 'VOUCHER', 'Bạn nhận voucher từ ' || c.sponsor_name || ' 🎟️', c.title, '/me/vouchers', null, true);
  return true;
end $$;

create or replace function private.voucher_on_challenge() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.voucher_campaigns;
begin
  begin
    if new.completed_at is not null and old.completed_at is null and new.status <> 'LEFT' then
      for c in select * from public.voucher_campaigns v where v.target_type = 'CHALLENGE' and v.target_id = new.challenge_id
                 and v.condition = 'COMPLETE' and v.is_active loop
        perform private.issue_voucher(c, new.profile_id);
      end loop;
    end if;
    if new.final_rank is not null and old.final_rank is distinct from new.final_rank and new.status <> 'LEFT' then
      for c in select * from public.voucher_campaigns v where v.target_type = 'CHALLENGE' and v.target_id = new.challenge_id
                 and v.condition = 'TOP_N' and v.is_active and new.final_rank <= v.top_n loop
        perform private.issue_voucher(c, new.profile_id);
      end loop;
    end if;
  exception when others then
    raise warning 'voucher_on_challenge % lỗi: % %', new.id, sqlstate, sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists trg_zz_voucher_challenge on public.challenge_participants;
create trigger trg_zz_voucher_challenge after update of completed_at, final_rank on public.challenge_participants
  for each row execute function private.voucher_on_challenge();

create or replace function private.voucher_on_quest() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.voucher_campaigns;
begin
  begin
    if new.completed_at is not null and (tg_op = 'INSERT' or old.completed_at is null) then
      for c in select * from public.voucher_campaigns v where v.target_type = 'QUEST' and v.target_id = new.quest_id and v.is_active loop
        perform private.issue_voucher(c, new.user_id);
      end loop;
    end if;
  exception when others then
    raise warning 'voucher_on_quest lỗi: % %', sqlstate, sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists trg_zz_voucher_quest on public.user_quest_progress;
create trigger trg_zz_voucher_quest after insert or update of completed_at on public.user_quest_progress
  for each row execute function private.voucher_on_quest();

-- ---------------------------------------------------------------------
-- 2. Quyền quản lý chiến dịch: admin, hoặc BTC thử thách (chỉ thử thách của mình)
-- ---------------------------------------------------------------------
create or replace function private.voucher_can_manage(p_type text, p_target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_system_admin()
      or (p_type = 'CHALLENGE' and exists (select 1 from public.challenges c where c.id = p_target and private.challenge_is_manager(c)))
$$;

create or replace function private.voucher_json(v public.voucher_campaigns, p_manage boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', v.id, 'sponsor_name', v.sponsor_name, 'sponsor_logo', v.sponsor_logo, 'title', v.title, 'terms', v.terms,
    'redeem_url', v.redeem_url, 'target_type', v.target_type, 'target_id', v.target_id, 'condition', v.condition, 'top_n', v.top_n,
    'code_mode', v.code_mode, 'valid_until', v.valid_until, 'is_active', v.is_active,
    'issued', (select count(*) from public.voucher_grants g where g.campaign_id = v.id),
    'remaining', case when v.code_mode = 'POOL' then (select count(*) from public.voucher_codes c where c.campaign_id = v.id and c.claimed_by is null) end,
    'mine', (select jsonb_build_object('code', g.code, 'issued_at', g.issued_at, 'used_at', g.used_at)
               from public.voucher_grants g where g.campaign_id = v.id and g.user_id = auth.uid()))
    || case when p_manage then jsonb_build_object('shared_code', v.shared_code,
         'total', case when v.code_mode = 'POOL' then (select count(*) from public.voucher_codes c where c.campaign_id = v.id) end) else '{}'::jsonb end
$$;

create or replace function public.save_voucher_campaign(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_type text := upper(coalesce(p->>'target_type', ''));
  v_target uuid := nullif(p->>'target_id', '')::uuid;
  v_old public.voucher_campaigns := (select x from public.voucher_campaigns x where x.id = v_id);
  r public.voucher_campaigns;
begin
  if v_old.id is not null then v_type := v_old.target_type; v_target := v_old.target_id; end if;
  if v_type not in ('CHALLENGE', 'QUEST') or v_target is null then raise exception 'INVALID_VOUCHER'; end if;
  if not private.voucher_can_manage(v_type, v_target) then raise exception 'FORBIDDEN'; end if;
  if v_type = 'CHALLENGE' and not exists (select 1 from public.challenges c where c.id = v_target) then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if v_type = 'QUEST' and not exists (select 1 from public.quests q where q.id = v_target) then raise exception 'QUEST_NOT_FOUND'; end if;
  if coalesce(p->>'condition', 'COMPLETE') = 'TOP_N' and (v_type <> 'CHALLENGE' or coalesce((p->>'top_n')::int, 0) not between 1 and 100) then
    raise exception 'INVALID_VOUCHER';
  end if;
  if coalesce(p->>'code_mode', 'POOL') = 'SHARED' and char_length(trim(coalesce(p->>'shared_code', ''))) < 3 then raise exception 'INVALID_VOUCHER_CODE'; end if;
  if nullif(p->>'redeem_url', '') is not null and (p->>'redeem_url') !~ '^https://' then raise exception 'INVALID_URL'; end if;
  if nullif(p->>'sponsor_logo', '') is not null and (p->>'sponsor_logo') !~ '^https://' then raise exception 'INVALID_URL'; end if;

  insert into public.voucher_campaigns as t (id, sponsor_name, sponsor_logo, title, terms, redeem_url, target_type, target_id, condition, top_n,
    code_mode, shared_code, valid_until, is_active, created_by)
  values (coalesce(v_id, gen_random_uuid()), trim(p->>'sponsor_name'), nullif(trim(coalesce(p->>'sponsor_logo', '')), ''), trim(p->>'title'),
    nullif(trim(coalesce(p->>'terms', '')), ''), nullif(trim(coalesce(p->>'redeem_url', '')), ''), v_type, v_target,
    coalesce(p->>'condition', 'COMPLETE'), case when p->>'condition' = 'TOP_N' then (p->>'top_n')::int end,
    coalesce(p->>'code_mode', 'POOL'), case when p->>'code_mode' = 'SHARED' then upper(trim(p->>'shared_code')) end,
    nullif(p->>'valid_until', '')::timestamptz, coalesce((p->>'is_active')::boolean, true), v_uid)
  on conflict (id) do update set sponsor_name = excluded.sponsor_name, sponsor_logo = excluded.sponsor_logo, title = excluded.title,
    terms = excluded.terms, redeem_url = excluded.redeem_url, condition = excluded.condition, top_n = excluded.top_n,
    code_mode = excluded.code_mode, shared_code = excluded.shared_code, valid_until = excluded.valid_until, is_active = excluded.is_active
  returning * into r;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SAVE_VOUCHER', 'voucher:' || r.id, p - 'shared_code');
  return private.voucher_json(r, true);
end $$;

-- Dán danh sách mã (mỗi dòng một mã); bỏ trùng; tối đa 5.000 mã / lần
create or replace function public.add_voucher_codes(p_campaign_id uuid, p_codes text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.voucher_campaigns := (select x from public.voucher_campaigns x where x.id = p_campaign_id);
  v_n integer;
begin
  if c.id is null then raise exception 'INVALID_VOUCHER'; end if;
  if not private.voucher_can_manage(c.target_type, c.target_id) then raise exception 'FORBIDDEN'; end if;
  if c.code_mode <> 'POOL' then raise exception 'INVALID_VOUCHER'; end if;
  if cardinality(p_codes) > 5000 then raise exception 'TOO_MANY_CODES'; end if;
  insert into public.voucher_codes (campaign_id, code)
  select c.id, x.code from (select distinct upper(trim(u)) as code from unnest(p_codes) u) x
   where char_length(x.code) between 3 and 40
  on conflict (campaign_id, code) do nothing;
  get diagnostics v_n = row_count;
  -- Người đã đạt điều kiện trước khi có mã: phát bù (thử thách đã hoàn thành / Top N; nhiệm vụ đã hoàn thành trong kỳ còn hiệu lực)
  if c.target_type = 'CHALLENGE' then
    perform private.issue_voucher(c, p.profile_id) from public.challenge_participants p
     where p.challenge_id = c.target_id and p.status <> 'LEFT'
       and ((c.condition = 'COMPLETE' and p.completed_at is not null) or (c.condition = 'TOP_N' and p.final_rank <= c.top_n));
  end if;
  return jsonb_build_object('added', v_n) || private.voucher_json(c, true);
end $$;

create or replace function public.list_voucher_campaigns(p_target_type text, p_target_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_manage boolean := auth.uid() is not null and private.voucher_can_manage(upper(p_target_type), p_target_id);
begin
  if upper(p_target_type) = 'CHALLENGE' and not public.challenge_visible(p_target_id) then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  return (select coalesce(jsonb_agg(private.voucher_json(v, v_manage) order by v.created_at), '[]'::jsonb)
            from public.voucher_campaigns v
           where v.target_type = upper(p_target_type) and v.target_id = p_target_id and (v.is_active or v_manage));
end $$;

create or replace function public.admin_list_voucher_campaigns() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(private.voucher_json(v, true) || jsonb_build_object('target_name',
            case v.target_type when 'CHALLENGE' then (select c.title from public.challenges c where c.id = v.target_id)
                               else (select q.title from public.quests q where q.id = v.target_id) end) order by v.created_at desc), '[]'::jsonb)
            from public.voucher_campaigns v);
end $$;

create or replace function public.my_vouchers() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('campaign_id', v.id, 'sponsor_name', v.sponsor_name, 'sponsor_logo', v.sponsor_logo,
      'title', v.title, 'terms', v.terms, 'redeem_url', v.redeem_url, 'valid_until', v.valid_until, 'code', g.code,
      'issued_at', g.issued_at, 'used_at', g.used_at, 'target_type', v.target_type, 'target_id', v.target_id,
      'target_name', case v.target_type when 'CHALLENGE' then (select c.title from public.challenges c where c.id = v.target_id)
                                        else (select q.title from public.quests q where q.id = v.target_id) end)
      order by (g.used_at is not null), g.issued_at desc), '[]'::jsonb)
    from public.voucher_grants g join public.voucher_campaigns v on v.id = g.campaign_id
   where g.user_id = auth.uid()
$$;

create or replace function public.mark_voucher_used(p_campaign_id uuid, p_used boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  update public.voucher_grants set used_at = case when p_used then now() end where campaign_id = p_campaign_id and user_id = v_uid;
  if not found then raise exception 'VOUCHER_NOT_FOUND'; end if;
end $$;

revoke all on function private.issue_voucher(public.voucher_campaigns, uuid), private.voucher_on_challenge(), private.voucher_on_quest(),
  private.voucher_can_manage(text, uuid), private.voucher_json(public.voucher_campaigns, boolean) from public, anon, authenticated;
revoke all on function public.save_voucher_campaign(jsonb), public.add_voucher_codes(uuid, text[]), public.list_voucher_campaigns(text, uuid),
  public.admin_list_voucher_campaigns(), public.my_vouchers(), public.mark_voucher_used(uuid, boolean) from public, anon;
grant execute on function public.save_voucher_campaign(jsonb), public.add_voucher_codes(uuid, text[]), public.list_voucher_campaigns(text, uuid),
  public.admin_list_voucher_campaigns(), public.my_vouchers(), public.mark_voucher_used(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001005300_market_partners.sql
-- ===================================================================
-- 005300: Chợ Runner (Market giai đoạn 2) — hồ sơ HLV / Shop / Dịch vụ ĐÃ XÁC MINH. RaceHub KHÔNG giữ tiền.
-- • Runner đăng ký hồ sơ đối tác (HLV, cửa hàng, dịch vụ: massage, pacer, chụp ảnh…) → admin xác minh → hiện trên Chợ Runner.
-- • Hồ sơ: giới thiệu, chuyên môn, bảng dịch vụ + giá tham khảo, khu vực (tỉnh / thành, không lộ tọa độ), liên hệ trực tiếp
--   (điện thoại, Zalo, Facebook, website). Người dùng liên hệ và thanh toán TRỰC TIẾP với đối tác.
-- • HLV: hiện thành tích chạy thật trên RaceHub (cấp, tổng km 12 tháng, số bài) — uy tín từ dữ liệu, không tự khai.
-- • Chưa có đánh giá (chỉ mở khi có đặt lịch thật để chống đánh giá ảo).
-- Cần 003100 (tìm kiếm), 004100. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('COACH', 'SHOP', 'SERVICE')),
  name text not null check (char_length(name) between 2 and 80),
  tagline text check (tagline is null or char_length(tagline) <= 120),
  bio text check (bio is null or char_length(bio) <= 2000),
  avatar_url text,
  cover_url text,
  area text check (area is null or char_length(area) <= 40),
  address text check (address is null or char_length(address) <= 160),
  specialties text[] not null default '{}',
  services jsonb not null default '[]'::jsonb,
  contacts jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'HIDDEN')),
  review_note text check (review_note is null or char_length(review_note) <= 300),
  verified_at timestamptz,
  verified_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, kind)
);
create index if not exists partners_list_idx on public.partners (status, kind, area);
alter table public.partners enable row level security;

-- Kho ảnh: market-media/<user_id>/<file>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('market-media', 'market-media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
drop policy if exists market_media_insert on storage.objects;
create policy market_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'market-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists market_media_delete on storage.objects;
create policy market_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'market-media' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function private.market_media_ok(p_owner uuid, p_url text) returns boolean
language sql immutable as $$
  select p_url is null or p_url ~ ('/storage/v1/object/public/market-media/' || p_owner::text || '/[A-Za-z0-9._-]{1,120}$')
$$;

-- Liên hệ: chỉ giữ trường hợp lệ
create or replace function private.market_contacts(c jsonb) returns jsonb
language plpgsql immutable as $$
declare v_out jsonb := '{}'::jsonb; k text; v text;
begin
  if c is null or jsonb_typeof(c) <> 'object' then return v_out; end if;
  foreach k in array array['phone', 'zalo', 'facebook', 'website', 'email'] loop
    v := nullif(trim(coalesce(c->>k, '')), '');
    if v is null then continue; end if;
    if k in ('phone', 'zalo') and v ~ '^\+?[0-9 .]{8,16}$' then v_out := v_out || jsonb_build_object(k, regexp_replace(v, '[ .]', '', 'g'));
    elsif k in ('facebook', 'website', 'zalo') and v ~ '^https://[^\s]{4,}$' and char_length(v) <= 300 then v_out := v_out || jsonb_build_object(k, v);
    elsif k = 'email' and v ~* '^[^@\s]{1,64}@[^@\s]{3,100}$' then v_out := v_out || jsonb_build_object(k, lower(v));
    else raise exception 'INVALID_CONTACT';
    end if;
  end loop;
  return v_out;
end $$;

create or replace function private.market_services(s jsonb) returns jsonb
language plpgsql immutable as $$
begin
  if s is null or jsonb_typeof(s) <> 'array' then return '[]'::jsonb; end if;
  if jsonb_array_length(s) > 12 then raise exception 'TOO_MANY_SERVICES'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'name', left(trim(e->>'name'), 80), 'price', nullif(left(trim(coalesce(e->>'price', '')), 40), ''),
      'unit', nullif(left(trim(coalesce(e->>'unit', '')), 30), ''), 'description', nullif(left(trim(coalesce(e->>'description', '')), 300), ''))
      order by o), '[]'::jsonb)
    from jsonb_array_elements(s) with ordinality as t(e, o)
   where char_length(trim(coalesce(e->>'name', ''))) >= 2);
end $$;

-- Uy tín HLV từ dữ liệu chạy thật
create or replace function private.partner_runner_stats(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'level', (select p.level from public.profiles p where p.id = p_user),
    'km_12m', (select round(coalesce(sum(coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0)), 0) / 1000.0) from public.activities a
                where a.user_id = p_user and a.validation_status = 'APPROVED' and a.started_at >= now() - interval '365 days'),
    'runs_12m', (select count(*) from public.activities a where a.user_id = p_user and a.validation_status = 'APPROVED' and a.started_at >= now() - interval '365 days'),
    'member_since', (select p.created_at from public.profiles p where p.id = p_user))
$$;

create or replace function private.partner_json(p public.partners, p_full boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'kind', p.kind, 'name', p.name, 'tagline', p.tagline, 'avatar_url', p.avatar_url, 'cover_url', p.cover_url,
    'area', p.area, 'specialties', to_jsonb(p.specialties), 'verified', p.status = 'APPROVED' and p.verified_at is not null,
    'status', p.status, 'is_mine', p.owner_id = auth.uid(),
    'services_count', jsonb_array_length(p.services),
    'owner', jsonb_build_object('id', p.owner_id, 'display_name', private.display_name(p.owner_id),
                                'avatar_url', (select x.avatar_url from public.profiles x where x.id = p.owner_id)))
    || case when p_full then jsonb_build_object('bio', p.bio, 'address', p.address, 'services', p.services, 'contacts', p.contacts,
         'review_note', case when p.owner_id = auth.uid() or public.is_system_admin() then p.review_note end,
         'stats', case when p.kind = 'COACH' then private.partner_runner_stats(p.owner_id) end,
         'updated_at', p.updated_at) else '{}'::jsonb end
$$;

-- ---------------------------------------------------------------------
-- RPC
-- ---------------------------------------------------------------------
create or replace function public.list_partners(p_kind text default null, p_area text default null, p_query text default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(private.partner_json(x.p, false) order by x.rn), '[]'::jsonb)
    from (select p, row_number() over (order by p.verified_at desc nulls last, p.name) as rn
            from public.partners p
           where p.status = 'APPROVED'
             and (p_kind is null or p.kind = upper(p_kind))
             and (p_area is null or p.area = p_area)
             and (private.search_key(p_query) = '' or private.search_match(private.search_hay(p.name || ' ' || coalesce(p.tagline, '') || ' '
                                                        || array_to_string(p.specialties, ' ')), p_query))) x
   where x.rn <= 60
$$;

create or replace function public.get_partner(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p public.partners := (select x from public.partners x where x.id = p_id);
begin
  if p.id is null or (p.status <> 'APPROVED' and p.owner_id is distinct from auth.uid() and not public.is_system_admin()) then
    raise exception 'PARTNER_NOT_FOUND';
  end if;
  return private.partner_json(p, true);
end $$;

create or replace function public.my_partners() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(private.partner_json(p, true) order by p.created_at), '[]'::jsonb) from public.partners p where p.owner_id = auth.uid()
$$;

create or replace function public.save_partner(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_old public.partners := (select x from public.partners x where x.id = v_id);
  v_kind text := upper(coalesce(p->>'kind', v_old.kind));
  r public.partners;
begin
  if v_old.id is not null and v_old.owner_id <> v_uid then raise exception 'FORBIDDEN'; end if;
  if v_kind not in ('COACH', 'SHOP', 'SERVICE') then raise exception 'INVALID_PARTNER'; end if;
  if char_length(trim(coalesce(p->>'name', ''))) < 2 then raise exception 'INVALID_PARTNER'; end if;
  if not private.market_media_ok(v_uid, nullif(p->>'avatar_url', '')) or not private.market_media_ok(v_uid, nullif(p->>'cover_url', '')) then
    raise exception 'INVALID_PARTNER_IMAGE';
  end if;
  if v_old.id is null and exists (select 1 from public.partners x where x.owner_id = v_uid and x.kind = v_kind) then raise exception 'PARTNER_EXISTS'; end if;
  insert into public.partners as t (id, owner_id, kind, name, tagline, bio, avatar_url, cover_url, area, address, specialties, services, contacts, status)
  values (coalesce(v_id, gen_random_uuid()), v_uid, v_kind, left(trim(p->>'name'), 80), nullif(left(trim(coalesce(p->>'tagline', '')), 120), ''),
    nullif(left(trim(coalesce(p->>'bio', '')), 2000), ''), nullif(p->>'avatar_url', ''), nullif(p->>'cover_url', ''),
    nullif(left(trim(coalesce(p->>'area', '')), 40), ''), nullif(left(trim(coalesce(p->>'address', '')), 160), ''),
    array(select left(trim(x), 30) from jsonb_array_elements_text(coalesce(p->'specialties', '[]'::jsonb)) with ordinality s(x, o)
           where trim(x) <> '' and o <= 12),
    private.market_services(p->'services'), private.market_contacts(p->'contacts'), 'PENDING')
  on conflict (id) do update set name = excluded.name, tagline = excluded.tagline, bio = excluded.bio, avatar_url = excluded.avatar_url,
    cover_url = excluded.cover_url, area = excluded.area, address = excluded.address, specialties = excluded.specialties,
    services = excluded.services, contacts = excluded.contacts, updated_at = now(),
    -- bị từ chối rồi sửa → gửi duyệt lại; đang hiện thì giữ nguyên (admin có thể ẩn)
    status = case when t.status = 'REJECTED' then 'PENDING' else t.status end
  returning * into r;
  return private.partner_json(r, true);
end $$;

create or replace function public.admin_list_partners(p_status text default 'PENDING') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(private.partner_json(p, true) order by p.updated_at desc), '[]'::jsonb)
            from public.partners p where p_status = 'ALL' or p.status = upper(p_status));
end $$;

create or replace function public.admin_review_partner(p_id uuid, p_action text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  r public.partners;
  v_act text := upper(coalesce(p_action, ''));
begin
  if v_act not in ('APPROVE', 'REJECT', 'HIDE') then raise exception 'INVALID_ACTION'; end if;
  if v_act in ('REJECT', 'HIDE') and char_length(trim(coalesce(p_note, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  update public.partners set
    status = case v_act when 'APPROVE' then 'APPROVED' when 'REJECT' then 'REJECTED' else 'HIDDEN' end,
    verified_at = case when v_act = 'APPROVE' then now() else verified_at end,
    verified_by = case when v_act = 'APPROVE' then v_uid else verified_by end,
    review_note = nullif(left(trim(coalesce(p_note, '')), 300), '')
  where id = p_id returning * into r;
  if r.id is null then raise exception 'PARTNER_NOT_FOUND'; end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'PARTNER_' || v_act, 'partner:' || r.id, jsonb_build_object('note', p_note));
  perform private.notify(r.owner_id, null, 'MARKET',
    case v_act when 'APPROVE' then 'Hồ sơ "' || r.name || '" đã được xác minh ✓' when 'REJECT' then 'Hồ sơ "' || r.name || '" cần bổ sung'
               else 'Hồ sơ "' || r.name || '" đã bị ẩn' end,
    coalesce(p_note, 'Hồ sơ của bạn đã hiện trên Chợ Runner.'), '/market/' || r.id, v_uid, true);
  return private.partner_json(r, true);
end $$;

revoke all on function private.market_media_ok(uuid, text), private.market_contacts(jsonb), private.market_services(jsonb),
  private.partner_runner_stats(uuid), private.partner_json(public.partners, boolean) from public, anon, authenticated;
revoke all on function public.list_partners(text, text, text), public.get_partner(uuid), public.my_partners(), public.save_partner(jsonb),
  public.admin_list_partners(text), public.admin_review_partner(uuid, text, text) from public, anon;
grant execute on function public.list_partners(text, text, text), public.get_partner(uuid) to anon, authenticated;
grant execute on function public.my_partners(), public.save_partner(jsonb), public.admin_list_partners(text), public.admin_review_partner(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001005400_challenge_rules_lists.sql
-- ===================================================================
-- 005400: Thử thách — thể lệ bổ sung + danh sách gọn.
-- • Thể lệ bổ sung (không bắt buộc) do người tạo điền: thưởng, phạt, lệ phí / đóng góp, điều kiện tham gia, liên hệ BTC,
--   và tối đa 5 mục tự đặt tên. Sửa được khi thử thách còn mở; nếu đã bắt đầu thì người tham gia được báo "BTC cập nhật thể lệ".
--   RaceHub không thu tiền hộ: lệ phí / phạt (nếu có) do BTC tự thu, app chỉ hiển thị.
-- • Danh sách thử thách: thử thách ĐÃ HỦY không còn nằm ở tab "Của tôi", "Khám phá", "CLB" (chỉ còn trong "Đã kết thúc").
--   Giải chạy ảo đã hủy cũng rời tab "Của tôi" (vẫn xem được ở "Đã qua").
-- Cần 000600, 002700. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

alter table public.challenges add column if not exists rules_info jsonb not null default '{}'::jsonb;
alter table public.challenges add column if not exists rules_updated_at timestamptz;

-- Chuẩn hóa thể lệ: chỉ giữ khóa hợp lệ, cắt độ dài, bỏ mục rỗng
create or replace function private.challenge_rules_clean(p jsonb) returns jsonb
language plpgsql immutable as $$
declare v_out jsonb := '{}'::jsonb; k text; v text; n int;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return v_out; end if;
  foreach k in array array['prizes', 'penalties', 'fees', 'conduct', 'contact'] loop
    v := nullif(trim(coalesce(p->>k, '')), '');
    n := case k when 'contact' then 200 when 'fees' then 600 else 1500 end;
    if v is not null then v_out := v_out || jsonb_build_object(k, left(v, n)); end if;
  end loop;
  if jsonb_typeof(p->'custom') = 'array' then
    if jsonb_array_length(p->'custom') > 5 then raise exception 'TOO_MANY_RULES'; end if;
    v_out := v_out || jsonb_build_object('custom', (
      select coalesce(jsonb_agg(jsonb_build_object('title', left(trim(e->>'title'), 60), 'body', left(trim(e->>'body'), 1500)) order by o), '[]'::jsonb)
        from jsonb_array_elements(p->'custom') with ordinality t(e, o)
       where char_length(trim(coalesce(e->>'title', ''))) >= 2 and char_length(trim(coalesce(e->>'body', ''))) >= 1));
    if v_out->'custom' = '[]'::jsonb then v_out := v_out - 'custom'; end if;
  end if;
  return v_out;
end $$;

create or replace function public.set_challenge_rules(p_challenge_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
  v_new jsonb := private.challenge_rules_clean(p);
  r record;
begin
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if c.created_by is distinct from v_uid and not (c.target_club_id is not null and public.club_is_staff(c.target_club_id))
     and not public.is_system_admin() then
    raise exception 'FORBIDDEN';
  end if;
  if c.status <> 'ACTIVE' or c.end_date <= now() then raise exception 'CHALLENGE_CLOSED'; end if;
  if v_new = c.rules_info then return v_new; end if;
  update public.challenges set rules_info = v_new, rules_updated_at = now() where id = c.id;
  -- Đã bắt đầu: báo người tham gia (trừ người sửa)
  if now() >= c.start_date then
    for r in select p2.profile_id from public.challenge_participants p2
              where p2.challenge_id = c.id and p2.status <> 'LEFT' and p2.profile_id <> v_uid loop
      perform private.notify(r.profile_id, c.target_club_id, 'CHALLENGE_RULES', 'BTC cập nhật thể lệ: ' || c.title,
        'Xem lại phần Luật chơi để nắm thể lệ mới.', '/challenges/' || c.id, v_uid, false);
    end loop;
  end if;
  return v_new;
end $$;

-- Danh sách thử thách: như 000600, bỏ thử thách đã hủy khỏi tab Của tôi / Khám phá / CLB; giới hạn 60 bằng row_number
create or replace function public.list_challenges(p_tab text default 'MINE', p_club_id uuid default null)
returns table (
  id uuid, title text, description text, format text, objective text, game_mode text, target_value numeric,
  start_date timestamptz, end_date timestamptz, status text, target_audience text, target_club_id uuid,
  club_name text, club_accent text, reward_xu numeric, participant_count integer, max_slots integer,
  my_status text, my_score numeric, my_rank integer, total_score numeric, created_by uuid
)
language sql stable security definer set search_path = public as $$
  with base as (
    select c.*,
           (select count(*)::int from public.challenge_participants p where p.challenge_id = c.id and p.status <> 'LEFT') as n,
           (select coalesce(sum(p.current_progress), 0) from public.challenge_participants p where p.challenge_id = c.id and p.status <> 'LEFT') as total,
           me.status as my_status, me.current_progress as my_score,
           case when me.id is not null then (select count(*)::int + 1 from public.challenge_participants o
                  where o.challenge_id = c.id and o.status <> 'LEFT' and o.current_progress > me.current_progress) end as my_rank
      from public.challenges c
      left join public.challenge_participants me on me.challenge_id = c.id and me.profile_id = auth.uid()
     where c.status in ('ACTIVE', 'FINISHED', 'CANCELLED')
       and case upper(coalesce(p_tab, 'MINE'))
         when 'MINE' then c.status <> 'CANCELLED'
                          and ((me.id is not null and me.status <> 'LEFT') or c.created_by = auth.uid())
                          and (c.status = 'ACTIVE' or c.end_date > now() - interval '30 days')
         when 'DISCOVER' then c.target_audience = 'PUBLIC' and c.status = 'ACTIVE' and c.end_date > now()
                          and (c.format <> 'TEAM' or c.start_date > now())
                          and (me.id is null or me.status = 'LEFT')
         when 'CLUB' then c.status <> 'CANCELLED'
                          and c.target_audience = 'CLUB_ONLY' and public.club_is_member(c.target_club_id)
                          and (p_club_id is null or c.target_club_id = p_club_id)
                          and (c.status = 'ACTIVE' or c.end_date > now() - interval '60 days')
         when 'ENDED' then me.id is not null and (c.status <> 'ACTIVE' or c.end_date <= now())
         else false end
  ), ranked as (
    select b.*, row_number() over (
             order by (b.status = 'ACTIVE' and b.end_date > now()) desc,
                      case when upper(coalesce(p_tab, 'MINE')) = 'DISCOVER' then -b.n else 0 end,
                      b.end_date) as rn
      from base b
  )
  select b.id, b.title, b.description, b.format, b.objective, b.game_mode, b.target_value, b.start_date, b.end_date,
         b.status, b.target_audience, b.target_club_id, cl.name, cl.accent_color, b.reward_xu, b.n, b.max_slots,
         b.my_status, b.my_score, b.my_rank, round(b.total, 2), b.created_by
    from ranked b left join public.clubs cl on cl.id = b.target_club_id
   where b.rn <= 60
   order by b.rn
$$;

-- Giải chạy ảo: như 002700, tab "Của tôi" bỏ giải đã hủy
create or replace function public.list_races(p_scope text default 'UPCOMING') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return (select coalesce(jsonb_agg(private.race_card(t.race) order by
            case when upper(p_scope) = 'PAST' then extract(epoch from (t.race).end_at) * -1 else extract(epoch from (t.race).start_at) end), '[]'::jsonb)
    from (select x as race, row_number() over (order by x.start_at desc) as rn from public.virtual_races x
           where private.race_visible(x)
             and case upper(coalesce(p_scope, 'UPCOMING'))
                   when 'MINE' then x.status <> 'CANCELLED'
                                and exists (select 1 from public.race_registrations g where g.race_id = x.id and g.user_id = auth.uid() and g.status <> 'WITHDRAWN')
                   when 'PAST' then x.end_at < now()
                   else x.end_at >= now() and x.status = 'PUBLISHED' end) t
   where t.rn <= 100);
end $$;

revoke all on function private.challenge_rules_clean(jsonb) from public, anon, authenticated;
revoke all on function public.set_challenge_rules(uuid, jsonb) from public, anon;
grant execute on function public.set_challenge_rules(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001005500_social_login_invites.sql
-- ===================================================================
-- 005500: Đăng nhập Google / Apple + lời mời chuyên nghiệp.
-- • Hồ sơ mới: lấy tên / ảnh từ Google, Apple (full_name, name, picture) hoặc tên nhập lúc đăng ký email (display_name).
--   Trước đây đăng ký email luôn ra tên = phần trước @ của email. Email ẩn của Apple (privaterelay) → "Runner".
-- • Mã giới thiệu ngắn, dễ đọc (8 ký tự, không có 0/O/1/I): link mời /join/<mã> thay cho /join/<uuid dài>.
--   Nhập mã ở màn đăng ký hoặc Tôi → Mời bạn bè (trong 14 ngày đầu). Link cũ /join/<uuid> vẫn dùng được.
-- • my_referral(): mã, số bạn đã mời / đã nhận thưởng / Xu đã nhận, luật thưởng hiện hành.
-- • Xem trước lời mời khi CHƯA đăng nhập: referral_preview (tên người mời), club_invite_preview (tên, logo, số thành viên CLB).
-- Cần 000300, 003400, 003700. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 1. Hồ sơ mới từ đăng ký email / Google / Apple
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_name text := coalesce(
    nullif(left(trim(m->>'display_name'), 60), ''), nullif(left(trim(m->>'full_name'), 60), ''), nullif(left(trim(m->>'name'), 60), ''),
    case when new.email is not null and new.email not ilike '%privaterelay.appleid.com' and new.email not ilike '%@phone.racehub.vn'
         then nullif(split_part(new.email, '@', 1), '') end,
    'Runner');
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, v_name, coalesce(nullif(m->>'avatar_url', ''), nullif(m->>'picture', '')))
  on conflict (id) do nothing;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2. Mã giới thiệu ngắn
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists referral_code text;
create unique index if not exists profiles_referral_code_key on public.profiles (referral_code);

-- 8 ký tự từ bảng 32 chữ dễ đọc, suy ra cố định từ id (2^40 tổ hợp) — chạy lại vẫn ra đúng mã cũ
create or replace function private.referral_code_for(p_id uuid, p_salt int default 0) returns text
language sql immutable as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', ((n >> (5 * i)) & 31)::int + 1, 1), '' order by i)
    from (select ('x' || substr(md5(p_id::text || case when p_salt > 0 then ':' || p_salt else '' end), 1, 10))::bit(40)::bigint as n) s,
         generate_series(0, 7) as i
$$;

create or replace function private.assign_referral_code() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_code text; v_salt int := 0;
begin
  if new.referral_code is not null then return new; end if;
  loop
    v_code := private.referral_code_for(new.id, v_salt);
    exit when not exists (select 1 from public.profiles p where p.referral_code = v_code and p.id <> new.id);
    v_salt := v_salt + 1;
  end loop;
  new.referral_code := v_code;
  return new;
end $$;
drop trigger if exists trg_assign_referral_code on public.profiles;
create trigger trg_assign_referral_code before insert or update of referral_code on public.profiles
  for each row execute function private.assign_referral_code();
-- Cấp mã cho tài khoản cũ (trigger tự tính mã khi đặt về null)
update public.profiles set referral_code = null where referral_code is null;

-- Tìm người mời theo mã ngắn hoặc uuid (link cũ)
create or replace function private.referrer_by_code(p_code text) returns uuid
language sql stable security definer set search_path = public as $$
  select p.id from public.profiles p
   where p.referral_code = upper(trim(coalesce(p_code, '')))
      or (trim(coalesce(p_code, '')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and p.id = trim(p_code)::uuid)
$$;

create or replace function public.apply_referral_code(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ref uuid := private.referrer_by_code(p_code);
begin
  perform private.require_uid();
  if v_ref is null then raise exception 'REFERRER_NOT_FOUND'; end if;
  return public.apply_referral(v_ref) || jsonb_build_object('referrer_name', private.display_name(v_ref));
end $$;

create or replace function public.referral_preview(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when r.id is null then null else jsonb_build_object(
    'display_name', r.display_name, 'avatar_url', r.avatar_url, 'code', r.referral_code,
    'referee_xu', coalesce((private.economy_config()->'referral'->>'refereeXu')::numeric, 0),
    'min_km', coalesce((private.economy_config()->'referral'->>'minKm')::numeric, 3)) end
    from (select p.id, p.display_name, p.avatar_url, p.referral_code from public.profiles p where p.id = private.referrer_by_code(p_code)) r
    right join (select 1) one on true
$$;

create or replace function public.my_referral() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  me public.profiles := (select p from public.profiles p where p.id = v_uid);
  cfg jsonb := private.economy_config()->'referral';
begin
  return jsonb_build_object(
    'code', me.referral_code,
    'invited', (select count(*) from public.profiles p where p.referred_by = v_uid),
    'rewarded', (select count(*) from public.ledger_transactions t join public.ledger_entries e on e.transaction_id = t.id
                  where t.type = 'REFERRAL_INVITER' and e.account_id = v_uid and e.amount > 0),
    'xu_earned', (select coalesce(sum(e.amount), 0) from public.ledger_transactions t join public.ledger_entries e on e.transaction_id = t.id
                  where t.type = 'REFERRAL_INVITER' and e.account_id = v_uid and e.amount > 0),
    'friends', (select coalesce(jsonb_agg(jsonb_build_object('display_name', x.display_name, 'avatar_url', x.avatar_url, 'joined_at', x.created_at,
                  'rewarded', exists (select 1 from public.ledger_transactions t where t.idempotency_key = 'referral_inviter:' || x.id)) order by x.created_at desc), '[]'::jsonb)
                  from (select p.id, p.display_name, p.avatar_url, p.created_at, row_number() over (order by p.created_at desc) as rn
                          from public.profiles p where p.referred_by = v_uid) x where x.rn <= 50),
    'referred_by', (select jsonb_build_object('display_name', r.display_name, 'avatar_url', r.avatar_url) from public.profiles r where r.id = me.referred_by),
    'can_enter_code', me.referred_by is null and me.created_at >= now() - interval '14 days',
    'enter_until', case when me.referred_by is null then me.created_at + interval '14 days' end,
    'rules', jsonb_build_object('inviter_xu', coalesce((cfg->>'inviterXu')::numeric, 0), 'referee_xu', coalesce((cfg->>'refereeXu')::numeric, 0),
                                'min_km', coalesce((cfg->>'minKm')::numeric, 3), 'monthly_cap', coalesce((cfg->>'monthlyCap')::int, 10)));
end $$;

-- ---------------------------------------------------------------------
-- 3. Xem trước lời mời CLB (chưa đăng nhập cũng xem được; không trả mã mời)
-- ---------------------------------------------------------------------
create or replace function public.club_invite_preview(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when c.id is null then null else jsonb_build_object(
    'id', c.id, 'name', c.name, 'description', left(c.description, 280), 'avatar_url', c.avatar_url, 'accent_color', c.accent_color,
    'member_count', c.member_count, 'join_policy', c.join_policy, 'plan', c.plan,
    'full', c.member_count >= coalesce(c.member_limit, 2147483647),
    'my_status', (select m.status from public.club_members m where m.club_id = c.id and m.user_id = auth.uid())) end
    from (select x.* from public.clubs x where x.invite_code = lower(trim(coalesce(p_code, '')))) c
    right join (select 1) one on true
$$;

revoke all on function private.referral_code_for(uuid, int), private.assign_referral_code(), private.referrer_by_code(text) from public, anon, authenticated;
revoke all on function public.apply_referral_code(text), public.my_referral(), public.referral_preview(text), public.club_invite_preview(text) from public, anon;
grant execute on function public.apply_referral_code(text), public.my_referral() to authenticated;
grant execute on function public.referral_preview(text), public.club_invite_preview(text) to anon, authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001005600_admin_console.sql
-- ===================================================================
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

-- ===================================================================
-- 20261001005700_club_roles_cleanup.sql
-- ===================================================================
-- 005700: Sửa dứt điểm lỗi trao quyền Chủ nhiệm (mã UNK-…).
-- Nguyên nhân: bảng club_members trên production còn ràng buộc CŨ club_members_role_check (chỉ cho OWNER / ADMIN / MEMBER)
-- song song ràng buộc mới club_members_role_chk (OWNER / CAPTAIN / MEMBER). Migration 000500 có xóa ràng buộc cũ,
-- nhưng nếu file 500 từng dừng giữa chừng trên SQL Editor thì nó vẫn còn → đổi chủ nhiệm cũ thành CAPTAIN bị chặn.
-- Việc làm: đổi vai trò cũ ADMIN / VICE → CAPTAIN, xóa các ràng buộc cũ, giữ lại ràng buộc mới.
-- Chạy riêng được, chạy lại nhiều lần vẫn an toàn. Sau đó chạy lại 003500 (Kiểm tra hệ thống).

alter table public.club_members drop constraint if exists club_members_role_check;
alter table public.club_members drop constraint if exists club_members_status_check;
update public.club_members set role = 'CAPTAIN' where role in ('ADMIN', 'VICE');
alter table public.club_members drop constraint if exists club_members_role_chk;
alter table public.club_members add constraint club_members_role_chk check (role in ('OWNER', 'CAPTAIN', 'MEMBER'));

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001005800_outfit_studio.sql
-- ===================================================================
-- 005800: Outfit Studio — quản lý trang phục nhân vật 2D không cần sửa code (ADR-017 mở rộng).
-- • Vòng đời vật phẩm: Nháp → Chờ duyệt → Đang bán → Ngừng bán (người đã có vẫn mặc) → Gỡ hẳn.
-- • Bộ sưu tập (mùa, cấp, sự kiện, CLB, tài trợ) để nhóm vật phẩm trong Tủ đồ và Quản trị.
-- • Điều kiện mở khóa: cấp (1–8), huy hiệu, hoàn thành thử thách, chỉ thành viên CLB, khung thời gian bán, giới hạn số lượng.
--   Món 0 Xu có điều kiện (huy hiệu / thử thách / CLB / cấp) được tự phát khi đủ điều kiện.
-- • Vùng in trên áo: logo, tên CLB, dòng phụ, tên runner — vẽ lên áo đã đổi màu, giữ nếp vải (không cần họa sĩ cho từng CLB).
-- • Đồng phục CLB = vật phẩm bình thường (admin đặt giá) nhưng chỉ thành viên CLB mua / mặc được; rời CLB thì tự tháo.
--   Ban quản trị CLB gửi yêu cầu (màu, logo, chữ) → admin duyệt → vật phẩm tự lên Tủ đồ của thành viên.
-- • Áo thật KHÔNG bán ở đây: bán qua Shop đối tác ở Chợ Runner (RaceHub không nhận tiền).
-- Cần 000900, 001000, 001200, 005100. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 1. Bộ sưu tập + cột mới của vật phẩm
-- ---------------------------------------------------------------------
create table if not exists public.avatar_collections (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_]{3,40}$'),
  name text not null check (char_length(name) between 2 and 60),
  description text check (description is null or char_length(description) <= 200),
  kind text not null default 'SEASON' check (kind in ('CORE', 'LEVEL', 'SEASON', 'EVENT', 'CLUB', 'SPONSOR')),
  starts_at timestamptz,
  ends_at timestamptz,
  sort integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.avatar_collections enable row level security;
revoke all on public.avatar_collections from anon, authenticated;

alter table public.avatar_items add column if not exists status text;
alter table public.avatar_items add column if not exists collection_id uuid references public.avatar_collections(id) on delete set null;
alter table public.avatar_items add column if not exists club_id uuid references public.clubs(id) on delete cascade;
alter table public.avatar_items add column if not exists required_badge text;
alter table public.avatar_items add column if not exists required_challenge uuid references public.challenges(id) on delete set null;
alter table public.avatar_items add column if not exists available_from timestamptz;
alter table public.avatar_items add column if not exists available_to timestamptz;
alter table public.avatar_items add column if not exists supply_limit integer;
alter table public.avatar_items add column if not exists print jsonb;
-- Trạng thái của vật phẩm cũ: đang hiện → Đang bán, đang ẩn → Gỡ hẳn (giữ đúng hành vi cũ)
update public.avatar_items set status = case when is_active then 'PUBLISHED' else 'RETIRED' end where status is null;
alter table public.avatar_items alter column status set default 'PUBLISHED';
alter table public.avatar_items alter column status set not null;
alter table public.avatar_items drop constraint if exists avatar_items_status_chk;
alter table public.avatar_items add constraint avatar_items_status_chk check (status in ('DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED', 'RETIRED'));
alter table public.avatar_items drop constraint if exists avatar_items_supply_chk;
alter table public.avatar_items add constraint avatar_items_supply_chk check (supply_limit is null or supply_limit > 0);
-- 8 cấp (kinh tế v2)
alter table public.avatar_items drop constraint if exists avatar_items_unlock_level_check;
alter table public.avatar_items drop constraint if exists avatar_items_unlock_level_chk;
alter table public.avatar_items add constraint avatar_items_unlock_level_chk check (unlock_level between 1 and 8);
create index if not exists avatar_items_club_idx on public.avatar_items (club_id) where club_id is not null;

-- is_active = còn hiển thị / mặc được (Đang bán, Ngừng bán); Nháp / Chờ duyệt / Gỡ hẳn thì ẩn
create or replace function private.avatar_item_status_sync() returns trigger
language plpgsql as $$
begin
  new.is_active := new.status in ('PUBLISHED', 'ARCHIVED');
  return new;
end $$;
drop trigger if exists trg_avatar_item_status on public.avatar_items;
create trigger trg_avatar_item_status before insert or update of status on public.avatar_items
  for each row execute function private.avatar_item_status_sync();

-- ---------------------------------------------------------------------
-- 2. Điều kiện: ai được mua / nhận, ai được mặc
-- ---------------------------------------------------------------------
create or replace function private.is_club_member(p_user uuid, p_club uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.club_members m where m.club_id = p_club and m.user_id = p_user and m.status = 'APPROVED')
$$;

-- null = được mua / nhận; ngược lại là lý do khóa
create or replace function private.item_lock(p_user uuid, i public.avatar_items) returns text
language sql stable security definer set search_path = public as $$
  select case
    when i.status <> 'PUBLISHED' then 'NOT_FOR_SALE'
    when i.club_id is not null and not private.is_club_member(p_user, i.club_id) then 'CLUB_ONLY'
    when coalesce((select p.level from public.profiles p where p.id = p_user), 1) < i.unlock_level then 'LEVEL'
    when i.required_badge is not null and not exists (
      select 1 from public.user_achievements ua join public.achievements a on a.id = ua.achievement_id
       where ua.user_id = p_user and a.code = i.required_badge) then 'BADGE'
    when i.required_challenge is not null and not exists (
      select 1 from public.challenge_participants cp
       where cp.challenge_id = i.required_challenge and cp.profile_id = p_user and cp.completed_at is not null) then 'CHALLENGE'
    when i.available_from is not null and now() < i.available_from then 'NOT_YET'
    when i.available_to is not null and now() > i.available_to then 'ENDED'
    when i.supply_limit is not null and (select count(*) from public.user_inventory v
                                          where v.item_id = i.id and v.acquired_reason <> 'TRIAL') >= i.supply_limit then 'SOLD_OUT'
  end
$$;

-- Mặc được: vật phẩm còn hiển thị, và đồng phục CLB thì phải còn là thành viên
create or replace function private.item_wearable(p_user uuid, p_item uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.avatar_items i where i.id = p_item and i.is_active
                  and (i.club_id is null or private.is_club_member(p_user, i.club_id)))
$$;

create or replace function private.item_json(i public.avatar_items) returns jsonb
language sql immutable as $$
  select jsonb_build_object('code', i.code, 'name', i.name, 'description', i.description, 'slot', i.category, 'rarity', i.rarity,
    'render_kind', i.render_kind, 'layer_urls', i.layer_urls, 'color', i.color, 'price_xu', i.price_xu,
    'unlock_level', i.unlock_level, 'is_default', i.is_default, 'acquire', coalesce(i.metadata->>'acquire', 'xu'),
    'print', i.print, 'status', i.status, 'club_id', i.club_id, 'collection_id', i.collection_id,
    'required_badge', i.required_badge, 'required_challenge', i.required_challenge,
    'available_from', i.available_from, 'available_to', i.available_to, 'supply_limit', i.supply_limit)
$$;

-- Phát đồ 0 Xu khi đủ điều kiện: bộ mặc định, quà cấp, quà huy hiệu / thử thách, đồng phục CLB miễn phí
create or replace function private.grant_free_items(p_user uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare v_rows integer;
begin
  insert into public.user_inventory (user_id, item_id, acquired_reason)
  select p_user, i.id,
         case when i.is_default then 'DEFAULT' when i.club_id is not null then 'CLUB'
              when i.required_badge is not null then 'BADGE' when i.required_challenge is not null then 'CHALLENGE'
              else 'LEVEL_' || i.unlock_level end
    from public.avatar_items i
   where i.is_active and i.status = 'PUBLISHED' and i.code is not null and i.price_xu = 0
     and (i.is_default or i.unlock_level > 1 or i.required_badge is not null or i.required_challenge is not null or i.club_id is not null)
     and private.item_lock(p_user, i) is null
  on conflict (user_id, item_id) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

-- Như 005100 + tháo đồng phục CLB khi không còn là thành viên
create or replace function private.ensure_character(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k text; v_id uuid;
begin
  insert into public.user_avatar (user_id) values (p_user) on conflict (user_id) do nothing;
  perform private.expire_trials(p_user);
  perform private.grant_free_items(p_user);
  insert into public.user_equipment (user_id) values (p_user) on conflict (user_id) do nothing;
  foreach k in array private.character_slots() loop
    v_id := (select (to_jsonb(e) ->> (k || '_item_id'))::uuid from public.user_equipment e where e.user_id = p_user);
    if v_id is not null and private.item_wearable(p_user, v_id) then continue; end if;
    if k = any(private.character_required_slots()) then
      v_id := (select id from public.avatar_items where code = k || '_original');
    else
      if v_id is null then continue; end if;
      v_id := null;
    end if;
    execute format('update public.user_equipment set %I = $1, updated_at = now() where user_id = $2', k || '_item_id') using v_id, p_user;
  end loop;
end $$;

-- Như 001000 + chặn mặc đồng phục CLB khi không phải thành viên
create or replace function public.save_character(p_look jsonb, p_equipped jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_gender text := p_look->>'gender';
  k text;
  v_code text;
  v_id uuid;
begin
  perform private.ensure_character(v_uid);
  if v_gender is not null and v_gender not in ('male', 'female') then raise exception 'INVALID_LOOK'; end if;
  update public.user_avatar set gender = coalesce(v_gender, gender), updated_at = now() where user_id = v_uid;

  if p_equipped is not null and jsonb_typeof(p_equipped) = 'object' then
    for k in select jsonb_object_keys(p_equipped) loop
      if not (k = any(private.character_slots())) then raise exception 'INVALID_SLOT'; end if;
      v_code := p_equipped->>k;
      if v_code is null then
        if k = any(private.character_required_slots()) then raise exception 'SLOT_REQUIRED'; end if;
        v_id := null;
      else
        v_id := (select i.id from public.avatar_items i
                   join public.user_inventory inv on inv.item_id = i.id and inv.user_id = v_uid
                  where i.code = v_code and i.category = k and i.is_active);
        if v_id is null then raise exception 'ITEM_NOT_OWNED'; end if;
        if not private.item_wearable(v_uid, v_id) then raise exception 'CLUB_ONLY'; end if;
      end if;
      execute format('update public.user_equipment set %I = $1, updated_at = now() where user_id = $2', k || '_item_id') using v_id, v_uid;
    end loop;
  end if;
  return private.character_look(v_uid);
end $$;

-- ---------------------------------------------------------------------
-- 3. Tủ đồ: như 005100 + ẩn đồ không dành cho mình, kèm lý do khóa, bộ sưu tập, số lượng còn
-- ---------------------------------------------------------------------
create or replace function public.character_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); v_items jsonb;
begin
  perform private.ensure_character(v_uid);
  v_items := (select coalesce(jsonb_agg(private.item_json(i) || jsonb_build_object(
                  'owned', inv.item_id is not null and inv.acquired_reason <> 'TRIAL',
                  'trial_until', case when inv.acquired_reason = 'TRIAL' then inv.expires_at end,
                  'offer', private.item_offer(v_uid, 'AVATAR', i.code, i.price_xu, 1),
                  'lock', case when inv.item_id is null then private.item_lock(v_uid, i) end,
                  'collection', (select jsonb_build_object('code', c.code, 'name', c.name, 'kind', c.kind) from public.avatar_collections c where c.id = i.collection_id),
                  'club_name', (select cl.name from public.clubs cl where cl.id = i.club_id),
                  'left', case when i.supply_limit is not null then greatest(0, i.supply_limit - (select count(*) from public.user_inventory v
                            where v.item_id = i.id and v.acquired_reason <> 'TRIAL')) end)
                order by i.category, i.sort, i.name), '[]'::jsonb)
                from public.avatar_items i
                left join public.user_inventory inv on inv.item_id = i.id and inv.user_id = v_uid
               where i.is_active and i.code is not null
                 -- đã có thì luôn thấy; chưa có: chỉ món đang bán, đồng phục chỉ thành viên CLB thấy
                 and (inv.item_id is not null
                      or (i.status = 'PUBLISHED' and (i.club_id is null or private.is_club_member(v_uid, i.club_id))
                          and (i.available_to is null or i.available_to > now() - interval '1 day'))));
  return (private.character_look(v_uid) - 'items') || jsonb_build_object(
    'level', coalesce((select level from public.profiles where id = v_uid), 1),
    'balance', private.balance(v_uid),
    'gender_set', (select gender is not null from public.profiles where id = v_uid),
    'display_name', private.display_name(v_uid),
    'items', v_items,
    'collections', (select coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'name', c.name, 'kind', c.kind, 'ends_at', c.ends_at) order by c.sort, c.name), '[]'::jsonb)
                      from public.avatar_collections c
                     where c.is_active and (c.starts_at is null or c.starts_at <= now()) and (c.ends_at is null or c.ends_at > now())
                       and exists (select 1 from public.avatar_items i where i.collection_id = c.id and i.status = 'PUBLISHED')),
    'bundles', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'badge', p.badge, 'price', p.fixed_price,
                  'base', (select coalesce(sum(i.price_xu), 0) from public.avatar_items i where i.code = any (p.bundle_items)),
                  'items', p.bundle_items, 'ends_at', p.ends_at, 'bought', private.promo_used(p.id, v_uid) >= coalesce(p.per_user_limit, 1),
                  'left', case when p.quantity_limit is null then null else p.quantity_limit - private.promo_used(p.id, null) end) order by p.created_at desc), '[]'::jsonb)
                  from public.item_promotions p
                 where p.kind = 'BUNDLE' and private.promo_live(p) and private.promo_segment_ok(v_uid, p.segment)));
end $$;

-- Như 005100, điều kiện mở khóa đầy đủ + giới hạn số lượng (khóa theo vật phẩm để không bán quá)
create or replace function public.buy_avatar_item(p_code text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  i public.avatar_items := (select x from public.avatar_items x where x.code = p_code and x.is_active);
  v_lock text;
  o jsonb;
  v_price integer;
  v_owned public.user_inventory;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if exists (select 1 from public.ledger_transactions where idempotency_key = 'shop:' || p_idempotency_key)
     or exists (select 1 from public.item_promo_redemptions where ref = 'shop:' || p_idempotency_key) then
    return jsonb_build_object('duplicate', true, 'balance', private.balance(v_uid));
  end if;
  if i.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if coalesce(i.metadata->>'acquire', '') = 'shine' then raise exception 'SHINE_ONLY'; end if;
  perform pg_advisory_xact_lock(hashtextextended('shop:' || v_uid, 0));
  if i.supply_limit is not null then perform pg_advisory_xact_lock(hashtextextended('item:' || i.id, 0)); end if;
  v_owned := (select x from public.user_inventory x where x.user_id = v_uid and x.item_id = i.id);
  if v_owned.id is not null and (v_owned.expires_at is null or v_owned.expires_at > now()) and v_owned.acquired_reason <> 'TRIAL' then
    raise exception 'ALREADY_OWNED';
  end if;
  v_lock := private.item_lock(v_uid, i);
  if v_lock is not null then
    raise exception '%', case v_lock when 'LEVEL' then 'LEVEL_TOO_LOW' when 'CLUB_ONLY' then 'CLUB_ONLY' when 'BADGE' then 'BADGE_REQUIRED'
      when 'CHALLENGE' then 'CHALLENGE_REQUIRED' when 'NOT_YET' then 'NOT_YET_AVAILABLE' when 'ENDED' then 'SALE_ENDED'
      when 'SOLD_OUT' then 'SOLD_OUT' else 'NOT_FOR_SALE' end;
  end if;

  o := private.item_offer(v_uid, 'AVATAR', i.code, i.price_xu, 1);
  if o is not null and (o->>'eligible')::boolean and o->>'kind' <> 'TRIAL' then v_price := (o->>'price')::int;
  else v_price := i.price_xu; o := null; end if;

  if v_price > 0 then
    if private.balance(v_uid) < v_price then raise exception 'INSUFFICIENT_BALANCE'; end if;
    perform private.ledger_post('SHOP_ITEM', 'shop:' || p_idempotency_key, 'Mua ' || i.name || case when o is not null then ' (' || (o->>'title') || ')' else '' end,
      v_uid, private.debit_entries(v_uid, v_price, private.system_account()));
  end if;
  if o is not null then
    insert into public.item_promo_redemptions (promo_id, user_id, qty, xu_paid, ref) values ((o->>'promo_id')::uuid, v_uid, 1, v_price, 'shop:' || p_idempotency_key);
  end if;
  delete from public.user_inventory where user_id = v_uid and item_id = i.id;          -- mua đứt thay cho bản dùng thử
  insert into public.user_inventory (user_id, item_id, acquired_reason)
  values (v_uid, i.id, case when o is not null then 'PROMO' when v_price > 0 then 'PURCHASE' else 'FREE' end);
  return jsonb_build_object('code', i.code, 'paid', v_price, 'balance', private.balance(v_uid));
end $$;

-- ---------------------------------------------------------------------
-- 4. Vùng in trên áo
-- ---------------------------------------------------------------------
-- {logo_url, title, subtitle, personal: NONE|NAME, text_color, font: sport|sans|serif}
create or replace function private.clean_print(p jsonb) returns jsonb
language plpgsql immutable as $$
declare v_logo text := nullif(trim(coalesce(p->>'logo_url', '')), '');
begin
  if p is null or jsonb_typeof(p) <> 'object' then return null; end if;
  if v_logo is not null and v_logo !~ '^(/character/|https://)[^\s"<>]+\.(png|webp|jpe?g)(\?[^\s"<>]*)?$' then raise exception 'INVALID_PRINT'; end if;
  if coalesce(p->>'text_color', '#ffffff') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_PRINT'; end if;
  if coalesce(p->>'personal', 'NONE') not in ('NONE', 'NAME') then raise exception 'INVALID_PRINT'; end if;
  if coalesce(p->>'font', 'sport') not in ('sport', 'sans', 'serif') then raise exception 'INVALID_PRINT'; end if;
  if v_logo is null and nullif(trim(coalesce(p->>'title', '')), '') is null and nullif(trim(coalesce(p->>'subtitle', '')), '') is null
     and coalesce(p->>'personal', 'NONE') = 'NONE' then return null; end if;
  return jsonb_build_object('logo_url', v_logo, 'title', nullif(left(trim(coalesce(p->>'title', '')), 24), ''),
    'subtitle', nullif(left(trim(coalesce(p->>'subtitle', '')), 32), ''), 'personal', coalesce(p->>'personal', 'NONE'),
    'text_color', coalesce(p->>'text_color', '#ffffff'), 'font', coalesce(p->>'font', 'sport'));
end $$;

-- ---------------------------------------------------------------------
-- 5. Quản trị vật phẩm (thay 001200): vòng đời, bộ sưu tập, điều kiện, vùng in
-- ---------------------------------------------------------------------
create or replace function public.admin_save_avatar_item(p_item jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  v_code text := lower(trim(coalesce(p_item->>'code', '')));
  v_name text := trim(coalesce(p_item->>'name', ''));
  v_desc text := nullif(trim(coalesce(p_item->>'description', '')), '');
  v_slot text := p_item->>'slot';
  v_rarity text := coalesce(p_item->>'rarity', 'common');
  v_kind text := coalesce(p_item->>'render_kind', 'TINT');
  v_color text := nullif(p_item->>'color', '');
  v_layers jsonb := case when jsonb_typeof(p_item->'layer_urls') = 'object' then p_item->'layer_urls' end;
  v_price numeric := coalesce((p_item->>'price_xu')::numeric, 0);
  v_level integer := coalesce((p_item->>'unlock_level')::integer, 1);
  v_sort integer := coalesce((p_item->>'sort')::integer, 100);
  v_default boolean := coalesce((p_item->>'is_default')::boolean, false);
  -- tương thích bản cũ: is_active=false (không gửi status) → Gỡ hẳn
  v_status text := upper(coalesce(p_item->>'status', case when (p_item->>'is_active')::boolean is false then 'RETIRED' else 'PUBLISHED' end));
  v_collection uuid := (select c.id from public.avatar_collections c where c.code = nullif(p_item->>'collection', ''));
  v_club uuid := nullif(p_item->>'club_id', '')::uuid;
  v_badge text := nullif(trim(coalesce(p_item->>'required_badge', '')), '');
  v_challenge uuid := nullif(p_item->>'required_challenge', '')::uuid;
  v_from timestamptz := nullif(p_item->>'available_from', '')::timestamptz;
  v_to timestamptz := nullif(p_item->>'available_to', '')::timestamptz;
  v_supply integer := nullif(p_item->>'supply_limit', '')::integer;
  v_print jsonb := private.clean_print(p_item->'print');
  v_old public.avatar_items;
  k text;
  v_url text;
begin
  if v_code !~ '^[a-z0-9_]{3,48}$' then raise exception 'INVALID_CODE'; end if;
  if char_length(v_name) not between 2 and 60 then raise exception 'INVALID_NAME'; end if;
  if v_desc is not null and char_length(v_desc) > 160 then raise exception 'INVALID_DESCRIPTION'; end if;
  if v_slot is null or not (v_slot = any(private.character_slots())) then raise exception 'INVALID_SLOT'; end if;
  if v_rarity not in ('common', 'rare', 'epic', 'legendary') then raise exception 'INVALID_RARITY'; end if;
  if v_price < 0 or v_price > 100000 then raise exception 'INVALID_PRICE'; end if;
  if v_level not between 1 and 8 then raise exception 'INVALID_LEVEL'; end if;
  if v_status not in ('DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED', 'RETIRED') then raise exception 'INVALID_STATUS'; end if;
  if nullif(p_item->>'collection', '') is not null and v_collection is null then raise exception 'COLLECTION_NOT_FOUND'; end if;
  if v_club is not null and not exists (select 1 from public.clubs c where c.id = v_club) then raise exception 'CLUB_NOT_FOUND'; end if;
  if v_badge is not null and not exists (select 1 from public.achievements a where a.code = v_badge) then raise exception 'BADGE_NOT_FOUND'; end if;
  if v_challenge is not null and not exists (select 1 from public.challenges c where c.id = v_challenge) then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if v_from is not null and v_to is not null and v_to <= v_from then raise exception 'INVALID_TIME_RANGE'; end if;
  if v_supply is not null and v_supply < 1 then raise exception 'INVALID_SUPPLY'; end if;
  if v_print is not null and v_slot <> 'top' then raise exception 'PRINT_TOP_ONLY'; end if;

  if v_kind = 'TINT' then
    if not (v_slot = any(private.character_required_slots())) then raise exception 'TINT_SLOT_ONLY'; end if;
    if v_color is not null and v_color !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_COLOR'; end if;
    v_layers := null;
  elsif v_kind = 'LAYER' then
    if v_layers is null or v_layers = '{}'::jsonb then raise exception 'LAYER_REQUIRED'; end if;
    for k in select jsonb_object_keys(v_layers) loop
      if k not in ('male', 'female') then raise exception 'INVALID_LAYER'; end if;
      v_url := v_layers->>k;
      if v_url is null or v_url !~ '^(/character/|https://)[^\s"<>]+\.png(\?[^\s"<>]*)?$' then raise exception 'INVALID_LAYER'; end if;
    end loop;
    v_color := null;
  else
    raise exception 'INVALID_RENDER_KIND';
  end if;

  v_old := (select i from public.avatar_items i where i.code = v_code);
  if v_old.id is not null and v_old.category <> v_slot
     and exists (select 1 from public.user_inventory where item_id = v_old.id) then
    raise exception 'SLOT_LOCKED';
  end if;
  if v_status not in ('PUBLISHED', 'ARCHIVED') and v_code = v_slot || '_original' then raise exception 'ITEM_REQUIRED'; end if;
  -- đã có người sở hữu thì không đưa về Nháp / Chờ duyệt (họ sẽ mất đồ) — dùng Ngừng bán
  if v_old.id is not null and v_status in ('DRAFT', 'REVIEW') and exists (select 1 from public.user_inventory where item_id = v_old.id) then
    raise exception 'ITEM_HAS_OWNERS';
  end if;

  insert into public.avatar_items (code, name, description, category, rarity, asset_url, render_kind, color, layer_urls,
                                   price_xu, unlock_level, sort, is_default, status, collection_id, club_id, required_badge,
                                   required_challenge, available_from, available_to, supply_limit, print)
  values (v_code, v_name, v_desc, v_slot, v_rarity, lower(v_kind), v_kind, v_color, v_layers,
          v_price, v_level, v_sort, v_default, v_status, v_collection, v_club, v_badge, v_challenge, v_from, v_to, v_supply, v_print)
  on conflict (code) where code is not null do update set
    name = excluded.name, description = excluded.description, category = excluded.category, rarity = excluded.rarity,
    render_kind = excluded.render_kind, color = excluded.color, layer_urls = excluded.layer_urls,
    price_xu = excluded.price_xu, unlock_level = excluded.unlock_level, sort = excluded.sort, is_default = excluded.is_default,
    status = excluded.status, collection_id = excluded.collection_id, club_id = excluded.club_id, required_badge = excluded.required_badge,
    required_challenge = excluded.required_challenge, available_from = excluded.available_from, available_to = excluded.available_to,
    supply_limit = excluded.supply_limit, print = excluded.print;

  insert into public.admin_audit_log (actor_id, action, target, old_value, new_value)
  values (v_admin, case when v_old.id is null then 'AVATAR_ITEM_CREATE' else 'AVATAR_ITEM_UPDATE' end, 'avatar_item:' || v_code,
          case when v_old.id is null then null else private.item_json(v_old) end,
          private.item_json((select i from public.avatar_items i where i.code = v_code)));

  return private.item_json((select i from public.avatar_items i where i.code = v_code)) || jsonb_build_object('is_active', v_status in ('PUBLISHED', 'ARCHIVED'));
end $$;

-- Bản cũ (nút Bán / Ẩn): mở bán = Đang bán; ẩn = Gỡ hẳn
create or replace function public.admin_set_avatar_item_active(p_code text, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_admin uuid := private.require_admin(); v_slot text;
begin
  v_slot := (select category from public.avatar_items where code = p_code);
  if v_slot is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if not p_active and p_code = v_slot || '_original' then raise exception 'ITEM_REQUIRED'; end if;
  update public.avatar_items set status = case when p_active then 'PUBLISHED' else 'RETIRED' end where code = p_code;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_admin, case when p_active then 'AVATAR_ITEM_ENABLE' else 'AVATAR_ITEM_DISABLE' end, 'avatar_item:' || p_code,
          jsonb_build_object('is_active', p_active));
end $$;

create or replace function public.admin_set_avatar_item_status(p_code text, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  i public.avatar_items := (select x from public.avatar_items x where x.code = p_code);
  v_status text := upper(coalesce(p_status, ''));
begin
  if i.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if v_status not in ('DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED', 'RETIRED') then raise exception 'INVALID_STATUS'; end if;
  if v_status not in ('PUBLISHED', 'ARCHIVED') and p_code = i.category || '_original' then raise exception 'ITEM_REQUIRED'; end if;
  if v_status in ('DRAFT', 'REVIEW') and exists (select 1 from public.user_inventory where item_id = i.id) then raise exception 'ITEM_HAS_OWNERS'; end if;
  update public.avatar_items set status = v_status where id = i.id;
  insert into public.admin_audit_log (actor_id, action, target, old_value, new_value)
  values (v_admin, 'AVATAR_ITEM_STATUS', 'avatar_item:' || p_code, jsonb_build_object('status', i.status), jsonb_build_object('status', v_status));
end $$;

create or replace function public.admin_list_avatar_items() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(private.item_json(i) || jsonb_build_object(
            'is_active', i.is_active, 'sort', i.sort,
            'owners', (select count(*) from public.user_inventory inv where inv.item_id = i.id),
            'collection', (select c.code from public.avatar_collections c where c.id = i.collection_id),
            'club_name', (select cl.name from public.clubs cl where cl.id = i.club_id),
            'challenge_title', (select ch.title from public.challenges ch where ch.id = i.required_challenge))
          order by i.is_active desc, i.category, i.sort, i.name), '[]'::jsonb)
            from public.avatar_items i where i.code is not null);
end $$;

create or replace function public.admin_list_avatar_collections() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object('items', (select count(*) from public.avatar_items i where i.collection_id = c.id))
            order by c.is_active desc, c.sort, c.name), '[]'::jsonb) from public.avatar_collections c);
end $$;

create or replace function public.admin_save_avatar_collection(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  v_code text := lower(trim(coalesce(p->>'code', '')));
  r public.avatar_collections;
begin
  if v_code !~ '^[a-z0-9_]{3,40}$' then raise exception 'INVALID_CODE'; end if;
  if char_length(trim(coalesce(p->>'name', ''))) < 2 then raise exception 'INVALID_NAME'; end if;
  if coalesce(p->>'kind', 'SEASON') not in ('CORE', 'LEVEL', 'SEASON', 'EVENT', 'CLUB', 'SPONSOR') then raise exception 'INVALID_KIND'; end if;
  if nullif(p->>'starts_at', '') is not null and nullif(p->>'ends_at', '') is not null
     and (p->>'ends_at')::timestamptz <= (p->>'starts_at')::timestamptz then raise exception 'INVALID_TIME_RANGE'; end if;
  insert into public.avatar_collections as t (code, name, description, kind, starts_at, ends_at, sort, is_active)
  values (v_code, left(trim(p->>'name'), 60), nullif(left(trim(coalesce(p->>'description', '')), 200), ''), coalesce(p->>'kind', 'SEASON'),
          nullif(p->>'starts_at', '')::timestamptz, nullif(p->>'ends_at', '')::timestamptz, coalesce((p->>'sort')::int, 100),
          coalesce((p->>'is_active')::boolean, true))
  on conflict (code) do update set name = excluded.name, description = excluded.description, kind = excluded.kind,
    starts_at = excluded.starts_at, ends_at = excluded.ends_at, sort = excluded.sort, is_active = excluded.is_active
  returning * into r;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_admin, 'AVATAR_COLLECTION', 'avatar_collection:' || v_code, to_jsonb(r));
  return to_jsonb(r);
end $$;

-- ---------------------------------------------------------------------
-- 6. Đồng phục CLB: ban quản trị CLB gửi yêu cầu → admin duyệt (đặt giá) → vật phẩm chỉ thành viên CLB mua / mặc
-- ---------------------------------------------------------------------
create table if not exists public.club_uniform_requests (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  name text not null check (char_length(name) between 2 and 60),
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  print jsonb not null,
  note text check (note is null or char_length(note) <= 500),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  review_note text check (review_note is null or char_length(review_note) <= 300),
  item_code text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null
);
create index if not exists club_uniform_requests_idx on public.club_uniform_requests (status, created_at desc);
alter table public.club_uniform_requests enable row level security;
revoke all on public.club_uniform_requests from anon, authenticated;

-- Kho logo đồng phục: uniform-media/<club_id>/<file> — ban quản trị CLB tải lên
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('uniform-media', 'uniform-media', true, 2097152, array['image/png', 'image/webp', 'image/jpeg'])
on conflict (id) do nothing;
drop policy if exists uniform_media_insert on storage.objects;
create policy uniform_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'uniform-media' and (public.is_system_admin() or exists (
    select 1 from public.club_members m where m.club_id::text = (storage.foldername(name))[1]
      and m.user_id = auth.uid() and m.status = 'APPROVED' and m.role in ('OWNER', 'CAPTAIN'))));

create or replace function private.uniform_request_json(r public.club_uniform_requests) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(r) || jsonb_build_object('club_name', (select c.name from public.clubs c where c.id = r.club_id),
    'requested_by_name', private.display_name(r.requested_by),
    'item', (select private.item_json(i) || jsonb_build_object('owners', (select count(*) from public.user_inventory v where v.item_id = i.id))
               from public.avatar_items i where i.code = r.item_code))
$$;

create or replace function public.request_club_uniform(p_club_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_print jsonb := private.clean_print(p->'print');
  r public.club_uniform_requests;
begin
  if not public.club_is_staff(p_club_id) then raise exception 'FORBIDDEN'; end if;
  if char_length(trim(coalesce(p->>'name', ''))) < 2 then raise exception 'INVALID_NAME'; end if;
  if coalesce(p->>'color', '') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_COLOR'; end if;
  if v_print is null then raise exception 'INVALID_PRINT'; end if;
  if v_print->>'logo_url' is not null and v_print->>'logo_url' !~ ('/storage/v1/object/public/uniform-media/' || p_club_id::text || '/') then
    raise exception 'INVALID_PRINT';
  end if;
  if (select count(*) from public.club_uniform_requests x where x.club_id = p_club_id and x.status = 'PENDING') >= 3 then
    raise exception 'TOO_MANY_REQUESTS';
  end if;
  insert into public.club_uniform_requests (club_id, requested_by, name, color, print, note)
  values (p_club_id, v_uid, left(trim(p->>'name'), 60), p->>'color', v_print, nullif(left(trim(coalesce(p->>'note', '')), 500), ''))
  returning * into r;
  return private.uniform_request_json(r);
end $$;

create or replace function public.club_uniforms(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.club_is_staff(p_club_id) and not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(private.uniform_request_json(r) order by r.created_at desc), '[]'::jsonb)
            from public.club_uniform_requests r where r.club_id = p_club_id);
end $$;

create or replace function public.cancel_club_uniform_request(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.club_uniform_requests := (select x from public.club_uniform_requests x where x.id = p_id);
begin
  perform private.require_uid();
  if r.id is null or not public.club_is_staff(r.club_id) then raise exception 'FORBIDDEN'; end if;
  if r.status <> 'PENDING' then raise exception 'REQUEST_CLOSED'; end if;
  update public.club_uniform_requests set status = 'CANCELLED' where id = p_id;
end $$;

create or replace function public.admin_list_uniform_requests(p_status text default 'PENDING') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(private.uniform_request_json(r) order by r.created_at desc), '[]'::jsonb)
            from public.club_uniform_requests r where upper(coalesce(p_status, 'ALL')) = 'ALL' or r.status = upper(p_status));
end $$;

-- APPROVE: p = {price_xu, rarity, name?, code?, collection?, status?} → tạo vật phẩm áo TINT + vùng in, chỉ thành viên CLB
create or replace function public.admin_review_uniform_request(p_id uuid, p_action text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  r public.club_uniform_requests := (select x from public.club_uniform_requests x where x.id = p_id);
  v_code text;
  m record;
begin
  if r.id is null then raise exception 'REQUEST_NOT_FOUND'; end if;
  if r.status <> 'PENDING' then raise exception 'REQUEST_CLOSED'; end if;
  if upper(coalesce(p_action, '')) = 'REJECT' then
    if char_length(trim(coalesce(p->>'note', ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
    update public.club_uniform_requests set status = 'REJECTED', review_note = left(trim(p->>'note'), 300), reviewed_at = now(), reviewed_by = v_admin
     where id = r.id returning * into r;
    if r.requested_by is not null then
      perform private.notify(r.requested_by, r.club_id, 'CLUB_UNIFORM', 'Đồng phục "' || r.name || '" cần chỉnh sửa', r.review_note,
        '/clubs/' || r.club_id || '/settings', v_admin, true);
    end if;
    return private.uniform_request_json(r);
  end if;
  if upper(coalesce(p_action, '')) <> 'APPROVE' then raise exception 'INVALID_ACTION'; end if;

  v_code := lower(coalesce(nullif(p->>'code', ''), 'uni_' || substr(replace(r.id::text, '-', ''), 1, 10)));
  perform public.admin_save_avatar_item(jsonb_build_object(
    'code', v_code, 'name', coalesce(nullif(p->>'name', ''), r.name), 'description', 'Đồng phục ' || (select c.name from public.clubs c where c.id = r.club_id),
    'slot', 'top', 'render_kind', 'TINT', 'color', r.color, 'print', r.print, 'club_id', r.club_id,
    'price_xu', coalesce((p->>'price_xu')::numeric, 0), 'rarity', coalesce(p->>'rarity', 'rare'),
    'collection', p->>'collection', 'status', coalesce(p->>'status', 'PUBLISHED'), 'sort', 10));
  update public.club_uniform_requests set status = 'APPROVED', item_code = v_code, reviewed_at = now(), reviewed_by = v_admin,
    review_note = nullif(left(trim(coalesce(p->>'note', '')), 300), '')
   where id = r.id returning * into r;
  -- báo cả CLB
  for m in select cm.user_id from public.club_members cm where cm.club_id = r.club_id and cm.status = 'APPROVED' loop
    perform private.notify(m.user_id, r.club_id, 'CLUB_UNIFORM', 'CLB có đồng phục mới: ' || r.name,
      case when coalesce((p->>'price_xu')::numeric, 0) > 0 then 'Vào Tủ đồ để mặc đồng phục CLB.' else 'Đã có sẵn trong Tủ đồ của bạn.' end,
      '/character', v_admin, false);
  end loop;
  return private.uniform_request_json(r);
end $$;

revoke all on function private.avatar_item_status_sync(), private.is_club_member(uuid, uuid), private.item_lock(uuid, public.avatar_items),
  private.item_wearable(uuid, uuid), private.clean_print(jsonb), private.uniform_request_json(public.club_uniform_requests) from public, anon, authenticated;
revoke all on function public.admin_set_avatar_item_status(text, text), public.admin_list_avatar_collections(), public.admin_save_avatar_collection(jsonb),
  public.request_club_uniform(uuid, jsonb), public.club_uniforms(uuid), public.cancel_club_uniform_request(uuid),
  public.admin_list_uniform_requests(text), public.admin_review_uniform_request(uuid, text, jsonb) from public, anon;
grant execute on function public.admin_set_avatar_item_status(text, text), public.admin_list_avatar_collections(), public.admin_save_avatar_collection(jsonb),
  public.request_club_uniform(uuid, jsonb), public.club_uniforms(uuid), public.cancel_club_uniform_request(uuid),
  public.admin_list_uniform_requests(text), public.admin_review_uniform_request(uuid, text, jsonb) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001005900_outfit_kits.sql
-- ===================================================================
-- 005900: Bộ đồng phục (Kit Studio) — thiết kế CẢ BỘ áo + quần + tất + giày, có họa tiết, cho nhân vật 2D.
-- • Họa tiết theo mặt nạ từng ô (áo: sọc, viền sườn, vai, chéo, ngang, nửa, chuyển màu, chữ V; quần: sọc sườn, viền gấu, chuyển màu;
--   tất: viền cổ, sọc ngang). Chữ / logo vẫn chỉ in trên áo.
-- • avatar_items.kit: mã bộ — các món cùng bộ được "Mặc cả bộ" một chạm trong Tủ đồ.
-- • Yêu cầu đồng phục CLB mang theo màu + họa tiết từng món (parts); admin duyệt → tạo cả bộ (giá từng món như vật phẩm thường).
-- Cần 005800. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

alter table public.avatar_items add column if not exists kit text;
create index if not exists avatar_items_kit_idx on public.avatar_items (kit) where kit is not null;
alter table public.club_uniform_requests add column if not exists parts jsonb;

-- Họa tiết cho phép theo ô
create or replace function private.pattern_kinds(p_slot text) returns text[]
language sql immutable as $$
  select case p_slot
    when 'top' then array['sides', 'shoulders', 'sash', 'hoops', 'stripes', 'half', 'gradient', 'chevron']
    when 'bottom' then array['sides', 'hem', 'gradient']
    when 'socks' then array['band', 'hoops']
    else array[]::text[] end
$$;

-- Thiết kế của một món: {pattern: {kind, color}} + (áo) nội dung in như 005800. null = trơn
create or replace function private.clean_design(p jsonb, p_slot text) returns jsonb
language plpgsql immutable as $$
declare
  v_pat jsonb := case when jsonb_typeof(p->'pattern') = 'object' and coalesce(p->'pattern'->>'kind', 'none') <> 'none' then p->'pattern' end;
  v_base jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return null; end if;
  if v_pat is not null then
    if not ((v_pat->>'kind') = any(private.pattern_kinds(p_slot))) then raise exception 'INVALID_PATTERN'; end if;
    if coalesce(v_pat->>'color', '') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_PATTERN'; end if;
    v_pat := jsonb_build_object('kind', v_pat->>'kind', 'color', lower(v_pat->>'color'));
  end if;
  if p_slot = 'top' then
    v_base := private.clean_print(p - 'pattern');
  elsif nullif(trim(coalesce(p->>'logo_url', '')), '') is not null or nullif(trim(coalesce(p->>'title', '')), '') is not null
        or nullif(trim(coalesce(p->>'subtitle', '')), '') is not null or coalesce(p->>'personal', 'NONE') = 'NAME' then
    raise exception 'PRINT_TOP_ONLY';
  end if;
  if v_pat is null then return v_base; end if;
  return coalesce(v_base, '{}'::jsonb) || jsonb_build_object('pattern', v_pat);
end $$;

create or replace function private.item_json(i public.avatar_items) returns jsonb
language sql immutable as $$
  select jsonb_build_object('code', i.code, 'name', i.name, 'description', i.description, 'slot', i.category, 'rarity', i.rarity,
    'render_kind', i.render_kind, 'layer_urls', i.layer_urls, 'color', i.color, 'price_xu', i.price_xu,
    'unlock_level', i.unlock_level, 'is_default', i.is_default, 'acquire', coalesce(i.metadata->>'acquire', 'xu'),
    'print', i.print, 'status', i.status, 'club_id', i.club_id, 'collection_id', i.collection_id,
    'required_badge', i.required_badge, 'required_challenge', i.required_challenge,
    'available_from', i.available_from, 'available_to', i.available_to, 'supply_limit', i.supply_limit, 'kit', i.kit)
$$;

-- Như 005800 + họa tiết, mã bộ
create or replace function public.admin_save_avatar_item(p_item jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  v_code text := lower(trim(coalesce(p_item->>'code', '')));
  v_name text := trim(coalesce(p_item->>'name', ''));
  v_desc text := nullif(trim(coalesce(p_item->>'description', '')), '');
  v_slot text := p_item->>'slot';
  v_rarity text := coalesce(p_item->>'rarity', 'common');
  v_kind text := coalesce(p_item->>'render_kind', 'TINT');
  v_color text := nullif(p_item->>'color', '');
  v_layers jsonb := case when jsonb_typeof(p_item->'layer_urls') = 'object' then p_item->'layer_urls' end;
  v_price numeric := coalesce((p_item->>'price_xu')::numeric, 0);
  v_level integer := coalesce((p_item->>'unlock_level')::integer, 1);
  v_sort integer := coalesce((p_item->>'sort')::integer, 100);
  v_default boolean := coalesce((p_item->>'is_default')::boolean, false);
  -- tương thích bản cũ: is_active=false (không gửi status) → Gỡ hẳn
  v_status text := upper(coalesce(p_item->>'status', case when (p_item->>'is_active')::boolean is false then 'RETIRED' else 'PUBLISHED' end));
  v_collection uuid := (select c.id from public.avatar_collections c where c.code = nullif(p_item->>'collection', ''));
  v_club uuid := nullif(p_item->>'club_id', '')::uuid;
  v_badge text := nullif(trim(coalesce(p_item->>'required_badge', '')), '');
  v_challenge uuid := nullif(p_item->>'required_challenge', '')::uuid;
  v_from timestamptz := nullif(p_item->>'available_from', '')::timestamptz;
  v_to timestamptz := nullif(p_item->>'available_to', '')::timestamptz;
  v_supply integer := nullif(p_item->>'supply_limit', '')::integer;
  v_print jsonb := private.clean_design(p_item->'print', v_slot);
  v_kit text := nullif(lower(trim(coalesce(p_item->>'kit', ''))), '');
  v_old public.avatar_items;
  k text;
  v_url text;
begin
  if v_code !~ '^[a-z0-9_]{3,48}$' then raise exception 'INVALID_CODE'; end if;
  if char_length(v_name) not between 2 and 60 then raise exception 'INVALID_NAME'; end if;
  if v_desc is not null and char_length(v_desc) > 160 then raise exception 'INVALID_DESCRIPTION'; end if;
  if v_slot is null or not (v_slot = any(private.character_slots())) then raise exception 'INVALID_SLOT'; end if;
  if v_rarity not in ('common', 'rare', 'epic', 'legendary') then raise exception 'INVALID_RARITY'; end if;
  if v_price < 0 or v_price > 100000 then raise exception 'INVALID_PRICE'; end if;
  if v_level not between 1 and 8 then raise exception 'INVALID_LEVEL'; end if;
  if v_status not in ('DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED', 'RETIRED') then raise exception 'INVALID_STATUS'; end if;
  if nullif(p_item->>'collection', '') is not null and v_collection is null then raise exception 'COLLECTION_NOT_FOUND'; end if;
  if v_club is not null and not exists (select 1 from public.clubs c where c.id = v_club) then raise exception 'CLUB_NOT_FOUND'; end if;
  if v_badge is not null and not exists (select 1 from public.achievements a where a.code = v_badge) then raise exception 'BADGE_NOT_FOUND'; end if;
  if v_challenge is not null and not exists (select 1 from public.challenges c where c.id = v_challenge) then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if v_from is not null and v_to is not null and v_to <= v_from then raise exception 'INVALID_TIME_RANGE'; end if;
  if v_supply is not null and v_supply < 1 then raise exception 'INVALID_SUPPLY'; end if;
  if v_kit is not null and v_kit !~ '^[a-z0-9_]{3,48}$' then raise exception 'INVALID_KIT'; end if;
  -- họa tiết theo mặt nạ: chỉ món đổi màu; áo lớp ảnh chỉ in chữ / logo
  if v_print ? 'pattern' and v_kind <> 'TINT' then raise exception 'PATTERN_TINT_ONLY'; end if;

  if v_kind = 'TINT' then
    if not (v_slot = any(private.character_required_slots())) then raise exception 'TINT_SLOT_ONLY'; end if;
    if v_color is not null and v_color !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_COLOR'; end if;
    v_layers := null;
  elsif v_kind = 'LAYER' then
    if v_layers is null or v_layers = '{}'::jsonb then raise exception 'LAYER_REQUIRED'; end if;
    for k in select jsonb_object_keys(v_layers) loop
      if k not in ('male', 'female') then raise exception 'INVALID_LAYER'; end if;
      v_url := v_layers->>k;
      if v_url is null or v_url !~ '^(/character/|https://)[^\s"<>]+\.png(\?[^\s"<>]*)?$' then raise exception 'INVALID_LAYER'; end if;
    end loop;
    v_color := null;
  else
    raise exception 'INVALID_RENDER_KIND';
  end if;

  v_old := (select i from public.avatar_items i where i.code = v_code);
  if v_old.id is not null and v_old.category <> v_slot
     and exists (select 1 from public.user_inventory where item_id = v_old.id) then
    raise exception 'SLOT_LOCKED';
  end if;
  if v_status not in ('PUBLISHED', 'ARCHIVED') and v_code = v_slot || '_original' then raise exception 'ITEM_REQUIRED'; end if;
  -- đã có người sở hữu thì không đưa về Nháp / Chờ duyệt (họ sẽ mất đồ) — dùng Ngừng bán
  if v_old.id is not null and v_status in ('DRAFT', 'REVIEW') and exists (select 1 from public.user_inventory where item_id = v_old.id) then
    raise exception 'ITEM_HAS_OWNERS';
  end if;

  insert into public.avatar_items (code, name, description, category, rarity, asset_url, render_kind, color, layer_urls,
                                   price_xu, unlock_level, sort, is_default, status, collection_id, club_id, required_badge,
                                   required_challenge, available_from, available_to, supply_limit, print, kit)
  values (v_code, v_name, v_desc, v_slot, v_rarity, lower(v_kind), v_kind, v_color, v_layers,
          v_price, v_level, v_sort, v_default, v_status, v_collection, v_club, v_badge, v_challenge, v_from, v_to, v_supply, v_print, v_kit)
  on conflict (code) where code is not null do update set
    name = excluded.name, description = excluded.description, category = excluded.category, rarity = excluded.rarity,
    render_kind = excluded.render_kind, color = excluded.color, layer_urls = excluded.layer_urls,
    price_xu = excluded.price_xu, unlock_level = excluded.unlock_level, sort = excluded.sort, is_default = excluded.is_default,
    status = excluded.status, collection_id = excluded.collection_id, club_id = excluded.club_id, required_badge = excluded.required_badge,
    required_challenge = excluded.required_challenge, available_from = excluded.available_from, available_to = excluded.available_to,
    supply_limit = excluded.supply_limit, print = excluded.print, kit = excluded.kit;

  insert into public.admin_audit_log (actor_id, action, target, old_value, new_value)
  values (v_admin, case when v_old.id is null then 'AVATAR_ITEM_CREATE' else 'AVATAR_ITEM_UPDATE' end, 'avatar_item:' || v_code,
          case when v_old.id is null then null else private.item_json(v_old) end,
          private.item_json((select i from public.avatar_items i where i.code = v_code)));

  return private.item_json((select i from public.avatar_items i where i.code = v_code)) || jsonb_build_object('is_active', v_status in ('PUBLISHED', 'ARCHIVED'));
end $$;

-- Các món khác của bộ: {bottom: {color, print?}, socks: {...}, shoes: {...}} — thiếu món nào thì bộ không có món đó
create or replace function private.clean_parts(p jsonb) returns jsonb
language plpgsql immutable as $$
declare k text; v_out jsonb := '{}'::jsonb; v_part jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return null; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('bottom', 'socks', 'shoes') then raise exception 'INVALID_PARTS'; end if;
    v_part := p->k;
    if v_part is null or jsonb_typeof(v_part) <> 'object' then continue; end if;
    if coalesce(v_part->>'color', '') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_COLOR'; end if;
    v_out := v_out || jsonb_build_object(k, jsonb_build_object('color', lower(v_part->>'color'), 'print', private.clean_design(v_part->'print', k)));
  end loop;
  return nullif(v_out, '{}'::jsonb);
end $$;

create or replace function private.uniform_request_json(r public.club_uniform_requests) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(r) || jsonb_build_object('club_name', (select c.name from public.clubs c where c.id = r.club_id),
    'requested_by_name', private.display_name(r.requested_by),
    'item', (select private.item_json(i) || jsonb_build_object('owners', (select count(*) from public.user_inventory v where v.item_id = i.id))
               from public.avatar_items i where i.code = r.item_code),
    'kit_items', (select coalesce(jsonb_agg(private.item_json(i) order by i.category), '[]'::jsonb)
                    from public.avatar_items i where r.item_code is not null and i.kit = r.item_code and i.code <> r.item_code))
$$;

-- Như 005800 + họa tiết áo + các món khác của bộ
create or replace function public.request_club_uniform(p_club_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_print jsonb := private.clean_design(p->'print', 'top');
  v_parts jsonb := private.clean_parts(p->'parts');
  r public.club_uniform_requests;
begin
  if not public.club_is_staff(p_club_id) then raise exception 'FORBIDDEN'; end if;
  if char_length(trim(coalesce(p->>'name', ''))) < 2 then raise exception 'INVALID_NAME'; end if;
  if coalesce(p->>'color', '') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_COLOR'; end if;
  if v_print is null then raise exception 'INVALID_PRINT'; end if;
  if v_print->>'logo_url' is not null and v_print->>'logo_url' !~ ('/storage/v1/object/public/uniform-media/' || p_club_id::text || '/') then
    raise exception 'INVALID_PRINT';
  end if;
  if (select count(*) from public.club_uniform_requests x where x.club_id = p_club_id and x.status = 'PENDING') >= 3 then
    raise exception 'TOO_MANY_REQUESTS';
  end if;
  insert into public.club_uniform_requests (club_id, requested_by, name, color, print, note, parts)
  values (p_club_id, v_uid, left(trim(p->>'name'), 60), lower(p->>'color'), v_print, nullif(left(trim(coalesce(p->>'note', '')), 500), ''), v_parts)
  returning * into r;
  return private.uniform_request_json(r);
end $$;

-- APPROVE: p = {price_xu (áo), part_prices: {bottom, socks, shoes}, rarity, name?, code?, collection?, status?, note?}
create or replace function public.admin_review_uniform_request(p_id uuid, p_action text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  r public.club_uniform_requests := (select x from public.club_uniform_requests x where x.id = p_id);
  v_code text;
  v_club text;
  v_name text;
  k text;
  m record;
  v_label jsonb := '{"bottom": "Quần", "socks": "Tất", "shoes": "Giày"}'::jsonb;
begin
  if r.id is null then raise exception 'REQUEST_NOT_FOUND'; end if;
  if r.status <> 'PENDING' then raise exception 'REQUEST_CLOSED'; end if;
  if upper(coalesce(p_action, '')) = 'REJECT' then
    if char_length(trim(coalesce(p->>'note', ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
    update public.club_uniform_requests set status = 'REJECTED', review_note = left(trim(p->>'note'), 300), reviewed_at = now(), reviewed_by = v_admin
     where id = r.id returning * into r;
    if r.requested_by is not null then
      perform private.notify(r.requested_by, r.club_id, 'CLUB_UNIFORM', 'Đồng phục "' || r.name || '" cần chỉnh sửa', r.review_note,
        '/clubs/' || r.club_id || '/settings', v_admin, true);
    end if;
    return private.uniform_request_json(r);
  end if;
  if upper(coalesce(p_action, '')) <> 'APPROVE' then raise exception 'INVALID_ACTION'; end if;

  v_code := lower(coalesce(nullif(p->>'code', ''), 'uni_' || substr(replace(r.id::text, '-', ''), 1, 10)));
  v_club := (select c.name from public.clubs c where c.id = r.club_id);
  v_name := coalesce(nullif(p->>'name', ''), r.name);
  perform public.admin_save_avatar_item(jsonb_build_object(
    'code', v_code, 'name', v_name, 'description', 'Đồng phục ' || v_club,
    'slot', 'top', 'render_kind', 'TINT', 'color', r.color, 'print', r.print, 'club_id', r.club_id, 'kit', v_code,
    'price_xu', coalesce((p->>'price_xu')::numeric, 0), 'rarity', coalesce(p->>'rarity', 'rare'),
    'collection', p->>'collection', 'status', coalesce(p->>'status', 'PUBLISHED'), 'sort', 10));
  for k in select jsonb_object_keys(coalesce(r.parts, '{}'::jsonb)) loop
    perform public.admin_save_avatar_item(jsonb_build_object(
      'code', v_code || '_' || k, 'name', left((v_label->>k) || ' ' || v_name, 60), 'description', 'Đồng phục ' || v_club,
      'slot', k, 'render_kind', 'TINT', 'color', r.parts->k->>'color', 'print', r.parts->k->'print', 'club_id', r.club_id, 'kit', v_code,
      'price_xu', coalesce((p->'part_prices'->>k)::numeric, 0), 'rarity', coalesce(p->>'rarity', 'rare'),
      'collection', p->>'collection', 'status', coalesce(p->>'status', 'PUBLISHED'), 'sort', 10));
  end loop;
  update public.club_uniform_requests set status = 'APPROVED', item_code = v_code, reviewed_at = now(), reviewed_by = v_admin,
    review_note = nullif(left(trim(coalesce(p->>'note', '')), 300), '')
   where id = r.id returning * into r;
  for m in select cm.user_id from public.club_members cm where cm.club_id = r.club_id and cm.status = 'APPROVED' loop
    perform private.notify(m.user_id, r.club_id, 'CLUB_UNIFORM', 'CLB có đồng phục mới: ' || r.name,
      'Vào Tủ đồ, bấm "Mặc cả bộ" để mặc đồng phục CLB.', '/character', v_admin, false);
  end loop;
  return private.uniform_request_json(r);
end $$;

revoke all on function private.pattern_kinds(text), private.clean_design(jsonb, text), private.clean_parts(jsonb) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001006000_character_designer.sql
-- ===================================================================
-- 006000: Bộ sưu tập nhân vật + trình thiết kế trang phục chuyên nghiệp.
-- • Nhân vật có nhiều dáng (bộ gốc + thư thái, đang chạy, áo thun…): user_avatar.body; dáng khác giới tự về bộ gốc (client).
-- • Thiết kế món đồ (cột print) mở rộng:
--     layers  — lớp in tự do (chữ / ảnh) đặt theo hộp bao vùng áo / quần: x, y (0..1), w (tỉ lệ bề rộng), xoay, độ mờ,
--               chữ: font, màu, viền, giãn chữ; "{TEN}" = tên gọi của người mặc. Tối đa 12 lớp, chỉ áo và quần.
--     tone    — độ đậm màu (strength 0.2..1) và sáng / tối (light -0.4..0.4) của màu nền món đồ.
--     texture — ảnh vải / ảnh áo thật phủ lên vùng (url, độ mờ, tỉ lệ), giữ nếp vải.
-- Cần 005900. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

alter table public.user_avatar add column if not exists body text;

create or replace function private.character_bodies() returns text[]
language sql immutable as $$
  select array['male', 'female', 'male_relax', 'male_run', 'female_tee', 'female_run']
$$;

create or replace function private.character_look(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'gender', coalesce(a.gender, 'male'),
    'body', a.body,
    'equipped', coalesce((
      select jsonb_object_agg(s.slot, i.code)
        from unnest(private.character_slots()) s(slot)
        join public.avatar_items i on i.is_active and i.id = (to_jsonb(e) ->> (s.slot || '_item_id'))::uuid
    ), '{}'::jsonb),
    'items', coalesce((
      select jsonb_agg(private.item_json(i))
        from public.avatar_items i
       where i.is_active and i.id in (e.top_item_id, e.bottom_item_id, e.socks_item_id, e.shoes_item_id, e.hair_item_id,
         e.hat_item_id, e.glasses_item_id, e.watch_item_id, e.accessory_item_id, e.effect_item_id)
    ), '[]'::jsonb))
    from (select p_user as uid) x
    left join public.user_avatar a on a.user_id = x.uid
    left join public.user_equipment e on e.user_id = x.uid
$$;

-- Như 005800 + chọn dáng nhân vật
create or replace function public.save_character(p_look jsonb, p_equipped jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_gender text := p_look->>'gender';
  v_body text := nullif(p_look->>'body', '');
  k text;
  v_code text;
  v_id uuid;
begin
  perform private.ensure_character(v_uid);
  if v_gender is not null and v_gender not in ('male', 'female') then raise exception 'INVALID_LOOK'; end if;
  if v_body is not null and not (v_body = any(private.character_bodies())) then raise exception 'INVALID_LOOK'; end if;
  update public.user_avatar set gender = coalesce(v_gender, gender),
    body = case when p_look ? 'body' then v_body else body end, updated_at = now() where user_id = v_uid;

  if p_equipped is not null and jsonb_typeof(p_equipped) = 'object' then
    for k in select jsonb_object_keys(p_equipped) loop
      if not (k = any(private.character_slots())) then raise exception 'INVALID_SLOT'; end if;
      v_code := p_equipped->>k;
      if v_code is null then
        if k = any(private.character_required_slots()) then raise exception 'SLOT_REQUIRED'; end if;
        v_id := null;
      else
        v_id := (select i.id from public.avatar_items i
                   join public.user_inventory inv on inv.item_id = i.id and inv.user_id = v_uid
                  where i.code = v_code and i.category = k and i.is_active);
        if v_id is null then raise exception 'ITEM_NOT_OWNED'; end if;
        if not private.item_wearable(v_uid, v_id) then raise exception 'CLUB_ONLY'; end if;
      end if;
      execute format('update public.user_equipment set %I = $1, updated_at = now() where user_id = $2', k || '_item_id') using v_id, v_uid;
    end loop;
  end if;
  return private.character_look(v_uid);
end $$;

create or replace function private.num_in(p jsonb, k text, lo numeric, hi numeric, dflt numeric) returns numeric
language sql immutable as $$
  select greatest(lo, least(hi, coalesce(case when jsonb_typeof(p->k) = 'number' then (p->>k)::numeric end, dflt)))
$$;

-- Ảnh hợp lệ cho thiết kế: trong app (/character/…) hoặc https, định dạng ảnh
create or replace function private.design_url_ok(u text) returns boolean
language sql immutable as $$
  select u ~ '^(/character/|https://)[^\s"<>]+\.(png|webp|jpe?g)(\?[^\s"<>]*)?$'
$$;

-- Thiết kế của một món: như 005900 + layers, tone, texture
create or replace function private.clean_design(p jsonb, p_slot text) returns jsonb
language plpgsql immutable as $$
declare
  v_pat jsonb := case when jsonb_typeof(p->'pattern') = 'object' and coalesce(p->'pattern'->>'kind', 'none') <> 'none' then p->'pattern' end;
  v_base jsonb;
  v_out jsonb;
  v_layers jsonb := '[]'::jsonb;
  l jsonb;
  v_type text;
  v_text text;
  v_n integer := 0;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return null; end if;
  if v_pat is not null then
    if not ((v_pat->>'kind') = any(private.pattern_kinds(p_slot))) then raise exception 'INVALID_PATTERN'; end if;
    if coalesce(v_pat->>'color', '') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_PATTERN'; end if;
    v_pat := jsonb_build_object('kind', v_pat->>'kind', 'color', lower(v_pat->>'color'));
  end if;
  if p_slot = 'top' then
    v_base := private.clean_print(p - 'pattern' - 'layers' - 'tone' - 'texture');
  elsif nullif(trim(coalesce(p->>'logo_url', '')), '') is not null or nullif(trim(coalesce(p->>'title', '')), '') is not null
        or nullif(trim(coalesce(p->>'subtitle', '')), '') is not null or coalesce(p->>'personal', 'NONE') = 'NAME' then
    raise exception 'PRINT_TOP_ONLY';
  end if;
  v_out := coalesce(v_base, '{}'::jsonb);
  if v_pat is not null then v_out := v_out || jsonb_build_object('pattern', v_pat); end if;

  if jsonb_typeof(p->'layers') = 'array' and jsonb_array_length(p->'layers') > 0 then
    if p_slot not in ('top', 'bottom') then raise exception 'PRINT_TOP_ONLY'; end if;
    if jsonb_array_length(p->'layers') > 12 then raise exception 'TOO_MANY_LAYERS'; end if;
    for l in select value from jsonb_array_elements(p->'layers') loop
      v_type := l->>'type';
      if v_type not in ('text', 'image') then raise exception 'INVALID_LAYER'; end if;
      v_n := v_n + 1;
      if v_type = 'text' then
        v_text := left(trim(coalesce(l->>'text', '')), 40);
        if v_text = '' then continue; end if;
        if coalesce(l->>'font', 'athletic') !~ '^[a-z_]{2,20}$' then raise exception 'INVALID_LAYER'; end if;
        if coalesce(l->>'color', '#ffffff') !~ '^#[0-9a-fA-F]{6}$' or coalesce(l->>'stroke', '#000000') !~ '^#[0-9a-fA-F]{6}$' then
          raise exception 'INVALID_LAYER';
        end if;
        v_layers := v_layers || jsonb_build_array(jsonb_build_object('id', left(coalesce(l->>'id', v_n::text), 16), 'type', 'text', 'text', v_text,
          'font', coalesce(l->>'font', 'athletic'), 'color', lower(coalesce(l->>'color', '#ffffff')),
          'stroke', lower(coalesce(l->>'stroke', '#000000')), 'stroke_w', private.num_in(l, 'stroke_w', 0, 0.3, 0),
          'spacing', private.num_in(l, 'spacing', -0.1, 0.8, 0), 'bold', coalesce((l->>'bold')::boolean, true),
          'x', private.num_in(l, 'x', -0.2, 1.2, 0.5), 'y', private.num_in(l, 'y', -0.2, 1.2, 0.5), 'w', private.num_in(l, 'w', 0.02, 1.6, 0.4),
          'rot', private.num_in(l, 'rot', -180, 180, 0), 'opacity', private.num_in(l, 'opacity', 0.05, 1, 1)));
      else
        if not private.design_url_ok(coalesce(l->>'url', '')) then raise exception 'INVALID_LAYER'; end if;
        v_layers := v_layers || jsonb_build_array(jsonb_build_object('id', left(coalesce(l->>'id', v_n::text), 16), 'type', 'image', 'url', l->>'url',
          'x', private.num_in(l, 'x', -0.2, 1.2, 0.5), 'y', private.num_in(l, 'y', -0.2, 1.2, 0.5), 'w', private.num_in(l, 'w', 0.02, 1.6, 0.3),
          'rot', private.num_in(l, 'rot', -180, 180, 0), 'opacity', private.num_in(l, 'opacity', 0.05, 1, 1)));
      end if;
    end loop;
    if jsonb_array_length(v_layers) > 0 then v_out := v_out || jsonb_build_object('layers', v_layers); end if;
  end if;

  if jsonb_typeof(p->'tone') = 'object' then
    v_out := v_out || jsonb_build_object('tone', jsonb_build_object('strength', private.num_in(p->'tone', 'strength', 0.2, 1, 1),
      'light', private.num_in(p->'tone', 'light', -0.4, 0.4, 0)));
  end if;
  if jsonb_typeof(p->'texture') = 'object' then
    if not private.design_url_ok(coalesce(p->'texture'->>'url', '')) then raise exception 'INVALID_TEXTURE'; end if;
    v_out := v_out || jsonb_build_object('texture', jsonb_build_object('url', p->'texture'->>'url',
      'opacity', private.num_in(p->'texture', 'opacity', 0.05, 1, 0.6), 'scale', private.num_in(p->'texture', 'scale', 0.3, 3, 1)));
  end if;
  return nullif(v_out, '{}'::jsonb);
end $$;

-- Đồng phục CLB: ảnh trong thiết kế (lớp ảnh, vải) phải nằm trong kho của chính CLB
create or replace function private.design_urls(p jsonb) returns text[]
language sql immutable as $$
  select array_remove(array[p->>'logo_url', p->'texture'->>'url'] ||
    coalesce((select array_agg(l->>'url') from jsonb_array_elements(case when jsonb_typeof(p->'layers') = 'array' then p->'layers' else '[]'::jsonb end) l
               where l->>'type' = 'image'), array[]::text[]), null)
$$;

create or replace function public.request_club_uniform(p_club_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_print jsonb := private.clean_design(p->'print', 'top');
  v_parts jsonb := private.clean_parts(p->'parts');
  v_url text;
  k text;
  r public.club_uniform_requests;
begin
  if not public.club_is_staff(p_club_id) then raise exception 'FORBIDDEN'; end if;
  if char_length(trim(coalesce(p->>'name', ''))) < 2 then raise exception 'INVALID_NAME'; end if;
  if coalesce(p->>'color', '') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_COLOR'; end if;
  if v_print is null then raise exception 'INVALID_PRINT'; end if;
  foreach v_url in array private.design_urls(v_print) loop
    if v_url !~ ('/storage/v1/object/public/uniform-media/' || p_club_id::text || '/') and v_url !~ '^/character/' then raise exception 'INVALID_PRINT'; end if;
  end loop;
  for k in select jsonb_object_keys(coalesce(v_parts, '{}'::jsonb)) loop
    foreach v_url in array private.design_urls(coalesce(v_parts->k->'print', '{}'::jsonb)) loop
      if v_url !~ ('/storage/v1/object/public/uniform-media/' || p_club_id::text || '/') and v_url !~ '^/character/' then raise exception 'INVALID_PRINT'; end if;
    end loop;
  end loop;
  if (select count(*) from public.club_uniform_requests x where x.club_id = p_club_id and x.status = 'PENDING') >= 3 then
    raise exception 'TOO_MANY_REQUESTS';
  end if;
  insert into public.club_uniform_requests (club_id, requested_by, name, color, print, note, parts)
  values (p_club_id, v_uid, left(trim(p->>'name'), 60), lower(p->>'color'), v_print, nullif(left(trim(coalesce(p->>'note', '')), 500), ''), v_parts)
  returning * into r;
  return private.uniform_request_json(r);
end $$;

revoke all on function private.character_bodies(), private.num_in(jsonb, text, numeric, numeric, numeric), private.design_url_ok(text),
  private.design_urls(jsonb) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001006100_runner_nearby.sql
-- ===================================================================
-- 006100: Runner Nearby (Quanh đây) — V1, xem docs/RUNNER_NEARBY.md.
-- • Mặc định TẮT; bật cần đồng ý riêng (phiên bản đồng ý) + ≥ 3 bài chạy hợp lệ.
-- • Vị trí chỉ lưu Ô LƯỚI ~1 km (làm tròn 0,01°), KHÔNG lưu toạ độ gốc, có hạn (24 giờ / 7 / 30 ngày).
-- • Khoảng cách hiển thị: số km (≥ 1) tính giữa tâm 2 ô + độ lệch cố định cho từng cặp (±0,5 km) → không dò tam giác được;
--   đổi vị trí ≤ 3 lần / 24 giờ, tìm ≤ 60 lần / giờ.
-- • Ai thấy tôi: VERIFIED (mặc định: người cũng đã đủ điều kiện) / SAME_GENDER / CLUBS (chung CLB).
-- • Kết nối 2 chiều (phải chấp nhận), ≤ 15 lời mời / ngày, bị từ chối thì 30 ngày không gửi lại. Chưa có nhắn tin riêng:
--   "Rủ chạy" = mời vào buổi chạy công khai / CLB. Chặn hai chiều, báo cáo (3 người báo cáo → tự ẩn chờ admin).
-- • CLB: điểm tập công khai (ô lưới) + sự kiện CLB công khai (người ngoài đăng ký được).
-- Cần 001500, 005600. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 1. Bảng
-- ---------------------------------------------------------------------
create table if not exists public.runner_discovery_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default false,
  visible_to text not null default 'VERIFIED' check (visible_to in ('VERIFIED', 'SAME_GENDER', 'CLUBS')),
  purposes text[] not null default array['BUDDY']::text[],
  goals text[] not null default '{}'::text[],
  time_slots text[] not null default '{}'::text[],
  share_pace boolean not null default true,
  radius_km integer not null default 10 check (radius_km in (2, 5, 10, 20)),
  bio text check (bio is null or char_length(bio) <= 140),
  consent_version text,
  consent_at timestamptz,
  suspended_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.runner_location_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  cell_lat numeric(6, 2) not null check (cell_lat between -90 and 90),
  cell_lng numeric(6, 2) not null check (cell_lng between -180 and 180),
  source text not null check (source in ('DEVICE', 'AREA')),
  area_label text check (area_label is null or char_length(area_label) <= 60),
  moves integer not null default 0,
  moves_since timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists runner_presence_cell_idx on public.runner_location_presence (cell_lat, cell_lng);

create table if not exists public.runner_connection_requests (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.profiles(id) on delete cascade,
  to_id uuid not null references public.profiles(id) on delete cascade,
  message text check (message is null or char_length(message) <= 140),
  status text not null default 'PENDING' check (status in ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (from_id <> to_id)
);
create unique index if not exists runner_request_pending_uq on public.runner_connection_requests (from_id, to_id) where status = 'PENDING';
create index if not exists runner_request_to_idx on public.runner_connection_requests (to_id, status);

create table if not exists public.runner_connections (
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);
create index if not exists runner_connections_b_idx on public.runner_connections (user_b);

create table if not exists public.user_blocks (
  blocker uuid not null references public.profiles(id) on delete cascade,
  blocked uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked);

create table if not exists public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid not null references public.profiles(id) on delete cascade,
  target uuid not null references public.profiles(id) on delete cascade,
  context text not null default 'NEARBY' check (context in ('NEARBY', 'CONNECTION', 'CLUB', 'OTHER')),
  reason text not null check (reason in ('SPAM', 'HARASSMENT', 'FAKE', 'UNSAFE', 'OTHER')),
  note text check (note is null or char_length(note) <= 500),
  status text not null default 'OPEN' check (status in ('OPEN', 'RESOLVED', 'DISMISSED')),
  resolution text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check (reporter <> target)
);
create index if not exists user_reports_status_idx on public.user_reports (status, created_at desc);

-- Nhật ký lượt tìm (giới hạn tần suất, phát hiện dò vị trí) — giữ 7 ngày
create table if not exists public.runner_nearby_searches (
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists runner_searches_idx on public.runner_nearby_searches (user_id, created_at desc);

-- Mọi đọc / ghi qua RPC
alter table public.runner_discovery_settings enable row level security;
alter table public.runner_location_presence enable row level security;
alter table public.runner_connection_requests enable row level security;
alter table public.runner_connections enable row level security;
alter table public.user_blocks enable row level security;
alter table public.user_reports enable row level security;
alter table public.runner_nearby_searches enable row level security;
revoke all on public.runner_discovery_settings, public.runner_location_presence, public.runner_connection_requests,
  public.runner_connections, public.user_blocks, public.user_reports, public.runner_nearby_searches from anon, authenticated;

-- CLB: điểm tập công khai; sự kiện CLB công khai
alter table public.clubs add column if not exists area_label text;
alter table public.clubs add column if not exists cell_lat numeric(6, 2);
alter table public.clubs add column if not exists cell_lng numeric(6, 2);
alter table public.club_events add column if not exists visibility text not null default 'CLUB';
alter table public.club_events drop constraint if exists club_events_visibility_chk;
alter table public.club_events add constraint club_events_visibility_chk check (visibility in ('CLUB', 'PUBLIC'));

-- ---------------------------------------------------------------------
-- 2. Hàm phụ
-- ---------------------------------------------------------------------
create or replace function private.nearby_consent_version() returns text language sql immutable as $$ select 'nearby-v1' $$;

-- Số bài chạy hợp lệ (điều kiện bật)
create or replace function private.valid_runs(p_user uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.activities a
   where a.user_id = p_user and a.validation_status = 'APPROVED' and coalesce(a.status, '') <> 'DELETED'
$$;

create or replace function private.nearby_eligible(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select private.valid_runs(p_user) >= 3
     and not exists (select 1 from public.profiles p where p.id = p_user and p.banned_at is not null)
$$;

-- Pace điển hình (giây / km): trung vị 28 ngày, bài hợp lệ ≥ 1 km
create or replace function private.typical_pace(p_user uuid) returns integer
language sql stable security definer set search_path = public as $$
  select round(percentile_cont(0.5) within group (order by a.moving_time_s / (a.distance_m / 1000.0)))::int
    from public.activities a
   where a.user_id = p_user and a.validation_status = 'APPROVED' and coalesce(a.status, '') <> 'DELETED'
     and a.distance_m >= 1000 and a.moving_time_s > 0 and a.started_at > now() - interval '28 days'
$$;

create or replace function private.is_blocked(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_blocks b where (b.blocker = p_a and b.blocked = p_b) or (b.blocker = p_b and b.blocked = p_a))
$$;

create or replace function private.are_connected(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.runner_connections c where c.user_a = least(p_a, p_b) and c.user_b = greatest(p_a, p_b))
$$;

create or replace function private.share_club(p_a uuid, p_b uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.club_members m1 join public.club_members m2 on m2.club_id = m1.club_id
   where m1.user_id = p_a and m2.user_id = p_b and m1.status = 'APPROVED' and m2.status = 'APPROVED'
$$;

-- Người xem có được thấy người này theo "ai thấy tôi" không
create or replace function private.nearby_visible(p_viewer uuid, p_target uuid, p_mode text) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_mode
    when 'SAME_GENDER' then exists (select 1 from public.profiles a join public.profiles b on b.id = p_target
                                     where a.id = p_viewer and a.gender is not null and a.gender = b.gender)
    when 'CLUBS' then private.share_club(p_viewer, p_target) > 0
    else true end
$$;

-- Khoảng cách (km) giữa tâm 2 ô lưới
create or replace function private.cell_km(a_lat numeric, a_lng numeric, b_lat numeric, b_lng numeric) returns numeric
language sql immutable as $$
  select 6371 * 2 * asin(sqrt(power(sin(radians((b_lat - a_lat)::float8) / 2), 2)
    + cos(radians(a_lat::float8)) * cos(radians(b_lat::float8)) * power(sin(radians((b_lng - a_lng)::float8) / 2), 2)))::numeric
$$;

-- Km hiển thị: làm tròn 1 km, cộng độ lệch cố định theo cặp (±0,5) → cùng một người luôn thấy cùng một số, không dò được
create or replace function private.shown_km(p_km numeric, p_a uuid, p_b uuid) returns integer
language sql immutable as $$
  select greatest(1, round(p_km + ((abs(hashtext(least(p_a, p_b)::text || greatest(p_a, p_b)::text)) % 100) / 100.0 - 0.5))::int)
$$;

create or replace function private.first_name(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  -- tên gọi + chữ cái đầu họ: "Nguyễn Văn An" → "An N."
  select case when n is null or n = '' then 'Runner'
              when position(' ' in n) = 0 then n
              else regexp_replace(n, '^.*\s', '') || ' ' || left(n, 1) || '.' end
    from (select trim(coalesce((select display_name from public.profiles where id = p_user), '')) as n) x
$$;

-- ---------------------------------------------------------------------
-- 3. Cài đặt + vị trí của tôi
-- ---------------------------------------------------------------------
create or replace function public.my_discovery() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  s public.runner_discovery_settings := (select x from public.runner_discovery_settings x where x.user_id = v_uid);
  p public.runner_location_presence := (select x from public.runner_location_presence x where x.user_id = v_uid);
begin
  return jsonb_build_object(
    'enabled', coalesce(s.enabled, false) and s.suspended_at is null,
    'suspended', s.suspended_at is not null,
    'visible_to', coalesce(s.visible_to, 'VERIFIED'), 'purposes', coalesce(to_jsonb(s.purposes), '["BUDDY"]'::jsonb),
    'goals', coalesce(to_jsonb(s.goals), '[]'::jsonb), 'time_slots', coalesce(to_jsonb(s.time_slots), '[]'::jsonb),
    'share_pace', coalesce(s.share_pace, true), 'radius_km', coalesce(s.radius_km, 10), 'bio', s.bio,
    'consented', s.consent_version = private.nearby_consent_version(),
    'valid_runs', private.valid_runs(v_uid), 'eligible', private.nearby_eligible(v_uid),
    'pace_s', private.typical_pace(v_uid),
    'presence', case when p.user_id is not null and p.expires_at > now() then jsonb_build_object(
      'source', p.source, 'area_label', p.area_label, 'updated_at', p.updated_at, 'expires_at', p.expires_at,
      'moves_left', greatest(0, 3 - case when p.moves_since > now() - interval '24 hours' then p.moves else 0 end)) end,
    'incoming', (select count(*) from public.runner_connection_requests r where r.to_id = v_uid and r.status = 'PENDING'),
    'connections', (select count(*) from public.runner_connections c where c.user_a = v_uid or c.user_b = v_uid));
end $$;

-- p: {enabled, consent, visible_to, purposes[], goals[], time_slots[], share_pace, radius_km, bio}
create or replace function public.set_discovery(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  s public.runner_discovery_settings := (select x from public.runner_discovery_settings x where x.user_id = v_uid);
  v_enabled boolean := coalesce((p->>'enabled')::boolean, s.enabled, false);
  v_vis text := coalesce(p->>'visible_to', s.visible_to, 'VERIFIED');
  v_radius integer := coalesce((p->>'radius_km')::int, s.radius_km, 10);
  v_purposes text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(p->'purposes') = 'array' then p->'purposes' end) x), s.purposes, array['BUDDY']);
  v_goals text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(p->'goals') = 'array' then p->'goals' end) x), s.goals, '{}');
  v_slots text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(p->'time_slots') = 'array' then p->'time_slots' end) x), s.time_slots, '{}');
  v_consent text := case when coalesce((p->>'consent')::boolean, false) then private.nearby_consent_version() else s.consent_version end;
begin
  if v_vis not in ('VERIFIED', 'SAME_GENDER', 'CLUBS') then raise exception 'INVALID_SETTINGS'; end if;
  if v_radius not in (2, 5, 10, 20) then raise exception 'INVALID_SETTINGS'; end if;
  if not (v_purposes <@ array['BUDDY', 'CLUB', 'COACH']) or not (v_goals <@ array['5K', '10K', 'HM', 'FM', 'TRAIL'])
     or not (v_slots <@ array['EARLY', 'MORNING', 'NOON', 'EVENING', 'WEEKEND']) then raise exception 'INVALID_SETTINGS'; end if;
  if v_enabled then
    if coalesce(v_consent, '') <> private.nearby_consent_version() then raise exception 'CONSENT_REQUIRED'; end if;
    if not private.nearby_eligible(v_uid) then raise exception 'NOT_ELIGIBLE'; end if;
    if s.suspended_at is not null then raise exception 'NEARBY_SUSPENDED'; end if;
  end if;
  insert into public.runner_discovery_settings as t (user_id, enabled, visible_to, purposes, goals, time_slots, share_pace, radius_km, bio,
                                                     consent_version, consent_at, updated_at)
  values (v_uid, v_enabled, v_vis, v_purposes, v_goals, v_slots, coalesce((p->>'share_pace')::boolean, s.share_pace, true), v_radius,
          case when p ? 'bio' then nullif(left(trim(coalesce(p->>'bio', '')), 140), '') else s.bio end,
          v_consent, case when v_consent is distinct from s.consent_version then now() else s.consent_at end, now())
  on conflict (user_id) do update set enabled = excluded.enabled, visible_to = excluded.visible_to, purposes = excluded.purposes,
    goals = excluded.goals, time_slots = excluded.time_slots, share_pace = excluded.share_pace, radius_km = excluded.radius_km,
    bio = excluded.bio, consent_version = excluded.consent_version, consent_at = excluded.consent_at, updated_at = now();
  -- Tắt = xoá vị trí ngay
  if not v_enabled then delete from public.runner_location_presence where user_id = v_uid; end if;
  return public.my_discovery();
end $$;

-- Công bố vị trí gần đúng: làm tròn về ô ~1 km trước khi lưu; đổi ô tối đa 3 lần / 24 giờ
create or replace function public.set_presence(p_lat double precision, p_lng double precision, p_source text, p_area text default null, p_hours integer default 168)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  s public.runner_discovery_settings := (select x from public.runner_discovery_settings x where x.user_id = v_uid);
  p public.runner_location_presence := (select x from public.runner_location_presence x where x.user_id = v_uid);
  v_lat numeric(6, 2) := round(p_lat::numeric, 2);
  v_lng numeric(6, 2) := round(p_lng::numeric, 2);
  v_moves integer;
begin
  if not coalesce(s.enabled, false) or s.suspended_at is not null then raise exception 'NEARBY_DISABLED'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'INVALID_LOCATION'; end if;
  if p_source not in ('DEVICE', 'AREA') then raise exception 'INVALID_LOCATION'; end if;
  if p_hours not in (24, 168, 720) then raise exception 'INVALID_LOCATION'; end if;
  v_moves := case when p.user_id is null then 0 when p.moves_since > now() - interval '24 hours' then p.moves else 0 end;
  if p.user_id is not null and (p.cell_lat <> v_lat or p.cell_lng <> v_lng) then
    if v_moves >= 3 then raise exception 'TOO_MANY_MOVES'; end if;
    v_moves := v_moves + 1;
  end if;
  insert into public.runner_location_presence as t (user_id, cell_lat, cell_lng, source, area_label, moves, moves_since, updated_at, expires_at)
  values (v_uid, v_lat, v_lng, p_source, nullif(left(trim(coalesce(p_area, '')), 60), ''), v_moves,
          case when p.user_id is null or p.moves_since <= now() - interval '24 hours' then now() else p.moves_since end,
          now(), now() + make_interval(hours => p_hours))
  on conflict (user_id) do update set cell_lat = excluded.cell_lat, cell_lng = excluded.cell_lng, source = excluded.source,
    area_label = excluded.area_label, moves = excluded.moves, moves_since = excluded.moves_since, updated_at = now(), expires_at = excluded.expires_at;
  return public.my_discovery();
end $$;

create or replace function public.clear_presence() returns void
language sql security definer set search_path = public as $$
  delete from public.runner_location_presence where user_id = private.require_uid()
$$;

-- ---------------------------------------------------------------------
-- 4. Tìm runner phù hợp
-- ---------------------------------------------------------------------
-- p: {radius_km, pace: ALL|FAST|MID|EASY|UNKNOWN, purpose, goal, slot, offset}
create or replace function public.nearby_runners(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  s public.runner_discovery_settings := (select x from public.runner_discovery_settings x where x.user_id = v_uid);
  me public.runner_location_presence := (select x from public.runner_location_presence x where x.user_id = v_uid and x.expires_at > now());
  v_radius integer := coalesce((p->>'radius_km')::int, s.radius_km, 10);
  v_pace text := upper(coalesce(p->>'pace', 'ALL'));
  v_purpose text := nullif(nullif(upper(coalesce(p->>'purpose', '')), ''), 'ALL');
  v_goal text := nullif(nullif(upper(coalesce(p->>'goal', '')), ''), 'ALL');
  v_slot text := nullif(nullif(upper(coalesce(p->>'slot', '')), ''), 'ALL');
  v_offset integer := greatest(0, coalesce((p->>'offset')::int, 0));
  v_my_pace integer := private.typical_pace(v_uid);
  v_dlat numeric;
  v_dlng numeric;
begin
  if not coalesce(s.enabled, false) or s.suspended_at is not null then raise exception 'NEARBY_DISABLED'; end if;
  if me.user_id is null then raise exception 'NO_PRESENCE'; end if;
  if v_radius not in (2, 5, 10, 20) then v_radius := 10; end if;
  if (select count(*) from public.runner_nearby_searches x where x.user_id = v_uid and x.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'TOO_MANY_SEARCHES';
  end if;
  insert into public.runner_nearby_searches (user_id) values (v_uid);
  delete from public.runner_nearby_searches where created_at < now() - interval '7 days';
  delete from public.runner_location_presence where expires_at < now() - interval '1 day';
  v_dlat := v_radius / 111.0 + 0.01;
  v_dlng := v_radius / (111.0 * greatest(cos(radians(me.cell_lat::float8)), 0.2)) + 0.01;

  return (
    with cand as (
      select o.user_id as id, ds, o, private.cell_km(me.cell_lat, me.cell_lng, o.cell_lat, o.cell_lng) as km,
             case when ds.share_pace then private.typical_pace(o.user_id) end as pace
        from public.runner_location_presence o
        join public.runner_discovery_settings ds on ds.user_id = o.user_id
       where o.user_id <> v_uid and o.expires_at > now() and ds.enabled and ds.suspended_at is null
         and o.cell_lat between me.cell_lat - v_dlat and me.cell_lat + v_dlat
         and o.cell_lng between me.cell_lng - v_dlng and me.cell_lng + v_dlng
         and not private.is_blocked(v_uid, o.user_id)
         and private.nearby_visible(v_uid, o.user_id, ds.visible_to)      -- họ cho mình thấy
         and private.nearby_visible(o.user_id, v_uid, s.visible_to)       -- mình cho họ thấy (công bằng 2 chiều)
         and private.nearby_eligible(o.user_id)
    ), f as (
      select c.*,
        private.share_club(v_uid, c.id) as clubs,
        (select count(*) from public.runner_connections a join public.runner_connections b
            on (b.user_a = case when a.user_a = v_uid then a.user_b else a.user_a end or b.user_b = case when a.user_a = v_uid then a.user_b else a.user_a end)
           where (a.user_a = v_uid or a.user_b = v_uid) and (b.user_a = c.id or b.user_b = c.id)) as mutual
        from cand c
       where c.km <= v_radius
         and (v_pace = 'ALL' or (v_pace = 'UNKNOWN' and c.pace is null)
              or (v_pace = 'FAST' and c.pace < 330) or (v_pace = 'MID' and c.pace between 330 and 420) or (v_pace = 'EASY' and c.pace > 420))
         and (v_purpose is null or v_purpose = any((c.ds).purposes))
         and (v_goal is null or v_goal = any((c.ds).goals))
         and (v_slot is null or v_slot = any((c.ds).time_slots))
    ), sc as (
      select f.*,
        -- pace 30 · khung giờ 20 · mục tiêu 15 · mục đích 10 · cộng đồng 15 · khoảng cách 10
        (case when f.pace is null or v_my_pace is null then 12 else greatest(0, 30 - greatest(0, abs(f.pace - v_my_pace) - 20) * 30 / 70.0) end
         + least(20, 10 * cardinality(array(select unnest((f.ds).time_slots) intersect select unnest(s.time_slots))))
         + least(15, 8 * cardinality(array(select unnest((f.ds).goals) intersect select unnest(s.goals))))
         + case when 'BUDDY' = any((f.ds).purposes) and 'BUDDY' = any(s.purposes) then 10 else 3 end
         + least(15, 10 * least(f.clubs, 1) + 3 * f.mutual)
         + case when f.km < 2 then 10 when f.km < 5 then 8 when f.km < 10 then 5 else 2 end
         + (abs(hashtext(f.id::text || current_date::text)) % 5)) as score
        from f
    )
    select jsonb_build_object('items', coalesce(jsonb_agg(y.x order by y.rn), '[]'::jsonb),
      'total', (select count(*) from sc), 'nearby_total', (select count(*) from cand))
      from (
        select row_number() over (order by sc.score desc, sc.id) as rn, jsonb_build_object(
          'id', sc.id, 'name', private.first_name(sc.id),
          'avatar_url', (select avatar_url from public.profiles where id = sc.id),
          'level', (select level from public.profiles where id = sc.id),
          'km', private.shown_km(sc.km, v_uid, sc.id), 'area_label', (sc.o).area_label,
          'pace_s', sc.pace, 'goals', to_jsonb((sc.ds).goals), 'time_slots', to_jsonb((sc.ds).time_slots),
          'purposes', to_jsonb((sc.ds).purposes), 'bio', (sc.ds).bio, 'clubs', sc.clubs, 'mutual', sc.mutual,
          'score', round(sc.score), 'connection',
            case when private.are_connected(v_uid, sc.id) then 'CONNECTED'
                 when exists (select 1 from public.runner_connection_requests r where r.from_id = v_uid and r.to_id = sc.id and r.status = 'PENDING') then 'PENDING_OUT'
                 when exists (select 1 from public.runner_connection_requests r where r.from_id = sc.id and r.to_id = v_uid and r.status = 'PENDING') then 'PENDING_IN'
                 else 'NONE' end,
          'reasons', to_jsonb(array_remove(array[
            case when sc.pace is not null and v_my_pace is not null and abs(sc.pace - v_my_pace) <= 30 then 'PACE' end,
            case when (sc.ds).time_slots && s.time_slots then 'SLOT' end,
            case when (sc.ds).goals && s.goals then 'GOAL' end,
            case when sc.clubs > 0 then 'CLUB' end,
            case when sc.mutual > 0 then 'MUTUAL' end], null))) as x
          from sc
      ) y(rn, x)
     where y.rn > v_offset and y.rn <= v_offset + 30
  );
end $$;

-- Buổi chạy công khai của CLB gần tôi (điểm hẹn là nơi công cộng → hiện km với 1 số lẻ)
create or replace function public.nearby_events(p_radius_km integer default 20) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  me public.runner_location_presence := (select x from public.runner_location_presence x where x.user_id = v_uid and x.expires_at > now());
begin
  if me.user_id is null then raise exception 'NO_PRESENCE'; end if;
  return (select coalesce(jsonb_agg(private.event_json(e, v_uid) || jsonb_build_object(
            'club_name', c.name, 'club_avatar', c.avatar_url,
            'km', round(private.cell_km(me.cell_lat, me.cell_lng, e.lat::numeric, e.lng::numeric), 1),
            'is_member', exists (select 1 from public.club_members m where m.club_id = e.club_id and m.user_id = v_uid and m.status = 'APPROVED'))
          order by e.starts_at), '[]'::jsonb)
            from public.club_events e join public.clubs c on c.id = e.club_id
           where e.visibility = 'PUBLIC' and e.status = 'SCHEDULED' and e.lat is not null
             and e.starts_at > now() - interval '1 hour' and e.starts_at < now() + interval '14 days'
             and private.cell_km(me.cell_lat, me.cell_lng, e.lat::numeric, e.lng::numeric) <= least(greatest(p_radius_km, 2), 50));
end $$;

create or replace function public.nearby_clubs(p_radius_km integer default 20) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  me public.runner_location_presence := (select x from public.runner_location_presence x where x.user_id = v_uid and x.expires_at > now());
begin
  if me.user_id is null then raise exception 'NO_PRESENCE'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url, 'accent_color', c.accent_color,
            'member_count', c.member_count, 'area_label', c.area_label, 'join_policy', c.join_policy,
            'km', round(private.cell_km(me.cell_lat, me.cell_lng, c.cell_lat, c.cell_lng)),
            'is_member', exists (select 1 from public.club_members m where m.club_id = c.id and m.user_id = v_uid and m.status = 'APPROVED'),
            'upcoming', (select count(*) from public.club_events e where e.club_id = c.id and e.visibility = 'PUBLIC' and e.status = 'SCHEDULED' and e.starts_at > now()))
          order by private.cell_km(me.cell_lat, me.cell_lng, c.cell_lat, c.cell_lng)), '[]'::jsonb)
            from public.clubs c
           where c.cell_lat is not null
             and private.cell_km(me.cell_lat, me.cell_lng, c.cell_lat, c.cell_lng) <= least(greatest(p_radius_km, 2), 50));
end $$;

-- ---------------------------------------------------------------------
-- 5. Kết nối
-- ---------------------------------------------------------------------
create or replace function public.send_connection(p_to uuid, p_message text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  s public.runner_discovery_settings := (select x from public.runner_discovery_settings x where x.user_id = v_uid);
  t public.runner_discovery_settings := (select x from public.runner_discovery_settings x where x.user_id = p_to);
  v_msg text := nullif(left(trim(coalesce(p_message, '')), 140), '');
  v_in public.runner_connection_requests := (select r from public.runner_connection_requests r where r.from_id = p_to and r.to_id = v_uid and r.status = 'PENDING');
  r public.runner_connection_requests;
begin
  if p_to = v_uid then raise exception 'INVALID_TARGET'; end if;
  if not coalesce(s.enabled, false) or s.suspended_at is not null then raise exception 'NEARBY_DISABLED'; end if;
  if t.user_id is null or not t.enabled or t.suspended_at is not null or not private.nearby_visible(v_uid, p_to, t.visible_to) then
    raise exception 'TARGET_UNAVAILABLE';
  end if;
  if private.is_blocked(v_uid, p_to) then raise exception 'TARGET_UNAVAILABLE'; end if;
  if private.are_connected(v_uid, p_to) then raise exception 'ALREADY_CONNECTED'; end if;
  if v_msg is not null and v_msg ~* '(https?://|www\.|\.com|\.vn|zalo|telegram|t\.me)' then raise exception 'NO_LINKS'; end if;
  -- Họ đã mời mình → chấp nhận luôn
  if v_in.id is not null then return public.respond_connection(v_in.id, 'ACCEPT'); end if;
  if exists (select 1 from public.runner_connection_requests x where x.from_id = v_uid and x.to_id = p_to and x.status = 'PENDING') then
    raise exception 'ALREADY_REQUESTED';
  end if;
  if exists (select 1 from public.runner_connection_requests x where x.from_id = v_uid and x.to_id = p_to and x.status = 'DECLINED'
              and x.responded_at > now() - interval '30 days') then raise exception 'REQUEST_COOLDOWN'; end if;
  if (select count(*) from public.runner_connection_requests x where x.from_id = v_uid and x.created_at > now() - interval '24 hours') >= 15 then
    raise exception 'TOO_MANY_REQUESTS';
  end if;
  insert into public.runner_connection_requests (from_id, to_id, message) values (v_uid, p_to, v_msg) returning * into r;
  perform private.notify(p_to, null, 'RUNNER_CONNECT', private.first_name(v_uid) || ' muốn kết nối chạy cùng bạn',
    coalesce(v_msg, 'Xem lời mời trong Quanh đây.'), '/nearby/connections', v_uid, true);
  return jsonb_build_object('id', r.id, 'status', r.status);
end $$;

create or replace function public.respond_connection(p_id uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  r public.runner_connection_requests := (select x from public.runner_connection_requests x where x.id = p_id);
begin
  if r.id is null or r.to_id <> v_uid then raise exception 'REQUEST_NOT_FOUND'; end if;
  if r.status <> 'PENDING' then raise exception 'REQUEST_CLOSED'; end if;
  if upper(p_action) = 'ACCEPT' then
    if private.is_blocked(r.from_id, r.to_id) then raise exception 'TARGET_UNAVAILABLE'; end if;
    update public.runner_connection_requests set status = 'ACCEPTED', responded_at = now() where id = r.id;
    insert into public.runner_connections (user_a, user_b) values (least(r.from_id, r.to_id), greatest(r.from_id, r.to_id)) on conflict do nothing;
    perform private.notify(r.from_id, null, 'RUNNER_CONNECTED', private.first_name(v_uid) || ' đã chấp nhận kết nối',
      'Rủ nhau một buổi chạy nhé!', '/nearby/connections', v_uid, true);
    return jsonb_build_object('id', r.id, 'status', 'ACCEPTED');
  elsif upper(p_action) = 'DECLINE' then
    update public.runner_connection_requests set status = 'DECLINED', responded_at = now() where id = r.id;
    return jsonb_build_object('id', r.id, 'status', 'DECLINED');
  end if;
  raise exception 'INVALID_ACTION';
end $$;

create or replace function public.cancel_connection_request(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update public.runner_connection_requests set status = 'CANCELLED', responded_at = now()
   where id = p_id and from_id = private.require_uid() and status = 'PENDING'
$$;

create or replace function public.remove_connection(p_user uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.runner_connections where user_a = least(private.require_uid(), p_user) and user_b = greatest(private.require_uid(), p_user)
$$;

create or replace function private.person_json(p_user uuid, p_viewer uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'name', case when private.are_connected(p_user, p_viewer) then p.display_name else private.first_name(p.id) end,
    'avatar_url', p.avatar_url, 'level', p.level,
    'pace_s', case when coalesce((select share_pace from public.runner_discovery_settings where user_id = p.id), false) then private.typical_pace(p.id) end,
    'goals', coalesce((select to_jsonb(goals) from public.runner_discovery_settings where user_id = p.id), '[]'::jsonb),
    'time_slots', coalesce((select to_jsonb(time_slots) from public.runner_discovery_settings where user_id = p.id), '[]'::jsonb),
    'bio', (select bio from public.runner_discovery_settings where user_id = p.id))
    from public.profiles p where p.id = p_user
$$;

create or replace function public.my_connections() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  return jsonb_build_object(
    'connections', (select coalesce(jsonb_agg(private.person_json(case when c.user_a = v_uid then c.user_b else c.user_a end, v_uid)
                       || jsonb_build_object('since', c.created_at) order by c.created_at desc), '[]'::jsonb)
                      from public.runner_connections c where (c.user_a = v_uid or c.user_b = v_uid)
                       and not private.is_blocked(c.user_a, c.user_b)),
    'incoming', (select coalesce(jsonb_agg(private.person_json(r.from_id, v_uid) || jsonb_build_object('request_id', r.id, 'message', r.message, 'at', r.created_at)
                    order by r.created_at desc), '[]'::jsonb)
                   from public.runner_connection_requests r where r.to_id = v_uid and r.status = 'PENDING' and not private.is_blocked(r.from_id, v_uid)),
    'outgoing', (select coalesce(jsonb_agg(private.person_json(r.to_id, v_uid) || jsonb_build_object('request_id', r.id, 'message', r.message, 'at', r.created_at)
                    order by r.created_at desc), '[]'::jsonb)
                   from public.runner_connection_requests r where r.from_id = v_uid and r.status = 'PENDING'),
    'blocked', (select coalesce(jsonb_agg(jsonb_build_object('id', b.blocked, 'name', private.first_name(b.blocked), 'at', b.created_at) order by b.created_at desc), '[]'::jsonb)
                  from public.user_blocks b where b.blocker = v_uid));
end $$;

-- "Rủ chạy": mời người đã kết nối vào buổi chạy công khai / sự kiện CLB mình tham gia, hoặc vào CLB của mình
create or replace function public.invite_to_run(p_user uuid, p_event_id uuid default null, p_club_id uuid default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  e public.club_events;
  v_note text := nullif(left(trim(coalesce(p_note, '')), 140), '');
begin
  if not private.are_connected(v_uid, p_user) or private.is_blocked(v_uid, p_user) then raise exception 'NOT_CONNECTED'; end if;
  if (select count(*) from public.notifications n where n.actor_id = v_uid and n.kind = 'RUNNER_INVITE' and n.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'TOO_MANY_REQUESTS';
  end if;
  if p_event_id is not null then
    e := (select x from public.club_events x where x.id = p_event_id);
    if e.id is null or e.status <> 'SCHEDULED' or e.starts_at < now() then raise exception 'EVENT_NOT_FOUND'; end if;
    if e.visibility <> 'PUBLIC' and not exists (select 1 from public.club_members m where m.club_id = e.club_id and m.user_id = p_user and m.status = 'APPROVED') then
      raise exception 'EVENT_NOT_PUBLIC';
    end if;
    perform private.notify(p_user, e.club_id, 'RUNNER_INVITE', private.first_name(v_uid) || ' rủ bạn chạy: ' || e.title,
      coalesce(v_note, to_char(e.starts_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM') || coalesce(' · ' || e.location_name, '')),
      case when e.visibility = 'PUBLIC' then '/nearby/events/' || e.id else '/clubs/' || e.club_id || '/events/' || e.id end, v_uid, true);
  elsif p_club_id is not null then
    if not exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = v_uid and m.status = 'APPROVED') then raise exception 'FORBIDDEN'; end if;
    perform private.notify(p_user, p_club_id, 'RUNNER_INVITE', private.first_name(v_uid) || ' rủ bạn vào CLB ' || (select name from public.clubs where id = p_club_id),
      v_note, '/clubs/' || p_club_id, v_uid, true);
  else
    raise exception 'INVALID_INVITE';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. Chặn / báo cáo
-- ---------------------------------------------------------------------
create or replace function public.block_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  if p_user = v_uid then raise exception 'INVALID_TARGET'; end if;
  insert into public.user_blocks (blocker, blocked) values (v_uid, p_user) on conflict do nothing;
  delete from public.runner_connections where user_a = least(v_uid, p_user) and user_b = greatest(v_uid, p_user);
  update public.runner_connection_requests set status = 'CANCELLED', responded_at = now()
   where status = 'PENDING' and ((from_id = v_uid and to_id = p_user) or (from_id = p_user and to_id = v_uid));
end $$;

create or replace function public.unblock_user(p_user uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.user_blocks where blocker = private.require_uid() and blocked = p_user
$$;

create or replace function public.report_user(p_user uuid, p_reason text, p_note text default null, p_context text default 'NEARBY') returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  if p_user = v_uid then raise exception 'INVALID_TARGET'; end if;
  if upper(p_reason) not in ('SPAM', 'HARASSMENT', 'FAKE', 'UNSAFE', 'OTHER') then raise exception 'INVALID_REASON'; end if;
  if exists (select 1 from public.user_reports r where r.reporter = v_uid and r.target = p_user and r.status = 'OPEN') then return; end if;
  insert into public.user_reports (reporter, target, context, reason, note)
  values (v_uid, p_user, coalesce(upper(p_context), 'NEARBY'), upper(p_reason), nullif(left(trim(coalesce(p_note, '')), 500), ''));
  -- 3 người khác nhau cùng báo cáo → tự ẩn khỏi Quanh đây chờ admin
  if (select count(distinct r.reporter) from public.user_reports r where r.target = p_user and r.status = 'OPEN') >= 3 then
    update public.runner_discovery_settings set suspended_at = coalesce(suspended_at, now()) where user_id = p_user;
    delete from public.runner_location_presence where user_id = p_user;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 7. CLB: điểm tập, sự kiện công khai, người ngoài đăng ký
-- ---------------------------------------------------------------------
create or replace function public.set_club_location(p_club_id uuid, p_lat double precision, p_lng double precision, p_area text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.club_is_staff(p_club_id) and not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  if p_lat is null then
    update public.clubs set cell_lat = null, cell_lng = null, area_label = null where id = p_club_id;
    return;
  end if;
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'INVALID_LOCATION'; end if;
  update public.clubs set cell_lat = round(p_lat::numeric, 2), cell_lng = round(p_lng::numeric, 2),
    area_label = nullif(left(trim(coalesce(p_area, '')), 60), '') where id = p_club_id;
end $$;

-- Vị trí CLB hiện tại (ban quản trị xem để sửa; người khác chỉ thấy km qua nearby_clubs)
create or replace function public.club_place(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.clubs := (select x from public.clubs x where x.id = p_club_id);
begin
  if c.id is null then raise exception 'CLUB_NOT_FOUND'; end if;
  if not public.club_is_staff(c.id) and not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object('area_label', c.area_label, 'lat', c.cell_lat, 'lng', c.cell_lng);
end $$;

create or replace function public.set_club_event_visibility(p_event_id uuid, p_visibility text) returns void
language plpgsql security definer set search_path = public as $$
declare e public.club_events := (select x from public.club_events x where x.id = p_event_id);
begin
  if e.id is null then raise exception 'EVENT_NOT_FOUND'; end if;
  if not public.club_is_staff(e.club_id) and not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  if upper(p_visibility) not in ('CLUB', 'PUBLIC') then raise exception 'INVALID_VISIBILITY'; end if;
  if upper(p_visibility) = 'PUBLIC' and e.lat is null then raise exception 'EVENT_NEEDS_LOCATION'; end if;
  update public.club_events set visibility = upper(p_visibility) where id = e.id;
end $$;

-- Đăng ký buổi chạy công khai (không cần là thành viên CLB)
create or replace function public.rsvp_public_event(p_event_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  e public.club_events := (select x from public.club_events x where x.id = p_event_id);
begin
  if e.id is null or e.visibility <> 'PUBLIC' then raise exception 'EVENT_NOT_FOUND'; end if;
  if p_status not in ('GOING', 'MAYBE', 'NOT_GOING') then raise exception 'INVALID_STATUS'; end if;
  if e.status = 'CANCELLED' then raise exception 'EVENT_CANCELLED'; end if;
  if now() > e.starts_at + make_interval(mins => e.duration_min) then raise exception 'EVENT_ENDED'; end if;
  if p_status = 'GOING' and e.capacity is not null
     and (select count(*) from public.club_event_rsvps where event_id = e.id and status = 'GOING' and user_id <> v_uid) >= e.capacity then
    raise exception 'EVENT_FULL';
  end if;
  insert into public.club_event_rsvps (event_id, user_id, status) values (e.id, v_uid, p_status)
  on conflict (event_id, user_id) do update set status = excluded.status, updated_at = now();
  return private.event_json(e, v_uid);
end $$;

-- Sự kiện CLB: kèm chế độ công khai
create or replace function private.event_json(e public.club_events, p_uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', e.id, 'club_id', e.club_id, 'title', e.title, 'description', e.description, 'starts_at', e.starts_at,
    'ends_at', e.starts_at + make_interval(mins => e.duration_min), 'duration_min', e.duration_min,
    'location_name', e.location_name, 'lat', e.lat, 'lng', e.lng, 'distance_km', e.distance_km, 'pace_text', e.pace_text,
    'capacity', e.capacity, 'status', e.status, 'visibility', e.visibility, 'cancel_reason', e.cancel_reason,
    'created_by', e.created_by, 'creator_name', (select display_name from public.profiles where id = e.created_by),
    'going_count', (select count(*) from public.club_event_rsvps r where r.event_id = e.id and r.status = 'GOING'),
    'maybe_count', (select count(*) from public.club_event_rsvps r where r.event_id = e.id and r.status = 'MAYBE'),
    'checked_in_count', (select count(*) from public.club_event_rsvps r where r.event_id = e.id and r.checked_in_at is not null),
    'my_status', (select r.status from public.club_event_rsvps r where r.event_id = e.id and r.user_id = p_uid),
    'my_checked_in_at', (select r.checked_in_at from public.club_event_rsvps r where r.event_id = e.id and r.user_id = p_uid))
$$;

-- Chi tiết sự kiện: người ngoài CLB xem được sự kiện CÔNG KHAI (không kèm danh sách người tham gia)
create or replace function public.club_event(p_event_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e public.club_events := (select x from public.club_events x where x.id = p_event_id);
  v_uid uuid := private.require_uid();
  v_member boolean;
begin
  if e.id is null then raise exception 'EVENT_NOT_FOUND'; end if;
  v_member := exists (select 1 from public.club_members m where m.club_id = e.club_id and m.user_id = v_uid and m.status = 'APPROVED');
  if not v_member and e.visibility <> 'PUBLIC' and not public.is_system_admin() then
    perform private.require_member(e.club_id);
  end if;
  return private.event_json(e, v_uid) || jsonb_build_object(
    'is_member', v_member,
    'club_name', (select c.name from public.clubs c where c.id = e.club_id),
    'club_avatar', (select c.avatar_url from public.clubs c where c.id = e.club_id),
    'can_manage', public.club_is_staff(e.club_id),
    'checkin_open', e.status = 'SCHEDULED' and now() between e.starts_at - interval '2 hours'
                                                          and e.starts_at + make_interval(mins => e.duration_min) + interval '2 hours',
    'attendees', case when v_member or public.is_system_admin() then (select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', r.user_id, 'display_name', p.display_name, 'avatar_url', p.avatar_url, 'status', r.status,
        'checked_in_at', r.checked_in_at, 'checkin_method', r.checkin_method)
        order by (r.checked_in_at is null), r.status, p.display_name), '[]'::jsonb)
      from public.club_event_rsvps r join public.profiles p on p.id = r.user_id
     where r.event_id = e.id and r.status <> 'NOT_GOING') else '[]'::jsonb end);
end $$;

-- ---------------------------------------------------------------------
-- 8. Quản trị báo cáo
-- ---------------------------------------------------------------------
create or replace function public.admin_list_reports(p_status text default 'OPEN') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'reporter', r.reporter, 'reporter_name', private.display_name(r.reporter),
            'target', r.target, 'target_name', private.display_name(r.target), 'context', r.context, 'reason', r.reason, 'note', r.note,
            'status', r.status, 'resolution', r.resolution, 'created_at', r.created_at, 'resolved_at', r.resolved_at,
            'target_reports', (select count(distinct x.reporter) from public.user_reports x where x.target = r.target),
            'target_suspended', exists (select 1 from public.runner_discovery_settings s where s.user_id = r.target and s.suspended_at is not null))
          order by r.created_at desc), '[]'::jsonb)
            from public.user_reports r where upper(coalesce(p_status, 'ALL')) = 'ALL' or r.status = upper(p_status));
end $$;

-- p_action: DISMISS (không vi phạm, gỡ ẩn) | SUSPEND (khoá Quanh đây) | BAN (khoá tài khoản — dùng admin_set_user_ban)
create or replace function public.admin_resolve_report(p_id uuid, p_action text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  r public.user_reports := (select x from public.user_reports x where x.id = p_id);
begin
  if r.id is null then raise exception 'REPORT_NOT_FOUND'; end if;
  if upper(p_action) = 'DISMISS' then
    update public.user_reports set status = 'DISMISSED', resolution = coalesce(nullif(trim(p_note), ''), 'Không vi phạm'), resolved_by = v_admin, resolved_at = now()
     where target = r.target and status = 'OPEN';
    update public.runner_discovery_settings set suspended_at = null where user_id = r.target;
  elsif upper(p_action) = 'SUSPEND' then
    update public.user_reports set status = 'RESOLVED', resolution = coalesce(nullif(trim(p_note), ''), 'Khoá Quanh đây'), resolved_by = v_admin, resolved_at = now()
     where target = r.target and status = 'OPEN';
    insert into public.runner_discovery_settings (user_id, enabled, suspended_at) values (r.target, false, now())
    on conflict (user_id) do update set enabled = false, suspended_at = now();
    delete from public.runner_location_presence where user_id = r.target;
  else
    raise exception 'INVALID_ACTION';
  end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_admin, 'USER_REPORT_' || upper(p_action), 'profile:' || r.target, jsonb_build_object('report', r.id, 'note', p_note));
end $$;

-- Việc cần xử lý: + báo cáo người dùng
create or replace function public.admin_inbox() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'orders', (select count(*) from public.orders o where o.status = 'PENDING' and (o.expires_at is null or o.expires_at > now())),
    'reviews', (select count(*) from public.activities a where a.validation_status = 'PENDING' and coalesce(a.status, '') <> 'DELETED'),
    'partners', (select count(*) from public.partners p where p.status = 'PENDING'),
    'cups', (select count(*) from public.club_cups c where c.status = 'PENDING_REVIEW'),
    'reports', (select count(distinct r.target) from public.user_reports r where r.status = 'OPEN'),
    'errors', (select count(distinct e.code) from private.client_errors e where e.last_at > now() - interval '24 hours'),
    'new_users_7d', (select count(*) from public.profiles p where p.created_at > now() - interval '7 days'),
    'active_7d', (select count(distinct a.user_id) from public.activities a where a.started_at > now() - interval '7 days'),
    'banned', (select count(*) from public.profiles p where p.banned_at is not null));
end $$;

-- ---------------------------------------------------------------------
-- 9. Quyền
-- ---------------------------------------------------------------------
revoke all on function private.nearby_consent_version(), private.valid_runs(uuid), private.nearby_eligible(uuid), private.typical_pace(uuid),
  private.is_blocked(uuid, uuid), private.are_connected(uuid, uuid), private.share_club(uuid, uuid), private.nearby_visible(uuid, uuid, text),
  private.cell_km(numeric, numeric, numeric, numeric), private.shown_km(numeric, uuid, uuid), private.first_name(uuid), private.person_json(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.my_discovery(), public.set_discovery(jsonb), public.set_presence(double precision, double precision, text, text, integer),
  public.clear_presence(), public.nearby_runners(jsonb), public.nearby_events(integer), public.nearby_clubs(integer),
  public.send_connection(uuid, text), public.respond_connection(uuid, text), public.cancel_connection_request(uuid), public.remove_connection(uuid),
  public.my_connections(), public.invite_to_run(uuid, uuid, uuid, text), public.block_user(uuid), public.unblock_user(uuid),
  public.report_user(uuid, text, text, text), public.set_club_location(uuid, double precision, double precision, text),
  public.set_club_event_visibility(uuid, text), public.club_place(uuid), public.rsvp_public_event(uuid, text), public.admin_list_reports(text),
  public.admin_resolve_report(uuid, text, text) from public, anon;
grant execute on function public.my_discovery(), public.set_discovery(jsonb), public.set_presence(double precision, double precision, text, text, integer),
  public.clear_presence(), public.nearby_runners(jsonb), public.nearby_events(integer), public.nearby_clubs(integer),
  public.send_connection(uuid, text), public.respond_connection(uuid, text), public.cancel_connection_request(uuid), public.remove_connection(uuid),
  public.my_connections(), public.invite_to_run(uuid, uuid, uuid, text), public.block_user(uuid), public.unblock_user(uuid),
  public.report_user(uuid, text, text, text), public.set_club_location(uuid, double precision, double precision, text),
  public.set_club_event_visibility(uuid, text), public.club_place(uuid), public.rsvp_public_event(uuid, text), public.admin_list_reports(text),
  public.admin_resolve_report(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001006200_knowledge.sql
-- ===================================================================
-- 006200: RaceHub Knowledge — Trung tâm kiến thức & tin tức chạy bộ (docs/KNOWLEDGE.md).
-- • Hai loại nội dung: ARTICLE (kiến thức lâu dài) và NEWS (tin đang diễn ra); 8 chuyên mục.
-- • Vòng đời: DRAFT → REVIEW → SCHEDULED → PUBLISHED → ARCHIVED. Bài sức khoẻ / dinh dưỡng / chấn thương / giáo án
--   phải qua DUYỆT CHUYÊN MÔN (chuyên gia hoặc admin) mới xuất bản được; sửa nội dung sau khi duyệt → duyệt lại.
-- • Người đọc chỉ thấy bài đã xuất bản (và đã tới giờ đăng); mọi thao tác qua RPC, bảng khoá RLS.
-- • Đọc bài KHÔNG cộng Xu / XP (XP chỉ từ km). Hoàn thành chuỗi "Bắt đầu chạy bộ" → huy hiệu (không kèm XP / Xu).
-- • Ban nội dung: EDITOR (duyệt, xuất bản), WRITER (viết nháp, gửi duyệt), EXPERT (duyệt chuyên môn, viết). Admin toàn quyền.
-- Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 1. Bảng
-- ---------------------------------------------------------------------
create table if not exists public.content_categories (
  id text primary key,
  name text not null,
  description text,
  icon text not null default 'BookOpen',
  sort integer not null default 0,
  needs_expert boolean not null default false,     -- bài thuộc chuyên mục này mặc định phải duyệt chuyên môn
  market_kind text check (market_kind is null or market_kind in ('COACH', 'SHOP', 'SERVICE')),
  is_active boolean not null default true
);

create table if not exists public.content_authors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.profiles(id) on delete set null,
  name text not null check (char_length(name) between 2 and 80),
  title text check (title is null or char_length(title) <= 80),
  bio text check (bio is null or char_length(bio) <= 600),
  avatar_url text,
  kind text not null default 'EDITOR' check (kind in ('TEAM', 'EDITOR', 'COACH', 'EXPERT', 'COMMUNITY')),
  partner_id uuid references public.partners(id) on delete set null,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.content_staff (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null check (role in ('EDITOR', 'WRITER', 'EXPERT')),
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.content_series (
  id text primary key,
  title text not null,
  description text,
  badge_code text,
  is_active boolean not null default true
);

create table if not exists public.content_articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 90),
  title text not null check (char_length(title) between 5 and 140),
  summary text check (summary is null or char_length(summary) <= 300),
  body text not null default '' check (char_length(body) <= 60000),
  cover_image_url text,
  category_id text not null references public.content_categories(id),
  author_id uuid references public.content_authors(id) on delete set null,
  content_type text not null default 'ARTICLE' check (content_type in ('ARTICLE', 'NEWS')),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'REVIEW', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED')),
  published_at timestamptz,
  reading_time_minutes integer not null default 1,
  source_url text,                                   -- tin tổng hợp: link bài gốc
  source_name text,
  is_featured boolean not null default false,
  series_id text references public.content_series(id) on delete set null,
  series_order integer,
  ctas jsonb not null default '[]'::jsonb,           -- [{kind, target, label}] dẫn tới tính năng trong app
  needs_expert_review boolean not null default false,
  expert_reviewed_by uuid references public.profiles(id) on delete set null,
  expert_reviewed_at timestamptz,
  expert_note text,
  review_note text,                                  -- ghi chú biên tập / lý do trả về
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  views integer not null default 0,
  reads integer not null default 0,
  saves integer not null default 0,
  shares integer not null default 0,
  cta_clicks integer not null default 0,
  helpful_yes integer not null default 0,
  helpful_no integer not null default 0,
  read_seconds bigint not null default 0
);
create index if not exists content_articles_live_idx on public.content_articles (status, published_at desc);
create index if not exists content_articles_cat_idx on public.content_articles (category_id, published_at desc);

create table if not exists public.content_tags (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null
);
create table if not exists public.content_article_tags (
  article_id uuid not null references public.content_articles(id) on delete cascade,
  tag_id uuid not null references public.content_tags(id) on delete cascade,
  primary key (article_id, tag_id)
);
create table if not exists public.content_sources (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.content_articles(id) on delete cascade,
  title text not null,
  url text,
  publisher text,
  sort integer not null default 0
);
create table if not exists public.content_bookmarks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  article_id uuid not null references public.content_articles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, article_id)
);
create table if not exists public.content_read_history (
  user_id uuid not null references public.profiles(id) on delete cascade,
  article_id uuid not null references public.content_articles(id) on delete cascade,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  progress integer not null default 0 check (progress between 0 and 100),
  seconds integer not null default 0,
  completed_at timestamptz,
  primary key (user_id, article_id)
);
create table if not exists public.content_reviews (
  article_id uuid not null references public.content_articles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  helpful boolean not null,
  comment text check (comment is null or char_length(comment) <= 500),
  created_at timestamptz not null default now(),
  primary key (article_id, user_id)
);
-- Thống kê theo ngày (lượt xem / đọc xong / chia sẻ / bấm hành động) + chống đếm trùng mỗi người mỗi ngày
create table if not exists public.content_daily_stats (
  article_id uuid not null references public.content_articles(id) on delete cascade,
  day date not null,
  views integer not null default 0,
  reads integer not null default 0,
  shares integer not null default 0,
  cta_clicks integer not null default 0,
  primary key (article_id, day)
);
create table if not exists public.content_user_events (
  user_id uuid not null references public.profiles(id) on delete cascade,
  article_id uuid not null references public.content_articles(id) on delete cascade,
  kind text not null,
  day date not null,
  primary key (user_id, article_id, kind, day)
);

alter table public.content_categories enable row level security;
alter table public.content_authors enable row level security;
alter table public.content_staff enable row level security;
alter table public.content_series enable row level security;
alter table public.content_articles enable row level security;
alter table public.content_tags enable row level security;
alter table public.content_article_tags enable row level security;
alter table public.content_sources enable row level security;
alter table public.content_bookmarks enable row level security;
alter table public.content_read_history enable row level security;
alter table public.content_reviews enable row level security;
alter table public.content_daily_stats enable row level security;
alter table public.content_user_events enable row level security;
revoke all on public.content_categories, public.content_authors, public.content_staff, public.content_series, public.content_articles,
  public.content_tags, public.content_article_tags, public.content_sources, public.content_bookmarks, public.content_read_history,
  public.content_reviews, public.content_daily_stats, public.content_user_events from anon, authenticated;

-- Kho ảnh bài viết: content-media/<user_id>/<file> — chỉ ban nội dung / admin tải lên
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('content-media', 'content-media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create or replace function public.can_upload_content_media(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select (storage.foldername(p_name))[1] = auth.uid()::text
     and (public.is_system_admin() or exists (select 1 from public.content_staff s where s.user_id = auth.uid()))
$$;
revoke all on function public.can_upload_content_media(text) from public, anon;
grant execute on function public.can_upload_content_media(text) to authenticated;
drop policy if exists content_media_insert on storage.objects;
create policy content_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'content-media' and public.can_upload_content_media(name));

-- ---------------------------------------------------------------------
-- 2. Dữ liệu gốc: 8 chuyên mục, chuỗi người mới, huy hiệu, tác giả Ban biên tập
-- ---------------------------------------------------------------------
insert into public.content_categories (id, name, description, icon, sort, needs_expert, market_kind) values
  ('BEGINNER', 'Bắt đầu chạy bộ', 'Chọn giày, kỹ thuật cơ bản, cách bắt đầu chạy 5K', 'Sprout', 1, false, null),
  ('TRAINING', 'Giáo án & luyện tập', '5K, 10K, Half Marathon, Marathon; pace, interval, long run', 'ClipboardList', 2, true, 'COACH'),
  ('NUTRITION', 'Dinh dưỡng & phục hồi', 'Gel, nước, điện giải, giấc ngủ, nghỉ ngơi và phục hồi', 'Apple', 3, true, 'SERVICE'),
  ('INJURY', 'Phòng tránh chấn thương', 'Tải lượng tập, dấu hiệu cần nghỉ, khi nào nên gặp chuyên gia', 'HeartPulse', 4, true, 'SERVICE'),
  ('GEAR', 'Thiết bị & trang phục', 'Giày, đồng hồ, áo chạy, phụ kiện và kinh nghiệm lựa chọn', 'Footprints', 5, false, 'SHOP'),
  ('RACES', 'Giải chạy & sự kiện', 'Lịch giải, kinh nghiệm thi đấu, race review và kết quả', 'Medal', 6, false, null),
  ('STORIES', 'Câu chuyện Runner', 'Hành trình PR, hoàn thành FM, câu chuyện CLB và cộng đồng', 'Sparkles', 7, false, null),
  ('APP', 'Hướng dẫn RaceHub', 'XP, Xu, Challenge, Avatar, Market, Club và các tính năng app', 'Smartphone', 8, false, null)
on conflict (id) do update set name = excluded.name, description = excluded.description, icon = excluded.icon, sort = excluded.sort,
  market_kind = excluded.market_kind;

insert into public.achievements (code, title, description, category, tier, icon, rule, xp_reward, xu_reward, sort)
values ('LEARN_STARTER', 'Runner ham học', 'Đọc hết chuỗi bài "Bắt đầu chạy bộ" trong RaceHub Knowledge', 'LEARN', 'BRONZE', 'GraduationCap', null, 0, 0, 80)
on conflict (code) do nothing;

insert into public.content_series (id, title, description, badge_code) values
  ('STARTER', 'Bắt đầu chạy bộ', 'Chuỗi bài cho người mới: từ đôi giày đầu tiên tới 5 km đầu tiên', 'LEARN_STARTER')
on conflict (id) do nothing;

insert into public.content_authors (id, name, title, bio, kind, verified)
values ('00000000-0000-0000-0000-00000000c0a1', 'Ban biên tập RaceHub', 'Đội ngũ RaceHub',
        'Hướng dẫn sử dụng app và tin tức từ đội ngũ RaceHub.', 'TEAM', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 3. Hàm nội bộ
-- ---------------------------------------------------------------------
-- Vai trò nội dung của người gọi: ADMIN / EDITOR / WRITER / EXPERT / null
create or replace function private.content_role(p_uid uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from public.profiles where id = p_uid and (role = 'SYSTEM_ADMIN' or is_admin is true)) then 'ADMIN'
              else (select s.role from public.content_staff s where s.user_id = p_uid) end
$$;

create or replace function private.content_live(a public.content_articles) returns boolean
language sql stable as $$
  select a.status in ('PUBLISHED', 'SCHEDULED') and a.published_at is not null and a.published_at <= now()
$$;

-- ~200 từ / phút (tiếng Việt), tối thiểu 1 phút
create or replace function private.reading_minutes(p_body text) returns integer
language sql immutable as $$
  select greatest(1, round(coalesce(array_length(regexp_split_to_array(trim(coalesce(p_body, '')), '\s+'), 1), 0) / 200.0)::int)
$$;

create or replace function private.slugify(p text) returns text
language sql immutable as $$
  select left(trim(both '-' from regexp_replace(private.search_key(p), '\s+', '-', 'g')), 80)
$$;

-- Thẻ bài (danh sách): kèm trạng thái của người đọc
create or replace function private.content_card(a public.content_articles, p_uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', a.id, 'slug', a.slug, 'title', a.title, 'summary', a.summary, 'cover_image_url', a.cover_image_url,
    'category_id', a.category_id, 'category_name', (select c.name from public.content_categories c where c.id = a.category_id),
    'content_type', a.content_type, 'reading_time_minutes', a.reading_time_minutes, 'published_at', a.published_at,
    'author_name', (select au.name from public.content_authors au where au.id = a.author_id),
    'is_featured', a.is_featured, 'source_name', a.source_name,
    'saved', exists (select 1 from public.content_bookmarks b where b.user_id = p_uid and b.article_id = a.id),
    'progress', coalesce((select h.progress from public.content_read_history h where h.user_id = p_uid and h.article_id = a.id), 0),
    'completed', exists (select 1 from public.content_read_history h where h.user_id = p_uid and h.article_id = a.id and h.completed_at is not null))
$$;

-- Ghi thống kê ngày (đã chống trùng ở nơi gọi)
create or replace function private.content_bump(p_article uuid, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.content_daily_stats (article_id, day, views, reads, shares, cta_clicks)
  values (p_article, (now() at time zone 'Asia/Ho_Chi_Minh')::date,
          (p_kind = 'VIEW')::int, (p_kind = 'READ')::int, (p_kind = 'SHARE')::int, (p_kind = 'CTA')::int)
  on conflict (article_id, day) do update set
    views = content_daily_stats.views + (p_kind = 'VIEW')::int, reads = content_daily_stats.reads + (p_kind = 'READ')::int,
    shares = content_daily_stats.shares + (p_kind = 'SHARE')::int, cta_clicks = content_daily_stats.cta_clicks + (p_kind = 'CTA')::int;
  update public.content_articles set
    views = views + (p_kind = 'VIEW')::int, reads = reads + (p_kind = 'READ')::int,
    shares = shares + (p_kind = 'SHARE')::int, cta_clicks = cta_clicks + (p_kind = 'CTA')::int
   where id = p_article;
end $$;

-- Hành động cuối bài: chỉ các loại đã biết, tối đa 3
create or replace function private.clean_ctas(p jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind', x.kind, 'target', nullif(left(trim(coalesce(x.target, '')), 80), ''),
                                               'label', nullif(left(trim(coalesce(x.label, '')), 40), '')) order by x.n), '[]'::jsonb)
    from (select e->>'kind' as kind, e->>'target' as target, e->>'label' as label, n
            from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) with ordinality t(e, n)) x
   where x.kind in ('GOAL', 'CHALLENGES', 'CHALLENGE', 'RACES', 'RACE', 'MARKET', 'PARTNER', 'CLUBS', 'CLUB', 'NEARBY',
                    'CHARACTER', 'ONBOARDING', 'WALLET', 'ARTICLE', 'LINK')
     and (x.kind <> 'LINK' or coalesce(x.target, '') ~ '^/[^/\\]')
     and x.n <= 3
$$;

-- ---------------------------------------------------------------------
-- 4. Người đọc
-- ---------------------------------------------------------------------
create or replace function public.knowledge_home() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  return jsonb_build_object(
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description, 'icon', c.icon,
                      'count', (select count(*) from public.content_articles a where a.category_id = c.id and private.content_live(a)))
                    order by c.sort), '[]'::jsonb) from public.content_categories c where c.is_active),
    'featured', (select coalesce(jsonb_agg(private.content_card(y.a, v_uid) order by y.rn), '[]'::jsonb) from (
                   select a, row_number() over (order by a.is_featured desc, a.published_at desc) rn
                     from public.content_articles a where private.content_live(a) and a.content_type = 'ARTICLE') y where y.rn <= 4),
    'news', (select coalesce(jsonb_agg(private.content_card(y.a, v_uid) order by y.rn), '[]'::jsonb) from (
               select a, row_number() over (order by a.published_at desc) rn
                 from public.content_articles a where private.content_live(a) and a.content_type = 'NEWS') y where y.rn <= 5),
    'continue', (select coalesce(jsonb_agg(private.content_card(y.a, v_uid) order by y.rn), '[]'::jsonb) from (
                   select a, row_number() over (order by h.last_at desc) rn
                     from public.content_read_history h join public.content_articles a on a.id = h.article_id
                    where h.user_id = v_uid and h.completed_at is null and h.progress between 5 and 89 and private.content_live(a)) y where y.rn <= 3),
    'series', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'description', s.description, 'badge_code', s.badge_code,
                  'total', (select count(*) from public.content_articles a where a.series_id = s.id and private.content_live(a)),
                  'done', (select count(*) from public.content_articles a join public.content_read_history h on h.article_id = a.id
                            where a.series_id = s.id and private.content_live(a) and h.user_id = v_uid and h.completed_at is not null),
                  'next_slug', (select y.slug from (select a.slug, row_number() over (order by a.series_order, a.published_at) rn
                                  from public.content_articles a where a.series_id = s.id and private.content_live(a)
                                   and not exists (select 1 from public.content_read_history h where h.article_id = a.id and h.user_id = v_uid
                                                    and h.completed_at is not null)) y where y.rn = 1))), '[]'::jsonb)
                 from public.content_series s where s.is_active
                  and exists (select 1 from public.content_articles a where a.series_id = s.id and private.content_live(a))),
    'saved_count', (select count(*) from public.content_bookmarks b join public.content_articles a on a.id = b.article_id
                     where b.user_id = v_uid and private.content_live(a)));
end $$;

-- p: {category, type: ARTICLE|NEWS, tag, q, saved: bool, offset}
create or replace function public.knowledge_list(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_cat text := nullif(p->>'category', '');
  v_type text := nullif(upper(coalesce(p->>'type', '')), '');
  v_tag text := nullif(p->>'tag', '');
  v_q text := coalesce(p->>'q', '');
  v_saved boolean := coalesce((p->>'saved')::boolean, false);
  v_offset integer := greatest(0, coalesce((p->>'offset')::int, 0));
begin
  return (
    with f as (
      select a, case when private.search_key(v_q) = '' then 0 else private.search_rank(a.title, v_q) end as rk
        from public.content_articles a
       where private.content_live(a)
         and (v_cat is null or a.category_id = v_cat)
         and (v_type is null or a.content_type = v_type)
         and (v_tag is null or exists (select 1 from public.content_article_tags at join public.content_tags t on t.id = at.tag_id
                                        where at.article_id = a.id and t.slug = v_tag))
         and (not v_saved or exists (select 1 from public.content_bookmarks b where b.user_id = v_uid and b.article_id = a.id))
         and (private.search_key(v_q) = '' or private.search_match(
               private.search_hay(a.title) || ' ' || private.search_key(coalesce(a.summary, '')) || ' '
               || coalesce((select string_agg(private.search_key(t.name), ' ') from public.content_article_tags at
                              join public.content_tags t on t.id = at.tag_id where at.article_id = a.id), '') || ' ', v_q))
    ), r as (
      select f.a, row_number() over (order by f.rk, (f.a).published_at desc) as rn from f
    )
    select jsonb_build_object('total', (select count(*) from f),
      'items', coalesce((select jsonb_agg(private.content_card(r.a, v_uid) order by r.rn) from r
                          where r.rn > v_offset and r.rn <= v_offset + 20), '[]'::jsonb)));
end $$;

-- Mở bài: ghi lượt xem (mỗi người tối đa 1 lượt / ngày). Ban nội dung xem trước được bài chưa đăng.
create or replace function public.knowledge_article(p_slug text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  a public.content_articles := (select x from public.content_articles x where x.slug = p_slug);
  v_live boolean;
  v_role text := private.content_role(v_uid);
begin
  if a.id is null then raise exception 'ARTICLE_NOT_FOUND'; end if;
  v_live := private.content_live(a);
  if not v_live and v_role is null then raise exception 'ARTICLE_NOT_FOUND'; end if;
  if v_live then
    insert into public.content_read_history (user_id, article_id) values (v_uid, a.id)
    on conflict (user_id, article_id) do update set last_at = now();
    insert into public.content_user_events (user_id, article_id, kind, day)
    values (v_uid, a.id, 'VIEW', (now() at time zone 'Asia/Ho_Chi_Minh')::date) on conflict do nothing;
    if found then perform private.content_bump(a.id, 'VIEW'); end if;
  end if;
  return private.content_card(a, v_uid) || jsonb_build_object(
    'body', a.body, 'preview', not v_live, 'status', a.status, 'updated_at', a.updated_at, 'source_url', a.source_url,
    'ctas', a.ctas, 'needs_expert_review', a.needs_expert_review, 'expert_reviewed_at', a.expert_reviewed_at,
    'expert_name', (select private.display_name(a.expert_reviewed_by)),
    'category', (select jsonb_build_object('id', c.id, 'name', c.name, 'icon', c.icon, 'market_kind', c.market_kind)
                   from public.content_categories c where c.id = a.category_id),
    'author', (select jsonb_build_object('id', au.id, 'name', au.name, 'title', au.title, 'bio', au.bio, 'avatar_url', au.avatar_url,
                 'kind', au.kind, 'verified', au.verified, 'partner_id', au.partner_id)
                 from public.content_authors au where au.id = a.author_id),
    'tags', (select coalesce(jsonb_agg(jsonb_build_object('slug', t.slug, 'name', t.name) order by t.name), '[]'::jsonb)
               from public.content_article_tags at join public.content_tags t on t.id = at.tag_id where at.article_id = a.id),
    'sources', (select coalesce(jsonb_agg(jsonb_build_object('title', s.title, 'url', s.url, 'publisher', s.publisher) order by s.sort), '[]'::jsonb)
                  from public.content_sources s where s.article_id = a.id),
    'my_feedback', (select jsonb_build_object('helpful', r.helpful, 'comment', r.comment) from public.content_reviews r
                     where r.article_id = a.id and r.user_id = v_uid),
    'series', case when a.series_id is not null then (
       select jsonb_build_object('id', s.id, 'title', s.title,
         'items', (select coalesce(jsonb_agg(jsonb_build_object('slug', x.slug, 'title', x.title,
                     'completed', exists (select 1 from public.content_read_history h where h.article_id = x.id and h.user_id = v_uid and h.completed_at is not null))
                     order by x.series_order, x.published_at), '[]'::jsonb)
                   from public.content_articles x where x.series_id = s.id and private.content_live(x)))
         from public.content_series s where s.id = a.series_id) end,
    'related', (select coalesce(jsonb_agg(private.content_card(y.x, v_uid) order by y.rn), '[]'::jsonb) from (
                  select x, row_number() over (order by
                           (select count(*) from public.content_article_tags t1 join public.content_article_tags t2 on t2.tag_id = t1.tag_id
                             where t1.article_id = a.id and t2.article_id = x.id) desc,
                           (x.category_id = a.category_id) desc, x.published_at desc) rn
                    from public.content_articles x where x.id <> a.id and private.content_live(x)) y where y.rn <= 4));
end $$;

-- Tiến độ đọc (gọi khi cuộn / rời bài). Đọc xong = cuộn ≥ 90 % và đọc đủ lâu (≥ 30 % thời gian ước tính, tối đa 60 giây).
-- Không cộng Xu / XP. Hoàn thành cả chuỗi → huy hiệu của chuỗi.
create or replace function public.knowledge_progress(p_id uuid, p_progress integer, p_seconds integer default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  a public.content_articles := (select x from public.content_articles x where x.id = p_id);
  h public.content_read_history;
  v_done boolean := false;
  v_badge text;
  v_total integer;
  v_read integer;
begin
  if a.id is null or not private.content_live(a) then raise exception 'ARTICLE_NOT_FOUND'; end if;
  insert into public.content_read_history (user_id, article_id, progress, seconds)
  values (v_uid, a.id, least(100, greatest(0, coalesce(p_progress, 0))), least(600, greatest(0, coalesce(p_seconds, 0))))
  on conflict (user_id, article_id) do update set
    progress = greatest(content_read_history.progress, excluded.progress),
    seconds = least(content_read_history.seconds + excluded.seconds, 36000), last_at = now();
  update public.content_articles set read_seconds = read_seconds + least(600, greatest(0, coalesce(p_seconds, 0))) where id = a.id;
  h := (select x from public.content_read_history x where x.user_id = v_uid and x.article_id = a.id);
  if h.completed_at is null and h.progress >= 90 and h.seconds >= least(60, a.reading_time_minutes * 18) then
    update public.content_read_history set completed_at = now() where user_id = v_uid and article_id = a.id;
    perform private.content_bump(a.id, 'READ');
    v_done := true;
    if a.series_id is not null then
      v_total := (select count(*) from public.content_articles x where x.series_id = a.series_id and private.content_live(x));
      v_read := (select count(*) from public.content_articles x join public.content_read_history r on r.article_id = x.id
                  where x.series_id = a.series_id and private.content_live(x) and r.user_id = v_uid and r.completed_at is not null);
      v_badge := (select s.badge_code from public.content_series s where s.id = a.series_id);
      if v_total > 0 and v_read >= v_total and v_badge is not null
         and not exists (select 1 from public.user_achievements ua join public.achievements ac on ac.id = ua.achievement_id
                          where ua.user_id = v_uid and ac.code = v_badge) then
        insert into public.user_achievements (user_id, achievement_id)
        select v_uid, ac.id from public.achievements ac where ac.code = v_badge;
        perform private.notify(v_uid, null, 'BADGE', 'Huy hiệu mới: ' || coalesce((select title from public.achievements where code = v_badge), v_badge),
          'Bạn đã đọc hết chuỗi "' || (select title from public.content_series where id = a.series_id) || '".', '/learn', null, false);
      else
        v_badge := null;
      end if;
    end if;
  end if;
  return jsonb_build_object('progress', h.progress, 'completed', h.completed_at is not null or v_done, 'just_completed', v_done, 'badge', v_badge);
end $$;

create or replace function public.knowledge_bookmark(p_id uuid, p_on boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  a public.content_articles := (select x from public.content_articles x where x.id = p_id);
begin
  if a.id is null or (p_on and not private.content_live(a)) then raise exception 'ARTICLE_NOT_FOUND'; end if;
  if p_on then
    insert into public.content_bookmarks (user_id, article_id) values (v_uid, a.id) on conflict do nothing;
    if found then update public.content_articles set saves = saves + 1 where id = a.id; end if;
  else
    delete from public.content_bookmarks where user_id = v_uid and article_id = a.id;
    if found then update public.content_articles set saves = greatest(0, saves - 1) where id = a.id; end if;
  end if;
  return p_on;
end $$;

create or replace function public.knowledge_feedback(p_id uuid, p_helpful boolean, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  a public.content_articles := (select x from public.content_articles x where x.id = p_id);
begin
  if a.id is null or not private.content_live(a) then raise exception 'ARTICLE_NOT_FOUND'; end if;
  insert into public.content_reviews (article_id, user_id, helpful, comment)
  values (a.id, v_uid, p_helpful, nullif(left(trim(coalesce(p_comment, '')), 500), ''))
  on conflict (article_id, user_id) do update set helpful = excluded.helpful, comment = coalesce(excluded.comment, content_reviews.comment), created_at = now();
  update public.content_articles set
    helpful_yes = (select count(*) from public.content_reviews r where r.article_id = a.id and r.helpful),
    helpful_no = (select count(*) from public.content_reviews r where r.article_id = a.id and not r.helpful)
   where id = a.id;
end $$;

-- Chia sẻ / bấm hành động cuối bài: đếm tối đa 1 lần / người / ngày / loại
create or replace function public.knowledge_track(p_id uuid, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  a public.content_articles := (select x from public.content_articles x where x.id = p_id);
begin
  if upper(p_kind) not in ('SHARE', 'CTA') then raise exception 'INVALID_KIND'; end if;
  if a.id is null or not private.content_live(a) then return; end if;
  insert into public.content_user_events (user_id, article_id, kind, day)
  values (v_uid, a.id, upper(p_kind), (now() at time zone 'Asia/Ho_Chi_Minh')::date) on conflict do nothing;
  if found then perform private.content_bump(a.id, upper(p_kind)); end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. CMS (ban nội dung + admin)
-- ---------------------------------------------------------------------
create or replace function private.require_content_staff() returns text
language plpgsql stable security definer set search_path = public as $$
declare v_role text := private.content_role(private.require_uid());
begin
  if v_role is null then raise exception 'FORBIDDEN'; end if;
  return v_role;
end $$;

create or replace function public.cms_meta() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_role text := private.require_content_staff();
begin
  return jsonb_build_object('role', v_role,
    'categories', (select coalesce(jsonb_agg(to_jsonb(c) order by c.sort), '[]'::jsonb) from public.content_categories c),
    'authors', (select coalesce(jsonb_agg(to_jsonb(au) || jsonb_build_object('user_name', private.display_name(au.user_id)) order by au.name), '[]'::jsonb)
                  from public.content_authors au),
    'series', (select coalesce(jsonb_agg(to_jsonb(s) order by s.title), '[]'::jsonb) from public.content_series s),
    'tags', (select coalesce(jsonb_agg(jsonb_build_object('slug', t.slug, 'name', t.name) order by t.name), '[]'::jsonb) from public.content_tags t),
    'staff', (select coalesce(jsonb_agg(jsonb_build_object('user_id', s.user_id, 'name', private.display_name(s.user_id), 'role', s.role, 'at', s.created_at)
                 order by s.created_at), '[]'::jsonb) from public.content_staff s),
    'counts', (select jsonb_object_agg(x.status, x.n) from (select a.status, count(*) n from public.content_articles a group by a.status) x));
end $$;

-- p: {status, category, type, q, mine, offset}
create or replace function public.cms_list(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_role text := private.require_content_staff();
  v_status text := nullif(upper(coalesce(p->>'status', '')), 'ALL');
  v_cat text := nullif(p->>'category', '');
  v_type text := nullif(upper(coalesce(p->>'type', '')), '');
  v_q text := coalesce(p->>'q', '');
  v_mine boolean := coalesce((p->>'mine')::boolean, false);
  v_offset integer := greatest(0, coalesce((p->>'offset')::int, 0));
begin
  v_status := nullif(v_status, '');
  return (
    with f as (
      select a from public.content_articles a
       where (v_status is null or a.status = v_status or (v_status = 'EXPERT' and a.needs_expert_review and a.expert_reviewed_at is null
                                                          and a.status in ('REVIEW', 'DRAFT')))
         and (v_cat is null or a.category_id = v_cat) and (v_type is null or a.content_type = v_type)
         and (not v_mine or a.created_by = v_uid)
         and (private.search_key(v_q) = '' or private.search_match(private.search_hay(a.title) || ' ' || a.slug || ' ', v_q))
    ), r as (select f.a, row_number() over (order by (f.a).updated_at desc) rn from f)
    select jsonb_build_object('total', (select count(*) from f),
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', (r.a).id, 'slug', (r.a).slug, 'title', (r.a).title, 'status', (r.a).status,
          'content_type', (r.a).content_type, 'category_id', (r.a).category_id, 'published_at', (r.a).published_at, 'updated_at', (r.a).updated_at,
          'is_featured', (r.a).is_featured, 'cover_image_url', (r.a).cover_image_url,
          'author_name', (select au.name from public.content_authors au where au.id = (r.a).author_id),
          'created_by_name', private.display_name((r.a).created_by), 'mine', (r.a).created_by = v_uid,
          'needs_expert_review', (r.a).needs_expert_review, 'expert_reviewed_at', (r.a).expert_reviewed_at, 'review_note', (r.a).review_note,
          'live', private.content_live(r.a),
          'views', (r.a).views, 'reads', (r.a).reads, 'saves', (r.a).saves, 'cta_clicks', (r.a).cta_clicks,
          'helpful_yes', (r.a).helpful_yes, 'helpful_no', (r.a).helpful_no) order by r.rn)
        from r where r.rn > v_offset and r.rn <= v_offset + 30), '[]'::jsonb)));
end $$;

create or replace function public.cms_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_role text := private.require_content_staff();
  a public.content_articles := (select x from public.content_articles x where x.id = p_id);
begin
  if a.id is null then raise exception 'ARTICLE_NOT_FOUND'; end if;
  return to_jsonb(a) || jsonb_build_object(
    'tags', (select coalesce(jsonb_agg(t.name order by t.name), '[]'::jsonb) from public.content_article_tags at
               join public.content_tags t on t.id = at.tag_id where at.article_id = a.id),
    'sources', (select coalesce(jsonb_agg(jsonb_build_object('title', s.title, 'url', s.url, 'publisher', s.publisher) order by s.sort), '[]'::jsonb)
                  from public.content_sources s where s.article_id = a.id),
    'expert_name', private.display_name(a.expert_reviewed_by), 'created_by_name', private.display_name(a.created_by),
    'feedback', (select coalesce(jsonb_agg(jsonb_build_object('helpful', r.helpful, 'comment', r.comment, 'at', r.created_at) order by r.created_at desc), '[]'::jsonb)
                   from public.content_reviews r where r.article_id = a.id and r.comment is not null));
end $$;

-- Tạo / sửa bài. p: {id?, title, slug?, summary, body, cover_image_url, category_id, content_type, author_id, tags[], sources[],
--                    ctas[], is_featured, series_id, series_order, source_url, source_name, needs_expert_review}
-- WRITER / EXPERT chỉ sửa bài mình tạo khi còn DRAFT / REVIEW. Sửa nội dung sau khi đã duyệt chuyên môn → phải duyệt lại.
create or replace function public.cms_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_role text := private.require_content_staff();
  a public.content_articles := (select x from public.content_articles x where x.id = nullif(p->>'id', '')::uuid);
  v_id uuid;
  v_title text := trim(coalesce(p->>'title', ''));
  v_slug text := nullif(private.slugify(coalesce(nullif(p->>'slug', ''), p->>'title')), '');
  v_body text := coalesce(p->>'body', '');
  v_cat text := coalesce(nullif(p->>'category_id', ''), a.category_id);
  v_expert boolean;
  v_editor boolean := v_role in ('ADMIN', 'EDITOR');
begin
  if nullif(p->>'id', '') is not null and a.id is null then raise exception 'ARTICLE_NOT_FOUND'; end if;
  if a.id is not null and not v_editor and (a.created_by is distinct from v_uid or a.status not in ('DRAFT', 'REVIEW')) then
    raise exception 'FORBIDDEN';
  end if;
  if char_length(v_title) < 5 then raise exception 'TITLE_TOO_SHORT'; end if;
  if v_slug is null then raise exception 'INVALID_SLUG'; end if;
  if not exists (select 1 from public.content_categories c where c.id = v_cat) then raise exception 'INVALID_CATEGORY'; end if;
  if exists (select 1 from public.content_articles x where x.slug = v_slug and x.id is distinct from a.id) then raise exception 'SLUG_TAKEN'; end if;
  if nullif(p->>'cover_image_url', '') is not null and p->>'cover_image_url' !~ '^https://' then raise exception 'INVALID_URL'; end if;
  if nullif(p->>'source_url', '') is not null and p->>'source_url' !~ '^https?://' then raise exception 'INVALID_URL'; end if;
  -- Chuyên mục sức khoẻ / giáo án luôn cần duyệt chuyên môn; chỉ admin tắt được
  v_expert := (select c.needs_expert from public.content_categories c where c.id = v_cat)
              or coalesce((p->>'needs_expert_review')::boolean, a.needs_expert_review, false);
  if v_role = 'ADMIN' and (p ? 'needs_expert_review') then v_expert := (p->>'needs_expert_review')::boolean; end if;

  if a.id is null then
    insert into public.content_articles (slug, title, summary, body, cover_image_url, category_id, author_id, content_type, reading_time_minutes,
      source_url, source_name, is_featured, series_id, series_order, ctas, needs_expert_review, created_by)
    values (v_slug, v_title, nullif(left(trim(coalesce(p->>'summary', '')), 300), ''), v_body, nullif(p->>'cover_image_url', ''), v_cat,
      coalesce(nullif(p->>'author_id', '')::uuid, (select au.id from public.content_authors au where au.user_id = v_uid)),
      case when upper(coalesce(p->>'content_type', '')) = 'NEWS' then 'NEWS' else 'ARTICLE' end, private.reading_minutes(v_body),
      nullif(p->>'source_url', ''), nullif(left(trim(coalesce(p->>'source_name', '')), 80), ''),
      v_editor and coalesce((p->>'is_featured')::boolean, false), nullif(p->>'series_id', ''), nullif(p->>'series_order', '')::int,
      private.clean_ctas(p->'ctas'), v_expert, v_uid)
    returning id into v_id;
  else
    v_id := a.id;
    update public.content_articles set slug = v_slug, title = v_title, summary = nullif(left(trim(coalesce(p->>'summary', '')), 300), ''),
      body = v_body, cover_image_url = nullif(p->>'cover_image_url', ''), category_id = v_cat,
      author_id = case when p ? 'author_id' then nullif(p->>'author_id', '')::uuid else author_id end,
      content_type = case when upper(coalesce(p->>'content_type', '')) = 'NEWS' then 'NEWS' else 'ARTICLE' end,
      reading_time_minutes = private.reading_minutes(v_body),
      source_url = nullif(p->>'source_url', ''), source_name = nullif(left(trim(coalesce(p->>'source_name', '')), 80), ''),
      is_featured = case when v_editor then coalesce((p->>'is_featured')::boolean, is_featured) else is_featured end,
      series_id = nullif(p->>'series_id', ''), series_order = nullif(p->>'series_order', '')::int,
      ctas = private.clean_ctas(p->'ctas'), needs_expert_review = v_expert,
      -- nội dung chuyên môn đổi mà người sửa không phải chuyên gia → duyệt lại
      expert_reviewed_at = case when body is distinct from v_body and v_role not in ('ADMIN', 'EXPERT') then null else expert_reviewed_at end,
      expert_reviewed_by = case when body is distinct from v_body and v_role not in ('ADMIN', 'EXPERT') then null else expert_reviewed_by end,
      updated_at = now()
     where id = v_id;
    -- bài đang đăng mất duyệt chuyên môn → gỡ về chờ duyệt
    update public.content_articles set status = 'REVIEW', review_note = 'Nội dung đã đổi — cần duyệt chuyên môn lại'
     where id = v_id and needs_expert_review and expert_reviewed_at is null and status in ('SCHEDULED', 'PUBLISHED');
  end if;

  -- Tag: tạo mới nếu chưa có
  delete from public.content_article_tags where article_id = v_id;
  insert into public.content_tags (slug, name)
  select distinct private.slugify(t), left(trim(t), 40) from jsonb_array_elements_text(coalesce(p->'tags', '[]'::jsonb)) t
   where private.slugify(t) <> '' on conflict (slug) do nothing;
  insert into public.content_article_tags (article_id, tag_id)
  select distinct v_id, ct.id from jsonb_array_elements_text(coalesce(p->'tags', '[]'::jsonb)) t
    join public.content_tags ct on ct.slug = private.slugify(t)
  on conflict do nothing;
  -- Nguồn tham khảo
  delete from public.content_sources where article_id = v_id;
  insert into public.content_sources (article_id, title, url, publisher, sort)
  select v_id, left(trim(s->>'title'), 200), case when s->>'url' ~ '^https?://' then left(s->>'url', 500) end,
         nullif(left(trim(coalesce(s->>'publisher', '')), 80), ''), n::int
    from jsonb_array_elements(coalesce(p->'sources', '[]'::jsonb)) with ordinality x(s, n)
   where char_length(trim(coalesce(s->>'title', ''))) > 0 and n <= 20;
  return v_id;
end $$;

-- Chuyển trạng thái. WRITER / EXPERT: DRAFT ↔ REVIEW bài của mình. EDITOR / ADMIN: mọi trạng thái.
-- Xuất bản / hẹn giờ cần: có nội dung, (nếu cần) đã duyệt chuyên môn. p_at: giờ đăng (hẹn giờ).
create or replace function public.cms_set_status(p_id uuid, p_status text, p_at timestamptz default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_role text := private.require_content_staff();
  a public.content_articles := (select x from public.content_articles x where x.id = p_id);
  v_status text := upper(coalesce(p_status, ''));
begin
  if a.id is null then raise exception 'ARTICLE_NOT_FOUND'; end if;
  if v_status not in ('DRAFT', 'REVIEW', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED') then raise exception 'INVALID_STATUS'; end if;
  if v_role not in ('ADMIN', 'EDITOR') and (a.created_by is distinct from v_uid or v_status not in ('DRAFT', 'REVIEW')
                                             or a.status not in ('DRAFT', 'REVIEW')) then
    raise exception 'FORBIDDEN';
  end if;
  if v_status in ('SCHEDULED', 'PUBLISHED') then
    if char_length(trim(a.body)) < 50 and a.source_url is null then raise exception 'BODY_TOO_SHORT'; end if;
    if a.needs_expert_review and a.expert_reviewed_at is null then raise exception 'EXPERT_REVIEW_REQUIRED'; end if;
    if v_status = 'SCHEDULED' and (p_at is null or p_at <= now()) then raise exception 'INVALID_SCHEDULE'; end if;
  end if;
  update public.content_articles set status = v_status,
    published_at = case when v_status = 'PUBLISHED' then coalesce(case when a.status = 'PUBLISHED' then a.published_at end, now())
                        when v_status = 'SCHEDULED' then p_at else published_at end,
    review_note = case when p_note is not null then left(p_note, 300) when v_status in ('SCHEDULED', 'PUBLISHED') then null else review_note end,
    updated_at = now()
   where id = a.id;
  -- Trả về người viết khi biên tập viên trả bài
  if v_status = 'DRAFT' and a.status = 'REVIEW' and a.created_by is not null and a.created_by <> v_uid then
    perform private.notify(a.created_by, null, 'CONTENT', 'Bài viết cần chỉnh sửa', '"' || a.title || '": ' || coalesce(p_note, 'Xem ghi chú biên tập'),
      '/learn/studio', v_uid, false);
  end if;
  if v_status = 'PUBLISHED' and a.status <> 'PUBLISHED' and a.created_by is not null and a.created_by <> v_uid then
    perform private.notify(a.created_by, null, 'CONTENT', 'Bài viết đã được đăng', a.title, '/learn/' || a.slug, v_uid, false);
  end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'CONTENT_' || v_status, 'article:' || a.id, jsonb_build_object('title', a.title, 'from', a.status, 'at', p_at, 'note', p_note));
  return jsonb_build_object('status', v_status);
end $$;

-- Duyệt chuyên môn (chuyên gia / admin). Không đạt → trả về nháp kèm ghi chú.
create or replace function public.cms_expert_review(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_role text := private.require_content_staff();
  a public.content_articles := (select x from public.content_articles x where x.id = p_id);
begin
  if v_role not in ('ADMIN', 'EXPERT') then raise exception 'FORBIDDEN'; end if;
  if a.id is null then raise exception 'ARTICLE_NOT_FOUND'; end if;
  if a.created_by = v_uid and v_role <> 'ADMIN' then raise exception 'CANNOT_REVIEW_OWN'; end if;
  if p_approve then
    update public.content_articles set expert_reviewed_by = v_uid, expert_reviewed_at = now(), expert_note = nullif(left(trim(coalesce(p_note, '')), 300), ''),
      updated_at = now() where id = a.id;
  else
    if char_length(trim(coalesce(p_note, ''))) < 5 then raise exception 'NOTE_REQUIRED'; end if;
    update public.content_articles set expert_reviewed_by = null, expert_reviewed_at = null, expert_note = left(trim(p_note), 300),
      status = case when status in ('SCHEDULED', 'PUBLISHED') then 'REVIEW' else 'DRAFT' end,
      review_note = 'Chuyên gia góp ý: ' || left(trim(p_note), 280), updated_at = now() where id = a.id;
    if a.created_by is not null and a.created_by <> v_uid then
      perform private.notify(a.created_by, null, 'CONTENT', 'Chuyên gia góp ý bài viết', '"' || a.title || '": ' || left(trim(p_note), 200), '/learn/studio', v_uid, false);
    end if;
  end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, case when p_approve then 'CONTENT_EXPERT_APPROVE' else 'CONTENT_EXPERT_REJECT' end, 'article:' || a.id, jsonb_build_object('note', p_note));
end $$;

create or replace function public.cms_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_role text := private.require_content_staff();
  a public.content_articles := (select x from public.content_articles x where x.id = p_id);
begin
  if a.id is null then raise exception 'ARTICLE_NOT_FOUND'; end if;
  -- Bài đã từng đăng: chỉ lưu trữ (giữ link, thống kê); nháp chưa đăng: xoá được
  if a.published_at is not null and a.published_at <= now() then raise exception 'ARCHIVE_INSTEAD'; end if;
  if v_role not in ('ADMIN', 'EDITOR') and a.created_by is distinct from v_uid then raise exception 'FORBIDDEN'; end if;
  delete from public.content_articles where id = a.id;
end $$;

-- Tác giả (EDITOR / ADMIN). p: {id?, name, title, bio, avatar_url, kind, user_id, partner_id, verified}
create or replace function public.cms_save_author(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_role text := private.require_content_staff();
  v_id uuid := nullif(p->>'id', '')::uuid;
begin
  if v_role not in ('ADMIN', 'EDITOR') then raise exception 'FORBIDDEN'; end if;
  if char_length(trim(coalesce(p->>'name', ''))) < 2 then raise exception 'NAME_REQUIRED'; end if;
  if nullif(p->>'avatar_url', '') is not null and p->>'avatar_url' !~ '^https://' then raise exception 'INVALID_URL'; end if;
  if v_id is null then
    insert into public.content_authors (name, title, bio, avatar_url, kind, user_id, partner_id, verified)
    values (left(trim(p->>'name'), 80), nullif(left(trim(coalesce(p->>'title', '')), 80), ''), nullif(left(trim(coalesce(p->>'bio', '')), 600), ''),
      nullif(p->>'avatar_url', ''), coalesce(nullif(upper(p->>'kind'), ''), 'EDITOR'), nullif(p->>'user_id', '')::uuid,
      nullif(p->>'partner_id', '')::uuid, coalesce((p->>'verified')::boolean, false))
    returning id into v_id;
  else
    update public.content_authors set name = left(trim(p->>'name'), 80), title = nullif(left(trim(coalesce(p->>'title', '')), 80), ''),
      bio = nullif(left(trim(coalesce(p->>'bio', '')), 600), ''), avatar_url = nullif(p->>'avatar_url', ''),
      kind = coalesce(nullif(upper(p->>'kind'), ''), kind), user_id = nullif(p->>'user_id', '')::uuid,
      partner_id = nullif(p->>'partner_id', '')::uuid, verified = coalesce((p->>'verified')::boolean, verified)
     where id = v_id;
    if not found then raise exception 'AUTHOR_NOT_FOUND'; end if;
  end if;
  return v_id;
end $$;

-- Ban nội dung: chỉ admin thêm / bớt. p_role null = gỡ.
create or replace function public.cms_set_staff(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare v_admin uuid := private.require_admin();
begin
  if p_role is null or p_role = '' then
    delete from public.content_staff where user_id = p_user;
  else
    if upper(p_role) not in ('EDITOR', 'WRITER', 'EXPERT') then raise exception 'INVALID_ROLE'; end if;
    if not exists (select 1 from public.profiles where id = p_user) then raise exception 'USER_NOT_FOUND'; end if;
    insert into public.content_staff (user_id, role, added_by) values (p_user, upper(p_role), v_admin)
    on conflict (user_id) do update set role = excluded.role, added_by = excluded.added_by;
  end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_admin, 'CONTENT_STAFF', 'profile:' || p_user, jsonb_build_object('role', p_role));
end $$;

-- Thống kê nội dung (ban nội dung): tổng + theo ngày + bài nổi bật nhất
create or replace function public.cms_stats(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_role text := private.require_content_staff();
  v_from date := (now() at time zone 'Asia/Ho_Chi_Minh')::date - greatest(1, least(coalesce(p_days, 30), 365)) + 1;
begin
  return jsonb_build_object(
    'totals', (select jsonb_build_object('views', coalesce(sum(d.views), 0), 'reads', coalesce(sum(d.reads), 0),
                 'shares', coalesce(sum(d.shares), 0), 'cta_clicks', coalesce(sum(d.cta_clicks), 0))
                 from public.content_daily_stats d where d.day >= v_from),
    'saves', (select count(*) from public.content_bookmarks b where b.created_at >= v_from),
    'readers', (select count(distinct h.user_id) from public.content_read_history h where h.last_at >= v_from),
    'avg_read_seconds', (select coalesce(round(avg(h.seconds)), 0) from public.content_read_history h where h.last_at >= v_from and h.seconds > 0),
    'published', (select count(*) from public.content_articles a where private.content_live(a)),
    'days', (select coalesce(jsonb_agg(jsonb_build_object('day', g.day, 'views', coalesce(s.views, 0), 'reads', coalesce(s.reads, 0)) order by g.day), '[]'::jsonb)
               from (select generate_series(v_from, (now() at time zone 'Asia/Ho_Chi_Minh')::date, interval '1 day')::date as day) g
               left join (select d.day, sum(d.views) views, sum(d.reads) reads from public.content_daily_stats d where d.day >= v_from group by d.day) s on s.day = g.day),
    'top', (select coalesce(jsonb_agg(y.j order by y.rn), '[]'::jsonb) from (
              select jsonb_build_object('id', a.id, 'slug', a.slug, 'title', a.title, 'category_id', a.category_id,
                       'views', sum(d.views), 'reads', sum(d.reads), 'shares', sum(d.shares), 'cta_clicks', sum(d.cta_clicks),
                       'read_rate', round(100.0 * sum(d.reads) / greatest(sum(d.views), 1)),
                       'cta_rate', round(100.0 * sum(d.cta_clicks) / greatest(sum(d.views), 1))) j,
                     row_number() over (order by sum(d.views) desc) rn
                from public.content_daily_stats d join public.content_articles a on a.id = d.article_id
               where d.day >= v_from group by a.id) y where y.rn <= 10));
end $$;

-- Vai trò nội dung của tôi (để hiện nút CMS)
create or replace function public.my_content_role() returns text
language sql stable security definer set search_path = public as $$
  select private.content_role(auth.uid())
$$;

-- Việc cần xử lý: + bài chờ duyệt
create or replace function public.admin_inbox() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'orders', (select count(*) from public.orders o where o.status = 'PENDING' and (o.expires_at is null or o.expires_at > now())),
    'reviews', (select count(*) from public.activities a where a.validation_status = 'PENDING' and coalesce(a.status, '') <> 'DELETED'),
    'partners', (select count(*) from public.partners p where p.status = 'PENDING'),
    'cups', (select count(*) from public.club_cups c where c.status = 'PENDING_REVIEW'),
    'reports', (select count(distinct r.target) from public.user_reports r where r.status = 'OPEN'),
    'content', (select count(*) from public.content_articles a where a.status = 'REVIEW'),
    'errors', (select count(distinct e.code) from private.client_errors e where e.last_at > now() - interval '24 hours'),
    'new_users_7d', (select count(*) from public.profiles p where p.created_at > now() - interval '7 days'),
    'active_7d', (select count(distinct a.user_id) from public.activities a where a.started_at > now() - interval '7 days'),
    'banned', (select count(*) from public.profiles p where p.banned_at is not null));
end $$;

-- ---------------------------------------------------------------------
-- 6. Bài mẫu (chạy lại không ghi đè bài đã sửa)
--    • Hướng dẫn RaceHub: đăng ngay (nội dung về app).
--    • Chuỗi "Bắt đầu chạy bộ": để CHỜ DUYỆT — nội dung sức khoẻ / giáo án cần chuyên gia xem trước khi đăng.
-- ---------------------------------------------------------------------
insert into public.content_articles (slug, title, summary, body, category_id, author_id, content_type, status, published_at, reading_time_minutes,
  is_featured, series_id, series_order, ctas, needs_expert_review)
select x.slug, x.title, x.summary, x.body, x.cat, '00000000-0000-0000-0000-00000000c0a1', x.typ, x.st,
       case when x.st = 'PUBLISHED' then now() end, private.reading_minutes(x.body), x.feat, x.series, x.ord, x.ctas::jsonb, x.expert
  from (values
  ('xp-xu-level-hoat-dong-the-nao', 'XP, Xu và cấp độ trong RaceHub hoạt động thế nào?',
   'XP chỉ đến từ km chạy hợp lệ; Xu dùng cho vật phẩm, quà tặng và tính năng. Hiểu đúng để chơi công bằng.',
   E'## XP: thước đo quãng đường\n\nMỗi km chạy **hợp lệ** (đồng bộ từ Strava hoặc ghi trong app, qua kiểm tra chống gian lận) mới sinh ra XP. Không có cách nào khác để có XP — không mua được, không đọc bài, không bấm quảng cáo.\n\n- XP cộng dồn lên **cấp độ** của bạn.\n- Bài bị nghi đi xe hoặc GPS nhảy sẽ chờ duyệt, chưa tính XP.\n\n## Xu: đồng tiền trong game\n\nXu dùng để mua vật phẩm cho nhân vật, tặng quà cho bạn chạy và dùng một số tính năng. Xu có thể nhận từ nhiệm vụ, thử thách hoặc nạp thêm.\n\n> RaceHub không giữ tiền của bạn và không cho chuyển Xu giữa người dùng.\n\n## Mẹo\n\n1. Kết nối Strava để bài chạy tự về.\n2. Đặt **mục tiêu tuần** vừa sức để giữ chuỗi ngày chạy.\n3. Tham gia thử thách để có thêm động lực.',
   'APP', 'ARTICLE', 'PUBLISHED', true, null, null, '[{"kind":"GOAL","label":"Đặt mục tiêu tuần"},{"kind":"CHALLENGES","label":"Khám phá thử thách"}]', false),
  ('tham-gia-thu-thach-dau-tien', 'Tham gia thử thách đầu tiên của bạn',
   'Thử thách cá nhân, thử thách CLB, giải chạy ảo — chọn cái phù hợp và bắt đầu.',
   E'## Có những loại thử thách nào?\n\n- **Thử thách cộng đồng**: chạy đủ km trong thời gian quy định.\n- **Thử thách CLB**: đua cùng thành viên CLB, có thể chia đội.\n- **Giải chạy ảo**: đăng ký cự ly, chạy ở bất kỳ đâu, nhận BIB và chứng nhận.\n\n## Bắt đầu thế nào?\n\n1. Mở **Thử thách**, đọc kỹ thể lệ (thời gian, cách tính km, phần thưởng).\n2. Bấm tham gia. Bài chạy hợp lệ trong thời gian thử thách tự được tính.\n3. Theo dõi bảng xếp hạng và tiến độ của bạn.\n\n> Chọn mục tiêu vừa sức: hoàn thành một thử thách nhỏ tốt hơn bỏ dở một thử thách lớn.',
   'APP', 'ARTICLE', 'PUBLISHED', false, null, null, '[{"kind":"CHALLENGES","label":"Xem thử thách đang mở"},{"kind":"RACES","label":"Giải chạy ảo"}]', false),
  ('tim-ban-chay-voi-quanh-day', 'Tìm bạn chạy cùng pace với Quanh đây',
   'Tính năng mới: runner hợp pace, hợp giờ ở gần bạn, buổi chạy công khai của CLB — vị trí chỉ lưu gần đúng.',
   E'## Quanh đây là gì?\n\nQuanh đây giúp bạn tìm **runner cùng pace, cùng khung giờ, cùng mục tiêu** ở gần, cùng các buổi chạy công khai và CLB trong khu vực.\n\n## Quyền riêng tư\n\n- Chỉ lưu vùng khoảng 1 km bạn chọn, tự hết hạn.\n- Người khác chỉ thấy khoảng cách ước chừng.\n- Bạn chọn ai thấy mình; chặn, báo cáo bất cứ lúc nào.\n\n## An toàn khi gặp nhau\n\nKết nối xong, hãy rủ nhau vào **buổi chạy nhóm nơi công cộng** của CLB. Báo người thân lịch chạy và không chia sẻ địa chỉ nhà.',
   'APP', 'NEWS', 'PUBLISHED', false, null, null, '[{"kind":"NEARBY","label":"Mở Quanh đây"}]', false),
  ('nhan-vat-va-tu-do', 'Nhân vật và tủ đồ: thể hiện phong cách runner',
   'Chọn dáng nhân vật, phối đồ, mặc đồng phục CLB và mở khoá vật phẩm theo thành tích.',
   E'## Nhân vật của bạn\n\nMỗi runner có một nhân vật 2D. Vào **Nhân vật** để chọn dáng, màu da, kiểu tóc.\n\n## Tủ đồ\n\n- Vật phẩm mua bằng Xu hoặc mở khoá theo cấp độ, huy hiệu, thử thách.\n- CLB có thể thiết kế **đồng phục riêng** (áo, quần, tất, giày) cho thành viên.\n\n> Áo thật chỉ bán qua cửa hàng đối tác trong Chợ Runner — vật phẩm trong app là đồ trang trí cho nhân vật.',
   'APP', 'ARTICLE', 'PUBLISHED', false, null, null, '[{"kind":"CHARACTER","label":"Mở tủ đồ"}]', false),
  ('lo-trinh-0-den-5-km', 'Bắt đầu chạy bộ: lộ trình từ 0 đến 5 km',
   'Kết hợp đi bộ và chạy chậm trong 8 tuần để chạy liền 5 km mà không quá sức.',
   E'> Bản nháp — cần chuyên gia duyệt trước khi đăng.\n\n## Nguyên tắc\n\n- Chạy **chậm tới mức nói chuyện được**.\n- 3 buổi / tuần, xen ngày nghỉ.\n- Tăng dần, không tăng quá nhanh.\n\n## Gợi ý 8 tuần\n\n| Tuần | Mỗi buổi |\n|---|---|\n| 1–2 | Đi bộ 2 phút + chạy 1 phút × 8 |\n| 3–4 | Đi bộ 1 phút 30 + chạy 2 phút × 7 |\n| 5–6 | Đi bộ 1 phút + chạy 4 phút × 5 |\n| 7 | Chạy 10 phút × 2, đi bộ 2 phút giữa |\n| 8 | Chạy liền 25–35 phút |\n\n## Khi nào nên dừng?\n\nĐau nhói, đau tăng dần khi chạy, chóng mặt, tức ngực — dừng lại và hỏi ý kiến nhân viên y tế.',
   'BEGINNER', 'ARTICLE', 'REVIEW', true, 'STARTER', 1, '[{"kind":"GOAL","label":"Đặt mục tiêu tuần đầu tiên"},{"kind":"CLUBS","label":"Tìm CLB để chạy cùng"}]', true),
  ('chon-giay-chay-bo-dau-tien', 'Cách chọn giày chạy bộ đầu tiên',
   'Vừa chân, êm vừa phải, phù hợp mặt đường — thử giày buổi chiều và chạy thử trước khi mua.',
   E'## Những điều quan trọng\n\n- **Vừa chân**: mũi giày dư khoảng một đốt ngón tay.\n- **Thoải mái ngay khi thử**: giày chạy không cần \"đi cho quen\".\n- **Mặt đường**: đường nhựa dùng giày road; đường mòn dùng giày trail.\n\n## Mẹo khi mua\n\n1. Thử giày buổi chiều (chân nở hơn).\n2. Mang đúng loại tất bạn hay chạy.\n3. Chạy thử vài bước trong cửa hàng.\n\nHỏi cửa hàng đối tác trong Chợ Runner để được đo chân và tư vấn.',
   'BEGINNER', 'ARTICLE', 'REVIEW', false, 'STARTER', 2, '[{"kind":"MARKET","target":"SHOP","label":"Cửa hàng đối tác"}]', false),
  ('easy-tempo-interval-khac-nhau', 'Phân biệt Easy Run, Tempo và Interval',
   'Ba kiểu buổi chạy cơ bản: chạy nhẹ xây nền, tempo tăng ngưỡng, interval tăng tốc độ.',
   E'> Bản nháp — cần chuyên gia duyệt trước khi đăng.\n\n## Easy run\n\nChạy nhẹ, nói chuyện được thành câu. Chiếm phần lớn thời gian tập.\n\n## Tempo\n\nChạy \"khó chịu nhưng giữ được\" khoảng 20–30 phút. Chỉ nói được vài từ.\n\n## Interval\n\nCác quãng nhanh ngắn xen nghỉ, ví dụ 6 × 400 m. Chỉ nên tập khi đã có nền chạy nhẹ đều đặn.\n\n> Người mới: tập trung easy run 4–8 tuần trước khi thêm tempo / interval.',
   'TRAINING', 'ARTICLE', 'REVIEW', false, 'STARTER', 3, '[{"kind":"MARKET","target":"COACH","label":"Tìm HLV"}]', true),
  ('khi-nao-bo-sung-nuoc-va-gel', 'Khi nào nên bổ sung nước và gel?',
   'Chạy dưới 60 phút thường chỉ cần nước; chạy dài hơn cần tính tới năng lượng và điện giải.',
   E'> Bản nháp — cần chuyên gia dinh dưỡng duyệt trước khi đăng.\n\n## Nước\n\nUống theo cảm giác khát, chú ý thời tiết nóng ẩm.\n\n## Gel và năng lượng\n\nBuổi chạy trên 60–75 phút có thể cần bổ sung năng lượng. **Thử gel trong buổi tập**, không thử lần đầu trong ngày thi đấu.\n\n## Điện giải\n\nRa nhiều mồ hôi, chạy lâu trong trời nóng: cân nhắc nước điện giải.\n\n> Nội dung mang tính tham khảo chung, không thay cho tư vấn của chuyên gia dinh dưỡng / y tế.',
   'NUTRITION', 'ARTICLE', 'REVIEW', false, 'STARTER', 4, '[{"kind":"MARKET","target":"SERVICE","label":"Chuyên gia dinh dưỡng"}]', true)
  ) as x(slug, title, summary, body, cat, typ, st, feat, series, ord, ctas, expert)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------
-- 7. Quyền
-- ---------------------------------------------------------------------
revoke all on function private.content_role(uuid), private.content_live(public.content_articles), private.reading_minutes(text), private.slugify(text),
  private.content_card(public.content_articles, uuid), private.content_bump(uuid, text), private.clean_ctas(jsonb), private.require_content_staff()
  from public, anon, authenticated;
revoke all on function public.knowledge_home(), public.knowledge_list(jsonb), public.knowledge_article(text), public.knowledge_progress(uuid, integer, integer),
  public.knowledge_bookmark(uuid, boolean), public.knowledge_feedback(uuid, boolean, text), public.knowledge_track(uuid, text),
  public.cms_meta(), public.cms_list(jsonb), public.cms_get(uuid), public.cms_save(jsonb), public.cms_set_status(uuid, text, timestamptz, text),
  public.cms_expert_review(uuid, boolean, text), public.cms_delete(uuid), public.cms_save_author(jsonb), public.cms_set_staff(uuid, text),
  public.cms_stats(integer), public.my_content_role() from public, anon;
grant execute on function public.knowledge_home(), public.knowledge_list(jsonb), public.knowledge_article(text), public.knowledge_progress(uuid, integer, integer),
  public.knowledge_bookmark(uuid, boolean), public.knowledge_feedback(uuid, boolean, text), public.knowledge_track(uuid, text),
  public.cms_meta(), public.cms_list(jsonb), public.cms_get(uuid), public.cms_save(jsonb), public.cms_set_status(uuid, text, timestamptz, text),
  public.cms_expert_review(uuid, boolean, text), public.cms_delete(uuid), public.cms_save_author(jsonb), public.cms_set_staff(uuid, text),
  public.cms_stats(integer), public.my_content_role() to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001006300_club_news_albums.sql
-- ===================================================================
-- 006300: Quản lý CLB — Tin CLB của ban chủ nhiệm + Kho link ảnh CLB.
-- • Tin CLB (club_posts.kind = 'NEWS'): chỉ ban quản trị CLB đăng; có tiêu đề, chuyên mục (thông báo / sự kiện / giải chạy /
--   kết quả / tập luyện / khác), link kèm theo, ảnh; tuỳ chọn ghim đầu bảng tin và / hoặc gửi thông báo tới mọi thành viên.
--   Bảng tin có bộ lọc "Tin CLB" để runner không bị trôi tin giữa bài chạy tự động.
-- • Kho ảnh (club_albums): lưu LINK album (Google Photos, Drive, Facebook, iCloud, OneDrive, Flickr…) theo sự kiện / giải / buổi tập,
--   có ảnh bìa, ngày chụp, tìm kiếm không dấu, lọc theo loại và năm. Thành viên gửi link → ban quản trị duyệt; ban quản trị thêm trực tiếp.
-- Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 1. Tin CLB
-- ---------------------------------------------------------------------
alter table public.club_posts drop constraint if exists club_posts_kind_check;
alter table public.club_posts add constraint club_posts_kind_check
  check (kind in ('POST', 'ANNOUNCEMENT', 'AUTO_RUN', 'AUTO_JOIN', 'RECAP', 'CHALLENGE', 'NEWS'));

create or replace function private.news_categories() returns text[]
language sql immutable as $$ select array['NOTICE', 'EVENT', 'RACE', 'RESULT', 'TRAINING', 'OTHER'] $$;

-- p: {id?, title, body, category, link, image_paths[], pin, notify}
create or replace function public.publish_club_news(p_club_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_title text := trim(coalesce(p->>'title', ''));
  v_body text := trim(coalesce(p->>'body', ''));
  v_cat text := upper(coalesce(nullif(p->>'category', ''), 'NOTICE'));
  v_link text := nullif(trim(coalesce(p->>'link', '')), '');
  v_paths text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'image_paths', '[]'::jsonb)) x), '{}');
  v_pin boolean := coalesce((p->>'pin')::boolean, false);
  v_old public.club_posts;
  m record;
begin
  if not public.club_is_staff(p_club_id) then raise exception 'FORBIDDEN'; end if;
  if char_length(v_title) < 3 or char_length(v_title) > 120 then raise exception 'TITLE_REQUIRED'; end if;
  if char_length(v_body) > 4000 or cardinality(v_paths) > 4 then raise exception 'POST_TOO_LONG'; end if;
  if not (v_cat = any (private.news_categories())) then raise exception 'INVALID_CATEGORY'; end if;
  if v_link is not null and (v_link !~ '^https?://' or char_length(v_link) > 500) then raise exception 'INVALID_URL'; end if;
  if exists (select 1 from unnest(v_paths) x where x not like p_club_id::text || '/' || v_uid::text || '/%') then
    raise exception 'INVALID_IMAGE_PATH';
  end if;

  if v_id is null then
    if (select count(*) from public.club_posts where club_id = p_club_id and kind = 'NEWS' and created_at > now() - interval '24 hours') >= 20 then
      raise exception 'RATE_LIMITED';
    end if;
    insert into public.club_posts (club_id, author_id, kind, title, body, image_paths, is_pinned, meta)
    values (p_club_id, v_uid, 'NEWS', v_title, v_body, v_paths, v_pin, jsonb_build_object('category', v_cat, 'link', v_link))
    returning id into v_id;
    if coalesce((p->>'notify')::boolean, false) then
      for m in select user_id from public.club_members where club_id = p_club_id and status = 'APPROVED' and user_id <> v_uid loop
        perform private.notify(m.user_id, p_club_id, 'CLUB_NEWS', v_title, left(coalesce(nullif(v_body, ''), 'Tin mới từ CLB'), 140),
          '/clubs/' || p_club_id || '?post=' || v_id, v_uid, true);
      end loop;
    end if;
  else
    v_old := (select x from public.club_posts x where x.id = v_id);
    if v_old.id is null or v_old.club_id <> p_club_id or v_old.kind <> 'NEWS' then raise exception 'POST_NOT_FOUND'; end if;
    -- ảnh cũ giữ nguyên được (người đăng khác trong ban quản trị)
    if exists (select 1 from unnest(v_paths) x where x not like p_club_id::text || '/' || v_uid::text || '/%' and not (x = any (v_old.image_paths))) then
      raise exception 'INVALID_IMAGE_PATH';
    end if;
    update public.club_posts set title = v_title, body = v_body, image_paths = v_paths, is_pinned = v_pin,
      meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('category', v_cat, 'link', v_link, 'edited_at', now())
     where id = v_id;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 2. Kho link ảnh CLB
-- ---------------------------------------------------------------------
create table if not exists public.club_albums (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  url text not null check (url ~ '^https?://' and char_length(url) <= 500),
  description text check (description is null or char_length(description) <= 500),
  kind text not null default 'EVENT' check (kind in ('EVENT', 'RACE', 'TRAINING', 'SOCIAL', 'OTHER')),
  taken_on date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  event_id uuid references public.club_events(id) on delete set null,
  race_name text check (race_name is null or char_length(race_name) <= 120),
  cover_path text,
  photographer text check (photographer is null or char_length(photographer) <= 80),
  status text not null default 'APPROVED' check (status in ('PENDING', 'APPROVED')),
  created_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  opens integer not null default 0
);
create index if not exists club_albums_list_idx on public.club_albums (club_id, status, taken_on desc);
create index if not exists club_albums_event_idx on public.club_albums (event_id);
alter table public.club_albums enable row level security;
revoke all on public.club_albums from anon, authenticated;

create or replace function private.album_json(a public.club_albums) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', a.id, 'club_id', a.club_id, 'title', a.title, 'url', a.url, 'description', a.description, 'kind', a.kind,
    'taken_on', a.taken_on, 'event_id', a.event_id, 'event_title', (select e.title from public.club_events e where e.id = a.event_id),
    'race_name', a.race_name, 'cover_path', a.cover_path, 'photographer', a.photographer, 'status', a.status, 'opens', a.opens,
    'created_by', a.created_by, 'created_by_name', private.display_name(a.created_by), 'created_at', a.created_at)
$$;

-- p: {q, kind, year, event_id, offset}. Thành viên thấy album đã duyệt + album mình gửi đang chờ; ban quản trị thấy cả hàng chờ.
create or replace function public.club_albums(p_club_id uuid, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_staff boolean := public.club_is_staff(p_club_id);
  v_q text := coalesce(p->>'q', '');
  v_kind text := nullif(upper(coalesce(p->>'kind', '')), 'ALL');
  v_year integer := nullif(p->>'year', '')::int;
  v_event uuid := nullif(p->>'event_id', '')::uuid;
  v_offset integer := greatest(0, coalesce((p->>'offset')::int, 0));
begin
  if not public.club_is_member(p_club_id) and not public.is_system_admin() then raise exception 'NOT_A_MEMBER'; end if;
  v_kind := nullif(v_kind, '');
  return (
    with vis as (
      select a from public.club_albums a
       where a.club_id = p_club_id and (a.status = 'APPROVED' or v_staff or a.created_by = v_uid)
    ), f as (
      select v.a from vis v
       where (v_kind is null or (v.a).kind = v_kind)
         and (v_year is null or extract(year from (v.a).taken_on) = v_year)
         and (v_event is null or (v.a).event_id = v_event)
         and (private.search_key(v_q) = '' or private.search_match(
               private.search_hay((v.a).title) || ' ' || private.search_key(coalesce((v.a).race_name, '') || ' ' || coalesce((v.a).description, '')
               || ' ' || coalesce((select e.title from public.club_events e where e.id = (v.a).event_id), '') || ' ' || coalesce((v.a).photographer, '')) || ' ', v_q))
    ), r as (
      select f.a, row_number() over (order by ((f.a).status = 'PENDING') desc, (f.a).taken_on desc, (f.a).created_at desc) rn from f
    )
    select jsonb_build_object(
      'total', (select count(*) from f),
      'items', coalesce((select jsonb_agg(private.album_json(r.a) order by r.rn) from r where r.rn > v_offset and r.rn <= v_offset + 30), '[]'::jsonb),
      'years', (select coalesce(jsonb_agg(y order by y desc), '[]'::jsonb) from (select distinct extract(year from (v.a).taken_on)::int y from vis v) z),
      'pending', case when v_staff then (select count(*) from public.club_albums a where a.club_id = p_club_id and a.status = 'PENDING') else 0 end,
      'can_manage', v_staff));
end $$;

-- Thêm / sửa album. p: {id?, title, url, description, kind, taken_on, event_id, race_name, cover_path, photographer, notify}
-- Ban quản trị: đăng ngay. Thành viên: gửi chờ duyệt (tối đa 10 link / ngày), sửa được link của mình khi còn chờ.
create or replace function public.save_club_album(p_club_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_staff boolean := public.club_is_staff(p_club_id);
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_old public.club_albums := (select x from public.club_albums x where x.id = nullif(p->>'id', '')::uuid);
  v_title text := trim(coalesce(p->>'title', ''));
  v_url text := trim(coalesce(p->>'url', ''));
  v_kind text := upper(coalesce(nullif(p->>'kind', ''), 'EVENT'));
  v_event uuid := nullif(p->>'event_id', '')::uuid;
  v_cover text := nullif(p->>'cover_path', '');
  v_date date := coalesce(nullif(p->>'taken_on', '')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  m record;
begin
  if not public.club_is_member(p_club_id) then raise exception 'NOT_A_MEMBER'; end if;
  if char_length(v_title) < 3 or char_length(v_title) > 120 then raise exception 'TITLE_REQUIRED'; end if;
  if v_url !~ '^https?://[^\s/$.?#][^\s]*$' or char_length(v_url) > 500 then raise exception 'INVALID_URL'; end if;
  if v_kind not in ('EVENT', 'RACE', 'TRAINING', 'SOCIAL', 'OTHER') then raise exception 'INVALID_KIND'; end if;
  if v_date > (now() at time zone 'Asia/Ho_Chi_Minh')::date + 1 then raise exception 'INVALID_DATE'; end if;
  if v_event is not null and not exists (select 1 from public.club_events e where e.id = v_event and e.club_id = p_club_id) then
    raise exception 'EVENT_NOT_FOUND';
  end if;
  if v_cover is not null and v_cover is distinct from v_old.cover_path and v_cover not like p_club_id::text || '/' || v_uid::text || '/%' then
    raise exception 'INVALID_IMAGE_PATH';
  end if;

  if v_old.id is null then
    if v_id is not null then raise exception 'ALBUM_NOT_FOUND'; end if;
    if not v_staff and (select count(*) from public.club_albums a where a.created_by = v_uid and a.created_at > now() - interval '24 hours') >= 10 then
      raise exception 'RATE_LIMITED';
    end if;
    if exists (select 1 from public.club_albums a where a.club_id = p_club_id and a.url = v_url) then raise exception 'ALBUM_EXISTS'; end if;
    insert into public.club_albums (club_id, title, url, description, kind, taken_on, event_id, race_name, cover_path, photographer, status, created_by, approved_by)
    values (p_club_id, v_title, v_url, nullif(left(trim(coalesce(p->>'description', '')), 500), ''), v_kind, v_date, v_event,
      nullif(left(trim(coalesce(p->>'race_name', '')), 120), ''), v_cover, nullif(left(trim(coalesce(p->>'photographer', '')), 80), ''),
      case when v_staff then 'APPROVED' else 'PENDING' end, v_uid, case when v_staff then v_uid end)
    returning id into v_id;
    if v_staff and coalesce((p->>'notify')::boolean, false) then
      for m in select user_id from public.club_members where club_id = p_club_id and status = 'APPROVED' and user_id <> v_uid loop
        perform private.notify(m.user_id, p_club_id, 'CLUB_ALBUM', 'Album ảnh mới: ' || v_title, 'Xem ảnh trong tab Ảnh của CLB',
          '/clubs/' || p_club_id || '/photos', v_uid, false);
      end loop;
    elsif not v_staff then
      for m in select user_id from public.club_members where club_id = p_club_id and status = 'APPROVED' and role in ('OWNER', 'CAPTAIN') loop
        perform private.notify(m.user_id, p_club_id, 'CLUB_ALBUM', 'Link ảnh chờ duyệt', private.display_name(v_uid) || ' gửi album "' || v_title || '"',
          '/clubs/' || p_club_id || '/photos', v_uid, false);
      end loop;
    end if;
  else
    if v_old.club_id <> p_club_id then raise exception 'ALBUM_NOT_FOUND'; end if;
    if not v_staff and (v_old.created_by is distinct from v_uid or v_old.status <> 'PENDING') then raise exception 'FORBIDDEN'; end if;
    if exists (select 1 from public.club_albums a where a.club_id = p_club_id and a.url = v_url and a.id <> v_old.id) then raise exception 'ALBUM_EXISTS'; end if;
    update public.club_albums set title = v_title, url = v_url, description = nullif(left(trim(coalesce(p->>'description', '')), 500), ''),
      kind = v_kind, taken_on = v_date, event_id = v_event, race_name = nullif(left(trim(coalesce(p->>'race_name', '')), 120), ''),
      cover_path = v_cover, photographer = nullif(left(trim(coalesce(p->>'photographer', '')), 80), ''), updated_at = now()
     where id = v_old.id;
  end if;
  return v_id;
end $$;

-- Duyệt link thành viên gửi: đồng ý → hiện cho cả CLB; từ chối → xoá, báo người gửi
create or replace function public.review_club_album(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  a public.club_albums := (select x from public.club_albums x where x.id = p_id);
begin
  if a.id is null then raise exception 'ALBUM_NOT_FOUND'; end if;
  if not public.club_is_staff(a.club_id) then raise exception 'FORBIDDEN'; end if;
  if p_approve then
    update public.club_albums set status = 'APPROVED', approved_by = v_uid, updated_at = now() where id = a.id;
    if a.created_by is not null and a.created_by <> v_uid and a.status = 'PENDING' then
      perform private.notify(a.created_by, a.club_id, 'CLUB_ALBUM', 'Album của bạn đã được duyệt', a.title, '/clubs/' || a.club_id || '/photos', v_uid, false);
    end if;
  else
    delete from public.club_albums where id = a.id;
    if a.created_by is not null and a.created_by <> v_uid then
      perform private.notify(a.created_by, a.club_id, 'CLUB_ALBUM', 'Album chưa được duyệt', a.title || coalesce(': ' || nullif(trim(p_note), ''), ''),
        '/clubs/' || a.club_id || '/photos', v_uid, false);
    end if;
  end if;
end $$;

create or replace function public.delete_club_album(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  a public.club_albums := (select x from public.club_albums x where x.id = p_id);
begin
  if a.id is null then raise exception 'ALBUM_NOT_FOUND'; end if;
  if not public.club_is_staff(a.club_id) and a.created_by is distinct from v_uid then raise exception 'FORBIDDEN'; end if;
  delete from public.club_albums where id = a.id;
end $$;

-- Đếm lượt mở (để ban quản trị biết album nào được xem nhiều)
create or replace function public.open_club_album(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.club_albums := (select x from public.club_albums x where x.id = p_id);
begin
  if a.id is null or a.status <> 'APPROVED' or not public.club_is_member(a.club_id) then return; end if;
  update public.club_albums set opens = opens + 1 where id = a.id;
end $$;

-- ---------------------------------------------------------------------
-- 3. Quyền
-- ---------------------------------------------------------------------
revoke all on function private.news_categories(), private.album_json(public.club_albums) from public, anon, authenticated;
revoke all on function public.publish_club_news(uuid, jsonb), public.club_albums(uuid, jsonb), public.save_club_album(uuid, jsonb),
  public.review_club_album(uuid, boolean, text), public.delete_club_album(uuid), public.open_club_album(uuid) from public, anon;
grant execute on function public.publish_club_news(uuid, jsonb), public.club_albums(uuid, jsonb), public.save_club_album(uuid, jsonb),
  public.review_club_album(uuid, boolean, text), public.delete_club_album(uuid), public.open_club_album(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001006400_bib_market.sql
-- ===================================================================
-- 006400: Chợ BIB — runner nhượng lại / tìm mua BIB giải chạy thật.
-- Nguyên tắc (docs/CHO_RUNNER.md):
-- • RaceHub KHÔNG giữ tiền, không làm trung gian thanh toán; hai bên tự liên hệ.
-- • Không bán cao hơn giá gốc (chống phe vé): giá bán ≤ giá mua ban đầu.
-- • Khuyến khích chuyển nhượng CHÍNH THỨC qua BTC (đổi tên VĐV). Nhiều giải cấm chạy BIB người khác — ghi rõ cách chuyển.
-- • Chỉ runner đã xác minh (≥ 3 bài chạy hợp lệ, không bị khoá) mới đăng tin; tối đa 5 tin đang mở.
-- • Thông tin liên hệ ẩn trong danh sách; bấm "Xem liên hệ" mới hiện (≤ 30 lần / ngày, có ghi lại) → hạn chế cào số điện thoại.
-- • Tin tự hết hạn sau ngày giải. Báo cáo tin → hàng đợi Báo cáo của admin; admin ẩn tin.
-- Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

create table if not exists public.bib_listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'SELL' check (kind in ('SELL', 'BUY')),
  race_name text not null check (char_length(race_name) between 3 and 120),
  race_date date not null,
  city text check (city is null or char_length(city) <= 40),
  distance text not null check (distance in ('5K', '10K', '21K', '42K', 'ULTRA', 'OTHER')),
  distance_note text check (distance_note is null or char_length(distance_note) <= 40),
  original_price integer check (original_price is null or original_price between 0 and 50000000),
  price integer check (price is null or price between 0 and 50000000),
  transfer text not null default 'OFFICIAL' check (transfer in ('OFFICIAL', 'ASK')),
  shirt_size text check (shirt_size is null or char_length(shirt_size) <= 10),
  note text check (note is null or char_length(note) <= 500),
  contacts jsonb not null default '{}'::jsonb,
  status text not null default 'OPEN' check (status in ('OPEN', 'RESERVED', 'DONE', 'CANCELLED', 'HIDDEN')),
  hidden_reason text,
  views integer not null default 0,
  reveals integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind = 'BUY' or (price is not null and original_price is not null and price <= original_price))
);
create index if not exists bib_listings_list_idx on public.bib_listings (status, race_date);
create table if not exists public.bib_contact_reveals (
  user_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid not null references public.bib_listings(id) on delete cascade,
  at timestamptz not null default now(),
  primary key (user_id, listing_id)
);
alter table public.bib_listings enable row level security;
alter table public.bib_contact_reveals enable row level security;
revoke all on public.bib_listings, public.bib_contact_reveals from anon, authenticated;

-- Báo cáo dùng chung: thêm ngữ cảnh BIB / MARKET
alter table public.user_reports drop constraint if exists user_reports_context_check;
alter table public.user_reports add constraint user_reports_context_check check (context in ('NEARBY', 'CONNECTION', 'CLUB', 'BIB', 'MARKET', 'OTHER'));

-- Liên hệ: chỉ giữ số điện thoại / Zalo / Facebook / Messenger hợp lệ
create or replace function private.bib_contacts(p jsonb) returns jsonb
language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'phone', case when coalesce(p->>'phone', '') ~ '^\+?[0-9 .]{8,15}$' then regexp_replace(p->>'phone', '[ .]', '', 'g') end,
    'zalo', case when coalesce(p->>'zalo', '') ~ '^\+?[0-9 .]{8,15}$' then regexp_replace(p->>'zalo', '[ .]', '', 'g') end,
    'facebook', case when coalesce(p->>'facebook', '') ~ '^https://(www\.|m\.)?(facebook\.com|fb\.com|m\.me)/[^\s]+$' then left(p->>'facebook', 200) end))
$$;

create or replace function private.bib_json(b public.bib_listings, p_uid uuid, p_full boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', b.id, 'kind', b.kind, 'race_name', b.race_name, 'race_date', b.race_date, 'city', b.city,
    'distance', b.distance, 'distance_note', b.distance_note, 'original_price', b.original_price, 'price', b.price,
    'transfer', b.transfer, 'shirt_size', b.shirt_size, 'note', b.note, 'status', b.status, 'created_at', b.created_at,
    'mine', b.user_id = p_uid,
    'seller', (select jsonb_build_object('id', p.id, 'name', coalesce(p.display_name, 'Runner'), 'avatar_url', p.avatar_url, 'level', p.level,
                 'runs', private.valid_runs(p.id), 'since', p.created_at) from public.profiles p where p.id = b.user_id),
    'revealed', exists (select 1 from public.bib_contact_reveals r where r.user_id = p_uid and r.listing_id = b.id))
  || case when p_full or b.user_id = p_uid
          or exists (select 1 from public.bib_contact_reveals r where r.user_id = p_uid and r.listing_id = b.id)
     then jsonb_build_object('contacts', b.contacts) else '{}'::jsonb end
  || case when b.user_id = p_uid then jsonb_build_object('views', b.views, 'reveals', b.reveals, 'hidden_reason', b.hidden_reason) else '{}'::jsonb end
$$;

-- p: {kind, q, city, distance, mine, offset}. Chỉ tin đang mở và giải chưa diễn ra (trừ "tin của tôi").
create or replace function public.bib_listings(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_kind text := nullif(upper(coalesce(p->>'kind', '')), '');
  v_q text := coalesce(p->>'q', '');
  v_city text := nullif(p->>'city', '');
  v_dist text := nullif(upper(coalesce(p->>'distance', '')), '');
  v_mine boolean := coalesce((p->>'mine')::boolean, false);
  v_offset integer := greatest(0, coalesce((p->>'offset')::int, 0));
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  return (
    with f as (
      select b from public.bib_listings b
       where case when v_mine then b.user_id = v_uid
                  else b.status in ('OPEN', 'RESERVED') and b.race_date >= v_today end
         and (v_kind is null or b.kind = v_kind)
         and (v_city is null or b.city = v_city)
         and (v_dist is null or b.distance = v_dist)
         and (private.search_key(v_q) = '' or private.search_match(private.search_hay(b.race_name) || ' ' || private.search_key(coalesce(b.city, '')) || ' ', v_q))
    ), r as (
      select f.b, row_number() over (order by case when v_mine then 0 else ((f.b).status = 'RESERVED')::int end, (f.b).race_date, (f.b).created_at desc) rn from f
    )
    select jsonb_build_object('total', (select count(*) from f),
      'items', coalesce((select jsonb_agg(private.bib_json(r.b, v_uid, false) order by r.rn) from r where r.rn > v_offset and r.rn <= v_offset + 30), '[]'::jsonb),
      'eligible', private.nearby_eligible(v_uid), 'valid_runs', private.valid_runs(v_uid),
      'open_count', (select count(*) from public.bib_listings b where b.user_id = v_uid and b.status in ('OPEN', 'RESERVED'))));
end $$;

-- Đăng / sửa tin. p: {id?, kind, race_name, race_date, city, distance, distance_note, original_price, price, transfer, shirt_size, note, contacts{phone,zalo,facebook}}
create or replace function public.save_bib_listing(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_old public.bib_listings := (select x from public.bib_listings x where x.id = nullif(p->>'id', '')::uuid);
  v_kind text := upper(coalesce(nullif(p->>'kind', ''), v_old.kind, 'SELL'));
  v_date date := nullif(p->>'race_date', '')::date;
  v_orig integer := nullif(p->>'original_price', '')::int;
  v_price integer := nullif(p->>'price', '')::int;
  v_contacts jsonb := private.bib_contacts(coalesce(p->'contacts', '{}'::jsonb));
  v_note text := nullif(left(trim(coalesce(p->>'note', '')), 500), '');
  v_id uuid;
begin
  if not private.nearby_eligible(v_uid) then raise exception 'NOT_ELIGIBLE'; end if;
  if nullif(p->>'id', '') is not null and (v_old.id is null or v_old.user_id <> v_uid) then raise exception 'LISTING_NOT_FOUND'; end if;
  if v_old.status = 'HIDDEN' then raise exception 'LISTING_HIDDEN'; end if;
  if v_kind not in ('SELL', 'BUY') then raise exception 'INVALID_KIND'; end if;
  if char_length(trim(coalesce(p->>'race_name', ''))) < 3 then raise exception 'RACE_REQUIRED'; end if;
  if v_date is null or v_date < (now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception 'RACE_DATE_PAST'; end if;
  if upper(coalesce(p->>'distance', '')) not in ('5K', '10K', '21K', '42K', 'ULTRA', 'OTHER') then raise exception 'INVALID_DISTANCE'; end if;
  if v_kind = 'SELL' and (v_orig is null or v_price is null) then raise exception 'PRICE_REQUIRED'; end if;
  if v_kind = 'SELL' and v_price > v_orig then raise exception 'PRICE_ABOVE_ORIGINAL'; end if;
  if v_contacts = '{}'::jsonb then raise exception 'CONTACT_REQUIRED'; end if;
  if v_note ~* '(https?://|www\.)' and v_note !~* '(facebook\.com|fb\.com)' then raise exception 'NO_LINKS'; end if;

  if v_old.id is null then
    if (select count(*) from public.bib_listings b where b.user_id = v_uid and b.status in ('OPEN', 'RESERVED')) >= 5 then raise exception 'TOO_MANY_LISTINGS'; end if;
    if (select count(*) from public.bib_listings b where b.user_id = v_uid and b.created_at > now() - interval '24 hours') >= 10 then raise exception 'RATE_LIMITED'; end if;
    insert into public.bib_listings (user_id, kind, race_name, race_date, city, distance, distance_note, original_price, price, transfer, shirt_size, note, contacts)
    values (v_uid, v_kind, left(trim(p->>'race_name'), 120), v_date, nullif(left(trim(coalesce(p->>'city', '')), 40), ''), upper(p->>'distance'),
      nullif(left(trim(coalesce(p->>'distance_note', '')), 40), ''), v_orig, v_price,
      case when upper(coalesce(p->>'transfer', '')) = 'ASK' then 'ASK' else 'OFFICIAL' end,
      nullif(left(trim(coalesce(p->>'shirt_size', '')), 10), ''), v_note, v_contacts)
    returning id into v_id;
  else
    v_id := v_old.id;
    update public.bib_listings set kind = v_kind, race_name = left(trim(p->>'race_name'), 120), race_date = v_date,
      city = nullif(left(trim(coalesce(p->>'city', '')), 40), ''), distance = upper(p->>'distance'),
      distance_note = nullif(left(trim(coalesce(p->>'distance_note', '')), 40), ''), original_price = v_orig, price = v_price,
      transfer = case when upper(coalesce(p->>'transfer', '')) = 'ASK' then 'ASK' else 'OFFICIAL' end,
      shirt_size = nullif(left(trim(coalesce(p->>'shirt_size', '')), 10), ''), note = v_note, contacts = v_contacts, updated_at = now()
     where id = v_id;
  end if;
  return v_id;
end $$;

-- Người đăng đổi trạng thái: OPEN (mở lại) / RESERVED (đang giao dịch) / DONE (đã xong) / CANCELLED (gỡ)
create or replace function public.set_bib_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.bib_listings := (select x from public.bib_listings x where x.id = p_id);
begin
  if b.id is null or b.user_id <> private.require_uid() then raise exception 'LISTING_NOT_FOUND'; end if;
  if b.status = 'HIDDEN' then raise exception 'LISTING_HIDDEN'; end if;
  if upper(p_status) not in ('OPEN', 'RESERVED', 'DONE', 'CANCELLED') then raise exception 'INVALID_STATUS'; end if;
  update public.bib_listings set status = upper(p_status), updated_at = now() where id = b.id;
end $$;

-- Xem liên hệ: cần đăng nhập + tài khoản không bị khoá; ≤ 30 tin khác nhau / 24 giờ
create or replace function public.bib_contact(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  b public.bib_listings := (select x from public.bib_listings x where x.id = p_id);
begin
  if b.id is null or b.status not in ('OPEN', 'RESERVED') then raise exception 'LISTING_NOT_FOUND'; end if;
  if exists (select 1 from public.profiles p where p.id = v_uid and p.banned_at is not null) then raise exception 'FORBIDDEN'; end if;
  if b.user_id <> v_uid and not exists (select 1 from public.bib_contact_reveals r where r.user_id = v_uid and r.listing_id = b.id) then
    if (select count(*) from public.bib_contact_reveals r where r.user_id = v_uid and r.at > now() - interval '24 hours') >= 30 then
      raise exception 'TOO_MANY_REVEALS';
    end if;
    insert into public.bib_contact_reveals (user_id, listing_id) values (v_uid, b.id);
    update public.bib_listings set reveals = reveals + 1 where id = b.id;
  end if;
  return b.contacts;
end $$;

-- Báo cáo tin BIB → hàng đợi Báo cáo của admin (ngữ cảnh BIB, kèm mã tin)
create or replace function public.report_bib(p_id uuid, p_reason text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  b public.bib_listings := (select x from public.bib_listings x where x.id = p_id);
begin
  if b.id is null then raise exception 'LISTING_NOT_FOUND'; end if;
  if b.user_id = v_uid then raise exception 'INVALID_TARGET'; end if;
  if upper(p_reason) not in ('SPAM', 'HARASSMENT', 'FAKE', 'UNSAFE', 'OTHER') then raise exception 'INVALID_REASON'; end if;
  if exists (select 1 from public.user_reports r where r.reporter = v_uid and r.target = b.user_id and r.context = 'BIB' and r.status = 'OPEN') then return; end if;
  insert into public.user_reports (reporter, target, context, reason, note)
  values (v_uid, b.user_id, 'BIB', upper(p_reason), left('Tin BIB "' || b.race_name || '" (' || b.id || '): ' || coalesce(nullif(trim(p_note), ''), ''), 500));
  -- 3 người khác nhau báo cáo tin này → tạm ẩn chờ admin
  if (select count(distinct r.reporter) from public.user_reports r where r.target = b.user_id and r.context = 'BIB' and r.status = 'OPEN'
        and r.note like '%' || b.id || '%') >= 3 then
    update public.bib_listings set status = 'HIDDEN', hidden_reason = 'Tạm ẩn do nhiều báo cáo, chờ quản trị viên xem xét' where id = b.id;
  end if;
end $$;

-- Admin: ẩn / hiện lại tin
create or replace function public.admin_hide_bib(p_id uuid, p_hide boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  b public.bib_listings := (select x from public.bib_listings x where x.id = p_id);
begin
  if b.id is null then raise exception 'LISTING_NOT_FOUND'; end if;
  if p_hide and char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  update public.bib_listings set status = case when p_hide then 'HIDDEN' else 'OPEN' end,
    hidden_reason = case when p_hide then left(trim(p_reason), 300) end, updated_at = now() where id = b.id;
  perform private.notify(b.user_id, null, 'MARKET', case when p_hide then 'Tin BIB đã bị ẩn' else 'Tin BIB đã hiện lại' end,
    b.race_name || coalesce(': ' || nullif(trim(p_reason), ''), ''), '/market?tab=bib', v_admin, true);
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_admin, case when p_hide then 'BIB_HIDE' else 'BIB_UNHIDE' end, 'bib:' || b.id, jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.admin_bib_listings(p_status text default 'ALL') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_admin uuid := private.require_admin();
begin
  return (select coalesce(jsonb_agg(y.j order by y.rn), '[]'::jsonb) from (
    select private.bib_json(b, v_admin, true) || jsonb_build_object('hidden_reason', b.hidden_reason, 'views', b.views, 'reveals', b.reveals) j,
           row_number() over (order by b.created_at desc) rn
      from public.bib_listings b where upper(coalesce(p_status, 'ALL')) = 'ALL' or b.status = upper(p_status)) y where y.rn <= 200);
end $$;

revoke all on function private.bib_contacts(jsonb), private.bib_json(public.bib_listings, uuid, boolean) from public, anon, authenticated;
revoke all on function public.bib_listings(jsonb), public.save_bib_listing(jsonb), public.set_bib_status(uuid, text), public.bib_contact(uuid),
  public.report_bib(uuid, text, text), public.admin_hide_bib(uuid, boolean, text), public.admin_bib_listings(text) from public, anon;
grant execute on function public.bib_listings(jsonb), public.save_bib_listing(jsonb), public.set_bib_status(uuid, text), public.bib_contact(uuid),
  public.report_bib(uuid, text, text), public.admin_hide_bib(uuid, boolean, text), public.admin_bib_listings(text) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001006500_gps_gap_check.sql
-- ===================================================================
-- 006500: Chấm bài chạy ghi trong app — thêm phát hiện MẤT TÍN HIỆU GPS.
-- Trước đây: tắt màn hình khi ghi bằng trình duyệt (iPhone dừng GPS) → điểm tiếp theo nối thẳng, bài vẫn được duyệt
-- (tuyến chỉ còn 2 điểm, quãng đường "ảo"). Nay: đoạn > 60 giây và > 150 m giữa hai điểm = mất tín hiệu;
-- tổng đoạn nối thẳng > 25 % quãng đường (và > 500 m) → bài chờ xác minh, kèm cờ GPS_GAP để ban quản trị xem.
-- Giữ nguyên mọi luật cũ (002400). Chạy lại nhiều lần vẫn an toàn.

create or replace function public.submit_and_process_activity(
  p_title text, p_source text, p_started_at timestamptz, p_ended_at timestamptz,
  p_elapsed_s integer, p_moving_s integer, p_distance_m numeric, p_avg_pace_s integer, p_track_points jsonb
) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := private.require_uid();
  cfg jsonb := private.economy_config();
  v_points jsonb := coalesce(p_track_points, '[]'::jsonb);
  v_n integer;
  v_gps_m numeric := 0;
  v_spikes integer := 0;
  v_prev jsonb;
  v_p jsonb;
  v_seg numeric;
  v_dt numeric;
  v_distance numeric;
  v_moving integer;
  v_pace integer;
  v_status text := 'APPROVED';
  v_reason text := 'Hoạt động hợp lệ qua kiểm tra tự động.';
  v_activity uuid;
  v_seq integer := 0;
  v_reward jsonb;
  -- Tốc độ duy trì (quãng đường trong cửa sổ 30 s) — cùng luật với features/activity/model/fraud.ts
  v_t numeric[] := '{}';
  v_c numeric[] := '{}';
  v_t0 timestamptz;
  v_i integer; v_j integer := 1; v_w numeric; v_sp numeric;
  v_run_sev numeric; v_run_nor numeric; v_run_veh numeric;
  v_sev numeric := 0; v_nor numeric := 0; v_veh numeric := 0;
  v_flags jsonb := '[]'::jsonb;
  -- Mất tín hiệu GPS: đoạn > 60 giây và > 150 m giữa hai điểm liên tiếp (tắt màn hình, hầm…) = tuyến bị nối thẳng
  v_gaps integer := 0;
  v_gap_s numeric := 0;
  v_gap_m numeric := 0;
  v_score integer := 0;
begin
  -- Kiểm tra đầu vào cơ bản
  if p_started_at is null or p_ended_at is null or p_ended_at <= p_started_at then raise exception 'INVALID_TIME_RANGE'; end if;
  if p_started_at > now() + interval '5 minutes' then raise exception 'INVALID_TIME_RANGE'; end if;
  if p_ended_at - p_started_at > interval '24 hours' then raise exception 'ACTIVITY_TOO_LONG'; end if;
  if jsonb_typeof(v_points) <> 'array' then raise exception 'INVALID_TRACK_POINTS'; end if;
  v_n := jsonb_array_length(v_points);
  if v_n > 20000 then raise exception 'TOO_MANY_TRACK_POINTS'; end if;

  -- Chống gửi trùng / chồng thời gian với bài chạy khác
  if exists (select 1 from public.activities
              where user_id = v_uid and started_at < p_ended_at and ended_at > p_started_at) then
    raise exception 'ACTIVITY_DUPLICATE';
  end if;
  if (select count(*) from public.activities where user_id = v_uid and created_at > now() - interval '1 day') >= 20 then
    raise exception 'RATE_LIMITED';
  end if;

  -- Tính lại quãng đường từ GPS (không tin số client gửi)
  for v_p in select value from jsonb_array_elements(v_points) loop
    if v_prev is not null then
      v_seg := private.haversine_m((v_prev->>'latitude')::numeric, (v_prev->>'longitude')::numeric,
                                   (v_p->>'latitude')::numeric, (v_p->>'longitude')::numeric);
      v_dt := extract(epoch from ((v_p->>'recorded_at')::timestamptz - (v_prev->>'recorded_at')::timestamptz));
      if v_dt > 0 and v_seg / v_dt > 12 then v_spikes := v_spikes + 1; end if;   -- > 43 km/h
      if v_dt > 60 and v_seg > 150 then v_gaps := v_gaps + 1; v_gap_s := v_gap_s + v_dt; v_gap_m := v_gap_m + v_seg; end if;
      v_gps_m := v_gps_m + coalesce(v_seg, 0);
    end if;
    v_t0 := coalesce(v_t0, (v_p->>'recorded_at')::timestamptz, p_started_at);
    v_t := v_t || extract(epoch from (coalesce((v_p->>'recorded_at')::timestamptz, v_t0) - v_t0));
    v_c := v_c || v_gps_m;
    v_prev := v_p;
  end loop;

  -- Đoạn liên tục dài nhất có tốc độ ≥ 20 km/h, ≥ 17 km/h, ≥ 25 km/h
  for v_i in 2 .. coalesce(array_length(v_t, 1), 0) loop
    while v_j < v_i and v_t[v_i] - v_t[v_j] > 30 loop v_j := v_j + 1; end loop;
    v_w := v_t[v_i] - v_t[v_j];
    if v_w < 15 then continue; end if;
    v_sp := (v_c[v_i] - v_c[v_j]) / v_w;
    if v_sp >= 20 / 3.6 then v_run_sev := coalesce(v_run_sev, v_t[v_j]); v_sev := greatest(v_sev, v_t[v_i] - v_run_sev); else v_run_sev := null; end if;
    if v_sp >= 17 / 3.6 then v_run_nor := coalesce(v_run_nor, v_t[v_j]); v_nor := greatest(v_nor, v_t[v_i] - v_run_nor); else v_run_nor := null; end if;
    if v_sp >= 25 / 3.6 then v_run_veh := coalesce(v_run_veh, v_t[v_j]); v_veh := greatest(v_veh, v_t[v_i] - v_run_veh); else v_run_veh := null; end if;
  end loop;
  if v_veh >= 30 then
    v_flags := v_flags || jsonb_build_object('code', 'VEHICLE_BURST', 'severity', 'SEVERE', 'durationS', round(v_veh));
    v_score := v_score + 35;
  end if;
  if v_sev >= 120 then
    v_flags := v_flags || jsonb_build_object('code', 'SUSTAINED_SPEED', 'severity', 'SEVERE', 'durationS', round(v_sev));
    v_score := v_score + 35;
  elsif v_nor >= 180 then
    v_flags := v_flags || jsonb_build_object('code', 'SUSTAINED_SPEED', 'severity', 'HIGH', 'durationS', round(v_nor));
    v_score := v_score + 28;
  end if;
  if v_spikes > 3 then
    v_flags := v_flags || jsonb_build_object('code', 'GPS_TELEPORT', 'severity', 'HIGH', 'count', v_spikes);
    v_score := v_score + 20;
  end if;

  if v_gaps > 0 then
    v_flags := v_flags || jsonb_build_object('code', 'GPS_GAP', 'severity', case when v_gap_m > greatest(500, 0.25 * v_gps_m) then 'HIGH' else 'INFO' end,
      'count', v_gaps, 'durationS', round(v_gap_s), 'meters', round(v_gap_m));
  end if;
  v_moving := least(greatest(coalesce(p_moving_s, 0), 0), extract(epoch from (p_ended_at - p_started_at))::integer);
  v_distance := case when v_n >= 2 then round(v_gps_m) else greatest(coalesce(p_distance_m, 0), 0) end;
  v_pace := case when v_distance > 0 then round(v_moving / (v_distance / 1000.0)) else 0 end;

  -- Luật xác thực (xem ADR-007)
  if v_distance < 200 then
    v_status := 'REJECTED'; v_reason := 'Quá ngắn (< 200 m), không đủ điều kiện ghi nhận.';
  elsif v_n < 2 then
    v_status := 'PENDING'; v_score := greatest(v_score, 40);
    v_reason := 'Bài không có dữ liệu GPS — không đối chiếu được quãng đường.';
  elsif v_pace < (cfg->>'minValidPace')::numeric * 60 then
    v_status := 'PENDING'; v_score := greatest(v_score, 75);
    v_reason := 'Pace trung bình nhanh hơn 3:00/km — vượt khả năng chạy bộ.';
  elsif v_veh >= 30 then
    v_status := 'PENDING'; v_score := greatest(v_score, 85);
    v_reason := 'Di chuyển ≥ 25 km/h liên tục ' || round(v_veh) || ' giây — giống đi xe.';
  elsif v_sev >= 120 then
    v_status := 'PENDING'; v_score := greatest(v_score, 70);
    v_reason := 'Giữ tốc độ ≥ 20 km/h (pace 3:00) liên tục ' || round(v_sev) || ' giây.';
  elsif v_nor >= 180 then
    v_status := 'PENDING'; v_score := greatest(v_score, 65);
    v_reason := 'Giữ tốc độ ≥ 17 km/h (pace 3:32) liên tục ' || round(v_nor) || ' giây.';
  elsif v_spikes > 3 then
    v_status := 'PENDING'; v_score := greatest(v_score, 50);
    v_reason := 'Vị trí GPS nhảy xa bất thường ' || v_spikes || ' lần (> 43 km/h).';
  elsif v_gap_m > greatest(500, 0.25 * v_gps_m) then
    v_status := 'PENDING'; v_score := greatest(v_score, 40);
    v_reason := 'Mất tín hiệu GPS ' || greatest(1, round(v_gap_s / 60)) || ' phút — ' || round(v_gap_m / 1000.0, 2)
                || ' km được nối thẳng, không đối chiếu được tuyến (thường do tắt màn hình khi ghi bằng trình duyệt).';
  elsif p_distance_m > 0 and abs(p_distance_m - v_distance) > greatest(0.15 * v_distance, 100) then
    v_status := 'PENDING'; v_score := greatest(v_score, 45);
    v_reason := 'Quãng đường app gửi lên lệch nhiều so với tuyến GPS.';
  end if;
  if v_status = 'PENDING' then
    v_reason := left('Mức nghi vấn: ' || private.risk_label(private.risk_level(v_score)) || '. ' || v_reason
                     || ' Bài được tính sau khi ban quản trị CLB hoặc admin xác minh.', 500);
  end if;

  v_activity := gen_random_uuid();
  insert into public.activities (
    id, user_id, title, source, started_at, ended_at, elapsed_time_s, moving_time_s,
    distance_m, moving_distance_m, avg_pace_s, status, validation_status, validation_reason,
    risk_score, risk_level, risk_flags)
  values (
    v_activity, v_uid, left(coalesce(nullif(trim(p_title), ''), 'Buổi chạy'), 120),
    case when p_source in ('DIRECT_GPS', 'STRAVA', 'GARMIN') then p_source else 'DIRECT_GPS' end,
    p_started_at, p_ended_at, greatest(coalesce(p_elapsed_s, 0), v_moving), v_moving,
    v_distance, v_distance, v_pace,
    case v_status when 'APPROVED' then 'READY' when 'PENDING' then 'PROCESSING' else 'REJECTED' end,
    v_status, v_reason,
    least(v_score, 100), private.risk_level(v_score),
    case when jsonb_array_length(v_flags) > 0 then v_flags end);

  for v_p in select value from jsonb_array_elements(v_points) loop
    v_seq := v_seq + 1;
    insert into public.activity_track_points (activity_id, sequence, latitude, longitude, accuracy, altitude, speed, recorded_at)
    values (v_activity, v_seq, (v_p->>'latitude')::numeric, (v_p->>'longitude')::numeric,
            (v_p->>'accuracy')::numeric, (v_p->>'altitude')::numeric, (v_p->>'speed')::numeric,
            coalesce((v_p->>'recorded_at')::timestamptz, p_started_at));
  end loop;

  if v_status = 'APPROVED' then
    v_reward := (select jsonb_build_object('earned_xu', x.earned_xu, 'earned_xp', x.earned_xp)
                   from public.activities x where x.id = v_activity);         -- trigger trg_auto_reward đã thưởng
  end if;

  return json_build_object(
    'success', true, 'activity_id', v_activity,
    'validation_status', v_status, 'validation_reason', v_reason,
    'distance_m', v_distance,
    'earned_xp', coalesce((v_reward->>'earned_xp')::integer, 0),
    'earned_xu', coalesce((v_reward->>'earned_xu')::numeric, 0));
end $$;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001006600_gps_track_distance.sql
-- ===================================================================
-- 006600: Quãng đường bài chạy trong app = đúng con số app đo (GPS-3).
-- Trước đây máy chủ cộng khoảng cách giữa các điểm tuyến. Điểm GPS luôn có nhiễu (rung ±5–15 m) nên cách cộng này
-- DƯ 2–11 % (mô phỏng: phố cao tầng +10,7 %), trong khi app đã hiệu chỉnh bằng vận tốc Doppler (lệch < 2 %).
-- Nay: mỗi điểm mang quãng đường tích luỹ app đo (distance_m). Máy chủ nhận từng đoạn nhưng KẸP theo hình học tuyến:
--   đoạn app báo ≤ 1,1 × khoảng cách thẳng giữa hai điểm + 3 m, và tổng ≤ tổng khoảng cách thẳng
--   → không thể khai khống quá tuyến GPS thật; app cũ (không gửi distance_m) dùng cách cũ.
-- Kèm: lưu quãng đường tích luỹ từng điểm + tính TỪNG KM ngay trên máy chủ (activity_details.splits).
-- Chạy lại nhiều lần vẫn an toàn.

alter table public.activity_track_points add column if not exists distance_m numeric;

create or replace function public.submit_and_process_activity(
  p_title text, p_source text, p_started_at timestamptz, p_ended_at timestamptz,
  p_elapsed_s integer, p_moving_s integer, p_distance_m numeric, p_avg_pace_s integer, p_track_points jsonb
) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := private.require_uid();
  cfg jsonb := private.economy_config();
  v_points jsonb := coalesce(p_track_points, '[]'::jsonb);
  v_n integer;
  v_gps_m numeric := 0;
  -- Quãng đường theo app (đã kẹp) + từng km
  v_trk_m numeric := 0;
  v_cd numeric;
  v_cd_prev numeric;
  v_step numeric;
  v_seg_t numeric;
  v_sd numeric := 0;
  v_st numeric := 0;
  v_over numeric;
  v_over_t numeric;
  v_alt0 numeric;
  v_splits jsonb := '[]'::jsonb;
  v_spikes integer := 0;
  v_prev jsonb;
  v_p jsonb;
  v_seg numeric;
  v_dt numeric;
  v_distance numeric;
  v_moving integer;
  v_pace integer;
  v_status text := 'APPROVED';
  v_reason text := 'Hoạt động hợp lệ qua kiểm tra tự động.';
  v_activity uuid;
  v_seq integer := 0;
  v_reward jsonb;
  -- Tốc độ duy trì (quãng đường trong cửa sổ 30 s) — cùng luật với features/activity/model/fraud.ts
  v_t numeric[] := '{}';
  v_c numeric[] := '{}';
  v_t0 timestamptz;
  v_i integer; v_j integer := 1; v_w numeric; v_sp numeric;
  v_run_sev numeric; v_run_nor numeric; v_run_veh numeric;
  v_sev numeric := 0; v_nor numeric := 0; v_veh numeric := 0;
  v_flags jsonb := '[]'::jsonb;
  -- Mất tín hiệu GPS: đoạn > 60 giây và > 150 m giữa hai điểm liên tiếp (tắt màn hình, hầm…) = tuyến bị nối thẳng
  v_gaps integer := 0;
  v_gap_s numeric := 0;
  v_gap_m numeric := 0;
  v_score integer := 0;
begin
  -- Kiểm tra đầu vào cơ bản
  if p_started_at is null or p_ended_at is null or p_ended_at <= p_started_at then raise exception 'INVALID_TIME_RANGE'; end if;
  if p_started_at > now() + interval '5 minutes' then raise exception 'INVALID_TIME_RANGE'; end if;
  if p_ended_at - p_started_at > interval '24 hours' then raise exception 'ACTIVITY_TOO_LONG'; end if;
  if jsonb_typeof(v_points) <> 'array' then raise exception 'INVALID_TRACK_POINTS'; end if;
  v_n := jsonb_array_length(v_points);
  if v_n > 20000 then raise exception 'TOO_MANY_TRACK_POINTS'; end if;

  -- Chống gửi trùng / chồng thời gian với bài chạy khác
  if exists (select 1 from public.activities
              where user_id = v_uid and started_at < p_ended_at and ended_at > p_started_at) then
    raise exception 'ACTIVITY_DUPLICATE';
  end if;
  if (select count(*) from public.activities where user_id = v_uid and created_at > now() - interval '1 day') >= 20 then
    raise exception 'RATE_LIMITED';
  end if;

  -- Tính lại quãng đường từ GPS (không tin số client gửi)
  for v_p in select value from jsonb_array_elements(v_points) loop
    v_cd := case when jsonb_typeof(v_p->'distance_m') = 'number' then (v_p->>'distance_m')::numeric end;
    if v_prev is null then v_alt0 := case when jsonb_typeof(v_p->'altitude') = 'number' then (v_p->>'altitude')::numeric end; end if;
    if v_prev is not null then
      v_seg := private.haversine_m((v_prev->>'latitude')::numeric, (v_prev->>'longitude')::numeric,
                                   (v_p->>'latitude')::numeric, (v_p->>'longitude')::numeric);
      v_dt := extract(epoch from ((v_p->>'recorded_at')::timestamptz - (v_prev->>'recorded_at')::timestamptz));
      if v_dt > 0 and v_seg / v_dt > 12 then v_spikes := v_spikes + 1; end if;   -- > 43 km/h
      if v_dt > 60 and v_seg > 150 then v_gaps := v_gaps + 1; v_gap_s := v_gap_s + v_dt; v_gap_m := v_gap_m + v_seg; end if;
      v_gps_m := v_gps_m + coalesce(v_seg, 0);
      -- Đoạn theo app: có distance_m ở cả hai điểm → dùng, kẹp [0, 1,1 × đoạn thẳng + 3 m]; thiếu → đoạn thẳng
      v_step := case when v_cd is not null and v_cd_prev is not null
                     then least(greatest(v_cd - v_cd_prev, 0), 1.1 * coalesce(v_seg, 0) + 3)
                     else coalesce(v_seg, 0) end;
      v_trk_m := v_trk_m + v_step;
      -- Từng km: đoạn ≤ 30 s tính đủ giờ; dài hơn (đứng chờ / mất tín hiệu) chỉ tính phần di chuyển ước lượng ≥ 1,5 m/s
      if v_dt > 0 then
        v_seg_t := case when v_dt <= 30 then v_dt else least(v_dt, v_step / 1.5) end;
        v_sd := v_sd + v_step; v_st := v_st + v_seg_t;
        while v_sd >= 1000 loop
          v_over := v_sd - 1000;
          v_over_t := case when v_step > 0 then v_seg_t * v_over / v_step else 0 end;
          v_splits := v_splits || jsonb_build_object('distance_m', 1000, 'moving_s', greatest(0, round(v_st - v_over_t)),
            'elev_m', case when v_alt0 is not null and jsonb_typeof(v_p->'altitude') = 'number' then round(((v_p->>'altitude')::numeric - v_alt0) * 10) / 10 end,
            'hr', null);
          v_sd := v_over; v_st := v_over_t;
          v_alt0 := case when jsonb_typeof(v_p->'altitude') = 'number' then (v_p->>'altitude')::numeric end;
        end loop;
      end if;
    end if;
    v_cd_prev := v_cd;
    v_t0 := coalesce(v_t0, (v_p->>'recorded_at')::timestamptz, p_started_at);
    v_t := v_t || extract(epoch from (coalesce((v_p->>'recorded_at')::timestamptz, v_t0) - v_t0));
    v_c := v_c || v_trk_m;
    v_prev := v_p;
  end loop;

  -- Đoạn liên tục dài nhất có tốc độ ≥ 20 km/h, ≥ 17 km/h, ≥ 25 km/h
  for v_i in 2 .. coalesce(array_length(v_t, 1), 0) loop
    while v_j < v_i and v_t[v_i] - v_t[v_j] > 30 loop v_j := v_j + 1; end loop;
    v_w := v_t[v_i] - v_t[v_j];
    if v_w < 15 then continue; end if;
    v_sp := (v_c[v_i] - v_c[v_j]) / v_w;
    if v_sp >= 20 / 3.6 then v_run_sev := coalesce(v_run_sev, v_t[v_j]); v_sev := greatest(v_sev, v_t[v_i] - v_run_sev); else v_run_sev := null; end if;
    if v_sp >= 17 / 3.6 then v_run_nor := coalesce(v_run_nor, v_t[v_j]); v_nor := greatest(v_nor, v_t[v_i] - v_run_nor); else v_run_nor := null; end if;
    if v_sp >= 25 / 3.6 then v_run_veh := coalesce(v_run_veh, v_t[v_j]); v_veh := greatest(v_veh, v_t[v_i] - v_run_veh); else v_run_veh := null; end if;
  end loop;
  if v_veh >= 30 then
    v_flags := v_flags || jsonb_build_object('code', 'VEHICLE_BURST', 'severity', 'SEVERE', 'durationS', round(v_veh));
    v_score := v_score + 35;
  end if;
  if v_sev >= 120 then
    v_flags := v_flags || jsonb_build_object('code', 'SUSTAINED_SPEED', 'severity', 'SEVERE', 'durationS', round(v_sev));
    v_score := v_score + 35;
  elsif v_nor >= 180 then
    v_flags := v_flags || jsonb_build_object('code', 'SUSTAINED_SPEED', 'severity', 'HIGH', 'durationS', round(v_nor));
    v_score := v_score + 28;
  end if;
  if v_spikes > 3 then
    v_flags := v_flags || jsonb_build_object('code', 'GPS_TELEPORT', 'severity', 'HIGH', 'count', v_spikes);
    v_score := v_score + 20;
  end if;

  if v_gaps > 0 then
    v_flags := v_flags || jsonb_build_object('code', 'GPS_GAP', 'severity', case when v_gap_m > greatest(500, 0.25 * v_gps_m) then 'HIGH' else 'INFO' end,
      'count', v_gaps, 'durationS', round(v_gap_s), 'meters', round(v_gap_m));
  end if;
  v_moving := least(greatest(coalesce(p_moving_s, 0), 0), extract(epoch from (p_ended_at - p_started_at))::integer);
  v_distance := case when v_n >= 2 then round(least(v_trk_m, v_gps_m)) else greatest(coalesce(p_distance_m, 0), 0) end;
  v_pace := case when v_distance > 0 then round(v_moving / (v_distance / 1000.0)) else 0 end;

  -- Luật xác thực (xem ADR-007)
  if v_distance < 200 then
    v_status := 'REJECTED'; v_reason := 'Quá ngắn (< 200 m), không đủ điều kiện ghi nhận.';
  elsif v_n < 2 then
    v_status := 'PENDING'; v_score := greatest(v_score, 40);
    v_reason := 'Bài không có dữ liệu GPS — không đối chiếu được quãng đường.';
  elsif v_pace < (cfg->>'minValidPace')::numeric * 60 then
    v_status := 'PENDING'; v_score := greatest(v_score, 75);
    v_reason := 'Pace trung bình nhanh hơn 3:00/km — vượt khả năng chạy bộ.';
  elsif v_veh >= 30 then
    v_status := 'PENDING'; v_score := greatest(v_score, 85);
    v_reason := 'Di chuyển ≥ 25 km/h liên tục ' || round(v_veh) || ' giây — giống đi xe.';
  elsif v_sev >= 120 then
    v_status := 'PENDING'; v_score := greatest(v_score, 70);
    v_reason := 'Giữ tốc độ ≥ 20 km/h (pace 3:00) liên tục ' || round(v_sev) || ' giây.';
  elsif v_nor >= 180 then
    v_status := 'PENDING'; v_score := greatest(v_score, 65);
    v_reason := 'Giữ tốc độ ≥ 17 km/h (pace 3:32) liên tục ' || round(v_nor) || ' giây.';
  elsif v_spikes > 3 then
    v_status := 'PENDING'; v_score := greatest(v_score, 50);
    v_reason := 'Vị trí GPS nhảy xa bất thường ' || v_spikes || ' lần (> 43 km/h).';
  elsif v_gap_m > greatest(500, 0.25 * v_gps_m) then
    v_status := 'PENDING'; v_score := greatest(v_score, 40);
    v_reason := 'Mất tín hiệu GPS ' || greatest(1, round(v_gap_s / 60)) || ' phút — ' || round(v_gap_m / 1000.0, 2)
                || ' km được nối thẳng, không đối chiếu được tuyến (thường do tắt màn hình khi ghi bằng trình duyệt).';
  elsif p_distance_m > 0 and abs(p_distance_m - v_distance) > greatest(0.15 * v_distance, 100) then
    v_status := 'PENDING'; v_score := greatest(v_score, 45);
    v_reason := 'Quãng đường app gửi lên lệch nhiều so với tuyến GPS.';
  end if;
  if v_status = 'PENDING' then
    v_reason := left('Mức nghi vấn: ' || private.risk_label(private.risk_level(v_score)) || '. ' || v_reason
                     || ' Bài được tính sau khi ban quản trị CLB hoặc admin xác minh.', 500);
  end if;

  v_activity := gen_random_uuid();
  insert into public.activities (
    id, user_id, title, source, started_at, ended_at, elapsed_time_s, moving_time_s,
    distance_m, moving_distance_m, avg_pace_s, status, validation_status, validation_reason,
    risk_score, risk_level, risk_flags)
  values (
    v_activity, v_uid, left(coalesce(nullif(trim(p_title), ''), 'Buổi chạy'), 120),
    case when p_source in ('DIRECT_GPS', 'STRAVA', 'GARMIN') then p_source else 'DIRECT_GPS' end,
    p_started_at, p_ended_at, greatest(coalesce(p_elapsed_s, 0), v_moving), v_moving,
    v_distance, v_distance, v_pace,
    case v_status when 'APPROVED' then 'READY' when 'PENDING' then 'PROCESSING' else 'REJECTED' end,
    v_status, v_reason,
    least(v_score, 100), private.risk_level(v_score),
    case when jsonb_array_length(v_flags) > 0 then v_flags end);

  for v_p in select value from jsonb_array_elements(v_points) loop
    v_seq := v_seq + 1;
    insert into public.activity_track_points (activity_id, sequence, latitude, longitude, accuracy, altitude, speed, recorded_at, distance_m)
    values (v_activity, v_seq, (v_p->>'latitude')::numeric, (v_p->>'longitude')::numeric,
            (v_p->>'accuracy')::numeric, (v_p->>'altitude')::numeric, (v_p->>'speed')::numeric,
            coalesce((v_p->>'recorded_at')::timestamptz, p_started_at), round(v_c[v_seq], 1));
  end loop;

  -- Từng km (km lẻ cuối ≥ 100 m) — màn chi tiết bài chạy đọc thẳng, khớp quãng đường đã lưu
  if v_n >= 2 then
    if v_sd >= 100 and v_st > 0 then
      v_splits := v_splits || jsonb_build_object('distance_m', round(v_sd), 'moving_s', round(v_st), 'elev_m', null, 'hr', null);
    end if;
    insert into public.activity_details (activity_id, splits, start_lat, start_lng, detailed)
    values (v_activity, v_splits, (v_points->0->>'latitude')::numeric, (v_points->0->>'longitude')::numeric, true)
    on conflict (activity_id) do update set splits = excluded.splits;
  end if;

  if v_status = 'APPROVED' then
    v_reward := (select jsonb_build_object('earned_xu', x.earned_xu, 'earned_xp', x.earned_xp)
                   from public.activities x where x.id = v_activity);         -- trigger trg_auto_reward đã thưởng
  end if;

  return json_build_object(
    'success', true, 'activity_id', v_activity,
    'validation_status', v_status, 'validation_reason', v_reason,
    'distance_m', v_distance,
    'earned_xp', coalesce((v_reward->>'earned_xp')::integer, 0),
    'earned_xu', coalesce((v_reward->>'earned_xu')::numeric, 0));
end $$;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001006700_strava_display_compliance.sql
-- ===================================================================
-- 006700: Tuân thủ Thoả thuận API Strava (hiệu lực 11/11/2024): dữ liệu Strava của một người chỉ được hiển thị cho
-- CHÍNH người đó trong app bên thứ ba. Bài đồng bộ từ Strava: người khác chỉ thấy số tổng (quãng đường, thời gian, pace)
-- — ẩn bản đồ tuyến, từng km, nhịp tim, nhịp bước, calo, thiết bị. Chủ bài vẫn xem đầy đủ.
-- Bài ghi bằng app RaceHub / nhập tay không bị ảnh hưởng. Chạy lại nhiều lần vẫn an toàn.
-- Còn lại cần chủ sản phẩm quyết định (xem docs/RUI_RO_VA_PHONG_NGUA.md): quãng đường Strava trên BXH / bảng tin CLB.

create or replace function public.activity_detail(p_activity_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  a public.activities := (select x from public.activities x where x.id = p_activity_id);
  d public.activity_details := (select x from public.activity_details x where x.activity_id = p_activity_id);
  v_mine boolean;
  v_map boolean;
  -- Bài đồng bộ từ Strava, người xem không phải chủ bài → chỉ số tổng, không chi tiết (API Agreement Strava 11/2024)
  v_strava_other boolean;
begin
  if a.id is null or coalesce(a.status, '') = 'DELETED' then raise exception 'ACTIVITY_NOT_FOUND'; end if;
  v_mine := a.user_id = v_uid;
  if not v_mine and not (public.can_view_activities(a.user_id) and public.activity_is_countable(a.status, a.validation_status)) then
    raise exception 'ACTIVITY_NOT_FOUND';
  end if;
  v_strava_other := not v_mine and a.source = 'STRAVA';
  v_map := v_mine or (not v_strava_other and public.can_view_map(a.user_id));

  return jsonb_build_object(
    'id', a.id, 'title', a.title, 'source', a.source, 'sport_type', a.sport_type, 'device_name', case when not v_strava_other then a.device_name end,
    'started_at', a.started_at, 'distance_m', coalesce(a.moving_distance_m, a.distance_m, 0),
    'moving_s', coalesce(a.moving_time_s, a.elapsed_time_s, 0), 'elapsed_s', coalesce(a.elapsed_time_s, 0),
    'avg_pace_s', a.avg_pace_s, 'elevation_gain_m', coalesce(a.elevation_gain_m, 0),
    'avg_heartrate', case when not v_strava_other then a.avg_heartrate end,
    'max_heartrate', case when not v_strava_other then d.max_heartrate end,
    'avg_cadence', case when not v_strava_other then d.avg_cadence end,
    'calories', case when not v_strava_other then d.calories end,
    'strava_limited', v_strava_other,
    'validation_status', a.validation_status,
    'validation_reason', case when v_mine then a.validation_reason end,
    'earned_xu', a.earned_xu, 'earned_xp', a.earned_xp,
    'is_mine', v_mine,
    'owner', (select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url, 'level', p.level)
                from public.profiles p where p.id = a.user_id),
    'map_allowed', v_map,
    'polyline', case when v_map then d.polyline end,
    -- Bài GPS trong app: điểm GPS rút gọn ≤ ~1000 điểm [lat, lng, giây kể từ lúc bắt đầu, độ cao]
    'points', case when v_map and d.polyline is null then (
        select jsonb_agg(jsonb_build_array(s.latitude, s.longitude,
                 round(extract(epoch from (s.recorded_at - a.started_at))), s.altitude) order by s.sequence)
          from (select t.latitude, t.longitude, t.recorded_at, t.altitude, t.sequence,
                       row_number() over (order by t.sequence) as rn, count(*) over () as cnt
                  from public.activity_track_points t where t.activity_id = a.id) s
         where s.rn % greatest(ceil(s.cnt / 1000.0)::int, 1) = 0 or s.rn = s.cnt) end,
    'splits', case when not v_strava_other then d.splits end,
    'needs_detail', v_mine and a.source = 'STRAVA' and not coalesce(d.detailed, false),
    'challenges', case when v_mine then (
        select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'counted_m', e.counted_m) order by e.created_at), '[]'::jsonb)
          from public.challenge_progress_events e join public.challenges c on c.id = e.challenge_id
         where e.activity_id = a.id) else '[]'::jsonb end,
    'cheers', (select jsonb_build_object('count', count(*), 'total', coalesce(sum(ch.amount), 0))
                 from public.cheers ch where ch.activity_id = a.id),
    -- So với 10 bài trước đó của chính người chạy (để hiện "dài hơn / nhanh hơn thường lệ")
    'compare', (select jsonb_build_object(
          'runs', count(*),
          'avg_distance_m', round(avg(coalesce(x.moving_distance_m, x.distance_m))),
          'avg_pace_s', round(avg(x.avg_pace_s) filter (where x.avg_pace_s > 0)),
          'longest_30d', coalesce(a.distance_m >= (select max(y.distance_m) from public.activities y
                              where y.user_id = a.user_id and y.id <> a.id and public.activity_is_countable(y.status, y.validation_status)
                                and y.started_at > a.started_at - interval '30 days' and y.started_at <= a.started_at), true))
        from (select z.*, row_number() over (order by z.started_at desc) as rn
                from public.activities z
               where z.user_id = a.user_id and z.id <> a.id and z.started_at < a.started_at
                 and public.activity_is_countable(z.status, z.validation_status)) x
       where x.rn <= 10)
  );
end $$;

revoke all on function public.activity_detail(uuid) from public, anon;
grant execute on function public.activity_detail(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001006800_account_deletion.sql
-- ===================================================================
-- 006800: Xoá tài khoản ngay trong app.
-- Bắt buộc với app có đăng ký tài khoản trên App Store (Apple, mục 5.1.1(v)) và Google Play; đồng thời đáp ứng quyền
-- yêu cầu xoá dữ liệu của Luật Bảo vệ dữ liệu cá nhân 2025 (hiệu lực 01/01/2026; dữ liệu vị trí là dữ liệu nhạy cảm).
--
-- Cách xoá: XOÁ dữ liệu cá nhân + ẨN DANH phần còn lại, giữ bản ghi giao dịch (đơn hàng, sổ Xu) ở dạng ẩn danh
-- vì nghĩa vụ kế toán / đối soát. Sau RPC này, route /api/account/delete xoá mềm tài khoản đăng nhập (auth)
-- — email được làm rối, người dùng đăng ký lại được bằng chính email đó như tài khoản mới.
--
-- Chặn: quản trị viên (phải được gỡ quyền trước) và chủ nhiệm CLB còn thành viên khác (chuyển quyền trước).
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT. Chạy lại nhiều lần vẫn an toàn.

alter table public.profiles add column if not exists deleted_at timestamptz;

create or replace function public.delete_my_account(p_confirm text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_p public.profiles := (select x from public.profiles x where x.id = v_uid);
  v_runs integer;
begin
  if coalesce(upper(trim(p_confirm)), '') not in ('XOÁ', 'XÓA', 'XOA') then raise exception 'CONFIRM_REQUIRED'; end if;
  if v_p.id is null then raise exception 'PROFILE_NOT_FOUND'; end if;
  if v_p.deleted_at is not null then return jsonb_build_object('ok', true, 'already', true); end if;
  if coalesce(v_p.is_admin, false) or coalesce(v_p.role, '') in ('ADMIN', 'SUPER_ADMIN') then raise exception 'ADMIN_CANNOT_DELETE'; end if;
  if exists (select 1 from public.clubs c where c.owner_id = v_uid
               and exists (select 1 from public.club_members m where m.club_id = c.id and m.user_id <> v_uid and m.status = 'ACTIVE')) then
    raise exception 'TRANSFER_CLUB_FIRST';
  end if;

  -- 1. Bài chạy: xoá tuyến GPS + chi tiết (dữ liệu vị trí), ẩn bài (không còn hiện ở đâu)
  delete from public.activity_track_points t using public.activities a where t.activity_id = a.id and a.user_id = v_uid;
  delete from public.activity_details d using public.activities a where d.activity_id = a.id and a.user_id = v_uid;
  update public.activities set status = 'DELETED', title = 'Buổi chạy', device_name = null where user_id = v_uid;
  v_runs := (select count(*) from public.activities where user_id = v_uid);

  -- 2. Dữ liệu cá nhân / thiết bị / vị trí
  delete from public.profile_details where user_id = v_uid;
  delete from public.push_subscriptions where user_id = v_uid;
  delete from public.push_settings where user_id = v_uid;
  delete from public.notification_settings where user_id = v_uid;
  delete from public.notifications where user_id = v_uid;
  delete from public.runner_discovery_settings where user_id = v_uid;
  delete from public.runner_location_presence where user_id = v_uid;
  delete from public.runner_nearby_searches where user_id = v_uid;
  delete from public.connected_accounts where user_id = v_uid;
  delete from public.content_bookmarks where user_id = v_uid;
  delete from public.content_read_history where user_id = v_uid;
  delete from public.content_user_events where user_id = v_uid;
  delete from public.club_message_reads where user_id = v_uid;
  delete from public.bib_listings where user_id = v_uid;
  delete from public.bib_contact_reveals where user_id = v_uid;
  delete from public.content_staff where user_id = v_uid;
  update public.content_authors set user_id = null where user_id = v_uid;
  update public.partners set status = 'HIDDEN', contacts = '{}'::jsonb, address = null where owner_id = v_uid;
  update public.challenge_honor_prefs set photo_url = null, hidden = true where user_id = v_uid;

  -- 3. Rời mọi CLB (CLB chỉ còn mình mình thì CLB giữ nguyên, không còn thành viên)
  delete from public.club_members where user_id = v_uid;

  -- 4. Hồ sơ: ẩn danh (bài viết / tin nhắn cũ trong CLB hiện "Người dùng đã xoá")
  update public.profiles set
    display_name = 'Người dùng đã xoá', avatar_url = null, bio = null, gender = null,
    strava_connected = false, strava_access_token = null, strava_refresh_token = null,
    strava_token_expires_at = null, strava_athlete_id = null,
    gift_wall_public = false, referral_code = null,
    banned_at = coalesce(banned_at, now()), banned_reason = 'ACCOUNT_DELETED',
    deleted_at = now(), updated_at = now()
  where id = v_uid;

  return jsonb_build_object('ok', true, 'activities_hidden', v_runs);
end $$;

revoke all on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001003500_system_check.sql
-- ===================================================================
-- 003500: Trang "Kiểm tra hệ thống" cho admin.
-- admin_system_check() dò từng migration đã chạy chưa (qua một đối tượng đặc trưng của file đó),
-- kho ảnh, pg_net / cấu hình push, và dữ liệu bất thường (thử thách / trận CLB quá hạn chưa tất toán,
-- hàng đợi push bị kẹt, bài chờ duyệt). Chỉ đọc, không đổi gì. Chạy lại nhiều lần vẫn an toàn.

create or replace function private.sc_fn(p_schema text, p_name text) returns boolean
language sql stable as $$
  select exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = p_schema and p.proname = p_name)
$$;

create or replace function private.sc_col(p_table text, p_col text) returns boolean
language sql stable as $$
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = p_table and column_name = p_col)
$$;

create or replace function public.admin_system_check() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_mig jsonb;
  v_buckets jsonb;
  v_stats jsonb := '{}'::jsonb;
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;

  v_mig := jsonb_build_array(
    jsonb_build_object('file', '20261001000100', 'label', 'Khóa khẩn cấp quyền ghi', 'ok', not has_table_privilege('authenticated', 'public.clubs', 'INSERT')),
    jsonb_build_object('file', '20261001000200', 'label', 'Sổ cái Xu', 'ok', private.sc_fn('private', 'ledger_post')),
    jsonb_build_object('file', '20261001000300', 'label', 'RPC an toàn', 'ok', private.sc_fn('private', 'require_admin')),
    jsonb_build_object('file', '20261001000400', 'label', 'Nhận bài chạy từ Strava', 'ok', private.sc_fn('public', 'ingest_provider_activity')),
    jsonb_build_object('file', '20261001000500', 'label', 'CLB: bảng tin, chat, thông báo', 'ok', private.sc_fn('private', 'notify')),
    jsonb_build_object('file', '20261001000600', 'label', 'Thử thách', 'ok', private.sc_fn('private', 'challenge_apply_activity')),
    jsonb_build_object('file', '20261001000700', 'label', 'Kinh tế Xu + admin', 'ok', private.sc_fn('public', 'economy_policy')),
    jsonb_build_object('file', '20261001000800', 'label', 'Lớp game', 'ok', private.sc_fn('private', 'game_config')),
    jsonb_build_object('file', '20261001000900', 'label', 'Cửa hàng nhân vật', 'ok', private.sc_fn('private', 'character_look')),
    jsonb_build_object('file', '20261001001000', 'label', 'Nhân vật 2D', 'ok', private.sc_col('avatar_items', 'render_kind')),
    jsonb_build_object('file', '20261001001100', 'label', 'Bỏ cột 3D', 'ok', not private.sc_col('avatar_items', 'model_key')),
    jsonb_build_object('file', '20261001001200', 'label', 'Admin vật phẩm', 'ok', private.sc_fn('public', 'admin_save_avatar_item')),
    jsonb_build_object('file', '20261001001300', 'label', 'Bộ mũ / băng đô', 'ok', exists (select 1 from public.avatar_items where code = 'hat_cap_tempo_black')),
    jsonb_build_object('file', '20261001001400', 'label', 'Hồ sơ chi tiết', 'ok', to_regclass('public.profile_details') is not null),
    jsonb_build_object('file', '20261001001500', 'label', 'Sự kiện + quỹ CLB', 'ok', private.sc_fn('private', 'event_json')),
    jsonb_build_object('file', '20261001001600', 'label', 'QR ngân hàng CLB', 'ok', private.sc_col('clubs', 'bank_qr_url')),
    jsonb_build_object('file', '20261001001700', 'label', 'Thông báo đẩy', 'ok', private.sc_fn('private', 'push_kick')),
    jsonb_build_object('file', '20261001001800', 'label', 'Onboarding', 'ok', private.sc_col('profiles', 'onboarded_at')),
    jsonb_build_object('file', '20261001001900', 'label', 'Chi tiết bài chạy', 'ok', to_regclass('public.activity_details') is not null),
    jsonb_build_object('file', '20261001002000', 'label', 'Mục tiêu tự đăng ký', 'ok', private.sc_fn('public', 'set_my_pledge')),
    jsonb_build_object('file', '20261001002100', 'label', 'CLB không giới hạn thành viên', 'ok',
      (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'clubs' and column_name = 'member_limit') = '1000000'),
    jsonb_build_object('file', '20261001002200', 'label', 'Tự chia đội', 'ok', private.sc_col('challenges', 'pledge_team_size')),
    jsonb_build_object('file', '20261001002300', 'label', 'Chống gian lận', 'ok', private.sc_col('activities', 'risk_score')),
    jsonb_build_object('file', '20261001002400', 'label', 'Duyệt bài nghi vấn', 'ok', private.sc_fn('private', 'can_review_activity')),
    jsonb_build_object('file', '20261001002500', 'label', 'Bộ đồ NBNR', 'ok', exists (select 1 from public.avatar_items where code = 'bottom_nbnr_club')),
    jsonb_build_object('file', '20261001002600', 'label', 'CLB đấu CLB', 'ok', private.sc_fn('public', 'create_club_battle')),
    jsonb_build_object('file', '20261001002700', 'label', 'Giải chạy ảo', 'ok', to_regclass('public.virtual_races') is not null),
    jsonb_build_object('file', '20261001002800', 'label', 'CLB Pro', 'ok', private.sc_col('clubs', 'plan')),
    jsonb_build_object('file', '20261001002900', 'label', 'e-BIB + kho ảnh race-media', 'ok', private.sc_col('virtual_races', 'bib_design')),
    jsonb_build_object('file', '20261001003000', 'label', 'BIB: ảnh có sẵn', 'ok', private.sc_fn('private', 'bib_num')),
    jsonb_build_object('file', '20261001003100', 'label', 'Tìm kiếm không dấu', 'ok', private.sc_fn('private', 'search_key')),
    jsonb_build_object('file', '20261001003200', 'label', 'BIB: 3 khung chữ', 'ok', private.sc_fn('private', 'bib_box')),
    jsonb_build_object('file', '20261001003300', 'label', 'Gợi ý tìm kiếm + sửa kho ảnh', 'ok', private.sc_fn('public', 'can_upload_race_media')),
    jsonb_build_object('file', '20261001003400', 'label', 'Chặn lộ mã mời CLB', 'ok', not has_column_privilege('authenticated', 'public.clubs', 'invite_code', 'SELECT')),
    jsonb_build_object('file', '20261001003500', 'label', 'Kiểm tra hệ thống', 'ok', true),
    jsonb_build_object('file', '20261001003600', 'label', 'Thách đấu nhiều CLB', 'ok', to_regclass('public.club_cups') is not null),
    jsonb_build_object('file', '20261001003700', 'label', 'Kinh tế v2 (1 Xu = 100đ)', 'ok', private.sc_fn('private', 'run_xu_for_km')),
    jsonb_build_object('file', '20261001003800', 'label', 'Gói VIP / Pro, đơn hàng', 'ok', to_regclass('public.orders') is not null),
    jsonb_build_object('file', '20261001003900', 'label', 'Quà tặng', 'ok', to_regclass('public.gift_catalog') is not null),
    jsonb_build_object('file', '20261001004000', 'label', 'Phân tích VIP + chỉ số kinh tế', 'ok', to_regprocedure('public.admin_economy_metrics(integer)') is not null),
    jsonb_build_object('file', '20261001004100', 'label', 'Bảo mật + nhật ký không xóa được', 'ok', private.sc_fn('private', 'append_only')),
    jsonb_build_object('file', '20261001004200', 'label', 'Phong độ + chào mừng trở lại', 'ok', to_regprocedure('public.runner_form(uuid)') is not null),
    jsonb_build_object('file', '20261001004300', 'label', 'Nhiệm vụ do admin tạo + khuyến mãi', 'ok', to_regclass('public.promotions') is not null),
    jsonb_build_object('file', '20261001004400', 'label', 'Thông báo hệ thống + nhật ký lỗi', 'ok', to_regprocedure('public.system_notice()') is not null),
    jsonb_build_object('file', '20261001004500', 'label', 'Báo "Bài chạy đã về"', 'ok', private.sc_fn('private', 'run_synced_notify')),
    jsonb_build_object('file', '20261001004600', 'label', 'Nhiệm vụ v2 (bậc, cộng đồng, gợi ý)', 'ok', private.sc_fn('private', 'quest_finish')),
    jsonb_build_object('file', '20261001004700', 'label', 'Ví Tỏa sáng (đổi quà, bậc tỏa sáng)', 'ok', to_regclass('public.shine_shop') is not null),
    jsonb_build_object('file', '20261001004800', 'label', 'Thiết kế BIB theo lớp + giấy chứng nhận', 'ok', private.sc_col('virtual_races', 'cert_design')),
    jsonb_build_object('file', '20261001004900', 'label', 'Vinh danh thử thách (CLB Pro / VIP)', 'ok', to_regclass('public.challenge_honors') is not null),
    jsonb_build_object('file', '20261001005000', 'label', 'Sửa trao quyền Chủ nhiệm CLB', 'ok',
      exists (select 1 from pg_proc where proname = 'transfer_club_ownership' and prosrc like '%CAPTAIN%')),
    jsonb_build_object('file', '20261001005100', 'label', 'Khuyến mãi vật phẩm (Xu)', 'ok', to_regclass('public.item_promotions') is not null),
    jsonb_build_object('file', '20261001005200', 'label', 'Voucher tài trợ (thử thách / nhiệm vụ)', 'ok', to_regclass('public.voucher_campaigns') is not null),
    jsonb_build_object('file', '20261001005300', 'label', 'Chợ Runner (hồ sơ HLV / Shop / Dịch vụ đã xác minh)', 'ok', to_regclass('public.partners') is not null),
    jsonb_build_object('file', '20261001005400', 'label', 'Thể lệ thử thách + danh sách bỏ thử thách đã hủy', 'ok', to_regprocedure('public.set_challenge_rules(uuid, jsonb)') is not null),
    jsonb_build_object('file', '20261001005500', 'label', 'Đăng nhập Google / Apple + mã giới thiệu + xem trước lời mời', 'ok', to_regprocedure('public.my_referral()') is not null),
    jsonb_build_object('file', '20261001005600', 'label', 'Quản trị: việc cần xử lý, người dùng, thử thách, nhật ký', 'ok', to_regprocedure('public.admin_inbox()') is not null),
    jsonb_build_object('file', '20261001005700', 'label', 'Gỡ ràng buộc vai trò CLB cũ (sửa lỗi trao quyền Chủ nhiệm)',
      'ok', not exists (select 1 from pg_constraint where conname = 'club_members_role_check' and conrelid = 'public.club_members'::regclass)),
    jsonb_build_object('file', '20261001005800', 'label', 'Trang phục: bộ sưu tập, vòng đời, điều kiện mở khóa, vùng in, đồng phục CLB',
      'ok', to_regprocedure('public.request_club_uniform(uuid, jsonb)') is not null),
    jsonb_build_object('file', '20261001005900', 'label', 'Bộ đồng phục: áo + quần + tất + giày, họa tiết, mặc cả bộ',
      'ok', to_regprocedure('private.clean_design(jsonb, text)') is not null),
    jsonb_build_object('file', '20261001006000', 'label', 'Bộ sưu tập nhân vật (dáng) + thiết kế in kéo thả, độ đậm màu, ảnh vải',
      'ok', to_regprocedure('private.character_bodies()') is not null),
    jsonb_build_object('file', '20261001006100', 'label', 'Quanh đây: runner gần bạn (ô ~1 km), kết nối, rủ chạy, buổi chạy công khai, chặn / báo cáo',
      'ok', to_regprocedure('public.nearby_runners(jsonb)') is not null),
    jsonb_build_object('file', '20261001006200', 'label', 'RaceHub Knowledge: kiến thức & tin tức, CMS có duyệt chuyên môn, tiến độ đọc, chuỗi bài → huy hiệu',
      'ok', to_regprocedure('public.knowledge_home()') is not null),
    jsonb_build_object('file', '20261001006300', 'label', 'Quản lý CLB: Tin CLB của ban chủ nhiệm + kho link ảnh CLB (album sự kiện, giải chạy)',
      'ok', to_regprocedure('public.club_albums(uuid, jsonb)') is not null),
    jsonb_build_object('file', '20261001006400', 'label', 'Chợ BIB: nhượng / tìm mua BIB (không cao hơn giá gốc, liên hệ ẩn, báo cáo, admin ẩn tin)',
      'ok', to_regprocedure('public.bib_listings(jsonb)') is not null),
    jsonb_build_object('file', '20261001006500', 'label', 'Chấm bài GPS: phát hiện mất tín hiệu (tắt màn hình) — tuyến nối thẳng phải xác minh',
      'ok', exists (select 1 from pg_proc where proname = 'submit_and_process_activity' and prosrc like '%GPS_GAP%')),
    jsonb_build_object('file', '20261001006600', 'label', 'Quãng đường bài GPS = số app đo (kẹp theo tuyến) + từng km trên máy chủ',
      'ok', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'activity_track_points' and column_name = 'distance_m')),
    jsonb_build_object('file', '20261001006700', 'label', 'Quy định API Strava: bài Strava của người khác chỉ hiện số tổng (ẩn bản đồ, từng km, nhịp tim)',
      'ok', exists (select 1 from pg_proc where proname = 'activity_detail' and prosrc like '%strava_limited%')),
    jsonb_build_object('file', '20261001006800', 'label', 'Xoá tài khoản trong app (Apple 5.1.1(v), Luật BVDLCN 2025): xoá dữ liệu cá nhân + ẩn danh',
      'ok', to_regprocedure('public.delete_my_account(text)') is not null));

  v_buckets := (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'ok', s.id is not null,
                   'limit_mb', round(coalesce(s.file_size_limit, 0) / 1048576.0, 1)) order by b.id), '[]'::jsonb)
                  from unnest(array['avatars', 'character-layers', 'club-media', 'race-media', 'uniform-media', 'content-media']) b(id)
                  left join storage.buckets s on s.id = b.id);

  v_stats := jsonb_build_object(
    'pg_net', exists (select 1 from pg_extension where extname = 'pg_net'),
    'push_url', case when to_regclass('private.app_settings') is not null
                     then (select value from private.app_settings where key = 'push_dispatch_url') end,
    'admins', (select count(*) from public.profiles where role = 'SYSTEM_ADMIN'),
    'users', (select count(*) from public.profiles),
    'clubs', (select count(*) from public.clubs));
  if to_regclass('private.push_queue') is not null then
    v_stats := v_stats || jsonb_build_object('push_stuck', (select count(*) from private.push_queue where claimed_at is null and created_at < now() - interval '15 minutes'));
  end if;
  if private.sc_col('challenges', 'end_date') then
    v_stats := v_stats || jsonb_build_object('challenges_overdue', (select count(*) from public.challenges where status = 'ACTIVE' and end_date < now() - interval '1 day'));
  end if;
  if to_regclass('public.club_battles') is not null then
    v_stats := v_stats || jsonb_build_object('battles_overdue', (select count(*) from public.club_battles where status = 'ACCEPTED' and end_at < now() - interval '1 day'));
  end if;
  if to_regclass('public.orders') is not null then
    v_stats := v_stats || jsonb_build_object('orders_pending', (select count(*) from public.orders where status = 'PENDING' and expires_at > now()),
                                             'payment_account', exists (select 1 from private.app_settings where key = 'pay_account_no'));
  end if;
  if to_regclass('public.club_cups') is not null then
    v_stats := v_stats || jsonb_build_object('cups_overdue', (select count(*) from public.club_cups where status = 'OPEN' and end_at < now() - interval '1 day'),
                                             'cups_pending', (select count(*) from public.club_cups where status = 'PENDING_REVIEW'));
  end if;
  if to_regclass('private.client_errors') is not null then
    v_stats := v_stats || jsonb_build_object('client_errors_24h', (select coalesce(sum(hits), 0) from private.client_errors where last_at > now() - interval '24 hours'),
                                             'not_deployed_24h', (select coalesce(sum(hits), 0) from private.client_errors where kind = 'NOT_DEPLOYED' and last_at > now() - interval '24 hours'));
  end if;
  if private.sc_col('activities', 'validation_status') then
    v_stats := v_stats || jsonb_build_object('pending_reviews', (select count(*) from public.activities where validation_status = 'PENDING'));
  end if;

  return jsonb_build_object('migrations', v_mig, 'buckets', v_buckets, 'stats', v_stats, 'checked_at', now());
end $$;

revoke all on function private.sc_fn(text, text), private.sc_col(text, text) from public, anon, authenticated;
revoke all on function public.admin_system_check() from public, anon;
grant execute on function public.admin_system_check() to authenticated;

notify pgrst, 'reload schema';

commit;
