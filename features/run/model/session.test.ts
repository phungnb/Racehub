import { describe, expect, it } from 'vitest'
import { RunSession, STOP } from './session'

// Mô phỏng: chạy trên đường thẳng hướng Bắc, GPS mỗi giây, sai số 5 m, máy báo vận tốc
const dLat = (m: number) => m / 111320
function sim() {
  const s = new RunSession()
  let t = 1_000_000, pos = 0
  const step = (v: number, n: number, noGps = false) => {
    for (let i = 0; i < n; i++) {
      t += 1000
      pos += v
      if (!noGps) s.fix({ latitude: 21 + dLat(pos), longitude: 105.85, accuracy: 5, altitude: null, speed: v, time: t }, t)
      s.tick(t)
    }
  }
  const events: string[] = []
  const stepEv = (v: number, n: number) => {
    for (let i = 0; i < n; i++) {
      t += 1000; pos += v
      for (const e of s.fix({ latitude: 21 + dLat(pos), longitude: 105.85, accuracy: 5, altitude: null, speed: v, time: t }, t)) events.push(e.type)
      for (const e of s.tick(t)) events.push(e.type)
    }
  }
  return { s, step, stepEv, events, now: () => t }
}

describe('phiên chạy: bắt đầu, tự tạm dừng, tạm dừng tay', () => {
  it('chờ GPS ổn định rồi mới tính giờ; đứng yên lúc đầu = sẵn sàng, không phải tự tạm dừng', () => {
    const { s, step } = sim()
    step(0, 1)
    expect(s.phase).toBe('RUNNING')          // điểm ≤ 10 m → bắt đầu ngay
    step(0, 30)
    expect(s.moved).toBe(false)
    expect(s.autoPaused).toBe(false)
    expect(s.shownS).toBe(0)
    expect(s.elapsedS).toBeCloseTo(30, 0)    // tổng thời gian vẫn chạy
  })

  it('chạy 5 phút ở 3 m/s: quãng đường, thời gian chạy, pace khớp; 5 km có đủ từng km', () => {
    const { s, step } = sim()
    step(3, 1700)
    expect(Math.abs(s.distanceM - 5100) / 5100).toBeLessThan(0.02)
    expect(s.splits.map((x) => x.km)).toEqual([1, 2, 3, 4, 5])
    expect(s.avgPace).toBeGreaterThan(320)
    expect(s.avgPace).toBeLessThan(345)
  })

  it('đứng nghỉ 2 phút không bấm dừng: tự tạm dừng sau ~10 giây, pace không bị kéo chậm, chạy tiếp tự tính lại', () => {
    const { s, stepEv, events } = sim()
    stepEv(3, 300)
    const moving = s.movingS
    stepEv(0, 120)
    expect(events).toContain('AUTO_PAUSE')
    expect(s.movingS - moving).toBeLessThan(15)
    expect(s.shownS - moving).toBeLessThan(15)
    stepEv(3, 300)
    expect(events).toContain('AUTO_RESUME')
    expect(s.avgPace).toBeGreaterThan(320)
    expect(s.avgPace).toBeLessThan(345)
    expect(s.elapsedS).toBeGreaterThan(s.movingS + 100)
  })

  it('tạm dừng tay 2 phút rồi tiếp tục: không nối đoạn, tổng thời gian không tính lúc tạm dừng', () => {
    const { s, step, now } = sim()
    step(3, 200)
    expect(s.currentPace).toBeGreaterThan(0)
    s.pause(now())
    expect(s.currentPace).toBe(0)                // tạm dừng: không hiện pace cũ
    const e = s.elapsedS, d = s.distanceM
    step(3, 120)                             // vẫn di chuyển nhưng đang tạm dừng
    expect(s.elapsedS).toBe(e)
    expect(s.distanceM).toBe(d)
    s.resume(now())
    step(3, 100)
    expect(s.distanceM - d).toBeLessThan(320)   // ≈ 300 m sau khi tiếp tục, không cộng 360 m lúc tạm dừng
    expect(s.q.pauses).toBe(1)
  })
})

describe('phiên chạy: đứng nghỉ quá lâu không bấm dừng', () => {
  it('10 phút → hỏi kết thúc; 30 phút → tự chuyển sang Tạm dừng', () => {
    const { s, stepEv, events } = sim()
    stepEv(3, 600)
    stepEv(0, STOP.ASK_S + 5)
    expect(events.filter((e) => e === 'LONG_STOP')).toHaveLength(1)
    expect(s.longStop).toBe(true)
    expect(s.phase).toBe('RUNNING')
    stepEv(0, STOP.AUTO_STOP_S - STOP.ASK_S)
    expect(events).toContain('AUTO_STOPPED')
    expect(s.phase).toBe('PAUSED')
    expect(s.autoStopped).toBe(true)
    const e = s.elapsedS
    stepEv(0, 600)
    expect(s.elapsedS).toBe(e)               // đã tạm dừng: tổng thời gian đứng lại
  })

  it('quên bấm Kết thúc 40 phút: bỏ phần đứng yên cuối bài, giờ kết thúc = lúc dừng chạy', () => {
    const { s, step, now } = sim()
    step(3, 1200)
    const runEnd = now()
    const moving = s.movingS
    step(0, 40 * 60)
    s.finish(now())
    expect(s.phase).toBe('FINISHED')
    expect(s.q.trimmedS).toBeGreaterThan(29 * 60)
    expect(s.elapsedS).toBeLessThan(1210)
    expect(s.endedAt! - runEnd).toBeLessThan(5000)
    const p = s.payload(now())
    expect(Date.parse(p.p_ended_at) - Date.parse(p.p_started_at)).toBeLessThan(1210 * 1000)
    expect(Math.abs(p.p_moving_s - moving)).toBeLessThan(10)     // đứng yên không cộng thời gian chạy
  })

  it('nghỉ ngắn ở cuối (dưới 2 phút) thì giữ nguyên', () => {
    const { s, step, now } = sim()
    step(3, 600)
    step(0, 60)
    s.finish(now())
    expect(s.q.trimmedS).toBe(0)
    expect(s.elapsedS).toBeGreaterThan(655)
  })

  it('bấm Bắt đầu rồi bỏ quên, không chạy: 30 phút tự tạm dừng', () => {
    const { s, stepEv, events } = sim()
    stepEv(0, STOP.AUTO_STOP_S + 2)
    expect(events).toContain('LONG_STOP')
    expect(s.phase).toBe('PAUSED')
  })
})

describe('phiên chạy: mất GPS, ẩn app, khôi phục, chất lượng', () => {
  it('mất GPS > 15 giây → báo mất; có điểm lại → hết báo', () => {
    const { s, step } = sim()
    step(3, 60)
    step(3, 20, true)
    expect(s.gpsLost).toBe(true)
    step(3, 2)
    expect(s.gpsLost).toBe(false)
    expect(s.gaps.length).toBe(1)
  })

  it('khôi phục từ bản lưu: về Tạm dừng, giữ số liệu, chạy tiếp được', () => {
    const { s, step, now } = sim()
    step(3, 400)
    s.hidden(now()); step(3, 5); s.visible(now())
    const snap = s.snapshot()!
    const r = RunSession.restore(JSON.parse(JSON.stringify(snap)), [...s.points], now())
    expect(r.phase).toBe('PAUSED')
    expect(r.distanceM).toBe(s.distanceM)
    expect(r.q.hidden).toBe(1)
    r.resume(now() + 1000)
    expect(r.phase).toBe('RUNNING')
  })

  it('tóm tắt chất lượng GPS gọn (< 2 KB) và đếm điểm bị loại theo lý do', () => {
    const { s, step, now } = sim()
    step(3, 300)
    s.fix({ latitude: 21, longitude: 105.85, accuracy: 80, altitude: null, speed: 3, time: now() + 500 }, now() + 500)
    const q = s.quality({ platform: 'web' })
    expect(q.fixes).toBe(301)
    expect(q.rejected.INACCURATE).toBe(1)
    expect(q.accepted).toBeGreaterThan(50)
    expect(JSON.stringify(q).length).toBeLessThan(2048)
  })
})

import { badPct, deviceLabel, errorPct, errorTone } from './qa'

describe('kiểm thử GPS: chỉ số', () => {
  it('sai lệch % so với quãng chuẩn; điểm hỏng không tính rung tại chỗ', () => {
    expect(errorPct(5100, 5000)).toBe(2)
    expect(errorPct(5000, null)).toBeNull()
    expect(errorTone(-1.5)).toBe('good')
    expect(errorTone(4)).toBe('ok')
    expect(errorTone(8)).toBe('bad')
    expect(badPct({ fixes: 1000, rejected: { JITTER: 700, INACCURATE: 10, TELEPORT: 5 } })).toBe(1.5)
  })
  it('tên thiết bị gọn từ user agent', () => {
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 RaceHubApp')).toBe('iPhone iOS 18.2')
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36')).toBe('SM-S918B · Android 14')
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36')).toBe('Pixel 7 · Android 13')
  })
})

describe('quy tắc ghi bài chạy do admin đặt (Chính sách vận hành)', () => {
  it('hỏi Kết thúc sau 5 phút, tự tạm dừng sau 15 phút, tự tạm dừng khi đứng 20 giây', () => {
    const s = new RunSession({ autoPauseAfterS: 20, longStopAskMin: 5, longStopAutoStopMin: 15 })
    let t = 1_000_000, pos = 0
    const ev: string[] = []
    const step = (v: number, n: number) => {
      for (let i = 0; i < n; i++) {
        t += 1000; pos += v
        for (const e of s.fix({ latitude: 21 + pos / 111320, longitude: 105.85, accuracy: 5, altitude: null, speed: v, time: t }, t)) ev.push(e.type)
        for (const e of s.tick(t)) ev.push(e.type)
      }
    }
    step(3, 300)
    step(0, 15)
    expect(s.autoPaused).toBe(false)          // chưa tới 20 giây
    step(0, 10)
    expect(s.autoPaused).toBe(true)
    step(0, 5 * 60)
    expect(ev).toContain('LONG_STOP')
    step(0, 10 * 60)
    expect(s.phase).toBe('PAUSED')
  })
})
