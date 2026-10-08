-- 014100: Thử thách Công khai do CLB tổ chức.
--   Trước: ban quản trị mở tab Thử thách của CLB nhưng chọn "Công khai" thì thử thách thành của cá nhân
--   (trừ ví / lượt gói cá nhân, không mang tên CLB). Nay ban quản trị tạo được thử thách Công khai mang tên CLB:
--   phí trừ quỹ CLB hoặc dùng lượt gói CLB (CLB Pro); hạn mức miễn phí nội bộ (Free ≤ 50, Pro ≤ 1.000 người)
--   chỉ áp dụng cho thử thách nội bộ. Ai cũng tham gia được; thử thách hiện ở tab Thử thách của CLB và ở Khám phá.
--   quote_challenge thêm bản 4 tham số (p_audience); bản 3 tham số giữ nguyên hành vi cũ (nội bộ) cho app cũ.
-- Chạy riêng được ngay; chạy lại 3500.

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
  -- 014100: thử thách Công khai do CLB tổ chức (ban quản trị tạo, quỹ / lượt gói CLB trả phí, ai cũng tham gia được)
  if v_audience = 'CLUB_ONLY' or (v_audience = 'PUBLIC' and v_club is not null and v_format <> 'DUEL') then
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
  -- 008200: thử thách nội bộ CLB (không áp dụng cho Công khai do CLB tổ chức) miễn phí trong hạn mức gói (Free / Pro) — khoá theo CLB để hai người tạo cùng lúc không vượt hạn mức
  if v_club is not null and v_audience = 'CLUB_ONLY' and v_fee > 0 then
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

create or replace function public.quote_challenge(p_max_slots integer, p_format text, p_club_id uuid, p_audience text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_slots integer := case when p_format = 'DUEL' then 2 else greatest(coalesce(p_max_slots, 1), 1) end;
  v_fee integer := private.challenge_creation_fee(p_format = 'TEAM', v_slots, now(), now() + interval '1 day');
  v_payer uuid := case when p_club_id is not null and coalesce(p_audience, 'CLUB_ONLY') in ('CLUB_ONLY', 'PUBLIC') and p_format <> 'DUEL'
                          and public.club_is_staff(p_club_id) then p_club_id else v_uid end;
  v_quota jsonb := case when v_payer <> v_uid and coalesce(p_audience, 'CLUB_ONLY') = 'CLUB_ONLY' then private.club_challenge_quota_json(v_payer, v_slots) end;
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

-- Bản 3 tham số (app cũ): như trước, coi là thử thách nội bộ CLB
create or replace function public.quote_challenge(p_max_slots integer, p_format text default 'RANKED', p_club_id uuid default null)
returns jsonb language sql security definer set search_path = public as $$
  select public.quote_challenge(p_max_slots, p_format, p_club_id, 'CLUB_ONLY')
$$;

revoke all on function public.quote_challenge(integer, text, uuid, text), public.quote_challenge(integer, text, uuid) from public, anon;
grant execute on function public.quote_challenge(integer, text, uuid, text), public.quote_challenge(integer, text, uuid) to authenticated;

create or replace function public.update_challenge(p_challenge_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := private.require_uid();
  c public.challenges;
  v_title text;
  v_desc text;
  v_target numeric;
  v_min_km numeric;
  v_min_pace numeric;
  v_max_pace numeric;
  v_cap numeric;
  v_start timestamptz;
  v_end timestamptz;
  v_objective text;
  v_conquest boolean;
  v_pledge boolean;
  v_mode text;
  v_slots integer;
  v_joined integer;
  v_audience text;
  v_reward numeric;
  v_diff numeric;
  v_require_hr boolean;
  v_fee integer;
  v_extra integer := 0;
  v_free boolean := false;
  v_quota jsonb;
  v_payer uuid;
  v_names text[];
  v_code text;
  m record;
begin
  perform 1 from public.challenges where id = p_challenge_id for update;
  c := (select x from public.challenges x where x.id = p_challenge_id);
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if not private.challenge_is_manager(c) then raise exception 'FORBIDDEN'; end if;
  if c.status <> 'ACTIVE' then raise exception 'CHALLENGE_CLOSED'; end if;
  -- Sau giờ bắt đầu: giữ luật cũ, không sửa được nữa
  if now() >= c.start_date then raise exception 'CHALLENGE_STARTED'; end if;

  v_title := trim(coalesce(p->>'title', c.title));
  v_desc := case when p ? 'description' then nullif(trim(coalesce(p->>'description', '')), '') else c.description end;
  v_target := coalesce((p->>'target_value')::numeric, c.target_value);
  v_min_km := coalesce((p->>'min_km')::numeric, c.min_km);
  v_min_pace := coalesce((p->>'min_pace')::numeric, c.min_pace);
  v_max_pace := coalesce((p->>'max_pace')::numeric, c.max_pace);
  v_cap := case when p ? 'daily_cap_km' then nullif((p->>'daily_cap_km')::numeric, 0) else c.daily_cap_km end;
  v_start := coalesce((p->>'start_date')::timestamptz, c.start_date);
  v_end := coalesce((p->>'end_date')::timestamptz, c.end_date);
  v_conquest := case when jsonb_typeof(p->'conquest') = 'object' then true
                     when p ? 'objective' then upper(p->>'objective') in ('BEST_TIME', 'BEST_PACE')
                     else c.objective in ('BEST_TIME', 'BEST_PACE') end;
  v_objective := case when jsonb_typeof(p->'conquest') = 'object' then upper(coalesce(p->'conquest'->>'objective', ''))
                      else upper(coalesce(nullif(p->>'objective', ''), c.objective)) end;
  v_pledge := case when p ? 'pledge' then jsonb_typeof(p->'pledge') = 'object' else coalesce(c.pledge_enabled, false) end;
  v_require_hr := coalesce((p->>'require_hr')::boolean, c.require_hr);
  v_reward := round(coalesce((p->>'reward_xu')::numeric, c.reward_xu, 0), 1);
  v_audience := upper(coalesce(nullif(p->>'audience', ''), c.target_audience));

  -- Kiểm tra như lúc tạo (create_challenge_v2)
  if char_length(v_title) not between 3 and 120 then raise exception 'INVALID_TITLE'; end if;
  if v_desc is not null and char_length(v_desc) > 2000 then raise exception 'DESC_TOO_LONG'; end if;
  if v_end <= v_start or v_end - v_start < interval '1 hour' or v_end - v_start > interval '366 days' then raise exception 'INVALID_TIME_RANGE'; end if;
  if v_start < now() then raise exception 'INVALID_TIME_RANGE'; end if;
  if c.format = 'TEAM' and v_start < now() + interval '10 minutes' then raise exception 'TEAM_START_TOO_SOON'; end if;
  if v_target < 0 or v_min_km < 0 or v_min_km > 100 or coalesce(v_cap, 0) < 0 then raise exception 'INVALID_DISTANCE'; end if;
  if v_min_pace <= 0 or v_max_pace < v_min_pace or v_max_pace > 30 then raise exception 'INVALID_PACE'; end if;

  -- Cách tính điểm: mỗi thể thức có lựa chọn riêng (như trình tạo)
  if v_objective is distinct from c.objective and not (
       (c.format = 'SOLO_GOAL' and v_objective in ('DISTANCE', 'BEST_TIME', 'BEST_PACE', 'STREAK_DAYS'))
    or (c.format in ('RANKED', 'COLLECTIVE') and v_objective = 'DISTANCE')
    or (c.format = 'TEAM' and v_objective in ('DISTANCE', 'RUNS', 'DURATION'))
    or (c.format = 'DUEL' and v_objective in ('DISTANCE', 'RUNS', 'DURATION', 'STREAK_DAYS'))) then
    raise exception 'INVALID_OBJECTIVE';
  end if;
  -- Chuyển sang chinh phục phải kèm các hạng mục
  if v_conquest and c.objective not in ('BEST_TIME', 'BEST_PACE') and jsonb_typeof(p->'conquest') is distinct from 'object' then
    raise exception 'INVALID_CONQUEST';
  end if;
  if v_pledge and (v_conquest or v_objective <> 'DISTANCE' or c.format not in ('SOLO_GOAL', 'TEAM')) then raise exception 'PLEDGE_NOT_SUPPORTED'; end if;
  -- Đua đội theo mục tiêu ↔ đua đội thường: cách chia đội khác hẳn → tạo thử thách mới
  if c.format = 'TEAM' and v_pledge is distinct from coalesce(c.pledge_enabled, false) then raise exception 'TEAM_MODE_LOCKED'; end if;
  if c.format in ('SOLO_GOAL', 'COLLECTIVE') and not v_conquest and not v_pledge and v_target <= 0 then raise exception 'TARGET_REQUIRED'; end if;
  if v_objective = 'STREAK_DAYS' and (v_min_km <= 0 or v_target > ceil(extract(epoch from v_end - v_start) / 86400)) then
    raise exception 'INVALID_STREAK';
  end if;
  v_mode := case when c.format = 'TEAM' then case when v_pledge then 'TEAM_SUM' else coalesce(nullif(p->>'game_mode', ''), c.game_mode) end
                 when v_objective = 'STREAK_DAYS' then 'STREAK' else 'ACCUMULATE' end;
  if c.format = 'TEAM' and v_mode not in ('TEAM_SUM', 'TEAM_AVG', 'TEAM_GAP', 'LAST_MEMBER') then raise exception 'INVALID_GAME_MODE'; end if;

  -- Tên đội (đua đội thường): đổi tên đúng số đội hiện có
  if c.format = 'TEAM' and not v_pledge and jsonb_typeof(p->'team_names') = 'array' then
    v_names := array(select trim(t.v) from jsonb_array_elements_text(p->'team_names') with ordinality as t(v, ord) order by t.ord);
    if cardinality(v_names) <> (select count(*) from public.challenge_teams where challenge_id = c.id)
       or exists (select 1 from unnest(v_names) as t(v) where char_length(t.v) not between 1 and 40)
       or (select count(distinct lower(t.v)) from unnest(v_names) as t(v)) <> cardinality(v_names) then
      raise exception 'INVALID_TEAMS';
    end if;
  end if;

  -- Số người tối đa: không nhỏ hơn số người đã tham gia
  v_slots := case when c.format = 'DUEL' then 2 else coalesce((p->>'max_slots')::int, c.max_slots) end;
  if v_slots not between 1 and 10000 then raise exception 'INVALID_MAX_SLOTS'; end if;
  if c.format = 'TEAM' and coalesce(c.fixed_team_size, 0) > 0 then
    v_slots := least(v_slots, c.fixed_team_size * greatest((select count(*)::int from public.challenge_teams where challenge_id = c.id), 1));
  end if;
  v_joined := (select count(*)::int from public.challenge_participants where challenge_id = c.id and status <> 'LEFT');
  if v_slots < v_joined then raise exception 'SLOTS_BELOW_JOINED'; end if;

  -- Đối tượng: chỉ đổi Công khai ↔ Có mã mời (thử thách CLB / 1-1 giữ nguyên vì liên quan quỹ CLB và lời mời)
  if v_audience is distinct from c.target_audience
     and (c.target_club_id is not null or c.format = 'DUEL' or v_audience not in ('PUBLIC', 'INVITE_ONLY')) then
    raise exception 'AUDIENCE_LOCKED';
  end if;

  -- Phí quy mô: chỉ thu thêm khi lên mức phí cao hơn mức đã trả (hạn mức CLB / lượt miễn phí còn bao được thì miễn)
  v_payer := coalesce(c.target_club_id, c.created_by);
  if v_slots > c.max_slots then
    v_fee := private.challenge_creation_fee(c.format = 'TEAM', v_slots, v_start, v_end);
    if v_fee > coalesce(c.fee_charged, 0) then
      if c.target_club_id is not null and c.target_audience = 'CLUB_ONLY' then
        perform pg_advisory_xact_lock(hashtext('club_challenge:' || c.target_club_id));
        v_quota := private.club_challenge_quota_json(c.target_club_id, v_slots);
        -- Thử thách này đã nằm trong số đang mở → không tính chính nó khi xét số thử thách đồng thời
        v_free := (v_quota->>'reason') is null
               or ((v_quota->>'reason') = 'OPEN_LIMIT' and (v_quota->>'open')::int - 1 < (v_quota->>'max_open')::int
                   and v_slots <= (v_quota->>'max_slots')::int);
      end if;
      if not v_free and c.pass_id is not null then
        v_free := coalesce((select x.max_slots from public.challenge_passes x where x.id = c.pass_id), 0) >= v_slots;
      end if;
      if not v_free then v_extra := v_fee - coalesce(c.fee_charged, 0); end if;
    end if;
  end if;

  -- Thưởng: chỉ quỹ CLB treo thưởng; tối đa 50% (quỹ hiện có + phần đang ký quỹ) như lúc tạo
  v_diff := v_reward - coalesce(c.reward_xu, 0);
  if v_reward < 0 or v_reward > 100000 then raise exception 'INVALID_AMOUNT'; end if;
  if v_diff <> 0 and (c.target_club_id is null or c.reward_source = 'CREATOR') then raise exception 'REWARD_NOT_ALLOWED'; end if;
  if v_diff > 0 and v_reward > (private.balance(c.target_club_id) + coalesce(c.reward_xu, 0)) * 0.5 then raise exception 'REWARD_TOO_LARGE'; end if;
  if c.target_club_id is not null and (case when v_payer = c.target_club_id then v_extra else 0 end) + greatest(v_diff, 0) > private.balance(c.target_club_id) then
    raise exception 'INSUFFICIENT_TREASURY';
  end if;
  if c.target_club_id is null and v_extra > private.balance(v_payer) then raise exception 'INSUFFICIENT_BALANCE'; end if;

  -- Sổ cái: phí chênh + ký quỹ chênh (mỗi lần sửa một mã giao dịch riêng, không đụng mã của lúc tạo / huỷ)
  if v_extra > 0 then
    perform private.ledger_post('CHALLENGE_CREATION_FEE', 'challenge_edit_fee:' || c.id || ':' || gen_random_uuid(),
      case when c.target_club_id is not null then 'Phí tăng quy mô thử thách (quỹ CLB)' else 'Phí tăng quy mô thử thách' end, v_uid,
      private.debit_entries(v_payer, v_extra, private.system_account()), c.id);
    if c.target_club_id is not null then
      insert into public.club_treasury_log (club_id, user_id, amount, kind, note)
      values (c.target_club_id, v_uid, -v_extra, 'SPEND', left('Phí tăng quy mô thử thách: ' || v_title, 200));
    end if;
  end if;
  if v_diff > 0 then
    perform private.ledger_post('CHALLENGE_ESCROW', 'challenge_escrow_adj:' || c.id || ':' || gen_random_uuid(), 'Tăng treo thưởng thử thách (quỹ CLB)', v_uid,
      private.debit_entries(c.target_club_id, v_diff, private.system_account()), c.id);
    insert into public.club_treasury_log (club_id, user_id, amount, kind, note)
    values (c.target_club_id, v_uid, -v_diff, 'REWARD', left('Tăng treo thưởng: ' || v_title, 200));
  elsif v_diff < 0 then
    perform private.ledger_post('CHALLENGE_REFUND', 'challenge_refund_adj:' || c.id || ':' || gen_random_uuid(), 'Giảm treo thưởng thử thách — hoàn quỹ CLB', v_uid,
      jsonb_build_array(
        jsonb_build_object('account_id', c.target_club_id, 'coin_kind', 'BONUS', 'amount', -v_diff),
        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', v_diff)), c.id);
    insert into public.club_treasury_log (club_id, user_id, amount, kind, note)
    values (c.target_club_id, v_uid, -v_diff, 'CONTRIBUTE', left('Hoàn bớt treo thưởng: ' || v_title, 200));
  end if;

  update public.challenges
     set title = v_title, description = v_desc, target_value = v_target,
         objective = case when v_conquest then objective else v_objective end,
         target_type = case when v_conquest then target_type else v_objective end,
         target_km = case when not v_conquest and v_objective = 'DISTANCE' then v_target else 0 end,
         game_mode = v_mode,
         min_km = v_min_km, min_pace = v_min_pace, max_pace = v_max_pace, daily_cap_km = v_cap,
         start_date = v_start, end_date = v_end,
         reg_deadline = case when format = 'TEAM' then least(coalesce(reg_deadline, v_start), v_start)
                             when reg_deadline is null or reg_deadline = c.end_date or reg_deadline > v_end then v_end
                             else reg_deadline end,
         max_slots = v_slots,
         calculated_fee = case when v_slots > c.max_slots then greatest(coalesce(calculated_fee, 0), coalesce(v_fee, 0)) else calculated_fee end,
         fee_charged = coalesce(fee_charged, 0) + v_extra,
         reward_xu = v_reward,
         reward_source = case when v_diff = 0 then reward_source when v_reward > 0 then 'CLUB' else 'NONE' end,
         target_audience = v_audience,
         require_hr = v_require_hr
   where id = c.id;

  -- Bỏ chinh phục → bỏ các hạng mục (kèm đăng ký)
  if not v_conquest and c.objective in ('BEST_TIME', 'BEST_PACE') then
    delete from public.challenge_categories where challenge_id = c.id;
    update public.challenges set conquest_mode = null where id = c.id;
  end if;
  if jsonb_typeof(p->'conquest') = 'object' then
    perform public.set_challenge_conquest(c.id, p->'conquest');
  end if;
  -- Mục tiêu tự đăng ký: bật / đổi mốc (set_challenge_pledge) hoặc tắt (bỏ mục tiêu đã chọn)
  if jsonb_typeof(p->'pledge') = 'object' then
    perform public.set_challenge_pledge(c.id, p->'pledge');
  elsif p ? 'pledge' and coalesce(c.pledge_enabled, false) then
    update public.challenges
       set pledge_enabled = false, pledge_options = null, pledge_min_km = null, pledge_max_km = null, pledge_cap_pct = null
     where id = c.id;
    update public.challenge_participants set pledge_km = null, pledged_at = null where challenge_id = c.id;
  end if;
  -- Chinh phục cá nhân theo mục tiêu: mục tiêu chung = mốc thấp nhất (như lúc tạo)
  update public.challenges x
     set target_value = coalesce((select min(o) from unnest(x.pledge_options) as o), x.pledge_min_km, x.target_value),
         target_km = coalesce((select min(o) from unnest(x.pledge_options) as o), x.pledge_min_km, x.target_value)
   where x.id = c.id and x.pledge_enabled and x.format = 'SOLO_GOAL';

  -- Tên đội
  if v_names is not null then
    update public.challenge_teams t set name = v_names[t.position]
     where t.challenge_id = c.id and t.position between 1 and cardinality(v_names);
  end if;
  -- Có mã mời: tạo mã nếu chưa có
  if v_audience <> 'PUBLIC' and not exists (select 1 from public.challenge_invites where challenge_id = c.id) then
    loop
      v_code := substr(md5(gen_random_uuid()::text), 1, 8);
      exit when not exists (select 1 from public.challenge_invites where code = v_code);
    end loop;
    insert into public.challenge_invites (challenge_id, code) values (c.id, v_code);
  end if;

  perform private.challenge_recompute_all(c.id);

  -- Bài giới thiệu thử thách trên bảng tin CLB
  update public.club_posts
     set title = v_title, body = coalesce(v_desc, ''),
         meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('target_value', v_target, 'start_date', v_start, 'end_date', v_end,
                                                                 'reward_xu', v_reward, 'objective', (select x.objective from public.challenges x where x.id = c.id))
   where kind = 'CHALLENGE' and deleted_at is null and meta->>'challenge_id' = c.id::text;

  for m in select profile_id from public.challenge_participants
            where challenge_id = c.id and profile_id is not null and coalesce(status, 'JOINED') <> 'LEFT' and profile_id <> v_uid loop
    perform private.notify(m.profile_id, c.target_club_id, 'CHALLENGE_UPDATED', 'Thử thách "' || left(v_title, 80) || '" vừa được cập nhật',
      'Xem lại thời gian, luật và giải thưởng trước khi bắt đầu.', '/challenges/' || c.id, v_uid, true);
  end loop;

  return jsonb_build_object('id', c.id, 'title', v_title, 'start_date', v_start, 'end_date', v_end,
                            'fee_extra', v_extra, 'reward_diff', v_diff, 'invite_code', (select code from public.challenge_invites where challenge_id = c.id));
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
           case when me.status <> 'LEFT' then me.pledge_km end as my_pledge,
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
                          and ((c.target_audience = 'CLUB_ONLY' and public.club_is_member(c.target_club_id))
                               or (c.target_audience = 'PUBLIC' and c.target_club_id is not null
                                   and (p_club_id is not null or public.club_is_member(c.target_club_id))))
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
  select b.id, b.title, b.description, b.format, b.objective, b.game_mode,
         -- 013300: thử thách tự đăng ký mục tiêu → mục tiêu người xem đã chọn (chưa chọn: mốc thấp nhất như cũ)
         case when coalesce(b.pledge_enabled, false) and b.my_pledge is not null then b.my_pledge else b.target_value end,
         b.start_date, b.end_date,
         b.status, b.target_audience, b.target_club_id, cl.name, cl.accent_color, b.reward_xu, b.n, b.max_slots,
         b.my_status, b.my_score, b.my_rank, round(b.total, 2), b.created_by
    from ranked b left join public.clubs cl on cl.id = b.target_club_id
   where b.rn <= 60
   order by b.rn
$$;

notify pgrst, 'reload schema';
