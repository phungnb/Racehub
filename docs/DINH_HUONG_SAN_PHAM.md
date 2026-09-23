# Định hướng hoàn thiện RaceHub

> Tài liệu này là **chuẩn chung** cho mọi quyết định về sản phẩm, thiết kế và kỹ thuật. Một tính năng chỉ được coi là "xong" khi đạt chuẩn ở §3 và §6.
> Tài liệu liên quan: [benchmark](./architecture/benchmark.md) · [kiến trúc](./architecture/README.md) · [frontend](./architecture/frontend.md) · [bảo mật](./BAO_CAO_BAO_MAT.md)

## 1. Định vị và thước đo thành công

**RaceHub = nơi runner Việt Nam biến mỗi km chạy thành thành tích, thử thách và phần thưởng cùng bạn bè và CLB.**

| | |
|---|---|
| **Chỉ số chính (North Star)** | Số **buổi chạy hợp lệ mỗi tuần** trên mỗi người dùng hoạt động |
| **Chỉ số hỗ trợ** | Tỷ lệ kết nối Strava trong 24 giờ đầu · % người tham gia ≥ 1 thử thách/tháng · tỷ lệ quay lại D7 / D30 · số Cheer mỗi bài chạy |
| **Chỉ số không được xấu đi (guardrail)** | Tỷ lệ bài bị gắn cờ gian lận · khiếu nại về Xu · crash-free sessions ≥ 99,5% |

Mọi tính năng trong lộ trình phải trả lời được câu hỏi: *nó làm tăng số buổi chạy hợp lệ mỗi tuần như thế nào?*

## 2. Năm nguyên tắc trải nghiệm

1. **Không thao tác thì vẫn có dữ liệu.** Bài chạy từ đồng hồ tự về, feed tự sinh, thử thách tự cập nhật.
2. **Mỗi km đều được ghi nhận ngay.** Sau khi chạy xong, người dùng thấy ngay Xu, XP, thứ hạng và tiến độ thử thách thay đổi.
3. **Minh bạch.** Bài bị chờ duyệt luôn có lý do; mọi Xu đều có lịch sử; luật thử thách hiển thị rõ trước khi tham gia.
4. **Người mới phải thắng sớm.** Trong tuần đầu: huy hiệu km đầu tiên, thử thách dễ, lời chào từ CLB.
5. **Xã hội trước, cạnh tranh sau.** Cổ vũ và CLB giữ chân người dùng lâu hơn bảng xếp hạng.

## 3. Chuẩn "đẹp và sắc nét" (bắt buộc cho mọi màn hình)

| Hạng mục | Chuẩn | Kiểm tra |
|---|---|---|
| **Chữ** | Be Vietnam Pro; số liệu dùng JetBrains Mono + `tabular`; **cỡ tối thiểu 12px**; tiêu đề màn hình 24px bold | Không có `text-[9px]`, `text-[10px]` |
| **Icon** | Chỉ dùng `lucide-react`, nét đồng nhất. **Không dùng emoji làm icon giao diện** (emoji chỉ được xuất hiện trong nội dung người dùng) | Tìm emoji trong `features/**/components` |
| **Màu** | Chỉ dùng token (`bg-surface`, `text-brand`, `text-coin`…). Xanh neon = hành động chính; cam = Xu; xanh tím = XP; đỏ = nguy hiểm | Không có mã màu cứng, không `slate-*` / `orange-*` |
| **Khoảng cách** | Bội số của 4px; lề màn hình 16px; khoảng cách giữa các khối 16–24px | |
| **Vùng chạm** | ≥ 44×44px; hành động phá hủy (dừng chạy, xóa, trừ Xu) phải **giữ** hoặc **xác nhận** | |
| **Trạng thái** | Mỗi màn hình có đủ 4 trạng thái: *đang tải* (skeleton), *trống* (hướng dẫn + nút hành động), *lỗi* (nút thử lại), *có dữ liệu* | |
| **Phản hồi** | Toast cho kết quả thao tác; không dùng `alert()`; nút có trạng thái `loading` | Không có `alert(` |
| **Ngôn ngữ** | Tiếng Việt tự nhiên, ngắn gọn, xưng "bạn"; **không hiện mã lỗi thô** (dùng `shared/lib/errors.ts`) | |
| **Chuyển động** | 150–250ms, ease-out; tôn trọng `prefers-reduced-motion` | |
| **Truy cập** | Tương phản ≥ 4.5:1; có `aria-label` cho nút chỉ có icon; điều khiển được bằng bàn phím | |

## 4. Hiện trạng 28 màn hình

✅ đạt chuẩn · 🟡 chạy được nhưng giao diện cũ · ❌ chưa có

| Cụm | Màn hình | Trạng thái | Sprint |
|---|---|---|---|
| Onboarding | MH1 Đăng nhập | 🟡 | 4 |
| | MH2 Kết nối thiết bị | ✅ (trong trang Hồ sơ) | — |
| | MH3 Tạo nhân vật · MH4 Chào mừng | 🟡 · ❌ | 4 |
| Feed | MH5 Trang chủ | ✅ phần cá nhân · ❌ bảng tin xã hội | 3 |
| | MH6 Chi tiết bài chạy (bản đồ, splits) | ❌ | 3 |
| | MH7 Thông báo · MH8 Tìm kiếm · MH9 BXH tổng | ❌ · 🟡 · ❌ | 3 · 3 · 2 |
| Thử thách | MH10 Danh sách | ✅ | — |
| | MH11 Chi tiết · MH12 BXH thử thách | ❌ | **2** |
| | MH13 Tạo thử thách | 🟡 | **2** |
| | MH14 Xác nhận cược | ❌ | 5 (sau tư vấn pháp lý, ADR-011) |
| Chạy | MH15 Đang chạy · MH16 Xác thực · MH17 Tổng kết | ✅ | — |
| | MH18 Poster chia sẻ | ❌ | 3 |
| Hub | MH19 Cửa hàng · MH20 BIB · MH23 HLV | ❌ | 6 |
| | MH21 Quỹ CLB · MH22 Quản lý CLB | 🟡 | **2** |
| Hồ sơ | MH24 Hồ sơ | ✅ | — |
| | MH25 Ví Xu | ❌ | 3 |
| | MH26 Tủ đồ | 🟡 | 4 |
| | MH27 Nhật ký tập | 🟡 (danh sách bài chạy) | 3 |
| | MH28 Cài đặt | ✅ bản cơ bản | — |

**Đã xong: 9/28 · Chạy được, cần làm lại: 9/28 · Chưa có: 10/28.**

## 5. Lộ trình

Mỗi sprint kéo dài 2 tuần và kết thúc bằng một bản **deploy lên production**, có checklist kiểm tra.

| Sprint | Mục tiêu (chỉ số) | Nội dung |
|---|---|---|
| **0–1 ✅** | Nền móng an toàn | Vá bảo mật, sổ cái, đồng bộ Strava, khung giao diện mới, màn Chạy / Thử thách / Hồ sơ |
| **2** | % người tham gia thử thách | **Chi tiết thử thách** (luật, tiến độ của tôi, nút Tham gia/Rời), **BXH real-time**, làm lại **wizard tạo thử thách** (4 bước theo MH13), **CLB** (trang CLB, BXH tuần, quỹ theo sổ cái), BXH tổng tuần/tháng |
| **3** | Tỷ lệ quay lại D7 | **Feed tự sinh** (bài chạy, PB, lên cấp) + **Like / Cheer**, **chi tiết bài chạy** có bản đồ và splits, **huy hiệu** và **PB** 5K/10K/HM/FM, **ví Xu** (lịch sử sổ cái), **nhiệm vụ ngày**, **thông báo** trong app, **poster chia sẻ** |
| **4** | Tỷ lệ kết nối Strava trong 24 giờ | **Onboarding 3 bước** (MH1–4: đăng nhập Google/Apple, kết nối Strava, tạo nhân vật), **PWA** (cài lên màn hình chính, Web Push), tủ đồ và cửa hàng vật phẩm |
| **5** | Buổi chạy / tuần | **App Expo** cho màn Chạy (GPS chạy nền, giọng HLV, nhận Cheer khi đang chạy), Garmin/COROS kết nối trực tiếp, thử thách 1-1 và đội có cược (sau khi có ý kiến pháp lý) |
| **6** | Doanh thu | Dashboard ban tổ chức (giải ảo, xuất CSV), thanh toán, marketplace voucher, training plan Premium |

## 6. "Định nghĩa hoàn thành" cho mỗi tính năng

- [ ] Đạt 100% chuẩn ở §3; chụp màn hình ở 390px (mobile) và 1280px (desktop)
- [ ] Mọi thay đổi DB là migration, có test trong `tests/db/` (quyền truy cập + nghiệp vụ)
- [ ] Logic thuần có unit test; lint, typecheck, test, build đều xanh trên CI
- [ ] Không có đường ghi tài sản (Xu, XP, tiến độ) từ client (ADR-003)
- [ ] Có sự kiện analytics cho các bước chính của tính năng
- [ ] Hướng dẫn triển khai được cập nhật nếu cần biến môi trường hoặc migration mới

## 7. Việc cần làm ngay về hạ tầng

1. **Merge nhánh hiện tại vào `main` và deploy lên Vercel** với domain chính thức. Webhook Strava cần địa chỉ công khai; Codespaces chỉ phù hợp để phát triển.
2. **Tạo 2 project Supabase:** *staging* (thử migration) và *production*. Không chạy thử migration trực tiếp trên production nữa.
3. **Gắn Sentry** (theo dõi lỗi) và **PostHog** (đo các chỉ số ở §1) trước khi có người dùng thật.
4. **Tạo lại Strava Client Secret** (đã bị lộ trong ảnh chụp màn hình).
