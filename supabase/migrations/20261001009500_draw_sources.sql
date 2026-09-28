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
