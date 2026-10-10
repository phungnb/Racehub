-- 015500: Tặng phẩm (hiện vật) cho thử thách và giải chạy — người tham gia điền thông tin nhận, BTC xem danh sách.
-- • BTC (người tạo / ban quản trị CLB; giải chạy: cả admin hệ thống) khai báo tặng phẩm: mô tả, có cần cỡ áo không (+ các cỡ), hạn điền.
-- • Người đang tham gia (thử thách: chưa rời; giải chạy: chưa rút) điền họ tên, SĐT, địa chỉ, cỡ áo, ghi chú — sửa được tới hạn điền.
-- • BTC xem danh sách đầy đủ (kể cả người chưa điền) để đóng gói / xuất Excel. Người khác không đọc được SĐT, địa chỉ.
-- scope: 'CHALLENGE' | 'RACE'. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

create table if not exists public.prize_gifts (
  scope text not null,
  ref_id uuid not null,
  description text not null,
  needs_size boolean not null default false,
  size_options text[] not null default '{}',
  deadline timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (scope, ref_id)
);
alter table public.prize_gifts drop constraint if exists prize_gifts_chk;
alter table public.prize_gifts add constraint prize_gifts_chk check (scope in ('CHALLENGE', 'RACE')
  and char_length(description) between 2 and 500 and cardinality(size_options) <= 12);

create table if not exists public.prize_addresses (
  scope text not null,
  ref_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  full_name text not null,
  phone text not null,
  address text not null,
  size text,
  note text,
  updated_at timestamptz not null default now(),
  primary key (scope, ref_id, user_id)
);
alter table public.prize_addresses drop constraint if exists prize_addresses_chk;
alter table public.prize_addresses add constraint prize_addresses_chk check (scope in ('CHALLENGE', 'RACE'));
create index if not exists prize_addresses_user_idx on public.prize_addresses (user_id);

alter table public.prize_gifts enable row level security;
alter table public.prize_addresses enable row level security;
revoke all on public.prize_gifts, public.prize_addresses from anon, authenticated;

-- Quyền: 'MANAGER' | 'MEMBER' | null
create or replace function private.prize_role(p_scope text, p_ref uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  c public.challenges;
  r public.virtual_races;
begin
  if auth.uid() is null then return null; end if;
  if p_scope = 'CHALLENGE' then
    c := (select x from public.challenges x where x.id = p_ref);
    if c.id is null then return null; end if;
    if private.challenge_is_manager(c) or public.is_system_admin() then return 'MANAGER'; end if;
    if exists (select 1 from public.challenge_participants p
                where p.challenge_id = p_ref and p.profile_id = auth.uid() and p.status <> 'LEFT') then return 'MEMBER'; end if;
  elsif p_scope = 'RACE' then
    r := (select x from public.virtual_races x where x.id = p_ref);
    if r.id is null then return null; end if;
    if private.race_is_manager(r) then return 'MANAGER'; end if;
    if exists (select 1 from public.race_registrations g
                where g.race_id = p_ref and g.user_id = auth.uid() and g.status <> 'WITHDRAWN') then return 'MEMBER'; end if;
  end if;
  return null;
end $$;

-- p = { description, needs_size, size_options: ["S","M"…], deadline }. Mô tả rỗng = gỡ khai báo tặng phẩm (thông tin đã điền được giữ).
create or replace function public.set_prize_gift(p_scope text, p_ref uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_desc text := left(trim(coalesce(p->>'description', '')), 500);
  v_needs boolean := coalesce((p->>'needs_size')::boolean, false);
  v_sizes text[] := '{}';
  v_deadline timestamptz := nullif(p->>'deadline', '')::timestamptz;
  v_title text;
  v_new boolean;
  m record;
begin
  if p_scope not in ('CHALLENGE', 'RACE') then raise exception 'BAD_SCOPE'; end if;
  if private.prize_role(p_scope, p_ref) is distinct from 'MANAGER' then raise exception 'FORBIDDEN'; end if;
  if v_desc = '' then
    delete from public.prize_gifts where scope = p_scope and ref_id = p_ref;
    return jsonb_build_object('enabled', false);
  end if;
  if char_length(v_desc) < 2 then raise exception 'PRIZE_DESC_SHORT'; end if;
  if v_needs then
    v_sizes := (select coalesce(array_agg(s order by o), '{}')
                  from (select left(trim(e), 10) as s, min(o) as o
                          from jsonb_array_elements_text(coalesce(p->'size_options', '[]'::jsonb)) with ordinality t(e, o)
                         where trim(e) <> '' group by left(trim(e), 10)) z);
    if cardinality(v_sizes) = 0 then raise exception 'PRIZE_SIZES_EMPTY'; end if;
    if cardinality(v_sizes) > 12 then v_sizes := v_sizes[1:12]; end if;
  end if;
  v_new := not exists (select 1 from public.prize_gifts where scope = p_scope and ref_id = p_ref);
  insert into public.prize_gifts (scope, ref_id, description, needs_size, size_options, deadline, created_by, updated_at)
    values (p_scope, p_ref, v_desc, v_needs, v_sizes, v_deadline, v_uid, now())
  on conflict (scope, ref_id) do update set description = excluded.description, needs_size = excluded.needs_size,
    size_options = excluded.size_options, deadline = excluded.deadline, updated_at = now();
  if v_new then
    if p_scope = 'CHALLENGE' then
      v_title := (select title from public.challenges where id = p_ref);
      for m in select p2.profile_id as uid from public.challenge_participants p2
                where p2.challenge_id = p_ref and p2.status <> 'LEFT' and p2.profile_id <> v_uid loop
        perform private.notify(m.uid, null, 'PRIZE_INFO', 'Có tặng phẩm: ' || v_title,
          'Vào thử thách, điền thông tin nhận tặng phẩm.', '/challenges/' || p_ref, v_uid, false);
      end loop;
    else
      v_title := (select title from public.virtual_races where id = p_ref);
      for m in select g.user_id as uid from public.race_registrations g
                where g.race_id = p_ref and g.status <> 'WITHDRAWN' and g.user_id <> v_uid loop
        perform private.notify(m.uid, null, 'PRIZE_INFO', 'Có tặng phẩm: ' || v_title,
          'Vào giải chạy, điền thông tin nhận tặng phẩm.', '/races/' || p_ref, v_uid, false);
      end loop;
    end if;
  end if;
  return jsonb_build_object('enabled', true);
end $$;

-- Trạng thái cho màn hình: người tham gia / BTC. Người ngoài nhận null.
create or replace function public.prize_gift_get(p_scope text, p_ref uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_role text := private.prize_role(p_scope, p_ref);
  g public.prize_gifts := (select x from public.prize_gifts x where x.scope = p_scope and x.ref_id = p_ref);
  a public.prize_addresses := (select x from public.prize_addresses x where x.scope = p_scope and x.ref_id = p_ref and x.user_id = auth.uid());
begin
  if v_role is null then return null; end if;
  if g.ref_id is null then
    return jsonb_build_object('enabled', false, 'can_manage', v_role = 'MANAGER');
  end if;
  return jsonb_build_object(
    'enabled', true, 'can_manage', v_role = 'MANAGER', 'is_member', v_role = 'MEMBER',
    'description', g.description, 'needs_size', g.needs_size, 'size_options', to_jsonb(g.size_options), 'deadline', g.deadline,
    'closed', g.deadline is not null and now() > g.deadline,
    'mine', case when a.user_id is null then null else jsonb_build_object(
      'full_name', a.full_name, 'phone', a.phone, 'address', a.address, 'size', a.size, 'note', a.note, 'updated_at', a.updated_at) end,
    'filled_count', case when v_role = 'MANAGER' then (select count(*) from public.prize_addresses x where x.scope = p_scope and x.ref_id = p_ref) end);
end $$;

-- p = { full_name, phone, address, size, note }
create or replace function public.save_prize_address(p_scope text, p_ref uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  g public.prize_gifts := (select x from public.prize_gifts x where x.scope = p_scope and x.ref_id = p_ref);
  v_name text := left(trim(coalesce(p->>'full_name', '')), 80);
  v_phone text := regexp_replace(coalesce(p->>'phone', ''), '[\s.\-()]', '', 'g');
  v_addr text := left(trim(coalesce(p->>'address', '')), 300);
  v_size text := nullif(left(trim(coalesce(p->>'size', '')), 10), '');
  v_note text := nullif(left(trim(coalesce(p->>'note', '')), 200), '');
begin
  if g.ref_id is null then raise exception 'PRIZE_NOT_ENABLED'; end if;
  if private.prize_role(p_scope, p_ref) is null then raise exception 'FORBIDDEN'; end if;
  if g.deadline is not null and now() > g.deadline then raise exception 'PRIZE_CLOSED'; end if;
  if char_length(v_name) < 2 then raise exception 'PRIZE_NAME_INVALID'; end if;
  if v_phone !~ '^\+?[0-9]{9,12}$' then raise exception 'PRIZE_PHONE_INVALID'; end if;
  if char_length(v_addr) < 10 then raise exception 'PRIZE_ADDRESS_INVALID'; end if;
  if g.needs_size then
    if v_size is null or not (v_size = any (g.size_options)) then raise exception 'PRIZE_SIZE_INVALID'; end if;
  else
    v_size := null;
  end if;
  insert into public.prize_addresses (scope, ref_id, user_id, full_name, phone, address, size, note, updated_at)
    values (p_scope, p_ref, v_uid, v_name, v_phone, v_addr, v_size, v_note, now())
  on conflict (scope, ref_id, user_id) do update set full_name = excluded.full_name, phone = excluded.phone,
    address = excluded.address, size = excluded.size, note = excluded.note, updated_at = now();
  return public.prize_gift_get(p_scope, p_ref);
end $$;

-- Danh sách cho BTC: mọi người đang tham gia, kèm thông tin nhận (nếu đã điền). Dễ nối vào file xuất Excel.
create or replace function public.prize_recipients(p_scope text, p_ref uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if private.prize_role(p_scope, p_ref) is distinct from 'MANAGER' then raise exception 'FORBIDDEN'; end if;
  if p_scope = 'CHALLENGE' then
    return (select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', p.profile_id, 'display_name', pr.display_name, 'status', p.status, 'ref_label', null::text,
        'filled', a.user_id is not null, 'full_name', a.full_name, 'phone', a.phone, 'address', a.address,
        'size', a.size, 'note', a.note, 'updated_at', a.updated_at)
        order by (a.user_id is null), pr.display_name), '[]'::jsonb)
      from public.challenge_participants p
      join public.profiles pr on pr.id = p.profile_id
      left join public.prize_addresses a on a.scope = 'CHALLENGE' and a.ref_id = p.challenge_id and a.user_id = p.profile_id
     where p.challenge_id = p_ref and p.status <> 'LEFT');
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', g.user_id, 'display_name', pr.display_name, 'status', g.status, 'ref_label', g.bib || ' · ' || g.distance_km || ' km',
      'filled', a.user_id is not null, 'full_name', a.full_name, 'phone', a.phone, 'address', a.address,
      'size', a.size, 'note', a.note, 'updated_at', a.updated_at)
      order by (a.user_id is null), g.bib), '[]'::jsonb)
    from public.race_registrations g
    join public.profiles pr on pr.id = g.user_id
    left join public.prize_addresses a on a.scope = 'RACE' and a.ref_id = g.race_id and a.user_id = g.user_id
   where g.race_id = p_ref and g.status <> 'WITHDRAWN');
end $$;

revoke all on function private.prize_role(text, uuid) from public, anon, authenticated;
revoke all on function public.set_prize_gift(text, uuid, jsonb), public.prize_gift_get(text, uuid),
  public.save_prize_address(text, uuid, jsonb), public.prize_recipients(text, uuid) from public, anon;
grant execute on function public.set_prize_gift(text, uuid, jsonb), public.prize_gift_get(text, uuid),
  public.save_prize_address(text, uuid, jsonb), public.prize_recipients(text, uuid) to authenticated;
