'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button, Field, Input, Skeleton, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { useSetSystemNotice, useSystemNotice } from '../hooks/useSystem'
import { systemApiErrorMessage, type NoticeLevel, type SystemNotice } from '../api/systemApi'

const LEVELS: { v: NoticeLevel; label: string; hint: string }[] = [
  { v: 'INFO', label: 'Thông tin', hint: 'Tin chung, người dùng tắt được' },
  { v: 'WARNING', label: 'Cảnh báo', hint: 'Sự cố một phần (VD: Strava chậm)' },
  { v: 'MAINTENANCE', label: 'Bảo trì', hint: 'Không tắt được cho tới khi hết hạn' },
]
const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '')

/** Quản trị → Hệ thống: đặt / tắt thông báo hiện ở đầu app cho mọi người */
export function SystemNoticeEditor() {
  const q = useSystemNotice()
  if (q.isPending) return <Skeleton className="h-40" />
  return <Editor key={q.data?.updated_at ?? 'none'} current={q.data ?? null} />
}

function Editor({ current }: { current: SystemNotice | null }) {
  const save = useSetSystemNotice()
  const [level, setLevel] = useState<NoticeLevel>(current?.level ?? 'INFO')
  const [title, setTitle] = useState(current?.title ?? '')
  const [message, setMessage] = useState(current?.message ?? '')
  const [until, setUntil] = useState(toLocal(current?.until ?? null))
  const run = (p: Parameters<typeof save.mutate>[0], ok: string) =>
    save.mutate(p, { onSuccess: () => toast.success(ok), onError: (e) => toast.error(systemApiErrorMessage(e)) })

  return (
    <div className="space-y-3">
      <p className="text-xs text-fg-muted">
        {current ? <>Đang hiện: <b className="text-fg">{current.title}</b>{current.until ? ` · tự tắt ${new Date(current.until).toLocaleString('vi-VN')}` : ''}</> : 'Hiện không có thông báo nào.'}
      </p>
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Mức thông báo">
        {LEVELS.map((l) => (
          <button key={l.v} type="button" role="radio" aria-checked={level === l.v} title={l.hint} onClick={() => setLevel(l.v)}
            className={cn('rounded-lg border py-2 text-xs font-semibold', level === l.v ? 'border-brand bg-brand/10' : 'border-border text-fg-muted')}>{l.label}</button>
        ))}
      </div>
      <p className="text-[11px] text-fg-subtle">{LEVELS.find((l) => l.v === level)?.hint}</p>
      <Field label="Tiêu đề" htmlFor="sn-title"><Input id="sn-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="VD: Bảo trì hệ thống 22:00–22:30" /></Field>
      <Field label="Nội dung (không bắt buộc)" htmlFor="sn-msg"><Textarea id="sn-msg" rows={2} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
      <Field label="Tự tắt lúc" htmlFor="sn-until" hint="Để trống = hiện tới khi bạn tắt"><Input id="sn-until" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
      <div className="flex gap-2">
        <Button className="flex-1" loading={save.isPending} disabled={title.trim().length < 2}
          onClick={() => run({ level, title: title.trim(), message: message.trim() || null, until: until ? new Date(until).toISOString() : null }, 'Đã đăng thông báo')}>
          {current ? 'Cập nhật' : 'Đăng thông báo'}
        </Button>
        {current && <Button variant="danger" disabled={save.isPending} onClick={() => run(null, 'Đã tắt thông báo')}>Tắt</Button>}
      </div>
    </div>
  )
}
