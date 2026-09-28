'use client'

import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { nativePlatform } from '@/shared/lib/native'
import { useSession } from '@/features/auth'
import { useOpsPolicy } from '@/features/system'
import { keepAwake, reacquireAwake, releaseAwake } from '@/shared/lib/keepAwake'
import { canTrackLocation, tracksInBackground, watchLocation, type LocationError, type LocationFix } from '../model/location'
import { clearSnapshot, loadSnapshot, saveSnapshot, type RunSnapshot } from '../model/recovery'
import { RunSession, type GpsQuality, type SessionEvent } from '../model/session'
import { ENGINE, type GpsGap, type Split } from '../model/tracker'
import { coachLine, persistsNow } from '../model/coach'
import { deviceLabel, errorPct, QA_KEY, type QaInput } from '../model/qa'
import { submitRun, type SaveResult } from '../api/submitRun'
import { useStoredFlag } from './useStoredFlag'
import { setRunActive } from './useRunActive'

export type { SaveResult }
export type RunPhase = 'IDLE' | 'LOCATING' | 'RUNNING' | 'PAUSED' | 'FINISHED' | 'SAVING' | 'SAVED' | 'QUEUED'
export type GpsState = 'OFF' | 'SEARCHING' | 'GOOD' | 'WEAK' | 'LOST' | 'DENIED' | 'UNSUPPORTED'

const AUTO_PAUSE_KEY = 'rh-run-auto-pause'
/** Lưu tạm 5 giây một lần khi đang chạy (chỉ ghi khối điểm cuối — xem recovery.ts); đổi trạng thái / qua km / ẩn app thì lưu ngay */
const PERSIST_EVERY_MS = 5_000
/** Tạm dừng quá lâu: tắt GPS cho đỡ pin; bấm Tiếp tục thì bật lại (đoạn GPS mới vốn không nối qua quãng tạm dừng) */
const GPS_OFF_AFTER_PAUSE_MS = 5 * 60_000

/** Những gì màn hình cần vẽ — chép từ RunSession sau mỗi lệnh / điểm GPS / nhịp đồng hồ */
interface View {
  distanceM: number; elapsedS: number; movingS: number; currentPace: number; avgPace: number
  autoPaused: boolean; moved: boolean; longStop: boolean; autoStopped: boolean; trimmedS: number
  splits: Split[]; gaps: GpsGap[]; gapS: number
}
const EMPTY: View = { distanceM: 0, elapsedS: 0, movingS: 0, currentPace: 0, avgPace: 0, autoPaused: false, moved: false, longStop: false, autoStopped: false, trimmedS: 0, splits: [], gaps: [], gapS: 0 }
const viewOf = (s: RunSession): View => ({
  distanceM: s.distanceM, elapsedS: s.elapsedS, movingS: s.phase === 'FINISHED' ? s.movingS : s.shownS, currentPace: s.currentPace, avgPace: s.avgPace,
  autoPaused: s.autoPaused, moved: s.moved, longStop: s.longStop, autoStopped: s.autoStopped, trimmedS: s.q.trimmedS,
  splits: s.splits, gaps: [...s.gaps], gapS: s.gapS,
})

function speak(text: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'vi-VN'
  window.speechSynthesis.speak(u)
}
const vibrate = (pattern: number[]) => { try { navigator.vibrate?.(pattern) } catch { /* máy không hỗ trợ */ } }

/**
 * Màn Chạy ↔ Tracking Engine: giữ một RunSession, nối nguồn vị trí + đồng hồ + lưu tạm + gửi máy chủ,
 * đọc giọng nói theo sự kiện. Mọi phép tính / trạng thái nằm trong RunSession (model/session.ts).
 */
export function useRunTracker() {
  const uid = useSession().session?.user.id
  const [phase, setPhaseState] = useState<RunPhase>('IDLE')
  const [gps, setGps] = useState<GpsState>('OFF')
  const [view, setView] = useState<View>(EMPTY)
  const [voiceOn, setVoiceOn] = useState(true)
  /**
   * Tự tạm dừng (như Strava / Garmin, mặc định bật): đồng hồ chính là "thời gian chạy", đứng lại khi bạn dừng.
   * Tắt: đồng hồ chính là tổng thời gian, luôn nhảy. Pace luôn tính theo thời gian di chuyển.
   */
  const [autoPauseOn, setAutoPauseOn] = useStoredFlag(AUTO_PAUSE_KEY, true)
  /** Chế độ kiểm thử GPS (bật bằng ?qa=1 hoặc nút của admin): nhập kịch bản + quãng chuẩn, xem chỉ số chất lượng */
  const [qaOn, setQaOn] = useStoredFlag(QA_KEY, false, useSearchParams().get('qa') === '1' ? true : undefined)
  const [qa, setQa] = useState<QaInput>({ scenario: null, ref_m: null, note: '' })
  const [result, setResult] = useState<SaveResult | null>(null)
  /** Chỉ số chất lượng GPS chốt lúc kết thúc — hiện ở màn tổng kết (chế độ kiểm thử) */
  const [summary, setSummary] = useState<GpsQuality | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Bài dở dang của chính tài khoản này, lưu trên máy từ lần trước (app bị đóng giữa chừng) — hỏi có khôi phục không */
  const [recovery, setRecovery] = useState<RunSnapshot | null>(null)
  const [recoveryFor, setRecoveryFor] = useState<string | undefined>()
  if (uid && uid !== recoveryFor) { setRecoveryFor(uid); setRecovery(loadSnapshot(undefined, undefined, uid)) }

  // Quy tắc tự tạm dừng / đứng nghỉ lâu do admin đặt (Chính sách vận hành) — áp cho bài bắt đầu từ lúc này
  const tracking = useOpsPolicy().tracking
  const latest = useRef({ tracking, uid, voiceOn, autoPauseOn })
  useEffect(() => { latest.current = { tracking, uid, voiceOn, autoPauseOn } }, [tracking, uid, voiceOn, autoPauseOn])

  const session = useRef(new RunSession())
  const phaseRef = useRef<RunPhase>('IDLE')
  const stopLocation = useRef<(() => void) | null>(null)
  const lastPersist = useRef(0)
  /** số điểm đã lưu chắc chắn trên máy (lưu theo khối: lần sau chỉ ghi từ khối chứa điểm này) */
  const saved = useRef(0)

  const setPhase = useCallback((p: RunPhase) => { phaseRef.current = p; setPhaseState(p) }, [])
  const say = useCallback((text: string) => { if (latest.current.voiceOn) speak(text) }, [])

  /** Lưu tạm bài đang chạy trên máy (tối đa 5 giây một lần, trừ khi `force`) */
  const persist = useCallback((force = false) => {
    const now = Date.now()
    if (!force && now - lastPersist.current < PERSIST_EVERY_MS) return
    const st = session.current.snapshot()
    if (!st) return
    lastPersist.current = now
    saved.current = saveSnapshot(st, session.current.points, saved.current, now, undefined, latest.current.uid)
  }, [])

  /** Chép trạng thái RunSession ra màn hình */
  const sync = useCallback(() => {
    const s = session.current
    setView(viewOf(s))
    const p = phaseRef.current
    if (s.phase !== p && (p === 'LOCATING' || p === 'RUNNING' || p === 'PAUSED')) setPhase(s.phase)
    if (s.gpsLost && s.phase === 'RUNNING') setGps('LOST')
  }, [setPhase])

  /** Sự kiện từ RunSession → giọng HLV + rung + lưu ngay những mốc quan trọng, rồi vẽ lại */
  const handle = useCallback((events: SessionEvent[]) => {
    for (const e of events) {
      const line = coachLine(e, latest.current.autoPauseOn)
      if (line) say(line)
      if (e.type === 'LONG_STOP') vibrate([300, 150, 300])
    }
    persist(events.some(persistsNow))
    sync()
  }, [say, persist, sync])

  // ---------- Nguồn vị trí ----------
  const onPosition = useCallback((fix: LocationFix) => {
    setGps(fix.accuracy <= ENGINE.GOOD_ACCURACY_M ? 'GOOD' : 'WEAK')
    handle(session.current.fix(fix, Date.now()))
  }, [handle])

  const stopWatch = useCallback(() => { stopLocation.current?.(); stopLocation.current = null }, [])

  const onPositionError = useCallback((err: LocationError) => {
    setGps(err.denied ? 'DENIED' : 'WEAK')
    if (err.denied) {
      stopWatch()
      setPhase('IDLE')
      setError('Bạn cần cho phép truy cập vị trí để ghi bài chạy.')
    }
  }, [stopWatch, setPhase])

  /** Bật (hoặc bật lại) theo dõi vị trí */
  const startWatch = useCallback(() => {
    stopLocation.current?.()
    stopLocation.current = watchLocation(onPosition, onPositionError)
  }, [onPosition, onPositionError])

  // App cài: GPS chạy nền, để màn hình tắt cho đỡ pin. Trình duyệt: giữ màn hình sáng (Wake Lock + video câm cho iPhone)
  const acquireWakeLock = useCallback(() => { if (!tracksInBackground()) void keepAwake() }, [])

  /** Dừng hẳn: GPS + giữ màn hình */
  const stopAll = useCallback(() => { stopWatch(); releaseAwake() }, [stopWatch])

  // ---------- Đồng hồ: RunSession tính theo mốc thời gian thật, không đếm tích tắc (chính xác cả khi tab bị treo) ----------
  useEffect(() => {
    if (phase !== 'RUNNING') return
    const id = setInterval(() => handle(session.current.tick(Date.now())), 1000)
    return () => clearInterval(id)
  }, [phase, handle])

  // Tạm dừng lâu (bấm tay hoặc tự dừng sau khi đứng yên): tắt GPS để đỡ pin
  useEffect(() => {
    if (phase !== 'PAUSED') return
    const id = setTimeout(() => { stopWatch(); setGps('OFF') }, GPS_OFF_AFTER_PAUSE_MS)
    return () => clearTimeout(id)
  }, [phase, stopWatch])

  // ---------- Lệnh của người chạy ----------
  const start = useCallback(() => {
    if (!canTrackLocation()) { setGps('UNSUPPORTED'); return }
    setError(null)
    setResult(null)
    session.current = new RunSession(latest.current.tracking)
    saved.current = 0
    lastPersist.current = 0
    clearSnapshot()
    setRecovery(null)
    setView(EMPTY)
    setGps('SEARCHING')
    setPhase('LOCATING')
    acquireWakeLock()          // gọi ngay trong thao tác bấm: iPhone mới cho phát video giữ màn hình
    startWatch()
  }, [acquireWakeLock, startWatch, setPhase])

  /** Bắt đầu dù tín hiệu GPS còn yếu */
  const startAnyway = useCallback(() => handle(session.current.begin(Date.now())), [handle])

  const pause = useCallback(() => {
    session.current.pause(Date.now()); say('Tạm dừng'); persist(true); sync()
  }, [say, persist, sync])

  const resume = useCallback(() => {
    session.current.resume(Date.now()); say('Tiếp tục'); persist(true); sync()
    if (!stopLocation.current) { setGps('SEARCHING'); startWatch() }      // GPS đã tắt vì tạm dừng lâu
  }, [say, persist, sync, startWatch])

  /** "Vẫn đang nghỉ" ở câu hỏi kết thúc khi đứng yên lâu */
  const dismissLongStop = useCallback(() => { session.current.dismissLongStop(); sync() }, [sync])

  const finish = useCallback(() => {
    stopAll()
    session.current.finish(Date.now())
    setSummary(session.current.quality())
    setPhase('FINISHED')
    say('Kết thúc bài chạy')
    persist(true)
    sync()
  }, [stopAll, say, persist, sync, setPhase])

  const discard = useCallback(() => {
    stopAll()
    clearSnapshot()
    setPhase('IDLE')
    setGps('OFF')
  }, [stopAll, setPhase])

  /** Khôi phục bài dở dang: đang chạy → về trạng thái tạm dừng (bấm Tiếp tục để chạy tiếp); đã kết thúc → màn lưu */
  const restore = useCallback(() => {
    const r = recovery
    if (!r) return
    session.current = RunSession.restore(r.state, r.points, Date.now(), latest.current.tracking)
    saved.current = r.points.length
    setRecovery(null)
    setView(viewOf(session.current))
    if (session.current.phase === 'FINISHED') { setSummary(session.current.quality()); setPhase('FINISHED'); return }
    setPhase('PAUSED')
    setGps('SEARCHING')
    acquireWakeLock()
    if (canTrackLocation()) startWatch()
  }, [recovery, acquireWakeLock, startWatch, setPhase])

  const dismissRecovery = useCallback(() => { clearSnapshot(); setRecovery(null) }, [])

  /** Tóm tắt chất lượng GPS gửi kèm bài (thiết bị, cài đặt, phần kiểm thử) */
  const quality = useCallback(() => {
    const s = session.current
    const qaData = qaOn && qa.scenario
      ? { qa: { scenario: qa.scenario, ref_m: qa.ref_m, note: qa.note.trim().slice(0, 300) || null, err_pct: errorPct(s.distanceM, qa.ref_m) } }
      : {}
    return s.quality({
      platform: nativePlatform() ?? 'web',
      device: typeof navigator === 'undefined' ? null : deviceLabel(navigator.userAgent),
      background: tracksInBackground(), auto_pause: autoPauseOn, ...qaData,
    })
  }, [qaOn, qa, autoPauseOn])

  const save = useCallback(async () => {
    setPhase('SAVING')
    setError(null)
    const out = await submitRun(session.current.payload(Date.now()), quality(), latest.current.uid)
    switch (out.kind) {
      case 'SAVED': setResult(out.result); setPhase('SAVED'); return out.result
      case 'QUEUED': setPhase('QUEUED'); return null
      case 'DUPLICATE': setError('Bài chạy này đã được lưu trước đó.'); setPhase('FINISHED'); return null
      case 'FAILED': setError('Không lưu được bài chạy. Thử lại sau ít phút.'); setPhase('FINISHED'); return null
    }
  }, [quality, setPhase])

  // ---------- Vòng đời trang ----------
  // Tắt màn hình / chuyển app: trình duyệt dừng GPS và nhả chế độ giữ sáng màn hình.
  // Quay lại → xin lại cả hai; đoạn bị mất được bộ máy GPS ghi thành "mất tín hiệu" (gaps) — không nối âm thầm.
  // Trong app cài: GPS vẫn chạy nền; chỉ lưu tạm ngay (hệ điều hành có thể đóng app lúc chạy nền) + thống kê.
  useEffect(() => {
    const onVis = () => {
      const p = phaseRef.current
      if (p !== 'RUNNING' && p !== 'PAUSED' && p !== 'LOCATING') return
      const now = Date.now()
      if (document.visibilityState === 'hidden') { session.current.hidden(now); persist(true); return }
      session.current.visible(now)
      if (tracksInBackground()) return
      reacquireAwake()
      if (stopLocation.current) startWatch()
    }
    // Đóng tab / tải lại trang: lưu nốt phần mới nhất
    const onHide = () => { if (phaseRef.current === 'RUNNING' || phaseRef.current === 'PAUSED') persist(true) }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', onHide)
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pagehide', onHide) }
  }, [startWatch, persist])

  // Khung app ẩn thanh điều hướng khi đang có bài chạy
  useEffect(() => { setRunActive(phase === 'LOCATING' || phase === 'RUNNING' || phase === 'PAUSED') }, [phase])

  // Rời màn hình khi đang chạy: dọn GPS + wake lock
  useEffect(() => () => { stopAll(); setRunActive(false) }, [stopAll])

  return {
    background: tracksInBackground(),
    phase, gps, ...view, autoPauseOn, voiceOn, result, error, recovery, qaOn, qa, summary,
    stopRules: { askMin: tracking.longStopAskMin, autoStopMin: tracking.longStopAutoStopMin },
    setVoiceOn, setAutoPauseOn, setQaOn, setQa, start, startAnyway, pause, resume, finish, discard, save, restore, dismissRecovery, dismissLongStop,
  }
}
