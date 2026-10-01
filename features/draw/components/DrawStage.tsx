'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Expand, Gift, Lock, ShieldCheck, Trophy, UserX, Volume2, VolumeX, X } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, ConfirmSheet, ScrollRow } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { drawAbsent, drawErrorMessage, drawNext, finishDraw, listDraws, startDraw, type DrawScope, type DrawWinner, type LuckyDraw } from '../api/drawApi'
import { latestWinner, nextPrize, prizeProgress, reelNames, spinDelays } from '../model/stage'
import { Confetti } from './Confetti'
import { useStageSound } from './useStageSound'

type Phase = 'idle' | 'spinning' | 'landed'

/**
 * Màn hình quay thưởng toàn màn hình (009300) — chiếu lên máy chiếu / TV ở buổi tất niên, lễ trao giải.
 * BTC: chọn giải → bấm QUAY (hoặc phím cách) → tên chạy chậm dần rồi dừng ở người trúng → pháo giấy.
 * Người trúng vắng mặt → "Vắng mặt · quay lại" (ghi công khai). Xong → "Kết thúc & công bố".
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
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'finish' | 'start' | null>(null)
  const [soundOn, setSoundOn] = useState(true)
  const sound = useStageSound(soundOn)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seen = useRef<string | null>(latestWinner(draw.winners)?.key ?? null)

  const put = (x: LuckyDraw) => { setLocal(x); qc.setQueryData<LuckyDraw[]>(key, (l) => l?.map((y) => (y.id === x.id ? x : y))) }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  // Khoá cuộn trang phía sau
  useEffect(() => { const o = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = o } }, [])

  /** Chạy vòng quay rồi dừng ở `w` */
  const roll = useCallback((w: DrawWinner, pool: string[]) => {
    const delays = spinDelays()
    const names = reelNames(pool, w.name, delays.length)
    setPhase('spinning'); setShown(null)
    let i = 0
    const step = () => {
      setReel({ name: names[i], n: i })
      sound.tick(i / names.length)
      if (i === names.length - 1) {
        setPhase('landed'); setShown(w); setFire((f) => f + 1); sound.win()
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
      put(x)
      const w = latestWinner(x.winners)
      if (w) { seen.current = w.key; roll(w, poolNames(x)) }
    } catch (e) {
      clearInterval(pre); setPhase('idle'); setReel(null)
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
    try { put(await finishDraw(d.id)); setConfirm(null); toast.success('Đã công bố kết quả và báo người trúng') }
    catch (e) { toast.error(drawErrorMessage(e)) } finally { setBusy(false) }
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

  const won = d.winners.filter((w) => w.status === 'WON').length
  const totalSlots = progress.reduce((a, p) => a + p.qty, 0)
  const curName = cur != null ? progress[cur].name : null
  const done = d.status === 'DONE'

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`Quay thưởng: ${d.title}`}
      className="fixed inset-0 z-[55] flex flex-col overflow-hidden bg-[#07090d] text-white animate-fade-in"
      style={{ backgroundImage: 'radial-gradient(90% 60% at 50% 0%, color-mix(in srgb, var(--color-coin) 22%, transparent), transparent 70%), radial-gradient(70% 50% at 50% 100%, color-mix(in srgb, var(--color-brand) 14%, transparent), transparent 70%)' }}>
      <Confetti fire={fire} />

      <header className="flex items-center gap-2 px-4 pb-2 pt-[max(env(safe-area-inset-top),0.75rem)]">
        <Gift className="size-5 shrink-0 text-coin" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold sm:text-lg">{d.title}</p>
          <p className="text-xs text-white/60">
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
        <button type="button" onClick={() => setSoundOn(!soundOn)} aria-label={soundOn ? 'Tắt âm thanh' : 'Bật âm thanh'} className="grid size-10 place-items-center rounded-full hover:bg-white/10">
          {soundOn ? <Volume2 className="size-5" aria-hidden /> : <VolumeX className="size-5" aria-hidden />}
        </button>
        <button type="button" onClick={full} aria-label="Toàn màn hình" className="hidden size-10 place-items-center rounded-full hover:bg-white/10 sm:grid"><Expand className="size-5" aria-hidden /></button>
        <button type="button" onClick={onClose} aria-label="Đóng" className="grid size-10 place-items-center rounded-full hover:bg-white/10"><X className="size-5" aria-hidden /></button>
      </header>

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

      <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-4 text-center">
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
              {done && phase === 'idle' ? 'Kết quả' : shown ? shown.prize : curName ?? 'Đã trao hết giải'}
            </p>
            {/* Ô quay */}
            <div className={cn('relative grid w-full max-w-3xl place-items-center overflow-hidden rounded-[2rem] border-2 px-4 py-6 sm:py-10',
              phase === 'landed' ? 'border-coin bg-coin/10 shadow-[0_0_80px_-10px_var(--color-coin)]' : 'border-white/15 bg-white/[0.04]')}>
              {phase === 'landed' && shown ? (
                <div key={shown.key} className="flex flex-col items-center gap-3 animate-winner">
                  <Avatar src={shown.avatar_url} name={shown.name} size="xl" className="ring-4 ring-coin" />
                  <p className="text-4xl font-extrabold leading-tight sm:text-7xl">{shown.name}</p>
                  <p className="text-sm font-semibold text-coin sm:text-xl">Chúc mừng! 🎉</p>
                </div>
              ) : reel ? (
                <p key={reel.n} className="text-4xl font-extrabold text-white/90 animate-reel sm:text-7xl">{reel.name}</p>
              ) : (
                <p className="text-2xl font-bold text-white/40 sm:text-5xl">{done ? 'Đã công bố' : manage ? 'Sẵn sàng' : 'Chờ BTC quay…'}</p>
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
      {d.winners.length > 0 && (
        <section aria-label="Người trúng" className="max-h-[32vh] overflow-y-auto border-t border-white/10 bg-black/30 px-4 py-3">
          <div className="mx-auto grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {progress.filter((p) => d.winners.some((w) => w.prize_idx === p.idx)).map((p) => (
              <div key={p.idx}>
                <p className="mb-1 text-xs font-bold uppercase tracking-wider text-coin">{p.name}</p>
                <ul className="space-y-1">
                  {d.winners.filter((w) => w.prize_idx === p.idx).map((w) => (
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
          <Button variant="secondary" disabled={busy || phase === 'spinning' || !won} onClick={() => setConfirm('finish')}>Kết thúc & công bố</Button>
        )}
      </footer>

      <ConfirmSheet open={confirm === 'start'} onClose={() => setConfirm(null)} danger={false} loading={busy} confirmLabel="Bắt đầu"
        title="Bắt đầu quay?" description="Danh sách người được quay sẽ được chốt. Sau khi đã quay ra người trúng thì không huỷ lượt này được nữa." onConfirm={() => void start()} />
      <ConfirmSheet open={confirm === 'finish'} onClose={() => setConfirm(null)} danger={false} loading={busy} confirmLabel="Công bố"
        title="Kết thúc & công bố kết quả?"
        description={`${won}/${totalSlots} suất đã trao${won < totalSlots ? ' — các suất còn lại sẽ không trao' : ''}. Người trúng được báo ngay, kết quả lên bảng tin kèm mã kiểm chứng.`}
        onConfirm={() => void finish()} />
    </div>,
    document.body,
  )
}
