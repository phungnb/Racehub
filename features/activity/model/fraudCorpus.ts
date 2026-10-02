// Bộ dữ liệu đánh giá bộ chống gian lận: bài chạy thật (nhiều kiểu), bài có lỗi GPS, bài gian lận giả lập.
// Sinh ngẫu nhiên có hạt giống (kết quả lặp lại được) — dùng để đo tỷ lệ phân loại sai mỗi khi đổi quy tắc / ngưỡng.
// Đây là dữ liệu MÔ PHỎNG theo đặc điểm bài chạy thật; ngưỡng cần đối chiếu thêm với bài thật đã được người duyệt gắn nhãn
// (bảng activity_analyses + activity_decisions, xem docs/CHONG_GIAN_LAN.md).
import type { FraudStreams, FraudSummary } from './fraud'

export type CorpusLabel = 'REAL' | 'REAL_ELITE' | 'GPS_ERROR' | 'CHEAT' | 'CHEAT_HARD'
export interface CorpusRun { id: string; label: CorpusLabel; kind: string; summary: FraudSummary; streams: FraudStreams; history: number[]; teleportM?: number }

/** Bộ sinh số ngẫu nhiên có hạt giống (mulberry32) */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Seg { s: number; mps: number; hr?: number; spm?: number }
interface Gen {
  r: () => number
  segs: Seg[]
  /** biến đổi sau khi dựng: chèn lỗi GPS / gian lận */
  spikes?: number                       // số cú nhảy GPS ngắn
  drift?: number                        // số đoạn GPS trôi (phóng đại quãng đường 20–40 giây)
  gaps?: number                         // số lần mất tín hiệu 60–180 giây
  teleportM?: number                    // một cú "dịch chuyển" cộng thêm quãng đường (gian lận đi tắt)
  noHr?: boolean
}

function make(g: Gen): FraudStreams {
  const { r } = g
  const time = [0], distance = [0], hr: number[] = [0], cad: number[] = [0]
  const latlng: [number, number][] = [[21.0, 105.8]]
  let t = 0, d = 0, heading = r() * Math.PI * 2, smooth = g.segs[0]?.mps ?? 3
  for (const seg of g.segs) {
    for (let k = 0; k < seg.s; k++) {
      t += 1
      // tốc độ thật dao động mượt quanh mục tiêu (±5%), đứng chờ đèn thì 0
      smooth += (seg.mps - smooth) * 0.2 + (r() - 0.5) * 0.08 * Math.max(seg.mps, 0.5)
      const v = Math.max(0, seg.mps === 0 ? 0 : smooth)
      d += v
      heading += (r() - 0.5) * 0.05
      const prev = latlng[latlng.length - 1]
      latlng.push([prev[0] + (v * Math.cos(heading)) / 111_000, prev[1] + (v * Math.sin(heading)) / 104_000])
      time.push(t); distance.push(d)
      hr.push(seg.hr != null ? seg.hr + (r() - 0.5) * 6 : 0)
      cad.push(seg.spm != null ? (seg.spm + (r() - 0.5) * 4) / 2 : 0)      // Strava: bước/phút của một chân
    }
  }
  const n = time.length
  const add = (from: number, meters: number, jumpLl = false) => {
    for (let i = from; i < n; i++) distance[i] += meters
    if (jumpLl) for (let i = from; i < n; i++) latlng[i] = [latlng[i][0] + meters / 111_000, latlng[i][1]]
  }
  // Cú nhảy GPS ngắn: điểm lạc 1–3 giây rồi quay về — quãng đường Strava cộng cả đi lẫn về
  for (let k = 0; k < (g.spikes ?? 0); k++) {
    const i = 60 + Math.floor(r() * (n - 120)), m = 40 + r() * 160, len = 1 + Math.floor(r() * 3)
    add(i, m)
    for (let j = i; j < i + len && j < n; j++) latlng[j] = [latlng[j][0] + m / 111_000, latlng[j][1]]
    add(i + len, m)
  }
  // GPS trôi (nhà cao tầng): 20–40 giây quãng đường bị phóng đại 25–50%
  for (let k = 0; k < (g.drift ?? 0); k++) {
    const i = 60 + Math.floor(r() * (n - 120)), len = 20 + Math.floor(r() * 20), f = 0.25 + r() * 0.25
    let extra = 0
    for (let j = i; j < Math.min(n, i + len); j++) { extra += (distance[j] - distance[j - 1]) * f; distance[j] += extra }
    for (let j = i + len; j < n; j++) distance[j] += extra
  }
  if (g.teleportM) add(Math.floor(n / 2), g.teleportM, true)
  // Mất tín hiệu: bỏ hẳn các điểm trong 60–180 giây (đường nối thẳng sau đó)
  let keep = Array.from({ length: n }, () => true)
  for (let k = 0; k < (g.gaps ?? 0); k++) {
    const i = 120 + Math.floor(r() * (n - 360)), len = 60 + Math.floor(r() * 120)
    for (let j = i; j < Math.min(n - 1, i + len); j++) keep[j] = false
  }
  keep = keep.map((x, i) => x || i === 0 || i === n - 1)
  const pick = <T>(a: T[]) => a.filter((_, i) => keep[i])
  const hasHr = !g.noHr && g.segs.some((s) => s.hr != null)
  const hasCad = g.segs.some((s) => s.spm != null)
  return { time: pick(time), distance: pick(distance), latlng: pick(latlng), heartrate: hasHr ? pick(hr) : null, cadence: hasCad ? pick(cad) : null }
}

const pace = (minPerKm: number) => 1000 / (minPerKm * 60)
const between = (r: () => number, a: number, b: number) => a + r() * (b - a)

function summaryOf(st: FraudStreams): FraudSummary {
  return { distanceM: st.distance[st.distance.length - 1], movingS: st.time[st.time.length - 1], sportType: 'Run' }
}
/** Lịch sử pace (giây/km) của người chạy quanh pace thường ngày */
function hist(r: () => number, sPerKm: number) {
  return Array.from({ length: 15 }, () => sPerKm * between(r, 0.93, 1.07))
}

type Recipe = (r: () => number) => Omit<CorpusRun, 'id' | 'summary' | 'streams'> & { gen: Omit<Gen, 'r'> }

const RECIPES: Recipe[] = [
  // ---------- Bài thật ----------
  (r) => { const p = between(r, 5.5, 7.2); return { label: 'REAL', kind: 'Chạy nhẹ có dừng đèn đỏ', history: hist(r, p * 60),
    gen: { segs: [{ s: 900, mps: pace(p), hr: 140, spm: 165 }, { s: 45, mps: 0, hr: 120 }, { s: 1200, mps: pace(p), hr: 145, spm: 166 }, { s: 30, mps: 0, hr: 125 }, { s: 900, mps: pace(p), hr: 148, spm: 166 }] } } },
  (r) => { const p = between(r, 4.0, 4.6); return { label: 'REAL', kind: 'Chạy tempo 20 phút', history: hist(r, (p + 1) * 60),
    gen: { segs: [{ s: 600, mps: pace(p + 1.3), hr: 135, spm: 165 }, { s: 1200, mps: pace(p), hr: 168, spm: 178 }, { s: 600, mps: pace(p + 1.5), hr: 145, spm: 165 }] } } },
  (r) => { const p = between(r, 3.3, 3.8), rest: Seg = { s: 90, mps: 1.5, hr: 140, spm: 120 }; return { label: 'REAL', kind: 'Biến tốc 8×400 m', history: hist(r, 330),
    gen: { segs: [{ s: 600, mps: pace(6), hr: 135, spm: 165 }, ...Array.from({ length: 8 }, () => [{ s: Math.round(400 / pace(p)), mps: pace(p), hr: 175, spm: 186 }, rest]).flat(), { s: 600, mps: pace(6.2), hr: 140, spm: 165 }] } } },
  (r) => { const p = between(r, 3.15, 3.35), rest: Seg = { s: 120, mps: 1.6, hr: 150, spm: 125 }; return { label: 'REAL', kind: 'VĐV phong trào mạnh: 5×1 km pace 3:15', history: hist(r, 270),
    gen: { segs: [{ s: 900, mps: pace(5), hr: 140, spm: 170 }, ...Array.from({ length: 5 }, () => [{ s: Math.round(1000 / pace(p)), mps: pace(p), hr: 178, spm: 188 }, rest]).flat(), { s: 600, mps: pace(5.5), hr: 145, spm: 168 }] } } },
  (r) => { const p = between(r, 3.0, 3.2); return { label: 'REAL', kind: 'Giải 10 km pace 3:05 (sub-elite)', history: hist(r, 230),
    gen: { segs: [{ s: 600, mps: pace(5), hr: 140, spm: 172 }, { s: Math.round(10000 / pace(p)), mps: pace(p), hr: 182, spm: 190 }, { s: 300, mps: pace(6), hr: 150, spm: 160 }] } } },
  (r) => { const p = between(r, 6.5, 9); return { label: 'REAL', kind: 'Trail leo dốc, đi bộ xen kẽ', history: hist(r, p * 60),
    gen: { segs: [{ s: 1200, mps: pace(p), hr: 150, spm: 150 }, { s: 900, mps: 1.2, hr: 160, spm: 110 }, { s: 600, mps: pace(p - 1.5), hr: 145, spm: 165 }, { s: 1200, mps: pace(p), hr: 150, spm: 150 }] } } },
  (r) => { const p = between(r, 5, 6.5); return { label: 'REAL', kind: 'Chạy không đeo cảm biến tim / cadence', history: [],
    gen: { segs: [{ s: 2400, mps: pace(p) }] } } },
  (r) => { const p = between(r, 2.75, 2.9); return { label: 'REAL_ELITE', kind: 'VĐV đỉnh cao: 5 km pace 2:50', history: hist(r, 200),
    gen: { segs: [{ s: 900, mps: pace(4.5), hr: 140, spm: 175 }, { s: Math.round(5000 / pace(p)), mps: pace(p), hr: 185, spm: 196 }, { s: 600, mps: pace(5), hr: 150, spm: 170 }] } } },

  // ---------- Bài thật có lỗi GPS ----------
  (r) => { const p = between(r, 5, 6.5); return { label: 'GPS_ERROR', kind: 'Điểm GPS nhảy (5 lần)', history: hist(r, p * 60),
    gen: { spikes: 5, segs: [{ s: 2700, mps: pace(p), hr: 150, spm: 168 }] } } },
  (r) => { const p = between(r, 5, 6.5); return { label: 'GPS_ERROR', kind: 'GPS trôi giữa nhà cao tầng (4 đoạn)', history: hist(r, p * 60),
    gen: { drift: 4, segs: [{ s: 2700, mps: pace(p), hr: 150, spm: 168 }] } } },
  (r) => { const p = between(r, 5, 6.5); return { label: 'GPS_ERROR', kind: 'Mất tín hiệu (hầm / cầu) 2 lần', history: hist(r, p * 60),
    gen: { gaps: 2, segs: [{ s: 3000, mps: pace(p), hr: 150, spm: 168 }] } } },
  (r) => { const p = between(r, 3.3, 3.7), rest: Seg = { s: 90, mps: 1.5, hr: 140, spm: 120 }; return { label: 'GPS_ERROR', kind: 'Biến tốc + GPS nhảy + trôi', history: hist(r, 320),
    gen: { spikes: 4, drift: 2, segs: [{ s: 600, mps: pace(6), hr: 135, spm: 165 }, ...Array.from({ length: 6 }, () => [{ s: Math.round(400 / pace(p)), mps: pace(p), hr: 175, spm: 186 }, rest]).flat(), { s: 600, mps: pace(6), hr: 140, spm: 165 }] } } },

  // ---------- Gian lận ----------
  (r) => { const p = between(r, 5.5, 6.5); return { label: 'CHEAT', kind: 'Đi ô tô / xe máy 5 phút giữa bài', history: hist(r, p * 60),
    gen: { segs: [{ s: 1200, mps: pace(p), hr: 145, spm: 166 }, { s: 300, mps: between(r, 11, 16), hr: 100 }, { s: 900, mps: pace(p), hr: 145, spm: 166 }] } } },
  (r) => ({ label: 'CHEAT', kind: 'Đạp xe cả bài 22–28 km/h', history: hist(r, 360),
    gen: { segs: [{ s: 2400, mps: between(r, 6.1, 7.8), hr: 125, spm: 170 }] } }),
  (r) => ({ label: 'CHEAT', kind: 'Xe điện 20–24 km/h 20 phút', history: hist(r, 380),
    gen: { segs: [{ s: 300, mps: pace(6), hr: 140, spm: 165 }, { s: 1200, mps: between(r, 5.7, 6.6), hr: 95 }, { s: 300, mps: pace(6), hr: 140, spm: 165 }] } }),
  (r) => ({ label: 'CHEAT', kind: 'Xe máy 3 đoạn × 1 phút 45 km/h', history: hist(r, 360),
    gen: { segs: [{ s: 600, mps: pace(6) }, { s: 60, mps: 12.5 }, { s: 600, mps: pace(6) }, { s: 60, mps: 12.5 }, { s: 600, mps: pace(6) }, { s: 60, mps: 12.5 }, { s: 300, mps: pace(6) }] } }),
  (r) => ({ label: 'CHEAT', kind: 'Đi tắt: tuyến "nhảy" thêm 2 km', history: hist(r, 360),
    gen: { teleportM: 2000, segs: [{ s: 2400, mps: pace(6), hr: 145, spm: 166 }] } }),
  (r) => ({ label: 'CHEAT_HARD', kind: 'Ngồi xe kẹt đường 13–15 km/h (khó phát hiện)', history: hist(r, 400),
    gen: { segs: [{ s: 600, mps: pace(6.5), hr: 140, spm: 165 }, { s: 900, mps: between(r, 3.6, 4.1) }, { s: 600, mps: pace(6.5), hr: 140, spm: 165 }] } }),
]

/** Sinh bộ dữ liệu: `perRecipe` bài cho mỗi kiểu */
export function buildCorpus(perRecipe = 12, seed = 20261002): CorpusRun[] {
  const out: CorpusRun[] = []
  RECIPES.forEach((recipe, ri) => {
    for (let k = 0; k < perRecipe; k++) {
      const r = rng(seed + ri * 1000 + k)
      const { gen, ...meta } = recipe(r)
      const streams = make({ ...gen, r })
      out.push({ id: `${ri}-${k}`, ...meta, summary: summaryOf(streams), streams, teleportM: gen.teleportM })
    }
  })
  return out
}
