'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button, Field, Sheet, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { blockRunner, REPORT_REASONS, reportRunner, socialErrorMessage, type ReportReason } from '../api/socialApi'

/** Báo cáo một runner (từ hồ sơ / tin nhắn); người bị báo cáo không biết ai báo cáo */
export function ReportRunnerSheet({ userId, name, context, initialNote = '', onClose }: {
  userId: string; name: string; context: 'DM' | 'PROFILE'; initialNote?: string; onClose: () => void
}) {
  const qc = useQueryClient()
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [note, setNote] = useState(initialNote.slice(0, 500))
  const [alsoBlock, setAlsoBlock] = useState(context === 'DM')
  const send = useMutation({
    mutationFn: async () => {
      await reportRunner(userId, reason!, note.trim() || null, context)
      if (alsoBlock) await blockRunner(userId)
    },
    onSuccess: () => {
      toast.success('Đã gửi báo cáo', { description: 'Quản trị viên sẽ xem xét. Cảm ơn bạn giữ cộng đồng an toàn.' })
      void qc.invalidateQueries({ queryKey: ['social'] })
      onClose()
    },
    onError: (e) => toast.error(socialErrorMessage(e)),
  })
  return (
    <Sheet open onClose={onClose} title={`Báo cáo ${name}`} description="Người bị báo cáo không biết ai báo cáo."
      footer={<Button block variant="danger" disabled={!reason} loading={send.isPending} onClick={() => send.mutate()}>Gửi báo cáo</Button>}>
      <div className="space-y-4">
        <div className="space-y-1.5">
          {(Object.keys(REPORT_REASONS) as ReportReason[]).map((k) => (
            <button key={k} type="button" aria-pressed={reason === k} onClick={() => setReason(k)}
              className={cn('w-full rounded-xl border p-3 text-left text-sm font-semibold', reason === k ? 'border-danger bg-danger/10' : 'border-border')}>
              {REPORT_REASONS[k]}
            </button>
          ))}
        </div>
        <Field label="Mô tả thêm (không bắt buộc)" htmlFor="soc-rep">
          <Textarea id="soc-rep" value={note} maxLength={500} rows={3} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2.5 text-sm">
          <input type="checkbox" checked={alsoBlock} onChange={(e) => setAlsoBlock(e.target.checked)} className="size-5 accent-[var(--color-brand)]" />
          Chặn luôn người này
        </label>
      </div>
    </Sheet>
  )
}
