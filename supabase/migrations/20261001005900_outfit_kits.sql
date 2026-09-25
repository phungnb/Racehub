-- 005900: Bộ đồng phục (Kit Studio) — thiết kế CẢ BỘ áo + quần + tất + giày, có họa tiết, cho nhân vật 2D.
-- • Họa tiết theo mặt nạ từng ô (áo: sọc, viền sườn, vai, chéo, ngang, nửa, chuyển màu, chữ V; quần: sọc sườn, viền gấu, chuyển màu;
--   tất: viền cổ, sọc ngang). Chữ / logo vẫn chỉ in trên áo.
-- • avatar_items.kit: mã bộ — các món cùng bộ được "Mặc cả bộ" một chạm trong Tủ đồ.
-- • Yêu cầu đồng phục CLB mang theo màu + họa tiết từng món (parts); admin duyệt → tạo cả bộ (giá từng món như vật phẩm thường).
-- Cần 005800. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

alter table public.avatar_items add column if not exists kit text;
create index if not exists avatar_items_kit_idx on public.avatar_items (kit) where kit is not null;
alter table public.club_uniform_requests add column if not exists parts jsonb;

-- Họa tiết cho phép theo ô
create or replace function private.pattern_kinds(p_slot text) returns text[]
language sql immutable as $$
  select case p_slot
    when 'top' then array['sides', 'shoulders', 'sash', 'hoops', 'stripes', 'half', 'gradient', 'chevron']
    when 'bottom' then array['sides', 'hem', 'gradient']
    when 'socks' then array['band', 'hoops']
    else array[]::text[] end
$$;

-- Thiết kế của một món: {pattern: {kind, color}} + (áo) nội dung in như 005800. null = trơn
create or replace function private.clean_design(p jsonb, p_slot text) returns jsonb
language plpgsql immutable as $$
declare
  v_pat jsonb := case when jsonb_typeof(p->'pattern') = 'object' and coalesce(p->'pattern'->>'kind', 'none') <> 'none' then p->'pattern' end;
  v_base jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return null; end if;
  if v_pat is not null then
    if not ((v_pat->>'kind') = any(private.pattern_kinds(p_slot))) then raise exception 'INVALID_PATTERN'; end if;
    if coalesce(v_pat->>'color', '') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_PATTERN'; end if;
    v_pat := jsonb_build_object('kind', v_pat->>'kind', 'color', lower(v_pat->>'color'));
  end if;
  if p_slot = 'top' then
    v_base := private.clean_print(p - 'pattern');
  elsif nullif(trim(coalesce(p->>'logo_url', '')), '') is not null or nullif(trim(coalesce(p->>'title', '')), '') is not null
        or nullif(trim(coalesce(p->>'subtitle', '')), '') is not null or coalesce(p->>'personal', 'NONE') = 'NAME' then
    raise exception 'PRINT_TOP_ONLY';
  end if;
  if v_pat is null then return v_base; end if;
  return coalesce(v_base, '{}'::jsonb) || jsonb_build_object('pattern', v_pat);
end $$;

create or replace function private.item_json(i public.avatar_items) returns jsonb
language sql immutable as $$
  select jsonb_build_object('code', i.code, 'name', i.name, 'description', i.description, 'slot', i.category, 'rarity', i.rarity,
    'render_kind', i.render_kind, 'layer_urls', i.layer_urls, 'color', i.color, 'price_xu', i.price_xu,
    'unlock_level', i.unlock_level, 'is_default', i.is_default, 'acquire', coalesce(i.metadata->>'acquire', 'xu'),
    'print', i.print, 'status', i.status, 'club_id', i.club_id, 'collection_id', i.collection_id,
    'required_badge', i.required_badge, 'required_challenge', i.required_challenge,
    'available_from', i.available_from, 'available_to', i.available_to, 'supply_limit', i.supply_limit, 'kit', i.kit)
$$;

-- Như 005800 + họa tiết, mã bộ
create or replace function public.admin_save_avatar_item(p_item jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  v_code text := lower(trim(coalesce(p_item->>'code', '')));
  v_name text := trim(coalesce(p_item->>'name', ''));
  v_desc text := nullif(trim(coalesce(p_item->>'description', '')), '');
  v_slot text := p_item->>'slot';
  v_rarity text := coalesce(p_item->>'rarity', 'common');
  v_kind text := coalesce(p_item->>'render_kind', 'TINT');
  v_color text := nullif(p_item->>'color', '');
  v_layers jsonb := case when jsonb_typeof(p_item->'layer_urls') = 'object' then p_item->'layer_urls' end;
  v_price numeric := coalesce((p_item->>'price_xu')::numeric, 0);
  v_level integer := coalesce((p_item->>'unlock_level')::integer, 1);
  v_sort integer := coalesce((p_item->>'sort')::integer, 100);
  v_default boolean := coalesce((p_item->>'is_default')::boolean, false);
  -- tương thích bản cũ: is_active=false (không gửi status) → Gỡ hẳn
  v_status text := upper(coalesce(p_item->>'status', case when (p_item->>'is_active')::boolean is false then 'RETIRED' else 'PUBLISHED' end));
  v_collection uuid := (select c.id from public.avatar_collections c where c.code = nullif(p_item->>'collection', ''));
  v_club uuid := nullif(p_item->>'club_id', '')::uuid;
  v_badge text := nullif(trim(coalesce(p_item->>'required_badge', '')), '');
  v_challenge uuid := nullif(p_item->>'required_challenge', '')::uuid;
  v_from timestamptz := nullif(p_item->>'available_from', '')::timestamptz;
  v_to timestamptz := nullif(p_item->>'available_to', '')::timestamptz;
  v_supply integer := nullif(p_item->>'supply_limit', '')::integer;
  v_print jsonb := private.clean_design(p_item->'print', v_slot);
  v_kit text := nullif(lower(trim(coalesce(p_item->>'kit', ''))), '');
  v_old public.avatar_items;
  k text;
  v_url text;
begin
  if v_code !~ '^[a-z0-9_]{3,48}$' then raise exception 'INVALID_CODE'; end if;
  if char_length(v_name) not between 2 and 60 then raise exception 'INVALID_NAME'; end if;
  if v_desc is not null and char_length(v_desc) > 160 then raise exception 'INVALID_DESCRIPTION'; end if;
  if v_slot is null or not (v_slot = any(private.character_slots())) then raise exception 'INVALID_SLOT'; end if;
  if v_rarity not in ('common', 'rare', 'epic', 'legendary') then raise exception 'INVALID_RARITY'; end if;
  if v_price < 0 or v_price > 100000 then raise exception 'INVALID_PRICE'; end if;
  if v_level not between 1 and 8 then raise exception 'INVALID_LEVEL'; end if;
  if v_status not in ('DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED', 'RETIRED') then raise exception 'INVALID_STATUS'; end if;
  if nullif(p_item->>'collection', '') is not null and v_collection is null then raise exception 'COLLECTION_NOT_FOUND'; end if;
  if v_club is not null and not exists (select 1 from public.clubs c where c.id = v_club) then raise exception 'CLUB_NOT_FOUND'; end if;
  if v_badge is not null and not exists (select 1 from public.achievements a where a.code = v_badge) then raise exception 'BADGE_NOT_FOUND'; end if;
  if v_challenge is not null and not exists (select 1 from public.challenges c where c.id = v_challenge) then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if v_from is not null and v_to is not null and v_to <= v_from then raise exception 'INVALID_TIME_RANGE'; end if;
  if v_supply is not null and v_supply < 1 then raise exception 'INVALID_SUPPLY'; end if;
  if v_kit is not null and v_kit !~ '^[a-z0-9_]{3,48}$' then raise exception 'INVALID_KIT'; end if;
  -- họa tiết theo mặt nạ: chỉ món đổi màu; áo lớp ảnh chỉ in chữ / logo
  if v_print ? 'pattern' and v_kind <> 'TINT' then raise exception 'PATTERN_TINT_ONLY'; end if;

  if v_kind = 'TINT' then
    if not (v_slot = any(private.character_required_slots())) then raise exception 'TINT_SLOT_ONLY'; end if;
    if v_color is not null and v_color !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_COLOR'; end if;
    v_layers := null;
  elsif v_kind = 'LAYER' then
    if v_layers is null or v_layers = '{}'::jsonb then raise exception 'LAYER_REQUIRED'; end if;
    for k in select jsonb_object_keys(v_layers) loop
      if k not in ('male', 'female') then raise exception 'INVALID_LAYER'; end if;
      v_url := v_layers->>k;
      if v_url is null or v_url !~ '^(/character/|https://)[^\s"<>]+\.png(\?[^\s"<>]*)?$' then raise exception 'INVALID_LAYER'; end if;
    end loop;
    v_color := null;
  else
    raise exception 'INVALID_RENDER_KIND';
  end if;

  v_old := (select i from public.avatar_items i where i.code = v_code);
  if v_old.id is not null and v_old.category <> v_slot
     and exists (select 1 from public.user_inventory where item_id = v_old.id) then
    raise exception 'SLOT_LOCKED';
  end if;
  if v_status not in ('PUBLISHED', 'ARCHIVED') and v_code = v_slot || '_original' then raise exception 'ITEM_REQUIRED'; end if;
  -- đã có người sở hữu thì không đưa về Nháp / Chờ duyệt (họ sẽ mất đồ) — dùng Ngừng bán
  if v_old.id is not null and v_status in ('DRAFT', 'REVIEW') and exists (select 1 from public.user_inventory where item_id = v_old.id) then
    raise exception 'ITEM_HAS_OWNERS';
  end if;

  insert into public.avatar_items (code, name, description, category, rarity, asset_url, render_kind, color, layer_urls,
                                   price_xu, unlock_level, sort, is_default, status, collection_id, club_id, required_badge,
                                   required_challenge, available_from, available_to, supply_limit, print, kit)
  values (v_code, v_name, v_desc, v_slot, v_rarity, lower(v_kind), v_kind, v_color, v_layers,
          v_price, v_level, v_sort, v_default, v_status, v_collection, v_club, v_badge, v_challenge, v_from, v_to, v_supply, v_print, v_kit)
  on conflict (code) where code is not null do update set
    name = excluded.name, description = excluded.description, category = excluded.category, rarity = excluded.rarity,
    render_kind = excluded.render_kind, color = excluded.color, layer_urls = excluded.layer_urls,
    price_xu = excluded.price_xu, unlock_level = excluded.unlock_level, sort = excluded.sort, is_default = excluded.is_default,
    status = excluded.status, collection_id = excluded.collection_id, club_id = excluded.club_id, required_badge = excluded.required_badge,
    required_challenge = excluded.required_challenge, available_from = excluded.available_from, available_to = excluded.available_to,
    supply_limit = excluded.supply_limit, print = excluded.print, kit = excluded.kit;

  insert into public.admin_audit_log (actor_id, action, target, old_value, new_value)
  values (v_admin, case when v_old.id is null then 'AVATAR_ITEM_CREATE' else 'AVATAR_ITEM_UPDATE' end, 'avatar_item:' || v_code,
          case when v_old.id is null then null else private.item_json(v_old) end,
          private.item_json((select i from public.avatar_items i where i.code = v_code)));

  return private.item_json((select i from public.avatar_items i where i.code = v_code)) || jsonb_build_object('is_active', v_status in ('PUBLISHED', 'ARCHIVED'));
end $$;

-- Các món khác của bộ: {bottom: {color, print?}, socks: {...}, shoes: {...}} — thiếu món nào thì bộ không có món đó
create or replace function private.clean_parts(p jsonb) returns jsonb
language plpgsql immutable as $$
declare k text; v_out jsonb := '{}'::jsonb; v_part jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return null; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('bottom', 'socks', 'shoes') then raise exception 'INVALID_PARTS'; end if;
    v_part := p->k;
    if v_part is null or jsonb_typeof(v_part) <> 'object' then continue; end if;
    if coalesce(v_part->>'color', '') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_COLOR'; end if;
    v_out := v_out || jsonb_build_object(k, jsonb_build_object('color', lower(v_part->>'color'), 'print', private.clean_design(v_part->'print', k)));
  end loop;
  return nullif(v_out, '{}'::jsonb);
end $$;

create or replace function private.uniform_request_json(r public.club_uniform_requests) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(r) || jsonb_build_object('club_name', (select c.name from public.clubs c where c.id = r.club_id),
    'requested_by_name', private.display_name(r.requested_by),
    'item', (select private.item_json(i) || jsonb_build_object('owners', (select count(*) from public.user_inventory v where v.item_id = i.id))
               from public.avatar_items i where i.code = r.item_code),
    'kit_items', (select coalesce(jsonb_agg(private.item_json(i) order by i.category), '[]'::jsonb)
                    from public.avatar_items i where r.item_code is not null and i.kit = r.item_code and i.code <> r.item_code))
$$;

-- Như 005800 + họa tiết áo + các món khác của bộ
create or replace function public.request_club_uniform(p_club_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_print jsonb := private.clean_design(p->'print', 'top');
  v_parts jsonb := private.clean_parts(p->'parts');
  r public.club_uniform_requests;
begin
  if not public.club_is_staff(p_club_id) then raise exception 'FORBIDDEN'; end if;
  if char_length(trim(coalesce(p->>'name', ''))) < 2 then raise exception 'INVALID_NAME'; end if;
  if coalesce(p->>'color', '') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_COLOR'; end if;
  if v_print is null then raise exception 'INVALID_PRINT'; end if;
  if v_print->>'logo_url' is not null and v_print->>'logo_url' !~ ('/storage/v1/object/public/uniform-media/' || p_club_id::text || '/') then
    raise exception 'INVALID_PRINT';
  end if;
  if (select count(*) from public.club_uniform_requests x where x.club_id = p_club_id and x.status = 'PENDING') >= 3 then
    raise exception 'TOO_MANY_REQUESTS';
  end if;
  insert into public.club_uniform_requests (club_id, requested_by, name, color, print, note, parts)
  values (p_club_id, v_uid, left(trim(p->>'name'), 60), lower(p->>'color'), v_print, nullif(left(trim(coalesce(p->>'note', '')), 500), ''), v_parts)
  returning * into r;
  return private.uniform_request_json(r);
end $$;

-- APPROVE: p = {price_xu (áo), part_prices: {bottom, socks, shoes}, rarity, name?, code?, collection?, status?, note?}
create or replace function public.admin_review_uniform_request(p_id uuid, p_action text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  r public.club_uniform_requests := (select x from public.club_uniform_requests x where x.id = p_id);
  v_code text;
  v_club text;
  v_name text;
  k text;
  m record;
  v_label jsonb := '{"bottom": "Quần", "socks": "Tất", "shoes": "Giày"}'::jsonb;
begin
  if r.id is null then raise exception 'REQUEST_NOT_FOUND'; end if;
  if r.status <> 'PENDING' then raise exception 'REQUEST_CLOSED'; end if;
  if upper(coalesce(p_action, '')) = 'REJECT' then
    if char_length(trim(coalesce(p->>'note', ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
    update public.club_uniform_requests set status = 'REJECTED', review_note = left(trim(p->>'note'), 300), reviewed_at = now(), reviewed_by = v_admin
     where id = r.id returning * into r;
    if r.requested_by is not null then
      perform private.notify(r.requested_by, r.club_id, 'CLUB_UNIFORM', 'Đồng phục "' || r.name || '" cần chỉnh sửa', r.review_note,
        '/clubs/' || r.club_id || '/settings', v_admin, true);
    end if;
    return private.uniform_request_json(r);
  end if;
  if upper(coalesce(p_action, '')) <> 'APPROVE' then raise exception 'INVALID_ACTION'; end if;

  v_code := lower(coalesce(nullif(p->>'code', ''), 'uni_' || substr(replace(r.id::text, '-', ''), 1, 10)));
  v_club := (select c.name from public.clubs c where c.id = r.club_id);
  v_name := coalesce(nullif(p->>'name', ''), r.name);
  perform public.admin_save_avatar_item(jsonb_build_object(
    'code', v_code, 'name', v_name, 'description', 'Đồng phục ' || v_club,
    'slot', 'top', 'render_kind', 'TINT', 'color', r.color, 'print', r.print, 'club_id', r.club_id, 'kit', v_code,
    'price_xu', coalesce((p->>'price_xu')::numeric, 0), 'rarity', coalesce(p->>'rarity', 'rare'),
    'collection', p->>'collection', 'status', coalesce(p->>'status', 'PUBLISHED'), 'sort', 10));
  for k in select jsonb_object_keys(coalesce(r.parts, '{}'::jsonb)) loop
    perform public.admin_save_avatar_item(jsonb_build_object(
      'code', v_code || '_' || k, 'name', left((v_label->>k) || ' ' || v_name, 60), 'description', 'Đồng phục ' || v_club,
      'slot', k, 'render_kind', 'TINT', 'color', r.parts->k->>'color', 'print', r.parts->k->'print', 'club_id', r.club_id, 'kit', v_code,
      'price_xu', coalesce((p->'part_prices'->>k)::numeric, 0), 'rarity', coalesce(p->>'rarity', 'rare'),
      'collection', p->>'collection', 'status', coalesce(p->>'status', 'PUBLISHED'), 'sort', 10));
  end loop;
  update public.club_uniform_requests set status = 'APPROVED', item_code = v_code, reviewed_at = now(), reviewed_by = v_admin,
    review_note = nullif(left(trim(coalesce(p->>'note', '')), 300), '')
   where id = r.id returning * into r;
  for m in select cm.user_id from public.club_members cm where cm.club_id = r.club_id and cm.status = 'APPROVED' loop
    perform private.notify(m.user_id, r.club_id, 'CLUB_UNIFORM', 'CLB có đồng phục mới: ' || r.name,
      'Vào Tủ đồ, bấm "Mặc cả bộ" để mặc đồng phục CLB.', '/character', v_admin, false);
  end loop;
  return private.uniform_request_json(r);
end $$;

revoke all on function private.pattern_kinds(text), private.clean_design(jsonb, text), private.clean_parts(jsonb) from public, anon, authenticated;

notify pgrst, 'reload schema';
