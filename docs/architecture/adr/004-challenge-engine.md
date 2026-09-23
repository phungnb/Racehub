# ADR-004: Challenge Engine phía server — format × objective × rules

**Bối cảnh.** Tài liệu có khoảng 15 kiểu thử thách (Pace Breaker, Streak, Negative Split, Volume, 1-1, đồng đội SUM/AVG, tiếp sức cứng/mềm, cộng đồng, bí mật, săn mồi, CLB, giải ảo BTC…), mỗi kiểu có luật thắng, luật tiền và ràng buộc riêng. Code hiện có 2 mô hình không khớp nhau (`challenge_type/game_mode` và `objective_type/challenge_rules`).

**Quyết định.**
- Một bảng `challenges` với `format` (cách tổ chức), `objective` (cách một bài chạy được tính điểm), `rules jsonb` (tham số), cùng các cột kinh tế chung (`funding`, `stake_xu`, `prize_split`, `platform_fee_bps`).
- `rules` được validate bằng Zod ở client và bằng hàm SQL ở server.
- Engine theo Strategy pattern: `score_<objective>()` tính đóng góp của một bài chạy; `rank_<format>()` và `settle_<format>()` xếp hạng và chia thưởng.
- Chỉ tính bài chạy `VERIFIED` và có `start_time` nằm trong `[started_at, end_at]` (và trong `daily_window` nếu có). Mỗi lần tính ghi vào `challenge_contributions` để đảo ngược được khi bài bị loại sau đó.
- Vòng đời có trạng thái rõ ràng (README §4.2). Settlement do `pg_cron` chạy, idempotent.

**Hệ quả.** Thêm kiểu thử thách mới = thêm giá trị enum + 1–3 hàm + 1 Zod schema + 1 bước wizard, không phải sửa bảng. Các luật đặc biệt trong tài liệu (mẫu số chốt tại giờ bắt đầu, hủy khi thiếu người, hòa thì hoàn trừ phí, gian lận xử thua) được cài đặt trong `settle_*`.
