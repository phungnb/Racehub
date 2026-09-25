// Lưu ảnh (BIB, chứng nhận, ảnh vinh danh, poster bài chạy) về máy — chạy được ở cả 3 nơi:
//  • App cài (Capacitor): ghi file vào bộ nhớ tạm rồi mở bảng Chia sẻ của hệ điều hành → "Lưu ảnh", Zalo, Facebook…
//    (WebView trong app bỏ qua <a download>, nên không dùng cách của trình duyệt được)
//  • iPhone / iPad (Safari, PWA): bảng Chia sẻ có "Lưu hình ảnh" vào Ảnh; <a download> ở PWA không lưu được
//  • Máy tính / Android Chrome: tải file PNG như bình thường
// Nếu mọi cách đều không được (app bản cũ chưa có plugin, trình duyệt chặn) → trả 'preview' để hiện ảnh cho người dùng nhấn giữ lưu.
import { Capacitor } from '@capacitor/core'

export type SaveResult = 'shared' | 'downloaded' | 'preview' | 'cancelled'

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('IMAGE_EMPTY'))), 'image/png')
    } catch {
      // Canvas "bẩn" vì có ảnh từ nguồn ngoài không cho CORS → trình duyệt cấm xuất ảnh
      reject(new Error('IMAGE_TAINTED'))
    }
  })
}

const isIOS = () => typeof navigator !== 'undefined'
  && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

async function saveNative(blob: Blob, fileName: string, title: string): Promise<SaveResult | null> {
  if (!Capacitor.isPluginAvailable('Filesystem') || !Capacitor.isPluginAvailable('Share')) return null   // app bản cũ
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')])
  const file = await Filesystem.writeFile({ path: fileName, data: await blobToBase64(blob), directory: Directory.Cache })
  try {
    await Share.share({ title, files: [file.uri], dialogTitle: 'Lưu hoặc gửi ảnh' })
    return 'shared'
  } catch (e) {
    if (/cancel/i.test((e as Error).message ?? '')) return 'cancelled'
    throw e
  }
}

export async function saveImageBlob(blob: Blob, fileName: string, title = 'RaceHub'): Promise<SaveResult> {
  if (Capacitor.isNativePlatform()) return (await saveNative(blob, fileName, title)) ?? 'preview'
  const file = new File([blob], fileName, { type: blob.type || 'image/png' })
  if (isIOS() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title })
      return 'shared'
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled'
      return 'preview'                        // mất "thao tác người dùng" (ảnh lớn tạo lâu) → cho nhấn giữ lưu
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
  return 'downloaded'
}

export async function saveCanvasImage(canvas: HTMLCanvasElement | null, fileName: string, title?: string): Promise<{ result: SaveResult; blob: Blob }> {
  if (!canvas) throw new Error('IMAGE_EMPTY')
  const blob = await canvasToBlob(canvas)
  return { result: await saveImageBlob(blob, fileName, title), blob }
}
