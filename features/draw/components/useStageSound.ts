'use client'

import { useMemo, useRef } from 'react'

/** Âm thanh sân khấu tạo bằng Web Audio (không tải file): tiếng "tách" khi tên đổi, hồi chuông khi có người trúng */
export function useStageSound(on: boolean) {
  const ctxRef = useRef<AudioContext | null>(null)
  // Ghi hình (lần 7): tiếng quay cũng vào video qua một đầu ra MediaStream
  const recRef = useRef<MediaStreamAudioDestinationNode | null>(null)
  return useMemo(() => {
    const ctx = () => {
      if (!on || typeof window === 'undefined') return null
      try {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!AC) return null
        ctxRef.current ??= new AC()
        if (ctxRef.current.state === 'suspended') void ctxRef.current.resume()
        return ctxRef.current
      } catch { return null }
    }
    const beep = (freq: number, at: number, dur: number, vol: number, type: OscillatorType = 'square') => {
      const c = ctx()
      if (!c) return
      const o = c.createOscillator(), g = c.createGain()
      o.type = type; o.frequency.value = freq
      g.gain.setValueAtTime(vol, c.currentTime + at)
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + dur)
      o.connect(g).connect(c.destination)
      if (recRef.current?.context === c) g.connect(recRef.current)
      o.start(c.currentTime + at); o.stop(c.currentTime + at + dur + 0.02)
    }
    return {
      /** progress 0..1: tiếng tách cao dần khi vòng quay chậm lại */
      tick: (progress: number) => beep(500 + progress * 500, 0, 0.03, 0.05),
      win: () => [523, 659, 784, 1047].forEach((f, i) => beep(f, i * 0.12, 0.35, 0.12, 'triangle')),
      /** Luồng âm thanh để ghép vào video ghi hình; null khi tắt tiếng / trình duyệt không có Web Audio */
      recordStream: (): MediaStream | null => {
        const c = ctx()
        if (!c || typeof c.createMediaStreamDestination !== 'function') return null
        // Mỗi lần ghi dùng đầu ra MỚI: có trình duyệt (Safari / WebView iOS) đóng luôn luồng âm thanh khi MediaRecorder dừng,
        // dùng lại luồng cũ thì lần ghi sau ra file rỗng, không có thông báo lưu
        recRef.current?.disconnect()
        const dest = c.createMediaStreamDestination()
        // Luôn có một nguồn im lặng nối vào: không có tiếng nào phát thì luồng âm thanh không ra dữ liệu, MediaRecorder
        // đứng chờ → video chỉ ghi được đoạn có tiếng quay (lượt đầu), lần ghi sau ra file rỗng
        try {
          const silent = c.createConstantSource()
          silent.offset.value = 0
          silent.connect(dest); silent.start()
        } catch {
          const o = c.createOscillator(), g = c.createGain()
          g.gain.value = 0
          o.connect(g).connect(dest); o.start()
        }
        recRef.current = dest
        return dest.stream
      },
    }
  }, [on])
}
