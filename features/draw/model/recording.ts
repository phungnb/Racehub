// Ghi hình buổi quay thưởng (chỉnh sửa lần 7) — phần logic thuần, không đụng DOM: chọn định dạng video, kiểm tra trình duyệt,
// tên file, đồng hồ ghi. Cách ghi: vẽ lại vùng quay (tên giải, ô quay, người trúng) lên một canvas riêng rồi
// canvas.captureStream() → MediaRecorder. Chỉ vùng quay vào video; nút Chấp nhận / Huỷ kết quả, thanh công cụ nằm ngoài.
// Xem docs/QUAY_THUONG_VIDEO.md.
import { searchKey } from '@/shared/lib/search'

/** Ưu tiên WebM (Chrome, Android WebView, Firefox); Safari chỉ có MP4 */
export const VIDEO_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1', 'video/mp4'] as const

export function pickVideoType(isSupported: (type: string) => boolean): string | null {
  for (const t of VIDEO_TYPES) {
    try { if (isSupported(t)) return t } catch { /* trình duyệt cũ ném lỗi với chuỗi lạ */ }
  }
  return null
}

export const videoExt = (type: string) => (type.startsWith('video/mp4') ? 'mp4' : 'webm')

export interface RecordEnv {
  MediaRecorder?: { isTypeSupported?: (type: string) => boolean } | undefined
  canvasCaptureStream: boolean
}
export type RecordSupport = { ok: true; type: string } | { ok: false; reason: string }

/** Trình duyệt ghi được vùng quay không; không được thì lý do ngắn để hiện thay cho nút */
export function recordSupport(env: RecordEnv): RecordSupport {
  if (!env.MediaRecorder) return { ok: false, reason: 'Trình duyệt này chưa hỗ trợ ghi video (MediaRecorder). Dùng Chrome / Edge bản mới, hoặc quay màn hình bằng điện thoại.' }
  if (!env.canvasCaptureStream) return { ok: false, reason: 'Trình duyệt này chưa hỗ trợ ghi hình vùng quay. Dùng Chrome / Edge bản mới, hoặc quay màn hình bằng điện thoại.' }
  const type = env.MediaRecorder.isTypeSupported ? pickVideoType(env.MediaRecorder.isTypeSupported) : 'video/webm'
  if (!type) return { ok: false, reason: 'Trình duyệt này không ghi được định dạng video WebM / MP4.' }
  return { ok: true, type }
}

/** "quay-thuong-tat-nien-2026-20261006-1930.webm" — không dấu, không ký tự lạ (lưu được trên mọi máy) */
export function recordingFileName(title: string, at: Date, ext: string): string {
  const slug = searchKey(title).replace(/ /g, '-').slice(0, 40).replace(/-+$/, '')
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}`
  return `quay-thuong-${slug || 'racehub'}-${stamp}.${ext}`
}

/** 75_000 → "01:15" */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** Ghi tối đa 30 phút một lần — file lớn hơn dễ làm app / trình duyệt điện thoại hết bộ nhớ khi lưu */
export const MAX_RECORD_MS = 30 * 60_000
