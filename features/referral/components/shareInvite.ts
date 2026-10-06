// Gửi lời mời (Zalo, Messenger, SMS…): app cài dùng bảng Chia sẻ của hệ điều hành (@capacitor/share — WebView Android không có
// navigator.share); trình duyệt dùng Web Share; không có thì sao chép lời mời để dán.
import { Capacitor } from '@capacitor/core'

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed'

const cancelled = (e: unknown) => (e as Error)?.name === 'AbortError' || /cancel/i.test((e as Error)?.message ?? '')

/** `text` đã chứa link — không truyền thêm url để Zalo / Messenger không hiện link hai lần */
export async function shareInvite(text: string, title = 'Chạy cùng mình trên RaceHub'): Promise<ShareResult> {
  if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Share')) {
    try {
      const { Share } = await import('@capacitor/share')
      await Share.share({ title, text, dialogTitle: 'Gửi link mời bạn bè' })
      return 'shared'
    } catch (e) {
      if (cancelled(e)) return 'cancelled'
    }
  }
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title, text })
      return 'shared'
    } catch (e) {
      if (cancelled(e)) return 'cancelled'
    }
  }
  try {
    await navigator.clipboard.writeText(text)
    return 'copied'
  } catch {
    return 'failed'
  }
}
