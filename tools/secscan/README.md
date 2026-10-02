# secscan

Công cụ rà soát cấu hình an toàn cho app dùng **Supabase / PostgREST**. Phạm vi cố ý
hẹp: chỉ kiểm tra **đúng các lớp lỗi RaceHub đã gặp và đã vá**. Toàn bộ là read-only
(chỉ gửi `GET`, không ghi, không gọi RPC), và có cổng xác nhận quyền trước khi chạy.

## Nguyên tắc

- **Chỉ chạy trên app anh sở hữu, hoặc app có văn bản cho phép kiểm tra.** Quét web
  người khác khi chưa được phép là vi phạm pháp luật. Công cụ buộc khai báo điều này
  và ghi vào báo cáo.
- **Không phá.** Không có hàm POST/PATCH/DELETE trong mã nguồn. Bảo đảm này kiểm tra
  được bằng mắt trong `src/http.js`.
- Mục tiêu là **phát hiện cấu hình sai để vá**, không phải khai thác.

## Kiểm tra gì

| Lỗi (RaceHub từng dính) | secscan phát hiện bằng cách |
|---|---|
| `profiles` cho anon đọc mọi cột (policy `USING true`) | Dùng khóa anon đọc thử từng bảng, báo bảng nào trả dữ liệu khi chưa đăng nhập |
| Token Strava nằm trong bảng ai cũng đọc | Soi cột của dòng đọc được; cột `*_token`, secret → NGHIÊM TRỌNG |
| Khóa `service_role` lọt ra front-end | Tải JS public, giải mã JWT, báo nếu `role=service_role` |

Ngoài phạm vi (kiểm tra thủ công): RPC gọi được bởi anon, policy ghi quá rộng —
vì kiểm tự động an toàn cho hai thứ này cần gửi lệnh ghi, trái nguyên tắc "không phá".

## Dùng

Cần Node >= 18 (có `fetch` sẵn). Không cài thêm gói nào.

```bash
# App của chính anh:
node src/index.js --url https://racehub.vn \
  --anon-key "<ANON_KEY công khai>" \
  --i-am-authorized "Phụng" \
  --out bao-cao.txt

# Kiểm hộ người khác (sẽ hỏi xác nhận quyền):
node src/index.js --url https://app-cua-khach.com --anon-key "<ANON_KEY>"
```

`--anon-key` là khóa **anon** công khai (nằm sẵn trong app web), không phải
`service_role`. Thiếu nó thì chỉ chạy kiểm tra khóa lộ.

Mã thoát: `0` không có lỗi cao; `2` có lỗi NGHIÊM TRỌNG/CAO (tiện gắn CI của chính anh).

## Tách thành repo riêng

Thư mục này tự chứa. Để đưa ra repo riêng: copy cả `tools/secscan/` ra ngoài,
`git init`, rồi push lên repo mới của anh.
