-- 002600: CLB đấu CLB + Bảng xếp hạng CLB (tuần / tháng, không theo mùa giải).
-- • Ban quản trị CLB gửi lời thách đấu tới CLB khác: tính theo TỔNG km hoặc km TRUNG BÌNH mỗi thành viên
--   (công bằng khi hai CLB chênh quân số). CLB kia chấp nhận / từ chối. Bảng hai phía cập nhật theo bài chạy hợp lệ.
-- • Chỉ tính bài APPROVED bắt đầu trong khung giờ và sau khi người chạy vào CLB (không "chiêu mộ" giữa trận để ăn km cũ).
-- • Hết giờ + 2 giờ chờ bài đồng bộ muộn → tất toán, báo kết quả cho thành viên hai CLB.
-- • Bảng xếp hạng CLB toàn hệ thống: km trung bình mỗi thành viên, chia hạng Đồng → Kim cương.
-- Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

create table if not exists public.club_battles (
  id uuid primary key default gen_random_uuid(),
  challenger_id uuid not null references public.clubs(id) on delete cascade,
  opponent_id uuid not null references public.clubs(id) on delete cascade,
  metric text not null default 'AVG_KM',
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'PENDING',
  message text,
  created_by uuid references public.profiles(id) on delete set null,
  responded_by uuid references public.profiles(id) on delete set null,
  responded_at timestamptz,
  winner_id uuid references public.clubs(id) on delete set null,
  result jsonb,
  settled_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.club_battles drop constraint if exists club_battles_metric_chk;
alter table public.club_battles add constraint club_battles_metric_chk check (metric in ('TOTAL_KM', 'AVG_KM'));
alter table public.club_battles drop constraint if exists club_battles_status_chk;
alter table public.club_battles add constraint club_battles_status_chk
  check (status in ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'FINISHED'));
alter table public.club_battles drop constraint if exists club_battles_sides_chk;
alter table public.club_battles add constraint club_battles_sides_chk check (challenger_id <> opponent_id and end_at > start_at);
create index if not exists club_battles_challenger_idx on public.club_battles (challenger_id, created_at desc);
create index if not exists club_battles_opponent_idx on public.club_battles (opponent_id, created_at desc);

alter table public.club_battles enable row level security;
revoke all on public.club_battles from anon, authenticated;
grant select on public.club_battles to authenticated;
drop policy if exists club_battles_select on public.club_battles;
create policy club_battles_select on public.club_battles for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- 1. Số liệu một phía trong khung giờ
-- ---------------------------------------------------------------------
create or replace function private.club_battle_side(p_club uuid, p_start timestamptz, p_end timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
  with mem as (
    select m.user_id, m.joined_at from public.club_members m where m.club_id = p_club and m.status = 'APPROVED'
  ), runs as (
    select a.user_id, sum(a.distance_m) as m, count(*) as n
      from public.activities a join mem on mem.user_id = a.user_id
     where a.validation_status = 'APPROVED' and coalesce(a.status, '') <> 'DELETED'
       and a.started_at >= p_start and a.started_at < p_end
       and a.started_at >= coalesce(mem.joined_at, '-infinity'::timestamptz)
     group by a.user_id
  ), ranked as (
    select r.*, row_number() over (order by r.m desc) as rn from runs r
  )
  select jsonb_build_object(
    'club_id', c.id, 'name', c.name, 'avatar_url', c.avatar_url, 'accent_color', c.accent_color,
    'members', greatest((select count(*) from mem), 1),
    'runners', (select count(*) from runs),
    'km', round(coalesce((select sum(m) from runs), 0) / 1000.0, 2),
    'avg_km', round(coalesce((select sum(m) from runs), 0) / 1000.0 / greatest((select count(*) from mem), 1), 2),
    'top', (select coalesce(jsonb_agg(jsonb_build_object('user_id', r.user_id, 'display_name', private.display_name(r.user_id),
                                                          'avatar_url', pr.avatar_url, 'km', round(r.m / 1000.0, 2), 'runs', r.n)
                                      order by r.rn), '[]'::jsonb)
              from ranked r join public.profiles pr on pr.id = r.user_id where r.rn <= 5))
  from public.clubs c where c.id = p_club
$$;

create or replace function private.club_battle_json(b public.club_battles) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  a jsonb := private.club_battle_side(b.challenger_id, b.start_at, least(b.end_at, now()));
  o jsonb := private.club_battle_side(b.opponent_id, b.start_at, least(b.end_at, now()));
  k text := case b.metric when 'TOTAL_KM' then 'km' else 'avg_km' end;
begin
  if b.status in ('PENDING', 'DECLINED', 'CANCELLED') or now() < b.start_at then
    -- chưa bắt đầu: chỉ thông tin CLB, chưa có km
    a := a || jsonb_build_object('km', 0, 'avg_km', 0, 'runners', 0, 'top', '[]'::jsonb);
    o := o || jsonb_build_object('km', 0, 'avg_km', 0, 'runners', 0, 'top', '[]'::jsonb);
  end if;
  if b.status = 'FINISHED' and b.result is not null then
    a := b.result->'challenger'; o := b.result->'opponent';
  end if;
  return jsonb_build_object(
    'id', b.id, 'metric', b.metric, 'start_at', b.start_at, 'end_at', b.end_at, 'status', b.status,
    'message', b.message, 'created_at', b.created_at, 'winner_id', b.winner_id,
    'challenger', a, 'opponent', o,
    'score_key', k,
    'leader_id', case when (a->>k)::numeric > (o->>k)::numeric then b.challenger_id
                      when (o->>k)::numeric > (a->>k)::numeric then b.opponent_id end,
    'can_respond', b.status = 'PENDING' and public.club_is_staff(b.opponent_id) and now() < b.end_at,
    'can_cancel', (b.status = 'PENDING' and public.club_is_staff(b.challenger_id))
                  or (b.status = 'ACCEPTED' and now() < b.start_at
                      and (public.club_is_staff(b.challenger_id) or public.club_is_staff(b.opponent_id))));
end $$;

-- Báo cho ban quản trị (hoặc mọi thành viên) của một CLB
create or replace function private.notify_club(p_club uuid, p_staff_only boolean, p_kind text, p_title text, p_body text,
                                               p_link text, p_actor uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m record;
begin
  for m in select cm.user_id from public.club_members cm
            where cm.club_id = p_club and cm.status = 'APPROVED'
              and (not p_staff_only or cm.role in ('OWNER', 'CAPTAIN')) loop
    perform private.notify(m.user_id, p_club, p_kind, p_title, p_body, p_link, p_actor, true);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. Thách đấu / trả lời / hủy
-- ---------------------------------------------------------------------
create or replace function public.create_club_battle(p_club_id uuid, p_opponent_id uuid, p_metric text,
                                                     p_start timestamptz, p_end timestamptz, p_message text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_id uuid := gen_random_uuid();
  v_name text := (select c.name from public.clubs c where c.id = p_club_id);
begin
  if not public.club_is_staff(p_club_id) then raise exception 'FORBIDDEN'; end if;
  if p_opponent_id = p_club_id or not exists (select 1 from public.clubs c where c.id = p_opponent_id) then raise exception 'INVALID_OPPONENT'; end if;
  if upper(coalesce(p_metric, '')) not in ('TOTAL_KM', 'AVG_KM') then raise exception 'INVALID_METRIC'; end if;
  if p_start is null or p_end is null or p_end <= p_start then raise exception 'INVALID_TIME_RANGE'; end if;
  if p_start < now() - interval '10 minutes' then raise exception 'START_IN_PAST'; end if;
  if p_end - p_start < interval '1 day' or p_end - p_start > interval '62 days' then raise exception 'INVALID_DURATION'; end if;
  if exists (select 1 from public.club_battles b
              where b.status in ('PENDING', 'ACCEPTED')
                and ((b.challenger_id = p_club_id and b.opponent_id = p_opponent_id) or (b.challenger_id = p_opponent_id and b.opponent_id = p_club_id))) then
    raise exception 'BATTLE_EXISTS';
  end if;
  if (select count(*) from public.club_battles b where b.challenger_id = p_club_id and b.created_at > now() - interval '1 day') >= 5 then
    raise exception 'RATE_LIMITED';
  end if;

  insert into public.club_battles (id, challenger_id, opponent_id, metric, start_at, end_at, message, created_by)
  values (v_id, p_club_id, p_opponent_id, upper(p_metric), p_start, p_end, nullif(left(trim(coalesce(p_message, '')), 200), ''), v_uid);

  perform private.notify_club(p_opponent_id, true, 'CLUB_BATTLE', v_name || ' thách đấu CLB của bạn',
    coalesce(nullif(trim(p_message), ''), 'Vào tab BXH để chấp nhận hoặc từ chối.'),
    '/clubs/' || p_opponent_id || '/leaderboard?tab=battles', v_uid);
  return private.club_battle_json((select b from public.club_battles b where b.id = v_id));
end $$;

create or replace function public.respond_club_battle(p_battle_id uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  b public.club_battles := (select x from public.club_battles x where x.id = p_battle_id);
  v_a text; v_o text;
begin
  if b.id is null then raise exception 'BATTLE_NOT_FOUND'; end if;
  if not public.club_is_staff(b.opponent_id) then raise exception 'FORBIDDEN'; end if;
  if b.status <> 'PENDING' then raise exception 'BATTLE_NOT_PENDING'; end if;
  if now() >= b.end_at then raise exception 'BATTLE_EXPIRED'; end if;
  update public.club_battles set status = case when p_accept then 'ACCEPTED' else 'DECLINED' end,
         responded_by = v_uid, responded_at = now() where id = b.id;
  v_a := (select c.name from public.clubs c where c.id = b.challenger_id);
  v_o := (select c.name from public.clubs c where c.id = b.opponent_id);
  if p_accept then
    perform private.notify_club(b.challenger_id, false, 'CLUB_BATTLE', 'Trận đấu với ' || v_o || ' đã được chấp nhận',
      'Mọi km hợp lệ trong thời gian thi đấu đều tính cho CLB. Chạy thôi!', '/clubs/' || b.challenger_id || '/leaderboard?tab=battles', v_uid);
    perform private.notify_club(b.opponent_id, false, 'CLUB_BATTLE', 'CLB nhận lời đấu với ' || v_a,
      'Mọi km hợp lệ trong thời gian thi đấu đều tính cho CLB. Chạy thôi!', '/clubs/' || b.opponent_id || '/leaderboard?tab=battles', v_uid);
  else
    perform private.notify_club(b.challenger_id, true, 'CLUB_BATTLE', v_o || ' đã từ chối lời thách đấu', null,
      '/clubs/' || b.challenger_id || '/leaderboard?tab=battles', v_uid);
  end if;
  return private.club_battle_json((select x from public.club_battles x where x.id = b.id));
end $$;

create or replace function public.cancel_club_battle(p_battle_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  b public.club_battles := (select x from public.club_battles x where x.id = p_battle_id);
begin
  if b.id is null then raise exception 'BATTLE_NOT_FOUND'; end if;
  if not ((b.status = 'PENDING' and public.club_is_staff(b.challenger_id))
          or (b.status = 'ACCEPTED' and now() < b.start_at
              and (public.club_is_staff(b.challenger_id) or public.club_is_staff(b.opponent_id)))) then
    raise exception 'FORBIDDEN';
  end if;
  update public.club_battles set status = 'CANCELLED' where id = b.id;
  return private.club_battle_json((select x from public.club_battles x where x.id = b.id));
end $$;

-- ---------------------------------------------------------------------
-- 3. Xem: danh sách trận của một CLB, chi tiết một trận
-- ---------------------------------------------------------------------
create or replace function public.club_battles_of(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return (select coalesce(jsonb_agg(private.club_battle_json(b)
                   order by case b.status when 'ACCEPTED' then 0 when 'PENDING' then 1 else 2 end, b.start_at desc), '[]'::jsonb)
            from (select x.*, row_number() over (order by x.created_at desc) as rn
                    from public.club_battles x where p_club_id in (x.challenger_id, x.opponent_id)) b
           where b.rn <= 30);
end $$;

create or replace function public.club_battle(p_battle_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b public.club_battles := (select x from public.club_battles x where x.id = p_battle_id);
begin
  if b.id is null then raise exception 'BATTLE_NOT_FOUND'; end if;
  return private.club_battle_json(b);
end $$;

-- ---------------------------------------------------------------------
-- 4. Tất toán (cron hằng ngày + mỗi khi có người mở trận đã hết giờ). Idempotent.
-- ---------------------------------------------------------------------
create or replace function public.settle_due_club_battles() returns integer
language plpgsql security definer set search_path = public as $$
declare
  b record;
  v_a jsonb; v_o jsonb; k text; v_win uuid; n integer := 0;
  v_an text; v_on text; v_msg text;
begin
  for b in select * from public.club_battles x where x.status = 'ACCEPTED' and x.end_at < now() - interval '2 hours'
           for update skip locked loop
    v_a := private.club_battle_side(b.challenger_id, b.start_at, b.end_at);
    v_o := private.club_battle_side(b.opponent_id, b.start_at, b.end_at);
    k := case b.metric when 'TOTAL_KM' then 'km' else 'avg_km' end;
    v_win := case when (v_a->>k)::numeric > (v_o->>k)::numeric then b.challenger_id
                  when (v_o->>k)::numeric > (v_a->>k)::numeric then b.opponent_id end;
    update public.club_battles set status = 'FINISHED', winner_id = v_win, settled_at = now(),
           result = jsonb_build_object('challenger', v_a, 'opponent', v_o) where id = b.id;
    v_an := v_a->>'name'; v_on := v_o->>'name';
    v_msg := v_an || ' ' || (v_a->>k) || ' – ' || (v_o->>k) || ' ' || v_on
             || case k when 'km' then ' (tổng km)' else ' (km trung bình / thành viên)' end;
    perform private.notify_club(b.challenger_id, false, 'CLUB_BATTLE',
      case when v_win = b.challenger_id then 'CLB thắng trận với ' || v_on || '! 🏆' when v_win is null then 'Hòa với ' || v_on else 'CLB thua ' || v_on end,
      v_msg, '/clubs/' || b.challenger_id || '/leaderboard?tab=battles', null);
    perform private.notify_club(b.opponent_id, false, 'CLUB_BATTLE',
      case when v_win = b.opponent_id then 'CLB thắng trận với ' || v_an || '! 🏆' when v_win is null then 'Hòa với ' || v_an else 'CLB thua ' || v_an end,
      v_msg, '/clubs/' || b.opponent_id || '/leaderboard?tab=battles', null);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 5. Bảng xếp hạng CLB toàn hệ thống (tuần / tháng): km trung bình mỗi thành viên, chia hạng
--    Hạng theo km TB / thành viên / tháng: Kim cương ≥ 120 · Bạch kim ≥ 80 · Vàng ≥ 50 · Bạc ≥ 25 · Đồng (tuần: chia 4)
-- ---------------------------------------------------------------------
create or replace function public.club_rankings(p_period text default 'MONTH') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_from timestamptz;
  f numeric := case upper(coalesce(p_period, '')) when 'WEEK' then 0.25 else 1 end;
begin
  if upper(coalesce(p_period, '')) not in ('WEEK', 'MONTH') then raise exception 'INVALID_PERIOD'; end if;
  v_from := private.period_start(p_period);
  return (
    with mem as (
      select m.club_id, m.user_id, m.joined_at from public.club_members m where m.status = 'APPROVED'
    ), totals as (
      select c.id, c.name, c.avatar_url, c.accent_color,
             (select count(*) from mem where mem.club_id = c.id) as members,
             coalesce((select sum(a.distance_m) from public.activities a join mem on mem.user_id = a.user_id and mem.club_id = c.id
                        where a.validation_status = 'APPROVED' and coalesce(a.status, '') <> 'DELETED'
                          and a.started_at >= v_from and a.started_at >= coalesce(mem.joined_at, '-infinity'::timestamptz)), 0) / 1000.0 as km,
             (select count(distinct a.user_id) from public.activities a join mem on mem.user_id = a.user_id and mem.club_id = c.id
               where a.validation_status = 'APPROVED' and coalesce(a.status, '') <> 'DELETED' and a.started_at >= v_from) as runners
        from public.clubs c
    ), ranked as (
      select t.*, round(t.km / greatest(t.members, 1), 2) as avg_km,
             row_number() over (order by t.km / greatest(t.members, 1) desc, t.km desc, t.name) as rn
        from totals t where t.members >= 3
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'rank', r.rn, 'club_id', r.id, 'name', r.name, 'avatar_url', r.avatar_url, 'accent_color', r.accent_color,
        'members', r.members, 'runners', r.runners, 'km', round(r.km, 1), 'avg_km', r.avg_km,
        'tier', case when r.avg_km >= 120 * f then 'DIAMOND' when r.avg_km >= 80 * f then 'PLATINUM'
                     when r.avg_km >= 50 * f then 'GOLD' when r.avg_km >= 25 * f then 'SILVER' else 'BRONZE' end,
        'is_mine', public.club_is_member(r.id))
        order by r.rn), '[]'::jsonb)
      from ranked r where r.rn <= 100 or public.club_is_member(r.id));
end $$;

-- ---------------------------------------------------------------------
-- 6. Quyền
-- ---------------------------------------------------------------------
revoke all on function private.club_battle_side(uuid, timestamptz, timestamptz), private.club_battle_json(public.club_battles),
  private.notify_club(uuid, boolean, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.create_club_battle(uuid, uuid, text, timestamptz, timestamptz, text), public.respond_club_battle(uuid, boolean),
  public.cancel_club_battle(uuid), public.club_battles_of(uuid), public.club_battle(uuid), public.settle_due_club_battles(),
  public.club_rankings(text) from public, anon;
grant execute on function public.create_club_battle(uuid, uuid, text, timestamptz, timestamptz, text), public.respond_club_battle(uuid, boolean),
  public.cancel_club_battle(uuid), public.club_battles_of(uuid), public.club_battle(uuid), public.settle_due_club_battles(),
  public.club_rankings(text) to authenticated;
grant execute on function public.settle_due_club_battles() to service_role;

notify pgrst, 'reload schema';
