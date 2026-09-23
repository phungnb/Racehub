# Hướng dẫn triển khai các thay đổi (Giai đoạn 0 + khung Giai đoạn 1)

Làm theo **đúng thứ tự** dưới đây. Tổng thời gian khoảng 20 phút.

## Bước 1 — Sao lưu database

Supabase Dashboard → **Database → Backups**. Kiểm tra có bản sao lưu gần nhất (gói Pro có sao lưu hằng ngày). Với gói Free, xuất dữ liệu bằng lệnh:

```bash
npx supabase db dump --db-url "$DATABASE_URL" -f backup_truoc_migration.sql
```

## Bước 2 — Cập nhật biến môi trường

Sao chép `.env.example` thành `.env.local` (máy local / Codespaces), hoặc điền vào **Vercel → Settings → Environment Variables**:

| Biến | Lấy ở đâu | Ghi chú |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API | Đã có |
| `SUPABASE_SERVICE_ROLE_KEY` | Cùng trang, mục `service_role` | **Bắt buộc**. Chỉ đặt ở server, không có tiền tố `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` | strava.com/settings/api | Trước đây Client ID bị hard-code, nay đọc từ biến môi trường |
| `OAUTH_STATE_SECRET` | Tự tạo bằng `openssl rand -hex 32` | **Mới**, bắt buộc |

Nếu thiếu một biến bắt buộc, route `/api/connect/strava` sẽ báo lỗi rõ tên biến bị thiếu, thay vì âm thầm dùng key sai như trước.

## Bước 3 — Chạy migration

> ⚠️ **KHẨN CẤP.** Database production hiện có lỗ hổng cho phép **bất kỳ ai, kể cả người chưa đăng nhập, tự tạo Xu, tự phong admin và đọc token Strava của người khác.** Chi tiết xem [BAO_CAO_BAO_MAT.md](./BAO_CAO_BAO_MAT.md). Hãy chạy migration **càng sớm càng tốt**.

Chạy **3 file** trong `supabase/migrations/`, đúng thứ tự:

| File | Nội dung | Chạy riêng được? |
|---|---|---|
| `20261001000100_emergency_lockdown.sql` | Khóa các lỗ hổng: thu hồi quyền gọi hàm nguy hiểm, bỏ các policy quá rộng, phân quyền theo cột, chuyển token Strava sang `connected_accounts` | **Có.** Nếu chưa deploy code mới được, hãy chạy file này trước |
| `20261001000200_ledger_and_rewards.sql` | Sổ cái thống nhất (đối soát số dư đầu kỳ), thưởng bài chạy phía server có trần/ngày, tính lại cấp độ theo tài liệu | Cần file 100 |
| `20261001000300_secure_rpcs.sql` | Viết lại các RPC: bài chạy GPS, tạo thử thách, quỹ CLB, giới thiệu bạn, duyệt bài, công cụ admin, kết nối Strava | Cần file 200 |
| `20261001000400_provider_activity_ingest.sql` | Nhận bài chạy từ Strava: chống trùng, luật hợp lệ kiểu UpRace, thu hồi thưởng khi bài bị xóa | Cần file 300 |

**Cách A — SQL Editor:** dán từng file theo thứ tự → Run. Mỗi file chạy lại nhiều lần vẫn an toàn.

**Cách B — CLI** (trong Codespaces, sau khi đã `link` như lúc dump schema):
```bash
npx supabase db push
```
File `20260601_team_challenges.sql` cũ **đã bị xóa** khỏi repo (chưa từng tạo bảng trên production; mô hình đội sẽ làm lại ở migration 000600). Nếu `db push` báo *"Remote migration versions not found in local migrations directory"* với mã `20260601`, chạy lệnh sau rồi push lại:

```bash
npx supabase migration repair --status reverted 20260601
```

### Tác động tới người dùng (cần biết trước)

| Thay đổi | Lý do |
|---|---|
| **Cấp độ được tính lại theo bảng trong tài liệu** (Lv2 từ 1.000 XP, Lv3 từ 5.000…). Công thức cũ `XP/500 + 1` cho ra cấp rất cao, nên nhiều người sẽ **thấy cấp giảm** | Đúng đặc tả Module 1.3 |
| **Thưởng chạy:** 1 Xu/km, 10 XP/km, trần 50 Xu/ngày (mặc định). Admin chỉnh được trong trang `/admin` | Công thức cũ 5 Xu + 50 XP/km, không có trần |
| **Bài chạy GPS bị chuyển sang "chờ duyệt"** nếu không có dữ liệu GPS, pace nhanh hơn 3:00/km, nhảy vị trí > 43 km/h, hoặc quãng đường khai lệch quá 15% so với GPS | Chống gian lận |
| **Người mời chỉ nhận thưởng khi bạn được mời chạy đủ 3 km.** Chỉ áp dụng lời mời trong 14 ngày đầu sau khi tạo tài khoản | Chống tạo tài khoản ảo |
| **CLB mới bắt đầu với quỹ 0 Xu** (trước đây được tặng 100 Xu) | Tiền phải có nguồn gốc trong sổ cái |
| **Người dùng mới bắt đầu với 0 Xu** (giống trigger `handle_new_user` hiện có) | Muốn tặng Xu chào mừng: cấu hình qua `admin_adjust_user_xu` hoặc nhiệm vụ |

Số Xu hiện có của từng người **được giữ nguyên**: migration ghi một bút toán "số dư đầu kỳ" cho mỗi người.

### Nếu chỉ chạy file 100 mà chưa deploy code mới
Hệ thống an toàn ngay, nhưng các chức năng sau sẽ tạm lỗi cho đến khi chạy tiếp file 200, 300 và deploy code: lưu bài chạy GPS (bản cũ vốn đã lỗi với mọi bài hợp lệ), tạo thử thách, kết nối/hủy Strava, người dùng mới tự tạo hồ sơ.

## Bước 4 — Cấu hình Strava

### 4a. Webhook Strava (bài chạy tự về, không cần bấm "Đồng bộ")
Cần một địa chỉ **công khai** (domain production, hoặc cổng 3000 của Codespaces đặt *Public* trong tab Ports). Mỗi app Strava chỉ có **1** subscription, nên khi đổi domain phải xóa rồi tạo lại.

```bash
# 1. Tạo mã xác minh và thêm vào .env.local (hoặc biến môi trường trên Vercel)
echo "STRAVA_WEBHOOK_VERIFY_TOKEN=$(openssl rand -hex 16)" >> .env.local
# (khởi động lại app để nhận biến mới)

# 2. Đăng ký (thay <domain>; lệnh đọc secret từ .env.local, không in ra màn hình)
set -a; . ./.env.local; set +a
curl -s -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=$NEXT_PUBLIC_STRAVA_CLIENT_ID -F client_secret=$STRAVA_CLIENT_SECRET \
  -F callback_url=https://<domain>/api/webhooks/strava -F verify_token=$STRAVA_WEBHOOK_VERIFY_TOKEN
# → {"id": 12345}  ⇒ thêm STRAVA_WEBHOOK_SUBSCRIPTION_ID=12345 vào biến môi trường

# Xem / xóa subscription hiện có
curl -s "https://www.strava.com/api/v3/push_subscriptions?client_id=$NEXT_PUBLIC_STRAVA_CLIENT_ID&client_secret=$STRAVA_CLIENT_SECRET"
curl -s -X DELETE "https://www.strava.com/api/v3/push_subscriptions/<id>?client_id=$NEXT_PUBLIC_STRAVA_CLIENT_ID&client_secret=$STRAVA_CLIENT_SECRET"
```
Chưa đăng ký webhook thì app vẫn chạy: khi vừa kết nối Strava, app tự kéo 30 ngày gần nhất, và người dùng có thể bấm **Đồng bộ** ở Trang chủ.

### 4b. Callback domain

strava.com/settings/api → **Authorization Callback Domain** = domain của app (ví dụ `racehub.vn`, hoặc domain Codespaces/Vercel khi thử nghiệm). Đường dẫn callback giữ nguyên: `/api/strava/callback`.

## Bước 5 — Deploy và kiểm tra

```bash
npm ci
npm run check     # lint + typecheck + test
npm run build
```

Checklist kiểm tra thủ công sau khi deploy:

- [ ] **Đăng nhập lại:** phiên đăng nhập nay lưu bằng cookie, nên mọi người cần đăng nhập lại một lần.
- [ ] **Đăng ký tài khoản mới** → vào Trang chủ thấy hồ sơ Lv.1 (0 Xu).
- [ ] **Tôi → Hồ sơ & Cài đặt → Strava "Liên kết"** → quay về hiện thông báo "Kết nối Strava thành công".
- [ ] **Chọn Nam/Nữ ở màn Nhân vật** vẫn lưu được.
- [ ] **Bấm "Hủy" kết nối Strava** → trạng thái trở về chưa kết nối.
- [ ] **Link mời CLB** `/club/join/<mã>` → vào đúng CLB (trước đây link này bị lỗi luôn nhận mã `undefined`).
- [ ] **Quên mật khẩu** → email → trang `/reset-password` đặt được mật khẩu mới.
- [ ] **Chạy thử 1 km bằng nút Chạy** (ngoài trời) → lưu thành công, nhận Xu/XP.
- [ ] **Tạo thử thách** → bị trừ phí, số dư trên thanh trên cùng giảm đúng.
- [ ] **Tài khoản admin** mở `/admin`, duyệt được bài chạy, lưu được cấu hình kinh tế.
- [ ] **Kiểm tra bảo mật** — Supabase → SQL Editor, chạy đoạn dưới. Kết quả **phải** báo lỗi `permission denied`:
  ```sql
  begin;
  select set_config('request.jwt.claims', '{"sub":"<uuid của bạn>","role":"authenticated"}', true);
  set local role authenticated;
  update public.profiles set xu = 999999 where id = '<uuid của bạn>';
  rollback;
  ```

## Bước 6 — Việc tiếp theo

Schema đã được đưa vào repo (`supabase/remote_schema.sql`), và các migration đã được test trên chính schema đó (xem `tests/db/`). Từ nay, mọi thay đổi DB đều viết thành migration, **không sửa trực tiếp trên Dashboard**, để schema trong repo luôn khớp với production.
