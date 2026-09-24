'use client'

import { Coins, History, ScrollText, Settings2, Shield, Ticket, type LucideIcon } from 'lucide-react'
import { Card, EmptyState, StatTile } from '@/shared/ui'
import { formatCoin, formatNumber, formatRelative } from '@/shared/lib/format'
import { feePolicyText, runPolicyText, xuToVnd } from '@/shared/lib/economy'
import type { AuditEntry, EconomyOverview } from '../../api/adminApi'

const ACTIONS: Record<string, { label: string; icon: LucideIcon; tone: string }> = {
  ADMIN_GRANT_XU: { label: 'Điều phối Xu', icon: Coins, tone: 'text-coin' },
  ADJUST_USER_XU: { label: 'Điều chỉnh ví', icon: Coins, tone: 'text-coin' },
  TOPUP_CLUB_FUND: { label: 'Nạp quỹ CLB', icon: Shield, tone: 'text-xp' },
  GRANT_CHALLENGE_PASS: { label: 'Tặng vé', icon: Ticket, tone: 'text-brand' },
  REVOKE_CHALLENGE_PASS: { label: 'Thu hồi vé', icon: Ticket, tone: 'text-danger' },
  PUBLISH_CONFIG: { label: 'Đổi chính sách', icon: Settings2, tone: 'text-fg-muted' },
}

function describe(e: AuditEntry): string {
  const v = e.new_value ?? {}
  const name = typeof v.name === 'string' ? v.name : e.target
  if (e.action === 'ADMIN_GRANT_XU' || e.action === 'ADJUST_USER_XU' || e.action === 'TOPUP_CLUB_FUND') {
    const amt = Number(v.amount ?? 0)
    return `${amt >= 0 ? '+' : '−'}${formatCoin(Math.abs(amt))} Xu · ${name}`
  }
  if (e.action === 'GRANT_CHALLENGE_PASS') return `${v.quantity} vé ≤ ${v.max_slots} người · ${name}`
  if (e.action === 'PUBLISH_CONFIG') return e.target
  return name
}

export function OverviewTab({ o }: { o: EconomyOverview }) {
  const p = o.policy
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <StatTile label="Xu trong ví người dùng" value={formatCoin(o.wallets)} tone="coin" />
        <StatTile label="Xu trong quỹ CLB" value={formatCoin(o.treasuries)} tone="xp" />
        <StatTile label="Đang treo thưởng" value={formatCoin(o.escrow)} />
        <StatTile label="Vé miễn phí còn" value={formatNumber(o.activePasses)} tone="brand" unit="vé" />
      </div>
      <Card className="space-y-2">
        <p className="text-sm font-semibold">30 ngày qua</p>
        {[
          ['Phát ra từ chạy bộ', o.minted30d],
          ['Admin tặng / nạp', o.granted30d],
          ['Thu phí tạo thử thách', o.fees30d],
        ].map(([label, v]) => (
          <p key={label as string} className="flex items-center justify-between text-sm">
            <span className="text-fg-muted">{label}</span>
            <span><span className="font-mono font-semibold">{formatCoin(v as number)} Xu</span>
              <span className="ml-2 text-xs text-fg-subtle">{xuToVnd(v as number, p)}</span></span>
          </p>
        ))}
      </Card>
      <Card className="space-y-1.5 text-sm">
        <p className="flex items-center gap-2 font-semibold"><ScrollText className="size-4 text-fg-muted" aria-hidden />Chính sách đang áp dụng</p>
        <p className="text-fg-muted">1 Xu ≈ {formatNumber(p.xuVnd)}đ · {formatNumber(p.xpPerKm)} XP/km · điểm danh +{formatNumber(p.checkinXu)} Xu khi chạy ≥ {formatNumber(p.checkinMinKm)} km</p>
        <p className="text-fg-muted">Chạy (cộng dồn trong ngày): {runPolicyText(p.run)}</p>
        <p className="text-fg-muted">Phí tạo thử thách / giải: {feePolicyText(p.capacityTiers)}</p>
      </Card>

      <h2 className="flex items-center gap-2 text-lg font-semibold"><History className="size-5 text-fg-muted" aria-hidden />Nhật ký điều phối</h2>
      {!o.recent.length ? (
        <EmptyState icon={History} title="Chưa có thao tác nào" description="Mọi lần cộng/trừ Xu, tặng vé, đổi chính sách đều được ghi lại ở đây." />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {o.recent.map((e) => {
            const m = ACTIONS[e.action] ?? { label: e.action, icon: History, tone: 'text-fg-muted' }
            const Icon = m.icon
            return (
              <li key={e.id} className="flex gap-3 p-3">
                <Icon className={`mt-0.5 size-4 shrink-0 ${m.tone}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm"><span className="font-semibold">{m.label}</span> · {describe(e)}</p>
                  {e.reason && <p className="truncate text-xs text-fg-muted">“{e.reason}”</p>}
                  <p className="text-xs text-fg-subtle">{e.actor ?? 'Hệ thống'} · {formatRelative(e.created_at)}</p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
