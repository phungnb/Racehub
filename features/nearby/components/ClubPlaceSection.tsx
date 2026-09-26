'use client'

import { useState } from 'react'
import { MapPin } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, SectionTitle, Sheet, Skeleton } from '@/shared/ui'
import { nearbyErrorMessage, setClubLocation } from '../api/nearbyApi'
import { useClubPlace, useNearbyMutation } from '../hooks/useNearby'
import { LocationPicker, type PickedPlace } from './LocationPicker'

/** Cài đặt CLB: khu vực hoạt động (~1 km) để runner Quanh đây tìm thấy CLB */
export function ClubPlaceSection({ clubId }: { clubId: string }) {
  const q = useClubPlace(clubId)
  const [open, setOpen] = useState(false)
  const save = useNearbyMutation((p: PickedPlace | null) => setClubLocation(clubId, p?.lat ?? null, p?.lng ?? null, p?.area ?? null))
  const has = q.data?.lat != null
  return (
    <section>
      <SectionTitle>Khu vực hoạt động</SectionTitle>
      <Card className="space-y-3">
        {q.isPending ? <Skeleton className="h-12" /> : (
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/15 text-brand"><MapPin className="size-5" aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{has ? (q.data?.area_label ?? 'Đã đặt khu vực') : 'Chưa đặt khu vực'}</p>
              <p className="text-xs text-fg-muted">Runner ở gần thấy CLB trong Quanh đây (chỉ hiện khoảng cách, không hiện điểm chính xác).</p>
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>{has ? 'Đổi khu vực' : 'Đặt khu vực'}</Button>
          {has && (
            <Button size="sm" variant="ghost" loading={save.isPending && save.variables === null}
              onClick={() => save.mutate(null, { onSuccess: () => toast.success('Đã gỡ CLB khỏi Quanh đây'), onError: (e) => toast.error(nearbyErrorMessage(e)) })}>
              Gỡ khỏi Quanh đây
            </Button>
          )}
        </div>
      </Card>
      {open && (
        <Sheet open onClose={() => setOpen(false)} title="Khu vực hoạt động của CLB" description="Chọn nơi CLB hay tập (công viên, hồ, sân vận động).">
          <LocationPicker initialArea={q.data?.area_label} busy={save.isPending} submitLabel="Lưu khu vực"
            onPick={(p) => save.mutate(p, { onSuccess: () => { toast.success('Đã lưu khu vực CLB'); setOpen(false) }, onError: (e) => toast.error(nearbyErrorMessage(e)) })} />
        </Sheet>
      )}
    </section>
  )
}
