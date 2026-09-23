# Cấu trúc thư mục RaceHub

> Mục tiêu: nhìn tên thư mục là biết code nằm ở đâu, thêm tính năng mới không phải hỏi "để file này ở đâu". Luật ranh giới ở §3 được **ESLint kiểm tra tự động** (`eslint.config.mjs`), nên vi phạm sẽ làm CI đỏ.

## 1. Cây thư mục hiện tại

```
Racehub/
├── app/                          ROUTE: chỉ ghép màn hình, không chứa nghiệp vụ
│   ├── layout.tsx, providers.tsx, globals.css (design token)
│   ├── (app)/                    Màn hình cần đăng nhập (có TopBar + BottomTabBar)
│   │   ├── _components/          Khung app: TopBar, BottomTabBar, FullScreenMessage
│   │   ├── feed/                 Trang chủ
│   │   ├── challenges/           Thử thách
│   │   ├── run/                  Chạy
│   │   ├── clubs/                CLB
│   │   ├── me/                   Tôi (hồ sơ, kết nối, cài đặt)
│   │   └── admin/                Quản trị hệ thống
│   ├── api/                      Route server: OAuth + đồng bộ Strava, webhook
│   ├── login/, reset-password/   Đăng nhập
│   └── club/join/[code]/, join/[code]/   Link mời CLB, link giới thiệu
│
├── features/                     NGHIỆP VỤ: mỗi thư mục là một module độc lập
│   ├── <module>/
│   │   ├── index.ts              ← CỔNG CÔNG KHAI: thứ duy nhất module khác được import
│   │   ├── server.ts             ← (nếu có) cổng chỉ dành cho server
│   │   ├── api/                  Gọi Supabase (select / rpc). Không có JSX
│   │   ├── model/                Logic thuần + type + test (*.test.ts). Không gọi mạng
│   │   ├── hooks/                Hook React (TanStack Query, realtime, GPS…)
│   │   └── components/           Giao diện. Màn hình chính đặt tên *Screen.tsx
│   │
│   ├── auth/                     Phiên đăng nhập, màn đăng nhập, hành động chờ sau đăng nhập
│   ├── run/                      Ghi GPS, màn Chạy (① ② ③ đều dùng dữ liệu từ đây)
│   ├── activity/                 Danh sách, chi tiết bài chạy
│   ├── integrations/             Strava (sau này Garmin, COROS). server.ts chứa token, webhook
│   ├── progression/              ① Cấp độ, XP (sau này streak, huy hiệu, league)
│   ├── character/                ① Nhân vật, vật phẩm, tủ đồ
│   ├── challenge/                ② Thử thách cá nhân và đội
│   ├── club/                     ③ Không gian CLB
│   ├── home/                     Trang chủ (trung tâm game)
│   ├── profile/                  Hồ sơ, quyền riêng tư, tìm vận động viên
│   ├── referral/                 Giới thiệu bạn bè
│   └── admin/                    Quản trị hệ thống, cấu hình phí
│
├── shared/                       DÙNG CHUNG, không biết gì về nghiệp vụ
│   ├── ui/                       Design system: Button, Card, Stat, States, HoldButton…
│   ├── lib/                      supabase (browser/server), format, errors, cn, oauth-state
│   ├── config/                   env (public / server), routes
│   └── types/                    Type dùng nhiều module (Profile; sau này type sinh từ DB)
│
├── supabase/
│   ├── migrations/               MỌI thay đổi DB, đánh số tăng dần (xem §4)
│   ├── remote_schema.sql         Ảnh chụp schema production (nền cho test DB)
│   └── config.toml
├── tests/db/                     Test migration + RLS trên Postgres nhúng (PGlite)
├── public/character/             Nhân vật 2D: ảnh nền + mặt nạ vùng theo giới tính (khung 900 × 1350, docs/NHAN_VAT.md)
├── scripts/character/            Ảnh gốc nhân vật (source/, không deploy) + sinh ảnh nền và mặt nạ: `python3 scripts/character/segment.py`
├── docs/                         Tài liệu (xem §5)
├── proxy.ts                      Làm mới phiên đăng nhập (thay middleware ở Next 16)
└── .github/workflows/ci.yml      lint + typecheck + test + build
```

## 2. Cây thư mục đích (sau Sprint 6)

Chỉ tạo thư mục khi có code thật, không tạo sẵn thư mục rỗng. Cây dưới đây là **bản đồ** để biết code mới sẽ nằm ở đâu.

```
app/(app)/
├── feed/                         Trang chủ = trung tâm game
├── challenges/
│   ├── page.tsx                  Của tôi / Khám phá / Đã xong
│   ├── new/                      Wizard 4 bước
│   └── [id]/                     Chi tiết · leaderboard/ · teams/[teamId]/
├── clubs/
│   ├── page.tsx                  Hộp thư CLB (tin chưa đọc, sự kiện sắp tới)
│   ├── new/                      Tạo CLB
│   └── [id]/
│       ├── layout.tsx            Đầu trang CLB + thanh tab (dùng chung cho mọi tab)
│       ├── page.tsx              Bảng tin
│       ├── chat/  events/  challenges/  leaderboard/  members/  treasury/  settings/
├── notifications/                Chuông thông báo
└── me/
    ├── page.tsx  wallet/  badges/  wardrobe/  settings/
    └── activities/[id]/          Chi tiết bài chạy (bản đồ, splits)

features/
├── club/
│   ├── api/                      clubApi · postsApi · chatApi · eventsApi · duesApi
│   ├── hooks/                    useClubFeed · useClubChat (realtime) · useUnread
│   ├── model/                    quyền, định dạng tin nhắn, luật điểm danh (+ test)
│   └── components/
│       ├── hub/                  ClubHeader, ClubTabs, ClubsInbox
│       ├── feed/  chat/  events/  members/  treasury/  leaderboard/
├── challenge/
│   ├── model/                    scoring.ts (TEAM_SUM/AVG/GAP/LAST_MEMBER…) + test
│   └── components/               detail/ · leaderboard/ · teams/ · wizard/
├── progression/                  levels · streak · badges · league
├── quest/                        Nhiệm vụ ngày / tuần
├── wallet/                       Ví Xu (lịch sử sổ cái)
├── notification/                 Chuông, cài đặt thông báo, Web Push
└── feed/                         Bảng tin cá nhân / bạn bè (nếu tách khỏi home)

shared/
├── ui/                           + Avatar, Tabs, Sheet, Dialog, Input, RankRow, ProgressRing, Countdown
└── types/database.ts             Type sinh tự động: `supabase gen types typescript`
```

## 3. Luật ranh giới (ESLint kiểm tra)

| Luật | Đúng | Sai |
|---|---|---|
| Ngoài module chỉ import qua cổng công khai | `import { ClubsScreen } from '@/features/club'` | `import ... from '@/features/club/components/ClubsScreen'` |
| Code server (token, service role) chỉ qua `server.ts` | `from '@/features/integrations/server'` | import `strava.server.ts` trực tiếp |
| Bên trong module dùng đường dẫn tương đối | `from '../api/clubApi'` | `from '@/features/club/api/clubApi'` |
| `shared/` không phụ thuộc `features/` hoặc `app/` | | `shared/ui` import từ `features/...` |
| `app/` chỉ ghép màn hình | `page.tsx` ≤ ~30 dòng, render `<XxxScreen />` | Truy vấn DB hoặc logic nghiệp vụ trong `page.tsx` |
| Component không gọi `supabase` trực tiếp *(áp dụng cho code mới)* | component → hook → `api/` | `supabase.from(...)` trong component |
| Module A cần dữ liệu module B | Import hàm từ `@/features/b` | Tự viết lại truy vấn bảng của B |

**Thêm một thứ mới thì đặt ở đâu?**

| Bạn cần | Đặt ở |
|---|---|
| Màn hình mới | `features/<module>/components/XxxScreen.tsx` + `app/(app)/<route>/page.tsx` + export trong `index.ts` |
| Gọi RPC / bảng mới | `features/<module>/api/<tên>Api.ts` |
| Tính toán thuần (điểm đội, pace, streak…) | `features/<module>/model/<tên>.ts` + `<tên>.test.ts` cạnh bên |
| Nút, thẻ, ô nhập dùng ở ≥ 2 module | `shared/ui/` + export trong `shared/ui/index.ts` |
| Bảng / cột / RPC / policy | Migration mới trong `supabase/migrations/` + test trong `tests/db/` |
| Biến môi trường | `.env.example` + `shared/config/env.ts` (public) hoặc `env.server.ts` (bí mật) |

## 4. Quy ước đặt tên

| Loại | Quy ước | Ví dụ |
|---|---|---|
| Module | danh từ số ít, chữ thường | `club`, `challenge`, `quest` |
| Màn hình | `PascalCase` + `Screen` | `ClubsScreen`, `ChallengeDetailScreen` |
| Component | `PascalCase`, named export (code mới) | `export function PostCard()` |
| Hook | `useXxx` trong `hooks/` | `useClubChat` |
| API | `<chủ đề>Api.ts`, hàm động từ | `chatApi.ts` → `sendMessage()`, `listMessages()` |
| Test | cạnh file, `.test.ts` | `model/scoring.test.ts` |
| Migration | `YYYYMMDD` + số thứ tự 6 chữ số + `_mô_tả` | `20261001000500_club_hub_core.sql` |
| Test DB | theo module | `tests/db/club-hub.test.ts` |
| Nhánh git | `feat/<mã việc>-mô-tả`, `fix/...` | `feat/CLB-05-club-chat` |
| Commit | `feat(club): …`, `fix(run): …`, `docs: …` | |

**Số migration đã dùng:** 000100 → 000400. Kế hoạch: 000500 CLB lõi (S2) · 000600 engine thử thách (S3) · 000700 lớp game (S4) · 000800 sự kiện và quỹ CLB (S5) · 000900 mùa giải và league CLB (S6).

## 5. Tài liệu

| File | Nội dung | Khi nào đọc |
|---|---|---|
| `docs/DINH_HUONG_SAN_PHAM.md` | Ba trụ cột, chỉ số, chuẩn giao diện | Trước khi quyết định làm gì |
| `docs/KE_HOACH_HOAN_THIEN.md` | Kế hoạch chi tiết từng sprint, từng việc | Hằng tuần, khi chọn việc |
| `docs/CAU_TRUC_THU_MUC.md` | File này | Khi thêm code mới |
| `docs/HUONG_DAN_TRIEN_KHAI.md` | Biến môi trường, migration, deploy | Khi deploy |
| `docs/BAO_CAO_BAO_MAT.md` | Lỗ hổng đã vá | Khi review bảo mật |
| `docs/architecture/` | Kiến trúc, API, CSDL, ADR, benchmark | Khi thiết kế tính năng lớn |

## 6. Những gì đã dọn (commit này)

| Việc | Lý do |
|---|---|
| Xóa `TeamLeaderboard`, `TeamRosterManager`, `CreateTeamChallengeModal` | Dùng **dữ liệu giả**, không màn hình nào dùng. Ý tưởng 4 chế độ đội được giữ trong kế hoạch Sprint 3 |
| Xóa `CharacterSelector`, `StatsRadar`, `MemberActionModal`, `authRole.ts`, `profileUtils.ts`, `character/types/index.ts` | Không nơi nào import (trùng với code mới hoặc bị thay thế) |
| Xóa migration `20260601_team_challenges.sql` | Chưa từng chạy trên production (không có bảng `challenge_teams`), mâu thuẫn với schema thật. Mô hình đội sẽ làm lại ở migration 000600 |
| `lib/` → `model/` (character, profile); `club/api.ts` → `club/api/clubApi.ts`; `referral/api.ts` → `referral/api/referralApi.ts`; `shared/lib/adminConfig.ts` → `features/admin/model/` | Mọi module có cùng bố cục |
| `ClubTab` → `ClubsScreen`, `AdminTab` → `AdminScreen` | Thống nhất tên màn hình |
| Thêm `index.ts` cho mọi module, `integrations/server.ts`; `app/` chỉ import qua cổng | Ranh giới rõ ràng, ESLint chặn import sâu |
