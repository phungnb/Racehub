'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Gift, Loader2 } from 'lucide-react'
import { supabase } from '@/shared/lib/supabase'
import { applyReferral, referralErrorMessage } from '@/features/referral/api'
import { savePendingReferral } from '@/features/auth/model/pending-actions'
import { Button, EmptyState } from '@/shared/ui'
import { routes } from '@/shared/config/routes'

export default function ReferralPage({ params }: PageProps<'/join/[code]'>) {
  const { code: referrerId } = use(params)
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (cancelled) return
      if (!session) {
        savePendingReferral(referrerId)
        router.replace(routes.login)
        return
      }
      try {
        await applyReferral(referrerId)
        if (cancelled) return
        toast.success('Nhận thưởng giới thiệu thành công! 🎉')
        router.replace(routes.home)
      } catch (e) {
        if (!cancelled) setError(referralErrorMessage(e))
      }
    })()
    return () => { cancelled = true }
  }, [referrerId, router])

  return (
    <div className="mx-auto grid min-h-dvh max-w-md place-items-center p-4">
      {error ? (
        <EmptyState icon={Gift} title="Không thể áp dụng lời mời" description={error}
          action={<Button variant="secondary" onClick={() => router.replace(routes.home)}>Về trang chủ</Button>} />
      ) : (
        <p className="flex items-center gap-2 text-sm text-fg-muted"><Loader2 className="size-4 animate-spin" /> Đang xử lý lời mời giới thiệu…</p>
      )}
    </div>
  )
}
