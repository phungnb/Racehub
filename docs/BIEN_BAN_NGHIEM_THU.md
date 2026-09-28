# Biên bản nghiệm thu kỹ thuật RaceHub

Ngày: 28/09/2026 · Nhánh: `claude/racehub-file-structure-thdkhr` · Phạm vi: toàn bộ mã nguồn, 101 migration, 66 trang, 29 tab Quản trị, 13 API máy chủ.

## Kết luận

**ĐẠT CÓ ĐIỀU KIỆN.** Không còn lỗi chặn trong mã nguồn. Trước khi mở cho người dùng thật cần làm 4 việc ở mục "Điều kiện".

## 1. Kiểm tra tự động

| Hạng mục | Kết quả |
|---|---|
| Lint + kiểm tra kiểu TypeScript | Đạt, 0 lỗi |
| Kiểm thử tự động (gồm kiểm thử trên CSDL thật chạy migration 2 lần) | Đạt, 136 file / 600 ca |
| Build bản production | Đạt |
| Lỗ hổng thư viện (`npm audit`) | 0 |
| Khóa bí mật trong mã nguồn / git | Không có; chỉ có `.env.example` |

## 2. Bảo mật cơ sở dữ liệu (chạy đủ migration rồi kiểm tra danh mục hệ thống)

| Kiểm tra | Kết quả |
|---|---|
| Mọi bảng bật RLS (phân quyền theo dòng) | Đạt: 0 bảng thiếu |
| Hàm SECURITY DEFINER cố định `search_path` | Đạt: 0 hàm thiếu |
| Schema `private` (hàm nội bộ) | Khách / người dùng không truy cập được |
| Sổ cái Xu, nhật ký quản trị | Không ai ghi trực tiếp được |
| Cột hồ sơ người dùng tự sửa được | Chỉ tên, ảnh, tường quà, thời gian cập nhật (Xu, XP, vai trò: không) |
| Hàm khách chưa đăng nhập gọi được | 17 hàm, đều là trang công khai (trang CLB, lời mời, hướng dẫn, gói, báo giá) |
| **Lỗi tìm thấy:** 9 bảng còn quyền ghi mặc định cho khách | Đã bị RLS chặn nên không khai thác được; đã thu hồi thêm lớp thứ hai (010100) |
| **Lỗi tìm thấy:** form báo giá Doanh nghiệp đổi số điện thoại là gửi được hàng loạt, spam thông báo admin | Đã vá (010100): 5 / ngày mỗi tài khoản, 20 / giờ cho khách |
| **Lỗi tìm thấy:** danh sách Kiểm tra hệ thống chạm giới hạn 100 tham số của PostgreSQL (thêm migration thứ 101 sẽ lỗi) | Đã vá: tách danh sách |

Các kiểm tra RLS, `search_path`, quyền ghi của khách nay chạy tự động mỗi lần kiểm thử (`tests/db/qa-hardening.test.ts`), nên migration mới sai quyền sẽ bị phát hiện ngay.

## 3. Giao diện (Playwright, màn hình điện thoại 390 px, bản production)

| Kịch bản | Kết quả |
|---|---|
| Đăng nhập admin, dữ liệu rỗng (95 trang + tab) | 88 / 95 đạt. 7 trang sập chỉ vì dữ liệu giả trả `null`; đã đối chiếu CSDL thật: các hàm đó luôn trả danh sách / đối tượng hoặc báo "không tìm thấy", nên **không phải lỗi thật** |
| Mất mạng hoàn toàn (95 trang) | 95 / 95 đạt: có thông báo lỗi và nút thử lại, không trắng trang |
| Khách chưa đăng nhập (66 trang) | 66 / 66 đạt |
| Trang riêng tư khi chưa đăng nhập | Đều chuyển về Đăng nhập |
| Tràn ngang trên điện thoại | Không trang nào |

## 4. API máy chủ và cấu hình web

| Kiểm tra | Kết quả |
|---|---|
| API không có thông tin xác thực | Đều từ chối (401 / 403 / 400) |
| Việc chạy định kỳ (cron) khi thiếu `CRON_SECRET` | Từ chối chạy (an toàn); trang Kiểm tra hệ thống báo thiếu biến |
| Header bảo mật | Có đủ: chống nhúng trang (X-Frame-Options, CSP frame-ancestors), HSTS, nosniff, Referrer-Policy, Permissions-Policy |

## 5. Migration chờ chạy trên production (009100 → 010100)

Đều theo quy tắc SQL Editor (không `DO $$`, `SELECT INTO`, `LIMIT`, `RETURNING INTO`), chạy lại an toàn, mỗi phần dưới 90 KB, mỗi phần là một giao dịch (lỗi thì không thay đổi gì).

## Điều kiện trước khi chạy thật

1. Chạy SQL `phan_14` → `phan_17`, trang Kiểm tra hệ thống phải xanh toàn bộ.
2. **Vá chi tiêu đồng thời ở sổ cái Xu**: kiểm tra số dư chưa khóa tài khoản, nên bấm tặng quà / mua đồ nhiều lần cùng lúc có thể trừ quá số dư. Đây là rủi ro lớn nhất còn lại.
3. Bật xác minh 2 lớp cho tài khoản admin.
4. Đặt đủ biến môi trường trên Vercel (`CRON_SECRET`, khóa VAPID, khóa Strava), rồi xem trang Kiểm tra hệ thống.

## Rủi ro đã biết, chấp nhận ở V1

- Chưa có giám sát lỗi tự động (Sentry…) và chưa diễn tập khôi phục sao lưu.
- Chưa có đối soát Xu hằng ngày và cảnh báo bất thường.
- Nuôi nhiều tài khoản để ăn thưởng giới thiệu: đã giới hạn 10 lượt / tháng và 3 km, chưa có CAPTCHA.
- Bài chạy trùng giờ / nghi vấn đã được thưởng trước bản vá 009800 / 009900 vẫn giữ Xu.
- Kiểm thử giao diện dùng dữ liệu giả; luồng thật (thanh toán VietQR, Strava, thông báo đẩy) cần thử trên production sau khi chạy SQL.
