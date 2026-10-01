// Bộ đo tốc độ (chỉ bật khi mở app với ?perf=1, tắt bằng ?perf=0): ghi thời gian từng yêu cầu máy chủ
// (RPC / bảng Supabase, /api, đăng nhập) và thời gian mở mỗi trang (từ lúc chuyển trang đến khi hết yêu cầu đang chờ).
// Người dùng thường không bị ảnh hưởng: khi tắt, hàm đo chỉ chuyển thẳng tới fetch gốc.

export interface PerfRequest { name: string; ms: number; status: number; at: number; route: string }
export interface PerfRoute { route: string; start: number; readyMs: number | null; requests: number }

const KEY = 'rh-perf'
const MAX = 300
let on: boolean | null = null
const requests: PerfRequest[] = []
const routes: PerfRoute[] = []
let pending = 0
let current: PerfRoute | null = null
let quietTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()
let version = 0

export function perfEnabled(): boolean {
  if (on !== null) return on
  if (typeof window === 'undefined') return false
  try {
    const q = new URLSearchParams(window.location.search).get('perf')
    if (q === '1') localStorage.setItem(KEY, '1')
    if (q === '0') localStorage.removeItem(KEY)
    on = localStorage.getItem(KEY) === '1'
  } catch { on = false }
  return on
}

export function disablePerf() {
  try { localStorage.removeItem(KEY) } catch { /* bỏ qua */ }
  on = false
  emit()
}

const emit = () => { version++; listeners.forEach((l) => l()) }
export const perfVersion = () => version
export function onPerf(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb) } }
/** Yêu cầu chưa xong (để thấy cái nào đang treo) */
const inflight = new Map<number, { name: string; t0: number }>()
let seq = 0
export const perfData = () => ({ requests, routes, inflight: [...inflight.values()] })

/** Tên dễ đọc: rpc/my_game_state · table/clubs · auth/token · api/strava/sync */
export function requestName(input: RequestInfo | URL): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  try {
    const u = new URL(raw, typeof window === 'undefined' ? 'http://x' : window.location.origin)
    const p = u.pathname
    let m = p.match(/\/rest\/v1\/rpc\/([\w-]+)/); if (m) return `rpc/${m[1]}`
    m = p.match(/\/rest\/v1\/([\w-]+)/); if (m) return `table/${m[1]}`
    m = p.match(/\/auth\/v1\/([\w/-]+)/); if (m) return `auth/${m[1]}`
    m = p.match(/\/storage\/v1\/object\/(?:public\/)?([\w-]+)/); if (m) return `storage/${m[1]}`
    if (p.startsWith('/api/')) return p.slice(1)
    return p
  } catch { return String(raw).slice(0, 60) }
}

function settle() {
  if (!current || pending > 0) return
  if (quietTimer) clearTimeout(quietTimer)
  const r = current
  quietTimer = setTimeout(() => {
    if (pending === 0 && r.readyMs === null) { r.readyMs = Math.round(lastEnd - r.start); emit() }
  }, 400)
}
let lastEnd = 0

/** Gọi khi đổi trang */
export function perfRouteStart(route: string) {
  if (!perfEnabled()) return
  current = { route, start: performance.now(), readyMs: null, requests: 0 }
  lastEnd = current.start
  routes.unshift(current)
  if (routes.length > 30) routes.pop()
  settle()
  emit()
}

/** fetch có đo — dùng cho client Supabase và có thể bọc các fetch /api */
export const perfFetch: typeof fetch = async (input, init) => {
  if (!perfEnabled()) return fetch(input, init)
  const t0 = performance.now()
  const id = ++seq
  inflight.set(id, { name: requestName(input), t0 })
  pending++
  if (current) current.requests++
  emit()
  let status = 0
  try {
    const res = await fetch(input, init)
    status = res.status
    return res
  } finally {
    inflight.delete(id)
    pending--
    lastEnd = performance.now()
    requests.unshift({ name: requestName(input), ms: Math.round(lastEnd - t0), status, at: Date.now(), route: current?.route ?? '' })
    if (requests.length > MAX) requests.pop()
    settle()
    emit()
  }
}
