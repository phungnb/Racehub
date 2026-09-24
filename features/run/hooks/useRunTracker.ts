'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/shared/lib/supabase'
import { GPS, evaluatePoint, isStationary, nextSplit, rollingPace, smoothPoint, splitAnnouncement, type Split, type TrackPoint } from '../model/tracker'

export type RunPhase = 'IDLE' | 'LOCATING' | 'RUNNING' | 'PAUSED' | 'FINISHED' | 'SAVING' | 'SAVED'
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
  const watchId = useRef<number | null>(null)
  const wakeLock = useRef<WakeLockSentinelLike | null>(null)
  const voiceRef = useRef(true)

  useEffect(() => { phaseRef.current = phase }, [phase])
  useEffect(() => { voiceRef.current = voiceOn }, [voiceOn])

  const speak = useCallback((text: string) => {
    if (!voiceRef.current || typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'vi-VN'
    window.speechSynthesis.speak(u)
  }, [])

  const acquireWakeLock = useCallback(async () => {
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
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current)
    watchId.current = null
  }, [])

  const onPosition = useCallback((pos: GeolocationPosition) => {
    const { latitude, longitude, accuracy, altitude, speed } = pos.coords
    const p: TrackPoint = {
      latitude, longitude, accuracy, altitude: altitude ?? 0, speed: speed ?? null,
      recorded_at: new Date(pos.timestamp || Date.now()).toISOString(),
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
    const v = evaluatePoint(lastAccepted.current, sp)
    if (!v.accept) return
    lastAccepted.current = sp
    points.current.push(sp)
    if (v.speed > GPS.AUTO_PAUSE_MPS || v.distance === 0) {
      lastMoveAt.current = Date.now()
      setAutoPaused(false)
    }
    const prev = distanceRef.current
    distanceRef.current += v.distance
    setDistanceM(distanceRef.current)
    setCurrentPace(rollingPace(points.current))

    const split = nextSplit(prev, distanceRef.current, movingRef.current, splitsRef.current)
    if (split) {
      splitsRef.current = [...splitsRef.current, split]
      setSplits(splitsRef.current)
      speak(splitAnnouncement(split, movingRef.current))
    }
  }, [speak])

  const onPositionError = useCallback((err: GeolocationPositionError) => {
    setGps(err.code === err.PERMISSION_DENIED ? 'DENIED' : 'WEAK')
    if (err.code === err.PERMISSION_DENIED) {
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
      setElapsedS((s) => s + dt)
      if (!idle) {
        movingRef.current += dt
        setMovingS(movingRef.current)
      }
    }, 1000)
    return () => clearInterval(id)
  }, [phase])

  const start = useCallback(() => {
    if (!('geolocation' in navigator)) { setGps('UNSUPPORTED'); return }
    setError(null)
    setResult(null)
    points.current = []
    lastAccepted.current = null
    distanceRef.current = 0
    movingRef.current = 0
    splitsRef.current = []
    raw.current = []
    setGapS(0)
    setDistanceM(0); setElapsedS(0); setMovingS(0); setCurrentPace(0); setSplits([]); setAutoPaused(false)
    setGps('SEARCHING')
    setPhase('LOCATING')
    phaseRef.current = 'LOCATING'
    void acquireWakeLock()
    watchId.current = navigator.geolocation.watchPosition(onPosition, onPositionError,
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 })
  }, [acquireWakeLock, onPosition, onPositionError])

  /** Bắt đầu dù tín hiệu GPS còn yếu */
  const startAnyway = useCallback(() => {
    startedAt.current = Date.now()
    lastTick.current = Date.now()
    lastMoveAt.current = Date.now()
    setPhase('RUNNING')
    phaseRef.current = 'RUNNING'
  }, [])

  const pause = useCallback(() => { setPhase('PAUSED'); lastTick.current = null; speak('Tạm dừng') }, [speak])
  const resume = useCallback(() => {
    lastTick.current = Date.now()
    lastMoveAt.current = Date.now()
    lastAccepted.current = null           // không nối đoạn GPS qua quãng tạm dừng
    raw.current = []
    setPhase('RUNNING')
    speak('Tiếp tục')
  }, [speak])

  const finish = useCallback(() => {
    stopWatch()
    releaseWakeLock()
    setPhase('FINISHED')
    speak('Kết thúc bài chạy')
  }, [releaseWakeLock, speak, stopWatch])

  const discard = useCallback(() => {
    stopWatch()
    releaseWakeLock()
    setPhase('IDLE')
    setGps('OFF')
  }, [releaseWakeLock, stopWatch])

  const save = useCallback(async () => {
    setPhase('SAVING')
    setError(null)
    const km = distanceRef.current / 1000
    const moving = Math.round(movingRef.current)
    const { data, error: rpcError } = await supabase.rpc('submit_and_process_activity', {
      p_title: `Buổi chạy ${new Date(startedAt.current ?? Date.now()).toLocaleDateString('vi-VN')}`,
      p_source: 'DIRECT_GPS',
      p_started_at: new Date(startedAt.current ?? Date.now()).toISOString(),
      p_ended_at: new Date().toISOString(),
      p_elapsed_s: Math.round(elapsedS),
      p_moving_s: moving,
      p_distance_m: Math.round(distanceRef.current),
      p_avg_pace_s: km > 0 ? Math.round(moving / km) : 0,
      p_track_points: points.current,
    })
    if (rpcError) {
      setError(rpcError.message.includes('ACTIVITY_DUPLICATE')
        ? 'Bài chạy này đã được lưu trước đó.'
        : 'Không lưu được bài chạy. Kiểm tra kết nối mạng rồi thử lại.')
      setPhase('FINISHED')
      return null
    }
    setResult(data as SaveResult)
    setPhase('SAVED')
    return data as SaveResult
  }, [elapsedS])

  // Tắt màn hình / chuyển app: trình duyệt dừng GPS và nhả chế độ giữ sáng màn hình.
  // Quay lại → xin lại cả hai; đoạn bị mất được nối bằng đường thẳng và báo cho người chạy.
  useEffect(() => {
    const onVis = () => {
      const active = phaseRef.current === 'RUNNING' || phaseRef.current === 'PAUSED' || phaseRef.current === 'LOCATING'
      if (!active) return
      if (document.visibilityState === 'hidden') { hiddenAt.current = Date.now(); return }
      void acquireWakeLock()
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current)
        watchId.current = navigator.geolocation.watchPosition(onPosition, onPositionError, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 })
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
  }, [acquireWakeLock, onPosition, onPositionError])

  // Rời màn hình khi đang chạy: dọn GPS + wake lock
  useEffect(() => () => { stopWatch(); releaseWakeLock() }, [releaseWakeLock, stopWatch])

  return {
    phase, gps, distanceM, elapsedS, movingS, currentPace, autoPaused, splits, voiceOn, result, error, gapS,
    setVoiceOn, start, startAnyway, pause, resume, finish, discard, save,
  }
}
