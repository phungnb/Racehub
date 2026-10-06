-- RaceHub — PHẦN 15/25 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 009500, 009600, 009700, 009800, 009900
-- Supabase → SQL Editor → New query → dán TOÀN BỘ phần này → Run. Lỗi thì không có gì thay đổi; chạy lại vẫn an toàn.
-- Xong thì chạy phần tiếp theo.
begin;
-- ===================================================================
-- 20261001009500_draw_sources.sql
-- ===================================================================
-- 009500: QUAY THƯỞNG — thêm nguồn người được quay + nhà tài trợ.
--   • EVENT: chỉ người đã ĐIỂM DANH (QR / ban quản trị điểm) ở một buổi của CLB — không còn cảnh gọi tên người vắng.
--   • MANUAL: ban quản trị DÁN danh sách tên (mỗi dòng một người) — khách mời, người chưa có tài khoản, danh sách từ Google Form…
--     Người trong danh sách dán không nhận thông báo trong app (có thể chưa có tài khoản); kết quả vẫn công bố + mã kiểm chứng như thường.
--   • Nhà tài trợ: tên + logo hiện trên màn hình quay và trong nội dung công bố.
-- Thứ tự trúng vẫn = md5(seed || khoá), khoá = mã người dùng hoặc "số thứ tự|tên" của dòng dán.
-- Cần 009300. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

alter table public.lucky_draws drop constraint if exists lucky_draws_rule_check;
alter table public.lucky_draws add constraint lucky_draws_rule_check check (rule in ('COMPLETED', 'ACTIVE', 'ALL', 'PICKED', 'EVENT', 'MANUAL'));
alter table public.lucky_draws add column if not exists event_id uuid references public.club_events(id) on delete set null;
alter table public.lucky_draws add column if not exists manual_names text[] not null default '{}';
alter table public.lucky_draws add column if not exists pool_names text[];
alter table public.lucky_draws add column if not exists sponsor jsonb;

-- Người trúng từ danh sách dán không có tài khoản → user_id rỗng, lưu khoá dòng
alter table public.lucky_draw_winners drop constraint if exists lucky_draw_winners_pkey;
alter table public.lucky_draw_winners alter column user_id drop not null;
alter table public.lucky_draw_winners add column if not exists entry text;
alter table public.lucky_draw_winners drop constraint if exists lucky_draw_winners_who_check;
alter table public.lucky_draw_winners add constraint lucky_draw_winners_who_check check (user_id is not null or entry is not null);
create unique index if not exists lucky_draw_winners_key_uidx on public.lucky_draw_winners (draw_id, (coalesce(user_id::text, entry)));

create or replace function private.draw_entry_name(p_entry text) returns text
language sql immutable as $$ select substr(p_entry, strpos(p_entry, '|') + 1) $$;

-- ---------------------------------------------------------------------
-- 1. Danh sách được quay
-- ---------------------------------------------------------------------
create or replace function private.draw_pool(d public.lucky_draws) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct c.u), '{}')
    from (select e.user_id as u
            from private.draw_entrants(d.scope, d.ref_id, case when d.rule in ('PICKED', 'EVENT', 'MANUAL') then 'ALL' else d.rule end) e
           where d.rule not in ('EVENT', 'MANUAL')
          union all
          select r.user_id from public.club_event_rsvps r
           where d.rule = 'EVENT' and r.event_id = d.event_id and r.checked_in_at is not null) c
   where c.u is not null
     and (d.rule <> 'PICKED' or c.u = any(d.picked))
     and not (c.u = any(d.excluded))
     and not (d.exclude_winners and exists (select 1 from public.lucky_draw_winners lw join public.lucky_draws x on x.id = lw.draw_id
                                             where x.scope = d.scope and x.ref_id is not distinct from d.ref_id and x.id <> d.id
                                               and lw.status = 'WON' and lw.user_id = c.u))
$$;

create or replace function private.draw_json(d public.lucky_draws, p_manage boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(d) - 'created_by' - 'run_by' - 'pool' - 'picked' - 'excluded' - 'seed' - 'manual_names' - 'pool_names'
    || jsonb_build_object('can_manage', p_manage,
    'seed', case when d.status = 'DONE' then d.seed end,
    'creator_name', private.display_name(d.created_by),
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
                  join public.profiles pr on pr.id = t.u where t.rn <= 40), '[]'::jsonb) end end)
$$;

-- ---------------------------------------------------------------------
-- 2. Tạo lượt quay
-- ---------------------------------------------------------------------
create or replace function public.create_lucky_draw(p_scope text, p_ref uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_new_id uuid;
  v_uid uuid := private.require_uid();
  v_title text := trim(coalesce(p->>'title', ''));
  v_rule text := case when p->>'rule' in ('COMPLETED', 'ACTIVE', 'ALL', 'PICKED', 'EVENT', 'MANUAL') then p->>'rule' else 'COMPLETED' end;
  v_prizes jsonb;
  v_picked uuid[];
  v_excluded uuid[];
  v_names text[];
  v_event uuid;
  v_sponsor jsonb;
  d public.lucky_draws;
begin
  if p_scope not in ('ORG_CAMPAIGN', 'CHALLENGE', 'CLUB', 'RACE', 'SYSTEM') then raise exception 'INVALID_SCOPE'; end if;
  if not private.draw_can_manage(p_scope, p_ref) then raise exception 'FORBIDDEN'; end if;
  if char_length(v_title) not between 3 and 120 then raise exception 'TITLE_REQUIRED'; end if;
  v_prizes := (select coalesce(jsonb_agg(jsonb_build_object('name', left(trim(x->>'name'), 80), 'qty', least(greatest(coalesce((x->>'qty')::int, 1), 1), 100))), '[]'::jsonb)
                 from jsonb_array_elements(case when jsonb_typeof(p->'prizes') = 'array' then p->'prizes' else '[]'::jsonb end) x
                where char_length(trim(coalesce(x->>'name', ''))) > 0);
  if jsonb_array_length(v_prizes) not between 1 and 10 then raise exception 'INVALID_PRIZES'; end if;
  if (select sum((x->>'qty')::int) from jsonb_array_elements(v_prizes) x) > 200 then raise exception 'INVALID_PRIZES'; end if;
  if jsonb_array_length(case when jsonb_typeof(p->'picked') = 'array' then p->'picked' else '[]'::jsonb end) > 2000
     or jsonb_array_length(case when jsonb_typeof(p->'excluded') = 'array' then p->'excluded' else '[]'::jsonb end) > 2000
     or jsonb_array_length(case when jsonb_typeof(p->'names') = 'array' then p->'names' else '[]'::jsonb end) > 2000 then
    raise exception 'TOO_MANY_PEOPLE';
  end if;
  v_picked := case when v_rule = 'PICKED' then private.draw_clean_ids(p_scope, p_ref, p->'picked') else '{}' end;
  v_excluded := private.draw_clean_ids(p_scope, p_ref, p->'excluded');
  if v_rule = 'PICKED' and cardinality(v_picked) = 0 then raise exception 'PICK_REQUIRED'; end if;
  -- Danh sách dán: bỏ dòng trống, cắt 80 ký tự
  v_names := case when v_rule = 'MANUAL' then
               (select coalesce(array_agg(left(trim(x), 80) order by o), '{}')
                  from jsonb_array_elements_text(case when jsonb_typeof(p->'names') = 'array' then p->'names' else '[]'::jsonb end) with ordinality as t(x, o)
                 where char_length(trim(x)) > 0)
             else '{}' end;
  if v_rule = 'MANUAL' and cardinality(v_names) = 0 then raise exception 'NAMES_REQUIRED'; end if;
  if v_rule = 'EVENT' then
    v_event := (select e.id from public.club_events e where p_scope = 'CLUB' and e.club_id = p_ref and e.id::text = p->>'event_id');
    if v_event is null then raise exception 'EVENT_REQUIRED'; end if;
  end if;
  if jsonb_typeof(p->'sponsor') = 'object' and char_length(trim(coalesce(p->'sponsor'->>'name', ''))) > 0 then
    if char_length(trim(p->'sponsor'->>'name')) > 80
       or (coalesce(p->'sponsor'->>'logo_url', '') <> '' and (p->'sponsor'->>'logo_url' !~ '^https://' or char_length(p->'sponsor'->>'logo_url') > 500)) then
      raise exception 'INVALID_SPONSOR';
    end if;
    v_sponsor := jsonb_build_object('name', trim(p->'sponsor'->>'name'), 'logo_url', nullif(p->'sponsor'->>'logo_url', ''));
  end if;
  if (select count(*) from public.lucky_draws x where x.scope = p_scope and x.ref_id is not distinct from p_ref and x.status in ('READY', 'LIVE')) >= 5 then
    raise exception 'TOO_MANY_DRAWS';
  end if;
  v_new_id := gen_random_uuid();
  insert into public.lucky_draws (id, scope, ref_id, title, rule, prizes, exclude_winners, created_by, picked, excluded, manual_names, event_id, sponsor)
  values (v_new_id, p_scope, case when p_scope = 'SYSTEM' then null else p_ref end, v_title, v_rule, v_prizes,
          coalesce((p->>'exclude_winners')::boolean, true), v_uid, v_picked, v_excluded, v_names, v_event, v_sponsor);
  d := (select t from public.lucky_draws t where t.id = v_new_id);
  return private.draw_json(d, true);
end $$;

/** Các buổi của CLB trong 60 ngày qua + số người đã điểm danh — để chọn "người có mặt tại buổi" */
create or replace function public.club_draw_events(p_club uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.club_is_staff(p_club) then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at,
                    'checked_in', (select count(*) from public.club_event_rsvps r where r.event_id = e.id and r.checked_in_at is not null))
                    order by e.starts_at desc)
                     from public.club_events e
                    where e.club_id = p_club and e.status <> 'CANCELLED' and e.starts_at > now() - interval '60 days' and e.starts_at < now() + interval '1 day'), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- 3. Quay
-- ---------------------------------------------------------------------
create or replace function public.start_lucky_draw(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := private.require_uid();
  d public.lucky_draws := (select x from public.lucky_draws x where x.id = p_id for update);
  v_seed text := encode(extensions.gen_random_bytes(16), 'hex');
  v_pool uuid[] := '{}';
  v_names text[] := '{}';
  v_count integer;
begin
  if d.id is null or not private.draw_can_manage(d.scope, d.ref_id) then raise exception 'FORBIDDEN'; end if;
  if d.status = 'LIVE' then return private.draw_json(d, true); end if;
  if d.status <> 'READY' then raise exception 'DRAW_CLOSED'; end if;
  if d.rule = 'MANUAL' then
    v_names := (select coalesce(array_agg(lpad(o::text, 4, '0') || '|' || n order by o), '{}') from unnest(d.manual_names) with ordinality as t(n, o));
    v_count := cardinality(v_names);
  else
    v_pool := private.draw_pool(d);
    v_count := cardinality(v_pool);
  end if;
  if v_count = 0 then raise exception 'NO_ENTRANTS'; end if;
  update public.lucky_draws set status = 'LIVE', pool = v_pool, pool_names = v_names, seed = v_seed, seed_hash = md5(v_seed), entrant_count = v_count,
         entrants_hash = case when d.rule = 'MANUAL' then (select md5(string_agg(k, ',' order by k)) from unnest(v_names) k)
                              else (select md5(string_agg(u::text, ',' order by u)) from unnest(v_pool) u) end,
         run_by = v_uid, started_at = now()
   where id = d.id;
  d := (select t from public.lucky_draws t where t.id = d.id);
  return private.draw_json(d, true);
end $$;

-- Người / dòng kế tiếp theo thứ tự md5(seed || khoá) nhận giải p_prize. false = hết người.
create or replace function private.draw_pick_next(p_id uuid, p_prize integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  d public.lucky_draws := (select x from public.lucky_draws x where x.id = p_id);
  v_key text;
  v_pos integer := (select count(*)::int + 1 from public.lucky_draw_winners w where w.draw_id = p_id);
begin
  v_key := (select t.k from (select k, row_number() over (order by md5(d.seed || k)) as rn
                               from (select u::text as k from unnest(coalesce(d.pool, '{}')) u
                                     union all select n from unnest(coalesce(d.pool_names, '{}')) n) s
                              where not exists (select 1 from public.lucky_draw_winners w where w.draw_id = d.id and coalesce(w.user_id::text, w.entry) = s.k)) t
             where t.rn = 1);
  if v_key is null then return false; end if;
  insert into public.lucky_draw_winners (draw_id, user_id, entry, prize, prize_idx, position, status)
  values (d.id, case when d.rule = 'MANUAL' then null else v_key::uuid end, case when d.rule = 'MANUAL' then v_key end,
          d.prizes->p_prize->>'name', p_prize, v_pos, 'WON');
  return true;
end $$;

create or replace function public.draw_next(p_id uuid, p_prize integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d public.lucky_draws := (select x from public.lucky_draws x where x.id = p_id for update);
begin
  if d.id is null or not private.draw_can_manage(d.scope, d.ref_id) then raise exception 'FORBIDDEN'; end if;
  if d.status <> 'LIVE' then raise exception 'DRAW_NOT_LIVE'; end if;
  if p_prize is null or p_prize < 0 or p_prize >= jsonb_array_length(d.prizes) then raise exception 'INVALID_PRIZES'; end if;
  if private.draw_left(d, p_prize) <= 0 then raise exception 'PRIZE_FULL'; end if;
  if not private.draw_pick_next(d.id, p_prize) then raise exception 'POOL_EXHAUSTED'; end if;
  d := (select t from public.lucky_draws t where t.id = d.id);
  return private.draw_json(d, true);
end $$;

/** Vắng mặt theo khoá (mã người dùng hoặc dòng dán) */
create or replace function public.draw_absent_key(p_id uuid, p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d public.lucky_draws := (select x from public.lucky_draws x where x.id = p_id for update);
begin
  if d.id is null or not private.draw_can_manage(d.scope, d.ref_id) then raise exception 'FORBIDDEN'; end if;
  if d.status <> 'LIVE' then raise exception 'DRAW_NOT_LIVE'; end if;
  update public.lucky_draw_winners set status = 'ABSENT'
   where draw_id = d.id and coalesce(user_id::text, entry) = p_key and status = 'WON';
  if not found then raise exception 'NOT_A_WINNER'; end if;
  return private.draw_json(d, true);
end $$;

create or replace function public.draw_absent(p_id uuid, p_user uuid) returns jsonb
language sql security definer set search_path = public as $$ select public.draw_absent_key(p_id, p_user::text) $$;

create or replace function private.draw_announce(p_id uuid, p_uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  d public.lucky_draws := (select x from public.lucky_draws x where x.id = p_id);
  v_org uuid;
  v_title text;
  w record;
begin
  for w in select lw.user_id, lw.prize from public.lucky_draw_winners lw where lw.draw_id = d.id and lw.status = 'WON' and lw.user_id is not null loop
    perform private.notify(w.user_id, case when d.scope = 'CLUB' then d.ref_id end, 'LUCKY_DRAW_WIN', 'Chúc mừng! Bạn trúng ' || w.prize,
      d.title, case d.scope when 'ORG_CAMPAIGN' then '/orgs/' || (select c.org_id from public.org_campaigns c where c.id = d.ref_id) || '/campaigns/' || d.ref_id
                             when 'CHALLENGE' then '/challenges/' || d.ref_id when 'CLUB' then '/clubs/' || d.ref_id || '/hall'
                             when 'RACE' then '/races/' || d.ref_id else '/notifications' end, p_uid, true);
  end loop;
  v_title := 'Kết quả ' || d.title || coalesce(' (tài trợ: ' || (d.sponsor->>'name') || ')', '') || ': '
    || coalesce((select string_agg(case when lw.user_id is null then private.draw_entry_name(lw.entry) else private.display_name(lw.user_id) end
                                   || ' (' || lw.prize || ')', ', ' order by lw.position)
                   from public.lucky_draw_winners lw where lw.draw_id = d.id and lw.status = 'WON'), '');
  if d.scope = 'ORG_CAMPAIGN' then
    v_org := (select c.org_id from public.org_campaigns c where c.id = d.ref_id);
    insert into public.org_posts (org_id, author_id, kind, body, meta) values (v_org, p_uid, 'DRAW', left(v_title, 2000), jsonb_build_object('draw_id', d.id));
  elsif d.scope = 'CLUB' then
    insert into public.club_posts (club_id, author_id, kind, title, body, is_pinned)
    values (d.ref_id, p_uid, 'ANNOUNCEMENT', left('Quay thưởng: ' || d.title, 120), left(v_title, 2000), false);
  end if;
end $$;

create or replace function public.run_lucky_draw(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := private.require_uid();
  d public.lucky_draws := (select x from public.lucky_draws x where x.id = p_id);
  i integer;
  k integer;
begin
  if d.id is null or not private.draw_can_manage(d.scope, d.ref_id) then raise exception 'FORBIDDEN'; end if;
  if d.status not in ('READY', 'LIVE') then raise exception 'DRAW_CLOSED'; end if;
  if d.status = 'READY' then perform public.start_lucky_draw(p_id); end if;
  perform 1 from public.lucky_draws x where x.id = p_id for update;
  d := (select x from public.lucky_draws x where x.id = p_id);
  <<prizes>>
  for i in 0 .. jsonb_array_length(d.prizes) - 1 loop
    for k in 1 .. greatest(private.draw_left(d, i), 0) loop
      exit prizes when not private.draw_pick_next(d.id, i);
    end loop;
  end loop;
  return public.finish_lucky_draw(p_id);
end $$;

revoke all on function private.draw_entry_name(text), private.draw_pool(public.lucky_draws), private.draw_json(public.lucky_draws, boolean),
  private.draw_pick_next(uuid, integer), private.draw_announce(uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_lucky_draw(text, uuid, jsonb), public.club_draw_events(uuid), public.start_lucky_draw(uuid),
  public.draw_next(uuid, integer), public.draw_absent_key(uuid, text), public.draw_absent(uuid, uuid), public.run_lucky_draw(uuid) from public, anon;
grant execute on function public.create_lucky_draw(text, uuid, jsonb), public.club_draw_events(uuid), public.start_lucky_draw(uuid),
  public.draw_next(uuid, integer), public.draw_absent_key(uuid, text), public.draw_absent(uuid, uuid), public.run_lucky_draw(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001009600_club_dashboard_recap.sql
-- ===================================================================
-- 009600: BẢNG ĐIỀU KHIỂN BAN QUẢN TRỊ CLB + TỔNG KẾT TUẦN / THÁNG TỰ ĐỘNG.
--   • club_admin_dashboard: một màn cho ban quản trị — đơn chờ duyệt, thành viên lâu không chạy, hoạt động tuần này so với tuần trước,
--     quỹ (số dư, khoản chờ xác nhận), buổi sắp tới, thử thách đang chạy, lượt quay thưởng, top điểm CLB, cài đặt tổng kết.
--   • Tổng kết: thêm tổng kết THÁNG, top điểm CLB (009400), số buổi / lượt điểm danh, cột mốc; ban quản trị bật / tắt từng loại
--     và bấm "Đăng ngay" cho kỳ vừa xong. Cron gọi hằng ngày, mỗi kỳ chỉ đăng một lần (khoá meta.week như 000500).
-- Cần 000500, 001500, 007000, 007800, 009300, 009400. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT,
-- không RETURNING INTO. Chạy lại an toàn.

create table if not exists public.club_ops (
  club_id uuid primary key references public.clubs(id) on delete cascade,
  recap_weekly boolean not null default true,
  recap_monthly boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.club_ops enable row level security;
revoke all on public.club_ops from anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Nội dung tổng kết một kỳ [p_start, p_end)
-- ---------------------------------------------------------------------
create or replace function private.club_recap_meta(p_club uuid, p_start timestamptz, p_end timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
  with runs as (
    select a.user_id, a.distance_m
      from public.club_members m
      join public.activities a on a.user_id = m.user_id and a.validation_status = 'APPROVED' and a.shared
       and coalesce(a.status, '') <> 'DELETED' and a.started_at >= p_start and a.started_at < p_end
     where m.club_id = p_club and m.status = 'APPROVED'
  ), per as (
    select r.user_id, sum(r.distance_m) as distance_m, row_number() over (order by sum(r.distance_m) desc) as rk from runs r group by r.user_id
  ), pts as (
    select d.user_id, sum(d.pts) as points, row_number() over (order by sum(d.pts) desc) as rk
      from (select r.user_id, r.day, least(sum(r.points), coalesce(max(r.daily_cap), sum(r.points))) as pts
              from private.club_point_rows(p_club, p_start) r where r.started_at < p_end group by r.user_id, r.day) d
     group by d.user_id having sum(d.pts) > 0
  )
  select jsonb_build_object(
    'distance_m', coalesce((select sum(distance_m) from runs), 0),
    'run_count', (select count(*) from runs),
    'active_members', (select count(distinct user_id) from runs),
    'new_members', (select count(*) from public.club_members where club_id = p_club and status = 'APPROVED' and joined_at >= p_start and joined_at < p_end),
    'top', coalesce((select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'name', private.display_name(p.user_id), 'distance_m', p.distance_m) order by p.rk)
                       from per p where p.rk <= 3), '[]'::jsonb),
    'points_top', coalesce((select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'name', private.display_name(p.user_id), 'points', p.points) order by p.rk)
                              from pts p where p.rk <= 3), '[]'::jsonb),
    'events', (select count(*) from public.club_events e where e.club_id = p_club and e.status <> 'CANCELLED' and e.starts_at >= p_start and e.starts_at < p_end),
    'checkins', (select count(*) from public.club_event_rsvps r join public.club_events e on e.id = r.event_id
                  where e.club_id = p_club and r.checked_in_at is not null and e.starts_at >= p_start and e.starts_at < p_end),
    'milestones', (select count(*) from public.club_posts x where x.club_id = p_club and x.kind = 'MILESTONE' and x.created_at >= p_start and x.created_at < p_end))
$$;

/** Đăng tổng kết một kỳ cho một CLB (kỳ đã kết thúc). Trả về id bài, null nếu đã có / không ai chạy */
create or replace function private.club_post_recap(p_club uuid, p_period text, p_start timestamptz) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_end timestamptz := case when p_period = 'MONTH' then p_start + interval '1 month' else p_start + interval '7 days' end;
  v_local timestamp := p_start at time zone 'Asia/Ho_Chi_Minh';
  v_key text := case when p_period = 'MONTH' then to_char(v_local, 'YYYY-"M"MM') else to_char(v_local, 'IYYY-"W"IW') end;
  v_meta jsonb;
  v_id uuid;
begin
  if exists (select 1 from public.club_posts x where x.club_id = p_club and x.kind = 'RECAP' and x.meta->>'week' = v_key) then return null; end if;
  v_meta := private.club_recap_meta(p_club, p_start, v_end);
  if (v_meta->>'run_count')::int = 0 then return null; end if;
  v_id := gen_random_uuid();
  insert into public.club_posts (id, club_id, kind, title, body, meta)
  values (v_id, p_club, 'RECAP',
          case when p_period = 'MONTH' then 'Tổng kết tháng ' || to_char(v_local, 'MM/YYYY') else 'Tổng kết tuần ' || to_char(v_local, 'DD/MM') end,
          '', v_meta || jsonb_build_object('week', v_key, 'period', p_period, 'from', p_start, 'to', v_end))
  on conflict (club_id, (meta->>'week')) where kind = 'RECAP' do nothing;
  if not found then return null; end if;
  return v_id;
end $$;

-- Cron (hằng ngày): tổng kết tuần trước cho CLB bật tổng kết tuần
create or replace function public.post_weekly_club_recaps() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_start timestamptz := private.period_start('WEEK') - interval '7 days';
  c record; n int := 0;
begin
  for c in select x.id from public.clubs x left join public.club_ops o on o.club_id = x.id where coalesce(o.recap_weekly, true) loop
    if private.club_post_recap(c.id, 'WEEK', v_start) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Cron (hằng ngày): tổng kết tháng trước cho CLB bật tổng kết tháng
create or replace function public.post_monthly_club_recaps() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_start timestamptz := ((date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') - interval '1 month') at time zone 'Asia/Ho_Chi_Minh');
  c record; n int := 0;
begin
  for c in select x.id from public.clubs x left join public.club_ops o on o.club_id = x.id where coalesce(o.recap_monthly, true) loop
    if private.club_post_recap(c.id, 'MONTH', v_start) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

/** Ban quản trị bấm "Đăng ngay": tổng kết tuần trước / tháng trước nếu chưa đăng */
create or replace function public.club_post_recap_now(p_club uuid, p_period text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_staff(p_club);
  v_id uuid;
begin
  if upper(coalesce(p_period, '')) not in ('WEEK', 'MONTH') then raise exception 'INVALID_PERIOD'; end if;
  v_id := private.club_post_recap(p_club, upper(p_period),
            case when upper(p_period) = 'MONTH' then ((date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') - interval '1 month') at time zone 'Asia/Ho_Chi_Minh')
                 else private.period_start('WEEK') - interval '7 days' end);
  if v_id is null then raise exception 'RECAP_NOT_POSTED'; end if;
  return v_id;
end $$;

create or replace function public.set_club_recap(p_club uuid, p_weekly boolean, p_monthly boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_staff(p_club);
begin
  insert into public.club_ops (club_id, recap_weekly, recap_monthly, updated_by, updated_at)
  values (p_club, coalesce(p_weekly, true), coalesce(p_monthly, true), v_uid, now())
  on conflict (club_id) do update set recap_weekly = excluded.recap_weekly, recap_monthly = excluded.recap_monthly,
                                      updated_by = excluded.updated_by, updated_at = now();
end $$;

-- ---------------------------------------------------------------------
-- 2. Bảng điều khiển ban quản trị
-- ---------------------------------------------------------------------
create or replace function public.club_admin_dashboard(p_club uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_staff(p_club);
  v_week timestamptz := private.period_start('WEEK');
begin
  return jsonb_build_object(
    'members', (select count(*) from public.club_members m where m.club_id = p_club and m.status = 'APPROVED'),
    'new_30d', (select count(*) from public.club_members m where m.club_id = p_club and m.status = 'APPROVED' and m.joined_at > now() - interval '30 days'),
    'pending', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', private.display_name(m.user_id), 'avatar_url', pr.avatar_url,
                                                            'requested_at', m.joined_at) order by m.joined_at)
                           from public.club_members m join public.profiles pr on pr.id = m.user_id
                          where m.club_id = p_club and m.status = 'PENDING'), '[]'::jsonb),
    -- Thành viên 30 ngày không có bài chạy hợp lệ: cần hỏi thăm
    'inactive', coalesce((select jsonb_agg(jsonb_build_object('user_id', t.user_id, 'name', private.display_name(t.user_id), 'avatar_url', t.avatar_url,
                                                             'last_run_at', t.last_run) order by t.last_run nulls first)
                            from (select m.user_id, pr.avatar_url,
                                         (select max(a.started_at) from public.activities a where a.user_id = m.user_id and a.validation_status = 'APPROVED'
                                            and coalesce(a.status, '') <> 'DELETED') as last_run
                                    from public.club_members m join public.profiles pr on pr.id = m.user_id
                                   where m.club_id = p_club and m.status = 'APPROVED' and m.joined_at < now() - interval '14 days') t
                           where t.last_run is null or t.last_run < now() - interval '30 days'), '[]'::jsonb),
    'this_week', private.club_recap_meta(p_club, v_week, now() + interval '1 minute'),
    'last_week', private.club_recap_meta(p_club, v_week - interval '7 days', v_week),
    'finance', jsonb_build_object(
      'balance', (select coalesce(sum(case when e.kind = 'EXPENSE' then -e.amount_vnd else e.amount_vnd end), 0)
                    from public.club_cash_entries e where e.club_id = p_club and e.voided_at is null),
      'claims', (select count(*) from public.club_due_payments p join public.club_dues d on d.id = p.due_id where d.club_id = p_club and p.status = 'CLAIMED'),
      'open_dues', (select count(*) from public.club_dues d where d.club_id = p_club and d.closed_at is null)),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at,
                                                           'going', (select count(*) from public.club_event_rsvps r where r.event_id = e.id and r.status = 'GOING'))
                                         order by e.starts_at)
                          from public.club_events e where e.club_id = p_club and e.status <> 'CANCELLED'
                           and e.starts_at > now() and e.starts_at < now() + interval '14 days'), '[]'::jsonb),
    'challenges', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'end_date', c.end_date,
                                                               'participants', (select count(*) from public.challenge_participants p where p.challenge_id = c.id and p.status <> 'LEFT'))
                                             order by c.end_date)
                              from public.challenges c where c.target_club_id = p_club and c.status = 'ACTIVE'), '[]'::jsonb),
    'draws', jsonb_build_object(
      'ready', (select count(*) from public.lucky_draws d where d.scope = 'CLUB' and d.ref_id = p_club and d.status = 'READY'),
      'live', (select count(*) from public.lucky_draws d where d.scope = 'CLUB' and d.ref_id = p_club and d.status = 'LIVE')),
    'points', jsonb_build_object(
      'has_rules', exists (select 1 from public.club_point_rules r where r.club_id = p_club),
      'top', coalesce((select jsonb_agg(jsonb_build_object('user_id', t.user_id, 'name', private.display_name(t.user_id), 'points', t.points) order by t.points desc)
                         from (select x.*, row_number() over (order by x.points desc) as rk from private.club_point_totals(p_club, v_week) x where x.points > 0) t
                        where t.rk <= 3), '[]'::jsonb)),
    'recap', jsonb_build_object(
      'weekly', coalesce((select o.recap_weekly from public.club_ops o where o.club_id = p_club), true),
      'monthly', coalesce((select o.recap_monthly from public.club_ops o where o.club_id = p_club), true)));
end $$;

revoke all on function private.club_recap_meta(uuid, timestamptz, timestamptz), private.club_post_recap(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.post_weekly_club_recaps(), public.post_monthly_club_recaps() from public, anon, authenticated;
grant execute on function public.post_weekly_club_recaps(), public.post_monthly_club_recaps() to service_role;
revoke all on function public.club_post_recap_now(uuid, text), public.set_club_recap(uuid, boolean, boolean), public.club_admin_dashboard(uuid) from public, anon;
grant execute on function public.club_post_recap_now(uuid, text), public.set_club_recap(uuid, boolean, boolean), public.club_admin_dashboard(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001009700_review_scope_fix.sql
-- ===================================================================
-- 009700: CHỐNG GIAN LẬN NGOÀI THỬ THÁCH — sửa lỗ hổng "tự duyệt mọi bài nghi vấn" (008500).
-- Trước: người không thi đấu → MỌI bài nghi vấn (kể cả giống đi xe, mất GPS gần hết quãng) được tự duyệt, vẫn cộng Xu, XP, BXH CLB.
--   Ví dụ thật: 3,01 km trong đó 2,99 km là đoạn mất tín hiệu được nối thẳng (đi xe máy lúc tắt màn hình) → vẫn được +2 Xu, +30 XP.
-- Sau:
--   • Chỉ tự duyệt bài nghi vấn MỨC THẤP (điểm rủi ro ≤ antiCheat.autoApproveMaxScore, mặc định 34 — admin chỉnh ở Chính sách vận hành).
--     Từ mức Trung bình trở lên: chờ xác minh, chưa cộng Xu / XP / BXH / điểm CLB — dù có thi đấu hay không.
--   • Bài mất tín hiệu GPS: người chạy tự chọn "Chỉ tính phần có GPS" → bỏ quãng nối thẳng, được duyệt ngay với phần đã kiểm chứng.
--   • Lời báo cho người chạy viết lại gọn, không lộ ngưỡng phát hiện; chi tiết kỹ thuật giữ ở review_detail cho người duyệt.
-- Cần 008500, 009100, 009200. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

alter table public.activities add column if not exists review_detail text;

-- ---------------------------------------------------------------------
-- 1. Ngưỡng tự duyệt do admin đặt (thêm vào nhóm antiCheat của chính sách vận hành)
-- ---------------------------------------------------------------------
create or replace function private.ops_defaults() returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'features', jsonb_build_object('nearby', true, 'market', true, 'bibMarket', true, 'knowledge', true, 'races', true, 'cups', true, 'orgs', true),
    'tracking', jsonb_build_object('autoPauseAfterS', 10, 'longStopAskMin', 10, 'longStopAutoStopMin', 30, 'trimTailMin', 2),
    'antiCheat', jsonb_build_object('dailyRunLimit', 20, 'minPaceMin', 3, 'vehicleKmh', 25, 'vehicleS', 30, 'severeKmh', 20, 'severeS', 120,
                                    'highKmh', 17, 'highS', 180, 'spikeKmh', 43, 'spikeMax', 3, 'autoApproveMaxScore', 34),
    'content', jsonb_build_object('enterprise', jsonb_build_object(
      'title', 'Phong trào chạy bộ cho cả tổ chức',
      'subtitle', 'Chiến dịch, bảng xếp hạng phòng ban, quản lý nhiều CLB và báo cáo cho nhân sự — tự động từ Strava và GPS, không cần bảng tính.',
      'features', jsonb_build_array(
        jsonb_build_object('title', 'Chiến dịch sức khoẻ', 'text', 'Tạo chiến dịch theo tổng km, số buổi hoặc số ngày chạy; mục tiêu chung cả tổ chức và mục tiêu mỗi người.'),
        jsonb_build_object('title', 'Xếp hạng theo đơn vị', 'text', 'Phòng ban, chi nhánh, lớp hoặc CLB thi đua với nhau — tính cả tổng và bình quân đầu người cho công bằng.'),
        jsonb_build_object('title', 'Quản lý nhiều CLB', 'text', 'Liên đoàn mời CLB tham gia; thành viên CLB tự được tính vào chiến dịch. Có thể tài trợ CLB Pro cho cả hệ thống.'),
        jsonb_build_object('title', 'Báo cáo cho nhân sự', 'text', 'km, số buổi, số ngày chạy của từng người theo khoảng ngày; mã nhân viên, đơn vị; xuất Excel.'),
        jsonb_build_object('title', 'Thương hiệu riêng', 'text', 'Logo, ảnh bìa, màu chủ đề, khẩu hiệu; bảng tin nội bộ như một CLB lớn; chứng nhận hoàn thành thiết kế theo mẫu công ty.'),
        jsonb_build_object('title', 'Quản lý như phòng nhân sự', 'text', 'Tự duyệt theo email công ty, nhập danh sách từ Excel, đơn vị nhiều cấp, trưởng đơn vị tự quản lý người của mình.'),
        jsonb_build_object('title', 'Trao giải minh bạch', 'text', 'Chốt kết quả, duyệt top trước khi trao, ngày hội ×2 / ×3, quay thưởng may mắn có mã kiểm chứng.'),
        jsonb_build_object('title', 'Chống gian lận, tôn trọng riêng tư', 'text', 'Chỉ tính bài chạy hợp lệ (GPS, pace, duyệt); người chạy tắt chia sẻ bài nào thì bài đó không vào bảng.'))),
      'plans', private.plan_content_defaults()))
$$;


create or replace function private.valid_ops(c jsonb) returns boolean
language sql immutable as $$
  select private.ops_num_ok(c, 'tracking', 'autoPauseAfterS', 5, 60)
     and private.ops_num_ok(c, 'tracking', 'longStopAskMin', 3, 60)
     and private.ops_num_ok(c, 'tracking', 'longStopAutoStopMin', 10, 240)
     and private.ops_num_ok(c, 'tracking', 'trimTailMin', 1, 30)
     and (c->'tracking'->>'longStopAutoStopMin')::numeric > (c->'tracking'->>'longStopAskMin')::numeric
     and private.ops_num_ok(c, 'antiCheat', 'dailyRunLimit', 3, 100)
     and private.ops_num_ok(c, 'antiCheat', 'minPaceMin', 2, 5)
     and private.ops_num_ok(c, 'antiCheat', 'vehicleKmh', 20, 60)
     and private.ops_num_ok(c, 'antiCheat', 'vehicleS', 10, 600)
     and private.ops_num_ok(c, 'antiCheat', 'severeKmh', 15, 40)
     and private.ops_num_ok(c, 'antiCheat', 'severeS', 30, 1800)
     and private.ops_num_ok(c, 'antiCheat', 'highKmh', 12, 35)
     and private.ops_num_ok(c, 'antiCheat', 'highS', 30, 3600)
     and private.ops_num_ok(c, 'antiCheat', 'spikeKmh', 30, 150)
     and private.ops_num_ok(c, 'antiCheat', 'spikeMax', 1, 100)
     and private.ops_num_ok(c, 'antiCheat', 'autoApproveMaxScore', 0, 100)
     and (c->'antiCheat'->>'highKmh')::numeric < (c->'antiCheat'->>'severeKmh')::numeric
     and (c->'antiCheat'->>'severeKmh')::numeric < (c->'antiCheat'->>'vehicleKmh')::numeric
     and not exists (select 1 from jsonb_each(c->'features') f where jsonb_typeof(f.value) <> 'boolean')
     and jsonb_typeof(c->'content'->'enterprise') = 'object'
     and char_length(coalesce(c->'content'->'enterprise'->>'title', '')) between 3 and 90
     and char_length(coalesce(c->'content'->'enterprise'->>'subtitle', '')) <= 400
     and jsonb_typeof(c->'content'->'enterprise'->'features') = 'array'
     and jsonb_array_length(c->'content'->'enterprise'->'features') between 1 and 12
     and not exists (select 1 from jsonb_array_elements(c->'content'->'enterprise'->'features') f
                      where char_length(coalesce(f->>'title', '')) not between 2 and 60 or char_length(coalesce(f->>'text', '')) > 300)
     and private.valid_plan_content(c->'content'->'plans')
$$;


-- ---------------------------------------------------------------------
-- 2. Lời báo cho người chạy (không lộ ngưỡng) theo dấu hiệu
-- ---------------------------------------------------------------------
create or replace function private.friendly_review(p_flags jsonb, p_reason text) returns text
language sql immutable as $$
  select case
    when exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_flags) = 'array' then p_flags else '[]'::jsonb end) f
                  where f->>'code' in ('VEHICLE_BURST', 'SUSTAINED_SPEED', 'STRIDE', 'HR_PACE', 'GPS_TELEPORT'))
         or coalesce(p_reason, '') ~ '(Pace trung bình nhanh|giống đi xe|Giữ tốc độ|nhảy xa)'
      then 'Một số đoạn trong bài có tốc độ khác với chạy bộ nên cần được xác minh trước khi cộng thành tích.'
    when exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_flags) = 'array' then p_flags else '[]'::jsonb end) f where f->>'code' = 'GPS_GAP')
         or coalesce(p_reason, '') ~ 'Mất tín hiệu GPS'
      then 'Một đoạn dài bị mất tín hiệu GPS nên chưa xác nhận được quãng đường. Bạn có thể chọn chỉ tính phần có GPS, hoặc chờ xác minh.'
    when coalesce(p_reason, '') ~ 'không có dữ liệu GPS'
      then 'Bài chạy không có dữ liệu vị trí nên cần được xác minh.'
    when coalesce(p_reason, '') ~ 'lệch nhiều'
      then 'Quãng đường chưa khớp với tuyến GPS nên cần được xác minh.'
    else 'Bài chạy cần được xác minh trước khi cộng thành tích.' end
$$;

-- ---------------------------------------------------------------------
-- 3. Trigger trước khi lưu bài: chỉ tự duyệt mức thấp khi không thi đấu; viết lại lời báo
-- ---------------------------------------------------------------------
create or replace function private.activity_review_scope() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.validation_status = 'PENDING' and not coalesce(new.is_manual, false) and new.user_id is not null and new.started_at is not null then
    new.review_detail := coalesce(new.review_detail, new.validation_reason);
    if coalesce(new.risk_score, 0) <= coalesce((private.ops_config()->'antiCheat'->>'autoApproveMaxScore')::numeric, 34)
       and not private.in_competition(new.user_id, new.started_at) then
      new.validation_status := 'APPROVED';
      if new.status = 'PROCESSING' then new.status := 'READY'; end if;
      new.review_skipped := true;
      new.validation_reason := null;
    else
      new.validation_reason := private.friendly_review(new.risk_flags, new.validation_reason);
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 4. Người chạy: xem lựa chọn + "Chỉ tính phần có GPS"
-- ---------------------------------------------------------------------
create or replace function private.gap_meters(p_flags jsonb) returns numeric
language sql immutable as $$
  select coalesce(sum((f->>'meters')::numeric), 0) from jsonb_array_elements(case when jsonb_typeof(p_flags) = 'array' then p_flags else '[]'::jsonb end) f
   where f->>'code' = 'GPS_GAP'
$$;
create or replace function private.gap_seconds(p_flags jsonb) returns numeric
language sql immutable as $$
  select coalesce(sum((f->>'durationS')::numeric), 0) from jsonb_array_elements(case when jsonb_typeof(p_flags) = 'array' then p_flags else '[]'::jsonb end) f
   where f->>'code' = 'GPS_GAP'
$$;

/** Chỉ được "tính phần có GPS" khi lý do duy nhất là mất tín hiệu (không có dấu hiệu tốc độ bất thường) */
create or replace function private.can_accept_verified(a public.activities) returns boolean
language sql stable security definer set search_path = public as $$
  select a.validation_status = 'PENDING' and coalesce(a.status, '') <> 'DELETED'
     and private.gap_meters(a.risk_flags) > 0 and coalesce(a.risk_score, 0) < 65
     and not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(a.risk_flags) = 'array' then a.risk_flags else '[]'::jsonb end) f
                      where f->>'code' <> 'GPS_GAP' and f->>'severity' in ('HIGH', 'SEVERE'))
$$;

create or replace function public.activity_review_info(p_activity uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a public.activities := (select x from public.activities x where x.id = p_activity);
begin
  if a.id is null or a.user_id is distinct from auth.uid() then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object('status', a.validation_status, 'reason', a.validation_reason,
    'can_accept_verified', private.can_accept_verified(a),
    'gap_distance_m', round(private.gap_meters(a.risk_flags)),
    'verified_distance_m', greatest(round(coalesce(a.distance_m, 0) - private.gap_meters(a.risk_flags)), 0));
end $$;

create or replace function public.accept_verified_distance(p_activity uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  a public.activities := (select x from public.activities x where x.id = p_activity for update);
  v_gap numeric;
  v_dist numeric;
  v_moving integer;
begin
  if a.id is null or a.user_id <> v_uid then raise exception 'FORBIDDEN'; end if;
  if not private.can_accept_verified(a) then raise exception 'NOT_ELIGIBLE'; end if;
  v_gap := private.gap_meters(a.risk_flags);
  v_dist := greatest(round(coalesce(a.distance_m, 0) - v_gap), 0);
  v_moving := greatest(coalesce(a.moving_time_s, 0) - round(private.gap_seconds(a.risk_flags))::int, 0);
  if v_dist < 200 then
    update public.activities set validation_status = 'REJECTED', status = 'REJECTED', updated_at = now(),
           review_detail = coalesce(review_detail, validation_reason),
           validation_reason = 'Quãng đường có GPS dưới 200 m.'
     where id = a.id;
  else
    update public.activities set distance_m = v_dist, moving_distance_m = v_dist, moving_time_s = v_moving,
           avg_pace_s = case when v_moving > 0 then round(v_moving / (v_dist / 1000.0)) else avg_pace_s end,
           review_detail = coalesce(review_detail, validation_reason),
           validation_reason = 'Chỉ tính phần có GPS.',
           validation_status = 'APPROVED', status = 'READY', updated_at = now()
     where id = a.id;                                   -- APPROVED → trigger thưởng Xu / XP như khi duyệt
  end if;
  return (select jsonb_build_object('status', x.validation_status, 'reason', x.validation_reason, 'distance_m', x.distance_m,
                                    'earned_xu', coalesce(x.earned_xu, 0), 'earned_xp', coalesce(x.earned_xp, 0))
            from public.activities x where x.id = a.id);
end $$;

-- ---------------------------------------------------------------------
-- 5. Người duyệt thấy chi tiết kỹ thuật
-- ---------------------------------------------------------------------
create or replace function public.club_pending_activities(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.club_is_staff(p_club_id) and not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'title', a.title, 'distance_m', a.distance_m, 'moving_time_s', a.moving_time_s,
      'started_at', a.started_at, 'created_at', a.created_at, 'source', a.source,
      'validation_reason', coalesce(a.review_detail, a.validation_reason), 'risk_score', a.risk_score, 'risk_level', a.risk_level, 'risk_flags', a.risk_flags,
      'user_id', a.user_id, 'can_review', a.user_id <> auth.uid(),
      'profiles', jsonb_build_object('display_name', pr.display_name, 'avatar_url', pr.avatar_url))
      order by a.created_at desc), '[]'::jsonb)
    from public.activities a
    join public.club_members m on m.user_id = a.user_id and m.club_id = p_club_id and m.status = 'APPROVED'
    join public.profiles pr on pr.id = a.user_id
   where a.validation_status = 'PENDING' and coalesce(a.status, '') <> 'DELETED'
     and (a.shared or public.is_system_admin()));
end $$;

revoke all on function private.friendly_review(jsonb, text), private.gap_meters(jsonb), private.gap_seconds(jsonb),
  private.can_accept_verified(public.activities), private.activity_review_scope() from public, anon, authenticated;
revoke all on function public.activity_review_info(uuid), public.accept_verified_distance(uuid), public.club_pending_activities(uuid) from public, anon;
grant execute on function public.activity_review_info(uuid), public.accept_verified_distance(uuid), public.club_pending_activities(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001009800_anticheat_all_runs.sql
-- ===================================================================
-- 009800: CHỐNG GIAN LẬN CHO MỌI BÀI CHẠY — bỏ hẳn ngoại lệ "không thi đấu thì tự duyệt" (008500 / 009700).
-- Bài chạy nào cũng được cộng Xu / XP, nên bài nào cũng phải qua cùng một bộ kiểm tra, có thi đấu hay không:
--   • Bài có dấu hiệu nghi vấn → chờ xác minh, chưa cộng Xu / XP / BXH / điểm CLB, cho tới khi được duyệt.
--   • antiCheat.autoApproveMaxScore mặc định 0 (không tự duyệt bài nghi vấn nào). Admin có thể nâng nếu muốn nới —
--     áp như nhau cho mọi người, không còn phụ thuộc có tham gia thử thách hay không.
--   • Lời báo cho người chạy rút còn một câu ngắn, trung tính.
-- Cần 009700. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create or replace function private.ops_defaults() returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'features', jsonb_build_object('nearby', true, 'market', true, 'bibMarket', true, 'knowledge', true, 'races', true, 'cups', true, 'orgs', true),
    'tracking', jsonb_build_object('autoPauseAfterS', 10, 'longStopAskMin', 10, 'longStopAutoStopMin', 30, 'trimTailMin', 2),
    'antiCheat', jsonb_build_object('dailyRunLimit', 20, 'minPaceMin', 3, 'vehicleKmh', 25, 'vehicleS', 30, 'severeKmh', 20, 'severeS', 120,
                                    'highKmh', 17, 'highS', 180, 'spikeKmh', 43, 'spikeMax', 3, 'autoApproveMaxScore', 0),
    'content', jsonb_build_object('enterprise', jsonb_build_object(
      'title', 'Phong trào chạy bộ cho cả tổ chức',
      'subtitle', 'Chiến dịch, bảng xếp hạng phòng ban, quản lý nhiều CLB và báo cáo cho nhân sự — tự động từ Strava và GPS, không cần bảng tính.',
      'features', jsonb_build_array(
        jsonb_build_object('title', 'Chiến dịch sức khoẻ', 'text', 'Tạo chiến dịch theo tổng km, số buổi hoặc số ngày chạy; mục tiêu chung cả tổ chức và mục tiêu mỗi người.'),
        jsonb_build_object('title', 'Xếp hạng theo đơn vị', 'text', 'Phòng ban, chi nhánh, lớp hoặc CLB thi đua với nhau — tính cả tổng và bình quân đầu người cho công bằng.'),
        jsonb_build_object('title', 'Quản lý nhiều CLB', 'text', 'Liên đoàn mời CLB tham gia; thành viên CLB tự được tính vào chiến dịch. Có thể tài trợ CLB Pro cho cả hệ thống.'),
        jsonb_build_object('title', 'Báo cáo cho nhân sự', 'text', 'km, số buổi, số ngày chạy của từng người theo khoảng ngày; mã nhân viên, đơn vị; xuất Excel.'),
        jsonb_build_object('title', 'Thương hiệu riêng', 'text', 'Logo, ảnh bìa, màu chủ đề, khẩu hiệu; bảng tin nội bộ như một CLB lớn; chứng nhận hoàn thành thiết kế theo mẫu công ty.'),
        jsonb_build_object('title', 'Quản lý như phòng nhân sự', 'text', 'Tự duyệt theo email công ty, nhập danh sách từ Excel, đơn vị nhiều cấp, trưởng đơn vị tự quản lý người của mình.'),
        jsonb_build_object('title', 'Trao giải minh bạch', 'text', 'Chốt kết quả, duyệt top trước khi trao, ngày hội ×2 / ×3, quay thưởng may mắn có mã kiểm chứng.'),
        jsonb_build_object('title', 'Chống gian lận, tôn trọng riêng tư', 'text', 'Chỉ tính bài chạy hợp lệ (GPS, pace, duyệt); người chạy tắt chia sẻ bài nào thì bài đó không vào bảng.'))),
      'plans', private.plan_content_defaults()))
$$;


create or replace function private.activity_review_scope() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.validation_status = 'PENDING' and not coalesce(new.is_manual, false) and new.user_id is not null and new.started_at is not null then
    new.review_detail := coalesce(new.review_detail, new.validation_reason);
    if coalesce(new.risk_score, 0) <= coalesce((private.ops_config()->'antiCheat'->>'autoApproveMaxScore')::numeric, 0) and coalesce(new.risk_score, 0) > 0 then
      new.validation_status := 'APPROVED';
      if new.status = 'PROCESSING' then new.status := 'READY'; end if;
      new.review_skipped := true;
      new.validation_reason := null;
    else
      new.validation_reason := private.friendly_review(new.risk_flags, new.validation_reason);
    end if;
  end if;
  return new;
end $$;

-- Lời báo ngắn cho người chạy
create or replace function private.friendly_review(p_flags jsonb, p_reason text) returns text
language sql immutable as $$
  select case
    when exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_flags) = 'array' then p_flags else '[]'::jsonb end) f
                  where f->>'code' in ('VEHICLE_BURST', 'SUSTAINED_SPEED', 'STRIDE', 'HR_PACE', 'GPS_TELEPORT'))
         or coalesce(p_reason, '') ~ '(Pace trung bình nhanh|giống đi xe|Giữ tốc độ|nhảy xa)'
      then 'Tốc độ có đoạn bất thường.'
    when exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_flags) = 'array' then p_flags else '[]'::jsonb end) f where f->>'code' = 'GPS_GAP')
         or coalesce(p_reason, '') ~ 'Mất tín hiệu GPS'
      then 'Mất tín hiệu GPS một đoạn.'
    when coalesce(p_reason, '') ~ 'không có dữ liệu GPS' then 'Thiếu dữ liệu GPS.'
    when coalesce(p_reason, '') ~ 'lệch nhiều' then 'Quãng đường chưa khớp tuyến GPS.'
    else null end
$$;

-- Điều khoản / trang menu: câu chữ theo chính sách mới (chỉ khi admin chưa tự sửa trang)
update public.help_pages
   set body = replace(replace(replace(body,
         '- Bài chạy thường ngày được **ghi nhận tự động**. Khi bạn **tham gia thử thách, giải chạy hoặc chiến dịch**, bài có dấu hiệu bất thường sẽ chờ Ban tổ chức / ban quản trị CLB duyệt, có thể bị từ chối và phần thưởng liên quan có thể bị thu hồi.',
         '- Mọi bài chạy đều được hệ thống kiểm tra. Bài có dấu hiệu bất thường sẽ chờ xác minh trước khi cộng Xu, XP và thành tích, có thể bị từ chối và phần thưởng liên quan có thể bị thu hồi.'),
         E'- Bài có dấu hiệu bất thường được tự duyệt lúc bạn không thi đấu thì không được tính vào thử thách / giải về sau.\n', ''),
         'Chống gian lận trong thử thách, giải chạy và chiến dịch', 'Chống gian lận cho mọi bài chạy')
 where updated_by is null and (body like '%ghi nhận tự động%' or body like '%Chống gian lận trong thử thách%');

revoke all on function private.ops_defaults(), private.activity_review_scope(), private.friendly_review(jsonb, text) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001009900_overlap_runs.sql
-- ===================================================================
-- 009900: MỘT TÀI KHOẢN — MỖI THỜI ĐIỂM CHỈ TÍNH MỘT BÀI CHẠY
-- Trường hợp cần xử lý: một tài khoản bật ghi trên nhiều thiết bị (dùng chung tài khoản, hoặc một người mang 2 máy),
-- ví dụ máy A chạy 2 giờ, trong khung giờ đó máy B cũng ghi vài bài ngắn hơn.
--   • Hai bài "trùng giờ" khi phần thời gian chồng nhau > 60 giây (chừa lệch đồng hồ giữa các máy).
--   • Chỉ bài DÀI NHẤT được tính: bài mới dài hơn tổng các bài trùng giờ đang được tính trên 10% → bài mới được tính, các bài
--     cũ chuyển "Không ghi nhận", thu hồi Xu / XP / nhiệm vụ / thử thách đã cộng. Ngược lại bài mới được lưu nhưng không tính.
--   • Bài mới nghi vấn (đang chờ xác minh) không được thay bài đã tính.
--   • Trước đây bài dài gửi sau bị báo "đã lưu" rồi mất; nay bài vẫn nằm trong lịch sử, ghi rõ lý do.
--   • Hai máy gửi CÙNG LÚC: khóa theo tài khoản trong lúc chèn, nên không còn lọt cả hai bài.
--   • Gửi lại đúng bài cũ (mạng chập chờn): vẫn báo ACTIVITY_DUPLICATE, không tạo bài mới.
-- Áp cho mọi đường ghi bài (GPS trong app, Strava / Garmin / COROS) qua trigger trước khi chèn.
-- Cần 009800. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

-- Quãng đường dùng để so bài (như khi tính thưởng)
create or replace function private.activity_meters(p_moving numeric, p_distance numeric) returns numeric
language sql immutable set search_path = public as $$
  select greatest(coalesce(nullif(p_moving, 0), p_distance, 0), 0)
$$;

-- Bài đang được tính (đã duyệt hoặc chờ xác minh) của một người, chồng giờ > 60 giây với [p_start, p_end]
create or replace function private.overlap_ids(p_user uuid, p_start timestamptz, p_end timestamptz, p_except uuid default null) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(x.id order by x.started_at), '{}')
    from public.activities x
   where x.user_id = p_user and x.id is distinct from p_except
     and coalesce(x.status, '') not in ('DELETED', 'REJECTED') and coalesce(x.validation_status, '') <> 'REJECTED'
     and x.started_at < p_end and coalesce(x.ended_at, x.started_at) > p_start
     and least(coalesce(x.ended_at, x.started_at), p_end) - greatest(x.started_at, p_start) > interval '60 seconds'
$$;

create or replace function private.overlap_meters(p_ids uuid[]) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(private.activity_meters(x.moving_distance_m, x.distance_m)), 0) from public.activities x where x.id = any(p_ids)
$$;

-- Thu hồi thưởng km (Xu + XP) của một bài đã thưởng. Nhiệm vụ / huy hiệu / điểm danh do trg_game_on_run_removed thu hồi
-- khi bài chuyển REJECTED; thử thách do trg_challenge_progress tính lại.
create or replace function private.revoke_run_reward(p_activity uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.activities := (select x from public.activities x where x.id = p_activity for update);
begin
  if a.id is null or a.rewarded_at is null then return; end if;
  if coalesce(a.earned_xu, 0) > 0 then
    perform private.ledger_post('RUN_REWARD_REVERSAL', 'run_reward_reversal:' || a.id, p_reason, a.user_id,
      jsonb_build_array(
        jsonb_build_object('account_id', a.user_id, 'coin_kind', 'BONUS', 'amount', -a.earned_xu),
        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', a.earned_xu)),
      a.id, true);
  end if;
  if coalesce(a.earned_xp, 0) > 0 then
    update public.profiles
       set xp = greatest(coalesce(xp, 0) - a.earned_xp, 0), level = private.level_for_xp(greatest(coalesce(xp, 0) - a.earned_xp, 0))
     where id = a.user_id;
  end if;
  update public.activities set earned_xu = 0, earned_xp = 0 where id = a.id;
end $$;

-- Chạy TRƯỚC khi chèn, sau trg_aa_activity_shared và trg_ab_activity_review_scope (đã biết bài có nghi vấn hay không)
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

  -- Ngược lại: lưu bài mới vào lịch sử nhưng không tính
  new.review_detail := left('Trùng giờ với ' || array_to_string(v_ids, ', ') || ' (' || round(v_old / 1000.0, 2) || ' km đang được tính)'
                            || coalesce(' · ' || new.review_detail, '') || '.', 500);
  new.validation_status := 'REJECTED';
  new.status := 'REJECTED';
  new.validation_reason := 'Trùng giờ với bài chạy khác.';
  return new;
end $$;

drop trigger if exists trg_ac_activity_overlap on public.activities;
create trigger trg_ac_activity_overlap before insert on public.activities
  for each row execute function private.activity_overlap_guard();

revoke all on function private.activity_meters(numeric, numeric), private.overlap_ids(uuid, timestamptz, timestamptz, uuid),
  private.overlap_meters(uuid[]), private.revoke_run_reward(uuid, text), private.activity_overlap_guard() from public, anon, authenticated;

-- Strava / Garmin / COROS: bản 002400, chỉ đổi bước bỏ qua bài trùng giờ
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
  v_pace := round(v_moving / (v_distance / 1000.0));

  -- Cùng một buổi chạy đã được ghi từ nguồn khác (vd GPS trong app) → không tính 2 lần.
  -- 009900: trừ khi bài này dài hơn hẳn các bài trùng giờ đang được tính (vd đồng hồ ghi đủ 2 giờ, điện thoại chỉ ghi một đoạn)
  if exists (select 1 from public.activities
              where user_id = p_user_id and coalesce(status, '') <> 'DELETED'
                and started_at < v_ended and coalesce(ended_at, started_at) > v_started)
     and v_distance <= 1.1 * private.overlap_meters(private.overlap_ids(p_user_id, v_started, v_ended)) then
    return jsonb_build_object('result', 'SKIPPED', 'reason', 'OVERLAPS_EXISTING_ACTIVITY');
  end if;

  -- Luật hợp lệ
  -- Chỉ bài NGHI GIAN LẬN mới chờ duyệt; bài chạy chậm / đi bộ vẫn được ghi nhận ngay (thử thách tự lọc theo pace riêng)
  if v_manual then
    v_status := 'PENDING'; v_level := 'HIGH'; v_score := 70;
    v_reason := 'Bài nhập tay — không có dữ liệu thiết bị (GPS, thời gian thực) để xác minh.';
  elsif v_sport = 'VirtualRun' then
    v_status := 'PENDING'; v_level := 'MEDIUM'; v_score := 40;
    v_reason := 'Chạy máy / chạy ảo — không có tuyến GPS để đối chiếu quãng đường.';
  elsif not v_has_gps then
    v_status := 'PENDING'; v_level := 'MEDIUM'; v_score := 40;
    v_reason := 'Bài không có tuyến GPS — không đối chiếu được quãng đường.';
  elsif v_pace < (cfg->>'minValidPace')::numeric * 60 then
    v_status := 'PENDING'; v_level := 'HIGH'; v_score := 75;
    v_reason := 'Pace trung bình ' || (v_pace / 60) || ':' || lpad((v_pace % 60)::text, 2, '0') || '/km — nhanh hơn kỷ lục thế giới.';
  elsif v_max_speed is not null and v_max_speed > 12 then
    v_status := 'PENDING'; v_level := 'HIGH'; v_score := 70;
    v_reason := 'Vận tốc tối đa ' || round(v_max_speed * 3.6) || ' km/h — vượt khả năng chạy bộ (> 43 km/h).';
  end if;
  -- Bộ phân tích gian lận (máy chủ ứng dụng, xem features/activity/model/fraud.ts) → chờ ban quản trị xác minh
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
  insert into public.activities (
    id, user_id, title, source, source_activity_id, sport_type, started_at, ended_at,
    elapsed_time_s, moving_time_s, distance_m, moving_distance_m, avg_pace_s,
    avg_speed_mps, max_speed_mps, avg_heartrate, elevation_gain_m, is_manual, device_name,
    status, validation_status, validation_reason, rewarded_at, earned_xu, earned_xp,
    risk_score, risk_level, risk_flags)
  values (
    v_id, p_user_id, left(coalesce(nullif(trim(p_activity->>'title'), ''), 'Buổi chạy'), 120), p_source, p_external_id, v_sport,
    v_started, v_ended, v_elapsed, v_moving, v_distance, v_distance, v_pace,
    (p_activity->>'avg_speed_mps')::numeric, v_max_speed, (p_activity->>'avg_heartrate')::numeric,
    coalesce((p_activity->>'elevation_gain_m')::numeric, 0), v_manual, left(p_activity->>'device_name', 80),
    case v_status when 'APPROVED' then 'READY' else 'PROCESSING' end, v_status,
    case when v_history_only then v_reason || ' Bài chạy trước khi kết nối — chỉ lưu lịch sử.' else v_reason end,
    case when v_history_only then now() end,
    case when v_history_only then 0 end,
    case when v_history_only then 0 end,
    case when v_status = 'PENDING' then v_score else (v_risk->>'score')::int end,
    case when v_status = 'PENDING' then v_level else v_risk->>'level' end, v_risk->'flags')
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

-- GPS trong app: bản 009100, chỉ đổi bước chặn trùng
create or replace function public.submit_and_process_activity(
  p_title text, p_source text, p_started_at timestamptz, p_ended_at timestamptz,
  p_elapsed_s integer, p_moving_s integer, p_distance_m numeric, p_avg_pace_s integer, p_track_points jsonb
) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := private.require_uid();
  cfg jsonb := private.economy_config();
  -- 009100: ngưỡng chống gian lận do admin đặt (Quản trị → Hệ thống → Chính sách vận hành)
  ac jsonb := private.ops_config()->'antiCheat';
  v_pace_min integer := round((private.ops_config()->'antiCheat'->>'minPaceMin')::numeric * 60);
  v_points jsonb := coalesce(p_track_points, '[]'::jsonb);
  v_n integer;
  v_gps_m numeric := 0;
  -- Quãng đường theo app (đã kẹp) + từng km
  v_trk_m numeric := 0;
  v_cd numeric;
  v_cd_prev numeric;
  v_step numeric;
  v_seg_t numeric;
  v_sd numeric := 0;
  v_st numeric := 0;
  v_over numeric;
  v_over_t numeric;
  v_alt0 numeric;
  v_splits jsonb := '[]'::jsonb;
  v_spikes integer := 0;
  v_prev jsonb;
  v_p jsonb;
  v_seg numeric;
  v_dt numeric;
  v_distance numeric;
  v_moving integer;
  v_pace integer;
  v_status text := 'APPROVED';
  v_reason text := 'Hoạt động hợp lệ qua kiểm tra tự động.';
  v_activity uuid;
  v_seq integer := 0;
  v_reward jsonb;
  -- Tốc độ duy trì (quãng đường trong cửa sổ 30 s) — cùng luật với features/activity/model/fraud.ts
  v_t numeric[] := '{}';
  v_c numeric[] := '{}';
  v_t0 timestamptz;
  v_i integer; v_j integer := 1; v_w numeric; v_sp numeric;
  v_run_sev numeric; v_run_nor numeric; v_run_veh numeric;
  v_sev numeric := 0; v_nor numeric := 0; v_veh numeric := 0;
  v_flags jsonb := '[]'::jsonb;
  -- Mất tín hiệu GPS: đoạn > 60 giây và > 150 m giữa hai điểm liên tiếp (tắt màn hình, hầm…) = tuyến bị nối thẳng
  v_gaps integer := 0;
  v_gap_s numeric := 0;
  v_gap_m numeric := 0;
  v_score integer := 0;
begin
  -- Kiểm tra đầu vào cơ bản
  if p_started_at is null or p_ended_at is null or p_ended_at <= p_started_at then raise exception 'INVALID_TIME_RANGE'; end if;
  if p_started_at > now() + interval '5 minutes' then raise exception 'INVALID_TIME_RANGE'; end if;
  if p_ended_at - p_started_at > interval '24 hours' then raise exception 'ACTIVITY_TOO_LONG'; end if;
  if jsonb_typeof(v_points) <> 'array' then raise exception 'INVALID_TRACK_POINTS'; end if;
  v_n := jsonb_array_length(v_points);
  if v_n > 20000 then raise exception 'TOO_MANY_TRACK_POINTS'; end if;

  -- 009900: bài trùng giờ với bài khác do trigger trg_ac_activity_overlap xử lý (chỉ tính bài dài nhất);
  -- ở đây chỉ chặn gửi lại đúng bài cũ
  if exists (select 1 from public.activities
              where user_id = v_uid and source_activity_id is null
                and started_at = p_started_at and ended_at = p_ended_at) then
    raise exception 'ACTIVITY_DUPLICATE';
  end if;
  if (select count(*) from public.activities where user_id = v_uid and created_at > now() - interval '1 day') >= (ac->>'dailyRunLimit')::int then
    raise exception 'RATE_LIMITED';
  end if;

  -- Tính lại quãng đường từ GPS (không tin số client gửi)
  for v_p in select value from jsonb_array_elements(v_points) loop
    v_cd := case when jsonb_typeof(v_p->'distance_m') = 'number' then (v_p->>'distance_m')::numeric end;
    if v_prev is null then v_alt0 := case when jsonb_typeof(v_p->'altitude') = 'number' then (v_p->>'altitude')::numeric end; end if;
    if v_prev is not null then
      v_seg := private.haversine_m((v_prev->>'latitude')::numeric, (v_prev->>'longitude')::numeric,
                                   (v_p->>'latitude')::numeric, (v_p->>'longitude')::numeric);
      v_dt := extract(epoch from ((v_p->>'recorded_at')::timestamptz - (v_prev->>'recorded_at')::timestamptz));
      if v_dt > 0 and v_seg / v_dt > (ac->>'spikeKmh')::numeric / 3.6 then v_spikes := v_spikes + 1; end if;
      if v_dt > 60 and v_seg > 150 then v_gaps := v_gaps + 1; v_gap_s := v_gap_s + v_dt; v_gap_m := v_gap_m + v_seg; end if;
      v_gps_m := v_gps_m + coalesce(v_seg, 0);
      -- Đoạn theo app: có distance_m ở cả hai điểm → dùng, kẹp [0, 1,1 × đoạn thẳng + 3 m]; thiếu → đoạn thẳng
      v_step := case when v_cd is not null and v_cd_prev is not null
                     then least(greatest(v_cd - v_cd_prev, 0), 1.1 * coalesce(v_seg, 0) + 3)
                     else coalesce(v_seg, 0) end;
      v_trk_m := v_trk_m + v_step;
      -- Từng km: đoạn ≤ 30 s tính đủ giờ; dài hơn (đứng chờ / mất tín hiệu) chỉ tính phần di chuyển ước lượng ≥ 1,5 m/s
      if v_dt > 0 then
        v_seg_t := case when v_dt <= 30 then v_dt else least(v_dt, v_step / 1.5) end;
        v_sd := v_sd + v_step; v_st := v_st + v_seg_t;
        while v_sd >= 1000 loop
          v_over := v_sd - 1000;
          v_over_t := case when v_step > 0 then v_seg_t * v_over / v_step else 0 end;
          v_splits := v_splits || jsonb_build_object('distance_m', 1000, 'moving_s', greatest(0, round(v_st - v_over_t)),
            'elev_m', case when v_alt0 is not null and jsonb_typeof(v_p->'altitude') = 'number' then round(((v_p->>'altitude')::numeric - v_alt0) * 10) / 10 end,
            'hr', null);
          v_sd := v_over; v_st := v_over_t;
          v_alt0 := case when jsonb_typeof(v_p->'altitude') = 'number' then (v_p->>'altitude')::numeric end;
        end loop;
      end if;
    end if;
    v_cd_prev := v_cd;
    v_t0 := coalesce(v_t0, (v_p->>'recorded_at')::timestamptz, p_started_at);
    v_t := v_t || extract(epoch from (coalesce((v_p->>'recorded_at')::timestamptz, v_t0) - v_t0));
    v_c := v_c || v_trk_m;
    v_prev := v_p;
  end loop;

  -- Đoạn liên tục dài nhất có tốc độ ≥ 20 km/h, ≥ 17 km/h, ≥ 25 km/h
  for v_i in 2 .. coalesce(array_length(v_t, 1), 0) loop
    while v_j < v_i and v_t[v_i] - v_t[v_j] > 30 loop v_j := v_j + 1; end loop;
    v_w := v_t[v_i] - v_t[v_j];
    if v_w < 15 then continue; end if;
    v_sp := (v_c[v_i] - v_c[v_j]) / v_w;
    if v_sp >= (ac->>'severeKmh')::numeric / 3.6 then v_run_sev := coalesce(v_run_sev, v_t[v_j]); v_sev := greatest(v_sev, v_t[v_i] - v_run_sev); else v_run_sev := null; end if;
    if v_sp >= (ac->>'highKmh')::numeric / 3.6 then v_run_nor := coalesce(v_run_nor, v_t[v_j]); v_nor := greatest(v_nor, v_t[v_i] - v_run_nor); else v_run_nor := null; end if;
    if v_sp >= (ac->>'vehicleKmh')::numeric / 3.6 then v_run_veh := coalesce(v_run_veh, v_t[v_j]); v_veh := greatest(v_veh, v_t[v_i] - v_run_veh); else v_run_veh := null; end if;
  end loop;
  if v_veh >= (ac->>'vehicleS')::numeric then
    v_flags := v_flags || jsonb_build_object('code', 'VEHICLE_BURST', 'severity', 'SEVERE', 'durationS', round(v_veh));
    v_score := v_score + 35;
  end if;
  if v_sev >= (ac->>'severeS')::numeric then
    v_flags := v_flags || jsonb_build_object('code', 'SUSTAINED_SPEED', 'severity', 'SEVERE', 'durationS', round(v_sev));
    v_score := v_score + 35;
  elsif v_nor >= (ac->>'highS')::numeric then
    v_flags := v_flags || jsonb_build_object('code', 'SUSTAINED_SPEED', 'severity', 'HIGH', 'durationS', round(v_nor));
    v_score := v_score + 28;
  end if;
  if v_spikes > (ac->>'spikeMax')::int then
    v_flags := v_flags || jsonb_build_object('code', 'GPS_TELEPORT', 'severity', 'HIGH', 'count', v_spikes);
    v_score := v_score + 20;
  end if;

  if v_gaps > 0 then
    v_flags := v_flags || jsonb_build_object('code', 'GPS_GAP', 'severity', case when v_gap_m > greatest(500, 0.25 * v_gps_m) then 'HIGH' else 'INFO' end,
      'count', v_gaps, 'durationS', round(v_gap_s), 'meters', round(v_gap_m));
  end if;
  v_moving := least(greatest(coalesce(p_moving_s, 0), 0), extract(epoch from (p_ended_at - p_started_at))::integer);
  v_distance := case when v_n >= 2 then round(least(v_trk_m, v_gps_m)) else greatest(coalesce(p_distance_m, 0), 0) end;
  v_pace := case when v_distance > 0 then round(v_moving / (v_distance / 1000.0)) else 0 end;

  -- Luật xác thực (xem ADR-007)
  if v_distance < 200 then
    v_status := 'REJECTED'; v_reason := 'Quá ngắn (< 200 m), không đủ điều kiện ghi nhận.';
  elsif v_n < 2 then
    v_status := 'PENDING'; v_score := greatest(v_score, 40);
    v_reason := 'Bài không có dữ liệu GPS — không đối chiếu được quãng đường.';
  elsif v_pace < v_pace_min then
    v_status := 'PENDING'; v_score := greatest(v_score, 75);
    v_reason := 'Pace trung bình nhanh hơn ' || (v_pace_min / 60) || ':' || lpad((v_pace_min % 60)::text, 2, '0') || '/km — vượt khả năng chạy bộ.';
  elsif v_veh >= (ac->>'vehicleS')::numeric then
    v_status := 'PENDING'; v_score := greatest(v_score, 85);
    v_reason := 'Di chuyển ≥ ' || (ac->>'vehicleKmh') || ' km/h liên tục ' || round(v_veh) || ' giây — giống đi xe.';
  elsif v_sev >= (ac->>'severeS')::numeric then
    v_status := 'PENDING'; v_score := greatest(v_score, 70);
    v_reason := 'Giữ tốc độ ≥ ' || (ac->>'severeKmh') || ' km/h liên tục ' || round(v_sev) || ' giây.';
  elsif v_nor >= (ac->>'highS')::numeric then
    v_status := 'PENDING'; v_score := greatest(v_score, 65);
    v_reason := 'Giữ tốc độ ≥ ' || (ac->>'highKmh') || ' km/h liên tục ' || round(v_nor) || ' giây.';
  elsif v_spikes > (ac->>'spikeMax')::int then
    v_status := 'PENDING'; v_score := greatest(v_score, 50);
    v_reason := 'Vị trí GPS nhảy xa bất thường ' || v_spikes || ' lần (> ' || (ac->>'spikeKmh') || ' km/h).';
  elsif v_gap_m > greatest(500, 0.25 * v_gps_m) then
    v_status := 'PENDING'; v_score := greatest(v_score, 40);
    v_reason := 'Mất tín hiệu GPS ' || greatest(1, round(v_gap_s / 60)) || ' phút — ' || round(v_gap_m / 1000.0, 2)
                || ' km được nối thẳng, không đối chiếu được tuyến (thường do tắt màn hình khi ghi bằng trình duyệt).';
  elsif p_distance_m > 0 and abs(p_distance_m - v_distance) > greatest(0.15 * v_distance, 100) then
    v_status := 'PENDING'; v_score := greatest(v_score, 45);
    v_reason := 'Quãng đường app gửi lên lệch nhiều so với tuyến GPS.';
  end if;
  if v_status = 'PENDING' then
    v_reason := left('Mức nghi vấn: ' || private.risk_label(private.risk_level(v_score)) || '. ' || v_reason
                     || ' Bài được tính sau khi ban quản trị CLB hoặc admin xác minh.', 500);
  end if;

  v_activity := gen_random_uuid();
  insert into public.activities (
    id, user_id, title, source, started_at, ended_at, elapsed_time_s, moving_time_s,
    distance_m, moving_distance_m, avg_pace_s, status, validation_status, validation_reason,
    risk_score, risk_level, risk_flags)
  values (
    v_activity, v_uid, left(coalesce(nullif(trim(p_title), ''), 'Buổi chạy'), 120),
    case when p_source in ('DIRECT_GPS', 'STRAVA', 'GARMIN') then p_source else 'DIRECT_GPS' end,
    p_started_at, p_ended_at, greatest(coalesce(p_elapsed_s, 0), v_moving), v_moving,
    v_distance, v_distance, v_pace,
    case v_status when 'APPROVED' then 'READY' when 'PENDING' then 'PROCESSING' else 'REJECTED' end,
    v_status, v_reason,
    least(v_score, 100), private.risk_level(v_score),
    case when jsonb_array_length(v_flags) > 0 then v_flags end);

  -- 008500: ngoài thử thách / giải / chiến dịch, trigger tự duyệt bài nghi vấn → trả về trạng thái thật
  v_status := (select x.validation_status from public.activities x where x.id = v_activity);
  v_reason := (select x.validation_reason from public.activities x where x.id = v_activity);

  for v_p in select value from jsonb_array_elements(v_points) loop
    v_seq := v_seq + 1;
    insert into public.activity_track_points (activity_id, sequence, latitude, longitude, accuracy, altitude, speed, recorded_at, distance_m)
    values (v_activity, v_seq, (v_p->>'latitude')::numeric, (v_p->>'longitude')::numeric,
            (v_p->>'accuracy')::numeric, (v_p->>'altitude')::numeric, (v_p->>'speed')::numeric,
            coalesce((v_p->>'recorded_at')::timestamptz, p_started_at), round(v_c[v_seq], 1));
  end loop;

  -- Từng km (km lẻ cuối ≥ 100 m) — màn chi tiết bài chạy đọc thẳng, khớp quãng đường đã lưu
  if v_n >= 2 then
    if v_sd >= 100 and v_st > 0 then
      v_splits := v_splits || jsonb_build_object('distance_m', round(v_sd), 'moving_s', round(v_st), 'elev_m', null, 'hr', null);
    end if;
    insert into public.activity_details (activity_id, splits, start_lat, start_lng, detailed)
    values (v_activity, v_splits, (v_points->0->>'latitude')::numeric, (v_points->0->>'longitude')::numeric, true)
    on conflict (activity_id) do update set splits = excluded.splits;
  end if;

  if v_status = 'APPROVED' then
    v_reward := (select jsonb_build_object('earned_xu', x.earned_xu, 'earned_xp', x.earned_xp)
                   from public.activities x where x.id = v_activity);         -- trigger trg_auto_reward đã thưởng
  end if;

  return json_build_object(
    'success', true, 'activity_id', v_activity,
    'validation_status', v_status, 'validation_reason', v_reason,
    'distance_m', v_distance,
    'earned_xp', coalesce((v_reward->>'earned_xp')::integer, 0),
    'earned_xu', coalesce((v_reward->>'earned_xu')::numeric, 0));
end $$;

commit;
