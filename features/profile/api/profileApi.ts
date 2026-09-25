// Hồ sơ của chính mình: đọc/sửa qua RPC (migration 001400). Ảnh đại diện lưu ở bucket "avatars/<user_id>/".
import { supabase } from '@/shared/lib/supabase'
import type { MyProfile, ProfilePatch } from '../model/profileForm'
import { systemErrorMessage } from '@/shared/lib/errors'

export async function getMyProfile(): Promise<MyProfile> {
  const { data, error } = await supabase.rpc('my_profile')
  if (error) throw error
  const p = data as MyProfile
  return { ...p, weight_kg: p.weight_kg == null ? null : Number(p.weight_kg) }
}

export async function updateMyProfile(patch: ProfilePatch): Promise<MyProfile> {
  const { data, error } = await supabase.rpc('update_my_profile', { p: patch })
  if (error) throw error
  return data as MyProfile
}

/** Tải ảnh (đã cắt vuông) lên và gắn làm ảnh đại diện */
export async function uploadAvatar(userId: string, blob: Blob): Promise<string> {
  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${userId}/${Date.now()}.${ext}`
  const up = await supabase.storage.from('avatars').upload(path, blob, { contentType: blob.type, upsert: false })
  if (up.error) throw up.error
  const url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
  await setAvatarUrl(userId, url)
  return url
}

export async function setAvatarUrl(userId: string, url: string | null) {
  const { error } = await supabase.from('profiles').update({ avatar_url: url, updated_at: new Date().toISOString() }).eq('id', userId)
  if (error) throw error
}

const MESSAGES: Record<string, string> = {
  INVALID_NAME: 'Tên hiển thị cần từ 2 đến 40 ký tự.',
  INVALID_BIO: 'Giới thiệu tối đa 160 ký tự.',
  INVALID_GENDER: 'Giới tính không hợp lệ.',
  INVALID_BIRTH_DATE: 'Ngày sinh không hợp lệ (bạn cần từ 10 tuổi trở lên).',
  INVALID_HEIGHT: 'Chiều cao cần từ 100 đến 250 cm.',
  INVALID_WEIGHT: 'Cân nặng cần từ 25 đến 250 kg.',
  INVALID_PROFILE: 'Thông tin hồ sơ không hợp lệ.',
  'Payload too large': 'Ảnh quá lớn (tối đa 2 MB).',
  'mime type': 'Chỉ nhận ảnh JPG, PNG hoặc WEBP.',
}

export function profileErrorMessage(e: unknown): string {
  const err = e as { message?: string; code?: string } | null
  console.warn('[Hồ sơ] Lỗi gốc:', err?.code, err?.message)
  const key = Object.keys(MESSAGES).find((k) => (err?.message ?? '').includes(k))
  return key ? MESSAGES[key] : systemErrorMessage(e, 'Không lưu được. Hãy thử lại.')
}
