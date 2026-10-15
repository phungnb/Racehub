-- RaceHub — PHẦN 26/28 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 016200, 016300, 016400, 016500, 016600, 016700, 016800
-- Supabase → SQL Editor → New query → dán TOÀN BỘ phần này → Run. Lỗi thì không có gì thay đổi; chạy lại vẫn an toàn.
-- Xong thì chạy phần tiếp theo.
begin;
-- ===================================================================
-- 20261001016200_club_cup_online_league.sql
-- ===================================================================
-- 016200: GIẢI ONLINE "GIAO LƯU CÁC CLB" — bổ sung luật và tính năng còn thiếu cho Thách đấu CLB nhiều CLB.
-- • Bài tối thiểu (min_run_km) và dải pace (min_pace–max_pace, phút/km) áp cho bài tính điểm của giải.
-- • Thành tích hợp lệ: mỗi thành viên chạy tối thiểu member_min_km; CLB chỉ được xếp hạng khi ít nhất min_valid_pct %
--   thành viên đã đăng ký đạt mức đó (CLB không đủ vẫn hiện trên bảng nhưng xếp sau, "eligible" = false, không thể vô địch).
-- • Giới hạn số runner đăng ký thi đấu (max_runners, mặc định giải online: 500 người đăng ký sớm nhất): đủ thì chặn đăng ký mới.
-- • require_club_approval: CLB đăng ký vào giải phải đủ min_roster thành viên và được ban tổ chức duyệt mới được tính (club_cup_entries.approved).
-- • BXH cá nhân trong giải theo km (club_cup_runner_board).
-- • Link form nhận giải (reward_form_url): ban tổ chức dán; người đạt giải (CLB hạng ≤ prize_top_clubs đủ điều kiện, hoặc cá nhân
--   hạng ≤ prize_top_runners, và đạt km hợp lệ) thấy link khi giải kết thúc chính thức.
-- Cần 003600, 011700, 012700. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

alter table public.club_cups add column if not exists min_run_km numeric;
alter table public.club_cups add column if not exists min_pace numeric;
alter table public.club_cups add column if not exists max_pace numeric;
alter table public.club_cups add column if not exists member_min_km numeric;
alter table public.club_cups add column if not exists min_valid_pct integer;
alter table public.club_cups add column if not exists max_runners integer;
alter table public.club_cups add column if not exists require_club_approval boolean not null default false;
alter table public.club_cups add column if not exists reward_form_url text;
alter table public.club_cups add column if not exists prize_top_clubs integer;
alter table public.club_cups add column if not exists prize_top_runners integer;
alter table public.club_cups drop constraint if exists club_cups_league_chk;
alter table public.club_cups add constraint club_cups_league_chk check (
  (min_run_km is null or min_run_km between 0.1 and 50)
  and (min_pace is null or min_pace between 1 and 30) and (max_pace is null or max_pace between 1 and 60)
  and (min_pace is null or max_pace is null or max_pace > min_pace)
  and (member_min_km is null or member_min_km between 1 and 2000)
  and (min_valid_pct is null or min_valid_pct between 1 and 100)
  and (max_runners is null or max_runners between 2 and 20000)
  and (prize_top_clubs is null or prize_top_clubs between 1 and 50)
  and (prize_top_runners is null or prize_top_runners between 1 and 500)
  and (reward_form_url is null or (char_length(reward_form_url) <= 500 and reward_form_url ~ '^https://[^[:space:]]+$')));

-- CLB đăng ký vào giải chờ ban tổ chức duyệt: approved = false → chưa tính điểm, chưa hiện trên BXH
alter table public.club_cup_entries add column if not exists approved boolean not null default true;

-- Người quản lý giải: người tạo, admin hệ thống, ban quản trị CLB chủ nhà
create or replace function private.cup_can_manage(u public.club_cups) returns boolean
language sql stable security definer set search_path = public as $$
  select u.created_by = auth.uid() or public.is_system_admin() or (u.host_club_id is not null and public.club_is_staff(u.host_club_id))
$$;

-- Kiểm tra + chuẩn hóa luật giải online trong biểu mẫu tạo giải (trường nào bỏ trống = không áp)
create or replace function private.cup_league_terms(p jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  v_run numeric := nullif(p->>'min_run_km', '')::numeric;
  v_pmin numeric := nullif(p->>'min_pace', '')::numeric;
  v_pmax numeric := nullif(p->>'max_pace', '')::numeric;
  v_mem numeric := nullif(p->>'member_min_km', '')::numeric;
  v_pct integer := nullif(p->>'min_valid_pct', '')::integer;
  v_cap integer := nullif(p->>'max_runners', '')::integer;
  v_appr boolean := coalesce(nullif(p->>'require_club_approval', '')::boolean, false);
  v_url text := nullif(trim(coalesce(p->>'reward_form_url', '')), '');
  v_tc integer := nullif(p->>'prize_top_clubs', '')::integer;
  v_tr integer := nullif(p->>'prize_top_runners', '')::integer;
begin
  if v_run is not null and v_run not between 0.1 and 50 then raise exception 'INVALID_LEAGUE'; end if;
  if (v_pmin is not null and v_pmin not between 1 and 30) or (v_pmax is not null and v_pmax not between 1 and 60)
     or (v_pmin is not null and v_pmax is not null and v_pmax <= v_pmin) then raise exception 'INVALID_LEAGUE'; end if;
  if v_mem is not null and v_mem not between 1 and 2000 then raise exception 'INVALID_LEAGUE'; end if;
  if v_pct is not null and v_pct not between 1 and 100 then raise exception 'INVALID_LEAGUE'; end if;
  if v_cap is not null and v_cap not between 2 and 20000 then raise exception 'INVALID_LEAGUE'; end if;
  if (v_tc is not null and v_tc not between 1 and 50) or (v_tr is not null and v_tr not between 1 and 500) then raise exception 'INVALID_LEAGUE'; end if;
  if v_url is not null and (char_length(v_url) > 500 or v_url !~ '^https://[^[:space:]]+$') then raise exception 'INVALID_FORM_URL'; end if;
  return jsonb_build_object('min_run_km', v_run, 'min_pace', v_pmin, 'max_pace', v_pmax, 'member_min_km', v_mem, 'min_valid_pct', v_pct,
    'max_runners', v_cap, 'require_club_approval', v_appr, 'reward_form_url', v_url, 'prize_top_clubs', v_tc, 'prize_top_runners', v_tr);
end $$;


create or replace function private.cup_counted(p_cup uuid)
returns table (club_id uuid, user_id uuid, joined_at timestamptz)
language sql stable security definer set search_path = public as $$
  select x.club_id, x.user_id, x.joined_at from (
    select m.club_id, m.user_id, m.joined_at,
           row_number() over (partition by m.user_id order by m.joined_at nulls first, m.club_id) as k
      from public.club_members m
      join public.club_cup_entries ce on ce.club_id = m.club_id and ce.cup_id = p_cup and ce.approved
     where m.status = 'APPROVED'
       and (not coalesce((select u.require_signup from public.club_cups u where u.id = p_cup), false)
            or exists (select 1 from public.club_cup_members cm where cm.cup_id = p_cup and cm.user_id = m.user_id and cm.club_id = m.club_id))) x
   where x.k = 1
$$;

create or replace function private.match_runner_rows(p_cup uuid, p_start timestamptz, p_end timestamptz, p_cap_km numeric)
returns table (club_id uuid, user_id uuid, km numeric, raw_km numeric, time_s numeric, days integer, runs integer)
language sql stable security definer set search_path = public as $$
  with r as (
    select * from private.cup_counted(p_cup)
  ), d as (
    select r.club_id, a.user_id, (a.started_at at time zone 'Asia/Ho_Chi_Minh')::date as day,
           sum(a.distance_m) as m, sum(coalesce(nullif(a.moving_time_s, 0), a.elapsed_time_s, 0)) as t, count(*) as n
      from public.activities a join r on r.user_id = a.user_id
     where p_end > p_start
       and a.validation_status = 'APPROVED' and coalesce(a.status, '') <> 'DELETED'
       and a.shared and not coalesce(a.review_skipped, false)
       and a.distance_m >= coalesce((select u.min_run_km from public.club_cups u where u.id = p_cup), 0) * 1000
       and (coalesce(a.avg_pace_s, 0) <= 0
            or a.avg_pace_s between coalesce((select u.min_pace from public.club_cups u where u.id = p_cup), 0) * 60
                                and coalesce((select u.max_pace from public.club_cups u where u.id = p_cup), 99) * 60)
       and a.started_at >= p_start and a.started_at < p_end
       and a.started_at >= coalesce(r.joined_at, '-infinity'::timestamptz)
     group by r.club_id, a.user_id, (a.started_at at time zone 'Asia/Ho_Chi_Minh')::date
  ), c as (
    select d.*, case when p_cap_km is null or d.m <= p_cap_km * 1000 then d.m else p_cap_km * 1000 end as cm from d
  )
  select r.club_id, r.user_id,
         coalesce(round(sum(c.cm) / 1000.0, 3), 0),
         coalesce(round(sum(c.m) / 1000.0, 3), 0),
         coalesce(round(sum(case when c.m > 0 then c.t * c.cm / c.m else 0 end)), 0),
         count(c.day)::integer,
         coalesce(sum(c.n), 0)::integer
    from r left join c on c.user_id = r.user_id and c.club_id = r.club_id
   group by r.club_id, r.user_id
$$;

create or replace function private.match_standings(u public.club_cups, p_end timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
  with w as (
    select * from private.match_values(u, p_end)
  ), e as (
    select ce.club_id, ce.forfeited from public.club_cup_entries ce where ce.cup_id = u.id and ce.approved
  ), agg as (
    select e.club_id, e.forfeited,
           count(w.user_id) as roster,
           count(w.user_id) filter (where w.runs > 0) as runners,
           count(w.user_id) filter (where u.member_min_km is not null and w.km >= u.member_min_km) as valid,
           coalesce(sum(w.km), 0) as km, coalesce(sum(w.time_s), 0) as time_s, coalesce(sum(w.days), 0) as days,
           coalesce(sum(w.val), 0) as total_val,
           coalesce(sum(w.val) filter (where w.rn_val <= coalesce(u.top_n, 1000000)), 0) as top_val,
           sum(w.time_s) filter (where w.qualified and (u.format <> 'TOP' or w.rn_pace <= u.top_n)) as p_t,
           sum(w.km) filter (where w.qualified and (u.format <> 'TOP' or w.rn_pace <= u.top_n)) as p_km
      from e left join w on w.club_id = e.club_id
     group by e.club_id, e.forfeited
  ), s as (
    select agg.*,
           case when u.measure = 'PACE' then case when agg.p_km > 0 then round(agg.p_t / agg.p_km) end
                when u.format = 'TOTAL' then agg.total_val
                when u.format = 'TOP' then agg.top_val
                else agg.total_val / greatest(agg.roster, 1) end as score,
           (u.member_min_km is null or u.min_valid_pct is null or (agg.roster > 0 and agg.valid * 100 >= u.min_valid_pct * agg.roster)) as eligible,
           case u.tiebreak when 'PARTICIPANTS' then agg.runners when 'DAYS' then agg.days else 0 end as tb
      from agg
  ), ranked as (
    select s.*, rank() over (order by s.forfeited, not s.eligible, (s.score is null and u.measure = 'PACE'),
                                      case when u.measure = 'PACE' then s.score end asc,
                                      case when u.measure <> 'PACE' then s.score end desc,
                                      s.tb desc) as rnk
      from s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'rank', r.rnk, 'club_id', c.id, 'name', c.name, 'avatar_url', c.avatar_url, 'accent_color', c.accent_color,
           'members', r.roster, 'runners', r.runners, 'valid', r.valid, 'eligible', r.eligible, 'km', round(r.km, 2), 'avg_km', round(r.km / greatest(r.roster, 1), 2),
           'time_s', round(r.time_s), 'days', r.days, 'forfeited', r.forfeited,
           'score', case when u.measure = 'KM' then round(r.score, 2) else round(r.score) end,
           'top', (select coalesce(jsonb_agg(jsonb_build_object('user_id', w.user_id, 'display_name', private.display_name(w.user_id),
                                                                  'avatar_url', p.avatar_url, 'km', round(w.km, 2), 'time_s', w.time_s,
                                                                  'pace_s', w.pace_s, 'value', round(w.val, 2))
                                             order by w.rn_val), '[]'::jsonb)
                     from w join public.profiles p on p.id = w.user_id
                    where w.club_id = r.club_id and w.rn_val <= 3 and w.runs > 0))
         order by r.rnk, c.name), '[]'::jsonb)
    from ranked r join public.clubs c on c.id = r.club_id
$$;

create or replace function private.match_finalize(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  u public.club_cups := (select x from public.club_cups x where x.id = p_id);
  s jsonb; v_win uuid; v_mvp jsonb; v_n integer; r jsonb; m record; v_total integer; v_link text; v_kind text; v_msg text;
begin
  if u.id is null or u.status not in ('OPEN', 'PROVISIONAL') then return; end if;
  s := private.match_standings(u, u.end_at);
  -- Thắng: đúng một CLB hạng 1, không bị xử thua; hòa (cùng hạng 1) → không ai thắng
  v_win := case when (select count(*) from jsonb_array_elements(s) e where (e->>'rank')::int = 1) = 1
                then (select (e->>'club_id')::uuid from jsonb_array_elements(s) e
                       where (e->>'rank')::int = 1 and not coalesce((e->>'forfeited')::boolean, false)
                         and coalesce((e->>'eligible')::boolean, true)
                         and (e->>'score') is not null) end;
  v_mvp := private.match_mvp(u, u.end_at);
  update public.club_cups set status = 'FINISHED', settled_at = now(), final_at = now(),
         result = jsonb_build_object('standings', s, 'winner_id', v_win, 'mvp', v_mvp, 'final', true)
   where id = u.id and status in ('OPEN', 'PROVISIONAL');
  get diagnostics v_n = row_count;
  if v_n = 0 then return; end if;

  v_link := '/cups/' || u.id;
  v_kind := private.match_kind_note(u);
  if u.rules_version is not null then
    if v_win is not null then
      for m in select w.user_id from private.match_runner_rows(u.id, u.start_at, u.end_at, u.daily_cap_km) w
                where w.club_id = v_win and w.runs > 0 loop
        perform private.match_badge(m.user_id, 'CLUB_MATCH_WIN', v_link);
      end loop;
    end if;
    if v_mvp is not null then perform private.match_badge((v_mvp->>'user_id')::uuid, 'CLUB_MATCH_MVP', v_link); end if;
    if u.kind = 'DUEL' and u.host_club_id is not null and u.opponent_club_id is not null then
      perform private.match_elo(u.host_club_id, u.opponent_club_id,
        case when v_win = u.host_club_id then 1 when v_win = u.opponent_club_id then 0 else 0.5 end);
    end if;
  end if;

  v_total := jsonb_array_length(s);
  for r in select value from jsonb_array_elements(s) loop
    v_msg := case
      when coalesce((r->>'forfeited')::boolean, false) then 'CLB bị xử thua (không đủ VĐV) tại "' || u.title || '"'
      when not coalesce((r->>'eligible')::boolean, true) then 'CLB chưa đủ ' || u.min_valid_pct || '% thành viên đạt ' || u.member_min_km || ' km nên không được xếp hạng tại "' || u.title || '"'
      when v_win = (r->>'club_id')::uuid then 'CLB thắng "' || u.title || '"! 🏆'
      when v_win is null and (r->>'rank')::int = 1 then 'Hòa tại "' || u.title || '"'
      when u.kind = 'DUEL' then 'CLB thua "' || u.title || '" — hẹn trận sau!'
      else 'CLB xếp hạng ' || (r->>'rank') || '/' || v_total || ' tại "' || u.title || '"' end;
    perform private.notify_club((r->>'club_id')::uuid, false, v_kind, 'Kết quả chính thức: ' || v_msg,
      private.match_score_text(u, nullif(r->>'score', '')::numeric) || ' · ' || (r->>'runners') || '/' || (r->>'members') || ' VĐV đã chạy'
        || case when v_mvp is not null and (v_mvp->>'club_id') = (r->>'club_id') then ' · MVP: ' || (v_mvp->>'display_name') else '' end,
      v_link, null);
  end loop;
end $$;

-- Người đạt giải của tôi: thuộc CLB hạng ≤ prize_top_clubs (đủ điều kiện, không bị xử thua) hoặc cá nhân hạng ≤ prize_top_runners,
-- và đạt km hợp lệ. Chỉ dùng khi giải đã kết thúc chính thức.
create or replace function private.cup_my_prize(u public.club_cups) returns jsonb
language sql stable security definer set search_path = public as $$
  with me as (
    select cm.club_id from public.club_cup_members cm where cm.cup_id = u.id and cm.user_id = auth.uid()
  ), v as (
    select * from private.match_values(u, u.end_at)
  ), r as (
    select v.*, rank() over (order by v.km desc, v.days desc) as rk from v
  ), c as (
    select (s->>'club_id')::uuid as club_id, (s->>'rank')::int as rk,
           coalesce((s->>'eligible')::boolean, true) and not coalesce((s->>'forfeited')::boolean, false) as ok
      from jsonb_array_elements(coalesce(u.result->'standings', '[]'::jsonb)) s
  )
  select jsonb_build_object(
    'club_rank', (select c.rk from c join me on me.club_id = c.club_id),
    'runner_rank', (select r.rk from r where r.user_id = auth.uid()),
    'valid', coalesce((select r.km >= coalesce(u.member_min_km, 0) from r where r.user_id = auth.uid()), false),
    'qualified', exists (select 1 from me)
      and coalesce((select r.km >= coalesce(u.member_min_km, 0) from r where r.user_id = auth.uid()), false)
      and (exists (select 1 from c join me on me.club_id = c.club_id where c.ok and c.rk <= coalesce(u.prize_top_clubs, 0))
           or coalesce((select r.rk <= coalesce(u.prize_top_runners, 0) from r where r.user_id = auth.uid()), false)))
$$;

-- Phần "league" của cup_json: luật giải online, số runner đã đăng ký, CLB chờ duyệt (ban tổ chức), link form nhận giải
create or replace function private.cup_league_json(u public.club_cups, p_full boolean) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_manage boolean := private.cup_can_manage(u);
  v_mine jsonb;
  v_show boolean := false;
begin
  if u.min_run_km is null and u.min_pace is null and u.max_pace is null and u.member_min_km is null and u.max_runners is null
     and u.reward_form_url is null and not u.require_club_approval then
    return null;
  end if;
  if p_full and u.status = 'FINISHED' and u.reward_form_url is not null and auth.uid() is not null then
    v_mine := private.cup_my_prize(u);
    v_show := coalesce((v_mine->>'qualified')::boolean, false);
  end if;
  return jsonb_build_object(
    'min_run_km', u.min_run_km, 'min_pace', u.min_pace, 'max_pace', u.max_pace,
    'member_min_km', u.member_min_km, 'min_valid_pct', u.min_valid_pct, 'max_runners', u.max_runners,
    'signed_runners', (select count(*) from public.club_cup_members x where x.cup_id = u.id),
    'require_club_approval', u.require_club_approval,
    'prize_top_clubs', u.prize_top_clubs, 'prize_top_runners', u.prize_top_runners,
    'has_reward_form', u.reward_form_url is not null,
    'reward_form_url', case when v_manage or v_show then u.reward_form_url end,
    'my_prize', v_mine,
    'pending_clubs', case when p_full and v_manage then
      (select coalesce(jsonb_agg(jsonb_build_object('club_id', c.id, 'name', c.name, 'avatar_url', c.avatar_url, 'accent_color', c.accent_color,
          'members', (select count(*) from public.club_members m where m.club_id = c.id and m.status = 'APPROVED'),
          'requested_at', ce.registered_at) order by ce.registered_at), '[]'::jsonb)
         from public.club_cup_entries ce join public.clubs c on c.id = ce.club_id
        where ce.cup_id = u.id and not ce.approved) end);
end $$;


create or replace function private.cup_json(u public.club_cups, p_full boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', u.id, 'title', u.title, 'description', u.description, 'prize', u.prize, 'metric', u.metric,
    'start_at', u.start_at, 'end_at', u.end_at, 'reg_close_at', u.reg_close_at, 'max_clubs', u.max_clubs,
    'status', u.status, 'review_note', u.review_note, 'created_at', u.created_at, 'settled_at', u.settled_at,
    'require_signup', coalesce(u.require_signup, false),
    'host', private.club_brief(u.host_club_id),
    'creator', (select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url)
                  from public.profiles p where p.id = u.created_by),
    'clubs', (select count(*) from public.club_cup_entries ce where ce.cup_id = u.id and ce.approved),
    'my_clubs', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url, 'accent_color', c.accent_color,
                         'staff', m.role in ('OWNER', 'CAPTAIN') or public.is_system_admin(),
                         'joined', ce.club_id is not null,
                         'approved', coalesce(ce.approved, true),
                         'forfeited', coalesce(ce.forfeited, false),
                         'eligible', m.joined_at is null or u.rules_version is null or m.joined_at <= private.match_cutoff(u, c.id),
                         'roster', (select count(*) from public.club_cup_members x where x.cup_id = u.id and x.club_id = c.id),
                         'signed_up', exists (select 1 from public.club_cup_members cm where cm.cup_id = u.id and cm.club_id = c.id and cm.user_id = auth.uid()))
                       order by (ce.club_id is null), c.name), '[]'::jsonb)
                   from public.club_members m join public.clubs c on c.id = m.club_id
                   left join public.club_cup_entries ce on ce.cup_id = u.id and ce.club_id = c.id
                  where m.user_id = auth.uid() and m.status = 'APPROVED'
                    and (u.kind = 'CUP' or c.id in (u.host_club_id, u.opponent_club_id))),
    'my_signup', (select cm.club_id from public.club_cup_members cm where cm.cup_id = u.id and cm.user_id = auth.uid()),
    'can_manage', u.created_by = auth.uid() or public.is_system_admin()
                  or (u.host_club_id is not null and public.club_is_staff(u.host_club_id)),
    'can_review', public.is_system_admin(),
    'standings', case when p_full and u.status in ('OPEN', 'PROVISIONAL', 'FINISHED') then coalesce(u.result->'standings',
                   private.match_standings(u, least(u.end_at, greatest(now(), u.start_at)))) end)
  || jsonb_build_object(
    'kind', u.kind, 'rules_version', u.rules_version, 'opponent', private.club_brief(u.opponent_club_id),
    'format', u.format, 'measure', u.measure, 'top_n', u.top_n, 'min_roster', u.min_roster, 'max_roster', u.max_roster,
    'daily_cap_km', u.daily_cap_km, 'share_cap_pct', u.share_cap_pct, 'pace_min_km', u.pace_min_km, 'tiebreak', u.tiebreak,
    'lock_hours', u.lock_hours, 'roster_close_at', coalesce(u.roster_close_at, case when coalesce(u.require_signup, false) then u.end_at else u.start_at end),
    'forfeit_rule', u.forfeit_rule,
    'final_after', u.end_at + make_interval(hours => u.final_delay_hours), 'final_delay_hours', u.final_delay_hours,
    'accepted_at', u.accepted_at, 'locked_at', u.locked_at, 'provisional_at', u.provisional_at, 'final_at', u.final_at,
    'phase', private.match_phase(u), 'terms_version', u.terms_version, 'awaiting_club_id', u.awaiting_club_id,
    'decline_reason', u.decline_reason, 'cancel_reason', u.cancel_reason,
    'negotiation', case when public.is_system_admin()
                          or (u.host_club_id is not null and public.club_is_staff(u.host_club_id))
                          or (u.opponent_club_id is not null and public.club_is_staff(u.opponent_club_id)) then u.negotiation end,
    'can_respond', u.status = 'INVITED' and u.awaiting_club_id is not null and public.club_is_staff(u.awaiting_club_id),
    'can_cancel', case
       when u.status in ('FINISHED', 'CANCELLED', 'DECLINED', 'EXPIRED', 'REJECTED') then false
       when public.is_system_admin() then u.status <> 'PROVISIONAL'
       when u.kind = 'DUEL' then (u.status = 'INVITED' and public.club_is_staff(u.host_club_id))
                               or (u.status = 'OPEN' and now() < u.start_at
                                   and (public.club_is_staff(u.host_club_id) or public.club_is_staff(u.opponent_club_id)))
       else (u.created_by = auth.uid() or (u.host_club_id is not null and public.club_is_staff(u.host_club_id)))
            and (u.status = 'PENDING_REVIEW' or (u.status = 'OPEN' and now() < u.start_at)) end,
    'winner_id', u.result->'winner_id', 'mvp', u.result->'mvp',
    -- Ban quản trị: số bài của VĐV thi đấu đang chờ duyệt trong khung giờ
    'pending_runs', case when u.status in ('OPEN', 'PROVISIONAL') and exists (
          select 1 from public.club_cup_entries ce where ce.cup_id = u.id and public.club_is_staff(ce.club_id))
        then (select count(*) from public.activities a join public.club_cup_members x on x.cup_id = u.id and x.user_id = a.user_id
               where a.validation_status = 'PENDING' and coalesce(a.status, '') <> 'DELETED'
                 and a.started_at >= u.start_at and a.started_at < u.end_at and public.club_is_staff(x.club_id)) end,
    -- Bài Strava của tôi đang ẩn → không được tính: nhắc bật "Hiện bài Strava"
    'my_strava_hidden', exists (select 1 from public.connected_accounts ca where ca.user_id = auth.uid() and ca.provider = 'STRAVA')
                        and not private.activity_shared(auth.uid(), 'STRAVA'))
  || jsonb_build_object('league', private.cup_league_json(u, p_full))
$$;

create or replace function public.create_club_cup(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_id uuid := gen_random_uuid();
  v_host uuid := nullif(p->>'host_club_id', '')::uuid;
  v_admin boolean := public.is_system_admin();
  v_title text := trim(coalesce(p->>'title', ''));
  v_max integer := coalesce((p->>'max_clubs')::integer, 20);
  v_status text;
  v_name text := private.display_name(v_uid);
  t jsonb;
  l jsonb := private.cup_league_terms(p);
  v_close timestamptz;
  a record;
begin
  if char_length(v_title) < 3 or char_length(v_title) > 120 then raise exception 'INVALID_TITLE'; end if;
  -- Biểu mẫu cũ gửi "metric" → đổi sang hình thức mới
  t := private.match_terms(p || jsonb_build_object('format', coalesce(nullif(p->>'format', ''),
                                                   case when p->>'metric' = 'TOTAL_KM' then 'TOTAL' else 'AVG' end)), 'CUP');
  v_close := coalesce(nullif(p->>'reg_close_at', '')::timestamptz, (t->>'roster_close_at')::timestamptz);
  if v_close > (t->>'roster_close_at')::timestamptz then v_close := (t->>'roster_close_at')::timestamptz; end if;
  if v_close < now() then raise exception 'INVALID_REG_CLOSE'; end if;
  if v_max < 2 or v_max > 200 then raise exception 'INVALID_MAX'; end if;
  if v_host is not null and not public.club_is_staff(v_host) and not v_admin then raise exception 'FORBIDDEN'; end if;
  if (select count(*) from public.club_cups u where u.created_by = v_uid and u.created_at > now() - interval '1 day') >= 5 then
    raise exception 'RATE_LIMITED';
  end if;

  v_status := case when v_admin or v_host is not null then 'OPEN' else 'PENDING_REVIEW' end;
  insert into public.club_cups (id, kind, rules_version, title, description, prize, metric, start_at, end_at, reg_close_at, max_clubs,
                                host_club_id, created_by, status, reviewed_by, reviewed_at, require_signup,
                                format, measure, top_n, min_roster, max_roster, daily_cap_km, share_cap_pct, pace_min_km, tiebreak,
                                lock_hours, roster_close_at, forfeit_rule, final_delay_hours)
  values (v_id, 'CUP', 2, v_title, nullif(left(trim(coalesce(p->>'description', '')), 1000), ''), nullif(left(trim(coalesce(p->>'prize', '')), 200), ''),
          case when t->>'format' = 'TOTAL' then 'TOTAL_KM' else 'AVG_KM' end,
          (t->>'start_at')::timestamptz, (t->>'end_at')::timestamptz, v_close, v_max, v_host, v_uid, v_status,
          case when v_status = 'OPEN' then v_uid end, case when v_status = 'OPEN' then now() end, true,
          t->>'format', t->>'measure', (t->>'top_n')::int, (t->>'min_roster')::int, (t->>'max_roster')::int,
          (t->>'daily_cap_km')::numeric, (t->>'share_cap_pct')::int, (t->>'pace_min_km')::numeric, t->>'tiebreak',
          (t->>'lock_hours')::int, (t->>'roster_close_at')::timestamptz, 'FORFEIT', 48);

  update public.club_cups set
    min_run_km = (l->>'min_run_km')::numeric, min_pace = (l->>'min_pace')::numeric, max_pace = (l->>'max_pace')::numeric,
    member_min_km = (l->>'member_min_km')::numeric, min_valid_pct = (l->>'min_valid_pct')::int, max_runners = (l->>'max_runners')::int,
    require_club_approval = (l->>'require_club_approval')::boolean, reward_form_url = l->>'reward_form_url',
    prize_top_clubs = (l->>'prize_top_clubs')::int, prize_top_runners = (l->>'prize_top_runners')::int
   where id = v_id;

  if v_host is not null then
    insert into public.club_cup_entries (cup_id, club_id, registered_by) values (v_id, v_host, v_uid);
  end if;
  if v_status = 'PENDING_REVIEW' then
    for a in select pr.id from public.profiles pr where pr.role = 'SYSTEM_ADMIN' loop
      perform private.notify(a.id, null, 'CLUB_CUP', 'Thách đấu CLB chờ duyệt: ' || v_title,
        v_name || ' vừa tạo. Vào Quản trị → Thách đấu để duyệt.', '/cups/' || v_id, v_uid, true);
    end loop;
  end if;
  return private.cup_json((select u from public.club_cups u where u.id = v_id), false);
end $$;

create or replace function public.join_cup_as_member(p_cup_id uuid, p_club_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  u public.club_cups := (select x from public.club_cups x where x.id = p_cup_id for update);
  v_mine uuid;
  v_joined timestamptz;
begin
  if u.id is null or not private.cup_visible(u) then raise exception 'CUP_NOT_FOUND'; end if;
  if u.status <> 'OPEN' or now() >= u.end_at then raise exception 'CUP_NOT_OPEN'; end if;
  if u.rules_version is not null and now() >= u.roster_close_at then raise exception 'ROSTER_LOCKED'; end if;
  if not exists (select 1 from public.club_cup_entries ce where ce.cup_id = u.id and ce.club_id = p_club_id) then raise exception 'CLUB_NOT_IN_CUP'; end if;
  if not exists (select 1 from public.club_cup_entries ce where ce.cup_id = u.id and ce.club_id = p_club_id and ce.approved) then raise exception 'CLUB_PENDING_APPROVAL'; end if;
  v_joined := (select m.joined_at from public.club_members m where m.club_id = p_club_id and m.user_id = v_uid and m.status = 'APPROVED');
  if not exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = v_uid and m.status = 'APPROVED') then
    raise exception 'NOT_A_MEMBER';
  end if;
  if u.rules_version is not null and v_joined is not null and v_joined > private.match_cutoff(u, p_club_id) then
    raise exception 'JOINED_CLUB_TOO_LATE';
  end if;
  v_mine := (select cm.club_id from public.club_cup_members cm where cm.cup_id = u.id and cm.user_id = v_uid);
  if v_mine = p_club_id then return private.cup_json(u, true); end if;
  if v_mine is not null then raise exception 'ALREADY_SIGNED_UP'; end if;
  if u.max_roster is not null and (select count(*) from public.club_cup_members x where x.cup_id = u.id and x.club_id = p_club_id) >= u.max_roster then
    raise exception 'ROSTER_FULL';
  end if;
  if u.max_runners is not null and (select count(*) from public.club_cup_members x where x.cup_id = u.id) >= u.max_runners then raise exception 'RUNNERS_FULL'; end if;
  insert into public.club_cup_members (cup_id, user_id, club_id) values (u.id, v_uid, p_club_id);
  return private.cup_json(u, true);
end $$;

-- Ban quản trị CLB đăng ký CLB vào giải. Giải yêu cầu duyệt: CLB phải đủ min_roster thành viên, vào hàng chờ, ban tổ chức duyệt mới tính.
create or replace function public.join_club_cup(p_cup_id uuid, p_club_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  u public.club_cups := (select x from public.club_cups x where x.id = p_cup_id for update);
  v_club text := (select c.name from public.clubs c where c.id = p_club_id);
  v_ok boolean;
  a record;
begin
  if u.id is null or not private.cup_visible(u) then raise exception 'CUP_NOT_FOUND'; end if;
  if u.kind <> 'CUP' then raise exception 'NOT_A_CUP'; end if;
  if v_club is null then raise exception 'CLUB_NOT_FOUND'; end if;
  if not public.club_is_staff(p_club_id) then raise exception 'CLUB_STAFF_REQUIRED'; end if;
  if u.status <> 'OPEN' then raise exception 'CUP_NOT_OPEN'; end if;
  if now() > u.reg_close_at then raise exception 'REGISTRATION_CLOSED'; end if;
  if exists (select 1 from public.club_cup_entries ce where ce.cup_id = u.id and ce.club_id = p_club_id) then raise exception 'ALREADY_JOINED'; end if;
  if (select count(*) from public.club_cup_entries ce where ce.cup_id = u.id) >= u.max_clubs then raise exception 'CUP_FULL'; end if;
  if u.require_club_approval and (select count(*) from public.club_members m where m.club_id = p_club_id and m.status = 'APPROVED') < u.min_roster then
    raise exception 'CLUB_TOO_SMALL';
  end if;
  v_ok := not u.require_club_approval or private.cup_can_manage(u);
  insert into public.club_cup_entries (cup_id, club_id, registered_by, approved) values (u.id, p_club_id, v_uid, v_ok);
  if v_ok then
    perform private.notify_club(p_club_id, false, 'CLUB_CUP', v_club || ' tham gia "' || u.title || '": đăng ký thi đấu!',
      case when coalesce(u.require_signup, false)
           then 'Bấm "Đăng ký thi đấu" trước ' || to_char(coalesce(u.roster_close_at, u.end_at) at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM')
                || ' — chỉ người đăng ký mới được tính cho CLB.'
           else 'Mọi km hợp lệ từ ' || to_char(u.start_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI') || ' đều tính cho CLB. Chạy thôi!' end,
      '/cups/' || u.id, v_uid);
    if u.created_by is not null and u.created_by <> v_uid then
      perform private.notify(u.created_by, null, 'CLUB_CUP', v_club || ' đã đăng ký "' || u.title || '"', null, '/cups/' || u.id, v_uid, false);
    end if;
  else
    perform private.notify_club(p_club_id, true, 'CLUB_CUP', v_club || ' đã gửi đăng ký vào "' || u.title || '"',
      'Chờ ban tổ chức duyệt. Bạn sẽ nhận thông báo khi được duyệt.', '/cups/' || u.id, v_uid);
    for a in select pr.id from public.profiles pr where pr.role = 'SYSTEM_ADMIN' or pr.id = u.created_by loop
      perform private.notify(a.id, null, 'CLUB_CUP', 'CLB chờ duyệt vào "' || u.title || '"',
        v_club || ' xin vào giải. Vào giải để duyệt.', '/cups/' || u.id, v_uid, true);
    end loop;
  end if;
  return private.cup_json((select x from public.club_cups x where x.id = u.id), true);
end $$;

-- Ban tổ chức duyệt / từ chối CLB đang chờ vào giải
create or replace function public.review_cup_club(p_cup_id uuid, p_club_id uuid, p_approve boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  u public.club_cups := (select x from public.club_cups x where x.id = p_cup_id for update);
  e public.club_cup_entries;
  v_note text := trim(coalesce(p_note, ''));
begin
  if u.id is null then raise exception 'CUP_NOT_FOUND'; end if;
  if not private.cup_can_manage(u) then raise exception 'FORBIDDEN'; end if;
  e := (select x from public.club_cup_entries x where x.cup_id = u.id and x.club_id = p_club_id);
  if e.club_id is null or e.approved then raise exception 'ENTRY_NOT_PENDING'; end if;
  if p_approve then
    if u.status <> 'OPEN' or now() >= coalesce(u.roster_close_at, u.start_at) then raise exception 'REGISTRATION_CLOSED'; end if;
    update public.club_cup_entries set approved = true where cup_id = u.id and club_id = p_club_id;
    -- Người đăng ký CLB (nếu là thành viên) tự có tên thi đấu, như khi CLB vào giải bình thường
    if coalesce(u.require_signup, false) and e.registered_by is not null
       and exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = e.registered_by and m.status = 'APPROVED')
       and (u.max_runners is null or (select count(*) from public.club_cup_members x where x.cup_id = u.id) < u.max_runners) then
      insert into public.club_cup_members (cup_id, user_id, club_id) values (u.id, e.registered_by, p_club_id) on conflict (cup_id, user_id) do nothing;
    end if;
    perform private.notify_club(p_club_id, false, 'CLUB_CUP', 'CLB đã được duyệt vào "' || u.title || '"!',
      'Bấm "Đăng ký thi đấu" trước ' || to_char(coalesce(u.roster_close_at, u.end_at) at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM')
        || ' — chỉ người đăng ký mới được tính cho CLB.', '/cups/' || u.id, v_uid);
  else
    if char_length(v_note) < 3 then raise exception 'REASON_REQUIRED'; end if;
    delete from public.club_cup_members where cup_id = u.id and club_id = p_club_id;
    delete from public.club_cup_entries where cup_id = u.id and club_id = p_club_id;
    perform private.notify_club(p_club_id, true, 'CLUB_CUP', 'CLB chưa được duyệt vào "' || u.title || '"', v_note, '/cups/' || u.id, v_uid);
  end if;
  return private.cup_json((select x from public.club_cups x where x.id = u.id), true);
end $$;

-- Ban tổ chức dán / xóa link form nhận giải
create or replace function public.set_cup_reward_form(p_cup_id uuid, p_url text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u public.club_cups := (select x from public.club_cups x where x.id = p_cup_id);
  v_url text := nullif(trim(coalesce(p_url, '')), '');
begin
  perform private.require_uid();
  if u.id is null then raise exception 'CUP_NOT_FOUND'; end if;
  if not private.cup_can_manage(u) then raise exception 'FORBIDDEN'; end if;
  if v_url is not null and (char_length(v_url) > 500 or v_url !~ '^https://[^[:space:]]+$') then raise exception 'INVALID_FORM_URL'; end if;
  update public.club_cups set reward_form_url = v_url where id = u.id;
  return private.cup_json((select x from public.club_cups x where x.id = u.id), true);
end $$;

-- BXH cá nhân trong giải: mọi runner đã đăng ký (kể cả chưa chạy), theo km tính điểm (đã áp trần ngày)
create or replace function public.club_cup_runner_board(p_cup_id uuid, p_limit integer default 500) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  u public.club_cups := (select x from public.club_cups x where x.id = p_cup_id);
  v_end timestamptz;
begin
  perform private.require_uid();
  if u.id is null or not private.cup_visible(u) or u.status not in ('OPEN', 'PROVISIONAL', 'FINISHED') then raise exception 'CUP_NOT_FOUND'; end if;
  v_end := least(u.end_at, greatest(now(), u.start_at));
  return jsonb_build_object(
    'member_min_km', u.member_min_km, 'daily_cap_km', u.daily_cap_km,
    'total', (select count(*) from public.club_cup_members x where x.cup_id = u.id),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
               'rank', t.rk, 'user_id', t.user_id, 'display_name', p.display_name, 'avatar_url', p.avatar_url,
               'club_id', t.club_id, 'club_name', c.name, 'km', round(t.km, 2), 'raw_km', round(t.raw_km, 2),
               'runs', t.runs, 'days', t.days, 'pace_s', t.pace_s, 'valid', t.km >= coalesce(u.member_min_km, 0))
             order by t.rk, p.display_name), '[]'::jsonb)
               from (select v.*, rank() over (order by v.km desc, v.days desc) as rk from private.match_values(u, v_end) v) t
               join public.profiles p on p.id = t.user_id
               join public.clubs c on c.id = t.club_id
              where t.rk <= greatest(coalesce(p_limit, 500), 1)));
end $$;

-- CLB chờ duyệt chưa được tự đăng ký người: chỉ CLB đã duyệt mới tự có tên thi đấu khi vào giải
create or replace function private.cup_entry_autosignup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.approved and new.registered_by is not null
     and coalesce((select u.require_signup from public.club_cups u where u.id = new.cup_id), false)
     and exists (select 1 from public.club_members m where m.club_id = new.club_id and m.user_id = new.registered_by and m.status = 'APPROVED') then
    insert into public.club_cup_members (cup_id, user_id, club_id) values (new.cup_id, new.registered_by, new.club_id)
    on conflict (cup_id, user_id) do nothing;
  end if;
  return new;
end $$;

revoke all on function private.cup_can_manage(public.club_cups), private.cup_league_terms(jsonb), private.cup_my_prize(public.club_cups),
  private.cup_league_json(public.club_cups, boolean) from public, anon, authenticated;
revoke all on function public.review_cup_club(uuid, uuid, boolean, text), public.set_cup_reward_form(uuid, text),
  public.club_cup_runner_board(uuid, integer) from public, anon;
grant execute on function public.review_cup_club(uuid, uuid, boolean, text), public.set_cup_reward_form(uuid, text),
  public.club_cup_runner_board(uuid, integer) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001016300_partner_shop.sql
-- ===================================================================
-- 016300: Cửa hàng đối tác — đăng sản phẩm (ảnh, giá, biến thể, tồn kho), giỏ hàng / đặt hàng, thanh toán, quản lý đơn.
-- • Đối tác (hồ sơ Chợ Runner, 005300) đăng sản phẩm ngay sau khi tạo hồ sơ; sản phẩm CHỈ hiện cho khách khi hồ sơ đã được xác minh.
-- • Sản phẩm: nhiều ảnh, giá + giá gốc (gạch), danh mục, SKU, biến thể (size / màu… mỗi biến thể có giá + tồn kho riêng).
-- • Khách chọn biến thể, thêm giỏ, đặt hàng: tên, điện thoại, địa chỉ giao. Server tự tính tiền, trừ tồn kho (khoá hàng chống bán lố).
-- • Thanh toán: chuyển khoản VietQR thẳng vào tài khoản của đối tác (nội dung = mã đơn) hoặc COD. RaceHub KHÔNG giữ tiền.
-- • Đối tác: đơn mới → xác nhận tiền → giao (mã vận đơn) → hoàn tất / huỷ (hoàn lại tồn kho). Khách theo dõi trong "Đơn của tôi".
-- Cần 005300, 000500 (private.notify). Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 1. Cài đặt cửa hàng trên hồ sơ đối tác
-- ---------------------------------------------------------------------
alter table public.partners add column if not exists shop_bank_bin text;
alter table public.partners add column if not exists shop_bank_account_no text;
alter table public.partners add column if not exists shop_bank_account_name text;
alter table public.partners add column if not exists ship_fee_vnd integer not null default 0 check (ship_fee_vnd between 0 and 500000);
alter table public.partners add column if not exists free_ship_over_vnd integer check (free_ship_over_vnd is null or free_ship_over_vnd between 0 and 50000000);
alter table public.partners add column if not exists cod_enabled boolean not null default false;
alter table public.partners add column if not exists shop_policy text check (shop_policy is null or char_length(shop_policy) <= 1000);

-- ---------------------------------------------------------------------
-- 2. Bảng sản phẩm / biến thể / đơn hàng
-- ---------------------------------------------------------------------
create table if not exists public.partner_products (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 100),
  description text check (description is null or char_length(description) <= 2000),
  images text[] not null default '{}' check (cardinality(images) <= 8),
  category text check (category is null or char_length(category) <= 30),
  price_vnd integer not null check (price_vnd between 0 and 50000000),
  compare_price_vnd integer check (compare_price_vnd is null or compare_price_vnd between 0 and 50000000),
  sku text check (sku is null or char_length(sku) <= 40),
  stock integer check (stock is null or stock between 0 and 1000000),      -- null = không giới hạn (sản phẩm không có biến thể)
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'HIDDEN')),
  sold integer not null default 0 check (sold >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists partner_products_partner_idx on public.partner_products (partner_id, status, created_at desc);

create table if not exists public.partner_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.partner_products(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  price_vnd integer check (price_vnd is null or price_vnd between 0 and 50000000),   -- null = dùng giá sản phẩm
  stock integer check (stock is null or stock between 0 and 1000000),
  sku text check (sku is null or char_length(sku) <= 40),
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists partner_variants_product_idx on public.partner_variants (product_id, position);

create table if not exists public.partner_orders (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  code text not null unique,
  items jsonb not null,                         -- ảnh chụp lúc đặt: [{product_id, variant_id, title, variant, price_vnd, qty, image}]
  quantity integer not null check (quantity between 1 and 200),
  subtotal_vnd bigint not null check (subtotal_vnd >= 0),
  ship_fee_vnd integer not null default 0 check (ship_fee_vnd >= 0),
  amount_vnd bigint not null check (amount_vnd >= 0),
  buyer_name text not null check (char_length(buyer_name) between 2 and 60),
  buyer_phone text not null check (buyer_phone ~ '^(0|\+84)[0-9]{9,10}$'),
  ship_address text not null check (char_length(ship_address) between 8 and 250),
  note text check (note is null or char_length(note) <= 300),
  payment_method text not null check (payment_method in ('BANK', 'COD')),
  status text not null default 'PENDING' check (status in ('PENDING', 'PAID', 'SHIPPING', 'DONE', 'CANCELLED')),
  status_note text,
  tracking_code text check (tracking_code is null or char_length(tracking_code) <= 60),
  paid_at timestamptz,
  shipped_at timestamptz,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists partner_orders_partner_idx on public.partner_orders (partner_id, created_at desc);
create index if not exists partner_orders_user_idx on public.partner_orders (user_id, created_at desc);

alter table public.partner_products enable row level security;
alter table public.partner_variants enable row level security;
alter table public.partner_orders enable row level security;
revoke all on public.partner_products, public.partner_variants, public.partner_orders from anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Hàm nội bộ
-- ---------------------------------------------------------------------
create or replace function private.shop_bank(p public.partners) returns jsonb
language sql immutable as $$
  select case when p.shop_bank_bin is null or p.shop_bank_account_no is null then null
              else jsonb_build_object('bin', p.shop_bank_bin, 'account_no', p.shop_bank_account_no, 'account_name', p.shop_bank_account_name) end
$$;

create or replace function private.shop_settings_json(p public.partners, p_owner boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ship_fee_vnd', p.ship_fee_vnd, 'free_ship_over_vnd', p.free_ship_over_vnd, 'cod_enabled', p.cod_enabled,
    'shop_policy', p.shop_policy, 'bank_ready', p.shop_bank_bin is not null and p.shop_bank_account_no is not null)
    || case when p_owner then jsonb_build_object('bank', private.shop_bank(p)) else '{}'::jsonb end
$$;

create or replace function private.shop_product_json(pr public.partner_products) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', pr.id, 'partner_id', pr.partner_id, 'title', pr.title, 'description', pr.description,
    'images', to_jsonb(pr.images), 'category', pr.category, 'price_vnd', pr.price_vnd, 'compare_price_vnd', pr.compare_price_vnd,
    'sku', pr.sku, 'stock', pr.stock, 'status', pr.status, 'sold', pr.sold, 'created_at', pr.created_at,
    'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'price_vnd', coalesce(v.price_vnd, pr.price_vnd),
                    'own_price', v.price_vnd, 'stock', v.stock, 'sku', v.sku) order by v.position, v.created_at)
                  from public.partner_variants v where v.product_id = pr.id), '[]'::jsonb),
    'price_min', coalesce((select min(coalesce(v.price_vnd, pr.price_vnd)) from public.partner_variants v where v.product_id = pr.id), pr.price_vnd),
    'price_max', coalesce((select max(coalesce(v.price_vnd, pr.price_vnd)) from public.partner_variants v where v.product_id = pr.id), pr.price_vnd),
    'in_stock', case when exists (select 1 from public.partner_variants v where v.product_id = pr.id)
                     then exists (select 1 from public.partner_variants v where v.product_id = pr.id and (v.stock is null or v.stock > 0))
                     else (pr.stock is null or pr.stock > 0) end)
$$;

create or replace function private.shop_order_json(o public.partner_orders) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', o.id, 'partner_id', o.partner_id, 'shop_name', (select p.name from public.partners p where p.id = o.partner_id),
    'user_id', o.user_id, 'code', o.code, 'items', o.items, 'quantity', o.quantity, 'subtotal_vnd', o.subtotal_vnd, 'ship_fee_vnd', o.ship_fee_vnd,
    'amount_vnd', o.amount_vnd, 'buyer_name', o.buyer_name, 'buyer_phone', o.buyer_phone, 'ship_address', o.ship_address, 'note', o.note,
    'payment_method', o.payment_method, 'status', o.status, 'status_note', o.status_note, 'tracking_code', o.tracking_code,
    'paid_at', o.paid_at, 'shipped_at', o.shipped_at, 'done_at', o.done_at, 'created_at', o.created_at,
    'bank', case when o.payment_method = 'BANK' and o.status = 'PENDING'
                 then (select private.shop_bank(p) from public.partners p where p.id = o.partner_id) end)
$$;

-- Hoàn lại tồn kho + số đã bán khi đơn bị huỷ
create or replace function private.shop_restore_stock(o public.partner_orders) returns void
language plpgsql security definer set search_path = public as $$
declare i jsonb;
begin
  for i in select e from jsonb_array_elements(o.items) e loop
    if nullif(i->>'variant_id', '') is not null then
      update public.partner_variants set stock = stock + (i->>'qty')::int where id = (i->>'variant_id')::uuid and stock is not null;
    else
      update public.partner_products set stock = stock + (i->>'qty')::int where id = (i->>'product_id')::uuid and stock is not null;
    end if;
    update public.partner_products set sold = greatest(sold - (i->>'qty')::int, 0) where id = (i->>'product_id')::uuid;
  end loop;
end $$;

-- Hồ sơ đối tác: thêm số sản phẩm đang bán (hiện trên danh sách Chợ)
create or replace function private.partner_json(p public.partners, p_full boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'kind', p.kind, 'name', p.name, 'tagline', p.tagline, 'avatar_url', p.avatar_url, 'cover_url', p.cover_url,
    'area', p.area, 'specialties', to_jsonb(p.specialties), 'verified', p.status = 'APPROVED' and p.verified_at is not null,
    'status', p.status, 'is_mine', p.owner_id = auth.uid(),
    'services_count', jsonb_array_length(p.services),
    'products_count', (select count(*) from public.partner_products x where x.partner_id = p.id and x.status = 'ACTIVE'),
    'owner', jsonb_build_object('id', p.owner_id, 'display_name', private.display_name(p.owner_id),
                                'avatar_url', (select x.avatar_url from public.profiles x where x.id = p.owner_id)))
    || case when p_full then jsonb_build_object('bio', p.bio, 'address', p.address, 'services', p.services, 'contacts', p.contacts,
         'review_note', case when p.owner_id = auth.uid() or public.is_system_admin() then p.review_note end,
         'stats', case when p.kind = 'COACH' then private.partner_runner_stats(p.owner_id) end,
         'updated_at', p.updated_at) else '{}'::jsonb end
$$;

-- ---------------------------------------------------------------------
-- 4. RPC — cửa hàng & sản phẩm
-- ---------------------------------------------------------------------
-- Cửa hàng của một đối tác: cài đặt + sản phẩm (khách: chỉ hàng đang bán, hồ sơ phải được xác minh)
create or replace function public.partner_shop(p_partner_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  p public.partners := (select x from public.partners x where x.id = p_partner_id);
  v_mine boolean;
begin
  if p.id is null then raise exception 'SHOP_NOT_FOUND'; end if;
  v_mine := p.owner_id = auth.uid();
  if p.status <> 'APPROVED' and not v_mine and not public.is_system_admin() then raise exception 'SHOP_NOT_FOUND'; end if;
  return jsonb_build_object(
    'partner', jsonb_build_object('id', p.id, 'name', p.name, 'avatar_url', p.avatar_url, 'area', p.area, 'kind', p.kind, 'status', p.status,
                                  'verified', p.status = 'APPROVED' and p.verified_at is not null, 'is_mine', v_mine),
    'settings', private.shop_settings_json(p, v_mine),
    'products', coalesce((select jsonb_agg(private.shop_product_json(x) order by (x.status = 'ACTIVE') desc, x.created_at desc)
                  from public.partner_products x where x.partner_id = p.id and (x.status = 'ACTIVE' or v_mine)), '[]'::jsonb));
end $$;

create or replace function public.get_shop_product(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  pr public.partner_products := (select x from public.partner_products x where x.id = p_id);
  p public.partners := (select x from public.partners x where x.id = pr.partner_id);
  v_mine boolean;
begin
  if pr.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
  v_mine := p.owner_id = auth.uid();
  if not v_mine and not public.is_system_admin() and (pr.status <> 'ACTIVE' or p.status <> 'APPROVED') then raise exception 'PRODUCT_NOT_FOUND'; end if;
  return jsonb_build_object(
    'product', private.shop_product_json(pr),
    'partner', jsonb_build_object('id', p.id, 'name', p.name, 'avatar_url', p.avatar_url, 'area', p.area, 'kind', p.kind, 'status', p.status,
                                  'verified', p.status = 'APPROVED' and p.verified_at is not null, 'is_mine', v_mine),
    'settings', private.shop_settings_json(p, v_mine));
end $$;

create or replace function public.save_partner_shop(p_partner_id uuid, s jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  p public.partners := (select x from public.partners x where x.id = p_partner_id);
  b jsonb := s->'bank';
  v_bin text; v_acc text; v_name text;
  v_fee integer := coalesce(nullif(s->>'ship_fee_vnd', '')::int, 0);
  v_free integer := nullif(s->>'free_ship_over_vnd', '')::int;
begin
  if p.id is null or p.owner_id <> v_uid then raise exception 'FORBIDDEN'; end if;
  if v_fee not between 0 and 500000 or (v_free is not null and v_free not between 0 and 50000000) then raise exception 'INVALID_SHIPPING'; end if;
  if b is not null and jsonb_typeof(b) = 'object' and coalesce(b->>'bin', '') <> '' then
    v_bin := b->>'bin'; v_acc := b->>'account_no'; v_name := upper(trim(coalesce(b->>'account_name', '')));
    if v_bin !~ '^\d{6}$' or coalesce(v_acc, '') !~ '^[0-9A-Za-z]{4,20}$' or char_length(v_name) not between 2 and 60 then raise exception 'INVALID_BANK'; end if;
  end if;
  update public.partners set ship_fee_vnd = v_fee, free_ship_over_vnd = v_free, cod_enabled = coalesce((s->>'cod_enabled')::boolean, false),
    shop_policy = nullif(left(trim(coalesce(s->>'shop_policy', '')), 1000), ''),
    shop_bank_bin = v_bin, shop_bank_account_no = v_acc, shop_bank_account_name = v_name
  where id = p.id;
  p := (select x from public.partners x where x.id = p.id);
  return private.shop_settings_json(p, true);
end $$;

create or replace function public.save_partner_product(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_old public.partner_products := (select x from public.partner_products x where x.id = v_id);
  v_partner uuid := coalesce(v_old.partner_id, nullif(p->>'partner_id', '')::uuid);
  v_owner uuid := (select x.owner_id from public.partners x where x.id = v_partner);
  v_images text[];
  v_price integer;
  v_compare integer := nullif(p->>'compare_price_vnd', '')::int;
  v_status text := coalesce(nullif(p->>'status', ''), 'ACTIVE');
  v_vars jsonb := coalesce(p->'variants', '[]'::jsonb);
  v_keep uuid[] := '{}';
  v jsonb;
  v_vid uuid;
  v_pos integer := 0;
  r public.partner_products;
begin
  if v_partner is null or v_owner is distinct from v_uid then raise exception 'FORBIDDEN'; end if;
  if char_length(trim(coalesce(p->>'title', ''))) not between 2 and 100 then raise exception 'INVALID_PRODUCT'; end if;
  v_price := coalesce(nullif(p->>'price_vnd', '')::int, -1);
  if v_price not between 0 and 50000000 or (v_compare is not null and (v_compare not between 0 and 50000000 or v_compare <= v_price)) then raise exception 'INVALID_PRICE'; end if;
  if v_status not in ('ACTIVE', 'HIDDEN') then raise exception 'INVALID_PRODUCT'; end if;
  if jsonb_typeof(v_vars) <> 'array' then v_vars := '[]'::jsonb; end if;
  if jsonb_array_length(v_vars) > 30 then raise exception 'TOO_MANY_VARIANTS'; end if;
  if jsonb_array_length(coalesce(p->'images', '[]'::jsonb)) > 8 then raise exception 'TOO_MANY_IMAGES'; end if;
  v_images := array(select u from jsonb_array_elements_text(coalesce(p->'images', '[]'::jsonb)) with ordinality t(u, o) where trim(u) <> '' order by o);
  if exists (select 1 from unnest(v_images) u where not private.market_media_ok(v_uid, u)) then raise exception 'INVALID_PARTNER_IMAGE'; end if;
  if v_old.id is null and (select count(*) from public.partner_products x where x.partner_id = v_partner) >= 200 then raise exception 'TOO_MANY_PRODUCTS'; end if;

  if v_old.id is null then
    v_id := gen_random_uuid();
    insert into public.partner_products (id, partner_id, title, description, images, category, price_vnd, compare_price_vnd, sku, stock, status)
    values (v_id, v_partner, trim(p->>'title'), nullif(left(trim(coalesce(p->>'description', '')), 2000), ''), v_images,
            nullif(left(trim(coalesce(p->>'category', '')), 30), ''), v_price, v_compare, nullif(left(trim(coalesce(p->>'sku', '')), 40), ''),
            nullif(p->>'stock', '')::int, v_status);
  else
    update public.partner_products set title = trim(p->>'title'), description = nullif(left(trim(coalesce(p->>'description', '')), 2000), ''),
      images = v_images, category = nullif(left(trim(coalesce(p->>'category', '')), 30), ''), price_vnd = v_price, compare_price_vnd = v_compare,
      sku = nullif(left(trim(coalesce(p->>'sku', '')), 40), ''), stock = nullif(p->>'stock', '')::int, status = v_status, updated_at = now()
    where id = v_id;
  end if;

  -- biến thể: giữ id cũ nếu có, thêm mới, xoá cái không còn trong danh sách
  for v in select e from jsonb_array_elements(v_vars) e loop
    if char_length(trim(coalesce(v->>'name', ''))) < 1 then continue; end if;
    v_pos := v_pos + 1;
    v_vid := (select x.id from public.partner_variants x where x.id = nullif(v->>'id', '')::uuid and x.product_id = v_id);
    if coalesce(nullif(v->>'price_vnd', '')::int, 0) not between 0 and 50000000 or coalesce(nullif(v->>'stock', '')::int, 0) not between 0 and 1000000 then
      raise exception 'INVALID_VARIANT';
    end if;
    if v_vid is null then
      v_vid := gen_random_uuid();
      insert into public.partner_variants (id, product_id, name, price_vnd, stock, sku, position)
      values (v_vid, v_id, left(trim(v->>'name'), 60), nullif(v->>'price_vnd', '')::int, nullif(v->>'stock', '')::int,
              nullif(left(trim(coalesce(v->>'sku', '')), 40), ''), v_pos);
    else
      update public.partner_variants set name = left(trim(v->>'name'), 60), price_vnd = nullif(v->>'price_vnd', '')::int,
        stock = nullif(v->>'stock', '')::int, sku = nullif(left(trim(coalesce(v->>'sku', '')), 40), ''), position = v_pos
      where id = v_vid;
    end if;
    v_keep := v_keep || v_vid;
  end loop;
  delete from public.partner_variants where product_id = v_id and not (id = any (v_keep));

  r := (select x from public.partner_products x where x.id = v_id);
  return private.shop_product_json(r);
end $$;

create or replace function public.delete_partner_product(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  pr public.partner_products := (select x from public.partner_products x where x.id = p_id);
begin
  if pr.id is null or (select x.owner_id from public.partners x where x.id = pr.partner_id) is distinct from v_uid then raise exception 'FORBIDDEN'; end if;
  delete from public.partner_products where id = pr.id;
end $$;

-- ---------------------------------------------------------------------
-- 5. RPC — đặt hàng, đơn của tôi, quản lý đơn
-- ---------------------------------------------------------------------
create or replace function public.place_partner_order(p_partner_id uuid, p_items jsonb, p_buyer jsonb, p_method text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  p public.partners := (select x from public.partners x where x.id = p_partner_id);
  v_method text := upper(coalesce(p_method, ''));
  v_name text := trim(coalesce(p_buyer->>'name', ''));
  v_phone text := regexp_replace(coalesce(p_buyer->>'phone', ''), '[ .-]', '', 'g');
  v_addr text := trim(coalesce(p_buyer->>'address', ''));
  r record;
  pr public.partner_products;
  va public.partner_variants;
  v_has_var boolean;
  v_unit integer;
  v_items jsonb := '[]'::jsonb;
  v_sub bigint := 0;
  v_qty integer := 0;
  v_ship integer;
  v_code text;
  v_id uuid := gen_random_uuid();
  o public.partner_orders;
begin
  if p.id is null or p.status <> 'APPROVED' then raise exception 'SHOP_NOT_FOUND'; end if;
  if p.owner_id = v_uid then raise exception 'OWN_SHOP'; end if;
  if v_method not in ('BANK', 'COD') then raise exception 'INVALID_PAYMENT'; end if;
  if v_method = 'BANK' and private.shop_bank(p) is null then raise exception 'BANK_MISSING'; end if;
  if v_method = 'COD' and not p.cod_enabled then raise exception 'COD_DISABLED'; end if;
  if char_length(v_name) not between 2 and 60 or v_phone !~ '^(0|\+84)[0-9]{9,10}$' or char_length(v_addr) not between 8 and 250 then raise exception 'INVALID_BUYER'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'EMPTY_CART'; end if;
  if jsonb_array_length(p_items) > 40 then raise exception 'EMPTY_CART'; end if;

  -- gộp dòng trùng; khoá hàng theo thứ tự cố định để không deadlock
  for r in
    select (i->>'product_id')::uuid as pid, nullif(i->>'variant_id', '')::uuid as vid, sum(coalesce((i->>'qty')::int, 0))::int as qty
      from jsonb_array_elements(p_items) i group by 1, 2 order by 1, 2
  loop
    if r.qty < 1 or r.qty > 20 then raise exception 'INVALID_QUANTITY'; end if;
    pr := (select x from public.partner_products x where x.id = r.pid and x.partner_id = p.id for update);
    if pr.id is null or pr.status <> 'ACTIVE' then raise exception 'PRODUCT_UNAVAILABLE'; end if;
    v_has_var := exists (select 1 from public.partner_variants x where x.product_id = pr.id);
    if v_has_var then
      if r.vid is null then raise exception 'VARIANT_REQUIRED'; end if;
      va := (select x from public.partner_variants x where x.id = r.vid and x.product_id = pr.id for update);
      if va.id is null then raise exception 'PRODUCT_UNAVAILABLE'; end if;
      if va.stock is not null and va.stock < r.qty then raise exception 'OUT_OF_STOCK: %', pr.title || ' (' || va.name || ')'; end if;
      if va.stock is not null then update public.partner_variants set stock = stock - r.qty where id = va.id; end if;
      v_unit := coalesce(va.price_vnd, pr.price_vnd);
    else
      if r.vid is not null then raise exception 'PRODUCT_UNAVAILABLE'; end if;
      if pr.stock is not null and pr.stock < r.qty then raise exception 'OUT_OF_STOCK: %', pr.title; end if;
      if pr.stock is not null then update public.partner_products set stock = stock - r.qty where id = pr.id; end if;
      v_unit := pr.price_vnd;
    end if;
    update public.partner_products set sold = sold + r.qty where id = pr.id;
    v_items := v_items || jsonb_build_object('product_id', pr.id, 'variant_id', case when v_has_var then va.id end, 'title', pr.title,
      'variant', case when v_has_var then va.name end, 'price_vnd', v_unit, 'qty', r.qty, 'image', pr.images[1]);
    v_sub := v_sub + v_unit::bigint * r.qty;
    v_qty := v_qty + r.qty;
  end loop;

  v_ship := case when p.free_ship_over_vnd is not null and v_sub >= p.free_ship_over_vnd then 0 else p.ship_fee_vnd end;
  loop
    v_code := 'RH' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from public.partner_orders x where x.code = v_code);
  end loop;
  insert into public.partner_orders (id, partner_id, user_id, code, items, quantity, subtotal_vnd, ship_fee_vnd, amount_vnd, buyer_name, buyer_phone,
                                     ship_address, note, payment_method)
  values (v_id, p.id, v_uid, v_code, v_items, v_qty, v_sub, v_ship, v_sub + v_ship, v_name, v_phone, v_addr,
          nullif(left(trim(coalesce(p_note, '')), 300), ''), v_method);
  o := (select t from public.partner_orders t where t.id = v_id);
  perform private.notify(p.owner_id, null, 'MARKET', 'Đơn mới ' || v_code || ' · ' || to_char(o.amount_vnd, 'FM999G999G999') || 'đ',
    v_name || ' đặt ' || v_qty || ' sản phẩm. Mở "Quản lý cửa hàng" để xác nhận.', '/market/me/shop/' || p.id, v_uid, true);
  return private.shop_order_json(o);
end $$;

create or replace function public.my_partner_orders() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(private.shop_order_json(o) order by o.created_at desc), '[]'::jsonb) from public.partner_orders o where o.user_id = auth.uid()
$$;

create or replace function public.cancel_my_partner_order(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  o public.partner_orders := (select x from public.partner_orders x where x.id = p_order_id for update);
begin
  if o.id is null or o.user_id is distinct from v_uid then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.status <> 'PENDING' then raise exception 'ORDER_LOCKED'; end if;
  update public.partner_orders set status = 'CANCELLED', status_note = 'Người mua huỷ' where id = o.id;
  perform private.shop_restore_stock(o);
  o := (select t from public.partner_orders t where t.id = o.id);
  perform private.notify((select p.owner_id from public.partners p where p.id = o.partner_id), null, 'MARKET', 'Đơn ' || o.code || ' đã bị khách huỷ',
    o.buyer_name, '/market/me/shop/' || o.partner_id, v_uid, true);
  return private.shop_order_json(o);
end $$;

create or replace function public.partner_orders_admin(p_partner_id uuid, p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p public.partners := (select x from public.partners x where x.id = p_partner_id);
begin
  if p.id is null or p.owner_id is distinct from auth.uid() then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'orders', coalesce((select jsonb_agg(private.shop_order_json(o) order by o.created_at desc) from public.partner_orders o
                         where o.partner_id = p.id and (p_status is null or o.status = upper(p_status))), '[]'::jsonb),
    'totals', (select jsonb_build_object('pending', count(*) filter (where o.status = 'PENDING'), 'paid', count(*) filter (where o.status = 'PAID'),
                        'shipping', count(*) filter (where o.status = 'SHIPPING'), 'done', count(*) filter (where o.status = 'DONE'),
                        'revenue_vnd', coalesce(sum(o.amount_vnd) filter (where o.status in ('PAID', 'SHIPPING', 'DONE')), 0),
                        'awaiting_vnd', coalesce(sum(o.amount_vnd) filter (where o.status = 'PENDING'), 0))
                 from public.partner_orders o where o.partner_id = p.id));
end $$;

create or replace function public.set_partner_order_status(p_order_id uuid, p_status text, p_note text default null, p_tracking text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  o public.partner_orders := (select x from public.partner_orders x where x.id = p_order_id for update);
  v_to text := upper(coalesce(p_status, ''));
begin
  if o.id is null or (select x.owner_id from public.partners x where x.id = o.partner_id) is distinct from v_uid then raise exception 'FORBIDDEN'; end if;
  if not ((o.status = 'PENDING' and v_to in ('PAID', 'SHIPPING', 'CANCELLED')) or (o.status = 'PAID' and v_to in ('SHIPPING', 'DONE', 'CANCELLED'))
          or (o.status = 'SHIPPING' and v_to in ('DONE', 'CANCELLED'))) then
    raise exception 'INVALID_STATUS';
  end if;
  if v_to = 'SHIPPING' and o.payment_method = 'BANK' and o.status = 'PENDING' then raise exception 'PAYMENT_NOT_CONFIRMED'; end if;
  update public.partner_orders set status = v_to, status_note = nullif(left(trim(coalesce(p_note, '')), 200), ''),
    tracking_code = case when v_to = 'SHIPPING' then nullif(left(trim(coalesce(p_tracking, '')), 60), '') else tracking_code end,
    paid_at = case when v_to = 'PAID' then coalesce(paid_at, now()) else paid_at end,
    shipped_at = case when v_to = 'SHIPPING' then now() else shipped_at end,
    done_at = case when v_to = 'DONE' then now() else done_at end
  where id = o.id;
  if v_to = 'CANCELLED' then perform private.shop_restore_stock(o); end if;
  o := (select t from public.partner_orders t where t.id = o.id);
  if o.user_id is not null then
    perform private.notify(o.user_id, null, 'MARKET',
      case v_to when 'PAID' then 'Cửa hàng đã nhận tiền đơn ' || o.code when 'SHIPPING' then 'Đơn ' || o.code || ' đang được giao'
                when 'DONE' then 'Đơn ' || o.code || ' đã hoàn tất' else 'Đơn ' || o.code || ' đã bị huỷ' end,
      coalesce(nullif(trim(coalesce(p_note, '')), ''), case when v_to = 'SHIPPING' and o.tracking_code is not null then 'Mã vận đơn: ' || o.tracking_code end,
               (select p.name from public.partners p where p.id = o.partner_id)),
      '/market/orders', v_uid, true);
  end if;
  return private.shop_order_json(o);
end $$;

revoke all on function private.shop_bank(public.partners), private.shop_settings_json(public.partners, boolean), private.shop_product_json(public.partner_products),
  private.shop_order_json(public.partner_orders), private.shop_restore_stock(public.partner_orders), private.partner_json(public.partners, boolean)
  from public, anon, authenticated;
revoke all on function public.partner_shop(uuid), public.get_shop_product(uuid), public.save_partner_shop(uuid, jsonb), public.save_partner_product(jsonb),
  public.delete_partner_product(uuid), public.place_partner_order(uuid, jsonb, jsonb, text, text), public.my_partner_orders(),
  public.cancel_my_partner_order(uuid), public.partner_orders_admin(uuid, text), public.set_partner_order_status(uuid, text, text, text) from public, anon;
grant execute on function public.partner_shop(uuid), public.get_shop_product(uuid) to anon, authenticated;
grant execute on function public.save_partner_shop(uuid, jsonb), public.save_partner_product(jsonb), public.delete_partner_product(uuid),
  public.place_partner_order(uuid, jsonb, jsonb, text, text), public.my_partner_orders(), public.cancel_my_partner_order(uuid),
  public.partner_orders_admin(uuid, text), public.set_partner_order_status(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001016400_race_search_sources.sql
-- ===================================================================
-- 016400: Nguồn quét kiểu TÌM KIẾM TỪ KHÓA (ngoài kiểu "trang lịch giải" ở 016100).
-- kind = 'PAGE': url là trang lịch giải; kind = 'SEARCH': query là từ khóa (VD "lịch giải marathon 2027 Việt Nam"), việc quét gọi API tìm kiếm web
-- rồi đưa từng kết quả qua cùng bộ đọc + sàng lọc, vào HÀNG CHỜ duyệt. Vẫn không tự đăng.
alter table public.race_sources add column if not exists kind text not null default 'PAGE';
alter table public.race_sources add column if not exists query text;
alter table public.race_sources alter column url drop not null;
alter table public.race_sources drop constraint if exists race_sources_kind_ck;
alter table public.race_sources add constraint race_sources_kind_ck check (
  (kind = 'PAGE' and url is not null and query is null)
  or (kind = 'SEARCH' and query is not null and char_length(btrim(query)) between 3 and 200 and url is null));
create unique index if not exists race_sources_query_uniq on public.race_sources (lower(query)) where query is not null;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001016500_knowledge_scan.sql
-- ===================================================================
-- 016500: Quét & gợi ý TIN KIẾM THỨC cho mục Kiến thức runner (dùng chung bảng nguồn quét của tab Race).
-- • race_sources.target: 'RACE' (giải chạy, như cũ) | 'KNOWLEDGE' (tin / bài kiến thức); category_id = chuyên mục mặc định khi AI không chắc.
-- • knowledge_scan_ingest (CHỈ service_role): tạo bài (NEWS tóm tắt, hoặc ARTICLE nếu nguồn chọn 'Bài đầy đủ') ở trạng thái REVIEW (chờ biên tập), kèm link + tên nguồn gốc.
--   Không bao giờ đăng thẳng. Chuyên mục sức khoẻ / giáo án vẫn bắt buộc duyệt chuyên môn như mọi bài khác (needs_expert_review).
--   Trùng link nguồn với bài đã có thì bỏ qua.
-- Chạy lại nhiều lần vẫn an toàn.
alter table public.race_sources add column if not exists target text not null default 'RACE';
alter table public.race_sources drop constraint if exists race_sources_target_ck;
alter table public.race_sources add constraint race_sources_target_ck check (target in ('RACE', 'KNOWLEDGE'));
-- scan_mode: 'SUMMARY' = tóm tắt ngắn + link nguồn; 'FULL' = AI viết lại thành bài đầy đủ (vẫn vào hàng chờ, biên tập sửa rồi mới đăng)
alter table public.race_sources add column if not exists scan_mode text not null default 'SUMMARY';
alter table public.race_sources drop constraint if exists race_sources_scan_mode_ck;
alter table public.race_sources add constraint race_sources_scan_mode_ck check (scan_mode in ('SUMMARY', 'FULL'));
alter table public.race_sources add column if not exists category_id text references public.content_categories(id) on delete set null;

create or replace function public.knowledge_scan_ingest(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_title text := trim(coalesce(p->>'title', ''));
  v_url text := trim(coalesce(p->>'source_url', ''));
  v_cat text := coalesce(nullif(p->>'category_id', ''), 'RACES');
  v_summary text := nullif(left(trim(coalesce(p->>'summary', '')), 300), '');
  v_name text := nullif(left(trim(coalesce(p->>'source_name', '')), 80), '');
  v_full text := nullif(trim(coalesce(p->>'body', '')), '');
  v_body text;
  v_slug text;
  v_id uuid;
begin
  if char_length(v_title) < 5 or char_length(v_title) > 140 then return null; end if;
  if v_url !~ '^https?://[^[:space:]]+$' or char_length(v_url) > 500 then return null; end if;
  if v_summary is null then return null; end if;
  if not exists (select 1 from public.content_categories c where c.id = v_cat) then v_cat := 'RACES'; end if;
  if exists (select 1 from public.content_articles x where lower(x.source_url) = lower(v_url)) then return null; end if;
  -- Bài đầy đủ chỉ nhận khi đủ dài; không thì lưu dạng tóm tắt
  if v_full is not null and char_length(v_full) between 300 and 30000 then
    v_body := v_full || E'\n\nNguồn: ' || coalesce(v_name, v_url) || ' — ' || v_url;
  else
    v_full := null;
    v_body := v_summary || E'\n\nNguồn: ' || coalesce(v_name, v_url) || ' — ' || v_url;
  end if;
  v_slug := left(coalesce(nullif(private.slugify(v_title), ''), 'tin'), 80) || '-' || substr(md5(lower(v_url)), 1, 6);
  if exists (select 1 from public.content_articles x where x.slug = v_slug) then return null; end if;
  insert into public.content_articles (slug, title, summary, body, category_id, content_type, status, reading_time_minutes,
    source_url, source_name, needs_expert_review, review_note)
  values (v_slug, v_title, v_summary, v_body, v_cat, case when v_full is null then 'NEWS' else 'ARTICLE' end, 'REVIEW',
    private.reading_minutes(v_body), v_url, v_name,
    coalesce((select c.needs_expert from public.content_categories c where c.id = v_cat), false),
    case when v_full is null then 'Tin tự quét: biên tập kiểm tra nội dung và nguồn trước khi đăng'
         else 'Bài AI viết lại từ nguồn: biên tập đọc kỹ, sửa và đối chiếu nguồn trước khi đăng' end)
  returning id into v_id;
  insert into public.content_tags (slug, name)
  select distinct private.slugify(t), left(trim(t), 40) from jsonb_array_elements_text(coalesce(p->'tags', '[]'::jsonb)) t
   where private.slugify(t) <> '' on conflict (slug) do nothing;
  insert into public.content_article_tags (article_id, tag_id)
  select distinct v_id, ct.id from jsonb_array_elements_text(coalesce(p->'tags', '[]'::jsonb)) t
    join public.content_tags ct on ct.slug = private.slugify(t)
  on conflict do nothing;
  return v_id;
end $$;
revoke all on function public.knowledge_scan_ingest(jsonb) from public, anon, authenticated;
grant execute on function public.knowledge_scan_ingest(jsonb) to service_role;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001016600_knowledge_scan_full.sql
-- ===================================================================
-- 016600: Tin kiến thức tự quét — bài đầy đủ phải có ĐỦ nội dung; nâng cấp bản tóm tắt cũ lên bài đầy đủ.
-- • Link nguồn đã có sẽ không còn bị bỏ qua nếu bản cũ là tóm tắt (NEWS) tự quét, đang chờ duyệt và chưa ai sửa: quét lại ở chế độ "Bài đầy đủ" sẽ thay nội dung bằng toàn văn.
--   Bài đã được biên tập sửa / đăng thì không bao giờ bị ghi đè.
-- • Giới hạn toàn văn nhận vào tăng lên 50.000 ký tự.
-- Chạy lại nhiều lần vẫn an toàn.
create or replace function public.knowledge_scan_ingest(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_title text := trim(coalesce(p->>'title', ''));
  v_url text := trim(coalesce(p->>'source_url', ''));
  v_cat text := coalesce(nullif(p->>'category_id', ''), 'RACES');
  v_summary text := nullif(left(trim(coalesce(p->>'summary', '')), 300), '');
  v_name text := nullif(left(trim(coalesce(p->>'source_name', '')), 80), '');
  v_full text := nullif(trim(coalesce(p->>'body', '')), '');
  v_body text;
  v_slug text;
  v_id uuid;
begin
  if char_length(v_title) < 5 or char_length(v_title) > 140 then return null; end if;
  if v_url !~ '^https?://[^[:space:]]+$' or char_length(v_url) > 500 then return null; end if;
  if v_summary is null then return null; end if;
  if not exists (select 1 from public.content_categories c where c.id = v_cat) then v_cat := 'RACES'; end if;
  -- Bài đầy đủ chỉ nhận khi đủ dài; không thì lưu dạng tóm tắt
  if v_full is not null and char_length(v_full) between 300 and 50000 then
    v_body := v_full || E'\n\nNguồn: ' || coalesce(v_name, v_url) || ' — ' || v_url;
  else
    v_full := null;
    v_body := v_summary || E'\n\nNguồn: ' || coalesce(v_name, v_url) || ' — ' || v_url;
  end if;
  -- Link nguồn đã có: chỉ NÂNG CẤP bản tóm tắt tự quét (chưa ai sửa / đăng) lên bài đầy đủ; mọi trường hợp khác bỏ qua
  v_id := (select x.id from public.content_articles x where lower(x.source_url) = lower(v_url) limit 1);
  if v_id is not null then
    if v_full is not null and exists (select 1 from public.content_articles x where x.id = v_id and x.content_type = 'NEWS'
                                       and x.status = 'REVIEW' and x.created_by is null) then
      update public.content_articles set body = v_body, summary = v_summary, content_type = 'ARTICLE', reading_time_minutes = private.reading_minutes(v_body),
        review_note = 'Bài AI viết lại từ nguồn: biên tập đọc kỹ, sửa và đối chiếu nguồn trước khi đăng', updated_at = now()
       where id = v_id;
      return v_id;
    end if;
    return null;
  end if;
  v_slug := left(coalesce(nullif(private.slugify(v_title), ''), 'tin'), 80) || '-' || substr(md5(lower(v_url)), 1, 6);
  if exists (select 1 from public.content_articles x where x.slug = v_slug) then return null; end if;
  insert into public.content_articles (slug, title, summary, body, category_id, content_type, status, reading_time_minutes,
    source_url, source_name, needs_expert_review, review_note)
  values (v_slug, v_title, v_summary, v_body, v_cat, case when v_full is null then 'NEWS' else 'ARTICLE' end, 'REVIEW',
    private.reading_minutes(v_body), v_url, v_name,
    coalesce((select c.needs_expert from public.content_categories c where c.id = v_cat), false),
    case when v_full is null then 'Tin tự quét: biên tập kiểm tra nội dung và nguồn trước khi đăng'
         else 'Bài AI viết lại từ nguồn: biên tập đọc kỹ, sửa và đối chiếu nguồn trước khi đăng' end)
  returning id into v_id;
  insert into public.content_tags (slug, name)
  select distinct private.slugify(t), left(trim(t), 40) from jsonb_array_elements_text(coalesce(p->'tags', '[]'::jsonb)) t
   where private.slugify(t) <> '' on conflict (slug) do nothing;
  insert into public.content_article_tags (article_id, tag_id)
  select distinct v_id, ct.id from jsonb_array_elements_text(coalesce(p->'tags', '[]'::jsonb)) t
    join public.content_tags ct on ct.slug = private.slugify(t)
  on conflict do nothing;
  return v_id;
end $$;
revoke all on function public.knowledge_scan_ingest(jsonb) from public, anon, authenticated;
grant execute on function public.knowledge_scan_ingest(jsonb) to service_role;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001016700_knowledge_delete_published.sql
-- ===================================================================
-- 016700: Kiến thức — admin / biên tập được XOÁ cả bài đã đăng hoặc đã lưu trữ (trước đây chỉ lưu trữ).
-- Người viết thường vẫn chỉ xoá được nháp của mình, chưa từng đăng. Mỗi lần xoá ghi nhật ký CONTENT_DELETE.
-- Chạy lại nhiều lần vẫn an toàn.
create or replace function public.cms_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_role text := private.require_content_staff();
  a public.content_articles := (select x from public.content_articles x where x.id = p_id);
begin
  if a.id is null then raise exception 'ARTICLE_NOT_FOUND'; end if;
  if v_role not in ('ADMIN', 'EDITOR') then
    if a.created_by is distinct from v_uid then raise exception 'FORBIDDEN'; end if;
    if a.published_at is not null and a.published_at <= now() then raise exception 'ARCHIVE_INSTEAD'; end if;
  end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'CONTENT_DELETE', 'article:' || a.id, jsonb_build_object('title', a.title, 'from', a.status));
  delete from public.content_articles where id = a.id;
end $$;
revoke all on function public.cms_delete(uuid) from public, anon;
grant execute on function public.cms_delete(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001016800_hall_of_fame_top3_all_members.sql
-- ===================================================================
-- Đại sảnh CLB: (1) mỗi người hoàn thành Full / Half có thêm top3 = 3 thành tích tốt nhất (giây quy về đúng cự ly, kèm ngày chạy);
-- (2) bảng Km năm liệt kê TẤT CẢ thành viên đã duyệt (kể cả 0 km), không còn cắt top 10. Chỉ đổi hàm club_hall_of_fame, chạy lại an toàn.

create or replace function public.club_hall_of_fame(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_year timestamptz := date_trunc('year', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh';
begin
  if not public.club_is_member(p_club_id) then raise exception 'NOT_A_MEMBER'; end if;
  return (
    with mem as (
      select m.user_id from public.club_members m where m.club_id = p_club_id and m.status = 'APPROVED'
    ), runs as (
      select x.id, x.user_id, x.distance_m, x.moving_time_s, x.started_at
        from public.activities x join mem on mem.user_id = x.user_id
       where x.validation_status = 'APPROVED' and x.shared and public.activity_is_countable(x.status, x.validation_status)
         and coalesce(x.distance_m, 0) > 0
    ), finishers as (
      select r.user_id, d.kind, count(*)::int as times, min(r.started_at) as first_at,
             min(case when r.distance_m <= d.need * 1.06 and r.moving_time_s > 0 then round(r.moving_time_s * d.need / r.distance_m) end)::int as best_s
        from runs r join (values ('FM', 42195::numeric), ('HM', 21097.5)) d(kind, need) on r.distance_m >= d.need
       group by r.user_id, d.kind
    ), best3 as (
      select t.user_id, t.kind, jsonb_agg(jsonb_build_object('best_s', t.secs, 'at', t.started_at, 'km', round(t.distance_m / 1000, 2)) order by t.secs) as top3
        from (
          select r.user_id, d.kind, r.started_at, r.distance_m, round(r.moving_time_s * d.need / r.distance_m)::int as secs,
                 row_number() over (partition by r.user_id, d.kind order by r.moving_time_s * d.need / r.distance_m) as rn
            from runs r join (values ('FM', 42195::numeric), ('HM', 21097.5)) d(kind, need)
              on r.distance_m >= d.need and r.distance_m <= d.need * 1.06 and r.moving_time_s > 0
        ) t where t.rn <= 3 group by t.user_id, t.kind
    ), rec as (
      select d.label, d.need, r.user_id, min(round(r.moving_time_s * d.need / r.distance_m))::int as best_s
        from runs r join (values ('5K', 5000::numeric), ('10K', 10000), ('21K', 21097.5), ('42K', 42195)) d(label, need)
          on r.distance_m >= d.need and r.distance_m <= d.need * 1.05 and r.moving_time_s > 0
       group by d.label, d.need, r.user_id
    ), rec_ranked as (
      select rec.*, row_number() over (partition by rec.label order by rec.best_s) as rn from rec
    ), yr as (
      select mem.user_id, coalesce(sum(r.distance_m), 0) as distance_m, count(r.id)::int as runs,
             row_number() over (order by coalesce(sum(r.distance_m), 0) desc, private.display_name(mem.user_id)) as rn
        from mem left join runs r on r.user_id = mem.user_id and r.started_at >= v_year group by mem.user_id
    ), ms as (
      select um.user_id, um.code, um.reached_at, row_number() over (order by um.reached_at desc) as rn
        from public.user_milestones um join mem on mem.user_id = um.user_id
       where um.activity_id is not null
    )
    select jsonb_build_object(
      'marathon', coalesce((select jsonb_agg(jsonb_build_object('user_id', f.user_id, 'name', private.display_name(f.user_id),
                    'avatar_url', p.avatar_url, 'times', f.times, 'first_at', f.first_at, 'best_s', f.best_s,
                    'top3', coalesce(b.top3, '[]'::jsonb)) order by f.first_at)
                  from finishers f join public.profiles p on p.id = f.user_id
                  left join best3 b on b.user_id = f.user_id and b.kind = f.kind where f.kind = 'FM'), '[]'::jsonb),
      'half', coalesce((select jsonb_agg(jsonb_build_object('user_id', f.user_id, 'name', private.display_name(f.user_id),
                    'avatar_url', p.avatar_url, 'times', f.times, 'first_at', f.first_at, 'best_s', f.best_s,
                    'top3', coalesce(b.top3, '[]'::jsonb)) order by f.first_at)
                  from finishers f join public.profiles p on p.id = f.user_id
                  left join best3 b on b.user_id = f.user_id and b.kind = f.kind where f.kind = 'HM'), '[]'::jsonb),
      'records', coalesce((select jsonb_agg(jsonb_build_object('label', rr.label, 'rank', rr.rn, 'user_id', rr.user_id,
                    'name', private.display_name(rr.user_id), 'avatar_url', p.avatar_url, 'best_s', rr.best_s) order by rr.need, rr.rn)
                  from rec_ranked rr join public.profiles p on p.id = rr.user_id where rr.rn <= 3), '[]'::jsonb),
      'year', coalesce((select jsonb_agg(jsonb_build_object('rank', y.rn, 'user_id', y.user_id, 'name', private.display_name(y.user_id),
                    'avatar_url', p.avatar_url, 'distance_m', y.distance_m, 'runs', y.runs) order by y.rn)
                  from yr y join public.profiles p on p.id = y.user_id ), '[]'::jsonb),
      'milestones', coalesce((select jsonb_agg(jsonb_build_object('user_id', ms.user_id, 'name', private.display_name(ms.user_id),
                    'avatar_url', p.avatar_url, 'code', ms.code, 'label', d.label, 'reached_at', ms.reached_at) order by ms.reached_at desc)
                  from ms join public.profiles p on p.id = ms.user_id join private.milestone_defs() d on d.code = ms.code
                 where ms.rn <= 20), '[]'::jsonb),
      'year_start', v_year));
end $$;

revoke all on function private.milestone_defs(), private.countable_km_m(uuid), private.check_milestones(uuid, uuid),
  private.milestones_on_activity() from public, anon, authenticated;
revoke all on function public.club_hall_of_fame(uuid) from public, anon;
grant execute on function public.club_hall_of_fame(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
