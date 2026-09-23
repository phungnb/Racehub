# ADR-001: Modular monolith trên Supabase + Next.js

**Bối cảnh.** Tài liệu mô tả "Client-Server" với Mobile App, Web Dashboard, Backend API và dịch vụ bên thứ ba. Đội ngũ nhỏ, code hiện dùng Next.js 16 + Supabase, đã có một số RPC cho CLB.

**Quyết định.** Giữ **một** backend là Supabase (Postgres + Auth + Realtime + Storage + Edge Functions). Logic nghiệp vụ lõi viết bằng PL/pgSQL (RPC), chia thành các module có ranh giới rõ (bounded context, xem README §3). Next.js làm web app, Web Dashboard (`/admin`, `/organizer`) và BFF cho tích hợp ngoài. **Không** tách microservice.

**Lý do.**
- Nghiệp vụ tiền/cược cần transaction ACID xuyên nhiều bảng. Postgres làm việc này tốt nhất khi mọi thứ nằm trong một DB.
- Đội nhỏ vận hành một hệ thống thì rẻ và nhanh hơn nhiều so với vài service.
- RLS + `auth.uid()` cho phép client gọi DB trực tiếp an toàn, không cần viết lớp REST trung gian.

**Hệ quả.**
- (+) Ít hạ tầng, phát triển nhanh, dữ liệu nhất quán.
- (−) Logic trong SQL khó test hơn TypeScript. Bù lại bằng: migration có review, test SQL bằng `pgTAP` trong CI, và quy tắc mỗi RPC chỉ làm một việc.
- (−) Phụ thuộc vào Supabase. Chấp nhận được vì bên dưới là Postgres chuẩn và có thể tự host.
- Điểm có thể tách ra sau này: worker ingest/anti-cheat (Edge Function → service riêng) khi tải lớn.
