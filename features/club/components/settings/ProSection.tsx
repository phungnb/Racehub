'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BarChart3, Check, Crown, Download, Link2, Sparkles, Ticket, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, ErrorState, Input, SectionTitle, Sheet, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatNumber } from '@/shared/lib/format'
import { clubErrorMessage, getAttendanceReport, getClubChallengeQuota, getClubPlan, setClubSlug, type AttendanceRow, type Club } from '../../api/clubApi'
import { clubKeys } from '../../hooks/keys'
import { ClubProPurchase } from '@/features/billing'
import { BrandingEditor } from './BrandingEditor'

const BENEFITS = [
  { icon: Users, text: 'Không giới hạn Quản trị viên (gói miễn phí: 2)' },
  { icon: Link2, text: 'Trang công khai + link mời dễ nhớ: racehub…/c/ten-clb' },
  { icon: BarChart3, text: 'Báo cáo chuyên cần: buổi chạy, km, điểm danh sự kiện, đóng quỹ — xuất CSV' },
  { icon: Sparkles, text: 'Tường nhà nổi bật: ảnh bìa, khẩu hiệu, chủ đề màu, huy hiệu ✦ PRO' },
  { icon: Ticket, text: 'Thử thách nội bộ miễn phí: tới 20 thử thách cùng lúc, mỗi thử thách tới 1.000 người' },
]
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('vi-VN')

/** Gói CLB (Pro): quyền lợi, link mời riêng, báo cáo chuyên cần — ban quản trị CLB */
export function ProSection({ club }: { club: Club }) {
  const q = useQuery({ queryKey: ['club', club.id, 'plan'], queryFn: () => getClubPlan(club.id) })
  const [report, setReport] = useState(false)
  if (q.isPending) return <Skeleton className="h-40" />
  if (q.isError) return <ErrorState message={clubErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
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
            {p.slug && <a href={`/c/${p.slug}`} target="_blank" rel="noopener noreferrer" className="inline-block text-sm font-semibold text-brand">Xem trang công khai của CLB →</a>}
            <Button block variant="secondary" onClick={() => setReport(true)}><BarChart3 className="size-4" aria-hidden />Báo cáo chuyên cần</Button>
          </>
        ) : null}
        <QuotaCard clubId={club.id} />
        <BrandingEditor club={club} active={p.active} />
        <ClubProPurchase clubId={club.id} active={p.active} />
      </Card>
      {report && <ReportSheet club={club} onClose={() => setReport(false)} />}
    </section>
  )
}

/** Hạn mức thử thách nội bộ miễn phí đang dùng (migration 008200) */
function QuotaCard({ clubId }: { clubId: string }) {
  const q = useQuery({ queryKey: ['club', clubId, 'challenge-quota'], queryFn: () => getClubChallengeQuota(clubId) })
  if (!q.data) return null
  const d = q.data
  const rows = [
    { label: 'Thử thách đang diễn ra', value: `${d.open}/${d.max_open}`, ok: d.open < d.max_open },
    { label: 'Quy mô mỗi thử thách', value: `≤ ${formatNumber(d.max_slots)} người`, ok: true },
    ...(d.plan === 'FREE' ? [{ label: `Thành viên có bài chạy trong ${d.active_window_days} ngày`, value: `${d.active_members}/${d.min_active_members}`,
                               ok: d.active_members >= d.min_active_members }] : []),
  ]
  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <p className="text-sm font-semibold">Thử thách nội bộ miễn phí</p>
      <ul className="space-y-1 text-sm">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between gap-2">
            <span className="text-fg-muted">{r.label}</span>
            <span className={cn('font-mono font-semibold', r.ok ? 'text-brand' : 'text-danger')}>{r.value}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-fg-subtle">
        {d.plan === 'FREE'
          ? `Ngoài hạn mức vẫn tạo được, phí tính theo quy mô và trừ quỹ CLB. CLB Pro: ${d.pro.max_open} thử thách cùng lúc, tới ${formatNumber(d.pro.max_slots)} người, không cần điều kiện thành viên.`
          : 'Ngoài hạn mức: phí theo quy mô, trừ quỹ CLB.'}
      </p>
    </div>
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
        {q.isPending ? <Skeleton className="h-48" /> : q.isError ? <ErrorState message={clubErrorMessage(q.error)} error={q.error} /> : (
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
