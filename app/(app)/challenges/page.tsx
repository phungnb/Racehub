'use client'

import { ChallengesScreen } from '@/features/challenge/components/ChallengesScreen'
import { useMyProfile } from '@/features/auth/model/session'

export default function ChallengesPage() {
  const { profile } = useMyProfile()
  return <ChallengesScreen profile={profile} />
}
