'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleSlash, Search, Trophy } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, ConfirmSheet, EmptyState, ErrorState, Field, Input, SegmentedControl, Skeleton } from '@/shared/ui'
import { formatNumber } from '@/shared/lib/format'
import { useDebounced } from '@/shared/lib/search'
import { routes } from '@/shared/config/routes'
import { adminCancelChallenge, adminListChallenges, consoleErrorMessage, type AdminChallenge } from '../../api/consoleApi'

type Status = 'LIVE' | 'UPCOMING' | 'ENDED' | 'CANCELLED' | 'ALL'
const STATUS_LABEL: Record<string, string> = { ACTIVE: 'Đang mở', FINISHED: 'Đã kết thúc', CANCELLED: 'Đã hủy', DRAFT: 'Nháp' }
const fmt = (iso: string) => new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })

/** Thử thách toàn hệ thống: tìm theo tên / CLB / người tạo; hủy thử thách vi phạm (hoàn tiền treo, báo người tham gia) */
export function ChallengesTab() {
  const [status, setStatus] = useState<Status>('LIVE')
  const [text, setText] = useState('')
  const q = useDebounced(text.trim(), 250)
  const list = useQuery({ queryKey: ['admin', 'challenges', status, q], queryFn: () => adminListChallenges(q, status), placeholderData: (p) => p })
  const [cancel, setCancel] = useState<AdminChallenge | null>(null)
  return (
    <div className="space-y-3">
      <SegmentedControl value={status} onChange={setStatus} options={[
        { value: 'LIVE', label: 'Đang diễn ra' }, { value: 'UPCOMING', label: 'Sắp tới' }, { value: 'ENDED', label: 'Kết thúc' },
        { value: 'CANCELLED', label: 'Đã hủy' }, { value: 'ALL', label: 'Tất cả' }]} />
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
        <Input value={text} onChange={(e) => setText(e.target.value)} className="pl-9" placeholder="Tên thử thách, CLB, người tạo hoặc ID" aria-label="Tìm thử thách" />
      </label>
      {list.isPending ? <Skeleton className="h-40" /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        : !list.data.length ? <EmptyState icon={Trophy} title="Không có thử thách" description="Thử đổi bộ lọc hoặc từ khóa." />
        : (
          <ul className="space-y-2">
            {list.data.map((c) => (
              <li key={c.id}>
                <Card className="space-y-1.5 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={routes.challenge(c.id)} className="min-w-0 font-semibold hover:underline">{c.title}</Link>
                    <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-fg-muted">{STATUS_LABEL[c.status] ?? c.status}</span>
                  </div>
                  <p className="text-xs text-fg-subtle">{c.creator ?? '—'}{c.club ? ` · CLB ${c.club}` : ''} · {fmt(c.start_date)} → {fmt(c.end_date)} · {formatNumber(c.participants)} người
                    {c.reward_xu > 0 ? ` · treo ${formatNumber(c.reward_xu)} Xu` : ''}</p>
                  {c.cancelled_reason && <p className="text-xs text-danger">Lý do hủy: {c.cancelled_reason}</p>}
                  {c.status === 'ACTIVE' && (
                    <Button size="sm" variant="danger" onClick={() => setCancel(c)}><CircleSlash className="size-4" aria-hidden />Hủy thử thách</Button>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      {cancel && <CancelSheet c={cancel} onClose={() => setCancel(null)} />}
    </div>
  )
}

function CancelSheet({ c, onClose }: { c: AdminChallenge; onClose: () => void }) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const m = useMutation({
    mutationFn: () => adminCancelChallenge(c.id, reason),
    onSuccess: () => { toast.success('Đã hủy thử thách và báo người tham gia'); void qc.invalidateQueries({ queryKey: ['admin', 'challenges'] }); onClose() },
    onError: (e) => toast.error(consoleErrorMessage(e)),
  })
  return (
    <ConfirmSheet open onClose={onClose} title={`Hủy "${c.title}"?`} confirmLabel="Hủy thử thách" loading={m.isPending}
      description={`${c.participants} người tham gia và người tạo sẽ nhận thông báo kèm lý do. Tiền treo thưởng được hoàn lại. Không hoàn tác được.`}
      onConfirm={() => { if (reason.trim().length < 3) { toast.error('Hãy ghi lý do (ít nhất 3 ký tự).'); return } m.mutate() }}>
      <Field label="Lý do (gửi cho người tham gia, lưu nhật ký)" htmlFor="admin-cancel-reason">
        <Input id="admin-cancel-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="VD: Nội dung vi phạm quy định cộng đồng" />
      </Field>
    </ConfirmSheet>
  )
}
