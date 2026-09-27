'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Building2, Check, Crown, Minus, Users } from 'lucide-react'
import { ErrorState, SegmentedControl, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatVnd } from '@/shared/lib/economy'
import { formatNumber } from '@/shared/lib/format'
import { routes } from '@/shared/config/routes'
import { getPlanCompare, type ComparePlan, type PlanCompareData } from '../api/billingApi'

type Tab = 'runner' | 'club' | 'org'
/** Ô trong bảng: true = có, false = không, chuỗi = giá trị cụ thể */
type Cell = boolean | string
interface Row { label: string; cells: Cell[] }

const monthly = (p: ComparePlan | undefined) => p?.prices.find((x) => x.months === 1)?.price_vnd
const yearly = (p: ComparePlan | undefined) => p?.prices.find((x) => x.months === 12)?.price_vnd
const priceCell = (p: ComparePlan | undefined): string => {
  const m = monthly(p), y = yearly(p)
  if (m != null) return `${formatVnd(m)}/tháng`
  if (y != null) return `${formatVnd(y)}/năm`
  return 'Liên hệ'
}
/** Lượt tạo thử thách mỗi tháng: "2 × ≤20 người, 1 × ≤50 người" */
const creditsCell = (p: ComparePlan): Cell =>
  p.credits.length ? p.credits.map((c) => `${c.per_month} × ≤${formatNumber(c.capacity)} người`).join(', ') : false

function runnerRows(vip: ComparePlan[]): Row[] {
  const all = (v: Cell) => [v, ...vip.map(() => v)]
  return [
    { label: 'Giá', cells: ['0 ₫', ...vip.map(priceCell)] },
    { label: 'Ghi bài GPS / Strava, Xu, XP, cấp độ, huy hiệu', cells: all(true) },
    { label: 'Tham gia thử thách, CLB, giải chạy ảo, tổ chức', cells: all(true) },
    { label: 'Tạo thử thách (trả Xu theo quy mô)', cells: all(true) },
    { label: 'Lượt tạo thử thách miễn phí mỗi tháng', cells: [false, ...vip.map(creditsCell)] },
    { label: 'Phân tích nâng cao (xu hướng, kỷ lục, pace)', cells: [false, ...vip.map(() => true)] },
    { label: 'Tăng km, XP hay thứ hạng', cells: all(false) },
  ]
}

function clubRows(d: PlanCompareData, pro: ComparePlan | undefined): Row[] {
  const c = d.club
  return [
    { label: 'Giá', cells: ['0 ₫', priceCell(pro)] },
    { label: 'Số thành viên', cells: [c.freeMaxMembers ? `Tối đa ${formatNumber(c.freeMaxMembers)}` : 'Không giới hạn', 'Không giới hạn'] },
    { label: 'Quản trị viên (ngoài chủ nhiệm)', cells: [`Tối đa ${d.free_captains}`, 'Không giới hạn'] },
    { label: 'Thử thách nội bộ miễn phí cùng lúc', cells: [String(c.freeMaxOpen), String(c.proMaxOpen)] },
    { label: 'Quy mô mỗi thử thách miễn phí', cells: [`≤ ${formatNumber(c.freeMaxSlots)} người`, `≤ ${formatNumber(c.proMaxSlots)} người`] },
    { label: 'Điều kiện tạo miễn phí', cells: [`≥ ${c.freeMinActiveMembers} thành viên có bài chạy trong ${c.activeWindowDays} ngày`, 'Không cần'] },
    { label: 'Bảng tin, chat, lịch, điểm danh QR, quỹ VietQR', cells: [true, true] },
    { label: 'Bảng xếp hạng, ngày hội ×2/×3, đại sảnh danh vọng', cells: [true, true] },
    { label: 'Cửa hàng CLB, giao lưu CLB', cells: [true, true] },
    { label: 'Tường nhà: ảnh bìa, khẩu hiệu, chủ đề màu', cells: [false, true] },
    { label: 'Link mời riêng + trang công khai /c/tên-clb', cells: [false, true] },
    { label: 'Báo cáo chuyên cần xuất Excel', cells: [false, true] },
    { label: 'Ảnh vinh danh thử thách theo mẫu CLB', cells: [false, true] },
  ]
}

function CellView({ v }: { v: Cell }) {
  if (v === true) return <Check className="mx-auto size-5 text-brand" aria-label="Có" />
  if (v === false) return <Minus className="mx-auto size-4 text-fg-subtle" aria-label="Không" />
  return <span className="text-xs font-semibold">{v}</span>
}

function Table({ heads, rows, highlight }: { heads: string[]; rows: Row[]; highlight: number }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[20rem] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 bg-bg p-2 text-left text-xs font-medium text-fg-muted">Quyền lợi</th>
            {heads.map((h, i) => (
              <th key={h} scope="col" className={cn('p-2 text-center text-xs font-bold', i === highlight && 'rounded-t-xl bg-coin/15 text-coin')}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row" className="sticky left-0 z-10 max-w-[11rem] border-t border-border bg-bg p-2 text-left text-xs font-medium leading-snug">{r.label}</th>
              {r.cells.map((c, i) => (
                <td key={i} className={cn('border-t border-border p-2 text-center align-middle', i === highlight && 'bg-coin/10')}><CellView v={c} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Perks({ plan }: { plan: ComparePlan }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-3">
      <p className="flex items-center gap-1.5 text-sm font-bold"><Crown className="size-4 text-coin" aria-hidden />{plan.name}
        <span className="ml-auto font-mono text-xs font-semibold text-fg-muted">{priceCell(plan)}</span></p>
      {plan.description && <p className="text-xs text-fg-muted">{plan.description}</p>}
      <ul className="mt-2 space-y-1">
        {plan.perks.map((p) => <li key={p} className="flex gap-2 text-xs"><Check className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />{p}</li>)}
      </ul>
      {yearly(plan) != null && monthly(plan) != null && (
        <p className="mt-2 text-[11px] text-fg-subtle">Trả theo năm: {formatVnd(yearly(plan)!)} (≈ {formatVnd(Math.round(yearly(plan)! / 12))}/tháng)</p>
      )}
    </div>
  )
}

/** So sánh Miễn phí · VIP · CLB Pro · Doanh nghiệp — giá và hạn mức lấy từ cấu hình admin, không viết cứng */
export function PlanCompare({ signedIn = true }: { signedIn?: boolean }) {
  const [tab, setTab] = useState<Tab>('runner')
  const q = useQuery({ queryKey: ['billing', 'compare'], queryFn: getPlanCompare, staleTime: 10 * 60_000 })
  if (q.isPending) return <Skeleton className="h-96" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const vip = q.data.plans.filter((p) => p.owner_type === 'USER').sort((a, b) => a.tier - b.tier)
  const pro = q.data.plans.find((p) => p.code === 'CLUB_PRO')
  const buy = signedIn ? routes.plan : `${routes.login}?next=${encodeURIComponent(routes.plan)}`

  return (
    <div className="space-y-4">
      <SegmentedControl value={tab} onChange={setTab}
        options={[{ value: 'runner', label: 'Cá nhân' }, { value: 'club', label: 'CLB' }, { value: 'org', label: 'Doanh nghiệp' }]} />

      {tab === 'runner' && (
        <>
          <Table heads={['Miễn phí', ...vip.map((p) => p.name)]} rows={runnerRows(vip)} highlight={vip.length >= 2 ? 2 : 1} />
          <p className="text-xs text-fg-muted">VIP không tăng km, XP hay thứ hạng — mọi runner thi đấu công bằng.</p>
          <div className="grid gap-2 sm:grid-cols-2">{vip.map((p) => <Perks key={p.code} plan={p} />)}</div>
          <Link href={buy} className="flex min-h-12 items-center justify-center rounded-2xl bg-coin font-bold text-brand-fg">Chọn gói VIP</Link>
        </>
      )}

      {tab === 'club' && (
        <>
          <Table heads={['CLB Miễn phí', pro?.name ?? 'CLB Pro']} rows={clubRows(q.data, pro)} highlight={1} />
          <p className="text-xs text-fg-muted">
            <Users className="mr-1 inline size-3.5" aria-hidden />CLB miễn phí đã vượt số thành viên vẫn giữ đủ người, chỉ chưa duyệt thêm người mới cho tới khi nâng Pro.
          </p>
          {pro && <Perks plan={pro} />}
          <Link href={signedIn ? routes.clubs : buy} className="flex min-h-12 items-center justify-center rounded-2xl bg-coin font-bold text-brand-fg">
            Nâng CLB Pro (Cài đặt CLB → Gói Pro)
          </Link>
        </>
      )}

      {tab === 'org' && (
        <div className="space-y-3 rounded-2xl border border-brand/30 bg-gradient-to-br from-brand/15 via-surface to-surface p-4">
          <p className="flex items-center gap-2 font-bold"><Building2 className="size-5 text-brand" aria-hidden />RaceHub Doanh nghiệp · Báo giá riêng</p>
          <ul className="space-y-1.5 text-sm">
            {['Chiến dịch sức khoẻ cho cả tổ chức (km, số buổi, số ngày chạy)', 'Xếp hạng phòng ban / chi nhánh / CLB — tổng và bình quân đầu người',
              'Tự duyệt email công ty, nhập danh sách từ Excel, đơn vị nhiều cấp', 'Báo cáo cho nhân sự theo mã nhân viên, xuất Excel',
              'Chốt kết quả, chứng nhận hoàn thành, quay thưởng minh bạch', 'Quản lý nhiều CLB, tài trợ CLB Pro cho cả hệ thống'].map((t) => (
              <li key={t} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />{t}</li>
            ))}
          </ul>
          <Link href={routes.enterprise} className="flex min-h-12 items-center justify-center rounded-2xl bg-brand font-bold text-brand-fg">Xem chi tiết & nhận báo giá</Link>
        </div>
      )}
    </div>
  )
}
