import { describe, expect, it } from 'vitest'
import { getServerHealth, noteRequestFailure, noteRequestSuccess, onServerHealth } from './connection'

describe('theo dõi máy chủ', () => {
  it('lỗi mạng / máy chủ rải rác ≥ 4 giây → degraded; lỗi quyền không tính; thành công → ok', () => {
    const seen: string[] = []
    const off = onServerHealth((h, prev) => seen.push(`${prev}>${h}`))
    const t = 1_000_000
    noteRequestFailure('SERVER', t)
    noteRequestFailure('FORBIDDEN', t + 100)
    expect(getServerHealth()).toBe('ok')
    noteRequestFailure('NETWORK', t + 4500)
    expect(getServerHealth()).toBe('degraded')
    noteRequestSuccess()
    expect(getServerHealth()).toBe('ok')
    expect(seen).toEqual(['ok>degraded', 'degraded>ok'])
    off()
  })

  it('nhiều yêu cầu cùng hỏng trong một lần chập mạng → chưa báo', () => {
    const t = 2_000_000
    noteRequestFailure('NETWORK', t)
    noteRequestFailure('NETWORK', t + 50)
    noteRequestFailure('NETWORK', t + 120)
    expect(getServerHealth()).toBe('ok')
    noteRequestSuccess()
  })
})
