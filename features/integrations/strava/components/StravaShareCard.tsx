'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, Info } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card } from '@/shared/ui'
import { myStravaSharing, setStravaSharing } from '../api/shareApi'
import { PoweredByStrava } from './StravaBrand'

export const stravaShareKey = ['strava', 'sharing'] as const

/**
 * Công tắc hiện bài Strava cho CLB & bảng xếp hạng (Cài đặt → Quyền riêng tư).
 * Kết nối Strava = đang bật (migration 007400); runner tắt được bất cứ lúc nào (rút lại đồng ý).
 */
export function StravaShareCard() {
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

  // null = cơ sở dữ liệu chưa chạy 007400: suy từ số bài đang ẩn
  const on = d.consent ?? d.hidden_runs === 0
  return (
    <Card className="space-y-3">
      <div className="flex items-start gap-3">
        {on ? <Eye className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden /> : <EyeOff className="mt-0.5 size-5 shrink-0 text-fg-subtle" aria-hidden />}
        <div className="min-w-0 flex-1 space-y-1 text-sm">
          <p className="font-semibold">Hiện bài chạy từ Strava cho CLB & bảng xếp hạng</p>
          <p className="text-fg-muted">
            {on ? 'Đang bật: thành viên CLB thấy quãng đường, thời gian bài Strava của bạn; bài được tính vào thử thách, giải chạy ảo, BXH. Bản đồ, nhịp tim chỉ bạn xem.'
              : `Đang tắt: ${d.hidden_runs} bài Strava chỉ mình bạn thấy — vẫn tính Xu, XP, huy hiệu nhưng không lên BXH, thử thách của CLB.`}
          </p>
          <PoweredByStrava />
        </div>
      </div>
      <Button block variant={on ? 'secondary' : 'primary'} loading={set.isPending} onClick={() => set.mutate(!on)}>
        {on ? 'Tắt — chỉ mình tôi thấy' : 'Bật hiện cho CLB & BXH'}
      </Button>
    </Card>
  )
}
