# Runner Nearby — Nghiên cứu & thiết kế (đề xuất V1)

> Trạng thái: **nghiên cứu, chờ chốt quyết định** (mục 10). Chưa có code / migration.
> Mục tiêu: tìm **người phù hợp để chạy cùng** (không chỉ người ở gần), kết nối an toàn, dẫn tới **buổi chạy thật** và **CLB**.

---

## 1. Đánh giá nhanh đề xuất

Đề xuất gốc đúng hướng ở 3 điểm quan trọng: mặc định tắt, chỉ hiện khoảng cách tương đối, xếp theo độ phù hợp thay vì độ gần. Cần bổ sung / sửa:

| # | Vấn đề | Vì sao | Đề xuất |
|---|---|---|---|
| 1 | "Cách bạn 2,1 km" là **quá chính xác** | Kẻ xấu đổi vị trí của mình vài lần rồi **dò tam giác** ra chỗ ở (đã xảy ra với Tinder, Grindr, Bumble). Khoảng cách 1 chữ số thập phân đủ để dò | Chỉ hiện **bậc**: "dưới 2 km", "2–5 km", "5–10 km", "10–20 km". Tính trên **ô lưới ~1 km**, không trên toạ độ thật |
| 2 | Chưa có giới hạn đổi vị trí tìm kiếm | Dò tam giác cần tìm từ nhiều điểm | Vị trí tìm = vị trí mình đang công bố (không cho tìm từ điểm tuỳ ý); đổi tối đa **3 lần / 24 giờ**, nhảy > 50 km bị chặn tạm |
| 3 | "Đang tìm bạn chạy" + ảnh + tên thật hiện cho người lạ | Nguy cơ quấy rối, nhất là runner nữ chạy sáng sớm | Chế độ **ai thấy tôi**: mọi người đã xác minh / chỉ cùng giới / chỉ thành viên CLB. Mặc định hiện **tên gọi + chữ cái đầu họ**, ảnh nhân vật 2D thay ảnh thật |
| 4 | Nhắn tin ngay sau "Kết nối" | Tin nhắn riêng là kênh quấy rối chính, cần kiểm duyệt | V1 **chưa có nhắn tin riêng**: kết nối xong thì *Rủ chạy* (lời mời vào buổi chạy / CLB). Nhắn tin riêng để V1.1 khi có chặn + báo cáo + giới hạn |
| 5 | Tách bảng `running_meetups` mới | RaceHub **đã có** `club_events` (điểm hẹn lat/lng, sức chứa, RSVP, điểm danh QR) | CLB đăng buổi chạy công khai = `club_events` thêm `visibility = PUBLIC`. Buổi chạy cá nhân để V1.1 (dùng chung giao diện RSVP) |
| 6 | Bảng `runner_connections` "bạn bè / theo dõi" gộp chung | Theo dõi 1 chiều + tìm quanh đây = dễ bị bám theo | V1 chỉ **kết nối 2 chiều** (phải chấp nhận). Theo dõi 1 chiều chỉ cho hồ sơ công khai, không kèm vị trí |
| 7 | Chưa tính người dưới 18 tuổi | Luật yêu cầu đồng ý của người giám hộ; rủi ro an toàn trẻ em | **Không cho bật** Runner Nearby nếu dưới 18 (hoặc chưa khai năm sinh) |
| 8 | Chưa có "vị trí cho CLB / HLV" | CLB, Shop, HLV **nên** hiện địa điểm (là tổ chức, không phải cá nhân) | Thêm khu vực + điểm tập công khai cho CLB; Market đã có `area`, `address` → thêm toạ độ tuỳ chọn |
| 9 | Ít người dùng lúc đầu → danh sách trống | Chợ 2 phía: không ai thì không ai bật | Khi ít người: tự nới bán kính, chuyển sang gợi ý **CLB & buổi chạy gần bạn** (luôn có dữ liệu), đếm "X runner đã bật quanh khu vực" để khuyến khích |

---

## 2. Pháp lý (Việt Nam) — phải làm đúng từ đầu

- **Nghị định 13/2023/NĐ-CP** và **Luật Bảo vệ dữ liệu cá nhân (hiệu lực 01/01/2026)**: dữ liệu vị trí cá nhân qua định vị là **dữ liệu cá nhân nhạy cảm** → cần:
  1. **Đồng ý rõ ràng, riêng cho mục đích này** (không gộp vào điều khoản chung), rút lại được bất kỳ lúc nào.
  2. Thông báo rõ: thu gì (ô lưới ~1 km, không phải toạ độ), để làm gì, lưu bao lâu, ai thấy.
  3. **Hồ sơ đánh giá tác động xử lý dữ liệu cá nhân** (lập và lưu; gửi cơ quan chuyên trách theo quy định).
  4. Xoá khi người dùng tắt tính năng / xoá tài khoản; có nhật ký.
  5. Trẻ em: cần đồng ý của cha mẹ → RaceHub chọn **chặn dưới 18 tuổi**.
- Cập nhật trang **Chính sách quyền riêng tư** (đã có `/privacy`) với mục "Runner Nearby".
- ⚠️ Nên nhờ luật sư rà lại trước khi phát hành (quy định mới, còn văn bản hướng dẫn).

## 3. Bài học từ sản phẩm khác

| Sản phẩm | Chuyện đã xảy ra | Bài học cho RaceHub |
|---|---|---|
| Strava Heatmap (2018) | Bản đồ nhiệt lộ vị trí căn cứ quân sự | Không dựng bản đồ nhiệt / tuyến từ hoạt động cho Nearby |
| Strava "Flyby" | Lộ người chạy gần nhau theo thời gian thực → phải chuyển sang mặc định tắt | Không có "đang chạy gần bạn" thời gian thực ở V1 |
| Tinder / Grindr / Bumble | Dò tam giác từ khoảng cách hiển thị | Bậc khoảng cách + ô lưới + giới hạn đổi vị trí |
| Meetup, Nike Run Club events | Buổi chạy nhóm ở nơi công cộng giữ chân người dùng tốt nhất | Đích đến của Nearby là **buổi chạy**, không phải chat |

---

## 4. Trải nghiệm (V1)

**Lối vào:** tab *Khám phá* (hoặc thẻ trên Trang chủ "Runner & buổi chạy gần bạn") → màn **Quanh đây** gồm 3 thẻ:

1. **Runner** — danh sách người phù hợp (không bản đồ). Mỗi thẻ:
   nhân vật 2D · tên gọi + chữ cái đầu họ · **bậc khoảng cách** · pace điển hình (bậc) · mục tiêu (5K/10K/HM/FM) · khung giờ hay chạy · CLB chung · lý do gợi ý ("Cùng pace 5:30–6:30, cùng chạy sáng sớm") · nút **Kết nối**.
2. **Buổi chạy** — buổi chạy công khai của CLB trong bán kính, sắp tới 14 ngày (điểm hẹn công khai, còn chỗ) → **Đăng ký**.
3. **CLB** — CLB có khu vực / điểm tập gần bạn → **Xin tham gia**.

**Bộ lọc:** bán kính 2 / 5 / 10 / 20 km · pace (< 5:30, 5:30–7:00, > 7:00, chưa có dữ liệu) · mục đích (bạn chạy cùng / CLB / HLV–nhóm tập) · mục tiêu · khung giờ (sáng sớm / trưa / tối / cuối tuần).

**Bật tính năng (luồng đồng ý, 3 bước):**
1. Giải thích ngắn + hình minh hoạ "RaceHub chỉ lưu ô ~1 km, người khác chỉ thấy *2–5 km*".
2. Chọn: ai thấy tôi (đã xác minh / cùng giới / chỉ CLB), mục đích, mục tiêu, khung giờ, có chia sẻ pace hay không.
3. Chọn cách lấy vị trí: **dùng vị trí điện thoại một lần** (gần đúng) **hoặc chọn khu vực trên bản đồ** (quận / phường). Thời hạn hiển thị: 24 giờ / 7 ngày / 30 ngày → hết hạn tự ẩn, nhắc gia hạn.

**Điều kiện được bật:** ≥ 18 tuổi · email / điện thoại đã xác minh · ≥ 3 bài chạy hợp lệ (chống tài khoản ảo) · không bị khoá.

**Kết nối:** gửi lời mời (kèm lời nhắn mẫu, tối đa 140 ký tự, không link) → người kia *Chấp nhận / Bỏ qua / Chặn*. Chấp nhận → thấy hồ sơ đầy đủ hơn, **Rủ chạy** (mời vào buổi chạy / CLB), nhận thông báo khi người kia đăng buổi chạy. Giới hạn **15 lời mời / ngày**, bị bỏ qua thì 30 ngày không gửi lại.

**An toàn:** chặn (ẩn hai chiều ngay, huỷ kết nối, huỷ lời mời) · báo cáo (lý do + ghi chú) → 3 báo cáo độc lập tự ẩn khỏi Nearby chờ admin · tắt nhanh "Ẩn tôi ngay" ở mọi màn · mẹo an toàn khi đi chạy với người mới (điểm hẹn công khai, báo người thân).

---

## 5. Thuật toán gợi ý "người phù hợp"

Chỉ xét người **cùng bậc bán kính đã chọn**, đã bật, chưa chặn nhau, thoả điều kiện "ai thấy tôi" của **cả hai phía**. Điểm 0–100:

| Thành phần | Trọng số | Cách tính |
|---|---|---|
| Pace | 30 | Pace trung vị 28 ngày từ bài chạy hợp lệ (chỉ khi đồng ý chia sẻ). Chênh ≤ 20 s/km = đủ điểm, ≥ 90 s/km = 0 |
| Khung giờ | 20 | Trùng khung giờ tự khai (V1); V1.1 thêm khung giờ thường chạy suy ra từ hoạt động (nếu đồng ý) |
| Mục tiêu | 15 | Cùng cự ly mục tiêu; cùng giải sắp tới (từ đăng ký giải chạy ảo) cộng thêm |
| Mục đích | 10 | Cả hai đều "tìm bạn chạy cùng" |
| Cộng đồng | 15 | Cùng CLB / có kết nối chung / cùng thử thách đang tham gia |
| Khoảng cách | 10 | Theo bậc (dưới 2 km = 10 … 10–20 km = 2) — **không** xếp tuyệt đối theo độ gần |

Thêm độ ngẫu nhiên nhỏ theo ngày để danh sách không cố định (tránh một người luôn đứng đầu bị làm phiền). Trả tối đa 30 người / lần, phân trang.

---

## 6. Kiến trúc bảo vệ vị trí

- **Không PostGIS ở V1** (giữ migration chạy được trong SQL Editor). Vị trí làm tròn về **ô lưới ~1 km**: `cell_lat = round(lat * 100) / 100` (≈ 1,1 km), `cell_lng` tương tự. **Không bao giờ lưu toạ độ gốc.**
- Tìm kiếm: lọc thô bằng hộp bao (chỉ mục trên `cell_lat, cell_lng`) → khoảng cách haversine giữa **tâm ô** → quy về bậc. Đủ nhanh tới ~100 nghìn người đang bật; khi lớn hơn mới bật PostGIS.
- Mọi đọc / ghi qua RPC `security definer`; bảng vị trí **không có quyền select** cho client (RLS chặn toàn bộ). RPC chỉ trả bậc khoảng cách, không trả ô.
- Hết hạn: cron xoá dòng `expires_at < now()` mỗi giờ; tắt tính năng = xoá ngay.
- Chống dò: tìm kiếm luôn lấy vị trí đã lưu của chính mình; đổi vị trí ≤ 3 lần / 24 giờ; giới hạn 60 lượt tìm / giờ; ghi nhật ký tìm kiếm 7 ngày để phát hiện hành vi bất thường.
- **Không** suy vị trí từ GPS bài chạy cũ; **không** hiện "đang chạy gần bạn".

## 7. Dữ liệu (Supabase)

| Bảng | Nội dung chính | Ghi chú |
|---|---|---|
| `runner_discovery_settings` | user_id, enabled, visible_to (VERIFIED / SAME_GENDER / CLUBS), purposes[], goals[], time_slots[], share_pace, radius_km, consent_at, consent_version | Không ai đọc trực tiếp; RPC `my_discovery` / `set_discovery` |
| `runner_location_presence` | user_id, cell_lat, cell_lng, source (DEVICE / AREA), area_label, updated_at, expires_at, moves_24h | Không toạ độ gốc; xoá khi hết hạn / tắt |
| `runner_connection_requests` | from, to, message, status (PENDING / ACCEPTED / DECLINED / CANCELLED), created_at | Unique (from, to) đang chờ; giới hạn / ngày |
| `runner_connections` | user_a < user_b, created_at | Hai chiều |
| `user_blocks` | blocker, blocked, created_at | Dùng chung toàn app (chat CLB, bình luận, Nearby) |
| `user_reports` | reporter, target_user, context (NEARBY / CHAT / POST…), reason, note, status | Vào **Việc cần xử lý** của Quản trị |
| `club_events` (có sẵn) | + `visibility` (CLUB / PUBLIC) | Buổi chạy công khai của CLB |
| `clubs` (có sẵn) | + `area_label`, `cell_lat`, `cell_lng` (điểm tập công khai) | Tìm CLB gần |
| `partners` (có sẵn) | + `cell_lat`, `cell_lng` (tuỳ chọn) | HLV / Shop gần bạn |

RPC chính: `set_discovery(p)`, `set_presence(lat, lng | area)`, `nearby_runners(filters)`, `nearby_events(radius)`, `nearby_clubs(radius)`, `send_connection(to, msg)`, `respond_connection(id, action)`, `block_user(id)`, `report_user(id, reason, note)`, `admin_reports(...)`.

## 8. Kết nối với các module có sẵn

| Module | Kết nối |
|---|---|
| Trang chủ | Thẻ "Quanh đây": 3 runner phù hợp + buổi chạy gần nhất (chỉ khi đã bật) |
| CLB | CLB khai khu vực / điểm tập; sự kiện công khai hiện ở Nearby; nút "Xin tham gia" |
| Thử thách | "Rủ kết nối cùng tham gia" thử thách / giải chạy ảo |
| Chợ Runner | Lọc HLV / nhóm tập / shop / phục hồi theo khu vực (đã có `area`) |
| Hồ sơ | Cài đặt hiển thị, pace, mục tiêu, khung giờ; danh sách kết nối, đã chặn |
| Thông báo | Lời mời kết nối, được chấp nhận, kết nối đăng buổi chạy |
| Game | Nhiệm vụ "Chạy cùng bạn mới" (điểm danh QR buổi chạy) — thưởng Xu nhỏ, **không** thưởng cho việc kết nối (chống spam) |
| Quản trị | Hàng đợi báo cáo, xem lịch sử tìm kiếm bất thường, khoá tính năng với tài khoản vi phạm |

## 9. Lộ trình đề xuất

| Giai đoạn | Nội dung | Ước lượng |
|---|---|---|
| **V1** | Đồng ý + cài đặt, vị trí ô lưới có hạn, danh sách runner phù hợp (bậc khoảng cách), kết nối 2 chiều, chặn / báo cáo (dùng chung), buổi chạy công khai của CLB, CLB gần bạn, thẻ Trang chủ, hàng đợi báo cáo Quản trị, cập nhật Chính sách quyền riêng tư | 2 đợt |
| V1.1 | Nhắn tin riêng giữa người đã kết nối (giới hạn, chặn, báo cáo), buổi chạy cá nhân (tối đa 10 người, điểm hẹn công khai), khung giờ suy từ hoạt động | 1–2 đợt |
| V2 | Chợ Runner theo bản đồ, ghép nhóm tự động theo pace cho buổi chạy CLB, gợi ý giáo án theo mục tiêu (khi có Knowledge) | sau |

**Thước đo:** % người dùng bật (mục tiêu 15–25 % người hoạt động) · tỉ lệ lời mời được chấp nhận (> 35 %) · số người điểm danh buổi chạy qua Nearby / tuần · báo cáo trên 1.000 lời mời (< 3) · giữ chân D30 của người đã kết nối so với chưa.

---

## 10. Đã chốt & đã làm (V1 — migration 006100)

| Câu hỏi | Quyết định | Cách làm |
|---|---|---|
| Phạm vi V1 | Không nhắn tin riêng; *Rủ chạy* + buổi chạy CLB | `invite_to_run` gửi thông báo kèm link buổi chạy công khai / sự kiện CLB / CLB |
| Ai thấy tôi (mặc định) | **Runner đã xác minh** | `visible_to` = VERIFIED / SAME_GENDER / CLUBS; kiểm tra **cả hai chiều** (`private.nearby_visible`) |
| Điều kiện bật | **≥ 3 bài chạy hợp lệ** (không yêu cầu 18+) | `private.nearby_eligible`: 3 bài APPROVED, tài khoản không bị khoá |
| Nguồn vị trí | **Cả hai**: vị trí điện thoại một lần (độ chính xác thấp) + chạm trên bản đồ | Máy chủ làm tròn về ô ~1 km (`round(x, 2)`), hết hạn 24 giờ / 7 / 30 ngày, đổi ≤ 3 lần / 24 giờ |
| Khoảng cách | **Hiện km cụ thể**, có chống dò | Km nguyên giữa tâm 2 ô + nhiễu cố định ±0,5 km theo từng cặp người (`private.shown_km`) → gọi lại nhiều lần vẫn ra cùng số, không tam giác hoá được; tìm ≤ 60 lần / giờ |

**Màn hình:** `/nearby` (bật 3 bước: cam kết + đồng ý → tuỳ chọn → khu vực; tab Runner / Buổi chạy / CLB; lọc bán kính, pace, mục đích, mục tiêu, khung giờ; "Ẩn tôi ngay"; cài đặt / tắt),
`/nearby/connections` (lời mời đến, bạn chạy, đã gửi, đã chặn), `/nearby/events/[id]` (buổi chạy công khai cho người ngoài CLB).
**CLB:** Cài đặt CLB → *Khu vực hoạt động*; form sự kiện → *Ai thấy buổi chạy: Chỉ thành viên / Công khai* (cần toạ độ).
**Quản trị:** Người dùng → *Báo cáo* (không vi phạm / khoá Quanh đây); 3 người báo cáo → tự tạm ẩn. Nhật ký: `USER_REPORT_*`.
**Pháp lý:** Chính sách quyền riêng tư mục 4b.
