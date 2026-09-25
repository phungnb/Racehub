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
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Tự tạo một lần: `npx web-push generate-vapid-keys` | **Mới (PWA-02)**. Bật thông báo đẩy. Khóa riêng chỉ đặt ở server. Đổi khóa thì mọi thiết bị phải bật lại thông báo |
| `VAPID_SUBJECT` | `mailto:<email của bạn>` hoặc `https://<tên-miền>` | Không bắt buộc (mặc định dùng tên miền app) |

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
| `20261001001000_character_2d.sql` | **Nhân vật 2D (ADR-017):** thay 3D bằng ảnh nhân vật thật đổi màu áo / quần / tất / giày (35 bộ màu, có bản nguyên bản). Ngừng bán đồ 3D (tóc, mũ, kính, đồng hồ, phụ kiện, hiệu ứng) và **tự hoàn Xu** cho người đã mua, kèm thông báo. Thêm cột `render_kind`, `layer_urls` để sau này xếp lớp PNG | Cần file 900 |
| `20261001001100_drop_3d_columns.sql` | Dọn 3 cột của nhân vật 3D không còn dùng (`model_key`, `model_urls`, `color2`) | Cần file 1000 |
| `20261001001200_item_admin.sql` | **Quản trị vật phẩm:** kho ảnh `character-layers` (chỉ admin tải lên), thêm/sửa/ẩn vật phẩm trong trang Quản trị → Vật phẩm, có nhật ký | Cần file 1100 |
| `20261001001300_headwear_collection.sql` | **Bộ đồ đội đầu đầu tiên:** 16 món ở ô Mũ (mũ chạy Tempo 4 màu, mũ Neon, mũ Huyền Thoại quà cấp 5, visor 3 màu, băng đô bông 4 màu, băng đô mảnh 3 màu). Ảnh nằm trong `public/character/layers/` nên **cần deploy code mới** | Cần file 1200 |
| `20261001001400_profile_details.sql` | **Hồ sơ cá nhân:** giới tính (nhân vật đi theo), giới thiệu, ngày sinh / chiều cao / cân nặng (bảng riêng, chỉ chủ tài khoản đọc được), kho ảnh `avatars`, lệnh `update_my_profile` | Cần file 1300 |
| `20261001001500_club_events_finance.sql` | **CLB hoàn chỉnh:** sự kiện chạy nhóm + báo tham gia + nhắc trước 12 giờ; điểm danh bằng QR (hết hạn 15 phút), tự điểm danh từ bài chạy, ban quản trị điểm danh tay; thu chi tiền VND (tài khoản VietQR, kỳ thu phí, xác nhận đóng, khoản chi có hóa đơn, xuất CSV); bình chọn; huy hiệu chạy nhóm 1/5/20 | Cần file 1400 |
| `20261001001600_club_bank_qr.sql` | Ban quản trị CLB tự tải **ảnh mã QR nhận tiền** (app ngân hàng / MoMo / ZaloPay); có ảnh thì thành viên quét ảnh này, không có thì app tự tạo VietQR từ số tài khoản | Cần file 1500 |
| `20261001001700_web_push.sql` | **Thông báo đẩy:** thiết bị nhận push, cài đặt loại thông báo + giờ yên lặng (mặc định 22h–6h), hàng đợi gửi. Sau khi chạy cần bước "Bật gửi push" bên dưới | Cần file 1600 |
| `20261001001800_onboarding.sql` | **Màn chào mừng người mới** (hồ sơ → Strava → CLB → thông báo). Tài khoản đang có được coi là đã xong, chỉ người đăng ký mới thấy | Cần file 1700 |
| `20261001001900_activity_detail.sql` | **Chi tiết bài chạy:** lưu tuyến chạy + từng km (từ Strava), trang `/activities/<id>` có bản đồ, nhịp tim, so sánh với bài trước; ảnh chia sẻ. Bản đồ của người khác vẫn theo cài đặt quyền riêng tư (mặc định riêng tư) | Cần file 1800 |
| `20261001002000_challenge_pledges.sql` | **Mục tiêu tự đăng ký:** thử thách tuần của CLB (mỗi người chọn mốc 21/42/60/100 km…, xếp hạng theo % mục tiêu) và đua đội theo mục tiêu (đăng ký km → quản trị chia đội cân bằng hoặc ngẫu nhiên, giới hạn % chạy vượt được tính) | Cần file 1900 |
| `20261001002100_club_no_member_limit.sql` | **Bỏ giới hạn thành viên CLB:** CLB không còn số thành viên tối đa (cài đặt CLB đã bỏ ô này) | Chạy độc lập |
| `20261001002200_pledge_auto_teams.sql` | **Đua đội theo mục tiêu — tự tạo đội:** ban quản trị chỉ đặt số người mỗi đội; khi chia đội, số đội = số người đăng ký ÷ số người mỗi đội, hệ thống tạo đội và chia cho tổng mục tiêu các đội bằng nhau. Thử thách Đồng đội cũ giữ nguyên | Cần file 2000 |
| `20261001002300_anti_cheat.sql` | **Chống gian lận:** bài Strava mới được máy chủ tải dữ liệu chi tiết và chấm điểm (tốc độ duy trì, đoạn đi xe, GPS nhảy, sải chân, nhịp tim so với pace, so với lịch sử); bài chạy GPS trong app kiểm tra tốc độ duy trì / đoạn đi xe. Nghi vấn → chờ duyệt (chưa cộng Xu, chưa tính thử thách), tab Duyệt bài hiện lý do + mức rủi ro | Chạy độc lập |
| `20261001002400_review_flow_hr.sql` | **Duyệt bài chuyên nghiệp + nhịp tim:** bài bình thường ghi nhận ngay, chỉ bài nghi gian lận chờ duyệt kèm mức nghi vấn và lý do; báo người chạy + ban quản trị CLB; chủ nhiệm / quản trị viên CLB duyệt trong tab Thành viên. Thử thách có tùy chọn Bắt buộc có nhịp tim | Cần file 2300 |
| `20261001002500_nbnr_collection.sql` | **Bộ sưu tập CLB NBNR:** áo, quần, tất đôi, mũ, băng đô (ảnh lớp trong public/character/layers/, cần deploy trước) | Cần file 1300 |
| `20261001002600_club_battles.sql` | **CLB đấu CLB + Xếp hạng CLB:** ban quản trị gửi lời thách đấu (tổng km hoặc km trung bình / thành viên), CLB kia nhận lời; bảng hai phía; tất toán + báo kết quả (cron hằng ngày `/api/cron/challenges`). Xếp hạng CLB tuần / tháng theo km trung bình, hạng Đồng → Kim cương | Chạy độc lập |
| `20261001002700_virtual_races.sql` | **Giải chạy ảo:** BTC (admin hoặc ban quản trị CLB) tạo giải nhiều cự ly; VĐV đăng ký nhận BIB; bài hợp lệ ≥ cự ly tự ghi thành tích (quy đổi theo pace); kết quả, dashboard BTC, xuất CSV, giấy chứng nhận | Chạy độc lập |
| `20261001002800_club_pro.sql` | **Gói CLB Pro:** gói miễn phí tối đa 2 Quản trị viên; Pro: không giới hạn, link mời riêng `/c/<slug>`, báo cáo chuyên cần CSV. Admin bật Pro ở Quản trị → CLB Pro (chưa có thanh toán trong app) | Cần file 2600 (dùng hàm báo tin CLB) |
| `20261001002900_race_bib_design.sql` | **e-BIB tự thiết kế:** BTC chọn mẫu (cổ điển / sọc chéo / neon / tối giản), màu, logo, ảnh nền, khẩu hiệu, tối đa 4 nhà tài trợ, QR xác thực; kho ảnh `race-media`; quét QR mở trang giải xác thực VĐV | Cần file 2700 |
| `20261001003000_bib_layout.sql` | **BIB đa dạng:** tải ảnh BIB có sẵn (Canva / Photoshop) làm khung + căn chỉnh (thu phóng, dịch ngang / dọc, kéo trên ảnh xem trước); bố cục số / tên (tên dưới, tên trên, cùng hàng), căn trái / giữa / phải, vị trí dọc, cỡ chữ, 4 kiểu chữ; QR phải / trái / góc dưới; bật / tắt đầu BIB và dải tài trợ | Cần file 2900 |
| `20261001003100_smart_search.sql` | **Tìm kiếm linh hoạt:** không dấu / hoa thường / Unicode tổ hợp (Unikey), nhiều từ không cần đúng thứ tự, viết tắt chữ cái đầu ("nbnr"), link riêng CLB; xếp khớp nhất trước. Áp cho tìm CLB (`search_clubs` mới), VĐV, admin tìm tài khoản / CLB Pro. CLB "chỉ qua mã mời" chỉ hiện khi gõ đúng tên | Cần file 2800 |
| `20261001003200_bib_text_boxes.sql` | **BIB 3 khung chữ:** Đơn vị tổ chức, Số BIB, Tên VĐV — mỗi khung tự đặt vị trí (kéo trên ảnh xem trước), căn lề, 10 font có tiếng Việt, nghiêng, viền rỗng, cỡ, màu; chữ Đơn vị tổ chức tự nhập | Cần file 3000 |
| `20261001003300_search_suggest_media_fix.sql` | **Gợi ý tìm kiếm admin + sửa kho ảnh BIB:** ô chọn người nhận Xu / vé có sổ xuống gợi ý ngay khi bấm (người mới + CLB đông nhất), gõ 1 ký tự đã lọc; kho `race-media` kiểm tra đường dẫn an toàn và nâng giới hạn lên 10 MB (app tự nén ảnh) | Cần file 3100 |
| `20261001003400_club_secrets.sql` | **Bảo mật CLB:** bảng `clubs` chỉ cho đọc cột công khai — mã mời và tài khoản ngân hàng không còn lộ qua API; mã mời lấy qua `club_invite_code`. **Sửa lỗi:** CLB "chỉ qua mã mời" trước đây không ai vào được, nay có mã là vào | Cần file 3300. **Gộp nhánh cùng lúc** (app mới không đọc `invite_code` trực tiếp) |
| `20261001003500_system_check.sql` | **Quản trị → Hệ thống:** tự kiểm migration đã chạy, biến môi trường Vercel, Strava secret + webhook, cặp khóa VAPID, kho ảnh, push, cron | Cần file 3400 |
| `20261001003600_club_cups.sql` | **Thách đấu CLB (nhiều CLB):** BQT CLB tạo dưới tên CLB → mở ngay; admin tạo → mở ngay; người dùng thường tạo → chờ admin duyệt (Quản trị → Thách đấu). Chỉ Chủ nhiệm / Quản trị viên của CLB mới đăng ký CLB. Tính tổng km hoặc km TB / thành viên; người ở nhiều CLB chỉ tính cho CLB vào trước; tự tất toán + báo hạng | Cần file 2600; chạy lại 3500 để trang Hệ thống nhận file này |
| `20261001003700_economy_v2.sql` | **Kinh tế v2 (Baseline v1.1):** 1 Xu = 100đ (số dư, giá đồ, thưởng treo **×10 một lần**, giữ nguyên giá trị); Xu chạy theo bậc km cộng dồn trong ngày (km 1–2: 0 · 3–10: 2/km · 11–20: 1/km, trần 20/ngày); điểm danh gắn bài chạy ≥ 1 km (+1 Xu); chuỗi tuần 2/4/8 → 10/20/50 Xu; giới thiệu chỉ trả khi bạn đã xác thực và chạy ≥ 3 km; XP chỉ từ km (10 XP/km), 8 cấp; nhiệm vụ / huy hiệu / league không còn Xu-XP; phí tạo theo quy mô (≤5 miễn phí … ≤1.000: 7.000 Xu); thử thách cá nhân không treo thưởng. Mọi con số sửa ở **Quản trị → Chính sách** | Cần file 3600 |
| `20261001003800_plans_orders.sql` | **Gói VIP1–3, CLB Pro 1/3/6/12 tháng, gói nạp Xu, đơn hàng VietQR:** người dùng tạo đơn ở **Tôi → Gói VIP & Nạp Xu** (CLB Pro: Cài đặt CLB), chuyển khoản đúng mã đơn, admin xác nhận ở **Quản trị → Đơn hàng** → tự kích hoạt gói / cộng Xu. Lượt tạo miễn phí cấp đầu mỗi tháng. **Giải chạy ảo chỉ CLB / cá nhân được cấp quyền** (Quản trị → Tổ chức giải), thu phí theo quy mô. Sau khi chạy: vào **Quản trị → Gói & giá** nhập tài khoản nhận tiền | Cần file 3700 |
| `20261001003900_gifts.sql` | **Kho quà tặng** thay "Tặng Xu": 17 quà thường 4 tầng (1 → 10.000 Xu, có Nước tăng lực, bỏ bia) + quà VIP + quà theo mùa (Tết, Trung thu). Quà **đốt Xu** người tặng, người nhận chỉ nhận quà + điểm Tỏa sáng (không chuyển Xu P2P). Tường quà trên hồ sơ. Sửa kho quà ở **Quản trị → Quà tặng** | Cần file 3800; chạy lại 3500 để trang Hệ thống nhận 3700–3900 |
| `20261001004000_vip_insights_metrics.sql` | **Quyền lợi VIP thật + chỉ số kinh tế:** trang **Tôi → Phân tích của tôi** — xu hướng 12 tuần / 12 tháng (VIP1), kỷ lục 1K → Marathon + phân bố pace (VIP2), xuất Excel (CSV) / in PDF (VIP3); **nhân bản thử thách cũ** trong trình tạo (VIP2). Máy chủ kiểm tra bậc VIP (VIP_REQUIRED). **Quản trị → Chỉ số**: Xu phát ra / đốt, doanh thu, lượt tạo, đơn hàng, duyệt bài theo tháng, so với ngưỡng. Bỏ chữ "(sắp có)" ở các quyền lợi đã làm (chỉ khi admin chưa sửa câu chữ) | Cần file 3900; chạy lại 3500 để trang Hệ thống nhận file này |
| `20261001004100_security_governance.sql` | **Bảo mật + quản trị:** khóa ghi bảng cũ, bỏ quyền của khách với hàm quản trị, cố định search_path; **admin không tự cấp** cho mình / CLB mình; lệnh lớn (≥ 5.000 Xu, vượt 20.000 Xu/ngày/admin, ≥ 10 lượt tạo, gói ≥ 3 tháng) **cần admin khác duyệt** ở Quản trị → Phê duyệt; nhật ký quản trị + sổ cái **không sửa / xóa được**; chốt thử thách **không cộng XP**; thưởng quỹ CLB tối đa 50% số dư và chỉ trao khi ≥ 3 người có kết quả. Chưa có admin thứ hai: duyệt trong SQL Editor bằng `select private.approve_as_owner('<id>');`. Đổi ngưỡng: `update private.app_settings set value = '10000' where key = 'gov_approval_xu';` | Cần file 4000; chạy lại 3500 |
| `20261001004200_form_comeback.sql` | **Nghỉ dài không hạ cấp.** Thêm **Phong độ** 28 ngày (Đang lên / Ổn định / Chậm lại / Tạm nghỉ / Nghỉ dài) trên trang chủ và hồ sơ; **Chào mừng trở lại**: bài đầu tiên sau ≥ 28 ngày nghỉ +10 Xu, tối đa 1 lần / 90 ngày (chỉnh ở Chính sách) | Cần file 4100 và bản 3700 mới nhất; chạy lại 3500 |

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

-- File 1000 phải ra 4 dòng: bottom, shoes, socks, top (mỗi ô có ≥ 6 màu đang bán)
select category, count(*) from public.avatar_items where is_active and code is not null group by 1 order by 1;
-- Số lần đã hoàn Xu cho đồ 3D ngừng bán (0 nếu chưa ai mua)
select count(*) from public.ledger_transactions where type = 'SHOP_REFUND';
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

### Sau khi chạy file 1700: bật gửi push (làm một lần)

1. Đặt `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` trên Vercel (Bước 2) rồi **deploy lại**.
2. Trong **SQL Editor** chạy (thay tên miền thật, phải là https):
   ```sql
   select private.configure_push('https://<tên-miền>/api/push/dispatch');
   ```
   Lệnh tự bật extension `pg_net` và tự sinh khóa bí mật giữa Supabase ↔ Vercel (không cần thêm biến môi trường). Nếu kết quả có chữ *"pg_net chưa bật"*: vào **Database → Extensions**, bật `pg_net`, rồi chạy lại lệnh trên.
3. Kiểm tra: mở app **bản đã deploy** → Tôi → Cài đặt → *Thông báo & ứng dụng* → bật *Thông báo trên thiết bị này* → **Gửi thử**. iPhone: phải **cài app lên màn hình chính** (Safari → Chia sẻ → Thêm vào MH chính, iOS 16.4+) và mở từ biểu tượng đó mới bật được.
4. Tắt gửi push: `select private.configure_push(null);` (thông báo vẫn vào chuông như cũ).

Thông báo trong giờ yên lặng của người nhận vẫn vào chuông, chỉ không rung máy. Thiết bị hết hạn (gỡ app, xóa dữ liệu) tự bị xóa khi gửi lỗi 404/410.

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
