# Architecture Decision Records

Mỗi ADR ghi lại **một** quyết định: bối cảnh, lựa chọn, lý do và hệ quả. Khi đổi quyết định, không sửa ADR cũ mà viết ADR mới với trạng thái "Thay thế ADR-xxx".

| ADR | Quyết định | Trạng thái |
|---|---|---|
| [001](./001-modular-monolith-supabase.md) | Modular monolith trên Supabase + Next.js | Đề xuất |
| [002](./002-double-entry-ledger.md) | Sổ cái kép cho RaceCoin | Đề xuất |
| [003](./003-commands-as-rpc.md) | Mọi command có giá trị là Postgres RPC dùng `auth.uid()` | Đề xuất |
| [004](./004-challenge-engine.md) | Challenge Engine phía server: format × objective × rules | Đề xuất |
| [005](./005-async-outbox-queue.md) | Xử lý bất đồng bộ: outbox + pgmq + worker | Đề xuất |
| [006](./006-wearable-integration.md) | Tích hợp thiết bị: Strava webhook trước, token ở schema private | Đề xuất |
| [007](./007-anti-cheat-trust-score.md) | Chống gian lận theo luật + Trust Score | Đề xuất |
| [008](./008-feed-ranking.md) | Feed fan-out on read, auto-post từ domain event | Đề xuất |
| [009](./009-mobile-strategy.md) | PWA trước, Expo native cho GPS nền | Đề xuất |
| [010](./010-realtime.md) | Realtime: Broadcast cho dữ liệu tạm, postgres_changes cho dữ liệu lưu | Đề xuất |
| [011](./011-virtual-currency-compliance.md) | Ranh giới pháp lý của Xu và cược | Đề xuất — **cần tư vấn luật** |
