'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button, SegmentedControl, Skeleton, ErrorState } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatNumber, formatRelative } from '@/shared/lib/format'
import type { ErrorKind } from '@/shared/lib/errors'
import { useClientErrors, useResolveClientError } from '../hooks/useSystem'
import { systemApiErrorMessage } from '../api/systemApi'

const KIND: Record<ErrorKind, { label: string; tone: string; hint?: string }> = {
  NOT_DEPLOYED: { label: 'Chưa cập nhật máy chủ', tone: 'bg-danger/15 text-danger', hint: 'Thường do chưa chạy migration — xem mục Database ở trên.' },
  SERVER: { label: 'Máy chủ lỗi', tone: 'bg-danger/15 text-danger' },
  TIMEOUT: { label: 'Quá thời gian', tone: 'bg-coin/15 text-coin' },
  NETWORK: { label: 'Mất kết nối máy chủ', tone: 'bg-coin/15 text-coin' },
  FORBIDDEN: { label: 'Không có quyền', tone: 'bg-surface-2 text-fg-muted' },
  UNKNOWN: { label: 'Khác', tone: 'bg-surface-2 text-fg-muted' },
  OFFLINE: { label: 'Ngoại tuyến', tone: 'bg-surface-2 text-fg-muted' },
  AUTH: { label: 'Hết phiên', tone: 'bg-surface-2 text-fg-muted' },
  RATE_LIMIT: { label: 'Quá nhanh', tone: 'bg-surface-2 text-fg-muted' },
}
const DAYS = [{ value: '1', label: '24 giờ' }, { value: '7', label: '7 ngày' }, { value: '30', label: '30 ngày' }]

/** Quản trị → Hệ thống: lỗi người dùng gặp, gộp theo mã (mã hiện trên màn hình lỗi của người dùng) */
export function ClientErrorsPanel() {
  const [days, setDays] = useState('7')
  const q = useClientErrors(Number(days))
  const resolve = useResolveClientError()
  const done = (code: string | null) => resolve.mutate(code, {
    onSuccess: () => toast.success(code ? `Đã đánh dấu ${code} là đã xử lý` : 'Đã dọn toàn bộ nhật ký lỗi'),
    onError: (e) => toast.error(systemApiErrorMessage(e)),
  })
  return (
    <div className="space-y-3">
      <SegmentedControl value={days} onChange={setDays} options={DAYS} />
      {!!q.data?.length && (
        <p className="text-[11px] text-fg-subtle">Sửa xong nguyên nhân (vd. đã chạy migration còn thiếu) thì bấm <b>Đã xử lý</b> — lỗi được xoá khỏi nhật ký.
          Nếu còn xảy ra, lần sau người dùng gặp sẽ được ghi lại.</p>
      )}
      {q.isPending ? <Skeleton className="h-32" /> : q.isError ? <ErrorState error={q.error} message="Chưa đọc được nhật ký lỗi (cần migration 004400)." onRetry={() => void q.refetch()} />
        : !q.data.length ? <p className="py-4 text-center text-sm text-fg-muted">Không có lỗi nào được ghi nhận. 🎉</p>
        : (
          <ul className="divide-y divide-border">
            {q.data.map((r) => {
              const k = KIND[r.kind] ?? KIND.UNKNOWN
              return (
                <li key={r.code} className="space-y-1 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-semibold', k.tone)}>{k.label}</span>
                    <span className="font-mono text-xs text-fg-subtle">{r.code}</span>
                    <span className="ml-auto text-xs text-fg-muted">{formatNumber(r.hits)} lần · {formatNumber(r.users)} người</span>
                  </div>
                  {r.message && <p className="break-words font-mono text-[11px] text-fg-muted">{r.message}</p>}
                  <div className="flex items-end gap-2">
                    <p className="min-w-0 flex-1 text-[11px] text-fg-subtle">{r.path ?? '—'} · gần nhất {formatRelative(r.last_at)}{k.hint ? ` · ${k.hint}` : ''}</p>
                    <Button size="sm" variant="secondary" disabled={resolve.isPending} onClick={() => done(r.code)}>Đã xử lý</Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      {(q.data?.length ?? 0) > 1 && (
        <Button block size="sm" variant="ghost" disabled={resolve.isPending} onClick={() => done(null)}>Đánh dấu tất cả đã xử lý</Button>
      )}
    </div>
  )
}
