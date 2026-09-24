// Các bước onboarding (ONB-01). Bước nằm trên URL (?step=) để quay lại đúng chỗ sau khi kết nối Strava.
export const STEPS = ['profile', 'device', 'club', 'notify', 'done'] as const
export type Step = (typeof STEPS)[number]

export const parseStep = (v: string | null | undefined): Step => (STEPS as readonly string[]).includes(v ?? '') ? (v as Step) : 'profile'
export const nextStep = (s: Step): Step => STEPS[Math.min(STEPS.indexOf(s) + 1, STEPS.length - 1)]
export const prevStep = (s: Step): Step | null => (STEPS.indexOf(s) > 0 ? STEPS[STEPS.indexOf(s) - 1] : null)
/** Số thứ tự hiển thị (1–4); bước "done" không đếm */
export const stepNumber = (s: Step) => Math.min(STEPS.indexOf(s) + 1, STEPS.length - 1)
export const STEP_COUNT = STEPS.length - 1
export const welcomeUrl = (s: Step) => `/welcome?step=${s}`

/** Tên hiển thị gợi ý từ email khi người dùng chưa đặt tên (vd "lan.nguyen92@…" → "Lan Nguyen") */
export function nameFromEmail(email: string | null | undefined): string {
  const local = (email ?? '').split('@')[0].replace(/[0-9]+/g, ' ').replace(/[._\-+]+/g, ' ').trim()
  return local.split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ').slice(0, 40)
}

/** Mã mời CLB: chấp nhận cả link đầy đủ (…/club/join/abc123) */
export function parseInviteCode(input: string): string {
  const t = input.trim()
  const m = t.match(/\/club\/join\/([^/?#\s]+)/)
  return decodeURIComponent(m ? m[1] : t).replace(/\s+/g, '')
}
