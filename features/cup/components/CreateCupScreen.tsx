'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ArrowLeft, Info } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, Field, Input, Skeleton, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { createCup, cupErrorMessage, type MatchTerms } from '../api/cupApi'
import { validateCup } from '../model/cup'
import { defaultTerms, rulesSummary, validateTerms } from '../model/match'
import { useCupOrganizer } from '../hooks/useCupOrganizer'
import { RulesForm } from './RulesForm'

/** Mặc định: bắt đầu sau 3 ngày (đủ thời gian các CLB đăng ký), 2 tuần, trung bình km */
function defaults(now: number): MatchTerms {
  const t = defaultTerms(now)
  const start = new Date(now); start.setDate(start.getDate() + 3); start.setHours(0, 0, 0, 0)
  const end = new Date(start); end.setDate(end.getDate() + 14); end.setMinutes(-1)
  return { ...t, start_at: start.toISOString(), end_at: end.toISOString() }
}

/** Tạo Thách đấu CLB: dưới tên CLB mình quản trị (mở ngay), RaceHub (admin) hoặc cá nhân (chờ admin duyệt) */
export function CreateCupScreen() {
  const router = useRouter()
  const org = useCupOrganizer()
  const [now] = useState(() => Date.now())
  const [terms, setTerms] = useState<MatchTerms>(() => defaults(now))
  const [host, setHost] = useState<string | 'NONE' | null>(null)
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [prize, setPrize] = useState('')
  const [max, setMax] = useState('20')
  const hostId = host ?? org.staffClubs[0]?.club_id ?? 'NONE'
  const needsReview = hostId === 'NONE' && !org.isAdmin
  // Hạn CLB đăng ký = giờ chốt danh sách thi đấu (sau đó thành viên không đăng ký thêm được)
  const close = new Date(Date.parse(terms.start_at) - terms.lock_hours * 3600_000).toISOString()
  const error = validateCup({ title, start: terms.start_at, end: terms.end_at, close, maxClubs: Number(max) }, now) ?? validateTerms(terms, now, 'CUP')

  const create = useMutation({
    mutationFn: () => createCup({
      ...terms, title: title.trim(), description: desc.trim(), prize: prize.trim(), max_clubs: Number(max),
      reg_close_at: close, host_club_id: hostId === 'NONE' ? null : hostId,
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

      <Card className="space-y-4">
        <RulesForm value={terms} onChange={setTerms} kind="CUP" />
        <Field label="Số CLB tối đa" htmlFor="cup-max">
          <Input id="cup-max" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, '').slice(0, 3))} />
        </Field>
      </Card>

      <ul className="space-y-1 text-xs text-fg-muted">
        <li>• Chủ nhiệm / Quản trị viên đăng ký CLB; thành viên tự bấm &quot;Đăng ký thi đấu&quot; trước giờ chốt danh sách. Mỗi người thi đấu cho một CLB.</li>
        {rulesSummary({ ...terms, kind: 'CUP', rules_version: 2, final_delay_hours: 48 }).map((r) => <li key={r}>• {r}</li>)}
      </ul>
      {error && title && <p className="text-xs text-danger">{error}</p>}
      <Button block size="lg" onClick={() => create.mutate()} loading={create.isPending} disabled={!!error}>
        {needsReview ? 'Gửi admin duyệt' : 'Mở thách đấu'}
      </Button>
    </div>
  )
}
