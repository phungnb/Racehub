// Đồng phục CLB (migration 005800): ban quản trị CLB gửi mẫu áo → admin duyệt, đặt giá → vật phẩm chỉ thành viên CLB mua / mặc.
import { supabase } from '@/shared/lib/supabase'
import { systemErrorMessage } from '@/shared/lib/errors'
import type { CharacterItem, ItemPrint } from '../model/catalog'

export const UNIFORM_BUCKET = 'uniform-media'

export type UniformStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'

export interface UniformRequest {
  id: string
  club_id: string
  club_name: string | null
  requested_by: string | null
  requested_by_name: string | null
  name: string
  color: string
  print: ItemPrint
  note: string | null
  status: UniformStatus
  review_note: string | null
  item_code: string | null
  item: (CharacterItem & { owners?: number }) | null
  created_at: string
  reviewed_at: string | null
}

export interface UniformInput { name: string; color: string; print: ItemPrint; note?: string | null }

export async function listClubUniforms(clubId: string): Promise<UniformRequest[]> {
  const { data, error } = await supabase.rpc('club_uniforms', { p_club_id: clubId })
  if (error) throw error
  return (data ?? []) as UniformRequest[]
}

export async function requestClubUniform(clubId: string, p: UniformInput): Promise<UniformRequest> {
  const { data, error } = await supabase.rpc('request_club_uniform', { p_club_id: clubId, p })
  if (error) throw error
  return data as UniformRequest
}

export async function cancelUniformRequest(id: string) {
  const { error } = await supabase.rpc('cancel_club_uniform_request', { p_id: id })
  if (error) throw error
}

/** Tải logo in áo: uniform-media/<thư mục>/<mốc thời gian>.<đuôi>. CLB dùng thư mục = club_id (quyền kho kiểm tra) */
export async function uploadPrintLogo(folder: string, file: File): Promise<string> {
  const ext = file.type === 'image/webp' ? 'webp' : file.type === 'image/jpeg' ? 'jpg' : 'png'
  const path = `${folder}/${Date.now()}.${ext}`
  const { error } = await supabase.storage.from(UNIFORM_BUCKET).upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw error
  return supabase.storage.from(UNIFORM_BUCKET).getPublicUrl(path).data.publicUrl
}

const MESSAGES: Record<string, string> = {
  TOO_MANY_REQUESTS: 'CLB đang có 3 mẫu chờ duyệt. Chờ admin duyệt hoặc hủy bớt.',
  INVALID_PRINT: 'Nội dung in chưa hợp lệ: cần ít nhất logo, chữ hoặc tên runner; logo phải tải lên từ đây.',
  INVALID_COLOR: 'Màu áo không hợp lệ.',
  INVALID_NAME: 'Tên mẫu áo cần từ 2 ký tự.',
  REQUEST_CLOSED: 'Yêu cầu này đã được xử lý.',
  FORBIDDEN: 'Chỉ chủ nhiệm / đội trưởng CLB làm được việc này.',
  'row-level security': 'Không có quyền tải logo lên kho của CLB này.',
  'exceeded the maximum allowed size': 'Logo tối đa 2 MB.',
}

export function uniformErrorMessage(e: unknown): string {
  const msg = (e as { message?: string } | null)?.message ?? ''
  const key = Object.keys(MESSAGES).find((k) => msg.includes(k))
  return key ? MESSAGES[key] : systemErrorMessage(e, 'Không thực hiện được. Hãy thử lại.')
}
