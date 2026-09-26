'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/shared/lib/supabase'
import { describeError } from '@/shared/lib/errors'
import { canTrackLocation, tracksInBackground, watchLocation, type LocationError, type LocationFix } from '../model/location'
import { buildPayload, clearSnapshot, enqueue, loadSnapshot, saveSnapshot, type RunSnapshot } from '../model/recovery'
import { ENGINE, GPS, TrackEngine, compactPoint, gpsReady, nextSplit, rollingPace, splitAnnouncement, type GpsGap, type Split, type TrackPoint } from '../model/tracker'
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

export function useRunTracker() {
  const [phase, setPhase] = useState<RunPhase>('IDLE')
  const [gps, setGps] = useState<GpsState>('OFF')
  const [distanceM, setDistanceM] = useState(0)
  const [elapsedS, setElapsedS] = useState(0)
  const [movingS, setMovingS] = useState(0)
  const [currentPace, setCurrentPace] = useState(0)
  /** Pace trung bình = thời gian di chuyển của các đoạn GPS / quãng đường GPS (cùng một nguồn → luôn khớp) */
  const [avgPace, setAvgPace] = useState(0)
  const lastAcceptAt = useRef(0)
  /** Lần cuối nhận được điểm GPS (bất kể chất lượng) — quá 15 giây → "Mất GPS" */
  const lastFixAt = useRef(0)
  /** Các điểm lúc chờ GPS (chỉ sai số + thời gian) — đủ ổn định mới bắt đầu tính giờ */
  const warmup = useRef<{ accuracy: number; time: number }[]>([])
  const engine = useRef(new TrackEngine())
  const [gaps, setGaps] = useState<GpsGap[]>([])
  const [autoPaused, setAutoPaused] = useState(false)
  const [splits, setSplits] = useState<Split[]>([])
  const [voiceOn, setVoiceOn] = useState(true)
  const [result, setResult] = useState<SaveResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** App bị ẩn (tắt màn hình / chuyển app) bao nhiêu giây trong lúc chạy — iPhone dừng GPS khi đó */
  const [gapS, setGapS] = useState(0)
  const hiddenAt = useRef<number | null>(null)

  const points = useRef<TrackPoint[]>([])
  const startedAt = useRef<number | null>(null)
  const lastTick = useRef<number | null>(null)
  const lastMoveAt = useRef<number>(0)
  const distanceRef = useRef(0)
  const movingRef = useRef(0)
  const splitsRef = useRef<Split[]>([])
  const phaseRef = useRef<RunPhase>('IDLE')
  const stopLocation = useRef<(() => void) | null>(null)
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

  // App cài: GPS chạy nền, để màn hình tắt cho đỡ pin. Trình duyệt: giữ màn hình sáng (Wake Lock + video câm cho iPhone)
  const acquireWakeLock = useCallback(() => { if (!tracksInBackground()) void keepAwake() }, [])
  const releaseWakeLock = useCallback(() => releaseAwake(), [])

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
    lastFixAt.current = Date.now()
    setGps(accuracy <= ENGINE.GOOD_ACCURACY_M ? 'GOOD' : 'WEAK')

    if (phaseRef.current === 'LOCATING') {
      warmup.current = [...warmup.current.slice(-4), { accuracy, time: Date.now() }]   // giờ nhận (giờ GPS một số máy lệch)
    }
    if (phaseRef.current === 'LOCATING' && gpsReady(warmup.current, Date.now())) {
      // Có tín hiệu tốt → bắt đầu tính giờ
      startedAt.current = Date.now()
      lastTick.current = Date.now()
      lastMoveAt.current = Date.now()
      setPhase('RUNNING')
      phaseRef.current = 'RUNNING'
      speak('Bắt đầu chạy')
    }
    if (phaseRef.current !== 'RUNNING') return

    const r = engine.current.push(p)
    if (r.gap) {
      setGaps([...engine.current.gaps])
      setGapS((g) => g + r.gap!.seconds)
    }
    if (!r.point) return
    // Mỗi điểm mang quãng đường tích luỹ app đo (máy chủ dùng số này, kẹp theo tuyến — xem migration 006600)
    points.current.push(compactPoint({ ...r.point, distance_m: distanceRef.current + r.distance }))
    if (r.distance === 0 && !r.gap) return      // điểm đầu đoạn
    movingRef.current += r.moving
    lastAcceptAt.current = Date.now()
    if (r.distance > 0 && (r.moving === 0 || r.distance / Math.max(r.moving, 1) > GPS.AUTO_PAUSE_MPS)) {
      lastMoveAt.current = Date.now()
      setAutoPaused(false)
    }
    const prev = distanceRef.current
    distanceRef.current += r.distance
    setDistanceM(distanceRef.current)
    setMovingS(movingRef.current)
    setCurrentPace(rollingPace(points.current))
    setAvgPace(distanceRef.current >= 50 ? movingRef.current / (distanceRef.current / 1000) : 0)

    // Qua đoạn mất tín hiệu có thể vượt nhiều mốc km cùng lúc → ghi đủ từng km
    const before = splitsRef.current.length
    let split = nextSplit(prev, distanceRef.current, movingRef.current, splitsRef.current)
    while (split) {
      splitsRef.current = [...splitsRef.current, split]
      split = nextSplit(prev, distanceRef.current, movingRef.current, splitsRef.current)
    }
    if (splitsRef.current.length > before) {
      setSplits(splitsRef.current)
      speak(splitAnnouncement(splitsRef.current[splitsRef.current.length - 1], movingRef.current))
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
      if (lastFixAt.current && now - lastFixAt.current > 15_000) setGps('LOST')
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
    engine.current = new TrackEngine()
    setGaps([])
    lastFixAt.current = 0
    warmup.current = []
    distanceRef.current = 0
    movingRef.current = 0
    splitsRef.current = []
    setGapS(0)
    elapsedRef.current = 0
    clearSnapshot()
    setRecovery(null)
    setDistanceM(0); setElapsedS(0); setMovingS(0); setCurrentPace(0); setAvgPace(0); setSplits([]); setAutoPaused(false)
    lastAcceptAt.current = 0
    setGps('SEARCHING')
    setPhase('LOCATING')
    phaseRef.current = 'LOCATING'
    acquireWakeLock()          // gọi ngay trong thao tác bấm: iPhone mới cho phát video giữ màn hình
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
    engine.current.breakSegment()          // không nối đoạn GPS qua quãng tạm dừng
    lastAcceptAt.current = 0
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
    engine.current = new TrackEngine()
    setElapsedS(s.elapsedS); setMovingS(s.movingS); setDistanceM(s.distanceM); setSplits(s.splits)
    setAvgPace(s.distanceM >= 50 ? s.movingS / (s.distanceM / 1000) : 0)
    setRecovery(null)
    if (s.phase === 'FINISHED') { setPhase('FINISHED'); phaseRef.current = 'FINISHED'; return }
    setPhase('PAUSED')
    phaseRef.current = 'PAUSED'
    setGps('SEARCHING')
    acquireWakeLock()
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
      reacquireAwake()
      if (stopLocation.current) {
        stopLocation.current()
        stopLocation.current = watchLocation(onPosition, onPositionError)
      }
      // Đoạn bị ẩn được bộ máy GPS ghi thành "mất tín hiệu" khi có điểm mới (gaps) — không nối âm thầm
      hiddenAt.current = null
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [onPosition, onPositionError, persist])

  // Rời màn hình khi đang chạy: dọn GPS + wake lock
  useEffect(() => () => { stopWatch(); releaseWakeLock() }, [releaseWakeLock, stopWatch])

  return {
    background: tracksInBackground(),
    phase, gps, distanceM, elapsedS, movingS, currentPace, avgPace, autoPaused, splits, voiceOn, result, error, gapS, gaps, recovery,
    setVoiceOn, start, startAnyway, pause, resume, finish, discard, save, restore, dismissRecovery,
  }
}
