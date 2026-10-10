// Tặng phẩm hiện vật cho thử thách / giải chạy (migration 015500): BTC khai báo, người tham gia điền thông tin nhận.
import { supabase } from '@/shared/lib/supabase'
import { systemErrorMessage } from '@/shared/lib/errors'

export type PrizeScope = 'CHALLENGE' | 'RACE'
export interface PrizeAddress { full_name: string; phone: string; address: string; size: string | null; note: string | null; updated_at?: string }
export interface PrizeState {
  enabled: boolean; can_manage: boolean; is_member?: boolean
  description?: string; needs_size?: boolean; size_options?: string[]; deadline?: string | null; closed?: boolean
  mine?: PrizeAddress | null; filled_count?: number | null
}
export interface PrizeRecipient extends Partial<PrizeAddress> {
  user_id: string; display_name: string | null; status: string; ref_label: string | null; filled: boolean
}
export interface PrizeGiftInput { description: string; needs_size: boolean; size_options: string[]; deadline: string | null }

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}

export const prizeKeys = (scope: PrizeScope, ref: string) => ['prize', scope, ref] as const
export const getPrize = (scope: PrizeScope, ref: string) => call<PrizeState | null>('prize_gift_get', { p_scope: scope, p_ref: ref })
export const setPrizeGift = (scope: PrizeScope, ref: string, p: PrizeGiftInput | { description: '' }) => call<{ enabled: boolean }>('set_prize_gift', { p_scope: scope, p_ref: ref, p })
export const savePrizeAddress = (scope: PrizeScope, ref: string, p: Omit<PrizeAddress, 'updated_at'>) => call<PrizeState>('save_prize_address', { p_scope: scope, p_ref: ref, p })
export const listPrizeRecipients = (scope: PrizeScope, ref: string) => call<PrizeRecipient[]>('prize_recipients', { p_scope: scope, p_ref: ref }).then((x) => x ?? [])

const MESSAGES: Record<string, string> = {
  FORBIDDEN: 'Bạn không có quyền làm việc này.',
  PRIZE_NOT_ENABLED: 'Ban tổ chức chưa bật tặng phẩm.',
  PRIZE_CLOSED: 'Đã quá hạn điền thông tin nhận tặng phẩm. Liên hệ Ban tổ chức nếu cần sửa.',
  PRIZE_NAME_INVALID: 'Nhập họ tên người nhận (tối thiểu 2 ký tự).',
  PRIZE_PHONE_INVALID: 'Số điện thoại chưa đúng (9–12 chữ số).',
  PRIZE_ADDRESS_INVALID: 'Địa chỉ quá ngắn — ghi đủ số nhà, đường, phường/xã, tỉnh/thành.',
  PRIZE_SIZE_INVALID: 'Chọn cỡ áo.',
  PRIZE_DESC_SHORT: 'Mô tả tặng phẩm quá ngắn.',
  PRIZE_SIZES_EMPTY: 'Nhập ít nhất một cỡ áo (VD: S, M, L, XL).',
}
export function prizeErrorMessage(e: unknown): string {
  const msg = (e as { message?: string } | null)?.message ?? ''
  const code = Object.keys(MESSAGES).sort((a, b) => b.length - a.length).find((k) => msg.includes(k))
  return code ? MESSAGES[code] : systemErrorMessage(e, 'Có lỗi xảy ra, thử lại sau.')
}
