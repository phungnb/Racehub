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
app/                    Route: chỉ ghép màn hình
features/<module>/      Nghiệp vụ. index.ts là cổng công khai duy nhất
  api/ · model/ · hooks/ · components/
shared/                 ui/ (design system) · lib/ · config/ · types/
supabase/migrations/    Mọi thay đổi DB
tests/db/               Test migration + RLS trên PGlite
docs/                   Định hướng, kế hoạch, cấu trúc, triển khai, kiến trúc
```

Chi tiết và luật ranh giới (ESLint kiểm tra): [docs/CAU_TRUC_THU_MUC.md](docs/CAU_TRUC_THU_MUC.md).

## Tài liệu chính

| File | Nội dung |
|---|---|
| [DINH_HUONG_SAN_PHAM.md](docs/DINH_HUONG_SAN_PHAM.md) | Ba trụ cột: game hóa · thử thách cá nhân và đồng đội · CLB thay nhóm Zalo |
| [KE_HOACH_HOAN_THIEN.md](docs/KE_HOACH_HOAN_THIEN.md) | Kế hoạch từng sprint, từng việc, mốc phát hành |
| [HUONG_DAN_TRIEN_KHAI.md](docs/HUONG_DAN_TRIEN_KHAI.md) | Biến môi trường, migration, deploy |

## Nguyên tắc

- **Client không ghi tài sản** (Xu, XP, cấp độ, tiến độ). Mọi thay đổi có giá trị đi qua RPC dùng `auth.uid()`. Xem [ADR-003](docs/architecture/adr/003-commands-as-rpc.md).
- **Secret chỉ ở server** (`shared/config/env.server.ts`), không dùng tiền tố `NEXT_PUBLIC_`.
- **Component không gọi `supabase` trực tiếp.** Gọi qua `features/*/api` và TanStack Query.
- **Ngoài module chỉ import qua `@/features/<module>`** (hoặc `@/features/<module>/server` cho code server).
- **Chỉ dùng token màu** (`bg-surface`, `text-brand`…), không dùng mã màu cứng.

Tài liệu đầy đủ: [docs/architecture](docs/architecture/README.md).
