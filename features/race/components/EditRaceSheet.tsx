'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button, Field, Input, Sheet } from '@/shared/ui'
import { updateCandidate, type CalendarRow, type CandidateEdit, type RaceKind } from '../api/listingApi'

const isHttp = (v: string) => v.trim() === '' || /^https?:\/\/\S+$/i.test(v.trim())

/** Admin sửa một dòng của bảng: nhất là link mua bib / đăng ký do trang nguồn thường ghi sai hoặc thiếu. */
export function EditRaceSheet({ row: c, onClose, onSaved }: { row: CalendarRow; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<CandidateEdit>({
    title: c.title, kind: c.kind, location: c.location ?? '', race_date: c.race_date ?? '', end_date: c.end_date ?? '',
    reg_deadline: c.reg_deadline ?? '', race_url: c.race_url ?? '', reg_url: c.reg_url ?? '',
  })
  const set = <K extends keyof CandidateEdit>(k: K, v: CandidateEdit[K]) => setF((x) => ({ ...x, [k]: v }))
  const save = useMutation({ mutationFn: () => updateCandidate(c.id, f), onSuccess: () => { toast.success('Đã lưu'); onSaved() }, onError: () => toast.error('Không lưu được (kiểm tra lại link và ngày).') })
  const bad = f.title.trim().length < 3 || !isHttp(f.race_url) || !isHttp(f.reg_url) || (f.end_date !== '' && f.race_date !== '' && f.end_date < f.race_date)
  return (
    <Sheet open onClose={onClose} title="Sửa giải trong bảng" description="Link mua bib / đăng ký để trống nếu chưa có."
      footer={<Button block loading={save.isPending} disabled={bad} onClick={() => save.mutate()}>Lưu</Button>}>
      <div className="space-y-3">
        <Field label="Tên giải" htmlFor="e-title"><Input id="e-title" value={f.title} maxLength={200} onChange={(e) => set('title', e.target.value)} /></Field>
        <Field label="Loại giải" htmlFor="e-kind">
          <select id="e-kind" value={f.kind} onChange={(e) => set('kind', e.target.value as RaceKind)} className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-[15px]">
            <option value="OFFLINE">Offline (chạy trực tiếp)</option><option value="ONLINE">Online (chạy ảo)</option>
          </select>
        </Field>
        <Field label="Địa điểm" htmlFor="e-loc"><Input id="e-loc" value={f.location} maxLength={200} onChange={(e) => set('location', e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Ngày chạy" htmlFor="e-date"><Input id="e-date" type="date" value={f.race_date} onChange={(e) => set('race_date', e.target.value)} /></Field>
          <Field label="Đến ngày" htmlFor="e-end"><Input id="e-end" type="date" value={f.end_date} onChange={(e) => set('end_date', e.target.value)} /></Field>
        </div>
        <Field label="Hạn đăng ký" htmlFor="e-dl"><Input id="e-dl" type="date" value={f.reg_deadline} onChange={(e) => set('reg_deadline', e.target.value)} /></Field>
        <Field label="Link giải" htmlFor="e-url" error={isHttp(f.race_url) ? undefined : 'Link phải bắt đầu bằng http(s)://'}>
          <Input id="e-url" inputMode="url" value={f.race_url} onChange={(e) => set('race_url', e.target.value)} />
        </Field>
        <Field label="Link mua bib (đăng ký)" htmlFor="e-reg" error={isHttp(f.reg_url) ? undefined : 'Link phải bắt đầu bằng http(s)://'}>
          <Input id="e-reg" inputMode="url" value={f.reg_url} onChange={(e) => set('reg_url', e.target.value)} />
        </Field>
      </div>
    </Sheet>
  )
}

