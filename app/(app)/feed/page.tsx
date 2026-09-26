'use client'

import { Users } from 'lucide-react'
import { useMyProfile } from '@/features/auth'
import { ConnectDeviceCard, ExploreShortcuts } from '@/features/home'
import { GameHub } from '@/features/game'
import { ActivityList } from '@/features/activity'
import { StravaSyncCard } from '@/features/integrations'
import { InstallCard } from '@/features/pwa'
import { KnowledgeHomeSection } from '@/features/knowledge'
import { EmptyState, SectionTitle, Skeleton } from '@/shared/ui'

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
      {profile.strava_connected ? <StravaSyncCard /> : <ConnectDeviceCard />}

      <section>
        <SectionTitle>Hoạt động của bạn</SectionTitle>
        <ActivityList userId={profile.id} />
      </section>

      <section>
        <SectionTitle>Bảng tin cộng đồng</SectionTitle>
        <EmptyState icon={Users} title="Sắp ra mắt"
          description="Bạn sẽ thấy bài chạy của bạn bè, kỷ lục mới và có thể gửi Cheer tại đây." />
      </section>
    </div>
  )
}
