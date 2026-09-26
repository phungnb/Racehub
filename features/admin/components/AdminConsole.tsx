'use client'

import { useState } from 'react'
import { Activity, BookOpen, ShieldAlert, BarChart3, Megaphone, Target, CheckCircle2, Flag, Gift, History, Swords, Coins, Crown, LayoutDashboard, Receipt, ScrollText, Shirt, Store, Tags, Ticket, Trophy, Users, type LucideIcon } from 'lucide-react'
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
import { SystemTab } from './SystemTab'
import { PartnersTab } from './PartnersTab'
import { OrdersTab } from './commerce/OrdersTab'
import { PlansTab } from './commerce/PlansTab'
import { GiftsTab, OrganizersTab } from './commerce/GiftsTab'
import { MetricsTab } from './commerce/MetricsTab'
import { QuestsTab } from './commerce/QuestsTab'
import { PromotionsTab } from './commerce/PromotionsTab'
import { CupReviewList } from '@/features/cup'
import type { AdminInbox } from '../api/consoleApi'
import { InboxPanel, useAdminInbox } from './console/InboxPanel'
import { UsersTab } from './console/UsersTab'
import { ChallengesTab } from './console/ChallengesTab'
import { AuditTab } from './console/AuditTab'
import { ReportsTab } from './console/ReportsTab'
import { BibTab } from './console/BibTab'
import { CmsScreen } from '@/features/knowledge'

type Tab = 'overview' | 'metrics' | 'users' | 'review' | 'reports' | 'challenges' | 'clubs' | 'cups' | 'partners' | 'organizers' | 'content' | 'bib'
  | 'orders' | 'plans' | 'promos' | 'quests' | 'gifts' | 'items' | 'grant' | 'passes' | 'policy' | 'system' | 'audit'
type Badge = keyof AdminInbox
const GROUPS: { id: string; label: string; icon: LucideIcon; tabs: { id: Tab; label: string; icon: LucideIcon; badge?: Badge }[] }[] = [
  { id: 'home', label: 'Tổng quan', icon: LayoutDashboard, tabs: [
    { id: 'overview', label: 'Tổng quan', icon: LayoutDashboard }, { id: 'metrics', label: 'Chỉ số', icon: BarChart3 }] },
  { id: 'people', label: 'Người dùng', icon: Users, tabs: [
    { id: 'users', label: 'Người dùng', icon: Users }, { id: 'review', label: 'Duyệt bài chạy', icon: CheckCircle2, badge: 'reviews' },
    { id: 'reports', label: 'Báo cáo', icon: ShieldAlert, badge: 'reports' }] },
  { id: 'community', label: 'Cộng đồng', icon: Trophy, tabs: [
    { id: 'challenges', label: 'Thử thách', icon: Trophy }, { id: 'clubs', label: 'CLB Pro', icon: Crown }, { id: 'cups', label: 'Thách đấu CLB', icon: Swords, badge: 'cups' },
    { id: 'partners', label: 'Đối tác', icon: Store, badge: 'partners' }, { id: 'bib', label: 'Chợ BIB', icon: Ticket }, { id: 'organizers', label: 'Tổ chức giải', icon: Flag },
    { id: 'content', label: 'Nội dung', icon: BookOpen, badge: 'content' }] },
  { id: 'sales', label: 'Kinh doanh', icon: Receipt, tabs: [
    { id: 'orders', label: 'Đơn hàng', icon: Receipt, badge: 'orders' }, { id: 'plans', label: 'Gói & giá', icon: Tags }, { id: 'promos', label: 'Khuyến mãi', icon: Megaphone },
    { id: 'quests', label: 'Nhiệm vụ', icon: Target }, { id: 'gifts', label: 'Quà tặng', icon: Gift }, { id: 'items', label: 'Vật phẩm', icon: Shirt }] },
  { id: 'economy', label: 'Kinh tế', icon: Coins, tabs: [
    { id: 'grant', label: 'Cộng/Trừ Xu', icon: Coins }, { id: 'passes', label: 'Lượt tạo', icon: Ticket }, { id: 'policy', label: 'Chính sách', icon: ScrollText }] },
  { id: 'system', label: 'Hệ thống', icon: Activity, tabs: [
    { id: 'system', label: 'Kiểm tra hệ thống', icon: Activity, badge: 'errors' }, { id: 'audit', label: 'Nhật ký quản trị', icon: History }] },
]
const ALL_TABS = GROUPS.flatMap((g) => g.tabs.map((t) => t.id))
const groupOf = (t: Tab) => GROUPS.find((g) => g.tabs.some((x) => x.id === t)) ?? GROUPS[0]

export function AdminConsole() {
  const [tab, setTabState] = useState<Tab>(() => {
    const t = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('tab') : null
    return t && (ALL_TABS as string[]).includes(t) ? (t as Tab) : 'overview'
  })
  // Giữ tab trên thanh địa chỉ (?tab=…) để tải lại / gửi link vẫn đúng chỗ
  const setTab = (t: string) => {
    if (!(ALL_TABS as string[]).includes(t)) return
    setTabState(t as Tab)
    window.history.replaceState(null, '', `?tab=${t}`)
    window.scrollTo({ top: 0 })
  }
  const o = useEconomyOverview()
  const inbox = useAdminInbox().data
  const count = (b?: Badge) => (b && inbox ? Number(inbox[b] ?? 0) : 0)
  const group = groupOf(tab)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Quản trị RaceHub</h1>
        <p className="text-sm text-fg-muted">Người dùng, cộng đồng, bán hàng, kinh tế Xu và sức khỏe hệ thống — mọi thao tác đều được ghi nhật ký.</p>
      </div>
      <nav className="space-y-2" aria-label="Khu vực quản trị">
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="tablist" aria-label="Nhóm">
          {GROUPS.map((g) => {
            const n = g.tabs.reduce((a, t) => a + count(t.badge), 0)
            return (
              <button key={g.id} role="tab" aria-selected={group.id === g.id} onClick={() => setTab(g.tabs[0].id)}
                className={cn('relative flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold',
                  group.id === g.id ? 'border-brand bg-brand text-brand-fg' : 'border-border text-fg-muted hover:text-fg')}>
                <g.icon className="size-4" aria-hidden />{g.label}
                {n > 0 && <span className="rounded-full bg-danger px-1.5 text-[11px] font-bold leading-4 text-white">{n}</span>}
              </button>
            )
          })}
        </div>
        {group.tabs.length > 1 && (
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={group.label}>
            {group.tabs.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                className={cn('flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium',
                  tab === t.id ? 'bg-surface-2 text-fg shadow-sm' : 'text-fg-subtle hover:text-fg')}>
                <t.icon className="size-4" aria-hidden />{t.label}
                {count(t.badge) > 0 && <span className="rounded-full bg-danger/15 px-1.5 text-[11px] font-bold text-danger">{count(t.badge)}</span>}
              </button>
            ))}
          </div>
        )}
      </nav>

      {tab === 'overview' && <InboxPanel onGo={setTab} />}
      {tab === 'system' ? <SystemTab />
        : tab === 'users' ? <UsersTab />
        : tab === 'challenges' ? <ChallengesTab />
        : tab === 'audit' ? <AuditTab />
        : tab === 'reports' ? <ReportsTab />
        : tab === 'content' ? <CmsScreen />
        : tab === 'bib' ? <BibTab />
        : tab === 'metrics' ? <MetricsTab />
        : tab === 'orders' ? <OrdersTab />
        : tab === 'promos' ? <PromotionsTab />
        : tab === 'quests' ? <QuestsTab />
        : tab === 'plans' ? <PlansTab />
        : tab === 'gifts' ? <GiftsTab />
        : tab === 'organizers' ? <OrganizersTab />
        : tab === 'cups' ? <CupReviewList />
        : tab === 'partners' ? <PartnersTab />
        : tab === 'review' ? <ReviewTab />
        : tab === 'clubs' ? <ClubsProTab />
        : tab === 'items' ? <ItemsTab />
        : o.isPending ? <div className="space-y-2"><Skeleton className="h-28" /><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
        : o.isError ? <ErrorState message={adminErrorMessage(o.error)} error={o.error} onRetry={() => void o.refetch()} />
        : tab === 'overview' ? <OverviewTab o={o.data} />
        : tab === 'grant' ? <GrantXuTab policy={o.data.policy} />
        : tab === 'passes' ? <PassesTab policy={o.data.policy} />
        : <PolicyTab key={JSON.stringify(o.data.policy)} policy={o.data.policy} raw={o.data.rawPolicy} />}
    </div>
  )
}
