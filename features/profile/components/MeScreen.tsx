'use client'

import { useState } from 'react'
import { shineTier } from '@/shared/lib/shine'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { BarChart3, ChevronRight, Copy, Crown, Gift, Pencil, Settings, Share2, Sparkles, Watch, Ticket, Store } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, LevelBadge, ProgressBar, SegmentedControl, Skeleton } from '@/shared/ui'
import { formatKm, formatNumber } from '@/shared/lib/format'
import { routes } from '@/shared/config/routes'
import { levelProgress } from '@/features/progression'
import { CharacterHub } from '@/features/character'
import { BadgeGrid, GiftWall } from '@/features/game'
import { getAthleteProfile } from '../api/athleteApi'
import { AvatarPicker } from './AvatarPicker'
import type { Profile } from '@/shared/types/profile'

type Tab = 'character' | 'overview' | 'badges'
const TABS: { value: Tab; label: string }[] = [
  { value: 'character', label: 'Nhân vật' },
  { value: 'overview', label: 'Tổng quan' },
  { value: 'badges', label: 'Huy hiệu' },
]
const isTab = (v: string | null): v is Tab => TABS.some((t) => t.value === v)

function StatCell({ label, km, runs }: { label: string; km: number; runs?: number }) {
  return (
    <div className="px-2 py-3 text-center">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className="font-mono tabular text-xl font-bold">{formatKm(km)}</p>
      <p className="text-xs text-fg-muted">km{runs !== undefined ? ` · ${runs} buổi` : ''}</p>
    </div>
  )
}

function Header({ profile }: { profile: Profile }) {
  const p = levelProgress(profile.xp, profile.level)
  const q = useQuery({ queryKey: ['athlete', profile.id], queryFn: () => getAthleteProfile(profile.id) })
  const s = q.data?.stats
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center gap-4 bg-gradient-to-br from-brand/15 via-transparent to-transparent p-4">
        <AvatarPicker userId={profile.id} avatarUrl={profile.avatar_url} name={profile.display_name} size="md" shine={shineTier(Number(profile.shine_total ?? 0))} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <h1 className="min-w-0 flex-1 truncate text-xl font-bold">{profile.display_name || 'Runner'}</h1>
            <Link href={routes.settings} aria-label="Cài đặt"
              className="-mr-2 -mt-2 grid size-11 shrink-0 place-items-center rounded-full text-fg-muted hover:bg-surface-2 hover:text-fg">
              <Settings className="size-5" aria-hidden />
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
            <LevelBadge level={p.current.level} /> <span className="truncate">{p.current.name}</span>
          </div>
          <div className="mt-2 space-y-1">
            <ProgressBar value={p.value} max={p.span} tone="xp" />
            <p className="text-xs text-fg-subtle">
              {p.next ? <>Còn <span className="font-mono tabular text-fg">{formatNumber(p.remaining)}</span> XP lên {p.next.name}</> : 'Cấp cao nhất'}
            </p>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 divide-x divide-border border-t border-border">
        {q.isPending ? (
          <><Skeleton className="m-3 h-12" /><Skeleton className="m-3 h-12" /><Skeleton className="m-3 h-12" /></>
        ) : (
          <>
            <StatCell label="Tuần này" km={s?.week.distance_m ?? 0} runs={s?.week.count ?? 0} />
            <StatCell label="Tháng này" km={s?.month.distance_m ?? 0} runs={s?.month.count ?? 0} />
            <StatCell label="Tổng" km={s?.all.distance_m ?? 0} runs={s?.all.count ?? 0} />
          </>
        )}
      </div>
    </Card>
  )
}

function Devices({ profile }: { profile: Profile }) {
  const [busy, setBusy] = useState(false)
  const disconnect = async () => {
    setBusy(true)
    const res = await fetch('/api/connect/strava/disconnect', { method: 'POST' })
    setBusy(false)
    if (!res.ok) { toast.error('Không hủy được kết nối Strava. Thử lại sau.'); return }
    toast.success('Đã hủy kết nối Strava')
    window.location.reload()
  }
  return (
    <ul className="divide-y divide-border">
      <li className="flex items-center gap-3 py-3">
        <span className="grid size-9 place-items-center rounded-lg bg-[#fc4c02]/15 font-black text-[#fc4c02]" aria-hidden>S</span>
        <div className="flex-1">
          <p className="font-semibold">Strava</p>
          <p className="text-xs text-fg-muted">{profile.strava_connected ? 'Đã kết nối · bài chạy tự đồng bộ' : 'Nhận bài chạy từ Garmin, COROS, Apple Watch…'}</p>
        </div>
        {profile.strava_connected
          ? <Button size="sm" variant="secondary" loading={busy} onClick={disconnect}>Ngắt</Button>
          : <a href="/api/connect/strava"><Button size="sm">Kết nối</Button></a>}
      </li>
      {['Garmin Connect', 'COROS', 'Apple Health'].map((n) => (
        <li key={n} className="flex items-center gap-3 py-3 opacity-60">
          <span className="grid size-9 place-items-center rounded-lg bg-surface-2"><Watch className="size-4" aria-hidden /></span>
          <p className="flex-1 font-semibold">{n}</p>
          <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-fg-subtle">Sắp có</span>
        </li>
      ))}
    </ul>
  )
}

function Invite({ profile }: { profile: Profile }) {
  const link = typeof window !== 'undefined' ? `${window.location.origin}/join/${profile.id}` : ''
  const share = async () => {
    if (navigator.share) {
      await navigator.share({ title: 'Chạy cùng mình trên RaceHub', url: link }).catch(() => undefined)
    } else {
      await navigator.clipboard.writeText(link)
      toast.success('Đã sao chép link mời')
    }
  }
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-10 place-items-center rounded-xl bg-coin/15 text-coin"><Gift className="size-5" aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Mời bạn bè</p>
        <p className="text-xs text-fg-muted">Bạn nhận thưởng Xu khi bạn bè chạy đủ 3 km đầu tiên.</p>
      </div>
      <Button size="sm" variant="secondary" onClick={share} aria-label="Chia sẻ link mời">
        {typeof navigator !== 'undefined' && 'share' in navigator ? <Share2 className="size-4" /> : <Copy className="size-4" />}
      </Button>
    </div>
  )
}

function Row({ icon: Icon, children }: { icon: typeof Pencil; children: React.ReactNode }) {
  return <div className="flex items-center gap-2 text-sm font-semibold text-fg-muted"><Icon className="size-4" aria-hidden />{children}</div>
}

export function MeScreen({ profile }: { profile: Profile }) {
  const params = useSearchParams()
  const router = useRouter()
  const fromUrl = params.get('tab')
  const tab: Tab = isTab(fromUrl) ? fromUrl : 'character'
  // Tab nằm trên URL để thông báo mở đúng chỗ (/me?tab=badges); mở trang Tôi là thấy nhân vật trước
  const setTab = (t: Tab) => router.replace(t === 'character' ? routes.me : `${routes.me}?tab=${t}`, { scroll: false })
  return (
    <div className="space-y-4 animate-fade-in">
      <Header profile={profile} />
      <SegmentedControl value={tab} onChange={setTab} options={TABS} />

      {tab === 'badges' && <div className="space-y-4"><GiftWall userId={profile.id} isMe /><BadgeGrid /></div>}

      {tab === 'overview' && (
        <div className="space-y-3">
          <Card className="divide-y divide-border p-0">
            <Link href={routes.insights} className="flex items-center gap-3 p-4">
              <span className="grid size-10 place-items-center rounded-xl bg-xp/15 text-xp"><BarChart3 className="size-5" aria-hidden /></span>
              <span className="min-w-0 flex-1"><span className="block font-semibold">Phân tích của tôi</span>
                <span className="block text-xs text-fg-muted">Xu hướng, kỷ lục 1K → Marathon, phân bố pace, xuất báo cáo</span></span>
              <ChevronRight className="size-4 text-fg-subtle" aria-hidden />
            </Link>
            <Link href={routes.shine} className="flex items-center gap-3 p-4">
              <span className="grid size-10 place-items-center rounded-xl bg-coin/15 text-coin"><Sparkles className="size-5" aria-hidden /></span>
              <span className="min-w-0 flex-1"><span className="block font-semibold">Ví Tỏa sáng</span>
                <span className="block text-xs text-fg-muted">Đổi quà nhận được lấy lượt tạo thử thách, khiên, vật phẩm; cảm ơn người tặng</span></span>
              <ChevronRight className="size-4 text-fg-subtle" aria-hidden />
            </Link>
            <Link href={routes.vouchers} className="flex items-center gap-3 p-4">
              <span className="grid size-10 place-items-center rounded-xl bg-danger/15 text-danger"><Ticket className="size-5" aria-hidden /></span>
              <span className="min-w-0 flex-1"><span className="block font-semibold">Voucher của tôi</span>
                <span className="block text-xs text-fg-muted">Quà từ nhà tài trợ khi hoàn thành thử thách / nhiệm vụ</span></span>
              <ChevronRight className="size-4 text-fg-subtle" aria-hidden />
            </Link>
            <Link href={routes.market} className="flex items-center gap-3 p-4">
              <span className="grid size-10 place-items-center rounded-xl bg-brand/15 text-brand"><Store className="size-5" aria-hidden /></span>
              <span className="min-w-0 flex-1"><span className="block font-semibold">Chợ Runner</span>
                <span className="block text-xs text-fg-muted">HLV, cửa hàng, dịch vụ đã xác minh · đăng ký hồ sơ đối tác</span></span>
              <ChevronRight className="size-4 text-fg-subtle" aria-hidden />
            </Link>
            <Link href={routes.plan} className="flex items-center gap-3 p-4">
              <span className="grid size-10 place-items-center rounded-xl bg-coin/15 text-coin"><Crown className="size-5" aria-hidden /></span>
              <span className="min-w-0 flex-1"><span className="block font-semibold">Gói VIP & Nạp Xu</span>
                <span className="block text-xs text-fg-muted">Lượt tạo thử thách miễn phí mỗi tháng, đơn hàng của tôi</span></span>
              <ChevronRight className="size-4 text-fg-subtle" aria-hidden />
            </Link>
          </Card>
          <Card><Invite profile={profile} /></Card>
          <Card className="space-y-1">
            <Row icon={Watch}>Thiết bị & nguồn dữ liệu</Row>
            <Devices profile={profile} />
          </Card>
        </div>
      )}

      {tab === 'character' && <CharacterHub />}
    </div>
  )
}
