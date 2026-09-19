'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/shared/lib/supabase'
import { joinClubByCode, clubErrorMessage } from '@/features/club/api'

export default function JoinClubPage({ params }: { params: { code: string } }) {
  const router = useRouter()
  const [status, setStatus] = useState<'checking-auth' | 'loading' | 'error'>('checking-auth')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false

    async function run() {
      const { data: { session } } = await supabase.auth.getSession()
      if (cancelled) return

      if (!session) {
        // Chưa đăng nhập: quay về trang chủ, AuthScreen sẽ tự hiện.
        // Lưu lại code để join tiếp sau khi đăng nhập xong.
        sessionStorage.setItem('pending_join_code', params.code)
        router.replace('/')
        return
      }

      setStatus('loading')
      try {
        const member = await joinClubByCode(params.code)
        if (cancelled) return
        router.replace(`/?tab=club&clubId=${member.club_id}`)
      } catch (e) {
        if (cancelled) return
        setStatus('error')
        setMessage(clubErrorMessage(e))
      }
    }

    run()
    return () => { cancelled = true }
  }, [params.code, router])

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6">
        <div className="bg-slate-900 border border-rose-900/60 rounded-2xl p-6 max-w-sm w-full text-center space-y-3">
          <h1 className="text-sm font-bold text-rose-400">Không thể tham gia</h1>
          <p className="text-xs text-slate-400">{message}</p>
          <button
            onClick={() => router.replace('/')}
            className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-2.5 rounded-xl text-xs cursor-pointer"
          >
            Về trang chủ
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950">
      <p className="text-xs text-slate-400">Đang xử lý lời mời…</p>
    </div>
  )
}