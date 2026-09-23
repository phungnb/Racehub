-- =====================================================================
-- 20261001000800 — LỚP GAME (Sprint 4, ADR-015)
--
--   * Nhiệm vụ ngày / tuần (quests) — Module 3 · FR21, tự trao khi đạt
--   * Streak TUẦN (đạt số buổi mục tiêu mỗi tuần) + khiên giữ chuỗi mua bằng Xu
--   * Huy hiệu theo luật (achievements.rule) — 27 huy hiệu đầu tiên
--   * League tuần: nhóm 30 người cùng hạng, lên / xuống hạng mỗi thứ Hai
--   * Cổ vũ có giá trị: tặng 1–10 Xu kèm lời, trần mỗi ngày (Module 4 · FR32–33)
--   * Chuỗi phần thưởng sau mỗi bài chạy (game_events) cho màn tổng kết
--   * Ví Xu: lịch sử từ sổ cái
-- Phụ thuộc: 000200 (sổ cái), 000500 (thông báo, CLB), 000600 (thử thách), 000700 (chính sách Xu).
-- Idempotent: chạy lại nhiều lần không lỗi.
-- Lưu ý: trong hàm, INTO luôn đặt ở CUỐI câu SELECT để SQL Editor của Supabase không hiểu nhầm
-- là lệnh tạo bảng (xem migration 000700).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Thời gian theo giờ Việt Nam + cấu hình game
-- ---------------------------------------------------------------------
create or replace function private.vn_day(p_at timestamptz) returns date
language sql immutable as $$ select (p_at at time zone 'Asia/Ho_Chi_Minh')::date $$;

-- Thứ Hai đầu tuần (giờ VN)
create or replace function private.vn_week(p_at timestamptz) returns date
language sql immutable as $$ select date_trunc('week', p_at at time zone 'Asia/Ho_Chi_Minh')::date $$;

create or replace function private.vn_start(p_day date) returns timestamptz
language sql immutable as $$ select p_day::timestamp at time zone 'Asia/Ho_Chi_Minh' $$;

create or replace function private.game_config() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'shieldPrice', 20, 'maxShields', 2, 'defaultWeeklyGoal', 3, 'streakWeekXp', 50,
           'cheerDailyCap', 50, 'cheerMaxPerDay', 30, 'cheerXp', 5,
           'leagueSize', 30, 'leagueRewardXu', jsonb_build_array(10, 6, 3), 'leagueRewardXp', jsonb_build_array(150, 100, 50))
         || coalesce((select config_value->'game' from public.system_config_versions
                       where config_key = 'economy_global_config' and status = 'PUBLISHED' and jsonb_typeof(config_value->'game') = 'object'
                       order by version desc limit 1), '{}'::jsonb)
$$;

create or replace function private.level_name(p_level integer) returns text
language sql immutable as $$
  select case p_level when 1 then 'Người Mới Bắt Đầu' when 2 then 'Người Chạy Đều Đặn' when 3 then 'Vận Động Viên Cơ Bản'
                      when 4 then 'Runner Nghiêm Túc' else 'Huyền Thoại Đường Chạy' end
$$;

create or replace function private.league_name(p_tier integer) returns text
language sql immutable as $$
  select case p_tier when 1 then 'Đồng' when 2 then 'Bạc' when 3 then 'Vàng' when 4 then 'Bạch kim' else 'Kim cương' end
$$;

-- Bài chạy được tính cho game: đã thưởng, hợp lệ, chưa bị xóa
create or replace function private.run_km(a public.activities) returns numeric
language sql immutable as $$ select greatest(coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0), 0) / 1000.0 $$;

-- ---------------------------------------------------------------------
-- 1. Bảng
-- ---------------------------------------------------------------------
-- Sự kiện phần thưởng (một dòng = một thẻ trong màn tổng kết / trang chủ)
create table if not exists public.game_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('RUN', 'QUEST', 'BADGE', 'STREAK', 'LEVEL_UP', 'LEAGUE', 'CHEER_IN')),
  title text not null check (char_length(title) <= 160),
  subtitle text check (subtitle is null or char_length(subtitle) <= 200),
  xu numeric(10, 1) not null default 0,
  xp integer not null default 0,
  activity_id uuid references public.activities(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null unique,
  seen_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists game_events_user_idx on public.game_events (user_id, created_at desc);
create index if not exists game_events_activity_idx on public.game_events (activity_id) where activity_id is not null;

create table if not exists public.quests (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  period text not null check (period in ('DAILY', 'WEEKLY')),
  metric text not null check (metric in ('CHECKIN', 'RUN_KM', 'CHEERS_SENT', 'WEEK_KM', 'WEEK_RUN_DAYS', 'CHALLENGE_JOINS', 'CHEERS_RECEIVED')),
  target numeric not null check (target > 0),
  title text not null,
  description text,
  icon text not null default 'Target',
  reward_xu numeric(10, 1) not null default 0 check (reward_xu >= 0),
  reward_xp integer not null default 0 check (reward_xp >= 0),
  sort integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.user_quest_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  quest_id uuid not null references public.quests(id) on delete cascade,
  period_start date not null,
  progress numeric not null default 0,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, quest_id, period_start)
);

create table if not exists public.user_streaks (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  weekly_goal smallint not null default 3 check (weekly_goal between 1 and 7),
  current_weeks integer not null default 0,
  best_weeks integer not null default 0,
  last_week date,                                   -- tuần gần nhất đạt mục tiêu (thứ Hai)
  shields smallint not null default 0 check (shields between 0 and 5),
  shields_used integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.achievements add column if not exists category text;
alter table public.achievements add column if not exists rule jsonb;
alter table public.achievements add column if not exists tier text;
alter table public.achievements add column if not exists icon text;
alter table public.achievements add column if not exists xp_reward integer not null default 0;
alter table public.achievements add column if not exists xu_reward numeric(10, 1) not null default 0;
alter table public.achievements add column if not exists sort integer not null default 0;
alter table public.achievements add column if not exists is_active boolean not null default true;

create table if not exists public.user_league (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  tier smallint not null default 1 check (tier between 1 and 5),
  best_tier smallint not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.league_groups (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  tier smallint not null check (tier between 1 and 5),
  member_count integer not null default 0,
  settled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists league_groups_week_idx on public.league_groups (week_start, tier) where settled_at is null;

create table if not exists public.league_members (
  group_id uuid not null references public.league_groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  tier smallint not null,
  joined_at timestamptz not null default now(),
  points numeric not null default 0,
  final_rank integer,
  outcome text check (outcome is null or outcome in ('PROMOTED', 'STAYED', 'DEMOTED')),
  primary key (group_id, user_id),
  unique (user_id, week_start)                      -- không ai ở 2 nhóm trong cùng một tuần
);

create table if not exists public.cheers (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references public.profiles(id) on delete cascade,
  to_user uuid not null references public.profiles(id) on delete cascade,
  amount numeric(6, 1) not null check (amount between 1 and 10),
  message text check (message is null or char_length(message) <= 140),
  activity_id uuid references public.activities(id) on delete set null,
  post_id uuid references public.club_posts(id) on delete set null,
  club_id uuid references public.clubs(id) on delete set null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  check (from_user <> to_user)
);
create index if not exists cheers_to_idx on public.cheers (to_user, created_at desc);
create index if not exists cheers_from_idx on public.cheers (from_user, created_at desc);
alter table public.club_posts add column if not exists cheer_xu numeric(10, 1) not null default 0;

-- RLS: chỉ đọc dữ liệu của mình; mọi ghi qua hàm SECURITY DEFINER
alter table public.game_events enable row level security;
alter table public.quests enable row level security;
alter table public.user_quest_progress enable row level security;
alter table public.user_streaks enable row level security;
alter table public.user_league enable row level security;
alter table public.league_groups enable row level security;
alter table public.league_members enable row level security;
alter table public.cheers enable row level security;
revoke all on public.game_events, public.quests, public.user_quest_progress, public.user_streaks, public.user_league,
  public.league_groups, public.league_members, public.cheers from anon, authenticated;
grant select on public.game_events, public.quests, public.user_quest_progress, public.user_streaks, public.user_league,
  public.league_groups, public.league_members, public.cheers to authenticated;

drop policy if exists game_events_own on public.game_events;
create policy game_events_own on public.game_events for select to authenticated using (user_id = auth.uid());
drop policy if exists quests_read on public.quests;
create policy quests_read on public.quests for select to authenticated using (is_active or public.is_system_admin());
drop policy if exists uqp_own on public.user_quest_progress;
create policy uqp_own on public.user_quest_progress for select to authenticated using (user_id = auth.uid());
drop policy if exists streak_own on public.user_streaks;
create policy streak_own on public.user_streaks for select to authenticated using (user_id = auth.uid());
drop policy if exists league_read on public.user_league;
create policy league_read on public.user_league for select to authenticated using (true);
drop policy if exists league_groups_read on public.league_groups;
create policy league_groups_read on public.league_groups for select to authenticated using (true);
drop policy if exists league_members_read on public.league_members;
create policy league_members_read on public.league_members for select to authenticated using (true);
drop policy if exists cheers_own on public.cheers;
create policy cheers_own on public.cheers for select to authenticated using (from_user = auth.uid() or to_user = auth.uid());

-- ---------------------------------------------------------------------
-- 2. Dữ liệu mẫu: nhiệm vụ và huy hiệu (admin sửa được số liệu trong bảng)
-- ---------------------------------------------------------------------
insert into public.quests (code, period, metric, target, title, description, icon, reward_xu, reward_xp, sort) values
  ('DAILY_CHECKIN', 'DAILY', 'CHECKIN', 1, 'Điểm danh', 'Mở app và điểm danh hôm nay', 'CalendarCheck', 0.5, 5, 1),
  ('DAILY_RUN_3K', 'DAILY', 'RUN_KM', 3, 'Chạy một bài từ 3 km', 'Một bài chạy hợp lệ dài ít nhất 3 km', 'Footprints', 1, 30, 2),
  ('DAILY_CHEER', 'DAILY', 'CHEERS_SENT', 1, 'Cổ vũ một người bạn', 'Tặng Xu cổ vũ cho một runner', 'HandHeart', 0.5, 5, 3),
  ('WEEK_30K', 'WEEKLY', 'WEEK_KM', 30, 'Tích lũy 30 km', 'Tổng quãng đường hợp lệ trong tuần', 'Route', 10, 150, 1),
  ('WEEK_5_DAYS', 'WEEKLY', 'WEEK_RUN_DAYS', 5, 'Bền bỉ: chạy 5 ngày', 'Có bài chạy hợp lệ ở 5 ngày khác nhau', 'CalendarDays', 8, 120, 2),
  ('WEEK_3_CHALLENGES', 'WEEKLY', 'CHALLENGE_JOINS', 3, 'Tham gia 3 thử thách', 'Vào 3 thử thách khác nhau trong tuần', 'Trophy', 3, 50, 3),
  ('WEEK_15_CHEERS', 'WEEKLY', 'CHEERS_RECEIVED', 15, 'Người truyền cảm hứng', 'Nhận 15 lượt cổ vũ bằng Xu', 'Sparkles', 5, 80, 4)
on conflict (code) do nothing;

insert into public.achievements (code, title, description, category, tier, icon, rule, xp_reward, xu_reward, sort) values
  ('FIRST_KM', 'Bước chân đầu tiên', 'Chạy km đầu tiên trên RaceHub', 'DISTANCE', 'BRONZE', 'Footprints', '{"type":"TOTAL_KM","gte":1}', 100, 0, 1),
  ('KM_10', '10 km', 'Tổng quãng đường đạt 10 km', 'DISTANCE', 'BRONZE', 'Route', '{"type":"TOTAL_KM","gte":10}', 50, 0, 2),
  ('KM_50', '50 km', 'Tổng quãng đường đạt 50 km', 'DISTANCE', 'SILVER', 'Route', '{"type":"TOTAL_KM","gte":50}', 100, 0, 3),
  ('KM_100', 'Câu lạc bộ 100', 'Tổng quãng đường đạt 100 km', 'DISTANCE', 'SILVER', 'Milestone', '{"type":"TOTAL_KM","gte":100}', 200, 2, 4),
  ('KM_500', 'Xuyên Việt 500', 'Tổng quãng đường đạt 500 km', 'DISTANCE', 'GOLD', 'Map', '{"type":"TOTAL_KM","gte":500}', 500, 5, 5),
  ('KM_1000', 'Nghìn cây số', 'Tổng quãng đường đạt 1.000 km', 'DISTANCE', 'LEGEND', 'Globe2', '{"type":"TOTAL_KM","gte":1000}', 5000, 10, 6),
  ('RUN_5K', 'Hoàn thành 5K', 'Một bài chạy dài từ 5 km', 'RACE', 'BRONZE', 'Flag', '{"type":"LONGEST_RUN_KM","gte":5}', 100, 0, 10),
  ('RUN_10K', 'Hoàn thành 10K', 'Một bài chạy dài từ 10 km', 'RACE', 'SILVER', 'Flag', '{"type":"LONGEST_RUN_KM","gte":10}', 200, 0, 11),
  ('RUN_HALF', 'Bán marathon', 'Một bài chạy dài từ 21 km', 'RACE', 'GOLD', 'Medal', '{"type":"LONGEST_RUN_KM","gte":21}', 300, 3, 12),
  ('RUN_FULL', 'Marathoner', 'Một bài chạy dài từ 42 km', 'RACE', 'LEGEND', 'Crown', '{"type":"LONGEST_RUN_KM","gte":42}', 1000, 10, 13),
  ('RUNS_10', '10 buổi chạy', 'Hoàn thành 10 bài chạy hợp lệ', 'HABIT', 'BRONZE', 'Repeat', '{"type":"RUN_COUNT","gte":10}', 50, 0, 20),
  ('RUNS_50', '50 buổi chạy', 'Hoàn thành 50 bài chạy hợp lệ', 'HABIT', 'SILVER', 'Repeat', '{"type":"RUN_COUNT","gte":50}', 150, 0, 21),
  ('RUNS_100', '100 buổi chạy', 'Hoàn thành 100 bài chạy hợp lệ', 'HABIT', 'GOLD', 'Repeat', '{"type":"RUN_COUNT","gte":100}', 300, 3, 22),
  ('STREAK_4', 'Chuỗi 4 tuần', 'Đạt mục tiêu tuần 4 tuần liền', 'HABIT', 'BRONZE', 'Flame', '{"type":"BEST_STREAK_WEEKS","gte":4}', 100, 0, 23),
  ('STREAK_10', 'Chuỗi 10 tuần', 'Đạt mục tiêu tuần 10 tuần liền', 'HABIT', 'SILVER', 'Flame', '{"type":"BEST_STREAK_WEEKS","gte":10}', 300, 3, 24),
  ('STREAK_26', 'Nửa năm kỷ luật', 'Đạt mục tiêu tuần 26 tuần liền', 'HABIT', 'GOLD', 'Flame', '{"type":"BEST_STREAK_WEEKS","gte":26}', 800, 8, 25),
  ('EARLY_BIRD', 'Chim sớm', '5 bài chạy bắt đầu trước 6 giờ sáng', 'HABIT', 'BRONZE', 'Sunrise', '{"type":"EARLY_RUNS","gte":5}', 50, 0, 26),
  ('NIGHT_OWL', 'Cú đêm', '5 bài chạy bắt đầu sau 20 giờ', 'HABIT', 'BRONZE', 'Moon', '{"type":"NIGHT_RUNS","gte":5}', 50, 0, 27),
  ('CHALLENGE_FIRST', 'Về đích thử thách', 'Hoàn thành thử thách đầu tiên', 'CHALLENGE', 'BRONZE', 'Trophy', '{"type":"CHALLENGES_FINISHED","gte":1}', 100, 0, 30),
  ('TEAM_FIRST', 'Đồng đội', 'Hoàn thành thử thách đội đầu tiên', 'CHALLENGE', 'SILVER', 'Users', '{"type":"TEAM_CHALLENGES_FINISHED","gte":1}', 150, 0, 31),
  ('CHALLENGE_WIN', 'Nhà vô địch', 'Về nhất một thử thách', 'CHALLENGE', 'SILVER', 'Award', '{"type":"CHALLENGE_WINS","gte":1}', 200, 0, 32),
  ('CHALLENGE_WIN_5', 'Bất bại', 'Về nhất 5 thử thách', 'CHALLENGE', 'GOLD', 'Crown', '{"type":"CHALLENGE_WINS","gte":5}', 500, 5, 33),
  ('CHEER_GIVER', 'Người cổ vũ', 'Tặng Xu cổ vũ 10 lần', 'SOCIAL', 'BRONZE', 'HandHeart', '{"type":"CHEERS_SENT","gte":10}', 50, 0, 40),
  ('CHEER_STAR', 'Ngôi sao truyền cảm hứng', 'Nhận 25 lượt cổ vũ bằng Xu', 'SOCIAL', 'SILVER', 'Sparkles', '{"type":"CHEERS_RECEIVED","gte":25}', 150, 0, 41),
  ('CLUB_JOIN', 'Có hội có thuyền', 'Tham gia một CLB', 'SOCIAL', 'BRONZE', 'Shield', '{"type":"CLUBS_JOINED","gte":1}', 30, 0, 42),
  ('LEVEL_3', 'Vận động viên', 'Đạt cấp 3', 'LEVEL', 'SILVER', 'Star', '{"type":"LEVEL","gte":3}', 0, 0, 50),
  ('LEVEL_5', 'Huyền thoại', 'Đạt cấp 5', 'LEVEL', 'LEGEND', 'Gem', '{"type":"LEVEL","gte":5}', 0, 0, 51)
on conflict (code) do update set
  title = excluded.title, description = excluded.description, category = excluded.category, tier = excluded.tier,
  icon = excluded.icon, rule = excluded.rule, sort = excluded.sort, xp_reward = excluded.xp_reward, xu_reward = excluded.xu_reward
  where public.achievements.rule is null;            -- không ghi đè khi admin đã chỉnh

-- ---------------------------------------------------------------------
-- 3. Động cơ phần thưởng
-- ---------------------------------------------------------------------
-- Cộng XP + tính lại cấp; lên cấp thì ghi sự kiện LEVEL_UP và báo người dùng
create or replace function private.add_xp(p_user uuid, p_xp integer, p_activity uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_old integer; v_new integer; v_xp numeric;
begin
  if coalesce(p_xp, 0) <= 0 then return; end if;
  select coalesce(level, 1), coalesce(xp, 0) + p_xp from public.profiles where id = p_user for update
    into v_old, v_xp;
  if not found then return; end if;
  v_new := private.level_for_xp(v_xp);
  update public.profiles set xp = v_xp, level = v_new where id = p_user;
  if v_new > v_old then
    perform private.level_up_event(p_user, v_new, p_activity);
  end if;
end $$;

create or replace function private.level_up_event(p_user uuid, p_level integer, p_activity uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.game_events (user_id, kind, title, subtitle, activity_id, payload, dedupe_key)
  values (p_user, 'LEVEL_UP', 'Lên cấp ' || p_level || ': ' || private.level_name(p_level), 'Mở khóa danh hiệu và vật phẩm mới',
          p_activity, jsonb_build_object('level', p_level), 'level:' || p_user || ':' || p_level)
  on conflict (dedupe_key) do nothing;
  if found then
    perform private.notify(p_user, null, 'LEVEL_UP', 'Chúc mừng! Bạn lên cấp ' || p_level,
      private.level_name(p_level), '/me', null, true);
  end if;
end $$;

-- Trao một phần thưởng (idempotent theo p_key): ghi sự kiện, Xu qua sổ cái, XP. Trả về true nếu là lần đầu.
create or replace function private.award(
  p_user uuid, p_kind text, p_title text, p_subtitle text, p_xu numeric, p_xp integer, p_key text,
  p_activity uuid default null, p_payload jsonb default '{}'::jsonb
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_rows integer;
begin
  insert into public.game_events (user_id, kind, title, subtitle, xu, xp, activity_id, payload, dedupe_key)
  values (p_user, p_kind, left(p_title, 160), left(p_subtitle, 200), coalesce(p_xu, 0), coalesce(p_xp, 0), p_activity,
          coalesce(p_payload, '{}'::jsonb), p_key)
  on conflict (dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return false; end if;
  if coalesce(p_xu, 0) > 0 then
    perform private.ledger_post('GAME_' || p_kind, 'game:' || p_key, p_title, p_user,
      jsonb_build_array(
        jsonb_build_object('account_id', p_user, 'coin_kind', 'BONUS', 'amount', p_xu),
        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -p_xu)),
      p_activity);
  end if;
  perform private.add_xp(p_user, p_xp, p_activity);
  return true;
end $$;

-- Cập nhật tiến độ nhiệm vụ theo một chỉ số. p_mode: ADD (cộng dồn), MAX (lấy lớn nhất), SET (gán)
create or replace function private.quest_progress(
  p_user uuid, p_metric text, p_value numeric, p_mode text default 'ADD', p_at timestamptz default now(), p_activity uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare q record; v_start date; v_prog numeric; v_done timestamptz;
begin
  for q in select * from public.quests where metric = p_metric and is_active loop
    v_start := case q.period when 'DAILY' then private.vn_day(p_at) else private.vn_week(p_at) end;
    insert into public.user_quest_progress (user_id, quest_id, period_start) values (p_user, q.id, v_start)
    on conflict do nothing;
    update public.user_quest_progress
       set progress = case p_mode when 'ADD' then progress + p_value when 'MAX' then greatest(progress, p_value) else p_value end,
           updated_at = now()
     where user_id = p_user and quest_id = q.id and period_start = v_start
    returning progress, completed_at into v_prog, v_done;
    if v_done is null and v_prog >= q.target then
      update public.user_quest_progress set completed_at = now()
       where user_id = p_user and quest_id = q.id and period_start = v_start;
      perform private.award(p_user, 'QUEST', 'Nhiệm vụ: ' || q.title,
        case q.period when 'DAILY' then 'Nhiệm vụ ngày' else 'Nhiệm vụ tuần' end,
        q.reward_xu, q.reward_xp, 'quest:' || q.id || ':' || p_user || ':' || v_start, p_activity,
        jsonb_build_object('quest_id', q.id, 'code', q.code, 'period', q.period, 'period_start', v_start, 'icon', q.icon));
    end if;
  end loop;
end $$;

-- Số ngày có bài chạy hợp lệ trong tuần / tổng km tuần
create or replace function private.week_run_stats(p_user uuid, p_week date)
returns table (km numeric, runs integer, days integer)
language sql stable security definer set search_path = public as $$
  select coalesce(sum(private.run_km(a)), 0), count(*)::int, count(distinct private.vn_day(a.started_at))::int
    from public.activities a
   where a.user_id = p_user and a.rewarded_at is not null and a.validation_status = 'APPROVED'
     and coalesce(a.status, '') <> 'DELETED'
     and a.started_at >= private.vn_start(p_week) and a.started_at < private.vn_start(p_week + 7)
$$;

create or replace function private.ensure_streak(p_user uuid) returns public.user_streaks
language plpgsql security definer set search_path = public as $$
declare s public.user_streaks;
begin
  insert into public.user_streaks (user_id, weekly_goal)
  values (p_user, coalesce((private.game_config()->>'defaultWeeklyGoal')::int, 3))
  on conflict (user_id) do nothing;
  select * from public.user_streaks where user_id = p_user into s;
  return s;
end $$;

-- Streak tuần: tuần đạt đủ số ngày chạy mục tiêu thì +1; tuần hụt được khiên bù (tự dùng), hết khiên thì về 1
create or replace function private.streak_on_run(p_user uuid, p_at timestamptz, p_activity uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.user_streaks;
  w date := private.vn_week(p_at);
  v_days integer;
  v_gap integer;
  v_cur integer;
  v_used integer := 0;
begin
  perform private.ensure_streak(p_user);
  select * from public.user_streaks where user_id = p_user for update into s;
  if s.last_week is not null and s.last_week >= w then return; end if;      -- tuần này đã tính
  select days from private.week_run_stats(p_user, w) into v_days;
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

  perform private.award(p_user, 'STREAK', 'Chuỗi ' || v_cur || ' tuần',
    case when v_used > 0 then 'Khiên đã giữ chuỗi cho ' || v_used || ' tuần bị hụt'
         else 'Đạt mục tiêu ' || s.weekly_goal || ' ngày chạy trong tuần' end,
    0, coalesce((private.game_config()->>'streakWeekXp')::int, 50), 'streak:' || p_user || ':' || w, p_activity,
    jsonb_build_object('weeks', v_cur, 'shields_used', v_used, 'week', w));
end $$;

-- Chỉ số để xét huy hiệu
create or replace function private.player_stats(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_runs jsonb; v_ch jsonb;
begin
  select jsonb_build_object(
           'TOTAL_KM', coalesce(sum(private.run_km(a)), 0),
           'RUN_COUNT', count(*),
           'LONGEST_RUN_KM', coalesce(max(private.run_km(a)), 0),
           'EARLY_RUNS', count(*) filter (where extract(hour from a.started_at at time zone 'Asia/Ho_Chi_Minh') < 6),
           'NIGHT_RUNS', count(*) filter (where extract(hour from a.started_at at time zone 'Asia/Ho_Chi_Minh') >= 20))
    from public.activities a
   where a.user_id = p_user and a.rewarded_at is not null and a.validation_status = 'APPROVED' and coalesce(a.status, '') <> 'DELETED'
    into v_runs;
  select jsonb_build_object(
           'CHALLENGES_FINISHED', count(*) filter (where p.current_progress > 0),
           'TEAM_CHALLENGES_FINISHED', count(*) filter (where p.current_progress > 0 and c.format = 'TEAM'),
           'CHALLENGE_WINS', count(*) filter (where p.final_rank = 1 and p.current_progress > 0 and c.format in ('RANKED', 'DUEL')))
    from public.challenge_participants p join public.challenges c on c.id = p.challenge_id
   where p.profile_id = p_user and p.status <> 'LEFT' and c.status = 'FINISHED'
    into v_ch;
  r := v_runs || v_ch || jsonb_build_object(
    'BEST_STREAK_WEEKS', coalesce((select best_weeks from public.user_streaks where user_id = p_user), 0),
    'CHEERS_SENT', (select count(*) from public.cheers where from_user = p_user),
    'CHEERS_RECEIVED', (select count(*) from public.cheers where to_user = p_user),
    'CLUBS_JOINED', (select count(*) from public.club_members where user_id = p_user and status = 'APPROVED'),
    'LEVEL', coalesce((select level from public.profiles where id = p_user), 1));
  return r;
end $$;

-- Mở khóa các huy hiệu đã đủ điều kiện. Trả về số huy hiệu mới.
create or replace function private.evaluate_achievements(p_user uuid, p_activity uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare st jsonb := private.player_stats(p_user); a record; v_rows integer; v_new integer := 0;
begin
  for a in select * from public.achievements x
            where x.is_active and x.rule is not null
              and not exists (select 1 from public.user_achievements u where u.user_id = p_user and u.achievement_id = x.id)
            order by x.sort loop
    if coalesce((st->>(a.rule->>'type'))::numeric, 0) >= (a.rule->>'gte')::numeric then
      insert into public.user_achievements (user_id, achievement_id) values (p_user, a.id) on conflict do nothing;
      get diagnostics v_rows = row_count;
      if v_rows > 0 then
        v_new := v_new + 1;
        perform private.award(p_user, 'BADGE', 'Huy hiệu: ' || a.title, a.description, a.xu_reward, a.xp_reward,
          'badge:' || a.code || ':' || p_user, p_activity,
          jsonb_build_object('code', a.code, 'tier', a.tier, 'icon', a.icon));
        perform private.notify(p_user, null, 'BADGE', 'Huy hiệu mới: ' || a.title, a.description, '/me?tab=badges', null, true);
      end if;
    end if;
  end loop;
  return v_new;
end $$;

-- League: vào nhóm của tuần hiện tại (khi có bài chạy đầu tiên trong tuần)
create or replace function private.league_join(p_user uuid, p_week date) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_tier integer; v_group uuid; v_size integer := coalesce((private.game_config()->>'leagueSize')::int, 30);
begin
  select group_id from public.league_members where user_id = p_user and week_start = p_week into v_group;
  if v_group is not null then return v_group; end if;
  insert into public.user_league (user_id) values (p_user) on conflict do nothing;
  select tier from public.user_league where user_id = p_user into v_tier;
  perform pg_advisory_xact_lock(hashtextextended('league:' || p_week || ':' || v_tier, 0));
  select id from public.league_groups
   where week_start = p_week and tier = v_tier and member_count < v_size and settled_at is null
   order by created_at limit 1 for update
    into v_group;
  if v_group is null then
    insert into public.league_groups (week_start, tier) values (p_week, v_tier) returning id into v_group;
  end if;
  insert into public.league_members (group_id, user_id, week_start, tier) values (v_group, p_user, p_week, v_tier)
  on conflict do nothing;
  update public.league_groups set member_count = (select count(*) from public.league_members where group_id = v_group)
   where id = v_group;
  return v_group;
end $$;

-- Điểm league = km hợp lệ trong tuần
create or replace function private.league_points(p_user uuid, p_week date) returns numeric
language sql stable security definer set search_path = public as $$
  select round(km, 2) from private.week_run_stats(p_user, p_week)
$$;

-- Số người lên / xuống hạng theo cỡ nhóm
create or replace function private.league_zones(p_size integer, p_tier integer, out promote integer, out demote integer)
language sql immutable as $$
  select case when p_tier >= 5 then 0 when p_size < 5 then least(p_size, 1) else least(7, p_size / 3) end,
         case when p_tier <= 1 or p_size < 5 then 0 else least(5, p_size / 5) end
$$;

-- Tất toán các nhóm league của một tuần đã qua (idempotent)
create or replace function private.settle_league_week(p_week date) returns integer
language plpgsql security definer set search_path = public as $$
declare
  g record; m record; z record; n integer; v_count integer := 0; v_new_tier integer; v_outcome text;
  cfg jsonb := private.game_config(); v_xu numeric; v_xp integer;
begin
  if p_week >= private.vn_week(now()) then return 0; end if;
  perform pg_advisory_xact_lock(hashtextextended('league_settle:' || p_week, 0));
  for g in select * from public.league_groups where week_start = p_week and settled_at is null for update loop
    update public.league_members lm set points = private.league_points(lm.user_id, p_week) where lm.group_id = g.id;
    with ranked as (
      select user_id, row_number() over (order by points desc, joined_at) as rk from public.league_members where group_id = g.id)
    update public.league_members lm set final_rank = r.rk from ranked r where lm.group_id = g.id and lm.user_id = r.user_id;
    select count(*) from public.league_members where group_id = g.id into n;
    select * from private.league_zones(n, g.tier) into z;
    for m in select * from public.league_members where group_id = g.id order by final_rank loop
      v_outcome := case when m.final_rank <= z.promote and m.points > 0 then 'PROMOTED'
                        when m.final_rank > n - z.demote then 'DEMOTED' else 'STAYED' end;
      v_new_tier := g.tier + case v_outcome when 'PROMOTED' then 1 when 'DEMOTED' then -1 else 0 end;
      update public.league_members set outcome = v_outcome where group_id = g.id and user_id = m.user_id;
      insert into public.user_league (user_id, tier, best_tier) values (m.user_id, v_new_tier, v_new_tier)
      on conflict (user_id) do update set tier = v_new_tier, best_tier = greatest(public.user_league.best_tier, v_new_tier), updated_at = now();
      v_xu := case when m.final_rank <= 3 and m.points > 0 then coalesce((cfg->'leagueRewardXu'->>(m.final_rank - 1))::numeric, 0) else 0 end;
      v_xp := case when m.final_rank <= 3 and m.points > 0 then coalesce((cfg->'leagueRewardXp'->>(m.final_rank - 1))::int, 0) else 0 end;
      perform private.award(m.user_id, 'LEAGUE',
        case v_outcome when 'PROMOTED' then 'Lên hạng ' || private.league_name(v_new_tier)
                       when 'DEMOTED' then 'Xuống hạng ' || private.league_name(v_new_tier)
                       else 'Giữ hạng ' || private.league_name(v_new_tier) end,
        'Hạng ' || m.final_rank || '/' || n || ' tuần ' || to_char(p_week, 'DD/MM') || ' · ' || round(m.points, 1) || ' km',
        v_xu, v_xp, 'league:' || g.id || ':' || m.user_id, null,
        jsonb_build_object('rank', m.final_rank, 'size', n, 'outcome', v_outcome, 'tier', v_new_tier, 'week', p_week));
      perform private.notify(m.user_id, null, 'LEAGUE',
        case v_outcome when 'PROMOTED' then 'Bạn lên hạng ' || private.league_name(v_new_tier) || '!'
                       when 'DEMOTED' then 'Bạn xuống hạng ' || private.league_name(v_new_tier)
                       else 'Bạn giữ hạng ' || private.league_name(v_new_tier) end,
        'Tuần trước bạn xếp thứ ' || m.final_rank || '/' || n, '/feed', null, v_outcome <> 'STAYED');
    end loop;
    update public.league_groups set settled_at = now() where id = g.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Tất toán mọi tuần còn treo (gọi từ cron thứ Hai và khi người dùng mở trang chủ)
create or replace function private.settle_leagues_due() returns integer
language plpgsql security definer set search_path = public as $$
declare w date; v integer := 0;
begin
  for w in select distinct week_start from public.league_groups
            where settled_at is null and week_start < private.vn_week(now()) order by 1 loop
    v := v + private.settle_league_week(w);
  end loop;
  return v;
end $$;

create or replace function public.settle_due_leagues() returns integer
language sql security definer set search_path = public as $$ select private.settle_leagues_due() $$;

-- ---------------------------------------------------------------------
-- 4. Móc vào luồng hiện có
-- ---------------------------------------------------------------------
-- Sau khi một bài chạy được trả thưởng (reward_activity đặt rewarded_at): thẻ bài chạy, lên cấp,
-- nhiệm vụ, streak, league, huy hiệu. Lỗi ở lớp game không được làm hỏng việc nhận bài chạy.
create or replace function private.game_after_run() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_km numeric := private.run_km(new); v_at timestamptz := coalesce(new.started_at, now()); v_level integer; v_xp numeric; w record;
begin
  if new.user_id is null then return new; end if;
  begin
    insert into public.game_events (user_id, kind, title, subtitle, xu, xp, activity_id, payload, dedupe_key)
    values (new.user_id, 'RUN', 'Bài chạy ' || replace(to_char(round(v_km, 2), 'FM999990.00'), '.', ',') || ' km',
            coalesce(nullif(trim(new.title), ''), 'Buổi chạy'), coalesce(new.earned_xu, 0), coalesce(new.earned_xp, 0),
            new.id, jsonb_build_object('km', round(v_km, 2)), 'run:' || new.id)
    on conflict (dedupe_key) do nothing;

    -- XP của bài chạy do reward_activity cộng: kiểm tra có lên cấp không
    select coalesce(level, 1), coalesce(xp, 0) from public.profiles where id = new.user_id into v_level, v_xp;
    if v_level > private.level_for_xp(greatest(v_xp - coalesce(new.earned_xp, 0), 0)) then
      perform private.level_up_event(new.user_id, v_level, new.id);
    end if;

    select * from private.week_run_stats(new.user_id, private.vn_week(v_at)) into w;
    perform private.quest_progress(new.user_id, 'RUN_KM', v_km, 'MAX', v_at, new.id);
    perform private.quest_progress(new.user_id, 'WEEK_KM', w.km, 'SET', v_at, new.id);
    perform private.quest_progress(new.user_id, 'WEEK_RUN_DAYS', w.days, 'SET', v_at, new.id);
    perform private.streak_on_run(new.user_id, v_at, new.id);
    if private.vn_week(v_at) = private.vn_week(now()) and v_km > 0 then
      perform private.league_join(new.user_id, private.vn_week(v_at));
    end if;
    perform private.evaluate_achievements(new.user_id, new.id);
  exception when others then
    raise warning 'game_after_run % lỗi: % %', new.id, sqlstate, sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists trg_game_after_run on public.activities;
create trigger trg_game_after_run after update of rewarded_at on public.activities
  for each row when (old.rewarded_at is null and new.rewarded_at is not null)
  execute function private.game_after_run();

-- Vào thử thách → nhiệm vụ tuần "tham gia 3 thử thách" (đếm thử thách khác nhau, rời/vào lại không cộng thêm)
create or replace function private.game_on_join() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_week date := private.vn_week(now()); v_n integer;
begin
  if new.profile_id is null or new.status <> 'JOINED' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'JOINED' then return new; end if;
  begin
    select count(distinct challenge_id) from public.challenge_participants
     where profile_id = new.profile_id and status <> 'LEFT' and joined_at >= private.vn_start(v_week)
      into v_n;
    perform private.quest_progress(new.profile_id, 'CHALLENGE_JOINS', v_n, 'SET', now(), null);
  exception when others then
    raise warning 'game_on_join lỗi: % %', sqlstate, sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists trg_game_on_join on public.challenge_participants;
create trigger trg_game_on_join after insert or update of status on public.challenge_participants
  for each row execute function private.game_on_join();

-- Thử thách tất toán xong → xét huy hiệu thử thách cho người tham gia
create or replace function private.game_on_challenge_finished() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  begin
    for r in select distinct profile_id from public.challenge_participants
              where challenge_id = new.id and status <> 'LEFT' and profile_id is not null loop
      perform private.evaluate_achievements(r.profile_id, null);
    end loop;
  exception when others then
    raise warning 'game_on_challenge_finished lỗi: % %', sqlstate, sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists trg_game_on_challenge_finished on public.challenges;
create trigger trg_game_on_challenge_finished after update of status on public.challenges
  for each row when (new.status = 'FINISHED' and old.status is distinct from 'FINISHED')
  execute function private.game_on_challenge_finished();

-- Bài chạy bị xóa / bị từ chối sau khi đã thưởng: thu hồi phần thưởng game gắn với bài đó
-- (Xu, XP; nhiệm vụ và huy hiệu mở lại để có thể đạt lại bằng bài hợp lệ). Thưởng chạy do 000400 thu hồi.
create or replace function private.game_revoke_activity(p_activity uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e record;
begin
  for e in select * from public.game_events where activity_id = p_activity and kind in ('QUEST', 'BADGE', 'STREAK') loop
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

create or replace function private.game_on_run_removed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform private.game_revoke_activity(new.id);
  exception when others then
    raise warning 'game_on_run_removed % lỗi: % %', new.id, sqlstate, sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists trg_game_on_run_removed on public.activities;
create trigger trg_game_on_run_removed after update of status, validation_status on public.activities
  for each row when (old.rewarded_at is not null
                     and ((new.status = 'DELETED' and old.status is distinct from 'DELETED')
                          or (new.validation_status = 'REJECTED' and old.validation_status is distinct from 'REJECTED')))
  execute function private.game_on_run_removed();

-- ---------------------------------------------------------------------
-- 5. RPC cho giao diện
-- ---------------------------------------------------------------------
-- Toàn bộ trạng thái game của tôi cho trang chủ (một lần gọi)
create or replace function public.my_game_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_now timestamptz := now();
  v_today date := private.vn_day(v_now);
  v_week date := private.vn_week(v_now);
  cfg jsonb := private.game_config();
  s public.user_streaks;
  w record;
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
  perform private.evaluate_achievements(v_uid, null);           -- bắt kịp huy hiệu CLB, cấp độ, thử thách
  s := private.ensure_streak(v_uid);
  select * from private.week_run_stats(v_uid, v_week) into w;

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
    'week', jsonb_build_object('km', round(coalesce(w.km, 0), 2), 'runs', coalesce(w.runs, 0), 'days', coalesce(w.days, 0)),
    'streak', jsonb_build_object(
      'goal', s.weekly_goal, 'week_days', coalesce(w.days, 0), 'done_this_week', s.last_week = v_week,
      'current', case when v_alive then s.current_weeks else 0 end, 'best', s.best_weeks, 'alive', v_alive,
      'at_risk_weeks', greatest(coalesce(v_gap, 0), 0), 'shields', s.shields,
      'max_shields', (cfg->>'maxShields')::int, 'shield_price', (cfg->>'shieldPrice')::numeric, 'daily', v_daily),
    'quests', v_quests,
    'league', coalesce(v_league, jsonb_build_object('group_id', null, 'tier', v_tier, 'tier_name', private.league_name(v_tier))),
    'unseen', v_events);
end $$;

-- Điểm danh ngày (nhiệm vụ CHECKIN). Gọi nhiều lần trong ngày cũng chỉ tính một.
create or replace function public.daily_checkin() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  perform private.quest_progress(v_uid, 'CHECKIN', 1, 'SET', now(), null);
  return jsonb_build_object('ok', true, 'balance', private.balance(v_uid));
end $$;

create or replace function public.set_weekly_goal(p_goal integer) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  if p_goal is null or p_goal not between 1 and 7 then raise exception 'INVALID_GOAL'; end if;
  perform private.ensure_streak(v_uid);
  update public.user_streaks set weekly_goal = p_goal, updated_at = now() where user_id = v_uid;
end $$;

-- Mua khiên giữ chuỗi bằng Xu (tiêu Xu thưởng trước, thiếu mới dùng Xu nạp)
create or replace function public.buy_streak_shield(p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  cfg jsonb := private.game_config();
  v_price numeric := (cfg->>'shieldPrice')::numeric;
  v_max integer := (cfg->>'maxShields')::int;
  s public.user_streaks;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if exists (select 1 from public.ledger_transactions where idempotency_key = 'shield:' || p_idempotency_key) then
    return jsonb_build_object('duplicate', true, 'shields', (select shields from public.user_streaks where user_id = v_uid));
  end if;
  perform private.ensure_streak(v_uid);
  select * from public.user_streaks where user_id = v_uid for update into s;
  if s.shields >= v_max then raise exception 'SHIELD_LIMIT'; end if;
  if private.balance(v_uid) < v_price then raise exception 'INSUFFICIENT_BALANCE'; end if;
  perform private.ledger_post('SHOP_SHIELD', 'shield:' || p_idempotency_key, 'Mua khiên giữ chuỗi', v_uid,
    private.debit_entries(v_uid, v_price, private.system_account()));
  update public.user_streaks set shields = shields + 1, updated_at = now() where user_id = v_uid;
  return jsonb_build_object('shields', s.shields + 1, 'balance', private.balance(v_uid));
end $$;

-- Cổ vũ có giá trị: tặng 1–10 Xu kèm lời nhắn. Người nhận luôn nhận Xu thưởng (BONUS).
create or replace function public.send_cheer(
  p_to_user uuid, p_amount numeric, p_message text default null, p_post_id uuid default null,
  p_activity_id uuid default null, p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  cfg jsonb := private.game_config();
  v_amount numeric := coalesce(p_amount, 0);
  v_msg text := nullif(trim(coalesce(p_message, '')), '');
  v_club uuid;
  v_author uuid;
  v_sent numeric;
  v_count integer;
  v_id uuid;
  v_xp integer := coalesce((cfg->>'cheerXp')::int, 5);
  v_name text;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  select id from public.cheers where idempotency_key = p_idempotency_key into v_id;
  if v_id is not null then return jsonb_build_object('cheer_id', v_id, 'duplicate', true); end if;
  if p_to_user is null or p_to_user = v_uid then raise exception 'CANNOT_CHEER_SELF'; end if;
  if not exists (select 1 from public.profiles where id = p_to_user) then raise exception 'USER_NOT_FOUND'; end if;
  if v_amount <> floor(v_amount) or v_amount not between 1 and 10 then raise exception 'INVALID_AMOUNT'; end if;
  if v_msg is not null and char_length(v_msg) > 140 then raise exception 'MESSAGE_TOO_LONG'; end if;

  if p_post_id is not null then
    select club_id, author_id from public.club_posts where id = p_post_id and deleted_at is null into v_club, v_author;
    if v_club is null or not public.club_is_member(v_club) then raise exception 'FORBIDDEN'; end if;
    if v_author is distinct from p_to_user then raise exception 'FORBIDDEN'; end if;
  end if;
  if p_activity_id is not null and not exists (select 1 from public.activities where id = p_activity_id and user_id = p_to_user) then
    raise exception 'FORBIDDEN';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('cheer:' || v_uid, 0));
  select coalesce(sum(amount), 0), count(*) from public.cheers
   where from_user = v_uid and created_at >= private.vn_start(private.vn_day(now()))
    into v_sent, v_count;
  if v_sent + v_amount > (cfg->>'cheerDailyCap')::numeric or v_count >= (cfg->>'cheerMaxPerDay')::int then
    raise exception 'CHEER_DAILY_LIMIT';
  end if;
  if private.balance(v_uid) < v_amount then raise exception 'INSUFFICIENT_BALANCE'; end if;

  -- Người gửi → hệ thống (BONUS trước, PAID sau); hệ thống → người nhận (BONUS)
  perform private.ledger_post('CHEER', 'cheer:' || p_idempotency_key, 'Cổ vũ ' || private.display_name(p_to_user), v_uid,
    private.debit_entries(v_uid, v_amount, private.system_account())
    || jsonb_build_array(
         jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -v_amount),
         jsonb_build_object('account_id', p_to_user, 'coin_kind', 'BONUS', 'amount', v_amount)));

  insert into public.cheers (from_user, to_user, amount, message, activity_id, post_id, club_id, idempotency_key)
  values (v_uid, p_to_user, v_amount, v_msg, p_activity_id, p_post_id, v_club, p_idempotency_key)
  returning id into v_id;
  if p_post_id is not null then
    update public.club_posts set cheer_xu = cheer_xu + v_amount where id = p_post_id;
  end if;

  v_name := private.display_name(v_uid);
  perform private.add_xp(v_uid, v_xp, null);
  perform private.award(p_to_user, 'CHEER_IN', v_name || ' cổ vũ bạn ' || v_amount || ' Xu', v_msg, 0, v_xp,
    'cheer_in:' || v_id, p_activity_id, jsonb_build_object('from', v_uid, 'amount', v_amount));
  perform private.notify(p_to_user, v_club, 'CHEER', v_name || ' cổ vũ bạn ' || v_amount || ' Xu',
    coalesce(v_msg, 'Tiếp tục chạy thật tốt nhé!'), case when v_club is not null then '/clubs/' || v_club else '/me?tab=wallet' end, v_uid, true);
  perform private.quest_progress(v_uid, 'CHEERS_SENT', 1, 'ADD', now(), null);
  perform private.quest_progress(p_to_user, 'CHEERS_RECEIVED', 1, 'ADD', now(), null);
  perform private.evaluate_achievements(v_uid, null);
  perform private.evaluate_achievements(p_to_user, null);
  return jsonb_build_object('cheer_id', v_id, 'balance', private.balance(v_uid));
end $$;

-- Phần thưởng của một bài chạy (màn tổng kết sau chạy)
create or replace function public.activity_rewards(p_activity_id uuid)
returns table (id uuid, kind text, title text, subtitle text, xu numeric, xp integer, payload jsonb, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select e.id, e.kind, e.title, e.subtitle, e.xu, e.xp, e.payload, e.created_at
    from public.game_events e
   where e.activity_id = p_activity_id and e.user_id = auth.uid()
   order by case e.kind when 'RUN' then 0 when 'LEVEL_UP' then 9 else 1 end, e.created_at
$$;

create or replace function public.mark_game_events_seen(p_ids uuid[]) returns void
language sql security definer set search_path = public as $$
  update public.game_events set seen_at = now()
   where user_id = auth.uid() and seen_at is null and (p_ids is null or id = any(p_ids))
$$;

-- Tất cả huy hiệu + trạng thái của tôi (chưa mở hiện điều kiện và tiến độ)
create or replace function public.my_achievements()
returns table (code text, title text, description text, category text, tier text, icon text, xp_reward integer, xu_reward numeric,
               target numeric, progress numeric, unlocked_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); st jsonb := private.player_stats(v_uid);
begin
  return query
  select a.code, a.title, a.description, a.category, a.tier, a.icon, a.xp_reward, a.xu_reward,
         (a.rule->>'gte')::numeric, least(coalesce((st->>(a.rule->>'type'))::numeric, 0), (a.rule->>'gte')::numeric), u.unlocked_at
    from public.achievements a
    left join public.user_achievements u on u.achievement_id = a.id and u.user_id = v_uid
   where a.is_active and a.rule is not null
   order by a.sort;
end $$;

-- Bảng xếp hạng một nhóm league (tuần hiện tại tính trực tiếp, tuần cũ lấy kết quả đã chốt)
create or replace function public.league_standings(p_group_id uuid)
returns table (rank integer, user_id uuid, display_name text, avatar_url text, level integer, points numeric, zone text, is_me boolean)
language plpgsql stable security definer set search_path = public as $$
declare g public.league_groups; n integer; z record;
begin
  perform private.require_uid();
  select * from public.league_groups where id = p_group_id into g;
  if g.id is null then raise exception 'NOT_FOUND'; end if;
  select count(*) from public.league_members where group_id = g.id into n;
  select * from private.league_zones(n, g.tier) into z;
  return query
  with lb as (
    select lm.user_id, case when g.settled_at is null then private.league_points(lm.user_id, g.week_start) else lm.points end as pts,
           lm.joined_at, lm.final_rank
      from public.league_members lm where lm.group_id = g.id),
  rk as (select lb.*, coalesce(lb.final_rank, row_number() over (order by lb.pts desc, lb.joined_at)::int) as r from lb)
  select rk.r, rk.user_id, coalesce(p.display_name, 'Runner'), p.avatar_url, coalesce(p.level, 1), rk.pts,
         case when rk.r <= z.promote and rk.pts > 0 then 'UP' when rk.r > n - z.demote then 'DOWN' else 'STAY' end,
         rk.user_id = auth.uid()
    from rk join public.profiles p on p.id = rk.user_id
   order by rk.r;
end $$;

-- Ví Xu: số dư theo loại + lịch sử từ sổ cái (phân trang theo thời gian)
create or replace function public.my_wallet(p_before timestamptz default null, p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); v_items jsonb;
begin
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb)
    from (
      select t.id, t.type, t.reason, t.created_at, sum(e.amount) as amount,
             jsonb_object_agg(e.coin_kind, e.amount) as by_kind
        from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
       where e.account_id = v_uid and (p_before is null or t.created_at < p_before)
       group by t.id, t.type, t.reason, t.created_at
      having sum(e.amount) <> 0
       order by t.created_at desc
       limit least(greatest(coalesce(p_limit, 30), 1), 100)) x
    into v_items;
  return jsonb_build_object(
    'bonus', private.balance(v_uid, 'BONUS'), 'paid', private.balance(v_uid, 'PAID'), 'total', private.balance(v_uid),
    'items', v_items);
end $$;

-- ---------------------------------------------------------------------
-- 6. Realtime + quyền
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_events') then
    alter publication supabase_realtime add table public.game_events;
  end if;
end $$;

revoke all on function public.my_game_state(), public.daily_checkin(), public.set_weekly_goal(integer),
  public.buy_streak_shield(text), public.send_cheer(uuid, numeric, text, uuid, uuid, text), public.activity_rewards(uuid),
  public.mark_game_events_seen(uuid[]), public.my_achievements(), public.league_standings(uuid), public.my_wallet(timestamptz, integer),
  public.settle_due_leagues()
  from public, anon;
grant execute on function public.my_game_state(), public.daily_checkin(), public.set_weekly_goal(integer),
  public.buy_streak_shield(text), public.send_cheer(uuid, numeric, text, uuid, uuid, text), public.activity_rewards(uuid),
  public.mark_game_events_seen(uuid[]), public.my_achievements(), public.league_standings(uuid), public.my_wallet(timestamptz, integer)
  to authenticated;
revoke all on function public.settle_due_leagues() from authenticated;
grant execute on function public.settle_due_leagues() to service_role;

revoke all on function private.game_config(), private.add_xp(uuid, integer, uuid), private.level_up_event(uuid, integer, uuid),
  private.award(uuid, text, text, text, numeric, integer, text, uuid, jsonb),
  private.quest_progress(uuid, text, numeric, text, timestamptz, uuid), private.week_run_stats(uuid, date),
  private.ensure_streak(uuid), private.streak_on_run(uuid, timestamptz, uuid), private.player_stats(uuid),
  private.evaluate_achievements(uuid, uuid), private.league_join(uuid, date), private.league_points(uuid, date),
  private.settle_league_week(date), private.settle_leagues_due(), private.game_revoke_activity(uuid)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
