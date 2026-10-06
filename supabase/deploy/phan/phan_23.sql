-- RaceHub — PHẦN 23/25 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 013300, 013400
-- Supabase → SQL Editor → New query → dán TOÀN BỘ phần này → Run. Lỗi thì không có gì thay đổi; chạy lại vẫn an toàn.
-- Xong thì chạy phần tiếp theo.
begin;
-- ===================================================================
-- 20261001013300_challenge_round7.sql
-- ===================================================================
-- 013300: Chỉnh sửa lần 7 — THỬ THÁCH.
-- 1. Danh sách thử thách: thử thách theo mục tiêu tự đăng ký trả target_value = mục tiêu CỦA NGƯỜI XEM (đã đăng ký),
--    thay cho mốc thấp nhất (VD đăng ký 21 km nhưng thẻ thử thách vẫn hiện 11 km).
-- 2. Sửa thử thách TRƯỚC giờ bắt đầu — người tạo / BTC được sửa mọi hạng mục (sau giờ bắt đầu giữ luật cũ: CHALLENGE_STARTED):
--    tên, mô tả, thời gian (bỏ giới hạn thời lượng: phí khởi tạo chỉ tính theo quy mô), mục tiêu, luật km / pace, cách tính điểm,
--    cách tính đội + tên đội, số người tối đa, đối tượng (Công khai ↔ Có mã mời), thưởng Xu quỹ CLB, bắt buộc nhịp tim,
--    mục tiêu tự đăng ký (bật / tắt / đổi mốc), hạng mục chinh phục (kể cả khi đã có người đăng ký).
--    • Số người tối đa không nhỏ hơn số người đã tham gia. Tăng quy mô sang mức phí cao hơn: thu phần chênh qua sổ cái
--      (CHALLENGE_CREATION_FEE, như lúc tạo; hạn mức CLB / lượt miễn phí còn bao được thì không thu). Giảm quy mô không hoàn phí
--      (phí khởi tạo không hoàn, như khi huỷ).
--    • Đổi thưởng: phần chênh đi qua sổ cái — tăng thì ký quỹ thêm (CHALLENGE_ESCROW), giảm thì hoàn quỹ CLB (CHALLENGE_REFUND),
--      kèm nhật ký quỹ CLB. Tổng ký quỹ luôn bằng reward_xu nên tất toán / huỷ (challenge_refund_escrow) vẫn đúng.
--    • Mọi người đã tham gia nhận thông báo CHALLENGE_UPDATED; ai mất mục tiêu / hạng mục đã đăng ký được nhắc chọn lại.
-- 3. Thử thách lặp hằng tuần: tên kỳ mới lấy số tuần ISO của kỳ mới ("Thử thách tuần 41" → "Thử thách tuần 42"),
--    không thêm "· Kỳ 2". Kỳ mới của thử thách chinh phục chép luôn các hạng mục.
-- 4. Vinh danh theo mục tiêu BTC đặt: GOAL<mét> (người chọn mục tiêu đó và đã hoàn thành) và CAT<thứ tự> (hạng mục chinh phục,
--    người đạt, kết quả nhanh nhất trước).
-- 5. Chinh phục cá nhân: đã đăng ký rồi mà có kết quả cho một cự ly (bài ≥ cự ly trong thời gian thử thách) thì không sửa đăng ký
--    cự ly đó nữa — không thêm, không đổi mục tiêu, không bỏ (CONQUEST_RESULT_LOCKED). Lần đăng ký đầu (tham gia trễ) vẫn như cũ:
--    mọi bài từ ngày bắt đầu đều được tính.
-- Cần 013100. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

-- ---------------------------------------------------------------------
-- 1. Danh sách: mục tiêu của chính người xem (bản 005400)
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 2. Sửa thử thách trước giờ bắt đầu: toàn quyền (bản 013100 mở rộng)
-- ---------------------------------------------------------------------
-- Mục tiêu tự đăng ký (bản 002200): trước giờ bắt đầu, ai có mục tiêu không còn hợp lệ với mốc mới thì bỏ mục tiêu + nhắc chọn lại
create or replace function public.set_challenge_pledge(p_challenge_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
  v_opts numeric[];
  v_min numeric := nullif((p->>'min_km')::numeric, 0);
  v_max numeric := nullif((p->>'max_km')::numeric, 0);
  v_cap numeric := (p->>'cap_pct')::numeric;
  v_size integer := nullif((p->>'team_size')::int, 0);
  m record;
begin
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if not private.challenge_is_manager(c) then raise exception 'FORBIDDEN'; end if;
  if c.status <> 'ACTIVE' or now() >= c.end_date then raise exception 'CHALLENGE_CLOSED'; end if;
  if c.objective <> 'DISTANCE' or c.format not in ('SOLO_GOAL', 'TEAM') then raise exception 'PLEDGE_NOT_SUPPORTED'; end if;
  -- Đã có người đăng ký mục tiêu và đã xuất phát → không đổi luật giữa chừng
  if now() >= c.start_date and exists (select 1 from public.challenge_participants x
                                         where x.challenge_id = c.id and x.pledge_km is not null) then
    raise exception 'PLEDGE_RULES_LOCKED';
  end if;

  v_opts := (select array_agg(v order by v) from (
               select distinct round((e)::numeric, 1) as v from jsonb_array_elements_text(coalesce(p->'options', '[]'::jsonb)) as t(e)) s);
  if v_opts is not null and (array_length(v_opts, 1) > 8 or v_opts[1] <= 0 or v_opts[array_length(v_opts, 1)] > 5000) then
    raise exception 'INVALID_PLEDGE_OPTIONS';
  end if;
  if v_opts is null and (v_min is null or v_max is null or v_min > v_max or v_max > 5000) then
    raise exception 'INVALID_PLEDGE_OPTIONS';
  end if;
  if v_cap is not null and (v_cap < 0 or v_cap > 500) then raise exception 'INVALID_PLEDGE_CAP'; end if;
  if v_size is not null and (c.format <> 'TEAM' or v_size < 2 or v_size > 50) then raise exception 'INVALID_TEAM_SIZE'; end if;

  update public.challenges
     set pledge_enabled = true, pledge_options = v_opts,
         pledge_min_km = case when v_opts is null then v_min end, pledge_max_km = case when v_opts is null then v_max end,
         pledge_cap_pct = v_cap, pledge_team_size = v_size,
         game_mode = case when format = 'TEAM' then 'TEAM_SUM' else game_mode end,
         reward_split = case when format = 'SOLO_GOAL' then 'FINISHERS' else reward_split end
   where id = c.id;

  -- 013300: mục tiêu cũ không còn trong mốc mới → bỏ, nhắc người đó chọn lại (chỉ xảy ra trước giờ bắt đầu)
  for m in select x.id, x.profile_id from public.challenge_participants x
            where x.challenge_id = c.id and x.status <> 'LEFT' and x.pledge_km is not null
              and case when v_opts is not null then not (x.pledge_km = any (v_opts)) else x.pledge_km < v_min or x.pledge_km > v_max end loop
    update public.challenge_participants set pledge_km = null, pledged_at = null, updated_at = now() where id = m.id;
    perform private.notify(m.profile_id, c.target_club_id, 'CHALLENGE_UPDATED', 'Chọn lại mục tiêu: ' || left(c.title, 80),
      'Ban tổ chức đã đổi các mục tiêu, mục tiêu cũ của bạn không còn. Vào chọn mục tiêu mới trước giờ bắt đầu.',
      '/challenges/' || c.id, v_uid, true);
  end loop;
  perform private.challenge_recompute_all(c.id);
  return jsonb_build_object('options', v_opts, 'min_km', v_min, 'max_km', v_max, 'cap_pct', v_cap, 'team_size', v_size);
end $$;

-- Hạng mục chinh phục (bản 010700): trước giờ bắt đầu sửa được cả khi đã có người đăng ký.
-- Hạng mục giữ nguyên cự ly thì giữ đăng ký; đổi cự ly / bỏ hạng mục / đổi kiểu (thời gian ↔ pace, BTC đặt ↔ tự đặt) thì
-- đăng ký liên quan bị xoá và người đó được nhắc chọn lại. Sau giờ bắt đầu: đã có người đăng ký thì khoá như cũ.
create or replace function public.set_challenge_conquest(p_challenge_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
  v_obj text := upper(coalesce(p->>'objective', ''));
  v_mode text := upper(coalesce(p->>'mode', 'FIXED'));
  v_cats jsonb := case when jsonb_typeof(p->'categories') = 'array' then p->'categories' else '[]'::jsonb end;
  v_n integer := jsonb_array_length(case when jsonb_typeof(p->'categories') = 'array' then p->'categories' else '[]'::jsonb end);
  v_min_m numeric;
  v_before uuid[];
  m record;
begin
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if not private.challenge_is_manager(c) then raise exception 'FORBIDDEN'; end if;
  if c.status <> 'ACTIVE' or now() >= c.end_date then raise exception 'CHALLENGE_CLOSED'; end if;
  if c.format <> 'SOLO_GOAL' then raise exception 'CONQUEST_NOT_SUPPORTED'; end if;
  if v_obj not in ('BEST_TIME', 'BEST_PACE') or v_mode not in ('FIXED', 'SELF') then raise exception 'INVALID_CONQUEST'; end if;
  if v_n not between 1 and 8 then raise exception 'INVALID_CONQUEST'; end if;
  if now() >= c.start_date and exists (select 1 from public.challenge_category_entries e where e.challenge_id = c.id) then
    raise exception 'CONQUEST_LOCKED';
  end if;
  begin
    if exists (select 1 from jsonb_array_elements(v_cats) x
                where char_length(trim(coalesce(x->>'label', ''))) not between 1 and 40
                   or (x->>'distance_km')::numeric not between 0.4 and 250
                   or (v_mode = 'FIXED' and coalesce((x->>'target_s')::int, 0) <= 0)
                   or (v_mode = 'FIXED' and v_obj = 'BEST_PACE' and (x->>'target_s')::int not between 120 and 1500)
                   or (v_mode = 'FIXED' and v_obj = 'BEST_TIME' and (x->>'target_s')::int not between 60 and 172800)) then
      raise exception 'INVALID_CONQUEST';
    end if;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'INVALID_CONQUEST';
  end;

  -- Ai đang có đăng ký (để nhắc nếu mất)
  v_before := (select coalesce(array_agg(distinct e.user_id), '{}') from public.challenge_category_entries e where e.challenge_id = c.id);
  -- Đổi kiểu tính / ai đặt mục tiêu: mục tiêu tự đặt cũ không còn ý nghĩa
  if c.objective is distinct from v_obj or c.conquest_mode is distinct from v_mode then
    delete from public.challenge_category_entries where challenge_id = c.id;
  end if;
  -- Hạng mục bị bỏ (vị trí > số hạng mục mới) — xoá kèm đăng ký
  delete from public.challenge_categories where challenge_id = c.id and position > v_n;
  -- Hạng mục đổi cự ly: bỏ đăng ký của hạng mục đó
  delete from public.challenge_category_entries e
   using public.challenge_categories cat, jsonb_array_elements(v_cats) with ordinality as t(x, ord)
   where e.category_id = cat.id and cat.challenge_id = c.id and cat.position = t.ord
     and cat.distance_m <> round((t.x->>'distance_km')::numeric * 1000);
  update public.challenge_categories cat
     set label = trim(t.x->>'label'), distance_m = round((t.x->>'distance_km')::numeric * 1000),
         target_s = case when v_mode = 'FIXED' then (t.x->>'target_s')::int end
    from jsonb_array_elements(v_cats) with ordinality as t(x, ord)
   where cat.challenge_id = c.id and cat.position = t.ord;
  insert into public.challenge_categories (challenge_id, position, label, distance_m, target_s)
  select c.id, t.ord, trim(t.x->>'label'), round((t.x->>'distance_km')::numeric * 1000),
         case when v_mode = 'FIXED' then (t.x->>'target_s')::int end
    from jsonb_array_elements(v_cats) with ordinality as t(x, ord)
   where not exists (select 1 from public.challenge_categories x where x.challenge_id = c.id and x.position = t.ord);

  v_min_m := (select min(distance_m) from public.challenge_categories where challenge_id = c.id);
  update public.challenges
     set objective = v_obj, conquest_mode = v_mode, target_value = 1, target_type = v_obj, target_km = 0,
         pledge_enabled = false, reward_split = 'FINISHERS', game_mode = 'ACCUMULATE',
         -- bài ngắn hơn hạng mục nhỏ nhất không thể cho kết quả → không cần ghi nhận
         min_km = round(v_min_m * 0.99 / 1000.0, 2)
   where id = c.id;
  update public.challenge_participants set pledge_km = null where challenge_id = c.id and pledge_km is not null;

  for m in select u.uid from unnest(v_before) as u(uid)
            where not exists (select 1 from public.challenge_category_entries e where e.challenge_id = c.id and e.user_id = u.uid) loop
    perform private.notify(m.uid, c.target_club_id, 'CHALLENGE_UPDATED', 'Chọn lại hạng mục: ' || left(c.title, 80),
      'Ban tổ chức đã đổi các hạng mục chinh phục, đăng ký cũ của bạn không còn. Vào chọn lại trước giờ bắt đầu.',
      '/challenges/' || c.id, v_uid, true);
  end loop;
  perform private.challenge_recompute_all(c.id);
  return public.challenge_conquest_board(c.id);
end $$;

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
      if c.target_club_id is not null then
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

-- ---------------------------------------------------------------------
-- 3. Thử thách lặp lại: tên kỳ mới
-- ---------------------------------------------------------------------
-- Hằng tuần + tên có "tuần <số>" → số tuần ISO (giờ VN) của kỳ mới; còn lại: "<tên> · Kỳ <n>" như cũ
create or replace function private.recur_title(p_title text, p_recurrence text, p_occurrence integer, p_start timestamptz) returns text
language sql stable set search_path = public as $$
  select case
    when p_recurrence = 'WEEKLY' and s.base ~ '([Tt]uần|TUẦN)\s*\d{1,2}(?!\d)' then
      left(regexp_replace(s.base, '([Tt]uần|TUẦN)(\s*)\d{1,2}(?!\d)', '\1\2' || extract(week from (p_start at time zone 'Asia/Ho_Chi_Minh'))::int), 120)
    else left(s.base, 108) || ' · Kỳ ' || (coalesce(p_occurrence, 1) + 1) end
    from (select regexp_replace(regexp_replace(coalesce(p_title, ''), '\s*·\s*Kỳ \d+$', ''), '\s*[-–]\s*[Ll]ần\s*\d+$', '') as base) s
$$;

-- Bản 007600 + tên kỳ mới (private.recur_title) + chép hạng mục chinh phục
create or replace function private.spawn_next_occurrence(p_id uuid) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  c public.challenges := (select x from public.challenges x where x.id = p_id for update);
  v_step interval;
  v_start timestamptz;
  v_end timestamptz;
  v_payload jsonb;
  v_old_claims text := current_setting('request.jwt.claims', true);
  v_old_sub text := current_setting('request.jwt.claim.sub', true);
  v_new uuid;
  v_n integer := 0;
  v_conquest boolean;
begin
  if c.id is null or c.recurrence = 'NONE' or c.recur_next_id is not null or c.status = 'CANCELLED' or c.created_by is null then return null; end if;
  v_step := private.recurrence_step(c.recurrence);
  v_start := c.start_date + v_step;
  v_end := c.end_date + v_step;
  while v_end <= now() + interval '1 hour' and v_n < 60 loop          -- bỏ lỡ nhiều kỳ (cron dừng): nhảy tới kỳ còn hiệu lực
    v_start := v_start + v_step; v_end := v_end + v_step; v_n := v_n + 1;
  end loop;
  if c.format = 'TEAM' and v_start < now() + interval '15 minutes' then v_start := now() + interval '15 minutes'; end if;
  v_conquest := c.objective in ('BEST_TIME', 'BEST_PACE');
  v_payload := jsonb_build_object(
    'title', private.recur_title(c.title, c.recurrence, c.occurrence, v_start), 'description', c.description, 'format', c.format,
    -- Chinh phục: tạo như thử thách km rồi chép hạng mục (như trình tạo)
    'objective', case when v_conquest then 'DISTANCE' else c.objective end, 'game_mode', c.game_mode,
    'target_value', case when v_conquest then 1 else c.target_value end, 'min_km', c.min_km,
    'min_pace', c.min_pace, 'max_pace', c.max_pace, 'daily_cap_km', c.daily_cap_km,
    'start_date', v_start, 'end_date', v_end, 'max_slots', c.max_slots, 'audience', c.target_audience,
    'club_id', c.target_club_id, 'team_size', c.fixed_team_size, 'reward_xu', c.reward_xu,
    'reward_source', c.reward_source, 'reward_split', c.reward_split,
    'team_names', coalesce((select jsonb_agg(t.name order by t.position) from public.challenge_teams t where t.challenge_id = c.id), '[]'::jsonb));

  -- Tạo như chính người tạo bấm tạo: mọi kiểm tra quyền / phí / lượt / quỹ giữ nguyên
  perform set_config('request.jwt.claims', json_build_object('sub', c.created_by, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', c.created_by::text, true);
  begin
    v_new := (public.create_challenge_v2(v_payload, 'recur:' || c.id)->>'challenge_id')::uuid;
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_old_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(v_old_sub, ''), true);
    if c.recur_error is distinct from sqlerrm then
      update public.challenges set recur_error = left(sqlerrm, 200) where id = c.id;
      perform private.notify(c.created_by, c.target_club_id, 'CHALLENGE_RECUR_FAILED', 'Chưa tạo được kỳ mới: ' || left(c.title, 80),
        case when sqlerrm like '%INSUFFICIENT%' then 'Ví / quỹ CLB không đủ Xu cho phí tạo. Nạp thêm hoặc giảm quy mô — hệ thống thử lại mỗi ngày.'
             when sqlerrm like '%FORBIDDEN%' then 'Bạn không còn là ban quản trị CLB. Tắt lặp lại hoặc nhờ ban quản trị tạo.'
             else 'Hệ thống thử lại mỗi ngày. Lý do: ' || left(sqlerrm, 120) end,
        '/challenges/' || c.id, null, true);
    end if;
    return null;
  end;
  perform set_config('request.jwt.claims', coalesce(v_old_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_old_sub, ''), true);

  -- Chép phần thiết lập thêm (nhịp tim, mục tiêu tự đăng ký, thể lệ, hạng mục chinh phục) và nối chuỗi kỳ
  update public.challenges n set
    require_hr = c.require_hr, rules_info = c.rules_info, rules_updated_at = case when c.rules_info <> '{}'::jsonb then now() end,
    pledge_enabled = c.pledge_enabled, pledge_options = c.pledge_options, pledge_min_km = c.pledge_min_km,
    pledge_max_km = c.pledge_max_km, pledge_cap_pct = c.pledge_cap_pct, pledge_team_size = c.pledge_team_size,
    game_mode = case when c.pledge_enabled and c.format = 'TEAM' then 'TEAM_SUM' else n.game_mode end,
    objective = c.objective, target_type = c.target_type, conquest_mode = c.conquest_mode,
    reward_split = case when v_conquest then 'FINISHERS' else n.reward_split end,
    min_km = case when v_conquest then c.min_km else n.min_km end,
    recurrence = c.recurrence, series_id = coalesce(c.series_id, c.id), occurrence = c.occurrence + 1
  where n.id = v_new;
  if v_conquest then
    insert into public.challenge_categories (challenge_id, position, label, distance_m, target_s)
    select v_new, cat.position, cat.label, cat.distance_m, cat.target_s
      from public.challenge_categories cat
     where cat.challenge_id = c.id
       and not exists (select 1 from public.challenge_categories x where x.challenge_id = v_new and x.position = cat.position);
  end if;
  update public.challenges set recur_next_id = v_new, recur_error = null, series_id = coalesce(series_id, id) where id = c.id;
  return v_new;
end $$;

-- ---------------------------------------------------------------------
-- 4. Vinh danh theo mục tiêu (bản 013100 + GOAL<mét>, CAT<thứ tự>)
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
    elsif k ~ '^DIST[0-9]{3,6}$' then
      -- 013100: vinh danh theo cự ly — bài tốt nhất có cự ly ≥ D trong thời gian thử thách, thời gian quy đổi theo pace trung bình
      return query select k, x.rn::int, x.pid, x.v from (
        select b.pid, b.best as v, row_number() over (order by b.best, b.at) as rn
          from (select p.profile_id as pid,
                       min(round(a.mt * substr(k, 5)::numeric / a.dist)) as best, min(a.started_at) as at
                  from public.challenge_participants p
                  join (select x.user_id, x.started_at, coalesce(nullif(x.moving_distance_m, 0), x.distance_m) as dist,
                               coalesce(nullif(x.moving_time_s, 0), x.elapsed_time_s) as mt
                          from public.activities x
                         where x.started_at >= c.start_date and x.started_at < c.end_date
                           and x.validation_status = 'APPROVED' and public.activity_is_countable(x.status, x.validation_status)) a
                    on a.user_id = p.profile_id and a.dist >= substr(k, 5)::numeric and a.mt > 0
                 where p.challenge_id = c.id and p.status <> 'LEFT'
                 group by p.profile_id) b) x where x.rn <= n;
    elsif k ~ '^GOAL[0-9]{3,7}$' then
      -- 013300: theo mục tiêu BTC đặt (tự đăng ký mục tiêu) — chỉ người chọn đúng mục tiêu này và đã hoàn thành;
      -- km được tính nhiều hơn đứng trước, bằng nhau thì ai hoàn thành sớm hơn
      return query select k, x.rn::int, x.pid, x.v from (
        select p.profile_id as pid, p.current_progress as v,
               row_number() over (order by p.current_progress desc, p.completed_at, p.joined_at) as rn
          from public.challenge_participants p
         where p.challenge_id = c.id and p.status <> 'LEFT' and p.completed_at is not null
           and round(p.pledge_km * 1000) = substr(k, 5)::numeric) x where x.rn <= n;
    elsif k ~ '^CAT[1-8]$' then
      -- 013300: hạng mục chinh phục thứ N — người đạt mục tiêu hạng mục, kết quả nhanh nhất trước (giây, hoặc giây/km nếu chinh phục pace)
      return query select k, x.rn::int, x.pid, x.v from (
        select e.user_id as pid, (case when c.objective = 'BEST_PACE' then e.best_pace_s else e.best_time_s end)::numeric as v,
               row_number() over (order by case when c.objective = 'BEST_PACE' then e.best_pace_s else e.best_time_s end, e.best_at) as rn
          from public.challenge_category_entries e
          join public.challenge_categories ct on ct.id = e.category_id and ct.challenge_id = c.id and ct.position = substr(k, 4)::int
          join public.challenge_participants p on p.id = e.participant_id and p.status <> 'LEFT'
         where e.achieved_at is not null and e.best_time_s is not null) x where x.rn <= n;
    elsif k like 'CUSTOM%' then
      return query select k, x.ord::int, x.pid, null::numeric from (
        select u.v::uuid as pid, u.ord
          from jsonb_array_elements_text(coalesce(cat->'users', '[]'::jsonb)) with ordinality as u(v, ord)
         where exists (select 1 from public.challenge_participants p where p.challenge_id = c.id and p.profile_id = u.v::uuid and p.status <> 'LEFT')) x
       where x.ord <= 10;
    end if;
  end loop;
end $$;

create or replace function private.honor_categories(p jsonb) returns jsonb
language plpgsql immutable as $$
declare v_out jsonb := '[]'::jsonb; cat jsonb; k text; seen text[] := '{}';
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 8 then raise exception 'INVALID_HONOR_CATEGORIES'; end if;
  for cat in select * from jsonb_array_elements(p) loop
    k := cat->>'key';
    if k is null or not (k = any (array['TOP', 'KM', 'DAYS', 'STREAK', 'BREAKTHROUGH', 'SUPPORTED']) or k ~ '^CUSTOM[1-5]$'
                         or (k ~ '^DIST[0-9]{3,6}$' and substr(k, 5)::int between 400 and 250000)
                         or (k ~ '^GOAL[0-9]{3,7}$' and substr(k, 5)::int between 100 and 5000000)
                         or k ~ '^CAT[1-8]$') or k = any (seen) then
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

-- ---------------------------------------------------------------------
-- 5. Đã có kết quả thì không sửa đăng ký
-- ---------------------------------------------------------------------
/** Người tham gia đã có bài chạy hợp lệ ≥ cự ly hạng mục trong thời gian thử thách (cùng điều kiện tính kết quả) */
create or replace function private.conquest_has_result(p_participant uuid, p_category uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.challenge_progress_events e
                   join public.challenge_categories cat on cat.id = p_category
                  where e.participant_id = p_participant and e.moving_s > 0 and e.distance_m >= cat.distance_m * 0.99)
$$;

-- Bản 010700 + CONQUEST_RESULT_LOCKED: đã đăng ký rồi thì không thêm / đổi mục tiêu / bỏ hạng mục mà mình đã có kết quả
create or replace function public.set_my_conquest(p_challenge_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
  v_pid uuid := (select x.id from public.challenge_participants x where x.challenge_id = p_challenge_id and x.profile_id = v_uid and x.status <> 'LEFT');
  v_items jsonb := case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end;
  v_started boolean;
begin
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if c.objective not in ('BEST_TIME', 'BEST_PACE') then raise exception 'CONQUEST_NOT_SUPPORTED'; end if;
  if v_pid is null then raise exception 'NOT_JOINED'; end if;
  if c.status <> 'ACTIVE' or now() >= c.end_date then raise exception 'CHALLENGE_CLOSED'; end if;
  if jsonb_array_length(v_items) = 0 then raise exception 'INVALID_CONQUEST'; end if;
  begin
    if exists (select 1 from jsonb_array_elements(v_items) x
                where not exists (select 1 from public.challenge_categories cat where cat.id = (x->>'category_id')::uuid and cat.challenge_id = c.id)
                   or (c.conquest_mode = 'SELF' and coalesce((x->>'target_s')::int, 0) <= 0)
                   or (c.conquest_mode = 'SELF' and c.objective = 'BEST_PACE' and (x->>'target_s')::int not between 120 and 1500)
                   or (c.conquest_mode = 'SELF' and c.objective = 'BEST_TIME' and (x->>'target_s')::int not between 60 and 172800)) then
      raise exception 'INVALID_CONQUEST';
    end if;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'INVALID_CONQUEST';
  end;
  -- 013300: sửa đăng ký (đã có đăng ký trước đó) mà cự ly đã có kết quả tương đương → không thêm, không đổi mục tiêu, không bỏ
  if exists (select 1 from public.challenge_category_entries e where e.participant_id = v_pid) and (exists (select 1 from jsonb_array_elements(v_items) x
              where private.conquest_has_result(v_pid, (x->>'category_id')::uuid)
                and (not exists (select 1 from public.challenge_category_entries e where e.participant_id = v_pid and e.category_id = (x->>'category_id')::uuid)
                     or (c.conquest_mode = 'SELF' and (select e.target_s from public.challenge_category_entries e
                                                         where e.participant_id = v_pid and e.category_id = (x->>'category_id')::uuid)
                                                      is distinct from (x->>'target_s')::int)))
     or exists (select 1 from public.challenge_category_entries e
                 where e.participant_id = v_pid and private.conquest_has_result(v_pid, e.category_id)
                   and not exists (select 1 from jsonb_array_elements(v_items) x where (x->>'category_id')::uuid = e.category_id))) then
    raise exception 'CONQUEST_RESULT_LOCKED';
  end if;
  v_started := now() >= c.start_date;
  -- Sau giờ xuất phát: được thêm hạng mục mới (người tham gia trễ) nhưng không bỏ / đổi mục tiêu đã đăng ký
  if v_started and exists (
       select 1 from public.challenge_category_entries e
        where e.participant_id = v_pid
          and (not exists (select 1 from jsonb_array_elements(v_items) x where (x->>'category_id')::uuid = e.category_id)
               or (c.conquest_mode = 'SELF' and e.target_s is distinct from
                     (select (x->>'target_s')::int from jsonb_array_elements(v_items) x where (x->>'category_id')::uuid = e.category_id)))) then
    raise exception 'CONQUEST_TARGET_LOCKED';
  end if;
  delete from public.challenge_category_entries e
   where e.participant_id = v_pid
     and not exists (select 1 from jsonb_array_elements(v_items) x where (x->>'category_id')::uuid = e.category_id);
  insert into public.challenge_category_entries (participant_id, category_id, challenge_id, user_id, target_s)
  select v_pid, (x->>'category_id')::uuid, c.id, v_uid, case when c.conquest_mode = 'SELF' then (x->>'target_s')::int end
    from jsonb_array_elements(v_items) x
  on conflict (participant_id, category_id) do update set target_s = excluded.target_s;
  perform private.challenge_recompute_participant(v_pid);
  return public.challenge_conquest_board(c.id);
end $$;

-- BXH chinh phục (bản 010700) + my_results: các hạng mục người xem đã có kết quả (giao diện khoá kèm lý do)
create or replace function public.challenge_conquest_board(p_challenge_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
  v_pid uuid;
begin
  if c.id is null or not public.challenge_visible(c.id) then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  v_pid := (select x.id from public.challenge_participants x where x.challenge_id = c.id and x.profile_id = v_uid and x.status <> 'LEFT');
  return jsonb_build_object(
    'objective', c.objective, 'mode', c.conquest_mode,
    'categories', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', cat.id, 'label', cat.label, 'distance_m', cat.distance_m, 'target_s', cat.target_s, 'position', cat.position,
                     'entrants', (select count(*) from public.challenge_category_entries e join public.challenge_participants pp on pp.id = e.participant_id
                                   where e.category_id = cat.id and pp.status <> 'LEFT'),
                     'achieved', (select count(*) from public.challenge_category_entries e join public.challenge_participants pp on pp.id = e.participant_id
                                   where e.category_id = cat.id and pp.status <> 'LEFT' and e.achieved_at is not null))
                     order by cat.position), '[]'::jsonb)
                     from public.challenge_categories cat where cat.challenge_id = c.id),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
               'category_id', r.category_id, 'user_id', r.user_id, 'display_name', r.display_name, 'avatar_url', r.avatar_url, 'level', r.level,
               'target_s', r.target_s_eff, 'best_time_s', r.best_time_s, 'best_pace_s', r.best_pace_s, 'best_activity_id', r.best_activity_id,
               'best_at', r.best_at, 'achieved', r.achieved_at is not null, 'rank', r.rk, 'me', r.user_id = v_uid)
               order by r.category_id, r.rk nulls last, r.display_name), '[]'::jsonb)
               from (select e.*, coalesce(e.target_s, cat.target_s) as target_s_eff, pr.display_name, pr.avatar_url, coalesce(pr.level, 1) as level,
                            case when e.best_time_s is not null then rank() over (partition by e.category_id, (e.best_time_s is not null)
                                                                                     order by e.best_time_s, e.best_at) end as rk
                       from public.challenge_category_entries e
                       join public.challenge_categories cat on cat.id = e.category_id
                       join public.challenge_participants pp on pp.id = e.participant_id and pp.status <> 'LEFT'
                       join public.profiles pr on pr.id = e.user_id
                      where e.challenge_id = c.id) r),
    'mine', (select coalesce(jsonb_agg(jsonb_build_object('category_id', e.category_id, 'target_s', e.target_s,
               'best_time_s', e.best_time_s, 'best_pace_s', e.best_pace_s, 'achieved', e.achieved_at is not null)), '[]'::jsonb)
               from public.challenge_category_entries e where e.challenge_id = c.id and e.user_id = v_uid),
    'my_results', (select coalesce(jsonb_agg(cat.id order by cat.position), '[]'::jsonb)
                     from public.challenge_categories cat
                    where cat.challenge_id = c.id and v_pid is not null and private.conquest_has_result(v_pid, cat.id))
  );
end $$;

-- ---------------------------------------------------------------------
-- 6. Quyền
-- ---------------------------------------------------------------------
revoke all on function private.recur_title(text, text, integer, timestamptz), private.conquest_has_result(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.update_challenge(uuid, jsonb), public.set_challenge_pledge(uuid, jsonb), public.set_challenge_conquest(uuid, jsonb),
  public.set_my_conquest(uuid, jsonb), public.challenge_conquest_board(uuid) from public, anon;
grant execute on function public.update_challenge(uuid, jsonb), public.set_challenge_pledge(uuid, jsonb), public.set_challenge_conquest(uuid, jsonb),
  public.set_my_conquest(uuid, jsonb), public.challenge_conquest_board(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001013400_strava_rule_round7.sql
-- ===================================================================
-- 013400: Chỉnh sửa lần 7 — luật bài đồng bộ từ đối tác (Strava / Garmin / COROS), Phụng chốt 06/10/2026:
--   "Luật GPS nhảy nếu Strava có GPS (mặc dù nhảy) thì RaceHub vẫn ghi nhận; chỉ không ghi nhận trường hợp nhập tay;
--    cảnh báo chạy máy (hoàn toàn không có GPS)".
-- Góp ý: "Bài GPS nhảy được ghi nhận ngay: hiện tại cập nhật xong nhưng BQT vẫn phải duyệt". Nguyên nhân (sau 013100 / lần 6):
--   • fraud.ts: dấu hiệu tốc độ (PACE_CURVE, VEHICLE_BURST…) do GPS trôi trải vài điểm chỉ bị hạ MỘT mức (DISQUALIFY → SUSPECT
--     vẫn chờ duyệt), và GPS_TELEPORT / GPS_DISTANCE_GAIN vẫn được đếm là một "cảnh báo độc lập" (+ 1 cảnh báo khác = chờ duyệt).
--     Sửa ở bộ phân tích (ac-2026.10.7): dấu hiệu do GPS nhảy chỉ còn là cảnh báo, không bao giờ giữ bài.
--   • SQL (bản này): pace TB tính trên km Strava ĐÃ cộng cú nhảy → "nhanh hơn kỷ lục" → chờ duyệt; "vận tốc tối đa" một điểm
--     (bài không có phân tích) → chờ duyệt. Nay: kiểm pace theo quãng đường đã bỏ cú nhảy; vận tốc tối đa chỉ là cảnh báo.
-- 1. ingest_provider_activity: nhập tay → REJECTED "Bài nhập tay không được ghi nhận." (không km / thử thách / BXH / Xu);
--    chạy máy / không có GPS → APPROVED + cảnh báo TREADMILL; GPS nhảy → APPROVED + cảnh báo. Km của đối tác giữ nguyên.
--    Bài đã nhập trước 013400 KHÔNG bị xét lại (bài đang chờ duyệt vẫn do ban quản trị quyết định).
-- 2. restore_activity: không khôi phục bài nhập tay của đối tác (MANUAL_NOT_COUNTED); rejected_activities trả thêm 'manual'.
-- 3. warned_activities(): "Bài có cảnh báo" — bài ĐÃ ghi nhận nhưng có cảnh báo (GPS nhảy, chạy máy…) cho admin hệ thống
--    (p_club_id null) và Ban quản trị CLB (chỉ bài của thành viên CLB mình).
-- Giữ nguyên chữ ký các hàm cũ. Cần 013100. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT,
-- không RETURNING INTO. Chạy lại an toàn.

-- ---------------------------------------------------------------------
-- 1. Nhập bài từ đối tác (bản 012600 + luật lần 7)
-- ---------------------------------------------------------------------
create or replace function public.ingest_provider_activity(
  p_user_id uuid, p_source text, p_external_id text, p_activity jsonb
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  cfg jsonb := private.economy_config();
  v_sport text := coalesce(p_activity->>'sport_type', 'Run');
  v_started timestamptz := (p_activity->>'started_at')::timestamptz;
  v_elapsed integer := greatest(coalesce((p_activity->>'elapsed_s')::numeric, 0), 0)::integer;
  v_moving integer := greatest(coalesce((p_activity->>'moving_s')::numeric, 0), 0)::integer;
  v_distance numeric := greatest(coalesce((p_activity->>'distance_m')::numeric, 0), 0);
  v_max_speed numeric := (p_activity->>'max_speed_mps')::numeric;
  v_manual boolean := coalesce((p_activity->>'manual')::boolean, false);
  v_has_gps boolean := coalesce((p_activity->>'has_gps')::boolean, true);
  v_ended timestamptz;
  v_pace integer;
  v_connected_at timestamptz;
  v_status text := 'APPROVED';
  v_reason text := 'Hợp lệ (đồng bộ tự động).';
  v_history_only boolean := false;
  v_existing public.activities%rowtype;
  v_id uuid;
  a public.activities%rowtype;
  v_level text;
  v_score integer := 0;
  v_risk jsonb := case when jsonb_typeof(p_activity->'risk') = 'object' then p_activity->'risk' end;
  -- 013400: cảnh báo lưu kèm bài (risk.flags của bộ phân tích + cảnh báo máy chủ tự thêm: chạy máy, vận tốc tối đa một điểm)
  v_flags jsonb := case when jsonb_typeof(p_activity->'risk'->'flags') = 'array' then p_activity->'risk'->'flags' else '[]'::jsonb end;
  -- Quãng đường đã bỏ cú nhảy / đoạn trôi GPS (bộ phân tích, chỉ để kiểm pace TB — km của đối tác KHÔNG đổi)
  v_pace_dist numeric := case when jsonb_typeof(p_activity->'analysis') = 'object' then nullif((p_activity->'analysis'->>'clean_distance_m')::numeric, 0) end;
  v_check_pace integer;
  v_no_gps boolean;
begin
  if p_source not in ('STRAVA', 'GARMIN', 'COROS') then raise exception 'INVALID_SOURCE'; end if;
  if p_external_id is null or v_started is null then raise exception 'INVALID_ACTIVITY'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then raise exception 'USER_NOT_FOUND'; end if;

  -- Đã có → chỉ cập nhật tiêu đề (Strava gửi aspect "update" khi đổi tên)
  v_existing := (select x from public.activities x where x.source = p_source and x.source_activity_id = p_external_id);
  if v_existing.id is not null then
    if v_existing.user_id <> p_user_id then raise exception 'ACTIVITY_OWNER_MISMATCH'; end if;
    update public.activities
       set title = left(coalesce(nullif(trim(p_activity->>'title'), ''), title), 120), updated_at = now()
     where id = v_existing.id and title is distinct from left(coalesce(nullif(trim(p_activity->>'title'), ''), title), 120);
    return jsonb_build_object('result', case when found then 'UPDATED' else 'DUPLICATE' end,
                              'activity_id', v_existing.id, 'validation_status', v_existing.validation_status);
  end if;

  -- Không phải chạy bộ / quá ngắn → bỏ qua, không lưu
  if v_sport not in ('Run', 'TrailRun', 'VirtualRun') then
    return jsonb_build_object('result', 'SKIPPED', 'reason', 'NOT_RUN');
  end if;
  if v_distance < 200 or v_moving <= 0 then
    return jsonb_build_object('result', 'SKIPPED', 'reason', 'TOO_SHORT');
  end if;
  if v_started > now() + interval '10 minutes' then
    return jsonb_build_object('result', 'SKIPPED', 'reason', 'FUTURE_START');
  end if;

  v_ended := v_started + make_interval(secs => greatest(v_elapsed, v_moving));
  -- 012600: km của đối tác (Strava…) giữ nguyên — cú nhảy GPS chỉ dùng để phân loại hợp lệ / nghi vấn (fraud.ts)
  v_pace := round(v_moving / (v_distance / 1000.0));
  -- 013400: pace TB "nhanh hơn kỷ lục" chỉ vì GPS nhảy cộng thêm km → kiểm theo quãng đường đã bỏ cú nhảy (nếu có phân tích)
  v_check_pace := case when v_has_gps and v_pace_dist is not null and v_pace_dist < v_distance
                       then round(v_moving / (v_pace_dist / 1000.0)) else v_pace end;
  v_no_gps := v_sport = 'VirtualRun' or not v_has_gps;

  -- Cùng một buổi chạy đã được ghi từ nguồn khác (vd GPS trong app) → không tính 2 lần.
  -- 009900: trừ khi bài này dài hơn hẳn các bài trùng giờ đang được tính (vd đồng hồ ghi đủ 2 giờ, điện thoại chỉ ghi một đoạn)
  if exists (select 1 from public.activities
              where user_id = p_user_id and coalesce(status, '') <> 'DELETED'
                and started_at < v_ended and coalesce(ended_at, started_at) > v_started)
     and v_distance <= 1.1 * private.overlap_meters(private.overlap_ids(p_user_id, v_started, v_ended)) then
    return jsonb_build_object('result', 'SKIPPED', 'reason', 'OVERLAPS_EXISTING_ACTIVITY');
  end if;

  -- Luật hợp lệ — 013400, Chỉnh sửa lần 7 (Phụng chốt 06/10/2026): "GPS nhảy nếu Strava có GPS (mặc dù nhảy) thì RaceHub vẫn
  -- ghi nhận; chỉ không ghi nhận trường hợp nhập tay; cảnh báo chạy máy (hoàn toàn không có GPS)".
  -- Chỉ bài NGHI GIAN LẬN (dấu hiệu không do GPS nhảy) mới chờ duyệt; bài chạy chậm / đi bộ vẫn được ghi nhận ngay
  if v_manual or v_risk->>'verdict' = 'REJECT' then
    -- Nhập tay: không có dữ liệu thiết bị → KHÔNG ghi nhận (không km, thử thách, BXH, Xu). Lưu lại để người chạy thấy lý do.
    v_status := 'REJECTED';
    v_reason := 'Bài nhập tay không được ghi nhận.';
    if not v_flags @> '[{"code": "MANUAL"}]'::jsonb then
      v_flags := v_flags || jsonb_build_array(jsonb_build_object('code', 'MANUAL', 'severity', 'SEVERE', 'tier', 'DISQUALIFY',
                   'message', 'Bài nhập tay không được ghi nhận'));
    end if;
  elsif v_check_pace < (cfg->>'minValidPace')::numeric * 60 then
    v_status := 'PENDING'; v_level := 'HIGH'; v_score := 75;
    v_reason := 'Pace trung bình ' || (v_check_pace / 60) || ':' || lpad((v_check_pace % 60)::text, 2, '0') || '/km — nhanh hơn kỷ lục thế giới.';
  -- 012400: "vận tốc tối đa" của Strava là MỘT điểm (hay do GPS nhảy). 013400: bài có GPS → ghi nhận, chỉ cảnh báo
  -- (có risk thì bộ phân tích — cửa sổ trượt + đường cong pace, fraud.ts — đã xét)
  elsif v_risk is null and not v_no_gps and v_max_speed is not null and v_max_speed > 12 then
    v_flags := v_flags || jsonb_build_array(jsonb_build_object('code', 'VEHICLE_BURST', 'severity', 'HIGH', 'tier', 'WARN', 'gpsJump', true,
                 'message', 'Vận tốc tối đa một điểm ' || round(v_max_speed * 3.6) || ' km/h (GPS nhảy) — bài vẫn được ghi nhận'));
  end if;
  -- Chạy máy / hoàn toàn không có GPS → vẫn ghi nhận, kèm cảnh báo cho ban quản trị (trước 013400: chờ duyệt)
  if v_status <> 'REJECTED' and v_no_gps then
    if not v_flags @> '[{"code": "TREADMILL"}]'::jsonb then
      v_flags := v_flags || jsonb_build_array(jsonb_build_object('code', 'TREADMILL', 'severity', 'HIGH', 'tier', 'WARN',
                   'message', case when v_sport = 'VirtualRun' then 'Chạy máy / chạy ảo — không có tuyến GPS để đối chiếu; bài vẫn được ghi nhận'
                                   else 'Bài hoàn toàn không có GPS — không đối chiếu được quãng đường; bài vẫn được ghi nhận' end));
    end if;
    if v_status = 'APPROVED' then v_reason := 'Hợp lệ (đồng bộ tự động) — cảnh báo: chạy máy / không có GPS.'; end if;
  end if;
  -- Bộ phân tích gian lận (máy chủ ứng dụng, xem features/activity/model/fraud.ts) → chờ ban quản trị xác minh.
  -- fraud.ts (ac-2026.10.7) không bao giờ kết luận REVIEW chỉ vì GPS nhảy / chạy máy.
  if v_status = 'APPROVED' and v_risk->>'verdict' = 'REVIEW' then
    v_status := 'PENDING';
    v_level := coalesce(v_risk->>'level', 'HIGH');
    v_score := coalesce((v_risk->>'score')::int, 65);
    v_reason := coalesce(nullif(v_risk->>'reason', ''), 'Dữ liệu bài chạy bất thường') || '.';
  end if;
  if v_status = 'PENDING' then
    v_reason := left('Mức nghi vấn: ' || private.risk_label(v_level) || '. ' || v_reason
                     || ' Bài được tính sau khi ban quản trị CLB hoặc admin xác minh.', 500);
  end if;

  -- Bài chạy trước khi kết nối: lưu lịch sử, không thưởng (tránh "đổ" hàng tháng dữ liệu cũ lấy Xu)
  v_connected_at := (select max(ca.created_at) from public.connected_accounts ca
                      where ca.user_id = p_user_id and ca.provider = p_source);
  v_history_only := v_connected_at is not null and v_started < v_connected_at;

  v_id := gen_random_uuid();
  -- Kết quả phân tích chi tiết (dữ liệu gốc rút gọn + bằng chứng) → trigger lưu vào activity_analyses cùng lúc với bài
  perform set_config('racehub.analysis', coalesce((p_activity->'analysis')::text, ''), true);
  perform set_config('racehub.reported_distance', v_distance::text, true);
  insert into public.activities (
    id, user_id, title, source, source_activity_id, sport_type, started_at, ended_at,
    elapsed_time_s, moving_time_s, distance_m, moving_distance_m, avg_pace_s,
    avg_speed_mps, max_speed_mps, avg_heartrate, elevation_gain_m, is_manual, device_name,
    status, validation_status, validation_reason, review_detail, rewarded_at, earned_xu, earned_xp,
    risk_score, risk_level, risk_flags)
  values (
    v_id, p_user_id, left(coalesce(nullif(trim(p_activity->>'title'), ''), 'Buổi chạy'), 120), p_source, p_external_id, v_sport,
    v_started, v_ended, v_elapsed, v_moving, v_distance, v_distance, v_pace,
    (p_activity->>'avg_speed_mps')::numeric, v_max_speed, (p_activity->>'avg_heartrate')::numeric,
    coalesce((p_activity->>'elevation_gain_m')::numeric, 0), v_manual, left(p_activity->>'device_name', 80),
    case v_status when 'APPROVED' then 'READY' when 'PENDING' then 'PROCESSING' else 'REJECTED' end, v_status,
    case when v_history_only then v_reason || ' Bài chạy trước khi kết nối — chỉ lưu lịch sử.' else v_reason end,
    null,
    case when v_history_only then now() end,
    case when v_history_only then 0 end,
    case when v_history_only then 0 end,
    case when v_status = 'PENDING' then v_score else (v_risk->>'score')::int end,
    case when v_status = 'PENDING' then v_level else v_risk->>'level' end,
    case when v_flags = '[]'::jsonb then v_risk->'flags' else v_flags end)
  on conflict (source, source_activity_id) where source_activity_id is not null do nothing;

  if not exists (select 1 from public.activities x where x.id = v_id) then  -- request song song đã chèn trước
    v_id := (select x.id from public.activities x where x.source = p_source and x.source_activity_id = p_external_id);
    return jsonb_build_object('result', 'DUPLICATE', 'activity_id', v_id);
  end if;

  a := (select x from public.activities x where x.id = v_id);   -- trigger đã trả thưởng nếu APPROVED
  return jsonb_build_object('result', 'IMPORTED', 'activity_id', v_id,
    'validation_status', a.validation_status, 'reason', a.validation_reason,
    'history_only', v_history_only,
    'earned_xu', coalesce(a.earned_xu, 0), 'earned_xp', coalesce(a.earned_xp, 0));
end $$;

-- ---------------------------------------------------------------------
-- 2. Khôi phục bài bị loại: không áp cho bài nhập tay (bản 012500 + kiểm tra nhập tay)
-- ---------------------------------------------------------------------
create or replace function public.restore_activity(p_activity_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  a public.activities := (select x from public.activities x where x.id = p_activity_id);
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if a.id is null or coalesce(a.status, '') = 'DELETED' then raise exception 'ACTIVITY_NOT_FOUND'; end if;
  if a.validation_status <> 'REJECTED' then raise exception 'ACTIVITY_NOT_REJECTED'; end if;
  -- 013400: bài nhập tay từ đối tác không bao giờ được ghi nhận (Phụng chốt 06/10/2026) → không khôi phục
  if coalesce(a.is_manual, false) and a.source in ('STRAVA', 'GARMIN', 'COROS') then raise exception 'MANUAL_NOT_COUNTED'; end if;
  if a.user_id = v_uid or not private.can_review_activity(a.user_id) then raise exception 'FORBIDDEN'; end if;
  if v_note is null or length(v_note) < 5 then raise exception 'NOTE_REQUIRED'; end if;
  -- Bài bị loại vì trùng giờ với bài khác đang được tính → khôi phục sẽ tính 2 lần
  if exists (select 1 from public.activities x
              where x.user_id = a.user_id and x.id <> a.id and x.validation_status = 'APPROVED'
                and coalesce(x.status, '') <> 'DELETED'
                and x.started_at < coalesce(a.ended_at, a.started_at) and coalesce(x.ended_at, x.started_at) > a.started_at) then
    raise exception 'OVERLAPS_COUNTED_RUN';
  end if;

  perform set_config('racehub.decision_kind', 'RESTORE', true);
  update public.activities
     set validation_status = 'APPROVED', status = 'READY',
         validation_reason = 'Đã khôi phục sau khi xem xét lại.',
         review_detail = left('Khôi phục: ' || v_note || coalesce(' · Trước đó: ' || coalesce(review_detail, validation_reason), ''), 500),
         reviewed_by = v_uid, reviewed_at = now(), updated_at = now()
   where id = a.id;                      -- APPROVED → trigger trả thưởng + cộng vào thử thách
  perform set_config('racehub.decision_kind', '', true);

  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'RESTORE_ACTIVITY', a.id::text, jsonb_build_object('note', v_note));

  perform private.notify(a.user_id, null, 'RUN_REVIEW', 'Bài chạy đã được khôi phục',
    round(coalesce(a.distance_m, 0) / 1000.0, 2) || ' km — đã xem xét lại và ghi nhận, cộng Xu, XP và thử thách.',
    '/activities/' || a.id, v_uid, true);
end $$;

/** Bài bị loại trong N ngày gần đây mà người gọi được quyền xem lại (BQT CLB của người chạy hoặc admin) */
create or replace function public.rejected_activities(p_club_id uuid default null, p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if p_club_id is not null and not public.club_is_staff(p_club_id) then raise exception 'FORBIDDEN'; end if;
  if p_club_id is null and not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'title', a.title, 'distance_m', a.distance_m, 'moving_time_s', a.moving_time_s,
      'started_at', a.started_at, 'created_at', a.created_at, 'source', a.source,
      'validation_reason', coalesce(a.review_detail, a.validation_reason), 'risk_score', a.risk_score, 'risk_level', a.risk_level,
      'risk_flags', a.risk_flags, 'user_id', a.user_id, 'can_review', a.user_id <> auth.uid(), 'reviewed_at', a.reviewed_at,
      'overlap', coalesce(a.validation_reason, '') like 'Trùng giờ%',
      'manual', coalesce(a.is_manual, false) and a.source in ('STRAVA', 'GARMIN', 'COROS'),
      'profiles', jsonb_build_object('display_name', pr.display_name, 'avatar_url', pr.avatar_url))
      order by coalesce(a.reviewed_at, a.updated_at, a.created_at) desc), '[]'::jsonb)
    from public.activities a
    join public.profiles pr on pr.id = a.user_id
   where a.validation_status = 'REJECTED' and coalesce(a.status, '') <> 'DELETED'
     and coalesce(a.reviewed_at, a.updated_at, a.created_at) > now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 180))
     and (p_club_id is null or exists (select 1 from public.club_members m
                                        where m.club_id = p_club_id and m.user_id = a.user_id and m.status = 'APPROVED')));
end $$;

-- ---------------------------------------------------------------------
-- 3. Bài có cảnh báo (đã ghi nhận) — admin hệ thống / Ban quản trị CLB
-- ---------------------------------------------------------------------
create index if not exists activities_warned_idx on public.activities (started_at desc)
  where validation_status = 'APPROVED' and risk_flags is not null;

/** Mức của một dấu hiệu: tier (012500) hoặc suy từ severity như màn duyệt bài (PendingRunCard) */
create or replace function private.flag_tier(f jsonb) returns text
language sql immutable as $$
  select coalesce(f->>'tier', case f->>'severity' when 'SEVERE' then 'SUSPECT' when 'HIGH' then 'WARN' else 'NOTE' end)
$$;

/** Bài đã ghi nhận nhưng có cảnh báo (GPS nhảy, chạy máy…) trong N ngày — mới nhất trước, tối đa 300 bài.
 *  p_club_id null: toàn hệ thống (chỉ admin hệ thống); có p_club_id: bài của thành viên CLB (Ban quản trị CLB hoặc admin). */
create or replace function public.warned_activities(p_club_id uuid default null, p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if p_club_id is not null and not public.club_is_staff(p_club_id) then raise exception 'FORBIDDEN'; end if;
  if p_club_id is null and not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', w.id, 'title', w.title, 'distance_m', w.distance_m, 'moving_time_s', w.moving_time_s,
      'started_at', w.started_at, 'created_at', w.created_at, 'source', w.source, 'user_id', w.user_id,
      'risk_score', w.risk_score, 'risk_level', w.risk_level, 'reviewed', w.reviewed_by is not null,
      'warnings', w.warnings,
      'profiles', jsonb_build_object('display_name', pr.display_name, 'avatar_url', pr.avatar_url))
      order by w.started_at desc), '[]'::jsonb)
    from (select a.*, row_number() over (order by a.started_at desc, a.id) as rn,
                 (select jsonb_agg(jsonb_build_object('code', f->>'code', 'tier', private.flag_tier(f), 'message', f->>'message',
                                                      'gpsJump', coalesce((f->>'gpsJump')::boolean, f->>'code' in ('GPS_TELEPORT', 'GPS_DISTANCE_GAIN'))))
                    from jsonb_array_elements(case when jsonb_typeof(a.risk_flags) = 'array' then a.risk_flags else '[]'::jsonb end) f where private.flag_tier(f) <> 'NOTE') as warnings
            from public.activities a
           where a.validation_status = 'APPROVED' and a.risk_flags is not null and jsonb_typeof(a.risk_flags) = 'array'
             and coalesce(a.status, '') <> 'DELETED'
             and a.started_at > now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 180))
             and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(a.risk_flags) = 'array' then a.risk_flags else '[]'::jsonb end) f where private.flag_tier(f) <> 'NOTE')
             and (p_club_id is null or exists (select 1 from public.club_members m
                                                where m.club_id = p_club_id and m.user_id = a.user_id and m.status = 'APPROVED'))) w
    join public.profiles pr on pr.id = w.user_id
   where w.rn <= 300);
end $$;

revoke all on function public.ingest_provider_activity(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_provider_activity(uuid, text, text, jsonb) to service_role;
revoke all on function private.flag_tier(jsonb) from public, anon, authenticated;
revoke all on function public.restore_activity(uuid, text), public.rejected_activities(uuid, integer),
  public.warned_activities(uuid, integer) from public, anon;
grant execute on function public.restore_activity(uuid, text), public.rejected_activities(uuid, integer),
  public.warned_activities(uuid, integer) to authenticated;

notify pgrst, 'reload schema';

commit;
