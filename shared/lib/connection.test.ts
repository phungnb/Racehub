import { describe, expect, it } from 'vitest'
import { getServerHealth, noteRequestFailure, noteRequestSuccess, onServerHealth } from './connection'

describe('theo dõi máy chủ', () => {
  it('2 lỗi mạng / máy chủ liên tiếp → degraded; lỗi quyền không tính; thành công → ok', () => {
    const seen: string[] = []
    const off = onServerHealth((h, prev) => seen.push(`${prev}>${h}`))
    noteRequestFailure('SERVER')
    noteRequestFailure('FORBIDDEN')
    expect(getServerHealth()).toBe('ok')
    noteRequestFailure('NETWORK')
    expect(getServerHealth()).toBe('degraded')
    noteRequestSuccess()
    expect(getServerHealth()).toBe('ok')
    expect(seen).toEqual(['ok>degraded', 'degraded>ok'])
    off()
  })
})
