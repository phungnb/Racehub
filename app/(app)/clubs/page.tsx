'use client'

import { ClubsScreen } from '@/features/club'
import { useInvalidateProfile, useMyProfile } from '@/features/auth'

export default function ClubsPage() {
  const { profile } = useMyProfile()
  const invalidateProfile = useInvalidateProfile()
  return <ClubsScreen profile={profile} onProfileUpdated={invalidateProfile} />
}
