'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { ErrorState, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { getOrg, orgErrorMessage } from '../api/orgApi'
import { fmtDay } from '../model/org'
import { OrgHeader } from './OrgHeader'
import { CampaignsTab } from './tabs/CampaignsTab'
import { MembersTab } from './tabs/MembersTab'
import { UnitsTab } from './tabs/UnitsTab'
import { ReportTab } from './tabs/ReportTab'
import { SettingsTab } from './tabs/SettingsTab'

type Tab = 'campaigns' | 'members' | 'units' | 'report' | 'settings'
export const orgKey = (id: string) => ['org', id] as const

/** Không gian tổ chức: chiến dịch, thành viên, đơn vị & CLB, báo cáo, cài đặt */
export function OrgScreen({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: orgKey(orgId), queryFn: () => getOrg(orgId) })
  const params = useSearchParams()
  const router = useRouter()
  const path = usePathname()
  const [now] = useState(() => Date.now())
  if (q.isPending) return <div className="space-y-3"><Skeleton className="h-44" /><Skeleton className="h-60" /></div>
  if (q.isError) return <ErrorState message={orgErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
  const o = q.data
  const tabs: { id: Tab; label: string; badge?: number | null }[] = [
    { id: 'campaigns', label: 'Chiến dịch' },
    { id: 'members', label: 'Thành viên', badge: o.pending_members },
    { id: 'units', label: o.kind === 'FEDERATION' ? 'Đơn vị & CLB' : o.unit_label },
    ...(o.is_admin ? [{ id: 'report' as Tab, label: 'Báo cáo' }, { id: 'settings' as Tab, label: 'Cài đặt' }] : []),
  ]
  const raw = params.get('tab') as Tab | null
  const tab: Tab = raw && tabs.some((t) => t.id === raw) ? raw : 'campaigns'
  const setTab = (t: Tab) => router.replace(`${path}?tab=${t}`, { scroll: false })
  const left = o.active_until ? daysLeft(o.active_until, now) : null

  return (
    <div className="space-y-4 pb-8">
      <OrgHeader org={o} extra={
        <p className="mt-1 text-xs text-white/80">
          {o.seats_used}/{o.seat_limit} thành viên{o.club_count ? ` · ${o.club_count} CLB` : ''}
          {o.is_admin && o.active_until ? ` · hạn ${fmtDay(o.active_until)}` : ''}
        </p>
      } />
      {!o.active && (
        <p className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          Gói của tổ chức đã hết hạn hoặc tạm dừng: vẫn xem được số liệu cũ, chưa tạo chiến dịch / nhận thành viên mới. Liên hệ RaceHub để gia hạn.
        </p>
      )}
      {o.is_admin && o.active && left !== null && left <= 30 && (
        <p className="rounded-xl border border-coin/40 bg-coin/10 p-3 text-sm">Gói còn {left} ngày — liên hệ RaceHub để gia hạn, tránh gián đoạn.</p>
      )}
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]" role="tablist" aria-label="Mục tổ chức">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={cn('flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold',
              tab === t.id ? 'border-brand bg-brand text-brand-fg' : 'border-border text-fg-muted hover:text-fg')}>
            {t.label}
            {!!t.badge && <span className="rounded-full bg-danger px-1.5 text-[11px] font-bold leading-4 text-white">{t.badge}</span>}
          </button>
        ))}
      </div>
      {tab === 'campaigns' && <CampaignsTab org={o} />}
      {tab === 'members' && <MembersTab org={o} />}
      {tab === 'units' && <UnitsTab org={o} />}
      {tab === 'report' && o.is_admin && <ReportTab org={o} />}
      {tab === 'settings' && o.is_admin && <SettingsTab org={o} />}
    </div>
  )
}

const daysLeft = (iso: string, now: number) => Math.max(0, Math.ceil((Date.parse(iso) - now) / 86400_000))
