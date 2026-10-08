-- RaceHub — PHẦN 24/25 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 013500, 013600, 013700, 013800
-- Supabase → SQL Editor → New query → dán TOÀN BỘ phần này → Run. Lỗi thì không có gì thay đổi; chạy lại vẫn an toàn.
-- Xong thì chạy phần tiếp theo.
begin;
-- ===================================================================
-- 20261001013500_quest_draw_round7.sql
-- ===================================================================
-- 013500: Chỉnh sửa lần 7 — quay thưởng: Ban tổ chức CHẤP NHẬN hoặc HUỶ kết quả trước khi kết quả thành chính thức.
--   • "Kết thúc" (finish_lucky_draw) và "Quay nhanh tất cả" (run_lucky_draw) không công bố ngay nữa: lượt quay chuyển sang
--     PENDING = chờ ban tổ chức xác nhận. Chưa báo người trúng, chưa đăng bảng tin, chưa tính là "đã trúng" chính thức.
--   • confirm_lucky_draw: người có quyền quay thưởng bấm "Chấp nhận" → DONE, ghi ai / lúc nào chấp nhận, rồi mới công bố
--     (báo người trúng + đăng bảng tin như trước).
--   • reject_lucky_draw: "Huỷ kết quả" → ghi nhật ký lucky_draw_rejections (ai huỷ, lúc nào, lý do, danh sách trúng bị huỷ, seed /
--     mã băm của lần quay đó để đối chiếu), xoá người trúng, đưa lượt quay về READY để quay lại (lần quay mới có seed mới).
--     Mọi người xem được SỐ LẦN kết quả bị huỷ (minh bạch, tránh "quay tới khi vừa ý" mà không ai biết); chi tiết chỉ ban tổ chức xem.
--   • Seed của lần quay được hiện từ lúc PENDING (thứ tự đã chốt, quay xong rồi) để ban tổ chức đối chiếu trước khi chấp nhận.
--   • Dữ liệu cũ: lượt DONE từ trước giữ nguyên = coi như đã chấp nhận (confirmed_at rỗng).
-- Giữ nguyên chữ ký, kiểu trả về và quyền gọi của finish_lucky_draw / run_lucky_draw / lucky_draws_for.
-- Cần 009500. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

-- ---------------------------------------------------------------------
-- 1. Trạng thái chờ xác nhận + nhật ký huỷ kết quả
-- ---------------------------------------------------------------------
alter table public.lucky_draws drop constraint if exists lucky_draws_status_check;
alter table public.lucky_draws add constraint lucky_draws_status_check check (status in ('READY', 'LIVE', 'PENDING', 'DONE', 'CANCELLED'));
alter table public.lucky_draws add column if not exists confirmed_by uuid references public.profiles(id) on delete set null;
alter table public.lucky_draws add column if not exists confirmed_at timestamptz;

create table if not exists public.lucky_draw_rejections (
  id uuid primary key default gen_random_uuid(),
  draw_id uuid not null references public.lucky_draws(id) on delete cascade,
  rejected_by uuid references public.profiles(id) on delete set null,
  rejected_at timestamptz not null default now(),
  reason text check (reason is null or char_length(reason) <= 300),
  -- Kết quả bị huỷ: [{key, name, prize, prize_idx, position, status}]
  winners jsonb not null default '[]'::jsonb,
  seed text,
  seed_hash text,
  entrants_hash text,
  entrant_count integer,
  started_at timestamptz,
  run_at timestamptz
);
create index if not exists lucky_draw_rejections_draw_idx on public.lucky_draw_rejections (draw_id, rejected_at);
alter table public.lucky_draw_rejections enable row level security;
revoke all on public.lucky_draw_rejections from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. JSON lượt quay: thêm người chấp nhận, số lần huỷ kết quả (mọi người), chi tiết huỷ (ban tổ chức)
-- ---------------------------------------------------------------------
create or replace function private.draw_json(d public.lucky_draws, p_manage boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(d) - 'created_by' - 'run_by' - 'confirmed_by' - 'pool' - 'picked' - 'excluded' - 'seed' - 'manual_names' - 'pool_names'
    || jsonb_build_object('can_manage', p_manage,
    -- 013500: hiện seed từ lúc quay xong (PENDING) để ban tổ chức đối chiếu trước khi chấp nhận
    'seed', case when d.status in ('PENDING', 'DONE') then d.seed end,
    'creator_name', private.display_name(d.created_by),
    'confirmed_by_name', case when d.confirmed_by is not null then private.display_name(d.confirmed_by) end,
    'picked_count', cardinality(d.picked), 'excluded_count', cardinality(d.excluded), 'manual_count', cardinality(d.manual_names),
    'event', (select jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at) from public.club_events e where e.id = d.event_id),
    'winners', coalesce((select jsonb_agg(jsonb_build_object('key', coalesce(w.user_id::text, w.entry), 'user_id', w.user_id,
                  'name', case when w.user_id is null then private.draw_entry_name(w.entry) else private.display_name(w.user_id) end,
                  'avatar_url', pr.avatar_url, 'prize', w.prize, 'prize_idx', w.prize_idx, 'position', w.position, 'status', w.status,
                  'me', w.user_id is not null and w.user_id = auth.uid()) order by w.position)
                from public.lucky_draw_winners w left join public.profiles pr on pr.id = w.user_id where w.draw_id = d.id), '[]'::jsonb),
    'eligible_now', case when d.status = 'READY' and p_manage then
                           case when d.rule = 'MANUAL' then cardinality(d.manual_names) else cardinality(private.draw_pool(d)) end
                         when d.status = 'LIVE' then coalesce(cardinality(d.pool), 0) + coalesce(cardinality(d.pool_names), 0)
                           - (select count(*)::int from public.lucky_draw_winners w where w.draw_id = d.id) end,
    'reel', case when d.status = 'LIVE' then
              case when d.rule = 'MANUAL' then
                coalesce((select jsonb_agg(jsonb_build_object('name', private.draw_entry_name(t.k), 'avatar_url', null))
                            from (select k, row_number() over (order by random()) as rn from unnest(d.pool_names) k) t where t.rn <= 40), '[]'::jsonb)
              else coalesce((select jsonb_agg(jsonb_build_object('name', private.display_name(t.u), 'avatar_url', pr.avatar_url))
                  from (select u, row_number() over (order by random()) as rn from unnest(d.pool) u) t
                  join public.profiles pr on pr.id = t.u where t.rn <= 40), '[]'::jsonb) end end,
    'reject_count', (select count(*)::int from public.lucky_draw_rejections r where r.draw_id = d.id),
    'rejections', case when p_manage then coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'at', r.rejected_at,
                      'by_name', case when r.rejected_by is not null then private.display_name(r.rejected_by) end, 'reason', r.reason,
                      'winners', r.winners, 'seed', r.seed, 'seed_hash', r.seed_hash, 'entrant_count', r.entrant_count) order by r.rejected_at)
                    from public.lucky_draw_rejections r where r.draw_id = d.id), '[]'::jsonb) end)
$$;

-- ---------------------------------------------------------------------
-- 3. Kết thúc quay → chờ xác nhận (không công bố)
-- ---------------------------------------------------------------------
create or replace function public.finish_lucky_draw(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  d public.lucky_draws := (select x from public.lucky_draws x where x.id = p_id for update);
begin
  if d.id is null or not private.draw_can_manage(d.scope, d.ref_id) then raise exception 'FORBIDDEN'; end if;
  if d.status = 'PENDING' then return private.draw_json(d, true); end if;
  if d.status <> 'LIVE' then raise exception 'DRAW_NOT_LIVE'; end if;
  if not exists (select 1 from public.lucky_draw_winners w where w.draw_id = d.id and w.status = 'WON') then raise exception 'NO_WINNERS'; end if;
  update public.lucky_draws set status = 'PENDING', run_at = now(), run_by = coalesce(run_by, v_uid) where id = d.id;
  d := (select t from public.lucky_draws t where t.id = d.id);
  return private.draw_json(d, true);
end $$;

-- ---------------------------------------------------------------------
-- 4. Chấp nhận kết quả → chính thức: báo người trúng + đăng bảng tin
-- ---------------------------------------------------------------------
create or replace function public.confirm_lucky_draw(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  d public.lucky_draws := (select x from public.lucky_draws x where x.id = p_id for update);
begin
  if d.id is null or not private.draw_can_manage(d.scope, d.ref_id) then raise exception 'FORBIDDEN'; end if;
  if d.status = 'DONE' then return private.draw_json(d, true); end if;
  if d.status <> 'PENDING' then raise exception 'DRAW_NOT_PENDING'; end if;
  if not exists (select 1 from public.lucky_draw_winners w where w.draw_id = d.id and w.status = 'WON') then raise exception 'NO_WINNERS'; end if;
  update public.lucky_draws set status = 'DONE', confirmed_by = v_uid, confirmed_at = now() where id = d.id;
  perform private.draw_announce(d.id, v_uid);
  d := (select t from public.lucky_draws t where t.id = d.id);
  return private.draw_json(d, true);
end $$;

-- ---------------------------------------------------------------------
-- 5. Huỷ kết quả → ghi nhật ký, xoá người trúng, quay lại từ đầu
-- ---------------------------------------------------------------------
create or replace function public.reject_lucky_draw(p_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  d public.lucky_draws := (select x from public.lucky_draws x where x.id = p_id for update);
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if d.id is null or not private.draw_can_manage(d.scope, d.ref_id) then raise exception 'FORBIDDEN'; end if;
  if d.status <> 'PENDING' then raise exception 'DRAW_NOT_PENDING'; end if;
  if char_length(coalesce(v_reason, '')) > 300 then raise exception 'REASON_TOO_LONG'; end if;
  insert into public.lucky_draw_rejections (draw_id, rejected_by, reason, winners, seed, seed_hash, entrants_hash, entrant_count, started_at, run_at)
  values (d.id, v_uid, v_reason,
          coalesce((select jsonb_agg(jsonb_build_object('key', coalesce(w.user_id::text, w.entry), 'user_id', w.user_id,
                      'name', case when w.user_id is null then private.draw_entry_name(w.entry) else private.display_name(w.user_id) end,
                      'prize', w.prize, 'prize_idx', w.prize_idx, 'position', w.position, 'status', w.status) order by w.position)
                     from public.lucky_draw_winners w where w.draw_id = d.id), '[]'::jsonb),
          d.seed, d.seed_hash, d.entrants_hash, d.entrant_count, d.started_at, d.run_at);
  delete from public.lucky_draw_winners where draw_id = d.id;
  -- Về READY: lần "Bắt đầu" sau chốt lại danh sách và tạo seed mới
  update public.lucky_draws set status = 'READY', pool = null, pool_names = null, seed = null, seed_hash = null, entrant_count = null,
         entrants_hash = null, started_at = null, run_at = null, run_by = null
   where id = d.id;
  d := (select t from public.lucky_draws t where t.id = d.id);
  return private.draw_json(d, true);
end $$;

-- ---------------------------------------------------------------------
-- 6. Quyền
-- ---------------------------------------------------------------------
revoke all on function private.draw_json(public.lucky_draws, boolean) from public, anon, authenticated;
revoke all on function public.finish_lucky_draw(uuid), public.confirm_lucky_draw(uuid), public.reject_lucky_draw(uuid, text) from public, anon;
grant execute on function public.finish_lucky_draw(uuid), public.confirm_lucky_draw(uuid), public.reject_lucky_draw(uuid, text) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001013600_run_reminder.sql
-- ===================================================================
-- Nhắc runner 3 ngày chưa có bài chạy (Phụng yêu cầu 2026-10-06).
-- Luật cố định, không AI (ADR-018): runner có bài hợp lệ gần nhất cách đây 3–30 ngày, chưa bị khóa,
-- và chưa được nhắc trong 7 ngày qua thì nhận 1 thông báo (chuông + push theo cài đặt "Thành tích").
-- Giờ gửi do cron quyết định (10:30 UTC = 17:30 giờ VN). Idempotent: chạy lại trong ngày không nhắc thêm.

-- Loại thông báo mới thuộc nhóm "game" để dùng chung công tắc "Thành tích", không đổi bảng cài đặt push
create or replace function private.push_category(p_kind text) returns text
language sql immutable as $$
  select case
    when p_kind like 'CLUB\_%' or p_kind = 'CHAT_MENTION' then 'club'
    when p_kind like 'POST\_%' or p_kind = 'CHEER' then 'social'
    when p_kind like 'CHALLENGE\_%' then 'challenge'
    when p_kind in ('BADGE', 'LEVEL_UP', 'LEAGUE', 'RUN_REMINDER') then 'game'
    else 'system'
  end
$$;

create or replace function public.send_run_reminders() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in
    select u.user_id, u.last_run
      from (select a.user_id, max(a.started_at) as last_run
              from public.activities a
             where a.validation_status = 'APPROVED' and coalesce(a.status, '') <> 'DELETED'
             group by a.user_id) u
      join public.profiles p on p.id = u.user_id
     where p.banned_at is null
       and u.last_run <= now() - interval '3 days'
       and u.last_run >  now() - interval '30 days'
       and not exists (select 1 from public.notifications x
                        where x.user_id = u.user_id and x.kind = 'RUN_REMINDER' and x.created_at > now() - interval '7 days')
     order by u.last_run desc
     limit 500
  loop
    perform private.notify(r.user_id, null, 'RUN_REMINDER',
      'Đã vài ngày chưa thấy bạn chạy',
      'Một buổi nhẹ 20–30 phút cũng đủ giữ nhịp. Mở RaceHub để xem thử thách đang chờ bạn.',
      '/me');
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.send_run_reminders() from public, anon, authenticated;
grant execute on function public.send_run_reminders() to service_role;
revoke all on function private.push_category(text) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001013700_overlap_pending_review.sql
-- ===================================================================
-- 013700: bài trùng giờ dài hơn nhưng nghi vấn → chờ duyệt; duyệt xong thì bài trùng giờ bị loại (Phụng yêu cầu 2026-10-07).
--   • Trước: bài mới dài hơn hẳn (> 110% tổng các bài đang tính trùng giờ) nhưng đang nghi vấn chờ xác minh bị loại ngay,
--     admin cũng không khôi phục được khi bài kia còn đang tính.
--   • Nay: bài đó nằm ở trạng thái CHỜ DUYỆT (chưa tính, chưa thưởng). Admin hoặc chủ nhiệm / đội trưởng CLB duyệt "Hợp lệ" thì các bài
--     trùng giờ (đang tính hoặc đang chờ) bị loại cùng lúc, thu hồi Xu / XP / nhiệm vụ / thử thách; duyệt "Không hợp lệ" thì bài kia giữ nguyên.
--   • Người chạy tự bấm "chỉ tính phần có GPS" không được dùng khi còn bài trùng giờ (tránh tính 2 lần, không qua người duyệt).
--   • Bài ngắn hơn / dài hơn không quá 10% vẫn bị loại như 009900.
-- Cần 009900, 002400, 009700. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create or replace function private.activity_overlap_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_end timestamptz;
  v_ids uuid[];
  v_old numeric;
  v_new numeric;
  v_id uuid;
begin
  if new.user_id is null or new.started_at is null or coalesce(new.status, '') = 'DELETED' then return new; end if;
  -- Hai máy gửi cùng lúc: bài sau chờ bài trước ghi xong rồi mới so
  perform pg_advisory_xact_lock(hashtextextended('activity_overlap:' || new.user_id::text, 0));
  v_end := coalesce(new.ended_at, new.started_at + make_interval(secs => greatest(coalesce(new.elapsed_time_s, new.moving_time_s, 0), 0)));

  -- Gửi lại đúng bài cũ (không có mã bài của nguồn) → không tạo bài mới
  if new.source_activity_id is null and exists (
       select 1 from public.activities x
        where x.user_id = new.user_id and x.source is not distinct from new.source and x.source_activity_id is null
          and x.started_at = new.started_at and coalesce(x.ended_at, x.started_at) = v_end) then
    raise exception 'ACTIVITY_DUPLICATE';
  end if;

  v_ids := private.overlap_ids(new.user_id, new.started_at, v_end, new.id);
  if cardinality(v_ids) = 0 then return new; end if;
  v_old := private.overlap_meters(v_ids);
  v_new := private.activity_meters(new.moving_distance_m, new.distance_m);

  if new.validation_status = 'APPROVED' and new.rewarded_at is null and v_new > v_old * 1.1 then
    -- Bài mới dài hơn hẳn → tính bài mới, bỏ các bài trùng giờ
    foreach v_id in array v_ids loop
      perform private.revoke_run_reward(v_id, 'Thu hồi thưởng — bài trùng giờ với bài dài hơn');
    end loop;
    update public.activities
       set validation_status = 'REJECTED', status = 'REJECTED', validation_reason = 'Trùng giờ với bài chạy khác.',
           review_detail = left('Trùng giờ với bài ' || new.id || ' (' || round(v_new / 1000.0, 2) || ' km) — chỉ tính bài dài hơn.', 500),
           updated_at = now()
     where id = any(v_ids);
    return new;
  end if;

  -- 013700: dài hơn hẳn nhưng đang nghi vấn chờ xác minh → giữ ở trạng thái chờ duyệt, không tính, không thay bài đang tính
  if new.validation_status = 'PENDING' and v_new > v_old * 1.1 then
    new.review_detail := left('Trùng giờ với ' || array_to_string(v_ids, ', ') || ' (' || round(v_old / 1000.0, 2) || ' km đang được tính). '
                              || 'Bài này dài hơn: nếu được duyệt hợp lệ, các bài trùng giờ sẽ bị loại'
                              || coalesce(' · ' || new.review_detail, '') || '.', 500);
    return new;
  end if;

  -- Ngược lại: lưu bài mới vào lịch sử nhưng không tính
  new.review_detail := left('Trùng giờ với ' || array_to_string(v_ids, ', ') || ' (' || round(v_old / 1000.0, 2) || ' km đang được tính)'
                            || coalesce(' · ' || new.review_detail, '') || '.', 500);
  new.validation_status := 'REJECTED';
  new.status := 'REJECTED';
  new.validation_reason := 'Trùng giờ với bài chạy khác.';
  return new;
end $$;

-- Duyệt bài chờ: "Hợp lệ" thì loại luôn các bài trùng giờ (đang tính hoặc đang chờ), thu hồi thưởng của chúng
create or replace function public.review_activity(p_activity_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  a public.activities := (select x from public.activities x where x.id = p_activity_id and x.validation_status = 'PENDING');
  v_end timestamptz;
  v_ids uuid[] := '{}';
  v_id uuid;
begin
  if p_status not in ('APPROVED', 'REJECTED') then raise exception 'INVALID_STATUS'; end if;
  if a.id is null then raise exception 'ACTIVITY_NOT_PENDING'; end if;
  if a.user_id = v_uid or not private.can_review_activity(a.user_id) then raise exception 'FORBIDDEN'; end if;

  if p_status = 'APPROVED' then
    perform pg_advisory_xact_lock(hashtextextended('activity_overlap:' || a.user_id::text, 0));
    v_end := coalesce(a.ended_at, a.started_at + make_interval(secs => greatest(coalesce(a.elapsed_time_s, a.moving_time_s, 0), 0)));
    v_ids := private.overlap_ids(a.user_id, a.started_at, v_end, a.id);
    foreach v_id in array v_ids loop
      perform private.revoke_run_reward(v_id, 'Thu hồi thưởng — bài trùng giờ đã được duyệt thay thế');
    end loop;
    if cardinality(v_ids) > 0 then
      update public.activities
         set validation_status = 'REJECTED', status = 'REJECTED', validation_reason = 'Trùng giờ với bài chạy khác.',
             review_detail = left('Trùng giờ với bài ' || a.id || ' đã được ban quản trị duyệt hợp lệ — chỉ tính bài đó.', 500),
             updated_at = now()
       where id = any(v_ids);
    end if;
  end if;

  update public.activities
     set validation_status = p_status,
         status = case when p_status = 'APPROVED' then 'READY' else 'REJECTED' end,
         reviewed_by = v_uid, reviewed_at = now(), updated_at = now()
   where id = a.id;                      -- APPROVED → trigger trả thưởng + cộng vào thử thách

  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'REVIEW_ACTIVITY', a.id::text, jsonb_build_object('status', p_status, 'rejected_overlaps', to_jsonb(v_ids)));

  perform private.notify(a.user_id, null, 'RUN_REVIEW',
    case when p_status = 'APPROVED' then 'Bài chạy đã được xác minh' else 'Bài chạy không được ghi nhận' end,
    round(coalesce(a.distance_m, 0) / 1000.0, 2) || ' km — ' ||
      case when p_status = 'APPROVED' then 'đã cộng Xu, XP và tính vào thử thách.'
           else 'ban quản trị xác định dữ liệu không hợp lệ.' end
      || case when cardinality(v_ids) > 0 then ' ' || cardinality(v_ids) || ' bài trùng giờ không còn được tính.' else '' end,
    '/activities/' || a.id, v_uid, true);
end $$;

-- Người chạy không tự duyệt "chỉ tính phần có GPS" khi còn bài trùng giờ (phải qua người duyệt)
create or replace function private.can_accept_verified(a public.activities) returns boolean
language sql stable security definer set search_path = public as $$
  select a.validation_status = 'PENDING' and coalesce(a.status, '') <> 'DELETED'
     and private.gap_meters(a.risk_flags) > 0 and coalesce(a.risk_score, 0) < 65
     and not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(a.risk_flags) = 'array' then a.risk_flags else '[]'::jsonb end) f
                      where f->>'code' <> 'GPS_GAP' and f->>'severity' in ('HIGH', 'SEVERE'))
     and cardinality(private.overlap_ids(a.user_id, a.started_at,
           coalesce(a.ended_at, a.started_at + make_interval(secs => greatest(coalesce(a.elapsed_time_s, a.moving_time_s, 0), 0))), a.id)) = 0
$$;

revoke all on function private.activity_overlap_guard(), private.can_accept_verified(public.activities) from public, anon, authenticated;
revoke all on function public.review_activity(uuid, text) from public, anon;
grant execute on function public.review_activity(uuid, text) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001013800_conquest_any_mode.sql
-- ===================================================================
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

commit;
