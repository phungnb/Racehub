-- 009300: QUAY THƯỞNG v2 — quay trên sân khấu như một chương trình thật.
--   • BTC chọn danh sách: rule 'PICKED' = chỉ quay trong những người BTC tích chọn (phải thuộc chương trình);
--     danh sách loại trừ (ban tổ chức, nhà tài trợ…) áp cho mọi cách chọn.
--   • Quay từng giải: start_lucky_draw chốt danh sách + seed (công bố trước MÃ BĂM của seed để đối chiếu sau) → trạng thái LIVE;
--     draw_next(giải) mở từng người trúng theo thứ tự md5(seed || user_id) — thứ tự đã cố định từ lúc bắt đầu, BTC không chọn được ai trúng;
--     draw_absent: người trúng vắng mặt → ghi "vắng mặt" công khai, quay lại suất đó cho người kế tiếp;
--     finish_lucky_draw: công bố, báo người trúng, đăng bảng tin.
--   • run_lucky_draw giữ nguyên tên: "Quay nhanh" toàn bộ (hoặc phần còn lại của lượt đang quay).
--   • Người xem (thành viên) thấy người trúng hiện dần khi đang quay; tên trong vòng quay lấy ngẫu nhiên từ danh sách.
-- Cần 008400. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

-- ---------------------------------------------------------------------
-- 1. Cột mới
-- ---------------------------------------------------------------------
alter table public.lucky_draws drop constraint if exists lucky_draws_rule_check;
alter table public.lucky_draws add constraint lucky_draws_rule_check check (rule in ('COMPLETED', 'ACTIVE', 'ALL', 'PICKED'));
alter table public.lucky_draws drop constraint if exists lucky_draws_status_check;
alter table public.lucky_draws add constraint lucky_draws_status_check check (status in ('READY', 'LIVE', 'DONE', 'CANCELLED'));
alter table public.lucky_draws add column if not exists picked uuid[] not null default '{}';
alter table public.lucky_draws add column if not exists excluded uuid[] not null default '{}';
alter table public.lucky_draws add column if not exists pool uuid[];
alter table public.lucky_draws add column if not exists seed_hash text;
alter table public.lucky_draws add column if not exists started_at timestamptz;

alter table public.lucky_draw_winners add column if not exists status text not null default 'WON';
alter table public.lucky_draw_winners drop constraint if exists lucky_draw_winners_status_check;
alter table public.lucky_draw_winners add constraint lucky_draw_winners_status_check check (status in ('WON', 'ABSENT'));
alter table public.lucky_draw_winners add column if not exists prize_idx integer;
alter table public.lucky_draw_winners add column if not exists drawn_at timestamptz not null default now();

-- ---------------------------------------------------------------------
-- 2. Danh sách được quay
-- ---------------------------------------------------------------------
create or replace function private.draw_pool(d public.lucky_draws) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct e.user_id), '{}')
    from private.draw_entrants(d.scope, d.ref_id, case when d.rule = 'PICKED' then 'ALL' else d.rule end) e
   where e.user_id is not null
     and (d.rule <> 'PICKED' or e.user_id = any(d.picked))
     and not (e.user_id = any(d.excluded))
     and not (d.exclude_winners and exists (select 1 from public.lucky_draw_winners lw join public.lucky_draws x on x.id = lw.draw_id
                                             where x.scope = d.scope and x.ref_id is not distinct from d.ref_id and x.id <> d.id
                                               and lw.status = 'WON' and lw.user_id = e.user_id))
$$;

/** Người được chọn / loại trừ: chỉ giữ người thuộc chương trình (tối đa 2.000) */
create or replace function private.draw_clean_ids(p_scope text, p_ref uuid, p jsonb) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct e.user_id), '{}')
    from private.draw_entrants(p_scope, p_ref, 'ALL') e
   where e.user_id::text in (select jsonb_array_elements_text(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end))
$$;

create or replace function private.draw_json(d public.lucky_draws, p_manage boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(d) - 'created_by' - 'run_by' - 'pool' - 'picked' - 'excluded' - 'seed'
    || jsonb_build_object('can_manage', p_manage,
    'seed', case when d.status = 'DONE' then d.seed end,
    'creator_name', private.display_name(d.created_by),
    'picked_count', cardinality(d.picked), 'excluded_count', cardinality(d.excluded),
    'winners', coalesce((select jsonb_agg(jsonb_build_object('user_id', w.user_id, 'name', private.display_name(w.user_id),
                  'avatar_url', pr.avatar_url, 'prize', w.prize, 'prize_idx', w.prize_idx, 'position', w.position, 'status', w.status,
                  'me', w.user_id = auth.uid()) order by w.position)
                from public.lucky_draw_winners w join public.profiles pr on pr.id = w.user_id where w.draw_id = d.id), '[]'::jsonb),
    'eligible_now', case when d.status = 'READY' and p_manage then cardinality(private.draw_pool(d))
                         when d.status = 'LIVE' then cardinality(d.pool)
                           - (select count(*)::int from public.lucky_draw_winners w where w.draw_id = d.id) end,
    -- Tên chạy trong vòng quay: tối đa 40 người ngẫu nhiên của danh sách đã chốt
    'reel', case when d.status = 'LIVE' then coalesce((select jsonb_agg(jsonb_build_object('name', private.display_name(t.u), 'avatar_url', pr.avatar_url))
                  from (select u, row_number() over (order by random()) as rn from unnest(d.pool) u) t
                  join public.profiles pr on pr.id = t.u where t.rn <= 40), '[]'::jsonb) end)
$$;

-- ---------------------------------------------------------------------
-- 3. Tạo lượt quay: thêm "BTC chọn danh sách" + danh sách loại trừ
-- ---------------------------------------------------------------------
create or replace function public.create_lucky_draw(p_scope text, p_ref uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_new_id uuid;
  v_uid uuid := private.require_uid();
  v_title text := trim(coalesce(p->>'title', ''));
  v_rule text := case when p->>'rule' in ('COMPLETED', 'ACTIVE', 'ALL', 'PICKED') then p->>'rule' else 'COMPLETED' end;
  v_prizes jsonb;
  v_picked uuid[];
  v_excluded uuid[];
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
     or jsonb_array_length(case when jsonb_typeof(p->'excluded') = 'array' then p->'excluded' else '[]'::jsonb end) > 2000 then
    raise exception 'TOO_MANY_PEOPLE';
  end if;
  v_picked := case when v_rule = 'PICKED' then private.draw_clean_ids(p_scope, p_ref, p->'picked') else '{}' end;
  v_excluded := private.draw_clean_ids(p_scope, p_ref, p->'excluded');
  if v_rule = 'PICKED' and cardinality(v_picked) = 0 then raise exception 'PICK_REQUIRED'; end if;
  if (select count(*) from public.lucky_draws x where x.scope = p_scope and x.ref_id is not distinct from p_ref and x.status in ('READY', 'LIVE')) >= 5 then
    raise exception 'TOO_MANY_DRAWS';
  end if;
  v_new_id := gen_random_uuid();
  insert into public.lucky_draws (id, scope, ref_id, title, rule, prizes, exclude_winners, created_by, picked, excluded)
  values (v_new_id, p_scope, case when p_scope = 'SYSTEM' then null else p_ref end, v_title, v_rule, v_prizes,
          coalesce((p->>'exclude_winners')::boolean, true), v_uid, v_picked, v_excluded);
  d := (select t from public.lucky_draws t where t.id = v_new_id);
  return private.draw_json(d, true);
end $$;

/** Danh sách người thuộc chương trình để BTC tích chọn / loại trừ (chỉ người quản lý) */
create or replace function public.lucky_draw_candidates(p_scope text, p_ref uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not private.draw_can_manage(p_scope, p_ref) then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'name', private.display_name(x.user_id), 'avatar_url', pr.avatar_url,
                                                       'completed', x.user_id in (select c.user_id from private.draw_entrants(p_scope, p_ref, 'COMPLETED') c))
                                    order by private.display_name(x.user_id))
                     from (select distinct e.user_id from private.draw_entrants(p_scope, p_ref, 'ALL') e where e.user_id is not null) x
                     join public.profiles pr on pr.id = x.user_id), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- 4. Quay trên sân khấu
-- ---------------------------------------------------------------------
create or replace function public.start_lucky_draw(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := private.require_uid();
  d public.lucky_draws := (select x from public.lucky_draws x where x.id = p_id for update);
  v_seed text := encode(extensions.gen_random_bytes(16), 'hex');
  v_pool uuid[];
begin
  if d.id is null or not private.draw_can_manage(d.scope, d.ref_id) then raise exception 'FORBIDDEN'; end if;
  if d.status = 'LIVE' then return private.draw_json(d, true); end if;
  if d.status <> 'READY' then raise exception 'DRAW_CLOSED'; end if;
  v_pool := private.draw_pool(d);
  if cardinality(v_pool) = 0 then raise exception 'NO_ENTRANTS'; end if;
  update public.lucky_draws set status = 'LIVE', pool = v_pool, seed = v_seed, seed_hash = md5(v_seed), entrant_count = cardinality(v_pool),
         entrants_hash = (select md5(string_agg(u::text, ',' order by u)) from unnest(v_pool) u), run_by = v_uid, started_at = now()
   where id = d.id;
  d := (select t from public.lucky_draws t where t.id = d.id);
  return private.draw_json(d, true);
end $$;

-- Người kế tiếp theo thứ tự đã cố định, nhận giải p_prize (tính từ 0). NULL = hết người.
create or replace function private.draw_pick(p_id uuid, p_prize integer) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  d public.lucky_draws := (select x from public.lucky_draws x where x.id = p_id);
  v_user uuid;
begin
  v_user := (select t.u from (select u, row_number() over (order by md5(d.seed || u::text)) as rn
                                from unnest(d.pool) u
                               where not exists (select 1 from public.lucky_draw_winners w where w.draw_id = d.id and w.user_id = u)) t
              where t.rn = 1);
  if v_user is null then return null; end if;
  insert into public.lucky_draw_winners (draw_id, user_id, prize, prize_idx, position, status)
  values (d.id, v_user, d.prizes->p_prize->>'name', p_prize,
          (select count(*)::int + 1 from public.lucky_draw_winners w where w.draw_id = d.id), 'WON');
  return v_user;
end $$;

create or replace function private.draw_left(d public.lucky_draws, p_prize integer) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((d.prizes->p_prize->>'qty')::int, 0)
         - (select count(*)::int from public.lucky_draw_winners w where w.draw_id = d.id and w.prize_idx = p_prize and w.status = 'WON')
$$;

create or replace function public.draw_next(p_id uuid, p_prize integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d public.lucky_draws := (select x from public.lucky_draws x where x.id = p_id for update);
begin
  if d.id is null or not private.draw_can_manage(d.scope, d.ref_id) then raise exception 'FORBIDDEN'; end if;
  if d.status <> 'LIVE' then raise exception 'DRAW_NOT_LIVE'; end if;
  if p_prize is null or p_prize < 0 or p_prize >= jsonb_array_length(d.prizes) then raise exception 'INVALID_PRIZES'; end if;
  if private.draw_left(d, p_prize) <= 0 then raise exception 'PRIZE_FULL'; end if;
  if private.draw_pick(d.id, p_prize) is null then raise exception 'POOL_EXHAUSTED'; end if;
  d := (select t from public.lucky_draws t where t.id = d.id);
  return private.draw_json(d, true);
end $$;

/** Người trúng vắng mặt: ghi công khai "vắng mặt", suất quà trả lại để quay tiếp */
create or replace function public.draw_absent(p_id uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d public.lucky_draws := (select x from public.lucky_draws x where x.id = p_id for update);
begin
  if d.id is null or not private.draw_can_manage(d.scope, d.ref_id) then raise exception 'FORBIDDEN'; end if;
  if d.status <> 'LIVE' then raise exception 'DRAW_NOT_LIVE'; end if;
  if not exists (select 1 from public.lucky_draw_winners w where w.draw_id = d.id and w.user_id = p_user and w.status = 'WON') then
    raise exception 'NOT_A_WINNER';
  end if;
  update public.lucky_draw_winners set status = 'ABSENT' where draw_id = d.id and user_id = p_user;
  return private.draw_json(d, true);
end $$;

-- Công bố: báo người trúng + đăng bảng tin (như 008400)
create or replace function private.draw_announce(p_id uuid, p_uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  d public.lucky_draws := (select x from public.lucky_draws x where x.id = p_id);
  v_org uuid;
  v_title text;
  w record;
begin
  for w in select lw.user_id, lw.prize from public.lucky_draw_winners lw where lw.draw_id = d.id and lw.status = 'WON' loop
    perform private.notify(w.user_id, case when d.scope = 'CLUB' then d.ref_id end, 'LUCKY_DRAW_WIN', 'Chúc mừng! Bạn trúng ' || w.prize,
      d.title, case d.scope when 'ORG_CAMPAIGN' then '/orgs/' || (select c.org_id from public.org_campaigns c where c.id = d.ref_id) || '/campaigns/' || d.ref_id
                             when 'CHALLENGE' then '/challenges/' || d.ref_id when 'CLUB' then '/clubs/' || d.ref_id || '/hall'
                             when 'RACE' then '/races/' || d.ref_id else '/notifications' end, p_uid, true);
  end loop;
  v_title := 'Kết quả ' || d.title || ': ' || coalesce((select string_agg(private.display_name(lw.user_id) || ' (' || lw.prize || ')', ', ' order by lw.position)
                                                           from public.lucky_draw_winners lw where lw.draw_id = d.id and lw.status = 'WON'), '');
  if d.scope = 'ORG_CAMPAIGN' then
    v_org := (select c.org_id from public.org_campaigns c where c.id = d.ref_id);
    insert into public.org_posts (org_id, author_id, kind, body, meta) values (v_org, p_uid, 'DRAW', left(v_title, 2000), jsonb_build_object('draw_id', d.id));
  elsif d.scope = 'CLUB' then
    insert into public.club_posts (club_id, author_id, kind, title, body, is_pinned)
    values (d.ref_id, p_uid, 'ANNOUNCEMENT', left('Quay thưởng: ' || d.title, 120), left(v_title, 2000), false);
  end if;
end $$;

create or replace function public.finish_lucky_draw(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  d public.lucky_draws := (select x from public.lucky_draws x where x.id = p_id for update);
begin
  if d.id is null or not private.draw_can_manage(d.scope, d.ref_id) then raise exception 'FORBIDDEN'; end if;
  if d.status <> 'LIVE' then raise exception 'DRAW_NOT_LIVE'; end if;
  if not exists (select 1 from public.lucky_draw_winners w where w.draw_id = d.id and w.status = 'WON') then raise exception 'NO_WINNERS'; end if;
  update public.lucky_draws set status = 'DONE', run_at = now() where id = d.id;
  perform private.draw_announce(d.id, v_uid);
  d := (select t from public.lucky_draws t where t.id = d.id);
  return private.draw_json(d, true);
end $$;

-- Quay nhanh: toàn bộ (READY) hoặc phần còn lại (LIVE), rồi công bố — cùng thứ tự md5(seed || user_id) như 008400
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
      exit prizes when private.draw_pick(d.id, i) is null;
    end loop;
  end loop;
  return public.finish_lucky_draw(p_id);
end $$;

create or replace function public.cancel_lucky_draw(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d public.lucky_draws := (select x from public.lucky_draws x where x.id = p_id);
begin
  if d.id is null or not private.draw_can_manage(d.scope, d.ref_id) then raise exception 'FORBIDDEN'; end if;
  -- Đang quay mà đã có người trúng thì không huỷ được (tránh huỷ để quay lại cho tới khi "vừa ý")
  if d.status = 'LIVE' and exists (select 1 from public.lucky_draw_winners w where w.draw_id = d.id) then raise exception 'DRAW_STARTED'; end if;
  if d.status not in ('READY', 'LIVE') then raise exception 'DRAW_CLOSED'; end if;
  update public.lucky_draws set status = 'CANCELLED' where id = p_id;
end $$;

-- Người xem: lượt đang quay hiện luôn (xem người trúng hiện dần), lượt huỷ chỉ người quản lý thấy
create or replace function public.lucky_draws_for(p_scope text, p_ref uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_manage boolean := private.draw_can_manage(p_scope, p_ref);
begin
  if not private.draw_can_view(p_scope, p_ref) then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(private.draw_json(d, v_manage) order by d.created_at desc)
           from public.lucky_draws d where d.scope = p_scope and d.ref_id is not distinct from p_ref
            and (d.status not in ('CANCELLED', 'READY') or v_manage)), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- 5. Quyền
-- ---------------------------------------------------------------------
revoke all on function private.draw_pool(public.lucky_draws), private.draw_clean_ids(text, uuid, jsonb), private.draw_json(public.lucky_draws, boolean),
  private.draw_pick(uuid, integer), private.draw_left(public.lucky_draws, integer), private.draw_announce(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.create_lucky_draw(text, uuid, jsonb), public.lucky_draw_candidates(text, uuid), public.start_lucky_draw(uuid),
  public.draw_next(uuid, integer), public.draw_absent(uuid, uuid), public.finish_lucky_draw(uuid), public.run_lucky_draw(uuid),
  public.cancel_lucky_draw(uuid), public.lucky_draws_for(text, uuid) from public, anon;
grant execute on function public.create_lucky_draw(text, uuid, jsonb), public.lucky_draw_candidates(text, uuid), public.start_lucky_draw(uuid),
  public.draw_next(uuid, integer), public.draw_absent(uuid, uuid), public.finish_lucky_draw(uuid), public.run_lucky_draw(uuid),
  public.cancel_lucky_draw(uuid), public.lucky_draws_for(text, uuid) to authenticated;

notify pgrst, 'reload schema';
