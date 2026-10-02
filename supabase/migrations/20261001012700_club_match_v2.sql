-- 012700: THI ĐẤU CLB v2 — một bộ luật cho cả "CLB đấu CLB" (1–1) và "Thách đấu nhiều CLB".
-- • Gộp: trận 1–1 là một thách đấu (club_cups) kind = 'DUEL' có đúng 2 CLB. Trận cũ trong club_battles được chuyển sang
--   (giữ id, giữ cách tính cũ: mọi thành viên, km). Hàm cũ create/respond/cancel_club_battle không dùng nữa.
-- • Luật mới (rules_version = 2), người tạo chọn:
--     - Hình thức: TOTAL (tổng) · AVG (trung bình mỗi VĐV đăng ký) · TOP (cộng top X VĐV giỏi nhất mỗi CLB)
--     - Đo bằng: KM · TIME (thời gian chạy) · PACE (pace đội = tổng thời gian / tổng km của VĐV chạy đủ km tối thiểu; thấp thắng)
--     - Số VĐV tối thiểu / tối đa mỗi bên; thiếu tối thiểu lúc chốt → xử thua (FORFEIT) hoặc hủy trận (CANCEL)
--     - Trần mỗi ngày (mặc định 42 km/người/ngày; thời gian tính theo tỉ lệ) và trần đóng góp (% tổng của đội, tùy chọn)
--     - Tiêu chí phụ khi hòa: nhiều người chạy hơn → nhiều ngày chạy hơn → hòa
--     - Chốt danh sách trước giờ G (mặc định 1 giờ): sau đó không đăng ký / rút được
-- • Đăng ký: chỉ thành viên vào CLB TRƯỚC khi trận được tạo (1–1) / trước khi CLB vào giải (nhiều CLB); mỗi người một CLB.
-- • Thương lượng (1–1): CLB được mời Nhận lời / Từ chối (kèm lý do) / Đề xuất lại điều khoản; mỗi lần đổi là một phiên bản,
--   nhận lời xong điều khoản bị khóa. Lời mời không trả lời trước giờ chốt danh sách → hết hạn.
-- • Kết quả 2 bước: hết giờ → KẾT QUẢ TẠM (báo ban quản trị số bài đang chờ duyệt) → sau 48 giờ → CHÍNH THỨC + trao thưởng.
-- • Thưởng (không cộng Xu): huy hiệu "Chiến thắng đấu CLB" cho VĐV đã chạy của CLB thắng, "MVP đấu CLB" cho người đóng góp
--   nhiều nhất trận; điểm uy tín CLB (Elo, chỉ trận 1–1) + chuỗi thắng; danh hiệu "Nhà vô địch" 7 ngày trên trang CLB.
-- • Chỉ tính bài chạy hợp lệ (APPROVED), được chia sẻ, không bị bỏ qua duyệt, bắt đầu trong khung giờ — như mọi BXH.
-- Cần 003600, 011700. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

-- ---------------------------------------------------------------------
-- 1. Cột / bảng mới
-- ---------------------------------------------------------------------
alter table public.club_cups add column if not exists kind text not null default 'CUP';
alter table public.club_cups add column if not exists rules_version integer;
alter table public.club_cups add column if not exists opponent_club_id uuid references public.clubs(id) on delete cascade;
alter table public.club_cups add column if not exists format text not null default 'AVG';
alter table public.club_cups add column if not exists measure text not null default 'KM';
alter table public.club_cups add column if not exists top_n integer;
alter table public.club_cups add column if not exists min_roster integer not null default 1;
alter table public.club_cups add column if not exists max_roster integer;
alter table public.club_cups add column if not exists daily_cap_km numeric;
alter table public.club_cups add column if not exists share_cap_pct integer;
alter table public.club_cups add column if not exists pace_min_km numeric not null default 5;
alter table public.club_cups add column if not exists tiebreak text not null default 'PARTICIPANTS';
alter table public.club_cups add column if not exists lock_hours integer not null default 1;
alter table public.club_cups add column if not exists roster_close_at timestamptz;
alter table public.club_cups add column if not exists forfeit_rule text not null default 'FORFEIT';
alter table public.club_cups add column if not exists final_delay_hours integer not null default 48;
alter table public.club_cups add column if not exists terms_version integer not null default 1;
alter table public.club_cups add column if not exists awaiting_club_id uuid references public.clubs(id) on delete set null;
alter table public.club_cups add column if not exists negotiation jsonb not null default '[]'::jsonb;
alter table public.club_cups add column if not exists decline_reason text;
alter table public.club_cups add column if not exists cancel_reason text;
alter table public.club_cups add column if not exists accepted_at timestamptz;
alter table public.club_cups add column if not exists reminded_at timestamptz;
alter table public.club_cups add column if not exists locked_at timestamptz;
alter table public.club_cups add column if not exists provisional_at timestamptz;
alter table public.club_cups add column if not exists final_at timestamptz;
alter table public.club_cups add column if not exists legacy_battle_id uuid;
create unique index if not exists club_cups_legacy_battle_idx on public.club_cups (legacy_battle_id) where legacy_battle_id is not null;
create index if not exists club_cups_kind_idx on public.club_cups (kind, status, start_at desc);
create index if not exists club_cups_opponent_idx on public.club_cups (opponent_club_id) where opponent_club_id is not null;

-- Thách đấu cũ tính tổng km giữ đúng cách tính
update public.club_cups set format = 'TOTAL' where rules_version is null and metric = 'TOTAL_KM' and format <> 'TOTAL';
update public.club_cups set final_delay_hours = 2 where rules_version is null and final_delay_hours <> 2;

alter table public.club_cups drop constraint if exists club_cups_status_chk;
alter table public.club_cups add constraint club_cups_status_chk check (status in
  ('PENDING_REVIEW', 'INVITED', 'OPEN', 'PROVISIONAL', 'FINISHED', 'REJECTED', 'DECLINED', 'EXPIRED', 'CANCELLED'));
alter table public.club_cups drop constraint if exists club_cups_kind_chk;
alter table public.club_cups add constraint club_cups_kind_chk check (kind in ('CUP', 'DUEL'));
alter table public.club_cups drop constraint if exists club_cups_rules_chk;
alter table public.club_cups add constraint club_cups_rules_chk check (
  format in ('TOTAL', 'AVG', 'TOP') and measure in ('KM', 'TIME', 'PACE')
  and (format <> 'TOP' or top_n between 1 and 50)
  and min_roster between 1 and 100 and (max_roster is null or max_roster between min_roster and 500)
  and (daily_cap_km is null or daily_cap_km between 5 and 100)
  and (share_cap_pct is null or share_cap_pct between 20 and 60)
  and pace_min_km between 1 and 42.2
  and tiebreak in ('PARTICIPANTS', 'DAYS', 'NONE')
  and lock_hours between 0 and 72 and forfeit_rule in ('FORFEIT', 'CANCEL')
  and final_delay_hours between 0 and 168);

alter table public.club_cup_entries add column if not exists forfeited boolean not null default false;

-- Điểm uy tín CLB (Elo) — chỉ trận 1–1 có luật mới
create table if not exists public.club_match_ratings (
  club_id uuid primary key references public.clubs(id) on delete cascade,
  rating integer not null default 1000,
  played integer not null default 0,
  wins integer not null default 0,
  draws integer not null default 0,
  losses integer not null default 0,
  streak integer not null default 0,
  best_streak integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.club_match_ratings enable row level security;
revoke all on public.club_match_ratings from anon, authenticated;

insert into public.achievements (code, title, description, category, tier, icon, rule, xp_reward, xu_reward, sort) values
  ('CLUB_MATCH_WIN', 'Chiến thắng đấu CLB', 'Thi đấu và góp km cho CLB thắng một trận đấu CLB', 'SOCIAL', 'GOLD', 'Trophy', null, 0, 0, 72),
  ('CLUB_MATCH_MVP', 'MVP đấu CLB', 'Người đóng góp nhiều nhất một trận đấu CLB', 'SOCIAL', 'LEGEND', 'Crown', null, 0, 0, 73)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 2. Hàm phụ
-- ---------------------------------------------------------------------
create or replace function private.match_kind_note(u public.club_cups) returns text
language sql immutable as $$ select case u.kind when 'DUEL' then 'CLUB_BATTLE' else 'CLUB_CUP' end $$;

-- Thời điểm thành viên phải vào CLB trước đó mới được đăng ký (1–1: lúc tạo trận; nhiều CLB: lúc CLB vào giải)
create or replace function private.match_cutoff(u public.club_cups, p_club uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select case when u.kind = 'DUEL' then u.created_at
              else coalesce((select ce.registered_at from public.club_cup_entries ce where ce.cup_id = u.id and ce.club_id = p_club), u.created_at) end
$$;

create or replace function private.fmt_pace(p_s numeric) returns text
language sql immutable as $$
  select case when p_s is null then '—' else (round(p_s)::int / 60) || ':' || lpad((round(p_s)::int % 60)::text, 2, '0') || '/km' end
$$;

-- Điểm của một CLB dạng chữ (thông báo)
create or replace function private.match_score_text(u public.club_cups, p_score numeric) returns text
language sql immutable as $$
  select case
    when p_score is null then 'chưa có điểm'
    when u.measure = 'PACE' then private.fmt_pace(p_score)
    when u.measure = 'TIME' then round(p_score / 3600.0, 1) || ' giờ' || case when u.format = 'AVG' then '/người' else '' end
    else round(p_score, 2) || ' km' || case when u.format = 'AVG' then '/người' else '' end end
$$;

-- Kiểm tra + chuẩn hóa điều khoản trận (tạo / đề xuất lại). Trả về jsonb đã chuẩn hóa hoặc báo lỗi.
create or replace function private.match_terms(p jsonb, p_kind text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_format text := upper(coalesce(nullif(p->>'format', ''), 'AVG'));
  v_measure text := upper(coalesce(nullif(p->>'measure', ''), 'KM'));
  v_top integer := nullif(p->>'top_n', '')::integer;
  v_min integer := coalesce(nullif(p->>'min_roster', '')::integer, 1);
  v_max integer := nullif(p->>'max_roster', '')::integer;
  v_cap numeric := case when p ? 'daily_cap_km' then nullif(p->>'daily_cap_km', '')::numeric else 42 end;
  v_share integer := nullif(p->>'share_cap_pct', '')::integer;
  v_pmin numeric := coalesce(nullif(p->>'pace_min_km', '')::numeric, 5);
  v_tb text := upper(coalesce(nullif(p->>'tiebreak', ''), 'PARTICIPANTS'));
  v_lock integer := coalesce(nullif(p->>'lock_hours', '')::integer, 1);
  v_forfeit text := upper(coalesce(nullif(p->>'forfeit_rule', ''), 'FORFEIT'));
  v_start timestamptz := nullif(p->>'start_at', '')::timestamptz;
  v_end timestamptz := nullif(p->>'end_at', '')::timestamptz;
  v_maxdur interval;
begin
  if v_format not in ('TOTAL', 'AVG', 'TOP') then raise exception 'INVALID_FORMAT'; end if;
  if v_measure not in ('KM', 'TIME', 'PACE') then raise exception 'INVALID_MEASURE'; end if;
  if v_measure = 'PACE' and v_format = 'TOTAL' then v_format := 'AVG'; end if;     -- "tổng pace" vô nghĩa → pace cả đội
  if v_format = 'TOP' and (v_top is null or v_top not between 1 and 50) then raise exception 'INVALID_TOP_N'; end if;
  if v_format <> 'TOP' then v_top := null; end if;
  if v_min not between 1 and 100 then raise exception 'INVALID_ROSTER'; end if;
  if v_max is not null and v_max not between v_min and 500 then raise exception 'INVALID_ROSTER'; end if;
  if v_format = 'TOP' and v_min < v_top then v_min := v_top; end if;               -- top X cần ít nhất X người
  if v_max is not null and v_max < v_min then raise exception 'INVALID_ROSTER'; end if;
  if v_cap is not null and v_cap not between 5 and 100 then raise exception 'INVALID_DAILY_CAP'; end if;
  if v_share is not null and v_share not between 20 and 60 then raise exception 'INVALID_SHARE_CAP'; end if;
  if v_pmin not between 1 and 42.2 then raise exception 'INVALID_PACE_MIN'; end if;
  if v_tb not in ('PARTICIPANTS', 'DAYS', 'NONE') then raise exception 'INVALID_TIEBREAK'; end if;
  if v_lock not between 0 and 72 then raise exception 'INVALID_LOCK'; end if;
  if v_forfeit not in ('FORFEIT', 'CANCEL') then raise exception 'INVALID_FORFEIT'; end if;
  if v_start is null or v_end is null or v_end <= v_start then raise exception 'INVALID_TIME_RANGE'; end if;
  if v_start < now() - interval '10 minutes' then raise exception 'START_IN_PAST'; end if;
  v_maxdur := case when p_kind = 'DUEL' then interval '62 days' else interval '93 days' end;
  if v_end - v_start < interval '1 day' or v_end - v_start > v_maxdur then raise exception 'INVALID_DURATION'; end if;
  if v_start - make_interval(hours => v_lock) < now() + interval '30 minutes' then raise exception 'LOCK_TOO_SOON'; end if;
  return jsonb_build_object('format', v_format, 'measure', v_measure, 'top_n', v_top, 'min_roster', v_min, 'max_roster', v_max,
    'daily_cap_km', v_cap, 'share_cap_pct', v_share, 'pace_min_km', v_pmin, 'tiebreak', v_tb, 'lock_hours', v_lock,
    'forfeit_rule', v_forfeit, 'start_at', v_start, 'end_at', v_end, 'roster_close_at', v_start - make_interval(hours => v_lock));
end $$;

create or replace function private.match_terms_of(u public.club_cups) returns jsonb
language sql stable as $$
  select jsonb_build_object('format', u.format, 'measure', u.measure, 'top_n', u.top_n, 'min_roster', u.min_roster, 'max_roster', u.max_roster,
    'daily_cap_km', u.daily_cap_km, 'share_cap_pct', u.share_cap_pct, 'pace_min_km', u.pace_min_km, 'tiebreak', u.tiebreak,
    'lock_hours', u.lock_hours, 'forfeit_rule', u.forfeit_rule, 'start_at', u.start_at, 'end_at', u.end_at, 'roster_close_at', u.roster_close_at)
$$;

-- ---------------------------------------------------------------------
-- 3. Tính điểm
-- ---------------------------------------------------------------------
-- Mỗi VĐV được tính (danh sách thi đấu): km (đã áp trần ngày), km gốc, thời gian (tỉ lệ theo trần), số ngày, số buổi.
-- Người đã đăng ký mà chưa chạy vẫn có dòng (0) — để thấy danh sách và để chia trung bình.
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

-- Giá trị đóng góp từng VĐV sau trần đóng góp (% tổng đội); pace: "pace_s" + đủ km tối thiểu mới được xét
create or replace function private.match_values(u public.club_cups, p_end timestamptz)
returns table (club_id uuid, user_id uuid, km numeric, raw_km numeric, time_s numeric, days integer, runs integer,
               val numeric, pace_s numeric, qualified boolean, rn_val bigint, rn_pace bigint)
language sql stable security definer set search_path = public as $$
  with x as (
    select * from private.match_runner_rows(u.id, u.start_at, p_end, u.daily_cap_km)
  ), v as (
    select x.*, case u.measure when 'TIME' then x.time_s else x.km end as v0,
           sum(case u.measure when 'TIME' then x.time_s else x.km end) over (partition by x.club_id) as team_raw
      from x
  ), w as (
    select v.club_id, v.user_id, v.km, v.raw_km, v.time_s, v.days, v.runs,
           case when u.share_cap_pct is not null and u.measure <> 'PACE' then least(v.v0, v.team_raw * u.share_cap_pct / 100.0) else v.v0 end as val,
           case when v.km > 0 then round(v.time_s / v.km) end as pace_s,
           (v.km >= u.pace_min_km and v.km > 0 and v.time_s > 0) as qualified
      from v
  )
  select w.*,
         row_number() over (partition by w.club_id order by w.val desc, w.user_id),
         row_number() over (partition by w.club_id order by case when w.qualified then w.pace_s end asc nulls last, w.user_id)
    from w
$$;

create or replace function private.match_standings(u public.club_cups, p_end timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
  with w as (
    select * from private.match_values(u, p_end)
  ), e as (
    select ce.club_id, ce.forfeited from public.club_cup_entries ce where ce.cup_id = u.id
  ), agg as (
    select e.club_id, e.forfeited,
           count(w.user_id) as roster,
           count(w.user_id) filter (where w.runs > 0) as runners,
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
           case u.tiebreak when 'PARTICIPANTS' then agg.runners when 'DAYS' then agg.days else 0 end as tb
      from agg
  ), ranked as (
    select s.*, rank() over (order by s.forfeited, (s.score is null and u.measure = 'PACE'),
                                      case when u.measure = 'PACE' then s.score end asc,
                                      case when u.measure <> 'PACE' then s.score end desc,
                                      s.tb desc) as rnk
      from s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'rank', r.rnk, 'club_id', c.id, 'name', c.name, 'avatar_url', c.avatar_url, 'accent_color', c.accent_color,
           'members', r.roster, 'runners', r.runners, 'km', round(r.km, 2), 'avg_km', round(r.km / greatest(r.roster, 1), 2),
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

-- Người đóng góp nhiều nhất trận (pace: nhanh nhất trong những người chạy đủ km tối thiểu)
create or replace function private.match_mvp(u public.club_cups, p_end timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
  with v as (
    select v.* from private.match_values(u, p_end) v
      join public.club_cup_entries ce on ce.cup_id = u.id and ce.club_id = v.club_id and not ce.forfeited
     where v.runs > 0 and (u.measure <> 'PACE' or v.qualified)
  ), w as (
    select v.*, row_number() over (order by case when u.measure = 'PACE' then null else v.val end desc nulls last,
                                            case when u.measure = 'PACE' then v.pace_s end asc nulls last,
                                            v.km desc, v.user_id) as rk
      from v
  )
  select (select jsonb_build_object('user_id', w.user_id, 'club_id', w.club_id, 'display_name', private.display_name(w.user_id),
                                    'avatar_url', p.avatar_url, 'km', round(w.km, 2), 'time_s', w.time_s, 'pace_s', w.pace_s, 'value', round(w.val, 2))
            from w join public.profiles p on p.id = w.user_id where w.rk = 1)
$$;

-- Giai đoạn để hiển thị
create or replace function private.match_phase(u public.club_cups) returns text
language sql stable as $$
  select case
    when u.status in ('PENDING_REVIEW', 'INVITED', 'REJECTED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'PROVISIONAL', 'FINISHED') then u.status
    when now() < coalesce(u.roster_close_at, u.start_at) then 'REGISTRATION'
    when now() < u.start_at then 'LOCKED'
    when now() < u.end_at then 'LIVE'
    else 'SETTLING' end
$$;

-- ---------------------------------------------------------------------
-- 4. Chốt kết quả, thưởng, điểm uy tín
-- ---------------------------------------------------------------------
create or replace function private.match_badge(p_user uuid, p_code text, p_link text) returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid := (select a.id from public.achievements a where a.code = p_code); v_title text; v_n integer;
begin
  if v_id is null or p_user is null then return; end if;
  insert into public.user_achievements (user_id, achievement_id) values (p_user, v_id) on conflict do nothing;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    v_title := (select a.title from public.achievements a where a.id = v_id);
    perform private.notify(p_user, null, 'BADGE', 'Huy hiệu mới: ' || v_title, null, p_link, null, true);
  end if;
end $$;

-- Elo K=32: thắng CLB mạnh hơn được nhiều điểm hơn; p_sa = 1 (A thắng) / 0.5 (hòa) / 0 (A thua)
create or replace function private.match_elo(p_a uuid, p_b uuid, p_sa numeric) returns void
language plpgsql security definer set search_path = public as $$
declare ra numeric; rb numeric; ea numeric;
begin
  insert into public.club_match_ratings (club_id) values (p_a), (p_b) on conflict (club_id) do nothing;
  ra := (select rating from public.club_match_ratings where club_id = p_a);
  rb := (select rating from public.club_match_ratings where club_id = p_b);
  ea := 1 / (1 + power(10::numeric, (rb - ra) / 400.0));
  update public.club_match_ratings set rating = greatest(100, round(ra + 32 * (p_sa - ea))), played = played + 1,
         wins = wins + (p_sa = 1)::int, draws = draws + (p_sa = 0.5)::int, losses = losses + (p_sa = 0)::int,
         streak = case when p_sa = 1 then greatest(streak, 0) + 1 when p_sa = 0 then least(streak, 0) - 1 else 0 end,
         best_streak = greatest(best_streak, case when p_sa = 1 then greatest(streak, 0) + 1 else 0 end), updated_at = now()
   where club_id = p_a;
  update public.club_match_ratings set rating = greatest(100, round(rb + 32 * ((1 - p_sa) - (1 - ea)))), played = played + 1,
         wins = wins + (p_sa = 0)::int, draws = draws + (p_sa = 0.5)::int, losses = losses + (p_sa = 1)::int,
         streak = case when p_sa = 0 then greatest(streak, 0) + 1 when p_sa = 1 then least(streak, 0) - 1 else 0 end,
         best_streak = greatest(best_streak, case when p_sa = 0 then greatest(streak, 0) + 1 else 0 end), updated_at = now()
   where club_id = p_b;
end $$;

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

-- Chuyển trạng thái một trận theo thời gian (idempotent; gọi khi mở trang + cron hằng ngày)
create or replace function private.match_tick(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  u public.club_cups := (select x from public.club_cups x where x.id = p_id);
  v_n integer; v_short integer; m record; e record; v_pending integer; v_kind text; v_link text; s jsonb; v_close text;
begin
  if u.id is null then return; end if;
  v_kind := private.match_kind_note(u);
  v_link := '/cups/' || u.id;

  -- 1. Lời mời 1–1 không được trả lời trước giờ chốt danh sách → hết hạn
  if u.status = 'INVITED' then
    if now() >= coalesce(u.roster_close_at, u.start_at) then
      update public.club_cups set status = 'EXPIRED' where id = u.id and status = 'INVITED';
      get diagnostics v_n = row_count;
      if v_n > 0 then
        perform private.notify_club(u.host_club_id, true, v_kind, 'Lời thách đấu "' || u.title || '" đã hết hạn', 'Đối thủ chưa trả lời trước giờ chốt danh sách.', v_link, null);
        perform private.notify_club(u.opponent_club_id, true, v_kind, 'Lời thách đấu "' || u.title || '" đã hết hạn', null, v_link, null);
      end if;
    end if;
    return;
  end if;

  if u.status = 'OPEN' and u.rules_version is not null then
    v_close := to_char(u.roster_close_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM');
    -- 2. Nhắc thành viên đủ điều kiện mà chưa đăng ký (một lần, khoảng 1 ngày trước giờ chốt)
    if u.reminded_at is null and now() >= u.roster_close_at - interval '26 hours' and now() < u.roster_close_at then
      update public.club_cups set reminded_at = now() where id = u.id and reminded_at is null;
      get diagnostics v_n = row_count;
      if v_n > 0 then
        for m in select cm.user_id, cm.club_id from public.club_members cm
                   join public.club_cup_entries ce on ce.cup_id = u.id and ce.club_id = cm.club_id
                  where cm.status = 'APPROVED' and cm.joined_at <= private.match_cutoff(u, cm.club_id)
                    and not exists (select 1 from public.club_cup_members x where x.cup_id = u.id and x.user_id = cm.user_id) loop
          perform private.notify(m.user_id, m.club_id, v_kind, 'Sắp chốt danh sách: ' || u.title,
            'Bấm để đăng ký thi đấu trước ' || v_close || ' — chỉ người đã đăng ký mới được tính cho CLB.', v_link, null, true);
        end loop;
      end if;
    end if;
    -- 3. Chốt danh sách: CLB thiếu VĐV tối thiểu → xử thua / hủy trận (theo luật đã chọn)
    if u.locked_at is null and now() >= u.roster_close_at then
      update public.club_cups set locked_at = now() where id = u.id and locked_at is null;
      get diagnostics v_n = row_count;
      if v_n > 0 then
        update public.club_cup_entries ce set forfeited = true
         where ce.cup_id = u.id
           and (select count(*) from public.club_cup_members x where x.cup_id = u.id and x.club_id = ce.club_id) < u.min_roster;
        v_short := (select count(*) from public.club_cup_entries ce where ce.cup_id = u.id and ce.forfeited);
        if u.kind = 'DUEL' and (v_short = 2 or (v_short = 1 and u.forfeit_rule = 'CANCEL')) then
          update public.club_cups set status = 'CANCELLED', cancel_reason = 'Không đủ ' || u.min_roster || ' VĐV đăng ký lúc chốt danh sách'
           where id = u.id;
          for e in select ce.club_id from public.club_cup_entries ce where ce.cup_id = u.id loop
            perform private.notify_club(e.club_id, false, v_kind, 'Trận "' || u.title || '" đã hủy',
              'Không đủ ' || u.min_roster || ' VĐV đăng ký lúc chốt danh sách.', v_link, null);
          end loop;
          return;
        end if;
        for m in select x.user_id, x.club_id from public.club_cup_members x where x.cup_id = u.id loop
          perform private.notify(m.user_id, m.club_id, v_kind, 'Đã chốt danh sách: ' || u.title,
            'Bắt đầu ' || to_char(u.start_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM') || '. Mọi bài chạy hợp lệ trong giờ thi đấu đều tính cho CLB!',
            v_link, null, false);
        end loop;
        for e in select ce.club_id from public.club_cup_entries ce where ce.cup_id = u.id and ce.forfeited loop
          perform private.notify_club(e.club_id, true, v_kind, 'CLB bị xử thua "' || u.title || '"',
            'Chưa đủ ' || u.min_roster || ' VĐV đăng ký lúc chốt danh sách.', v_link, null);
        end loop;
      end if;
    end if;
  end if;

  u := (select x from public.club_cups x where x.id = p_id);
  -- 4. Hết giờ → kết quả tạm (luật mới) / chốt luôn sau 2 giờ (trận cũ)
  if u.status = 'OPEN' and now() >= u.end_at then
    if u.rules_version is null then
      if now() >= u.end_at + make_interval(hours => u.final_delay_hours) then perform private.match_finalize(u.id); end if;
      return;
    end if;
    update public.club_cups set status = 'PROVISIONAL', provisional_at = now() where id = u.id and status = 'OPEN';
    get diagnostics v_n = row_count;
    if v_n > 0 then
      s := private.match_standings(u, u.end_at);
      for e in select (x->>'club_id')::uuid as club_id, x->>'score' as score, (x->>'rank')::int as rk from jsonb_array_elements(s) x loop
        perform private.notify_club(e.club_id, false, v_kind, 'Kết quả tạm: ' || u.title,
          'Hạng ' || e.rk || ' · ' || private.match_score_text(u, nullif(e.score, '')::numeric)
            || '. Kết quả chính thức sau ' || u.final_delay_hours || ' giờ (chờ bài đồng bộ muộn và bài đang duyệt).', v_link, null);
        -- Báo ban quản trị số bài của VĐV đang chờ duyệt — duyệt trước giờ chốt chính thức
        v_pending := (select count(*) from public.activities a
                        join public.club_cup_members x on x.cup_id = u.id and x.user_id = a.user_id and x.club_id = e.club_id
                       where a.validation_status = 'PENDING' and coalesce(a.status, '') <> 'DELETED'
                         and a.started_at >= u.start_at and a.started_at < u.end_at);
        if v_pending > 0 then
          perform private.notify_club(e.club_id, true, v_kind, v_pending || ' bài chạy thi đấu đang chờ duyệt',
            'Duyệt trước ' || to_char((u.end_at + make_interval(hours => u.final_delay_hours)) at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM')
              || ' để được tính vào kết quả "' || u.title || '".', '/clubs/' || e.club_id || '/members', null);
        end if;
      end loop;
    end if;
    u := (select x from public.club_cups x where x.id = p_id);
  end if;
  -- 5. Hết thời gian chờ → kết quả chính thức + thưởng
  if u.status = 'PROVISIONAL' and now() >= u.end_at + make_interval(hours => u.final_delay_hours) then
    perform private.match_finalize(u.id);
  end if;
end $$;

-- Cron hằng ngày (service role): mọi trận cần chuyển trạng thái
create or replace function public.settle_due_club_cups() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in select x.id from public.club_cups x
            where (x.status = 'INVITED' and now() >= coalesce(x.roster_close_at, x.start_at))
               or (x.status = 'OPEN' and (now() >= x.end_at
                    or (x.rules_version is not null and x.locked_at is null and now() >= x.roster_close_at)
                    or (x.rules_version is not null and x.reminded_at is null and now() >= x.roster_close_at - interval '26 hours')))
               or (x.status = 'PROVISIONAL' and now() >= x.end_at + make_interval(hours => x.final_delay_hours)) loop
    perform private.match_tick(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 5. Xem
-- ---------------------------------------------------------------------
create or replace function private.club_brief(p_club uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url, 'accent_color', c.accent_color)
    from public.clubs c where c.id = p_club
$$;

create or replace function private.cup_visible(u public.club_cups) returns boolean
language sql stable security definer set search_path = public as $$
  select u.status in ('OPEN', 'PROVISIONAL', 'FINISHED', 'CANCELLED') or u.created_by = auth.uid() or public.is_system_admin()
      or (u.host_club_id is not null and public.club_is_staff(u.host_club_id))
      or (u.opponent_club_id is not null and public.club_is_staff(u.opponent_club_id))
      -- 1–1 đã từ chối / hết hạn: thành viên hai CLB vẫn xem lại được
      or (u.kind = 'DUEL' and (public.club_is_member(u.host_club_id) or public.club_is_member(u.opponent_club_id)))
$$;

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
    'clubs', (select count(*) from public.club_cup_entries ce where ce.cup_id = u.id),
    'my_clubs', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url, 'accent_color', c.accent_color,
                         'staff', m.role in ('OWNER', 'CAPTAIN') or public.is_system_admin(),
                         'joined', ce.club_id is not null,
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
$$;

create or replace function public.club_cup(p_cup_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u public.club_cups;
begin
  perform private.match_tick(p_cup_id);
  u := (select x from public.club_cups x where x.id = p_cup_id);
  if u.id is null or not private.cup_visible(u) then raise exception 'CUP_NOT_FOUND'; end if;
  return private.cup_json(u, true);
end $$;

-- Trang Thách đấu: chỉ giải nhiều CLB (trận 1–1 xem ở tab Đấu CLB của mỗi CLB)
create or replace function public.list_club_cups(p_scope text default 'ACTIVE') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  if p_scope = 'REVIEW' and not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(private.cup_json(x.cup, false) order by x.rn), '[]'::jsonb) from (
    select u as cup, row_number() over (order by
             case when p_scope = 'DONE' then extract(epoch from u.end_at) * -1 else extract(epoch from u.start_at) end) as rn
      from public.club_cups u
     where u.kind = 'CUP' and private.cup_visible(u)
       and case p_scope
             when 'ACTIVE' then u.status in ('OPEN', 'PROVISIONAL')
             when 'DONE' then u.status in ('FINISHED', 'CANCELLED')
             when 'REVIEW' then u.status = 'PENDING_REVIEW'
             else u.created_by = v_uid
               or exists (select 1 from public.club_cup_entries ce join public.club_members m on m.club_id = ce.club_id
                           where ce.cup_id = u.id and m.user_id = v_uid and m.status = 'APPROVED')
           end) x
   where x.rn <= 60);
end $$;

-- BXH VĐV của một CLB trong trận: người đã đăng ký (kể cả chưa chạy), km tính / km gốc, ngày, pace, giá trị đóng góp
create or replace function public.club_cup_club_board(p_cup_id uuid, p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  u public.club_cups := (select x from public.club_cups x where x.id = p_cup_id);
  v_end timestamptz;
begin
  if u.id is null or not private.cup_visible(u) then raise exception 'CUP_NOT_FOUND'; end if;
  if not exists (select 1 from public.club_cup_entries ce where ce.cup_id = u.id and ce.club_id = p_club_id) then raise exception 'CLUB_NOT_IN_CUP'; end if;
  v_end := least(u.end_at, greatest(now(), u.start_at));
  return jsonb_build_object(
    'club', private.club_brief(p_club_id),
    'measure', u.measure, 'format', u.format, 'top_n', u.top_n, 'pace_min_km', u.pace_min_km, 'daily_cap_km', u.daily_cap_km,
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
               'rank', t.rk, 'user_id', t.user_id, 'display_name', p.display_name, 'avatar_url', p.avatar_url,
               'km', round(t.km, 2), 'raw_km', round(t.raw_km, 2), 'runs', t.runs, 'days', t.days, 'moving_s', t.time_s,
               'pace_s', t.pace_s, 'qualified', t.qualified, 'value', round(t.val, 2),
               'counted', case when u.measure = 'PACE' then t.qualified and (u.format <> 'TOP' or t.rn_pace <= u.top_n)
                               when u.format = 'TOP' then t.rn_val <= u.top_n and t.runs > 0 else t.runs > 0 end)
             order by t.rk, p.display_name), '[]'::jsonb)
               from (select v.*, case when u.measure = 'PACE' then v.rn_pace else v.rn_val end as rk
                       from private.match_values(u, v_end) v where v.club_id = p_club_id) t
               join public.profiles p on p.id = t.user_id));
end $$;

-- Tổng quan đấu CLB của một CLB: điểm uy tín, thành tích, danh hiệu vô địch 7 ngày, trận đang diễn ra / chờ, trận gần đây
create or replace function public.club_match_summary(p_club_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  perform private.require_uid();
  if not exists (select 1 from public.clubs c where c.id = p_club_id) then raise exception 'CLUB_NOT_FOUND'; end if;
  for r in select x.id from public.club_cups x
            where (x.host_club_id = p_club_id or x.opponent_club_id = p_club_id
                   or exists (select 1 from public.club_cup_entries ce where ce.cup_id = x.id and ce.club_id = p_club_id))
              and x.status in ('INVITED', 'OPEN', 'PROVISIONAL') loop
    perform private.match_tick(r.id);
  end loop;
  return jsonb_build_object(
    'can_challenge', public.club_is_staff(p_club_id),
    'rating', (select jsonb_build_object('rating', g.rating, 'played', g.played, 'wins', g.wins, 'draws', g.draws, 'losses', g.losses,
                                         'streak', g.streak, 'best_streak', g.best_streak)
                 from public.club_match_ratings g where g.club_id = p_club_id),
    'rank', (select count(*) + 1 from public.club_match_ratings g
              where g.played > 0 and g.rating > coalesce((select h.rating from public.club_match_ratings h where h.club_id = p_club_id), 1000)),
    'champion', (select jsonb_build_object('cup_id', t.id, 'title', t.title, 'kind', t.kind, 'final_at', t.final_at,
                                           'until', t.final_at + interval '7 days')
                   from (select x.id, x.title, x.kind, x.final_at, row_number() over (order by x.final_at desc) as rn
                           from public.club_cups x
                          where x.status = 'FINISHED' and x.final_at > now() - interval '7 days'
                            and (x.result->>'winner_id') = p_club_id::text) t
                  where t.rn = 1),
    'active', (select coalesce(jsonb_agg(private.cup_json(x, true) order by x.start_at), '[]'::jsonb)
                 from public.club_cups x
                where (x.host_club_id = p_club_id or x.opponent_club_id = p_club_id
                       or exists (select 1 from public.club_cup_entries ce where ce.cup_id = x.id and ce.club_id = p_club_id))
                  and (x.status in ('OPEN', 'PROVISIONAL') or (x.status = 'INVITED' and private.cup_visible(x)))),
    'recent', (select coalesce(jsonb_agg(private.cup_json(t.x, false) order by t.ord desc), '[]'::jsonb)
                 from (select x, coalesce(x.final_at, x.settled_at, x.end_at) as ord,
                              row_number() over (order by coalesce(x.final_at, x.settled_at, x.end_at) desc) as rn
                         from public.club_cups x
                        where (x.host_club_id = p_club_id or x.opponent_club_id = p_club_id
                               or exists (select 1 from public.club_cup_entries ce where ce.cup_id = x.id and ce.club_id = p_club_id))
                          and x.status in ('FINISHED', 'DECLINED', 'EXPIRED', 'CANCELLED') and private.cup_visible(x)) t
                where t.rn <= 15));
end $$;

-- Trang chủ: các trận của các CLB tôi đang ở — cần đăng ký / đang đấu / kết quả tạm; lời mời chờ tôi (ban quản trị) trả lời
create or replace function public.my_club_matches() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); r record;
begin
  for r in select x.id from public.club_cups x
            where x.status in ('INVITED', 'OPEN', 'PROVISIONAL')
              and (exists (select 1 from public.club_cup_entries ce join public.club_members m on m.club_id = ce.club_id
                            where ce.cup_id = x.id and m.user_id = v_uid and m.status = 'APPROVED')
                   or (x.status = 'INVITED' and public.club_is_staff(x.awaiting_club_id))) loop
    perform private.match_tick(r.id);
  end loop;
  return (select coalesce(jsonb_agg(private.cup_json(x, true) order by x.start_at), '[]'::jsonb)
            from public.club_cups x
           where (x.status in ('OPEN', 'PROVISIONAL')
                  and exists (select 1 from public.club_cup_entries ce join public.club_members m on m.club_id = ce.club_id
                               where ce.cup_id = x.id and m.user_id = v_uid and m.status = 'APPROVED'))
              or (x.status = 'INVITED' and x.awaiting_club_id is not null
                  and exists (select 1 from public.club_members m where m.club_id = x.awaiting_club_id and m.user_id = v_uid
                               and m.status = 'APPROVED' and m.role in ('OWNER', 'CAPTAIN'))));
end $$;

-- Bảng điểm uy tín đấu CLB (1–1) toàn hệ thống
create or replace function public.club_duel_ladder() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('rank', t.rk, 'club_id', c.id, 'name', c.name, 'avatar_url', c.avatar_url,
           'accent_color', c.accent_color, 'rating', t.rating, 'played', t.played, 'wins', t.wins, 'draws', t.draws,
           'losses', t.losses, 'streak', t.streak,
           'is_mine', exists (select 1 from public.club_members m where m.club_id = c.id and m.user_id = auth.uid() and m.status = 'APPROVED'))
         order by t.rk, c.name), '[]'::jsonb)
    from (select g.*, rank() over (order by g.rating desc) as rk from public.club_match_ratings g where g.played > 0) t
    join public.clubs c on c.id = t.club_id
   where t.rk <= 50
$$;

-- ---------------------------------------------------------------------
-- 6. Trận 1–1: tạo · nhận lời / từ chối / đề xuất lại · hủy
-- ---------------------------------------------------------------------
create or replace function public.create_club_duel(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_club uuid := nullif(p->>'club_id', '')::uuid;
  v_opp uuid := nullif(p->>'opponent_id', '')::uuid;
  v_id uuid := gen_random_uuid();
  t jsonb;
  v_a text; v_b text; v_msg text := nullif(left(trim(coalesce(p->>'message', '')), 200), '');
begin
  if v_club is null or not public.club_is_staff(v_club) then raise exception 'FORBIDDEN'; end if;
  v_a := (select c.name from public.clubs c where c.id = v_club);
  v_b := (select c.name from public.clubs c where c.id = v_opp);
  if v_opp is null or v_opp = v_club or v_b is null then raise exception 'INVALID_OPPONENT'; end if;
  t := private.match_terms(p, 'DUEL');
  if exists (select 1 from public.club_cups x
              where x.kind = 'DUEL' and x.status in ('INVITED', 'OPEN', 'PROVISIONAL')
                and ((x.host_club_id = v_club and x.opponent_club_id = v_opp) or (x.host_club_id = v_opp and x.opponent_club_id = v_club))) then
    raise exception 'BATTLE_EXISTS';
  end if;
  if (select count(*) from public.club_cups x where x.kind = 'DUEL' and x.host_club_id = v_club and x.created_at > now() - interval '1 day') >= 5 then
    raise exception 'RATE_LIMITED';
  end if;
  insert into public.club_cups (id, kind, rules_version, title, description, metric, start_at, end_at, reg_close_at, max_clubs,
                                host_club_id, opponent_club_id, created_by, status, require_signup, awaiting_club_id,
                                format, measure, top_n, min_roster, max_roster, daily_cap_km, share_cap_pct, pace_min_km, tiebreak,
                                lock_hours, roster_close_at, forfeit_rule, final_delay_hours, negotiation)
  values (v_id, 'DUEL', 2, left(v_a || ' vs ' || v_b, 120), v_msg,
          case when t->>'format' = 'TOTAL' then 'TOTAL_KM' else 'AVG_KM' end,
          (t->>'start_at')::timestamptz, (t->>'end_at')::timestamptz, (t->>'start_at')::timestamptz, 2,
          v_club, v_opp, v_uid, 'INVITED', true, v_opp,
          t->>'format', t->>'measure', (t->>'top_n')::int, (t->>'min_roster')::int, (t->>'max_roster')::int,
          (t->>'daily_cap_km')::numeric, (t->>'share_cap_pct')::int, (t->>'pace_min_km')::numeric, t->>'tiebreak',
          (t->>'lock_hours')::int, (t->>'roster_close_at')::timestamptz, t->>'forfeit_rule', 48,
          jsonb_build_array(jsonb_build_object('v', 1, 'club_id', v_club, 'by', v_uid, 'at', now(), 'action', 'PROPOSE', 'note', v_msg, 'terms', t)));
  perform private.notify_club(v_opp, true, 'CLUB_BATTLE', v_a || ' thách đấu CLB của bạn',
    coalesce(v_msg, 'Xem luật thi đấu rồi Nhận lời, Từ chối hoặc Đề xuất lại.'), '/cups/' || v_id, v_uid);
  return private.cup_json((select x from public.club_cups x where x.id = v_id), false);
end $$;

-- p_action: ACCEPT | DECLINE (p->>'note' = lý do, không bắt buộc) | COUNTER (p = điều khoản mới + note)
create or replace function public.respond_club_duel(p_cup_id uuid, p_action text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  u public.club_cups := (select x from public.club_cups x where x.id = p_cup_id for update);
  v_act text := upper(coalesce(p_action, ''));
  v_note text := nullif(left(trim(coalesce(p->>'note', '')), 200), '');
  v_other uuid; t jsonb; v_me text; v_close text;
begin
  if u.id is null or u.kind <> 'DUEL' then raise exception 'CUP_NOT_FOUND'; end if;
  perform private.match_tick(u.id);
  u := (select x from public.club_cups x where x.id = p_cup_id);
  if u.status <> 'INVITED' then raise exception 'BATTLE_NOT_PENDING'; end if;
  if u.awaiting_club_id is null or not public.club_is_staff(u.awaiting_club_id) then raise exception 'FORBIDDEN'; end if;
  v_other := case when u.awaiting_club_id = u.host_club_id then u.opponent_club_id else u.host_club_id end;
  v_me := (select c.name from public.clubs c where c.id = u.awaiting_club_id);

  if v_act = 'ACCEPT' then
    update public.club_cups set status = 'OPEN', accepted_at = now(), awaiting_club_id = null,
           negotiation = negotiation || jsonb_build_array(jsonb_build_object('v', terms_version, 'club_id', u.awaiting_club_id, 'by', v_uid,
                                                                              'at', now(), 'action', 'ACCEPT', 'note', v_note))
     where id = u.id;
    -- Hai CLB vào trận; người đăng ký tính từ lúc tạo trận (chống "chiêu mộ" sau khi đã biết đối thủ)
    insert into public.club_cup_entries (cup_id, club_id, registered_by, registered_at)
    values (u.id, u.host_club_id, u.created_by, u.created_at), (u.id, u.opponent_club_id, v_uid, u.created_at)
    on conflict (cup_id, club_id) do nothing;
    v_close := to_char(u.roster_close_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM');
    perform private.notify_club(u.host_club_id, false, 'CLUB_BATTLE', '⚔ ' || u.title || ': đăng ký thi đấu!',
      'Đối thủ đã nhận lời. Bấm "Đăng ký thi đấu" trước ' || v_close || ' — chỉ người đăng ký mới được tính cho CLB.', '/cups/' || u.id, null);
    perform private.notify_club(u.opponent_club_id, false, 'CLUB_BATTLE', '⚔ ' || u.title || ': đăng ký thi đấu!',
      'CLB đã nhận lời. Bấm "Đăng ký thi đấu" trước ' || v_close || ' — chỉ người đăng ký mới được tính cho CLB.', '/cups/' || u.id, null);
  elsif v_act = 'DECLINE' then
    update public.club_cups set status = 'DECLINED', awaiting_club_id = null, decline_reason = v_note,
           negotiation = negotiation || jsonb_build_array(jsonb_build_object('v', terms_version, 'club_id', u.awaiting_club_id, 'by', v_uid,
                                                                              'at', now(), 'action', 'DECLINE', 'note', v_note))
     where id = u.id;
    perform private.notify_club(v_other, true, 'CLUB_BATTLE', v_me || ' đã từ chối lời thách đấu', coalesce('Lý do: ' || v_note, null), '/cups/' || u.id, v_uid);
  elsif v_act = 'COUNTER' then
    if u.terms_version >= 6 then raise exception 'TOO_MANY_COUNTERS'; end if;
    t := private.match_terms(p, 'DUEL');
    update public.club_cups set
           format = t->>'format', measure = t->>'measure', top_n = (t->>'top_n')::int, min_roster = (t->>'min_roster')::int,
           max_roster = (t->>'max_roster')::int, daily_cap_km = (t->>'daily_cap_km')::numeric, share_cap_pct = (t->>'share_cap_pct')::int,
           pace_min_km = (t->>'pace_min_km')::numeric, tiebreak = t->>'tiebreak', lock_hours = (t->>'lock_hours')::int,
           forfeit_rule = t->>'forfeit_rule', start_at = (t->>'start_at')::timestamptz, end_at = (t->>'end_at')::timestamptz,
           reg_close_at = (t->>'start_at')::timestamptz, roster_close_at = (t->>'roster_close_at')::timestamptz,
           metric = case when t->>'format' = 'TOTAL' then 'TOTAL_KM' else 'AVG_KM' end,
           terms_version = terms_version + 1, awaiting_club_id = v_other,
           negotiation = negotiation || jsonb_build_array(jsonb_build_object('v', terms_version + 1, 'club_id', u.awaiting_club_id, 'by', v_uid,
                                                                              'at', now(), 'action', 'COUNTER', 'note', v_note, 'terms', t))
     where id = u.id;
    perform private.notify_club(v_other, true, 'CLUB_BATTLE', v_me || ' đề xuất lại điều khoản "' || u.title || '"',
      coalesce(v_note, 'Xem điều khoản mới rồi Nhận lời, Từ chối hoặc Đề xuất lại.'), '/cups/' || u.id, v_uid);
  else
    raise exception 'INVALID_ACTION';
  end if;
  return private.cup_json((select x from public.club_cups x where x.id = u.id), true);
end $$;

-- Hủy: 1–1 → CLB thách đấu khi đang chờ trả lời; ban quản trị một trong hai CLB trước giờ bắt đầu. Nhiều CLB: như cũ. Admin: luôn (trừ khi đã có kết quả).
create or replace function public.cancel_club_cup(p_cup_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  u public.club_cups := (select x from public.club_cups x where x.id = p_cup_id);
  e record;
begin
  if u.id is null then raise exception 'CUP_NOT_FOUND'; end if;
  if not coalesce((private.cup_json(u, false)->>'can_cancel')::boolean, false) then
    if u.status in ('OPEN', 'PROVISIONAL') and now() >= u.start_at then raise exception 'CUP_STARTED'; end if;
    if u.status not in ('PENDING_REVIEW', 'INVITED', 'OPEN') then raise exception 'CUP_NOT_OPEN'; end if;
    raise exception 'FORBIDDEN';
  end if;
  update public.club_cups set status = 'CANCELLED', awaiting_club_id = null,
         cancel_reason = coalesce(cancel_reason, 'Hủy bởi ' || private.display_name(v_uid)) where id = u.id;
  for e in select x.club_id from (select ce.club_id from public.club_cup_entries ce where ce.cup_id = u.id
                                  union select u.host_club_id union select u.opponent_club_id) x where x.club_id is not null loop
    perform private.notify_club(e.club_id, u.status = 'INVITED', private.match_kind_note(u), '"' || u.title || '" đã hủy', null, '/cups/' || u.id, v_uid);
  end loop;
  return private.cup_json((select x from public.club_cups x where x.id = u.id), false);
end $$;

-- ---------------------------------------------------------------------
-- 7. Thách đấu nhiều CLB: tạo với luật mới (vẫn cần admin duyệt nếu người thường tạo)
-- ---------------------------------------------------------------------
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

-- Ban quản trị đăng ký CLB vào giải nhiều CLB (trận 1–1 có sẵn hai CLB)
create or replace function public.join_club_cup(p_cup_id uuid, p_club_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  u public.club_cups := (select x from public.club_cups x where x.id = p_cup_id for update);
  v_club text := (select c.name from public.clubs c where c.id = p_club_id);
begin
  if u.id is null or not private.cup_visible(u) then raise exception 'CUP_NOT_FOUND'; end if;
  if u.kind <> 'CUP' then raise exception 'NOT_A_CUP'; end if;
  if v_club is null then raise exception 'CLUB_NOT_FOUND'; end if;
  if not public.club_is_staff(p_club_id) then raise exception 'CLUB_STAFF_REQUIRED'; end if;
  if u.status <> 'OPEN' then raise exception 'CUP_NOT_OPEN'; end if;
  if now() > u.reg_close_at then raise exception 'REGISTRATION_CLOSED'; end if;
  if exists (select 1 from public.club_cup_entries ce where ce.cup_id = u.id and ce.club_id = p_club_id) then raise exception 'ALREADY_JOINED'; end if;
  if (select count(*) from public.club_cup_entries ce where ce.cup_id = u.id) >= u.max_clubs then raise exception 'CUP_FULL'; end if;
  insert into public.club_cup_entries (cup_id, club_id, registered_by) values (u.id, p_club_id, v_uid);
  perform private.notify_club(p_club_id, false, 'CLUB_CUP', v_club || ' tham gia "' || u.title || '": đăng ký thi đấu!',
    case when coalesce(u.require_signup, false)
         then 'Bấm "Đăng ký thi đấu" trước ' || to_char(coalesce(u.roster_close_at, u.end_at) at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM')
              || ' — chỉ người đăng ký mới được tính cho CLB.'
         else 'Mọi km hợp lệ từ ' || to_char(u.start_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI') || ' đều tính cho CLB. Chạy thôi!' end,
    '/cups/' || u.id, v_uid);
  if u.created_by is not null and u.created_by <> v_uid then
    perform private.notify(u.created_by, null, 'CLUB_CUP', v_club || ' đã đăng ký "' || u.title || '"', null, '/cups/' || u.id, v_uid, false);
  end if;
  return private.cup_json((select x from public.club_cups x where x.id = u.id), true);
end $$;

create or replace function public.leave_club_cup(p_cup_id uuid, p_club_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u public.club_cups := (select x from public.club_cups x where x.id = p_cup_id);
begin
  perform private.require_uid();
  if u.id is null then raise exception 'CUP_NOT_FOUND'; end if;
  if u.kind <> 'CUP' then raise exception 'NOT_A_CUP'; end if;
  if not public.club_is_staff(p_club_id) then raise exception 'CLUB_STAFF_REQUIRED'; end if;
  if now() >= coalesce(u.roster_close_at, u.start_at) then raise exception 'CUP_STARTED'; end if;
  delete from public.club_cup_members where cup_id = u.id and club_id = p_club_id;
  delete from public.club_cup_entries where cup_id = u.id and club_id = p_club_id;
  return private.cup_json((select x from public.club_cups x where x.id = u.id), true);
end $$;

-- ---------------------------------------------------------------------
-- 8. Thành viên đăng ký thi đấu
-- ---------------------------------------------------------------------
create or replace function public.join_cup_as_member(p_cup_id uuid, p_club_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  u public.club_cups := (select x from public.club_cups x where x.id = p_cup_id);
  v_mine uuid;
  v_joined timestamptz;
begin
  if u.id is null or not private.cup_visible(u) then raise exception 'CUP_NOT_FOUND'; end if;
  if u.status <> 'OPEN' or now() >= u.end_at then raise exception 'CUP_NOT_OPEN'; end if;
  if u.rules_version is not null and now() >= u.roster_close_at then raise exception 'ROSTER_LOCKED'; end if;
  if not exists (select 1 from public.club_cup_entries ce where ce.cup_id = u.id and ce.club_id = p_club_id) then raise exception 'CLUB_NOT_IN_CUP'; end if;
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
  insert into public.club_cup_members (cup_id, user_id, club_id) values (u.id, v_uid, p_club_id);
  return private.cup_json(u, true);
end $$;

create or replace function public.leave_cup_as_member(p_cup_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); u public.club_cups := (select x from public.club_cups x where x.id = p_cup_id);
begin
  if u.id is null or not private.cup_visible(u) then raise exception 'CUP_NOT_FOUND'; end if;
  if u.rules_version is not null and now() >= u.roster_close_at then raise exception 'ROSTER_LOCKED'; end if;
  if now() >= u.start_at then raise exception 'CUP_STARTED'; end if;
  delete from public.club_cup_members where cup_id = u.id and user_id = v_uid;
  return private.cup_json(u, true);
end $$;

-- ---------------------------------------------------------------------
-- 9. Chuyển trận "CLB đấu CLB" cũ (club_battles) sang thách đấu 1–1 — giữ id, giữ cách tính cũ (mọi thành viên, km)
-- ---------------------------------------------------------------------
insert into public.club_cups (id, kind, legacy_battle_id, rules_version, title, description, metric, format, measure,
                              start_at, end_at, reg_close_at, max_clubs, host_club_id, opponent_club_id, created_by, status,
                              require_signup, awaiting_club_id, final_delay_hours, accepted_at, settled_at, final_at, created_at, daily_cap_km)
select b.id, 'DUEL', b.id, null, left(ca.name || ' vs ' || co.name, 120), b.message, b.metric,
       case when b.metric = 'TOTAL_KM' then 'TOTAL' else 'AVG' end, 'KM',
       b.start_at, b.end_at, b.start_at, 2, b.challenger_id, b.opponent_id, b.created_by,
       case b.status when 'PENDING' then 'INVITED' when 'ACCEPTED' then 'OPEN' else b.status end,
       false, case when b.status = 'PENDING' then b.opponent_id end, 2, b.responded_at, b.settled_at, b.settled_at, b.created_at, null
  from public.club_battles b
  join public.clubs ca on ca.id = b.challenger_id
  join public.clubs co on co.id = b.opponent_id
on conflict (id) do nothing;

insert into public.club_cup_entries (cup_id, club_id, registered_by, registered_at)
select b.id, x.club_id, b.created_by, b.created_at
  from public.club_battles b
  cross join lateral (values (b.challenger_id), (b.opponent_id)) as x(club_id)
 where b.status in ('ACCEPTED', 'FINISHED') and exists (select 1 from public.club_cups u where u.id = b.id)
on conflict (cup_id, club_id) do nothing;

-- Kết quả trận cũ đã xong: bảng điểm theo engine mới (cùng cách tính cũ) + người thắng đã công bố
update public.club_cups u set result = jsonb_build_object('standings', private.match_standings(u, u.end_at),
                                                          'winner_id', b.winner_id, 'mvp', null, 'final', true, 'legacy', true)
  from public.club_battles b
 where b.id = u.id and u.legacy_battle_id is not null and u.status = 'FINISHED' and u.result is null;

-- Hàm cũ: không tạo trận kiểu cũ nữa (app mới dùng create_club_duel); danh sách cũ trả rỗng; cron cũ không làm gì
create or replace function public.create_club_battle(p_club_id uuid, p_opponent_id uuid, p_metric text,
                                                     p_start timestamptz, p_end timestamptz, p_message text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin raise exception 'FEATURE_MOVED'; end $$;
create or replace function public.respond_club_battle(p_battle_id uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin raise exception 'FEATURE_MOVED'; end $$;
create or replace function public.cancel_club_battle(p_battle_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin raise exception 'FEATURE_MOVED'; end $$;
create or replace function public.club_battles_of(p_club_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$ select '[]'::jsonb $$;
create or replace function public.settle_due_club_battles() returns integer
language sql security definer set search_path = public as $$ select 0 $$;

-- ---------------------------------------------------------------------
-- 10. Quyền
-- ---------------------------------------------------------------------
revoke all on function private.match_kind_note(public.club_cups), private.match_cutoff(public.club_cups, uuid), private.fmt_pace(numeric),
  private.match_score_text(public.club_cups, numeric), private.match_terms(jsonb, text), private.match_terms_of(public.club_cups),
  private.match_runner_rows(uuid, timestamptz, timestamptz, numeric), private.match_values(public.club_cups, timestamptz),
  private.match_standings(public.club_cups, timestamptz), private.match_mvp(public.club_cups, timestamptz),
  private.match_phase(public.club_cups), private.match_badge(uuid, text, text), private.match_elo(uuid, uuid, numeric),
  private.match_finalize(uuid), private.match_tick(uuid), private.club_brief(uuid) from public, anon, authenticated;
revoke all on function public.create_club_duel(jsonb), public.respond_club_duel(uuid, text, jsonb), public.club_match_summary(uuid),
  public.my_club_matches(), public.club_duel_ladder(), public.club_cup_club_board(uuid, uuid) from public, anon;
grant execute on function public.create_club_duel(jsonb), public.respond_club_duel(uuid, text, jsonb), public.club_match_summary(uuid),
  public.my_club_matches(), public.club_duel_ladder(), public.club_cup_club_board(uuid, uuid) to authenticated;
revoke all on function public.settle_due_club_cups(), public.settle_due_club_battles() from public, anon, authenticated;
grant execute on function public.settle_due_club_cups(), public.settle_due_club_battles() to service_role;

notify pgrst, 'reload schema';
