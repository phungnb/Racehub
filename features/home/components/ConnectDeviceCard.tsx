'use client'

import { Watch } from 'lucide-react'
import { Card } from '@/shared/ui'
import { StravaConnectButton, StravaShareNotice } from '@/features/integrations'

export function ConnectDeviceCard() {
  return (
    <Card className="space-y-3 border-brand/30 bg-brand/5">
      <div className="flex items-center gap-3">
        <Watch className="size-8 shrink-0 text-brand" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Kết nối Strava</p>
          <p className="text-sm text-fg-muted">Bài chạy từ Garmin, Coros, Apple Watch sẽ tự động tính vào tiến độ của bạn.</p>
        </div>
      </div>
      <StravaConnectButton href="/api/connect/strava" size="lg" />
      <StravaShareNotice />
    </Card>
  )
}
