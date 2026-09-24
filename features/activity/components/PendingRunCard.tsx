'use client'

import { AlertTriangle, Check, X } from 'lucide-react'
import { Avatar, Button } from '@/shared/ui'
import { formatKm, formatRelative } from '@/shared/lib/format'
import { cn } from '@/shared/lib/cn'

/** Bài chạy chờ duyệt (bị hệ thống chống gian lận gắn cờ — migration 002300/002400) */
export interface PendingRun {
  id: string
  title: string | null
  distance_m: number
  moving_time_s: number | null
  started_at: string | null
  created_at: string
  source: string | null
  validation_reason: string | null
  risk_score: number | null
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null
  risk_flags: { code: string; severity: string; message?: string }[] | null
  can_review?: boolean
  profiles: { display_name: string | null; avatar_url?: string | null } | null
}

const FLAG_LABEL: Record<string, string> = {
  MANUAL: 'Nhập tay', TREADMILL: 'Chạy máy', SUSTAINED_SPEED: 'Tốc độ duy trì', VEHICLE_BURST: 'Giống đi xe',
  GPS_TELEPORT: 'GPS nhảy', STRIDE: 'Sải chân', HR_PACE: 'Tim thấp / pace nhanh', HISTORY: 'Khác thường ngày',
}
export const RISK_LABEL = { LOW: 'Thấp', MEDIUM: 'Trung bình', HIGH: 'Cao', CRITICAL: 'Rất cao' } as const
const RISK_TONE = { LOW: 'bg-surface-2 text-fg-muted', MEDIUM: 'bg-warning/15 text-warning', HIGH: 'bg-danger/15 text-danger', CRITICAL: 'bg-danger text-bg' } as const
const SOURCE_LABEL: Record<string, string> = { STRAVA: 'Strava', DIRECT_GPS: 'GPS trong app', GARMIN: 'Garmin', COROS: 'Coros' }
const pace = (s: number, m: number) => { const p = Math.round(s / (m / 1000)); return `${Math.floor(p / 60)}:${String(p % 60).padStart(2, '0')}` }

export function PendingRunCard({ run: a, onReview, busy }: { run: PendingRun; onReview: (status: 'APPROVED' | 'REJECTED') => void; busy?: boolean }) {
  const reason = a.validation_reason?.replace(/^Mức nghi vấn: [^.]+\.\s*/, '').replace(/\s*Bài được tính sau khi.*$/, '')
  return (
    <li className="space-y-3 rounded-xl border border-border bg-surface p-3">
      <div className="flex items-start gap-3">
        <Avatar src={a.profiles?.avatar_url} name={a.profiles?.display_name ?? 'Runner'} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{a.profiles?.display_name ?? 'Runner'}</p>
          <p className="truncate text-xs text-fg-muted">{a.title || 'Buổi chạy'} · {formatRelative(a.started_at ?? a.created_at)}{a.source ? ` · ${SOURCE_LABEL[a.source] ?? a.source}` : ''}</p>
        </div>
        <div className="text-right">
          <p className="font-mono font-semibold">{formatKm(a.distance_m)} km</p>
          {a.moving_time_s && a.distance_m > 0 ? <p className="font-mono text-xs text-fg-muted">{pace(a.moving_time_s, a.distance_m)}/km</p> : null}
        </div>
      </div>
      <div className="space-y-2 rounded-lg bg-warning/10 p-2.5">
        <p className="flex items-center gap-2 text-xs font-semibold">
          <AlertTriangle className="size-3.5 shrink-0 text-warning" aria-hidden />
          Mức nghi vấn
          {a.risk_level && <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', RISK_TONE[a.risk_level])}>{RISK_LABEL[a.risk_level]}{a.risk_score != null ? ` · ${a.risk_score}/100` : ''}</span>}
        </p>
        {reason && <p className="text-xs text-fg">{reason}</p>}
        {!!a.risk_flags?.length && (
          <div className="flex flex-wrap gap-1.5">
            {a.risk_flags.map((f, i) => (
              <span key={i} title={f.message} className={cn('rounded-full border px-2 py-0.5 text-[11px]', f.severity === 'SEVERE' ? 'border-danger/50 text-danger' : 'border-border text-fg-muted')}>
                {FLAG_LABEL[f.code] ?? f.code}
              </span>
            ))}
          </div>
        )}
      </div>
      {a.can_review === false ? (
        <p className="text-center text-xs text-fg-subtle">Bài của bạn — người khác trong ban quản trị sẽ duyệt</p>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" block onClick={() => onReview('APPROVED')} disabled={busy}><Check className="size-4" aria-hidden />Hợp lệ</Button>
          <Button size="sm" block variant="danger" onClick={() => onReview('REJECTED')} disabled={busy}><X className="size-4" aria-hidden />Không hợp lệ</Button>
        </div>
      )}
    </li>
  )
}
