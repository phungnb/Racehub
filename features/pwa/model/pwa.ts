// Trạng thái PWA dùng chung: sự kiện cài đặt của trình duyệt, chế độ standalone, nền tảng.
// Sự kiện `beforeinstallprompt` chỉ bắn một lần rất sớm → giữ ở cấp module để màn nào cũng dùng được.

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function captureInstallPrompt() {
  if (typeof window === 'undefined') return
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => { deferred = null; emit() })
}

export const subscribeInstall = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const canPromptInstall = () => deferred !== null

/** Mở hộp thoại cài của trình duyệt (Android/Chrome/Edge). Trả về true nếu người dùng đồng ý. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false
  const e = deferred
  deferred = null
  emit()
  await e.prompt()
  return (await e.userChoice).outcome === 'accepted'
}

export type Platform = 'ios' | 'android' | 'desktop'

export function detectPlatform(ua: string, maxTouchPoints = 0): Platform {
  if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return 'desktop'
}

/** iOS chỉ cài được bằng Safari (Chrome/Firefox trên iOS không có "Thêm vào MH chính" ở bản cũ) */
export const isIosSafari = (ua: string) => /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

// Ẩn thẻ gợi ý cài trong 14 ngày sau khi người dùng bấm "Để sau"
const DISMISS_KEY = 'rh-install-dismissed'
const DISMISS_MS = 14 * 24 * 3600_000
export function installDismissed(now: number): boolean {
  try { return now - Number(localStorage.getItem(DISMISS_KEY) ?? 0) < DISMISS_MS } catch { return false }
}
export function dismissInstall(now: number) {
  try { localStorage.setItem(DISMISS_KEY, String(now)) } catch { /* trình duyệt chặn lưu trữ */ }
}
