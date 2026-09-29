'use client'

import { useMyProfile } from '@/features/auth'
import { ActivityList } from '@/features/activity'
import { PageHeader, Skeleton } from '@/shared/ui'

/** Hoạt động của tôi: mọi bài chạy gần đây, bấm vào để xem chi tiết (lối tắt từ thẻ trên Trang chủ) */
export default function ActivitiesPage() {
  const { profile } = useMyProfile()
  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader title="Hoạt động của bạn" subtitle="Bấm vào một bài để xem bản đồ, từng km, nhịp tim" />
      {profile ? <ActivityList userId={profile.id} limit={60} /> : <Skeleton className="h-64" />}
    </div>
  )
}
