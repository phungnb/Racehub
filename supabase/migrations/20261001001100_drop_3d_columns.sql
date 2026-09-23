-- =====================================================================
-- 20261001001100 — DỌN CỘT CỦA NHÂN VẬT 3D (ADR-017)
--
-- Nhân vật 2D không dùng mô hình GLB và màu phụ: bỏ model_key, model_urls, color2 khỏi avatar_items.
-- Mọi hàm đang dùng (item_json, character_state...) đã được migration 001000 viết lại, không còn đọc các cột này.
-- Phụ thuộc: 001000. Idempotent.
-- =====================================================================

alter table public.avatar_items drop column if exists model_key;
alter table public.avatar_items drop column if exists model_urls;
alter table public.avatar_items drop column if exists color2;

notify pgrst, 'reload schema';
