-- RaceHub — PHẦN 01/14 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 003700, 003800, 003900
-- Supabase → SQL Editor → New query → dán TOÀN BỘ phần này → Run. Lỗi thì không có gì thay đổi; chạy lại vẫn an toàn.
-- Xong thì chạy phần tiếp theo.
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

commit;
