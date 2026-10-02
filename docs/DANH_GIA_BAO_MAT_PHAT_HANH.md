# Đánh giá bảo mật & chất lượng trước khi phát hành (CH Play / App Store)

*Ngày: 02/10/2026 · Phạm vi: mã nguồn web (Next.js 16), API máy chủ, database Supabase (126 migration), app Android/iOS (Capacitor), quy trình build.*
*Cách làm: quét tự động (npm audit, quét lịch sử git tìm khóa bí mật, quét cấu hình database bằng test) + đọc mã từng điểm nhạy cảm.*
*Không gồm: kiểm thử xâm nhập do bên thứ ba thực hiện, cấu hình trong bảng điều khiển Supabase / Vercel (không đọc được từ mã) — xem mục 5.*

## 1. Tổng quan

| Hạng mục | Đánh giá | Ghi chú |
|---|---|---|
| Bảo mật database (quyền, RLS) | **Tốt** | 0 bảng thiếu RLS; mọi hàm đặc quyền khóa `search_path`; khách chỉ gọi được 18 hàm công khai đã duyệt |
| Bảo mật API máy chủ | **Tốt** | Mọi route kiểm tra đăng nhập / quyền; cron & push có khóa bí mật so sánh hằng thời gian |
| Khóa bí mật | **Tốt** | Không có khóa nào trong mã hoặc lịch sử git; khóa service role chỉ ở máy chủ |
| Thư viện bên ngoài | **Đã vá** | 1 lỗ hổng NGHIÊM TRỌNG ở Next.js — đã nâng cấp, còn 0 |
| App Android / iOS | **Khá** | Đã khóa sao lưu, quyền vị trí có giải thích; đã thu hẹp trang được mở trong app |
| Chống gian lận bài chạy | **Khá** | Xem `docs/CHONG_GIAN_LAN.md` |
| Chất lượng kỹ thuật | **Tốt** | 715 test tự động đạt; 0 lỗi kiểu / lint; 0 `any`, 0 TODO |
| Độ tin cậy vận hành | **Trung bình** | Phụ thuộc gói miễn phí Supabase (không có sao lưu khôi phục theo thời điểm) — xem mục 5 |

## 2. Lỗi phát hiện trong lần quét này

| # | Mức | Lỗi | Trạng thái |
|---|---|---|---|
| 1 | **Nghiêm trọng** | Next.js 16.3.5 có lỗ hổng chạy mã từ xa (GHSA-vcvr-r3jv-pc5j, ở `next/og`). RaceHub không dùng `next/og` nên khó khai thác, nhưng vẫn phải vá | **Đã sửa**: nâng lên 16.3.8, `npm audit` = 0 |
| 2 | Thấp | Chuyển hướng ra trang ngoài (open redirect): link `?next=/<tab>/trang-gia.com` vượt qua bộ lọc vì trình duyệt bỏ ký tự tab → dùng để lừa đảo (link RaceHub thật dẫn sang trang giả) | **Đã sửa** + thêm test |
| 3 | Thấp | App Android/iOS cho mở trong khung app **mọi** trang `*.supabase.co` (ai cũng tạo được dự án Supabase) | **Đã sửa**: chỉ cho đúng dự án của RaceHub khi build có biến `NEXT_PUBLIC_SUPABASE_URL` (đặt ở GitHub → Actions → Variables) |
| 4 | Thấp | Giới hạn đăng ký bằng SĐT đọc IP từ `x-forwarded-for` (có thể giả ở môi trường không phải Vercel) | **Đã sửa**: ưu tiên `x-real-ip` do Vercel đặt |
| 5 | Trung bình | Đăng ký bằng SĐT **chưa xác minh OTP**: có thể đăng ký trước số điện thoại của người khác | Còn mở — cần dịch vụ SMS (mục 4) |
| 6 | Trung bình | Giới hạn spam đăng ký SĐT chỉ đếm trong bộ nhớ từng máy chủ (5 lần/giờ/IP), Vercel chạy nhiều máy nên chưa chặt | Còn mở — nên bật CAPTCHA Supabase (mục 4) |
| 7 | Thấp | Bài chạy đang chờ duyệt mà người chạy để công khai: người khác (đã đăng nhập) đọc được cả ghi chú chống gian lận của bài | Còn mở — chuyển sang RPC ở lần sau; không lộ dữ liệu cá nhân |
| 8 | Thấp | Chưa có Content-Security-Policy đầy đủ (mới có chống nhúng iframe, chống đoán kiểu tệp, HSTS) | Còn mở — React 19 đã tự chặn link `javascript:`; không có chỗ nào chèn HTML thô |
| 9 | Thông tin | Webhook Strava chấp nhận sự kiện từ bất kỳ ai nếu chưa đặt `STRAVA_WEBHOOK_SUBSCRIPTION_ID` (dữ liệu luôn lấy lại từ Strava nên không giả được bài, chỉ tốn lượt gọi API) | Kiểm tra hệ thống đã cảnh báo khi thiếu |

## 3. Các lớp bảo vệ đã kiểm chứng

**Database** (test `tests/db/security-posture.test.ts` chạy mỗi lần sửa mã — lỗi cấu hình sẽ bị chặn trước khi phát hành):
- Mọi bảng bật RLS; khách chưa đăng nhập không ghi được bảng nào.
- 486 hàm đặc quyền (SECURITY DEFINER) đều khóa `search_path`; đã đọc các hàm thay đổi dữ liệu — đều kiểm tra quyền (chủ CLB, admin tổ chức, người quản lý giải…).
- Cột nhạy cảm (Xu, XP, quyền admin, token Strava, mã giới thiệu, khóa tài khoản) không ai đọc / sửa trực tiếp được — chỉ qua hàm có kiểm tra.
- Token Strava nằm trong schema riêng, chỉ máy chủ đọc được.
- Bản đồ GPS (lộ địa chỉ nhà) mặc định **riêng tư**.
- 9 kho ảnh đều giới hạn dung lượng (≤ 10 MB) và loại tệp (ảnh / PDF).
- Các lỗ hổng tiền ảo nghiêm trọng của bản gốc (tự nạp Xu, tự phong admin, đọc token người khác…) đã vá và có test giữ — xem `docs/BAO_CAO_BAO_MAT.md`.

**API máy chủ**:
- Kết nối Strava: chống giả mạo (state có chữ ký + nonce trong cookie + đúng người đăng nhập).
- Cron / gửi thông báo đẩy: khóa bí mật, so sánh hằng thời gian.
- Xóa tài khoản: thu hồi Strava, xóa ảnh, xóa dữ liệu (yêu cầu Apple 5.1.1(v)).
- Header bảo mật: chống nhúng iframe, HSTS, chặn camera / vị trí ngoài RaceHub.

**App**: không sao lưu dữ liệu app lên đám mây (`allowBackup=false`); đăng nhập qua link `vn.racehub.app://auth` dùng PKCE (app khác bắt được link cũng không đổi được phiên); quyền vị trí / camera / ảnh đều có câu giải thích.

## 4. Việc nên làm trước khi phát hành

| Ưu tiên | Việc | Ai làm |
|---|---|---|
| **Cao** | Supabase → Authentication → bật **CAPTCHA** (hCaptcha / Turnstile) cho đăng ký & đăng nhập | Admin (bảng điều khiển) |
| **Cao** | Supabase → Authentication → **Leaked password protection** bật; độ dài mật khẩu tối thiểu 8 | Admin |
| **Cao** | Bật **xác thực 2 lớp (MFA)** cho tài khoản Quản trị chính | Admin |
| **Cao** | Nâng **Supabase Pro** khi có người dùng thật: sao lưu hằng ngày 7 ngày, không bị tạm dừng, nhiều tài nguyên hơn. Gói miễn phí không có bản sao lưu tải về được | Chủ dự án |
| **Cao** | Kiểm tra Vercel: gói Hobby **không cho dùng thương mại** — app có thu phí (VIP / Pro) cần gói Pro | Chủ dự án |
| Trung bình | Đặt biến `NEXT_PUBLIC_SUPABASE_URL` và `STRAVA_WEBHOOK_SUBSCRIPTION_ID` (GitHub Actions + Vercel) | Admin |
| Trung bình | OTP SMS cho đăng ký bằng SĐT (hoặc tạm ẩn đăng ký SĐT, chỉ để email / Google / Apple) | Lập trình + dịch vụ SMS |
| Thấp | CSP đầy đủ (script-src có nonce); chuyển dữ liệu chống gian lận của bài chạy sang RPC | Lập trình |

## 5. Không kiểm tra được từ mã nguồn

Giới hạn tần suất của Supabase Auth, cấu hình email, danh sách URL chuyển hướng được phép, chính sách mật khẩu, sao lưu, nhật ký truy cập, quyền thành viên trong Vercel / Supabase / GitHub / Google Play Console / App Store Connect (nên bật 2 lớp cho mọi tài khoản này).

## 6. Chất lượng kỹ thuật

- ~55.000 dòng TypeScript, 126 migration SQL (~33.000 dòng), 163 tệp test.
- **715 test tự động** (268 ứng dụng + 447 database) đều đạt; `tsc` và `eslint` 0 lỗi; 0 `any`; 0 TODO / FIXME; 0 `console.log` sót lại.
- Kiến trúc: logic tiền ảo / quyền nằm trong database (không tin dữ liệu từ app), máy chủ chỉ giữ khóa bí mật, giao diện chia theo tính năng (`features/*`).
- Điểm cần theo dõi: số hàm database lớn (486 hàm đặc quyền) — mỗi tính năng mới phải kèm test quyền như hiện nay.
