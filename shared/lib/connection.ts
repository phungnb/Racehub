// Theo dõi "máy chủ có đang trả lời không": lỗi mạng / máy chủ kéo dài → báo dải cảnh báo;
// một yêu cầu thành công → hết cảnh báo (và báo "đã kết nối lại").
// Tránh báo oan:
//  • nhiều yêu cầu song song cùng hỏng trong một lần chập mạng chỉ tính là MỘT lần (phải lỗi rải rác ≥ 4 giây);
//  • app đang ẩn / vừa mở lại từ nền (iPhone hay làm hỏng vài yêu cầu đầu tiên: "Load failed") → không tính.
import type { ErrorKind } from './errors'

export type ServerHealth = 'ok' | 'degraded'
const FAIL_KINDS: ErrorKind[] = ['NETWORK', 'TIMEOUT', 'SERVER']
const MIN_FAILS = 2
const MIN_SPAN_MS = 4000
const RESUME_GRACE_MS = 5000

let fails = 0
let firstFailAt = 0
let resumedAt = 0
let health: ServerHealth = 'ok'
const listeners = new Set<(h: ServerHealth, prev: ServerHealth) => void>()

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resumedAt = Date.now() })
}

function set(next: ServerHealth) {
  if (next === health) return
  const prev = health
  health = next
  listeners.forEach((l) => l(next, prev))
}

/** App đang ẩn hoặc vừa mở lại từ nền: lỗi mạng lúc này thường do điện thoại chưa kịp nối mạng lại, không phải máy chủ */
export const isResumeNoise = (now = Date.now()) =>
  typeof document !== 'undefined' && (document.visibilityState === 'hidden' || now - resumedAt < RESUME_GRACE_MS)

export function noteRequestFailure(kind: ErrorKind, now = Date.now()) {
  if (!FAIL_KINDS.includes(kind)) return
  if (isResumeNoise(now)) return
  if (fails === 0) firstFailAt = now
  fails += 1
  if (fails >= MIN_FAILS && now - firstFailAt >= MIN_SPAN_MS) set('degraded')
}

export function noteRequestSuccess() {
  fails = 0
  set('ok')
}

export const getServerHealth = () => health
export function onServerHealth(cb: (h: ServerHealth, prev: ServerHealth) => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}
