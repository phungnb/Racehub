-- 015800: Chuẩn hoá "ngày" theo giờ Việt Nam (Asia/Ho_Chi_Minh) trong CSDL.
--   Quy ước của app: mọi ranh giới ngày (thử thách, nhiệm vụ, trần Xu/ngày, ngày vàng, báo cáo) tính theo giờ VN,
--   dùng private.vn_today() / private.vn_day() / private.vn_start(). Supabase chạy giờ UTC nên `current_date` lệch
--   ngày trong khung 00:00–07:00 giờ VN (vd "chạy lần cuối" hiện 0 ngày thay vì 1, gợi ý hằng ngày đổi lúc 07:00).
--   Migration này thay `current_date` bằng private.vn_today() trong MỌI hàm public/private còn dùng nó
--   (nearby_runners, hub_runners, match_score, hàm hồ sơ…): lấy định nghĩa hiện hành rồi thay, nên không phụ thuộc bản cũ.
-- Chạy riêng được ngay; chạy lại nhiều lần vẫn an toàn (lần sau không còn gì để thay).

do $$
declare
  r record;
  v_def text;
begin
  for r in
    select p.oid, n.nspname, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and p.prokind = 'f' and p.prosrc ~* '\mcurrent_date\M'
  loop
    v_def := regexp_replace(pg_get_functiondef(r.oid), '\mcurrent_date\M', 'private.vn_today()', 'gi');
    execute v_def;
  end loop;
end $$;
