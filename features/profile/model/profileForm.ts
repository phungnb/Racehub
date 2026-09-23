// Hồ sơ cá nhân: kiểu dữ liệu + hàm thuần (kiểm tra form, nhóm tuổi, cắt ảnh vuông).
export type Gender = 'male' | 'female'

export interface MyProfile {
  id: string
  display_name: string
  avatar_url: string | null
  bio: string | null
  gender: Gender | null
  birth_date: string | null
  height_cm: number | null
  weight_kg: number | null
}

export type ProfilePatch = Partial<Pick<MyProfile, 'display_name' | 'bio' | 'gender' | 'birth_date' | 'height_cm' | 'weight_kg'>>

export interface ProfileDraft {
  display_name: string
  bio: string
  gender: Gender | null
  birth_date: string
  height_cm: string
  weight_kg: string
}

export const toDraft = (p: MyProfile): ProfileDraft => ({
  display_name: p.display_name ?? '',
  bio: p.bio ?? '',
  gender: p.gender,
  birth_date: p.birth_date ?? '',
  height_cm: p.height_cm == null ? '' : String(p.height_cm),
  weight_kg: p.weight_kg == null ? '' : String(p.weight_kg),
})

const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')))

/** Ngày sinh muộn nhất được chấp nhận (đủ 10 tuổi), dạng yyyy-mm-dd */
export function maxBirthDate(today = new Date()) {
  const d = new Date(Date.UTC(today.getFullYear() - 10, today.getMonth(), today.getDate()))
  return d.toISOString().slice(0, 10)
}

export function validateDraft(d: ProfileDraft, today = new Date()): Partial<Record<keyof ProfileDraft, string>> {
  const e: Partial<Record<keyof ProfileDraft, string>> = {}
  const name = d.display_name.trim()
  if (name.length < 2 || name.length > 40) e.display_name = 'Tên hiển thị cần từ 2 đến 40 ký tự.'
  if (d.bio.trim().length > 160) e.bio = 'Tối đa 160 ký tự.'
  if (d.birth_date && (d.birth_date < '1920-01-01' || d.birth_date > maxBirthDate(today))) e.birth_date = 'Bạn cần từ 10 tuổi trở lên.'
  const h = num(d.height_cm)
  if (h !== null && (!Number.isFinite(h) || h < 100 || h > 250)) e.height_cm = 'Từ 100 đến 250 cm.'
  const w = num(d.weight_kg)
  if (w !== null && (!Number.isFinite(w) || w < 25 || w > 250)) e.weight_kg = 'Từ 25 đến 250 kg.'
  return e
}

/** Chỉ gửi các trường đã đổi */
export function diffDraft(p: MyProfile, d: ProfileDraft): ProfilePatch {
  const out: ProfilePatch = {}
  const o = toDraft(p)
  if (d.display_name.trim() !== o.display_name) out.display_name = d.display_name.trim()
  if (d.bio.trim() !== o.bio) out.bio = d.bio.trim() || null
  if (d.gender !== o.gender) out.gender = d.gender
  if (d.birth_date !== o.birth_date) out.birth_date = d.birth_date || null
  if (d.height_cm.trim() !== o.height_cm) out.height_cm = num(d.height_cm)
  if (d.weight_kg.trim() !== o.weight_kg) out.weight_kg = num(d.weight_kg)
  return out
}

/** Tuổi và nhóm tuổi thi đấu (như các giải chạy: dưới 20, 20–29, 30–39, ..., 60+) */
export function ageInfo(birth: string, today = new Date()): { age: number; group: string } | null {
  if (!birth) return null
  const [y, m, dd] = birth.split('-').map(Number)
  if (!y || !m || !dd) return null
  let age = today.getFullYear() - y
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < dd)) age--
  if (age < 0) return null
  const group = age < 20 ? 'Dưới 20' : age >= 60 ? '60+' : `${Math.floor(age / 10) * 10}–${Math.floor(age / 10) * 10 + 9}`
  return { age, group }
}

/** Vùng cắt vuông ở giữa ảnh (để làm ảnh đại diện) */
export function centerSquare(w: number, h: number) {
  const side = Math.min(w, h)
  return { sx: Math.round((w - side) / 2), sy: Math.round((h - side) / 2), side }
}
