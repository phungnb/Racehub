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
| `CRON_SECRET` | Tự tạo bằng `openssl rand -hex 24` | **Mới (Sprint 2)**. Vercel dùng để gọi `/api/cron/club-recap` (bài Tổng kết tuần, 07:00 sáng thứ Hai), `/api/cron/challenges` (tất toán thử thách) và `/api/cron/leagues` (chốt league 00:10 thứ Hai). Lịch nằm trong `vercel.json` |

Nếu thiếu một biến bắt buộc, route `/api/connect/strava` sẽ báo lỗi rõ tên biến bị thiếu, thay vì âm thầm dùng key sai như trước.

## Bước 3 — Chạy migration

> ⚠️ **KHẨN CẤP.** Database production hiện có lỗ hổng cho phép **bất kỳ ai, kể cả người chưa đăng nhập, tự tạo Xu, tự phong admin và đọc token Strava của người khác.** Chi tiết xem [BAO_CAO_BAO_MAT.md](./BAO_CAO_BAO_MAT.md). Hãy chạy migration **càng sớm càng tốt**.

Chạy các file trong `supabase/migrations/`, đúng thứ tự:

| File | Nội dung | Chạy riêng được? |
|---|---|---|
| `20261001000100_emergency_lockdown.sql` | Khóa các lỗ hổng: thu hồi quyền gọi hàm nguy hiểm, bỏ các policy quá rộng, phân quyền theo cột, chuyển token Strava sang `connected_accounts` | **Có.** Nếu chưa deploy code mới được, hãy chạy file này trước |
| `20261001000200_ledger_and_rewards.sql` | Sổ cái thống nhất (đối soát số dư đầu kỳ), thưởng bài chạy phía server có trần/ngày, tính lại cấp độ theo tài liệu | Cần file 100 |
| `20261001000300_secure_rpcs.sql` | Viết lại các RPC: bài chạy GPS, tạo thử thách, quỹ CLB, giới thiệu bạn, duyệt bài, công cụ admin, kết nối Strava | Cần file 200 |
| `20261001000400_provider_activity_ingest.sql` | Nhận bài chạy từ Strava: chống trùng, luật hợp lệ kiểu UpRace, thu hồi thưởng khi bài bị xóa | Cần file 300 |
| `20261001000500_club_hub_core.sql` | **Sprint 2, CLB:** bảng tin, chat, thông báo, BXH CLB, hộp thư, bài tự sinh, bucket ảnh `club-media`; **sửa lỗi không gán được vai trò Quản trị viên / không cấm được thành viên** | Cần file 400 |
| `20261001000600_challenge_engine.sql` | **Sprint 3, Thử thách:** tham gia/rời, đội (4 chế độ), tiến độ tự tính từ bài chạy, BXH realtime, treo thưởng từ ví hoặc quỹ CLB, tất toán tự động. **Sửa lỗi production:** trước đây không có cách tham gia thử thách và không đọc được danh sách người tham gia | Cần file 500 |
| `20261001000700_economy_admin.sql` | **Kinh tế Xu & điều phối admin (ADR-014):** phí tạo thử thách theo số người (≤ 5 miễn phí · 6–10 người 3 Xu/người · trên 10 người 5 Xu/người), thử thách CLB trả bằng quỹ CLB, vé tạo miễn phí, thưởng chạy mới (km đầu 1 Xu + 0,2 Xu/km, trần 10 Xu/ngày), admin cộng/trừ Xu cho cá nhân hoặc quỹ CLB | Cần file 600 |
| `20261001000800_game_layer.sql` | **Sprint 4, Game (ADR-015):** nhiệm vụ ngày/tuần, điểm danh, streak tuần + khiên, 27 huy hiệu, league tuần (Đồng → Kim cương), cổ vũ bằng Xu, ví Xu, chuỗi phần thưởng sau bài chạy. Bài chạy bị xóa thì thu hồi cả thưởng game | Cần file 700 |
| `20261001000900_character_shop.sql` | **Nhân vật 3D (ADR-016):** 45 vật phẩm (tóc, áo, quần, tất, giày, mũ, kính, đồng hồ, phụ kiện, hiệu ứng), mua bằng Xu, quà lên cấp, lưu bộ đồ. Vật phẩm cũ không có mô hình bị ẩn khỏi shop | Cần file 800 |

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
| **Thưởng chạy (từ file 700):** km đầu 1 Xu, mỗi km tiếp 0,2 Xu, trần 10 Xu/ngày; 10 XP/km. Admin chỉnh trong `/admin` → Chính sách | Công thức cũ 5 Xu + 50 XP/km, không có trần |
| **Thử thách CLB không còn miễn phí** (từ file 700): phí trừ vào quỹ CLB. Thử thách ≤ 5 người luôn miễn phí; admin có thể tặng vé miễn phí | Chống tạo thử thách tràn lan, Xu có giá trị |
| **Bài chạy GPS bị chuyển sang "chờ duyệt"** nếu không có dữ liệu GPS, pace nhanh hơn 3:00/km, nhảy vị trí > 43 km/h, hoặc quãng đường khai lệch quá 15% so với GPS | Chống gian lận |
| **Người mời chỉ nhận thưởng khi bạn được mời chạy đủ 3 km.** Chỉ áp dụng lời mời trong 14 ngày đầu sau khi tạo tài khoản | Chống tạo tài khoản ảo |
| **CLB mới bắt đầu với quỹ 0 Xu** (trước đây được tặng 100 Xu) | Tiền phải có nguồn gốc trong sổ cái |
| **Người dùng mới bắt đầu với 0 Xu** (giống trigger `handle_new_user` hiện có) | Muốn tặng Xu chào mừng: cấu hình qua `admin_adjust_user_xu` hoặc nhiệm vụ |

Số Xu hiện có của từng người **được giữ nguyên**: migration ghi một bút toán "số dư đầu kỳ" cho mỗi người.

### Nếu chỉ chạy file 100 mà chưa deploy code mới
Hệ thống an toàn ngay, nhưng các chức năng sau sẽ tạm lỗi cho đến khi chạy tiếp file 200, 300 và deploy code: lưu bài chạy GPS (bản cũ vốn đã lỗi với mọi bài hợp lệ), tạo thử thách, kết nối/hủy Strava, người dùng mới tự tạo hồ sơ.

### Luôn kiểm tra migration đã chạy đủ

SQL Editor có thể dừng giữa chừng mà không báo rõ (đã xảy ra với file 500). Sau mỗi file, chạy câu kiểm tra tương ứng:

```sql
-- File 500 phải ra 16 dòng; file 600 phải ra 13 dòng
select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in (
  'create_challenge_v2','preview_challenge_fee','join_challenge','leave_challenge','change_challenge_team','cancel_challenge',
  'get_challenge','list_challenges','challenge_leaderboard','challenge_team_standings','settle_challenge_if_due',
  'settle_due_challenges','challenge_visible') order by 1;
notify pgrst, 'reload schema';

-- File 700 phải ra 10 dòng
select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in (
  'quote_challenge','economy_policy','my_challenge_passes','admin_search_accounts','admin_grant_xu',
  'admin_grant_challenge_pass','admin_revoke_challenge_pass','admin_list_passes','admin_economy_overview',
  'admin_publish_config') order by 1;
notify pgrst, 'reload schema';

-- File 800 phải ra 11 dòng
select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in (
  'my_game_state','daily_checkin','set_weekly_goal','buy_streak_shield','send_cheer','activity_rewards',
  'mark_game_events_seen','my_achievements','league_standings','my_wallet','settle_due_leagues') order by 1;
notify pgrst, 'reload schema';

-- File 900 phải ra 4 dòng (và bảng avatar_items có ≥ 45 vật phẩm có mã)
select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in (
  'character_state','get_character','buy_avatar_item','save_character') order by 1;
select count(*) from public.avatar_items where code is not null;
notify pgrst, 'reload schema';
```

### Sau khi chạy file 700: cấp quyền admin và điều phối Xu

1. Cấp quyền cho tài khoản quản trị (chạy một lần trong SQL Editor, thay email):
   ```sql
   update public.profiles set role = 'SYSTEM_ADMIN'
    where id = (select id from auth.users where email = '<email-cua-ban>');
   ```
2. Tải lại app: biểu tượng khiên xuất hiện trên thanh trên cùng → **Quản trị RaceHub**.
   - **Cộng/Trừ Xu:** tìm người (tên, email, ID) hoặc CLB → nhập số Xu → chọn *Xu thưởng* hay *Xu nạp* → ghi lý do → xác nhận. Có nhật ký, người nhận (hoặc ban quản trị CLB) được báo.
   - **Vé miễn phí:** tặng N vé cho cá nhân/CLB, mỗi vé dùng cho một thử thách tối đa M người, có hạn dùng; thu hồi được.
   - **Chính sách:** sửa giá trị 1 Xu, mức thưởng chạy, biểu phí; bảng mô phỏng cho thấy phí trước/sau khi lưu.

### Sau khi chạy file 500: bật Realtime cho chat

File 500 đã tự thêm `club_messages`, `club_posts`, `notifications` vào Realtime; file 600 thêm `challenge_participants` (BXH thử thách cập nhật tức thì). Kiểm tra lại trong **Supabase → Database → Publications → supabase_realtime**: ba bảng này phải được bật. Nếu chưa có thì chat vẫn gửi được, nhưng người khác phải tải lại trang mới thấy tin mới.

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
- [ ] **CLB (Sprint 2):** dùng 2 tài khoản trên 2 trình duyệt (hoặc 1 máy tính + 1 điện thoại):
  - [ ] Tài khoản A **tạo CLB** → vào tab Thành viên → **Mời bạn vào CLB** → sao chép link.
  - [ ] Tài khoản B mở link → vào CLB (nếu chế độ "Cần duyệt": A thấy chấm đỏ ở tab Thành viên và chuông thông báo → **Duyệt**).
  - [ ] Tab **Chat**: A gửi tin → B thấy ngay dưới 1 giây, không cần tải lại. Gõ `@` → hiện gợi ý tên → B nhận thông báo "nhắc đến bạn".
  - [ ] Giữ (hoặc chạm) vào một tin → **Trả lời**, **Thu hồi** hoạt động.
  - [ ] Ra danh sách CLB: CLB có tin chưa đọc hiện số màu đỏ; mở Chat thì số về 0.
  - [ ] Tab **Bảng tin**: A (Chủ nhiệm) bật "Đăng thành thông báo ghim" → bài nằm đầu bảng tin, B nhận thông báo. B đăng bài có ảnh, A **Thích** / **Bình luận**.
  - [ ] B chạy một bài (hoặc đồng bộ Strava) → bài chạy **tự hiện** trên Bảng tin CLB và cộng vào **BXH** tuần.
  - [ ] Tab **Thành viên**: A cho B làm **Quản trị viên** (trước đây bị lỗi), rồi thôi; thử **Cấm** một tài khoản thử.
  - [ ] **Cài đặt CLB** (bánh răng): đổi màu CLB, đổi logo, chọn mức thông báo "Tắt" → không nhận thông báo từ CLB đó nữa.
  - [ ] **Thử thách (Sprint 3):** tab **Thử thách** → **Tạo** → chọn *Đồng đội* · *Chốt đoàn*, 2 đội, bắt đầu sau 15 phút → tài khoản B mở link, **Chọn đội**. Khi bắt đầu, cả hai chạy/đồng bộ một bài → BXH và thanh đội đổi ngay không cần tải lại.
  - [ ] Chủ nhiệm CLB: tab **Thử thách** trong CLB → **Tạo thử thách CLB**, treo thưởng từ **quỹ CLB** → bảng tin CLB có bài "Thử thách mới", thành viên nhận thông báo, quỹ CLB giảm đúng số Xu.
  - [ ] Thử thách hết hạn quá 2 giờ → mở trang chi tiết là tự tổng kết: người thắng nhận Xu, mọi người nhận thông báo kết quả.
  - [ ] Kiểm tra cron: `curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/club-recap` → trả về `{"posted": …}`; `/api/cron/challenges` và `/api/cron/leagues` → `{"settled": …}`; gọi không có token → 401.
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
