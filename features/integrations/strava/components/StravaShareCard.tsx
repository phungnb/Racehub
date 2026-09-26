'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, Info } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { myStravaSharing, setStravaSharing } from '../api/shareApi'
import { PoweredByStrava } from './StravaBrand'

export const stravaShareKey = ['strava', 'sharing'] as const

/**
 * Đồng ý hiện bài Strava cho CLB & bảng xếp hạng (hướng B+, migration 007000).
 * - mode "prompt": chỉ hiện khi đã kết nối Strava mà chưa trả lời (đặt ở trang chủ)
 * - mode "setting": luôn hiện khi đã kết nối (đặt trong Cài đặt → Quyền riêng tư)
 */
export function StravaShareCard({ mode = 'setting' }: { mode?: 'prompt' | 'setting' }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: stravaShareKey, queryFn: myStravaSharing, staleTime: 60_000 })
  const set = useMutation({
    mutationFn: setStravaSharing,
    onSuccess: (d) => {
      qc.setQueryData(stravaShareKey, d)
      void qc.invalidateQueries({ queryKey: ['club'] })
      void qc.invalidateQueries({ queryKey: ['challenges'] })
      toast.success(d.consent ? 'Bài chạy từ Strava sẽ hiện trên CLB và bảng xếp hạng' : 'Bài chạy từ Strava giờ chỉ mình bạn thấy')
    },
    onError: () => toast.error('Không lưu được lựa chọn. Thử lại sau.'),
  })
  const d = q.data
  if (!d || !d.connected) return null
  if (mode === 'prompt' && (d.consent !== null || d.policy !== 'OPT_IN')) return null

  if (d.policy !== 'OPT_IN') {
    return (
      <Card className="flex gap-2 text-sm text-fg-muted">
        <Info className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
        <span>{d.policy === 'OWNER_ONLY'
          ? 'Theo quy định của Strava, bài chạy đồng bộ từ Strava chỉ bạn thấy (vẫn tính Xu, XP, huy hiệu). Ghi bằng app RaceHub để lên bảng xếp hạng CLB.'
          : 'Bài chạy từ Strava được tính vào CLB và bảng xếp hạng.'} <PoweredByStrava className="ml-1" /></span>
      </Card>
    )
  }

  const on = d.consent === true
  return (
    <Card className={cn('space-y-3', mode === 'prompt' && 'border-brand/40 bg-brand/5')}>
      <div className="flex items-start gap-3">
        {on ? <Eye className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden /> : <EyeOff className="mt-0.5 size-5 shrink-0 text-fg-subtle" aria-hidden />}
        <div className="min-w-0 flex-1 space-y-1 text-sm">
          <p className="font-semibold">Hiện bài chạy từ Strava cho CLB & bảng xếp hạng</p>
          <p className="text-fg-muted">
            {on ? 'Đang bật: thành viên CLB thấy quãng đường, thời gian bài Strava của bạn; bài được tính vào thử thách, giải chạy ảo, BXH. Bản đồ, nhịp tim chỉ bạn xem.'
              : d.consent === false ? `Đang tắt: ${d.hidden_runs} bài Strava chỉ mình bạn thấy — vẫn tính Xu, XP, huy hiệu nhưng không lên BXH, thử thách của CLB.`
              : 'Theo quy định của Strava, RaceHub cần bạn đồng ý trước khi hiện bài Strava cho người khác. Không đồng ý: bài vẫn tính Xu, XP, huy hiệu cho riêng bạn.'}
          </p>
          <PoweredByStrava />
        </div>
      </div>
      {d.consent === null ? (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" loading={set.isPending && set.variables === false} onClick={() => set.mutate(false)}>Chỉ mình tôi</Button>
          <Button loading={set.isPending && set.variables === true} onClick={() => set.mutate(true)}>Đồng ý hiện</Button>
        </div>
      ) : (
        <Button block variant={on ? 'secondary' : 'primary'} loading={set.isPending} onClick={() => set.mutate(!on)}>
          {on ? 'Tắt — chỉ mình tôi thấy' : 'Bật hiện cho CLB & BXH'}
        </Button>
      )}
    </Card>
  )
}
