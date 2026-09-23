'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { KeyRound } from 'lucide-react'
import { supabase } from '@/shared/lib/supabase'
import { useSession } from '@/features/auth/model/session'
import { Button, Card } from '@/shared/ui'
import { routes } from '@/shared/config/routes'

// Người dùng tới đây từ link "Quên mật khẩu" trong email.
// Supabase tự đổi mã trong URL thành phiên đăng nhập tạm để cho phép đặt mật khẩu mới.
export default function ResetPasswordPage() {
  const router = useRouter()
  const { session, loading } = useSession()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) return toast.error('Mật khẩu cần ít nhất 8 ký tự.')
    if (password !== confirm) return toast.error('Mật khẩu nhập lại không khớp.')
    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password })
    setSaving(false)
    if (error) return toast.error('Không đặt được mật khẩu: ' + error.message)
    toast.success('Đã cập nhật mật khẩu')
    router.replace(routes.home)
  }

  const input = 'h-11 w-full rounded-xl border border-border bg-bg px-3 text-[15px] outline-none focus:border-brand'

  return (
    <div className="mx-auto grid min-h-dvh max-w-md place-items-center p-4">
      <Card className="w-full space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound className="size-5 text-brand" aria-hidden />
          <h1 className="text-lg font-bold">Đặt mật khẩu mới</h1>
        </div>
        {!loading && !session ? (
          <p className="text-sm text-fg-muted">Liên kết đã hết hạn hoặc không hợp lệ. Hãy yêu cầu gửi lại email đặt lại mật khẩu.</p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <label className="block space-y-1 text-sm">
              <span className="text-fg-muted">Mật khẩu mới</span>
              <input type="password" autoComplete="new-password" className={input} value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-fg-muted">Nhập lại mật khẩu</span>
              <input type="password" autoComplete="new-password" className={input} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </label>
            <Button type="submit" block loading={saving}>Lưu mật khẩu</Button>
          </form>
        )}
      </Card>
    </div>
  )
}
