'use client'

import { toast } from 'sonner'
import RunTab from '@/features/run/components/RunTab'
import { useInvalidateProfile, useMyProfile } from '@/features/auth/model/session'

export default function RunPage() {
  const { profile } = useMyProfile()
  const invalidateProfile = useInvalidateProfile()
  return (
    <RunTab
      profile={profile}
      onActivitySaved={() => {
        invalidateProfile()
        toast.success('Đã lưu buổi chạy')
      }}
    />
  )
}
