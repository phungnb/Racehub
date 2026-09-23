# ADR-005: Xử lý bất đồng bộ bằng outbox + pgmq + worker

**Bối cảnh.** Một bài chạy kích hoạt nhiều hệ quả: chấm thử thách, XP, Xu, nhiệm vụ, PB, feed, thông báo, điểm CLB. Webhook Strava phải trả lời trong 2 giây. Push notification gọi dịch vụ ngoài và có thể chậm hoặc lỗi.

**Quyết định.**
- Phần **bắt buộc nhất quán** (tiến độ thử thách, ledger, XP) chạy đồng bộ trong transaction `ingest_activity`.
- Phần **có thể trễ vài giây** (feed item, notification, push, điểm CLB, badge) được ghi thành `domain_events` trong cùng transaction (Transactional Outbox). Worker (Edge Function kích hoạt bởi `pg_cron` hoặc pgmq) đọc và xử lý, có retry.
- Việc gọi API ngoài (Strava fetch, FCM) luôn đi qua hàng đợi `pgmq`, không bao giờ nằm trong request người dùng.

**Hệ quả.** Không mất sự kiện khi worker chết (sự kiện vẫn trong DB). Consumer phải idempotent. Có bảng `job_runs` + cảnh báo khi hàng đợi tồn đọng.
