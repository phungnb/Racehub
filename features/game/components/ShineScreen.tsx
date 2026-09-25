'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, Heart, Info, Lock, Shield, Shirt, Sparkles, Ticket, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Card, ConfirmSheet, ErrorState, ProgressBar, ShineBadge, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin, formatNumber, formatRelative } from '@/shared/lib/format'
import { SHINE_NAMES, shineProgress } from '@/shared/lib/shine'
import { useMyProfile } from '@/features/auth'
import { routes } from '@/shared/config/routes'
import { gameErrorMessage, type ShineShopItem } from '../api/gameApi'
import { useGiftWall, useMyShine, useRedeemShine, useSendThanks } from '../hooks/useGame'
import { setGiftWallPublic } from '../api/gameApi'
import { useMutation, useQueryClient } from '@tanstack/react-query'

const KIND_ICON = { PASS: Ticket, SHIELD: Shield, COSMETIC: Shirt } as const

/** Lý do chưa đổi được (null = đổi được) */
export function redeemBlock(i: ShineShopItem, available: number, senders: number) {
  if (i.kind === 'COSMETIC' && i.item?.owned) return 'Đã có'
  if (i.period_limit != null && i.used >= i.period_limit) return `Đã đổi ${i.used}/${i.period_limit} ${i.limit_period === 'WEEK' ? 'tuần này' : 'tháng này'}`
  if (i.min_senders > senders) return `Cần quà từ ${i.min_senders} người khác nhau (30 ngày) — đang có ${senders}`
  if (available < i.cost) return `Còn thiếu ${formatNumber(i.cost - available)} Tỏa sáng`
  return null
}

/** Ví Tỏa sáng: quà nhận được → danh tiếng (khung ảnh đại diện) + ví để đổi quyền lợi */
export function ShineScreen() {
  const q = useMyShine()
  const { profile } = useMyProfile()
  const redeem = useRedeemShine()
  const thanks = useSendThanks()
  const [pick, setPick] = useState<ShineShopItem | null>(null)
  const [rules, setRules] = useState(false)

  if (q.isPending) return <div className="space-y-3"><Skeleton className="h-48" /><Skeleton className="h-64" /></div>
  if (q.isError) return <ErrorState message={gameErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
  const s = q.data
  const p = shineProgress(s.total, s.tiers)

  return (
    <div className="space-y-4 animate-fade-in">
      <Link href={routes.me} className="inline-flex items-center gap-1 text-sm text-fg-muted"><ChevronLeft className="size-4" aria-hidden />Tôi</Link>

      <Card className="space-y-4 overflow-hidden bg-gradient-to-br from-coin/15 via-surface to-surface">
        <div className="flex items-center gap-4">
          <Avatar src={profile?.avatar_url} name={profile?.display_name} size="xl" shine={s.tier} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">Tỏa sáng tích lũy</p>
            <p className="font-mono text-3xl font-black text-coin">{formatCoin(s.total)}</p>
            {s.tier > 0 ? <ShineBadge tier={s.tier} /> : <p className="text-xs text-fg-muted">Nhận quà để có khung Tỏa sáng</p>}
          </div>
        </div>
        {p ? (
          <div className="space-y-1">
            <ProgressBar value={p.value} max={p.span} />
            <p className="text-xs text-fg-muted">Còn <b className="font-mono text-fg">{formatNumber(p.remaining)}</b> tới bậc <b className="text-fg">{SHINE_NAMES[p.next]}</b> — khung ảnh đại diện sẽ rực hơn</p>
          </div>
        ) : <p className="text-xs text-fg-muted">Bạn đã ở bậc cao nhất: Huyền thoại 👑</p>}
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Khả dụng để đổi" value={formatCoin(s.available)} accent />
          <Stat label="Người hâm mộ" value={formatNumber(s.fans)} />
          <Stat label="Người tặng 30 ngày" value={formatNumber(s.senders_30d)} />
        </div>
        <button type="button" onClick={() => setRules((v) => !v)} className="flex items-center gap-1.5 text-xs font-semibold text-fg-muted" aria-expanded={rules}>
          <Info className="size-3.5" aria-hidden />Cách tính Tỏa sáng
        </button>
        {rules && (
          <ul className="list-disc space-y-1 pl-5 text-xs text-fg-muted">
            <li>Tích lũy = tổng giá trị quà bạn nhận. Con số này <b>không giảm</b> khi đổi quà và quyết định khung ảnh đại diện.</li>
            <li>Khả dụng = phần dùng để đổi. Mỗi người tặng góp tối đa {formatNumber(s.per_sender_weekly_cap)} mỗi tuần; chỉ tính người tặng đã chạy trên RaceHub ít nhất 14 ngày và 3 bài.</li>
            <li>Tỏa sáng không mua được, không chuyển cho người khác được.</li>
          </ul>
        )}
      </Card>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-coin" aria-hidden />Đổi Tỏa sáng</h2>
        {s.shop.map((i) => {
          const Icon = KIND_ICON[i.kind]
          const block = redeemBlock(i, s.available, s.senders_30d)
          return (
            <Card key={i.code} className="flex items-center gap-3 p-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-coin/10 text-coin"><Icon className="size-5" aria-hidden /></span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{i.name}</p>
                <p className="text-xs text-fg-muted">{i.description ?? (i.item ? 'Vật phẩm nhân vật chỉ có ở đây — không bán bằng Xu' : '')}</p>
                {block && <p className="mt-0.5 flex items-center gap-1 text-[11px] text-fg-subtle"><Lock className="size-3" aria-hidden />{block}</p>}
              </div>
              <Button size="sm" variant={block ? 'secondary' : 'coin'} disabled={!!block} onClick={() => setPick(i)}>
                <Sparkles className="size-3.5" aria-hidden />{formatNumber(i.cost)}
              </Button>
            </Card>
          )
        })}
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 font-semibold"><Heart className="size-4 text-danger" aria-hidden />Người đã tiếp sức bạn
          <span className="ml-auto text-xs font-normal text-fg-muted">Còn {s.thanks_left} lời cảm ơn hôm nay</span></h2>
        {s.supporters.length ? (
          <Card className="divide-y divide-border p-0">
            {s.supporters.map((u) => (
              <div key={u.user_id} className="flex items-center gap-3 px-3 py-2.5">
                <Avatar src={u.avatar_url} name={u.display_name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{u.display_name ?? 'Runner'}</p>
                  <p className="text-xs text-fg-muted">{formatCoin(u.amount)} Tỏa sáng · {formatRelative(u.last_at)}</p>
                </div>
                <Button size="sm" variant="secondary" disabled={u.thanked_today || s.thanks_left <= 0 || thanks.isPending}
                  onClick={() => thanks.mutate(u.user_id, { onSuccess: () => toast.success(`Đã gửi lời cảm ơn tới ${u.display_name ?? 'runner'} 💛`), onError: (e) => toast.error(gameErrorMessage(e)) })}>
                  {u.thanked_today ? 'Đã cảm ơn' : 'Cảm ơn 💛'}
                </Button>
              </div>
            ))}
          </Card>
        ) : <p className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-4 text-sm text-fg-muted"><Users className="size-4" aria-hidden />Chưa có ai tặng quà trong 30 ngày. Chạy và chia sẻ bài chạy để được tiếp sức!</p>}
      </section>

      {profile?.id && <WallPrivacy userId={profile.id} />}

      {s.history.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">Đã đổi</h2>
          <ul className="space-y-1 text-sm">
            {s.history.map((h, i) => (
              <li key={i} className="flex justify-between gap-2 text-fg-muted"><span>{h.name} · {formatRelative(h.at)}</span><span className="font-mono">−{formatNumber(h.cost)}</span></li>
            ))}
          </ul>
        </section>
      )}

      <ConfirmSheet open={!!pick} onClose={() => setPick(null)} danger={false} loading={redeem.isPending}
        title={pick ? `Đổi ${pick.name}?` : ''} confirmLabel={pick ? `Đổi ${formatNumber(pick.cost)} Tỏa sáng` : ''}
        description={pick ? `Tỏa sáng khả dụng còn ${formatNumber(s.available - pick.cost)} sau khi đổi. Tỏa sáng tích lũy và khung ảnh đại diện giữ nguyên.` : undefined}
        onConfirm={() => pick && redeem.mutate({ code: pick.code, key: `shine-${pick.code}-${Date.now()}` }, {
          onSuccess: (r) => { toast.success(`Đã đổi ${r.name}`, { description: pick.kind === 'PASS' ? 'Lượt tạo đã vào mục Lượt tạo của bạn — dùng khi tạo thử thách.' : pick.kind === 'COSMETIC' ? 'Vật phẩm đã vào Tủ đồ.' : undefined }); setPick(null) },
          onError: (e) => toast.error(gameErrorMessage(e)),
        })} />
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-bg/50 px-2 py-2">
      <p className={cn('font-mono text-lg font-bold', accent && 'text-coin')}>{value}</p>
      <p className="text-[11px] text-fg-muted">{label}</p>
    </div>
  )
}

/** Ẩn / hiện tường quà với người khác (bậc Tỏa sáng và khung ảnh vẫn hiện) */
function WallPrivacy({ userId }: { userId: string }) {
  const qc = useQueryClient()
  const wall = useGiftWall(userId)
  const m = useMutation({
    mutationFn: (v: boolean) => setGiftWallPublic(userId, v),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['game', 'gift-wall', userId] }); toast.success('Đã lưu') },
    onError: (e) => toast.error(gameErrorMessage(e)),
  })
  if (!wall.data) return null
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-3 text-sm">
      <span>
        <span className="block font-semibold">Hiện tường quà công khai</span>
        <span className="block text-xs text-fg-muted">Tắt thì người khác chỉ thấy bậc Tỏa sáng, không thấy quà và người tặng.</span>
      </span>
      <input type="checkbox" checked={wall.data.public} disabled={m.isPending} onChange={(e) => m.mutate(e.target.checked)} className="size-5 accent-[var(--color-brand)]" />
    </label>
  )
}
