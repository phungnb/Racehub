// Thi đấu CLB v2 (012700): nhãn, tóm tắt luật, điểm, trạng thái đăng ký — hàm thuần, dùng chung cho trận 1–1 và giải nhiều CLB
import type { Cup, MatchFormat, MatchMeasure, MatchPhase, MatchTerms, MatchTiebreak } from '../api/cupApi'

export const FORMAT_LABEL: Record<MatchFormat, { title: string; hint: string }> = {
  AVG: { title: 'Trung bình mỗi VĐV', hint: 'Tổng chia số VĐV đăng ký — công bằng khi hai CLB chênh quân số' },
  TOTAL: { title: 'Tổng cả đội', hint: 'Cộng tất cả — CLB đông, chạy nhiều có lợi' },
  TOP: { title: 'Top VĐV giỏi nhất', hint: 'Cộng X người giỏi nhất mỗi CLB — đọ đội hình mạnh nhất' },
}
export const MEASURE_LABEL: Record<MatchMeasure, { title: string; hint: string }> = {
  KM: { title: 'Quãng đường (km)', hint: 'Chạy nhiều km hơn thắng' },
  TIME: { title: 'Thời gian chạy', hint: 'Chạy lâu hơn thắng — người chạy chậm cũng góp sức' },
  PACE: { title: 'Pace đội', hint: 'Tổng thời gian ÷ tổng km, thấp hơn thắng — người chạy đủ km tối thiểu mới được xét' },
}
export const TIEBREAK_LABEL: Record<MatchTiebreak, string> = {
  PARTICIPANTS: 'nhiều người chạy hơn thắng',
  DAYS: 'nhiều ngày chạy hơn thắng',
  NONE: 'xử hòa',
}
export const PHASE_INFO: Record<MatchPhase, { label: string; tone: string }> = {
  PENDING_REVIEW: { label: 'Chờ admin duyệt', tone: 'bg-warning/15 text-warning' },
  INVITED: { label: 'Chờ trả lời', tone: 'bg-warning/15 text-warning' },
  REJECTED: { label: 'Không được duyệt', tone: 'bg-danger/15 text-danger' },
  DECLINED: { label: 'Bị từ chối', tone: 'bg-surface-2 text-fg-muted' },
  EXPIRED: { label: 'Hết hạn', tone: 'bg-surface-2 text-fg-muted' },
  CANCELLED: { label: 'Đã hủy', tone: 'bg-surface-2 text-fg-muted' },
  REGISTRATION: { label: 'Đang đăng ký', tone: 'bg-brand/15 text-brand' },
  LOCKED: { label: 'Đã chốt danh sách', tone: 'bg-brand/15 text-brand' },
  LIVE: { label: 'Đang thi đấu', tone: 'bg-danger/15 text-danger' },
  SETTLING: { label: 'Đang tính kết quả', tone: 'bg-surface-2 text-fg-muted' },
  PROVISIONAL: { label: 'Kết quả tạm', tone: 'bg-warning/15 text-warning' },
  FINISHED: { label: 'Đã kết thúc', tone: 'bg-surface-2 text-fg-muted' },
}

const num = (v: number, d = 1) => v.toLocaleString('vi-VN', { maximumFractionDigits: d })

export function formatDuration(s: number) {
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60)
  return h ? `${h} giờ${m ? ` ${m} phút` : ''}` : `${m} phút`
}
export const formatPaceS = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}/km`

/** Điểm của một CLB (đúng đơn vị theo luật) */
export function formatScore(c: Pick<Cup, 'measure' | 'format'>, score: number | null | undefined): string {
  if (score == null) return '—'
  if (c.measure === 'PACE') return formatPaceS(score)
  const per = c.format === 'AVG' ? '/người' : ''
  if (c.measure === 'TIME') return `${formatDuration(score)}${per}`
  return `${num(score, 2)} km${per}`
}

/** Giá trị đóng góp một người (km / thời gian / pace) */
export function formatContribution(measure: MatchMeasure, r: { km: number; time_s?: number; moving_s?: number; pace_s?: number | null; value?: number }) {
  if (measure === 'PACE') return r.pace_s ? formatPaceS(r.pace_s) : '—'
  if (measure === 'TIME') return formatDuration(Number(r.value ?? r.time_s ?? r.moving_s ?? 0))
  return `${num(Number(r.value ?? r.km), 2)} km`
}

/** Luật thi đấu dạng câu ngắn, theo thứ tự quan trọng */
export function rulesSummary(c: Pick<Cup, 'format' | 'measure' | 'top_n' | 'min_roster' | 'max_roster' | 'daily_cap_km' | 'share_cap_pct' |
  'pace_min_km' | 'tiebreak' | 'lock_hours' | 'forfeit_rule' | 'final_delay_hours' | 'kind' | 'rules_version'>): string[] {
  if (!c.rules_version) {
    return [c.format === 'TOTAL' ? 'Tổng km của mọi thành viên' : 'Km trung bình mỗi thành viên', 'Mọi thành viên đều được tính, không cần đăng ký']
  }
  const what = c.measure === 'PACE'
    ? `Pace đội = tổng thời gian ÷ tổng km${c.format === 'TOP' ? ` của ${c.top_n} VĐV nhanh nhất` : ''}; chỉ xét người chạy từ ${num(c.pace_min_km)} km`
    : `${c.format === 'TOP' ? `Cộng ${c.top_n} VĐV giỏi nhất mỗi CLB` : c.format === 'TOTAL' ? 'Tổng cả đội' : 'Trung bình mỗi VĐV đăng ký'} · ${c.measure === 'TIME' ? 'thời gian chạy' : 'km'}`
  const out = [what]
  if (c.daily_cap_km) out.push(`Mỗi người tính tối đa ${num(c.daily_cap_km)} km/ngày${c.measure === 'TIME' ? ' (thời gian tính theo tỉ lệ)' : ''}`)
  if (c.share_cap_pct) out.push(`Mỗi người góp tối đa ${c.share_cap_pct}% tổng của đội`)
  out.push(`Mỗi CLB ${c.max_roster ? `${c.min_roster}–${c.max_roster}` : `từ ${c.min_roster}`} VĐV đăng ký${c.kind === 'DUEL' ? `; thiếu lúc chốt → ${c.forfeit_rule === 'CANCEL' ? 'hủy trận' : 'xử thua'}` : '; thiếu lúc chốt → xử thua'}`)
  out.push(c.lock_hours ? `Chốt danh sách ${c.lock_hours} giờ trước giờ bắt đầu` : 'Chốt danh sách đúng giờ bắt đầu')
  out.push(`Bằng điểm: ${TIEBREAK_LABEL[c.tiebreak]}`)
  out.push(`Kết quả chính thức ${c.final_delay_hours} giờ sau khi kết thúc (chờ bài đồng bộ muộn, bài đang duyệt)`)
  return out
}

export type SignupState =
  | { kind: 'NOT_MEMBER' }
  | { kind: 'WAITING' }                                   // trận chưa được nhận lời / chưa mở
  | { kind: 'CAN_SIGN'; clubId: string; deadline: string }
  | { kind: 'SIGNED'; clubId: string; canLeave: boolean }
  | { kind: 'NOT_ELIGIBLE'; clubId: string }              // vào CLB sau khi trận được tạo
  | { kind: 'LOCKED' }                                    // đã chốt danh sách mà mình chưa đăng ký
  | { kind: 'CLUB_NOT_IN' }                               // CLB của tôi chưa vào giải (nhiều CLB)
  | { kind: 'AUTO' }                                      // trận cũ: không cần đăng ký

/** Tôi cần làm gì để được tính cho CLB? */
export function signupState(c: Pick<Cup, 'status' | 'require_signup' | 'my_clubs' | 'my_signup' | 'roster_close_at' | 'end_at' | 'start_at' | 'rules_version'>, now: number): SignupState {
  if (!c.my_clubs.length) return { kind: 'NOT_MEMBER' }
  if (c.status !== 'OPEN') return c.my_signup ? { kind: 'SIGNED', clubId: c.my_signup, canLeave: false } : { kind: 'WAITING' }
  if (!c.require_signup) return { kind: 'AUTO' }
  const closeAt = Date.parse(c.roster_close_at)
  const open = now < closeAt && now < Date.parse(c.end_at)
  if (c.my_signup) return { kind: 'SIGNED', clubId: c.my_signup, canLeave: open && now < Date.parse(c.start_at) }
  const joined = c.my_clubs.filter((m) => m.joined)
  if (!joined.length) return { kind: 'CLUB_NOT_IN' }
  if (!open) return { kind: 'LOCKED' }
  const ok = joined.find((m) => m.eligible !== false)
  return ok ? { kind: 'CAN_SIGN', clubId: ok.id, deadline: c.roster_close_at } : { kind: 'NOT_ELIGIBLE', clubId: joined[0].id }
}

/** "còn 2 ngày 3 giờ" / "còn 45 phút" */
export function countdown(iso: string, now: number) {
  const ms = Date.parse(iso) - now
  if (ms <= 0) return 'đã qua'
  const m = Math.floor(ms / 60_000), h = Math.floor(m / 60), d = Math.floor(h / 24)
  if (d) return `còn ${d} ngày${h % 24 ? ` ${h % 24} giờ` : ''}`
  if (h) return `còn ${h} giờ${m % 60 ? ` ${m % 60} phút` : ''}`
  return `còn ${Math.max(1, m)} phút`
}

/** Trận 1–1: ai đang dẫn và cách bao xa ("Hồ Tây dẫn 12,5 km") */
export function duelLead(c: Pick<Cup, 'measure' | 'format' | 'standings'>): { leaderId: string | null; text: string } {
  const [a, b] = c.standings ?? []
  if (!a || !b || a.score == null || b.score == null) return { leaderId: null, text: 'Chưa có điểm' }
  if (a.forfeited !== b.forfeited) { const w = a.forfeited ? b : a; return { leaderId: w.club_id, text: `${w.name} thắng do đối thủ thiếu người` } }
  const diff = Math.abs(Number(a.score) - Number(b.score))
  if (diff === 0) return { leaderId: null, text: 'Đang hòa' }
  const lead = c.measure === 'PACE' ? (Number(a.score) < Number(b.score) ? a : b) : (Number(a.score) > Number(b.score) ? a : b)
  const gap = c.measure === 'PACE' ? `${Math.round(diff)} giây/km` : c.measure === 'TIME' ? formatDuration(diff) : `${num(diff, 2)} km`
  return { leaderId: lead.club_id, text: `${lead.name} dẫn ${gap}${c.format === 'AVG' && c.measure !== 'PACE' ? '/người' : ''}` }
}

const pad = (n: number) => String(n).padStart(2, '0')
export const toLocalInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`

/** Điều khoản mặc định: bắt đầu 00:00 ngày mai (hoặc ngày kia nếu đã khuya), 7 ngày, trung bình km, tối thiểu 3 VĐV */
export function defaultTerms(now: number): MatchTerms {
  const start = new Date(now); start.setHours(24, 0, 0, 0)
  if (start.getTime() - now < 3 * 3600_000) start.setDate(start.getDate() + 1)
  const end = new Date(start); end.setDate(end.getDate() + 7); end.setMinutes(-1)
  return { format: 'AVG', measure: 'KM', top_n: null, min_roster: 3, max_roster: null, daily_cap_km: 42, share_cap_pct: null, pace_min_km: 5,
    tiebreak: 'PARTICIPANTS', lock_hours: 1, forfeit_rule: 'FORFEIT', start_at: start.toISOString(), end_at: end.toISOString() }
}

/** Kiểm tra như máy chủ — null nếu hợp lệ */
export function validateTerms(t: MatchTerms, now: number, kind: 'CUP' | 'DUEL'): string | null {
  const s = Date.parse(t.start_at), e = Date.parse(t.end_at)
  if (!s || !e) return 'Chọn thời gian bắt đầu và kết thúc.'
  if (e <= s) return 'Thời gian kết thúc phải sau thời gian bắt đầu.'
  const days = (e - s) / 86400_000
  if (days < 1 || days > (kind === 'DUEL' ? 62 : 93)) return kind === 'DUEL' ? 'Trận đấu kéo dài từ 1 ngày đến 2 tháng.' : 'Thách đấu kéo dài từ 1 ngày đến 3 tháng.'
  if (s - t.lock_hours * 3600_000 < now + 30 * 60_000) return 'Giờ chốt danh sách phải sau hiện tại ít nhất 30 phút — chọn giờ bắt đầu muộn hơn.'
  if (t.format === 'TOP' && (!t.top_n || t.top_n < 1 || t.top_n > 50)) return 'Chọn số VĐV top từ 1 đến 50.'
  if (t.min_roster < 1 || t.min_roster > 100) return 'Số VĐV tối thiểu từ 1 đến 100.'
  if (t.max_roster != null && (t.max_roster < Math.max(t.min_roster, t.format === 'TOP' ? t.top_n ?? 1 : 1) || t.max_roster > 500)) return 'Số VĐV tối đa phải ≥ tối thiểu (và ≥ số top).'
  return null
}
