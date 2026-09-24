// Chuẩn bị ảnh trước khi tải lên kho: ảnh quá lớn (dung lượng / kích thước) hoặc định dạng lạ (HEIC trên iPhone…)
// được vẽ lại trên canvas và nén WebP (giữ nền trong suốt). Ảnh nhỏ, đúng định dạng giữ nguyên để không mất nét.
const OK_TYPES = ['image/png', 'image/jpeg', 'image/webp']

export interface PrepareOptions { maxSide?: number; maxBytes?: number }

function decode(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const im = new Image()
    im.onload = () => { URL.revokeObjectURL(url); resolve(im) }
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('INVALID_IMAGE_TYPE')) }
    im.src = url
  })
}

/** Kích thước sau khi thu nhỏ để cạnh dài ≤ maxSide (thuần, để test) */
export function fitSide(w: number, h: number, maxSide: number) {
  const s = Math.min(1, maxSide / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) }
}

export async function prepareImage(file: File, { maxSide = 2800, maxBytes = 2.5 * 1024 * 1024 }: PrepareOptions = {}): Promise<Blob> {
  if (file.type && !file.type.startsWith('image/')) throw new Error('INVALID_IMAGE_TYPE')
  const im = await decode(file)
  if (OK_TYPES.includes(file.type) && file.size <= maxBytes && Math.max(im.naturalWidth, im.naturalHeight) <= maxSide) return file
  let { w, h } = fitSide(im.naturalWidth, im.naturalHeight, maxSide)
  for (let attempt = 0; attempt < 6; attempt++) {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    c.getContext('2d')!.drawImage(im, 0, 0, w, h)
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', attempt < 3 ? 0.92 - attempt * 0.07 : 0.8))
    if (blob && blob.size <= maxBytes) return blob
    if (attempt >= 2) { w = Math.round(w * 0.8); h = Math.round(h * 0.8) }        // vẫn lớn → thu nhỏ thêm
  }
  throw new Error('IMAGE_TOO_LARGE')
}
