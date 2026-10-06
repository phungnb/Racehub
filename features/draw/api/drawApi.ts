// Quay thưởng dùng chung toàn app (migration 008400, sân khấu 009300): chiến dịch tổ chức, thử thách, CLB, giải chạy, toàn hệ thống.
import { supabase } from '@/shared/lib/supabase'
import { systemErrorMessage } from '@/shared/lib/errors'

export type DrawScope = 'ORG_CAMPAIGN' | 'CHALLENGE' | 'CLUB' | 'RACE' | 'SYSTEM'
export type DrawRule = 'COMPLETED' | 'ACTIVE' | 'ALL' | 'PICKED' | 'EVENT' | 'MANUAL'
export interface DrawWinner {
  /** 009500: khoá người trúng — mã người dùng, hoặc "số dòng|tên" với danh sách dán (user_id rỗng) */
  key: string
  user_id: string | null; name: string; avatar_url: string | null; prize: string; position: number; me: boolean
  /** 009300: suất thuộc giải thứ mấy; ABSENT = vắng mặt, suất đã quay lại cho người khác */
  prize_idx: number | null; status: 'WON' | 'ABSENT'
}
export interface DrawCandidate { user_id: string; name: string; avatar_url: string | null; completed: boolean }
export interface LuckyDraw {
  id: string; scope: DrawScope; ref_id: string | null; title: string; rule: DrawRule
  /** 013500: PENDING = quay xong, chờ Ban tổ chức chấp nhận (DONE, công bố) hoặc huỷ kết quả (về READY để quay lại) */
  prizes: { name: string; qty: number }[]; exclude_winners: boolean; status: 'READY' | 'LIVE' | 'PENDING' | 'DONE' | 'CANCELLED'
  seed: string | null; entrant_count: number | null; entrants_hash: string | null; created_at: string; run_at: string | null
  can_manage: boolean; creator_name: string | null; winners: DrawWinner[]; eligible_now: number | null
  /** 009300: mã băm seed công bố lúc bắt đầu quay; seed chỉ hiện sau khi công bố kết quả */
  seed_hash?: string | null; started_at?: string | null; picked_count?: number; excluded_count?: number
  /** Tên chạy trong vòng quay (khi đang quay) */
  reel?: { name: string; avatar_url: string | null }[] | null
  /** 009500: buổi điểm danh (EVENT), số dòng dán (MANUAL), nhà tài trợ */
  event?: { id: string; title: string; starts_at: string } | null; manual_count?: number
  sponsor?: { name: string; logo_url: string | null } | null
  /** 013500: ai / lúc nào chấp nhận (lượt DONE cũ: rỗng = coi như đã chấp nhận); số lần huỷ kết quả (mọi người thấy) */
  confirmed_at?: string | null; confirmed_by_name?: string | null; reject_count?: number
  /** 013500: nhật ký huỷ kết quả — chỉ người quản lý nhận được */
  rejections?: DrawRejection[] | null
}
export interface DrawRejection {
  id: string; at: string; by_name: string | null; reason: string | null; seed: string | null; seed_hash: string | null; entrant_count: number | null
  winners: { key: string; name: string; prize: string; prize_idx: number | null; position: number; status: 'WON' | 'ABSENT' }[]
}
export interface DrawEvent { id: string; title: string; starts_at: string; checked_in: number }
export interface DrawInput {
  title: string; rule: DrawRule; prizes: { name: string; qty: number }[]; exclude_winners: boolean; picked?: string[]; excluded?: string[]
  names?: string[]; event_id?: string | null; sponsor?: { name: string; logo_url: string | null } | null
}

const call = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}

export const listDraws = (scope: DrawScope, refId: string | null) => call<LuckyDraw[]>('lucky_draws_for', { p_scope: scope, p_ref: refId })
export const createDraw = (scope: DrawScope, refId: string | null, p: DrawInput) =>
  call<LuckyDraw>('create_lucky_draw', { p_scope: scope, p_ref: refId, p })
export const listCandidates = (scope: DrawScope, refId: string | null) => call<DrawCandidate[]>('lucky_draw_candidates', { p_scope: scope, p_ref: refId })
export const startDraw = (id: string) => call<LuckyDraw>('start_lucky_draw', { p_id: id })
export const drawNext = (id: string, prize: number) => call<LuckyDraw>('draw_next', { p_id: id, p_prize: prize })
export const drawAbsent = (id: string, key: string) => call<LuckyDraw>('draw_absent_key', { p_id: id, p_key: key })
export const listDrawEvents = (clubId: string) => call<DrawEvent[]>('club_draw_events', { p_club: clubId })

/** Logo nhà tài trợ (lượt quay của CLB): bucket club-media, thư mục <club_id>/<user_id>/ như ảnh bài đăng */
export async function uploadSponsorLogo(clubId: string, file: File): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('NOT_AUTHENTICATED')
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${clubId}/${user.id}/sponsor-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('club-media').upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw error
  return supabase.storage.from('club-media').getPublicUrl(path).data.publicUrl
}
/** Kết thúc quay → chờ xác nhận (013500: chưa công bố) */
export const finishDraw = (id: string) => call<LuckyDraw>('finish_lucky_draw', { p_id: id })
/** Chấp nhận kết quả → chính thức: báo người trúng, đăng bảng tin */
export const confirmDraw = (id: string) => call<LuckyDraw>('confirm_lucky_draw', { p_id: id })
/** Huỷ kết quả → ghi nhật ký, xoá người trúng, lượt quay về "Chờ quay" để quay lại */
export const rejectDraw = (id: string, reason: string | null) => call<LuckyDraw>('reject_lucky_draw', { p_id: id, p_reason: reason?.trim() || null })
export const runDraw = (id: string) => call<LuckyDraw>('run_lucky_draw', { p_id: id })
export const cancelDraw = (id: string) => call<void>('cancel_lucky_draw', { p_id: id })

const MESSAGES: Record<string, string> = {
  NO_ENTRANTS: 'Chưa có ai đủ điều kiện quay (hoặc tất cả đã trúng ở lượt trước).',
  DRAW_CLOSED: 'Lượt quay này đã quay hoặc đã huỷ.',
  INVALID_PRIZES: 'Nhập 1–10 giải, tổng tối đa 200 suất.',
  TITLE_REQUIRED: 'Tên lượt quay cần 3–120 ký tự.',
  TOO_MANY_DRAWS: 'Đang có 5 lượt quay chờ. Quay hoặc huỷ bớt trước.',
  PICK_REQUIRED: 'Hãy chọn ít nhất một người thuộc chương trình.',
  TOO_MANY_PEOPLE: 'Chọn tối đa 2.000 người.',
  DRAW_NOT_LIVE: 'Lượt quay chưa bắt đầu hoặc đã kết thúc.',
  PRIZE_FULL: 'Giải này đã đủ người trúng. Chọn giải khác.',
  POOL_EXHAUSTED: 'Đã hết người trong danh sách để quay.',
  NOT_A_WINNER: 'Người này không còn trong danh sách trúng.',
  NO_WINNERS: 'Chưa có ai trúng — quay ít nhất một giải trước khi kết thúc.',
  DRAW_STARTED: 'Đã quay ra người trúng nên không huỷ được lượt này. Hãy quay tiếp rồi bấm Kết thúc — sau đó Chấp nhận hoặc Huỷ kết quả.',
  DRAW_NOT_PENDING: 'Lượt quay này không còn chờ xác nhận (đã chấp nhận, đã huỷ kết quả hoặc chưa quay xong). Tải lại để xem trạng thái mới.',
  REASON_TOO_LONG: 'Lý do huỷ tối đa 300 ký tự.',
  NAMES_REQUIRED: 'Dán ít nhất một tên (mỗi dòng một người).',
  EVENT_REQUIRED: 'Chọn một buổi của CLB.',
  INVALID_SPONSOR: 'Tên nhà tài trợ tối đa 80 ký tự; logo phải là ảnh https.',
  FORBIDDEN: 'Bạn không có quyền làm việc này.',
}
export function drawErrorMessage(e: unknown): string {
  const raw = (e as { message?: string } | null)?.message ?? ''
  const key = Object.keys(MESSAGES).sort((a, b) => b.length - a.length).find((k) => raw.includes(k))
  return key ? MESSAGES[key] : systemErrorMessage(e, 'Không thực hiện được. Hãy thử lại.')
}
