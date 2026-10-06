'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { saveFileBlob } from '@/shared/lib/saveImage'
import { MAX_RECORD_MS, recordSupport, recordingFileName, videoExt, type RecordSupport } from '../model/recording'

const W = 1280, H = 720, FPS = 30

async function saveVideo(blob: Blob, name: string, title: string): Promise<void> {
  const retry = () => void saveVideo(blob, name, title)
  try {
    const r = await saveFileBlob(blob, name, title, 'Lưu hoặc gửi video quay thưởng')
    if (r === 'downloaded') toast.success(`Đã tải video về máy: ${name}`)
    else if (r === 'preview') toast.error('Bản app này chưa lưu được video. Cập nhật app hoặc mở RaceHub bằng trình duyệt Chrome để ghi hình.', { duration: 8000 })
    else if (r === 'cancelled') toast('Chưa lưu video', { action: { label: 'Lưu lại', onClick: retry }, duration: 15_000 })
  } catch {
    toast.error('Không lưu được video (máy hết bộ nhớ?).', { action: { label: 'Thử lại', onClick: retry }, duration: 15_000 })
  }
}

/**
 * Ghi video vùng quay thưởng: mỗi 1/30 giây gọi `paint` vẽ vùng quay lên canvas 1280×720 (không hiện ra màn hình),
 * canvas.captureStream() + tiếng quay (nếu bật) → MediaRecorder. Dừng thì lưu file .webm (Safari: .mp4) về máy:
 * trình duyệt tải file; app cài (Android / iOS) ghi bằng @capacitor/filesystem rồi mở bảng Chia sẻ (shared/lib/saveImage).
 */
export function useStageRecorder(title: string, paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, audio: () => MediaStream | null) {
  const [support] = useState<RecordSupport>(() => (typeof window === 'undefined' ? { ok: false, reason: '' } : recordSupport({
    MediaRecorder: typeof MediaRecorder === 'undefined' ? undefined : MediaRecorder,
    canvasCaptureStream: typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function',
  })))
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(0)
  const paintRef = useRef(paint)
  const audioRef = useRef(audio)
  useEffect(() => { paintRef.current = paint; audioRef.current = audio })
  const run = useRef<{ rec: MediaRecorder; timers: ReturnType<typeof setInterval>[]; stream: MediaStream } | null>(null)

  const stop = useCallback(() => {
    const r = run.current
    if (!r) return
    run.current = null
    r.timers.forEach(clearInterval)
    if (r.rec.state !== 'inactive') r.rec.stop()      // onstop lưu file, rồi tắt luồng
    setStartedAt(null)
  }, [])

  const start = useCallback(() => {
    if (!support.ok || run.current) return
    try {
      const canvas = document.createElement('canvas')
      canvas.width = W; canvas.height = H
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('NO_CANVAS')
      const draw = () => { try { paintRef.current(ctx, W, H) } catch { /* bỏ qua một khung hình lỗi */ } }
      draw()
      const stream = canvas.captureStream(FPS)
      audioRef.current()?.getAudioTracks().forEach((t) => stream.addTrack(t))
      const rec = new MediaRecorder(stream, { mimeType: support.type, videoBitsPerSecond: 2_500_000 })
      const chunks: Blob[] = []
      const at = new Date()
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
      rec.onstop = () => {
        stream.getVideoTracks().forEach((t) => t.stop())     // track âm thanh thuộc Web Audio của màn quay, không tắt
        const blob = new Blob(chunks, { type: support.type.split(';')[0] })
        if (blob.size) void saveVideo(blob, recordingFileName(title, at, videoExt(support.type)), title)
      }
      rec.start(1000)
      const t0 = Date.now()
      // setInterval thay cho requestAnimationFrame: rAF dừng khi tab bị che, video sẽ đứng hình
      const timers = [setInterval(draw, 1000 / FPS), setInterval(() => {
        setNow(Date.now())
        if (Date.now() - t0 > MAX_RECORD_MS) { toast('Đã ghi đủ 30 phút — tự dừng và lưu. Bấm ghi tiếp nếu cần.'); stop() }
      }, 500)]
      run.current = { rec, timers, stream }
      setStartedAt(t0); setNow(t0)
    } catch {
      toast.error('Không bắt đầu ghi hình được trên trình duyệt này.')
    }
  }, [support, title, stop])

  // Đóng màn quay khi đang ghi → dừng và lưu phần đã ghi
  useEffect(() => () => stop(), [stop])

  return { support, recording: startedAt !== null, elapsed: startedAt ? now - startedAt : 0, start, stop }
}
