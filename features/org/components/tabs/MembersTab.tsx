'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Search, UserMinus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, ConfirmSheet, ErrorState, Input, Sheet, Skeleton } from '@/shared/ui'
import { matchesSearch } from '@/shared/lib/search'
import { listOrgMembers, orgErrorMessage, setOrgMember, type OrgDetail, type OrgMember } from '../../api/orgApi'

const ROLE_LABEL = { OWNER: 'Sở hữu', ADMIN: 'Quản trị', MEMBER: 'Thành viên' } as const

export function MembersTab({ org }: { org: OrgDetail }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['org', org.id, 'members'], queryFn: () => listOrgMembers(org.id) })
  const [term, setTerm] = useState('')
  const [unit, setUnit] = useState('')
  const [edit, setEdit] = useState<OrgMember | null>(null)
  const act = useMutation({
    mutationFn: ({ m, p }: { m: OrgMember; p: Parameters<typeof setOrgMember>[2] }) => setOrgMember(org.id, m.user_id, p),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['org', org.id] }) },
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  const list = useMemo(() => {
    return (q.data ?? []).filter((m) => (!term.trim() || matchesSearch(term, m.name, m.employee_code)) && (!unit || m.unit_id === unit))
  }, [q.data, term, unit])
  if (q.isPending) return <Skeleton className="h-60" />
  if (q.isError) return <ErrorState message={orgErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
  const pending = list.filter((m) => m.status === 'PENDING')
  const approved = list.filter((m) => m.status === 'APPROVED')
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Tìm tên, mã nhân viên" className="pl-9" aria-label="Tìm thành viên" />
        </div>
        {org.units.length > 0 && (
          <select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label={`Lọc theo ${org.unit_label}`}
            className="h-11 max-w-[40%] rounded-xl border border-border bg-surface px-2 text-sm">
            <option value="">Mọi {org.unit_label.toLowerCase()}</option>
            {org.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
      </div>
      {org.is_admin && pending.length > 0 && (
        <section className="space-y-1.5">
          <p className="text-sm font-semibold">Chờ duyệt ({pending.length})</p>
          {pending.map((m) => (
            <div key={m.user_id} className="flex items-center gap-3 rounded-xl border border-coin/40 bg-coin/5 px-3 py-2">
              <Avatar src={m.avatar_url} name={m.name} size="sm" />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{m.name}</span>
                <span className="block text-xs text-fg-muted">{[m.unit_name, m.employee_code].filter(Boolean).join(' · ') || 'Chưa chọn đơn vị'}</span></span>
              <Button size="sm" variant="ghost" aria-label="Từ chối" onClick={() => act.mutate({ m, p: { action: 'REMOVE' } })}><X className="size-4" aria-hidden /></Button>
              <Button size="sm" aria-label="Duyệt" onClick={() => act.mutate({ m, p: { status: 'APPROVED' } })}><Check className="size-4" aria-hidden /></Button>
            </div>
          ))}
        </section>
      )}
      <p className="text-xs text-fg-subtle">{approved.length} thành viên{org.is_admin ? ` · còn ${Math.max(0, org.seat_limit - org.seats_used)} chỗ` : ''}</p>
      <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
        {approved.map((m) => (
          <li key={m.user_id}>
            <button type="button" disabled={!org.is_admin} onClick={() => setEdit(m)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left disabled:cursor-default">
              <Avatar src={m.avatar_url} name={m.name} size="sm" />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{m.name}</span>
                <span className="block truncate text-xs text-fg-muted">{[m.unit_name, org.is_admin ? m.employee_code : null].filter(Boolean).join(' · ') || '—'}</span></span>
              {m.role !== 'MEMBER' && <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-semibold text-brand">{ROLE_LABEL[m.role]}</span>}
            </button>
          </li>
        ))}
      </ul>
      {edit && <MemberSheet org={org} m={edit} onClose={() => setEdit(null)} />}
    </div>
  )
}

function MemberSheet({ org, m, onClose }: { org: OrgDetail; m: OrgMember; onClose: () => void }) {
  const qc = useQueryClient()
  const [unit, setUnit] = useState(m.unit_id ?? '')
  const [code, setCode] = useState(m.employee_code ?? '')
  const [role, setRole] = useState<'ADMIN' | 'MEMBER'>(m.role === 'ADMIN' ? 'ADMIN' : 'MEMBER')
  const [remove, setRemove] = useState(false)
  const save = useMutation({
    mutationFn: (p: Parameters<typeof setOrgMember>[2]) => setOrgMember(org.id, m.user_id, p),
    onSuccess: () => { toast.success('Đã lưu'); void qc.invalidateQueries({ queryKey: ['org', org.id] }); onClose() },
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  return (
    <Sheet open onClose={onClose} title={m.name} description={`Vào từ ${new Date(m.joined_at).toLocaleDateString('vi-VN')}`}
      footer={<Button block loading={save.isPending} onClick={() => save.mutate({ unit_id: unit || null, employee_code: code, ...(m.role !== 'OWNER' ? { role } : {}) })}>Lưu</Button>}>
      <div className="space-y-4">
        <label className="block text-sm font-semibold">{org.unit_label}
          <select value={unit} onChange={(e) => setUnit(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-border bg-surface px-3 text-[15px] font-normal">
            <option value="">— Chưa gán —</option>
            {org.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label className="block text-sm font-semibold">Mã nhân viên
          <Input className="mt-1" value={code} maxLength={40} onChange={(e) => setCode(e.target.value)} />
        </label>
        {m.role !== 'OWNER' && (
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Vai trò">
            {(['MEMBER', 'ADMIN'] as const).map((r) => (
              <button key={r} type="button" role="radio" aria-checked={role === r} onClick={() => setRole(r)}
                className={`rounded-xl border py-2.5 text-sm font-semibold ${role === r ? 'border-brand bg-brand text-brand-fg' : 'border-border'}`}>
                {ROLE_LABEL[r]}
              </button>
            ))}
          </div>
        )}
        {m.role !== 'OWNER' && (
          <Button variant="danger" block onClick={() => setRemove(true)}><UserMinus className="size-4" aria-hidden />Mời ra khỏi tổ chức</Button>
        )}
      </div>
      <ConfirmSheet open={remove} onClose={() => setRemove(false)} title={`Mời ${m.name} ra khỏi tổ chức?`}
        description="Người này không còn trong chiến dịch và báo cáo; có thể vào lại bằng mã mời." confirmLabel="Mời ra"
        loading={save.isPending} onConfirm={() => save.mutate({ action: 'REMOVE' })} />
    </Sheet>
  )
}
