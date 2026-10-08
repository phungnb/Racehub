-- RaceHub — PHẦN 24/25 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 013500, 013600, 013700, 013800, 013900, 014000, 014100
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

-- ===================================================================
-- 20261001013900_quote_solo_goal_slots.sql
-- ===================================================================
-- Báo giá thử thách Chinh phục cá nhân nhiều người (vd chinh phục cự ly mừng sự kiện): tính theo số chỗ thật.
--   Trước: quote_challenge luôn coi SOLO_GOAL là 1 chỗ nên báo "miễn phí / đủ hạn mức gói CLB", nhưng khi tạo
--   (create_challenge_v2) phí và hạn mức gói CLB (Free ≤ 50 người, Pro ≤ 1.000) tính theo số chỗ thật → báo giá sai,
--   bấm tạo mới bị từ chối INSUFFICIENT_TREASURY. "Cá nhân tôi" vẫn tính 1 chỗ vì app gửi p_max_slots = 1.
create or replace function public.quote_challenge(p_max_slots integer, p_format text default 'RANKED', p_club_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_slots integer := case when p_format = 'DUEL' then 2 else greatest(coalesce(p_max_slots, 1), 1) end;
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

-- ===================================================================
-- 20261001014000_admin_save_plan_fix.sql
-- ===================================================================
-- 014000: Sửa lỗi lưu gói ở trang admin (mã UNK-FSZ, "column reference "e" is ambiguous").
-- admin_save_plan (003800) khai báo biến e jsonb rồi lại đặt bí danh e cho jsonb_array_elements ở phần lượt tạo,
-- nên mọi lần lưu có gửi lượt tạo (credits) đều lỗi. Đổi bí danh; trùng quy mô thì lấy dòng sau cùng thay vì lỗi khóa chính.
-- Chạy riêng được ngay; chạy lại 3500.

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
    for e in select value from jsonb_array_elements(p->'credits') loop
      if coalesce((e->>'per_month')::int, 0) > 0 then
        insert into public.plan_credits (plan_code, capacity, per_month)
        values (v_code, (e->>'capacity')::int, (e->>'per_month')::int)
        on conflict (plan_code, capacity) do update set per_month = excluded.per_month;
      end if;
    end loop;
  end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SAVE_PLAN', v_code, p);
end $$;

-- ===================================================================
-- 20261001014100_club_public_challenge.sql
-- ===================================================================
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

commit;
