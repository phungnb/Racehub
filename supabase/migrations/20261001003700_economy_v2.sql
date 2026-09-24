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
  check (kind in ('RUN', 'QUEST', 'BADGE', 'STREAK', 'LEVEL_UP', 'LEAGUE', 'CHEER_IN', 'CHECKIN', 'REFERRAL', 'GIFT_IN'));

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
  for e in select * from public.game_events where activity_id = p_activity and kind in ('QUEST', 'BADGE', 'STREAK', 'CHECKIN') loop
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
