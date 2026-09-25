// Thông báo hệ thống + nhật ký lỗi phía người dùng (migration 004400)
import { supabase } from '@/shared/lib/supabase'
import { systemErrorMessage } from '@/shared/lib/errors'
import type { ErrorKind } from '@/shared/lib/errors'

export type NoticeLevel = 'INFO' | 'WARNING' | 'MAINTENANCE'
export interface SystemNotice { level: NoticeLevel; title: string; message: string | null; until: string | null; updated_at: string }
export interface ClientErrorRow {
  code: string; kind: ErrorKind; message: string | null; path: string | null
  hits: number; users: number; days: number; first_at: string; last_at: string
}

export async function getSystemNotice(): Promise<SystemNotice | null> {
  const { data, error } = await supabase.rpc('system_notice')
  if (error) {
    // Máy chủ chưa chạy 004400 → coi như không có thông báo (không làm hỏng app)
    if (/PGRST202|could not find the function/i.test(`${error.code} ${error.message}`)) return null
    throw error
  }
  return (data ?? null) as SystemNotice | null
}

export async function setSystemNotice(p: { level: NoticeLevel; title: string; message?: string | null; until?: string | null } | null) {
  const { data, error } = await supabase.rpc('admin_set_system_notice', { p: p ?? {} })
  if (error) throw error
  return (data ?? null) as SystemNotice | null
}

export async function getClientErrors(days: number): Promise<ClientErrorRow[]> {
  const { data, error } = await supabase.rpc('admin_client_errors', { p_days: days })
  if (error) throw error
  return ((data ?? []) as ClientErrorRow[]).map((r) => ({ ...r, hits: Number(r.hits), users: Number(r.users), days: Number(r.days) }))
}

const MESSAGES: Record<string, string> = {
  INVALID_LEVEL: 'Mức thông báo không hợp lệ.',
  INVALID_TITLE: 'Tiêu đề cần 2–80 ký tự.',
  INVALID_MESSAGE: 'Nội dung tối đa 500 ký tự.',
  INVALID_TIME_RANGE: 'Thời điểm tự tắt phải ở tương lai.',
  FORBIDDEN: 'Chỉ quản trị hệ thống mới làm được việc này.',
}

export function systemApiErrorMessage(e: unknown): string {
  const raw = (e as { message?: string } | null)?.message ?? ''
  const key = Object.keys(MESSAGES).find((k) => raw.includes(k))
  return key ? MESSAGES[key] : systemErrorMessage(e, 'Không thực hiện được. Hãy thử lại.')
}
