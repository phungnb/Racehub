// Kiểm tra file lớp vật phẩm trước khi tải lên + tạo mã vật phẩm (docs/vat-pham/HUONG_DAN.md).
import { FRAME, type Slot } from '@/features/character'

export interface LayerStats {
  width: number
  height: number
  bytes: number
  type: string
  /** Tỉ lệ điểm ảnh không trong suốt (alpha > 8) */
  opaqueRatio: number
  /** Alpha lớn nhất ở 4 góc */
  cornerAlpha: number
}

export const MAX_LAYER_BYTES = 1_048_576
export const WARN_LAYER_BYTES = 300_000

/** Lỗi thì không cho lưu; cảnh báo thì vẫn cho lưu */
export function checkLayer(s: LayerStats, slot: Slot): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  if (s.type !== 'image/png') errors.push('Phải là file PNG có nền trong suốt.')
  if (s.width !== FRAME.width || s.height !== FRAME.height)
    errors.push(`Kích thước ${s.width}×${s.height}, phải đúng ${FRAME.width}×${FRAME.height} (không cắt sát khi xuất).`)
  if (s.bytes > MAX_LAYER_BYTES) errors.push('File lớn hơn 1 MB — nén bằng TinyPNG / Squoosh.')
  else if (s.bytes > WARN_LAYER_BYTES) warnings.push(`File ${Math.round(s.bytes / 1000)} KB, nên dưới 300 KB để tải nhanh.`)
  if (s.opaqueRatio === 0) errors.push('File trống, không có món đồ nào.')
  else if (s.opaqueRatio > 0.6 && slot !== 'effect') errors.push('Gần như cả khung bị phủ kín — nền phải trong suốt, chỉ giữ món đồ.')
  if (s.cornerAlpha > 8 && slot !== 'effect') warnings.push('Góc ảnh không trong suốt — kiểm tra đã ẩn lớp ảnh nhân vật khi xuất chưa.')
  return { errors, warnings }
}

/** "Mũ lưỡi trai Đỏ" + hat → "hat_mu_luoi_trai_do" */
export function suggestCode(slot: Slot, name: string): string {
  const slug = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  const body = slug.startsWith(`${slot}_`) ? slug : `${slot}_${slug}`
  return body.slice(0, 48).replace(/_+$/, '')
}

export const CODE_PATTERN = /^[a-z0-9_]{3,48}$/
