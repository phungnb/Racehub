import { describe, it, expect } from 'vitest'
import { accentOf, canManage, clubRank, isStaff } from './roles'

describe('vai trò CLB', () => {
  it('thứ bậc và quyền quản lý khớp với club_rank() trong DB', () => {
    expect(clubRank('OWNER')).toBeGreaterThan(clubRank('CAPTAIN'))
    expect(isStaff('CAPTAIN')).toBe(true)
    expect(isStaff('MEMBER')).toBe(false)
    expect(canManage('OWNER', 'CAPTAIN')).toBe(true)
    expect(canManage('CAPTAIN', 'MEMBER')).toBe(true)
    expect(canManage('CAPTAIN', 'CAPTAIN')).toBe(false)
    expect(canManage('MEMBER', 'MEMBER')).toBe(false)
  })
  it('màu CLB mặc định là màu thương hiệu', () => {
    expect(accentOf({ accent_color: null })).toBe('#b6ff3b')
    expect(accentOf({ accent_color: '#38bdf8' })).toBe('#38bdf8')
  })
})
