// Thành phần thương hiệu Strava theo Strava API Brand Guidelines (developers.strava.com/guidelines) — bắt buộc để qua
// vòng duyệt Developer Program: nút "Connect with Strava" màu cam, ghi "Powered by Strava" nơi hiện dữ liệu Strava,
// link "View on Strava" về bài gốc (chữ đậm / gạch chân / màu cam #FC5200). Không dùng chữ "Strava" trong tên app,
// không làm người dùng tưởng RaceHub do Strava làm.
// Trước khi chụp ảnh nộp duyệt: tải bộ nút / logo chính thức ở trang guidelines, đặt vào public/brand/strava/
// (connect-with-strava.svg, powered-by-strava.svg) — hai thành phần dưới tự dùng ảnh chính thức nếu có biến môi trường
// NEXT_PUBLIC_STRAVA_BRAND_ASSETS=1.
import { cn } from '@/shared/lib/cn'

export const STRAVA_ORANGE = '#FC5200'
const OFFICIAL = process.env.NEXT_PUBLIC_STRAVA_BRAND_ASSETS === '1'

/** Nút kết nối: luôn dẫn tới route của RaceHub, route này chuyển thẳng sang strava.com/oauth/(mobile/)authorize */
export function StravaConnectButton({ href, className, size = 'md' }: { href: string; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  if (OFFICIAL) {
    return (
      <a href={href} className={cn('inline-block', className)} aria-label="Connect with Strava">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/strava/connect-with-strava.svg" alt="Connect with Strava" className={size === 'sm' ? 'h-9' : 'h-12'} />
      </a>
    )
  }
  return (
    <a href={href} style={{ backgroundColor: STRAVA_ORANGE }}
      className={cn('inline-flex items-center justify-center rounded-lg font-bold text-white active:opacity-90',
        size === 'sm' ? 'h-9 px-3 text-sm' : size === 'lg' ? 'h-12 w-full px-4 text-base' : 'h-11 px-4 text-sm', className)}>
      Connect with Strava
    </a>
  )
}

/** Dòng thông báo ngay dưới nút kết nối: kết nối = đồng ý hiện bài cho CLB & BXH (migration 007400), tắt được trong Cài đặt */
export function StravaShareNotice({ className }: { className?: string }) {
  return (
    <p className={cn('text-[11px] leading-relaxed text-fg-subtle', className)}>
      Khi kết nối, quãng đường và thời gian bài chạy Strava của bạn hiện trên bảng tin CLB và bảng xếp hạng (bản đồ, nhịp tim chỉ bạn xem).
      Tắt bất cứ lúc nào ở Cài đặt → Quyền riêng tư.
    </p>
  )
}

/** Ghi nguồn ở mọi nơi hiện dữ liệu lấy từ Strava */
export function PoweredByStrava({ className }: { className?: string }) {
  if (OFFICIAL) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src="/brand/strava/powered-by-strava.svg" alt="Powered by Strava" className={cn('h-4', className)} />
  }
  return <span className={cn('text-[11px] font-bold tracking-wide', className)} style={{ color: STRAVA_ORANGE }}>Powered by Strava</span>
}

/** Link về bài gốc trên Strava */
export function ViewOnStrava({ activityId, className }: { activityId: string | number; className?: string }) {
  return (
    <a href={`https://www.strava.com/activities/${encodeURIComponent(String(activityId))}`} target="_blank" rel="noopener noreferrer"
      className={cn('text-sm font-bold underline', className)} style={{ color: STRAVA_ORANGE }}>
      View on Strava
    </a>
  )
}
