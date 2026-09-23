# Kiến trúc Frontend & Design System

## 1. Vì sao giao diện hiện tại "chưa chuyên nghiệp"

Nguyên nhân chủ yếu nằm ở cấu trúc và sự nhất quán, không phải ở màu sắc:

| Triệu chứng | Nguyên nhân gốc | Cách sửa |
|---|---|---|
| Không có URL cho từng màn hình, nút Back của trình duyệt/điện thoại thoát app, không chia sẻ link thử thách được | Cả app là 1 trang, tab lưu trong `useState` (`app/page.tsx`) | Mỗi màn hình là một route của App Router (§3) |
| Màu sắc lệch giữa các màn hình (`slate-950`/`orange-500` ở trang chính, `#18191a`/`#2f3031` ở Admin), cỡ chữ `text-[9px]`, `text-[10px]`, `text-[11px]` rải rác | Không có design token, mỗi component tự chọn giá trị | Token trong `globals.css` + bộ component chuẩn (§4) |
| Icon là emoji (🏠 🎯 ⚡ 🛡️), mỗi hệ điều hành hiển thị một kiểu | Chưa có bộ icon | `lucide-react` (đã được import ở 6 file nhưng **chưa cài**) |
| Dùng `alert()` để báo thành công/lỗi | Không có hệ thống toast / dialog | `sonner` (toast) + `Dialog` / `Sheet` (bottom sheet) |
| Màn hình trắng hoặc "Đang tải..." dạng chữ | Không có skeleton, không có trạng thái rỗng/lỗi | Mỗi màn hình có đủ 4 trạng thái: loading / empty / error / data |
| Component 300–700 dòng (`ClubTab.tsx` 714 dòng) trộn truy vấn DB với UI | Không tách tầng dữ liệu | Hook `useXxx()` bằng TanStack Query + component trình bày thuần |
| Dữ liệu có thể cũ sau khi thao tác, phải `window.location.reload()` | Không có cache và invalidation | TanStack Query `invalidateQueries` sau mutation |
| `title: "Create Next App"`, `lang="en"`, dịch tiếng Anh chỉ phủ vài chữ | Chưa thiết lập metadata/i18n | `next-intl`, metadata cho từng route, `lang="vi"` |
| Typing `any` khắp nơi, lỗi build | Không có type sinh từ DB | `supabase gen types` + Zod |

## 2. Stack đề xuất

| Nhu cầu | Thư viện | Lý do |
|---|---|---|
| Framework | Next.js 16 App Router (đang dùng) | SSR cho trang chia sẻ (thử thách, hồ sơ), route-based |
| Style | Tailwind CSS v4 (đang dùng) + CSS variables | Token tập trung, hỗ trợ dark mode |
| Component nền | **shadcn/ui** (Radix UI) | Code nằm trong repo nên sửa được; accessible sẵn (focus, ARIA, bàn phím) |
| Icon | `lucide-react` | Đồng bộ nét, tree-shake được |
| Dữ liệu server | `@tanstack/react-query` + `@supabase/ssr` | Cache, retry, optimistic update; session cookie cho Server Components |
| Form | `react-hook-form` + `zod` | Wizard 4 bước tạo thử thách; dùng chung schema với validate rules |
| Toast | `sonner` | Thay `alert()` |
| i18n | `next-intl` | vi/en, định dạng số, ngày, tiền theo locale |
| Bản đồ | `maplibre-gl` (+ tile Mapbox/MapTiler) | Mini-map, lộ trình, heatmap cộng đồng |
| Biểu đồ | `recharts` | Pace/HR (MH 17), thống kê tuần/tháng |
| Hiệu ứng | `motion` (framer-motion) | Cheer, level up, nút "Breath" (MH 4) |
| 3D avatar | `three` + `@react-three/fiber` (đang dùng) | **Lazy-load** (`next/dynamic`, `ssr:false`), fallback ảnh 2D |
| Poster chia sẻ | `@vercel/og` (route `/api/og/...`) | Sinh ảnh MH 18 phía server |
| PWA | `serwist` | Cài lên màn hình chính, offline shell, Web Push |
| Chất lượng | ESLint, Prettier, Vitest, Playwright, Storybook (tùy chọn) | |

## 3. Cấu trúc thư mục và route

```
app/
  (marketing)/                  # trang công khai, SSR, SEO
    page.tsx                    # landing
    c/[slug]/page.tsx           # trang chia sẻ thử thách (Open Graph)
    u/[handle]/page.tsx         # hồ sơ công khai
  (auth)/
    login/page.tsx              # MH 1
    onboarding/
      connect/page.tsx          # MH 2 Device Sync
      avatar/page.tsx           # MH 3
      ready/page.tsx            # MH 4
  (app)/                        # cần đăng nhập — layout có TopBar + BottomTabBar
    layout.tsx
    feed/page.tsx               # MH 5  (Tab 1)
    feed/[activityId]/page.tsx  # MH 6
    notifications/page.tsx      # MH 7
    search/page.tsx             # MH 8
    leaderboard/page.tsx        # MH 9
    challenges/page.tsx         # MH 10 (Tab 2)
    challenges/new/page.tsx     # MH 13 wizard
    challenges/[id]/page.tsx    # MH 11
    challenges/[id]/leaderboard/page.tsx   # MH 12
    challenges/[id]/join/page.tsx          # MH 14 (hoặc intercepting route dạng sheet)
    run/page.tsx                # MH 15 (Tab 3)
    run/[activityId]/verify/page.tsx       # MH 16
    run/[activityId]/summary/page.tsx      # MH 17
    run/[activityId]/share/page.tsx        # MH 18
    hub/page.tsx                # Tab 4: Shop, Club, Coach
    hub/shop/page.tsx           # MH 19
    clubs/[id]/page.tsx
    clubs/[id]/treasury/page.tsx           # MH 21
    clubs/[id]/manage/page.tsx             # MH 22
    me/page.tsx                 # MH 24 (Tab 5)
    me/wallet/page.tsx          # MH 25
    me/inventory/page.tsx       # MH 26
    me/log/page.tsx             # MH 27
    me/settings/page.tsx        # MH 28
    chat/page.tsx, chat/[id]/page.tsx      # MH 9 Chat Center
  admin/                        # Web Dashboard — layout sidebar, desktop-first
  organizer/
  api/                          # Route Handlers (webhook, OAuth, OG image, export)

features/<module>/
  api/        # hàm gọi RPC/query có type — KHÔNG import React
  hooks/      # useChallenge(id), useJoinChallenge() — TanStack Query
  components/ # UI riêng của module
  model/      # zod schema, hằng số, hàm thuần (tính pace, format)
  index.ts    # public API của module — module khác chỉ import từ đây

shared/
  ui/         # design system: Button, Card, Sheet, Tabs, Avatar, StatTile, Skeleton, EmptyState…
  lib/        # supabase (browser/server), errors.ts, format.ts, query-client.ts
  types/      # database.ts (sinh tự động)
  config/     # routes.ts, env.ts (zod validate biến môi trường)
messages/     # vi.json, en.json
```

Quy tắc import (khuyến nghị kiểm tra bằng ESLint `import/no-restricted-paths`):
- `shared` không import `features`.
- Feature A chỉ import feature B qua `features/B/index.ts`.
- Component không gọi `supabase.*` trực tiếp. Chỉ `features/*/api` được gọi.

## 4. Design System

### 4.1 Định hướng thị giác (theo tài liệu màn hình)

"Dark mode sâu + điểm nhấn **Action Green** neon + họa tiết hexagon công nghệ". Màu cam hiện tại được giữ làm màu phụ cho **Xu/RaceCoin**, để người dùng liên kết màu cam với tiền.

### 4.2 Token (`app/globals.css`)

```css
@import "tailwindcss";

@theme {
  /* Nền & bề mặt */
  --color-bg:          #0A0D12;
  --color-surface:     #121720;
  --color-surface-2:   #1A2130;
  --color-border:      #263042;
  /* Chữ */
  --color-fg:          #F2F5F9;
  --color-fg-muted:    #9AA6B8;
  --color-fg-subtle:   #6B7689;
  /* Thương hiệu */
  --color-brand:       #B6FF3B;   /* Action Green */
  --color-brand-fg:    #0A0D12;   /* chữ trên nền brand */
  --color-coin:        #FFB020;   /* Xu / RaceCoin */
  --color-xp:          #7C9CFF;   /* XP */
  --color-live:        #FF3B5C;   /* LIVE badge */
  /* Trạng thái */
  --color-success:     #22C55E;
  --color-warning:     #F59E0B;
  --color-danger:      #EF4444;
  /* Độ hiếm vật phẩm */
  --color-rarity-common:    #9AA6B8;
  --color-rarity-rare:      #3B82F6;
  --color-rarity-epic:      #A855F7;
  --color-rarity-legendary: #F59E0B;

  --radius-sm: 8px;  --radius-md: 12px;  --radius-lg: 16px;  --radius-xl: 24px;
  --font-sans: "Be Vietnam Pro", system-ui, sans-serif;   /* hỗ trợ dấu tiếng Việt tốt */
  --font-mono: "JetBrains Mono", ui-monospace, monospace; /* số liệu: pace, km, thời gian */
}
```

Thang chữ (chỉ dùng các mức này, **không dùng `text-[9px]`**):

| Token | Size / line-height | Dùng cho |
|---|---|---|
| `display` | 40/44, font-black, mono | Số km lớn khi đang chạy, kết quả |
| `h1` | 24/32 bold | Tiêu đề màn hình |
| `h2` | 18/26 semibold | Tiêu đề section / card |
| `body` | 15/22 | Nội dung |
| `caption` | 13/18 muted | Mô tả phụ, thời gian |
| `micro` | 11/14 uppercase tracking-wide | Nhãn thống kê ("PACE TB") |

Khoảng cách dùng bội số của 4 px. Lề màn hình mobile 16 px. Vùng chạm tối thiểu **44×44 px**, đặc biệt quan trọng khi người dùng đang chạy.

### 4.3 Bộ component chuẩn (`shared/ui`)

| Nhóm | Component |
|---|---|
| Nền tảng | `Button` (primary/secondary/ghost/danger, size sm/md/lg, `loading`), `IconButton`, `Input`, `Select`, `Switch`, `Slider`, `SegmentedControl`, `Tabs`, `Badge`, `Chip` |
| Bố cục | `AppShell`, `TopBar`, `BottomTabBar` (5 tab, nút RUN nổi ở giữa), `PageHeader`, `Section`, `Card`, `List/ListItem` |
| Overlay | `Sheet` (bottom sheet cho Cheer, bộ lọc, xác nhận cược), `Dialog`, `ConfirmDialog` (double confirmation MH 14), `Toast` |
| Trạng thái | `Skeleton`, `EmptyState` (icon + lời nhắn + CTA), `ErrorState` (nút thử lại), `ProgressBar`, `ProgressRing` |
| Miền RaceHub | `CoinAmount` (icon + số, định dạng `1.250`), `XpBadge`, `LevelBadge`, `AvatarRing` (vòng LIVE phát sáng / pulse), `StatTile` (label + số mono + đơn vị), `PaceText`, `DurationText`, `ActivityCard`, `ChallengeCard`, `LeaderboardRow` (hạng, avatar, giá trị, chênh lệch, trạng thái chờ duyệt xám), `RarityFrame`, `HoldButton` (giữ 3 giây để dừng, MH 15), `WizardStepper`, `MiniMap` |

### 4.4 Mẫu màn hình chuẩn

Mọi màn hình đều theo khung sau:

```tsx
export default function ChallengesPage() {
  const t = useTranslations('challenges')
  const q = useChallenges({ tab })              // TanStack Query
  return (
    <AppShell title={t('title')} actions={<WalletChip />}>
      <SegmentedControl … />
      {q.isPending && <ChallengeCard.Skeleton count={4} />}
      {q.isError   && <ErrorState onRetry={q.refetch} />}
      {q.data?.length === 0 && <EmptyState icon={Trophy} title={t('empty')} action={<Button asChild><Link href="/challenges/new">{t('create')}</Link></Button>} />}
      {q.data?.map(c => <ChallengeCard key={c.id} challenge={c} />)}
    </AppShell>
  )
}
```

Mutation có xác nhận và cập nhật lạc quan (optimistic update):

```ts
export function useSendCheer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: sendCheer,                                   // features/social/api
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wallet'] })
      qc.invalidateQueries({ queryKey: ['feed'] })
      toast.success('Đã gửi cổ vũ!')
    },
    onError: (e) => toast.error(errorMessage(e)),            // từ mã lỗi RPC
  })
}
```

### 4.5 Nguyên tắc UX cho app thể thao

- **Màn hình Run (MH 15):** chữ số cực lớn, tương phản cao, có chế độ "chạy ban đêm". Nút dừng dạng giữ 3 giây. Giữ màn hình sáng (`navigator.wakeLock`). Voice coach dùng `speechSynthesis` (tiếng Việt).
- **Tiền và cược:** luôn hiển thị số dư trước/sau (MH 14) và có checkbox cam kết. Nếu không đủ Xu, nút chuyển thành "Nạp thêm Xu". Không bao giờ trừ Xu mà thiếu bước xác nhận.
- **Phản hồi tức thì:** Cheer, like, join dùng optimistic update rồi rollback khi lỗi.
- **Quyền riêng tư:** mặc định ẩn 200 m đầu/cuối lộ trình. Chế độ Live chia sẻ vị trí phải bật riêng.
- **Truy cập (a11y):** tương phản tối thiểu 4.5:1 (xanh neon trên nền tối đạt yêu cầu; **không** dùng chữ trắng trên nền neon). Tôn trọng `prefers-reduced-motion` cho hiệu ứng Cheer.
- **Hiệu năng:** trang 3D avatar và bản đồ được lazy-load. Ảnh dùng `next/image`. Mục tiêu LCP < 2.5 s trên 4G.

## 5. Kế hoạch làm lại frontend (song song với backend GĐ 0–2)

1. **Nền móng (2–3 ngày):** cài `lucide-react`, shadcn/ui, TanStack Query, next-intl, sonner; đặt token; tạo `AppShell`, `BottomTabBar`, route groups; chuyển 5 tab hiện có sang route mà **giữ nguyên nội dung**.
2. **Tầng dữ liệu (2–3 ngày):** sinh type DB; chuyển các lời gọi `supabase` trong component sang `features/*/api` + hooks.
3. **Làm lại từng cụm màn hình:** thứ tự ưu tiên Onboarding (MH 1–4) → Run (15–17) → Challenge (10–14) → Feed (5–7) → Profile/Wallet/Inventory (24–26) → Club (21–22).
4. **Hoàn thiện:** PWA, OG image chia sẻ, Playwright test cho luồng onboarding / tham gia thử thách / cheer.
