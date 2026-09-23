import 'server-only'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

// Tham số `state` của OAuth = payload + chữ ký HMAC.
// Chống giả mạo: không ai tạo được state hợp lệ nếu không có OAUTH_STATE_SECRET.
// Chống CSRF gắn tài khoản: nonce trong state phải khớp cookie httpOnly của chính trình duyệt đã bắt đầu luồng.

export const OAUTH_NONCE_COOKIE = 'rh_oauth_nonce'
const TTL_SECONDS = 10 * 60

interface StatePayload {
  uid: string
  provider: string
  nonce: string
  exp: number
}

const b64 = (buf: Buffer) => buf.toString('base64url')

function sign(data: string, secret: string) {
  return b64(createHmac('sha256', secret).update(data).digest())
}

export function createOAuthState(uid: string, provider: string, secret: string) {
  const nonce = b64(randomBytes(24))
  const payload: StatePayload = { uid, provider, nonce, exp: Math.floor(Date.now() / 1000) + TTL_SECONDS }
  const data = b64(Buffer.from(JSON.stringify(payload)))
  return { state: `${data}.${sign(data, secret)}`, nonce, maxAge: TTL_SECONDS }
}

export type StateCheck =
  | { ok: true; payload: StatePayload }
  | { ok: false; reason: 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED' | 'NONCE_MISMATCH' | 'WRONG_PROVIDER' }

export function verifyOAuthState(state: string, cookieNonce: string | undefined, provider: string, secret: string): StateCheck {
  const [data, sig] = state.split('.')
  if (!data || !sig) return { ok: false, reason: 'MALFORMED' }

  const expected = Buffer.from(sign(data, secret))
  const actual = Buffer.from(sig)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: 'BAD_SIGNATURE' }
  }

  let payload: StatePayload
  try {
    payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'MALFORMED' }
  }
  if (payload.provider !== provider) return { ok: false, reason: 'WRONG_PROVIDER' }
  if (payload.exp < Math.floor(Date.now() / 1000)) return { ok: false, reason: 'EXPIRED' }
  if (!cookieNonce || cookieNonce !== payload.nonce) return { ok: false, reason: 'NONCE_MISMATCH' }
  return { ok: true, payload }
}
