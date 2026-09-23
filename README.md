# RaceHub

Nền tảng chạy bộ xã hội: thử thách, giải chạy ảo, CLB, nhân vật và kinh tế RaceCoin.
Next.js 16 (App Router) + Supabase (Postgres, Auth, Realtime, Storage).

## Chạy local

```bash
cp .env.example .env.local   # điền giá trị thật
npm ci
npm run dev                  # http://localhost:3000
```

| Lệnh | Việc |
|---|---|
| `npm run dev` / `build` / `start` | Phát triển / build / chạy bản production |
| `npm run lint` | ESLint |
| `npm run typecheck` | Sinh type route (`next typegen`) + `tsc` |
| `npm test` | Vitest: unit test + test migration DB trên Postgres nhúng (PGlite) |
| `npm run check` | Cả ba lệnh trên (CI chạy lệnh này + build) |

## Cấu trúc

```
app/                    Route (App Router)
  (app)/                Màn hình cần đăng nhập: feed, challenges, run, clubs, me, admin
  api/                  Route server: OAuth Strava, webhook
  login, reset-password, club/join/[code], join/[code]
features/<module>/      Theo nghiệp vụ: api/ (gọi DB) · model/ (logic thuần) · components/
shared/
  ui/                   Design system (Button, Card, StatTile, EmptyState…)
  lib/                  supabase client (browser/server), format, cn, oauth-state
  config/               env (public/server), routes
supabase/migrations/    Mọi thay đổi DB đều là migration
tests/db/               Fixture + test migration
docs/architecture/      Thiết kế kiến trúc, API, CSDL, ADR
docs/HUONG_DAN_TRIEN_KHAI.md   Các bước triển khai
```

## Nguyên tắc

- **Client không ghi tài sản** (Xu, XP, cấp độ, tiến độ). Mọi thay đổi có giá trị đi qua RPC dùng `auth.uid()`. Xem [ADR-003](docs/architecture/adr/003-commands-as-rpc.md).
- **Secret chỉ ở server** (`shared/config/env.server.ts`), không dùng tiền tố `NEXT_PUBLIC_`.
- **Component không gọi `supabase` trực tiếp.** Gọi qua `features/*/api` và TanStack Query.
- **Chỉ dùng token màu** (`bg-surface`, `text-brand`…), không dùng mã màu cứng.

Tài liệu đầy đủ: [docs/architecture](docs/architecture/README.md).
