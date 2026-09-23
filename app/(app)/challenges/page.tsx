'use client'

import { ChallengesScreen } from '@/features/challenge'
import { useMyProfile } from '@/features/auth'

export default function ChallengesPage() {
  const { profile } = useMyProfile()
  return <ChallengesScreen profile={profile} />
}
