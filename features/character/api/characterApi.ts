// Nhân vật: đọc/ghi qua RPC (migration 000900). Không ghi thẳng bảng.
import { supabase } from '@/shared/lib/supabase'
import type { CharacterState, Look, Slot } from '../model/catalog'

export async function getCharacterState(): Promise<CharacterState> {
  const { data, error } = await supabase.rpc('character_state')
  if (error) throw error
  const s = data as CharacterState
  return { ...s, balance: Number(s.balance ?? 0), items: (s.items ?? []).map((i) => ({ ...i, price_xu: Number(i.price_xu ?? 0) })) }
}

export async function getCharacter(userId: string): Promise<Look> {
  const { data, error } = await supabase.rpc('get_character', { p_user: userId })
  if (error) throw error
  return data as Look
}

export async function buyItem(code: string, key: string) {
  const { data, error } = await supabase.rpc('buy_avatar_item', { p_code: code, p_idempotency_key: key })
  if (error) throw error
  return data as { code?: string; balance: number; duplicate?: boolean }
}

export async function saveCharacter(look: Partial<Omit<Look, 'equipped'>>, equipped: Partial<Record<Slot, string | null>>) {
  const { data, error } = await supabase.rpc('save_character', { p_look: look, p_equipped: equipped })
  if (error) throw error
  return data as Look
}

const MESSAGES: Record<string, string> = {
  INSUFFICIENT_BALANCE: 'Số Xu trong ví không đủ.',
  LEVEL_TOO_LOW: 'Vật phẩm này cần cấp độ cao hơn.',
  ALREADY_OWNED: 'Bạn đã có vật phẩm này.',
  ITEM_NOT_FOUND: 'Vật phẩm không còn bán.',
  ITEM_NOT_OWNED: 'Bạn chưa sở hữu vật phẩm này.',
  SLOT_REQUIRED: 'Nhân vật cần có tóc, áo, quần và giày.',
  INVALID_LOOK: 'Màu da hoặc màu tóc không hợp lệ.',
}

export function characterErrorMessage(e: unknown): string {
  const err = e as { message?: string; code?: string } | null
  console.warn('[Nhân vật] Lỗi gốc:', err?.code, err?.message)
  const key = Object.keys(MESSAGES).find((k) => (err?.message ?? '').includes(k))
  return key ? MESSAGES[key] : 'Không thực hiện được. Hãy thử lại.'
}
