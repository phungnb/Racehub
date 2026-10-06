-- RaceHub — PHẦN 24/25 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 013500
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

commit;
