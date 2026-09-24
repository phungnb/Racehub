'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BarChart3, Check, Crown, Download, Link2, Ticket, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, ErrorState, Input, SectionTitle, Sheet, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatNumber } from '@/shared/lib/format'
import { clubErrorMessage, getAttendanceReport, getClubPlan, setClubSlug, type AttendanceRow, type Club } from '../../api/clubApi'
import { clubKeys } from '../../hooks/keys'
import { ClubProPurchase } from '@/features/billing'

const BENEFITS = [
  { icon: Users, text: 'Không giới hạn Quản trị viên (gói miễn phí: 2)' },
  { icon: Link2, text: 'Link mời riêng dễ nhớ: racehub…/c/ten-clb' },
  { icon: BarChart3, text: 'Báo cáo chuyên cần: buổi chạy, km, điểm danh sự kiện, đóng quỹ — xuất CSV' },
  { icon: Ticket, text: '2 lượt tạo thử thách CLB ≤100 người mỗi tháng (trừ quỹ CLB 0 Xu)' },
]
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('vi-VN')

/** Gói CLB (Pro): quyền lợi, link mời riêng, báo cáo chuyên cần — ban quản trị CLB */
export function ProSection({ club }: { club: Club }) {
  const q = useQuery({ queryKey: ['club', club.id, 'plan'], queryFn: () => getClubPlan(club.id) })
  const [report, setReport] = useState(false)
  if (q.isPending) return <Skeleton className="h-40" />
  if (q.isError) return <ErrorState message={clubErrorMessage(q.error)} onRetry={() => void q.refetch()} />
  const p = q.data
  return (
    <section>
      <SectionTitle>Gói CLB</SectionTitle>
      <Card className={cn('space-y-4', p.active && 'border-coin/50 bg-gradient-to-br from-coin/10 to-surface')}>
        <div className="flex items-center gap-3">
          <span className={cn('grid size-11 place-items-center rounded-xl', p.active ? 'bg-coin/20 text-coin' : 'bg-surface-2 text-fg-muted')}>
            <Crown className="size-5" aria-hidden />
          </span>
          <div className="flex-1">
            <p className="font-bold">{p.active ? 'CLB Pro' : 'Gói miễn phí'}</p>
            <p className="text-xs text-fg-muted">
              {p.active ? (p.pro_until ? `Hiệu lực đến ${fmtDate(p.pro_until)}` : 'Không thời hạn')
                : p.plan === 'PRO' ? 'Gói Pro đã hết hạn' : `Quản trị viên: ${p.captains}/${p.captain_limit ?? '∞'}`}
            </p>
          </div>
        </div>
        <ul className="space-y-2">
          {BENEFITS.map((b) => (
            <li key={b.text} className="flex items-start gap-2 text-sm">
              {p.active ? <Check className="mt-0.5 size-4 shrink-0 text-coin" aria-hidden /> : <b.icon className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />}
              <span className={p.active ? '' : 'text-fg-muted'}>{b.text}</span>
            </li>
          ))}
        </ul>
        {p.active ? (
          <>
            <SlugEditor clubId={club.id} current={p.slug} />
            <Button block variant="secondary" onClick={() => setReport(true)}><BarChart3 className="size-4" aria-hidden />Báo cáo chuyên cần</Button>
          </>
        ) : null}
        <ClubProPurchase clubId={club.id} active={p.active} />
      </Card>
      {report && <ReportSheet club={club} onClose={() => setReport(false)} />}
    </section>
  )
}

function SlugEditor({ clubId, current }: { clubId: string; current: string | null }) {
  const qc = useQueryClient()
  const [v, setV] = useState(current ?? '')
  const save = useMutation({
    mutationFn: () => setClubSlug(clubId, v.trim() || null),
    onSuccess: (slug) => {
      toast.success(slug ? 'Đã lưu link mời riêng' : 'Đã bỏ link mời riêng')
      void qc.invalidateQueries({ queryKey: ['club', clubId, 'plan'] })
      void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) })
    },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  const origin = typeof window === 'undefined' ? '' : window.location.host
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">Link mời riêng</p>
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs text-fg-subtle">{origin}/c/</span>
        <Input value={v} onChange={(e) => setV(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30))} placeholder="ho-tay-runners" aria-label="Link mời riêng" />
        <Button className="shrink-0" onClick={() => save.mutate()} loading={save.isPending} disabled={(v || null) === current}>Lưu</Button>
      </div>
      <p className="text-xs text-fg-subtle">Link và mã QR ở mục &ldquo;Mời vào CLB&rdquo; sẽ dùng link này.</p>
    </div>
  )
}

const csvCell = (x: unknown) => { const s = String(x ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }

function monthRange(offset: number) {
  const d = new Date()
  const from = new Date(d.getFullYear(), d.getMonth() + offset, 1)
  const to = new Date(d.getFullYear(), d.getMonth() + offset + 1, 1)
  return { from, to, label: from.toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' }) }
}

function ReportSheet({ club, onClose }: { club: Club; onClose: () => void }) {
  const [offset, setOffset] = useState(0)
  const r = monthRange(offset)
  const q = useQuery({ queryKey: ['club', club.id, 'attendance', offset], queryFn: () => getAttendanceReport(club.id, r.from.toISOString(), r.to.toISOString()) })
  const exportCsv = () => {
    if (!q.data) return
    const head = ['Thành viên', 'Vai trò', 'Buổi chạy', 'Km', 'Sự kiện đăng ký đi', 'Điểm danh', 'Khoản quỹ đã đóng']
    const rows = q.data.members.map((m: AttendanceRow) => [m.display_name, m.role, m.runs, String(m.km).replace('.', ','), m.events_going, m.events_checked_in, m.dues_paid])
    const csv = '﻿' + [head, ...rows].map((x) => x.map(csvCell).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `chuyen-can-${r.from.getFullYear()}-${String(r.from.getMonth() + 1).padStart(2, '0')}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const active = q.data?.members.filter((m) => m.runs > 0).length ?? 0
  return (
    <Sheet open onClose={onClose} title="Báo cáo chuyên cần" description={`${club.name} · ${r.label}`}
      footer={<Button block onClick={exportCsv} disabled={!q.data}><Download className="size-4" aria-hidden />Xuất CSV</Button>}>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {[-2, -1, 0].map((o) => (
            <button key={o} type="button" aria-pressed={offset === o} onClick={() => setOffset(o)}
              className={cn('rounded-xl border py-2 text-xs font-semibold', offset === o ? 'border-brand bg-brand text-brand-fg' : 'border-border')}>
              {o === 0 ? 'Tháng này' : o === -1 ? 'Tháng trước' : monthRange(o).from.toLocaleDateString('vi-VN', { month: '2-digit', year: 'numeric' })}
            </button>
          ))}
        </div>
        {q.isPending ? <Skeleton className="h-48" /> : q.isError ? <ErrorState message={clubErrorMessage(q.error)} /> : (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Mini label="Người chạy" value={`${active}/${q.data.members.length}`} />
              <Mini label="Sự kiện" value={formatNumber(q.data.events)} />
              <Mini label="Kỳ thu quỹ" value={formatNumber(q.data.dues)} />
            </div>
            <ul className="divide-y divide-border rounded-xl border border-border text-sm">
              <li className="grid grid-cols-[1fr_4.8rem_3.6rem_2.6rem] gap-1 px-3 py-2 text-[11px] font-semibold text-fg-subtle">
                <span>Thành viên</span><span className="text-right">Buổi · km</span><span className="text-right">Điểm danh</span><span className="text-right">Quỹ</span>
              </li>
              {q.data.members.map((m) => (
                <li key={m.user_id} className="grid grid-cols-[1fr_4.8rem_3.6rem_2.6rem] items-center gap-1 px-3 py-2">
                  <span className="truncate">{m.display_name}</span>
                  <span className="whitespace-nowrap text-right font-mono text-xs">{m.runs} · {formatNumber(m.km)}</span>
                  <span className="text-right font-mono text-xs">{m.events_checked_in}/{m.events_going}</span>
                  <span className="text-right font-mono text-xs">{m.dues_paid}/{q.data.dues}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Sheet>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-2 p-2">
      <p className="font-mono font-bold">{value}</p>
      <p className="text-[11px] text-fg-subtle">{label}</p>
    </div>
  )
}
