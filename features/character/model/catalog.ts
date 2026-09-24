// Nhân vật 2D (migration 001000, ADR-017, docs/NHAN_VAT.md): kiểu dữ liệu + hàm thuần.
// Nhân vật là ảnh thật trong KHUNG CHUẨN; vật phẩm TINT đổi màu một vùng (theo mặt nạ), LAYER xếp một ảnh PNG cùng khung lên trên.
import { Footprints, Gem, Glasses, HardHat, Scissors, Shirt, Sparkles, Watch, type LucideIcon } from 'lucide-react'

export type Gender = 'male' | 'female'
export type Slot = 'hair' | 'top' | 'bottom' | 'socks' | 'shoes' | 'hat' | 'glasses' | 'watch' | 'accessory' | 'effect'
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary'
export type RenderKind = 'TINT' | 'LAYER'

export interface CharacterItem {
  code: string
  name: string
  description: string | null
  slot: Slot
  rarity: Rarity
  render_kind: RenderKind
  /** Ảnh lớp (PNG trong suốt, đúng khung chuẩn) theo giới tính — chỉ với LAYER */
  layer_urls: Partial<Record<Gender, string>> | null
  /** Màu vùng (TINT); null = màu nguyên bản của ảnh */
  color: string | null
  price_xu: number
  unlock_level: number
  is_default: boolean
  owned?: boolean
}

export interface Look {
  gender: Gender
  equipped: Partial<Record<Slot, string>>
  /** Chi tiết các món đang mặc (get_character trả kèm để vẽ được mà không cần cả danh mục) */
  items?: CharacterItem[]
}

export interface CharacterState extends Look {
  /** Người chơi đã khai giới tính trong hồ sơ chưa (nhân vật đi theo giới tính hồ sơ) */
  gender_set?: boolean
  level: number
  balance: number
  items: CharacterItem[]
}

/** Khung chuẩn: mọi ảnh nền, mặt nạ và lớp vật phẩm đều đúng kích thước này */
export const FRAME = { width: 900, height: 1350 } as const
export const CHARACTER_BASE = '/character'
/** Vùng đổi màu được trên ảnh nhân vật (mỗi vùng có một mặt nạ) */
export const TINT_SLOTS = ['top', 'bottom', 'socks', 'shoes'] as const satisfies readonly Slot[]
export type TintSlot = (typeof TINT_SLOTS)[number]

export const baseUrl = (g: Gender) => `${CHARACTER_BASE}/${g}/base.webp`
export const maskUrl = (g: Gender, slot: TintSlot) => `${CHARACTER_BASE}/${g}/${slot}.png`
export const isTintSlot = (s: Slot): s is TintSlot => (TINT_SLOTS as readonly Slot[]).includes(s)

/** Thứ tự ô trong tủ đồ */
export const SLOTS: { slot: Slot; label: string; icon: LucideIcon; required?: boolean }[] = [
  { slot: 'top', label: 'Áo', icon: Shirt, required: true },
  { slot: 'bottom', label: 'Quần', icon: Shirt, required: true },
  { slot: 'socks', label: 'Tất', icon: Footprints, required: true },
  { slot: 'shoes', label: 'Giày', icon: Footprints, required: true },
  { slot: 'accessory', label: 'Phụ kiện', icon: Gem },
  { slot: 'watch', label: 'Đồng hồ', icon: Watch },
  { slot: 'hair', label: 'Tóc', icon: Scissors },
  { slot: 'glasses', label: 'Kính', icon: Glasses },
  { slot: 'hat', label: 'Mũ', icon: HardHat },
  { slot: 'effect', label: 'Hiệu ứng', icon: Sparkles },
]

export const RARITY_META: Record<Rarity, { label: string; text: string; border: string }> = {
  common: { label: 'Thường', text: 'text-rarity-common', border: 'border-border' },
  rare: { label: 'Hiếm', text: 'text-rarity-rare', border: 'border-rarity-rare/60' },
  epic: { label: 'Sử thi', text: 'text-rarity-epic', border: 'border-rarity-epic/60' },
  legendary: { label: 'Huyền thoại', text: 'text-rarity-legendary', border: 'border-rarity-legendary/70' },
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

/**
 * Đổi màu một điểm ảnh giữ nếp vải: độ sáng tương đối của điểm (so với trung bình vùng) nhân vào màu đích.
 * Màu rất tối được nâng tối thiểu và cộng thêm độ lệch sáng để vẫn thấy nếp gấp.
 * alpha = độ phủ của mặt nạ (0..1). Trả về [r, g, b] đã trộn với màu gốc.
 */
export function tintPixel(r: number, g: number, b: number, alpha: number, target: readonly [number, number, number], regionMean: number): [number, number, number] {
  const L = luma(r, g, b)
  const f = L / Math.max(regionMean, 1)
  const tl = luma(target[0], target[1], target[2])
  const lift = Math.max(tl, 25) / Math.max(tl, 1)
  const detail = tl < 40 ? (L - regionMean) * 0.35 : 0
  const out = [r, g, b] as [number, number, number]
  for (let j = 0; j < 3; j++) {
    const c = tl < 1 ? 25 : target[j] * lift
    const nv = Math.min(255, Math.max(0, c * f + detail))
    out[j] = out[j] * (1 - alpha) + nv * alpha
  }
  return out
}

/** Ảnh lớp của vật phẩm theo giới tính (không có bản riêng thì dùng bản của giới còn lại) */
export function layerUrl(item: Pick<CharacterItem, 'render_kind' | 'layer_urls'>, gender: Gender): string | null {
  if (item.render_kind !== 'LAYER' || !item.layer_urls) return null
  return item.layer_urls[gender] ?? item.layer_urls[gender === 'male' ? 'female' : 'male'] ?? null
}

/** Thứ tự xếp lớp ảnh (sau đè trước): quần → tất → giày → áo (vạt áo, áo khoác nằm trên quần) → phụ kiện → ... */
export const LAYER_ORDER: Slot[] = ['bottom', 'socks', 'shoes', 'top', 'accessory', 'watch', 'hair', 'glasses', 'hat', 'effect']

/** Bộ đồ (mã theo ô) → danh sách món cần vẽ, theo thứ tự xếp lớp */
export function resolveOutfit(items: CharacterItem[] | undefined, equipped: Partial<Record<Slot, string>>): CharacterItem[] {
  const byCode = new Map((items ?? []).map((i) => [i.code, i]))
  const out: CharacterItem[] = []
  for (const slot of LAYER_ORDER) {
    const code = equipped[slot]
    const it = code ? byCode.get(code) : undefined
    if (it && it.slot === slot) out.push(it)
  }
  return out
}

/** Trạng thái một vật phẩm với người chơi */
export type ItemStatus = 'EQUIPPED' | 'OWNED' | 'BUY' | 'LOCKED'
export function itemStatus(item: CharacterItem, level: number, equipped: Partial<Record<Slot, string>>): ItemStatus {
  if (equipped[item.slot] === item.code) return 'EQUIPPED'
  if (item.owned) return 'OWNED'
  if (level < item.unlock_level) return 'LOCKED'
  return 'BUY'
}

/** Những ô đã thay đổi so với bộ đang lưu (để gửi lên save_character) */
export function outfitDiff(saved: Partial<Record<Slot, string>>, draft: Partial<Record<Slot, string>>) {
  const out: Partial<Record<Slot, string | null>> = {}
  for (const { slot } of SLOTS) {
    if ((saved[slot] ?? null) !== (draft[slot] ?? null)) out[slot] = draft[slot] ?? null
  }
  return out
}
