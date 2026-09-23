'use client'

import ClubTab from '@/features/club/components/ClubTab'
import { useInvalidateProfile, useMyProfile } from '@/features/auth/model/session'

export default function ClubsPage() {
  const { profile } = useMyProfile()
  const invalidateProfile = useInvalidateProfile()
  return <ClubTab profile={profile} onProfileUpdated={invalidateProfile} />
}
