# RaceHub — Tài liệu Kiến trúc Phần mềm

> Phiên bản 1.0 · Nguồn yêu cầu: *Chi tiết module app*, *Chi tiết 28 màn hình RaceHub* · Áp dụng cho code tại nhánh `main` (Next.js 16 + Supabase).

| Tài liệu | Nội dung |
|---|---|
| [README.md](./README.md) (file này) | Đánh giá hiện trạng, sơ đồ thành phần, bounded context, luồng dữ liệu, lộ trình |
| [api.md](./api.md) | Thiết kế API: RPC command, REST route, Realtime channel, mã lỗi |
| [database.md](./database.md) | Lược đồ CSDL (ERD), nguyên tắc RLS, sổ cái kép, kế hoạch migrate |
| [schema.sql](./schema.sql) | DDL tham chiếu cho lược đồ đích (chưa phải migration, xem hướng dẫn trong file) |
| [frontend.md](./frontend.md) | Kiến trúc frontend, design system, cấu trúc thư mục, chuẩn UI |
| [adr/](./adr/) | Các quyết định kiến trúc quan trọng (ADR-001 … ADR-011) |

---

## 1. Đánh giá hiện trạng code

Phần đã làm tốt: tổ chức theo `features/*`, đã dùng RPC cho các nghiệp vụ nhạy cảm của CLB (`join_club`, `contribute_treasury`…), đã có ý tưởng sổ cái (`create_challenge_with_ledger`) và idempotency key.

Các vấn đề cần xử lý **trước khi** phát triển thêm tính năng (xếp theo mức độ nghiêm trọng):

| # | Vấn đề | Vị trí | Hệ quả | Hướng xử lý |
|---|---|---|---|---|
| 1 | Liên kết Strava dùng `state = user_id` thô, không ký, không kiểm tra phiên | `app/api/strava/callback/route.ts`, `ProfileTab.tsx` | Kẻ xấu gửi link OAuth với `state` = id nạn nhân → ghi đè token Strava và tên hiển thị của người khác | `state` = nonce ngẫu nhiên lưu server-side, gắn với phiên đăng nhập (ADR-006) |
| 2 | Route server fallback về `ANON_KEY` khi thiếu `SERVICE_ROLE_KEY`; token Strava lưu trong `profiles` | cùng file trên | Token OAuth có thể bị đọc qua API công khai nếu RLS của `profiles` cho phép select | Tách bảng `provider_connections` không có policy SELECT cho client; fail-fast khi thiếu key |
| 3 | Client tự `insert` profile với `xu: 500`, tự `update` bảng `profiles`, admin duyệt bài chạy bằng `update` trực tiếp | `app/page.tsx`, `ProfileTab.tsx`, `AdminDashboard.tsx` | Nếu RLS cho phép cập nhật cả dòng, user tự sửa được `xu`, `xp`, `level`, `role` | Tạo profile bằng trigger `on auth.users insert`; chỉ cho update cột an toàn; mọi thay đổi tài sản đi qua RPC (ADR-003) |
| 4 | RPC nhận `p_user_id` từ client (`submit_and_process_activity`, `equip_item`, `has_permission`, `create_challenge_with_ledger`) | `RunTab.tsx`, `characterApi.ts`, `club/api.ts`, `challengeApi.ts` | Nếu hàm SQL tin tham số này, người dùng mạo danh được người khác | Trong SQL luôn dùng `auth.uid()`, bỏ tham số `p_user_id` (ADR-003) |
| 5 | Chấm điểm thử thách chạy ở client (`racehubEngine.ts` gọi `update challenge_participants`) | `shared/lib/racehubEngine.ts` | Client tự tăng tiến độ, gian lận được | Chuyển toàn bộ engine xuống server (ADR-004) |
| 6 | Lược đồ không khớp nhau: `profile_id` vs `user_id`, `JOINED` vs `ACTIVE`, `strava_expires_at` vs `strava_token_expires_at`, `start_date` vs `activity_date`; `user_avatar` lặp `level/xp/coins` của `profiles` | nhiều file | Lỗi chạy ngầm, dữ liệu lệch | Một lược đồ chuẩn duy nhất ([database.md](./database.md)), sinh type bằng `supabase gen types` |
| 7 | Chỉ có 1 file migration; phần lớn bảng/RPC nằm trên Supabase Dashboard | `supabase/migrations` | Không tái tạo được môi trường, không review được | Kéo schema về bằng `supabase db pull`, từ nay mọi thay đổi DB đều là migration |
| 8 | Build lỗi: 11 lỗi TypeScript | xem bên dưới | Không deploy được | Sửa trong Giai đoạn 0 |
| 9 | Toàn bộ app là 1 trang, tab lưu bằng `useState`; không có route, không deep link, không SSR | `app/page.tsx` | Không chia sẻ link được, back button hỏng, chậm | App Router theo route (xem [frontend.md](./frontend.md)) |

Kết quả `npx tsc --noEmit` hiện tại:

```
app/layout.tsx                 Cannot find name 'LayoutProps'
features/*/…                   Cannot find module 'lucide-react'  (6 file — chưa có trong package.json)
features/character/CharacterHub.tsx  Property 'gender' does not exist …   (lỗi trong ảnh chụp màn hình)
features/club/index.ts         Cannot find module './components/ClubAdminPanel' / 'ClubDashboardWithLeaderboard'
```

Ngoài ra `CharacterHub.tsx` gọi `equipItemRpc(itemId, category)` trong khi hàm nhận `(userId, itemId)`, sai thứ tự tham số. Ở gốc repo còn một file rỗng tên `=` do gõ nhầm lệnh.

---

## 2. Kiến trúc tổng thể

**Kiểu kiến trúc:** *Modular monolith* trên nền **Supabase (PostgreSQL)** + **Next.js** làm Web App và BFF (Backend-for-Frontend). Không dùng microservices ở giai đoạn này (ADR-001).

### 2.1 Sơ đồ thành phần (Component Diagram)

```mermaid
flowchart LR
  subgraph Clients["Client"]
    PWA["Runner App<br/>Next.js PWA<br/>(Feed, Challenge, Club, Hub, Profile)"]
    NATIVE["Run Tracker<br/>Expo / React Native<br/>(GPS nền, Live mode) — GĐ 3"]
    ADMIN["Web Dashboard<br/>/admin, /organizer<br/>(Next.js, cùng codebase)"]
  end

  subgraph Edge["Next.js server (Vercel)"]
    RSC["Server Components<br/>đọc dữ liệu SSR"]
    ROUTES["Route Handlers /api/*<br/>OAuth, Webhook, Export CSV,<br/>Thanh toán"]
    SA["Server Actions<br/>form, upload"]
  end

  subgraph Supabase["Supabase"]
    AUTH["Auth<br/>Email OTP, Google, Apple, Facebook"]
    PG[("PostgreSQL<br/>Bảng + RLS + RPC<br/>(domain logic)")]
    RT["Realtime<br/>postgres_changes + Broadcast + Presence"]
    ST["Storage<br/>avatar, cover, poster, GPX"]
    EF["Edge Functions<br/>worker ingest, anti-cheat,<br/>push sender"]
    CRON["pg_cron + pgmq<br/>job định kỳ, hàng đợi"]
  end

  subgraph External["Dịch vụ ngoài"]
    STRAVA["Strava API + Webhook"]
    GARMIN["Garmin / Coros<br/>(GĐ 3)"]
    PAY["Cổng thanh toán<br/>VNPay / MoMo / Stripe"]
    FCM["FCM / APNs<br/>(push)"]
    MAPS["Mapbox / MapLibre"]
    OBS["Sentry + PostHog"]
  end

  PWA -->|supabase-js: RPC, select| PG
  PWA --> AUTH
  PWA <-->|subscribe| RT
  PWA --> ST
  PWA --> RSC
  NATIVE -->|RPC + batch GPS| PG
  NATIVE <--> RT
  ADMIN --> RSC
  ADMIN --> ROUTES
  RSC -->|server client, cookie session| PG
  ROUTES -->|service role| PG
  STRAVA -->|webhook event| ROUTES
  ROUTES -->|OAuth token| STRAVA
  PAY -->|IPN webhook| ROUTES
  CRON --> EF
  PG -->|pgmq job| EF
  EF -->|lấy activity| STRAVA
  EF --> FCM
  PWA --> MAPS
  PWA --> OBS
```

### 2.2 Nguyên tắc phân tầng

| Tầng | Nơi chạy | Được phép | Không được phép |
|---|---|---|---|
| UI (component) | Browser | Hiển thị, gọi hook của feature | Gọi `supabase` trực tiếp |
| Feature API (`features/*/api`) | Browser / Server | Gọi RPC, `select` có RLS bảo vệ | `insert/update/delete` các bảng tài sản (ví, XP, tiến độ) |
| Route Handler / Server Action | Next.js server | Service role cho tích hợp ngoài | Chứa luật nghiệp vụ trùng với SQL |
| Domain logic | PostgreSQL (RPC `SECURITY DEFINER`) | Mọi thay đổi trạng thái có giá trị | Tin tham số `p_user_id` từ client |
| Worker | Edge Function + pgmq | Xử lý bất đồng bộ, gọi API ngoài | Chạy trong request của người dùng |

**Quy tắc vàng:** *Client chỉ đọc và phát lệnh (command). Server quyết định kết quả.* Xu, XP, tiến độ thử thách, Trust Score, cấp độ đều không có đường ghi trực tiếp từ client.

---

## 3. Bounded Context (Module nghiệp vụ)

Ánh xạ từ 8 module trong tài liệu sang các context trong code. Mỗi context sở hữu bảng của mình. Context khác chỉ đọc bảng đó qua view hoặc RPC, không ghi trực tiếp.

```mermaid
flowchart TB
  IDN["Identity & Profile<br/>M1: đăng nhập, hồ sơ, kết nối thiết bị"]
  ACT["Activity<br/>M2.3, M7: ingest, GPS, PB, thống kê"]
  VER["Verification<br/>M2.4: anti-cheat, Trust Score, report"]
  CHL["Challenge Engine<br/>M2: 8 thể thức, BXH, settlement"]
  ECO["Economy (Ledger)<br/>M3.1: ví Xu, escrow, nhiệm vụ"]
  PRG["Progression<br/>M1.3: XP, Level, decay, badge"]
  SHP["Shop & Avatar<br/>M3.2–3.3: vật phẩm, tủ đồ, trang phục"]
  SOC["Social<br/>M4: feed, cheer, bạn bè, chat, thông báo"]
  CLB["Club<br/>M4.2: vai trò, quỹ, điểm hoạt động"]
  EVT["Events & Organizer<br/>M2.2 FR13, M5: giải ảo, thu phí"]
  MKT["Marketplace<br/>M6: voucher, BIB, coach — GĐ 4"]
  ADM["Admin<br/>M5.2: cấu hình, duyệt, báo cáo"]

  IDN --> ACT
  ACT -->|activity.created| VER
  VER -->|activity.verified| CHL
  VER -->|activity.verified| PRG
  VER -->|activity.verified| ECO
  VER -->|activity.verified| CLB
  CHL -->|escrow / payout| ECO
  CHL -->|challenge.completed| PRG
  CHL -->|challenge.completed| SOC
  PRG -->|level.up| SOC
  SHP -->|mua| ECO
  SOC -->|cheer: chi Xu| ECO
  CLB -->|quỹ CLB| ECO
  EVT -->|phí đăng ký| ECO
  MKT --> ECO
  ADM -.cấu hình.-> ECO
  ADM -.cấu hình.-> PRG
  ADM -.duyệt.-> VER
```

Mũi tên là **sự kiện miền (domain event)**. Sự kiện được ghi vào bảng `domain_events` (outbox) trong cùng transaction, rồi worker phát tán tới các context khác (ADR-005). Nhờ vậy khi thêm một phần thưởng mới cho bài chạy, ta chỉ thêm một consumer mà không phải sửa luồng ingest.

---

## 4. Luồng dữ liệu chính

### 4.1 Ghi nhận bài chạy (Strava webhook hoặc GPS trong app) → chấm điểm → thưởng

Đây là luồng quan trọng nhất của hệ thống. Mọi phần thưởng đều bắt nguồn từ nó.

```mermaid
sequenceDiagram
  autonumber
  participant S as Strava
  participant R as /api/webhooks/strava
  participant App as Run Tracker (app)
  participant DB as Postgres
  participant Q as pgmq: activity_ingest
  participant W as Worker (Edge Fn)
  participant RT as Realtime

  alt Nguồn Strava
    S->>R: POST event {object_id, owner_id, aspect_type=create}
    R->>R: Kiểm tra subscription + owner_id đã liên kết
    R->>DB: insert activity_ingest_jobs (unique source+external_id)
    R-->>S: 200 OK (< 2 giây)
    DB->>Q: enqueue
    Q->>W: job
    W->>S: GET /activities/{id} + streams (refresh token nếu hết hạn)
    W->>DB: rpc ingest_activity(normalized, streams)
  else Nguồn GPS trong app
    App->>DB: rpc submit_activity(track_points, client_hash)
  end

  Note over DB: ingest_activity — 1 transaction
  DB->>DB: upsert activities (status = PENDING_VERIFY)
  DB->>DB: verify_activity(): tốc độ, gia tốc, độ cao, GPS gap, HR, thiết bị → verdict
  alt VERIFIED
    DB->>DB: update personal_bests, user_stats
    DB->>DB: score_challenges(activity) theo từng thể thức
    DB->>DB: ledger: thưởng Xu chạy (1 xu km đầu + 0.2/km), nhiệm vụ
    DB->>DB: xp_events + recompute level
    DB->>DB: insert domain_events (activity.verified, pb.achieved, …)
  else SUSPICIOUS
    DB->>DB: status = UNDER_REVIEW, trust_score_events
    Note over DB: Không tính vào BXH (hiển thị xám) cho tới khi admin/admin CLB duyệt
  end
  DB-->>RT: postgres_changes: challenge_participants, leaderboard
  W->>W: consumer domain_events → feed_items, notifications, push
```

Các điểm then chốt:
- **Idempotent:** khóa duy nhất `(source, external_id)` trên `activities`; ledger có `idempotency_key = 'activity:{id}:reward'`. Strava gửi trùng thì cũng không cộng thưởng hai lần.
- **Không làm việc nặng trong webhook:** Strava yêu cầu phản hồi trong 2 giây. Webhook chỉ ghi job rồi trả về.
- **Sửa hoặc xóa trên Strava** (`aspect_type=update/delete`): chạy bù trừ (reversal). Ghi bút toán đảo ngược, không sửa bút toán cũ.

### 4.2 Vòng đời thử thách có cược (1-1 / nhóm / đồng đội): Escrow & Settlement

```mermaid
stateDiagram-v2
  [*] --> DRAFT: create_challenge()
  DRAFT --> OPEN: publish_challenge()<br/>khóa cọc chủ kèo → escrow
  OPEN --> CANCELLED: hết hạn nhận kèo / thiếu người<br/>hoàn cọc 100%
  OPEN --> READY: đủ người (join: khóa cọc người tham gia)
  READY --> LIVE: start_at hoặc 2 bên bấm "Sẵn sàng" (1-1)
  LIVE --> SETTLING: end_at (pg_cron)
  SETTLING --> SETTLED: chốt kết quả, trả thưởng,<br/>thu phí sàn 5%
  SETTLING --> DISPUTED: có activity UNDER_REVIEW / report
  DISPUTED --> SETTLING: admin xử lý xong
  SETTLED --> [*]
  CANCELLED --> [*]
```

```mermaid
sequenceDiagram
  autonumber
  participant A as Người tạo
  participant B as Đối thủ
  participant DB as Postgres (RPC)
  participant C as pg_cron

  A->>DB: create_challenge(format=DUEL_1V1, stake=500, rules)
  A->>DB: publish_challenge(id, idem_key)
  DB->>DB: ledger: user:A → escrow:challenge (500)
  B->>DB: join_challenge(id, pin?, idem_key)
  DB->>DB: kiểm tra level, số dư, slot, PIN → ledger: user:B → escrow (500)
  A->>DB: set_ready(id) · B->>DB: set_ready(id)
  DB->>DB: status LIVE, started_at = now()
  Note over DB: Chỉ bài chạy có start_time >= started_at mới được tính
  C->>DB: settle_due_challenges() mỗi phút
  DB->>DB: xếp hạng theo scoring strategy
  DB->>DB: ledger: escrow → winner (950), escrow → platform_fee (50)
  DB->>DB: domain_events: challenge.settled → feed, push, XP
```

Luật từ tài liệu được hiện thực hóa:
- Hòa: hoàn cọc cho cả hai, **trừ phí sàn**.
- Người gian lận bị xử thua ngay: bài chạy `REJECTED` khiến người đó bị loại (`DISQUALIFIED`), trừ Trust Score.
- Đội "quân số tự do": **mẫu số chốt tại `started_at`** (`team_size_locked`). Người chạy 0 km vẫn được tính vào mẫu số.
- Đội "quân số bằng nhau": đến giờ mà chưa đủ người thì `CANCELLED` và hoàn tiền.
- Thử thách bí mật: `get_challenge` trả `is_locked=true` và ẩn `description/rules` cho tới khi `unlock_challenge(id, pin)` thành công.

### 4.3 Live run, Cheer và bàn giao tiếp sức (Realtime)

```mermaid
sequenceDiagram
  autonumber
  participant R as Runner (đang chạy)
  participant RT as Realtime channel live:{session_id}
  participant F as Bạn bè (Feed)
  participant DB as Postgres

  R->>DB: start_live_session(challenge_id?) → session_id
  loop mỗi 5–10 giây
    R->>RT: broadcast {lat, lng, dist, pace} (không ghi DB)
  end
  loop mỗi 60 giây
    R->>DB: append_live_points(batch) (lưu để hậu kiểm)
  end
  F->>RT: subscribe (Presence: ai đang xem)
  F->>DB: send_cheer(session_id, item_id, message, idem_key)
  DB->>DB: ledger: F → R (hoặc F → burn), XP cho cả 2
  DB-->>RT: broadcast cheer event
  RT-->>R: hiệu ứng + voice "Minh vừa tặng bạn Tên lửa 🚀"
  R->>DB: finish_live_session() → submit_activity(...)
```

**Tiếp sức (Relay):** khi Runner N gọi `finish_leg`, server xác nhận đủ cự ly, đặt `legs[N+1].unlocked_at = now()` rồi broadcast `relay:{team_id}` và gửi push "Đến lượt bạn!". Nút Start của Runner N+1 chỉ bật khi `unlocked_at IS NOT NULL`. Client không tự quyết định việc này. Job cron kiểm tra `unlocked_at + 30 phút` để phạt đội chậm bàn giao.

### 4.4 Mua vật phẩm / trang bị avatar

```mermaid
sequenceDiagram
  participant U as User
  participant DB as Postgres
  U->>DB: purchase_item(item_id, idem_key)
  DB->>DB: SELECT … FOR UPDATE ví, kiểm tra level_required, còn hàng
  DB->>DB: ledger: user → shop_revenue (price)
  DB->>DB: insert user_items
  DB-->>U: {balance, item}
  U->>DB: equip_item(item_id)
  DB->>DB: kiểm tra sở hữu + level hiện tại ≥ level_required (đồ độc quyền bị khóa khi hạ cấp)
  DB->>DB: upsert avatar_loadouts[slot]
```

### 4.5 Job định kỳ (pg_cron)

| Job | Tần suất | Nghiệp vụ |
|---|---|---|
| `settle_due_challenges` | 1 phút | Chuyển LIVE→SETTLING→SETTLED, hoàn cọc kèo hết hạn |
| `relay_handover_watchdog` | 5 phút | Phạt đội bàn giao trễ quá 30 phút |
| `refresh_leaderboards` | 5 phút | Refresh materialized view BXH toàn cầu / khu vực |
| `reset_periodic_leaderboards` | 00:00 thứ Hai / ngày 1 | Chốt BXH tuần/tháng vào `leaderboard_snapshots`, thưởng Top 1 (500 XP) |
| `level_decay_warning` | hằng ngày | Gửi cảnh báo trước 7 ngày cho Lv 3–5 |
| `level_decay_check` | hằng ngày | Hạ cấp nếu không đủ hoạt động (5 buổi/30 ngày với Lv4–5; 3 buổi/60 ngày với Lv3) |
| `club_activity_score` | hằng ngày | Tính điểm hoạt động, decay; cảnh báo 4 tuần = 0; giải thể sau 2 tuần |
| `mission_rollover` | 00:00 hằng ngày / tuần | Sinh nhiệm vụ ngày/tuần mới |
| `strava_token_refresh` | 30 phút | Refresh token sắp hết hạn |

---

## 5. Yêu cầu phi chức năng → giải pháp

| Yêu cầu | Giải pháp |
|---|---|
| Onboarding ≤ 3 bước / 60 giây (NFR1) | Đăng nhập OAuth → Kết nối Strava (bỏ qua được) → Chọn nhân vật. Profile tạo tự động bằng trigger |
| BXH real-time | Bảng `challenge_participants` tăng dần + Realtime `postgres_changes` lọc theo `challenge_id`; BXH toàn cầu dùng materialized view |
| Toàn vẹn tài sản ảo | Sổ cái kép, `CHECK` số dư ≥ 0, `SELECT … FOR UPDATE`, idempotency key, không có UPDATE/DELETE trên `ledger_entries` |
| Chống gian lận | Pipeline verify phía server, Trust Score, report, duyệt thủ công (ADR-007) |
| Bảo mật | RLS trên mọi bảng, RPC dùng `auth.uid()`, secret chỉ ở server, OAuth state có nonce |
| Quan sát (observability) | Sentry (lỗi FE/BE), PostHog (funnel onboarding, retention), bảng `job_runs` cho cron |
| Quy mô | 10k–100k user chạy tốt trên 1 Postgres (Supabase Pro). Partition `activity_points` theo tháng; khi cần, tách read replica cho BXH |

---

## 6. Lộ trình triển khai đề xuất

| Giai đoạn | Mục tiêu | Hạng mục |
|---|---|---|
| **0. Ổn định** (1–2 tuần) | Build xanh, an toàn | Sửa 11 lỗi TS; `supabase db pull` đưa schema vào migrations; sửa OAuth state; chặn client ghi `profiles.xu/xp/role`; bỏ `p_user_id`; xóa `racehubEngine.ts` phía client; thêm CI (lint + typecheck + build) |
| **1. Nền tảng** (3–4 tuần) | Kiến trúc đích | Ledger kép; pipeline ingest Strava webhook; App Router theo route; design system; sinh type từ DB |
| **2. Core loop** (4–6 tuần) | MVP có thể ra mắt | Thử thách: Volume, Distance, Streak, Pace Breaker, 1-1 có cược, Đồng đội SUM/AVG; Feed tự động; Cheer; Shop + Avatar; XP/Level; BXH |
| **3. Mở rộng** | Giữ chân user | App native (Expo) chạy GPS nền + Live mode; Relay, Hunter, Bí mật; Chat; Club treasury/score; level decay; Garmin/Coros |
| **4. Doanh thu** | Kiếm tiền | Web Dashboard BTC + thanh toán; Marketplace voucher; BIB resell; Coach directory; Training plan Premium |

Chi tiết các quyết định kiến trúc: [adr/](./adr/).
