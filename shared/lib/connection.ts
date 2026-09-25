// Theo dõi "máy chủ có đang trả lời không": nhiều yêu cầu liên tiếp lỗi mạng / máy chủ → báo dải cảnh báo;
// một yêu cầu thành công → hết cảnh báo (và báo "đã kết nối lại").
import type { ErrorKind } from './errors'

export type ServerHealth = 'ok' | 'degraded'
const FAIL_KINDS: ErrorKind[] = ['NETWORK', 'TIMEOUT', 'SERVER']
const THRESHOLD = 2

let fails = 0
let health: ServerHealth = 'ok'
const listeners = new Set<(h: ServerHealth, prev: ServerHealth) => void>()

function set(next: ServerHealth) {
  if (next === health) return
  const prev = health
  health = next
  listeners.forEach((l) => l(next, prev))
}

export function noteRequestFailure(kind: ErrorKind) {
  if (!FAIL_KINDS.includes(kind)) return
  fails += 1
  if (fails >= THRESHOLD) set('degraded')
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
