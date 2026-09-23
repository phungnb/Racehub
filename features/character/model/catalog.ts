// Nhân vật 3D (migration 000900, docs/NHAN_VAT_3D.md): kiểu dữ liệu + hàm thuần.
import { Footprints, Gem, Glasses, HardHat, Palette, Scissors, Shirt, Sparkles, Watch, type LucideIcon } from 'lucide-react'

export type Gender = 'male' | 'female'
export type Slot = 'hair' | 'top' | 'bottom' | 'socks' | 'shoes' | 'hat' | 'glasses' | 'watch' | 'accessory' | 'effect'
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary'
export type AnimationName = 'Idle' | 'Run' | 'Wave'

export interface CharacterItem {
  code: string
  name: string
  description: string | null
  slot: Slot
  rarity: Rarity
  model_key: string | null
  model_urls: Partial<Record<Gender, string>> | null
  color: string | null
  color2: string | null
  price_xu: number
  unlock_level: number
  is_default: boolean
  owned?: boolean
}

export interface Look {
  gender: Gender
  skin_tone: string
  hair_color: string
  equipped: Partial<Record<Slot, string>>
}

export interface CharacterState extends Look {
  level: number
  balance: number
  items: CharacterItem[]
}

/** Thứ tự ô trong tủ đồ */
export const SLOTS: { slot: Slot; label: string; icon: LucideIcon; required?: boolean }[] = [
  { slot: 'hair', label: 'Tóc', icon: Scissors, required: true },
  { slot: 'top', label: 'Áo', icon: Shirt, required: true },
  { slot: 'bottom', label: 'Quần', icon: Shirt, required: true },
  { slot: 'socks', label: 'Tất', icon: Footprints },
  { slot: 'shoes', label: 'Giày', icon: Footprints, required: true },
  { slot: 'hat', label: 'Mũ', icon: HardHat },
  { slot: 'glasses', label: 'Kính', icon: Glasses },
  { slot: 'watch', label: 'Đồng hồ', icon: Watch },
  { slot: 'accessory', label: 'Phụ kiện', icon: Gem },
  { slot: 'effect', label: 'Hiệu ứng', icon: Sparkles },
]
export const LOOK_TAB = { label: 'Ngoại hình', icon: Palette }

export const SKIN_TONES = ['#f6d7c3', '#e9b995', '#d49a6a', '#b57a4f', '#8a5a3b', '#5c3a26']
export const HAIR_COLORS = ['#1b1210', '#2b1d16', '#5a3522', '#8b4513', '#c68642', '#e6c27a', '#9aa6b8', '#e11d48', '#2f6bff']

export const RARITY_META: Record<Rarity, { label: string; text: string; border: string }> = {
  common: { label: 'Thường', text: 'text-rarity-common', border: 'border-border' },
  rare: { label: 'Hiếm', text: 'text-rarity-rare', border: 'border-rarity-rare/60' },
  epic: { label: 'Sử thi', text: 'text-rarity-epic', border: 'border-rarity-epic/60' },
  legendary: { label: 'Huyền thoại', text: 'text-rarity-legendary', border: 'border-rarity-legendary/70' },
}

export const MODEL_BASE = '/models/character'
export const bodyUrl = (g: Gender) => `${MODEL_BASE}/body_${g}.glb`

/** URL mô hình của vật phẩm theo giới tính: asset riêng (model_urls) ưu tiên, không thì theo model_key */
export function modelUrl(item: Pick<CharacterItem, 'model_key' | 'model_urls'>, gender: Gender): string | null {
  const custom = item.model_urls?.[gender]
  if (custom) return custom
  return item.model_key ? `${MODEL_BASE}/${item.model_key}_${gender}.glb` : null
}

/** Tên xương chuẩn hóa: bỏ tiền tố "mixamorig", bỏ ký tự đặc biệt ("mixamorig:LeftArm" → "LeftArm") */
export const normalizeBone = (name: string) => name.replace(/^mixamorig[:_]?/i, '').replace(/[^A-Za-z0-9]/g, '')

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
