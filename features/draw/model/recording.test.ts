import { describe, expect, it } from 'vitest'
import { formatElapsed, pickVideoType, recordSupport, recordingFileName, videoExt } from './recording'

describe('ghi hình buổi quay thưởng', () => {
  it('chọn định dạng: MP4 trước (mở được mọi máy), chỉ dùng WebM khi trình duyệt chưa ghi được MP4; không có gì → null', () => {
    expect(pickVideoType(() => true)).toBe('video/mp4;codecs=avc1.42E01E,mp4a.40.2')
    // Chrome / Edge ≥ 126: H.264 + Opus
    expect(pickVideoType((t) => t === 'video/mp4;codecs=avc1,opus' || t.startsWith('video/webm'))).toBe('video/mp4;codecs=avc1,opus')
    expect(pickVideoType((t) => t.startsWith('video/webm'))).toBe('video/webm;codecs=vp9')
    expect(pickVideoType((t) => t === 'video/mp4')).toBe('video/mp4')
    expect(pickVideoType(() => false)).toBeNull()
    expect(pickVideoType(() => { throw new Error('x') })).toBeNull()
    expect(videoExt('video/mp4;codecs=avc1')).toBe('mp4')
    expect(videoExt('video/webm;codecs=vp8')).toBe('webm')
  })

  it('trình duyệt không hỗ trợ → ẩn nút, có lý do ngắn', () => {
    expect(recordSupport({ MediaRecorder: undefined, canvasCaptureStream: true })).toMatchObject({ ok: false })
    expect(recordSupport({ MediaRecorder: { isTypeSupported: () => true }, canvasCaptureStream: false })).toMatchObject({ ok: false })
    expect(recordSupport({ MediaRecorder: { isTypeSupported: () => false }, canvasCaptureStream: true })).toMatchObject({ ok: false })
    expect(recordSupport({ MediaRecorder: { isTypeSupported: (t) => t === 'video/webm' }, canvasCaptureStream: true })).toEqual({ ok: true, type: 'video/webm' })
    // MediaRecorder rất cũ không có isTypeSupported: thử WebM
    expect(recordSupport({ MediaRecorder: {}, canvasCaptureStream: true })).toEqual({ ok: true, type: 'video/webm' })
  })

  it('tên file không dấu, có ngày giờ', () => {
    expect(recordingFileName('Quay thưởng Tất niên 2026 — Đội Đường dài!', new Date(2026, 9, 6, 19, 5), 'webm'))
      .toBe('quay-thuong-quay-thuong-tat-nien-2026-doi-duong-dai-20261006-1905.webm')
    expect(recordingFileName('🎁🎁', new Date(2026, 0, 2, 3, 4), 'mp4')).toBe('quay-thuong-racehub-20260102-0304.mp4')
  })

  it('đồng hồ ghi', () => {
    expect(formatElapsed(0)).toBe('00:00')
    expect(formatElapsed(75_400)).toBe('01:15')
    expect(formatElapsed(-5)).toBe('00:00')
  })
})
