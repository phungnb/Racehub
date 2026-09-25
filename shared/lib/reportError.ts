// Gửi lỗi người dùng gặp về máy chủ (Quản trị → Hệ thống) để đội ngũ biết sự cố trước khi có người báo.
// Mỗi mã lỗi chỉ gửi 1 lần / 5 phút / thiết bị; bỏ qua lỗi do mạng của người dùng hoặc phiên hết hạn.
import { supabase } from './supabase'
import { describeError, type ErrorKind } from './errors'

const SKIP: ErrorKind[] = ['OFFLINE', 'AUTH', 'RATE_LIMIT']
const sent = new Map<string, number>()
let disabled = false

export function reportError(e: unknown, path = typeof location === 'undefined' ? '' : location.pathname) {
  if (disabled || typeof window === 'undefined') return
  const d = describeError(e)
  if (SKIP.includes(d.kind)) return
  const now = Date.now()
  if ((sent.get(d.code) ?? 0) > now - 5 * 60_000) return
  sent.set(d.code, now)
  const message = String((e as { message?: string } | null)?.message ?? e ?? '').slice(0, 300)
  void supabase.rpc('log_client_error', { p_kind: d.kind, p_code: d.code, p_message: message, p_path: path.slice(0, 120) })
    .then(({ error }) => { if (error && /PGRST202|could not find/i.test(`${error.code} ${error.message}`)) disabled = true }, () => {})
}
