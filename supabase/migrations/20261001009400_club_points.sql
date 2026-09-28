-- 009400: ĐIỂM CLB — "đặt luật một lần, hệ thống tự chấm" (học từ Tucana).
-- Ban quản trị CLB (chủ nhiệm + quản trị viên được phân quyền) tự soạn luật: điểm theo mỗi bài chạy hoặc theo km, kèm điều kiện
-- (quãng đường tối thiểu / tối đa, pace, khung giờ, ngày trong tuần, chỉ tính buổi chạy nhóm có điểm danh QR), trần điểm mỗi ngày,
-- nhân hệ số theo "Ngày vàng" (007700). Mỗi lần lưu là một PHIÊN BẢN, chọn áp dụng từ bây giờ / đầu tuần / đầu tháng / mọi bài;
-- bài chạy lúc t được chấm theo phiên bản MỚI NHẤT có hiệu lực tại t. Thành viên xem được luật, lịch sử và vì sao mình được điểm.
-- Điểm tính trực tiếp từ bài chạy hợp lệ + chia sẻ (như BXH km), không lưu riêng → không lệch, sửa luật là BXH tự tính lại.
-- Cần 000500, 001500, 007700. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create table if not exists public.club_point_rules (
  club_id uuid not null references public.clubs(id) on delete cascade,
  version integer not null,
  enabled boolean not null default true,
  rules jsonb not null,
  daily_cap numeric,
  use_boost boolean not null default true,
  valid_from timestamptz not null,
  note text check (note is null or char_length(note) <= 200),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (club_id, version)
);
alter table public.club_point_rules enable row level security;
revoke all on public.club_point_rules from anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Kiểm tra luật
-- ---------------------------------------------------------------------
create or replace function private.num_between(v jsonb, lo numeric, hi numeric, nullable boolean) returns boolean
language sql immutable as $$
  select case when v is null or jsonb_typeof(v) = 'null' then nullable
              when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric between lo and hi
              else false end
$$;

create or replace function private.valid_point_rule(r jsonb) returns boolean
language sql immutable as $$
  select case when jsonb_typeof(r) <> 'object' then false else
       char_length(trim(coalesce(r->>'name', ''))) between 2 and 60
   and coalesce(r->>'per', '') in ('RUN', 'KM')
   and private.num_between(r->'points', 0, case when r->>'per' = 'KM' then 100 else 1000 end, false)
   and private.num_between(r->'min_km', 0, 500, true)
   and private.num_between(r->'max_km', 0, 1000, true)
   and (jsonb_typeof(r->'max_km') is distinct from 'number' or (r->>'max_km')::numeric >= coalesce((r->>'min_km')::numeric, 0))
   and private.num_between(r->'max_pace_s', 150, 1500, true)
   and private.num_between(r->'from_hour', 0, 23, true)
   and private.num_between(r->'to_hour', 1, 24, true)
   and (jsonb_typeof(r->'from_hour') is distinct from 'number' or jsonb_typeof(r->'to_hour') is distinct from 'number'
        or (r->>'from_hour')::numeric < (r->>'to_hour')::numeric)
   and (r->'days' is null or jsonb_typeof(r->'days') = 'null'
        or (jsonb_typeof(r->'days') = 'array'
            and not exists (select 1 from jsonb_array_elements(r->'days') d where jsonb_typeof(d) <> 'number' or (d #>> '{}')::numeric not in (1, 2, 3, 4, 5, 6, 7))))
   and (r->'group_only' is null or jsonb_typeof(r->'group_only') in ('boolean', 'null'))
  end
$$;

/** Chấm một bài: tổng điểm các luật khớp + danh sách luật khớp (để thành viên biết vì sao được điểm) */
create or replace function private.club_score_run(p_rules jsonb, p_km numeric, p_pace integer, p_local timestamp, p_group boolean) returns jsonb
language sql immutable as $$
  select jsonb_build_object('points', coalesce(sum(x.pts), 0),
                            'hits', coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'points', x.pts)) filter (where x.pts > 0), '[]'::jsonb))
    from (select r->>'name' as name,
                 case when p_km >= coalesce((r->>'min_km')::numeric, 0)
                       and (jsonb_typeof(r->'max_km') is distinct from 'number' or p_km <= (r->>'max_km')::numeric)
                       and (jsonb_typeof(r->'max_pace_s') is distinct from 'number' or (coalesce(p_pace, 0) > 0 and p_pace <= (r->>'max_pace_s')::numeric))
                       and (jsonb_typeof(r->'from_hour') is distinct from 'number' or extract(hour from p_local) >= (r->>'from_hour')::numeric)
                       and (jsonb_typeof(r->'to_hour') is distinct from 'number' or extract(hour from p_local) < (r->>'to_hour')::numeric)
                       and (jsonb_typeof(r->'days') is distinct from 'array' or jsonb_array_length(r->'days') = 0
                            or r->'days' @> to_jsonb(extract(isodow from p_local)::int))
                       and (not coalesce((r->>'group_only')::boolean, false) or p_group)
                      then case when r->>'per' = 'KM' then round((r->>'points')::numeric * p_km, 1) else (r->>'points')::numeric end
                      else 0 end as pts
            from jsonb_array_elements(case when jsonb_typeof(p_rules) = 'array' then p_rules else '[]'::jsonb end) r) x
$$;

-- ---------------------------------------------------------------------
-- 2. Chấm điểm các bài chạy của thành viên từ mốc p_from
-- ---------------------------------------------------------------------
create or replace function private.club_point_rows(p_club uuid, p_from timestamptz, p_user uuid default null)
returns table (activity_id uuid, user_id uuid, title text, started_at timestamptz, day date, km numeric,
               is_group boolean, boost numeric, points numeric, hits jsonb, version integer, daily_cap numeric)
language sql stable security definer set search_path = public as $$
  with acts as (
    select a.id, a.user_id, a.title, a.started_at, (a.started_at at time zone 'Asia/Ho_Chi_Minh') as local_at,
           round(coalesce(a.distance_m, 0) / 1000.0, 2) as km,
           coalesce(nullif(a.avg_pace_s, 0), case when coalesce(a.distance_m, 0) > 0 then round(a.moving_time_s / (a.distance_m / 1000.0)) end)::int as pace,
           (select max(r.version) from public.club_point_rules r where r.club_id = p_club and r.valid_from <= a.started_at) as ver
      from public.club_members m
      join public.activities a on a.user_id = m.user_id and a.validation_status = 'APPROVED' and a.shared
       and coalesce(a.status, '') <> 'DELETED' and a.started_at >= p_from
     where m.club_id = p_club and m.status = 'APPROVED' and (p_user is null or m.user_id = p_user)
  ), scored as (
    select x.*, v.rules, v.enabled, v.use_boost, v.daily_cap as cap,
           exists (select 1 from public.club_event_rsvps rv join public.club_events e on e.id = rv.event_id
                    where e.club_id = p_club and rv.user_id = x.user_id and rv.checked_in_at is not null
                      and (rv.activity_id = x.id or (e.starts_at at time zone 'Asia/Ho_Chi_Minh')::date = x.local_at::date)) as grp,
           coalesce((select b.multiplier from public.club_boost_days b where b.club_id = p_club and b.day = x.local_at::date), 1) as mult
      from acts x join public.club_point_rules v on v.club_id = p_club and v.version = x.ver
  )
  select s.id, s.user_id, s.title, s.started_at, s.local_at::date, s.km, s.grp,
         case when s.use_boost then s.mult else 1 end,
         case when s.enabled then round(((private.club_score_run(s.rules, s.km, s.pace, s.local_at, s.grp)->>'points')::numeric)
                                        * case when s.use_boost then s.mult else 1 end, 1) else 0 end,
         case when s.enabled then private.club_score_run(s.rules, s.km, s.pace, s.local_at, s.grp)->'hits' else '[]'::jsonb end,
         s.ver, s.cap
    from scored s
$$;

/** Tổng điểm mỗi người: cộng theo ngày, mỗi ngày không quá trần của phiên bản đang áp dụng */
create or replace function private.club_point_totals(p_club uuid, p_from timestamptz)
returns table (user_id uuid, points numeric, runs integer)
language sql stable security definer set search_path = public as $$
  select d.user_id, sum(d.pts), sum(d.n)::int
    from (select r.user_id, r.day, least(sum(r.points), coalesce(max(r.daily_cap), sum(r.points))) as pts,
                 count(*) filter (where r.points > 0) as n
            from private.club_point_rows(p_club, p_from) r group by r.user_id, r.day) d
   group by d.user_id
$$;

create or replace function private.club_rules_json(r public.club_point_rules) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('version', r.version, 'enabled', r.enabled, 'rules', r.rules, 'daily_cap', r.daily_cap, 'use_boost', r.use_boost,
                            'valid_from', r.valid_from, 'note', r.note, 'created_at', r.created_at, 'by', private.display_name(r.created_by))
$$;

-- ---------------------------------------------------------------------
-- 3. API
-- ---------------------------------------------------------------------
/** Luật đang áp dụng + 10 phiên bản gần nhất (mọi thành viên xem được — minh bạch) */
create or replace function public.club_point_rules_get(p_club uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.club_is_member(p_club) then raise exception 'NOT_A_MEMBER'; end if;
  return jsonb_build_object(
    'can_edit', public.club_is_staff(p_club),
    'current', (select private.club_rules_json(r) from public.club_point_rules r where r.club_id = p_club
                   and r.version = (select max(x.version) from public.club_point_rules x where x.club_id = p_club)),
    'history', coalesce((select jsonb_agg(private.club_rules_json(h) order by h.version desc)
                          from public.club_point_rules h
                         where h.club_id = p_club and h.version > (select max(x.version) - 10 from public.club_point_rules x where x.club_id = p_club)), '[]'::jsonb));
end $$;

/** Ban quản trị lưu luật mới (phiên bản mới). p_apply: NOW | WEEK | MONTH | ALL — tính cho bài chạy từ mốc nào */
create or replace function public.save_club_point_rules(p_club uuid, p jsonb, p_apply text default 'NOW') returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_staff(p_club);
  v_rules jsonb := case when jsonb_typeof(p->'rules') = 'array' then p->'rules' else '[]'::jsonb end;
  v_from timestamptz := case upper(coalesce(p_apply, 'NOW')) when 'WEEK' then private.period_start('WEEK') when 'MONTH' then private.period_start('MONTH')
                              when 'ALL' then '-infinity'::timestamptz else now() end;
  v_next integer;
  v_clean jsonb;
begin
  if upper(coalesce(p_apply, 'NOW')) not in ('NOW', 'WEEK', 'MONTH', 'ALL') then raise exception 'INVALID_APPLY'; end if;
  if jsonb_array_length(v_rules) not between 1 and 12 then raise exception 'INVALID_RULES'; end if;
  if exists (select 1 from jsonb_array_elements(v_rules) r where not private.valid_point_rule(r)) then raise exception 'INVALID_RULES'; end if;
  if not private.num_between(p->'daily_cap', 1, 100000, true) then raise exception 'INVALID_RULES'; end if;
  -- Chỉ giữ khoá đã biết
  v_clean := (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('name', left(trim(r->>'name'), 60), 'per', r->>'per', 'points', (r->>'points')::numeric,
                'min_km', r->'min_km', 'max_km', r->'max_km', 'max_pace_s', r->'max_pace_s', 'from_hour', r->'from_hour', 'to_hour', r->'to_hour',
                'days', case when jsonb_typeof(r->'days') = 'array' and jsonb_array_length(r->'days') > 0 then r->'days' end,
                'group_only', case when coalesce((r->>'group_only')::boolean, false) then true end)) order by o)
                from jsonb_array_elements(v_rules) with ordinality as t(r, o));
  perform pg_advisory_xact_lock(hashtext('club_points:' || p_club));
  v_next := coalesce((select max(r.version) from public.club_point_rules r where r.club_id = p_club), 0) + 1;
  insert into public.club_point_rules (club_id, version, enabled, rules, daily_cap, use_boost, valid_from, note, created_by)
  values (p_club, v_next, coalesce((p->>'enabled')::boolean, true), v_clean,
          case when jsonb_typeof(p->'daily_cap') = 'number' then (p->>'daily_cap')::numeric end,
          coalesce((p->>'use_boost')::boolean, true), v_from, left(nullif(trim(p->>'note'), ''), 200), v_uid);
  -- Báo cả CLB: luật thay đổi là việc chung, ai cũng cần biết
  insert into public.club_posts (club_id, author_id, kind, title, body, meta)
  values (p_club, v_uid, 'ANNOUNCEMENT', 'Cập nhật luật tính điểm CLB (bản ' || v_next || ')',
          'Ban quản trị vừa ' || case when coalesce((p->>'enabled')::boolean, true) then 'cập nhật' else 'tạm tắt' end || ' luật tính điểm CLB, áp dụng cho bài chạy '
          || case upper(coalesce(p_apply, 'NOW')) when 'WEEK' then 'từ đầu tuần này' when 'MONTH' then 'từ đầu tháng này' when 'ALL' then 'từ trước tới nay' else 'từ bây giờ' end
          || '. Xem luật và điểm của bạn ở BXH → Điểm CLB.'
          || coalesce(E'\n\nGhi chú: ' || left(nullif(trim(p->>'note'), ''), 200), ''),
          jsonb_build_object('points_version', v_next));
  return v_next;
end $$;

/** BXH điểm CLB theo tuần / tháng / tất cả */
create or replace function public.club_points_board(p_club uuid, p_period text default 'WEEK') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.club_is_member(p_club) then raise exception 'NOT_A_MEMBER'; end if;
  if upper(coalesce(p_period, '')) not in ('WEEK', 'MONTH', 'ALL') then raise exception 'INVALID_PERIOD'; end if;
  return jsonb_build_object(
    'has_rules', exists (select 1 from public.club_point_rules r where r.club_id = p_club),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('rank', t.rk, 'user_id', t.user_id, 'name', private.display_name(t.user_id),
                                                          'avatar_url', pr.avatar_url, 'points', t.points, 'runs', t.runs, 'me', t.user_id = auth.uid())
                                       order by t.rk, private.display_name(t.user_id))
                       from (select x.*, rank() over (order by x.points desc)::int as rk from private.club_point_totals(p_club, private.period_start(p_period)) x
                              where x.points > 0) t
                       join public.profiles pr on pr.id = t.user_id), '[]'::jsonb));
end $$;

/** Điểm của tôi: từng bài, luật nào khớp, hệ số ngày vàng, bị trần ngày hay không */
create or replace function public.club_points_mine(p_club uuid, p_period text default 'WEEK') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  if not public.club_is_member(p_club) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('activity_id', r.activity_id, 'title', r.title, 'started_at', r.started_at, 'km', r.km,
                                                       'points', r.points, 'hits', r.hits, 'boost', r.boost, 'group', r.is_group, 'version', r.version,
                                                       'daily_cap', r.daily_cap) order by r.started_at desc)
                     from private.club_point_rows(p_club, private.period_start(p_period), v_uid) r), '[]'::jsonb);
end $$;

revoke all on function private.num_between(jsonb, numeric, numeric, boolean), private.valid_point_rule(jsonb),
  private.club_score_run(jsonb, numeric, integer, timestamp, boolean), private.club_point_rows(uuid, timestamptz, uuid),
  private.club_point_totals(uuid, timestamptz), private.club_rules_json(public.club_point_rules) from public, anon, authenticated;
revoke all on function public.club_point_rules_get(uuid), public.save_club_point_rules(uuid, jsonb, text),
  public.club_points_board(uuid, text), public.club_points_mine(uuid, text) from public, anon;
grant execute on function public.club_point_rules_get(uuid), public.save_club_point_rules(uuid, jsonb, text),
  public.club_points_board(uuid, text), public.club_points_mine(uuid, text) to authenticated;

notify pgrst, 'reload schema';
