'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card } from '@/shared/ui'
import { supabase } from '@/shared/lib/supabase'

interface ScanStatus { members: number; connected: number; pending: number; done: number; failed: number; imported: number; queued?: number }

/** Ban quản trị: bật quét Strava từ 1/1/2026 chạy nền cho cả CLB (migration 017000). Xem tiến độ ngay tại thẻ. */
export function ClubStravaScan({ clubId, onDone }: { clubId: string; onDone?: () => void }) {
  const qc = useQueryClient()
  const key = ['club', clubId, 'strava-scan']
  const q = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('club_strava_scan_status', { p_club_id: clubId })
      if (error) throw error
      return data as ScanStatus
    },
    // Đang quét thì tự cập nhật tiến độ; xong thì làm mới Đại sảnh
    refetchInterval: (query) => (query.state.data?.pending ? 60_000 : false),
  })
  const start = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('club_request_strava_scan', { p_club_id: clubId })
      if (error) throw error
      return data as ScanStatus
    },
    onSuccess: (s) => {
      qc.setQueryData(key, s)
      toast.success(s.queued ? `Đã bật quét nền cho ${s.queued} thành viên đã nối Strava.` : 'Không có thành viên mới cần quét.')
      onDone?.()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Không bật được quét Strava.'),
  })
  const s = q.data
  if (!s || !s.connected) return null
  const started = s.pending + s.done + s.failed
  const finished = started > 0 && !s.pending
  return (
    <Card className="space-y-2">
      <p className="flex items-center gap-2 text-sm font-bold"><Users className="size-4 text-brand" aria-hidden />Quét Strava cho cả CLB (ban quản trị)</p>
      <p className="text-xs text-fg-muted">
        Lấy toàn bộ bài chạy từ 1/1/2026 của thành viên đã nối Strava, chạy nền và chia nhỏ theo thời gian để không chạm giới hạn Strava (mỗi lần thành viên mở app, và hằng đêm).
        {' '}{s.connected}/{s.members} thành viên đã nối Strava.
        {started > 0 && ` Đã xong ${s.done}, đang chờ ${s.pending}${s.failed ? `, lỗi ${s.failed} (cần nối lại Strava)` : ''} · nhập ${s.imported} bài.`}
      </p>
      {!finished && !s.pending && <Button size="sm" onClick={() => start.mutate()} loading={start.isPending}>Bật quét tự động</Button>}
      {s.pending > 0 && <p className="text-xs font-semibold text-brand">Đang quét nền… tiến độ tự cập nhật.</p>}
      {finished && s.connected > started && <Button size="sm" variant="secondary" onClick={() => start.mutate()} loading={start.isPending}>Thêm thành viên mới nối Strava</Button>}
    </Card>
  )
}
