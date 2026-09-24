import { describe, it, expect } from 'vitest'
import { canRegister, dashboardCsv, distanceLabel, racePace, racePhase, raceTime } from './race'

describe('giải chạy ảo', () => {
  const r = { status: 'PUBLISHED' as const, start_at: '2026-10-10T00:00:00Z', end_at: '2026-10-20T00:00:00Z', reg_close_at: '2026-10-15T00:00:00Z' }
  it('trạng thái giải và hạn đăng ký', () => {
    expect(racePhase(r, Date.parse('2026-10-01T00:00:00Z'))).toBe('UPCOMING')
    expect(racePhase(r, Date.parse('2026-10-12T00:00:00Z'))).toBe('LIVE')
    expect(racePhase(r, Date.parse('2026-10-21T00:00:00Z'))).toBe('ENDED')
    expect(racePhase({ ...r, status: 'CANCELLED' })).toBe('CANCELLED')
    expect(canRegister(r, Date.parse('2026-10-14T00:00:00Z'))).toBe(true)
    expect(canRegister(r, Date.parse('2026-10-16T00:00:00Z'))).toBe(false)
  })
  it('định dạng cự ly, thời gian, pace', () => {
    expect(distanceLabel(21.1)).toBe('Half Marathon')
    expect(distanceLabel(42.2)).toBe('Full Marathon')
    expect(distanceLabel(5)).toBe('5 km')
    expect(raceTime(3300)).toBe('55:00')
    expect(raceTime(7384)).toBe('2:03:04')
    expect(raceTime(null)).toBe('—')
    expect(racePace(330)).toBe('5:30/km')
  })
  it('CSV cho ban tổ chức: có BOM, xếp hạng trong từng cự ly, thoát dấu phẩy', () => {
    const base = { user_id: 'u', registered_at: '2026-10-01T00:00:00Z', activity_id: null }
    const csv = dashboardCsv([
      { ...base, bib: 'RH-0001', display_name: 'An, Nguyễn', distance_km: 10, status: 'FINISHED', finish_time_s: 3300, finish_distance_m: 12000, finished_at: '2026-10-12T00:00:00Z' },
      { ...base, bib: 'RH-0002', display_name: 'Bình', distance_km: 10, status: 'FINISHED', finish_time_s: 3000, finish_distance_m: 10000, finished_at: '2026-10-12T00:00:00Z' },
      { ...base, bib: 'RH-0003', display_name: 'Chi', distance_km: 5, status: 'REGISTERED', finish_time_s: null, finish_distance_m: null, finished_at: null },
    ])
    const lines = csv.split('\n')
    expect(csv.startsWith('﻿')).toBe(true)
    expect(lines[1]).toContain('"An, Nguyễn"')
    expect(lines[1].split(',')[5]).toBe('2')           // hạng 2 ở cự ly 10 km
    expect(lines[2]).toContain('RH-0002,Bình,10,Hoàn thành,1,50:00')
    expect(lines[3]).toContain('Chưa hoàn thành')
  })
})
