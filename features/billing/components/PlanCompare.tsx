'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Building2, Check, Crown, Shield, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button, ErrorState, Sheet, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatVnd } from '@/shared/lib/economy'
import { formatNumber } from '@/shared/lib/format'
import { routes } from '@/shared/config/routes'
import { billingErrorMessage, getManagedClubs, getPlanCompare, MONTH_LABEL, type ComparePlan, type Order, type PlanCompareData } from '../api/billingApi'
import { useActiveSales, useCreateOrder, useMyPlan } from '../hooks/useBilling'
import { bestSale, salePrice } from '../model/sale'
import { OrderSheet } from './OrderSheet'

const creditLine = (p: ComparePlan) =>
  p.credits.length ? `Lượt tạo thử thách miễn phí mỗi tháng: ${p.credits.map((c) => `${c.per_month} × ≤${formatNumber(c.capacity)} người`).join(', ')}` : null

function Perks({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((t) => <li key={t} className="flex gap-2 text-sm"><Check className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />{t}</li>)}
    </ul>
  )
}

function PlanCard({ title, badge, description, perks, tone, current, action }: {
  title: string; badge?: string; description?: string | null; perks: string[]; tone: 'free' | 'vip' | 'pro' | 'org'; current?: boolean; action?: React.ReactNode
}) {
  const TONE = { free: 'border-border bg-surface', vip: 'border-coin/40 bg-gradient-to-br from-coin/10 to-surface', pro: 'border-brand/40 bg-gradient-to-br from-brand/10 to-surface', org: 'border-sky-500/40 bg-gradient-to-br from-sky-500/10 to-surface' }
  return (
    <div className={cn('space-y-3 rounded-2xl border p-4', TONE[tone])}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-base font-bold">{tone !== 'free' && <Crown className={cn('size-4', tone === 'vip' ? 'text-coin' : tone === 'pro' ? 'text-brand' : 'text-sky-400')} aria-hidden />}{title}
            {badge && <span className="rounded bg-surface-2 px-1.5 text-[11px] font-semibold text-fg-muted">{badge}</span>}</p>
          {description && <p className="text-xs text-fg-muted">{description}</p>}
        </div>
        {current && <span className="shrink-0 rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-bold text-brand">Đang dùng</span>}
      </div>
      <Perks items={perks} />
      {action}
    </div>
  )
}

/** Khung "Nâng cấp": giá theo kỳ hạn (admin sửa ở Quản trị → Gói), đang khuyến mãi thì gạch giá cũ — cùng cách máy chủ tính khi tạo đơn */
function UpgradeSheet({ plan, clubMode, onClose }: { plan: ComparePlan; clubMode: boolean; onClose: () => void }) {
  const sales = useActiveSales()
  const create = useCreateOrder()
  const clubs = useQuery({ queryKey: ['billing', 'managed-clubs'], queryFn: getManagedClubs, enabled: clubMode })
  const prices = plan.prices
  const [months, setMonths] = useState(() => prices.find((p) => p.months === 12)?.months ?? prices[0]?.months ?? 1)
  const [clubId, setClubId] = useState<string | null>(null)
  const [order, setOrder] = useState<Order | null>(null)
  const sale = bestSale(sales.data ?? [], 'PLAN', plan.code)
  const monthly = prices.find((p) => p.months === 1)?.price_vnd
  const chosen = prices.find((p) => p.months === months)
  const club = clubMode ? (clubs.data ?? []).find((c) => c.id === clubId) ?? (clubs.data?.length === 1 ? clubs.data[0] : undefined) : undefined
  const buy = async () => {
    if (!chosen || (clubMode && !club)) return
    try { setOrder(await create.mutateAsync({ kind: 'PLAN', plan_code: plan.code, months: chosen.months, club_id: club?.id ?? null })) }
    catch (e) { toast.error(billingErrorMessage(e)) }
  }
  if (order) return <OrderSheet order={order} onClose={() => { setOrder(null); onClose() }} />
  return (
    <Sheet open onClose={onClose} title={`Nâng cấp ${plan.name}`} description="Chọn kỳ hạn. Thanh toán chuyển khoản VietQR, gói bật sau khi RaceHub xác nhận."
      footer={<Button block variant="coin" loading={create.isPending} disabled={!chosen || (clubMode && !club)} onClick={() => void buy()}>
        Thanh toán{chosen ? ` · ${formatVnd(salePrice(chosen.price_vnd, sale))}` : ''}</Button>}>
      <div className="space-y-3">
        {sale && (
          <p className="rounded-xl border border-danger/40 bg-danger/10 p-2.5 text-sm"><b>{sale.title}</b>
            {sale.discount_pct ? ` — giảm ${sale.discount_pct}%` : ''}{sale.ends_at ? ` · đến ${new Date(sale.ends_at).toLocaleDateString('vi-VN')}` : ''}</p>
        )}
        {clubMode && (
          <div className="space-y-1.5">
            <p className="text-sm font-semibold">CLB nâng cấp</p>
            {clubs.isPending ? <Skeleton className="h-11" /> : !clubs.data?.length ? (
              <p className="rounded-xl bg-surface-2 p-3 text-sm text-fg-muted">Bạn cần là chủ nhiệm hoặc quản trị viên của một CLB để nâng CLB Pro.</p>
            ) : (
              <div className="grid gap-1.5" role="radiogroup" aria-label="Chọn CLB">
                {clubs.data.map((c) => (
                  <button key={c.id} type="button" role="radio" aria-checked={club?.id === c.id} onClick={() => setClubId(c.id)}
                    className={cn('flex min-h-11 items-center justify-between rounded-xl border px-3 text-left text-sm', club?.id === c.id ? 'border-brand bg-brand/10' : 'border-border')}>
                    <span className="truncate font-semibold">{c.name}</span>
                    {c.pro && <span className="text-[11px] font-semibold text-brand">Đang Pro · gia hạn</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {!prices.length ? <p className="text-sm text-fg-muted">Gói này đang tạm ngừng bán.</p> : (
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Kỳ hạn">
            {prices.map((p) => {
              const final = salePrice(p.price_vnd, sale)
              const save = monthly && p.months > 1 ? Math.round((1 - p.price_vnd / (monthly * p.months)) * 100) : 0
              return (
                <button key={p.months} type="button" role="radio" aria-checked={months === p.months} onClick={() => setMonths(p.months)}
                  className={cn('rounded-xl border p-2.5 text-left', months === p.months ? 'border-coin bg-coin/10' : 'border-border')}>
                  <span className="block text-sm font-semibold">{MONTH_LABEL[p.months] ?? `${p.months} tháng`}</span>
                  <span className="block font-mono text-sm font-bold">{formatVnd(final)}</span>
                  {final < p.price_vnd && <span className="block font-mono text-xs text-fg-subtle line-through">{formatVnd(p.price_vnd)}</span>}
                  {save > 0 && <span className="text-[11px] font-semibold text-brand">tiết kiệm {save}% so với trả tháng</span>}
                </button>
              )
            })}
          </div>
        )}
        <p className="text-xs text-fg-subtle">Gia hạn khi còn hạn được cộng nối tiếp. RaceHub không giữ tiền của thành viên; đơn hết hạn nếu chưa chuyển khoản.</p>
      </div>
    </Sheet>
  )
}

/** Gói & quyền lợi: thẻ xếp dọc Cá nhân → CLB → Doanh nghiệp, chỉ nêu quyền lợi; bấm Nâng cấp mới hiện giá (kèm khuyến mãi) */
export function PlanCompare({ signedIn = true }: { signedIn?: boolean }) {
  const q = useQuery({ queryKey: ['billing', 'compare'], queryFn: getPlanCompare, staleTime: 10 * 60_000 })
  const mine = useMyPlan()
  const [upgrade, setUpgrade] = useState<{ plan: ComparePlan; club: boolean } | null>(null)
  if (q.isPending) return <Skeleton className="h-96" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const d: PlanCompareData = q.data
  const vip = d.plans.filter((p) => p.owner_type === 'USER').sort((a, b) => a.tier - b.tier)
  const pro = d.plans.find((p) => p.code === 'CLUB_PRO')
  const myCode = signedIn ? mine.data?.plan?.plan_code ?? null : null
  const login = `${routes.login}?next=${encodeURIComponent(routes.plans)}`
  const upgradeBtn = (plan: ComparePlan, club: boolean, label: string) => signedIn
    ? <Button block variant={club ? 'primary' : 'coin'} onClick={() => setUpgrade({ plan, club })}>{label}</Button>
    : <Link href={login} className="flex h-11 items-center justify-center rounded-xl bg-coin text-sm font-bold text-brand-fg">Đăng nhập để nâng cấp</Link>
  const c = d.club

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-bold"><Crown className="size-5 text-coin" aria-hidden />Cá nhân</h2>
        <PlanCard tone="free" title="Miễn phí" current={signedIn && !myCode} perks={[
          'Ghi bài bằng GPS trong app hoặc tự động từ Strava', 'Xu, XP, cấp độ, huy hiệu, nhiệm vụ, nhân vật',
          'Tham gia thử thách, CLB, giải chạy ảo, tổ chức không giới hạn', 'Tạo thử thách (trả Xu theo quy mô)',
        ]} />
        {vip.map((p) => (
          <PlanCard key={p.code} tone="vip" title={p.name} badge={`VIP${p.tier}`} description={p.description} current={myCode === p.code}
            perks={[...(creditLine(p) ? [creditLine(p)!] : []), ...p.perks.filter((x) => !/lượt tạo/i.test(x) || !p.credits.length)]}
            action={upgradeBtn(p, false, myCode === p.code ? 'Gia hạn' : 'Nâng cấp')} />
        ))}
        <p className="text-xs text-fg-muted">VIP không tăng km, XP hay thứ hạng — mọi runner thi đấu công bằng.</p>
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-bold"><Shield className="size-5 text-brand" aria-hidden />Câu lạc bộ</h2>
        <PlanCard tone="free" title="CLB Miễn phí" perks={[
          c.freeMaxMembers ? `Tối đa ${formatNumber(c.freeMaxMembers)} thành viên` : 'Không giới hạn thành viên',
          `${c.freeMaxOpen} thử thách nội bộ miễn phí cùng lúc, mỗi thử thách ≤ ${formatNumber(c.freeMaxSlots)} người (cần ≥ ${c.freeMinActiveMembers} thành viên có bài chạy trong ${c.activeWindowDays} ngày)`,
          `Tối đa ${d.free_captains} quản trị viên`, 'Bảng tin, chat, lịch, điểm danh QR, quỹ VietQR, bảng xếp hạng',
          'Ngày hội ×2/×3, đại sảnh danh vọng, cửa hàng CLB, giao lưu CLB',
        ]} />
        {pro && (
          <PlanCard tone="pro" title={pro.name} description={pro.description} perks={[
            ...pro.perks,
            ...(pro.perks.some((x) => /cùng lúc/.test(x)) ? [] : [`${c.proMaxOpen} thử thách nội bộ cùng lúc, mỗi thử thách ≤ ${formatNumber(c.proMaxSlots)} người`]),
          ]} action={upgradeBtn(pro, true, 'Nâng cấp CLB Pro')} />
        )}
        <p className="flex items-start gap-1.5 text-xs text-fg-muted"><Users className="mt-0.5 size-3.5 shrink-0" aria-hidden />CLB miễn phí vượt số thành viên vẫn giữ đủ người, chỉ chưa duyệt thêm người mới cho tới khi nâng Pro.</p>
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-bold"><Building2 className="size-5 text-sky-400" aria-hidden />Doanh nghiệp · Liên đoàn · Trường học</h2>
        <PlanCard tone="org" title="RaceHub Doanh nghiệp" description="Báo giá riêng theo số người và thời hạn" perks={[
          'Chiến dịch sức khoẻ cho cả tổ chức (km, số buổi, số ngày chạy)', 'Bảng xếp hạng phòng ban / chi nhánh / CLB — tổng và bình quân đầu người',
          'Nhập danh sách nhân viên từ Excel, tự duyệt email công ty, đơn vị nhiều cấp', 'Báo cáo theo mã nhân viên, xuất Excel',
          'Chốt kết quả, chứng nhận hoàn thành, quay thưởng minh bạch', 'Quản lý nhiều CLB, tài trợ CLB Pro cho cả hệ thống',
        ]} action={<Link href={routes.enterprise} className="flex h-11 items-center justify-center rounded-xl bg-sky-500 text-sm font-bold text-white">Xem chi tiết & nhận báo giá</Link>} />
      </section>

      {upgrade && <UpgradeSheet plan={upgrade.plan} clubMode={upgrade.club} onClose={() => setUpgrade(null)} />}
    </div>
  )
}
