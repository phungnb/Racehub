'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/shared/lib/supabase'
import { describeError } from '@/shared/lib/errors'
import { nativePlatform } from '@/shared/lib/native'
import { canTrackLocation, tracksInBackground, watchLocation, type LocationError, type LocationFix } from '../model/location'
import { clearSnapshot, enqueue, loadSnapshot, saveSnapshot, type RunPayload, type RunSnapshot } from '../model/recovery'
import { RunSession, type GpsQuality, type SessionEvent } from '../model/session'
import { ENGINE, splitAnnouncement, type GpsGap, type Split } from '../model/tracker'
import { deviceLabel, errorPct, QA_KEY, type QaInput } from '../model/qa'
import { keepAwake, reacquireAwake, releaseAwake } from '@/shared/lib/keepAwake'

export type RunPhase = 'IDLE' | 'LOCATING' | 'RUNNING' | 'PAUSED' | 'FINISHED' | 'SAVING' | 'SAVED' | 'QUEUED'
export type GpsState = 'OFF' | 'SEARCHING' | 'GOOD' | 'WEAK' | 'LOST' | 'DENIED' | 'UNSUPPORTED'

export interface SaveResult {
  activity_id?: string
  validation_status: 'APPROVED' | 'PENDING' | 'REJECTED'
  validation_reason: string
  earned_xu: number
  earned_xp: number
  distance_m: number
}

const AUTO_PAUSE_KEY = 'rh-run-auto-pause'
/** Lưu tạm 5 giây một lần khi đang chạy (chỉ ghi khối điểm cuối — xem recovery.ts); đổi trạng thái / qua km / ẩn app thì lưu ngay */
const PERSIST_EVERY_MS = 5_000

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
const readFlag = (key: string, dflt: boolean) => {
  try { const v = localStorage.getItem(key); return v === null ? dflt : v === '1' } catch { return dflt }
}
const writeFlag = (key: string, on: boolean) => { try { localStorage.setItem(key, on ? '1' : '0') } catch { /* bỏ qua */ } }

/**
 * Màn Chạy ↔ Tracking Engine: giữ một RunSession, nối nguồn vị trí + đồng hồ + lưu tạm + gửi máy chủ,
 * đọc giọng nói theo sự kiện. Mọi phép tính / trạng thái nằm trong RunSession (model/session.ts).
 */
export function useRunTracker() {
  const [phase, setPhaseState] = useState<RunPhase>('IDLE')
  const [gps, setGps] = useState<GpsState>('OFF')
  const [view, setView] = useState<View>(EMPTY)
  const [voiceOn, setVoiceOn] = useState(true)
  /**
   * Tự tạm dừng (như Strava / Garmin, mặc định bật): đồng hồ chính là "thời gian chạy", đứng lại khi bạn dừng.
   * Tắt: đồng hồ chính là tổng thời gian, luôn nhảy. Pace luôn tính theo thời gian di chuyển.
   */
  const [autoPauseOn, setAutoPauseOnState] = useState(() => typeof window === 'undefined' || readFlag(AUTO_PAUSE_KEY, true))
  /** Chế độ kiểm thử GPS (bật bằng ?qa=1 hoặc nút của admin): nhập kịch bản + quãng chuẩn, xem chỉ số chất lượng */
  const [qaOn, setQaOnState] = useState(() => {
    if (typeof window === 'undefined') return false
    if (new URLSearchParams(window.location.search).get('qa') === '1') { writeFlag(QA_KEY, true); return true }
    return readFlag(QA_KEY, false)
  })
  const [qa, setQa] = useState<QaInput>({ scenario: null, ref_m: null, note: '' })
  const [result, setResult] = useState<SaveResult | null>(null)
  /** Chỉ số chất lượng GPS chốt lúc kết thúc — hiện ở màn tổng kết (chế độ kiểm thử) */
  const [summary, setSummary] = useState<GpsQuality | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Bài dở dang lưu trên máy từ lần trước (app bị đóng giữa chừng) — hỏi người chạy có khôi phục không */
  const [recovery, setRecovery] = useState<RunSnapshot | null>(() => (typeof window === 'undefined' ? null : loadSnapshot()))

  const session = useRef(new RunSession())
  const phaseRef = useRef<RunPhase>('IDLE')
  const voiceRef = useRef(true)
  const autoPauseRef = useRef(autoPauseOn)
  const stopLocation = useRef<(() => void) | null>(null)
  const lastPersist = useRef(0)
  /** số điểm đã lưu chắc chắn trên máy (lưu theo khối: lần sau chỉ ghi từ khối chứa điểm này) */
  const saved = useRef(0)

  useEffect(() => { voiceRef.current = voiceOn }, [voiceOn])
  useEffect(() => { autoPauseRef.current = autoPauseOn }, [autoPauseOn])

  const setPhase = useCallback((p: RunPhase) => { phaseRef.current = p; setPhaseState(p) }, [])
  const setAutoPauseOn = useCallback((on: boolean) => { setAutoPauseOnState(on); writeFlag(AUTO_PAUSE_KEY, on) }, [])
  const setQaOn = useCallback((on: boolean) => { setQaOnState(on); writeFlag(QA_KEY, on) }, [])

  const speak = useCallback((text: string) => {
    if (!voiceRef.current || typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'vi-VN'
    window.speechSynthesis.speak(u)
  }, [])

  /** Lưu tạm bài đang chạy trên máy (tối đa 5 giây một lần, trừ khi `force`) */
  const persist = useCallback((force = false) => {
    const now = Date.now()
    if (!force && now - lastPersist.current < PERSIST_EVERY_MS) return
    const st = session.current.snapshot()
    if (!st) return
    lastPersist.current = now
    saved.current = saveSnapshot(st, session.current.points, saved.current, now)
  }, [])

  /** Chép trạng thái RunSession ra màn hình */
  const sync = useCallback(() => {
    const s = session.current
    setView(viewOf(s))
    const p = phaseRef.current
    if (s.phase !== p && (p === 'LOCATING' || p === 'RUNNING' || p === 'PAUSED')) setPhase(s.phase)
    if (s.gpsLost && s.phase === 'RUNNING') setGps('LOST')
  }, [setPhase])

  /** Sự kiện từ RunSession → giọng HLV + lưu ngay những mốc quan trọng */
  const handle = useCallback((events: SessionEvent[]) => {
    let force = false
    for (const e of events) {
      switch (e.type) {
        case 'START': speak('Bắt đầu chạy'); force = true; break
        case 'SPLIT': speak(splitAnnouncement(e.split, e.movingS)); force = true; break
        case 'AUTO_PAUSE': if (autoPauseRef.current) speak('Tự tạm dừng'); break
        case 'AUTO_RESUME': if (autoPauseRef.current) speak('Tiếp tục chạy'); break
        case 'LONG_STOP':
          speak(`Bạn đã đứng yên ${e.minutes} phút. Nếu đã chạy xong, hãy bấm Kết thúc.`)
          try { navigator.vibrate?.([300, 150, 300]) } catch { /* bỏ qua */ }
          break
        case 'AUTO_STOPPED': speak(`Đã tạm dừng bài chạy vì bạn đứng yên ${e.minutes} phút.`); force = true; break
        case 'GAP': force = true; break
      }
    }
    persist(force)
  }, [speak, persist])

  // App cài: GPS chạy nền, để màn hình tắt cho đỡ pin. Trình duyệt: giữ màn hình sáng (Wake Lock + video câm cho iPhone)
  const acquireWakeLock = useCallback(() => { if (!tracksInBackground()) void keepAwake() }, [])
  const releaseWakeLock = useCallback(() => releaseAwake(), [])
  const stopWatch = useCallback(() => { stopLocation.current?.(); stopLocation.current = null }, [])

  const onPosition = useCallback((fix: LocationFix) => {
    setGps(fix.accuracy <= ENGINE.GOOD_ACCURACY_M ? 'GOOD' : 'WEAK')
    handle(session.current.fix(fix, Date.now()))
    sync()
  }, [handle, sync])

  const onPositionError = useCallback((err: LocationError) => {
    setGps(err.denied ? 'DENIED' : 'WEAK')
    if (err.denied) {
      stopWatch()
      setPhase('IDLE')
      setError('Bạn cần cho phép truy cập vị trí để ghi bài chạy.')
    }
  }, [stopWatch, setPhase])

  // Đồng hồ: RunSession tính theo mốc thời gian thật, không đếm tích tắc (chính xác cả khi tab bị treo)
  useEffect(() => {
    if (phase !== 'RUNNING') return
    const id = setInterval(() => { handle(session.current.tick(Date.now())); sync() }, 1000)
    return () => clearInterval(id)
  }, [phase, handle, sync])

  const start = useCallback(() => {
    if (!canTrackLocation()) { setGps('UNSUPPORTED'); return }
    setError(null)
    setResult(null)
    session.current = new RunSession()
    saved.current = 0
    lastPersist.current = 0
    clearSnapshot()
    setRecovery(null)
    setView(EMPTY)
    setGps('SEARCHING')
    setPhase('LOCATING')
    acquireWakeLock()          // gọi ngay trong thao tác bấm: iPhone mới cho phát video giữ màn hình
    stopLocation.current?.()
    stopLocation.current = watchLocation(onPosition, onPositionError)
  }, [acquireWakeLock, onPosition, onPositionError, setPhase])

  /** Bắt đầu dù tín hiệu GPS còn yếu */
  const startAnyway = useCallback(() => { handle(session.current.begin(Date.now())); sync() }, [handle, sync])

  const pause = useCallback(() => {
    session.current.pause(Date.now()); speak('Tạm dừng'); persist(true); sync()
  }, [speak, persist, sync])
  const resume = useCallback(() => {
    session.current.resume(Date.now()); speak('Tiếp tục'); persist(true); sync()
  }, [speak, persist, sync])
  /** "Vẫn đang nghỉ" ở câu hỏi kết thúc khi đứng yên lâu */
  const dismissLongStop = useCallback(() => { session.current.dismissLongStop(); sync() }, [sync])

  const finish = useCallback(() => {
    stopWatch()
    releaseWakeLock()
    session.current.finish(Date.now())
    setSummary(session.current.quality())
    setPhase('FINISHED')
    speak('Kết thúc bài chạy')
    persist(true)
    sync()
  }, [releaseWakeLock, speak, stopWatch, persist, sync, setPhase])

  const discard = useCallback(() => {
    stopWatch()
    releaseWakeLock()
    clearSnapshot()
    setPhase('IDLE')
    setGps('OFF')
  }, [releaseWakeLock, stopWatch, setPhase])

  /** Khôi phục bài dở dang: đang chạy → về trạng thái tạm dừng (bấm Tiếp tục để chạy tiếp); đã kết thúc → màn lưu */
  const restore = useCallback(() => {
    const r = recovery
    if (!r) return
    session.current = RunSession.restore(r.state, r.points, Date.now())
    saved.current = r.points.length
    setRecovery(null)
    setView(viewOf(session.current))
    if (session.current.phase === 'FINISHED') { setSummary(session.current.quality()); setPhase('FINISHED'); return }
    setPhase('PAUSED')
    setGps('SEARCHING')
    acquireWakeLock()
    if (canTrackLocation()) {
      stopLocation.current?.()
      stopLocation.current = watchLocation(onPosition, onPositionError)
    }
  }, [recovery, acquireWakeLock, onPosition, onPositionError, setPhase])

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
    const payload: RunPayload = session.current.payload(Date.now())
    const q = quality()
    const { data, error: rpcError } = await supabase.rpc('submit_and_process_activity', payload)
    if (rpcError) {
      if (rpcError.message.includes('ACTIVITY_DUPLICATE')) {
        clearSnapshot()
        setError('Bài chạy này đã được lưu trước đó.')
        setPhase('FINISHED')
        return null
      }
      // Mất mạng / máy chủ lỗi: giữ bài trên máy, tự gửi khi có mạng — người chạy không mất bài
      const kind = describeError(rpcError).kind
      if (kind === 'OFFLINE' || kind === 'NETWORK' || kind === 'TIMEOUT' || kind === 'SERVER') {
        enqueue(payload, Date.now(), undefined, q)
        clearSnapshot()
        setPhase('QUEUED')
        window.dispatchEvent(new Event('rh-run-queued'))
        return null
      }
      setError('Không lưu được bài chạy. Thử lại sau ít phút.')
      setPhase('FINISHED')
      return null
    }
    // Không chặn người chạy: gắn tóm tắt chất lượng GPS phía sau (máy chủ chưa chạy 008800 thì bỏ qua)
    void supabase.rpc('activity_attach_gps_quality', { p_started_at: payload.p_started_at, p_quality: q })
    clearSnapshot()
    setResult(data as SaveResult)
    setPhase('SAVED')
    return data as SaveResult
  }, [quality, setPhase])

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
      if (stopLocation.current) {
        stopLocation.current()
        stopLocation.current = watchLocation(onPosition, onPositionError)
      }
    }
    // Đóng tab / tải lại trang: lưu nốt phần mới nhất
    const onHide = () => { if (phaseRef.current === 'RUNNING' || phaseRef.current === 'PAUSED') persist(true) }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', onHide)
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pagehide', onHide) }
  }, [onPosition, onPositionError, persist])

  // Rời màn hình khi đang chạy: dọn GPS + wake lock
  useEffect(() => () => { stopWatch(); releaseWakeLock() }, [releaseWakeLock, stopWatch])

  return {
    background: tracksInBackground(),
    phase, gps, ...view, autoPauseOn, voiceOn, result, error, recovery, qaOn, qa, summary,
    setVoiceOn, setAutoPauseOn, setQaOn, setQa, start, startAnyway, pause, resume, finish, discard, save, restore, dismissRecovery, dismissLongStop,
  }
}
