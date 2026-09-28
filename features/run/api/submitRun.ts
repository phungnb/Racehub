// Gửi bài chạy lên máy chủ. Mất mạng / máy chủ lỗi → cất vào hàng chờ trên máy (tự gửi sau), người chạy không mất bài.
import { supabase } from '@/shared/lib/supabase'
import { describeError } from '@/shared/lib/errors'
import { clearSnapshot, enqueue, type RunPayload } from '../model/recovery'

export interface SaveResult {
  activity_id?: string
  validation_status: 'APPROVED' | 'PENDING' | 'REJECTED'
  validation_reason: string
  earned_xu: number
  earned_xp: number
  distance_m: number
}

export type SubmitOutcome =
  | { kind: 'SAVED'; result: SaveResult }
  | { kind: 'DUPLICATE' }            // đã gửi rồi (bấm Lưu lần hai / hàng chờ gửi trước)
  | { kind: 'QUEUED' }               // chưa gửi được, đã cất vào hàng chờ trên máy
  | { kind: 'FAILED' }               // lỗi khác: giữ bài dở dang trên máy để thử lại

const RETRYABLE = new Set(['OFFLINE', 'NETWORK', 'TIMEOUT', 'SERVER'])

export async function submitRun(payload: RunPayload, quality: Record<string, unknown>, uid?: string): Promise<SubmitOutcome> {
  const { data, error } = await supabase.rpc('submit_and_process_activity', payload)
  if (error) {
    if (error.message.includes('ACTIVITY_DUPLICATE')) { clearSnapshot(); return { kind: 'DUPLICATE' } }
    if (!RETRYABLE.has(describeError(error).kind)) return { kind: 'FAILED' }
    enqueue(payload, Date.now(), undefined, quality, uid)
    clearSnapshot()
    window.dispatchEvent(new Event('rh-run-queued'))
    return { kind: 'QUEUED' }
  }
  // Không chặn người chạy: gắn tóm tắt chất lượng GPS phía sau (máy chủ chưa chạy 008800 thì bỏ qua)
  void supabase.rpc('activity_attach_gps_quality', { p_started_at: payload.p_started_at, p_quality: quality })
  clearSnapshot()
  return { kind: 'SAVED', result: data as SaveResult }
}
