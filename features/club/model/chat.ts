// Logic thuần cho màn trò chuyện CLB: gom tin, nhãn ngày, nhắc tên (@).

export interface ChatMessageLike {
  id: string
  author_id: string
  created_at: string
  deleted_at?: string | null
}

export type ChatItem<M> =
  | { type: 'day'; key: string; label: string }
  | { type: 'msg'; key: string; message: M; groupStart: boolean; groupEnd: boolean }

const GROUP_GAP_MS = 5 * 60_000
const WEEKDAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy']

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

export function dayLabel(d: Date, now: Date = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diff = Math.round((today.getTime() - that.getTime()) / 86_400_000)
  if (diff === 0) return 'Hôm nay'
  if (diff === 1) return 'Hôm qua'
  const dm = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
  if (diff > 1 && diff < 7) return `${WEEKDAYS[d.getDay()]}, ${dm}`
  return d.getFullYear() === now.getFullYear() ? dm : `${dm}/${d.getFullYear()}`
}

/** Tin sắp xếp cũ → mới. Chèn nhãn ngày; gom tin liên tiếp của cùng người trong 5 phút. */
export function groupMessages<M extends ChatMessageLike>(messages: M[], now: Date = new Date()): ChatItem<M>[] {
  const out: ChatItem<M>[] = []
  let lastDay = ''
  messages.forEach((m, i) => {
    const d = new Date(m.created_at)
    const k = dayKey(d)
    if (k !== lastDay) {
      out.push({ type: 'day', key: `day-${k}`, label: dayLabel(d, now) })
      lastDay = k
    }
    const prev = messages[i - 1]
    const next = messages[i + 1]
    const joins = (a?: M, b?: M) => !!a && !!b && a.author_id === b.author_id && !a.deleted_at && !b.deleted_at &&
      dayKey(new Date(a.created_at)) === dayKey(new Date(b.created_at)) &&
      Math.abs(new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) <= GROUP_GAP_MS
    out.push({ type: 'msg', key: m.id, message: m, groupStart: !joins(prev, m), groupEnd: !joins(m, next) })
  })
  return out
}

export interface Mentionable { user_id: string; name: string }

/** Ai được nhắc trong nội dung ("@Tên đầy đủ"). Ưu tiên tên dài hơn để "@An Nguyễn" không khớp nhầm "@An". */
export function findMentions(body: string, members: Mentionable[]): string[] {
  const text = body.toLocaleLowerCase('vi')
  const found = new Set<string>()
  const sorted = [...members].filter((m) => m.name.trim()).sort((a, b) => b.name.length - a.name.length)
  let masked = text
  for (const m of sorted) {
    const token = `@${m.name.trim().toLocaleLowerCase('vi')}`
    const at = masked.indexOf(token)
    if (at === -1) continue
    const after = masked[at + token.length]
    if (after && /[\p{L}\p{N}]/u.test(after)) continue
    found.add(m.user_id)
    masked = masked.slice(0, at) + ' '.repeat(token.length) + masked.slice(at + token.length)
  }
  return [...found]
}

/** Từ đang gõ sau dấu @ tại vị trí con trỏ (để gợi ý tên). null nếu không đang nhắc ai. */
export function mentionQuery(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at === -1) return null
  if (at > 0 && !/\s/.test(before[at - 1])) return null
  const q = before.slice(at + 1)
  if (q.length > 30 || /\n/.test(q) || /\s{2}/.test(q)) return null
  return { query: q, start: at }
}

/** Thay "@truy vấn" đang gõ bằng "@Tên " */
export function applyMention(text: string, start: number, caret: number, name: string) {
  const next = `${text.slice(0, start)}@${name} ${text.slice(caret)}`
  return { text: next, caret: start + name.length + 2 }
}
