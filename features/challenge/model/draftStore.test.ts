import { describe, it, expect } from 'vitest'
import { defaultDraft } from './challenge'
import { clearDraft, draftKey, draftWorthSaving, DRAFT_TTL_MS, loadDraft, saveDraft } from './draftStore'

/** localStorage giả trong bộ nhớ */
const memory = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }
}
const now = Date.parse('2026-10-06T03:00:00Z')

describe('nháp tạo thử thách', () => {
  it('lưu theo người dùng + CLB; đọc lại đúng bước và nội dung', () => {
    const s = memory()
    const d = { ...defaultDraft(new Date(now), 'club-1'), title: 'Thử thách tuần 41', pledge: { ...defaultDraft().pledge, enabled: true, options: [21, 42] } }
    saveDraft('u1', 'club-1', d, 2, now, s)
    expect(s.m.has(draftKey('u1', 'club-1'))).toBe(true)
    expect(loadDraft('u1', null, now, s)).toBeNull()               // không CLB: nháp riêng
    expect(loadDraft('u2', 'club-1', now, s)).toBeNull()           // người khác
    const r = loadDraft('u1', 'club-1', now + 1000, s)!
    expect(r).toMatchObject({ step: 2, savedAt: now, draft: { title: 'Thử thách tuần 41', clubId: 'club-1', pledge: { enabled: true, options: [21, 42] } } })
    clearDraft('u1', 'club-1', s)
    expect(loadDraft('u1', 'club-1', now, s)).toBeNull()
  })
  it('nháp hỏng / quá hạn bị bỏ; bộ nhớ lỗi không làm vỡ màn hình', () => {
    const s = memory()
    s.setItem(draftKey('u1', null), '{không phải json')
    expect(loadDraft('u1', null, now, s)).toBeNull()
    s.setItem(draftKey('u1', null), JSON.stringify({ draft: { foo: 1 }, step: 1, savedAt: now }))
    expect(loadDraft('u1', null, now, s)).toBeNull()
    expect(s.m.size).toBe(0)
    saveDraft('u1', null, { ...defaultDraft(new Date(now)), title: 'Cũ' }, 9, now, s)
    expect(loadDraft('u1', null, now, s)?.step).toBe(3)            // bước kẹp về 0–3
    expect(loadDraft('u1', null, now + DRAFT_TTL_MS + 1, s)).toBeNull()
    const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('quota') }, removeItem: () => { throw new Error('x') } }
    expect(loadDraft('u1', null, now, broken)).toBeNull()
    expect(() => saveDraft('u1', null, defaultDraft(), 0, now, broken)).not.toThrow()
    expect(() => clearDraft('u1', null, broken)).not.toThrow()
    expect(loadDraft('u1', null, now, null)).toBeNull()
  })
  it('chỉ lưu khi đã có gì đáng giữ', () => {
    expect(draftWorthSaving(defaultDraft(), 0)).toBe(false)
    expect(draftWorthSaving({ ...defaultDraft(), title: 'A' }, 0)).toBe(true)
    expect(draftWorthSaving(defaultDraft(), 1)).toBe(true)
  })
})
