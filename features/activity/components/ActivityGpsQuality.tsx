'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Satellite } from 'lucide-react'
import { Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { supabase } from '@/shared/lib/supabase'
import { GpsQualityCard, type GpsQualityData } from '@/features/run'

/** Bài ghi bằng app RaceHub: chỉ số chất lượng GPS lúc chạy (chỉ chủ bài + admin xem — migration 008800). Mở ra mới tải. */
export function ActivityGpsQuality({ id, distanceM }: { id: string; distanceM: number }) {
  const [open, setOpen] = useState(false)
  const q = useQuery({
    queryKey: ['activity', id, 'gps-quality'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('activity_gps_quality', { p_activity_id: id })
      if (error) throw error
      return data as GpsQualityData | null
    },
    enabled: open,
    staleTime: Infinity,
  })
  return (
    <section>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-xl px-1 py-2 text-left text-sm font-semibold text-fg-muted hover:text-fg">
        <Satellite className="size-4" aria-hidden /><span className="flex-1">Chất lượng GPS lúc ghi</span>
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (q.isPending ? <Skeleton className="h-40" />
        : q.data ? <GpsQualityCard q={q.data} distanceM={distanceM} />
          : <p className="px-1 text-sm text-fg-muted">Bài này chưa có dữ liệu chất lượng GPS (ghi trước khi có tính năng này).</p>)}
    </section>
  )
}
