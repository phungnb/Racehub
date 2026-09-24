'use client'

import Link from 'next/link'
import { Watch } from 'lucide-react'
import { Button, Card } from '@/shared/ui'

export function ConnectDeviceCard() {
  return (
    <Card className="flex items-center gap-3 border-brand/30 bg-brand/5">
      <Watch className="size-8 shrink-0 text-brand" aria-hidden />
      <div className="flex-1">
        <p className="font-semibold">Kết nối Strava</p>
        <p className="text-sm text-fg-muted">Bài chạy từ Garmin, Coros, Apple Watch sẽ tự động tính vào thử thách.</p>
      </div>
      <Link href="/api/connect/strava"><Button size="sm">Kết nối</Button></Link>
    </Card>
  )
}

