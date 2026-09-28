import { describe, expect, it } from 'vitest'
import type { DrawWinner } from '../api/drawApi'
import { latestWinner, nextPrize, prizeProgress, reelNames, resultText, spinDelays } from './stage'

const w = (user: string, prize_idx: number, position: number, status: DrawWinner['status'] = 'WON'): DrawWinner =>
  ({ key: user, user_id: user, name: `Tên ${user}`, avatar_url: null, prize: `G${prize_idx}`, prize_idx, position, status, me: false })
const prizes = [{ name: 'Giải nhất', qty: 1 }, { name: 'Giải nhì', qty: 2 }, { name: 'Khuyến khích', qty: 3 }]

describe('màn hình quay thưởng', () => {
  it('tiến độ từng giải; người vắng mặt không tính suất', () => {
    const p = prizeProgress({ prizes, winners: [w('a', 2, 1), w('b', 2, 2, 'ABSENT'), w('c', 1, 3)] })
    expect(p.map((x) => [x.won, x.left])).toEqual([[0, 1], [1, 1], [1, 2]])
  })

  it('mặc định quay giải nhỏ (cuối danh sách) trước; giữ giải đang chọn nếu còn suất', () => {
    const p = prizeProgress({ prizes, winners: [w('a', 2, 1), w('b', 2, 2), w('c', 2, 3)] })
    expect(nextPrize(p)).toBe(1)
    expect(nextPrize(p, 0)).toBe(0)
    expect(nextPrize(p, 2)).toBe(1)                       // giải đang chọn đã đủ → chuyển giải kế
    expect(nextPrize(prizeProgress({ prizes: [{ name: 'X', qty: 1 }], winners: [w('a', 0, 1)] }))).toBeNull()
  })

  it('người vừa mở gần nhất, bỏ qua người vắng mặt', () => {
    expect(latestWinner([w('a', 0, 1), w('b', 0, 2, 'ABSENT')])?.user_id).toBe('a')
    expect(latestWinner([])).toBeNull()
  })

  it('vòng quay: chậm dần, dừng đúng người trúng, không lặp tên liền kề', () => {
    const d = spinDelays()
    expect(d.at(-1)!).toBeGreaterThan(d[0])
    const total = d.reduce((a, b) => a + b, 0)
    expect(total).toBeGreaterThan(2500)
    expect(total).toBeLessThan(5000)
    let seed = 1
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const names = reelNames(['An', 'Bình', 'Chi', 'Dũng'], 'Chi', d.length, rand)
    expect(names).toHaveLength(d.length)
    expect(names.at(-1)).toBe('Chi')
    expect(names.every((n, i) => i === 0 || n !== names[i - 1])).toBe(true)
    expect(reelNames([], 'Một mình', 3)).toEqual(['Một mình', 'Một mình', 'Một mình'])
  })

  it('nội dung công bố theo từng giải, kèm mã kiểm chứng', () => {
    const t = resultText({ title: 'Tất niên', prizes, winners: [w('a', 0, 1), w('b', 2, 2, 'ABSENT'), w('c', 2, 3)], entrant_count: 40, seed: 'abc', seed_hash: 'def' })
    expect(t).toContain('KẾT QUẢ TẤT NIÊN')
    expect(t).toContain('🏆 Giải nhất:\n   • Tên a')
    expect(t).not.toContain('Tên b')
    expect(t).not.toContain('Giải nhì')
    expect(t).toContain('40 người')
    expect(t).toContain('abc (md5 = def)')
    expect(resultText({ title: 'X', prizes, winners: [], entrant_count: 1, seed: null, seed_hash: null, sponsor: { name: 'Shop A', logo_url: null } })).toContain('Nhà tài trợ: Shop A')
  })
})
