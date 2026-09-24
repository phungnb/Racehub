-- =====================================================================
-- 20261001000900 — NHÂN VẬT 3D: TỦ ĐỒ & SHOP (ADR-016, docs/NHAN_VAT_3D.md)
--
--   * Danh mục vật phẩm (avatar_items) có mã, giá Xu, cấp mở khóa, màu, mô hình GLB theo giới tính
--   * Ô trang bị: tóc, áo, quần, tất, giày, mũ, kính, đồng hồ, phụ kiện, hiệu ứng
--   * Vật phẩm mặc định và vật phẩm mở theo cấp độ (Module 1.3 · FR8) được tự vào tủ đồ
--   * Mua bằng Xu qua sổ cái (Xu thưởng trước, Xu nạp sau), không mua được khi chưa đủ cấp
--   * Lưu cả bộ đồ + ngoại hình trong một lệnh (chỉ đồ đã sở hữu)
-- Phụ thuộc: 000200 (sổ cái), 000800 (lớp game). Idempotent.
-- INTO luôn đặt cuối câu SELECT (xem ghi chú ở migration 000700).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Bảng
-- ---------------------------------------------------------------------
alter table public.avatar_items drop constraint if exists avatar_items_category_check;
alter table public.avatar_items add constraint avatar_items_category_check
  check (category in ('base', 'hair', 'top', 'bottom', 'socks', 'shoes', 'hat', 'glasses', 'watch', 'accessory', 'effect'));
alter table public.avatar_items add column if not exists code text;
alter table public.avatar_items add column if not exists description text;
alter table public.avatar_items add column if not exists model_key text;            -- vd. 'top_tee' → /models/character/top_tee_<giới tính>.glb
alter table public.avatar_items add column if not exists model_urls jsonb;          -- tùy chọn: {"male": url, "female": url} (asset của họa sĩ)
alter table public.avatar_items add column if not exists color text;
alter table public.avatar_items add column if not exists color2 text;
alter table public.avatar_items add column if not exists price_xu numeric(10, 1) not null default 0 check (price_xu >= 0);
alter table public.avatar_items add column if not exists unlock_level integer not null default 1 check (unlock_level between 1 and 5);
alter table public.avatar_items add column if not exists is_default boolean not null default false;
alter table public.avatar_items add column if not exists sort integer not null default 0;
create unique index if not exists avatar_items_code_uidx on public.avatar_items (code) where code is not null;

alter table public.user_equipment add column if not exists socks_item_id uuid references public.avatar_items(id);

-- Vật phẩm cũ không có mã / mô hình → không hiển thị được: ẩn khỏi shop (không xóa dữ liệu)
update public.avatar_items set is_active = false where code is null and is_active;

-- Chỉ đọc danh mục; mọi ghi qua RPC
revoke insert, update, delete on public.avatar_items from anon, authenticated;
revoke all on public.user_avatar from anon;

-- ---------------------------------------------------------------------
-- 2. Danh mục khởi đầu (giá theo ADR-014: 1 Xu ≈ 1.000đ)
-- ---------------------------------------------------------------------
insert into public.avatar_items (code, name, description, category, rarity, asset_url, model_key, color, color2, price_xu, unlock_level, is_default, sort) values
  -- Tóc (miễn phí, ai cũng chọn được)
  ('hair_short', 'Tóc ngắn', null, 'hair', 'common', 'hair_short', 'hair_short', null, null, 0, 1, true, 1),
  ('hair_spiky', 'Tóc vuốt dựng', null, 'hair', 'common', 'hair_spiky', 'hair_spiky', null, null, 0, 1, true, 2),
  ('hair_buzz', 'Đầu đinh', null, 'hair', 'common', 'hair_buzz', 'hair_buzz', null, null, 0, 1, true, 3),
  ('hair_ponytail', 'Tóc đuôi ngựa', null, 'hair', 'common', 'hair_ponytail', 'hair_ponytail', '#3b82f6', null, 0, 1, true, 4),
  ('hair_bob', 'Tóc bob', null, 'hair', 'common', 'hair_bob', 'hair_bob', null, null, 0, 1, true, 5),
  -- Áo
  ('top_tee_blue', 'Áo chạy Xanh Điện', 'Áo thun kỹ thuật thoáng khí', 'top', 'common', 'top_tee', 'top_tee', '#2f6bff', '#c8ff3b', 0, 1, true, 10),
  ('top_crop_coral', 'Áo croptop San Hô', null, 'top', 'common', 'top_crop', 'top_crop', '#ff6b5b', '#ffd6cf', 0, 1, true, 11),
  ('top_tee_white', 'Áo chạy Trắng Tinh', null, 'top', 'common', 'top_tee', 'top_tee', '#f4f6f8', '#1d2128', 20, 1, false, 12),
  ('top_tee_black', 'Áo chạy Đen Đêm', null, 'top', 'common', 'top_tee', 'top_tee', '#1d2128', '#b6ff3b', 20, 1, false, 13),
  ('top_singlet_orange', 'Áo ba lỗ Cam Nắng', 'Áo thi đấu cự ly ngắn', 'top', 'rare', 'top_singlet', 'top_singlet', '#ff8a1f', '#ffffff', 60, 1, false, 14),
  ('top_singlet_level2', 'Áo ba lỗ Người Chạy Đều', 'Quà khi lên cấp 2', 'top', 'rare', 'top_singlet', 'top_singlet', '#14b8a6', '#fef08a', 0, 2, false, 15),
  ('top_crop_black', 'Áo croptop Đen', null, 'top', 'rare', 'top_crop', 'top_crop', '#1d2128', '#ff6b9a', 60, 1, false, 16),
  ('top_longsleeve_gray', 'Áo dài tay Xám Sương', 'Cho những buổi chạy sáng se lạnh', 'top', 'rare', 'top_longsleeve', 'top_longsleeve', '#8a94a6', '#f4f6f8', 80, 1, false, 17),
  ('top_jacket_neon', 'Áo gió Neon', 'Áo khoác gió phản quang', 'top', 'epic', 'top_jacket', 'top_jacket', '#16181d', '#b6ff3b', 150, 1, false, 18),
  ('top_jacket_level4', 'Áo gió Runner Nghiêm Túc', 'Quà khi lên cấp 4', 'top', 'epic', 'top_jacket', 'top_jacket', '#7c3aed', '#fbbf24', 0, 4, false, 19),
  ('top_tee_gold', 'Áo Huyền Thoại', 'Chỉ dành cho cấp 5', 'top', 'legendary', 'top_tee', 'top_tee', '#f3c44b', '#1d2128', 0, 5, false, 20),
  -- Quần
  ('bottom_shorts_black', 'Quần short Đen', null, 'bottom', 'common', 'bottom_shorts', 'bottom_shorts', '#1d2128', '#c8ff3b', 0, 1, true, 30),
  ('bottom_shorts_navy', 'Quần short Xanh Than', null, 'bottom', 'common', 'bottom_shorts', 'bottom_shorts', '#1e2a4a', '#ff8a1f', 20, 1, false, 31),
  ('bottom_split_red', 'Quần xẻ tà Đỏ', 'Quần thi đấu siêu nhẹ', 'bottom', 'rare', 'bottom_split', 'bottom_split', '#e11d48', '#ffffff', 60, 1, false, 32),
  ('bottom_tights_black', 'Quần bó dài', null, 'bottom', 'rare', 'bottom_tights', 'bottom_tights', '#15171c', '#6b7689', 80, 1, false, 33),
  ('bottom_capri_purple', 'Quần lửng Tím', null, 'bottom', 'rare', 'bottom_capri', 'bottom_capri', '#6d28d9', '#f0abfc', 80, 1, false, 34),
  ('bottom_split_level3', 'Quần xẻ tà Vận Động Viên', 'Quà khi lên cấp 3', 'bottom', 'epic', 'bottom_split', 'bottom_split', '#0ea5e9', '#fef08a', 0, 3, false, 35),
  -- Tất
  ('socks_crew_white', 'Tất cổ cao Trắng', null, 'socks', 'common', 'socks_crew', 'socks_crew', '#f4f6f8', '#2f6bff', 0, 1, true, 40),
  ('socks_ankle_black', 'Tất cổ thấp Đen', null, 'socks', 'common', 'socks_ankle', 'socks_ankle', '#1d2128', '#b6ff3b', 10, 1, false, 41),
  ('socks_compression_lime', 'Tất bó bắp Chanh', 'Tất nén hỗ trợ bắp chân', 'socks', 'rare', 'socks_compression', 'socks_compression', '#c8ff3b', '#1d2128', 40, 1, false, 42),
  -- Giày
  ('shoes_runner_blue', 'Giày chạy Xanh', null, 'shoes', 'common', 'shoes_runner', 'shoes_runner', '#2f6bff', '#c8ff3b', 0, 1, true, 50),
  ('shoes_runner_coral', 'Giày chạy San Hô', null, 'shoes', 'common', 'shoes_runner', 'shoes_runner', '#ff7a66', '#ffffff', 0, 1, true, 51),
  ('shoes_runner_white', 'Giày chạy Trắng', null, 'shoes', 'common', 'shoes_runner', 'shoes_runner', '#f4f6f8', '#1d2128', 30, 1, false, 52),
  ('shoes_racer_orange', 'Giày carbon Cam', 'Đế carbon cho ngày đua', 'shoes', 'epic', 'shoes_racer', 'shoes_racer', '#ff5a1f', '#fef08a', 200, 1, false, 53),
  ('shoes_racer_level5', 'Giày carbon Huyền Thoại', 'Chỉ dành cho cấp 5', 'shoes', 'legendary', 'shoes_racer', 'shoes_racer', '#f3c44b', '#7c3aed', 0, 5, false, 54),
  -- Mũ
  ('hat_cap_black', 'Mũ lưỡi trai Đen', null, 'hat', 'common', 'hat_cap', 'hat_cap', '#1d2128', '#b6ff3b', 30, 1, false, 60),
  ('hat_visor_white', 'Mũ nửa đầu Trắng', null, 'hat', 'rare', 'hat_visor', 'hat_visor', '#f4f6f8', '#2f6bff', 50, 1, false, 61),
  ('hat_headband_red', 'Băng đô Đỏ', null, 'hat', 'common', 'hat_headband', 'hat_headband', '#e11d48', '#ffffff', 20, 1, false, 62),
  ('hat_beanie_green', 'Mũ len Xanh Rêu', 'Chạy mùa đông Hà Nội', 'hat', 'rare', 'hat_beanie', 'hat_beanie', '#166534', '#fef08a', 60, 1, false, 63),
  -- Kính
  ('glasses_shield_black', 'Kính thể thao Đen', null, 'glasses', 'rare', 'glasses_shield', 'glasses_shield', '#1d2128', null, 60, 1, false, 70),
  ('glasses_mirror_blue', 'Kính tráng gương Xanh', 'Chống chói khi chạy trưa', 'glasses', 'epic', 'glasses_mirror', 'glasses_mirror', '#f4f6f8', '#6ad1ff', 120, 1, false, 71),
  -- Đồng hồ
  ('watch_sport_black', 'Đồng hồ GPS Đen', null, 'watch', 'rare', 'watch_sport', 'watch_sport', '#1d2128', '#b6ff3b', 80, 1, false, 80),
  ('watch_sport_level2', 'Đồng hồ GPS Người Chạy Đều', 'Quà khi lên cấp 2', 'watch', 'rare', 'watch_sport', 'watch_sport', '#2f6bff', '#c8ff3b', 0, 2, false, 81),
  ('watch_classic_silver', 'Đồng hồ Bạc', null, 'watch', 'epic', 'watch_classic', 'watch_classic', '#c9ced6', null, 150, 1, false, 82),
  -- Phụ kiện
  ('accessory_bib', 'Số đeo ngực (bib)', 'Như đang ở vạch xuất phát', 'accessory', 'common', 'accessory_bib', 'accessory_bib', '#e11d48', null, 20, 1, false, 90),
  ('accessory_armband', 'Túi đeo tay', null, 'accessory', 'common', 'accessory_armband', 'accessory_armband', '#1d2128', null, 30, 1, false, 91),
  ('accessory_vest', 'Áo nước trail', 'Cho những cung đường trail dài', 'accessory', 'epic', 'accessory_vest', 'accessory_vest', '#0f766e', '#fb923c', 180, 1, false, 92),
  ('accessory_medal_level3', 'Huy chương Finisher', 'Quà khi lên cấp 3', 'accessory', 'epic', 'accessory_medal', 'accessory_medal', '#e11d48', '#fef3c7', 0, 3, false, 93),
  -- Hiệu ứng
  ('effect_aura_lime', 'Vòng hào quang Chanh', 'Hiệu ứng phát sáng dưới chân', 'effect', 'legendary', 'effect_aura', 'effect_aura', '#b6ff3b', null, 400, 1, false, 100),
  ('effect_aura_level5', 'Hào quang Huyền Thoại', 'Chỉ dành cho cấp 5', 'effect', 'legendary', 'effect_aura', 'effect_aura', '#f3c44b', null, 0, 5, false, 101)
on conflict (code) where code is not null do update set
  name = excluded.name, description = excluded.description, category = excluded.category, rarity = excluded.rarity,
  model_key = excluded.model_key, color = excluded.color, color2 = excluded.color2, sort = excluded.sort
  where public.avatar_items.model_urls is null;        -- không ghi đè vật phẩm admin đã gắn asset riêng

-- ---------------------------------------------------------------------
-- 3. Hàm nội bộ
-- ---------------------------------------------------------------------
create or replace function private.character_slots() returns text[]
language sql immutable as $$
  select array['hair', 'top', 'bottom', 'socks', 'shoes', 'hat', 'glasses', 'watch', 'accessory', 'effect']
$$;

-- Tự vào tủ đồ: vật phẩm mặc định + vật phẩm miễn phí đã đủ cấp. Trả về số món mới.
create or replace function private.grant_free_items(p_user uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare v_level integer; v_rows integer;
begin
  v_level := coalesce((select level from public.profiles where id = p_user), 1);
  insert into public.user_inventory (user_id, item_id, acquired_reason)
  select p_user, i.id, case when i.is_default then 'DEFAULT' else 'LEVEL_' || i.unlock_level end
    from public.avatar_items i
   where i.is_active and i.code is not null and i.price_xu = 0 and i.unlock_level <= v_level
     and (i.is_default or i.unlock_level > 1)
  on conflict (user_id, item_id) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

-- Bộ đồ mặc định theo giới tính (khi chưa có trang bị)
create or replace function private.ensure_character(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_gender text;
begin
  insert into public.user_avatar (user_id) values (p_user) on conflict (user_id) do nothing;
  perform private.grant_free_items(p_user);
  if exists (select 1 from public.user_equipment where user_id = p_user) then return; end if;
  v_gender := coalesce((select gender from public.user_avatar where user_id = p_user), 'male');
  insert into public.user_equipment (user_id, hair_item_id, top_item_id, bottom_item_id, socks_item_id, shoes_item_id)
  values (p_user,
    (select id from public.avatar_items where code = case when v_gender = 'female' then 'hair_ponytail' else 'hair_short' end),
    (select id from public.avatar_items where code = case when v_gender = 'female' then 'top_crop_coral' else 'top_tee_blue' end),
    (select id from public.avatar_items where code = 'bottom_shorts_black'),
    (select id from public.avatar_items where code = 'socks_crew_white'),
    (select id from public.avatar_items where code = case when v_gender = 'female' then 'shoes_runner_coral' else 'shoes_runner_blue' end))
  on conflict (user_id) do nothing;
end $$;

-- Ngoại hình + trang bị (mã vật phẩm theo ô) của một người
create or replace function private.character_look(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'gender', coalesce(a.gender, 'male'),
    'skin_tone', coalesce(a.skin_tone, '#e9b995'),
    'hair_color', coalesce(a.hair_color, '#2b1d16'),
    'equipped', jsonb_strip_nulls(jsonb_build_object(
      'hair', (select code from public.avatar_items where id = e.hair_item_id),
      'top', (select code from public.avatar_items where id = e.top_item_id),
      'bottom', (select code from public.avatar_items where id = e.bottom_item_id),
      'socks', (select code from public.avatar_items where id = e.socks_item_id),
      'shoes', (select code from public.avatar_items where id = e.shoes_item_id),
      'hat', (select code from public.avatar_items where id = e.hat_item_id),
      'glasses', (select code from public.avatar_items where id = e.glasses_item_id),
      'watch', (select code from public.avatar_items where id = e.watch_item_id),
      'accessory', (select code from public.avatar_items where id = e.accessory_item_id),
      'effect', (select code from public.avatar_items where id = e.effect_item_id))))
    from (select p_user as uid) x
    left join public.user_avatar a on a.user_id = x.uid
    left join public.user_equipment e on e.user_id = x.uid
$$;

create or replace function private.item_json(i public.avatar_items) returns jsonb
language sql immutable as $$
  select jsonb_build_object('code', i.code, 'name', i.name, 'description', i.description, 'slot', i.category, 'rarity', i.rarity,
    'model_key', i.model_key, 'model_urls', i.model_urls, 'color', i.color, 'color2', i.color2, 'price_xu', i.price_xu,
    'unlock_level', i.unlock_level, 'is_default', i.is_default)
$$;

-- ---------------------------------------------------------------------
-- 4. RPC
-- ---------------------------------------------------------------------
-- Toàn bộ dữ liệu màn Tủ đồ / Shop trong một lần gọi
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
  return private.character_look(v_uid) || jsonb_build_object(
    'level', coalesce((select level from public.profiles where id = v_uid), 1),
    'balance', private.balance(v_uid),
    'items', v_items);
end $$;

-- Nhân vật của người khác (hồ sơ, BXH): chỉ ngoại hình
create or replace function public.get_character(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_uid();
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'USER_NOT_FOUND'; end if;
  return private.character_look(p_user);
end $$;

-- Mua vật phẩm bằng Xu (idempotent theo khóa)
create or replace function public.buy_avatar_item(p_code text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  i public.avatar_items;
  v_level integer;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if exists (select 1 from public.ledger_transactions where idempotency_key = 'shop:' || p_idempotency_key) then
    return jsonb_build_object('duplicate', true, 'balance', private.balance(v_uid));
  end if;
  select * from public.avatar_items where code = p_code and is_active into i;
  if i.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if exists (select 1 from public.user_inventory where user_id = v_uid and item_id = i.id) then raise exception 'ALREADY_OWNED'; end if;
  v_level := coalesce((select level from public.profiles where id = v_uid), 1);
  if v_level < i.unlock_level then raise exception 'LEVEL_TOO_LOW'; end if;
  if i.price_xu > 0 then
    if private.balance(v_uid) < i.price_xu then raise exception 'INSUFFICIENT_BALANCE'; end if;
    perform private.ledger_post('SHOP_ITEM', 'shop:' || p_idempotency_key, 'Mua ' || i.name, v_uid,
      private.debit_entries(v_uid, i.price_xu, private.system_account()));
  end if;
  insert into public.user_inventory (user_id, item_id, acquired_reason)
  values (v_uid, i.id, case when i.price_xu > 0 then 'PURCHASE' else 'FREE' end)
  on conflict (user_id, item_id) do nothing;
  return jsonb_build_object('code', i.code, 'balance', private.balance(v_uid));
end $$;

-- Lưu ngoại hình + cả bộ đồ. p_equipped: {"top": "top_tee_blue", "hat": null, ...}; ô không có trong p_equipped giữ nguyên.
create or replace function public.save_character(p_look jsonb, p_equipped jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_gender text := p_look->>'gender';
  v_skin text := p_look->>'skin_tone';
  v_hair text := p_look->>'hair_color';
  k text;
  v_code text;
  v_id uuid;
begin
  perform private.ensure_character(v_uid);
  if v_gender is not null and v_gender not in ('male', 'female') then raise exception 'INVALID_LOOK'; end if;
  if v_skin is not null and v_skin !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_LOOK'; end if;
  if v_hair is not null and v_hair !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_LOOK'; end if;
  update public.user_avatar
     set gender = coalesce(v_gender, gender), skin_tone = coalesce(v_skin, skin_tone), hair_color = coalesce(v_hair, hair_color), updated_at = now()
   where user_id = v_uid;

  if p_equipped is not null and jsonb_typeof(p_equipped) = 'object' then
    for k in select jsonb_object_keys(p_equipped) loop
      if not (k = any(private.character_slots())) then raise exception 'INVALID_SLOT'; end if;
      v_code := p_equipped->>k;
      if v_code is null then
        if k in ('hair', 'top', 'bottom', 'shoes') then raise exception 'SLOT_REQUIRED'; end if;
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

-- Hàm cũ: chỉ cho người đã đăng nhập
revoke all on function public.equip_avatar_item(uuid, text) from public, anon;

revoke all on function public.character_state(), public.get_character(uuid), public.buy_avatar_item(text, text),
  public.save_character(jsonb, jsonb) from public, anon;
grant execute on function public.character_state(), public.get_character(uuid), public.buy_avatar_item(text, text),
  public.save_character(jsonb, jsonb) to authenticated;
revoke all on function private.character_slots(), private.grant_free_items(uuid), private.ensure_character(uuid),
  private.character_look(uuid), private.item_json(public.avatar_items) from public, anon, authenticated;

notify pgrst, 'reload schema';
