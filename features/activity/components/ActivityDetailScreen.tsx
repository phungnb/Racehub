'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Coins, Flame, Footprints, Gauge, Heart, HeartPulse, Loader2, Lock, MapPinOff, Mountain, Share2, Sparkles, Timer, Trophy, Zap,
} from 'lucide-react'
import { Avatar, Button, Card, ErrorState, SectionTitle, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin, formatDuration, formatKm, formatNumber, formatPace, paceFrom } from '@/shared/lib/format'
import { routes } from '@/shared/config/routes'
import { CheerButton } from '@/features/game'
import { activityErrorMessage, type ActivityDetail } from '../api/activities'
import { useActivityDetail } from '../hooks/useActivityDetail'
import { compareNotes, decodePolyline, fastestSplit, splitPace, splitsFromPoints, type LatLng, type Split } from '../model/route'
import { RouteMap } from './RouteMap'
import { ShareActivitySheet } from './ShareActivity'

const SOURCE_LABEL: Record<string, string> = { STRAVA: 'Strava', DIRECT_GPS: 'GPS RaceHub', GARMIN: 'Garmin', COROS: 'COROS' }

/** Tuyến chạy + từng km của một bài, dùng chung cho màn chi tiết và ảnh chia sẻ */
export function useRouteData(a: ActivityDetail | undefined) {
  return useMemo(() => {
    if (!a) return { route: [] as LatLng[], splits: [] as Split[] }
    const route: LatLng[] = a.polyline ? decodePolyline(a.polyline) : (a.points ?? []).map((p) => [p[0], p[1]] as LatLng)
    const splits = a.splits?.length ? a.splits : a.points?.length ? splitsFromPoints(a.points) : []
    return { route, splits }
  }, [a])
}

export function ActivityDetailScreen({ id }: { id: string }) {
  const router = useRouter()
  const q = useActivityDetail(id)
  const [sharing, setSharing] = useState(false)
  const { route, splits } = useRouteData(q.data)

  const back = (
    <button type="button" onClick={() => (history.length > 1 ? router.back() : router.push(routes.feed))} aria-label="Quay lại"
      className="-ml-2 grid size-11 shrink-0 place-items-center rounded-full text-fg-muted hover:bg-surface-2"><ArrowLeft className="size-5" aria-hidden /></button>
  )
  if (q.isPending) return <div className="space-y-4">{back}<Skeleton className="h-64" /><Skeleton className="h-28" /><Skeleton className="h-60" /></div>
  if (q.isError) return <div className="space-y-4">{back}<ErrorState message={activityErrorMessage(q.error)} onRetry={() => void q.refetch()} /></div>

  const a = q.data
  const pace = a.avg_pace_s || paceFrom(a.distance_m, a.moving_s)
  const notes = a.is_mine ? compareNotes(a.compare, a.distance_m, pace) : []
  const when = new Date(a.started_at)
  const whenText = when.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' })
    + ' · ' + when.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })

  return (
    <div className="space-y-5 pb-6 animate-fade-in">
      <div className="flex items-start gap-2">
        {back}
        <div className="min-w-0 flex-1 pt-1">
          <h1 className="text-xl font-bold leading-tight">{a.title}</h1>
          <p className="text-xs capitalize text-fg-subtle">{whenText}</p>
          <p className="text-xs text-fg-subtle">{[SOURCE_LABEL[a.source ?? ''] ?? a.source, a.device_name].filter(Boolean).join(' · ')}</p>
        </div>
        {a.is_mine && (
          <Button size="sm" onClick={() => setSharing(true)} className="mt-1 shrink-0"><Share2 className="size-4" aria-hidden />Chia sẻ</Button>
        )}
      </div>

      {!a.is_mine && (
        <div className="flex items-center gap-3">
          <Avatar src={a.owner.avatar_url} name={a.owner.display_name ?? 'Runner'} size="sm" />
          <span className="min-w-0 flex-1 truncate font-semibold">{a.owner.display_name ?? 'Runner'}</span>
          <CheerButton toUser={a.owner.id} toName={a.owner.display_name ?? 'Runner'} toAvatar={a.owner.avatar_url} activityId={a.id} total={a.cheers.total} />
        </div>
      )}

      {a.is_mine && a.validation_status === 'PENDING' && (
        <p className="rounded-2xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          Bài đang chờ xác minh{a.validation_reason ? `: ${a.validation_reason}` : ''}. Chưa được tính thưởng và thử thách.
        </p>
      )}

      {/* Bản đồ */}
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-border">
        {!a.map_allowed ? (
          <Placeholder icon={Lock} text="Người chạy để bản đồ ở chế độ riêng tư" />
        ) : route.length >= 2 ? (
          <RouteMap route={route} className="h-64 w-full" />
        ) : (
          <Placeholder icon={MapPinOff} text={a.needs_detail ? 'Đang lấy tuyến chạy từ Strava…' : 'Bài chạy không có dữ liệu GPS'} />
        )}
      </div>

      {/* Số liệu chính */}
      <Card className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Big label="Quãng đường" value={formatKm(a.distance_m)} unit="km" accent />
          <Big label="Thời gian" value={formatDuration(a.moving_s)} />
          <Big label="Pace" value={formatPace(pace)} unit="/km" />
        </div>
        <div className="grid grid-cols-3 gap-2 border-t border-border pt-4">
          <Small icon={Mountain} label="Leo dốc" value={`${formatNumber(Math.round(a.elevation_gain_m))} m`} />
          <Small icon={HeartPulse} label="Nhịp tim TB" value={a.avg_heartrate ? `${Math.round(a.avg_heartrate)} bpm` : '—'} />
          <Small icon={Zap} label="Nhịp tim tối đa" value={a.max_heartrate ? `${Math.round(a.max_heartrate)} bpm` : '—'} />
          <Small icon={Footprints} label="Nhịp bước" value={a.avg_cadence ? `${Math.round(a.avg_cadence)} spm` : '—'} />
          <Small icon={Flame} label="Calo" value={a.calories ? `${formatNumber(Math.round(a.calories))} kcal` : '—'} />
          <Small icon={Timer} label="Tổng thời gian" value={formatDuration(a.elapsed_s || a.moving_s)} />
        </div>
        {notes.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 border-t border-border pt-3">
            {notes.map((n) => (
              <li key={n} className="flex items-center gap-1 rounded-full bg-brand/10 px-2.5 py-1 text-xs font-semibold text-brand">
                <Sparkles className="size-3.5" aria-hidden />{n}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Từng km */}
      <section>
        <SectionTitle>Từng km</SectionTitle>
        {splits.length > 0 ? <Splits splits={splits} />
          : a.needs_detail ? <p className="flex items-center gap-2 text-sm text-fg-muted"><Loader2 className="size-4 animate-spin" aria-hidden />Đang lấy dữ liệu từng km từ Strava…</p>
          : <p className="text-sm text-fg-muted">Bài chạy này không có dữ liệu từng km.</p>}
      </section>

      {/* Phần thưởng + thử thách */}
      {a.is_mine && (Number(a.earned_xu) > 0 || Number(a.earned_xp) > 0 || a.challenges.length > 0) && (
        <section className="space-y-2">
          <SectionTitle>Bài chạy này mang lại</SectionTitle>
          {(Number(a.earned_xu) > 0 || Number(a.earned_xp) > 0) && (
            <Card className="flex items-center gap-4">
              <span className="flex items-center gap-1.5 font-mono text-lg font-bold text-coin"><Coins className="size-5" aria-hidden />+{formatCoin(a.earned_xu ?? 0)} Xu</span>
              <span className="font-mono text-lg font-bold text-xp">+{formatNumber(a.earned_xp ?? 0)} XP</span>
            </Card>
          )}
          {a.challenges.map((c) => (
            <Link key={c.id} href={routes.challenge(c.id)} className="flex items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-3 hover:border-fg-subtle">
              <Trophy className="size-5 shrink-0 text-coin" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{c.title}</span>
              <span className="shrink-0 font-mono text-sm text-brand">+{formatKm(c.counted_m)} km</span>
            </Link>
          ))}
        </section>
      )}

      {a.cheers.count > 0 && (
        <p className="flex items-center gap-1.5 text-sm text-fg-muted">
          <Heart className="size-4 text-live" aria-hidden />{a.cheers.count} lượt cổ vũ · {formatCoin(a.cheers.total)} Xu
        </p>
      )}

      {sharing && <ShareActivitySheet activity={a} route={a.map_allowed ? route : []} onClose={() => setSharing(false)} />}
    </div>
  )
}

function Placeholder({ icon: Icon, text }: { icon: typeof Lock; text: string }) {
  return (
    <div className="grid h-40 place-items-center bg-surface-2 text-center text-sm text-fg-muted">
      <span className="flex flex-col items-center gap-2"><Icon className="size-6 text-fg-subtle" aria-hidden />{text}</span>
    </div>
  )
}

function Big({ label, value, unit, accent }: { label: string; value: string; unit?: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className={cn('font-mono tabular text-2xl font-bold', accent && 'text-brand')}>{value}{unit && <span className="ml-0.5 text-xs font-medium text-fg-muted">{unit}</span>}</p>
    </div>
  )
}

function Small({ icon: Icon, label, value }: { icon: typeof Gauge; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4 shrink-0 text-fg-subtle" aria-hidden />
      <span className="min-w-0">
        <span className="block text-[11px] text-fg-subtle">{label}</span>
        <span className="block truncate font-mono text-sm font-semibold">{value}</span>
      </span>
    </div>
  )
}

/** Bảng từng km: thanh ngang theo pace (dài hơn = nhanh hơn), km nhanh nhất tô màu */
function Splits({ splits }: { splits: Split[] }) {
  const best = fastestSplit(splits)
  const paces = splits.map(splitPace).filter((p) => p > 0)
  const slow = Math.max(...paces), fast = Math.min(...paces)
  const hasHr = splits.some((s) => s.hr)
  const hasElev = splits.some((s) => s.elev_m !== null)
  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-surface">
      <div className="grid grid-cols-[2.5rem_3.5rem_1fr_auto] items-center gap-2 border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
        <span>Km</span><span>Pace</span><span /><span className="flex gap-3">{hasElev && <span className="w-10 text-right">Dốc</span>}{hasHr && <span className="w-9 text-right">Tim</span>}</span>
      </div>
      <ol>
        {splits.map((s, i) => {
          const p = splitPace(s)
          // 40% → 100% chiều dài: km chậm nhất ngắn nhất
          const w = slow === fast ? 100 : 40 + (60 * (slow - p)) / (slow - fast)
          const partial = s.distance_m < 900
          return (
            <li key={i} className="grid grid-cols-[2.5rem_3.5rem_1fr_auto] items-center gap-2 px-3 py-1.5 text-sm">
              <span className="font-mono text-fg-muted">{partial ? (s.distance_m / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) : i + 1}</span>
              <span className={cn('font-mono font-semibold', i === best && 'text-brand')}>{formatPace(p)}</span>
              <span className="h-2.5 overflow-hidden rounded-full bg-surface-2">
                <span className={cn('block h-full rounded-full', i === best ? 'bg-brand' : 'bg-xp/70')} style={{ width: `${w}%` }} />
              </span>
              <span className="flex gap-3 font-mono text-xs text-fg-muted">
                {hasElev && <span className="w-10 text-right">{s.elev_m === null ? '—' : `${s.elev_m > 0 ? '+' : ''}${Math.round(s.elev_m)}`}</span>}
                {hasHr && <span className="w-9 text-right">{s.hr ?? '—'}</span>}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
