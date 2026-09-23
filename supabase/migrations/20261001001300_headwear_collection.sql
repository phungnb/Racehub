-- =====================================================================
-- 20261001001300 — BỘ SƯU TẬP ĐỒ ĐỘI ĐẦU ĐẦU TIÊN (lớp ảnh PNG, ADR-017)
--
-- 16 món cho ô Mũ: mũ chạy Tempo (4 màu), mũ Neon, mũ Huyền Thoại (quà cấp 5), visor (3 màu),
-- băng đô bông (4 màu), băng đô mảnh (3 màu). Ảnh trong public/character/layers/, sinh bằng
-- scripts/character/items/headwear.py (vẽ theo hình khối đầu, có bóng đổ và tóc mái đè lên băng đô).
-- Tham khảo dáng: mũ chạy vải mỏng có lỗ thoáng (Ciele GOCap, Nike AeroBill), visor, băng đô bông
-- (Halo, Nike), băng đô thun mảnh (Buff). Logo là tia chớp RaceHub, không dùng thương hiệu khác.
-- Phụ thuộc: 001200. Idempotent. Không dùng SELECT ... INTO, khối DO, LIMIT (SQL Editor).
-- =====================================================================

insert into public.avatar_items (code, name, description, category, rarity, asset_url, render_kind, layer_urls, price_xu, unlock_level, sort) values
  ('hat_cap_tempo_black', 'Mũ chạy Tempo Đen', 'Mũ vải mỏng, lỗ thoáng hai bên', 'hat', 'rare', 'layer', 'LAYER', '{"male": "/character/layers/hat_cap_tempo_black_male.png?v=1", "female": "/character/layers/hat_cap_tempo_black_female.png?v=1"}', 60, 1, 200),
  ('hat_cap_tempo_white', 'Mũ chạy Tempo Trắng', 'Mũ vải mỏng, lỗ thoáng hai bên', 'hat', 'rare', 'layer', 'LAYER', '{"male": "/character/layers/hat_cap_tempo_white_male.png?v=1", "female": "/character/layers/hat_cap_tempo_white_female.png?v=1"}', 60, 1, 201),
  ('hat_cap_tempo_red', 'Mũ chạy Tempo Đỏ', 'Mũ vải mỏng, lỗ thoáng hai bên', 'hat', 'rare', 'layer', 'LAYER', '{"male": "/character/layers/hat_cap_tempo_red_male.png?v=1", "female": "/character/layers/hat_cap_tempo_red_female.png?v=1"}', 60, 1, 202),
  ('hat_cap_tempo_navy', 'Mũ chạy Tempo Xanh Than', 'Mặt dưới lưỡi trai màu cam', 'hat', 'rare', 'layer', 'LAYER', '{"male": "/character/layers/hat_cap_tempo_navy_male.png?v=1", "female": "/character/layers/hat_cap_tempo_navy_female.png?v=1"}', 60, 1, 203),
  ('hat_cap_neon', 'Mũ chạy Neon', 'Nổi bật cả khi chạy đêm', 'hat', 'epic', 'layer', 'LAYER', '{"male": "/character/layers/hat_cap_neon_male.png?v=1", "female": "/character/layers/hat_cap_neon_female.png?v=1"}', 150, 1, 204),
  ('hat_cap_legend', 'Mũ Huyền Thoại', 'Chỉ dành cho cấp 5', 'hat', 'legendary', 'layer', 'LAYER', '{"male": "/character/layers/hat_cap_legend_male.png?v=1", "female": "/character/layers/hat_cap_legend_female.png?v=1"}', 0, 5, 205),
  ('hat_visor_sun_white', 'Visor Trắng', 'Thoáng đỉnh đầu cho ngày nắng', 'hat', 'rare', 'layer', 'LAYER', '{"male": "/character/layers/hat_visor_sun_white_male.png?v=1", "female": "/character/layers/hat_visor_sun_white_female.png?v=1"}', 50, 1, 206),
  ('hat_visor_sun_black', 'Visor Đen', 'Thoáng đỉnh đầu cho ngày nắng', 'hat', 'rare', 'layer', 'LAYER', '{"male": "/character/layers/hat_visor_sun_black_male.png?v=1", "female": "/character/layers/hat_visor_sun_black_female.png?v=1"}', 50, 1, 207),
  ('hat_visor_sun_pink', 'Visor Hồng', 'Thoáng đỉnh đầu cho ngày nắng', 'hat', 'rare', 'layer', 'LAYER', '{"male": "/character/layers/hat_visor_sun_pink_male.png?v=1", "female": "/character/layers/hat_visor_sun_pink_female.png?v=1"}', 50, 1, 208),
  ('hat_band_terry_red', 'Băng đô bông Đỏ', 'Thấm mồ hôi, không cay mắt', 'hat', 'common', 'layer', 'LAYER', '{"male": "/character/layers/hat_band_terry_red_male.png?v=1", "female": "/character/layers/hat_band_terry_red_female.png?v=1"}', 25, 1, 209),
  ('hat_band_terry_white', 'Băng đô bông Trắng', 'Thấm mồ hôi, không cay mắt', 'hat', 'common', 'layer', 'LAYER', '{"male": "/character/layers/hat_band_terry_white_male.png?v=1", "female": "/character/layers/hat_band_terry_white_female.png?v=1"}', 25, 1, 210),
  ('hat_band_terry_black', 'Băng đô bông Đen', 'Thấm mồ hôi, không cay mắt', 'hat', 'common', 'layer', 'LAYER', '{"male": "/character/layers/hat_band_terry_black_male.png?v=1", "female": "/character/layers/hat_band_terry_black_female.png?v=1"}', 25, 1, 211),
  ('hat_band_terry_blue', 'Băng đô bông Xanh', 'Thấm mồ hôi, không cay mắt', 'hat', 'common', 'layer', 'LAYER', '{"male": "/character/layers/hat_band_terry_blue_male.png?v=1", "female": "/character/layers/hat_band_terry_blue_female.png?v=1"}', 25, 1, 212),
  ('hat_band_thin_black', 'Băng đô mảnh Đen', 'Thun co giãn, không trượt', 'hat', 'common', 'layer', 'LAYER', '{"male": "/character/layers/hat_band_thin_black_male.png?v=1", "female": "/character/layers/hat_band_thin_black_female.png?v=1"}', 15, 1, 213),
  ('hat_band_thin_lime', 'Băng đô mảnh Chanh', 'Thun co giãn, không trượt', 'hat', 'common', 'layer', 'LAYER', '{"male": "/character/layers/hat_band_thin_lime_male.png?v=1", "female": "/character/layers/hat_band_thin_lime_female.png?v=1"}', 15, 1, 214),
  ('hat_band_thin_pink', 'Băng đô mảnh Hồng', 'Thun co giãn, không trượt', 'hat', 'common', 'layer', 'LAYER', '{"male": "/character/layers/hat_band_thin_pink_male.png?v=1", "female": "/character/layers/hat_band_thin_pink_female.png?v=1"}', 15, 1, 215)
on conflict (code) where code is not null do update set
  name = excluded.name, description = excluded.description, rarity = excluded.rarity,
  layer_urls = excluded.layer_urls, price_xu = excluded.price_xu, unlock_level = excluded.unlock_level, sort = excluded.sort
  where public.avatar_items.render_kind = 'LAYER' and public.avatar_items.layer_urls->>'male' like '/character/layers/%';

notify pgrst, 'reload schema';
