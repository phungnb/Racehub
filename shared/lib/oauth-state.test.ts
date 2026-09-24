import { describe, expect, it, vi, afterEach } from 'vitest'
import { createOAuthState, verifyOAuthState } from './oauth-state'

const SECRET = 'x'.repeat(40)
const UID = '00000000-0000-0000-0000-000000000001'

describe('OAuth state', () => {
  afterEach(() => vi.useRealTimers())

  it('chấp nhận state hợp lệ với đúng nonce cookie', () => {
    const { state, nonce } = createOAuthState(UID, 'STRAVA', SECRET)
    const r = verifyOAuthState(state, nonce, 'STRAVA', SECRET)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.payload.uid).toBe(UID)
  })

  it('từ chối state bị sửa uid (giả mạo người dùng khác)', () => {
    const { state, nonce } = createOAuthState(UID, 'STRAVA', SECRET)
    const [data, sig] = state.split('.')
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString())
    payload.uid = 'victim'
    const forged = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${sig}`
    expect(verifyOAuthState(forged, nonce, 'STRAVA', SECRET)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' })
  })

  it('từ chối khi nonce cookie không khớp (link do người khác tạo)', () => {
    const { state } = createOAuthState(UID, 'STRAVA', SECRET)
    expect(verifyOAuthState(state, 'other', 'STRAVA', SECRET)).toEqual({ ok: false, reason: 'NONCE_MISMATCH' })
    expect(verifyOAuthState(state, undefined, 'STRAVA', SECRET)).toEqual({ ok: false, reason: 'NONCE_MISMATCH' })
  })

  it('từ chối state hết hạn, sai secret, sai provider, sai định dạng', () => {
    vi.useFakeTimers()
    const { state, nonce } = createOAuthState(UID, 'STRAVA', SECRET)
    expect(verifyOAuthState(state, nonce, 'STRAVA', 'y'.repeat(40)).ok).toBe(false)
    expect(verifyOAuthState(state, nonce, 'GARMIN', SECRET)).toEqual({ ok: false, reason: 'WRONG_PROVIDER' })
    expect(verifyOAuthState('abc', nonce, 'STRAVA', SECRET)).toEqual({ ok: false, reason: 'MALFORMED' })
    vi.advanceTimersByTime(11 * 60 * 1000)
    expect(verifyOAuthState(state, nonce, 'STRAVA', SECRET)).toEqual({ ok: false, reason: 'EXPIRED' })
  })
})
