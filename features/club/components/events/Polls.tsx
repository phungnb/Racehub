'use client'

import { useState } from 'react'
import { Check, EyeOff, Lock, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, Field, Input, Sheet } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatRelative } from '@/shared/lib/format'
import { closePoll, createPoll, eventsErrorMessage, votePoll, type ClubPoll } from '../../api/eventsApi'
import { useClubMutation } from '../../hooks/useEvents'
import { eventCountdown, fromVnLocalInput } from '../../model/events'

/** Một bình chọn: bấm để chọn (đổi được tới khi đóng); kết quả dạng thanh */
export function PollCard({ clubId, poll: p }: { clubId: string; poll: ClubPoll }) {
  const [picked, setPicked] = useState<number[]>(p.my_choices ?? [])
  const vote = useClubMutation(clubId, (choices: number[]) => votePoll(p.id, choices))
  const close = useClubMutation(clubId, () => closePoll(p.id))
  const total = p.counts?.reduce((a, b) => a + b, 0) ?? 0
  const voted = !!p.my_choices?.length
  const changed = JSON.stringify([...picked].sort()) !== JSON.stringify([...(p.my_choices ?? [])].sort())

  const toggle = (i: number) => {
    if (p.closed) return
    const next = p.multi ? (picked.includes(i) ? picked.filter((x) => x !== i) : [...picked, i]) : [i]
    setPicked(next)
    if (!p.multi) vote.mutate(next, { onError: (e) => { toast.error(eventsErrorMessage(e)); setPicked(p.my_choices ?? []) } })
  }

  return (
    <Card className="space-y-3">
      <div>
        <p className="font-semibold">{p.question}</p>
        <p className="text-xs text-fg-subtle">
          {p.creator_name ?? 'Thành viên'} · {formatRelative(p.created_at)} · {p.voters} người đã chọn
          {p.multi ? ' · chọn nhiều' : ''}
          {p.closed ? ' · đã đóng' : p.closes_at ? ` · ${eventCountdown(p.closes_at, p.closes_at).toLowerCase()} để chọn` : ''}
        </p>
      </div>
      <ul className="space-y-1.5">
        {p.options.map((o, i) => {
          const n = p.counts?.[i] ?? 0
          const pct = total ? Math.round((n / total) * 100) : 0
          const mine = picked.includes(i)
          return (
            <li key={i}>
              <button type="button" onClick={() => toggle(i)} disabled={p.closed || vote.isPending} aria-pressed={mine}
                className={cn('relative flex min-h-11 w-full items-center gap-2 overflow-hidden rounded-xl border px-3 text-left text-sm',
                  mine ? 'border-brand' : 'border-border', !p.closed && 'hover:border-fg-subtle')}>
                {p.counts && <span className="absolute inset-y-0 left-0 bg-brand/15 transition-all" style={{ width: `${pct}%` }} aria-hidden />}
                <span className={cn('relative grid size-5 shrink-0 place-items-center border', p.multi ? 'rounded-md' : 'rounded-full',
                  mine ? 'border-brand bg-brand text-brand-fg' : 'border-fg-subtle')}>
                  {mine && <Check className="size-3.5" aria-hidden />}
                </span>
                <span className="relative min-w-0 flex-1 truncate font-medium">{o}</span>
                {p.counts && <span className="relative shrink-0 font-mono text-xs text-fg-muted">{n} · {pct}%</span>}
              </button>
            </li>
          )
        })}
      </ul>
      {!p.counts && (
        <p className="flex items-center gap-1.5 text-xs text-fg-subtle"><EyeOff className="size-3.5" aria-hidden />Kết quả hiện khi bình chọn đóng</p>
      )}
      {(p.multi && !p.closed && (changed || !voted)) || (p.can_close && !p.closed) ? (
        <div className="flex gap-2">
          {p.can_close && !p.closed && (
            <Button size="sm" variant="secondary" loading={close.isPending}
              onClick={() => close.mutate(undefined, { onSuccess: () => toast.success('Đã đóng bình chọn'), onError: (e) => toast.error(eventsErrorMessage(e)) })}>
              <Lock className="size-4" aria-hidden />Đóng
            </Button>
          )}
          {p.multi && !p.closed && (
            <Button size="sm" block disabled={!changed} loading={vote.isPending}
              onClick={() => vote.mutate(picked, { onSuccess: () => toast.success('Đã ghi lựa chọn'), onError: (e) => toast.error(eventsErrorMessage(e)) })}>
              Gửi lựa chọn
            </Button>
          )}
        </div>
      ) : null}
    </Card>
  )
}

export function PollFormSheet({ clubId, open, onClose }: { clubId: string; open: boolean; onClose: () => void }) {
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [multi, setMulti] = useState(false)
  const [hide, setHide] = useState(false)
  const [closes, setCloses] = useState('')
  const create = useClubMutation(clubId, () => createPoll(clubId, {
    question: question.trim(), options: options.map((o) => o.trim()).filter(Boolean), multi, hideResults: hide,
    closesAt: closes ? fromVnLocalInput(closes) : null,
  }))
  const valid = question.trim().length >= 3 && options.filter((o) => o.trim()).length >= 2

  return (
    <Sheet open={open} onClose={onClose} title="Tạo bình chọn"
      footer={<Button block disabled={!valid} loading={create.isPending}
        onClick={() => create.mutate(undefined, { onSuccess: () => { toast.success('Đã tạo bình chọn'); onClose() }, onError: (e) => toast.error(eventsErrorMessage(e)) })}>
        Tạo bình chọn</Button>}>
      <div className="space-y-4">
        <Field label="Câu hỏi" htmlFor="poll-q">
          <Input id="poll-q" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={200} placeholder="Chủ nhật này chạy ở đâu?" />
        </Field>
        <Field label="Lựa chọn">
          <div className="space-y-2">
            {options.map((o, i) => (
              <div key={i} className="flex gap-2">
                <Input value={o} maxLength={80} placeholder={`Lựa chọn ${i + 1}`} aria-label={`Lựa chọn ${i + 1}`}
                  onChange={(e) => setOptions((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))} />
                {options.length > 2 && (
                  <Button variant="secondary" className="shrink-0" aria-label="Bỏ lựa chọn" onClick={() => setOptions((xs) => xs.filter((_, j) => j !== i))}>
                    <X className="size-4" aria-hidden />
                  </Button>
                )}
              </div>
            ))}
            {options.length < 10 && (
              <Button size="sm" variant="secondary" onClick={() => setOptions((xs) => [...xs, ''])}><Plus className="size-4" aria-hidden />Thêm lựa chọn</Button>
            )}
          </div>
        </Field>
        <Field label="Hạn chót (không bắt buộc)" htmlFor="poll-close">
          <Input id="poll-close" type="datetime-local" value={closes} onChange={(e) => setCloses(e.target.value)} />
        </Field>
        <label className="flex items-center justify-between gap-3 text-sm font-medium">
          Cho chọn nhiều đáp án
          <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} className="size-5 accent-[var(--color-brand)]" />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm font-medium">
          Ẩn kết quả tới khi đóng
          <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} className="size-5 accent-[var(--color-brand)]" />
        </label>
      </div>
    </Sheet>
  )
}
