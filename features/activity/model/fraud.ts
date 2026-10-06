// Phát hiện gian lận bài chạy (hàm thuần, không gọi mạng) — dùng cho bài đồng bộ từ Strava.
// Dựa trên bộ quy tắc RaceHub trước đây (Apps Script), sửa các điểm dễ báo nhầm:
//  - Tốc độ tính theo quãng đường trong cửa sổ trượt 30 s (không dùng từng điểm velocity_smooth, hay bị nhảy)
//  - Nhịp tim: bỏ 10 phút đầu (tim chưa lên), bỏ dữ liệu HR rơi/đứng im, phải kéo dài ≥ 3 phút
//  - Sải chân: phải kéo dài đủ thời gian (bản cũ khai báo minDurationSec nhưng không dùng)
//  - Thêm: điểm GPS "dịch chuyển tức thời", đoạn chạy ≥ 25 km/h kiểu xe máy / xe đạp
//  - Cú nhảy GPS ngắn (≤ 10 s) bị bỏ khỏi quãng đường trước khi tính tốc độ — một điểm nhảy 70 km/h không làm cả bài thành "đi xe"
//  - Đường cong pace theo thời gian: tốc độ TB tốt nhất trong mỗi cửa sổ 1 phút … 2 giờ so với kỷ lục thế giới cùng thời lượng
// Kết luận chỉ là OK hoặc REVIEW (chờ ban quản trị duyệt) — không tự động từ chối người thật.

export interface FraudStreams {
  time: number[]                         // giây từ lúc bắt đầu
  distance: number[]                     // mét, cộng dồn
  latlng?: [number, number][] | null
  heartrate?: number[] | null
  cadence?: number[] | null              // bước/phút của MỘT chân (kiểu Strava) — sẽ nhân đôi
}

export interface FraudSummary {
  sportType?: string | null
  manual?: boolean | null
  trainer?: boolean | null
  deviceName?: string | null
  distanceM: number
  movingS: number
  maxSpeedMps?: number | null
}

export type FraudCode = 'MANUAL' | 'TREADMILL' | 'SUSTAINED_SPEED' | 'VEHICLE_BURST' | 'GPS_TELEPORT' | 'STRIDE' | 'HR_PACE' | 'HISTORY' | 'PACE_CURVE' | 'GPS_DISTANCE_GAIN'

/**
 * Mức của một dấu hiệu (tách bạch "cảnh báo" và "đủ căn cứ loại"):
 *  NOTE        – chỉ ghi lại, không ảnh hưởng kết luận
 *  WARN        – cảnh báo; một mình KHÔNG giữ bài, cần ≥ 2 cảnh báo độc lập
 *  SUSPECT     – nghi vấn; đủ để chuyển người duyệt xem
 *  DISQUALIFY  – đủ căn cứ loại (vượt giới hạn thể chất con người); người duyệt vẫn là người quyết định cuối
 */
export type FraudTier = 'NOTE' | 'WARN' | 'SUSPECT' | 'DISQUALIFY'
/** Nguồn dữ liệu sinh ra dấu hiệu — để biết hai dấu hiệu có thật sự độc lập không */
export type FraudSource = 'GPS' | 'GPS+CADENCE' | 'GPS+HR' | 'DEVICE' | 'HISTORY'

export interface FraudFlag {
  code: FraudCode
  severity: 'SEVERE' | 'HIGH' | 'INFO'
  score: number                          // 0–100 cho riêng quy tắc
  message: string
  atS?: number                           // bắt đầu đoạn nghi vấn (giây)
  durationS?: number
  tier?: FraudTier
  source?: FraudSource
  /** Số đo + ngưỡng đã dùng — để người duyệt / admin kiểm tra lại được */
  evidence?: Record<string, number | string | boolean | null>
  /** Trùng thời điểm với một lỗi GPS (nhảy điểm / mất tín hiệu) → có thể cùng một nguyên nhân, đã hạ mức */
  gpsError?: boolean
}

export interface FraudResult {
  score: number                          // 0–100 tổng hợp (chỉ để hiển thị / sắp xếp)
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  verdict: 'OK' | 'REVIEW'
  flags: FraudFlag[]
  reason: string | null                  // câu ngắn gửi lên máy chủ / hiện cho người chạy
  /** Mức cao nhất trong các bằng chứng độc lập; DISQUALIFY = đủ căn cứ loại */
  basis: FraudTier | null
  /** Số nhóm bằng chứng độc lập (các dấu hiệu cùng một lỗi GPS / cùng thời điểm tính là một) */
  independent: number
  engine: string
  /** Quãng đường (m) nếu bỏ cú nhảy GPS — CHỈ để tham khảo khi duyệt, không thay km của đối tác; null nếu không có streams */
  cleanDistanceM: number | null
}

/** Phiên bản bộ quy tắc — lưu kèm mỗi kết quả để biết bài được xét bằng luật nào */
export const FRAUD_ENGINE_VERSION = 'ac-2026.10.4'

export const FRAUD_CONFIG = {
  windowS: 30,
  sustained: { normal: { kmh: 17, s: 180 }, severe: { kmh: 20, s: 120 } },
  vehicle: { kmh: 25, s: 30 },
  teleport: { mps: 12, minCount: 3 },
  stride: { windowS: 90, minS: 90, suspiciousM: 1.8, severeM: 2.1, minSpm: 120, minMps: 2 },
  hr: {
    skipFirstS: 600, windowS: 90, minS: 180, minCoverage: 0.8,
    // pace (phút/km) nhanh hơn hoặc bằng → nhịp tim tối thiểu hợp lý
    table: [{ pace: 5.0, minHr: 115 }, { pace: 4.5, minHr: 125 }, { pace: 4.0, minHr: 135 }, { pace: 3.5, minHr: 145 }],
  },
  history: { minSamples: 10, z: 3, zCritical: 5 },
  // Lỗi GPS: khoảng không có điểm dài hơn gapS giây; dấu hiệu cách lỗi GPS ≤ padS giây coi như cùng nguyên nhân
  gpsError: { gapS: 30, padS: 30 },
  // Cú nhảy GPS: chuỗi điểm liên tiếp nhanh hơn ngưỡng "nhảy" nhưng tổng thời gian ≤ maxS giây → bỏ quãng đó
  spike: { maxS: 10, contextS: 30, contextRatio: 0.5 },
  // Cú nhảy GPS: KHÔNG sửa km của đối tác (Strava…), chỉ dùng để phân loại. Nhảy nhỏ rồi quay về = bình thường (ghi chú).
  // MỘT cú dịch chuyển ≥ jumpM mét trong ≤ spike.maxS giây (≥ 360 km/h) không thể là chạy / sóng yếu thông thường → nghi vấn, chờ duyệt.
  gain: { jumpM: 1000 },
  // Tốc độ TB tối đa con người giữ được theo thời lượng (≈ kỷ lục thế giới nam: 400 m, 800 m, 1500 m, 5 km, 10 km, bán marathon,
  // marathon) + 5% sai số GPS. Vượt mức này trong cả một cửa sổ dài = không thể là chạy bộ.
  curve: { tolerance: 1.05, points: [
    { s: 60, mps: 8.6 }, { s: 120, mps: 7.9 }, { s: 300, mps: 7.0 }, { s: 600, mps: 6.8 },
    { s: 1200, mps: 6.5 }, { s: 3600, mps: 6.1 }, { s: 7200, mps: 5.85 },
  ] },
  weights: { GPS_DISTANCE_GAIN: 15, PACE_CURVE: 40, SUSTAINED_SPEED: 35, VEHICLE_BURST: 35, GPS_TELEPORT: 20, STRIDE: 30, HR_PACE: 25, HISTORY: 10 } as Record<string, number>,
  levels: { medium: 35, high: 65, critical: 85 },
}

export interface FraudRule {
  label: string
  /** Vì sao quy tắc này phát hiện được gian lận */
  reason: string
  /** Dữ liệu đầu vào cụ thể */
  inputs: string
  source: FraudSource
  /** Ngưỡng cảnh báo / nghi vấn (chuyển người duyệt) / đủ căn cứ loại — mô tả cho người đọc */
  warn: string | null
  suspect: string | null
  disqualify: string | null
  /** Những tình huống thật có thể chạm ngưỡng — người duyệt cần loại trừ */
  falsePositives: string
}

/** Danh mục quy tắc — nguồn duy nhất cho tài liệu, màn hình duyệt và kiểm thử (docs/CHONG_GIAN_LAN.md) */
export const FRAUD_RULES: Record<FraudCode, FraudRule> = {
  PACE_CURVE: {
    label: 'Nhanh hơn kỷ lục thế giới', source: 'GPS',
    reason: 'Tốc độ TB tốt nhất trong mỗi khoảng 1 phút … 2 giờ vượt kỷ lục thế giới nam cùng thời lượng (+5% sai số GPS) — không con người nào chạy được.',
    inputs: 'Streams time + distance (đã bỏ cú nhảy GPS ≤ 10 giây)',
    warn: null, suspect: 'Khi đoạn vượt ngưỡng trùng thời điểm lỗi GPS (hạ một mức)',
    disqualify: '1 phút > 8,6 m/s · 2 phút > 7,9 · 5 phút > 7,0 · 10 phút > 6,8 · 20 phút > 6,5 · 1 giờ > 6,1 · 2 giờ > 5,85 (×1,05)',
    falsePositives: 'GPS trôi kéo dài > 10 giây (nhà cao tầng, hầm) — đã hạ mức khi trùng vùng lỗi GPS',
  },
  SUSTAINED_SPEED: {
    label: 'Giữ tốc độ cao lâu', source: 'GPS',
    reason: 'Giữ pace rất nhanh liên tục nhiều phút — hiếm ở người chạy phong trào, thường gặp khi đi xe đạp / xe điện chậm.',
    inputs: 'Tốc độ cửa sổ trượt 30 giây trên quãng đường đã bỏ cú nhảy GPS; ngưỡng do admin đặt (Chính sách vận hành)',
    warn: '≥ 17 km/h (3:32/km) liên tục ≥ 3 phút', suspect: '≥ 20 km/h (3:00/km) liên tục ≥ 2 phút', disqualify: null,
    falsePositives: 'VĐV phong trào mạnh chạy biến tốc / đổ dốc dài',
  },
  VEHICLE_BURST: {
    label: 'Giống đi xe', source: 'GPS',
    reason: 'Đoạn ngắn có tốc độ của xe máy / xe đạp.',
    inputs: 'Tốc độ cửa sổ trượt 30 giây; không có streams thì chỉ có "vận tốc tối đa" một điểm (chỉ ghi chú)',
    warn: null, suspect: '≥ 25 km/h liên tục ≥ 30 giây', disqualify: null,
    falsePositives: 'Nước rút 200 m của người rất nhanh; GPS trôi kéo dài',
  },
  GPS_TELEPORT: {
    label: 'GPS nhảy', source: 'GPS',
    reason: 'Vị trí nhảy xa trong 1 lượt ghi — có thể do sóng yếu, cũng có thể do chỉnh sửa tuyến.',
    inputs: 'Streams latlng + time: đoạn > 50 m với tốc độ tức thời > ngưỡng "nhảy" (mặc định 43 km/h)',
    warn: '≥ 3 lần nhảy', suspect: null, disqualify: null,
    falsePositives: 'Rất hay gặp ở đô thị — một mình không bao giờ giữ bài',
  },
  GPS_DISTANCE_GAIN: {
    label: 'Vị trí dịch chuyển', source: 'GPS',
    reason: 'GPS lạc vài chục–vài trăm mét rồi quay về là BÌNH THƯỜNG (chỉ ghi chú). Một lần vị trí "dịch chuyển" ≥ 1 km trong vài giây (≥ 360 km/h) rồi chạy tiếp từ chỗ mới thì không thể do chạy hay sóng yếu thông thường — có thể do sửa / ghép file tuyến, app giả vị trí hoặc GPS lỗi nặng. Km của đối tác KHÔNG bị sửa; từ lần chỉnh sửa 6 chỉ là cảnh báo, bài có GPS vẫn được ghi nhận.',
    inputs: 'Streams time + distance: chuỗi điểm nhanh hơn ngưỡng "nhảy" kéo dài ≤ 10 giây, xung quanh 30 giây đang ở tốc độ chạy bộ; đo từng cú nhảy riêng',
    warn: 'Một cú dịch chuyển ≥ 1 km', suspect: null, disqualify: null,
    falsePositives: 'Đồng hồ bắt GPS sai lúc mới bật / ra khỏi hầm dài — người duyệt xem bản đồ để quyết định',
  },
  STRIDE: {
    label: 'Sải chân', source: 'GPS+CADENCE',
    reason: 'Quãng đường / số bước ra sải chân dài bất thường — đang di chuyển nhưng không phải bằng bước chạy.',
    inputs: 'Streams distance + cadence (đồng hồ / cảm biến) trong cửa sổ 90 giây, bỏ đoạn đi bộ / đứng',
    warn: 'Sải > 1,8 m liên tục ≥ 90 giây', suspect: 'Sải > 2,1 m liên tục ≥ 90 giây', disqualify: null,
    falsePositives: 'Cảm biến cadence lỗi; quãng đường GPS bị phóng đại',
  },
  HR_PACE: {
    label: 'Tim thấp / pace nhanh', source: 'GPS+HR',
    reason: 'Pace nhanh nhưng nhịp tim quá thấp — thiết bị không đi cùng người đang gắng sức.',
    inputs: 'Streams heartrate + distance, bỏ 10 phút đầu, bỏ dữ liệu tim đứng im, cửa sổ 90 giây',
    warn: 'Kéo dài 3–5 phút', suspect: 'Kéo dài ≥ 5 phút', disqualify: null,
    falsePositives: 'Dây đeo tim lỏng / mất tiếp xúc; người tập rất lâu năm có nhịp tim thấp',
  },
  HISTORY: {
    label: 'Khác thường ngày', source: 'HISTORY',
    reason: 'Pace TB nhanh hơn hẳn các bài trước của chính người đó.',
    inputs: 'Pace 30 bài hợp lệ gần nhất (≥ 2 km), cần ≥ 10 bài',
    warn: 'Nhanh hơn ≥ 5 lần độ lệch chuẩn', suspect: null, disqualify: null,
    falsePositives: 'Người mới tiến bộ nhanh; bài thi đấu',
  },
  MANUAL: {
    label: 'Nhập tay', source: 'DEVICE',
    reason: 'Không có dữ liệu thiết bị để xác minh.', inputs: 'Cờ manual của Strava',
    warn: null, suspect: 'Luôn chuyển người duyệt', disqualify: null, falsePositives: 'Bài thật nhưng quên bật đồng hồ',
  },
  TREADMILL: {
    label: 'Chạy máy', source: 'DEVICE',
    reason: 'Không có tuyến GPS để đối chiếu quãng đường.', inputs: 'trainer / VirtualRun / tên thiết bị',
    warn: null, suspect: 'Luôn chuyển người duyệt', disqualify: null, falsePositives: 'Chạy máy thật — người duyệt quyết định',
  },
}

/** Ngưỡng tốc độ dùng chung với máy chủ (ops_policy.antiCheat, 009100) — admin đổi được, không cần sửa code */
export interface SpeedRules {
  sustained: { normal: { kmh: number; s: number }; severe: { kmh: number; s: number } }
  vehicle: { kmh: number; s: number }
  teleport: { mps: number; minCount: number }
}
const DEFAULT_SPEED: SpeedRules = { sustained: FRAUD_CONFIG.sustained, vehicle: FRAUD_CONFIG.vehicle, teleport: FRAUD_CONFIG.teleport }

/** Ngưỡng chống gian lận của Chính sách vận hành → luật tốc độ phân tích bài Strava */
export function speedRulesFrom(ac: { highKmh: number; highS: number; severeKmh: number; severeS: number; vehicleKmh: number; vehicleS: number; spikeKmh: number; spikeMax: number } | null | undefined): SpeedRules {
  if (!ac) return DEFAULT_SPEED
  return {
    sustained: { normal: { kmh: ac.highKmh, s: ac.highS }, severe: { kmh: ac.severeKmh, s: ac.severeS } },
    vehicle: { kmh: ac.vehicleKmh, s: ac.vehicleS },
    teleport: { mps: ac.spikeKmh / 3.6, minCount: ac.spikeMax },
  }
}

const kmhToPace = (kmh: number) => {
  const s = Math.round(3600 / kmh)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const mmss = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} phút${s % 60 ? ` ${Math.round(s % 60)} giây` : ''}` : `${Math.round(s)} giây`)

function haversine(a: [number, number], b: [number, number]) {
  const R = 6371000, rad = Math.PI / 180
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))))
}

/** Tốc độ (m/s) tại mỗi điểm = quãng đường trong cửa sổ ~30 s kết thúc tại điểm đó. NaN nếu cửa sổ quá ngắn. */
export function windowSpeeds(time: number[], distance: number[], windowS = FRAUD_CONFIG.windowS): number[] {
  const out = new Array<number>(time.length).fill(NaN)
  let j = 0
  for (let i = 1; i < time.length; i++) {
    while (j < i && time[i] - time[j] > windowS) j++
    const dt = time[i] - time[j]
    if (dt >= windowS / 2) out[i] = Math.max(0, distance[i] - distance[j]) / dt
  }
  return out
}

/**
 * Quãng đường cộng dồn sau khi bỏ cú nhảy GPS: chuỗi điểm liên tiếp có tốc độ tức thời > `maxMps` mà tổng thời gian
 * ≤ `maxS` giây (điểm lạc rồi quay về). Đoạn nhanh kéo dài hơn (đi xe thật) được GIỮ NGUYÊN để các luật tốc độ bắt được.
 */
export function despike(time: number[], distance: number[], maxMps: number, maxS = FRAUD_CONFIG.spike.maxS): number[] {
  const n = Math.min(time.length, distance.length)
  const fast = new Array<boolean>(n).fill(false)
  for (let i = 1; i < n; i++) {
    const dt = time[i] - time[i - 1], dd = distance[i] - distance[i - 1]
    fast[i] = dd > 0 && (dt <= 0 || dd / dt > maxMps)
  }
  // Tốc độ TB trong `ctxS` giây ngay trước / sau một đoạn — chỉ tính các bước KHÔNG nhảy (2 cú nhảy sát nhau không che nhau)
  const ctxS = FRAUD_CONFIG.spike.contextS
  const around = (i: number, j: number) => {
    let m = 0, s = 0
    for (let k = i - 1; k >= 1 && time[i - 1] - time[k - 1] <= ctxS; k--) if (!fast[k]) { m += distance[k] - distance[k - 1]; s += time[k] - time[k - 1] }
    for (let k = j + 1; k < n && time[k] - time[j] <= ctxS; k++) if (!fast[k]) { m += distance[k] - distance[k - 1]; s += time[k] - time[k - 1] }
    return s > 0 ? m / s : 0
  }
  const drop = new Array<boolean>(n).fill(false)
  for (let i = 1; i < n; i++) {
    if (!fast[i] || fast[i - 1]) continue
    let j = i
    while (j + 1 < n && fast[j + 1]) j++
    // Chỉ là "cú nhảy" khi ngắn VÀ xung quanh đang ở tốc độ chạy bộ; xe chạy quanh ngưỡng (xung quanh cũng nhanh) thì giữ
    if (time[j] - time[i - 1] <= maxS && around(i, j) < maxMps * FRAUD_CONFIG.spike.contextRatio) for (let k = i; k <= j; k++) drop[k] = true
  }
  const out = new Array<number>(n)
  let acc = 0
  out[0] = distance[0] ?? 0
  for (let i = 1; i < n; i++) { if (!drop[i]) acc += Math.max(0, distance[i] - distance[i - 1]); out[i] = (distance[0] ?? 0) + acc }
  return out
}

/** Tốc độ TB tốt nhất (m/s) trên mọi cửa sổ dài ≥ `windowS` giây — "đường cong pace" của bài chạy */
export function bestWindowSpeed(time: number[], distance: number[], windowS: number): { mps: number; atS: number } {
  let best = 0, at = 0, j = 0
  for (let i = 0; i < time.length; i++) {
    if (j < i) j = i
    while (j < time.length && time[j] - time[i] < windowS) j++
    if (j >= time.length) break
    const v = (distance[j] - distance[i]) / (time[j] - time[i])
    if (v > best) { best = v; at = time[i] }
  }
  return { mps: best, atS: at }
}

/** Đoạn liên tục dài nhất có tốc độ ≥ ngưỡng: [thời lượng giây, giây bắt đầu] */
export function longestRun(time: number[], speed: number[], minMps: number): [number, number] {
  let best = 0, bestAt = 0, start = -1
  for (let i = 0; i <= speed.length; i++) {
    const ok = i < speed.length && speed[i] >= minMps
    if (ok && start < 0) start = i
    if (!ok && start >= 0) {
      const d = time[i - 1] - time[start]
      if (d > best) { best = d; bestAt = time[start] }
      start = -1
    }
  }
  return [best, bestAt]
}

function ruleSummary(s: FraudSummary): FraudFlag[] {
  const out: FraudFlag[] = []
  if (s.manual) out.push({ code: 'MANUAL', severity: 'SEVERE', score: 100, evidence: { manual: true }, message: 'Bài nhập tay, không có dữ liệu thiết bị' })
  const dev = (s.deviceName ?? '').toLowerCase()
  if (s.trainer || s.sportType === 'VirtualRun' || /treadmill|zwift|virtual/.test(dev)) {
    out.push({ code: 'TREADMILL', severity: 'SEVERE', score: 80, evidence: { trainer: !!s.trainer, sportType: s.sportType ?? null, device: s.deviceName ?? null }, message: 'Chạy máy / chạy ảo — không có tuyến GPS để đối chiếu' })
  }
  return out
}

function ruleSpeed(t: number[], v: number[], c: SpeedRules): FraudFlag[] {
  const out: FraudFlag[] = []
  const [sev, sevAt] = longestRun(t, v, c.sustained.severe.kmh / 3.6)
  const [nor, norAt] = longestRun(t, v, c.sustained.normal.kmh / 3.6)
  if (sev >= c.sustained.severe.s) {
    out.push({ code: 'SUSTAINED_SPEED', severity: 'SEVERE', score: 100, atS: sevAt, durationS: sev,
      evidence: { thresholdKmh: c.sustained.severe.kmh, minS: c.sustained.severe.s, measuredS: Math.round(sev) },
      message: `Giữ pace ${kmhToPace(c.sustained.severe.kmh)}/km hoặc nhanh hơn liên tục ${mmss(sev)}` })
  } else if (nor >= c.sustained.normal.s) {
    out.push({ code: 'SUSTAINED_SPEED', severity: 'HIGH', score: 80, atS: norAt, durationS: nor,
      evidence: { thresholdKmh: c.sustained.normal.kmh, minS: c.sustained.normal.s, measuredS: Math.round(nor) },
      message: `Giữ pace ${kmhToPace(c.sustained.normal.kmh)}/km hoặc nhanh hơn liên tục ${mmss(nor)}` })
  }
  const [veh, vehAt] = longestRun(t, v, c.vehicle.kmh / 3.6)
  if (veh >= c.vehicle.s) {
    out.push({ code: 'VEHICLE_BURST', severity: 'SEVERE', score: 100, atS: vehAt, durationS: veh,
      evidence: { thresholdKmh: c.vehicle.kmh, minS: c.vehicle.s, measuredS: Math.round(veh) },
      message: `Di chuyển ≥ ${c.vehicle.kmh} km/h trong ${mmss(veh)} — giống đi xe` })
  }
  return out
}

function ruleCurve(t: number[], d: number[]): FraudFlag[] {
  const c = FRAUD_CONFIG.curve
  const total = t[t.length - 1] - t[0]
  let worst: { ratio: number; s: number; mps: number; atS: number } | null = null
  for (const p of c.points) {
    if (total < p.s) break
    const b = bestWindowSpeed(t, d, p.s)
    const ratio = b.mps / (p.mps * c.tolerance)
    if (ratio > 1 && (!worst || ratio > worst.ratio)) worst = { ratio, s: p.s, mps: b.mps, atS: b.atS }
  }
  if (!worst) return []
  return [{ code: 'PACE_CURVE', severity: 'SEVERE', score: 100, atS: worst.atS, durationS: worst.s,
    evidence: { windowS: worst.s, measuredMps: +worst.mps.toFixed(2), limitMps: +(worst.mps / worst.ratio).toFixed(2) },
    message: `Pace TB ${kmhToPace(worst.mps * 3.6)}/km suốt ${mmss(worst.s)} — nhanh hơn kỷ lục thế giới cùng thời lượng` }]
}

function ruleTeleport(t: number[], ll: [number, number][] | null | undefined, c: SpeedRules): FraudFlag[] {
  if (!ll || ll.length < 2) return []
  let n = 0, first = -1
  for (let i = 1; i < Math.min(t.length, ll.length); i++) {
    const dt = t[i] - t[i - 1]
    if (dt <= 0 || !ll[i] || !ll[i - 1]) continue
    const d = haversine(ll[i - 1], ll[i])
    if (d > 50 && d / dt > c.teleport.mps) { n++; if (first < 0) first = t[i] }
  }
  return n >= c.teleport.minCount
    ? [{ code: 'GPS_TELEPORT', severity: 'HIGH', score: Math.min(100, 50 + n * 10), atS: first,
        evidence: { jumps: n, minJumps: c.teleport.minCount, thresholdKmh: Math.round(c.teleport.mps * 3.6), points: ll.length }, message: `${n} lần vị trí nhảy xa bất thường (> ${Math.round(c.teleport.mps * 3.6)} km/h)` }]
    : []
}

/** Các cửa sổ trượt dài `windowS`; trả về chỉ số [đầu, cuối] */
function* windows(t: number[], windowS: number): Generator<[number, number]> {
  let j = 0
  for (let i = 0; i < t.length; i++) {
    while (j < t.length && t[j] - t[i] < windowS) j++
    if (j >= t.length) return
    yield [i, j]
  }
}

function ruleStride(t: number[], d: number[], cad: number[] | null | undefined): FraudFlag[] {
  const c = FRAUD_CONFIG.stride
  if (!cad || cad.length !== t.length || !cad.some((x) => x > 0)) return []
  // Sải chân (m) mỗi cửa sổ = quãng đường / số bước; bỏ cửa sổ đi bộ / đứng (ít bước hoặc chậm)
  const stride = new Array<number>(t.length).fill(NaN)
  for (const [a, b] of windows(t, c.windowS)) {
    const dt = t[b] - t[a]
    let steps = 0, cover = 0
    for (let k = a + 1; k <= b; k++) {
      const spm = (cad[k] ?? 0) * 2
      if (spm >= c.minSpm) { steps += (spm / 60) * (t[k] - t[k - 1]); cover += t[k] - t[k - 1] }
    }
    const mps = (d[b] - d[a]) / dt
    if (cover < dt * 0.8 || mps < c.minMps || steps <= 0) continue
    stride[a] = (d[b] - d[a]) / steps
  }
  const [sev, sevAt] = longestRun(t, stride, c.severeM)
  const [sus, susAt] = longestRun(t, stride, c.suspiciousM)
  if (sev >= c.minS) return [{ code: 'STRIDE', severity: 'SEVERE', score: 100, atS: sevAt, durationS: sev, evidence: { thresholdM: c.severeM, measuredS: Math.round(sev) }, message: `Sải chân > ${c.severeM} m liên tục ${mmss(sev)} — không phải bước chạy` }]
  if (sus >= c.minS) return [{ code: 'STRIDE', severity: 'HIGH', score: 90, atS: susAt, durationS: sus, evidence: { thresholdM: c.suspiciousM, measuredS: Math.round(sus) }, message: `Sải chân > ${c.suspiciousM} m liên tục ${mmss(sus)}` }]
  return []
}

function ruleHr(t: number[], d: number[], hr: number[] | null | undefined): FraudFlag[] {
  const c = FRAUD_CONFIG.hr
  if (!hr || hr.length !== t.length) return []
  const flagged = new Array<number>(t.length).fill(NaN)
  let worst: { pace: number; hr: number; min: number } | null = null
  for (const [a, b] of windows(t, c.windowS)) {
    if (t[a] < c.skipFirstS) continue
    const vals = hr.slice(a, b + 1).filter((x) => x > 30 && x < 230)
    if (vals.length < (b - a + 1) * c.minCoverage) continue
    // HR đứng im tuyệt đối (cảm biến treo) → không dùng làm bằng chứng
    if (Math.max(...vals) - Math.min(...vals) < 1) continue
    const avgHr = vals.reduce((s, x) => s + x, 0) / vals.length
    const mps = (d[b] - d[a]) / (t[b] - t[a])
    if (mps <= 0) continue
    const pace = 1000 / mps / 60
    let min: number | null = null
    for (const r of c.table) if (pace <= r.pace) min = r.minHr
    if (min !== null && avgHr < min) {
      flagged[a] = 1
      if (!worst || pace < worst.pace) worst = { pace, hr: avgHr, min }
    }
  }
  const [dur, at] = longestRun(t, flagged, 1)
  if (dur < c.minS || !worst) return []
  const p = Math.round(worst.pace * 60)
  // ≥ 5 phút liên tục: gần như chắc chắn điện thoại/đồng hồ không đi cùng người đang chạy (xe, người khác cầm)
  return [{ code: 'HR_PACE', severity: dur >= 300 ? 'SEVERE' : 'HIGH', score: 90, atS: at, durationS: dur,
    evidence: { paceSPerKm: p, avgHr: Math.round(worst.hr), minHr: worst.min, measuredS: Math.round(dur) },
    message: `Pace ${Math.floor(p / 60)}:${String(p % 60).padStart(2, '0')}/km nhưng nhịp tim chỉ ${Math.round(worst.hr)} bpm (hợp lý ≥ ${worst.min}) trong ${mmss(dur)}` }]
}

/** So với lịch sử của chính người chạy: pace (giây/km) các bài gần đây */
function ruleHistory(s: FraudSummary, history: number[], cleanDistanceM?: number): FraudFlag[] {
  const c = FRAUD_CONFIG.history
  const h = history.filter((x) => Number.isFinite(x) && x > 0)
  if (h.length < c.minSamples || s.distanceM <= 0) return []
  // Dùng quãng đường đã bỏ cú nhảy GPS (nếu có streams) → không để lỗi GPS biến thành dấu hiệu "khác thường ngày"
  const dist = cleanDistanceM && cleanDistanceM > 0 ? Math.min(cleanDistanceM, s.distanceM) : s.distanceM
  const cur = s.movingS / (dist / 1000)
  const mean = h.reduce((a, x) => a + x, 0) / h.length
  const sd = Math.sqrt(h.reduce((a, x) => a + (x - mean) ** 2, 0) / h.length)
  if (!(sd > 0)) return []
  const z = (mean - cur) / sd
  if (z < c.z) return []
  return [{ code: 'HISTORY', severity: z >= c.zCritical ? 'HIGH' : 'INFO', score: z >= c.zCritical ? 100 : 80,
    evidence: { z: +z.toFixed(2), samples: h.length, paceSPerKm: Math.round(cur), meanSPerKm: Math.round(mean) },
    message: `Nhanh hơn thường ngày ${z.toFixed(1)} lần độ lệch chuẩn` }]
}

/** Vùng thời gian có lỗi GPS: cú nhảy đã bị bỏ, vị trí "dịch chuyển tức thời", khoảng mất dữ liệu dài */
export function gpsErrorRegions(t: number[], raw: number[], clean: number[], ll: [number, number][] | null | undefined, rules: SpeedRules): [number, number][] {
  const out: [number, number][] = []
  for (let i = 1; i < t.length; i++) {
    const dt = t[i] - t[i - 1]
    const dropped = (raw[i] - raw[i - 1]) - (clean[i] - clean[i - 1]) > 1
    const gap = dt > FRAUD_CONFIG.gpsError.gapS
    let jump = false
    if (ll && ll[i] && ll[i - 1] && dt > 0) { const m = haversine(ll[i - 1], ll[i]); jump = m > 50 && m / dt > rules.teleport.mps }
    if (dropped || gap || jump) out.push([t[i - 1], t[i]])
  }
  return out
}

const TIER_RANK: Record<FraudTier, number> = { NOTE: 0, WARN: 1, SUSPECT: 2, DISQUALIFY: 3 }
const DOWN: Record<FraudTier, FraudTier> = { NOTE: 'NOTE', WARN: 'NOTE', SUSPECT: 'WARN', DISQUALIFY: 'SUSPECT' }

/** Mức + nguồn mặc định của từng quy tắc (xem FRAUD_RULES) */
function classify(f: FraudFlag): FraudFlag {
  const r = FRAUD_RULES[f.code]
  const tier: FraudTier = f.tier ?? (f.code === 'PACE_CURVE' ? 'DISQUALIFY'
    : f.severity === 'SEVERE' ? 'SUSPECT' : f.severity === 'HIGH' ? 'WARN' : 'NOTE')
  return { ...f, tier, source: f.source ?? r.source }
}

export function analyzeRun(summary: FraudSummary, streams: FraudStreams | null, history: number[] = [], rules: SpeedRules = DEFAULT_SPEED): FraudResult {
  const raw: FraudFlag[] = [...ruleSummary(summary)]
  let regions: [number, number][] = []
  let cleanDistanceM: number | undefined
  if (streams && streams.time.length >= 2 && streams.distance.length === streams.time.length) {
    const { time: t } = streams
    // Bỏ cú nhảy GPS ngắn trước khi tính tốc độ (luật GPS_TELEPORT vẫn đếm các cú nhảy riêng)
    const d = despike(t, streams.distance, rules.teleport.mps)
    const v = windowSpeeds(t, d)
    regions = gpsErrorRegions(t, streams.distance, d, streams.latlng, rules)
    cleanDistanceM = d[d.length - 1] - d[0]
    const rawM = streams.distance[streams.distance.length - 1] - streams.distance[0]
    const gain = rawM - cleanDistanceM
    // Từng cú nhảy = chuỗi bước liên tiếp bị despike bỏ; cú lớn nhất cho biết "dịch chuyển" hay chỉ là GPS lạc rồi quay về
    let maxJumpM = 0, maxJumpAtS = 0, cur = 0, curAt = 0
    for (let i = 1; i < t.length; i++) {
      const cut = (streams.distance[i] - streams.distance[i - 1]) - (d[i] - d[i - 1])
      if (cut > 0) { if (cur === 0) curAt = t[i - 1] - t[0]; cur += cut } else cur = 0
      if (cur > maxJumpM) { maxJumpM = cur; maxJumpAtS = curAt }
    }
    if (gain >= 50) {
      const jump = maxJumpM >= FRAUD_CONFIG.gain.jumpM
      const ev = { addedM: Math.round(gain), maxJumpM: Math.round(maxJumpM), reportedStreamM: Math.round(rawM), withoutJumpsM: Math.round(cleanDistanceM) }
      // Chỉnh sửa lần 6 (Phụng quyết 06/10/2026): bài có GPS được ghi nhận dù GPS nhảy — cú dịch chuyển chỉ là CẢNH BÁO
      // (một mình không giữ bài); bằng chứng vẫn lưu để ban quản trị xem lại.
      raw.push(jump
        ? { code: 'GPS_DISTANCE_GAIN', severity: 'HIGH', score: 60, tier: 'WARN', atS: maxJumpAtS, evidence: ev,
            message: `Vị trí dịch chuyển ${Math.round(maxJumpM)} m trong vài giây (GPS nhảy hoặc đi tắt); km giữ nguyên, bài vẫn được ghi nhận` }
        : { code: 'GPS_DISTANCE_GAIN', severity: 'INFO', score: 20, tier: 'NOTE', evidence: ev,
            message: `GPS nhảy cộng thêm khoảng ${Math.round(gain)} m (bình thường, km giữ nguyên)` })
    }
    raw.push(...ruleCurve(t, d), ...ruleSpeed(t, v, rules), ...ruleTeleport(t, streams.latlng, rules), ...ruleStride(t, d, streams.cadence), ...ruleHr(t, d, streams.heartrate))
  } else if ((summary.maxSpeedMps ?? 0) > rules.teleport.mps) {
    // Không có streams: "vận tốc tối đa" là MỘT điểm (thường do GPS nhảy) → chỉ ghi chú, không tự chặn bài
    raw.push({ code: 'VEHICLE_BURST', severity: 'INFO', score: 40, tier: 'NOTE',
      evidence: { maxSpeedKmh: Math.round((summary.maxSpeedMps ?? 0) * 3.6), streams: false },
      message: `Vận tốc tối đa một điểm ${Math.round((summary.maxSpeedMps ?? 0) * 3.6)} km/h (có thể do GPS nhảy)` })
  }
  raw.push(...ruleHistory(summary, history, cleanDistanceM))

  // Dấu hiệu dựa trên GPS trùng thời điểm với lỗi GPS → có thể cùng một nguyên nhân: hạ một mức, gộp vào nhóm "lỗi GPS"
  const pad = FRAUD_CONFIG.gpsError.padS
  const flags = raw.map(classify).map((f) => {
    if (!f.source?.startsWith('GPS') || f.code === 'GPS_TELEPORT' || f.code === 'GPS_DISTANCE_GAIN' || f.atS == null) return f
    const a = f.atS - pad, b = f.atS + (f.durationS ?? 0) + pad
    const hit = regions.some(([x, y]) => x <= b && y >= a)
    return hit ? { ...f, gpsError: true, tier: DOWN[f.tier!], evidence: { ...f.evidence, gpsErrorOverlap: true } } : f
  })

  // Nhóm bằng chứng độc lập: dấu hiệu GPS chồng thời gian nhau = 1 nhóm; mọi dấu hiệu trùng lỗi GPS + GPS_TELEPORT = nhóm "lỗi GPS"
  const groups: { key: string; a: number; b: number; tier: FraudTier }[] = []
  for (const f of flags) {
    if (f.tier === 'NOTE') continue
    const gpsErr = f.gpsError || f.code === 'GPS_TELEPORT' || f.code === 'GPS_DISTANCE_GAIN'
    const timed = f.source?.startsWith('GPS') && f.atS != null && !gpsErr
    const key = gpsErr ? 'GPS_ERROR' : timed ? 'GPS_TIME' : f.source ?? f.code
    const a = f.atS ?? 0, b = (f.atS ?? 0) + (f.durationS ?? 0)
    const g = groups.find((x) => x.key === key && (key !== 'GPS_TIME' || (x.a <= b + pad && x.b >= a - pad)))
    if (g) { g.a = Math.min(g.a, a); g.b = Math.max(g.b, b); if (TIER_RANK[f.tier!] > TIER_RANK[g.tier]) g.tier = f.tier! }
    else groups.push({ key, a, b, tier: f.tier! })
  }
  const top = groups.reduce<FraudTier | null>((m, g) => (!m || TIER_RANK[g.tier] > TIER_RANK[m] ? g.tier : m), null)
  const warns = groups.filter((g) => g.tier === 'WARN').length
  // Chờ duyệt khi: có nghi vấn / đủ căn cứ loại, hoặc ≥ 2 cảnh báo ĐỘC LẬP (không tính 2 dấu hiệu cùng một lỗi GPS)
  const verdict = top === 'SUSPECT' || top === 'DISQUALIFY' || warns >= 2 ? 'REVIEW' : 'OK'

  const w = FRAUD_CONFIG.weights
  const score = Math.min(100, Math.round(flags.reduce((s, f) => s + (f.tier === 'NOTE' ? 0 : (f.score / 100) * (w[f.code] ?? 0)), 0)))
  const L = FRAUD_CONFIG.levels
  const level = top === 'DISQUALIFY' ? 'CRITICAL' : score >= L.critical ? 'CRITICAL' : score >= L.high ? 'HIGH' : score >= L.medium ? 'MEDIUM' : 'LOW'
  const sorted = [...flags].sort((a, b) => TIER_RANK[b.tier!] - TIER_RANK[a.tier!] || b.score - a.score)
  return { score, level, verdict, flags, basis: top, independent: groups.length, engine: FRAUD_ENGINE_VERSION,
    cleanDistanceM: cleanDistanceM == null ? null : Math.round(cleanDistanceM),
    reason: verdict === 'REVIEW' ? sorted.slice(0, 2).map((f) => f.message).join('; ') : null }
}

/** Dữ liệu gốc rút gọn để lưu (mỗi ~5 giây một điểm, tối đa ~1500 điểm; luôn giữ điểm nhảy / đầu / cuối) */
export function compactStreams(s: FraudStreams, stepS = 5, maxPoints = 1500): FraudStreams {
  const n = s.time.length
  const step = Math.max(stepS, Math.ceil((s.time[n - 1] - s.time[0]) / maxPoints))
  const keep: number[] = []
  let last = -Infinity
  for (let i = 0; i < n; i++) {
    const jump = i > 0 && s.time[i] - s.time[i - 1] > 0 && (s.distance[i] - s.distance[i - 1]) / (s.time[i] - s.time[i - 1]) > 12
    if (i === 0 || i === n - 1 || jump || s.time[i] - last >= step) { keep.push(i); last = s.time[i] }
  }
  const pick = <T,>(a: T[] | null | undefined) => (a ? keep.map((i) => a[i]) : null)
  const r1 = (x: number) => Math.round(x * 10) / 10
  return { time: keep.map((i) => s.time[i]), distance: keep.map((i) => r1(s.distance[i])),
    latlng: s.latlng ? keep.map((i) => s.latlng![i] ? [+s.latlng![i][0].toFixed(5), +s.latlng![i][1].toFixed(5)] as [number, number] : s.latlng![i]) : null,
    heartrate: pick(s.heartrate), cadence: pick(s.cadence) }
}

/** Streams Strava (key_by_type=true) → FraudStreams */
export function stravaStreams(raw: Record<string, { data?: unknown[] } | undefined> | null | undefined): FraudStreams | null {
  const arr = <T>(k: string) => (Array.isArray(raw?.[k]?.data) ? (raw![k]!.data as T[]) : null)
  const time = arr<number>('time'), distance = arr<number>('distance')
  if (!time || !distance || time.length < 2) return null
  const n = Math.min(time.length, distance.length)
  const cut = <T>(x: T[] | null) => (x && x.length >= n ? x.slice(0, n) : null)
  return { time: time.slice(0, n), distance: distance.slice(0, n), latlng: cut(arr<[number, number]>('latlng')),
    heartrate: cut(arr<number>('heartrate')), cadence: cut(arr<number>('cadence')) }
}
