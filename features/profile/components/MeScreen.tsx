'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { ArrowLeft, Check, ChevronRight, Coins, Copy, Gift, LogOut, Pencil, Settings, Share2, Shirt, Watch } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/shared/lib/supabase'
import { Button, Card, LevelBadge, ProgressBar, SegmentedControl, Skeleton } from '@/shared/ui'
import { formatCoin, formatKm, formatNumber } from '@/shared/lib/format'
import { routes } from '@/shared/config/routes'
import { levelProgress } from '@/features/progression'
import { useInvalidateProfile } from '@/features/auth'
import { CharacterHub } from '@/features/character'
import { BadgeGrid } from '@/features/game'
import { getAthleteProfile } from '../api/athleteApi'
import PrivacySettings from './PrivacySettings'
import type { Profile } from '@/shared/types/profile'

type Tab = 'overview' | 'badges' | 'character'
const TABS: { value: Tab; label: string }[] = [
  { value: 'overview', label: 'Tổng quan' },
  { value: 'badges', label: 'Huy hiệu' },
  { value: 'character', label: 'Nhân vật' },
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
  const initial = (profile.display_name ?? 'R').trim().charAt(0).toUpperCase()
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center gap-4 bg-gradient-to-br from-brand/15 via-transparent to-transparent p-4">
        <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-full bg-brand text-2xl font-black text-brand-fg ring-4 ring-bg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {profile.avatar_url ? <img src={profile.avatar_url} alt="" className="size-full object-cover" /> : initial}
        </div>
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
          <Link href={routes.wallet} aria-label="Mở ví Xu"
            className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-full border border-coin/40 bg-coin/10 px-3 text-sm font-semibold text-coin hover:bg-coin/15">
            <Coins className="size-4" aria-hidden /><span className="font-mono">{formatCoin(profile.xu)}</span> Xu
            <ChevronRight className="size-4" aria-hidden />
          </Link>
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

function NameForm({ profile }: { profile: Profile }) {
  const [name, setName] = useState(profile.display_name ?? '')
  const invalidate = useInvalidateProfile()
  const m = useMutation({
    mutationFn: async () => {
      const v = name.trim()
      if (v.length < 2 || v.length > 40) throw new Error('Tên hiển thị cần từ 2 đến 40 ký tự.')
      const { error } = await supabase.from('profiles').update({ display_name: v, updated_at: new Date().toISOString() }).eq('id', profile.id)
      if (error) throw error
    },
    onSuccess: () => { invalidate(); toast.success('Đã cập nhật tên hiển thị') },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Không lưu được'),
  })
  const changed = name.trim() !== (profile.display_name ?? '')
  return (
    <form onSubmit={(e) => { e.preventDefault(); m.mutate() }} className="flex gap-2">
      <label className="sr-only" htmlFor="display-name">Tên hiển thị</label>
      <input id="display-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40}
        className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-bg px-3 text-[15px] outline-none focus:border-brand" />
      <Button type="submit" loading={m.isPending} disabled={!changed}><Check className="size-4" /> Lưu</Button>
    </form>
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
  const tab: Tab = isTab(fromUrl) ? fromUrl : 'overview'
  // Tab nằm trên URL để thông báo mở đúng chỗ (/me?tab=badges)
  const setTab = (t: Tab) => router.replace(t === 'overview' ? routes.me : `${routes.me}?tab=${t}`, { scroll: false })
  return (
    <div className="space-y-4 animate-fade-in">
      <Header profile={profile} />
      <SegmentedControl value={tab} onChange={setTab} options={TABS} />

      {tab === 'badges' && <BadgeGrid />}

      {tab === 'overview' && (
        <div className="space-y-3">
          <Card><Invite profile={profile} /></Card>
          <Card className="space-y-1">
            <Row icon={Watch}>Thiết bị & nguồn dữ liệu</Row>
            <Devices profile={profile} />
          </Card>
          <button onClick={() => setTab('character')} className="w-full text-left">
            <Card className="flex items-center gap-3 transition-colors hover:border-fg-subtle">
              <span className="grid size-10 place-items-center rounded-xl bg-brand/15 text-brand"><Shirt className="size-5" /></span>
              <div className="flex-1"><p className="font-semibold">Nhân vật & tủ đồ</p><p className="text-xs text-fg-muted">Trang phục mở khóa theo cấp độ</p></div>
              <ChevronRight className="size-5 text-fg-subtle" />
            </Card>
          </button>
        </div>
      )}

      {tab === 'character' && <CharacterHub userId={profile.id} />}
    </div>
  )
}

/** Màn Cài đặt riêng (/me/settings): tên hiển thị, quyền riêng tư, đăng xuất */
export function SettingsScreen({ profile }: { profile: Profile }) {
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-2">
        <Link href={routes.me} aria-label="Quay lại" className="-ml-2 grid size-11 place-items-center rounded-full text-fg-muted hover:bg-surface-2">
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
        <h1 className="text-xl font-bold">Cài đặt</h1>
      </div>
      <Card className="space-y-3">
        <Row icon={Pencil}>Tên hiển thị</Row>
        <NameForm profile={profile} />
      </Card>
      <PrivacySettings userId={profile.id} />
      <Button block variant="danger" onClick={() => supabase.auth.signOut()}><LogOut className="size-4" /> Đăng xuất</Button>
    </div>
  )
}
