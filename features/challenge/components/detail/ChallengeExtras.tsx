'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Pencil, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, Field, Input, Sheet } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { challengeErrorMessage, getChallengeBoostDays, setChallengeBoostDay, setRegDeadline, type ChallengeDetail } from '../../api/challengeApi'
import { challengeKeys } from '../../hooks/useChallenge'

const fmtDay = (d: string) => new Date(`${d}T00:00:00+07:00`).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })
const vnToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10)
const vnDate = (iso: string) => new Date(Date.parse(iso) + 7 * 3_600_000).toISOString().slice(0, 10)
const toLocalInput = (iso: string) => {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Hạn đăng ký: ai cũng thấy; người tạo sửa được. Tham gia trễ vẫn tính mọi bài từ ngày bắt đầu. */
export function RegDeadlineCard({ d }: { d: ChallengeDetail }) {
  const c = d.challenge
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(() => toLocalInput(c.reg_deadline ?? c.end_date))
  const [now] = useState(() => Date.now())
  const save = useMutation({
    mutationFn: () => setRegDeadline(c.id, new Date(value).toISOString()),
    onSuccess: () => { toast.success('Đã đổi hạn đăng ký'); setOpen(false); void qc.invalidateQueries({ queryKey: challengeKeys.detail(c.id) }) },
    onError: (e) => toast.error(challengeErrorMessage(e)),
  })
  const deadline = c.reg_deadline ?? c.end_date
  const closed = now >= Date.parse(deadline)
  const live = c.status === 'ACTIVE' && now < Date.parse(c.end_date)
  return (
    <Card className="flex items-start gap-3">
      <CalendarClock className={cn('mt-0.5 size-5 shrink-0', closed ? 'text-fg-subtle' : 'text-brand')} aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">{closed ? 'Đã hết hạn đăng ký' : `Hạn đăng ký: ${new Date(deadline).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}`}</p>
        <p className="text-xs text-fg-muted">Tham gia trễ vẫn được tính mọi bài chạy hợp lệ từ ngày bắt đầu thử thách.</p>
      </div>
      {d.can_manage && live && (
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}><Pencil className="size-4" aria-hidden />Sửa</Button>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title="Sửa hạn đăng ký"
        description={c.format === 'TEAM' ? 'Thử thách đội: hạn đăng ký không quá giờ xuất phát.' : 'Từ bây giờ đến trước khi thử thách kết thúc.'}
        footer={<Button block loading={save.isPending} onClick={() => save.mutate()}>Lưu</Button>}>
        <Field label="Hạn đăng ký" htmlFor="reg-deadline">
          <Input id="reg-deadline" type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
      </Sheet>
    </Card>
  )
}

/** Ngày vàng riêng của thử thách (thử thách tính theo km): km trong ngày được nhân ×1,5 / ×2 / ×3 */
export function ChallengeBoostDays({ d }: { d: ChallengeDetail }) {
  const c = d.challenge
  const qc = useQueryClient()
  const q = useQuery({ queryKey: challengeKeys.boostDays(c.id), queryFn: () => getChallengeBoostDays(c.id), enabled: c.objective === 'DISTANCE' })
  const [adding, setAdding] = useState(false)
  const [now] = useState(() => Date.now())
  const first = [vnToday(), vnDate(c.start_date)].sort().at(-1)!
  const [day, setDay] = useState(() => {
    const t = new Date(Date.parse(`${vnToday()}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    return t < first ? first : t
  })
  const [mult, setMult] = useState(2)
  const [title, setTitle] = useState('Ngày vàng')
  const done = (days: unknown) => { qc.setQueryData(challengeKeys.boostDays(c.id), days) }
  const save = useMutation({
    mutationFn: (v: { day: string; mult: number | null; title: string }) => setChallengeBoostDay(c.id, v.day, v.mult, v.title),
    onSuccess: (days, v) => { done(days); toast.success(v.mult ? 'Đã thêm ngày vàng và báo người tham gia' : 'Đã bỏ ngày vàng'); setAdding(false) },
    onError: (e) => toast.error(challengeErrorMessage(e)),
  })
  if (c.objective !== 'DISTANCE') return null
  const days = q.data ?? []
  const live = c.status === 'ACTIVE' && now < Date.parse(c.end_date)
  if (!days.length && !(d.can_manage && live)) return null
  return (
    <Card className="space-y-2">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 size-5 shrink-0 text-coin" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Ngày vàng</p>
          <p className="text-xs text-fg-muted">Km chạy trong ngày được nhân hệ số trên BXH thử thách này.</p>
        </div>
        {d.can_manage && live && <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>Thêm</Button>}
      </div>
      {days.length > 0 && (
        <ul className="space-y-1.5">
          {days.map((b) => (
            <li key={b.day} className="flex items-center gap-2 rounded-xl bg-coin/10 px-3 py-2 text-sm">
              <span className="font-mono font-bold text-coin">×{String(b.multiplier).replace('.', ',')}</span>
              <span className="min-w-0 flex-1 truncate"><span className="capitalize">{fmtDay(b.day)}</span> · {b.title}</span>
              {d.can_manage && live && b.day > vnToday() && (
                <button type="button" aria-label="Bỏ ngày vàng" onClick={() => save.mutate({ day: b.day, mult: null, title: b.title })}
                  className="grid size-8 place-items-center rounded-full text-fg-subtle hover:bg-surface-2 hover:text-danger"><Trash2 className="size-4" aria-hidden /></button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Sheet open={adding} onClose={() => setAdding(false)} title="Thêm ngày vàng" description="Chỉ đặt cho ngày sắp tới trong thời gian thử thách. Người tham gia được báo."
        footer={<Button block loading={save.isPending} onClick={() => save.mutate({ day, mult, title })}>Thêm ngày vàng</Button>}>
        <div className="space-y-3">
          <Field label="Ngày" htmlFor="boost-day"><Input id="boost-day" type="date" value={day} min={first} max={vnDate(c.end_date)} onChange={(e) => setDay(e.target.value)} /></Field>
          <div role="radiogroup" aria-label="Hệ số" className="grid grid-cols-3 gap-2">
            {[1.5, 2, 3].map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mult === m} onClick={() => setMult(m)}
                className={cn('h-11 rounded-xl border font-mono font-bold', mult === m ? 'border-coin bg-coin/15 text-coin' : 'border-border text-fg-muted')}>×{String(m).replace('.', ',')}</button>
            ))}
          </div>
          <Field label="Tên" htmlFor="boost-title"><Input id="boost-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Ngày hội chạy" /></Field>
        </div>
      </Sheet>
    </Card>
  )
}
