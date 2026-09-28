-- RaceHub — PHẦN 15/16 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 009500, 009600, 009700
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
           validation_reason = 'Phần có tín hiệu GPS dưới 200 m nên bài không được ghi nhận.'
     where id = a.id;
  else
    update public.activities set distance_m = v_dist, moving_distance_m = v_dist, moving_time_s = v_moving,
           avg_pace_s = case when v_moving > 0 then round(v_moving / (v_dist / 1000.0)) else avg_pace_s end,
           review_detail = coalesce(review_detail, validation_reason),
           validation_reason = 'Chỉ tính phần có tín hiệu GPS (bỏ ' || replace(round(v_gap / 1000.0, 2)::text, '.', ',') || ' km mất tín hiệu).',
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

commit;
