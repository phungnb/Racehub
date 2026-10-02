# Thể lệ thi đấu CLB (migration 012700)

Áp dụng chung cho **trận 1–1 ("Đấu CLB")** và **thách đấu nhiều CLB**. Trận 1–1 nay là một thách đấu có đúng 2 CLB, nên dùng cùng luật, cùng cách đăng ký và cùng bảng điểm.

## 1. Quy trình

| Bước | Ai | Làm gì | Ở đâu trên app |
|---|---|---|---|
| 1. Thách đấu | Chủ nhiệm / Quản trị viên CLB A | Chọn đối thủ, đặt luật, gửi lời nhắn | CLB → BXH → **Đấu CLB** → "Thách đấu CLB khác" |
| 2. Trả lời | Chủ nhiệm / Quản trị viên CLB B | **Nhận lời** / **Từ chối** (kèm lý do) / **Đề xuất lại** điều khoản; tối đa 6 phiên bản | Thông báo → trang trận |
| 3. Đăng ký | Thành viên hai CLB | Bấm **"Đăng ký thi đấu"** trước giờ chốt danh sách | Thông báo · dải nhắc đầu trang CLB · thẻ "Đấu CLB của bạn" ở trang chủ · trang trận |
| 4. Thi đấu | VĐV đã đăng ký | Chạy bằng GPS trong app hoặc đồng bộ Strava | Bảng điểm làm mới 20 giây/lần khi đang đấu |
| 5. Kết quả tạm | Hệ thống | Hết giờ → công bố kết quả tạm, báo ban quản trị số bài đang chờ duyệt | Trang trận |
| 6. Chính thức | Hệ thống | 48 giờ sau → chốt, trao huy hiệu, cộng điểm uy tín | Thông báo cho mọi thành viên |

Lời mời 1–1 không được trả lời trước giờ chốt danh sách thì **hết hạn**. Đã nhận lời thì điều khoản bị khóa.

## 2. Luật người tạo chọn

| Mục | Lựa chọn | Mặc định |
|---|---|---|
| Đo bằng | Km · Thời gian chạy · Pace đội (thấp thắng) | Km |
| Hình thức | Tổng cả đội · Trung bình mỗi VĐV đăng ký · Cộng top X VĐV | Trung bình |
| Thời gian | Bắt đầu bất kỳ; 1 ngày – 2 tháng (1–1), – 3 tháng (nhiều CLB) | 00:00 ngày mai, 7 ngày |
| Chốt danh sách | Đúng giờ G / trước 1 · 6 · 24 giờ | 1 giờ |
| VĐV mỗi CLB | Tối thiểu 1–100, tối đa tùy chọn | Tối thiểu 3 |
| Thiếu VĐV lúc chốt | Xử thua / Hủy trận (1–1); nhiều CLB: xử thua | Xử thua |
| Trần mỗi người mỗi ngày | 21 · 42 · 60 km / không | 42 km |
| Trần đóng góp | 30 · 40 · 50% tổng đội / không | Không |
| Pace: km tối thiểu mỗi người | 3 · 5 · 10 · 21 km | 5 km |
| Khi bằng điểm | Nhiều người chạy hơn · Nhiều ngày chạy hơn · Hòa | Nhiều người chạy |

## 3. Luật cố định (công bằng, chống gian lận)

- **Mỗi người một CLB** trong một trận. Người ở cả hai CLB phải chọn một.
- **Chống "chiêu mộ"**: chỉ người đã vào CLB **trước khi trận được tạo** mới được đăng ký (trận 1–1). Với thách đấu nhiều CLB là trước khi CLB vào giải.
- Sau giờ chốt danh sách **không đăng ký và không rút** được nữa.
- Chỉ tính bài **hợp lệ** (đã qua bộ chống gian lận, xem `docs/CHONG_GIAN_LAN.md`), **bắt đầu trong giờ thi đấu**, **được chia sẻ** (bài Strava cần bật "Hiện bài Strava"; trang trận nhắc và có nút bật ngay).
- **Trần mỗi ngày** giảm thiệt hại nếu một bài gian lận lọt qua, và không để một người "gánh" cả đội. Với thời gian chạy, phần bị cắt tính theo tỉ lệ km.
- **Pace đội** = tổng thời gian ÷ tổng km của những người chạy đủ km tối thiểu. Không ai thắng nhờ chạy 1 km thật nhanh.
- **Trung bình** chia cho số **VĐV đã đăng ký**, không phải toàn bộ thành viên CLB. Đăng ký mà không chạy sẽ kéo điểm đội xuống, nên mọi người được khuyến khích cùng chạy.
- Kết quả **chính thức sau 48 giờ**, để chờ bài Strava đồng bộ muộn và bài đang duyệt. Ban quản trị được báo số bài cần duyệt.

## 4. Thưởng (không cộng Xu)

- Huy hiệu **"Chiến thắng đấu CLB"** cho VĐV đã chạy của CLB thắng.
- Huy hiệu **"MVP đấu CLB"** cho người đóng góp nhiều nhất trận (với pace: người nhanh nhất trong số những người chạy đủ km tối thiểu).
- **Điểm uy tín CLB** (Elo, chỉ trận 1–1):
  - mọi CLB bắt đầu 1.000 điểm;
  - thắng CLB mạnh hơn được nhiều điểm hơn;
  - có chuỗi thắng và **Bảng uy tín** toàn hệ thống.
- Danh hiệu **"Nhà vô địch"** hiện ở đầu trang CLB 7 ngày sau khi thắng.

## 5. Trận cũ

Trận "CLB đấu CLB" tạo trước bản này được chuyển sang, giữ nguyên đường link. Các trận này vẫn tính như cũ: mọi thành viên, km, không cần đăng ký, chốt sau 2 giờ. Riêng người ở cả hai CLB nay chỉ được tính cho CLB vào trước, vì bản cũ có lỗi tính cho cả hai bên.
