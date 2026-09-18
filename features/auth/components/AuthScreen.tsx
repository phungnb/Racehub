'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function AuthScreen({ onAuthSuccess }: { onAuthSuccess: () => void }) {
  const [isLogin, setIsLogin] = useState(true)
  const [identifier, setIdentifier] = useState('') // Có thể là Email hoặc Số điện thoại
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // Hàm chuyển đổi số điện thoại thành email hệ thống nếu người dùng nhập SĐT
  const resolveEmailInput = (input: string) => {
    const cleanInput = input.trim()
    // Nếu là số điện thoại (chứa toàn số hoặc bắt đầu bằng dấu +)
    if (/^[0-9+]+$/.test(cleanInput)) {
      return `${cleanInput}@phone.racehub.vn`
    }
    return cleanInput
  }

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg('')

    const processedEmail = resolveEmailInput(identifier)

    if (isLogin) {
      // ĐĂNG NHẬP KHÔNG CẦN XÁC NHẬN
      const { error } = await supabase.auth.signInWithPassword({ 
        email: processedEmail, 
        password 
      })
      if (error) {
        setErrorMsg('Sai tài khoản hoặc mật khẩu. Vui lòng kiểm tra lại!')
      } else {
        onAuthSuccess()
      }
    } else {
      // ĐĂNG KÝ TỨC THÌ (Tự động bypass xác nhận email trên Supabase)
      const { data, error } = await supabase.auth.signUp({
        email: processedEmail,
        password,
        options: {
          data: { display_name: displayName || identifier }
        }
      })

      if (error) {
        setErrorMsg(error.message)
      } else {
        // Nếu Supabase yêu cầu confirm, ta tiến hành ép đăng nhập luôn hoặc báo thành công
        if (data.session) {
          onAuthSuccess()
        } else {
          // Tự động đăng nhập luôn sau khi đăng ký để không cần bấm xác nhận
          const { error: loginError } = await supabase.auth.signInWithPassword({
            email: processedEmail,
            password
          })
          if (loginError) {
            setErrorMsg('Đăng ký thành công! Vui lòng bấm Đăng nhập.')
            setIsLogin(true)
          } else {
            onAuthSuccess()
          }
        }
      }
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-black text-orange-500 tracking-wider">
            RACEHUB <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full">v1.0</span>
          </h1>
          <p className="text-sm text-slate-400">
            {isLogin ? 'Chào mừng trở lại đường đua!' : 'Đăng ký nhanh không cần xác nhận'}
          </p>
        </div>

        {errorMsg && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs p-3 rounded-xl text-center">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleAuth} className="space-y-4">
          {!isLogin && (
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">Tên hiển thị</label>
              <input 
                type="text" 
                required 
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Nguyễn Bá Phụng"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-orange-500"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">Email hoặc Số điện thoại</label>
            <input 
              type="text" 
              required 
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="nhapsdt@gmail.com hoặc 0909123456"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-orange-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">Mật khẩu</label>
            <input 
              type="password" 
              required 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-orange-500"
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3.5 rounded-xl text-sm transition-all shadow-lg shadow-orange-500/20 cursor-pointer"
          >
            {loading ? 'Đang xử lý...' : (isLogin ? 'ĐĂNG NHẬP' : 'TẠO TÀI KHOẢN NGAY')}
          </button>
        </form>

        <div className="text-center">
          <button 
            type="button"
            onClick={() => setIsLogin(!isLogin)}
            className="text-xs text-slate-400 hover:text-orange-400 transition-colors cursor-pointer"
          >
            {isLogin ? "Chưa có tài khoản? Đăng ký ngay" : "Đã có tài khoản? Đăng nhập"}
          </button>
        </div>
      </div>
    </div>
  )
}