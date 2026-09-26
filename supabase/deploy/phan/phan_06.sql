-- RaceHub — PHẦN 06/12 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 005900, 006000, 006100
-- Supabase → SQL Editor → New query → dán TOÀN BỘ phần này → Run. Lỗi thì không có gì thay đổi; chạy lại vẫn an toàn.
-- Xong thì chạy phần tiếp theo.
begin;
-- ===================================================================
-- 20261001005900_outfit_kits.sql
-- ===================================================================
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

-- ===================================================================
-- 20261001006000_character_designer.sql
-- ===================================================================
-- 006000: Bộ sưu tập nhân vật + trình thiết kế trang phục chuyên nghiệp.
-- • Nhân vật có nhiều dáng (bộ gốc + thư thái, đang chạy, áo thun…): user_avatar.body; dáng khác giới tự về bộ gốc (client).
-- • Thiết kế món đồ (cột print) mở rộng:
--     layers  — lớp in tự do (chữ / ảnh) đặt theo hộp bao vùng áo / quần: x, y (0..1), w (tỉ lệ bề rộng), xoay, độ mờ,
--               chữ: font, màu, viền, giãn chữ; "{TEN}" = tên gọi của người mặc. Tối đa 12 lớp, chỉ áo và quần.
--     tone    — độ đậm màu (strength 0.2..1) và sáng / tối (light -0.4..0.4) của màu nền món đồ.
--     texture — ảnh vải / ảnh áo thật phủ lên vùng (url, độ mờ, tỉ lệ), giữ nếp vải.
-- Cần 005900. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

alter table public.user_avatar add column if not exists body text;

create or replace function private.character_bodies() returns text[]
language sql immutable as $$
  select array['male', 'female', 'male_relax', 'male_run', 'female_tee', 'female_run']
$$;

create or replace function private.character_look(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'gender', coalesce(a.gender, 'male'),
    'body', a.body,
    'equipped', coalesce((
      select jsonb_object_agg(s.slot, i.code)
        from unnest(private.character_slots()) s(slot)
        join public.avatar_items i on i.is_active and i.id = (to_jsonb(e) ->> (s.slot || '_item_id'))::uuid
    ), '{}'::jsonb),
    'items', coalesce((
      select jsonb_agg(private.item_json(i))
        from public.avatar_items i
       where i.is_active and i.id in (e.top_item_id, e.bottom_item_id, e.socks_item_id, e.shoes_item_id, e.hair_item_id,
         e.hat_item_id, e.glasses_item_id, e.watch_item_id, e.accessory_item_id, e.effect_item_id)
    ), '[]'::jsonb))
    from (select p_user as uid) x
    left join public.user_avatar a on a.user_id = x.uid
    left join public.user_equipment e on e.user_id = x.uid
$$;

-- Như 005800 + chọn dáng nhân vật
create or replace function public.save_character(p_look jsonb, p_equipped jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_gender text := p_look->>'gender';
  v_body text := nullif(p_look->>'body', '');
  k text;
  v_code text;
  v_id uuid;
begin
  perform private.ensure_character(v_uid);
  if v_gender is not null and v_gender not in ('male', 'female') then raise exception 'INVALID_LOOK'; end if;
  if v_body is not null and not (v_body = any(private.character_bodies())) then raise exception 'INVALID_LOOK'; end if;
  update public.user_avatar set gender = coalesce(v_gender, gender),
    body = case when p_look ? 'body' then v_body else body end, updated_at = now() where user_id = v_uid;

  if p_equipped is not null and jsonb_typeof(p_equipped) = 'object' then
    for k in select jsonb_object_keys(p_equipped) loop
      if not (k = any(private.character_slots())) then raise exception 'INVALID_SLOT'; end if;
      v_code := p_equipped->>k;
      if v_code is null then
        if k = any(private.character_required_slots()) then raise exception 'SLOT_REQUIRED'; end if;
        v_id := null;
      else
        v_id := (select i.id from public.avatar_items i
                   join public.user_inventory inv on inv.item_id = i.id and inv.user_id = v_uid
                  where i.code = v_code and i.category = k and i.is_active);
        if v_id is null then raise exception 'ITEM_NOT_OWNED'; end if;
        if not private.item_wearable(v_uid, v_id) then raise exception 'CLUB_ONLY'; end if;
      end if;
      execute format('update public.user_equipment set %I = $1, updated_at = now() where user_id = $2', k || '_item_id') using v_id, v_uid;
    end loop;
  end if;
  return private.character_look(v_uid);
end $$;

create or replace function private.num_in(p jsonb, k text, lo numeric, hi numeric, dflt numeric) returns numeric
language sql immutable as $$
  select greatest(lo, least(hi, coalesce(case when jsonb_typeof(p->k) = 'number' then (p->>k)::numeric end, dflt)))
$$;

-- Ảnh hợp lệ cho thiết kế: trong app (/character/…) hoặc https, định dạng ảnh
create or replace function private.design_url_ok(u text) returns boolean
language sql immutable as $$
  select u ~ '^(/character/|https://)[^\s"<>]+\.(png|webp|jpe?g)(\?[^\s"<>]*)?$'
$$;

-- Thiết kế của một món: như 005900 + layers, tone, texture
create or replace function private.clean_design(p jsonb, p_slot text) returns jsonb
language plpgsql immutable as $$
declare
  v_pat jsonb := case when jsonb_typeof(p->'pattern') = 'object' and coalesce(p->'pattern'->>'kind', 'none') <> 'none' then p->'pattern' end;
  v_base jsonb;
  v_out jsonb;
  v_layers jsonb := '[]'::jsonb;
  l jsonb;
  v_type text;
  v_text text;
  v_n integer := 0;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return null; end if;
  if v_pat is not null then
    if not ((v_pat->>'kind') = any(private.pattern_kinds(p_slot))) then raise exception 'INVALID_PATTERN'; end if;
    if coalesce(v_pat->>'color', '') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_PATTERN'; end if;
    v_pat := jsonb_build_object('kind', v_pat->>'kind', 'color', lower(v_pat->>'color'));
  end if;
  if p_slot = 'top' then
    v_base := private.clean_print(p - 'pattern' - 'layers' - 'tone' - 'texture');
  elsif nullif(trim(coalesce(p->>'logo_url', '')), '') is not null or nullif(trim(coalesce(p->>'title', '')), '') is not null
        or nullif(trim(coalesce(p->>'subtitle', '')), '') is not null or coalesce(p->>'personal', 'NONE') = 'NAME' then
    raise exception 'PRINT_TOP_ONLY';
  end if;
  v_out := coalesce(v_base, '{}'::jsonb);
  if v_pat is not null then v_out := v_out || jsonb_build_object('pattern', v_pat); end if;

  if jsonb_typeof(p->'layers') = 'array' and jsonb_array_length(p->'layers') > 0 then
    if p_slot not in ('top', 'bottom') then raise exception 'PRINT_TOP_ONLY'; end if;
    if jsonb_array_length(p->'layers') > 12 then raise exception 'TOO_MANY_LAYERS'; end if;
    for l in select value from jsonb_array_elements(p->'layers') loop
      v_type := l->>'type';
      if v_type not in ('text', 'image') then raise exception 'INVALID_LAYER'; end if;
      v_n := v_n + 1;
      if v_type = 'text' then
        v_text := left(trim(coalesce(l->>'text', '')), 40);
        if v_text = '' then continue; end if;
        if coalesce(l->>'font', 'athletic') !~ '^[a-z_]{2,20}$' then raise exception 'INVALID_LAYER'; end if;
        if coalesce(l->>'color', '#ffffff') !~ '^#[0-9a-fA-F]{6}$' or coalesce(l->>'stroke', '#000000') !~ '^#[0-9a-fA-F]{6}$' then
          raise exception 'INVALID_LAYER';
        end if;
        v_layers := v_layers || jsonb_build_array(jsonb_build_object('id', left(coalesce(l->>'id', v_n::text), 16), 'type', 'text', 'text', v_text,
          'font', coalesce(l->>'font', 'athletic'), 'color', lower(coalesce(l->>'color', '#ffffff')),
          'stroke', lower(coalesce(l->>'stroke', '#000000')), 'stroke_w', private.num_in(l, 'stroke_w', 0, 0.3, 0),
          'spacing', private.num_in(l, 'spacing', -0.1, 0.8, 0), 'bold', coalesce((l->>'bold')::boolean, true),
          'x', private.num_in(l, 'x', -0.2, 1.2, 0.5), 'y', private.num_in(l, 'y', -0.2, 1.2, 0.5), 'w', private.num_in(l, 'w', 0.02, 1.6, 0.4),
          'rot', private.num_in(l, 'rot', -180, 180, 0), 'opacity', private.num_in(l, 'opacity', 0.05, 1, 1)));
      else
        if not private.design_url_ok(coalesce(l->>'url', '')) then raise exception 'INVALID_LAYER'; end if;
        v_layers := v_layers || jsonb_build_array(jsonb_build_object('id', left(coalesce(l->>'id', v_n::text), 16), 'type', 'image', 'url', l->>'url',
          'x', private.num_in(l, 'x', -0.2, 1.2, 0.5), 'y', private.num_in(l, 'y', -0.2, 1.2, 0.5), 'w', private.num_in(l, 'w', 0.02, 1.6, 0.3),
          'rot', private.num_in(l, 'rot', -180, 180, 0), 'opacity', private.num_in(l, 'opacity', 0.05, 1, 1)));
      end if;
    end loop;
    if jsonb_array_length(v_layers) > 0 then v_out := v_out || jsonb_build_object('layers', v_layers); end if;
  end if;

  if jsonb_typeof(p->'tone') = 'object' then
    v_out := v_out || jsonb_build_object('tone', jsonb_build_object('strength', private.num_in(p->'tone', 'strength', 0.2, 1, 1),
      'light', private.num_in(p->'tone', 'light', -0.4, 0.4, 0)));
  end if;
  if jsonb_typeof(p->'texture') = 'object' then
    if not private.design_url_ok(coalesce(p->'texture'->>'url', '')) then raise exception 'INVALID_TEXTURE'; end if;
    v_out := v_out || jsonb_build_object('texture', jsonb_build_object('url', p->'texture'->>'url',
      'opacity', private.num_in(p->'texture', 'opacity', 0.05, 1, 0.6), 'scale', private.num_in(p->'texture', 'scale', 0.3, 3, 1)));
  end if;
  return nullif(v_out, '{}'::jsonb);
end $$;

-- Đồng phục CLB: ảnh trong thiết kế (lớp ảnh, vải) phải nằm trong kho của chính CLB
create or replace function private.design_urls(p jsonb) returns text[]
language sql immutable as $$
  select array_remove(array[p->>'logo_url', p->'texture'->>'url'] ||
    coalesce((select array_agg(l->>'url') from jsonb_array_elements(case when jsonb_typeof(p->'layers') = 'array' then p->'layers' else '[]'::jsonb end) l
               where l->>'type' = 'image'), array[]::text[]), null)
$$;

create or replace function public.request_club_uniform(p_club_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_print jsonb := private.clean_design(p->'print', 'top');
  v_parts jsonb := private.clean_parts(p->'parts');
  v_url text;
  k text;
  r public.club_uniform_requests;
begin
  if not public.club_is_staff(p_club_id) then raise exception 'FORBIDDEN'; end if;
  if char_length(trim(coalesce(p->>'name', ''))) < 2 then raise exception 'INVALID_NAME'; end if;
  if coalesce(p->>'color', '') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_COLOR'; end if;
  if v_print is null then raise exception 'INVALID_PRINT'; end if;
  foreach v_url in array private.design_urls(v_print) loop
    if v_url !~ ('/storage/v1/object/public/uniform-media/' || p_club_id::text || '/') and v_url !~ '^/character/' then raise exception 'INVALID_PRINT'; end if;
  end loop;
  for k in select jsonb_object_keys(coalesce(v_parts, '{}'::jsonb)) loop
    foreach v_url in array private.design_urls(coalesce(v_parts->k->'print', '{}'::jsonb)) loop
      if v_url !~ ('/storage/v1/object/public/uniform-media/' || p_club_id::text || '/') and v_url !~ '^/character/' then raise exception 'INVALID_PRINT'; end if;
    end loop;
  end loop;
  if (select count(*) from public.club_uniform_requests x where x.club_id = p_club_id and x.status = 'PENDING') >= 3 then
    raise exception 'TOO_MANY_REQUESTS';
  end if;
  insert into public.club_uniform_requests (club_id, requested_by, name, color, print, note, parts)
  values (p_club_id, v_uid, left(trim(p->>'name'), 60), lower(p->>'color'), v_print, nullif(left(trim(coalesce(p->>'note', '')), 500), ''), v_parts)
  returning * into r;
  return private.uniform_request_json(r);
end $$;

revoke all on function private.character_bodies(), private.num_in(jsonb, text, numeric, numeric, numeric), private.design_url_ok(text),
  private.design_urls(jsonb) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001006100_runner_nearby.sql
-- ===================================================================
-- 006100: Runner Nearby (Quanh đây) — V1, xem docs/RUNNER_NEARBY.md.
-- • Mặc định TẮT; bật cần đồng ý riêng (phiên bản đồng ý) + ≥ 3 bài chạy hợp lệ.
-- • Vị trí chỉ lưu Ô LƯỚI ~1 km (làm tròn 0,01°), KHÔNG lưu toạ độ gốc, có hạn (24 giờ / 7 / 30 ngày).
-- • Khoảng cách hiển thị: số km (≥ 1) tính giữa tâm 2 ô + độ lệch cố định cho từng cặp (±0,5 km) → không dò tam giác được;
--   đổi vị trí ≤ 3 lần / 24 giờ, tìm ≤ 60 lần / giờ.
-- • Ai thấy tôi: VERIFIED (mặc định: người cũng đã đủ điều kiện) / SAME_GENDER / CLUBS (chung CLB).
-- • Kết nối 2 chiều (phải chấp nhận), ≤ 15 lời mời / ngày, bị từ chối thì 30 ngày không gửi lại. Chưa có nhắn tin riêng:
--   "Rủ chạy" = mời vào buổi chạy công khai / CLB. Chặn hai chiều, báo cáo (3 người báo cáo → tự ẩn chờ admin).
-- • CLB: điểm tập công khai (ô lưới) + sự kiện CLB công khai (người ngoài đăng ký được).
-- Cần 001500, 005600. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 1. Bảng
-- ---------------------------------------------------------------------
create table if not exists public.runner_discovery_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default false,
  visible_to text not null default 'VERIFIED' check (visible_to in ('VERIFIED', 'SAME_GENDER', 'CLUBS')),
  purposes text[] not null default array['BUDDY']::text[],
  goals text[] not null default '{}'::text[],
  time_slots text[] not null default '{}'::text[],
  share_pace boolean not null default true,
  radius_km integer not null default 10 check (radius_km in (2, 5, 10, 20)),
  bio text check (bio is null or char_length(bio) <= 140),
  consent_version text,
  consent_at timestamptz,
  suspended_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.runner_location_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  cell_lat numeric(6, 2) not null check (cell_lat between -90 and 90),
  cell_lng numeric(6, 2) not null check (cell_lng between -180 and 180),
  source text not null check (source in ('DEVICE', 'AREA')),
  area_label text check (area_label is null or char_length(area_label) <= 60),
  moves integer not null default 0,
  moves_since timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists runner_presence_cell_idx on public.runner_location_presence (cell_lat, cell_lng);

create table if not exists public.runner_connection_requests (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.profiles(id) on delete cascade,
  to_id uuid not null references public.profiles(id) on delete cascade,
  message text check (message is null or char_length(message) <= 140),
  status text not null default 'PENDING' check (status in ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (from_id <> to_id)
);
create unique index if not exists runner_request_pending_uq on public.runner_connection_requests (from_id, to_id) where status = 'PENDING';
create index if not exists runner_request_to_idx on public.runner_connection_requests (to_id, status);

create table if not exists public.runner_connections (
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);
create index if not exists runner_connections_b_idx on public.runner_connections (user_b);

create table if not exists public.user_blocks (
  blocker uuid not null references public.profiles(id) on delete cascade,
  blocked uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked);

create table if not exists public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid not null references public.profiles(id) on delete cascade,
  target uuid not null references public.profiles(id) on delete cascade,
  context text not null default 'NEARBY' check (context in ('NEARBY', 'CONNECTION', 'CLUB', 'OTHER')),
  reason text not null check (reason in ('SPAM', 'HARASSMENT', 'FAKE', 'UNSAFE', 'OTHER')),
  note text check (note is null or char_length(note) <= 500),
  status text not null default 'OPEN' check (status in ('OPEN', 'RESOLVED', 'DISMISSED')),
  resolution text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check (reporter <> target)
);
create index if not exists user_reports_status_idx on public.user_reports (status, created_at desc);

-- Nhật ký lượt tìm (giới hạn tần suất, phát hiện dò vị trí) — giữ 7 ngày
create table if not exists public.runner_nearby_searches (
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists runner_searches_idx on public.runner_nearby_searches (user_id, created_at desc);

-- Mọi đọc / ghi qua RPC
alter table public.runner_discovery_settings enable row level security;
alter table public.runner_location_presence enable row level security;
alter table public.runner_connection_requests enable row level security;
alter table public.runner_connections enable row level security;
alter table public.user_blocks enable row level security;
alter table public.user_reports enable row level security;
alter table public.runner_nearby_searches enable row level security;
revoke all on public.runner_discovery_settings, public.runner_location_presence, public.runner_connection_requests,
  public.runner_connections, public.user_blocks, public.user_reports, public.runner_nearby_searches from anon, authenticated;

-- CLB: điểm tập công khai; sự kiện CLB công khai
alter table public.clubs add column if not exists area_label text;
alter table public.clubs add column if not exists cell_lat numeric(6, 2);
alter table public.clubs add column if not exists cell_lng numeric(6, 2);
alter table public.club_events add column if not exists visibility text not null default 'CLUB';
alter table public.club_events drop constraint if exists club_events_visibility_chk;
alter table public.club_events add constraint club_events_visibility_chk check (visibility in ('CLUB', 'PUBLIC'));

-- ---------------------------------------------------------------------
-- 2. Hàm phụ
-- ---------------------------------------------------------------------
create or replace function private.nearby_consent_version() returns text language sql immutable as $$ select 'nearby-v1' $$;

-- Số bài chạy hợp lệ (điều kiện bật)
create or replace function private.valid_runs(p_user uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.activities a
   where a.user_id = p_user and a.validation_status = 'APPROVED' and coalesce(a.status, '') <> 'DELETED'
$$;

create or replace function private.nearby_eligible(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select private.valid_runs(p_user) >= 3
     and not exists (select 1 from public.profiles p where p.id = p_user and p.banned_at is not null)
$$;

-- Pace điển hình (giây / km): trung vị 28 ngày, bài hợp lệ ≥ 1 km
create or replace function private.typical_pace(p_user uuid) returns integer
language sql stable security definer set search_path = public as $$
  select round(percentile_cont(0.5) within group (order by a.moving_time_s / (a.distance_m / 1000.0)))::int
    from public.activities a
   where a.user_id = p_user and a.validation_status = 'APPROVED' and coalesce(a.status, '') <> 'DELETED'
     and a.distance_m >= 1000 and a.moving_time_s > 0 and a.started_at > now() - interval '28 days'
$$;

create or replace function private.is_blocked(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_blocks b where (b.blocker = p_a and b.blocked = p_b) or (b.blocker = p_b and b.blocked = p_a))
$$;

create or replace function private.are_connected(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.runner_connections c where c.user_a = least(p_a, p_b) and c.user_b = greatest(p_a, p_b))
$$;

create or replace function private.share_club(p_a uuid, p_b uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.club_members m1 join public.club_members m2 on m2.club_id = m1.club_id
   where m1.user_id = p_a and m2.user_id = p_b and m1.status = 'APPROVED' and m2.status = 'APPROVED'
$$;

-- Người xem có được thấy người này theo "ai thấy tôi" không
create or replace function private.nearby_visible(p_viewer uuid, p_target uuid, p_mode text) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_mode
    when 'SAME_GENDER' then exists (select 1 from public.profiles a join public.profiles b on b.id = p_target
                                     where a.id = p_viewer and a.gender is not null and a.gender = b.gender)
    when 'CLUBS' then private.share_club(p_viewer, p_target) > 0
    else true end
$$;

-- Khoảng cách (km) giữa tâm 2 ô lưới
create or replace function private.cell_km(a_lat numeric, a_lng numeric, b_lat numeric, b_lng numeric) returns numeric
language sql immutable as $$
  select 6371 * 2 * asin(sqrt(power(sin(radians((b_lat - a_lat)::float8) / 2), 2)
    + cos(radians(a_lat::float8)) * cos(radians(b_lat::float8)) * power(sin(radians((b_lng - a_lng)::float8) / 2), 2)))::numeric
$$;

-- Km hiển thị: làm tròn 1 km, cộng độ lệch cố định theo cặp (±0,5) → cùng một người luôn thấy cùng một số, không dò được
create or replace function private.shown_km(p_km numeric, p_a uuid, p_b uuid) returns integer
language sql immutable as $$
  select greatest(1, round(p_km + ((abs(hashtext(least(p_a, p_b)::text || greatest(p_a, p_b)::text)) % 100) / 100.0 - 0.5))::int)
$$;

create or replace function private.first_name(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  -- tên gọi + chữ cái đầu họ: "Nguyễn Văn An" → "An N."
  select case when n is null or n = '' then 'Runner'
              when position(' ' in n) = 0 then n
              else regexp_replace(n, '^.*\s', '') || ' ' || left(n, 1) || '.' end
    from (select trim(coalesce((select display_name from public.profiles where id = p_user), '')) as n) x
$$;

-- ---------------------------------------------------------------------
-- 3. Cài đặt + vị trí của tôi
-- ---------------------------------------------------------------------
create or replace function public.my_discovery() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  s public.runner_discovery_settings := (select x from public.runner_discovery_settings x where x.user_id = v_uid);
  p public.runner_location_presence := (select x from public.runner_location_presence x where x.user_id = v_uid);
begin
  return jsonb_build_object(
    'enabled', coalesce(s.enabled, false) and s.suspended_at is null,
    'suspended', s.suspended_at is not null,
    'visible_to', coalesce(s.visible_to, 'VERIFIED'), 'purposes', coalesce(to_jsonb(s.purposes), '["BUDDY"]'::jsonb),
    'goals', coalesce(to_jsonb(s.goals), '[]'::jsonb), 'time_slots', coalesce(to_jsonb(s.time_slots), '[]'::jsonb),
    'share_pace', coalesce(s.share_pace, true), 'radius_km', coalesce(s.radius_km, 10), 'bio', s.bio,
    'consented', s.consent_version = private.nearby_consent_version(),
    'valid_runs', private.valid_runs(v_uid), 'eligible', private.nearby_eligible(v_uid),
    'pace_s', private.typical_pace(v_uid),
    'presence', case when p.user_id is not null and p.expires_at > now() then jsonb_build_object(
      'source', p.source, 'area_label', p.area_label, 'updated_at', p.updated_at, 'expires_at', p.expires_at,
      'moves_left', greatest(0, 3 - case when p.moves_since > now() - interval '24 hours' then p.moves else 0 end)) end,
    'incoming', (select count(*) from public.runner_connection_requests r where r.to_id = v_uid and r.status = 'PENDING'),
    'connections', (select count(*) from public.runner_connections c where c.user_a = v_uid or c.user_b = v_uid));
end $$;

-- p: {enabled, consent, visible_to, purposes[], goals[], time_slots[], share_pace, radius_km, bio}
create or replace function public.set_discovery(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  s public.runner_discovery_settings := (select x from public.runner_discovery_settings x where x.user_id = v_uid);
  v_enabled boolean := coalesce((p->>'enabled')::boolean, s.enabled, false);
  v_vis text := coalesce(p->>'visible_to', s.visible_to, 'VERIFIED');
  v_radius integer := coalesce((p->>'radius_km')::int, s.radius_km, 10);
  v_purposes text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(p->'purposes') = 'array' then p->'purposes' end) x), s.purposes, array['BUDDY']);
  v_goals text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(p->'goals') = 'array' then p->'goals' end) x), s.goals, '{}');
  v_slots text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(p->'time_slots') = 'array' then p->'time_slots' end) x), s.time_slots, '{}');
  v_consent text := case when coalesce((p->>'consent')::boolean, false) then private.nearby_consent_version() else s.consent_version end;
begin
  if v_vis not in ('VERIFIED', 'SAME_GENDER', 'CLUBS') then raise exception 'INVALID_SETTINGS'; end if;
  if v_radius not in (2, 5, 10, 20) then raise exception 'INVALID_SETTINGS'; end if;
  if not (v_purposes <@ array['BUDDY', 'CLUB', 'COACH']) or not (v_goals <@ array['5K', '10K', 'HM', 'FM', 'TRAIL'])
     or not (v_slots <@ array['EARLY', 'MORNING', 'NOON', 'EVENING', 'WEEKEND']) then raise exception 'INVALID_SETTINGS'; end if;
  if v_enabled then
    if coalesce(v_consent, '') <> private.nearby_consent_version() then raise exception 'CONSENT_REQUIRED'; end if;
    if not private.nearby_eligible(v_uid) then raise exception 'NOT_ELIGIBLE'; end if;
    if s.suspended_at is not null then raise exception 'NEARBY_SUSPENDED'; end if;
  end if;
  insert into public.runner_discovery_settings as t (user_id, enabled, visible_to, purposes, goals, time_slots, share_pace, radius_km, bio,
                                                     consent_version, consent_at, updated_at)
  values (v_uid, v_enabled, v_vis, v_purposes, v_goals, v_slots, coalesce((p->>'share_pace')::boolean, s.share_pace, true), v_radius,
          case when p ? 'bio' then nullif(left(trim(coalesce(p->>'bio', '')), 140), '') else s.bio end,
          v_consent, case when v_consent is distinct from s.consent_version then now() else s.consent_at end, now())
  on conflict (user_id) do update set enabled = excluded.enabled, visible_to = excluded.visible_to, purposes = excluded.purposes,
    goals = excluded.goals, time_slots = excluded.time_slots, share_pace = excluded.share_pace, radius_km = excluded.radius_km,
    bio = excluded.bio, consent_version = excluded.consent_version, consent_at = excluded.consent_at, updated_at = now();
  -- Tắt = xoá vị trí ngay
  if not v_enabled then delete from public.runner_location_presence where user_id = v_uid; end if;
  return public.my_discovery();
end $$;

-- Công bố vị trí gần đúng: làm tròn về ô ~1 km trước khi lưu; đổi ô tối đa 3 lần / 24 giờ
create or replace function public.set_presence(p_lat double precision, p_lng double precision, p_source text, p_area text default null, p_hours integer default 168)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  s public.runner_discovery_settings := (select x from public.runner_discovery_settings x where x.user_id = v_uid);
  p public.runner_location_presence := (select x from public.runner_location_presence x where x.user_id = v_uid);
  v_lat numeric(6, 2) := round(p_lat::numeric, 2);
  v_lng numeric(6, 2) := round(p_lng::numeric, 2);
  v_moves integer;
begin
  if not coalesce(s.enabled, false) or s.suspended_at is not null then raise exception 'NEARBY_DISABLED'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'INVALID_LOCATION'; end if;
  if p_source not in ('DEVICE', 'AREA') then raise exception 'INVALID_LOCATION'; end if;
  if p_hours not in (24, 168, 720) then raise exception 'INVALID_LOCATION'; end if;
  v_moves := case when p.user_id is null then 0 when p.moves_since > now() - interval '24 hours' then p.moves else 0 end;
  if p.user_id is not null and (p.cell_lat <> v_lat or p.cell_lng <> v_lng) then
    if v_moves >= 3 then raise exception 'TOO_MANY_MOVES'; end if;
    v_moves := v_moves + 1;
  end if;
  insert into public.runner_location_presence as t (user_id, cell_lat, cell_lng, source, area_label, moves, moves_since, updated_at, expires_at)
  values (v_uid, v_lat, v_lng, p_source, nullif(left(trim(coalesce(p_area, '')), 60), ''), v_moves,
          case when p.user_id is null or p.moves_since <= now() - interval '24 hours' then now() else p.moves_since end,
          now(), now() + make_interval(hours => p_hours))
  on conflict (user_id) do update set cell_lat = excluded.cell_lat, cell_lng = excluded.cell_lng, source = excluded.source,
    area_label = excluded.area_label, moves = excluded.moves, moves_since = excluded.moves_since, updated_at = now(), expires_at = excluded.expires_at;
  return public.my_discovery();
end $$;

create or replace function public.clear_presence() returns void
language sql security definer set search_path = public as $$
  delete from public.runner_location_presence where user_id = private.require_uid()
$$;

-- ---------------------------------------------------------------------
-- 4. Tìm runner phù hợp
-- ---------------------------------------------------------------------
-- p: {radius_km, pace: ALL|FAST|MID|EASY|UNKNOWN, purpose, goal, slot, offset}
create or replace function public.nearby_runners(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  s public.runner_discovery_settings := (select x from public.runner_discovery_settings x where x.user_id = v_uid);
  me public.runner_location_presence := (select x from public.runner_location_presence x where x.user_id = v_uid and x.expires_at > now());
  v_radius integer := coalesce((p->>'radius_km')::int, s.radius_km, 10);
  v_pace text := upper(coalesce(p->>'pace', 'ALL'));
  v_purpose text := nullif(nullif(upper(coalesce(p->>'purpose', '')), ''), 'ALL');
  v_goal text := nullif(nullif(upper(coalesce(p->>'goal', '')), ''), 'ALL');
  v_slot text := nullif(nullif(upper(coalesce(p->>'slot', '')), ''), 'ALL');
  v_offset integer := greatest(0, coalesce((p->>'offset')::int, 0));
  v_my_pace integer := private.typical_pace(v_uid);
  v_dlat numeric;
  v_dlng numeric;
begin
  if not coalesce(s.enabled, false) or s.suspended_at is not null then raise exception 'NEARBY_DISABLED'; end if;
  if me.user_id is null then raise exception 'NO_PRESENCE'; end if;
  if v_radius not in (2, 5, 10, 20) then v_radius := 10; end if;
  if (select count(*) from public.runner_nearby_searches x where x.user_id = v_uid and x.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'TOO_MANY_SEARCHES';
  end if;
  insert into public.runner_nearby_searches (user_id) values (v_uid);
  delete from public.runner_nearby_searches where created_at < now() - interval '7 days';
  delete from public.runner_location_presence where expires_at < now() - interval '1 day';
  v_dlat := v_radius / 111.0 + 0.01;
  v_dlng := v_radius / (111.0 * greatest(cos(radians(me.cell_lat::float8)), 0.2)) + 0.01;

  return (
    with cand as (
      select o.user_id as id, ds, o, private.cell_km(me.cell_lat, me.cell_lng, o.cell_lat, o.cell_lng) as km,
             case when ds.share_pace then private.typical_pace(o.user_id) end as pace
        from public.runner_location_presence o
        join public.runner_discovery_settings ds on ds.user_id = o.user_id
       where o.user_id <> v_uid and o.expires_at > now() and ds.enabled and ds.suspended_at is null
         and o.cell_lat between me.cell_lat - v_dlat and me.cell_lat + v_dlat
         and o.cell_lng between me.cell_lng - v_dlng and me.cell_lng + v_dlng
         and not private.is_blocked(v_uid, o.user_id)
         and private.nearby_visible(v_uid, o.user_id, ds.visible_to)      -- họ cho mình thấy
         and private.nearby_visible(o.user_id, v_uid, s.visible_to)       -- mình cho họ thấy (công bằng 2 chiều)
         and private.nearby_eligible(o.user_id)
    ), f as (
      select c.*,
        private.share_club(v_uid, c.id) as clubs,
        (select count(*) from public.runner_connections a join public.runner_connections b
            on (b.user_a = case when a.user_a = v_uid then a.user_b else a.user_a end or b.user_b = case when a.user_a = v_uid then a.user_b else a.user_a end)
           where (a.user_a = v_uid or a.user_b = v_uid) and (b.user_a = c.id or b.user_b = c.id)) as mutual
        from cand c
       where c.km <= v_radius
         and (v_pace = 'ALL' or (v_pace = 'UNKNOWN' and c.pace is null)
              or (v_pace = 'FAST' and c.pace < 330) or (v_pace = 'MID' and c.pace between 330 and 420) or (v_pace = 'EASY' and c.pace > 420))
         and (v_purpose is null or v_purpose = any((c.ds).purposes))
         and (v_goal is null or v_goal = any((c.ds).goals))
         and (v_slot is null or v_slot = any((c.ds).time_slots))
    ), sc as (
      select f.*,
        -- pace 30 · khung giờ 20 · mục tiêu 15 · mục đích 10 · cộng đồng 15 · khoảng cách 10
        (case when f.pace is null or v_my_pace is null then 12 else greatest(0, 30 - greatest(0, abs(f.pace - v_my_pace) - 20) * 30 / 70.0) end
         + least(20, 10 * cardinality(array(select unnest((f.ds).time_slots) intersect select unnest(s.time_slots))))
         + least(15, 8 * cardinality(array(select unnest((f.ds).goals) intersect select unnest(s.goals))))
         + case when 'BUDDY' = any((f.ds).purposes) and 'BUDDY' = any(s.purposes) then 10 else 3 end
         + least(15, 10 * least(f.clubs, 1) + 3 * f.mutual)
         + case when f.km < 2 then 10 when f.km < 5 then 8 when f.km < 10 then 5 else 2 end
         + (abs(hashtext(f.id::text || current_date::text)) % 5)) as score
        from f
    )
    select jsonb_build_object('items', coalesce(jsonb_agg(y.x order by y.rn), '[]'::jsonb),
      'total', (select count(*) from sc), 'nearby_total', (select count(*) from cand))
      from (
        select row_number() over (order by sc.score desc, sc.id) as rn, jsonb_build_object(
          'id', sc.id, 'name', private.first_name(sc.id),
          'avatar_url', (select avatar_url from public.profiles where id = sc.id),
          'level', (select level from public.profiles where id = sc.id),
          'km', private.shown_km(sc.km, v_uid, sc.id), 'area_label', (sc.o).area_label,
          'pace_s', sc.pace, 'goals', to_jsonb((sc.ds).goals), 'time_slots', to_jsonb((sc.ds).time_slots),
          'purposes', to_jsonb((sc.ds).purposes), 'bio', (sc.ds).bio, 'clubs', sc.clubs, 'mutual', sc.mutual,
          'score', round(sc.score), 'connection',
            case when private.are_connected(v_uid, sc.id) then 'CONNECTED'
                 when exists (select 1 from public.runner_connection_requests r where r.from_id = v_uid and r.to_id = sc.id and r.status = 'PENDING') then 'PENDING_OUT'
                 when exists (select 1 from public.runner_connection_requests r where r.from_id = sc.id and r.to_id = v_uid and r.status = 'PENDING') then 'PENDING_IN'
                 else 'NONE' end,
          'reasons', to_jsonb(array_remove(array[
            case when sc.pace is not null and v_my_pace is not null and abs(sc.pace - v_my_pace) <= 30 then 'PACE' end,
            case when (sc.ds).time_slots && s.time_slots then 'SLOT' end,
            case when (sc.ds).goals && s.goals then 'GOAL' end,
            case when sc.clubs > 0 then 'CLUB' end,
            case when sc.mutual > 0 then 'MUTUAL' end], null))) as x
          from sc
      ) y(rn, x)
     where y.rn > v_offset and y.rn <= v_offset + 30
  );
end $$;

-- Buổi chạy công khai của CLB gần tôi (điểm hẹn là nơi công cộng → hiện km với 1 số lẻ)
create or replace function public.nearby_events(p_radius_km integer default 20) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  me public.runner_location_presence := (select x from public.runner_location_presence x where x.user_id = v_uid and x.expires_at > now());
begin
  if me.user_id is null then raise exception 'NO_PRESENCE'; end if;
  return (select coalesce(jsonb_agg(private.event_json(e, v_uid) || jsonb_build_object(
            'club_name', c.name, 'club_avatar', c.avatar_url,
            'km', round(private.cell_km(me.cell_lat, me.cell_lng, e.lat::numeric, e.lng::numeric), 1),
            'is_member', exists (select 1 from public.club_members m where m.club_id = e.club_id and m.user_id = v_uid and m.status = 'APPROVED'))
          order by e.starts_at), '[]'::jsonb)
            from public.club_events e join public.clubs c on c.id = e.club_id
           where e.visibility = 'PUBLIC' and e.status = 'SCHEDULED' and e.lat is not null
             and e.starts_at > now() - interval '1 hour' and e.starts_at < now() + interval '14 days'
             and private.cell_km(me.cell_lat, me.cell_lng, e.lat::numeric, e.lng::numeric) <= least(greatest(p_radius_km, 2), 50));
end $$;

create or replace function public.nearby_clubs(p_radius_km integer default 20) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  me public.runner_location_presence := (select x from public.runner_location_presence x where x.user_id = v_uid and x.expires_at > now());
begin
  if me.user_id is null then raise exception 'NO_PRESENCE'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url, 'accent_color', c.accent_color,
            'member_count', c.member_count, 'area_label', c.area_label, 'join_policy', c.join_policy,
            'km', round(private.cell_km(me.cell_lat, me.cell_lng, c.cell_lat, c.cell_lng)),
            'is_member', exists (select 1 from public.club_members m where m.club_id = c.id and m.user_id = v_uid and m.status = 'APPROVED'),
            'upcoming', (select count(*) from public.club_events e where e.club_id = c.id and e.visibility = 'PUBLIC' and e.status = 'SCHEDULED' and e.starts_at > now()))
          order by private.cell_km(me.cell_lat, me.cell_lng, c.cell_lat, c.cell_lng)), '[]'::jsonb)
            from public.clubs c
           where c.cell_lat is not null
             and private.cell_km(me.cell_lat, me.cell_lng, c.cell_lat, c.cell_lng) <= least(greatest(p_radius_km, 2), 50));
end $$;

-- ---------------------------------------------------------------------
-- 5. Kết nối
-- ---------------------------------------------------------------------
create or replace function public.send_connection(p_to uuid, p_message text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  s public.runner_discovery_settings := (select x from public.runner_discovery_settings x where x.user_id = v_uid);
  t public.runner_discovery_settings := (select x from public.runner_discovery_settings x where x.user_id = p_to);
  v_msg text := nullif(left(trim(coalesce(p_message, '')), 140), '');
  v_in public.runner_connection_requests := (select r from public.runner_connection_requests r where r.from_id = p_to and r.to_id = v_uid and r.status = 'PENDING');
  r public.runner_connection_requests;
begin
  if p_to = v_uid then raise exception 'INVALID_TARGET'; end if;
  if not coalesce(s.enabled, false) or s.suspended_at is not null then raise exception 'NEARBY_DISABLED'; end if;
  if t.user_id is null or not t.enabled or t.suspended_at is not null or not private.nearby_visible(v_uid, p_to, t.visible_to) then
    raise exception 'TARGET_UNAVAILABLE';
  end if;
  if private.is_blocked(v_uid, p_to) then raise exception 'TARGET_UNAVAILABLE'; end if;
  if private.are_connected(v_uid, p_to) then raise exception 'ALREADY_CONNECTED'; end if;
  if v_msg is not null and v_msg ~* '(https?://|www\.|\.com|\.vn|zalo|telegram|t\.me)' then raise exception 'NO_LINKS'; end if;
  -- Họ đã mời mình → chấp nhận luôn
  if v_in.id is not null then return public.respond_connection(v_in.id, 'ACCEPT'); end if;
  if exists (select 1 from public.runner_connection_requests x where x.from_id = v_uid and x.to_id = p_to and x.status = 'PENDING') then
    raise exception 'ALREADY_REQUESTED';
  end if;
  if exists (select 1 from public.runner_connection_requests x where x.from_id = v_uid and x.to_id = p_to and x.status = 'DECLINED'
              and x.responded_at > now() - interval '30 days') then raise exception 'REQUEST_COOLDOWN'; end if;
  if (select count(*) from public.runner_connection_requests x where x.from_id = v_uid and x.created_at > now() - interval '24 hours') >= 15 then
    raise exception 'TOO_MANY_REQUESTS';
  end if;
  insert into public.runner_connection_requests (from_id, to_id, message) values (v_uid, p_to, v_msg) returning * into r;
  perform private.notify(p_to, null, 'RUNNER_CONNECT', private.first_name(v_uid) || ' muốn kết nối chạy cùng bạn',
    coalesce(v_msg, 'Xem lời mời trong Quanh đây.'), '/nearby/connections', v_uid, true);
  return jsonb_build_object('id', r.id, 'status', r.status);
end $$;

create or replace function public.respond_connection(p_id uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  r public.runner_connection_requests := (select x from public.runner_connection_requests x where x.id = p_id);
begin
  if r.id is null or r.to_id <> v_uid then raise exception 'REQUEST_NOT_FOUND'; end if;
  if r.status <> 'PENDING' then raise exception 'REQUEST_CLOSED'; end if;
  if upper(p_action) = 'ACCEPT' then
    if private.is_blocked(r.from_id, r.to_id) then raise exception 'TARGET_UNAVAILABLE'; end if;
    update public.runner_connection_requests set status = 'ACCEPTED', responded_at = now() where id = r.id;
    insert into public.runner_connections (user_a, user_b) values (least(r.from_id, r.to_id), greatest(r.from_id, r.to_id)) on conflict do nothing;
    perform private.notify(r.from_id, null, 'RUNNER_CONNECTED', private.first_name(v_uid) || ' đã chấp nhận kết nối',
      'Rủ nhau một buổi chạy nhé!', '/nearby/connections', v_uid, true);
    return jsonb_build_object('id', r.id, 'status', 'ACCEPTED');
  elsif upper(p_action) = 'DECLINE' then
    update public.runner_connection_requests set status = 'DECLINED', responded_at = now() where id = r.id;
    return jsonb_build_object('id', r.id, 'status', 'DECLINED');
  end if;
  raise exception 'INVALID_ACTION';
end $$;

create or replace function public.cancel_connection_request(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update public.runner_connection_requests set status = 'CANCELLED', responded_at = now()
   where id = p_id and from_id = private.require_uid() and status = 'PENDING'
$$;

create or replace function public.remove_connection(p_user uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.runner_connections where user_a = least(private.require_uid(), p_user) and user_b = greatest(private.require_uid(), p_user)
$$;

create or replace function private.person_json(p_user uuid, p_viewer uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'name', case when private.are_connected(p_user, p_viewer) then p.display_name else private.first_name(p.id) end,
    'avatar_url', p.avatar_url, 'level', p.level,
    'pace_s', case when coalesce((select share_pace from public.runner_discovery_settings where user_id = p.id), false) then private.typical_pace(p.id) end,
    'goals', coalesce((select to_jsonb(goals) from public.runner_discovery_settings where user_id = p.id), '[]'::jsonb),
    'time_slots', coalesce((select to_jsonb(time_slots) from public.runner_discovery_settings where user_id = p.id), '[]'::jsonb),
    'bio', (select bio from public.runner_discovery_settings where user_id = p.id))
    from public.profiles p where p.id = p_user
$$;

create or replace function public.my_connections() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  return jsonb_build_object(
    'connections', (select coalesce(jsonb_agg(private.person_json(case when c.user_a = v_uid then c.user_b else c.user_a end, v_uid)
                       || jsonb_build_object('since', c.created_at) order by c.created_at desc), '[]'::jsonb)
                      from public.runner_connections c where (c.user_a = v_uid or c.user_b = v_uid)
                       and not private.is_blocked(c.user_a, c.user_b)),
    'incoming', (select coalesce(jsonb_agg(private.person_json(r.from_id, v_uid) || jsonb_build_object('request_id', r.id, 'message', r.message, 'at', r.created_at)
                    order by r.created_at desc), '[]'::jsonb)
                   from public.runner_connection_requests r where r.to_id = v_uid and r.status = 'PENDING' and not private.is_blocked(r.from_id, v_uid)),
    'outgoing', (select coalesce(jsonb_agg(private.person_json(r.to_id, v_uid) || jsonb_build_object('request_id', r.id, 'message', r.message, 'at', r.created_at)
                    order by r.created_at desc), '[]'::jsonb)
                   from public.runner_connection_requests r where r.from_id = v_uid and r.status = 'PENDING'),
    'blocked', (select coalesce(jsonb_agg(jsonb_build_object('id', b.blocked, 'name', private.first_name(b.blocked), 'at', b.created_at) order by b.created_at desc), '[]'::jsonb)
                  from public.user_blocks b where b.blocker = v_uid));
end $$;

-- "Rủ chạy": mời người đã kết nối vào buổi chạy công khai / sự kiện CLB mình tham gia, hoặc vào CLB của mình
create or replace function public.invite_to_run(p_user uuid, p_event_id uuid default null, p_club_id uuid default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  e public.club_events;
  v_note text := nullif(left(trim(coalesce(p_note, '')), 140), '');
begin
  if not private.are_connected(v_uid, p_user) or private.is_blocked(v_uid, p_user) then raise exception 'NOT_CONNECTED'; end if;
  if (select count(*) from public.notifications n where n.actor_id = v_uid and n.kind = 'RUNNER_INVITE' and n.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'TOO_MANY_REQUESTS';
  end if;
  if p_event_id is not null then
    e := (select x from public.club_events x where x.id = p_event_id);
    if e.id is null or e.status <> 'SCHEDULED' or e.starts_at < now() then raise exception 'EVENT_NOT_FOUND'; end if;
    if e.visibility <> 'PUBLIC' and not exists (select 1 from public.club_members m where m.club_id = e.club_id and m.user_id = p_user and m.status = 'APPROVED') then
      raise exception 'EVENT_NOT_PUBLIC';
    end if;
    perform private.notify(p_user, e.club_id, 'RUNNER_INVITE', private.first_name(v_uid) || ' rủ bạn chạy: ' || e.title,
      coalesce(v_note, to_char(e.starts_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM') || coalesce(' · ' || e.location_name, '')),
      case when e.visibility = 'PUBLIC' then '/nearby/events/' || e.id else '/clubs/' || e.club_id || '/events/' || e.id end, v_uid, true);
  elsif p_club_id is not null then
    if not exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = v_uid and m.status = 'APPROVED') then raise exception 'FORBIDDEN'; end if;
    perform private.notify(p_user, p_club_id, 'RUNNER_INVITE', private.first_name(v_uid) || ' rủ bạn vào CLB ' || (select name from public.clubs where id = p_club_id),
      v_note, '/clubs/' || p_club_id, v_uid, true);
  else
    raise exception 'INVALID_INVITE';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. Chặn / báo cáo
-- ---------------------------------------------------------------------
create or replace function public.block_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  if p_user = v_uid then raise exception 'INVALID_TARGET'; end if;
  insert into public.user_blocks (blocker, blocked) values (v_uid, p_user) on conflict do nothing;
  delete from public.runner_connections where user_a = least(v_uid, p_user) and user_b = greatest(v_uid, p_user);
  update public.runner_connection_requests set status = 'CANCELLED', responded_at = now()
   where status = 'PENDING' and ((from_id = v_uid and to_id = p_user) or (from_id = p_user and to_id = v_uid));
end $$;

create or replace function public.unblock_user(p_user uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.user_blocks where blocker = private.require_uid() and blocked = p_user
$$;

create or replace function public.report_user(p_user uuid, p_reason text, p_note text default null, p_context text default 'NEARBY') returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  if p_user = v_uid then raise exception 'INVALID_TARGET'; end if;
  if upper(p_reason) not in ('SPAM', 'HARASSMENT', 'FAKE', 'UNSAFE', 'OTHER') then raise exception 'INVALID_REASON'; end if;
  if exists (select 1 from public.user_reports r where r.reporter = v_uid and r.target = p_user and r.status = 'OPEN') then return; end if;
  insert into public.user_reports (reporter, target, context, reason, note)
  values (v_uid, p_user, coalesce(upper(p_context), 'NEARBY'), upper(p_reason), nullif(left(trim(coalesce(p_note, '')), 500), ''));
  -- 3 người khác nhau cùng báo cáo → tự ẩn khỏi Quanh đây chờ admin
  if (select count(distinct r.reporter) from public.user_reports r where r.target = p_user and r.status = 'OPEN') >= 3 then
    update public.runner_discovery_settings set suspended_at = coalesce(suspended_at, now()) where user_id = p_user;
    delete from public.runner_location_presence where user_id = p_user;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 7. CLB: điểm tập, sự kiện công khai, người ngoài đăng ký
-- ---------------------------------------------------------------------
create or replace function public.set_club_location(p_club_id uuid, p_lat double precision, p_lng double precision, p_area text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.club_is_staff(p_club_id) and not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  if p_lat is null then
    update public.clubs set cell_lat = null, cell_lng = null, area_label = null where id = p_club_id;
    return;
  end if;
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'INVALID_LOCATION'; end if;
  update public.clubs set cell_lat = round(p_lat::numeric, 2), cell_lng = round(p_lng::numeric, 2),
    area_label = nullif(left(trim(coalesce(p_area, '')), 60), '') where id = p_club_id;
end $$;

-- Vị trí CLB hiện tại (ban quản trị xem để sửa; người khác chỉ thấy km qua nearby_clubs)
create or replace function public.club_place(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.clubs := (select x from public.clubs x where x.id = p_club_id);
begin
  if c.id is null then raise exception 'CLUB_NOT_FOUND'; end if;
  if not public.club_is_staff(c.id) and not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object('area_label', c.area_label, 'lat', c.cell_lat, 'lng', c.cell_lng);
end $$;

create or replace function public.set_club_event_visibility(p_event_id uuid, p_visibility text) returns void
language plpgsql security definer set search_path = public as $$
declare e public.club_events := (select x from public.club_events x where x.id = p_event_id);
begin
  if e.id is null then raise exception 'EVENT_NOT_FOUND'; end if;
  if not public.club_is_staff(e.club_id) and not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  if upper(p_visibility) not in ('CLUB', 'PUBLIC') then raise exception 'INVALID_VISIBILITY'; end if;
  if upper(p_visibility) = 'PUBLIC' and e.lat is null then raise exception 'EVENT_NEEDS_LOCATION'; end if;
  update public.club_events set visibility = upper(p_visibility) where id = e.id;
end $$;

-- Đăng ký buổi chạy công khai (không cần là thành viên CLB)
create or replace function public.rsvp_public_event(p_event_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  e public.club_events := (select x from public.club_events x where x.id = p_event_id);
begin
  if e.id is null or e.visibility <> 'PUBLIC' then raise exception 'EVENT_NOT_FOUND'; end if;
  if p_status not in ('GOING', 'MAYBE', 'NOT_GOING') then raise exception 'INVALID_STATUS'; end if;
  if e.status = 'CANCELLED' then raise exception 'EVENT_CANCELLED'; end if;
  if now() > e.starts_at + make_interval(mins => e.duration_min) then raise exception 'EVENT_ENDED'; end if;
  if p_status = 'GOING' and e.capacity is not null
     and (select count(*) from public.club_event_rsvps where event_id = e.id and status = 'GOING' and user_id <> v_uid) >= e.capacity then
    raise exception 'EVENT_FULL';
  end if;
  insert into public.club_event_rsvps (event_id, user_id, status) values (e.id, v_uid, p_status)
  on conflict (event_id, user_id) do update set status = excluded.status, updated_at = now();
  return private.event_json(e, v_uid);
end $$;

-- Sự kiện CLB: kèm chế độ công khai
create or replace function private.event_json(e public.club_events, p_uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', e.id, 'club_id', e.club_id, 'title', e.title, 'description', e.description, 'starts_at', e.starts_at,
    'ends_at', e.starts_at + make_interval(mins => e.duration_min), 'duration_min', e.duration_min,
    'location_name', e.location_name, 'lat', e.lat, 'lng', e.lng, 'distance_km', e.distance_km, 'pace_text', e.pace_text,
    'capacity', e.capacity, 'status', e.status, 'visibility', e.visibility, 'cancel_reason', e.cancel_reason,
    'created_by', e.created_by, 'creator_name', (select display_name from public.profiles where id = e.created_by),
    'going_count', (select count(*) from public.club_event_rsvps r where r.event_id = e.id and r.status = 'GOING'),
    'maybe_count', (select count(*) from public.club_event_rsvps r where r.event_id = e.id and r.status = 'MAYBE'),
    'checked_in_count', (select count(*) from public.club_event_rsvps r where r.event_id = e.id and r.checked_in_at is not null),
    'my_status', (select r.status from public.club_event_rsvps r where r.event_id = e.id and r.user_id = p_uid),
    'my_checked_in_at', (select r.checked_in_at from public.club_event_rsvps r where r.event_id = e.id and r.user_id = p_uid))
$$;

-- Chi tiết sự kiện: người ngoài CLB xem được sự kiện CÔNG KHAI (không kèm danh sách người tham gia)
create or replace function public.club_event(p_event_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e public.club_events := (select x from public.club_events x where x.id = p_event_id);
  v_uid uuid := private.require_uid();
  v_member boolean;
begin
  if e.id is null then raise exception 'EVENT_NOT_FOUND'; end if;
  v_member := exists (select 1 from public.club_members m where m.club_id = e.club_id and m.user_id = v_uid and m.status = 'APPROVED');
  if not v_member and e.visibility <> 'PUBLIC' and not public.is_system_admin() then
    perform private.require_member(e.club_id);
  end if;
  return private.event_json(e, v_uid) || jsonb_build_object(
    'is_member', v_member,
    'club_name', (select c.name from public.clubs c where c.id = e.club_id),
    'club_avatar', (select c.avatar_url from public.clubs c where c.id = e.club_id),
    'can_manage', public.club_is_staff(e.club_id),
    'checkin_open', e.status = 'SCHEDULED' and now() between e.starts_at - interval '2 hours'
                                                          and e.starts_at + make_interval(mins => e.duration_min) + interval '2 hours',
    'attendees', case when v_member or public.is_system_admin() then (select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', r.user_id, 'display_name', p.display_name, 'avatar_url', p.avatar_url, 'status', r.status,
        'checked_in_at', r.checked_in_at, 'checkin_method', r.checkin_method)
        order by (r.checked_in_at is null), r.status, p.display_name), '[]'::jsonb)
      from public.club_event_rsvps r join public.profiles p on p.id = r.user_id
     where r.event_id = e.id and r.status <> 'NOT_GOING') else '[]'::jsonb end);
end $$;

-- ---------------------------------------------------------------------
-- 8. Quản trị báo cáo
-- ---------------------------------------------------------------------
create or replace function public.admin_list_reports(p_status text default 'OPEN') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'reporter', r.reporter, 'reporter_name', private.display_name(r.reporter),
            'target', r.target, 'target_name', private.display_name(r.target), 'context', r.context, 'reason', r.reason, 'note', r.note,
            'status', r.status, 'resolution', r.resolution, 'created_at', r.created_at, 'resolved_at', r.resolved_at,
            'target_reports', (select count(distinct x.reporter) from public.user_reports x where x.target = r.target),
            'target_suspended', exists (select 1 from public.runner_discovery_settings s where s.user_id = r.target and s.suspended_at is not null))
          order by r.created_at desc), '[]'::jsonb)
            from public.user_reports r where upper(coalesce(p_status, 'ALL')) = 'ALL' or r.status = upper(p_status));
end $$;

-- p_action: DISMISS (không vi phạm, gỡ ẩn) | SUSPEND (khoá Quanh đây) | BAN (khoá tài khoản — dùng admin_set_user_ban)
create or replace function public.admin_resolve_report(p_id uuid, p_action text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  r public.user_reports := (select x from public.user_reports x where x.id = p_id);
begin
  if r.id is null then raise exception 'REPORT_NOT_FOUND'; end if;
  if upper(p_action) = 'DISMISS' then
    update public.user_reports set status = 'DISMISSED', resolution = coalesce(nullif(trim(p_note), ''), 'Không vi phạm'), resolved_by = v_admin, resolved_at = now()
     where target = r.target and status = 'OPEN';
    update public.runner_discovery_settings set suspended_at = null where user_id = r.target;
  elsif upper(p_action) = 'SUSPEND' then
    update public.user_reports set status = 'RESOLVED', resolution = coalesce(nullif(trim(p_note), ''), 'Khoá Quanh đây'), resolved_by = v_admin, resolved_at = now()
     where target = r.target and status = 'OPEN';
    insert into public.runner_discovery_settings (user_id, enabled, suspended_at) values (r.target, false, now())
    on conflict (user_id) do update set enabled = false, suspended_at = now();
    delete from public.runner_location_presence where user_id = r.target;
  else
    raise exception 'INVALID_ACTION';
  end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_admin, 'USER_REPORT_' || upper(p_action), 'profile:' || r.target, jsonb_build_object('report', r.id, 'note', p_note));
end $$;

-- Việc cần xử lý: + báo cáo người dùng
create or replace function public.admin_inbox() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'orders', (select count(*) from public.orders o where o.status = 'PENDING' and (o.expires_at is null or o.expires_at > now())),
    'reviews', (select count(*) from public.activities a where a.validation_status = 'PENDING' and coalesce(a.status, '') <> 'DELETED'),
    'partners', (select count(*) from public.partners p where p.status = 'PENDING'),
    'cups', (select count(*) from public.club_cups c where c.status = 'PENDING_REVIEW'),
    'reports', (select count(distinct r.target) from public.user_reports r where r.status = 'OPEN'),
    'errors', (select count(distinct e.code) from private.client_errors e where e.last_at > now() - interval '24 hours'),
    'new_users_7d', (select count(*) from public.profiles p where p.created_at > now() - interval '7 days'),
    'active_7d', (select count(distinct a.user_id) from public.activities a where a.started_at > now() - interval '7 days'),
    'banned', (select count(*) from public.profiles p where p.banned_at is not null));
end $$;

-- ---------------------------------------------------------------------
-- 9. Quyền
-- ---------------------------------------------------------------------
revoke all on function private.nearby_consent_version(), private.valid_runs(uuid), private.nearby_eligible(uuid), private.typical_pace(uuid),
  private.is_blocked(uuid, uuid), private.are_connected(uuid, uuid), private.share_club(uuid, uuid), private.nearby_visible(uuid, uuid, text),
  private.cell_km(numeric, numeric, numeric, numeric), private.shown_km(numeric, uuid, uuid), private.first_name(uuid), private.person_json(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.my_discovery(), public.set_discovery(jsonb), public.set_presence(double precision, double precision, text, text, integer),
  public.clear_presence(), public.nearby_runners(jsonb), public.nearby_events(integer), public.nearby_clubs(integer),
  public.send_connection(uuid, text), public.respond_connection(uuid, text), public.cancel_connection_request(uuid), public.remove_connection(uuid),
  public.my_connections(), public.invite_to_run(uuid, uuid, uuid, text), public.block_user(uuid), public.unblock_user(uuid),
  public.report_user(uuid, text, text, text), public.set_club_location(uuid, double precision, double precision, text),
  public.set_club_event_visibility(uuid, text), public.club_place(uuid), public.rsvp_public_event(uuid, text), public.admin_list_reports(text),
  public.admin_resolve_report(uuid, text, text) from public, anon;
grant execute on function public.my_discovery(), public.set_discovery(jsonb), public.set_presence(double precision, double precision, text, text, integer),
  public.clear_presence(), public.nearby_runners(jsonb), public.nearby_events(integer), public.nearby_clubs(integer),
  public.send_connection(uuid, text), public.respond_connection(uuid, text), public.cancel_connection_request(uuid), public.remove_connection(uuid),
  public.my_connections(), public.invite_to_run(uuid, uuid, uuid, text), public.block_user(uuid), public.unblock_user(uuid),
  public.report_user(uuid, text, text, text), public.set_club_location(uuid, double precision, double precision, text),
  public.set_club_event_visibility(uuid, text), public.club_place(uuid), public.rsvp_public_event(uuid, text), public.admin_list_reports(text),
  public.admin_resolve_report(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';

commit;
