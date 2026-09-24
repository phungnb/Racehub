'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Award, BadgeCheck, CalendarDays, Clock, Download, Flag, Maximize2, Medal, Palette, Timer, Users, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Card, ConfirmSheet, EmptyState, ErrorState, Input, SectionTitle, Sheet, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatNumber } from '@/shared/lib/format'
import {
  cancelRace, getRace, getRaceDashboard, getRaceResults, lookupBib, raceErrorMessage, registerRace, withdrawRace,
  type Race,
} from '../api/raceApi'
import { CERT_SIZE, drawCertificate } from '../model/certificate'
import { canRegister, dashboardCsv, distanceLabel, racePace, racePhase, raceTime } from '../model/race'
import { fmtDate, PHASE } from './RaceCard'
import { BibDesigner } from './BibDesigner'
import { downloadCanvas, EBib } from './EBib'

const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })

export function RaceDetailScreen({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['race', id], queryFn: () => getRace(id) })
  const [now] = useState(() => Date.now())
  if (q.isPending) return <div className="space-y-3"><Skeleton className="h-40" /><Skeleton className="h-32" /><Skeleton className="h-64" /></div>
  if (q.isError) return <ErrorState message={raceErrorMessage(q.error)} onRetry={() => void q.refetch()} />
  const r = q.data
  const phase = racePhase(r, now)
  return (
    <div className="space-y-5 pb-6 animate-fade-in">
      <Link href="/races" className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"><ArrowLeft className="size-4" aria-hidden />Giải chạy ảo</Link>
      <div className="rounded-[var(--radius-card)] border border-border bg-gradient-to-br from-brand/20 via-surface-2 to-surface p-4">
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', PHASE[phase].tone)}>{PHASE[phase].label}</span>
        <h1 className="mt-2 text-2xl font-bold leading-tight">{r.title}</h1>
        <p className="mt-1 text-sm text-fg-muted">
          {r.club ? `${r.club.name} tổ chức` : `Tổ chức: ${r.organizer?.display_name ?? 'RaceHub'}`}
          {r.audience === 'CLUB_ONLY' ? ' · nội bộ CLB' : ''}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <Info icon={CalendarDays} label="Thời gian" value={`${fmtDate(r.start_at)} – ${fmtDate(r.end_at)}`} />
          <Info icon={Clock} label="Hạn đăng ký" value={fmtDateTime(r.reg_close_at)} />
          <Info icon={Users} label="VĐV" value={`${formatNumber(r.registered)}${r.max_participants ? ` / ${formatNumber(r.max_participants)}` : ''}`} />
          <Info icon={Medal} label="Hoàn thành" value={formatNumber(r.finished)} />
        </div>
        {r.status === 'CANCELLED' && <p className="mt-3 rounded-xl bg-danger/10 p-2 text-sm text-danger">Giải đã hủy{r.cancelled_reason ? `: ${r.cancelled_reason}` : ''}.</p>}
      </div>
      {r.description && <p className="whitespace-pre-line text-sm text-fg-muted">{r.description}</p>}

      <BibCheck r={r} />
      <MyEntry r={r} now={now} />
      <Rules />
      <Results r={r} />
      {r.can_manage && <Organizer r={r} />}
    </div>
  )
}

function Info({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-bg/40 p-2">
      <p className="flex items-center gap-1 text-[11px] text-fg-subtle"><Icon className="size-3" aria-hidden />{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  )
}

function useRefresh(id: string) {
  const qc = useQueryClient()
  return () => { void qc.invalidateQueries({ queryKey: ['race', id] }); void qc.invalidateQueries({ queryKey: ['races'] }) }
}

function MyEntry({ r, now }: { r: Race; now: number }) {
  const refresh = useRefresh(r.id)
  const [pick, setPick] = useState<number | null>(null)
  const [cert, setCert] = useState(false)
  const [withdraw, setWithdraw] = useState(false)
  const reg = useMutation({
    mutationFn: (km: number) => registerRace(r.id, km),
    onSuccess: (d) => { toast.success(r.me ? 'Đã đổi cự ly' : `Đăng ký thành công — BIB ${d.me?.bib}`); setPick(null); refresh() },
    onError: (e) => toast.error(raceErrorMessage(e)),
  })
  const out = useMutation({
    mutationFn: () => withdrawRace(r.id),
    onSuccess: () => { toast.success('Đã rút tên'); setWithdraw(false); refresh() },
    onError: (e) => toast.error(raceErrorMessage(e)),
  })
  const open = canRegister(r, now)
  const started = now >= Date.parse(r.start_at)
  const me = r.me

  if (!me) {
    if (!open) return null
    return (
      <Card className="space-y-3 border-brand/40">
        <p className="flex items-center gap-2 font-semibold"><Flag className="size-4 text-brand" aria-hidden />Đăng ký tham gia</p>
        <div className="grid grid-cols-2 gap-2">
          {r.distances.map((d) => (
            <button key={d} type="button" aria-pressed={pick === d} onClick={() => setPick(d)}
              className={cn('rounded-xl border p-3 text-left', pick === d ? 'border-brand bg-brand/10' : 'border-border')}>
              <span className="block font-mono text-lg font-bold">{String(d).replace('.', ',')} km</span>
              <span className="text-xs text-fg-muted">{distanceLabel(d)}</span>
            </button>
          ))}
        </div>
        <Button block onClick={() => pick && reg.mutate(pick)} disabled={!pick} loading={reg.isPending}>Đăng ký & nhận BIB</Button>
      </Card>
    )
  }

  return (
    <section className="space-y-3">
      {/* e-BIB theo thiết kế của BTC */}
      <EBibCard r={r} />

      {me.status === 'FINISHED' ? (
        <Card className="space-y-3 border-coin/40">
          <p className="flex items-center gap-2 font-semibold text-coin"><Award className="size-4" aria-hidden />Bạn đã hoàn thành!</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Thành tích" value={raceTime(me.finish_time_s)} />
            <Stat label="Pace" value={racePace(me.finish_time_s! / Number(me.distance_km))} />
            <Stat label="Hạng" value={me.rank ? `#${me.rank}` : '—'} />
          </div>
          <p className="text-xs text-fg-subtle">
            Thời gian quy đổi đúng {String(me.distance_km).replace('.', ',')} km từ bài chạy {((me.finish_distance_m ?? 0) / 1000).toFixed(2).replace('.', ',')} km
            ngày {me.finished_at ? fmtDate(me.finished_at) : ''}. Chạy bài nhanh hơn trong thời gian giải sẽ tự cập nhật.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => setCert(true)}><Download className="size-4" aria-hidden />Giấy chứng nhận</Button>
            {me.finish_activity_id && <Link href={`/activities/${me.finish_activity_id}`}><Button block variant="secondary">Xem bài chạy</Button></Link>}
          </div>
        </Card>
      ) : (
        <Card className="space-y-2 text-sm">
          <p className="font-semibold">{started ? 'Giải đang diễn ra — chạy thôi!' : `Giải bắt đầu ${fmtDateTime(r.start_at)}`}</p>
          <p className="text-fg-muted">
            Chạy một bài dài từ {String(me.distance_km).replace('.', ',')} km trong thời gian giải (GPS trong app hoặc Strava). Bài hợp lệ sẽ tự ghi nhận thành tích.
          </p>
          {open && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {r.distances.filter((d) => Number(d) !== Number(me.distance_km)).map((d) => (
                <Button key={d} size="sm" variant="secondary" onClick={() => reg.mutate(d)} disabled={reg.isPending}>Đổi sang {String(d).replace('.', ',')} km</Button>
              ))}
            </div>
          )}
          {!started && <Button size="sm" variant="ghost" onClick={() => setWithdraw(true)}>Rút tên</Button>}
        </Card>
      )}
      <ConfirmSheet open={withdraw} onClose={() => setWithdraw(false)} onConfirm={() => out.mutate()} loading={out.isPending}
        title="Rút tên khỏi giải?" description="Bạn có thể đăng ký lại trước hạn và giữ nguyên số BIB." confirmLabel="Rút tên" />
      {cert && <CertificateSheet r={r} onClose={() => setCert(false)} />}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-2 p-2">
      <p className="font-mono text-lg font-bold">{value}</p>
      <p className="text-[11px] text-fg-subtle">{label}</p>
    </div>
  )
}

function Rules() {
  return (
    <details className="rounded-[var(--radius-card)] border border-border bg-surface p-4 text-sm">
      <summary className="cursor-pointer font-semibold">Luật giải</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-fg-muted">
        <li>Chạy <b className="text-fg">một bài liền mạch</b> dài bằng hoặc hơn cự ly đã đăng ký, trong thời gian giải.</li>
        <li>Chỉ tính bài hợp lệ (GPS trong app hoặc đồng bộ Strava, đã qua kiểm tra chống gian lận).</li>
        <li>Thành tích = thời gian quy đổi đúng cự ly theo pace của bài. Chạy nhiều lần: lấy bài nhanh nhất.</li>
        <li>Được đổi cự ly trước hạn đăng ký; rút tên trước giờ khai mạc.</li>
      </ul>
    </details>
  )
}

function Results({ r }: { r: Race }) {
  const [km, setKm] = useState<number>(r.me?.distance_km != null ? Number(r.me.distance_km) : Number(r.distances[0]))
  const q = useQuery({ queryKey: ['race', r.id, 'results', km], queryFn: () => getRaceResults(r.id, km), refetchInterval: 60_000 })
  return (
    <section>
      <SectionTitle>Kết quả</SectionTitle>
      <div className="mb-3 flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
        {r.distances.map((d) => (
          <button key={d} type="button" aria-pressed={km === Number(d)} onClick={() => setKm(Number(d))}
            className={cn('shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold', km === Number(d) ? 'border-brand bg-brand text-brand-fg' : 'border-border text-fg-muted')}>
            {distanceLabel(d)}
            <span className="ml-1 font-normal opacity-70">{r.per_distance?.find((p) => Number(p.distance_km) === Number(d))?.finished ?? ''}</span>
          </button>
        ))}
      </div>
      {q.isPending ? <Skeleton className="h-40" /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : !q.data.length ? (
        <EmptyState icon={Timer} title="Chưa có ai hoàn thành" description="Kết quả tự cập nhật khi VĐV có bài chạy hợp lệ." />
      ) : (
        <ol className="space-y-1.5">
          {q.data.map((x) => (
            <li key={x.user_id} className={cn('flex items-center gap-3 rounded-xl border px-3 py-2.5', x.is_me ? 'border-brand/50 bg-brand/10' : 'border-border bg-surface')}>
              <span className={cn('w-7 text-center font-mono text-sm font-bold', x.rank <= 3 ? ['text-medal-gold', 'text-medal-silver', 'text-medal-bronze'][x.rank - 1] : 'text-fg-muted')}>{x.rank}</span>
              <Avatar src={x.avatar_url} name={x.display_name ?? 'VĐV'} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{x.is_me ? 'Bạn' : x.display_name}</span>
                <span className="font-mono text-xs text-fg-subtle">{x.bib} · {racePace(x.pace_s)}</span>
              </span>
              <span className="font-mono font-bold tabular">{raceTime(x.finish_time_s)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function Organizer({ r }: { r: Race }) {
  const refresh = useRefresh(r.id)
  const dash = useQuery({ queryKey: ['race', r.id, 'dashboard'], queryFn: () => getRaceDashboard(r.id) })
  const [cancelOpen, setCancelOpen] = useState(false)
  const [design, setDesign] = useState(false)
  const [reason, setReason] = useState('')
  const cancel = useMutation({
    mutationFn: () => cancelRace(r.id, reason),
    onSuccess: () => { toast.success('Đã hủy giải và báo cho VĐV'); setCancelOpen(false); refresh() },
    onError: (e) => toast.error(raceErrorMessage(e)),
  })
  const exportCsv = () => {
    if (!dash.data) return
    const blob = new Blob([dashboardCsv(dash.data)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `ket-qua-${r.bib_prefix.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  return (
    <section>
      <SectionTitle>Ban tổ chức</SectionTitle>
      <Card className="space-y-3 border-xp/40">
        <div className="grid grid-cols-3 gap-2 text-center">
          {(r.per_distance ?? []).map((p) => (
            <div key={p.distance_km} className="rounded-xl bg-surface-2 p-2">
              <p className="text-xs text-fg-subtle">{distanceLabel(p.distance_km)}</p>
              <p className="font-mono font-bold">{p.finished}/{p.registered}</p>
              <p className="text-[10px] text-fg-subtle">hoàn thành / đăng ký</p>
            </div>
          ))}
        </div>
        {dash.isPending ? <Skeleton className="h-24" /> : dash.isError ? <ErrorState message={raceErrorMessage(dash.error)} /> : (
          <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-xl border border-border text-sm">
            {dash.data.length === 0 && <li className="p-3 text-center text-fg-subtle">Chưa có VĐV đăng ký</li>}
            {dash.data.map((x) => (
              <li key={x.bib} className="flex items-center gap-2 px-3 py-2">
                <span className="w-24 shrink-0 font-mono text-xs">{x.bib}</span>
                <span className="min-w-0 flex-1 truncate">{x.display_name}</span>
                <span className="text-xs text-fg-muted">{String(x.distance_km).replace('.', ',')} km</span>
                <span className={cn('w-16 text-right font-mono text-xs', x.status === 'FINISHED' ? 'text-brand' : 'text-fg-subtle')}>
                  {x.status === 'FINISHED' ? raceTime(x.finish_time_s) : x.status === 'WITHDRAWN' ? 'Đã rút' : '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Button block onClick={() => setDesign(true)}><Palette className="size-4" aria-hidden />Thiết kế BIB</Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={exportCsv} disabled={!dash.data?.length}><Download className="size-4" aria-hidden />Xuất CSV</Button>
          {r.status === 'PUBLISHED' && <Button variant="danger" onClick={() => setCancelOpen(true)}><XCircle className="size-4" aria-hidden />Hủy giải</Button>}
        </div>
      </Card>
      <ConfirmSheet open={cancelOpen} onClose={() => setCancelOpen(false)} onConfirm={() => cancel.mutate()} loading={cancel.isPending}
        title="Hủy giải?" description="Mọi VĐV đã đăng ký sẽ nhận thông báo. Không thể hoàn tác." confirmLabel="Hủy giải">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Lý do (không bắt buộc)" aria-label="Lý do hủy" />
      </ConfirmSheet>
      {design && <BibDesigner r={r} onClose={() => setDesign(false)} />}
    </section>
  )
}

function CertificateSheet({ r, onClose }: { r: Race; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const me = r.me!
  const finishers = r.per_distance?.find((p) => Number(p.distance_km) === Number(me.distance_km))?.finished ?? r.finished
  useEffect(() => {
    if (!ref.current) return
    drawCertificate(ref.current, {
      race: r.title, organizer: r.club?.name ?? r.organizer?.display_name ?? 'RaceHub', name: me.display_name ?? 'Runner', bib: me.bib,
      distanceKm: Number(me.distance_km), timeS: me.finish_time_s ?? 0, rank: me.rank, finishers,
      date: me.finished_at ? new Date(me.finished_at).toLocaleDateString('vi-VN', { day: '2-digit', month: 'long', year: 'numeric' }) : '',
      site: typeof window === 'undefined' ? 'racehub' : window.location.host,
    })
  }, [r, me, finishers])
  const download = () => {
    const a = document.createElement('a')
    a.href = ref.current!.toDataURL('image/png')
    a.download = `chung-nhan-${me.bib.toLowerCase()}.png`
    a.click()
  }
  return (
    <Sheet open onClose={onClose} title="Giấy chứng nhận hoàn thành" footer={<Button block onClick={download}><Download className="size-4" aria-hidden />Tải ảnh</Button>}>
      <canvas ref={ref} width={CERT_SIZE.w} height={CERT_SIZE.h} className="mx-auto w-full max-w-xs rounded-xl" aria-label="Giấy chứng nhận" />
    </Sheet>
  )
}

function bibData(r: Race, bib: string, name: string | null, km: number) {
  return {
    race: r.title, bib, name, org: r.club?.name ?? r.organizer?.display_name ?? null, distanceKm: km, dates: `${fmtDate(r.start_at)} – ${fmtDate(r.end_at)}`,
    qrUrl: typeof window === 'undefined' ? null : `${window.location.origin}/races/${r.id}?bib=${encodeURIComponent(bib)}`,
  }
}

/** e-BIB của tôi: tải PNG (in ra giấy A5 ngang) hoặc mở toàn màn hình để khoe / check-in */
function EBibCard({ r }: { r: Race }) {
  const me = r.me!
  const ref = useRef<HTMLCanvasElement | null>(null)
  const [full, setFull] = useState(false)
  const data = bibData(r, me.bib, me.display_name, Number(me.distance_km))
  return (
    <div className="space-y-2">
      <button type="button" onClick={() => setFull(true)} className="block w-full" aria-label="Xem BIB toàn màn hình">
        <EBib ref={ref} design={r.bib_design} data={data} />
      </button>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => downloadCanvas(ref.current, `bib-${me.bib.toLowerCase()}.png`)}><Download className="size-4" aria-hidden />Tải BIB</Button>
        <Button variant="secondary" onClick={() => setFull(true)}><Maximize2 className="size-4" aria-hidden />Toàn màn hình</Button>
      </div>
      {full && (
        <div role="dialog" aria-label="BIB toàn màn hình" onClick={() => setFull(false)}
          className="fixed inset-0 z-50 grid place-items-center bg-black/90 p-3">
          <div className="w-full max-w-[min(100vw,140vh)] rotate-0 landscape:max-w-[90vw]">
            <EBib design={r.bib_design} data={data} />
            <p className="mt-3 text-center text-xs text-white/60">Chạm để đóng · Xoay ngang điện thoại để BIB to hơn</p>
          </div>
        </div>
      )}
    </div>
  )
}

/** Quét QR trên BIB → trang giải kèm ?bib=… → xác thực VĐV */
function BibCheck({ r }: { r: Race }) {
  const bib = useSearchParams().get('bib')
  const q = useQuery({ queryKey: ['race', r.id, 'bib', bib], queryFn: () => lookupBib(r.id, bib!), enabled: !!bib })
  if (!bib) return null
  if (q.isPending) return <Skeleton className="h-20" />
  const v = q.data
  return (
    <Card className={cn('flex items-center gap-3', v ? 'border-brand/50 bg-brand/10' : 'border-danger/40 bg-danger/10')}>
      {v ? <Avatar src={v.avatar_url} name={v.display_name ?? 'VĐV'} size="md" /> : <XCircle className="size-8 text-danger" aria-hidden />}
      <div className="min-w-0 flex-1">
        {v ? (
          <>
            <p className="flex items-center gap-1.5 font-semibold"><BadgeCheck className="size-4 text-brand" aria-hidden />BIB {v.bib} hợp lệ</p>
            <p className="truncate text-sm">{v.display_name} · {distanceLabel(v.distance_km)}</p>
            <p className="text-xs text-fg-muted">{v.status === 'FINISHED' ? `Đã hoàn thành · ${raceTime(v.finish_time_s)}` : 'Đã đăng ký, chưa hoàn thành'}</p>
          </>
        ) : <p className="font-semibold text-danger">Không tìm thấy BIB {bib} trong giải này</p>}
      </div>
    </Card>
  )
}
