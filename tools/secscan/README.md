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
| anon tự INSERT/UPDATE (clubs, activities, inventory, cột xu/role) | Đọc OpenAPI theo vai trò anon; bảng nào hiện `post/patch/delete` là anon ghi được — **không gửi lệnh ghi** |
| RPC nguy hiểm anon gọi được (`user_topup_xu`, `admin_adjust_user_xu`…) | Đọc OpenAPI; RPC nào anon thấy trong `/rpc/` là anon gọi được — **không gọi RPC** |
| Khóa `service_role` lọt ra front-end | Tải JS public, giải mã JWT, báo nếu `role=service_role` |

**Vì sao an toàn:** PostgREST sinh bản OpenAPI theo vai trò của khóa gửi lên. Với khóa
anon, quyền ghi và RPC gọi được của anon hiện ngay trong bản mô tả, nên secscan suy ra
lỗ hổng chỉ bằng cách **đọc** — không có hàm POST/PATCH/DELETE nào trong mã nguồn.

## Dùng

Cần Node >= 18 (có `fetch` sẵn). Không cài thêm gói nào.

```bash
# Chỉ cần URL — tự rút khóa anon và địa chỉ Supabase từ front-end:
node src/index.js --url https://racehub.vn --i-am-authorized "Phụng" --out bao-cao.txt

# Hoặc tự truyền khóa anon (khi không rút được tự động):
node src/index.js --url https://racehub.vn \
  --anon-key "<ANON_KEY công khai>" \
  --i-am-authorized "Phụng" \
  --out bao-cao.txt

# Kiểm hộ người khác (sẽ hỏi xác nhận quyền):
node src/index.js --url https://app-cua-khach.com --anon-key "<ANON_KEY>"

# Bỏ qua các RPC công khai có chủ đích:
node src/index.js --url https://app.com --anon-key "<KEY>" --allow-rpc search_public,get_leaderboard
```

Chạy test: `npm test` (offline, không chạm mạng).

Mặc định, thiếu `--anon-key` thì công cụ **tự dò** khóa anon và địa chỉ Supabase
từ mã front-end của trang (khóa anon là khóa công khai, nằm sẵn trong bundle JS).
Nếu không dò được (app không dùng Supabase, hoặc nhúng khóa khác cách), truyền tay
bằng `--anon-key`. Tuyệt đối không truyền khóa `service_role`.

Mã thoát: `0` không có lỗi cao; `2` có lỗi NGHIÊM TRỌNG/CAO (tiện gắn CI của chính anh).

## Tách thành repo riêng

Thư mục này tự chứa. Để đưa ra repo riêng: copy cả `tools/secscan/` ra ngoài,
`git init`, rồi push lên repo mới của anh.
