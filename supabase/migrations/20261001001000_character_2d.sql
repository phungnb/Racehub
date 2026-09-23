-- =====================================================================
-- 20261001001000 — NHÂN VẬT 2D: ẢNH THẬT + ĐỔI MÀU TRANG PHỤC (ADR-017, docs/NHAN_VAT.md)
--
-- Thay nhân vật 3D (ADR-016) bằng ảnh nhân vật thật. Vật phẩm là:
--   * TINT : bộ màu cho một vùng trên ảnh (áo, quần, tất, giày). Nếp vải và ánh sáng giữ nguyên.
--            color = null nghĩa là màu nguyên bản của ảnh.
--   * LAYER: (dành cho sau này) ảnh PNG trong suốt vẽ đúng khung chuẩn, xếp chồng lên nhân vật
--            (mũ, kính, áo CLB...). Đường dẫn trong layer_urls = {"male": url, "female": url}.
-- Vật phẩm 3D không còn hiển thị được (tóc, mũ, kính, đồng hồ, phụ kiện, hiệu ứng, bản trùng màu)
-- bị ngừng bán; ai đã mua được hoàn lại đúng số Xu (đúng loại Xu thưởng / Xu nạp đã trả).
-- Phụ thuộc: 000900. Idempotent. INTO luôn đặt cuối câu SELECT (xem ghi chú ở migration 000700).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Cột mới
-- ---------------------------------------------------------------------
alter table public.avatar_items add column if not exists render_kind text not null default 'TINT';
alter table public.avatar_items drop constraint if exists avatar_items_render_kind_check;
alter table public.avatar_items add constraint avatar_items_render_kind_check check (render_kind in ('TINT', 'LAYER'));
alter table public.avatar_items add column if not exists layer_urls jsonb;

-- ---------------------------------------------------------------------
-- 2. Ngừng bán đồ 3D không còn hiển thị được
-- ---------------------------------------------------------------------
update public.avatar_items set is_active = false
 where is_active and render_kind = 'TINT' and layer_urls is null
   and (category in ('base', 'hair', 'hat', 'glasses', 'watch', 'accessory', 'effect')
        or code in ('top_crop_black', 'bottom_tights_black'));   -- trùng màu với món khác

-- ---------------------------------------------------------------------
-- 3. Danh mục màu (giá theo ADR-014: 1 Xu ≈ 1.000đ). Món đã có giữ mã và giá, chỉ đổi tên cho đúng kiểu mới.
-- ---------------------------------------------------------------------
insert into public.avatar_items (code, name, description, category, rarity, asset_url, color, price_xu, unlock_level, is_default, sort) values
  -- Áo
  ('top_original', 'Áo nguyên bản', null, 'top', 'common', 'tint', null, 0, 1, true, 10),
  ('top_tee_blue', 'Áo Xanh Điện', null, 'top', 'common', 'tint', '#2f6bff', 0, 1, true, 11),
  ('top_crop_coral', 'Áo San Hô', null, 'top', 'common', 'tint', '#ff6b5b', 0, 1, true, 12),
  ('top_tee_white', 'Áo Trắng Tinh', null, 'top', 'common', 'tint', '#f4f6f8', 20, 1, false, 13),
  ('top_tee_black', 'Áo Đen Đêm', null, 'top', 'common', 'tint', '#1d2128', 20, 1, false, 14),
  ('top_red', 'Áo Đỏ Rực', null, 'top', 'common', 'tint', '#e11d48', 30, 1, false, 15),
  ('top_sky', 'Áo Xanh Trời', null, 'top', 'common', 'tint', '#0ea5e9', 30, 1, false, 16),
  ('top_singlet_orange', 'Áo Cam Nắng', 'Màu nổi bật trên đường chạy', 'top', 'rare', 'tint', '#ff8a1f', 60, 1, false, 17),
  ('top_longsleeve_gray', 'Áo Xám Sương', 'Cho những buổi chạy sáng se lạnh', 'top', 'rare', 'tint', '#8a94a6', 80, 1, false, 18),
  ('top_jacket_neon', 'Áo Neon Chanh', 'Nổi bật cả khi chạy đêm', 'top', 'epic', 'tint', '#b6ff3b', 150, 1, false, 19),
  ('top_singlet_level2', 'Áo Ngọc Lam', 'Quà khi lên cấp 2', 'top', 'rare', 'tint', '#14b8a6', 0, 2, false, 20),
  ('top_jacket_level4', 'Áo Tím Runner', 'Quà khi lên cấp 4', 'top', 'epic', 'tint', '#7c3aed', 0, 4, false, 21),
  ('top_tee_gold', 'Áo Huyền Thoại', 'Chỉ dành cho cấp 5', 'top', 'legendary', 'tint', '#f3c44b', 0, 5, false, 22),
  -- Quần
  ('bottom_original', 'Quần nguyên bản', null, 'bottom', 'common', 'tint', null, 0, 1, true, 30),
  ('bottom_shorts_black', 'Quần Đen', null, 'bottom', 'common', 'tint', '#1d2128', 0, 1, true, 31),
  ('bottom_shorts_navy', 'Quần Xanh Than', null, 'bottom', 'common', 'tint', '#1e2a4a', 20, 1, false, 32),
  ('bottom_white', 'Quần Trắng', null, 'bottom', 'common', 'tint', '#f4f6f8', 30, 1, false, 33),
  ('bottom_split_red', 'Quần Đỏ', 'Màu thi đấu', 'bottom', 'rare', 'tint', '#e11d48', 60, 1, false, 34),
  ('bottom_capri_purple', 'Quần Tím', null, 'bottom', 'rare', 'tint', '#6d28d9', 80, 1, false, 35),
  ('bottom_split_level3', 'Quần Vận Động Viên', 'Quà khi lên cấp 3', 'bottom', 'epic', 'tint', '#0ea5e9', 0, 3, false, 36),
  -- Tất
  ('socks_original', 'Tất nguyên bản', null, 'socks', 'common', 'tint', null, 0, 1, true, 40),
  ('socks_crew_white', 'Tất Trắng', null, 'socks', 'common', 'tint', '#f4f6f8', 0, 1, true, 41),
  ('socks_ankle_black', 'Tất Đen', null, 'socks', 'common', 'tint', '#1d2128', 10, 1, false, 42),
  ('socks_pink', 'Tất Hồng', null, 'socks', 'common', 'tint', '#ff6b9a', 15, 1, false, 43),
  ('socks_compression_lime', 'Tất Chanh', 'Tất nén hỗ trợ bắp chân', 'socks', 'rare', 'tint', '#c8ff3b', 40, 1, false, 44),
  ('socks_level2', 'Tất Người Chạy Đều', 'Quà khi lên cấp 2', 'socks', 'rare', 'tint', '#14b8a6', 0, 2, false, 45),
  -- Giày
  ('shoes_original', 'Giày nguyên bản', null, 'shoes', 'common', 'tint', null, 0, 1, true, 50),
  ('shoes_runner_blue', 'Giày Xanh', null, 'shoes', 'common', 'tint', '#2f6bff', 0, 1, true, 51),
  ('shoes_runner_coral', 'Giày San Hô', null, 'shoes', 'common', 'tint', '#ff7a66', 0, 1, true, 52),
  ('shoes_runner_white', 'Giày Trắng', null, 'shoes', 'common', 'tint', '#f4f6f8', 30, 1, false, 53),
  ('shoes_black', 'Giày Đen', null, 'shoes', 'common', 'tint', '#1d2128', 30, 1, false, 54),
  ('shoes_lime', 'Giày Chanh', 'Màu của RaceHub', 'shoes', 'rare', 'tint', '#b6ff3b', 80, 1, false, 55),
  ('shoes_racer_orange', 'Giày Cam Carbon', 'Cho ngày đua', 'shoes', 'epic', 'tint', '#ff5a1f', 200, 1, false, 56),
  ('shoes_level3', 'Giày Finisher', 'Quà khi lên cấp 3', 'shoes', 'epic', 'tint', '#e11d48', 0, 3, false, 57),
  ('shoes_racer_level5', 'Giày Huyền Thoại', 'Chỉ dành cho cấp 5', 'shoes', 'legendary', 'tint', '#f3c44b', 0, 5, false, 58)
on conflict (code) where code is not null do update set
  name = excluded.name, description = excluded.description, category = excluded.category, rarity = excluded.rarity,
  color = excluded.color, sort = excluded.sort, is_default = excluded.is_default,
  render_kind = 'TINT', model_key = null, color2 = null
  where public.avatar_items.render_kind = 'TINT' and public.avatar_items.layer_urls is null;   -- không ghi đè món admin đã đổi thành lớp ảnh

-- ---------------------------------------------------------------------
-- 4. Hoàn Xu cho đồ đã mua nay ngừng bán, rồi thu hồi khỏi tủ đồ
--    Tìm đúng giao dịch mua để hoàn đúng loại Xu (thưởng/nạp); không tìm thấy thì hoàn bằng Xu thưởng.
-- ---------------------------------------------------------------------
do $$
declare
  r record;
  v_tx uuid;
  v_entries jsonb;
begin
  for r in
    select inv.user_id, i.id as item_id, i.code, i.name, i.price_xu
      from public.user_inventory inv
      join public.avatar_items i on i.id = inv.item_id
     where not i.is_active and i.code is not null and inv.acquired_reason = 'PURCHASE'
  loop
    v_tx := null;
    v_entries := null;
    if r.price_xu > 0 then
      select t.id from public.ledger_transactions t
       where t.type = 'SHOP_ITEM' and t.created_by = r.user_id and t.reason = 'Mua ' || r.name
       order by t.created_at
       limit 1
        into v_tx;
      if v_tx is not null then
        select jsonb_agg(jsonb_build_object('account_id', e.account_id, 'coin_kind', e.coin_kind, 'amount', -e.amount))
          from public.ledger_entries e where e.transaction_id = v_tx
          into v_entries;
      end if;
      if v_entries is null or jsonb_array_length(v_entries) < 2 then
        v_entries := jsonb_build_array(
          jsonb_build_object('account_id', r.user_id, 'coin_kind', 'BONUS', 'amount', r.price_xu),
          jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -r.price_xu));
      end if;
      perform private.ledger_post('SHOP_REFUND', 'shop_refund:' || r.user_id || ':' || r.code, 'Hoàn Xu: ' || r.name,
        r.user_id, v_entries, null, true);
      perform private.notify(r.user_id, null, 'ADMIN_XU', 'Hoàn ' || trim_scale(r.price_xu) || ' Xu',
        r.name || ' ngừng bán khi nhân vật đổi sang kiểu mới. Xu đã về ví của bạn.', '/wallet');
    end if;
    delete from public.user_inventory where user_id = r.user_id and item_id = r.item_id;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5. Hàm nội bộ và RPC
-- ---------------------------------------------------------------------
-- Ô bắt buộc (luôn có một món, tối thiểu là bản nguyên bản)
create or replace function private.character_required_slots() returns text[]
language sql immutable as $$ select array['top', 'bottom', 'socks', 'shoes'] $$;

-- Bộ đồ mặc định: bản nguyên bản của ảnh. Món đang mặc bị ngừng bán → về nguyên bản; ô không bắt buộc → bỏ.
create or replace function private.ensure_character(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k text; v_id uuid;
begin
  insert into public.user_avatar (user_id) values (p_user) on conflict (user_id) do nothing;
  perform private.grant_free_items(p_user);
  insert into public.user_equipment (user_id) values (p_user) on conflict (user_id) do nothing;
  foreach k in array private.character_slots() loop
    select (to_jsonb(e) ->> (k || '_item_id'))::uuid from public.user_equipment e where e.user_id = p_user into v_id;
    if v_id is not null and exists (select 1 from public.avatar_items where id = v_id and is_active) then continue; end if;
    if k = any(private.character_required_slots()) then
      select id from public.avatar_items where code = k || '_original' into v_id;
    else
      if v_id is null then continue; end if;
      v_id := null;
    end if;
    execute format('update public.user_equipment set %I = $1, updated_at = now() where user_id = $2', k || '_item_id') using v_id, p_user;
  end loop;
end $$;

create or replace function private.item_json(i public.avatar_items) returns jsonb
language sql immutable as $$
  select jsonb_build_object('code', i.code, 'name', i.name, 'description', i.description, 'slot', i.category, 'rarity', i.rarity,
    'render_kind', i.render_kind, 'layer_urls', i.layer_urls, 'color', i.color, 'price_xu', i.price_xu,
    'unlock_level', i.unlock_level, 'is_default', i.is_default)
$$;

-- Nhân vật của người khác: chỉ ngoại hình, và chỉ món còn hiển thị được
create or replace function private.character_look(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'gender', coalesce(a.gender, 'male'),
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

create or replace function public.character_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); v_items jsonb;
begin
  perform private.ensure_character(v_uid);
  select coalesce(jsonb_agg(private.item_json(i) || jsonb_build_object('owned', inv.item_id is not null) order by i.category, i.sort, i.name), '[]'::jsonb)
    from public.avatar_items i
    left join public.user_inventory inv on inv.item_id = i.id and inv.user_id = v_uid
   where i.is_active and i.code is not null
    into v_items;
  return (private.character_look(v_uid) - 'items') || jsonb_build_object(
    'level', coalesce((select level from public.profiles where id = v_uid), 1),
    'balance', private.balance(v_uid),
    'items', v_items);
end $$;

-- Lưu dáng người + bộ đồ. p_look chỉ còn dùng "gender". p_equipped: {"top": "top_red", "hat": null, ...}; ô không có giữ nguyên.
create or replace function public.save_character(p_look jsonb, p_equipped jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_gender text := p_look->>'gender';
  k text;
  v_code text;
  v_id uuid;
begin
  perform private.ensure_character(v_uid);
  if v_gender is not null and v_gender not in ('male', 'female') then raise exception 'INVALID_LOOK'; end if;
  update public.user_avatar set gender = coalesce(v_gender, gender), updated_at = now() where user_id = v_uid;

  if p_equipped is not null and jsonb_typeof(p_equipped) = 'object' then
    for k in select jsonb_object_keys(p_equipped) loop
      if not (k = any(private.character_slots())) then raise exception 'INVALID_SLOT'; end if;
      v_code := p_equipped->>k;
      if v_code is null then
        if k = any(private.character_required_slots()) then raise exception 'SLOT_REQUIRED'; end if;
        v_id := null;
      else
        select i.id from public.avatar_items i
          join public.user_inventory inv on inv.item_id = i.id and inv.user_id = v_uid
         where i.code = v_code and i.category = k and i.is_active
          into v_id;
        if v_id is null then raise exception 'ITEM_NOT_OWNED'; end if;
      end if;
      execute format('update public.user_equipment set %I = $1, updated_at = now() where user_id = $2', k || '_item_id') using v_id, v_uid;
    end loop;
  end if;
  return private.character_look(v_uid);
end $$;

-- Người đang mặc đồ ngừng bán: đưa về bộ hợp lệ ngay (không chờ lần mở tủ đồ tiếp theo)
do $$
declare r record;
begin
  for r in select user_id from public.user_equipment loop
    perform private.ensure_character(r.user_id);
  end loop;
end $$;

revoke all on function private.character_required_slots(), private.ensure_character(uuid), private.item_json(public.avatar_items),
  private.character_look(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
