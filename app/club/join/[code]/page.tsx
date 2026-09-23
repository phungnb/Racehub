'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, ShieldX } from 'lucide-react'
import { supabase } from '@/shared/lib/supabase'
import { joinClubByCode, clubErrorMessage } from '@/features/club/api'
import { savePendingClubCode } from '@/features/auth/model/pending-actions'
import { Button, EmptyState } from '@/shared/ui'
import { routes } from '@/shared/config/routes'

export default function JoinClubPage({ params }: PageProps<'/club/join/[code]'>) {
  const { code } = use(params)            // Next 15+: params là Promise
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (cancelled) return
      if (!session) {
        savePendingClubCode(code)
        router.replace(routes.login)
        return
      }
      try {
        const member = await joinClubByCode(code)
        if (cancelled) return
        toast.success('Đã gửi yêu cầu tham gia CLB')
        router.replace(routes.club(member.club_id))
      } catch (e) {
        if (!cancelled) setError(clubErrorMessage(e))
      }
    })()
    return () => { cancelled = true }
  }, [code, router])

  return (
    <div className="mx-auto grid min-h-dvh max-w-md place-items-center p-4">
      {error ? (
        <EmptyState icon={ShieldX} title="Không thể tham gia CLB" description={error}
          action={<Button variant="secondary" onClick={() => router.replace(routes.clubs)}>Về danh sách CLB</Button>} />
      ) : (
        <p className="flex items-center gap-2 text-sm text-fg-muted"><Loader2 className="size-4 animate-spin" /> Đang xử lý lời mời…</p>
      )}
    </div>
  )
}
