-- Chinh phục cự ly: thêm chế độ ANY cho thử thách chinh phục.
--   Người tạo chỉ đặt cự ly các hạng mục (không đặt thời gian/pace). Người chơi chạy MỘT bài có cự ly ≥ 99% hạng mục
--   (cùng ngưỡng với chinh phục thời gian/pace) là đạt hạng mục đó. Dùng objective BEST_TIME để mọi luật hiện có
--   (đăng ký hạng mục, chia thưởng FINISHERS, vinh danh, bài trùng giờ, chống gian lận) giữ nguyên.
alter table public.challenges drop constraint if exists challenges_conquest_mode_chk;
alter table public.challenges add constraint challenges_conquest_mode_chk
  check (conquest_mode is null or conquest_mode in ('FIXED', 'SELF', 'ANY'));

-- ---------------------------------------------------------------------
-- 1. Tính điểm: bản 010700, hạng mục ở chế độ ANY đạt ngay khi có bài đủ cự ly
-- ---------------------------------------------------------------------
create or replace function private.challenge_recompute_participant(p_participant_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  p public.challenge_participants := (select x from public.challenge_participants x where x.id = p_participant_id);
  c public.challenges;
  v_dist numeric; v_moving bigint; v_runs integer; v_days integer; v_score numeric; v_target numeric;
begin
  if p.id is null then return; end if;
  perform 1 from public.challenge_participants where id = p.id for update;
  c := (select x from public.challenges x where x.id = p.challenge_id);

  v_dist := (select coalesce(sum(e.counted_m), 0) from public.challenge_progress_events e where e.participant_id = p.id);
  v_moving := (select coalesce(sum(e.moving_s), 0) from public.challenge_progress_events e where e.participant_id = p.id);
  v_runs := (select count(*) from public.challenge_progress_events e where e.participant_id = p.id and e.counted_m > 0);
  v_days := (select count(*) from (
               select e.day from public.challenge_progress_events e where e.participant_id = p.id
                group by e.day having sum(e.distance_m) >= greatest(coalesce(c.min_km, 0), 0.2) * 1000) d);

  if c.objective in ('BEST_TIME', 'BEST_PACE') then
    -- Kết quả tốt nhất cho từng hạng mục: bài có cự ly ≥ hạng mục, quy đổi theo pace trung bình
    update public.challenge_category_entries
       set best_time_s = null, best_pace_s = null, best_activity_id = null, best_at = null, achieved_at = null
     where participant_id = p.id;
    update public.challenge_category_entries ce
       set best_time_s = b.t, best_pace_s = b.pace, best_activity_id = b.aid, best_at = b.at,
           achieved_at = case when c.conquest_mode = 'ANY' then b.at
                              when coalesce(ce.target_s, b.cat_target) is not null
                                   and (case when c.objective = 'BEST_PACE' then b.pace else b.t end) <= coalesce(ce.target_s, b.cat_target)
                              then b.at end
      from (select distinct on (cat.id) cat.id as cat_id, cat.target_s as cat_target,
                   round(e.moving_s * cat.distance_m / e.distance_m)::int as t,
                   round(e.moving_s * 1000.0 / e.distance_m)::int as pace,
                   e.activity_id as aid, a.started_at as at
              from public.challenge_categories cat
              join public.challenge_progress_events e on e.participant_id = p.id
                                                       and e.distance_m >= cat.distance_m * 0.99 and e.moving_s > 0
              join public.activities a on a.id = e.activity_id
             where cat.challenge_id = c.id
             order by cat.id, e.moving_s / e.distance_m, a.started_at) b
     where ce.participant_id = p.id and ce.category_id = b.cat_id;
    v_score := (select count(*) from public.challenge_category_entries ce where ce.participant_id = p.id and ce.achieved_at is not null);
    v_target := (select count(*) from public.challenge_category_entries ce where ce.participant_id = p.id);
  else
    v_score := case c.objective
      when 'RUNS' then v_runs
      when 'DURATION' then round(v_moving / 60.0, 1)
      when 'STREAK_DAYS' then v_days
      else round(v_dist / 1000.0, 2) end;

    v_target := coalesce(c.target_value, 0);
    if c.pledge_enabled then
      v_target := coalesce(p.pledge_km, 0);           -- chưa đăng ký mục tiêu → chưa thể hoàn thành
      if v_target > 0 and c.pledge_cap_pct is not null then
        v_score := least(v_score, round(v_target * (1 + c.pledge_cap_pct / 100.0), 2));
      end if;
    end if;
  end if;

  update public.challenge_participants
     set distance_m = v_dist, moving_s = v_moving, run_count = v_runs, streak_days = v_days,
         current_progress = v_score,
         completed_at = case when v_target > 0 and v_score >= v_target then coalesce(completed_at, now()) end,
         status = case when status = 'LEFT' then 'LEFT'
                       when v_target > 0 and v_score >= v_target then 'COMPLETED'
                       else 'JOINED' end,
         updated_at = now()
   where id = p.id;
end $$;

-- ---------------------------------------------------------------------
-- 2. Người tạo: chấp nhận mode ANY (không cần target_s)
-- ---------------------------------------------------------------------
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
  if v_obj not in ('BEST_TIME', 'BEST_PACE') or v_mode not in ('FIXED', 'SELF', 'ANY') then raise exception 'INVALID_CONQUEST'; end if;
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
