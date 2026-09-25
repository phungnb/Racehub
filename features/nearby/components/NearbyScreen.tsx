'use client'

import Link from 'next/link'
import { useState } from 'react'
import { CalendarDays, ChevronRight, EyeOff, MapPin, Radar, Settings2, ShieldAlert, Users, UsersRound } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Card, EmptyState, ErrorState, SegmentedControl, Sheet, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import {
  clearPresence, nearbyErrorMessage, setDiscovery, setPresence, type Discovery, type DiscoveryInput, type Goal, type NearbyFilters,
  type Purpose, type Radius, type Slot,
} from '../api/nearbyApi'
import { useDiscovery, useNearbyClubs, useNearbyEvents, useNearbyMutation, useNearbyRunners } from '../hooks/useNearby'
import { eventWhen, expiresIn, GOALS, PACE_FILTERS, PURPOSES, RADII, SLOTS } from '../model/nearby'
import { EnableSheet, PrefsForm } from './EnableSheet'
import { LocationPicker, type PickedPlace } from './LocationPicker'
import { RunnerCard } from './RunnerCard'

type Tab = 'runners' | 'events' | 'clubs'

/** Runner quanh đây: runner hợp pace / giờ / mục tiêu, buổi chạy công khai và CLB gần khu vực bạn chọn */
export function NearbyScreen() {
  const me = useDiscovery()
  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">Quanh đây</h1>
          <p className="text-sm text-fg-muted">Bạn chạy cùng pace, buổi chạy nhóm, CLB gần bạn</p>
        </div>
        <Link href={routes.nearbyConnections} className="relative inline-flex h-11 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-semibold hover:border-fg-subtle">
          <UsersRound className="size-4" aria-hidden />Kết nối
          {!!me.data?.incoming && <span className="absolute -right-1.5 -top-1.5 grid min-w-5 place-items-center rounded-full bg-live px-1 text-[11px] font-bold text-white">{me.data.incoming}</span>}
        </Link>
      </header>
      {me.isPending ? <div className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
        : me.isError ? <ErrorState message={nearbyErrorMessage(me.error)} error={me.error} onRetry={() => void me.refetch()} />
        : <Body d={me.data} />}
    </div>
  )
}

function Body({ d }: { d: Discovery }) {
  const [enableOpen, setEnableOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('runners')
  const [radius, setRadius] = useState<Radius>(d.radius_km)
  const live = d.enabled && !!d.presence

  if (d.suspended) {
    return (
      <EmptyState icon={ShieldAlert} title="Quanh đây đang tạm khoá"
        description="Tài khoản của bạn nhận nhiều báo cáo nên tạm ẩn khỏi Quanh đây, chờ quản trị viên xem xét. Bạn vẫn dùng mọi tính năng khác bình thường." />
    )
  }
  return (
    <>
      {live ? <StatusCard d={d} /> : (
        <Card className="space-y-3 bg-gradient-to-br from-brand/15 to-transparent">
          <div className="flex items-start gap-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand/20 text-brand"><Radar className="size-6" aria-hidden /></span>
            <div>
              <p className="font-semibold">{d.enabled ? 'Vị trí của bạn đã hết hạn' : 'Tìm bạn chạy quanh bạn'}</p>
              <p className="text-sm text-fg-muted">
                {d.enabled ? 'Chọn lại khu vực để tiếp tục thấy và được thấy.' : 'Chỉ chia sẻ vùng ~1 km bạn chọn, tự hết hạn. Bạn quyết định ai thấy mình.'}
              </p>
            </div>
          </div>
          <Button block onClick={() => setEnableOpen(true)}>{d.enabled ? 'Chọn lại khu vực' : 'Bật Quanh đây'}</Button>
        </Card>
      )}
      {enableOpen && <EnableSheet me={d} open onClose={() => setEnableOpen(false)} />}

      {d.presence && (
        <>
          <SegmentedControl value={tab} onChange={setTab} options={[
            { value: 'runners', label: 'Runner' }, { value: 'events', label: 'Buổi chạy' }, { value: 'clubs', label: 'CLB' },
          ]} />
          <div className="flex items-center gap-1.5" role="group" aria-label="Bán kính">
            <span className="text-xs text-fg-muted">Trong</span>
            {RADII.map((r) => (
              <button key={r} type="button" aria-pressed={radius === r} onClick={() => setRadius(r)}
                className={cn('h-9 rounded-full border px-3 text-xs font-semibold', radius === r ? 'border-brand bg-brand/15 text-fg' : 'border-border text-fg-muted')}>
                {r} km
              </button>
            ))}
          </div>
          {tab === 'runners' && (d.enabled ? <Runners d={d} radius={radius} onFallback={setTab} />
            : <EmptyState icon={Users} title="Bật Quanh đây để thấy runner" description="Runner chỉ thấy nhau khi cả hai cùng bật." />)}
          {tab === 'events' && <Events radius={radius} />}
          {tab === 'clubs' && <Clubs radius={radius} />}
        </>
      )}
    </>
  )
}

function StatusCard({ d }: { d: Discovery }) {
  const [sheet, setSheet] = useState<'move' | 'settings' | null>(null)
  const hide = useNearbyMutation(() => clearPresence())
  const p = d.presence!
  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="relative grid size-11 shrink-0 place-items-center rounded-2xl bg-brand/15 text-brand">
          <MapPin className="size-5" aria-hidden />
          <span className="absolute right-1 top-1 size-2.5 rounded-full bg-brand ring-2 ring-surface" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{p.area_label ?? (p.source === 'DEVICE' ? 'Quanh vị trí của bạn' : 'Khu vực đã chọn')}</p>
          <p className="text-xs text-fg-muted">Đang hiện · {expiresIn(p.expires_at)} · {d.connections} kết nối</p>
        </div>
        <Button size="sm" variant="ghost" aria-label="Cài đặt Quanh đây" onClick={() => setSheet('settings')}><Settings2 className="size-5" aria-hidden /></Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="sm" disabled={p.moves_left === 0} onClick={() => setSheet('move')}>
          <MapPin className="size-4" aria-hidden />Đổi khu vực{p.moves_left < 3 ? ` (${p.moves_left})` : ''}
        </Button>
        <Button variant="secondary" size="sm" loading={hide.isPending}
          onClick={() => hide.mutate(undefined, { onSuccess: () => toast.success('Đã ẩn bạn khỏi Quanh đây', { description: 'Vị trí đã xoá. Chọn lại khu vực để hiện.' }) })}>
          <EyeOff className="size-4" aria-hidden />Ẩn tôi ngay
        </Button>
      </div>
      {sheet === 'move' && <MoveSheet area={p.area_label} onClose={() => setSheet(null)} />}
      {sheet === 'settings' && <SettingsSheet d={d} onClose={() => setSheet(null)} />}
    </Card>
  )
}

function MoveSheet({ area, onClose }: { area: string | null; onClose: () => void }) {
  const move = useNearbyMutation((x: PickedPlace) => setPresence(x.lat, x.lng, x.source, x.area, x.hours))
  return (
    <Sheet open onClose={onClose} title="Đổi khu vực" description="Tối đa 3 lần / 24 giờ để không ai dò được vị trí chính xác của người khác.">
      <LocationPicker initialArea={area} busy={move.isPending}
        onPick={(x) => move.mutate(x, { onSuccess: () => { toast.success('Đã cập nhật khu vực'); onClose() }, onError: (e) => toast.error(nearbyErrorMessage(e)) })} />
    </Sheet>
  )
}

function SettingsSheet({ d, onClose }: { d: Discovery; onClose: () => void }) {
  const [prefs, setPrefs] = useState<DiscoveryInput>({ visible_to: d.visible_to, purposes: d.purposes, goals: d.goals, time_slots: d.time_slots, share_pace: d.share_pace, bio: d.bio })
  const save = useNearbyMutation((p: DiscoveryInput) => setDiscovery(p))
  const run = (p: DiscoveryInput, msg: string) => save.mutate(p, { onSuccess: () => { toast.success(msg); onClose() }, onError: (e) => toast.error(nearbyErrorMessage(e)) })
  return (
    <Sheet open onClose={onClose} title="Cài đặt Quanh đây"
      footer={<Button block loading={save.isPending} onClick={() => run(prefs, 'Đã lưu')}>Lưu</Button>}>
      <div className="space-y-5">
        <PrefsForm value={prefs} onChange={setPrefs} />
        <div className="rounded-xl border border-danger/30 p-3">
          <p className="text-sm font-semibold">Tắt Quanh đây</p>
          <p className="mb-2 text-xs text-fg-muted">Xoá vị trí ngay, không ai thấy bạn nữa. Kết nối đã có vẫn giữ.</p>
          <Button size="sm" variant="danger" disabled={save.isPending} onClick={() => run({ enabled: false }, 'Đã tắt Quanh đây')}>Tắt và xoá vị trí</Button>
        </div>
      </div>
    </Sheet>
  )
}

function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Record<T, string>; onChange: (v: T) => void }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}
        className={cn('h-9 shrink-0 rounded-full border bg-bg px-3 text-xs font-semibold', value === 'ALL' ? 'border-border text-fg-muted' : 'border-brand text-fg')}>
      {(Object.keys(options) as T[]).map((k) => <option key={k} value={k}>{options[k]}</option>)}
    </select>
  )
}

function Runners({ d, radius, onFallback }: { d: Discovery; radius: Radius; onFallback: (t: Tab) => void }) {
  const [pace, setPace] = useState<NonNullable<NearbyFilters['pace']>>('ALL')
  const [purpose, setPurpose] = useState<Purpose | 'ALL'>('ALL')
  const [goal, setGoal] = useState<Goal | 'ALL'>('ALL')
  const [slot, setSlot] = useState<Slot | 'ALL'>('ALL')
  const q = useNearbyRunners({ radius_km: radius, pace, purpose, goal, slot }, d)
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  const first = q.data?.pages[0]

  return (
    <div className="space-y-3">
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
        <Select label="Pace" value={pace} options={PACE_FILTERS} onChange={setPace} />
        <Select label="Mục đích" value={purpose} options={{ ALL: 'Mọi mục đích', ...PURPOSES }} onChange={setPurpose} />
        <Select label="Mục tiêu" value={goal} options={{ ALL: 'Mọi mục tiêu', ...GOALS }} onChange={setGoal} />
        <Select label="Khung giờ" value={slot} options={{ ALL: 'Mọi khung giờ', ...SLOTS }} onChange={setSlot} />
      </div>
      {q.isPending ? <div className="space-y-3"><Skeleton className="h-44" /><Skeleton className="h-44" /></div>
        : q.isError ? <ErrorState message={nearbyErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
        : items.length === 0 ? (
          <EmptyState icon={Users} title={first?.nearby_total ? 'Không ai khớp bộ lọc' : 'Chưa có runner nào quanh đây'}
            description={first?.nearby_total
              ? `Có ${first.nearby_total} runner trong ${radius} km nhưng không khớp bộ lọc. Thử nới bộ lọc hoặc tăng bán kính.`
              : 'Quanh đây còn ít người bật. Thử tham gia buổi chạy công khai hoặc CLB gần bạn — gặp nhau ngoài đời nhanh hơn!'}
            action={<div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => onFallback('events')}><CalendarDays className="size-4" aria-hidden />Buổi chạy</Button>
              <Button size="sm" variant="secondary" onClick={() => onFallback('clubs')}><Users className="size-4" aria-hidden />CLB gần đây</Button>
            </div>} />
        ) : (
          <>
            <p className="text-xs text-fg-muted">{first!.total} runner hợp với bạn · xếp theo mức hợp nhau · khoảng cách đã làm tròn để bảo vệ vị trí</p>
            {items.map((r) => <RunnerCard key={r.id} r={r} />)}
            {q.hasNextPage && <Button block variant="secondary" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Xem thêm</Button>}
          </>
        )}
    </div>
  )
}

function Events({ radius }: { radius: Radius }) {
  const q = useNearbyEvents(radius)
  if (q.isPending) return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
  if (q.isError) return <ErrorState message={nearbyErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
  if (q.data.length === 0) {
    return <EmptyState icon={CalendarDays} title="Chưa có buổi chạy công khai" description={`Trong ${radius} km, 14 ngày tới chưa CLB nào mở buổi chạy cho người ngoài. Thử tăng bán kính.`} />
  }
  return (
    <ul className="space-y-2">
      {q.data.map((e) => (
        <li key={e.id}>
          <Link href={e.is_member ? `${routes.club(e.club_id)}/events/${e.id}` : routes.nearbyEvent(e.id)}
            className="flex items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-3 hover:border-fg-subtle">
            <Avatar src={e.club_avatar} name={e.club_name} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{e.title}</p>
              <p className="truncate text-xs text-fg-muted">{eventWhen(e.starts_at)} · {e.club_name}</p>
              <p className="truncate text-xs text-fg-subtle">
                {e.km != null && `${String(e.km).replace('.', ',')} km · `}{e.location_name ?? 'Điểm hẹn công cộng'}
                {e.pace_text && ` · pace ${e.pace_text}`} · {e.going_count}{e.capacity ? `/${e.capacity}` : ''} người
              </p>
            </div>
            {e.my_status === 'GOING' ? <span className="rounded-full bg-brand/15 px-2 py-1 text-[11px] font-semibold text-brand">Sẽ đi</span>
              : <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />}
          </Link>
        </li>
      ))}
    </ul>
  )
}

function Clubs({ radius }: { radius: Radius }) {
  const q = useNearbyClubs(radius)
  if (q.isPending) return <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
  if (q.isError) return <ErrorState message={nearbyErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
  if (q.data.length === 0) {
    return <EmptyState icon={Users} title="Chưa có CLB nào đánh dấu khu vực ở gần" description="Ban quản trị CLB đặt khu vực trong Cài đặt CLB để runner quanh đó tìm thấy." />
  }
  return (
    <ul className="space-y-2">
      {q.data.map((c) => (
        <li key={c.id}>
          <Link href={routes.club(c.id)} className="flex items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-3 hover:border-fg-subtle">
            <Avatar src={c.avatar_url} name={c.name} ring={c.accent_color} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{c.name}</p>
              <p className="truncate text-xs text-fg-muted">
                {c.km <= 1 ? 'khoảng 1 km' : `khoảng ${c.km} km`}{c.area_label ? ` · ${c.area_label}` : ''} · {c.member_count ?? 0} thành viên
              </p>
              {c.upcoming > 0 && <p className="text-xs text-brand">{c.upcoming} buổi chạy công khai sắp tới</p>}
            </div>
            {c.is_member ? <span className="rounded-full bg-surface-2 px-2 py-1 text-[11px] font-semibold text-fg-muted">Đã tham gia</span>
              : <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />}
          </Link>
        </li>
      ))}
    </ul>
  )
}
