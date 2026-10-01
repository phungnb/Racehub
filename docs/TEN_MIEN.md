# Tên miền chính: racehubrun.com

Web chạy trên Vercel, cơ sở dữ liệu trên Supabase. App tự lấy tên miền từ địa chỉ đang mở, nên **không cần sửa biến môi trường**.
App Android / iOS mở `https://racehubrun.com` (cấu hình trong `capacitor.config.ts`).

## 1. Vercel — gắn tên miền
1. Vercel → dự án RaceHub → **Settings → Domains → Add**: nhập `racehubrun.com` → Add.
2. Thêm tiếp `www.racehubrun.com` → chọn **Redirect to racehubrun.com**.
3. Vercel hiện các bản ghi DNS cần thêm (bước 2). Chờ đến khi cả hai dòng báo **Valid Configuration**; HTTPS tự bật.

## 2. Nơi mua tên miền — thêm bản ghi DNS
Vào trang quản lý DNS của tên miền, **xoá các bản ghi A / CNAME mặc định** của `@` và `www` (trang đỗ của nhà cung cấp), rồi thêm:

| Loại | Tên (Host) | Giá trị | TTL |
|---|---|---|---|
| `A` | `@` | `76.76.21.21` | mặc định |
| `CNAME` | `www` | `cname.vercel-dns.com` | mặc định |

Nếu Vercel hiện giá trị khác (ví dụ một địa chỉ IP / CNAME riêng cho dự án) thì **dùng đúng giá trị Vercel hiện**.
Thường chạy sau 5–30 phút, tối đa 24 giờ.

## 3. Supabase — Authentication → URL Configuration
- **Site URL**: `https://racehubrun.com`
- **Redirect URLs** → Add URL: `https://racehubrun.com/**` và `https://www.racehubrun.com/**`
  (giữ địa chỉ `*.vercel.app` cũ để thử nghiệm). Thư xác nhận / quên mật khẩu sẽ dùng tên miền mới.

## 4. Strava
1. strava.com/settings/api → **Authorization Callback Domain**: `racehubrun.com` → Update.
2. Mở `https://racehubrun.com` → Quản trị → Hệ thống → Kiểm tra hệ thống → **Đăng ký webhook Strava** (để bài chạy Strava gửi về tên miền mới).

## 5. Đăng nhập Google / Apple (nếu đã bật)
- Google Cloud → APIs & Services → Credentials → OAuth client → *Authorized JavaScript origins*: thêm `https://racehubrun.com`.
- Apple Developer → Service ID → *Domains and Subdomains*: thêm `racehubrun.com`.
(Đường quay về vẫn là `https://<project>.supabase.co/auth/v1/callback` — không đổi.)

## 5b. Email gửi từ tên miền (bắt buộc trước khi mời nhiều người đăng ký)
Máy gửi email có sẵn của Supabase chỉ gửi **vài email mỗi giờ** cho cả hệ thống → người đăng ký thứ 3–4 gặp lỗi
*"email rate limit exceeded"*. Cần dùng dịch vụ gửi email riêng (SMTP), ví dụ **Resend** (miễn phí 3.000 email/tháng):
1. resend.com → đăng ký → **Domains → Add Domain**: `racehubrun.com` → thêm các bản ghi DNS (TXT/MX) Resend hiện vào Namecheap → chờ **Verified**.
2. Resend → **API Keys → Create** (chỉ quyền Sending). Không gửi key này qua chat.
3. Supabase → **Authentication → Emails → SMTP Settings** → bật **Enable custom SMTP**:
   - Sender email: `no-reply@racehubrun.com`, Sender name: `RaceHub`
   - Host `smtp.resend.com`, Port `465`, Username `resend`, Password: API key vừa tạo → Save.
4. Supabase → **Authentication → Rate Limits** → *Rate limit for sending emails*: tăng lên ~100/giờ.

Tạm thời khi test: có thể tắt **Authentication → Sign In / Providers → Email → Confirm email** để đăng ký không cần gửi thư (bật lại trước khi ra mắt).

## 6. Kiểm tra
- [ ] `https://racehubrun.com` mở được, có ổ khoá HTTPS; `www.racehubrun.com` tự chuyển về.
- [ ] Đăng ký / đăng nhập email, Google, Apple.
- [ ] Kết nối Strava + đồng bộ một bài chạy.
- [ ] Quản trị → Kiểm tra hệ thống: xanh hết.
- [ ] Thông báo đẩy: người đã bật trên tên miền cũ phải mở tên miền mới và bật lại.
- [ ] Sau đó mới dựng app Android (Actions → *Android — bản phát hành*) để app mở đúng tên miền mới.
