'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, Field, Input, Sheet } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { deleteBoostDay, getBoostDays, setBoostDay, type BoostDay } from '../../api/hubApi'
import { clubErrorMessage } from '../../api/clubApi'

const MULTIPLIERS = [1.5, 2, 3]
const x = (m: number) => `×${String(m).replace('.', ',')}`
const vnToday = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' })

/** Ngày vàng (migration 007700): km trong ngày được nhân trên BXH CLB và thử thách nội bộ CLB — không nhân XP / Xu */
export function BoostDays({ clubId, isStaff }: { clubId: string; isStaff: boolean }) {
  const qc = useQueryClient()
  const key = ['club', clubId, 'boost-days']
  const q = useQuery({ queryKey: key, queryFn: () => getBoostDays(clubId), staleTime: 60_000 })
  const [open, setOpen] = useState(false)
  const done = (list: BoostDay[]) => { qc.setQueryData(key, list); void qc.invalidateQueries({ queryKey: ['club', clubId, 'leaderboard'] }) }
  const del = useMutation({
    mutationFn: (day: string) => deleteBoostDay(clubId, day),
    onSuccess: (list) => { done(list); toast.success('Đã bỏ ngày vàng') },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  const today = vnToday()
  const days = (q.data ?? []).filter((b) => b.day >= today)
  const now = days.find((b) => b.day === today)
  if (!isStaff && days.length === 0) return null
  return (
    <>
      <Card className={cn('space-y-2', now && 'border-coin/50 bg-coin/10')}>
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 shrink-0 text-coin" aria-hidden />
          <p className="min-w-0 flex-1 text-sm">
            {now ? <><b>Hôm nay là ngày vàng {x(now.multiplier)}</b> · {now.title}</> : <b>Ngày vàng</b>}
            <span className="block text-xs text-fg-muted">Km chạy trong ngày được nhân trên BXH và thử thách của CLB (XP, Xu vẫn tính km thật).</span>
          </p>
          {isStaff && <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Thêm</Button>}
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
        {isStaff && days.length === 0 && <p className="text-xs text-fg-subtle">Chưa có ngày vàng nào. Gợi ý: sinh nhật CLB, ngày lễ, tuần trước giải lớn.</p>}
      </Card>
      {isStaff && <AddBoostSheet clubId={clubId} open={open} onClose={() => setOpen(false)} onSaved={(l) => { done(l); setOpen(false) }} />}
    </>
  )
}

function AddBoostSheet({ clubId, open, onClose, onSaved }: { clubId: string; open: boolean; onClose: () => void; onSaved: (l: BoostDay[]) => void }) {
  const tomorrow = new Date(Date.parse(vnToday()) + 86400_000).toISOString().slice(0, 10)
  const [day, setDay] = useState(tomorrow)
  const [mult, setMult] = useState(2)
  const [title, setTitle] = useState('')
  const save = useMutation({
    mutationFn: () => setBoostDay(clubId, day, mult, title.trim()),
    onSuccess: (l) => { toast.success(`Đã đặt ngày vàng ${x(mult)} — cả CLB được báo`); setTitle(''); onSaved(l) },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  return (
    <Sheet open={open} onClose={onClose} title="Thêm ngày vàng" description="Tối đa 4 ngày mỗi tháng. Phải đặt trước, từ ngày mai."
      footer={<Button block loading={save.isPending} disabled={title.trim().length < 2 || !day} onClick={() => save.mutate()}>Đặt ngày vàng</Button>}>
      <div className="space-y-4">
        <Field label="Ngày" htmlFor="bd-day"><Input id="bd-day" type="date" min={tomorrow} value={day} onChange={(e) => setDay(e.target.value)} /></Field>
        <Field label="Hệ số">
          <div className="grid grid-cols-3 gap-2">
            {MULTIPLIERS.map((m) => (
              <button key={m} type="button" aria-pressed={mult === m} onClick={() => setMult(m)}
                className={cn('rounded-xl border py-2.5 font-mono text-lg font-bold', mult === m ? 'border-coin bg-coin/15 text-coin' : 'border-border')}>{x(m)}</button>
            ))}
          </div>
        </Field>
        <Field label="Dịp gì?" htmlFor="bd-title"><Input id="bd-title" value={title} maxLength={80} placeholder="Sinh nhật CLB 3 tuổi" onChange={(e) => setTitle(e.target.value)} /></Field>
      </div>
    </Sheet>
  )
}
