// Nháp tạo thử thách: lưu ở máy (localStorage) theo người dùng + CLB để quay lại không phải làm lại từ đầu.
// Chỉ là tiện ích trên máy này — không đồng bộ; hỏng / bị chặn thì coi như không có nháp.
import { defaultDraft, type ChallengeDraft } from './challenge'

const PREFIX = 'racehub:challenge-draft:v1'
/** Nháp quá 14 ngày thì bỏ (thời gian, luật đã cũ) */
export const DRAFT_TTL_MS = 14 * 86_400_000

export interface SavedChallengeDraft { draft: ChallengeDraft; step: number; savedAt: number }
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const draftKey = (userId: string, clubId: string | null | undefined) => `${PREFIX}:${userId}:${clubId || 'none'}`

const browserStore = (): Store | null => {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

/** Đọc nháp; sai cấu trúc / quá hạn → null (và xoá luôn) */
export function loadDraft(userId: string, clubId: string | null | undefined, now = Date.now(), s: Store | null = browserStore()): SavedChallengeDraft | null {
  if (!s) return null
  const key = draftKey(userId, clubId)
  try {
    const raw = s.getItem(key)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<SavedChallengeDraft> | null
    const d = v?.draft as Partial<ChallengeDraft> | undefined
    if (!v || !d || typeof d !== 'object' || typeof d.format !== 'string' || typeof d.title !== 'string' || typeof v.savedAt !== 'number'
        || now - v.savedAt > DRAFT_TTL_MS) {
      s.removeItem(key)
      return null
    }
    // Ghép lên nháp mặc định: trường thêm về sau vẫn có giá trị
    const base = defaultDraft(new Date(now), clubId ?? null)
    return {
      draft: { ...base, ...d, pledge: { ...base.pledge, ...d.pledge }, conquest: d.conquest ? { ...base.conquest, ...d.conquest } : base.conquest, rules: d.rules ?? {} },
      step: Math.min(3, Math.max(0, Math.trunc(Number(v.step) || 0))),
      savedAt: v.savedAt,
    }
  } catch {
    return null
  }
}

export function saveDraft(userId: string, clubId: string | null | undefined, draft: ChallengeDraft, step: number,
  now = Date.now(), s: Store | null = browserStore()) {
  if (!s) return
  try { s.setItem(draftKey(userId, clubId), JSON.stringify({ draft, step, savedAt: now } satisfies SavedChallengeDraft)) } catch { /* đầy bộ nhớ / bị chặn: bỏ qua */ }
}

export function clearDraft(userId: string, clubId: string | null | undefined, s: Store | null = browserStore()) {
  if (!s) return
  try { s.removeItem(draftKey(userId, clubId)) } catch { /* bị chặn: bỏ qua */ }
}

/** Nháp có gì đáng giữ không (đã đặt tên / mô tả hoặc đã qua bước đầu) */
export const draftWorthSaving = (d: ChallengeDraft, step: number) => step > 0 || d.title.trim().length > 0 || d.description.trim().length > 0
