'use client'

import { useState } from 'react'
import { AlertTriangle, Check, RotateCcw, X } from 'lucide-react'
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
  risk_flags: { code: string; severity: string; tier?: string | null; message?: string }[] | null
  can_review?: boolean
  /** Bài bị loại vì trùng giờ với bài khác đang được tính — không khôi phục được */
  overlap?: boolean
  /** 013100: giải trình của người chạy */
  owner_note?: string | null
  profiles: { display_name: string | null; avatar_url?: string | null } | null
}

const FLAG_LABEL: Record<string, string> = {
  MANUAL: 'Nhập tay', TREADMILL: 'Chạy máy', SUSTAINED_SPEED: 'Tốc độ duy trì', VEHICLE_BURST: 'Giống đi xe',
  GPS_TELEPORT: 'GPS nhảy', GPS_GAP: 'Mất tín hiệu GPS', STRIDE: 'Sải chân', HR_PACE: 'Tim thấp / pace nhanh', HISTORY: 'Khác thường ngày', PACE_CURVE: 'Nhanh hơn kỷ lục',
  GPS_DISTANCE_GAIN: 'Vị trí dịch chuyển', DISTANCE_MISMATCH: 'Lệch km',
}
/** Mức của dấu hiệu (012500): cảnh báo ≠ đủ căn cứ loại */
const TIER: Record<string, { label: string; tone: string }> = {
  DISQUALIFY: { label: 'Đủ căn cứ loại', tone: 'border-danger bg-danger/15 text-danger' },
  SUSPECT: { label: 'Nghi vấn', tone: 'border-danger/50 text-danger' },
  WARN: { label: 'Cảnh báo', tone: 'border-warning/60 text-warning' },
  NOTE: { label: 'Ghi chú', tone: 'border-border text-fg-subtle' },
}
const tierOf = (f: { severity: string; tier?: string | null }) => f.tier ?? (f.severity === 'SEVERE' ? 'SUSPECT' : f.severity === 'HIGH' ? 'WARN' : 'NOTE')
export const RISK_LABEL = { LOW: 'Thấp', MEDIUM: 'Trung bình', HIGH: 'Cao', CRITICAL: 'Rất cao' } as const
const RISK_TONE = { LOW: 'bg-surface-2 text-fg-muted', MEDIUM: 'bg-warning/15 text-warning', HIGH: 'bg-danger/15 text-danger', CRITICAL: 'bg-danger text-bg' } as const
const SOURCE_LABEL: Record<string, string> = { STRAVA: 'Strava', DIRECT_GPS: 'GPS trong app', GARMIN: 'Garmin', COROS: 'Coros' }
const pace = (s: number, m: number) => { const p = Math.round(s / (m / 1000)); return `${Math.floor(p / 60)}:${String(p % 60).padStart(2, '0')}` }

export function PendingRunCard({ run: a, onReview, onRestore, busy }: {
  run: PendingRun; busy?: boolean
  onReview?: (status: 'APPROVED' | 'REJECTED') => void
  /** Bài đã bị loại: khôi phục (bắt buộc ghi lý do) */
  onRestore?: (note: string) => void
}) {
  const [note, setNote] = useState('')
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
        {a.owner_note && <p className="rounded-md bg-surface px-2 py-1.5 text-xs text-fg"><span className="font-semibold">Người chạy giải trình: </span>{a.owner_note}</p>}
        {!!a.risk_flags?.length && (
          <div className="flex flex-wrap gap-1.5">
            {a.risk_flags.map((f, i) => {
              const t = TIER[tierOf(f)] ?? TIER.NOTE
              return (
                <span key={i} title={f.message} className={cn('rounded-full border px-2 py-0.5 text-[11px]', t.tone)}>
                  {FLAG_LABEL[f.code] ?? f.code} · {t.label}
                </span>
              )
            })}
          </div>
        )}
      </div>
      {onRestore ? (
        a.overlap ? (
          <p className="text-center text-xs text-fg-subtle">Bị loại vì trùng giờ với bài khác đang được tính — không khôi phục</p>
        ) : a.can_review === false ? (
          <p className="text-center text-xs text-fg-subtle">Bài của bạn — người khác trong ban quản trị sẽ xem lại</p>
        ) : (
          <div className="space-y-2">
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200}
              placeholder="Lý do khôi phục (vd: xem tuyến, GPS trôi dưới cầu)"
              className="h-10 w-full rounded-lg border border-border bg-surface-2 px-3 text-sm" aria-label="Lý do khôi phục" />
            <Button size="sm" block variant="secondary" disabled={busy || note.trim().length < 5} onClick={() => onRestore(note.trim())}>
              <RotateCcw className="size-4" aria-hidden />Khôi phục — tính lại Xu, XP, thử thách
            </Button>
          </div>
        )
      ) : a.can_review === false || !onReview ? (
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
