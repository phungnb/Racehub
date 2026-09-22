'use client'

import { useState } from 'react'
import { supabase } from '@/shared/lib/supabase'
import { Loader2, Eye, EyeOff, Mail, Lock, User, ArrowLeft, CheckCircle2 } from 'lucide-react'

type Mode = 'login' | 'register' | 'forgot'

export default function AuthScreen({ onAuthSuccess }: { onAuthSuccess: () => void }) {
  const [mode, setMode] = useState<Mode>('login')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
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
    } catch (err: any) {
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
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-black text-orange-500 tracking-wider">
            RACEHUB{' '}
            <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full align-middle">
              v1.0
            </span>
          </h1>
          <p className="text-sm text-slate-400">
            {mode === 'login' && 'Chào mừng trở lại đường đua!'}
            {mode === 'register' && 'Tạo tài khoản để bắt đầu chinh phục'}
            {mode === 'forgot' && 'Khôi phục mật khẩu của bạn'}
          </p>
        </div>

        {/* Tab chỉ hiện ở login/register, ẩn khi ở forgot */}
        {mode !== 'forgot' && (
          <div className="grid grid-cols-2 bg-slate-950 border border-slate-800 rounded-xl p-1">
            <button
              type="button"
              onClick={() => switchMode('login')}
              className={`py-2.5 rounded-lg text-sm font-bold transition-all cursor-pointer ${
                mode === 'login' ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Đăng nhập
            </button>
            <button
              type="button"
              onClick={() => switchMode('register')}
              className={`py-2.5 rounded-lg text-sm font-bold transition-all cursor-pointer ${
                mode === 'register' ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' : 'text-slate-400 hover:text-slate-200'
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
                <p className="text-xs text-slate-400 leading-relaxed">
                  Kiểm tra hộp thư <span className="text-orange-400 font-semibold">{identifier}</span> và bấm vào liên kết để đặt lại mật khẩu.
                </p>
              </div>
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="text-xs text-slate-400 hover:text-orange-400 transition-colors cursor-pointer flex items-center gap-1 justify-center mx-auto"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Quay lại đăng nhập
              </button>
            </div>
          ) : (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">Email đã đăng ký</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    required
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="ban@gmail.com"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-all"
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">
                  Chúng tôi sẽ gửi một liên kết đặt lại mật khẩu đến email này.
                </p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl text-sm transition-all shadow-lg shadow-orange-500/20 cursor-pointer flex items-center justify-center gap-2"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {loading ? 'Đang gửi...' : 'GỬI LIÊN KẾT KHÔI PHỤC'}
              </button>

              <button
                type="button"
                onClick={() => switchMode('login')}
                className="w-full text-xs text-slate-400 hover:text-orange-400 transition-colors cursor-pointer flex items-center gap-1 justify-center"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Quay lại đăng nhập
              </button>
            </form>
          )
        )}

        {/* ===== FORM: ĐĂNG NHẬP / ĐĂNG KÝ ===== */}
        {mode !== 'forgot' && (
          <form onSubmit={handleAuth} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">Tên hiển thị</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Nguyễn Bá Phụng"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-all"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">Email hoặc Số điện thoại</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="ban@gmail.com hoặc 0909123456"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-all"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-bold text-slate-300">Mật khẩu</label>
                {mode === 'login' && (
                  <button
                    type="button"
                    onClick={() => switchMode('forgot')}
                    className="text-[11px] text-orange-400 hover:underline cursor-pointer font-semibold"
                  >
                    Quên mật khẩu?
                  </button>
                )}
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-10 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl text-sm transition-all shadow-lg shadow-orange-500/20 cursor-pointer flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Đang xử lý...' : mode === 'login' ? 'ĐĂNG NHẬP' : 'TẠO TÀI KHOẢN NGAY'}
            </button>
          </form>
        )}

        {mode !== 'forgot' && (
          <p className="text-center text-[11px] text-slate-600">
            Bằng việc tiếp tục, bạn đồng ý với Điều khoản sử dụng của RaceHub
          </p>
        )}
      </div>
    </div>
  )
}