import { describe, it, expect } from 'vitest'
import { pushSupport, urlBase64ToUint8Array } from './push'

const base = { hasKey: true, production: true, hasSW: true, hasPush: true, ios: false, standalone: false }

describe('push: hỗ trợ trình duyệt', () => {
  it('iPhone phải cài app trước; thiếu khóa / không hỗ trợ báo rõ', () => {
    expect(pushSupport(base)).toBe('ok')
    expect(pushSupport({ ...base, ios: true, hasPush: false })).toBe('ios-install')
    expect(pushSupport({ ...base, ios: true, standalone: true })).toBe('ok')
    expect(pushSupport({ ...base, hasKey: false })).toBe('no-key')
    expect(pushSupport({ ...base, hasPush: false })).toBe('unsupported')
    expect(pushSupport({ ...base, production: false })).toBe('dev')
  })
  it('giải mã khóa VAPID base64url', () => {
    expect([...urlBase64ToUint8Array('AQID_-8')]).toEqual([1, 2, 3, 255, 239])
  })
})
