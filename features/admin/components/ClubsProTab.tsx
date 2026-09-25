'use client'

import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Crown, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button, EmptyState, ErrorState, Field, Input, Sheet, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { useDebounced } from '@/shared/lib/search'
import { formatNumber } from '@/shared/lib/format'
import { adminErrorMessage, adminListClubs, adminSetClubPlan, type AdminClub } from '../api/adminApi'

const TERMS = [{ months: 1, label: '1 tháng' }, { months: 3, label: '3 tháng' }, { months: 12, label: '12 tháng' }, { months: 0, label: 'Không thời hạn' }]

/** Bật / tắt gói CLB Pro (chưa có thanh toán trong app — admin bật sau khi nhận chuyển khoản) */
export function ClubsProTab() {
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<AdminClub | null>(null)
  const term = useDebounced(q.trim())
  const list = useQuery({ queryKey: ['admin', 'clubs', term], queryFn: () => adminListClubs(term), placeholderData: keepPreviousData })
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm CLB theo tên hoặc link riêng" className="pl-9" aria-label="Tìm CLB" />
      </div>
      {list.isPending ? <Skeleton className="h-48" /> : list.isError ? <ErrorState message={adminErrorMessage(list.error)} error={list.error} onRetry={() => void list.refetch()} />
        : !list.data.length ? <EmptyState icon={Crown} title="Không tìm thấy CLB" />
        : (
          <ul className="space-y-2">
            {list.data.map((c) => (
              <li key={c.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate font-semibold">{c.name}
                    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', c.active ? 'bg-coin/20 text-coin' : 'bg-surface-2 text-fg-muted')}>
                      {c.active ? 'PRO' : c.plan === 'PRO' ? 'PRO hết hạn' : 'FREE'}
                    </span>
                  </p>
                  <p className="text-xs text-fg-muted">
                    {formatNumber(c.member_count)} thành viên{c.pro_until ? ` · đến ${new Date(c.pro_until).toLocaleDateString('vi-VN')}` : c.active ? ' · không thời hạn' : ''}{c.slug ? ` · /c/${c.slug}` : ''}
                  </p>
                </div>
                <Button size="sm" variant={c.active ? 'secondary' : 'primary'} onClick={() => setEditing(c)}>{c.active ? 'Sửa' : 'Bật Pro'}</Button>
              </li>
            ))}
          </ul>
        )}
      {editing && <PlanSheet club={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function PlanSheet({ club, onClose }: { club: AdminClub; onClose: () => void }) {
  const qc = useQueryClient()
  const [months, setMonths] = useState(12)
  const [reason, setReason] = useState('')
  const set = useMutation({
    mutationFn: (plan: 'FREE' | 'PRO') => {
      let until: string | null = null
      if (plan === 'PRO' && months > 0) {
        const base = club.active && club.pro_until ? new Date(club.pro_until) : new Date()     // gia hạn: cộng dồn
        base.setMonth(base.getMonth() + months)
        until = base.toISOString()
      }
      return adminSetClubPlan(club.id, plan, until, reason.trim())
    },
    onSuccess: (_, plan) => {
      toast.success(plan === 'PRO' ? `Đã bật Pro cho ${club.name}` : `Đã chuyển ${club.name} về gói miễn phí`)
      void qc.invalidateQueries({ queryKey: ['admin', 'clubs'] })
      onClose()
    },
    onError: (e) => toast.error(adminErrorMessage(e)),
  })
  return (
    <Sheet open onClose={onClose} title={club.name} description="Mọi thay đổi được ghi nhật ký quản trị và báo cho ban quản trị CLB."
      footer={
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => set.mutate('FREE')} disabled={set.isPending || reason.trim().length < 3 || club.plan === 'FREE'}>Về miễn phí</Button>
          <Button onClick={() => set.mutate('PRO')} loading={set.isPending} disabled={reason.trim().length < 3}><Crown className="size-4" aria-hidden />{club.active ? 'Gia hạn Pro' : 'Bật Pro'}</Button>
        </div>
      }>
      <div className="space-y-4">
        <Field label="Thời hạn">
          <div className="grid grid-cols-2 gap-2">
            {TERMS.map((t) => (
              <button key={t.months} type="button" aria-pressed={months === t.months} onClick={() => setMonths(t.months)}
                className={cn('rounded-xl border py-2.5 text-sm font-semibold', months === t.months ? 'border-brand bg-brand text-brand-fg' : 'border-border')}>{t.label}</button>
            ))}
          </div>
        </Field>
        <Field label="Lý do / mã giao dịch" htmlFor="pro-reason">
          <Input id="pro-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="VD: CK 12 tháng, mã GD 123456" />
        </Field>
      </div>
    </Sheet>
  )
}
