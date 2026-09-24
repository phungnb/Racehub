# ADR-007: Chống gian lận theo luật + Trust Score

**Bối cảnh.** Có tiền cược thì sẽ có gian lận (đi xe máy, giả GPS, sửa file, nhờ người chạy hộ). FR17–FR19 và MH 16 yêu cầu xác thực, report và Trust Score.

**Quyết định.** Pipeline `verify_activity()` chạy phía server, gồm các luật có trọng số, trả về `verify_score` 0–100 và `verify_flags`:

| Luật | Ví dụ ngưỡng |
|---|---|
| Tốc độ tức thời vượt ngưỡng (người tạo thử thách được đặt riêng) | > 25 km/h trong ≥ 30 giây |
| Pace trung bình phi thực tế | < 2:30/km cho cự ly > 3 km |
| Gia tốc / teleport | nhảy > 100 m trong 1 giây |
| Độ cao phi tự nhiên | > 30 m/giây |
| GPS gián đoạn | khoảng trống > 60 giây mà vẫn tăng quãng đường |
| Cadence / HR không khớp tốc độ | pace 3:30 mà cadence < 140 hoặc HR < 100 |
| Nguồn thủ công | `MANUAL` thì không bao giờ tính cho thử thách có cược |
| Trùng lặp | cùng user, thời gian chồng lấn với bài khác |
| Relay | điểm kết thúc chặng N cách điểm bắt đầu chặng N+1 hơn 1 km |

Kết luận: `score ≥ 80` → `VERIFIED`; `50–79` hoặc user có `trust_score < 50` → `UNDER_REVIEW`; `< 50` → `REJECTED` (được gửi giải trình).
Trust Score: +1 mỗi bài hợp lệ (tối đa +2/ngày), −10 đến −20 khi xác nhận gian lận, admin điều chỉnh được (FR37). Ngưỡng đọc từ `config_versions('anticheat')`.

**Hệ quả.** Bắt đầu bằng luật (giải thích được, dễ khiếu nại). Sau khi có dữ liệu đã gán nhãn từ admin, có thể thêm model ML ở worker. Kết quả `UNDER_REVIEW` hiển thị xám trên BXH, và settlement chờ xử lý xong (`DISPUTED`).
