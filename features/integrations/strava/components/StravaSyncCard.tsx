'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card } from '@/shared/ui'
import { formatCoin } from '@/shared/lib/format'
import { useInvalidateProfile } from '@/features/auth/model/session'
import type { SyncSummary } from '../mapping'

async function syncNow(): Promise<SyncSummary> {
  const res = await fetch('/api/strava/sync', { method: 'POST' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.message ?? 'Không đồng bộ được Strava.')
  return body as SyncSummary
}

export function StravaSyncCard() {
  const qc = useQueryClient()
  const invalidateProfile = useInvalidateProfile()
  const m = useMutation({
    mutationFn: syncNow,
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ['activities'] })
      invalidateProfile()
      if (s.imported === 0) {
        toast.info('Không có bài chạy mới trên Strava.')
      } else {
        toast.success(
          `Đã nhập ${s.imported} bài chạy` +
            (s.earned_xu > 0 ? ` · +${formatCoin(s.earned_xu)} Xu` : '') +
            (s.pending > 0 ? ` · ${s.pending} bài chờ xác minh` : ''),
        )
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Không đồng bộ được Strava.'),
  })

  return (
    <Card className="flex items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#fc4c02]/15 text-sm font-black text-[#fc4c02]" aria-hidden>S</span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Strava đã kết nối</p>
        <p className="text-sm text-fg-muted">Bài chạy mới tự về sau vài phút. Bấm để lấy ngay.</p>
      </div>
      <Button size="sm" variant="secondary" loading={m.isPending} onClick={() => m.mutate()}>
        {!m.isPending && <RefreshCw className="size-4" aria-hidden />} Đồng bộ
      </Button>
    </Card>
  )
}
