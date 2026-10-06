'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, Field, Input, Sheet, Textarea } from '@/shared/ui'
import { challengeErrorMessage, updateChallenge, type ChallengeDetail } from '../../api/challengeApi'
import { isConquest, OBJECTIVE_META } from '../../model/challenge'
import { challengeKeys } from '../../hooks/useChallenge'

const toLocalInput = (iso: string) => {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const num = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')))

/**
 * Sửa thử thách trước khi bắt đầu (013100): tên, mô tả, mục tiêu, luật km / pace, thời gian.
 * Thể thức, số người, đối tượng, giải thưởng không đổi (liên quan phí và tiền treo thưởng); thời lượng không dài hơn lúc tạo.
 */
export function EditChallengeCard({ d }: { d: ChallengeDetail }) {
  const [open, setOpen] = useState(false)
  return (
    <Card className="flex items-center gap-3">
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">Thử thách chưa bắt đầu</p>
        <p className="text-xs text-fg-muted">Bạn còn sửa được tên, mô tả, mục tiêu, luật và thời gian. Người đã tham gia sẽ nhận thông báo.</p>
      </div>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}><Pencil className="size-4" aria-hidden />Sửa</Button>
      {open && <EditChallengeSheet d={d} onClose={() => setOpen(false)} />}
    </Card>
  )
}

function EditChallengeSheet({ d, onClose }: { d: ChallengeDetail; onClose: () => void }) {
  const c = d.challenge
  const qc = useQueryClient()
  const conquest = isConquest(c.objective)
  const [title, setTitle] = useState(c.title)
  const [desc, setDesc] = useState(c.description ?? '')
  const [target, setTarget] = useState(String(c.target_value ?? 0))
  const [minKm, setMinKm] = useState(String(c.min_km ?? 0))
  const [minPace, setMinPace] = useState(String(c.min_pace ?? 3))
  const [maxPace, setMaxPace] = useState(String(c.max_pace ?? 15))
  const [cap, setCap] = useState(c.daily_cap_km ? String(c.daily_cap_km) : '')
  const [start, setStart] = useState(() => toLocalInput(c.start_date))
  const [end, setEnd] = useState(() => toLocalInput(c.end_date))
  const days = Math.round((Date.parse(c.end_date) - Date.parse(c.start_date)) / 3_600_000) / 24
  const save = useMutation({
    mutationFn: () => updateChallenge(c.id, {
      title: title.trim(), description: desc.trim() || null, target_value: conquest ? c.target_value : num(target),
      min_km: num(minKm) || 0, min_pace: num(minPace), max_pace: num(maxPace), daily_cap_km: cap.trim() ? num(cap) : null,
      start_date: new Date(start).toISOString(), end_date: new Date(end).toISOString(),
    }),
    onSuccess: () => {
      toast.success('Đã lưu thay đổi và báo người tham gia')
      void qc.invalidateQueries({ queryKey: challengeKeys.detail(c.id) })
      onClose()
    },
    onError: (e) => toast.error(challengeErrorMessage(e)),
  })
  const valid = title.trim().length >= 3 && !!start && !!end && Date.parse(end) > Date.parse(start)
    && (conquest || Number.isFinite(num(target))) && Number.isFinite(num(minPace)) && Number.isFinite(num(maxPace))
  return (
    <Sheet open onClose={onClose} title="Sửa thử thách"
      description={`Chỉ sửa được trước giờ bắt đầu. Thời lượng tối đa ${days.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} ngày như lúc tạo (phí tính theo thời lượng).`}
      footer={<Button block loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>Lưu thay đổi</Button>}>
      <div className="space-y-4">
        <Field label="Tên thử thách" htmlFor="ec-title"><Input id="ec-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Mô tả" htmlFor="ec-desc"><Textarea id="ec-desc" rows={4} maxLength={2000} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bắt đầu" htmlFor="ec-start"><Input id="ec-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Kết thúc" htmlFor="ec-end"><Input id="ec-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        {!conquest && (
          <Field label={`Mục tiêu (${OBJECTIVE_META[c.objective]?.unit ?? ''})`} htmlFor="ec-target">
            <Input id="ec-target" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mỗi bài tối thiểu (km)" htmlFor="ec-minkm"><Input id="ec-minkm" inputMode="decimal" value={minKm} onChange={(e) => setMinKm(e.target.value)} /></Field>
          <Field label="Trần km mỗi ngày" htmlFor="ec-cap" hint="Để trống = không giới hạn"><Input id="ec-cap" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} /></Field>
          <Field label="Pace nhanh nhất (phút/km)" htmlFor="ec-minpace"><Input id="ec-minpace" inputMode="decimal" value={minPace} onChange={(e) => setMinPace(e.target.value)} /></Field>
          <Field label="Pace chậm nhất (phút/km)" htmlFor="ec-maxpace"><Input id="ec-maxpace" inputMode="decimal" value={maxPace} onChange={(e) => setMaxPace(e.target.value)} /></Field>
        </div>
        <p className="text-xs text-fg-muted">Thể thức, số người tối đa, đối tượng tham gia và giải thưởng không đổi được sau khi tạo. Cần đổi thì huỷ và tạo thử thách mới.</p>
      </div>
    </Sheet>
  )
}
