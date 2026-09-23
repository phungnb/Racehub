-- =====================================================================
-- 20261001000600 — ENGINE THỬ THÁCH (Sprint 3, trụ cột ②)
--
-- Hiện trạng trên production trước file này:
--   * Không có cách tham gia thử thách (không có RPC join) → tạo xong không ai vào được
--   * challenge_participants bật RLS nhưng không có policy đọc → BXH không hoạt động
--   * Không có mô hình đội; tiến độ chỉ cộng km, không thu hồi khi bài bị xóa; không tất toán
--
-- File này (ADR-004, ADR-013):
--   * format (SOLO_GOAL · RANKED · DUEL · TEAM · COLLECTIVE) × objective (DISTANCE · RUNS · DURATION · STREAK_DAYS)
--   * Đội: TEAM_SUM · TEAM_AVG · TEAM_GAP (gap nội bộ) · LAST_MEMBER (chốt đoàn)
--   * Tiến độ tính từ challenge_progress_events (mỗi bài chạy một dòng) → đảo ngược được
--   * Trần km mỗi người mỗi ngày; luật pace và cự ly tối thiểu mỗi bài
--   * Thưởng do người tạo hoặc QUỸ CLB treo (ký quỹ qua sổ cái), tất toán tự động, idempotent
--   * KHÔNG có cược giữa người dùng (chờ ý kiến pháp lý — ADR-011)
-- Idempotent: chạy lại nhiều lần không lỗi.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Cột mới cho challenges
-- ---------------------------------------------------------------------
alter table public.challenges add column if not exists format text;
alter table public.challenges add column if not exists objective text;
alter table public.challenges add column if not exists daily_cap_km numeric;
alter table public.challenges add column if not exists reward_xu numeric not null default 0;
alter table public.challenges add column if not exists reward_source text not null default 'NONE';
alter table public.challenges add column if not exists reward_split text not null default 'WINNER';
alter table public.challenges add column if not exists settled_at timestamptz;
alter table public.challenges add column if not exists cancelled_reason text;

update public.challenges set format = case when challenge_type = 'TEAM' then 'TEAM' else 'RANKED' end where format is null;
update public.challenges set objective = 'DISTANCE' where objective is null;
alter table public.challenges alter column format set default 'RANKED';
alter table public.challenges alter column objective set default 'DISTANCE';

alter table public.challenges drop constraint if exists challenges_status_check;
alter table public.challenges add constraint challenges_status_check
  check (status in ('DRAFT', 'ACTIVE', 'FINISHED', 'ARCHIVED', 'CANCELLED'));
alter table public.challenges drop constraint if exists challenges_format_chk;
alter table public.challenges add constraint challenges_format_chk
  check (format in ('SOLO_GOAL', 'RANKED', 'DUEL', 'TEAM', 'COLLECTIVE'));
alter table public.challenges drop constraint if exists challenges_objective_chk;
alter table public.challenges add constraint challenges_objective_chk
  check (objective in ('DISTANCE', 'RUNS', 'DURATION', 'STREAK_DAYS'));
alter table public.challenges drop constraint if exists challenges_reward_chk;
alter table public.challenges add constraint challenges_reward_chk
  check (reward_xu >= 0 and reward_source in ('NONE', 'CREATOR', 'CLUB')
         and reward_split in ('WINNER', 'TOP3', 'FINISHERS', 'TEAM'));

create index if not exists challenges_club_idx on public.challenges (target_club_id) where target_club_id is not null;
create index if not exists challenges_active_idx on public.challenges (status, end_date);

-- ---------------------------------------------------------------------
-- 2. Đội, mã mời, sự kiện tiến độ; cột mới cho người tham gia
-- ---------------------------------------------------------------------
create table if not exists public.challenge_teams (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  color text not null default '#b6ff3b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists challenge_teams_challenge_idx on public.challenge_teams (challenge_id, position);

create table if not exists public.challenge_invites (
  challenge_id uuid primary key references public.challenges(id) on delete cascade,
  code text not null unique check (code ~ '^[a-z0-9]{6,16}$'),
  created_at timestamptz not null default now()
);

-- Người tham gia trùng (dữ liệu cũ) → giữ bản ghi sớm nhất rồi khóa bằng unique
delete from public.challenge_participants a
 using public.challenge_participants b
 where a.challenge_id = b.challenge_id and a.profile_id = b.profile_id
   and (a.joined_at, a.id) > (b.joined_at, b.id);
create unique index if not exists challenge_participants_uidx on public.challenge_participants (challenge_id, profile_id);

alter table public.challenge_participants add column if not exists team_id uuid references public.challenge_teams(id) on delete set null;
alter table public.challenge_participants add column if not exists distance_m numeric not null default 0;
alter table public.challenge_participants add column if not exists moving_s bigint not null default 0;
alter table public.challenge_participants add column if not exists run_count integer not null default 0;
alter table public.challenge_participants add column if not exists streak_days integer not null default 0;
alter table public.challenge_participants add column if not exists completed_at timestamptz;
alter table public.challenge_participants add column if not exists final_rank integer;
alter table public.challenge_participants add column if not exists reward_xu numeric not null default 0;
alter table public.challenge_participants add column if not exists updated_at timestamptz not null default now();
create index if not exists challenge_participants_rank_idx on public.challenge_participants (challenge_id, current_progress desc);

create table if not exists public.challenge_progress_events (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  participant_id uuid not null references public.challenge_participants(id) on delete cascade,
  activity_id uuid not null references public.activities(id) on delete cascade,
  day date not null,
  distance_m numeric not null,
  counted_m numeric not null,
  moving_s integer not null default 0,
  created_at timestamptz not null default now(),
  unique (participant_id, activity_id)
);
create index if not exists challenge_progress_events_activity_idx on public.challenge_progress_events (activity_id);

-- Bài đăng CLB loại "thử thách mới" / "kết quả thử thách"
alter table public.club_posts drop constraint if exists club_posts_kind_check;
alter table public.club_posts add constraint club_posts_kind_check
  check (kind in ('POST', 'ANNOUNCEMENT', 'AUTO_RUN', 'AUTO_JOIN', 'RECAP', 'CHALLENGE'));

-- ---------------------------------------------------------------------
-- 3. Quyền xem
-- ---------------------------------------------------------------------
-- Ai được xem một thử thách: công khai · thành viên CLB (nội bộ) · người tạo · người tham gia
create or replace function public.challenge_visible(p_challenge_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.challenges c
     where c.id = p_challenge_id
       and (c.target_audience = 'PUBLIC'
            or c.created_by = auth.uid()
            or (c.target_audience = 'CLUB_ONLY' and c.target_club_id is not null and public.club_is_member(c.target_club_id))
            or exists (select 1 from public.challenge_participants p
                        where p.challenge_id = c.id and p.profile_id = auth.uid())))
$$;

alter table public.challenge_teams enable row level security;
alter table public.challenge_invites enable row level security;
alter table public.challenge_progress_events enable row level security;

revoke all on public.challenge_teams, public.challenge_invites, public.challenge_progress_events from anon, authenticated;
grant select on public.challenge_teams to authenticated;
revoke insert, update, delete on public.challenges, public.challenge_participants from anon, authenticated;
grant select on public.challenges, public.challenge_participants to authenticated;
revoke select on public.challenges, public.challenge_participants from anon;

drop policy if exists "Cho phép đọc challenge" on public.challenges;
drop policy if exists challenges_select on public.challenges;
create policy challenges_select on public.challenges for select to authenticated
  using (public.challenge_visible(id));

drop policy if exists challenge_participants_select on public.challenge_participants;
create policy challenge_participants_select on public.challenge_participants for select to authenticated
  using (public.challenge_visible(challenge_id));

drop policy if exists challenge_teams_select on public.challenge_teams;
create policy challenge_teams_select on public.challenge_teams for select to authenticated
  using (public.challenge_visible(challenge_id));

-- ---------------------------------------------------------------------
-- 4. Tính tiến độ
-- ---------------------------------------------------------------------
-- Tính lại toàn bộ số liệu của một người tham gia từ các sự kiện (nguồn sự thật duy nhất)
create or replace function private.challenge_recompute_participant(p_participant_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  p public.challenge_participants%rowtype;
  c public.challenges%rowtype;
  v_dist numeric; v_moving bigint; v_runs integer; v_days integer; v_score numeric;
begin
  select * into p from public.challenge_participants where id = p_participant_id for update;
  if not found then return; end if;
  select * into c from public.challenges where id = p.challenge_id;

  select coalesce(sum(counted_m), 0), coalesce(sum(moving_s), 0), count(*) filter (where counted_m > 0)
    into v_dist, v_moving, v_runs
    from public.challenge_progress_events where participant_id = p.id;
  select count(*) into v_days from (
    select day from public.challenge_progress_events where participant_id = p.id
     group by day having sum(distance_m) >= greatest(coalesce(c.min_km, 0), 0.2) * 1000) d;

  v_score := case c.objective
    when 'RUNS' then v_runs
    when 'DURATION' then round(v_moving / 60.0, 1)
    when 'STREAK_DAYS' then v_days
    else round(v_dist / 1000.0, 2) end;

  update public.challenge_participants
     set distance_m = v_dist, moving_s = v_moving, run_count = v_runs, streak_days = v_days,
         current_progress = v_score,
         completed_at = case when coalesce(c.target_value, 0) > 0 and v_score >= c.target_value
                             then coalesce(completed_at, now()) end,
         status = case when status = 'LEFT' then 'LEFT'
                       when coalesce(c.target_value, 0) > 0 and v_score >= c.target_value then 'COMPLETED'
                       else 'JOINED' end,
         updated_at = now()
   where id = p.id;
end $$;

-- Ghi nhận một bài chạy vào các thử thách của người chạy (idempotent)
create or replace function private.challenge_apply_activity(p_activity_id uuid, p_only_participant uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  a public.activities%rowtype;
  r record;
  v_day date;
  v_km numeric;
  v_already numeric;
  v_counted numeric;
  n integer := 0;
begin
  select * into a from public.activities where id = p_activity_id;
  if not found or a.user_id is null or a.validation_status is distinct from 'APPROVED'
     or not public.activity_is_countable(a.status, a.validation_status) then
    return 0;
  end if;
  v_km := greatest(coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0), 0) / 1000.0;
  v_day := (a.started_at at time zone 'Asia/Ho_Chi_Minh')::date;

  for r in
    select p.id as pid, c.*
      from public.challenge_participants p join public.challenges c on c.id = p.challenge_id
     where p.profile_id = a.user_id and p.status in ('JOINED', 'COMPLETED')
       and (p_only_participant is null or p.id = p_only_participant)
       and c.status = 'ACTIVE'
       and a.started_at >= c.start_date and a.started_at < c.end_date
  loop
    -- Luật: cự ly tối thiểu mỗi bài (trừ chuỗi ngày — cộng dồn trong ngày) và khoảng pace
    if r.objective <> 'STREAK_DAYS' and v_km < coalesce(r.min_km, 0) then continue; end if;
    if coalesce(a.avg_pace_s, 0) > 0 and (a.avg_pace_s < coalesce(r.min_pace, 0) * 60
                                          or a.avg_pace_s > coalesce(r.max_pace, 99) * 60) then continue; end if;

    v_counted := v_km * 1000;
    if coalesce(r.daily_cap_km, 0) > 0 then
      select coalesce(sum(counted_m), 0) into v_already from public.challenge_progress_events
       where participant_id = r.pid and day = v_day and activity_id <> a.id;
      v_counted := least(v_counted, greatest(r.daily_cap_km * 1000 - v_already, 0));
    end if;

    insert into public.challenge_progress_events (challenge_id, participant_id, activity_id, day, distance_m, counted_m, moving_s)
    values (r.id, r.pid, a.id, v_day, v_km * 1000, v_counted, coalesce(a.moving_time_s, 0))
    on conflict (participant_id, activity_id) do nothing;
    if found then
      perform private.challenge_recompute_participant(r.pid);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Bài chạy bị xóa / bị từ chối → gỡ khỏi mọi thử thách chưa tất toán
create or replace function private.challenge_revoke_activity(p_activity_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  for pid in
    delete from public.challenge_progress_events e
     using public.challenges c
     where e.activity_id = p_activity_id and c.id = e.challenge_id and c.status = 'ACTIVE'
    returning e.participant_id
  loop
    perform private.challenge_recompute_participant(pid);
  end loop;
end $$;

create or replace function private.challenge_progress_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.validation_status = 'APPROVED' and public.activity_is_countable(new.status, new.validation_status) then
    perform private.challenge_apply_activity(new.id);
  elsif tg_op = 'UPDATE' then
    perform private.challenge_revoke_activity(new.id);
  end if;
  return null;
end $$;

drop trigger if exists trg_challenge_progress on public.activities;
create trigger trg_challenge_progress after insert or update of validation_status, status on public.activities
  for each row execute function private.challenge_progress_trigger();

-- Điểm của từng đội theo chế độ
--   TEAM_SUM: tổng · TEAM_AVG: tổng / số thành viên (người 0 km vẫn tính mẫu số)
--   LAST_MEMBER (chốt đoàn): điểm của người thấp nhất · TEAM_GAP: TB − ½ × (cao nhất − thấp nhất)
create or replace function private.challenge_team_scores(p_challenge_id uuid)
returns table (team_id uuid, name text, color text, "position" integer, members integer, active_members integer,
               total numeric, score numeric)
language sql stable security definer set search_path = public as $$
  with c as (select game_mode from public.challenges where id = p_challenge_id),
  agg as (
    select t.id, t.name, t.color, t.position,
           count(p.id)::int as members,
           count(p.id) filter (where p.current_progress > 0)::int as active_members,
           coalesce(sum(p.current_progress), 0) as total,
           coalesce(min(p.current_progress), 0) as lo,
           coalesce(max(p.current_progress), 0) as hi
      from public.challenge_teams t
      left join public.challenge_participants p on p.team_id = t.id and p.status <> 'LEFT'
     where t.challenge_id = p_challenge_id
     group by t.id)
  select agg.id, agg.name, agg.color, agg.position, agg.members, agg.active_members, round(agg.total, 2),
         round(case (select game_mode from c)
           when 'TEAM_AVG' then case when agg.members > 0 then agg.total / agg.members else 0 end
           when 'LAST_MEMBER' then case when agg.members > 0 then agg.lo else 0 end
           when 'TEAM_GAP' then case when agg.members > 0 then greatest(agg.total / agg.members - (agg.hi - agg.lo) / 2, 0) else 0 end
           else agg.total end, 2)
    from agg
$$;

-- Phí khởi tạo (giữ công thức "Mô hình B" đang cấu hình trong admin)
create or replace function private.challenge_creation_fee(p_team boolean, p_max_slots integer, p_start timestamptz, p_end timestamptz)
returns integer language plpgsql stable security definer set search_path = public as $$
declare v_config jsonb; v_tier jsonb; v_base integer := 50; v_type numeric := 1; v_dur numeric := 1; v_days integer;
begin
  select config_value into v_config from public.system_config_versions
   where config_key = 'challenge_fee_model_b' and status = 'PUBLISHED' order by version desc limit 1;
  if v_config is not null then
    for v_tier in select * from jsonb_array_elements(v_config->'tiers') loop
      if p_max_slots >= (v_tier->>'min')::int and (v_tier->>'max' is null or p_max_slots <= (v_tier->>'max')::int) then
        v_base := (v_tier->>'fee')::int;
      end if;
    end loop;
    v_type := case when p_team then coalesce((v_config->'multipliers'->>'type_team')::numeric, 1.3)
                   else coalesce((v_config->'multipliers'->>'type_individual')::numeric, 1.0) end;
    v_days := extract(day from (p_end - p_start));
    v_dur := case when v_days > 30 then coalesce((v_config->'multipliers'->>'duration_long')::numeric, 1.5)
                  when v_days > 14 then coalesce((v_config->'multipliers'->>'duration_mid_30d')::numeric, 1.2)
                  else coalesce((v_config->'multipliers'->>'duration_short_14d')::numeric, 1.0) end;
  end if;
  return greatest(round(v_base * v_type * v_dur)::int, 0);
end $$;


-- ---------------------------------------------------------------------
-- 4b. Thưởng bài chạy: bỏ khối cộng tiến độ thử thách cũ (nay do trg_challenge_progress)
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

  -- Tiến độ thử thách: do trigger trg_challenge_progress xử lý (migration 000600)

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

-- ---------------------------------------------------------------------
-- 5. Tạo thử thách
--   p: {title, description, format, objective, game_mode, target_value, min_km, min_pace, max_pace,
--       daily_cap_km, start_date, end_date, max_slots, audience, club_id, team_names[], team_size,
--       reward_xu, reward_source, reward_split}
-- ---------------------------------------------------------------------
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
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  select campaign_id into v_existing from public.ledger_transactions where idempotency_key = v_key;
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
    select array_agg(trim(v)) into v_teams from jsonb_array_elements_text(coalesce(p->'team_names', '[]'::jsonb)) as t(v)
     where trim(v) <> '';
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
    select name into v_club_name from public.clubs where id = v_club;
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

  -- Phí khởi tạo: miễn phí cho thử thách nội bộ CLB và mục tiêu cá nhân
  if v_club is null and v_format <> 'SOLO_GOAL' then
    v_fee := private.challenge_creation_fee(v_format = 'TEAM', v_slots, v_start, v_end);
  end if;
  if (v_fee + (case when v_source = 'CREATOR' then v_reward else 0 end)) > private.balance(v_uid) then
    raise exception 'INSUFFICIENT_BALANCE';
  end if;
  if v_source = 'CLUB' and v_reward > private.balance(v_club) then raise exception 'INSUFFICIENT_TREASURY'; end if;

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
    perform private.ledger_post('CHALLENGE_CREATION_FEE', v_key, 'Phí khởi tạo thử thách', v_uid,
      private.debit_entries(v_uid, v_fee, private.system_account()), v_id);
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

  return jsonb_build_object('challenge_id', v_id, 'fee', v_fee, 'invite_code', v_code,
                            'remaining_balance', private.balance(v_uid));
end $$;

create or replace function public.preview_challenge_fee(p_format text, p_max_slots integer, p_start timestamptz, p_end timestamptz, p_club boolean)
returns integer language sql stable security definer set search_path = public as $$
  select case when p_club or p_format = 'SOLO_GOAL' then 0
              else private.challenge_creation_fee(p_format = 'TEAM', case when p_format = 'DUEL' then 2 else p_max_slots end, p_start, p_end) end
$$;

-- ---------------------------------------------------------------------
-- 6. Tham gia / rời / đổi đội / hủy
-- ---------------------------------------------------------------------
create or replace function public.join_challenge(p_challenge_id uuid, p_code text default null, p_team_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.challenges%rowtype;
  v_team uuid := p_team_id;
  v_count integer;
  v_pid uuid;
  v_cur public.challenge_participants%rowtype;
  a record;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if c.status <> 'ACTIVE' or now() >= c.end_date then raise exception 'CHALLENGE_CLOSED'; end if;
  if c.format = 'TEAM' and now() >= c.start_date then raise exception 'TEAM_ROSTER_LOCKED'; end if;

  -- Quyền vào
  if c.target_audience = 'CLUB_ONLY' and not public.club_is_member(c.target_club_id) then raise exception 'CLUB_MEMBERS_ONLY'; end if;
  if c.target_audience = 'INVITE_ONLY' and c.created_by is distinct from v_uid
     and not exists (select 1 from public.challenge_invites where challenge_id = c.id and code = lower(trim(coalesce(p_code, '')))) then
    raise exception 'INVALID_INVITE';
  end if;

  select * into v_cur from public.challenge_participants where challenge_id = c.id and profile_id = v_uid;
  if found and v_cur.status <> 'LEFT' then raise exception 'ALREADY_JOINED'; end if;

  select count(*) into v_count from public.challenge_participants where challenge_id = c.id and status <> 'LEFT';
  if v_count >= coalesce(c.max_slots, 10000) then raise exception 'CHALLENGE_FULL'; end if;

  if c.format = 'TEAM' then
    if v_team is null then   -- chưa chọn đội → vào đội ít người nhất
      select t.id into v_team from public.challenge_teams t
        left join public.challenge_participants p on p.team_id = t.id and p.status <> 'LEFT'
       where t.challenge_id = c.id group by t.id, t.position order by count(p.id), t.position limit 1;
    end if;
    if not exists (select 1 from public.challenge_teams where id = v_team and challenge_id = c.id) then raise exception 'INVALID_TEAM'; end if;
    if coalesce(c.fixed_team_size, 0) > 0 and (select count(*) from public.challenge_participants
         where team_id = v_team and status <> 'LEFT') >= c.fixed_team_size then raise exception 'TEAM_FULL'; end if;
  else
    v_team := null;
  end if;

  if v_cur.id is not null then
    update public.challenge_participants set status = 'JOINED', team_id = v_team, joined_at = now() where id = v_cur.id
    returning id into v_pid;
  else
    insert into public.challenge_participants (challenge_id, profile_id, status, team_id)
    values (c.id, v_uid, 'JOINED', v_team) returning id into v_pid;
  end if;

  -- Tính luôn các bài chạy đã có trong thời gian thử thách
  for a in select id from public.activities
            where user_id = v_uid and validation_status = 'APPROVED'
              and started_at >= c.start_date and started_at < least(c.end_date, now() + interval '1 day')
  loop
    perform private.challenge_apply_activity(a.id, v_pid);
  end loop;

  if c.created_by is not null and c.created_by <> v_uid then
    perform private.notify(c.created_by, c.target_club_id, 'CHALLENGE_JOINED',
      private.display_name(v_uid) || case when c.format = 'DUEL' then ' đã nhận lời thách đấu: ' else ' đã tham gia ' end || c.title,
      null, '/challenges/' || c.id, v_uid, c.format = 'DUEL');
  end if;

  return jsonb_build_object('participant_id', v_pid, 'team_id', v_team);
end $$;

create or replace function public.leave_challenge(p_challenge_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); c public.challenges%rowtype;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if not found then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if c.status <> 'ACTIVE' then raise exception 'CHALLENGE_CLOSED'; end if;
  if now() < c.start_date then
    delete from public.challenge_participants where challenge_id = c.id and profile_id = v_uid;
  elsif c.format in ('TEAM', 'DUEL') then
    raise exception 'CANNOT_LEAVE_STARTED';
  else
    update public.challenge_participants set status = 'LEFT', updated_at = now()
     where challenge_id = c.id and profile_id = v_uid;
  end if;
end $$;

create or replace function public.change_challenge_team(p_challenge_id uuid, p_team_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); c public.challenges%rowtype;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or c.format <> 'TEAM' then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if now() >= c.start_date or c.status <> 'ACTIVE' then raise exception 'TEAM_ROSTER_LOCKED'; end if;
  if not exists (select 1 from public.challenge_teams where id = p_team_id and challenge_id = c.id) then raise exception 'INVALID_TEAM'; end if;
  if coalesce(c.fixed_team_size, 0) > 0 and (select count(*) from public.challenge_participants
       where team_id = p_team_id and status <> 'LEFT' and profile_id <> v_uid) >= c.fixed_team_size then raise exception 'TEAM_FULL'; end if;
  update public.challenge_participants set team_id = p_team_id, updated_at = now()
   where challenge_id = c.id and profile_id = v_uid and status <> 'LEFT';
  if not found then raise exception 'NOT_JOINED'; end if;
end $$;

-- Hoàn lại tiền treo thưởng cho người tạo / quỹ CLB
create or replace function private.challenge_refund_escrow(c public.challenges) returns void
language plpgsql security definer set search_path = public as $$
declare v_to uuid := case when c.reward_source = 'CLUB' then c.target_club_id else c.created_by end;
begin
  if c.reward_source = 'NONE' or coalesce(c.reward_xu, 0) <= 0 or v_to is null then return; end if;
  perform private.ledger_post('CHALLENGE_REFUND', 'challenge_refund:' || c.id, 'Hoàn tiền treo thưởng thử thách', c.created_by,
    jsonb_build_array(
      jsonb_build_object('account_id', v_to, 'coin_kind', 'BONUS', 'amount', c.reward_xu),
      jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -c.reward_xu)), c.id);
  if c.reward_source = 'CLUB' then
    insert into public.club_treasury_log (club_id, user_id, amount, kind, note)
    values (c.target_club_id, c.created_by, c.reward_xu, 'CONTRIBUTE', left('Hoàn thưởng: ' || c.title, 200));
  end if;
end $$;

create or replace function public.cancel_challenge(p_challenge_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); c public.challenges%rowtype; r record;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if c.created_by is distinct from v_uid and not (c.target_club_id is not null and public.club_is_staff(c.target_club_id)) then
    raise exception 'FORBIDDEN';
  end if;
  if c.status <> 'ACTIVE' then raise exception 'CHALLENGE_CLOSED'; end if;
  if now() >= c.start_date and exists (select 1 from public.challenge_participants
       where challenge_id = c.id and profile_id <> c.created_by) then
    raise exception 'CANNOT_CANCEL_STARTED';
  end if;
  update public.challenges set status = 'CANCELLED', cancelled_reason = left(p_reason, 300), settled_at = now() where id = c.id;
  perform private.challenge_refund_escrow(c);
  for r in select profile_id from public.challenge_participants where challenge_id = c.id loop
    perform private.notify(r.profile_id, c.target_club_id, 'CHALLENGE_CANCELLED', 'Thử thách đã bị hủy: ' || c.title,
      p_reason, '/challenges/' || c.id, v_uid, true);
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 7. Đọc: chi tiết, danh sách theo tab, BXH cá nhân, BXH đội
-- ---------------------------------------------------------------------
create or replace function public.get_challenge(p_challenge_id uuid, p_code text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  c public.challenges%rowtype;
  v_code text;
  v_me public.challenge_participants%rowtype;
  v_invited boolean;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if not found then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  select code into v_code from public.challenge_invites where challenge_id = c.id;
  v_invited := v_code is not null and v_code = lower(trim(coalesce(p_code, '')));
  if not public.challenge_visible(c.id) and not v_invited then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  select * into v_me from public.challenge_participants where challenge_id = c.id and profile_id = v_uid;

  return jsonb_build_object(
    'challenge', to_jsonb(c) - 'fee_config_version' - 'pace_min' - 'pace_max',
    'club', (select jsonb_build_object('id', cl.id, 'name', cl.name, 'accent_color', cl.accent_color, 'avatar_url', cl.avatar_url)
               from public.clubs cl where cl.id = c.target_club_id),
    'creator', (select jsonb_build_object('id', pr.id, 'display_name', pr.display_name, 'avatar_url', pr.avatar_url)
                  from public.profiles pr where pr.id = c.created_by),
    'invite_code', case when c.created_by = v_uid or v_me.id is not null or v_invited then v_code end,
    'stats', (select jsonb_build_object(
                'participants', count(*) filter (where status <> 'LEFT'),
                'completed', count(*) filter (where completed_at is not null and status <> 'LEFT'),
                'total_score', coalesce(round(sum(current_progress) filter (where status <> 'LEFT'), 2), 0))
                from public.challenge_participants where challenge_id = c.id),
    'me', case when v_me.id is null then null else to_jsonb(v_me) end,
    'teams', case when c.format = 'TEAM' then (
               select coalesce(jsonb_agg(to_jsonb(t) order by t.score desc, t.position), '[]'::jsonb)
                 from private.challenge_team_scores(c.id) t) end,
    'can_manage', c.created_by = v_uid or (c.target_club_id is not null and public.club_is_staff(c.target_club_id))
  );
end $$;

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
         when 'MINE' then ((me.id is not null and me.status <> 'LEFT') or c.created_by = auth.uid())
                          and (c.status = 'ACTIVE' or c.end_date > now() - interval '30 days')
         when 'DISCOVER' then c.target_audience = 'PUBLIC' and c.status = 'ACTIVE' and c.end_date > now()
                          and (c.format <> 'TEAM' or c.start_date > now())
                          and (me.id is null or me.status = 'LEFT')
         when 'CLUB' then c.target_audience = 'CLUB_ONLY' and public.club_is_member(c.target_club_id)
                          and (p_club_id is null or c.target_club_id = p_club_id)
                          and (c.status = 'ACTIVE' or c.end_date > now() - interval '60 days')
         when 'ENDED' then me.id is not null and (c.status <> 'ACTIVE' or c.end_date <= now())
         else false end
  )
  select b.id, b.title, b.description, b.format, b.objective, b.game_mode, b.target_value, b.start_date, b.end_date,
         b.status, b.target_audience, b.target_club_id, cl.name, cl.accent_color, b.reward_xu, b.n, b.max_slots,
         b.my_status, b.my_score, b.my_rank, round(b.total, 2), b.created_by
    from base b left join public.clubs cl on cl.id = b.target_club_id
   order by (b.status = 'ACTIVE' and b.end_date > now()) desc,
            case when upper(coalesce(p_tab, 'MINE')) = 'DISCOVER' then -b.n else 0 end,
            b.end_date
   limit 60
$$;

create or replace function public.challenge_leaderboard(p_challenge_id uuid)
returns table (
  rank integer, participant_id uuid, user_id uuid, display_name text, avatar_url text, level integer,
  team_id uuid, score numeric, distance_m numeric, run_count integer, moving_s bigint, streak_days integer,
  completed_at timestamptz, reward_xu numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.challenge_visible(p_challenge_id) then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  return query
  select (rank() over (order by p.current_progress desc, p.completed_at asc nulls last))::int,
         p.id, p.profile_id, private.display_name(p.profile_id), pr.avatar_url, coalesce(pr.level, 1)::int,
         p.team_id, p.current_progress, p.distance_m, p.run_count, p.moving_s, p.streak_days, p.completed_at, p.reward_xu
    from public.challenge_participants p join public.profiles pr on pr.id = p.profile_id
   where p.challenge_id = p_challenge_id and p.status <> 'LEFT'
   order by p.current_progress desc, p.completed_at asc nulls last, p.joined_at
   limit 500;
end $$;

create or replace function public.challenge_team_standings(p_challenge_id uuid)
returns table (rank integer, team_id uuid, name text, color text, members integer, active_members integer, total numeric, score numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.challenge_visible(p_challenge_id) then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  return query
  select (rank() over (order by t.score desc))::int, t.team_id, t.name, t.color, t.members, t.active_members, t.total, t.score
    from private.challenge_team_scores(p_challenge_id) t
   order by t.score desc, t."position";
end $$;

-- ---------------------------------------------------------------------
-- 8. Tất toán: xếp hạng, trao thưởng từ tiền ký quỹ, cộng XP, báo kết quả
--    Chạy sau khi kết thúc 2 giờ (để bài chạy đồng bộ muộn vẫn được tính theo giờ bắt đầu)
-- ---------------------------------------------------------------------
create or replace function private.settle_challenge(p_challenge_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  c public.challenges%rowtype;
  v_pool numeric;
  v_users uuid[] := '{}';
  v_weights numeric[] := '{}';
  v_sumw numeric;
  v_amount numeric;
  v_paid numeric := 0;
  v_winners uuid[] := '{}';
  v_top numeric;
  v_names text;
  i integer;
  r record;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or c.status <> 'ACTIVE' or now() < c.end_date then return false; end if;

  update public.challenge_participants p set final_rank = x.rk
    from (select id, (rank() over (order by current_progress desc, completed_at asc nulls last))::int as rk
            from public.challenge_participants where challenge_id = c.id and status <> 'LEFT') x
   where p.id = x.id;

  -- Ai nhận thưởng
  if c.format = 'TEAM' then
    select max(score) into v_top from private.challenge_team_scores(c.id);
    if coalesce(v_top, 0) > 0 then
      select array_agg(p.profile_id), array_agg(1::numeric) into v_users, v_weights
        from public.challenge_participants p
       where p.challenge_id = c.id and p.status <> 'LEFT'
         and p.team_id in (select t.team_id from private.challenge_team_scores(c.id) t where t.score = v_top);
      v_winners := v_users;
    end if;
  elsif c.format = 'SOLO_GOAL' then
    select array_agg(profile_id), array_agg(1::numeric) into v_users, v_weights
      from public.challenge_participants where challenge_id = c.id and status <> 'LEFT' and completed_at is not null;
  elsif c.format = 'COLLECTIVE' then
    if (select coalesce(sum(current_progress), 0) from public.challenge_participants
         where challenge_id = c.id and status <> 'LEFT') >= c.target_value then
      select array_agg(profile_id), array_agg(1::numeric) into v_users, v_weights
        from public.challenge_participants where challenge_id = c.id and status <> 'LEFT' and current_progress > 0;
    end if;
  elsif c.reward_split = 'TOP3' then
    select array_agg(profile_id order by final_rank),
           array_agg(case final_rank when 1 then 50 when 2 then 30 else 20 end::numeric order by final_rank)
      into v_users, v_weights
      from public.challenge_participants
     where challenge_id = c.id and status <> 'LEFT' and final_rank <= 3 and current_progress > 0;
    select array_agg(profile_id) into v_winners from public.challenge_participants
     where challenge_id = c.id and status <> 'LEFT' and final_rank = 1 and current_progress > 0;
  else
    select array_agg(profile_id), array_agg(1::numeric) into v_users, v_weights
      from public.challenge_participants
     where challenge_id = c.id and status <> 'LEFT' and final_rank = 1 and current_progress > 0;
    v_winners := v_users;
  end if;
  v_users := coalesce(v_users, '{}'); v_weights := coalesce(v_weights, '{}'); v_winners := coalesce(v_winners, '{}');

  -- Chia tiền ký quỹ (làm tròn 0,1 Xu; phần lẻ cho người đầu tiên)
  v_pool := case when c.reward_source <> 'NONE' then coalesce(c.reward_xu, 0) else 0 end;
  if v_pool > 0 then
    if cardinality(v_users) = 0 then
      perform private.challenge_refund_escrow(c);
    else
      select sum(w) into v_sumw from unnest(v_weights) w;
      for i in reverse cardinality(v_users) .. 1 loop
        v_amount := case when i = 1 then v_pool - v_paid else floor(v_pool * v_weights[i] / v_sumw * 10) / 10 end;
        if v_amount <= 0 then continue; end if;
        perform private.ledger_post('CHALLENGE_PRIZE', 'challenge_prize:' || c.id || ':' || v_users[i],
          'Thưởng thử thách: ' || c.title, v_users[i],
          jsonb_build_array(
            jsonb_build_object('account_id', v_users[i], 'coin_kind', 'BONUS', 'amount', v_amount),
            jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -v_amount)), c.id);
        update public.challenge_participants set reward_xu = reward_xu + v_amount
         where challenge_id = c.id and profile_id = v_users[i];
        v_paid := v_paid + v_amount;
      end loop;
    end if;
  end if;

  -- XP: hoàn thành mục tiêu +50, về nhất / đội thắng +100
  update public.profiles pr
     set xp = coalesce(pr.xp, 0) + x.bonus, level = private.level_for_xp(coalesce(pr.xp, 0) + x.bonus)
    from (select p.profile_id,
                 (case when p.completed_at is not null then 50 else 0 end
                  + case when p.profile_id = any(v_winners) then 100 else 0 end) as bonus
            from public.challenge_participants p where p.challenge_id = c.id and p.status <> 'LEFT') x
   where pr.id = x.profile_id and x.bonus > 0;

  update public.challenges set status = 'FINISHED', settled_at = now() where id = c.id;

  -- Báo kết quả cho từng người
  for r in select profile_id, final_rank, reward_xu, completed_at from public.challenge_participants
            where challenge_id = c.id and status <> 'LEFT' loop
    perform private.notify(r.profile_id, c.target_club_id, 'CHALLENGE_RESULT', 'Kết quả: ' || c.title,
      case when r.profile_id = any(v_winners) then 'Chúc mừng! Bạn về nhất'
           when r.completed_at is not null then 'Bạn đã hoàn thành mục tiêu'
           else 'Bạn xếp hạng ' || r.final_rank end
      || case when r.reward_xu > 0 then ' · +' || r.reward_xu || ' Xu' else '' end,
      '/challenges/' || c.id, null, true);
  end loop;

  -- Thử thách CLB: đăng kết quả lên bảng tin
  if c.target_club_id is not null then
    select string_agg(private.display_name(u), ', ') into v_names from unnest(v_winners[1:5]) u;
    insert into public.club_posts (club_id, author_id, kind, title, body, meta)
    values (c.target_club_id, null, 'CHALLENGE', 'Kết quả: ' || c.title,
            case when v_names is not null then 'Chúc mừng ' || v_names || '!' else 'Thử thách đã kết thúc.' end,
            jsonb_build_object('challenge_id', c.id, 'result', true, 'format', c.format, 'reward_xu', v_paid));
  end if;
  return true;
end $$;

create or replace function public.settle_challenge_if_due(p_challenge_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform private.require_uid();
  if not public.challenge_visible(p_challenge_id) then return false; end if;
  if not exists (select 1 from public.challenges where id = p_challenge_id and status = 'ACTIVE'
                  and now() >= end_date + interval '2 hours') then return false; end if;
  return private.settle_challenge(p_challenge_id);
end $$;

create or replace function public.settle_due_challenges() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in select id from public.challenges where status = 'ACTIVE' and now() >= end_date + interval '2 hours'
            order by end_date limit 200 loop
    if private.settle_challenge(r.id) then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 9. Realtime + quyền thực thi
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'challenge_participants') then
    alter publication supabase_realtime add table public.challenge_participants;
  end if;
end $$;

revoke all on function public.challenge_visible(uuid), public.create_challenge_v2(jsonb, text),
  public.preview_challenge_fee(text, integer, timestamptz, timestamptz, boolean),
  public.join_challenge(uuid, text, uuid), public.leave_challenge(uuid), public.change_challenge_team(uuid, uuid),
  public.cancel_challenge(uuid, text), public.get_challenge(uuid, text), public.list_challenges(text, uuid),
  public.challenge_leaderboard(uuid), public.challenge_team_standings(uuid), public.settle_challenge_if_due(uuid),
  public.settle_due_challenges()
  from public, anon;
grant execute on function public.challenge_visible(uuid), public.create_challenge_v2(jsonb, text),
  public.preview_challenge_fee(text, integer, timestamptz, timestamptz, boolean),
  public.join_challenge(uuid, text, uuid), public.leave_challenge(uuid), public.change_challenge_team(uuid, uuid),
  public.cancel_challenge(uuid, text), public.get_challenge(uuid, text), public.list_challenges(text, uuid),
  public.challenge_leaderboard(uuid), public.challenge_team_standings(uuid), public.settle_challenge_if_due(uuid)
  to authenticated;
revoke all on function public.settle_due_challenges() from authenticated;
grant execute on function public.settle_due_challenges() to service_role;

revoke all on function private.challenge_recompute_participant(uuid), private.challenge_apply_activity(uuid, uuid),
  private.challenge_revoke_activity(uuid), private.challenge_progress_trigger(), private.challenge_team_scores(uuid),
  private.challenge_creation_fee(boolean, integer, timestamptz, timestamptz), private.challenge_refund_escrow(public.challenges),
  private.settle_challenge(uuid), private.reward_activity(uuid)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
