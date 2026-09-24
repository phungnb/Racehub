# Benchmark: RaceHub so với các app chạy bộ hàng đầu

> Mục đích: học các mẫu đã được thị trường chứng minh, tìm khoảng trống của RaceHub cho từng module, và sắp thứ tự ưu tiên triển khai.
> Đối tượng so sánh: **Strava**, **Garmin Connect**, **Nike Run Club (NRC)**, **adidas Running**, **Runkeeper (ASICS)**, **COROS**, **UpRace** và **VnExpress Marathon Virtual** (thị trường Việt Nam), **Pacer**, **Zwift Run**, **Sweatcoin**.
> Các nhận định dưới đây dựa trên hành vi sản phẩm công khai của từng app, dùng để định hướng thiết kế, không phải thông số kỹ thuật chính thức.

## 1. Mỗi app thắng nhờ điều gì

| App | Vòng lặp cốt lõi (core loop) | Điều RaceHub nên học |
|---|---|---|
| **Strava** | Chạy → tự đồng bộ → feed + Kudos → segment/leaderboard → quay lại | Đồng bộ **tự động, không cần thao tác**; *feed tự sinh* từ bài chạy; *segment* tạo cạnh tranh địa phương; Club có leaderboard tuần |
| **Garmin Connect** | Đồng hồ → dữ liệu sâu (HR, cadence, VO2max, training load) | Dữ liệu chất lượng cao là *nền của chống gian lận*; Training Status / Body Battery tạo lý do mở app mỗi ngày |
| **Nike Run Club** | Guided Runs có HLV nói → thói quen | *Âm thanh dẫn chạy* giữ người mới; thành tích (badges) theo mốc; giao diện chạy rất tối giản |
| **adidas Running** | Thử thách theo mùa + nhóm | Thử thách *có thời hạn, có chủ đề*; hiển thị tiến độ nhóm |
| **Runkeeper** | Kế hoạch tập theo mục tiêu | *Training plan* cá nhân hóa (5K → Marathon); nhắc lịch |
| **UpRace (VN)** | Sự kiện chạy ảo gây quỹ, đội và công ty | **Mô hình Việt Nam đã chứng minh**: đồng bộ Strava/Garmin, chạy theo *đội/công ty*, luật hợp lệ rõ (pace 4:00–15:00, ≥ 1 km, GPS bắt buộc), BXH đội thời gian thực |
| **Pacer / Sweatcoin** | Bước chân → điểm → đổi quà | Kinh tế điểm thưởng + chợ đổi quà; **giới hạn thưởng mỗi ngày** để chống farm |
| **Zwift Run** | Game hóa, avatar, cấp độ, đồ trang bị | Avatar và vật phẩm mở khóa theo cấp; cảm giác "đi đâu cũng thấy tiến bộ" |
| **Duolingo** *(ngoài ngành)* | Streak + league tuần + nhiệm vụ | **Streak** là lý do quay lại số 1; **league 30 người** cùng trình độ tạo cạnh tranh công bằng; khiên bảo vệ streak |
| **Zalo / Band** *(nhóm)* | Chat nhóm + bài đăng + bình chọn | Đây là nơi các CLB **đang sống**. Muốn thay được thì phải có: chat realtime, ghim thông báo, nhắc tên, bình chọn, album |
| **Spond / Heja** *(quản lý đội thể thao)* | Lịch sự kiện + RSVP + thu phí | Lịch buổi tập có RSVP và nhắc tự động; **thu phí thành viên, theo dõi ai chưa đóng**; vai trò quản trị |

**Kết luận chiến lược:** RaceHub = **game hóa** (Zwift + Duolingo) × **thử thách cá nhân và đồng đội** (UpRace + adidas) × **CLB thay nhóm Zalo** (Zalo + Spond + Strava Clubs). Không app nào ở trên có đủ cả ba. Strava Clubs chỉ có BXH và feed, không có chat, lịch và quỹ. Zalo có chat nhưng không biết ai đã chạy. UpRace có đội nhưng không có đời sống nhóm giữa các giải. Chi tiết ở [Định hướng sản phẩm](../DINH_HUONG_SAN_PHAM.md). Nền móng chung vẫn là **dữ liệu chạy tự động, đáng tin cậy.**

## 2. So sánh theo module và khoảng trống của RaceHub

Ký hiệu: ✅ đã có · 🟡 có một phần · ❌ chưa có.

| Module | Chuẩn thị trường (best practice) | RaceHub hiện tại | Khoảng trống cần lấp |
|---|---|---|---|
| **Đồng bộ thiết bị** | Strava/UpRace: webhook tự đẩy, đồng bộ trong vài giây; backfill khi mới kết nối; xử lý sửa/xóa | 🟡 OAuth an toàn, **chưa kéo bài chạy nào** | Webhook + nút "Đồng bộ ngay" + backfill 30 ngày + refresh token + xử lý xóa/deauthorize → **Sprint 1** |
| **Xác thực bài chạy** | UpRace: pace 4:00–15:00, GPS bắt buộc, không nhận "manual"; Strava: gắn cờ tốc độ bất thường | 🟡 Có luật cho GPS trong app | Áp luật cho bài từ Strava: loại *manual*, *không phải chạy bộ*, vận tốc tối đa bất thường, thiếu GPS → chờ duyệt → **Sprint 1** |
| **Ghi GPS trong app** | NRC/Strava: chạy nền, khóa màn hình, voice mỗi km, auto-pause | 🟡 Web GPS (dừng khi tắt màn hình) | App native (Expo) → Giai đoạn 3 (ADR-009) |
| **Feed xã hội** | Strava: feed tự sinh + Kudos + comment; ưu tiên bạn bè | ❌ | Bảng `feed_items` sinh từ bài chạy, PB, lên cấp; Like/Cheer → **Sprint 3** |
| **Thử thách** | adidas/UpRace: theo mùa, đội, BXH real-time, huy chương | 🟡 Tạo được, tiến độ cộng dồn km, **chưa có mô hình đội** | Engine tiến độ, đội, chi tiết, BXH, tham gia/rời, tất toán → **Sprint 3** |
| **Bảng xếp hạng** | Strava Club weekly, UpRace đội | ❌ | View BXH tuần/tháng (cá nhân, CLB, khu vực) → **Sprint 2** |
| **Cấp độ & thành tích** | NRC badges; Zwift mở khóa đồ; Duolingo streak, league | 🟡 Cấp độ đúng tài liệu | Huy hiệu tự trao, PB, streak tuần, nhiệm vụ, league tuần → **Sprint 4**; mùa giải → Sprint 6 |
| **Kinh tế Xu** | Sweatcoin: trần ngày, chợ đổi quà | ✅ Sổ cái, trần ngày | Nhiệm vụ ngày/tuần, lịch sử ví (MH 25) → **Sprint 3** |
| **CLB** | Strava Club (BXH, feed) + Zalo (chat) + Spond (lịch, RSVP, thu phí) | 🟡 Vai trò, quyền, quỹ Xu, thông báo đơn giản | Không gian CLB, bảng tin, chat realtime, BXH tuần → **Sprint 2**; lịch, điểm danh, thu phí, bình chọn → **Sprint 5** (ADR-012) |
| **Training plan** | Runkeeper/NRC: kế hoạch + nhắc | ❌ | Giai đoạn 4 (Premium) |
| **Thông báo** | Mọi app: push khi được kudos, sắp hết thử thách | ❌ | Bảng `notifications` + Web Push → **Sprint 3** |
| **Quyền riêng tư** | Strava: ẩn 200 m đầu/cuối, chế độ riêng tư | 🟡 Có cài đặt hiển thị | Cắt điểm đầu/cuối khi hiển thị bản đồ → Sprint 3 |

## 3. Nguyên tắc thiết kế rút ra (áp dụng cho mọi module)

1. **Không bắt người dùng thao tác để có dữ liệu.** Đồng bộ tự động là mặc định, nút "Đồng bộ ngay" chỉ là phương án dự phòng (Strava, UpRace).
2. **Luật hợp lệ công khai và nhất quán.** Hiển thị lý do khi bài bị chờ duyệt (UpRace hiển thị rõ "pace không hợp lệ").
3. **Mỗi bài chạy phải "được thấy".** Tự sinh bài đăng feed, cập nhật BXH và thử thách ngay (Strava).
4. **Thưởng có trần, có nguồn gốc.** Thưởng theo ngày có giới hạn, mọi Xu có bút toán (Sweatcoin + sổ cái đã làm).
5. **Người mới phải thắng sớm.** Huy hiệu km đầu tiên, thử thách hệ thống dễ (NRC).
6. **Idempotent ở mọi điểm tích hợp.** Webhook có thể gửi trùng hoặc gửi lại; khóa `(source, source_activity_id)` là duy nhất.

## 4. Lộ trình

Lộ trình chính thức theo ba trụ cột nằm ở [Định hướng sản phẩm §8](../DINH_HUONG_SAN_PHAM.md#8-lộ-trình-theo-trụ-cột): Sprint 2 CLB → Sprint 3 Thử thách → Sprint 4 Game hóa → Sprint 5 CLB nâng cao + PWA.
