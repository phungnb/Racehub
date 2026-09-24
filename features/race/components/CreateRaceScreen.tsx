'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ArrowLeft, Flag, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, EmptyState, Field, Input, Skeleton, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { createRace, raceErrorMessage, type NewRace } from '../api/raceApi'
import { distanceLabel } from '../model/race'
import { useOrganizer } from '../hooks/useOrganizer'

const PRESETS = [5, 10, 21.1, 42.2]
const pad = (n: number) => String(n).padStart(2, '0')
const toLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : '')

function defaults() {
  const start = new Date(); start.setDate(start.getDate() + 7); start.setHours(0, 0, 0, 0)
  const end = new Date(start); end.setDate(end.getDate() + 14); end.setMinutes(-1)
  return { start: toLocal(start), end: toLocal(end), close: toLocal(end) }
}

export function CreateRaceScreen() {
  const router = useRouter()
  const org = useOrganizer()
  const [dft] = useState(defaults)
  const [clubId, setClubId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [start, setStart] = useState(dft.start)
  const [end, setEnd] = useState(dft.end)
  const [close, setClose] = useState(dft.close)
  const [distances, setDistances] = useState<number[]>([5, 10, 21.1])
  const [custom, setCustom] = useState('')
  const [audience, setAudience] = useState<'PUBLIC' | 'CLUB_ONLY'>('PUBLIC')
  const [max, setMax] = useState('')
  const [prefix, setPrefix] = useState('')
  const club = clubId ?? (org.isAdmin ? null : org.staffClubs[0]?.club_id ?? null)

  const create = useMutation({
    mutationFn: () => {
      const p: NewRace = {
        title: title.trim(), description: desc.trim(), start_at: fromLocal(start), end_at: fromLocal(end), reg_close_at: fromLocal(close),
        distances, audience: club ? audience : 'PUBLIC', club_id: club, max_participants: max ? Number(max) : null,
        bib_prefix: (prefix || title.replace(/[^A-Za-z0-9]/g, '').slice(0, 4) || 'RH').toUpperCase(),
      }
      return createRace(p)
    },
    onSuccess: (id) => { toast.success('Đã tạo giải'); router.replace(`/races/${id}`) },
    onError: (e) => toast.error(raceErrorMessage(e)),
  })
  const toggle = (d: number) => setDistances((xs) => (xs.includes(d) ? xs.filter((x) => x !== d) : [...xs, d].sort((a, b) => a - b)))
  const addCustom = () => {
    const v = Math.round(Number(custom.replace(',', '.')) * 100) / 100
    if (v >= 1 && v <= 250 && !distances.includes(v) && distances.length < 6) setDistances([...distances, v].sort((a, b) => a - b))
    setCustom('')
  }

  if (org.isLoading) return <Skeleton className="h-96" />
  if (!org.canCreate) return <EmptyState icon={Flag} title="Chỉ ban tổ chức được tạo giải" description="Chủ nhiệm / quản trị viên CLB có thể tạo giải chạy ảo cho CLB mình." />
  const valid = title.trim().length >= 3 && distances.length > 0 && start && end && Date.parse(fromLocal(end)) > Date.parse(fromLocal(start))

  return (
    <div className="space-y-5 pb-6">
      <Link href="/races" className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"><ArrowLeft className="size-4" aria-hidden />Giải chạy ảo</Link>
      <h1 className="text-2xl font-bold">Tạo giải chạy ảo</h1>

      <Field label="Đơn vị tổ chức">
        <div className="grid gap-2">
          {org.isAdmin && (
            <button type="button" aria-pressed={club === null} onClick={() => setClubId(null)}
              className={cn('rounded-xl border p-3 text-left text-sm font-semibold', club === null ? 'border-brand bg-brand/10' : 'border-border')}>RaceHub (giải công khai)</button>
          )}
          {org.staffClubs.map((c) => (
            <button key={c.club_id} type="button" aria-pressed={club === c.club_id} onClick={() => setClubId(c.club_id)}
              className={cn('rounded-xl border p-3 text-left text-sm font-semibold', club === c.club_id ? 'border-brand bg-brand/10' : 'border-border')}>{c.name}</button>
          ))}
        </div>
      </Field>
      <Field label="Tên giải" htmlFor="r-title" hint={`${title.trim().length}/120`}>
        <Input id="r-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="VD: NBNR Virtual Run 2026" />
      </Field>
      <Field label="Giới thiệu (không bắt buộc)" htmlFor="r-desc">
        <Textarea id="r-desc" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={3000} placeholder="Mục đích, quà tặng, cách nhận huy chương…" />
      </Field>

      <Card className="space-y-3">
        <p className="text-sm font-semibold">Cự ly</p>
        <div className="flex flex-wrap gap-2">
          {[...new Set([...PRESETS, ...distances])].sort((a, b) => a - b).map((d) => (
            <button key={d} type="button" aria-pressed={distances.includes(d)} onClick={() => toggle(d)}
              className={cn('rounded-full border px-3 py-1.5 text-sm font-semibold', distances.includes(d) ? 'border-brand bg-brand text-brand-fg' : 'border-border text-fg-muted')}>
              {distanceLabel(d)}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Input inputMode="decimal" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Cự ly khác (km)" aria-label="Cự ly khác" />
          <Button type="button" variant="secondary" className="shrink-0" onClick={addCustom} disabled={!custom}><Plus className="size-4" aria-hidden />Thêm</Button>
        </div>
      </Card>

      <div className="space-y-3">
        <Field label="Bắt đầu" htmlFor="r-start"><Input id="r-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Kết thúc" htmlFor="r-end"><Input id="r-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        <Field label="Hạn đăng ký" htmlFor="r-close" hint="Mặc định đến lúc kết thúc (cho đăng ký muộn)">
          <Input id="r-close" type="datetime-local" value={close} onChange={(e) => setClose(e.target.value)} />
        </Field>
      </div>

      {club && (
        <Field label="Ai được đăng ký">
          <div className="grid grid-cols-2 gap-2">
            {(['PUBLIC', 'CLUB_ONLY'] as const).map((a) => (
              <button key={a} type="button" aria-pressed={audience === a} onClick={() => setAudience(a)}
                className={cn('rounded-xl border p-3 text-sm font-semibold', audience === a ? 'border-brand bg-brand/10' : 'border-border')}>
                {a === 'PUBLIC' ? 'Mọi người' : 'Chỉ thành viên CLB'}
              </button>
            ))}
          </div>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Số VĐV tối đa" htmlFor="r-max" hint="Để trống = không giới hạn">
          <Input id="r-max" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        </Field>
        <Field label="Tiền tố BIB" htmlFor="r-bib" hint={`VD: ${(prefix || 'RH').toUpperCase()}-0001`}>
          <Input id="r-bib" value={prefix} onChange={(e) => setPrefix(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase())} placeholder="NBNR" />
        </Field>
      </div>
      <Button block size="lg" onClick={() => create.mutate()} loading={create.isPending} disabled={!valid}>Tạo giải</Button>
      {distances.length === 0 && <p className="flex items-center gap-1 text-xs text-danger"><X className="size-3" aria-hidden />Chọn ít nhất một cự ly</p>}
    </div>
  )
}
