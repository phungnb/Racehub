import { it } from 'vitest'
import { analyzeRun, type FraudStreams } from './fraud'

// Bài 1 Hz, tốc độ v, lat theo quãng đường
function build(n: number, v = 3.0, step = 1): FraudStreams {
  const time: number[] = [], distance: number[] = [], latlng: [number, number][] = []
  for (let t = 0; t <= n; t += step) { time.push(t); distance.push(t * v); latlng.push([21 + (t * v) / 111000, 105.8]) }
  return { time, distance, latlng, heartrate: null, cadence: null }
}
// Dịch chuyển m mét trải trên `over` điểm bắt đầu từ chỉ số i (cả distance và latlng); back>0: quay về sau back điểm
function jump(s: FraudStreams, i: number, m: number, over = 1, back = 0) {
  const n = s.time.length
  for (let k = i; k < n; k++) {
    const f = Math.min(1, (k - i + 1) / over)
    s.distance[k] += m * f
    s.latlng![k] = [s.latlng![k][0] + (m * f) / 111000, s.latlng![k][1]]
  }
  if (back) for (let k = i + back; k < n; k++) {
    const f = Math.min(1, (k - i - back + 1) / over)
    s.distance[k] += m * f
    s.latlng![k] = [s.latlng![k][0] - (m * f) / 111000, s.latlng![k][1]]
  }
  return s
}
const sum = (s: FraudStreams) => ({ distanceM: s.distance.at(-1)!, movingS: s.time.at(-1)!, sportType: 'Run' })
const hist = Array.from({ length: 15 }, (_, i) => 330 + (i % 5) * 6)
const show = (name: string, s: FraudStreams, h: number[] = []) => {
  const r = analyzeRun(sum(s), s, h)
  console.log(name.padEnd(48), r.verdict, r.basis, 'g', r.independent, r.flags.map((f) => `${f.code}:${f.tier}${f.gpsError ? '(gpsErr)' : ''}`).join(' '))
}
it('exp', () => {
  show('1 cú 2 km/1s', jump(build(2400), 1200, 2000))
  show('1 cú 2 km/1s + lịch sử', jump(build(2400), 1200, 2000), hist)
  show('3 cú 1,2 km/1s', jump(jump(jump(build(2400), 500, 1200), 1200, 1200), 1900, 1200))
  show('3 cú 1,2 km + lịch sử', jump(jump(jump(build(2400), 500, 1200), 1200, 1200), 1900, 1200), hist)
  show('3 cú 300 m rồi quay về (2s)', jump(jump(jump(build(2400), 500, 300, 1, 2), 1200, 300, 1, 2), 1900, 300, 1, 2))
  show('3 cú 300 m quay về + lịch sử', jump(jump(jump(build(2400), 500, 300, 1, 2), 1200, 300, 1, 2), 1900, 300, 1, 2), hist)
  show('lạc 1 km rồi quay về (3s mỗi chiều)', jump(build(2400), 1200, 1000, 3, 5))
  show('dịch chuyển 600 m trải 15 s', jump(build(2400), 1200, 600, 15))
  show('dịch chuyển 1 km trải 20 s', jump(build(2400), 1200, 1000, 20))
  show('trôi 300 m ra rồi về, mỗi chiều 15 s', jump(build(2400), 1200, 300, 15, 15))
  show('trôi 150 m ra rồi về, mỗi chiều 10 s', jump(build(2400), 1200, 150, 10, 10))
  show('nhảy 2 km lúc mới bật (giây 5)', jump(build(2400), 5, 2000))
  show('mẫu 5 s, nhảy 1 km trong 1 bước', jump(build(2400, 3, 5), 240, 1000))
  show('mẫu 5 s, nhảy 1 km trải 3 bước (15s)', jump(build(2400, 3, 5), 240, 1000, 3))
  show('mẫu 5 s, 4 cú 400 m', [100, 200, 300, 400].reduce((s, i) => jump(s, i, 400), build(2400, 3, 5)))
  show('10 cú 200 m/1s', [200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000].reduce((s, i) => jump(s, i, 200), build(2400)))
  show('10 cú 200 m/1s + lịch sử', [200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000].reduce((s, i) => jump(s, i, 200), build(2400)), hist)
})
