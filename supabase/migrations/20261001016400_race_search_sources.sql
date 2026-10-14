-- 016400: Nguồn quét kiểu TÌM KIẾM TỪ KHÓA (ngoài kiểu "trang lịch giải" ở 016100).
-- kind = 'PAGE': url là trang lịch giải; kind = 'SEARCH': query là từ khóa (VD "lịch giải marathon 2027 Việt Nam"), việc quét gọi API tìm kiếm web
-- rồi đưa từng kết quả qua cùng bộ đọc + sàng lọc, vào HÀNG CHỜ duyệt. Vẫn không tự đăng.
alter table public.race_sources add column if not exists kind text not null default 'PAGE';
alter table public.race_sources add column if not exists query text;
alter table public.race_sources alter column url drop not null;
alter table public.race_sources drop constraint if exists race_sources_kind_ck;
alter table public.race_sources add constraint race_sources_kind_ck check (
  (kind = 'PAGE' and url is not null and query is null)
  or (kind = 'SEARCH' and query is not null and char_length(btrim(query)) between 3 and 200 and url is null));
create unique index if not exists race_sources_query_uniq on public.race_sources (lower(query)) where query is not null;

notify pgrst, 'reload schema';
