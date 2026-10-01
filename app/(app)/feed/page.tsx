'use client'

import { useMyProfile, useSession } from '@/features/auth'
import { ConnectDeviceCard, ExploreShortcuts } from '@/features/home'
import { GameHub } from '@/features/game'
import { StravaAutoSync } from '@/features/integrations'
import { InstallCard } from '@/features/pwa'
import { KnowledgeHomeSection } from '@/features/knowledge'
import { Skeleton } from '@/shared/ui'
import { CommunityFeed } from '@/features/club'
import { HomeFeeds } from '@/features/social'

export default function FeedPage() {
  const { profile } = useMyProfile()
  // Phần không cần hồ sơ (lối tắt, kiến thức, bảng tin) tải song song ngay, không chờ hồ sơ về trước
  const meId = useSession().session?.user.id

  return (
    <div className="space-y-6 animate-fade-in">
      <InstallCard />
      {profile ? <GameHub profile={profile} /> : <Skeleton className="h-52" />}
      <ExploreShortcuts />
      <KnowledgeHomeSection />
      {profile && (profile.strava_connected ? <StravaAutoSync /> : <ConnectDeviceCard />)}

      {meId && <HomeFeeds community={<CommunityFeed meId={meId} />} />}
    </div>
  )
}
