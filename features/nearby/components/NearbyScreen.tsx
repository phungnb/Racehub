'use client'

import Link from 'next/link'
import { useState } from 'react'
import { CalendarDays, ChevronRight, EyeOff, Footprints, MapPin, MessageCircle, Newspaper, Radar, Settings2, ShieldAlert, UserPlus, Users, UsersRound } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Card, EmptyState, ErrorState, LevelBadge, PageHeader, SegmentedControl, Sheet, Skeleton, ScrollRow, SwitchRow } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import {
  clearPresence, nearbyErrorMessage, sendConnection, setDiscovery, setPresence, type Discovery, type DiscoveryInput, type FeedPost, type FeedRun,
  type Goal, type NearbyFilters, type Purpose, type Radius, type Slot,
} from '../api/nearbyApi'
import { useDiscovery, useNearbyClubs, useNearbyEvents, useNearbyFeed, useNearbyMutation, useNearbyRunners } from '../hooks/useNearby'
import { dayLabel, eventWhen, expiresIn, formatKm, formatPace, GOALS, PACE_FILTERS, PURPOSES, RADII, SLOTS } from '../model/nearby'
import { AUTO_AREA_TERMS, EnableSheet, PrefsForm } from './EnableSheet'
import { LocationPicker, type PickedPlace } from './LocationPicker'
import { RunnerCard } from './RunnerCard'

type Tab = 'feed' | 'runners' | 'events' | 'clubs'

/**
 * Runner quanh đây: bảng tin hoạt động gần mình, runner hợp pace / giờ / mục tiêu, buổi chạy công khai và CLB gần.
 * Vị trí: khu hay chạy tự động (từ điểm xuất phát bài chạy — không cần mở app mỗi ngày) hoặc khu vực tạm tự chọn.
 */
export function NearbyScreen() {
  const me = useDiscovery()
  return (
    <div className="space-y-4">
      <PageHeader title="Quanh đây" subtitle="Bạn chạy cùng pace, buổi chạy nhóm, CLB gần bạn" action={
        <Link href={routes.nearbyConnections} className="relative inline-flex h-11 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-semibold hover:border-fg-subtle">
          <UsersRound className="size-4" aria-hidden />Kết nối
          {!!me.data?.incoming && <span className="absolute -right-1.5 -top-1.5 grid min-w-5 place-items-center rounded-full bg-live px-1 text-[11px] font-bold text-white">{me.data.incoming}</span>}
        </Link>} />
      {me.isPending ? <div className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
        : me.isError ? <ErrorState message={nearbyErrorMessage(me.error)} error={me.error} onRetry={() => void me.refetch()} />
        : <Body d={me.data} />}
    </div>
  )
}

function Body({ d }: { d: Discovery }) {
  const [enableOpen, setEnableOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('feed')
  const [radius, setRadius] = useState<Radius>(d.radius_km)
  const live = d.enabled && d.located

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
              <p className="font-semibold">{d.enabled ? 'Chưa có khu vực' : 'Tìm bạn chạy quanh bạn'}</p>
              <p className="text-sm text-fg-muted">
                {d.enabled ? 'Bật "khu hay chạy tự động" để không phải chọn lại mỗi ngày, hoặc chọn khu vực tạm.'
                  : 'Thấy runner, bài chạy và buổi chạy nhóm gần bạn — chỉ chia sẻ vùng ~1–2 km, bạn quyết định ai thấy mình.'}
              </p>
            </div>
          </div>
          <Button block onClick={() => setEnableOpen(true)}>{d.enabled ? 'Chọn khu vực' : 'Bật Quanh đây'}</Button>
        </Card>
      )}
      {enableOpen && <EnableSheet me={d} open onClose={() => setEnableOpen(false)} />}
      <HubBanner />

      {d.located && (
        <>
          <SegmentedControl value={tab} onChange={setTab} options={[
            { value: 'feed', label: 'Bảng tin' }, { value: 'runners', label: 'Runner' }, { value: 'events', label: 'Buổi chạy' }, { value: 'clubs', label: 'CLB' },
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
          {tab === 'feed' && <Feed radius={radius} onFallback={setTab} />}
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
  // Ẩn ngay: xoá vị trí tạm + tắt khu hay chạy tự động
  const hide = useNearbyMutation(async () => {
    if (d.presence) await clearPresence()
    if (d.auto_area) await setDiscovery({ auto_area: false })
  })
  const p = d.presence
  const title = p ? (p.area_label ?? (p.source === 'DEVICE' ? 'Quanh vị trí của bạn' : 'Khu vực đã chọn')) : 'Khu hay chạy (tự động)'
  const sub = p ? `Vị trí tạm · ${expiresIn(p.expires_at)}${d.auto_area ? ' · sau đó dùng khu hay chạy' : ''}`
    : `Từ ${d.home?.runs ?? 0} bài chạy gần đây · tự cập nhật, không cần mở app`
  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="relative grid size-11 shrink-0 place-items-center rounded-2xl bg-brand/15 text-brand">
          {p ? <MapPin className="size-5" aria-hidden /> : <Footprints className="size-5" aria-hidden />}
          <span className="absolute right-1 top-1 size-2.5 rounded-full bg-brand ring-2 ring-surface" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{title}</p>
          <p className="text-xs text-fg-muted">Đang hiện · {sub} · {d.connections} kết nối</p>
        </div>
        <Button size="sm" variant="ghost" aria-label="Cài đặt Quanh đây" onClick={() => setSheet('settings')}><Settings2 className="size-5" aria-hidden /></Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="sm" disabled={!!p && p.moves_left === 0} onClick={() => setSheet('move')}>
          <MapPin className="size-4" aria-hidden />{p ? `Đổi khu vực${p.moves_left < 3 ? ` (${p.moves_left})` : ''}` : 'Đang ở nơi khác'}
        </Button>
        <Button variant="secondary" size="sm" loading={hide.isPending}
          onClick={() => hide.mutate(undefined, { onSuccess: () => toast.success('Đã ẩn bạn khỏi Quanh đây', { description: 'Vị trí đã xoá. Chọn lại khu vực để hiện.' }) })}>
          <EyeOff className="size-4" aria-hidden />Ẩn tôi ngay
        </Button>
      </div>
      {sheet === 'move' && <MoveSheet area={p?.area_label ?? null} onClose={() => setSheet(null)} />}
      {sheet === 'settings' && <SettingsSheet d={d} onClose={() => setSheet(null)} />}
    </Card>
  )
}

/** Lối vào Hội quán runner (toàn quốc) */
function HubBanner() {
  return (
    <Link href={routes.hub} className="flex items-center gap-3 rounded-[var(--radius-card)] border border-violet-500/30 bg-gradient-to-r from-violet-500/15 to-transparent p-3 hover:border-violet-400/60">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-500/20 text-violet-300"><UsersRound className="size-5" aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold">Hội quán runner</span>
        <span className="block text-xs text-fg-muted">Runner khắp Việt Nam: khoe thành tích, rủ đi giải, tìm pacer, tìm bạn hợp pace</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
    </Link>
  )
}

function MoveSheet({ area, onClose }: { area: string | null; onClose: () => void }) {
  const move = useNearbyMutation((x: PickedPlace) => setPresence(x.lat, x.lng, x.source, x.area, x.hours))
  return (
    <Sheet open onClose={onClose} title="Khu vực tạm thời" description="Dùng khi bạn đang ở nơi khác (đi công tác, du lịch). Đổi tối đa 3 lần / 24 giờ để không ai dò được vị trí chính xác.">
      <LocationPicker initialArea={area} busy={move.isPending}
        onPick={(x) => move.mutate(x, { onSuccess: () => { toast.success('Đã cập nhật khu vực'); onClose() }, onError: (e) => toast.error(nearbyErrorMessage(e)) })} />
    </Sheet>
  )
}

function SettingsSheet({ d, onClose }: { d: Discovery; onClose: () => void }) {
  const [prefs, setPrefs] = useState<DiscoveryInput>({
    visible_to: d.visible_to, purposes: d.purposes, goals: d.goals, time_slots: d.time_slots, share_pace: d.share_pace, bio: d.bio, auto_area: d.auto_area,
  })
  const save = useNearbyMutation((p: DiscoveryInput) => setDiscovery({ ...p, auto_consent: p.auto_area && !d.auto_area ? true : undefined }))
  const run = (p: DiscoveryInput, msg: string) => save.mutate(p, { onSuccess: () => { toast.success(msg); onClose() }, onError: (e) => toast.error(nearbyErrorMessage(e)) })
  return (
    <Sheet open onClose={onClose} title="Cài đặt Quanh đây"
      footer={<Button block loading={save.isPending} onClick={() => run(prefs, 'Đã lưu')}>Lưu</Button>}>
      <div className="space-y-5">
        <SwitchRow checked={!!prefs.auto_area} onChange={(on) => setPrefs({ ...prefs, auto_area: on })} icon={Footprints}
          label="Khu hay chạy tự động" description={`${AUTO_AREA_TERMS} Bật = bạn đồng ý cách xử lý này.`} />
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
      <ScrollRow className="-mx-4" innerClassName="gap-1.5 px-4 pb-1">
        <Select label="Pace" value={pace} options={PACE_FILTERS} onChange={setPace} />
        <Select label="Mục đích" value={purpose} options={{ ALL: 'Mọi mục đích', ...PURPOSES }} onChange={setPurpose} />
        <Select label="Mục tiêu" value={goal} options={{ ALL: 'Mọi mục tiêu', ...GOALS }} onChange={setGoal} />
        <Select label="Khung giờ" value={slot} options={{ ALL: 'Mọi khung giờ', ...SLOTS }} onChange={setSlot} />
      </ScrollRow>
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

/** Bảng tin quanh đây: ai vừa chạy gần mình + bài rủ chạy gần mình. Không tuyến, không giờ chính xác. */
function Feed({ radius, onFallback }: { radius: Radius; onFallback: (t: Tab) => void }) {
  const q = useNearbyFeed(radius)
  if (q.isPending) return <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
  if (q.isError) return <ErrorState message={nearbyErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
  if (q.data.items.length === 0) {
    return (
      <EmptyState icon={Newspaper} title="Tuần này chưa có hoạt động quanh bạn"
        description={q.data.people ? `Có ${q.data.people} runner trong ${radius} km nhưng 7 ngày qua chưa ai chia sẻ bài chạy.` : 'Quanh đây còn ít người bật. Rủ bạn bè cùng bật, hoặc đăng bài rủ chạy ở Hội quán.'}
        action={<div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => onFallback('events')}><CalendarDays className="size-4" aria-hidden />Buổi chạy</Button>
          <Link href={routes.hub} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-semibold"><UsersRound className="size-4" aria-hidden />Hội quán</Link>
        </div>} />
    )
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-fg-muted">{q.data.people} runner trong {radius} km · 7 ngày qua · chỉ bài họ đã chia sẻ, không hiện tuyến chạy</p>
      <ul className="space-y-2">
        {q.data.items.map((x) => x.type === 'RUN'
          ? <RunItem key={`r-${x.user.id}-${x.at}`} x={x} />
          : <PostItem key={`p-${x.id}`} x={x} />)}
      </ul>
    </div>
  )
}

function RunItem({ x }: { x: FeedRun }) {
  const [sent, setSent] = useState(false)
  const connect = useNearbyMutation(() => sendConnection(x.user.id, null))
  const pace = formatPace(x.distance_m > 0 ? Math.round(x.moving_time_s / (x.distance_m / 1000)) : null)
  return (
    <li className="flex items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-3">
      <Avatar src={x.user.avatar_url} name={x.user.name} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm"><b className="truncate">{x.user.name}</b>{x.user.level != null && <LevelBadge level={x.user.level} />}</p>
        <p className="text-sm">chạy <b>{(x.distance_m / 1000).toFixed(1).replace('.', ',')} km</b>{pace && <> · {pace}</>} · {dayLabel(x.day)}</p>
        <p className="text-xs text-fg-subtle">{formatKm(x.km)}{x.where === 'HOME' ? ' · khu hay chạy' : ''}</p>
      </div>
      {x.connection === 'CONNECTED'
        ? <Link href={routes.message(x.user.id)} aria-label={`Nhắn tin cho ${x.user.name}`} className="grid size-10 place-items-center rounded-xl border border-border text-brand"><MessageCircle className="size-4" aria-hidden /></Link>
        : <Button size="sm" variant="secondary" disabled={sent} loading={connect.isPending} aria-label={`Kết nối với ${x.user.name}`}
            onClick={() => connect.mutate(undefined, { onSuccess: () => { setSent(true); toast.success('Đã gửi lời mời kết nối') }, onError: (e) => toast.error(nearbyErrorMessage(e)) })}>
            <UserPlus className="size-4" aria-hidden />{sent ? 'Đã gửi' : 'Kết nối'}
          </Button>}
    </li>
  )
}

const POST_KIND: Record<string, string> = { BUDDY: 'Rủ chạy', RACE: 'Đi giải cùng', PACER: 'Cần pacer', SHARE: 'Khoe thành tích', ASK: 'Hỏi đáp' }

function PostItem({ x }: { x: FeedPost }) {
  return (
    <li>
      <Link href={routes.hubPost(x.id)} className="block space-y-1.5 rounded-[var(--radius-card)] border border-violet-500/30 bg-violet-500/5 p-3 hover:border-violet-400/60">
        <p className="flex items-center gap-2 text-xs">
          <span className="rounded-full bg-violet-500/20 px-2 py-0.5 font-bold text-violet-300">{POST_KIND[x.kind] ?? 'Bài đăng'}</span>
          <span className="truncate text-fg-muted">{x.author.name} · {formatKm(x.km)}</span>
        </p>
        <p className="line-clamp-3 text-sm">{x.body}</p>
        <p className="text-xs text-fg-subtle">{x.interest_count} người quan tâm · bấm để xem trong Hội quán</p>
      </Link>
    </li>
  )
}
