'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Circle, Expand, Gift, Lock, ShieldCheck, Square, Trophy, UserX, Video, VideoOff, Volume2, VolumeX, X } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, ConfirmSheet, ScrollRow } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { drawAbsent, drawErrorMessage, drawNext, finishDraw, listDraws, startDraw, type DrawScope, type DrawWinner, type LuckyDraw } from '../api/drawApi'
import { latestWinner, nextPrize, prizeProgress, reelNames, spinDelays } from '../model/stage'
import { formatElapsed, videoExt } from '../model/recording'
import { paintStage, type StageSnapshot } from './stagePaint'
import { ReviewActions } from './ReviewActions'
import { useStageRecorder } from './useStageRecorder'
import { Confetti } from './Confetti'
import { useStageSound } from './useStageSound'

type Phase = 'idle' | 'spinning' | 'landed'

/**
 * Màn hình quay thưởng toàn màn hình (009300) — chiếu lên máy chiếu / TV ở buổi tất niên, lễ trao giải.
 * BTC: chọn giải → bấm QUAY (hoặc phím cách) → tên chạy chậm dần rồi dừng ở người trúng → pháo giấy.
 * Người trúng vắng mặt → "Vắng mặt · quay lại" (ghi công khai). Xong → "Kết thúc" → kết quả CHỜ XÁC NHẬN (013500):
 * BTC bấm "Chấp nhận" (công bố) hoặc "Huỷ kết quả" (ghi nhật ký, quay lại) ở chân màn hình — ngoài vùng quay.
 * Ghi hình (lần 7): chỉ vùng quay được vẽ lại lên canvas và ghi thành video (useStageRecorder + stagePaint).
 * Thành viên mở cùng màn này để xem trực tiếp: người trúng mới hiện ra cũng có hiệu ứng quay.
 */
export function DrawStage({ draw, scope, refId, onClose }: { draw: LuckyDraw; scope: DrawScope; refId: string | null; onClose: () => void }) {
  const qc = useQueryClient()
  const key = ['draws', scope, refId]
  const manage = draw.can_manage
  // Người xem: đọc lại mỗi 2,5 giây để thấy người trúng mới
  const live = useQuery({ queryKey: key, queryFn: () => listDraws(scope, refId), refetchInterval: manage ? false : 2500 })
  const [local, setLocal] = useState<LuckyDraw>(draw)
  const d = (manage ? local : live.data?.find((x) => x.id === draw.id)) ?? local
  const progress = prizeProgress(d)
  const [prize, setPrize] = useState<number | null>(() => nextPrize(prizeProgress(draw)))
  const cur = nextPrize(progress, prize)
  const [phase, setPhase] = useState<Phase>(() => (draw.status === 'LIVE' && latestWinner(draw.winners) ? 'landed' : 'idle'))
  const [reel, setReel] = useState<{ name: string; n: number } | null>(null)
  // Mở lại giữa chừng: hiện người trúng gần nhất
  const [shown, setShown] = useState<DrawWinner | null>(() => (draw.status === 'LIVE' ? latestWinner(draw.winners) : null))
  const [fire, setFire] = useState(0)
  // Người vừa được máy chủ chọn nhưng vòng quay chưa dừng: chưa được lộ tên ở bảng người trúng
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'finish' | 'start' | null>(null)
  const [soundOn, setSoundOn] = useState(true)
  const sound = useStageSound(soundOn)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seen = useRef<string | null>(latestWinner(draw.winners)?.key ?? null)
  const [seenKey, setSeenKey] = useState<string | null>(latestWinner(draw.winners)?.key ?? null) // bản sao của `seen` để dùng khi vẽ
  const landedAt = useRef(0)

  const put = (x: LuckyDraw) => { setLocal(x); qc.setQueryData<LuckyDraw[]>(key, (l) => l?.map((y) => (y.id === x.id ? x : y))) }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  // Khoá cuộn trang phía sau
  useEffect(() => { const o = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = o } }, [])

  /** Chạy vòng quay rồi dừng ở `w` */
  const roll = useCallback((w: DrawWinner, pool: string[]) => {
    const delays = spinDelays()
    const names = reelNames(pool, w.name, delays.length)
    setPhase('spinning'); setShown(null); setPendingKey(w.key)
    let i = 0
    const step = () => {
      setReel({ name: names[i], n: i })
      sound.tick(i / names.length)
      if (i === names.length - 1) {
        setPhase('landed'); setShown(w); setPendingKey(null); setFire((f) => f + 1); sound.win(); landedAt.current = Date.now()
        return
      }
      timer.current = setTimeout(() => { i++; step() }, delays[i])
    }
    step()
  }, [sound])

  const poolNames = (x: LuckyDraw) => (x.reel ?? []).map((r) => r.name)

  // Người xem: có người trúng mới → quay tới người đó
  useEffect(() => {
    if (manage) return
    const w = latestWinner(d.winners)
    if (!w || w.key === seen.current) return
    seen.current = w.key
    roll(w, poolNames(d))
  }, [d, manage, roll])

  const spin = async () => {
    if (busy || phase === 'spinning' || cur == null || d.status !== 'LIVE') return
    setBusy(true)
    // Tên chạy nhanh ngay lúc bấm, trong khi chờ máy chủ chọn người
    setPhase('spinning'); setShown(null)
    const names = poolNames(d)
    let k = 0
    const pre = setInterval(() => { setReel({ name: names[k++ % Math.max(names.length, 1)] ?? '…', n: k }); sound.tick(0) }, 55)
    try {
      const x = await drawNext(d.id, cur)
      clearInterval(pre)
      const w = latestWinner(x.winners)
      if (w) setPendingKey(w.key)
      put(x)
      if (w) { seen.current = w.key; setSeenKey(w.key); roll(w, poolNames(x)) }
    } catch (e) {
      clearInterval(pre); setPhase('idle'); setReel(null); setPendingKey(null)
      toast.error(drawErrorMessage(e))
    } finally { setBusy(false) }
  }

  const absent = async () => {
    if (!shown || busy) return
    setBusy(true)
    try { put(await drawAbsent(d.id, shown.key)); toast(`${shown.name}: vắng mặt — quay lại ${shown.prize}`); setShown(null); setPhase('idle'); setReel(null); setPrize(shown.prize_idx) }
    catch (e) { toast.error(drawErrorMessage(e)) } finally { setBusy(false) }
  }

  const start = async () => {
    setBusy(true)
    try { put(await startDraw(d.id)); setConfirm(null) } catch (e) { toast.error(drawErrorMessage(e)) } finally { setBusy(false) }
  }
  const finish = async () => {
    setBusy(true)
    try { put(await finishDraw(d.id)); setConfirm(null); toast('Đã kết thúc quay. Kiểm tra kết quả rồi bấm Chấp nhận để công bố, hoặc Huỷ kết quả để quay lại.', { duration: 8000 }) }
    catch (e) { toast.error(drawErrorMessage(e)) } finally { setBusy(false) }
  }
  /** Sau Chấp nhận / Huỷ kết quả: huỷ kết quả thì lượt quay về "Chờ quay" → dọn màn hình để quay lại từ đầu */
  const reviewed = (x: LuckyDraw) => {
    put(x)
    if (x.status === 'READY') {
      if (timer.current) clearTimeout(timer.current)
      setPhase('idle'); setShown(null); setReel(null); setPendingKey(null); seen.current = null; setSeenKey(null); setPrize(nextPrize(prizeProgress(x)))
    }
    void qc.invalidateQueries({ queryKey: key })
  }

  // Phím cách / Enter = QUAY (điều khiển bằng bàn phím hoặc bút trình chiếu)
  const spinRef = useRef(spin)
  useEffect(() => { spinRef.current = spin })
  useEffect(() => {
    if (!manage) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === ' ' || e.key === 'Enter') && !(e.target as HTMLElement)?.closest('input,textarea,button,[role=dialog]')) { e.preventDefault(); void spinRef.current() }
      if (e.key === 'Escape' && !document.fullscreenElement) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [manage, onClose])

  const full = () => {
    const el = document.documentElement
    if (document.fullscreenElement) void document.exitFullscreen?.()
    else void el.requestFullscreen?.().catch(() => toast('Trình duyệt này không hỗ trợ toàn màn hình'))
  }

  // Người xem: người trúng mới đã về tới máy nhưng hiệu ứng quay chưa bắt đầu → cũng phải giấu
  const newest = latestWinner(d.winners)
  const hideKey = pendingKey ?? (!manage && newest && newest.key !== seenKey ? newest.key : null)
  const winners = hideKey ? d.winners.filter((w) => w.key !== hideKey) : d.winners
  const won = winners.filter((w) => w.status === 'WON').length
  const totalSlots = progress.reduce((a, p) => a + p.qty, 0)
  const curName = cur != null ? progress[cur].name : null
  const done = d.status === 'DONE'
  const pending = d.status === 'PENDING'

  // Ghi hình: ảnh chụp trạng thái mới nhất cho bộ vẽ canvas (chạy 30 lần/giây ngoài vòng vẽ của React)
  const snap = useRef<StageSnapshot | null>(null)
  useEffect(() => { snap.current = { d, progress, phase, shown, reel, curName, landedAt: landedAt.current } })
  const recorder = useStageRecorder(d.title, (ctx, w, h) => { if (snap.current) paintStage(ctx, w, h, snap.current) }, sound.recordStream)
  // Trình duyệt không ghi được: thay nút ghi bằng biểu tượng gạch chéo, bấm xem lý do
  const recordHint = recorder.support.ok ? null : recorder.support.reason

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`Quay thưởng: ${d.title}`}
      className="fixed inset-0 z-[55] flex flex-col overflow-hidden bg-[#07090d] text-white animate-fade-in"
      style={{ backgroundImage: 'radial-gradient(90% 60% at 50% 0%, color-mix(in srgb, var(--color-coin) 22%, transparent), transparent 70%), radial-gradient(70% 50% at 50% 100%, color-mix(in srgb, var(--color-brand) 14%, transparent), transparent 70%)' }}>
      <Confetti fire={fire} />

      <header className="flex items-center gap-2 px-4 pb-2 pt-[max(env(safe-area-inset-top),0.75rem)]">
        <Gift className="size-5 shrink-0 text-coin" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold sm:text-lg">{d.title}</p>
          <p className="hidden text-xs text-white/60 sm:block">
            {d.status === 'LIVE' && <span className="mr-1.5 inline-flex items-center gap-1 font-bold text-danger"><span className="size-2 animate-pulse rounded-full bg-danger" />TRỰC TIẾP</span>}
            {d.entrant_count ?? d.eligible_now ?? 0} người trong danh sách · {won}/{totalSlots} suất đã trao
          </p>
        </div>
        {d.sponsor?.name && (
          <span className="hidden items-center gap-2 rounded-xl bg-white/10 px-2.5 py-1 text-xs sm:flex">
            <span className="text-white/60">Tài trợ</span>
            {/* eslint-disable-next-line @next/next/no-img-element -- logo nhà tài trợ do BTC tải lên */}
            {d.sponsor.logo_url ? <img src={d.sponsor.logo_url} alt={d.sponsor.name} className="h-7 max-w-28 object-contain" /> : <b>{d.sponsor.name}</b>}
          </span>
        )}
        {recorder.recording && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-danger/20 px-2 py-1 font-mono text-xs font-bold text-danger" role="status">
            <Circle className="size-2.5 animate-pulse fill-current" aria-hidden />REC {formatElapsed(recorder.elapsed)}
          </span>
        )}
        {recorder.support.ok ? (
          <button type="button" onClick={recorder.recording ? recorder.stop : recorder.start}
            aria-label={recorder.recording ? 'Dừng ghi hình và lưu video' : 'Ghi hình vùng quay thưởng'} title={recorder.recording ? 'Dừng & lưu video' : `Ghi hình vùng quay (video .${recorder.support.ok ? videoExt(recorder.support.type) : 'mp4'})`}
            className={cn('grid size-9 shrink-0 place-items-center rounded-full sm:size-10 hover:bg-white/10', recorder.recording && 'text-danger')}>
            {recorder.recording ? <Square className="size-4 fill-current" aria-hidden /> : <Video className="size-5" aria-hidden />}
          </button>
        ) : recordHint ? (
          <button type="button" onClick={() => toast(recordHint, { duration: 8000 })} aria-label="Không ghi hình được trên trình duyệt này"
            className="grid size-9 shrink-0 place-items-center rounded-full sm:size-10 text-white/40 hover:bg-white/10">
            <VideoOff className="size-5" aria-hidden />
          </button>
        ) : null}
        <button type="button" onClick={() => setSoundOn(!soundOn)} aria-label={soundOn ? 'Tắt âm thanh' : 'Bật âm thanh'} className="grid size-9 shrink-0 place-items-center rounded-full sm:size-10 hover:bg-white/10">
          {soundOn ? <Volume2 className="size-5" aria-hidden /> : <VolumeX className="size-5" aria-hidden />}
        </button>
        <button type="button" onClick={full} aria-label="Toàn màn hình" className="hidden size-10 shrink-0 place-items-center rounded-full hover:bg-white/10 sm:grid"><Expand className="size-5" aria-hidden /></button>
        <button type="button" onClick={onClose} aria-label="Đóng" className="grid size-9 shrink-0 place-items-center rounded-full sm:size-10 hover:bg-white/10"><X className="size-5" aria-hidden /></button>
      </header>

      {/* Điện thoại: dòng trạng thái xuống hàng riêng để tiêu đề và nút không bị bóp */}
      <p className="px-4 pb-1 text-xs text-white/60 sm:hidden">
        {d.status === 'LIVE' && <span className="mr-1.5 inline-flex items-center gap-1 font-bold text-danger"><span className="size-2 animate-pulse rounded-full bg-danger" />TRỰC TIẾP</span>}
        {d.entrant_count ?? d.eligible_now ?? 0} người · {won}/{totalSlots} suất đã trao
      </p>

      {/* Chọn giải */}
      {d.status !== 'READY' && (
        <nav aria-label="Chọn giải"><ScrollRow innerClassName="gap-2 px-4 pb-2">
          {progress.map((p) => (
            <button key={p.idx} type="button" disabled={!manage || p.left === 0 || phase === 'spinning'} onClick={() => setPrize(p.idx)} aria-pressed={cur === p.idx}
              className={cn('shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold transition',
                cur === p.idx ? 'border-coin bg-coin text-black' : p.left ? 'border-white/20 text-white/80' : 'border-white/10 text-white/35 line-through')}>
              {p.name} <span className="font-mono text-xs opacity-80">{p.won}/{p.qty}</span>
            </button>
          ))}
        </ScrollRow></nav>
      )}

      <main className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center sm:gap-5">
        {d.status === 'READY' ? (
          <div className="max-w-md space-y-4">
            <Trophy className="mx-auto size-14 text-coin" aria-hidden />
            <p className="text-2xl font-extrabold sm:text-4xl">{d.title}</p>
            <ul className="space-y-1 text-white/80">{d.prizes.map((p, i) => <li key={i}><b className="text-coin">{p.name}</b> × {p.qty}</li>)}</ul>
            <p className="text-sm text-white/60">{d.eligible_now ?? 0} người đủ điều kiện. Bấm <b>Bắt đầu</b>: danh sách được chốt và công bố mã cam kết — từ lúc đó không ai thêm, bớt người hay đổi thứ tự được.</p>
            {manage && <Button variant="coin" size="lg" block loading={busy} disabled={!d.eligible_now} onClick={() => setConfirm('start')}>Bắt đầu quay</Button>}
          </div>
        ) : (
          <>
            <p className="text-sm font-bold uppercase tracking-[0.35em] text-coin sm:text-lg">
              {(done || pending) && phase === 'idle' ? 'Kết quả' : shown ? shown.prize : curName ?? 'Đã trao hết giải'}
            </p>
            {/* Ô quay */}
            <div className={cn('relative grid min-h-[38dvh] w-full max-w-5xl flex-1 place-items-center overflow-hidden rounded-[2rem] border-2 px-4 py-6 sm:py-10',
              phase === 'landed' ? 'border-coin bg-coin/10 shadow-[0_0_80px_-10px_var(--color-coin)]' : 'border-white/15 bg-white/[0.04]')}>
              {phase === 'landed' && shown ? (
                <div key={shown.key} className="flex w-full min-w-0 flex-col items-center gap-4 animate-winner">
                  <Avatar src={shown.avatar_url} name={shown.name} size="xl" className="!size-32 shrink-0 ring-4 ring-coin sm:!size-44" />
                  <p className="w-full break-words text-5xl font-extrabold leading-tight sm:text-8xl">{shown.name}</p>
                  <p className="text-sm font-semibold text-coin sm:text-xl">Chúc mừng! 🎉</p>
                </div>
              ) : reel ? (
                <p key={reel.n} className="w-full break-words text-5xl font-extrabold text-white/90 animate-reel sm:text-8xl">{reel.name}</p>
              ) : (
                <p className="text-2xl font-bold text-white/40 sm:text-5xl">{done ? 'Đã công bố' : pending ? 'Chờ ban tổ chức xác nhận' : manage ? 'Sẵn sàng' : 'Chờ BTC quay…'}</p>
              )}
            </div>

            {manage && d.status === 'LIVE' && (
              <div className="flex flex-col items-center gap-3">
                <button type="button" onClick={() => void spin()} disabled={busy || phase === 'spinning' || cur == null}
                  className="grid size-28 place-items-center rounded-full bg-coin text-2xl font-black tracking-wider text-black shadow-[0_0_60px_-5px_var(--color-coin)] transition active:scale-95 disabled:opacity-40 sm:size-36 sm:text-3xl">
                  QUAY
                </button>
                <p className="hidden text-xs text-white/50 sm:block">Phím cách để quay · bút trình chiếu cũng dùng được</p>
                {phase === 'landed' && shown && (
                  <Button variant="ghost" className="text-white/80" disabled={busy} onClick={() => void absent()}>
                    <UserX className="size-4" aria-hidden />Vắng mặt · quay lại suất này
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* Bảng người trúng */}
      {winners.length > 0 && (
        <section aria-label="Người trúng" className="max-h-[22vh] overflow-y-auto sm:max-h-[30vh] border-t border-white/10 bg-black/30 px-4 py-3">
          <div className="mx-auto grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {progress.filter((p) => winners.some((w) => w.prize_idx === p.idx)).map((p) => (
              <div key={p.idx}>
                <p className="mb-1 text-xs font-bold uppercase tracking-wider text-coin">{p.name}</p>
                <ul className="space-y-1">
                  {winners.filter((w) => w.prize_idx === p.idx).map((w) => (
                    <li key={w.key} className={cn('flex items-center gap-2 text-sm', w.status === 'ABSENT' && 'text-white/40')}>
                      <Avatar src={w.avatar_url} name={w.name} size="xs" />
                      <span className={cn('min-w-0 flex-1 truncate', w.status === 'ABSENT' && 'line-through')}>{w.name}</span>
                      {w.status === 'ABSENT' && <span className="shrink-0 text-[11px]">vắng mặt</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      <footer className="flex flex-wrap items-center gap-3 border-t border-white/10 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3">
        <p className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-white/50">
          {d.seed_hash ? <><Lock className="size-3.5 shrink-0" aria-hidden /><span className="truncate">Mã cam kết: <span className="font-mono">{d.seed_hash}</span></span></>
            : <><ShieldCheck className="size-3.5 shrink-0" aria-hidden />Thứ tự trúng do máy chủ chốt khi bắt đầu, BTC không chọn được ai trúng</>}
        </p>
        {manage && d.status === 'LIVE' && (
          <Button variant="secondary" disabled={busy || phase === 'spinning' || !won} onClick={() => setConfirm('finish')}>Kết thúc</Button>
        )}
        {pending && !manage && <p className="w-full text-center text-xs font-semibold text-coin">Ban tổ chức đang xác nhận kết quả — chưa phải kết quả chính thức.</p>}
        {/* Ngoài vùng quay: không lọt vào video ghi hình */}
        {pending && manage && (
          <div className="w-full space-y-1.5">
            <p className="text-center text-xs text-white/70">Kết quả chờ xác nhận: chưa báo người trúng, chưa đăng bảng tin.</p>
            <ReviewActions d={d} onDone={reviewed} dark className="mx-auto max-w-md" />
          </div>
        )}
      </footer>

      <ConfirmSheet open={confirm === 'start'} onClose={() => setConfirm(null)} danger={false} loading={busy} confirmLabel="Bắt đầu"
        title="Bắt đầu quay?" description="Danh sách người được quay sẽ được chốt. Sau khi đã quay ra người trúng thì không huỷ lượt này được nữa." onConfirm={() => void start()} />
      <ConfirmSheet open={confirm === 'finish'} onClose={() => setConfirm(null)} danger={false} loading={busy} confirmLabel="Kết thúc"
        title="Kết thúc quay?"
        description={`${won}/${totalSlots} suất đã trao${won < totalSlots ? ' — các suất còn lại sẽ không trao' : ''}. Kết quả chuyển sang chờ xác nhận: bấm Chấp nhận thì mới báo người trúng và đăng bảng tin; Huỷ kết quả thì quay lại.`}
        onConfirm={() => void finish()} />
    </div>,
    document.body,
  )
}
