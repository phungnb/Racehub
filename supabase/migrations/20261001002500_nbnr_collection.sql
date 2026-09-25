-- 002500: Bộ sưu tập CLB NBNR (No Beer No Run) — áo, quần, tất, mũ, băng đô.
-- Ảnh lớp vẽ bằng code, khớp 100% khung nhân vật: scripts/character/items/kit.py (áo, quần, tất) và headwear.py (mũ, băng đô).
-- Ảnh nằm trong public/character/layers/ → cần deploy bản có các file này. Chạy lại nhiều lần vẫn an toàn.

insert into public.avatar_items (code, name, description, category, rarity, asset_url, render_kind, layer_urls, price_xu, unlock_level, sort)
values ('top_nbnr_club', 'Áo CLB NBNR', 'No Beer No Run — xanh dương / vàng, chữ NBNR chéo ngực, logo hổ', 'top', 'epic', 'layer', 'LAYER', '{"male": "/character/layers/top_nbnr_club_male.png", "female": "/character/layers/top_nbnr_club_female.png"}'::jsonb, 150.0, 1, 100)
on conflict (code) where code is not null do update set name = excluded.name, description = excluded.description,
  category = excluded.category, rarity = excluded.rarity, render_kind = 'LAYER', layer_urls = excluded.layer_urls,
  unlock_level = excluded.unlock_level, is_active = true;

insert into public.avatar_items (code, name, description, category, rarity, asset_url, render_kind, layer_urls, price_xu, unlock_level, sort)
values ('bottom_nbnr_club', 'Quần CLB NBNR', 'Quần xanh dương, mảng vàng chấm bi, logo hổ', 'bottom', 'rare', 'layer', 'LAYER', '{"male": "/character/layers/bottom_nbnr_club_male.png", "female": "/character/layers/bottom_nbnr_club_female.png"}'::jsonb, 80.0, 1, 100)
on conflict (code) where code is not null do update set name = excluded.name, description = excluded.description,
  category = excluded.category, rarity = excluded.rarity, render_kind = 'LAYER', layer_urls = excluded.layer_urls,
  unlock_level = excluded.unlock_level, is_active = true;

insert into public.avatar_items (code, name, description, category, rarity, asset_url, render_kind, layer_urls, price_xu, unlock_level, sort)
values ('socks_nbnr_pair', 'Tất đôi NBNR', 'Một chiếc vàng một chiếc xanh, chấm bi', 'socks', 'rare', 'layer', 'LAYER', '{"male": "/character/layers/socks_nbnr_pair_male.png", "female": "/character/layers/socks_nbnr_pair_female.png"}'::jsonb, 40.0, 1, 100)
on conflict (code) where code is not null do update set name = excluded.name, description = excluded.description,
  category = excluded.category, rarity = excluded.rarity, render_kind = 'LAYER', layer_urls = excluded.layer_urls,
  unlock_level = excluded.unlock_level, is_active = true;

insert into public.avatar_items (code, name, description, category, rarity, asset_url, render_kind, layer_urls, price_xu, unlock_level, sort)
values ('hat_cap_nbnr', 'Mũ CLB NBNR', 'Mũ chạy xanh dương, chấm bi vàng, logo hổ', 'hat', 'epic', 'layer', 'LAYER', '{"male": "/character/layers/hat_cap_nbnr_male.png", "female": "/character/layers/hat_cap_nbnr_female.png"}'::jsonb, 120.0, 1, 100)
on conflict (code) where code is not null do update set name = excluded.name, description = excluded.description,
  category = excluded.category, rarity = excluded.rarity, render_kind = 'LAYER', layer_urls = excluded.layer_urls,
  unlock_level = excluded.unlock_level, is_active = true;

insert into public.avatar_items (code, name, description, category, rarity, asset_url, render_kind, layer_urls, price_xu, unlock_level, sort)
values ('hat_band_nbnr', 'Băng đô CLB NBNR', 'Băng đô bông xanh dương chấm bi vàng', 'hat', 'rare', 'layer', 'LAYER', '{"male": "/character/layers/hat_band_nbnr_male.png", "female": "/character/layers/hat_band_nbnr_female.png"}'::jsonb, 40.0, 1, 100)
on conflict (code) where code is not null do update set name = excluded.name, description = excluded.description,
  category = excluded.category, rarity = excluded.rarity, render_kind = 'LAYER', layer_urls = excluded.layer_urls,
  unlock_level = excluded.unlock_level, is_active = true;

notify pgrst, 'reload schema';
