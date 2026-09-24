-- =====================================================================
-- 20261001001200 — QUẢN TRỊ VẬT PHẨM NHÂN VẬT (ADR-017, docs/vat-pham/HUONG_DAN.md)
--
--   * Bucket công khai "character-layers" chứa ảnh lớp PNG (khung 900x1350); chỉ quản trị viên hệ thống được tải lên / xóa
--   * admin_list_avatar_items: toàn bộ danh mục (cả món đang ẩn) + số người sở hữu
--   * admin_save_avatar_item: thêm / sửa một vật phẩm (màu hoặc lớp ảnh), kiểm tra đầy đủ, ghi nhật ký
--   * admin_set_avatar_item_active: bán / ngừng bán (không xóa để giữ đồ người chơi đã mua)
-- Phụ thuộc: 001100. Idempotent.
-- Viết để chạy được trong SQL Editor của Supabase: không dùng SELECT ... INTO, khối DO, LIMIT.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Kho ảnh lớp vật phẩm
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('character-layers', 'character-layers', true, 1048576, array['image/png'])
on conflict (id) do nothing;

drop policy if exists character_layers_insert on storage.objects;
create policy character_layers_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'character-layers' and public.is_system_admin());
drop policy if exists character_layers_update on storage.objects;
create policy character_layers_update on storage.objects for update to authenticated
  using (bucket_id = 'character-layers' and public.is_system_admin());
drop policy if exists character_layers_delete on storage.objects;
create policy character_layers_delete on storage.objects for delete to authenticated
  using (bucket_id = 'character-layers' and public.is_system_admin());

-- ---------------------------------------------------------------------
-- 2. RPC quản trị
-- ---------------------------------------------------------------------
create or replace function public.admin_list_avatar_items() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(private.item_json(i) || jsonb_build_object(
            'is_active', i.is_active, 'sort', i.sort,
            'owners', (select count(*) from public.user_inventory inv where inv.item_id = i.id))
          order by i.is_active desc, i.category, i.sort, i.name), '[]'::jsonb)
            from public.avatar_items i where i.code is not null);
end $$;

-- p_item: {code, name, description, slot, rarity, render_kind, color, layer_urls, price_xu, unlock_level, sort, is_default, is_active}
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
  v_active boolean := coalesce((p_item->>'is_active')::boolean, true);
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
  if v_level not between 1 and 5 then raise exception 'INVALID_LEVEL'; end if;

  if v_kind = 'TINT' then
    if not (v_slot = any(private.character_required_slots())) then raise exception 'TINT_SLOT_ONLY'; end if;
    if v_color is not null and v_color !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_COLOR'; end if;
    v_layers := null;
  elsif v_kind = 'LAYER' then
    if v_layers is null or v_layers = '{}'::jsonb then raise exception 'LAYER_REQUIRED'; end if;
    for k in select jsonb_object_keys(v_layers) loop
      if k not in ('male', 'female') then raise exception 'INVALID_LAYER'; end if;
      v_url := v_layers->>k;
      -- chỉ nhận ảnh PNG trong /character/... (repo) hoặc URL https (Supabase Storage)
      if v_url is null or v_url !~ '^(/character/|https://)[^\s"<>]+\.png(\?[^\s"<>]*)?$' then raise exception 'INVALID_LAYER'; end if;
    end loop;
    v_color := null;
  else
    raise exception 'INVALID_RENDER_KIND';
  end if;

  v_old := (select i from public.avatar_items i where i.code = v_code);
  if v_old.id is not null and v_old.category <> v_slot
     and exists (select 1 from public.user_inventory where item_id = v_old.id) then
    raise exception 'SLOT_LOCKED';                    -- đã có người sở hữu: không đổi sang ô khác
  end if;
  if v_old.id is not null and not v_active and v_code = v_slot || '_original' then raise exception 'ITEM_REQUIRED'; end if;

  insert into public.avatar_items (code, name, description, category, rarity, asset_url, render_kind, color, layer_urls,
                                   price_xu, unlock_level, sort, is_default, is_active)
  values (v_code, v_name, v_desc, v_slot, v_rarity, lower(v_kind), v_kind, v_color, v_layers,
          v_price, v_level, v_sort, v_default, v_active)
  on conflict (code) where code is not null do update set
    name = excluded.name, description = excluded.description, category = excluded.category, rarity = excluded.rarity,
    render_kind = excluded.render_kind, color = excluded.color, layer_urls = excluded.layer_urls,
    price_xu = excluded.price_xu, unlock_level = excluded.unlock_level, sort = excluded.sort,
    is_default = excluded.is_default, is_active = excluded.is_active;

  insert into public.admin_audit_log (actor_id, action, target, old_value, new_value)
  values (v_admin, case when v_old.id is null then 'AVATAR_ITEM_CREATE' else 'AVATAR_ITEM_UPDATE' end, 'avatar_item:' || v_code,
          case when v_old.id is null then null else private.item_json(v_old) || jsonb_build_object('is_active', v_old.is_active) end,
          private.item_json((select i from public.avatar_items i where i.code = v_code)) || jsonb_build_object('is_active', v_active));

  return private.item_json((select i from public.avatar_items i where i.code = v_code)) || jsonb_build_object('is_active', v_active);
end $$;

create or replace function public.admin_set_avatar_item_active(p_code text, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_admin uuid := private.require_admin(); v_slot text;
begin
  v_slot := (select category from public.avatar_items where code = p_code);
  if v_slot is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if not p_active and p_code = v_slot || '_original' then raise exception 'ITEM_REQUIRED'; end if;
  update public.avatar_items set is_active = p_active where code = p_code;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_admin, case when p_active then 'AVATAR_ITEM_ENABLE' else 'AVATAR_ITEM_DISABLE' end, 'avatar_item:' || p_code,
          jsonb_build_object('is_active', p_active));
end $$;

revoke all on function public.admin_list_avatar_items(), public.admin_save_avatar_item(jsonb),
  public.admin_set_avatar_item_active(text, boolean) from public, anon;
grant execute on function public.admin_list_avatar_items(), public.admin_save_avatar_item(jsonb),
  public.admin_set_avatar_item_active(text, boolean) to authenticated;

notify pgrst, 'reload schema';
