import { describe, it, expect } from 'vitest'
import { nameFromEmail, nextStep, parseInviteCode, parseStep, prevStep, stepNumber } from './steps'

describe('onboarding: bước', () => {
  it('đọc bước từ URL, bước lạ về đầu; tiến/lùi không vượt biên', () => {
    expect(parseStep('club')).toBe('club')
    expect(parseStep('xyz')).toBe('profile')
    expect(parseStep(null)).toBe('profile')
    expect(nextStep('notify')).toBe('done')
    expect(nextStep('done')).toBe('done')
    expect(prevStep('profile')).toBeNull()
    expect(prevStep('device')).toBe('profile')
    expect(stepNumber('profile')).toBe(1)
    expect(stepNumber('done')).toBe(4)
  })
  it('gợi ý tên từ email, mã mời từ link', () => {
    expect(nameFromEmail('lan.nguyen92@gmail.com')).toBe('Lan Nguyen')
    expect(nameFromEmail('')).toBe('')
    expect(parseInviteCode('https://racehub.vn/club/join/hotay9?x=1')).toBe('hotay9')
    expect(parseInviteCode('  HOTAY 9 ')).toBe('HOTAY9')
  })
})
