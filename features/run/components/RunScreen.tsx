'use client'

import Link from 'next/link'
import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock3, Gift, Gauge, Loader2, Lock, MapPin, Pause, Play, Satellite, Smartphone, Square, Timer, Unlock, Volume2, VolumeX, Watch, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, CoinAmount, HoldButton, XpAmount } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatDuration, formatKm, formatPace } from '@/shared/lib/format'
import { RewardCascade, useActivityRewards, useMarkSeen } from '@/features/game'
import { useRunTracker, type GpsState } from '../hooks/useRunTracker'

const GPS_LABEL: Record<GpsState, { text: string; tone: string }> = {
  OFF: { text: 'GPS tắt', tone: 'text-fg-subtle' },
  SEARCHING: { text: 'Đang tìm GPS…', tone: 'text-warning' },
  GOOD: { text: 'GPS tốt', tone: 'text-success' },
  WEAK: { text: 'GPS yếu', tone: 'text-warning' },
  DENIED: { text: 'Chưa cấp quyền vị trí', tone: 'text-danger' },
  UNSUPPORTED: { text: 'Thiết bị không hỗ trợ GPS', tone: 'text-danger' },
}

function GpsBadge({ gps }: { gps: GpsState }) {
  const g = GPS_LABEL[gps]
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold', g.tone)}>
      <Satellite className={cn('size-3.5', gps === 'SEARCHING' && 'animate-pulse')} aria-hidden /> {g.text}
    </span>
  )
}

function Metric({ label, value, unit, icon: Icon }: { label: string; value: string; unit?: string; icon: typeof Clock3 }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
        <Icon className="size-3.5" aria-hidden />{label}
      </span>
      <span className="font-mono tabular text-2xl font-bold">{value}{unit && <span className="ml-0.5 text-sm text-fg-muted">{unit}</span>}</span>
    </div>
  )
}

export function RunScreen({ onSaved }: { onSaved?: () => void }) {
  const t = useRunTracker()
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [locked, setLocked] = useState(false)
  const avgPace = t.distanceM > 0 ? t.movingS / (t.distanceM / 1000) : 0
  const live = t.phase === 'RUNNING' || t.phase === 'PAUSED' || t.phase === 'LOCATING'

  // ---------------- Chờ bắt đầu ----------------
  if (t.phase === 'IDLE') {
    return (
      <div className="flex min-h-[70dvh] flex-col animate-fade-in">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Chạy</h1>
          <button onClick={() => t.setVoiceOn(!t.voiceOn)} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-xs font-semibold text-fg-muted"
            aria-pressed={t.voiceOn}>
            {t.voiceOn ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />} Giọng HLV {t.voiceOn ? 'bật' : 'tắt'}
          </button>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center gap-6 py-10">
          <div className="text-center">
            <p className="font-mono tabular text-7xl font-black leading-none">0,00</p>
            <p className="mt-1 text-sm font-semibold uppercase tracking-widest text-fg-subtle">Kilômét</p>
          </div>
          <button onClick={t.start} aria-label="Bắt đầu chạy"
            className="grid size-36 place-items-center rounded-full bg-brand text-brand-fg shadow-[0_0_60px_-10px] shadow-brand/60 transition-transform active:scale-95 animate-breath">
            <span className="flex flex-col items-center font-black"><Play className="size-10 fill-current" />BẮT ĐẦU</span>
          </button>
          <GpsBadge gps={t.gps} />
        </div>

        {t.error && <p role="alert" className="mb-3 rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">{t.error}</p>}
        <Card className="space-y-2 text-sm text-fg-muted">
          <p className="flex gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-brand" /> Chạy ngoài trời. Đứng yên thì app tự dừng tính km.</p>
          <p className="flex gap-2"><Smartphone className="mt-0.5 size-4 shrink-0 text-brand" /> Trình duyệt chỉ ghi GPS khi app đang mở: bấm <b className="text-fg">Khóa màn hình</b> rồi bỏ túi, màn hình tối lại và không bấm nhầm.</p>
          <p className="flex gap-2"><Watch className="mt-0.5 size-4 shrink-0 text-brand" /> Chạy dài hoặc muốn tắt hẳn màn hình? Dùng đồng hồ Garmin / COROS / Apple Watch hoặc app Strava — bài chạy tự về RaceHub.</p>
        </Card>
      </div>
    )
  }

  // ---------------- Đang chạy / tạm dừng ----------------
  if (live) {
    const status = t.phase === 'LOCATING' ? 'ĐANG TÌM GPS' : t.phase === 'PAUSED' ? 'TẠM DỪNG' : t.autoPaused ? 'TỰ TẠM DỪNG' : 'ĐANG CHẠY'
    if (locked && t.phase !== 'LOCATING') {
      return <PocketMode distanceM={t.distanceM} movingS={t.movingS} pace={avgPace} status={status} onUnlock={() => setLocked(false)} />
    }
    return (
      <div className="flex min-h-[75dvh] flex-col">
        <div className="flex items-center justify-between">
          <span className={cn('inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-black tracking-wider',
            status === 'ĐANG CHẠY' ? 'bg-brand text-brand-fg' : 'bg-warning/15 text-warning')}>
            <span className={cn('size-2 rounded-full bg-current', status === 'ĐANG CHẠY' && 'animate-pulse')} />{status}
          </span>
          <GpsBadge gps={t.gps} />
        </div>

        <div className="flex flex-1 flex-col items-center justify-center py-8 text-center">
          <p className="font-mono tabular text-[5.5rem] font-black leading-none tracking-tight">{formatKm(t.distanceM)}</p>
          <p className="mt-2 text-sm font-semibold uppercase tracking-widest text-fg-subtle">Kilômét</p>
        </div>

        <div className="grid grid-cols-3 gap-2 rounded-[var(--radius-card)] border border-border bg-surface py-4">
          <Metric label="Thời gian" icon={Timer} value={formatDuration(t.movingS)} />
          <Metric label="Pace TB" icon={Gauge} value={formatPace(avgPace)} unit="/km" />
          <Metric label="Hiện tại" icon={Clock3} value={formatPace(t.currentPace)} unit="/km" />
        </div>

        {t.splits.length > 0 && (
          <ol className="mt-3 flex gap-2 overflow-x-auto scrollbar-none" aria-label="Pace từng km">
            {t.splits.slice(-5).map((s) => (
              <li key={s.km} className="shrink-0 rounded-lg bg-surface-2 px-3 py-1.5 text-xs">
                <span className="text-fg-subtle">Km {s.km} ·</span> <span className="font-mono tabular font-bold">{formatPace(s.seconds)}</span>
              </li>
            ))}
          </ol>
        )}

        {t.gapS > 0 && (
          <p role="status" className="mt-3 flex gap-2 rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            App bị ẩn {Math.round(t.gapS / 60) || 1} phút (tắt màn hình / chuyển app) nên điện thoại dừng GPS; đoạn đó được nối thẳng.
            Lần sau hãy dùng nút Khóa màn hình.
          </p>
        )}

        {t.phase === 'LOCATING' ? (
          <div className="mt-8 flex flex-col items-center gap-3">
            <p className="flex items-center gap-2 text-sm text-fg-muted"><Loader2 className="size-4 animate-spin" /> Đang chờ tín hiệu GPS ổn định…</p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={t.discard}>Hủy</Button>
              <Button onClick={t.startAnyway}>Bắt đầu ngay</Button>
            </div>
          </div>
        ) : (
          t.phase === 'RUNNING' ? (
            <div className="mt-8 grid grid-cols-3 items-center justify-items-center">
              <RoundAction label="Khóa màn hình" onClick={() => setLocked(true)}><Lock className="size-6" aria-hidden /></RoundAction>
              <button onClick={t.pause} aria-label="Tạm dừng"
                className="grid size-24 place-items-center rounded-full bg-fg text-bg shadow-lg active:scale-95">
                <Pause className="size-10 fill-current" aria-hidden />
              </button>
              <RoundAction label={t.voiceOn ? 'Tắt giọng HLV' : 'Bật giọng HLV'} onClick={() => t.setVoiceOn(!t.voiceOn)}>
                {t.voiceOn ? <Volume2 className="size-6" aria-hidden /> : <VolumeX className="size-6" aria-hidden />}
              </RoundAction>
            </div>
          ) : (
            // Đã tạm dừng: bấm một lần là kết thúc (tạm dừng đã là bước xác nhận, như Strava / Garmin)
            <div className="mt-8 grid grid-cols-2 gap-3">
              <button onClick={t.resume} className="flex h-16 items-center justify-center gap-2 rounded-2xl bg-brand text-lg font-bold text-brand-fg active:scale-[0.98]">
                <Play className="size-6 fill-current" aria-hidden />Tiếp tục
              </button>
              <button onClick={t.finish} className="flex h-16 items-center justify-center gap-2 rounded-2xl bg-danger text-lg font-bold text-white active:scale-[0.98]">
                <Square className="size-5 fill-current" aria-hidden />Kết thúc
              </button>
            </div>
          )
        )}
      </div>
    )
  }

  // ---------------- Kết thúc: tổng kết & lưu ----------------
  if (t.phase === 'FINISHED' || t.phase === 'SAVING') {
    return (
      <div className="space-y-4 animate-fade-in">
        <h1 className="text-2xl font-bold">Tổng kết</h1>
        <Card className="text-center">
          <p className="font-mono tabular text-6xl font-black">{formatKm(t.distanceM)}<span className="ml-1 text-lg text-fg-muted">km</span></p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Metric label="Thời gian" icon={Timer} value={formatDuration(t.movingS)} />
            <Metric label="Pace TB" icon={Gauge} value={formatPace(avgPace)} unit="/km" />
          </div>
        </Card>
        {t.splits.length > 0 && (
          <Card>
            <p className="mb-2 text-sm font-semibold">Pace từng km</p>
            <ul className="space-y-1.5">
              {t.splits.map((s) => {
                const best = Math.min(...t.splits.map((x) => x.seconds))
                return (
                  <li key={s.km} className="flex items-center gap-3 text-sm">
                    <span className="w-10 text-fg-subtle">Km {s.km}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <span className="block h-full rounded-full bg-brand" style={{ width: `${(best / s.seconds) * 100}%` }} />
                    </span>
                    <span className="w-12 text-right font-mono tabular font-bold">{formatPace(s.seconds)}</span>
                  </li>
                )
              })}
            </ul>
          </Card>
        )}
        {t.error && <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">{t.error}</p>}
        <Button block size="lg" loading={t.phase === 'SAVING'} onClick={async () => { if (await t.save()) onSaved?.() }}>
          Lưu bài chạy
        </Button>
        {confirmDiscard ? (
          <div className="flex gap-2">
            <Button block variant="secondary" onClick={() => setConfirmDiscard(false)}>Giữ lại</Button>
            <Button block variant="danger" onClick={() => { t.discard(); toast('Đã bỏ bài chạy') }}>Bỏ bài chạy</Button>
          </div>
        ) : (
          <Button block variant="ghost" onClick={() => setConfirmDiscard(true)} disabled={t.phase === 'SAVING'}>Bỏ bài chạy này</Button>
        )}
      </div>
    )
  }

  // ---------------- Đã lưu: kết quả xác thực + phần thưởng (MH 16–17) ----------------
  const r = t.result
  const verdict = r?.validation_status === 'APPROVED'
    ? { icon: CheckCircle2, title: 'Bài chạy hợp lệ', tone: 'text-success bg-success/10' }
    : r?.validation_status === 'PENDING'
      ? { icon: AlertTriangle, title: 'Đang chờ xác minh', tone: 'text-warning bg-warning/10' }
      : { icon: XCircle, title: 'Không được ghi nhận', tone: 'text-danger bg-danger/10' }
  return (
    <div className="space-y-4 animate-fade-in">
      <div className={cn('flex flex-col items-center gap-2 rounded-[var(--radius-card)] px-4 py-6 text-center', verdict.tone)}>
        <verdict.icon className="size-12" aria-hidden />
        <p className="text-xl font-bold">{verdict.title}</p>
        {r?.validation_reason && <p className="text-sm opacity-90">{r.validation_reason}</p>}
      </div>
      <Card className="grid grid-cols-2 gap-3 text-center">
        <div><p className="text-xs text-fg-subtle">Quãng đường</p><p className="font-mono tabular text-2xl font-bold">{formatKm(r?.distance_m ?? t.distanceM)} km</p></div>
        <div><p className="text-xs text-fg-subtle">Thời gian</p><p className="font-mono tabular text-2xl font-bold">{formatDuration(t.movingS)}</p></div>
        <div><p className="text-xs text-fg-subtle">Phần thưởng</p><CoinAmount value={r?.earned_xu ?? 0} className="text-xl" /></div>
        <div><p className="text-xs text-fg-subtle">Kinh nghiệm</p><XpAmount value={r?.earned_xp ?? 0} className="text-xl" /></div>
      </Card>
      {r?.activity_id && r.validation_status === 'APPROVED' && <RunRewards activityId={r.activity_id} />}
      <div className="flex gap-2">
        <Button block variant="secondary" onClick={t.discard}>Chạy tiếp</Button>
        <Link href="/feed" className="flex-1"><Button block>Về trang chủ</Button></Link>
      </div>
    </div>
  )
}

function RoundAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-1.5 text-fg-muted active:scale-95">
      <span className="grid size-14 place-items-center rounded-full bg-surface-2">{children}</span>
      <span className="text-[11px] font-semibold">{label}</span>
    </button>
  )
}

/**
 * Chế độ bỏ túi: màn hình đen (tiết kiệm pin màn OLED), chữ lớn, chạm nhầm không có tác dụng.
 * Mở khóa bằng cách giữ nút 1,5 giây — chỉ ở đây mới cần giữ, để tránh bấm nhầm trong túi.
 */
function PocketMode({ distanceM, movingS, pace, status, onUnlock }: { distanceM: number; movingS: number; pace: number; status: string; onUnlock: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] flex flex-col items-center justify-between bg-black px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] text-white">
      <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black tracking-wider text-white/70">{status}</span>
      <div className="text-center">
        <p className="font-mono tabular text-[6.5rem] font-black leading-none text-brand">{formatKm(distanceM)}</p>
        <p className="mt-1 text-sm font-semibold uppercase tracking-widest text-white/50">Kilômét</p>
        <div className="mt-10 grid grid-cols-2 gap-10">
          <div><p className="text-xs uppercase tracking-wider text-white/50">Thời gian</p><p className="font-mono tabular text-4xl font-bold">{formatDuration(movingS)}</p></div>
          <div><p className="text-xs uppercase tracking-wider text-white/50">Pace TB</p><p className="font-mono tabular text-4xl font-bold">{formatPace(pace)}</p></div>
        </div>
      </div>
      <div className="flex flex-col items-center gap-2">
        <HoldButton onComplete={onUnlock} label="Giữ để mở khóa" className="bg-white/10 text-white">
          <Unlock className="size-7" aria-hidden />
        </HoldButton>
        <span className="text-xs font-semibold text-white/50">Giữ để mở khóa</span>
      </div>
    </div>
  )
}

/** Tổng kết sau chạy (MH17): tự mở chuỗi phần thưởng một lần, xem lại được */
function RunRewards({ activityId }: { activityId: string }) {
  const q = useActivityRewards(activityId)
  const markSeen = useMarkSeen()
  // null = chưa thao tác: tự mở khi có từ 2 phần thưởng trở lên
  const [open, setOpen] = useState<boolean | null>(null)
  const events = q.data ?? []
  if (q.isPending) return <div className="h-14 animate-pulse rounded-xl bg-surface-2" aria-label="Đang tính phần thưởng" />
  if (events.length <= 1) return null
  const close = () => { setOpen(false); markSeen.mutate(events.map((e) => e.id)) }
  return (
    <>
      <Button block variant="secondary" onClick={() => setOpen(true)}>
        <Gift className="size-4 text-coin" aria-hidden />Xem {events.length} phần thưởng của bài chạy
      </Button>
      <RewardCascade events={events} open={open ?? events.length > 1} onClose={close} title="Tổng kết buổi chạy" />
    </>
  )
}
