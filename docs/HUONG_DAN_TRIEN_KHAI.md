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

Chạy **4 file mới** trong `supabase/migrations/`, theo thứ tự tên file:

1. `20261001000100_security_baseline.sql`
2. `20261001000200_profiles_and_connections.sql`
3. `20261001000300_admin_rpcs.sql`
4. `20261001000400_rpc_auth_shims.sql`

**Cách A — SQL Editor (đơn giản):** Supabase → SQL Editor → dán nội dung từng file → Run. Mỗi file chạy lại nhiều lần cũng an toàn (idempotent).

**Cách B — Supabase CLI:**
```bash
npx supabase link --project-ref <project-ref>
npx supabase db push
```

Sau khi chạy file 4, bảng *Messages* của SQL Editor sẽ liệt kê các RPC đã được "bọc", ví dụ `Đã bọc RPC equip_item(p_item_id uuid)`. Nếu bạn thấy dòng `Không tìm thấy ...`, hãy báo lại cho tôi tên hàm đó.

### Các migration này làm gì
- **Chặn client sửa Xu/XP/Level/role** và các cột tài sản khác qua API REST. Các RPC hiện có vẫn chạy bình thường.
- **Tạo hồ sơ phía server:** người dùng mới tự có hồ sơ với 500 Xu chào mừng, client không còn tự đặt số Xu.
- **Chuyển token Strava** khỏi bảng `profiles` sang schema `private` (client không đọc được).
- **Admin duyệt bài chạy / lưu cấu hình kinh tế** qua RPC có kiểm tra quyền và ghi nhật ký.
- **RPC cũ nhận `p_user_id`** (`equip_item`, `submit_and_process_activity`, `create_challenge_with_ledger`) giờ tự lấy người gọi từ phiên đăng nhập. Bản cũ được chuyển sang schema `legacy`, không gọi được từ ngoài.
- **Quyền admin** được chép từ `profiles.role = 'SYSTEM_ADMIN'` sang bảng `user_roles`. Từ nay cấp quyền admin bằng lệnh:
  ```sql
  insert into public.user_roles (user_id, role) values ('<uuid>', 'SYSTEM_ADMIN');
  ```

Không có bảng hay cột nào bị xóa.

## Bước 4 — Cấu hình Strava

strava.com/settings/api → **Authorization Callback Domain** = domain của app (ví dụ `racehub.vn`, hoặc domain Codespaces/Vercel khi thử nghiệm). Đường dẫn callback giữ nguyên: `/api/strava/callback`.

## Bước 5 — Deploy và kiểm tra

```bash
npm ci
npm run check     # lint + typecheck + test
npm run build
```

Checklist kiểm tra thủ công sau khi deploy:

- [ ] **Đăng nhập lại:** phiên đăng nhập nay lưu bằng cookie, nên mọi người cần đăng nhập lại một lần.
- [ ] **Đăng ký tài khoản mới** → vào Trang chủ thấy 500 Xu, Lv.1.
- [ ] **Tôi → Hồ sơ & Cài đặt → Strava "Liên kết"** → quay về hiện thông báo "Kết nối Strava thành công".
- [ ] **Chọn Nam/Nữ ở màn Nhân vật** vẫn lưu được.
- [ ] **Bấm "Hủy" kết nối Strava** → trạng thái trở về chưa kết nối.
- [ ] **Link mời CLB** `/club/join/<mã>` → vào đúng CLB (trước đây link này bị lỗi luôn nhận mã `undefined`).
- [ ] **Quên mật khẩu** → email → trang `/reset-password` đặt được mật khẩu mới.
- [ ] **Tài khoản admin** mở `/admin`, duyệt được bài chạy.
- [ ] **Kiểm tra bảo mật:** Supabase → SQL Editor, chạy đoạn dưới (giả lập một lệnh ghi trực tiếp từ trình duyệt). Kết quả **phải** báo lỗi `PROTECTED_COLUMN`:
  ```sql
  begin;
  select set_config('request.path', '/profiles', true),
         set_config('request.jwt.claims', '{"sub":"<uuid của bạn>","role":"authenticated"}', true);
  set local role authenticated;
  update public.profiles set xu = 999999 where id = '<uuid của bạn>';
  rollback;
  ```

## Bước 6 — Việc tôi cần từ bạn để làm tiếp

Chạy lệnh sau rồi commit, push:

```bash
npx supabase db pull
git add supabase/migrations && git commit -m "chore: pull remote schema" && git push
```

Khi có schema thật, tôi sẽ viết lại hoàn chỉnh `submit_and_process_activity`, `create_challenge_with_ledger` và các RPC CLB theo thiết kế (sổ cái kép, engine chấm điểm phía server). Xem [docs/architecture/README.md §6](./architecture/README.md#6-lộ-trình-triển-khai-đề-xuất).
