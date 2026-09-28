// Logic thuần của màn hình quay thưởng (009300): tiến độ từng giải, giải quay tiếp theo, nhịp vòng quay, nội dung công bố.
import type { DrawWinner, LuckyDraw } from '../api/drawApi'

export interface PrizeProgress { idx: number; name: string; qty: number; won: number; left: number }

/** Mỗi giải: đã trúng bao nhiêu / còn bao nhiêu suất (người vắng mặt không tính) */
export function prizeProgress(d: Pick<LuckyDraw, 'prizes' | 'winners'>): PrizeProgress[] {
  return d.prizes.map((p, idx) => {
    const won = d.winners.filter((w) => w.status !== 'ABSENT' && (w.prize_idx === idx || (w.prize_idx == null && w.prize === p.name))).length
    return { idx, name: p.name, qty: p.qty, won, left: Math.max(p.qty - won, 0) }
  })
}

/** Giải quay tiếp: giải còn suất nằm CUỐI danh sách — BTC nhập giải lớn trước, quay giải nhỏ trước để giữ hồi hộp */
export function nextPrize(progress: PrizeProgress[], current?: number | null): number | null {
  if (current != null && progress[current]?.left) return current
  for (let i = progress.length - 1; i >= 0; i--) if (progress[i].left > 0) return i
  return null
}

/** Người vừa mở gần nhất (trúng, chưa bị đánh dấu vắng mặt) */
export function latestWinner(winners: DrawWinner[]): DrawWinner | null {
  return winners.reduce<DrawWinner | null>((a, w) => (w.status === 'WON' && (!a || w.position > a.position) ? w : a), null)
}

/**
 * Nhịp vòng quay (ms giữa hai lần đổi tên): chạy nhanh `fast` nhịp rồi chậm dần như máy quay số thật.
 * Tổng khoảng 3–4 giây — đủ hồi hộp, không làm khán giả chờ lâu.
 */
export function spinDelays(fast = 26): number[] {
  const slow = [70, 80, 95, 115, 140, 170, 210, 260, 320, 400, 500]
  return [...Array.from({ length: fast }, () => 55), ...slow]
}

/** Danh sách tên cho vòng quay: lặp tên trong danh sách, không trùng tên liền kề, kết thúc ở người trúng */
export function reelNames(pool: string[], winner: string, steps: number, rand: () => number = Math.random): string[] {
  const src = pool.filter(Boolean).length ? pool.filter(Boolean) : [winner]
  const out: string[] = []
  for (let i = 0; i < steps - 1; i++) {
    let n = src[Math.floor(rand() * src.length)]
    if (src.length > 1) for (let k = 0; k < 4 && (n === out[i - 1] || n === winner && i >= steps - 3); k++) n = src[Math.floor(rand() * src.length)]
    out.push(n)
  }
  out.push(winner)
  return out
}

/** Nội dung công bố để dán vào Zalo / Facebook */
export function resultText(d: Pick<LuckyDraw, 'title' | 'prizes' | 'winners' | 'entrant_count' | 'seed' | 'seed_hash'> & { sponsor?: LuckyDraw['sponsor'] }): string {
  const lines = [`🎁 KẾT QUẢ ${d.title.toUpperCase()}`, ...(d.sponsor?.name ? [`Nhà tài trợ: ${d.sponsor.name}`] : []), '']
  d.prizes.forEach((p, idx) => {
    const ws = d.winners.filter((w) => w.status !== 'ABSENT' && (w.prize_idx === idx || (w.prize_idx == null && w.prize === p.name)))
    if (!ws.length) return
    lines.push(`🏆 ${p.name}:`)
    ws.forEach((w) => lines.push(`   • ${w.name}`))
  })
  lines.push('', `Quay ngẫu nhiên trong ${d.entrant_count ?? 0} người đủ điều kiện trên RaceHub.`)
  if (d.seed) lines.push(`Mã kiểm chứng: ${d.seed}${d.seed_hash ? ` (md5 = ${d.seed_hash})` : ''}`)
  return lines.join('\n')
}
