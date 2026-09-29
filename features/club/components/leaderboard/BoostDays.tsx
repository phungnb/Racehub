'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { deleteBoostDay, getBoostDays, type BoostDay } from '../../api/hubApi'
import { clubErrorMessage } from '../../api/clubApi'

const x = (m: number) => `×${String(m).replace('.', ',')}`
const vnToday = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' })

/** Ngày vàng (migration 007700): km trong ngày được nhân trên BXH CLB và thử thách nội bộ CLB — không nhân XP / Xu */
export function BoostDays({ clubId, isStaff }: { clubId: string; isStaff: boolean }) {
  const qc = useQueryClient()
  const key = ['club', clubId, 'boost-days']
  const q = useQuery({ queryKey: key, queryFn: () => getBoostDays(clubId), staleTime: 60_000 })
  const done = (list: BoostDay[]) => { qc.setQueryData(key, list); void qc.invalidateQueries({ queryKey: ['club', clubId, 'leaderboard'] }) }
  const del = useMutation({
    mutationFn: (day: string) => deleteBoostDay(clubId, day),
    onSuccess: (list) => { done(list); toast.success('Đã bỏ ngày vàng') },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  const today = vnToday()
  const days = (q.data ?? []).filter((b) => b.day >= today)
  const now = days.find((b) => b.day === today)
  // Ngày vàng nay đặt trong từng thử thách (tab Luật chơi); ở đây chỉ còn hiện ngày vàng CLB đã đặt trước đó
  if (days.length === 0) return null
  return (
    <>
      <Card className={cn('space-y-2', now && 'border-coin/50 bg-coin/10')}>
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 shrink-0 text-coin" aria-hidden />
          <p className="min-w-0 flex-1 text-sm">
            {now ? <><b>Hôm nay là ngày vàng {x(now.multiplier)}</b> · {now.title}</> : <b>Ngày vàng</b>}
            <span className="block text-xs text-fg-muted">Km chạy trong ngày được nhân trên BXH và thử thách của CLB (XP, Xu vẫn tính km thật).{isStaff ? ' Thêm ngày vàng mới: mở từng thử thách → Luật chơi → Ngày vàng.' : ''}</span>
          </p>
        </div>
        {days.filter((b) => b.day !== today).slice(0, 6).map((b) => (
          <div key={b.day} className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-1.5 text-sm">
            <span className="w-24 shrink-0 font-semibold">{fmt(b.day)}</span>
            <span className="min-w-0 flex-1 truncate text-fg-muted">{b.title}</span>
            <span className="font-mono font-bold text-coin">{x(b.multiplier)}</span>
            {isStaff && b.editable && (
              <button type="button" aria-label={`Bỏ ngày vàng ${fmt(b.day)}`} onClick={() => del.mutate(b.day)}
                className="grid size-8 place-items-center rounded-full text-fg-subtle hover:text-danger"><Trash2 className="size-4" aria-hidden /></button>
            )}
          </div>
        ))}
      </Card>
    </>
  )
}
