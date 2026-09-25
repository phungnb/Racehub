'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { saveCanvasImage, saveImageBlob, type SaveResult } from '@/shared/lib/saveImage'
import { Sheet } from './Sheet'

const MESSAGE: Record<string, string> = {
  IMAGE_TAINTED: 'Không xuất được ảnh vì có ảnh từ nguồn ngoài chặn tải về. Hãy đổi ảnh (tải ảnh lên RaceHub) rồi thử lại.',
  IMAGE_EMPTY: 'Ảnh chưa vẽ xong, thử lại sau giây lát.',
}

/**
 * Lưu ảnh từ canvas / blob ở mọi nơi (web, iPhone, app cài). Trả `sheet` để gắn vào JSX:
 * khi không lưu tự động được, hiện ảnh để người dùng nhấn giữ → "Lưu ảnh".
 */
export function useImageSaver() {
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const done = useCallback((r: SaveResult, blob: Blob) => {
    if (r === 'downloaded') toast.success('Đã tải ảnh về máy')
    else if (r === 'shared') toast.success('Đã mở bảng chia sẻ — chọn "Lưu ảnh" để lưu vào máy')
    else if (r === 'preview') setPreview(URL.createObjectURL(blob))
  }, [])
  const run = useCallback(async (fn: () => Promise<{ result: SaveResult; blob: Blob }>) => {
    setBusy(true)
    try { const { result, blob } = await fn(); done(result, blob) } catch (e) {
      const m = (e as Error).message
      toast.error(MESSAGE[m] ?? 'Không lưu được ảnh. Thử lại.')
    } finally { setBusy(false) }
  }, [done])
  const saveCanvas = useCallback((canvas: HTMLCanvasElement | null, fileName: string, title?: string) =>
    run(() => saveCanvasImage(canvas, fileName, title)), [run])
  const saveBlob = useCallback((blob: Blob, fileName: string, title?: string) =>
    run(async () => ({ result: await saveImageBlob(blob, fileName, title), blob })), [run])
  const close = () => { if (preview) URL.revokeObjectURL(preview); setPreview(null) }
  const sheet = (
    <Sheet open={!!preview} onClose={close} title="Lưu ảnh" description="Nhấn giữ vào ảnh rồi chọn “Lưu ảnh” (hoặc “Thêm vào Ảnh”).">
      {/* eslint-disable-next-line @next/next/no-img-element -- ảnh vừa tạo (blob) để nhấn giữ lưu */}
      {preview && <img src={preview} alt="Ảnh để lưu" className="mx-auto max-h-[70dvh] w-auto rounded-lg" />}
    </Sheet>
  )
  return { saveCanvas, saveBlob, busy, sheet }
}
