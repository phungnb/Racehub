import { describe, expect, it } from 'vitest'
import { ageInfo, centerSquare, diffDraft, maxBirthDate, toDraft, validateDraft, type MyProfile } from './profileForm'

const P: MyProfile = { id: 'u', display_name: 'Minh', avatar_url: null, bio: null, gender: null, birth_date: null, height_cm: null, weight_kg: null }
const today = new Date(2026, 8, 23)

describe('hồ sơ cá nhân — hàm thuần', () => {
  it('nhóm tuổi theo sinh nhật đã qua hay chưa', () => {
    expect(ageInfo('1992-05-20', today)).toEqual({ age: 34, group: '30–39' })
    expect(ageInfo('1996-12-01', today)).toEqual({ age: 29, group: '20–29' })
    expect(ageInfo('2010-01-01', today)?.group).toBe('Dưới 20')
    expect(ageInfo('1960-01-01', today)?.group).toBe('60+')
    expect(ageInfo('', today)).toBeNull()
  })
  it('kiểm tra form', () => {
    const ok = { ...toDraft(P), birth_date: '1990-01-01', height_cm: '170', weight_kg: '62,5' }
    expect(validateDraft(ok, today)).toEqual({})
    const bad = validateDraft({ ...ok, display_name: 'x', bio: 'a'.repeat(161), birth_date: maxBirthDate(new Date(2030, 0, 1)), height_cm: '20', weight_kg: 'abc' }, today)
    expect(Object.keys(bad).sort()).toEqual(['bio', 'birth_date', 'display_name', 'height_cm', 'weight_kg'])
  })
  it('chỉ gửi trường đã đổi; xoá bằng null; dấu phẩy thập phân', () => {
    const d = { ...toDraft(P), gender: 'female' as const, weight_kg: '62,5' }
    expect(diffDraft(P, d)).toEqual({ gender: 'female', weight_kg: 62.5 })
    expect(diffDraft({ ...P, height_cm: 170 }, { ...toDraft(P), height_cm: '' })).toEqual({ height_cm: null })
    expect(diffDraft(P, toDraft(P))).toEqual({})
  })
  it('cắt vuông giữa ảnh', () => {
    expect(centerSquare(1200, 800)).toEqual({ sx: 200, sy: 0, side: 800 })
    expect(centerSquare(600, 900)).toEqual({ sx: 0, sy: 150, side: 600 })
  })
})
