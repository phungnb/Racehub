# ADR-015: Lớp game (nhiệm vụ, streak, huy hiệu, league, cổ vũ)

**Trạng thái.** Đã chấp nhận (migration `20261001000800_game_layer.sql`). Trụ cột ① trong [Định hướng](../../DINH_HUONG_SAN_PHAM.md). Dựa trên ADR-002 (sổ cái) và ADR-014 (kinh tế Xu).

**Bối cảnh.** Đặc tả (Module 1.3, 3.1, 4.3) có XP, cấp độ, nhiệm vụ ngày/tuần, streak, huy hiệu, bảng xếp hạng tuần và "Cheer" có giá trị. Trước migration này, app chỉ cộng Xu và XP theo km. Mở app không thấy việc gì cần làm hôm nay, và cũng không có lý do để quay lại mỗi ngày.

**Quyết định.**

1. **Một động cơ phần thưởng duy nhất: `private.award`.** Mỗi phần thưởng là một dòng `game_events`, có `dedupe_key` duy nhất nên được trao đúng một lần.
   - Xu đi qua sổ cái (`GAME_QUEST`, `GAME_BADGE`, `GAME_LEAGUE`…), XP đi qua `private.add_xp`.
   - Khi lên cấp, hệ thống tự ghi sự kiện `LEVEL_UP` và gửi thông báo.
   - Client không bao giờ tự cộng thưởng.
2. **Chạy sau khi bài chạy được trả thưởng.** Trigger `trg_game_after_run` chạy khi `rewarded_at` chuyển từ null sang có giá trị. Nó lần lượt xử lý: thẻ bài chạy → nhiệm vụ → streak → league → huy hiệu.
   - Lỗi trong lớp game chỉ ghi cảnh báo, không làm hỏng việc nhận bài chạy (kể cả webhook Strava).
   - Bài chạy lưu lịch sử (trước khi kết nối Strava) đã có `rewarded_at` ngay khi được chèn vào, nên không kích hoạt trigger. Bài đó chỉ được tính vào huy hiệu tổng km.
3. **Thu hồi khi bài chạy mất hiệu lực.** Nếu bài bị xóa trên Strava hoặc bị từ chối sau khi đã thưởng, `game_revoke_activity` xử lý các phần thưởng gắn với bài đó:
   - Trừ lại Xu (cho phép số dư âm, giống thu hồi thưởng chạy) và XP.
   - Mở lại nhiệm vụ và huy hiệu để có thể đạt lại bằng một bài hợp lệ.
4. **Nhiệm vụ** nằm trong bảng `quests`, admin sửa được số liệu.
   - Nhiệm vụ đạt là **tự nhận thưởng**, không cần bấm "Nhận", nên không có thưởng bị bỏ quên.
   - Kỳ nhiệm vụ tính theo giờ Việt Nam: ngày, hoặc tuần bắt đầu từ thứ Hai.
   - Mức thưởng mặc định được giảm so với tài liệu gốc để khớp giá trị Xu mới (1 Xu ≈ 1.000đ):

   | Nhiệm vụ | Thưởng |
   |---|---|
   | Điểm danh | 0,5 Xu |
   | Chạy ≥ 3 km | 1 Xu |
   | Cổ vũ 1 người | 0,5 Xu |
   | 30 km/tuần | 10 Xu |
   | Chạy 5 ngày trong tuần | 8 Xu |
   | Tham gia 3 thử thách | 3 Xu |
   | Nhận 15 lượt cổ vũ | 5 Xu |

   Một người rất chăm có thể kiếm tối đa khoảng 225 Xu/tháng từ chạy và nhiệm vụ.
5. **Streak tính theo TUẦN, không theo ngày.** Mỗi người đặt mục tiêu 1–7 ngày chạy/tuần.
   - Tuần nào hụt mục tiêu thì **khiên** tự dùng để giữ chuỗi. Khiên giá 20 Xu, mỗi người có tối đa 2.
   - Lý do chọn tuần: người chạy cần ngày nghỉ, streak ngày dễ gây chấn thương và làm người dùng bỏ app khi đứt chuỗi. App vẫn hiện thêm "số ngày chạy liên tiếp" để tham khảo.
   - Không cần cron: tuần hụt được xử lý khi người đó có bài đạt mục tiêu tiếp theo, còn trang chủ tính trạng thái "còn chuỗi" trực tiếp mỗi lần mở.
6. **Huy hiệu theo luật:** `achievements.rule = {"type": ..., "gte": n}`, dựa trên chỉ số do `private.player_stats` tính.
   - Huy hiệu được xét sau mỗi bài chạy, mỗi lần cổ vũ, khi thử thách tất toán, và khi mở trang chủ (để bắt kịp huy hiệu CLB và cấp độ).
   - Bộ đầu tiên có 27 huy hiệu, chia 4 bậc: Đồng, Bạc, Vàng, Huyền thoại.
7. **League tuần:** có 5 hạng (Đồng → Kim cương). Điểm là **km hợp lệ trong tuần**, dễ hiểu với người chạy bộ.
   - Người dùng vào nhóm 30 người cùng hạng khi có bài chạy đầu tiên trong tuần. Ràng buộc `unique (user_id, week_start)` đảm bảo không ai ở hai nhóm trong cùng tuần.
   - Chốt tuần vào thứ Hai: nhóm từ 5 người trở lên thì top ⌊n/3⌋ (tối đa 7) lên hạng và ⌊n/5⌋ (tối đa 5) người cuối xuống hạng. Top 3 nhận 10/6/3 Xu.
   - Việc chốt được kích hoạt ngay khi có người mở trang chủ và bởi cron `/api/cron/leagues` làm lưới an toàn.
8. **Cổ vũ có giá trị:** người gửi tặng 1–10 Xu kèm lời nhắn. Xu đi qua sổ cái: người gửi dùng BONUS trước rồi mới đến PAID, còn người nhận **luôn nhận BONUS**.
   - Có trần 50 Xu và 30 lượt mỗi ngày, không cổ vũ được chính mình, và cả hai bên được +5 XP.
   - Vì Xu nạp của người gửi đổi thành Xu thưởng khi sang người nhận, Xu nạp không bị "rửa" giữa các tài khoản.
9. **Hiển thị:**
   - `my_game_state()` trả toàn bộ trạng thái trang chủ trong một lần gọi.
   - `activity_rewards(id)` phục vụ màn tổng kết sau chạy: tối đa 6 thẻ, ≤ 6 giây, bỏ qua được, tôn trọng cài đặt giảm chuyển động.
   - `game_events` được phát qua Realtime nên phần thưởng từ bài Strava hiện ngay trên trang chủ.

**Hệ quả.**
- Mọi số liệu (thưởng nhiệm vụ, giá khiên, trần cổ vũ, thưởng league) đều chỉnh được mà không cần deploy. Nhiệm vụ và huy hiệu sửa trong bảng `quests` / `achievements`; các số khác sửa trong khóa `game` của `economy_global_config`.
- Streak không trả Xu, chỉ trả XP, để tránh "cày chuỗi". Xu từ streak đến qua huy hiệu mốc 10 và 26 tuần.
- Còn để sau: chi tiết bài chạy có bản đồ (GM-10), cơ chế hạ cấp do không hoạt động (Module 1.3), huy hiệu "chạy nhóm" (cần sự kiện CLB), và giao diện admin để sửa nhiệm vụ/huy hiệu.
