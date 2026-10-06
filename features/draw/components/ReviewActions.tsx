'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button, ConfirmSheet, Field, Sheet, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { confirmDraw, drawErrorMessage, rejectDraw, type LuckyDraw } from '../api/drawApi'

/**
 * Chỉnh sửa lần 7 (013500): quay xong thì kết quả CHỜ XÁC NHẬN. Ban tổ chức bấm "Chấp nhận" → chính thức (báo người trúng, đăng bảng tin);
 * "Huỷ kết quả" → ghi nhật ký (ai, lúc nào, lý do, danh sách bị huỷ), lượt quay về "Chờ quay" để quay lại.
 * Đặt NGOÀI vùng quay (không lọt vào video ghi hình): dưới thẻ lượt quay và ở chân màn hình quay.
 */
export function ReviewActions({ d, onDone, dark, className }: { d: LuckyDraw; onDone: (x: LuckyDraw) => void; dark?: boolean; className?: string }) {
  const [open, setOpen] = useState<'accept' | 'reject' | null>(null)
  const [reason, setReason] = useState('')
  const accept = useMutation({
    mutationFn: () => confirmDraw(d.id),
    onSuccess: (x) => { setOpen(null); onDone(x); toast.success('Đã chấp nhận kết quả — đã báo người trúng và công bố') },
    onError: (e) => toast.error(drawErrorMessage(e)),
  })
  const reject = useMutation({
    mutationFn: () => rejectDraw(d.id, reason),
    onSuccess: (x) => { setOpen(null); setReason(''); onDone(x); toast('Đã huỷ kết quả và ghi lại. Lượt quay trở về "Chờ quay" — có thể quay lại.') },
    onError: (e) => toast.error(drawErrorMessage(e)),
  })
  if (d.status !== 'PENDING' || !d.can_manage) return null
  const won = d.winners.filter((w) => w.status === 'WON').length
  return (
    <div className={cn('grid grid-cols-2 gap-2', className)}>
      <Button variant="danger" onClick={() => setOpen('reject')} disabled={accept.isPending}><RotateCcw className="size-4" aria-hidden />Huỷ kết quả</Button>
      <Button variant="coin" onClick={() => setOpen('accept')} disabled={reject.isPending}
        className={cn(dark && 'shadow-[0_0_30px_-8px_var(--color-coin)]')}><CheckCircle2 className="size-4" aria-hidden />Chấp nhận</Button>

      <ConfirmSheet open={open === 'accept'} onClose={() => setOpen(null)} danger={false} loading={accept.isPending} confirmLabel="Chấp nhận & công bố"
        title="Chấp nhận kết quả?" onConfirm={() => accept.mutate()}
        description={`${won} người trúng sẽ được báo ngay, kết quả lên bảng tin kèm mã kiểm chứng. Sau khi chấp nhận không huỷ được nữa.`} />
      <Sheet open={open === 'reject'} onClose={() => setOpen(null)} title="Huỷ kết quả quay?"
        description="Danh sách trúng lần này bị huỷ và được ghi lại (ai huỷ, lúc nào, lý do). Lượt quay trở về Chờ quay; lần quay sau có mã cam kết mới."
        footer={<div className="flex gap-2">
          <Button variant="secondary" block onClick={() => setOpen(null)} disabled={reject.isPending}>Giữ kết quả</Button>
          <Button variant="danger" block loading={reject.isPending} onClick={() => reject.mutate()}>Huỷ kết quả</Button>
        </div>}>
        <Field label="Lý do (không bắt buộc)" htmlFor="draw-reject-reason" hint="VD: nhầm danh sách người được quay, sai giải, sự cố kỹ thuật… Số lần huỷ hiện công khai cho mọi người.">
          <Textarea id="draw-reject-reason" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Sheet>
    </div>
  )
}
