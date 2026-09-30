'use client'

import { useMyProfile } from '@/features/auth'
import { ConnectDeviceCard, ExploreShortcuts } from '@/features/home'
import { GameHub } from '@/features/game'
import { StravaAutoSync } from '@/features/integrations'
import { InstallCard } from '@/features/pwa'
import { KnowledgeHomeSection } from '@/features/knowledge'
import { Skeleton } from '@/shared/ui'
import { CommunityFeed } from '@/features/club'
import { HomeFeeds } from '@/features/social'

export default function FeedPage() {
  const { profile, isPending } = useMyProfile()

  if (isPending || !profile) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-52" />
        <Skeleton className="h-24" />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <InstallCard />
      <GameHub profile={profile} />
      <ExploreShortcuts />
      <KnowledgeHomeSection />
      {profile.strava_connected ? <StravaAutoSync /> : <ConnectDeviceCard />}

      <HomeFeeds community={<CommunityFeed meId={profile.id} />} />
    </div>
  )
}
