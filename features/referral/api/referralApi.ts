import { supabase } from '@/shared/lib/supabase'

export async function applyReferral(referrerId: string) {
  const { data, error } = await supabase.rpc('apply_referral', { p_referrer_id: referrerId })
  if (error) throw error
  return data
}

const MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: 'Bạn cần đăng nhập để nhận thưởng giới thiệu.',
  CANNOT_REFER_SELF: 'Bạn không thể tự giới thiệu chính mình.',
  ALREADY_REFERRED: 'Tài khoản này đã được giới thiệu trước đó.',
  REFERRER_NOT_FOUND: 'Người giới thiệu không tồn tại hoặc đã bị xoá.',
}

export function referralErrorMessage(e: any): string {
  const raw: string = e?.message ?? ''
  for (const key of Object.keys(MESSAGES)) {
    if (raw.includes(key)) return MESSAGES[key]
  }
  return raw || 'Không thể xử lý lời mời giới thiệu.'
}