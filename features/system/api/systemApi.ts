// Thông báo hệ thống + nhật ký lỗi phía người dùng (migration 004400)
import { supabase } from '@/shared/lib/supabase'
import { toOps, type OpsPolicy } from '@/shared/lib/ops'
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

/** Đánh dấu lỗi đã xử lý (xoá khỏi nhật ký); không truyền mã = tất cả. Trả về số lần lỗi đã được xoá */
export async function resolveClientError(code: string | null): Promise<number> {
  const { data, error } = await supabase.rpc('admin_resolve_client_error', { p_code: code })
  if (error) throw error
  return Number(data ?? 0)
}

const MESSAGES: Record<string, string> = {
  INVALID_LEVEL: 'Mức thông báo không hợp lệ.',
  INVALID_TITLE: 'Tiêu đề cần 2–80 ký tự.',
  INVALID_MESSAGE: 'Nội dung tối đa 500 ký tự.',
  INVALID_TIME_RANGE: 'Thời điểm tự tắt phải ở tương lai.',
  FORBIDDEN: 'Chỉ quản trị hệ thống mới làm được việc này.',
  INVALID_CONFIG: 'Giá trị ngoài giới hạn cho phép — kiểm tra lại các ô vừa sửa.',
  VERSION_NOT_FOUND: 'Không tìm thấy phiên bản này.',
}

export function systemApiErrorMessage(e: unknown): string {
  const raw = (e as { message?: string } | null)?.message ?? ''
  const key = Object.keys(MESSAGES).find((k) => raw.includes(k))
  return key ? MESSAGES[key] : systemErrorMessage(e, 'Không thực hiện được. Hãy thử lại.')
}

// ---------------- Chính sách vận hành (009100) ----------------

export async function getOpsPolicy(): Promise<OpsPolicy> {
  const { data, error } = await supabase.rpc('ops_policy')
  if (error) throw error
  return toOps(data)
}

/** Gửi một phần là đủ: nhóm / thẻ không gửi giữ nguyên bản đang dùng */
export async function publishOpsPolicy(p: Partial<Pick<OpsPolicy, 'features' | 'tracking' | 'antiCheat'>> & { content?: Partial<OpsPolicy['content']> }, note: string): Promise<number> {
  const { data, error } = await supabase.rpc('admin_publish_ops_policy', { p, p_note: note || null })
  if (error) throw error
  return Number(data)
}

export type ConfigKey = 'economy_global_config' | 'ops_policy'
export interface ConfigVersion { version: number; status: string; created_at: string; by: string; value: Record<string, unknown> }

export async function getConfigHistory(key: ConfigKey): Promise<ConfigVersion[]> {
  const { data, error } = await supabase.rpc('admin_config_history', { p_key: key })
  if (error) throw error
  return (data ?? []) as ConfigVersion[]
}

export async function rollbackConfig(key: ConfigKey, version: number): Promise<number> {
  const { data, error } = await supabase.rpc('admin_rollback_config', { p_key: key, p_version: version })
  if (error) throw error
  return Number(data)
}
