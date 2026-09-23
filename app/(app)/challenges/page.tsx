'use client'

import ChallengeTab from '@/features/challenge/components/ChallengeTab'
import { useMyProfile } from '@/features/auth/model/session'

export default function ChallengesPage() {
  const { profile } = useMyProfile()
  return <ChallengeTab profile={profile} />
}
