// Đăng nhập Google / Apple qua Supabase Auth (OAuth + PKCE).
//  • Web / PWA: chuyển cả trang sang Google / Apple → quay về /auth/callback (máy chủ đổi mã lấy phiên, ghi cookie).
//  • App cài: Google CẤM đăng nhập trong WebView → mở trình duyệt hệ thống (plugin Browser); xong, hệ điều hành mở lại app
//    bằng vn.racehub.app://auth/callback?code=… → NativeAuthBridge đưa WebView tới /auth/callback để đổi mã.
// Bật nhà cung cấp: Supabase → Authentication → Providers, rồi đặt NEXT_PUBLIC_AUTH_PROVIDERS=google,apple (xem HUONG_DAN_TRIEN_KHAI.md).
import { Capacitor } from '@capacitor/core'
import { supabase } from '@/shared/lib/supabase'

export type OAuthProvider = 'google' | 'apple'
export const NATIVE_CALLBACK = 'vn.racehub.app://auth/callback'

export function enabledProviders(): OAuthProvider[] {
  const raw = (process.env.NEXT_PUBLIC_AUTH_PROVIDERS ?? '').toLowerCase()
  return (['google', 'apple'] as const).filter((p) => raw.split(/[\s,]+/).includes(p))
}

export async function signInWithProvider(provider: OAuthProvider, next: string) {
  const native = Capacitor.isNativePlatform()
  if (native && !Capacitor.isPluginAvailable('Browser')) throw new Error('APP_UPDATE_REQUIRED')
  const query = `?next=${encodeURIComponent(next)}`
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: native ? `${NATIVE_CALLBACK}${query}` : `${window.location.origin}/auth/callback${query}`,
      skipBrowserRedirect: native,
      queryParams: provider === 'google' ? { prompt: 'select_account' } : undefined,
    },
  })
  if (error) throw error
  if (native && data.url) {
    const { Browser } = await import('@capacitor/browser')
    await Browser.open({ url: data.url, presentationStyle: 'popover' })
  }
}

export function socialErrorMessage(e: unknown): string {
  const m = (e as { message?: string } | null)?.message ?? ''
  if (m.includes('APP_UPDATE_REQUIRED')) return 'Hãy cập nhật app RaceHub lên bản mới nhất để đăng nhập bằng Google / Apple.'
  if (/provider is not enabled|Unsupported provider/i.test(m)) return 'Cách đăng nhập này chưa được bật. Hãy dùng email hoặc thử lại sau.'
  return 'Không mở được trang đăng nhập. Kiểm tra mạng rồi thử lại.'
}
