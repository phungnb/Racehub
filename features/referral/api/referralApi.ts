// Giới thiệu bạn bè (migration 005500): mã ngắn 8 ký tự, link /join/<mã>; thưởng Xu khi bạn mới chạy đủ km (economy_config.referral)
import { supabase } from '@/shared/lib/supabase'
import { systemErrorMessage } from '@/shared/lib/errors'

export interface ReferralPreview { display_name: string; avatar_url: string | null; code: string; referee_xu: number; min_km: number }
export interface MyReferral {
  code: string
  invited: number
  rewarded: number
  xu_earned: number
  friends: { display_name: string; avatar_url: string | null; joined_at: string; rewarded: boolean }[]
  referred_by: { display_name: string; avatar_url: string | null } | null
  can_enter_code: boolean
  enter_until: string | null
  rules: { inviter_xu: number; referee_xu: number; min_km: number; monthly_cap: number }
}

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}
/** Áp dụng mã giới thiệu (mã ngắn hoặc uuid của link cũ) */
export const applyReferral = (code: string) => call<{ success: boolean; referrer_name: string }>('apply_referral_code', { p_code: code.trim() })
export const referralPreview = (code: string) => call<ReferralPreview | null>('referral_preview', { p_code: code.trim() })
export const myReferral = () => call<MyReferral>('my_referral')
export const referralLink = (code: string) => (typeof window === 'undefined' ? '' : `${window.location.origin}/join/${code}`)

const MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: 'Bạn cần đăng nhập để nhận lời mời.',
  CANNOT_REFER_SELF: 'Bạn không thể tự giới thiệu chính mình.',
  ALREADY_REFERRED: 'Tài khoản của bạn đã nhận lời mời của người khác trước đó.',
  REFERRER_NOT_FOUND: 'Mã giới thiệu không đúng. Kiểm tra lại 8 ký tự trên link / tin nhắn mời.',
  REFERRAL_WINDOW_EXPIRED: 'Chỉ nhập được mã giới thiệu trong 14 ngày đầu sau khi tạo tài khoản.',
}

export function referralErrorMessage(e: unknown): string {
  const raw: string = (e as { message?: string } | null)?.message ?? ''
  for (const key of Object.keys(MESSAGES)) {
    if (raw.includes(key)) return MESSAGES[key]
  }
  return systemErrorMessage(e, 'Không thể xử lý lời mời giới thiệu.')
}
