'use client'

import { useState } from 'react'
import { supabase } from '@/shared/lib/supabase'
import { Loader2, Eye, EyeOff, Mail, Lock, User, ArrowLeft, CheckCircle2, Gift } from 'lucide-react'
import { peekPendingReferral, savePendingReferral } from '../model/pending-actions'
import { enabledProviders, signInWithProvider, socialErrorMessage, type OAuthProvider } from '../model/socialAuth'

const CALLBACK_ERROR: Record<string, string> = {
  cancelled: 'Bạn đã hủy đăng nhập.',
  verifier: 'Phiên đăng nhập đã hết hạn — hãy bấm đăng nhập lại (mở trên cùng trình duyệt / app).',
  oauth: 'Không đăng nhập được bằng tài khoản này. Thử lại hoặc dùng email.',
}

type Mode = 'login' | 'register' | 'forgot'

export default function AuthScreen({ onAuthSuccess, next = '/feed', callbackError }: { onAuthSuccess: () => void; next?: string; callbackError?: string | null }) {
  const [mode, setMode] = useState<Mode>(() => (peekPendingReferral() ? 'register' : 'login'))
  const [referral, setReferral] = useState(() => peekPendingReferral() ?? '')
  const [social, setSocial] = useState<OAuthProvider | null>(null)
  const providers = enabledProviders()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState(() => (callbackError ? CALLBACK_ERROR[callbackError] ?? CALLBACK_ERROR.oauth : ''))
  const [resetSent, setResetSent] = useState(false)

  const resolveEmailInput = (input: string) => {
    const cleanInput = input.trim()
    if (/^[0-9+]+$/.test(cleanInput)) {
      return `${cleanInput}@phone.racehub.vn`
    }
    return cleanInput
  }

  const safeAuthCall = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn()
    } catch (err) {
      console.error('Auth call failed:', err)
      setErrorMsg('Không thể kết nối đến máy chủ xác thực. Vui lòng thử lại sau.')
      return null
    }
  }

  const switchMode = (next: Mode) => {
    setMode(next)
    setErrorMsg('')
    setResetSent(false)
  }

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg('')

    const processedEmail = resolveEmailInput(identifier)

    if (mode === 'login') {
      const result = await safeAuthCall(() =>
        supabase.auth.signInWithPassword({ email: processedEmail, password })
      )
    if (result) {
      if (result.error) {
        if (result.error.message.toLowerCase().includes('email not confirmed')) {
          setErrorMsg('Email chưa được xác nhận. Vui lòng kiểm tra hộp thư và bấm vào liên kết xác nhận trước khi đăng nhập.')
        } else if (result.error.message.toLowerCase().includes('invalid login credentials')) {
          setErrorMsg('Sai tài khoản hoặc mật khẩu. Vui lòng kiểm tra lại!')
        } else {
          setErrorMsg(result.error.message)
        }
      } else {
        onAuthSuccess()
      }
    }
    } else if (mode === 'register') {
      // Mã giới thiệu: lưu lại, sau khi vào app sẽ tự áp dụng (trang /join/<mã>)
      if (referral.trim()) savePendingReferral(referral.trim().toUpperCase())
      const result = await safeAuthCall(() =>
        supabase.auth.signUp({
          email: processedEmail,
          password,
          options: { data: { display_name: displayName || identifier } },
        })
      )

      if (result) {
        const { data, error } = result
        if (error) {
          setErrorMsg(error.message)
        } else if (data.session) {
          onAuthSuccess()
        } else {
          const loginResult = await safeAuthCall(() =>
            supabase.auth.signInWithPassword({ email: processedEmail, password })
          )
          if (loginResult) {
            if (loginResult.error) {
              setErrorMsg('Đăng ký thành công! Vui lòng bấm Đăng nhập.')
              switchMode('login')
            } else {
              onAuthSuccess()
            }
          }
        }
      }
    }
    setLoading(false)
  }

  const handleSocial = async (p: OAuthProvider) => {
    setErrorMsg('')
    setSocial(p)
    if (mode === 'register' && referral.trim()) savePendingReferral(referral.trim().toUpperCase())
    try {
      await signInWithProvider(p, next)
      // Web: trang chuyển đi ngay; App: trình duyệt hệ thống mở — giữ trạng thái chờ tới khi quay lại
    } catch (e) {
      setErrorMsg(socialErrorMessage(e))
      setSocial(null)
    }
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg('')

    const processedEmail = resolveEmailInput(identifier)

    if (processedEmail.endsWith('@phone.racehub.vn')) {
      setErrorMsg('Tài khoản đăng ký bằng số điện thoại chưa hỗ trợ khôi phục mật khẩu qua bước này. Vui lòng liên hệ hỗ trợ.')
      setLoading(false)
      return
    }

    const result = await safeAuthCall(() =>
      supabase.auth.resetPasswordForEmail(processedEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
    )

    if (result) {
      if (result.error) {
        setErrorMsg(result.error.message)
      } else {
        setResetSent(true)
      }
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-surface border border-border rounded-3xl p-8 shadow-2xl space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-black text-brand tracking-wider">
            RACEHUB{' '}
            <span className="text-xs bg-brand/20 text-brand px-2 py-0.5 rounded-full align-middle">
              v1.0
            </span>
          </h1>
          <p className="text-sm text-fg-muted">
            {mode === 'login' && 'Chào mừng trở lại đường đua!'}
            {mode === 'register' && 'Tạo tài khoản để bắt đầu chinh phục'}
            {mode === 'forgot' && 'Khôi phục mật khẩu của bạn'}
          </p>
        </div>

        {/* Tab chỉ hiện ở login/register, ẩn khi ở forgot */}
        {mode !== 'forgot' && (
          <div className="grid grid-cols-2 bg-bg border border-border rounded-xl p-1">
            <button
              type="button"
              onClick={() => switchMode('login')}
              className={`py-2.5 rounded-lg text-sm font-bold transition-all cursor-pointer ${
                mode === 'login' ? 'bg-brand text-brand-fg shadow-lg shadow-brand/20' : 'text-fg-muted hover:text-fg'
              }`}
            >
              Đăng nhập
            </button>
            <button
              type="button"
              onClick={() => switchMode('register')}
              className={`py-2.5 rounded-lg text-sm font-bold transition-all cursor-pointer ${
                mode === 'register' ? 'bg-brand text-brand-fg shadow-lg shadow-brand/20' : 'text-fg-muted hover:text-fg'
              }`}
            >
              Đăng ký
            </button>
          </div>
        )}

        {errorMsg && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs p-3 rounded-xl text-center">
            {errorMsg}
          </div>
        )}

        {/* ===== FORM: QUÊN MẬT KHẨU ===== */}
        {mode === 'forgot' && (
          resetSent ? (
            <div className="text-center space-y-4 py-4">
              <div className="w-14 h-14 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center justify-center mx-auto text-emerald-400">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-bold text-white">Đã gửi email khôi phục!</p>
                <p className="text-xs text-fg-muted leading-relaxed">
                  Kiểm tra hộp thư <span className="text-brand font-semibold">{identifier}</span> và bấm vào liên kết để đặt lại mật khẩu.
                </p>
              </div>
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="text-xs text-fg-muted hover:text-brand transition-colors cursor-pointer flex items-center gap-1 justify-center mx-auto"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Quay lại đăng nhập
              </button>
            </div>
          ) : (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-fg mb-1.5">Email đã đăng ký</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle" />
                  <input
                    type="text"
                    required
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="ban@gmail.com"
                    className="w-full bg-bg border border-border rounded-xl pl-10 pr-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand transition-all"
                  />
                </div>
                <p className="text-[11px] text-fg-subtle mt-1.5">
                  Chúng tôi sẽ gửi một liên kết đặt lại mật khẩu đến email này.
                </p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-brand hover:bg-brand-strong disabled:opacity-60 disabled:cursor-not-allowed text-brand-fg font-bold py-3.5 rounded-xl text-sm transition-all shadow-lg shadow-brand/20 cursor-pointer flex items-center justify-center gap-2"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {loading ? 'Đang gửi...' : 'GỬI LIÊN KẾT KHÔI PHỤC'}
              </button>

              <button
                type="button"
                onClick={() => switchMode('login')}
                className="w-full text-xs text-fg-muted hover:text-brand transition-colors cursor-pointer flex items-center gap-1 justify-center"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Quay lại đăng nhập
              </button>
            </form>
          )
        )}

        {/* ===== ĐĂNG NHẬP GOOGLE / APPLE ===== */}
        {mode !== 'forgot' && providers.length > 0 && (
          <div className="space-y-2">
            {providers.includes('google') && (
              <button type="button" onClick={() => void handleSocial('google')} disabled={!!social}
                className="flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-white text-sm font-semibold text-[#1f1f1f] transition-opacity hover:opacity-90 disabled:opacity-60">
                {social === 'google' ? <Loader2 className="size-5 animate-spin" /> : <GoogleLogo />}
                Tiếp tục với Google
              </button>
            )}
            {providers.includes('apple') && (
              <button type="button" onClick={() => void handleSocial('apple')} disabled={!!social}
                className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-white/20 bg-black text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60">
                {social === 'apple' ? <Loader2 className="size-5 animate-spin" /> : <AppleLogo />}
                Tiếp tục với Apple
              </button>
            )}
            <div className="flex items-center gap-3 pt-1 text-[11px] uppercase tracking-wider text-fg-subtle">
              <span className="h-px flex-1 bg-border" />hoặc dùng email / số điện thoại<span className="h-px flex-1 bg-border" />
            </div>
          </div>
        )}

        {/* ===== FORM: ĐĂNG NHẬP / ĐĂNG KÝ ===== */}
        {mode !== 'forgot' && (
          <form onSubmit={handleAuth} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-bold text-fg mb-1.5">Tên hiển thị</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle" />
                  <input
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Nguyễn Bá Phụng"
                    className="w-full bg-bg border border-border rounded-xl pl-10 pr-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand transition-all"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-fg mb-1.5">Email hoặc Số điện thoại</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle" />
                <input
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="ban@gmail.com hoặc 0909123456"
                  className="w-full bg-bg border border-border rounded-xl pl-10 pr-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand transition-all"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-bold text-fg">Mật khẩu</label>
                {mode === 'login' && (
                  <button
                    type="button"
                    onClick={() => switchMode('forgot')}
                    className="text-[11px] text-brand hover:underline cursor-pointer font-semibold"
                  >
                    Quên mật khẩu?
                  </button>
                )}
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-bg border border-border rounded-xl pl-10 pr-10 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {mode === 'register' && (
              <div>
                <label htmlFor="auth-ref" className="block text-xs font-bold text-fg mb-1.5">Mã giới thiệu <span className="font-normal text-fg-subtle">(không bắt buộc)</span></label>
                <div className="relative">
                  <Gift className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle" />
                  <input id="auth-ref" type="text" value={referral} maxLength={40} autoCapitalize="characters"
                    onChange={(e) => setReferral(e.target.value)} placeholder="VD: K7M2Q9XA"
                    className="w-full bg-bg border border-border rounded-xl pl-10 pr-4 py-3 font-mono text-sm uppercase tracking-widest text-white focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand transition-all" />
                </div>
                <p className="text-[11px] text-fg-subtle mt-1.5">Bạn và người mời cùng nhận Xu khi bạn chạy đủ vài km đầu tiên.</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brand hover:bg-brand-strong disabled:opacity-60 disabled:cursor-not-allowed text-brand-fg font-bold py-3.5 rounded-xl text-sm transition-all shadow-lg shadow-brand/20 cursor-pointer flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Đang xử lý...' : mode === 'login' ? 'ĐĂNG NHẬP' : 'TẠO TÀI KHOẢN NGAY'}
            </button>
          </form>
        )}

        {mode !== 'forgot' && (
          <p className="text-center text-[11px] text-fg-subtle">
            Bằng việc tiếp tục, bạn đồng ý với <a href="/terms" className="underline hover:text-fg">Điều khoản sử dụng</a> và{' '}
            <a href="/privacy" className="underline hover:text-fg">Chính sách quyền riêng tư</a> của RaceHub
          </p>
        )}
      </div>
    </div>
  )
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

function AppleLogo() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
      <path d="M16.37 12.75c-.03-2.6 2.13-3.86 2.22-3.92-1.21-1.77-3.1-2.01-3.77-2.04-1.6-.16-3.13.95-3.94.95-.82 0-2.07-.93-3.4-.9-1.75.03-3.36 1.02-4.26 2.58-1.82 3.15-.47 7.8 1.3 10.36.87 1.25 1.9 2.65 3.25 2.6 1.3-.05 1.8-.84 3.37-.84 1.57 0 2.02.84 3.4.81 1.4-.02 2.29-1.27 3.15-2.53.99-1.45 1.4-2.86 1.42-2.93-.03-.01-2.72-1.05-2.74-4.14zM13.8 5.12c.72-.87 1.2-2.08 1.07-3.29-1.03.04-2.28.69-3.02 1.56-.66.77-1.24 2-1.09 3.18 1.15.09 2.32-.58 3.04-1.45z" />
    </svg>
  )
}
