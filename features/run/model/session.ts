// Phiên chạy (Tracking Engine) — toàn bộ logic ghi bài chạy, không phụ thuộc React / trình duyệt / nền tảng:
//   Location Provider (location.ts: trình duyệt hoặc Core Location / Fused Location qua plugin native)
//     → RunSession.fix(): lọc điểm (TrackEngine: Kalman, đứng yên, nhảy điểm, mất tín hiệu) → quãng đường, pace, từng km
//     → RunSession.tick(): đồng hồ, tự tạm dừng, đứng nghỉ quá lâu
//     → snapshot() / restore(): lưu tạm trên máy · payload(): gửi máy chủ · quality(): tóm tắt chất lượng GPS
// Giao diện (useRunTracker) chỉ gửi lệnh + hiển thị + đọc giọng nói theo sự kiện trả về.
// Viết app native thuần sau này: giữ nguyên lớp này (hoặc port 1-1), chỉ thay nguồn vị trí.
import { buildPayload, type RunPayload } from './recovery'
import { DEFAULT_TRACKING, type TrackingRules } from '@/shared/lib/ops'
import { ENGINE, GPS, TrackEngine, compactPoint, gpsReady, movingClock, nextSplit, rollingPace, type GpsGap, type Split, type TrackPoint } from './tracker'

export type SessionPhase = 'LOCATING' | 'RUNNING' | 'PAUSED' | 'FINISHED'

/** Một điểm vị trí thô từ nguồn vị trí (cùng dạng LocationFix) */
export interface FixInput {
  latitude: number
  longitude: number
  accuracy: number
  altitude: number | null
  speed: number | null
  /** giờ đo (ms) */
  time: number
}

/**
 * Đứng nghỉ mà không bấm Tạm dừng (như Apple Watch "Bạn quên kết thúc bài tập?", Garmin tự tắt khi đứng quá lâu):
 * - ASK_S: đứng yên 10 phút → hỏi "Đã chạy xong? Kết thúc bài chạy" (giọng nói + băng thông báo), chưa đổi gì;
 * - AUTO_STOP_S: đứng yên 30 phút → tự chuyển sang Tạm dừng (tổng thời gian ngừng tăng, GPS vẫn bật để chạy tiếp);
 * - TRIM_S: bấm Kết thúc khi đã đứng yên từ 2 phút → bỏ phần đứng yên cuối bài: giờ kết thúc = lúc dừng chạy.
 *   Tránh bài "chạy 5 km trong 3 tiếng" vì quên bấm Kết thúc — tổng thời gian sai, chồng giờ với bài sau (máy chủ báo trùng).
 */
export const STOP = { ASK_S: 600, AUTO_STOP_S: 1800, TRIM_S: 120 } as const
// Giá trị trên là mặc định; admin đổi được ở Quản trị → Hệ thống → Chính sách vận hành (ops_policy.tracking, 009100)
/** Quá 15 giây không có điểm GPS nào → "Mất GPS" */
export const LOST_AFTER_MS = 15_000

export type SessionEvent =
  | { type: 'START' }
  | { type: 'SPLIT'; split: Split; movingS: number }
  | { type: 'AUTO_PAUSE' }
  | { type: 'AUTO_RESUME' }
  | { type: 'GAP'; gap: GpsGap }
  | { type: 'LONG_STOP'; minutes: number }
  | { type: 'AUTO_STOPPED'; minutes: number }

type Reject = 'INACCURATE' | 'STILL' | 'JITTER' | 'TELEPORT' | 'NO_TIME'
type LogCode = 'start' | 'pause' | 'resume' | 'auto_pause' | 'auto_resume' | 'gap' | 'long_stop' | 'auto_stop' | 'hidden' | 'visible' | 'finish' | 'restore'

/** Bộ đếm chất lượng GPS của buổi chạy (gọn, không lưu từng điểm bị loại) */
export interface QualityCounters {
  fixes: number
  accepted: number
  rejected: Partial<Record<Reject, number>>
  accSum: number
  accMax: number
  pauses: number
  autoPauses: number
  longStops: number
  autoStopped: number
  hidden: number
  hiddenS: number
  trimmedS: number
  /** nhật ký sự kiện: [giây kể từ lúc bắt đầu, mã] — tối đa 120 dòng */
  log: [number, LogCode][]
}

/** Dữ liệu lưu tạm trên máy (không kèm điểm GPS — điểm lưu riêng theo khối, xem recovery.ts) */
export interface SessionState {
  phase: 'RUNNING' | 'PAUSED' | 'FINISHED'
  startedAt: number
  endedAt: number | null
  elapsedS: number
  movingS: number
  distanceM: number
  splits: Split[]
  gaps: GpsGap[]
  moved: boolean
  /** tổng thời gian tại lần di chuyển cuối — để cắt phần đứng yên cuối bài */
  elapsedAtMove: number
  q: QualityCounters
}

const emptyQ = (): QualityCounters => ({
  fixes: 0, accepted: 0, rejected: {}, accSum: 0, accMax: 0, pauses: 0, autoPauses: 0, longStops: 0, autoStopped: 0, hidden: 0, hiddenS: 0, trimmedS: 0, log: [],
})

export class RunSession {
  phase: SessionPhase = 'LOCATING'
  startedAt = 0
  endedAt: number | null = null
  elapsedS = 0
  /** thời gian di chuyển đã chốt theo điểm GPS (dùng tính pace, gửi máy chủ) */
  movingS = 0
  /** số trên đồng hồ "Thời gian chạy": chạy đều từng giây, không bao giờ lùi */
  shownS = 0
  distanceM = 0
  currentPace = 0
  points: TrackPoint[] = []
  splits: Split[] = []
  /** đã bắt đầu di chuyển chưa (bấm Bắt đầu khi còn đứng = "sẵn sàng", chưa phải tự tạm dừng) */
  moved = false
  autoPaused = false
  /** đang hỏi "đứng yên lâu — kết thúc?" */
  longStop = false
  /** vừa tự chuyển sang Tạm dừng vì đứng yên quá lâu */
  autoStopped = false
  gpsLost = false
  lastFixAt = 0
  q: QualityCounters = emptyQ()

  private engine = new TrackEngine()
  private warm: { accuracy: number; time: number }[] = []
  private lastTick: number | null = null
  private lastMoveAt = 0
  private lastAcceptAt = 0
  private elapsedAtMove = 0
  private hiddenAt: number | null = null
  /** Quy tắc ghi bài chạy (giây) — từ chính sách vận hành, thiếu thì mặc định */
  readonly rules: { autoPauseAfterS: number; askS: number; autoStopS: number; trimS: number }

  constructor(rules: Partial<TrackingRules> = {}) {
    const r = { ...DEFAULT_TRACKING, ...rules }
    this.rules = { autoPauseAfterS: r.autoPauseAfterS, askS: r.longStopAskMin * 60, autoStopS: r.longStopAutoStopMin * 60, trimS: r.trimTailMin * 60 }
  }

  get gaps(): GpsGap[] { return this.engine.gaps }
  get gapS() { return this.engine.gaps.reduce((s, g) => s + g.seconds, 0) }
  get avgPace() { return this.distanceM >= 50 ? this.movingS / (this.distanceM / 1000) : 0 }
  /** số giây đứng yên (từ lần di chuyển cuối) */
  idleS(now: number) { return this.phase === 'RUNNING' ? Math.max(0, (now - this.lastMoveAt) / 1000) : 0 }

  private log(now: number, code: LogCode) {
    if (this.q.log.length < 120) this.q.log.push([this.startedAt ? Math.max(0, Math.round((now - this.startedAt) / 1000)) : 0, code])
  }
  /** cộng dồn tổng thời gian tới `now` (chỉ khi đang chạy) */
  private advance(now: number) {
    if (this.phase === 'RUNNING' && this.lastTick !== null) this.elapsedS += Math.max(0, (now - this.lastTick) / 1000)
    this.lastTick = this.phase === 'RUNNING' ? now : null
  }

  /** Bắt đầu tính giờ (GPS đã sẵn sàng, hoặc người chạy bấm "Bắt đầu ngay") */
  begin(now: number): SessionEvent[] {
    if (this.phase !== 'LOCATING') return []
    this.phase = 'RUNNING'
    this.startedAt = now; this.lastTick = now; this.lastMoveAt = now
    this.log(now, 'start')
    return [{ type: 'START' }]
  }

  /** Một điểm vị trí mới; `now` = giờ nhận trên máy (giờ GPS một số máy lệch) */
  fix(f: FixInput, now: number): SessionEvent[] {
    const ev: SessionEvent[] = []
    this.lastFixAt = now
    this.gpsLost = false
    if (this.phase === 'LOCATING') {
      this.warm = [...this.warm.slice(-4), { accuracy: f.accuracy, time: now }]
      if (gpsReady(this.warm, now)) ev.push(...this.begin(now))
    }
    if (this.phase !== 'RUNNING') return ev
    this.q.fixes++
    this.q.accSum += f.accuracy
    this.q.accMax = Math.max(this.q.accMax, f.accuracy)

    const r = this.engine.push({
      latitude: f.latitude, longitude: f.longitude, accuracy: f.accuracy, altitude: f.altitude, speed: f.speed,
      recorded_at: new Date(f.time).toISOString(),
    })
    if (r.gap) { ev.push({ type: 'GAP', gap: r.gap }); this.log(now, 'gap') }
    if (!r.point) {
      const why = r.reason as Reject | undefined
      if (why) this.q.rejected[why] = (this.q.rejected[why] ?? 0) + 1
      return ev
    }
    this.q.accepted++
    // Mỗi điểm mang quãng đường tích luỹ app đo (máy chủ dùng số này, kẹp theo tuyến — migration 006600)
    this.points.push(compactPoint({ ...r.point, distance_m: this.distanceM + r.distance }))
    if (r.distance === 0 && !r.gap) return ev      // điểm đầu đoạn
    this.movingS += r.moving
    this.lastAcceptAt = now
    if (r.distance > 0 && (r.moving === 0 || r.distance / Math.max(r.moving, 1) > GPS.AUTO_PAUSE_MPS)) {
      this.advance(now)
      this.lastMoveAt = now
      this.elapsedAtMove = this.elapsedS
      this.moved = true
      this.longStop = false
      if (this.autoPaused) { this.autoPaused = false; ev.push({ type: 'AUTO_RESUME' }); this.log(now, 'auto_resume') }
    }
    const prev = this.distanceM
    this.distanceM += r.distance
    this.shownS = movingClock(this.shownS, this.movingS, 0, false)
    this.currentPace = rollingPace(this.points)
    // Qua đoạn mất tín hiệu có thể vượt nhiều mốc km cùng lúc → ghi đủ từng km
    for (let s = nextSplit(prev, this.distanceM, this.movingS, this.splits); s; s = nextSplit(prev, this.distanceM, this.movingS, this.splits)) {
      this.splits = [...this.splits, s]
      ev.push({ type: 'SPLIT', split: s, movingS: this.movingS })
    }
    return ev
  }

  /** Mỗi giây: đồng hồ, tự tạm dừng, mất GPS, đứng nghỉ quá lâu */
  tick(now: number): SessionEvent[] {
    if (this.phase !== 'RUNNING') return []
    const ev: SessionEvent[] = []
    this.advance(now)
    const still = this.idleS(now)
    // Chưa di chuyển lần nào → "chờ bạn chạy", chưa phải tự tạm dừng
    const idle = !this.moved || still > this.rules.autoPauseAfterS
    if (this.moved && idle && !this.autoPaused) {
      this.autoPaused = true; this.q.autoPauses++
      ev.push({ type: 'AUTO_PAUSE' }); this.log(now, 'auto_pause')
    }
    this.gpsLost = this.lastFixAt > 0 && now - this.lastFixAt > LOST_AFTER_MS
    this.shownS = movingClock(this.shownS, this.movingS, this.lastAcceptAt ? (now - this.lastAcceptAt) / 1000 : -1, idle)
    this.currentPace = idle ? 0 : rollingPace(this.points, 30, now)
    if (still >= this.rules.askS && !this.longStop && !this.autoStopped) {
      this.longStop = true; this.q.longStops++
      ev.push({ type: 'LONG_STOP', minutes: Math.floor(still / 60) }); this.log(now, 'long_stop')
    }
    if (still >= this.rules.autoStopS) {
      this.pause(now)
      this.autoStopped = true; this.q.autoStopped++; this.q.pauses--
      ev.push({ type: 'AUTO_STOPPED', minutes: Math.floor(still / 60) }); this.log(now, 'auto_stop')
    }
    return ev
  }

  /** Người chạy bấm "Vẫn đang nghỉ" ở câu hỏi kết thúc */
  dismissLongStop() { this.longStop = false }

  pause(now: number) {
    if (this.phase !== 'RUNNING') return
    this.advance(now)
    this.phase = 'PAUSED'
    this.lastTick = null
    this.q.pauses++
    this.log(now, 'pause')
  }

  resume(now: number) {
    if (this.phase !== 'PAUSED') return
    this.engine.breakSegment()          // không nối đoạn GPS qua quãng tạm dừng
    this.phase = 'RUNNING'
    this.lastTick = now; this.lastMoveAt = now; this.lastAcceptAt = 0
    this.elapsedAtMove = this.elapsedS
    this.autoPaused = false; this.longStop = false; this.autoStopped = false
    this.log(now, 'resume')
  }

  /** Kết thúc; đứng yên từ 2 phút ở cuối bài thì bỏ phần đó (giờ kết thúc = lúc dừng chạy) */
  finish(now: number) {
    if (this.phase === 'FINISHED' || this.phase === 'LOCATING') return
    this.advance(now)
    this.phase = 'FINISHED'
    this.lastTick = null
    const tail = this.elapsedS - this.elapsedAtMove
    this.endedAt = now
    if (this.moved && tail >= this.rules.trimS) {
      this.q.trimmedS += Math.round(tail)
      this.elapsedS = this.elapsedAtMove
      const lastPoint = this.points.length ? Date.parse(this.points[this.points.length - 1].recorded_at) : 0
      this.endedAt = Math.max(this.lastMoveAt, lastPoint, this.startedAt + 1000)
    }
    this.shownS = this.movingS
    this.autoPaused = false; this.longStop = false
    this.log(now, 'finish')
  }

  /** App bị ẩn / hiện lại (tắt màn hình, chuyển app) — chỉ để thống kê chất lượng */
  hidden(now: number) { if (this.hiddenAt === null && this.phase !== 'FINISHED') { this.hiddenAt = now; this.q.hidden++; this.log(now, 'hidden') } }
  visible(now: number) {
    if (this.hiddenAt === null) return
    this.q.hiddenS += Math.round((now - this.hiddenAt) / 1000)
    this.hiddenAt = null
    this.log(now, 'visible')
  }

  snapshot(): SessionState | null {
    if (this.phase === 'LOCATING' || !this.startedAt) return null
    return {
      phase: this.phase, startedAt: this.startedAt, endedAt: this.endedAt, elapsedS: this.elapsedS, movingS: this.movingS,
      distanceM: this.distanceM, splits: this.splits, gaps: this.engine.gaps, moved: this.moved, elapsedAtMove: this.elapsedAtMove, q: this.q,
    }
  }

  /** Khôi phục bài dở dang: đang chạy → về Tạm dừng (bấm Tiếp tục để chạy tiếp) */
  static restore(s: SessionState, points: TrackPoint[], now: number, rules: Partial<TrackingRules> = {}): RunSession {
    const x = new RunSession(rules)
    x.phase = s.phase === 'FINISHED' ? 'FINISHED' : 'PAUSED'
    x.startedAt = s.startedAt; x.endedAt = s.endedAt
    x.elapsedS = s.elapsedS; x.movingS = s.movingS; x.shownS = s.movingS; x.distanceM = s.distanceM
    x.splits = s.splits ?? []; x.points = points
    x.moved = s.moved ?? s.distanceM > 0
    x.elapsedAtMove = s.elapsedAtMove ?? s.elapsedS
    x.engine.gaps = s.gaps ?? []
    x.q = { ...emptyQ(), ...(s.q ?? {}) }
    x.log(now, 'restore')
    return x
  }

  payload(now: number): RunPayload {
    return buildPayload({
      startedAt: this.startedAt || now, endedAt: this.endedAt ?? now, elapsedS: Math.max(this.elapsedS, this.movingS),
      movingS: this.movingS, distanceM: this.distanceM, points: this.points,
    })
  }

  /** Tóm tắt chất lượng GPS gửi kèm bài chạy (~0,5–2 KB): phục vụ kiểm thử thực địa, hỗ trợ runner, chống gian lận */
  quality(extra: Record<string, unknown> = {}) {
    const q = this.q
    return {
      v: 1,
      fixes: q.fixes, accepted: q.accepted, rejected: q.rejected,
      acc_avg: q.fixes ? Math.round((q.accSum / q.fixes) * 10) / 10 : null, acc_max: Math.round(q.accMax * 10) / 10,
      gaps: this.engine.gaps.length, gap_s: this.gapS, gap_counted: this.engine.gaps.filter((g) => g.counted).length,
      pauses: q.pauses, auto_pauses: q.autoPauses, long_stops: q.longStops, auto_stopped: q.autoStopped,
      hidden: q.hidden, hidden_s: q.hiddenS, trimmed_s: q.trimmedS,
      elapsed_s: Math.round(this.elapsedS), moving_s: Math.round(this.movingS), distance_m: Math.round(this.distanceM),
      good_acc_m: ENGINE.GOOD_ACCURACY_M,
      log: q.log,
      ...extra,
    }
  }
}

export type GpsQuality = ReturnType<RunSession['quality']>
