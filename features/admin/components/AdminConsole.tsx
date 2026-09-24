'use client'

import { useState } from 'react'
import { CheckCircle2, Coins, Crown, LayoutDashboard, ScrollText, Shirt, Ticket, type LucideIcon } from 'lucide-react'
import { ErrorState, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { adminErrorMessage } from '../api/adminApi'
import { useEconomyOverview } from '../hooks/useAdmin'
import { GrantXuTab } from './economy/GrantXuTab'
import { OverviewTab } from './economy/OverviewTab'
import { PassesTab } from './economy/PassesTab'
import { PolicyTab } from './economy/PolicyTab'
import { ItemsTab } from './items/ItemsTab'
import { ReviewTab } from './ReviewTab'
import { ClubsProTab } from './ClubsProTab'

type Tab = 'overview' | 'grant' | 'passes' | 'policy' | 'items' | 'review' | 'clubs'
const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Tổng quan', icon: LayoutDashboard },
  { id: 'grant', label: 'Cộng/Trừ Xu', icon: Coins },
  { id: 'passes', label: 'Vé miễn phí', icon: Ticket },
  { id: 'policy', label: 'Chính sách', icon: ScrollText },
  { id: 'items', label: 'Vật phẩm', icon: Shirt },
  { id: 'review', label: 'Duyệt bài', icon: CheckCircle2 },
  { id: 'clubs', label: 'CLB Pro', icon: Crown },
]

/** Bảng điều phối của quản trị viên hệ thống: dòng Xu, cộng/trừ Xu, vé miễn phí, chính sách, vật phẩm, duyệt bài */
export function AdminConsole() {
  const [tab, setTab] = useState<Tab>('overview')
  const o = useEconomyOverview()

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Quản trị RaceHub</h1>
        <p className="text-sm text-fg-muted">Điều phối Xu, vé tạo thử thách, chính sách kinh tế và vật phẩm</p>
      </div>
      <nav className="flex flex-wrap gap-2" role="tablist" aria-label="Khu vực quản trị">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={cn('flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold',
              tab === t.id ? 'border-brand bg-brand text-brand-fg' : 'border-border text-fg-muted hover:text-fg')}>
            <t.icon className="size-4" aria-hidden />{t.label}
          </button>
        ))}
      </nav>

      {tab === 'review' ? <ReviewTab />
        : tab === 'clubs' ? <ClubsProTab />
        : tab === 'items' ? <ItemsTab />
        : o.isPending ? <div className="space-y-2"><Skeleton className="h-28" /><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
        : o.isError ? <ErrorState message={adminErrorMessage(o.error)} onRetry={() => void o.refetch()} />
        : tab === 'overview' ? <OverviewTab o={o.data} />
        : tab === 'grant' ? <GrantXuTab policy={o.data.policy} />
        : tab === 'passes' ? <PassesTab policy={o.data.policy} />
        : <PolicyTab key={JSON.stringify(o.data.policy)} policy={o.data.policy} raw={o.data.rawPolicy} />}
    </div>
  )
}
