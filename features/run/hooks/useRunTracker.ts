'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/shared/lib/supabase'
import { describeError } from '@/shared/lib/errors'
import { canTrackLocation, tracksInBackground, watchLocation, type LocationError, type LocationFix } from '../model/location'
import { buildPayload, clearSnapshot, enqueue, loadSnapshot, saveSnapshot, type RunSnapshot } from '../model/recovery'
import { GPS, evaluatePoint, isStationary, nextSplit, rollingPace, segmentMovingS, smoothPoint, splitAnnouncement, type Split, type TrackPoint } from '../model/tracker'

export type RunPhase = 'IDLE' | 'LOCATING' | 'RUNNING' | 'PAUSED' | 'FINISHED' | 'SAVING' | 'SAVED' | 'QUEUED'
export type GpsState = 'OFF' | 'SEARCHING' | 'GOOD' | 'WEAK' | 'DENIED' | 'UNSUPPORTED'

export interface SaveResult {
  activity_id?: string
  validation_status: 'APPROVED' | 'PENDING' | 'REJECTED'
  validation_reason: string
  earned_xu: number
  earned_xp: number
  distance_m: number
}

type WakeLockSentinelLike = { release: () => Promise<void> }

export function useRunTracker() {
  const [phase, setPhase] = useState<RunPhase>('IDLE')
  const [gps, setGps] = useState<GpsState>('OFF')
  const [distanceM, setDistanceM] = useState(0)
  const [elapsedS, setElapsedS] = useState(0)
  const [movingS, setMovingS] = useState(0)
  const [currentPace, setCurrentPace] = useState(0)
  /** Pace trung bình = thời gian di chuyển của các đoạn GPS / quãng đường GPS (cùng một nguồn → luôn khớp) */
  const [avgPace, setAvgPace] = useState(0)
  const recentSpeed = useRef(2.8)
  const lastAcceptAt = useRef(0)
  const [autoPaused, setAutoPaused] = useState(false)
  const [splits, setSplits] = useState<Split[]>([])
  const [voiceOn, setVoiceOn] = useState(true)
  const [result, setResult] = useState<SaveResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** App bị ẩn (tắt màn hình / chuyển app) bao nhiêu giây trong lúc chạy — iPhone dừng GPS khi đó */
  const [gapS, setGapS] = useState(0)
  const raw = useRef<TrackPoint[]>([])
  const hiddenAt = useRef<number | null>(null)

  const points = useRef<TrackPoint[]>([])
  const lastAccepted = useRef<TrackPoint | null>(null)
  const startedAt = useRef<number | null>(null)
  const lastTick = useRef<number | null>(null)
  const lastMoveAt = useRef<number>(0)
  const distanceRef = useRef(0)
  const movingRef = useRef(0)
  const splitsRef = useRef<Split[]>([])
  const phaseRef = useRef<RunPhase>('IDLE')
  const stopLocation = useRef<(() => void) | null>(null)
  const wakeLock = useRef<WakeLockSentinelLike | null>(null)
  const voiceRef = useRef(true)
  const elapsedRef = useRef(0)
  const lastPersist = useRef(0)
  /** Bài dở dang lưu trên máy từ lần trước (app bị đóng giữa chừng) — hỏi người chạy có khôi phục không */
  const [recovery, setRecovery] = useState<RunSnapshot | null>(() => (typeof window === 'undefined' ? null : loadSnapshot()))

  useEffect(() => { phaseRef.current = phase }, [phase])
  useEffect(() => { voiceRef.current = voiceOn }, [voiceOn])

  const speak = useCallback((text: string) => {
    if (!voiceRef.current || typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'vi-VN'
    window.speechSynthesis.speak(u)
  }, [])

  /** Lưu tạm bài đang chạy trên máy (tối đa 5 giây một lần, trừ khi `force`) */
  const persist = useCallback((force = false) => {
    const ph = phaseRef.current
    if ((ph !== 'RUNNING' && ph !== 'PAUSED' && ph !== 'FINISHED') || !startedAt.current) return
    const now = Date.now()
    if (!force && now - lastPersist.current < 5000) return
    lastPersist.current = now
    saveSnapshot({
      v: 1, phase: ph, startedAt: startedAt.current, savedAt: now, elapsedS: elapsedRef.current, movingS: movingRef.current,
      distanceM: distanceRef.current, points: points.current, splits: splitsRef.current,
    })
  }, [])

  const acquireWakeLock = useCallback(async () => {
    if (tracksInBackground()) return   // app cài: GPS chạy nền, để màn hình tắt cho đỡ pin
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLike> } }).wakeLock
      if (wl) wakeLock.current = await wl.request('screen')
    } catch { /* không hỗ trợ / bị từ chối: bỏ qua */ }
  }, [])
  const releaseWakeLock = useCallback(() => {
    wakeLock.current?.release().catch(() => undefined)
    wakeLock.current = null
  }, [])

  const stopWatch = useCallback(() => {
    stopLocation.current?.()
    stopLocation.current = null
  }, [])

  const onPosition = useCallback((fix: LocationFix) => {
    const { latitude, longitude, accuracy, altitude, speed } = fix
    const p: TrackPoint = {
      latitude, longitude, accuracy, altitude: altitude ?? 0, speed: speed ?? null,
      recorded_at: new Date(fix.time).toISOString(),
    }
    setGps(accuracy <= GPS.MAX_ACCURACY_M ? 'GOOD' : 'WEAK')

    if (phaseRef.current === 'LOCATING' && accuracy <= GPS.MAX_ACCURACY_M) {
      // Có tín hiệu tốt → bắt đầu tính giờ
      startedAt.current = Date.now()
      lastTick.current = Date.now()
      lastMoveAt.current = Date.now()
      setPhase('RUNNING')
      phaseRef.current = 'RUNNING'
      speak('Bắt đầu chạy')
    }
    if (phaseRef.current !== 'RUNNING') return
    if (accuracy > GPS.MAX_ACCURACY_M) return

    // Đứng yên (vị trí đã làm mượt gần như không đổi trong 10 giây) → không cộng quãng đường
    raw.current.push(p)
    if (raw.current.length > 60) raw.current.splice(0, raw.current.length - 60)
    if (isStationary(raw.current)) return
    const sp = smoothPoint(raw.current)!
    const anchor = lastAccepted.current
    const v = evaluatePoint(anchor, sp)
    if (!v.accept) return
    if (anchor) {
      const dt = (Date.parse(sp.recorded_at) - Date.parse(anchor.recorded_at)) / 1000
      movingRef.current += segmentMovingS(dt, v.distance, recentSpeed.current)
      if (dt <= GPS.SEGMENT_MAX_S) recentSpeed.current = 0.7 * recentSpeed.current + 0.3 * v.speed
    }
    lastAcceptAt.current = Date.now()
    lastAccepted.current = sp
    points.current.push(sp)
    if (v.speed > GPS.AUTO_PAUSE_MPS || v.distance === 0) {
      lastMoveAt.current = Date.now()
      setAutoPaused(false)
    }
    const prev = distanceRef.current
    distanceRef.current += v.distance
    setDistanceM(distanceRef.current)
    setMovingS(movingRef.current)
    setCurrentPace(rollingPace(points.current))
    setAvgPace(distanceRef.current >= 50 ? movingRef.current / (distanceRef.current / 1000) : 0)

    const split = nextSplit(prev, distanceRef.current, movingRef.current, splitsRef.current)
    if (split) {
      splitsRef.current = [...splitsRef.current, split]
      setSplits(splitsRef.current)
      speak(splitAnnouncement(split, movingRef.current))
    }
    persist()
  }, [speak, persist])

  const onPositionError = useCallback((err: LocationError) => {
    setGps(err.denied ? 'DENIED' : 'WEAK')
    if (err.denied) {
      stopWatch()
      setPhase('IDLE')
      setError('Bạn cần cho phép truy cập vị trí để ghi bài chạy.')
    }
  }, [stopWatch])

  // Đồng hồ: tính theo mốc thời gian thật, không đếm tích tắc (chính xác cả khi tab bị treo)
  useEffect(() => {
    if (phase !== 'RUNNING') return
    const id = setInterval(() => {
      const now = Date.now()
      const dt = lastTick.current ? (now - lastTick.current) / 1000 : 0
      lastTick.current = now
      const idle = (now - lastMoveAt.current) / 1000 > GPS.AUTO_PAUSE_AFTER_S
      setAutoPaused(idle)
      elapsedRef.current += dt
      setElapsedS(elapsedRef.current)
      // Đồng hồ chạy mượt giữa hai điểm GPS; con số chính xác được chốt mỗi khi nhận điểm mới
      const live = idle || !lastAcceptAt.current ? 0 : Math.min((now - lastAcceptAt.current) / 1000, GPS.SEGMENT_MAX_S)
      setMovingS(movingRef.current + live)
      if (idle) setCurrentPace(0)
      else setCurrentPace(rollingPace(points.current, 30, now))
      persist()
    }, 1000)
    return () => clearInterval(id)
  }, [phase, persist])

  const start = useCallback(() => {
    if (!canTrackLocation()) { setGps('UNSUPPORTED'); return }
    setError(null)
    setResult(null)
    points.current = []
    lastAccepted.current = null
    distanceRef.current = 0
    movingRef.current = 0
    splitsRef.current = []
    raw.current = []
    setGapS(0)
    elapsedRef.current = 0
    clearSnapshot()
    setRecovery(null)
    setDistanceM(0); setElapsedS(0); setMovingS(0); setCurrentPace(0); setAvgPace(0); setSplits([]); setAutoPaused(false)
    recentSpeed.current = 2.8
    lastAcceptAt.current = 0
    setGps('SEARCHING')
    setPhase('LOCATING')
    phaseRef.current = 'LOCATING'
    void acquireWakeLock()
    stopLocation.current?.()
    stopLocation.current = watchLocation(onPosition, onPositionError)
  }, [acquireWakeLock, onPosition, onPositionError])

  /** Bắt đầu dù tín hiệu GPS còn yếu */
  const startAnyway = useCallback(() => {
    startedAt.current = Date.now()
    lastTick.current = Date.now()
    lastMoveAt.current = Date.now()
    setPhase('RUNNING')
    phaseRef.current = 'RUNNING'
  }, [])

  const pause = useCallback(() => {
    setPhase('PAUSED'); phaseRef.current = 'PAUSED'; lastTick.current = null; speak('Tạm dừng'); persist(true)
  }, [speak, persist])
  const resume = useCallback(() => {
    lastTick.current = Date.now()
    lastMoveAt.current = Date.now()
    lastAccepted.current = null           // không nối đoạn GPS qua quãng tạm dừng
    lastAcceptAt.current = 0
    raw.current = []
    setPhase('RUNNING')
    phaseRef.current = 'RUNNING'
    speak('Tiếp tục')
    persist(true)
  }, [speak, persist])

  const finish = useCallback(() => {
    stopWatch()
    releaseWakeLock()
    setPhase('FINISHED')
    phaseRef.current = 'FINISHED'
    speak('Kết thúc bài chạy')
    persist(true)
  }, [releaseWakeLock, speak, stopWatch, persist])

  const discard = useCallback(() => {
    stopWatch()
    releaseWakeLock()
    clearSnapshot()
    setPhase('IDLE')
    setGps('OFF')
  }, [releaseWakeLock, stopWatch])

  /** Khôi phục bài dở dang: đang chạy → về trạng thái tạm dừng (bấm Tiếp tục để chạy tiếp); đã kết thúc → màn lưu */
  const restore = useCallback(() => {
    const s = recovery
    if (!s) return
    startedAt.current = s.startedAt
    elapsedRef.current = s.elapsedS
    movingRef.current = s.movingS
    distanceRef.current = s.distanceM
    points.current = s.points
    splitsRef.current = s.splits
    lastAccepted.current = null
    raw.current = []
    setElapsedS(s.elapsedS); setMovingS(s.movingS); setDistanceM(s.distanceM); setSplits(s.splits)
    setAvgPace(s.distanceM >= 50 ? s.movingS / (s.distanceM / 1000) : 0)
    setRecovery(null)
    if (s.phase === 'FINISHED') { setPhase('FINISHED'); phaseRef.current = 'FINISHED'; return }
    setPhase('PAUSED')
    phaseRef.current = 'PAUSED'
    setGps('SEARCHING')
    void acquireWakeLock()
    if (canTrackLocation()) {
      stopLocation.current?.()
      stopLocation.current = watchLocation(onPosition, onPositionError)
    }
  }, [recovery, acquireWakeLock, onPosition, onPositionError])

  const dismissRecovery = useCallback(() => { clearSnapshot(); setRecovery(null) }, [])

  const save = useCallback(async () => {
    setPhase('SAVING')
    setError(null)
    const payload = buildPayload({
      startedAt: startedAt.current ?? Date.now(), endedAt: Date.now(), elapsedS: elapsedRef.current,
      movingS: movingRef.current, distanceM: distanceRef.current, points: points.current,
    })
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
        enqueue(payload)
        clearSnapshot()
        setPhase('QUEUED')
        window.dispatchEvent(new Event('rh-run-queued'))
        return null
      }
      setError('Không lưu được bài chạy. Thử lại sau ít phút.')
      setPhase('FINISHED')
      return null
    }
    clearSnapshot()
    setResult(data as SaveResult)
    setPhase('SAVED')
    return data as SaveResult
  }, [])

  // Tắt màn hình / chuyển app: trình duyệt dừng GPS và nhả chế độ giữ sáng màn hình.
  // Quay lại → xin lại cả hai; đoạn bị mất được nối bằng đường thẳng và báo cho người chạy.
  // Trong app cài: GPS vẫn chạy nền nên chỉ lưu tạm, không có "đoạn bị mất".
  useEffect(() => {
    const onVis = () => {
      const active = phaseRef.current === 'RUNNING' || phaseRef.current === 'PAUSED' || phaseRef.current === 'LOCATING'
      if (!active) return
      if (document.visibilityState === 'hidden') { hiddenAt.current = Date.now(); persist(true); return }
      if (tracksInBackground()) { hiddenAt.current = null; return }
      void acquireWakeLock()
      if (stopLocation.current) {
        stopLocation.current()
        stopLocation.current = watchLocation(onPosition, onPositionError)
      }
      raw.current = []
      if (hiddenAt.current && phaseRef.current === 'RUNNING') {
        const gone = (Date.now() - hiddenAt.current) / 1000
        if (gone > 15) setGapS((g) => g + Math.round(gone))
      }
      hiddenAt.current = null
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [acquireWakeLock, onPosition, onPositionError, persist])

  // Rời màn hình khi đang chạy: dọn GPS + wake lock
  useEffect(() => () => { stopWatch(); releaseWakeLock() }, [releaseWakeLock, stopWatch])

  return {
    background: tracksInBackground(),
    phase, gps, distanceM, elapsedS, movingS, currentPace, avgPace, autoPaused, splits, voiceOn, result, error, gapS, recovery,
    setVoiceOn, start, startAnyway, pause, resume, finish, discard, save, restore, dismissRecovery,
  }
}
