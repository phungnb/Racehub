'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Gift, Minus, Plus, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Card, ConfirmSheet, Field, Input, SectionTitle, Sheet, SwitchRow } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { cancelDraw, createDraw, drawErrorMessage, listDraws, runDraw, type DrawRule, type DrawScope, type LuckyDraw } from '../api/drawApi'

const RULES: Record<DrawScope, Partial<Record<DrawRule, string>>> = {
  ORG_CAMPAIGN: { COMPLETED: 'Người đạt mục tiêu', ACTIVE: 'Người có chạy trong chiến dịch', ALL: 'Mọi người tham gia' },
  CHALLENGE: { COMPLETED: 'Người hoàn thành thử thách', ACTIVE: 'Người đã có thành tích', ALL: 'Mọi người tham gia' },
  RACE: { COMPLETED: 'VĐV đã về đích', ALL: 'Mọi VĐV đăng ký' },
  CLUB: { ACTIVE: 'Thành viên có chạy 30 ngày qua', ALL: 'Mọi thành viên' },
  SYSTEM: { ACTIVE: 'Runner có chạy 30 ngày qua', ALL: 'Mọi tài khoản' },
}

/** Quay thưởng dùng chung: danh sách lượt quay + kết quả; người quản lý tạo / quay (một lần, có seed kiểm chứng) */
export function DrawPanel({ scope, refId, canManage, className }: { scope: DrawScope; refId: string | null; canManage: boolean; className?: string }) {
  const q = useQuery({ queryKey: ['draws', scope, refId], queryFn: () => listDraws(scope, refId) })
  const [creating, setCreating] = useState(false)
  const list = q.data ?? []
  if (!canManage && !list.some((d) => d.status === 'DONE')) return null
  return (
    <section className={cn('space-y-2', className)}>
      <SectionTitle action={canManage ? <Button size="sm" variant="secondary" onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden />Tạo lượt quay</Button> : undefined}>
        Quay thưởng
      </SectionTitle>
      {canManage && !list.length && (
        <p className="rounded-xl border border-dashed border-border p-3 text-sm text-fg-muted">
          Tạo lượt quay may mắn cho người đủ điều kiện. Quay một lần, kết quả công khai kèm mã kiểm chứng; người trúng được báo ngay.
        </p>
      )}
      <ul className="space-y-2">
        {list.filter((d) => canManage || d.status === 'DONE').map((d) => <li key={d.id}><DrawCard d={d} scope={scope} refId={refId} /></li>)}
      </ul>
      {creating && <CreateDrawSheet scope={scope} refId={refId} onClose={() => setCreating(false)} />}
    </section>
  )
}

function DrawCard({ d, scope, refId }: { d: LuckyDraw; scope: DrawScope; refId: string | null }) {
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState<'run' | 'cancel' | null>(null)
  const [reveal, setReveal] = useState<number | null>(null)
  const refresh = () => void qc.invalidateQueries({ queryKey: ['draws', scope, refId] })
  const run = useMutation({
    mutationFn: () => runDraw(d.id),
    onSuccess: () => { setConfirm(null); setReveal(0); refresh() },
    onError: (e) => { setConfirm(null); toast.error(drawErrorMessage(e)) },
  })
  const cancel = useMutation({
    mutationFn: () => cancelDraw(d.id),
    onSuccess: () => { setConfirm(null); refresh() },
    onError: (e) => toast.error(drawErrorMessage(e)),
  })
  // Hiệu ứng lật từng người trúng sau khi quay
  useEffect(() => {
    if (reveal === null || reveal >= d.winners.length) return
    const t = setTimeout(() => setReveal((r) => (r ?? 0) + 1), 700)
    return () => clearTimeout(t)
  }, [reveal, d.winners.length])
  const shown = reveal === null ? d.winners.length : Math.min(reveal, d.winners.length)
  const rules = RULES[scope]
  const total = d.prizes.reduce((a, p) => a + p.qty, 0)
  return (
    <Card className={cn('space-y-3', d.status === 'DONE' && 'border-coin/40 bg-gradient-to-br from-coin/10 to-surface', d.status === 'CANCELLED' && 'opacity-60')}>
      <div className="flex items-start gap-2">
        <Gift className="mt-0.5 size-5 shrink-0 text-coin" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{d.title}</p>
          <p className="text-xs text-fg-muted">{rules[d.rule] ?? d.rule} · {d.prizes.map((p) => `${p.qty} × ${p.name}`).join(', ')}</p>
        </div>
        <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold">
          {d.status === 'DONE' ? 'Đã quay' : d.status === 'CANCELLED' ? 'Đã huỷ' : 'Chờ quay'}
        </span>
      </div>
      {d.status === 'READY' && d.can_manage && (
        <>
          <p className="text-sm text-fg-muted">Đủ điều kiện hiện tại: <b className="text-fg">{d.eligible_now ?? 0}</b> người{d.exclude_winners ? ' (đã loại người trúng lượt trước)' : ''} · {total} suất quà</p>
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Button variant="ghost" onClick={() => setConfirm('cancel')} aria-label="Huỷ lượt quay"><Trash2 className="size-4" aria-hidden /></Button>
            <Button variant="coin" loading={run.isPending} disabled={!d.eligible_now} onClick={() => setConfirm('run')}><Sparkles className="size-4" aria-hidden />Quay ngay</Button>
          </div>
        </>
      )}
      {run.isPending && <p className="animate-pulse text-center font-mono text-lg font-bold text-coin">Đang quay…</p>}
      {d.status === 'DONE' && (
        <>
          <ol className="space-y-1.5">
            {d.winners.slice(0, shown).map((w) => (
              <li key={w.user_id} className={cn('flex items-center gap-3 rounded-xl px-2 py-1.5 animate-fade-in', w.me ? 'bg-brand/15' : 'bg-surface-2/60')}>
                <span className="w-6 text-center font-mono text-xs font-bold text-fg-muted">{w.position}</span>
                <Avatar src={w.avatar_url} name={w.name} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{w.name}{w.me ? ' (bạn)' : ''}</span>
                <span className="shrink-0 text-xs font-semibold text-coin">{w.prize}</span>
              </li>
            ))}
          </ol>
          <details className="text-[11px] text-fg-subtle">
            <summary className="flex cursor-pointer items-center gap-1"><ShieldCheck className="size-3.5" aria-hidden />Kiểm chứng</summary>
            <p className="mt-1 break-all">Quay lúc {d.run_at ? new Date(d.run_at).toLocaleString('vi-VN') : ''} trong {d.entrant_count} người đủ điều kiện.
              Mã băm danh sách: {d.entrants_hash} · Seed: {d.seed}. Thứ tự trúng = sắp xếp md5(seed + mã người dùng) tăng dần — không ai chỉnh được sau khi quay.</p>
          </details>
        </>
      )}
      <ConfirmSheet open={confirm === 'run'} onClose={() => setConfirm(null)} danger={false} title="Quay thưởng ngay?"
        description="Chỉ quay được một lần, kết quả công bố cho mọi người và báo người trúng." confirmLabel="Quay"
        loading={run.isPending} onConfirm={() => run.mutate()} />
      <ConfirmSheet open={confirm === 'cancel'} onClose={() => setConfirm(null)} title="Huỷ lượt quay?" confirmLabel="Huỷ lượt quay"
        loading={cancel.isPending} onConfirm={() => cancel.mutate()} />
    </Card>
  )
}

function CreateDrawSheet({ scope, refId, onClose }: { scope: DrawScope; refId: string | null; onClose: () => void }) {
  const qc = useQueryClient()
  const rules = Object.keys(RULES[scope]) as DrawRule[]
  const [title, setTitle] = useState('Quay thưởng may mắn')
  const [rule, setRule] = useState<DrawRule>(rules[0])
  const [prizes, setPrizes] = useState([{ name: '', qty: 1 }])
  const [exclude, setExclude] = useState(true)
  const create = useMutation({
    mutationFn: () => createDraw(scope, refId, { title: title.trim(), rule, exclude_winners: exclude,
      prizes: prizes.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), qty: p.qty })) }),
    onSuccess: () => { toast.success('Đã tạo lượt quay'); void qc.invalidateQueries({ queryKey: ['draws', scope, refId] }); onClose() },
    onError: (e) => toast.error(drawErrorMessage(e)),
  })
  const valid = title.trim().length >= 3 && prizes.some((p) => p.name.trim())
  return (
    <Sheet open onClose={onClose} title="Tạo lượt quay thưởng" description="Quà do ban tổ chức tự trao — RaceHub chỉ chọn người trúng minh bạch."
      footer={<Button block loading={create.isPending} disabled={!valid} onClick={() => create.mutate()}>Tạo lượt quay</Button>}>
      <div className="space-y-4">
        <Field label="Tên lượt quay" htmlFor="d-title"><Input id="d-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></Field>
        <div role="radiogroup" aria-label="Ai được quay" className="grid gap-2">
          {rules.map((r) => (
            <button key={r} type="button" role="radio" aria-checked={rule === r} onClick={() => setRule(r)}
              className={cn('rounded-xl border p-3 text-left text-sm font-semibold', rule === r ? 'border-brand/60 bg-brand/10' : 'border-border')}>{RULES[scope][r]}</button>
          ))}
        </div>
        <div className="space-y-2">
          <p className="text-sm font-semibold">Giải thưởng</p>
          {prizes.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input value={p.name} maxLength={80} placeholder={i === 0 ? 'VD: Giày chạy' : 'Tên giải'} aria-label={`Giải ${i + 1}`}
                onChange={(e) => setPrizes(prizes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <div className="flex shrink-0 items-center gap-1">
                <Button size="sm" variant="ghost" aria-label="Bớt" onClick={() => setPrizes(prizes.map((x, j) => (j === i ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}><Minus className="size-4" aria-hidden /></Button>
                <span className="w-7 text-center font-mono text-sm">{p.qty}</span>
                <Button size="sm" variant="ghost" aria-label="Thêm" onClick={() => setPrizes(prizes.map((x, j) => (j === i ? { ...x, qty: Math.min(100, x.qty + 1) } : x)))}><Plus className="size-4" aria-hidden /></Button>
              </div>
            </div>
          ))}
          {prizes.length < 10 && <Button size="sm" variant="secondary" onClick={() => setPrizes([...prizes, { name: '', qty: 1 }])}><Plus className="size-4" aria-hidden />Thêm giải</Button>}
        </div>
        <SwitchRow checked={exclude} onChange={setExclude} label="Loại người đã trúng ở lượt trước" description="Mỗi người trúng tối đa một lần trong cùng chương trình" />
      </div>
    </Sheet>
  )
}
