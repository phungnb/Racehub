'use client'

import { SettingsScreen } from '@/features/profile'
import { useMyProfile } from '@/features/auth'
import { Skeleton } from '@/shared/ui'

export default function SettingsPage() {
  const { profile } = useMyProfile()
  return profile ? <SettingsScreen profile={profile} /> : <Skeleton className="h-96" />
}
