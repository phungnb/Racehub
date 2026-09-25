'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ArrowLeft, Info } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, Field, Input, Skeleton, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { createCup, cupErrorMessage, type CupMetric } from '../api/cupApi'
import { METRIC_LABEL, validateCup } from '../model/cup'
import { useCupOrganizer } from '../hooks/useCupOrganizer'

const pad = (n: number) => String(n).padStart(2, '0')
const toLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : '')

function defaults() {
  const start = new Date(); start.setDate(start.getDate() + 3); start.setHours(0, 0, 0, 0)
  const end = new Date(start); end.setDate(end.getDate() + 14); end.setMinutes(-1)
  const close = new Date(start); close.setMinutes(-1)
  return { start: toLocal(start), end: toLocal(end), close: toLocal(close) }
}

/** Tạo Thách đấu CLB: dưới tên CLB mình quản trị (mở ngay), RaceHub (admin) hoặc cá nhân (chờ admin duyệt) */
export function CreateCupScreen() {
  const router = useRouter()
  const org = useCupOrganizer()
  const [dft] = useState(defaults)
  const [now] = useState(() => Date.now())
  const [host, setHost] = useState<string | 'NONE' | null>(null)
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [prize, setPrize] = useState('')
  const [metric, setMetric] = useState<CupMetric>('AVG_KM')
  const [start, setStart] = useState(dft.start)
  const [end, setEnd] = useState(dft.end)
  const [close, setClose] = useState(dft.close)
  const [max, setMax] = useState('20')
  const hostId = host ?? org.staffClubs[0]?.club_id ?? 'NONE'
  const needsReview = hostId === 'NONE' && !org.isAdmin
  const error = validateCup({ title, start: fromLocal(start), end: fromLocal(end), close: fromLocal(close), maxClubs: Number(max) }, now)

  const create = useMutation({
    mutationFn: () => createCup({
      title: title.trim(), description: desc.trim(), prize: prize.trim(), metric, max_clubs: Number(max),
      start_at: fromLocal(start), end_at: fromLocal(end), reg_close_at: fromLocal(close), host_club_id: hostId === 'NONE' ? null : hostId,
    }),
    onSuccess: (c) => {
      toast.success(c.status === 'PENDING_REVIEW' ? 'Đã gửi — chờ admin duyệt, bạn sẽ nhận thông báo' : 'Đã mở thách đấu, mời các CLB đăng ký!')
      router.replace(`/cups/${c.id}`)
    },
    onError: (e) => toast.error(cupErrorMessage(e)),
  })

  if (org.isLoading) return <Skeleton className="h-96" />
  const option = (id: string, label: string, hint: string) => (
    <button key={id} type="button" aria-pressed={hostId === id} onClick={() => setHost(id)}
      className={cn('rounded-xl border p-3 text-left', hostId === id ? 'border-brand bg-brand/10' : 'border-border')}>
      <span className="block text-sm font-semibold">{label}</span>
      <span className="block text-[11px] text-fg-muted">{hint}</span>
    </button>
  )

  return (
    <div className="space-y-5 pb-6">
      <Link href="/cups" className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"><ArrowLeft className="size-4" aria-hidden />Thách đấu CLB</Link>
      <h1 className="text-2xl font-bold">Tạo thách đấu CLB</h1>

      <Field label="Đơn vị tổ chức">
        <div className="grid gap-2">
          {org.staffClubs.map((c) => option(c.club_id, c.name, 'Mở đăng ký ngay · CLB tự vào thách đấu'))}
          {option('NONE', org.isAdmin ? 'RaceHub' : 'Cá nhân tôi', org.isAdmin ? 'Admin tạo: mở ngay' : 'Cần admin RaceHub duyệt trước khi mở')}
        </div>
      </Field>
      {needsReview && (
        <p className="flex gap-2 rounded-xl bg-warning/10 p-3 text-xs text-warning">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />Bạn không phải ban quản trị CLB nào nên thách đấu sẽ chờ admin duyệt. Khi được duyệt, Chủ nhiệm / Quản trị viên các CLB mới đăng ký được.
        </p>
      )}

      <Field label="Tên thách đấu" htmlFor="cup-title" hint={`${title.trim().length}/120`}>
        <Input id="cup-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="VD: Cúp Hồ Gươm tháng 11" />
      </Field>
      <Field label="Giới thiệu (không bắt buộc)" htmlFor="cup-desc">
        <Textarea id="cup-desc" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={1000} placeholder="Luật chơi, mục đích, liên hệ ban tổ chức…" />
      </Field>
      <Field label="Giải thưởng (không bắt buộc)" htmlFor="cup-prize">
        <Input id="cup-prize" value={prize} onChange={(e) => setPrize(e.target.value)} maxLength={200} placeholder="VD: Cúp + 5 triệu quỹ CLB cho đội vô địch" />
      </Field>

      <Field label="Cách tính điểm">
        <div className="grid gap-2">
          {(Object.keys(METRIC_LABEL) as CupMetric[]).map((m) => (
            <button key={m} type="button" aria-pressed={metric === m} onClick={() => setMetric(m)}
              className={cn('rounded-xl border p-3 text-left', metric === m ? 'border-brand bg-brand/10' : 'border-border')}>
              <span className="block text-sm font-semibold">{METRIC_LABEL[m].title}</span>
              <span className="block text-[11px] text-fg-muted">{METRIC_LABEL[m].hint}</span>
            </button>
          ))}
        </div>
      </Field>

      <Card className="space-y-3">
        <Field label="Bắt đầu" htmlFor="cup-start"><Input id="cup-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Kết thúc" htmlFor="cup-end"><Input id="cup-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        <Field label="Hạn CLB đăng ký" htmlFor="cup-close" hint="Có thể cho đăng ký muộn, nhưng km chỉ tính từ lúc bắt đầu">
          <Input id="cup-close" type="datetime-local" value={close} onChange={(e) => setClose(e.target.value)} />
        </Field>
        <Field label="Số CLB tối đa" htmlFor="cup-max">
          <Input id="cup-max" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, '').slice(0, 3))} />
        </Field>
      </Card>

      <ul className="space-y-1 text-xs text-fg-muted">
        <li>• Chỉ Chủ nhiệm / Quản trị viên của một CLB mới đăng ký CLB đó.</li>
        <li>• Tính bài chạy hợp lệ trong thời gian thi đấu, sau khi thành viên vào CLB. Người ở nhiều CLB chỉ tính cho CLB vào trước.</li>
        <li>• Kết thúc 2 giờ sau giờ chốt (chờ bài đồng bộ muộn), mọi thành viên nhận thông báo thứ hạng.</li>
      </ul>
      {error && title && <p className="text-xs text-danger">{error}</p>}
      <Button block size="lg" onClick={() => create.mutate()} loading={create.isPending} disabled={!!error}>
        {needsReview ? 'Gửi admin duyệt' : 'Mở thách đấu'}
      </Button>
    </div>
  )
}
