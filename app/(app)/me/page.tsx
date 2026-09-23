'use client'

import { Suspense, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { MeScreen } from '@/features/profile/components/MeScreen'
import { useInvalidateProfile, useMyProfile } from '@/features/auth/model/session'
import { Skeleton } from '@/shared/ui'

const STRAVA_ERRORS: Record<string, string> = {
  access_denied: 'Bạn đã hủy hoặc từ chối cấp quyền truy cập Strava.',
  account_conflict: 'Tài khoản Strava này đã được liên kết với một tài khoản RaceHub khác.',
  invalid_state: 'Phiên kết nối Strava không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.',
  auth_required: 'Bạn cần đăng nhập trước khi kết nối Strava.',
  server_error: 'Có lỗi hệ thống khi kết nối Strava. Vui lòng thử lại sau.',
}

function StravaResultNotice() {
  const params = useSearchParams()
  const router = useRouter()
  const invalidateProfile = useInvalidateProfile()
  const handled = useRef<string | null>(null)

  useEffect(() => {
    const ok = params.get('strava_success')
    const err = params.get('strava_error')
    if (!ok && !err) return
    // Chỉ xử lý mỗi kết quả một lần (URL chưa kịp đổi thì effect có thể chạy lại)
    const key = params.toString()
    if (handled.current === key) return
    handled.current = key
    if (ok) {
      toast.success('Kết nối Strava thành công!')
      invalidateProfile()
    } else if (err) {
      toast.error(STRAVA_ERRORS[err] ?? 'Không kết nối được Strava.')
    }
    router.replace('/me')
  }, [params, router, invalidateProfile])

  return null
}

export default function MePage() {
  const { profile } = useMyProfile()
  return (
    <>
      <Suspense fallback={null}><StravaResultNotice /></Suspense>
      {profile ? <MeScreen profile={profile} /> : <Skeleton className="h-96" />}
    </>
  )
}
