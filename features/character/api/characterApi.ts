// Nhân vật: đọc/ghi qua RPC (migration 000900, 001000). Không ghi thẳng bảng.
import { supabase } from '@/shared/lib/supabase'
import type { CharacterItem, CharacterState, Gender, Look, Slot } from '../model/catalog'
import { systemErrorMessage } from '@/shared/lib/errors'

const normItem = (i: CharacterItem): CharacterItem => ({ ...i, price_xu: Number(i.price_xu ?? 0) })

export async function getCharacterState(): Promise<CharacterState> {
  const { data, error } = await supabase.rpc('character_state')
  if (error) throw error
  const s = data as CharacterState
  return { ...s, balance: Number(s.balance ?? 0), items: (s.items ?? []).map(normItem) }
}

export async function getCharacter(userId: string): Promise<Look> {
  const { data, error } = await supabase.rpc('get_character', { p_user: userId })
  if (error) throw error
  const l = data as Look
  return { ...l, items: (l.items ?? []).map(normItem) }
}

export async function buyItem(code: string, key: string) {
  const { data, error } = await supabase.rpc('buy_avatar_item', { p_code: code, p_idempotency_key: key })
  if (error) throw error
  return data as { code?: string; balance: number; duplicate?: boolean }
}

export async function saveCharacter(look: { gender?: Gender }, equipped: Partial<Record<Slot, string | null>>) {
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
  SLOT_REQUIRED: 'Nhân vật cần có áo, quần, tất và giày.',
  INVALID_LOOK: 'Dáng người không hợp lệ.',
}

export function characterErrorMessage(e: unknown): string {
  const err = e as { message?: string; code?: string } | null
  console.warn('[Nhân vật] Lỗi gốc:', err?.code, err?.message)
  const key = Object.keys(MESSAGES).find((k) => (err?.message ?? '').includes(k))
  return key ? MESSAGES[key] : systemErrorMessage(e, 'Không thực hiện được. Hãy thử lại.')
}
