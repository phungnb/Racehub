// Voucher tài trợ (migration 005200): nhà tài trợ tặng mã khi runner hoàn thành thử thách / đạt Top N / xong nhiệm vụ
import { supabase } from '@/shared/lib/supabase'
import { systemErrorMessage } from '@/shared/lib/errors'

export interface VoucherCampaign {
  id: string
  sponsor_name: string
  sponsor_logo: string | null
  title: string
  terms: string | null
  redeem_url: string | null
  target_type: 'CHALLENGE' | 'QUEST'
  target_id: string
  condition: 'COMPLETE' | 'TOP_N'
  top_n: number | null
  code_mode: 'POOL' | 'SHARED'
  valid_until: string | null
  is_active: boolean
  issued: number
  remaining: number | null
  mine: { code: string; issued_at: string; used_at: string | null } | null
  // chỉ người quản lý
  shared_code?: string | null
  total?: number | null
  target_name?: string | null
}
export interface MyVoucher {
  campaign_id: string
  sponsor_name: string
  sponsor_logo: string | null
  title: string
  terms: string | null
  redeem_url: string | null
  valid_until: string | null
  code: string
  issued_at: string
  used_at: string | null
  target_type: 'CHALLENGE' | 'QUEST'
  target_id: string
  target_name: string | null
}
export type VoucherInput = Partial<Omit<VoucherCampaign, 'issued' | 'remaining' | 'mine' | 'total'>> & { shared_code?: string | null }

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}
export const listVouchers = (type: 'CHALLENGE' | 'QUEST', id: string) =>
  call<VoucherCampaign[]>('list_voucher_campaigns', { p_target_type: type, p_target_id: id }).then((x) => x ?? [])
export const adminListVouchers = () => call<VoucherCampaign[]>('admin_list_voucher_campaigns').then((x) => x ?? [])
export const saveVoucher = (p: VoucherInput) => call<VoucherCampaign>('save_voucher_campaign', { p })
export const addVoucherCodes = (id: string, codes: string[]) => call<VoucherCampaign & { added: number }>('add_voucher_codes', { p_campaign_id: id, p_codes: codes })
export const myVouchers = () => call<MyVoucher[]>('my_vouchers').then((x) => x ?? [])
export const markVoucherUsed = (id: string, used: boolean) => call<void>('mark_voucher_used', { p_campaign_id: id, p_used: used })

const MESSAGES: Record<string, string> = {
  FORBIDDEN: 'Chỉ Ban tổ chức thử thách hoặc admin mới làm được việc này.',
  INVALID_URL: 'Đường link / logo phải bắt đầu bằng https://',
  INVALID_VOUCHER_CODE: 'Nhập mã chung (ít nhất 3 ký tự).',
  INVALID_VOUCHER: 'Thông tin voucher chưa hợp lệ (Top N từ 1 đến 100, chỉ áp cho thử thách).',
  TOO_MANY_CODES: 'Tối đa 5.000 mã mỗi lần dán.',
  VOUCHER_NOT_FOUND: 'Không tìm thấy voucher.',
}
export function voucherErrorMessage(e: unknown): string {
  const raw = (e as { message?: string } | null)?.message ?? ''
  const k = Object.keys(MESSAGES).find((x) => raw.includes(x))
  return k ? MESSAGES[k] : systemErrorMessage(e, 'Không thực hiện được. Hãy thử lại.')
}
