import { describe, expect, it } from 'vitest'
import { describeError, errorKind, shouldRetry, systemErrorMessage } from './errors'

describe('phân loại lỗi', () => {
  it('nhận đúng loại lỗi hệ thống', () => {
    expect(errorKind(new TypeError('Failed to fetch'))).toBe('NETWORK')
    expect(errorKind({ message: 'x' }, false)).toBe('OFFLINE')
    expect(errorKind({ message: 'JWT expired', code: 'PGRST301' })).toBe('AUTH')
    expect(errorKind({ code: 'PGRST202', message: 'Could not find the function public.my_quests without parameters in the schema cache' })).toBe('NOT_DEPLOYED')
    expect(errorKind({ code: '42501', message: 'permission denied for function x' })).toBe('FORBIDDEN')
    expect(errorKind({ status: 503, message: 'Service Unavailable' })).toBe('SERVER')
    expect(errorKind({ code: '', message: 'upstream connect error' })).toBe('SERVER')
    expect(errorKind({ message: 'INVALID_AMOUNT 500' })).toBe('UNKNOWN')
    expect(errorKind({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe('TIMEOUT')
    expect(errorKind({ message: 'INSUFFICIENT_BALANCE' })).toBe('UNKNOWN')
  })
  it('mã lỗi ổn định, không phụ thuộc id; không tự thử lại lỗi quyền / chưa cập nhật', () => {
    const a = describeError({ code: 'P0001', message: 'boom 5f1c2d4e-1111-2222-3333-444455556666' })
    const b = describeError({ code: 'P0001', message: 'boom 0a0b0c0d-aaaa-bbbb-cccc-ddddeeeeffff' })
    expect(a.code).toBe(b.code)
    expect(a.code).toMatch(/^UNK-[0-9A-Z]{3}$/)
    expect(shouldRetry({ code: 'PGRST202' })).toBe(false)
    expect(shouldRetry(new TypeError('Failed to fetch'))).toBe(true)
    expect(systemErrorMessage(new TypeError('Failed to fetch'))).toContain('Không kết nối được máy chủ')
  })
})
