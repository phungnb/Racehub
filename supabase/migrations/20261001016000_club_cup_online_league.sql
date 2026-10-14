-- 016000: GIẢI ONLINE "GIAO LƯU CÁC CLB" — bổ sung luật và tính năng còn thiếu cho Thách đấu CLB nhiều CLB.
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
