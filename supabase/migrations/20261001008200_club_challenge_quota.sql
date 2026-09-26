-- 008200: Hạn mức thử thách CLB theo gói (tham khảo Tucana: Free 30 thành viên / 2 sự kiện đồng thời → Pro → Enterprise)
-- và chặn "CLB một người" dùng miễn phí.
-- • Thử thách NỘI BỘ CLB (chỉ thành viên tham gia) được tạo MIỄN PHÍ trong hạn mức gói:
--     CLB Free: tối đa 2 thử thách đang diễn ra cùng lúc, mỗi thử thách ≤ 50 người,
--               và CLB phải có ≥ 5 thành viên THẬT (đã duyệt, có bài chạy hợp lệ trong 30 ngày).
--     CLB Pro : tối đa 20 thử thách đang diễn ra cùng lúc, mỗi thử thách ≤ 1.000 người, không cần điều kiện thành viên.
--   Ngoài hạn mức (CLB ít người chạy, quá số thử thách đồng thời, quá quy mô) → tính như cũ: lượt tạo của gói, rồi Xu từ quỹ CLB.
--   Không chặn ai: CLB vẫn tạo được, chỉ là mất phí → đủ động lực nâng Pro mà không làm hỏng việc của CLB.
-- • Thử thách công khai / cá nhân: giữ nguyên biểu phí theo quy mô + lượt VIP (một người lập CLB không lách được phí này,
--   vì thử thách CLB chỉ thành viên CLB mới vào được).
-- • Mọi con số nằm trong cấu hình kinh tế, khoá "clubChallenge" — admin sửa ở Quản trị → Chính sách.
-- • create_challenge_v2 được viết lại (bỏ SELECT INTO / LIMIT để chạy được trong SQL Editor), chỉ thêm phần hạn mức CLB.
-- Cần 0700, 2800, 3700, 3800, 7500. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT. Chạy lại an toàn.

create or replace function private.club_challenge_policy() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('freeMinActiveMembers', 5, 'activeWindowDays', 30, 'freeMaxSlots', 50, 'freeMaxOpen', 2,
                            'proMaxSlots', 1000, 'proMaxOpen', 20)
         || coalesce(case when jsonb_typeof(private.economy_config()->'clubChallenge') = 'object'
                          then private.economy_config()->'clubChallenge' end, '{}'::jsonb)
$$;

-- Admin chỉnh hạn mức ở Quản trị → Chính sách: kiểm tra giá trị như 003700 + khoá clubChallenge
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
     and coalesce((c->'clubChallenge'->>'freeMinActiveMembers')::numeric, 5) between 0 and 10000
     and coalesce((c->'clubChallenge'->>'activeWindowDays')::numeric, 30) between 1 and 365
     and coalesce((c->'clubChallenge'->>'freeMaxSlots')::numeric, 50) between 0 and 10000
     and coalesce((c->'clubChallenge'->>'freeMaxOpen')::numeric, 2) between 0 and 10000
     and coalesce((c->'clubChallenge'->>'proMaxSlots')::numeric, 1000) between 0 and 10000
     and coalesce((c->'clubChallenge'->>'proMaxOpen')::numeric, 20) between 0 and 10000
$$;

-- Thành viên "thật": đã duyệt và có ít nhất một bài chạy hợp lệ trong N ngày gần nhất
create or replace function private.club_active_members(p_club uuid, p_days integer) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.club_members m
   where m.club_id = p_club and m.status = 'APPROVED'
     and exists (select 1 from public.activities x
                  where x.user_id = m.user_id and x.validation_status = 'APPROVED'
                    and public.activity_is_countable(x.status, x.validation_status)
                    and x.started_at >= now() - make_interval(days => greatest(p_days, 1)))
$$;

-- Thử thách nội bộ đang diễn ra (chưa kết thúc, chưa huỷ)
create or replace function private.club_open_challenges(p_club uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.challenges c
   where c.target_club_id = p_club and c.target_audience = 'CLUB_ONLY' and c.status = 'ACTIVE' and c.end_date > now()
$$;

create or replace function private.club_challenge_quota_json(p_club uuid, p_slots integer) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  pol jsonb := private.club_challenge_policy();
  v_pro boolean := private.club_is_pro(p_club);
  v_active integer := private.club_active_members(p_club, (pol->>'activeWindowDays')::int);
  v_open integer := private.club_open_challenges(p_club);
  v_min integer := case when v_pro then 0 else (pol->>'freeMinActiveMembers')::int end;
  v_max_open integer := (pol->>case when v_pro then 'proMaxOpen' else 'freeMaxOpen' end)::int;
  v_max_slots integer := (pol->>case when v_pro then 'proMaxSlots' else 'freeMaxSlots' end)::int;
  v_reason text := null;
begin
  if v_active < v_min then v_reason := 'NEED_ACTIVE_MEMBERS';
  elsif v_open >= v_max_open then v_reason := 'OPEN_LIMIT';
  elsif coalesce(p_slots, 1) > v_max_slots then v_reason := 'SLOTS_LIMIT';
  end if;
  return jsonb_build_object('plan', case when v_pro then 'PRO' else 'FREE' end, 'eligible', v_reason is null, 'reason', v_reason,
    'active_members', v_active, 'min_active_members', v_min, 'active_window_days', (pol->>'activeWindowDays')::int,
    'open', v_open, 'max_open', v_max_open, 'max_slots', v_max_slots,
    'free', jsonb_build_object('min_active_members', (pol->>'freeMinActiveMembers')::int, 'max_open', (pol->>'freeMaxOpen')::int,
                               'max_slots', (pol->>'freeMaxSlots')::int),
    'pro', jsonb_build_object('max_open', (pol->>'proMaxOpen')::int, 'max_slots', (pol->>'proMaxSlots')::int));
end $$;

-- Hạn mức thử thách của CLB (thành viên xem được — hiện ở Cài đặt CLB và trình tạo thử thách)
create or replace function public.club_challenge_quota(p_club_id uuid, p_slots integer default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_uid();
  if not public.club_is_member(p_club_id) then raise exception 'NOT_A_MEMBER'; end if;
  return private.club_challenge_quota_json(p_club_id, p_slots);
end $$;

-- Báo giá: thử thách nội bộ trong hạn mức → phí 0, kèm hạn mức để giao diện giải thích
create or replace function public.quote_challenge(p_max_slots integer, p_format text default 'RANKED', p_club_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_slots integer := case when p_format = 'DUEL' then 2 when p_format = 'SOLO_GOAL' then 1 else greatest(coalesce(p_max_slots, 1), 1) end;
  v_fee integer := private.challenge_creation_fee(p_format = 'TEAM', v_slots, now(), now() + interval '1 day');
  v_payer uuid := case when p_club_id is not null and public.club_is_staff(p_club_id) then p_club_id else v_uid end;
  v_quota jsonb := case when v_payer <> v_uid then private.club_challenge_quota_json(v_payer, v_slots) end;
  v_list_fee integer := v_fee;
  v_pass public.challenge_passes;
begin
  if v_fee > 0 and coalesce((v_quota->>'eligible')::boolean, false) then v_fee := 0; end if;
  perform private.issue_credits(case when v_payer = v_uid then 'USER' else 'CLUB' end, v_payer);
  v_pass := (select t.x from (select x, row_number() over (order by x.expires_at nulls last, x.max_slots, x.created_at) as rn
                                from public.challenge_passes x
                               where x.owner_id = v_payer and x.remaining > 0 and x.max_slots >= v_slots
                                 and (x.expires_at is null or x.expires_at > now())) t where t.rn = 1);
  return jsonb_build_object(
    'fee', v_fee, 'list_fee', v_list_fee, 'tier', private.capacity_tier(v_slots), 'custom', private.capacity_tier(v_slots)->>'xu' is null,
    'payer', case when v_payer = v_uid then 'USER' else 'CLUB' end,
    'payer_balance', private.balance(v_payer), 'wallet_balance', private.balance(v_uid),
    'pass', case when v_pass.id is null or v_fee = 0 then null
                 else jsonb_build_object('id', v_pass.id, 'remaining', v_pass.remaining, 'max_slots', v_pass.max_slots,
                                         'expires_at', v_pass.expires_at, 'note', v_pass.note) end,
    'plan', private.plan_badge(v_payer, v_payer <> v_uid),
    'club_quota', v_quota,
    'best_pass_slots', coalesce((select max(x.max_slots) from public.challenge_passes x
                                  where x.owner_id = v_payer and x.remaining > 0 and (x.expires_at is null or x.expires_at > now())), 0),
    'xu_vnd', (private.economy_config()->>'xuVnd')::numeric,
    'policy', private.economy_config());
end $$;

-- Tạo thử thách: như 000700, thêm hạn mức thử thách nội bộ CLB (008200)
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
  v_quota jsonb;
  v_free_reason text;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if exists (select 1 from public.ledger_transactions lt where lt.idempotency_key = v_key) then
    v_existing := (select lt.campaign_id from public.ledger_transactions lt where lt.idempotency_key = v_key);
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
    v_teams := (select array_agg(trim(t.v)) from jsonb_array_elements_text(coalesce(p->'team_names', '[]'::jsonb)) as t(v)
                 where trim(t.v) <> '');
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
    v_club_name := (select cl.name from public.clubs cl where cl.id = v_club);
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
  -- 008200: thử thách nội bộ CLB miễn phí trong hạn mức gói (Free / Pro) — khoá theo CLB để hai người tạo cùng lúc không vượt hạn mức
  if v_club is not null and v_fee > 0 then
    perform pg_advisory_xact_lock(hashtext('club_challenge:' || v_club));
    v_quota := private.club_challenge_quota_json(v_club, v_slots);
    if (v_quota->>'eligible')::boolean then v_fee_waived := v_fee; v_fee := 0; v_free_reason := v_quota->>'plan'; end if;
  end if;
  -- Vé tạo miễn phí (gói VIP / Pro, admin tặng): dùng vé sắp hết hạn trước, vé nhỏ nhất đủ số người
  if v_fee > 0 then
    v_pass := (select t.id from (select x.id, row_number() over (order by x.expires_at nulls last, x.max_slots, x.created_at) as rn
                                   from public.challenge_passes x
                                  where x.owner_id = v_payer and x.remaining > 0 and x.max_slots >= v_slots
                                    and (x.expires_at is null or x.expires_at > now())) t where t.rn = 1);
    if v_pass is not null then
      perform 1 from public.challenge_passes x where x.id = v_pass for update;
      v_fee_waived := v_fee; v_fee := 0;
    end if;
  end if;
  v_need_user := case when v_club is null then v_fee else 0 end + case when v_source = 'CREATOR' then v_reward else 0 end;
  v_need_club := case when v_club is not null then v_fee else 0 end + case when v_source = 'CLUB' then v_reward else 0 end;
  if v_need_user > private.balance(v_uid) then raise exception 'INSUFFICIENT_BALANCE'; end if;
  if v_club is not null and v_need_club > private.balance(v_club) then raise exception 'INSUFFICIENT_TREASURY'; end if;

  v_id := gen_random_uuid();
  insert into public.challenges (id, 
    title, description, format, objective, challenge_type, game_mode, target_type, target_value, target_km,
    min_km, min_pace, max_pace, daily_cap_km, fixed_team_size, min_members, target_audience, target_club_id,
    creator_role, start_date, end_date, reg_deadline, max_slots, calculated_fee, fee_charged,
    reward_xu, reward_source, reward_split, status, created_by)
  values (v_id, 
    v_title, v_desc, v_format, v_objective, case when v_format = 'TEAM' then 'TEAM' else 'INDIVIDUAL' end, v_mode,
    v_objective, v_target, case when v_objective = 'DISTANCE' then v_target else 0 end,
    v_min_km, v_min_pace, v_max_pace, v_cap, v_team_size, 1, v_audience, v_club,
    case when v_club is not null then 'CLUB' else 'MEMBER' end, v_start, v_end,
    case when v_format in ('TEAM') then v_start else v_end end, v_slots, v_fee, v_fee,
    v_reward, v_source, v_split, 'ACTIVE', v_uid);

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
    values ('CHALLENGE_CREATION_FEE', v_key,
            case v_free_reason when 'PRO' then 'Miễn phí (hạn mức CLB Pro)' when 'FREE' then 'Miễn phí (hạn mức CLB)' else 'Miễn phí' end, v_uid, v_id);
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
    update public.challenge_passes set remaining = remaining - 1, updated_at = now() where id = v_pass and remaining > 0;
    update public.challenges set pass_id = v_pass where id = v_id;
  end if;

  return jsonb_build_object('challenge_id', v_id, 'fee', v_fee, 'fee_waived', v_fee_waived, 'pass_used', v_pass is not null, 'club_free', v_free_reason,
                            'invite_code', v_code, 'remaining_balance', private.balance(v_uid));
end $$;
-- Quyền lợi CLB Pro hiển thị (chỉ sửa khi admin chưa đổi câu chữ gốc)
update public.plans set perks = '["Thử thách nội bộ miễn phí: tới 20 thử thách cùng lúc, mỗi thử thách tới 1.000 người", "Không giới hạn quản trị viên", "Tường nhà CLB: ảnh bìa, khẩu hiệu, chủ đề màu", "Link mời riêng + trang công khai /c/tên-clb", "Báo cáo chuyên cần xuất Excel", "Cửa hàng CLB, giao lưu CLB"]'::jsonb
 where code = 'CLUB_PRO'
   and perks = '["2 lượt tạo thử thách ≤100 người / tháng", "Không giới hạn quản trị viên", "Link mời riêng /c/tên-clb", "Báo cáo chuyên cần xuất Excel", "Ví CLB, thương hiệu CLB"]'::jsonb;

revoke all on function private.club_challenge_policy(), private.club_active_members(uuid, integer), private.club_open_challenges(uuid),
  private.club_challenge_quota_json(uuid, integer) from public, anon, authenticated;
revoke all on function public.club_challenge_quota(uuid, integer), public.quote_challenge(integer, text, uuid),
  public.create_challenge_v2(jsonb, text) from public, anon;
grant execute on function public.club_challenge_quota(uuid, integer), public.quote_challenge(integer, text, uuid),
  public.create_challenge_v2(jsonb, text) to authenticated;

notify pgrst, 'reload schema';
