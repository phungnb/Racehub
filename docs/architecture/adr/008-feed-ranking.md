# ADR-008: Feed — fan-out on read + auto-post từ domain event

**Bối cảnh.** FR28–29 và "Smart Feed" yêu cầu ưu tiên: Live → PB/Level up → bạn bè thân → cùng thử thách → nhiều tương tác chất lượng. Có auto-post khi hoàn thành thử thách, PB, lên cấp, vật phẩm hiếm, và thẻ Brand Mission.

**Quyết định.**
- Consumer của `domain_events` tạo `feed_items` (auto-post), nên không cần người dùng tự đăng.
- **Fan-out on read:** `list_feed` lấy ứng viên từ bạn bè, CLB, thử thách đang tham gia và nội dung công khai nổi bật trong 72 giờ, rồi tính điểm:
  `score = w_type(verb) + w_rel(bạn thân / CLB / cùng thử thách) + log(1 + cheers·3 + comments·2 + likes) − decay(tuổi)`.
  Item LIVE luôn được ghim lên dải Story.
- Trọng số lưu ở `config_versions('feed')` để A/B test được.

**Lý do.** Với vài chục nghìn user, fan-out on read trong Postgres (có index `actor_id, created_at`) đủ nhanh và đơn giản. Khi vượt khoảng 100k DAU, chuyển sang fan-out on write (bảng `feed_inbox` theo user) mà không cần đổi API.
