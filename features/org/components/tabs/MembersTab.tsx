'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Download, FileUp, MailQuestion, Search, Trash2, UserMinus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, ConfirmSheet, ErrorState, Input, Sheet, Skeleton, SwitchRow, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { matchesSearch } from '@/shared/lib/search'
import {
  deletePendingInvite, importOrgMembers, listOrgMembers, listPendingInvites, orgErrorMessage, setOrgMember,
  type ImportResult, type ImportRow, type OrgDetail, type OrgMember,
} from '../../api/orgApi'
import { downloadCsv, parseCsv, unitOptions } from '../../model/org'

export const ROLE_LABEL = { OWNER: 'Sở hữu', ADMIN: 'Quản trị', UNIT_ADMIN: 'Trưởng đơn vị', MEMBER: 'Thành viên' } as const

export function MembersTab({ org }: { org: OrgDetail }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['org', org.id, 'members'], queryFn: () => listOrgMembers(org.id) })
  const [term, setTerm] = useState('')
  const [unit, setUnit] = useState('')
  const [edit, setEdit] = useState<OrgMember | null>(null)
  const [importing, setImporting] = useState(false)
  const [invites, setInvites] = useState(false)
  const units = useMemo(() => unitOptions(org.units), [org.units])
  const act = useMutation({
    mutationFn: ({ m, p }: { m: OrgMember; p: Parameters<typeof setOrgMember>[2] }) => setOrgMember(org.id, m.user_id, p),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['org', org.id] }) },
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  const list = useMemo(() => {
    const sub = unit ? new Set(unitOptions(org.units).filter((u) => u.id === unit || u.path.startsWith(`${units.find((x) => x.id === unit)?.path} /`)).map((u) => u.id)) : null
    return (q.data ?? []).filter((m) => (!term.trim() || matchesSearch(term, m.name, m.employee_code)) && (!sub || (m.unit_id && sub.has(m.unit_id))))
  }, [q.data, term, unit, org.units, units])
  if (q.isPending) return <Skeleton className="h-60" />
  if (q.isError) return <ErrorState message={orgErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
  const pending = list.filter((m) => m.status === 'PENDING')
  const approved = list.filter((m) => m.status === 'APPROVED')
  const canManage = org.is_admin || org.is_unit_admin
  return (
    <div className="space-y-3">
      {org.is_admin && (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => setImporting(true)}><FileUp className="size-4" aria-hidden />Nhập danh sách</Button>
          <Button variant="secondary" onClick={() => setInvites(true)}><MailQuestion className="size-4" aria-hidden />Lời mời chờ{org.pending_invites ? ` (${org.pending_invites})` : ''}</Button>
        </div>
      )}
      {org.is_unit_admin && <p className="rounded-xl bg-surface-2 p-2.5 text-xs text-fg-muted">Bạn là trưởng đơn vị: duyệt, gán đơn vị và mời ra người trong đơn vị của mình.</p>}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Tìm tên, mã nhân viên" className="pl-9" aria-label="Tìm thành viên" />
        </div>
        {units.length > 0 && (
          <select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label={`Lọc theo ${org.unit_label}`}
            className="h-11 max-w-[42%] rounded-xl border border-border bg-surface px-2 text-sm">
            <option value="">Mọi {org.unit_label.toLowerCase()}</option>
            {units.map((u) => <option key={u.id} value={u.id}>{'· '.repeat(u.depth)}{u.name}</option>)}
          </select>
        )}
      </div>
      {canManage && pending.length > 0 && (
        <section className="space-y-1.5">
          <p className="text-sm font-semibold">Chờ duyệt ({pending.length})</p>
          {pending.map((m) => (
            <div key={m.user_id} className="flex items-center gap-3 rounded-xl border border-coin/40 bg-coin/5 px-3 py-2">
              <Avatar src={m.avatar_url} name={m.name} size="sm" />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{m.name}</span>
                <span className="block text-xs text-fg-muted">{[m.unit_name, m.employee_code].filter(Boolean).join(' · ') || 'Chưa chọn đơn vị'}</span></span>
              {m.manageable && <>
                <Button size="sm" variant="ghost" aria-label="Từ chối" onClick={() => act.mutate({ m, p: { action: 'REMOVE' } })}><X className="size-4" aria-hidden /></Button>
                <Button size="sm" aria-label="Duyệt" onClick={() => act.mutate({ m, p: { status: 'APPROVED' } })}><Check className="size-4" aria-hidden /></Button>
              </>}
            </div>
          ))}
        </section>
      )}
      <p className="text-xs text-fg-subtle">{approved.length} thành viên{org.is_admin ? ` · còn ${Math.max(0, org.seat_limit - org.seats_used)} chỗ` : ''}</p>
      <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
        {approved.map((m) => (
          <li key={m.user_id}>
            <button type="button" disabled={!m.manageable} onClick={() => setEdit(m)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left disabled:cursor-default">
              <Avatar src={m.avatar_url} name={m.name} size="sm" />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{m.name}</span>
                <span className="block truncate text-xs text-fg-muted">{[m.unit_name, m.employee_code].filter(Boolean).join(' · ') || '—'}</span></span>
              {m.role !== 'MEMBER' && <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-semibold text-brand">{ROLE_LABEL[m.role]}</span>}
            </button>
          </li>
        ))}
      </ul>
      {edit && <MemberSheet org={org} m={edit} onClose={() => setEdit(null)} />}
      {importing && <ImportSheet org={org} onClose={() => setImporting(false)} />}
      {invites && <InvitesSheet org={org} onClose={() => setInvites(false)} />}
    </div>
  )
}

function MemberSheet({ org, m, onClose }: { org: OrgDetail; m: OrgMember; onClose: () => void }) {
  const qc = useQueryClient()
  const [unit, setUnit] = useState(m.unit_id ?? '')
  const [code, setCode] = useState(m.employee_code ?? '')
  const [role, setRole] = useState<'ADMIN' | 'UNIT_ADMIN' | 'MEMBER'>(m.role === 'OWNER' ? 'ADMIN' : m.role)
  const [remove, setRemove] = useState(false)
  const units = unitOptions(org.units, org.is_admin ? null : org.managed_units)
  const save = useMutation({
    mutationFn: (p: Parameters<typeof setOrgMember>[2]) => setOrgMember(org.id, m.user_id, p),
    onSuccess: () => { toast.success('Đã lưu'); void qc.invalidateQueries({ queryKey: ['org', org.id] }); onClose() },
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  const submit = () => save.mutate({
    ...(unit || org.is_admin ? { unit_id: unit || null } : {}), employee_code: code,
    ...(org.is_admin && m.role !== 'OWNER' && role !== m.role ? { role } : {}),
  })
  return (
    <Sheet open onClose={onClose} title={m.name} description={`Vào từ ${new Date(m.joined_at).toLocaleDateString('vi-VN')}`}
      footer={<Button block loading={save.isPending} disabled={role === 'UNIT_ADMIN' && !unit} onClick={submit}>Lưu</Button>}>
      <div className="space-y-4">
        <label className="block text-sm font-semibold">{org.unit_label}
          <select value={unit} onChange={(e) => setUnit(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-border bg-surface px-3 text-[15px] font-normal">
            {org.is_admin && <option value="">— Chưa gán —</option>}
            {units.map((u) => <option key={u.id} value={u.id}>{u.path}</option>)}
          </select>
        </label>
        <label className="block text-sm font-semibold">Mã nhân viên
          <Input className="mt-1" value={code} maxLength={40} onChange={(e) => setCode(e.target.value)} />
        </label>
        {org.is_admin && m.role !== 'OWNER' && (
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Vai trò">
            {(['MEMBER', 'UNIT_ADMIN', 'ADMIN'] as const).map((r) => (
              <button key={r} type="button" role="radio" aria-checked={role === r} onClick={() => setRole(r)}
                className={cn('rounded-xl border py-2.5 text-xs font-semibold', role === r ? 'border-brand bg-brand text-brand-fg' : 'border-border')}>
                {ROLE_LABEL[r]}
              </button>
            ))}
          </div>
        )}
        {role === 'UNIT_ADMIN' && <p className="text-xs text-fg-muted">Trưởng đơn vị quản lý người trong {org.unit_label.toLowerCase()} đã chọn (và các đơn vị con), xem báo cáo của đơn vị.</p>}
        {m.role !== 'OWNER' && <Button variant="danger" block onClick={() => setRemove(true)}><UserMinus className="size-4" aria-hidden />Mời ra khỏi tổ chức</Button>}
      </div>
      <ConfirmSheet open={remove} onClose={() => setRemove(false)} title={`Mời ${m.name} ra khỏi tổ chức?`}
        description="Người này không còn trong chiến dịch và báo cáo; có thể vào lại bằng mã mời." confirmLabel="Mời ra"
        loading={save.isPending} onConfirm={() => save.mutate({ action: 'REMOVE' })} />
    </Sheet>
  )
}

const HEADERS: Record<keyof ImportRow, RegExp> = {
  email: /^(e-?mail|thu dien tu|thư điện tử)$/i,
  unit: /^(don vi|đơn vị|unit|phong ban|phòng ban|bo phan|bộ phận)$/i,
  employee_code: /^(ma nv|mã nv|ma nhan vien|mã nhân viên|employee.?code|msnv)$/i,
  role: /^(vai tro|vai trò|role)$/i,
}

function toRows(table: string[][]): ImportRow[] {
  if (!table.length) return []
  const head = table[0].map((h) => h.trim())
  const col = (k: keyof ImportRow) => head.findIndex((h) => HEADERS[k].test(h))
  const hasHeader = col('email') >= 0
  const idx = hasHeader ? { email: col('email'), unit: col('unit'), employee_code: col('employee_code'), role: col('role') } : { email: 0, unit: 1, employee_code: 2, role: 3 }
  return (hasHeader ? table.slice(1) : table).map((r) => ({
    email: (r[idx.email] ?? '').toLowerCase(), unit: idx.unit >= 0 ? r[idx.unit] ?? '' : '',
    employee_code: idx.employee_code >= 0 ? r[idx.employee_code] ?? '' : '',
    role: idx.role >= 0 && /truong|trưởng|unit_admin/i.test(r[idx.role] ?? '') ? 'UNIT_ADMIN' : 'MEMBER',
  })).filter((r) => r.email)
}

/** Nhập danh sách nhân viên từ Excel (lưu CSV) — email, đơn vị nhiều cấp, mã NV, vai trò */
function ImportSheet({ org, onClose }: { org: OrgDetail; onClose: () => void }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [createUnits, setCreateUnits] = useState(true)
  const [removeMissing, setRemoveMissing] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const rows = useMemo(() => toRows(parseCsv(text)), [text])
  const run = useMutation({
    mutationFn: () => importOrgMembers(org.id, rows, { create_units: createUnits, remove_missing: removeMissing }),
    onSuccess: (r) => { setResult(r); void qc.invalidateQueries({ queryKey: ['org', org.id] }) },
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  const template = () => downloadCsv('mau-danh-sach.csv', ['Email', 'Đơn vị', 'Mã NV', 'Vai trò'], [
    ['nguyen.an@congty.vn', 'Miền Bắc / Hà Nội / Phòng Kỹ thuật', 'NV001', 'Thành viên'],
    ['tran.binh@congty.vn', 'Miền Bắc / Hà Nội / Phòng Kỹ thuật', 'NV002', 'Trưởng đơn vị']])
  return (
    <Sheet open onClose={onClose} title="Nhập danh sách thành viên" description="Từ Excel: Tệp → Lưu thành → CSV UTF-8. Cột: Email, Đơn vị (nhiều cấp cách nhau bằng /), Mã NV, Vai trò."
      footer={result ? <Button block onClick={onClose}>Xong</Button>
        : <Button block loading={run.isPending} disabled={!rows.length} onClick={() => run.mutate()}>Nhập {rows.length} dòng</Button>}>
      {result ? (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2 text-center">
            {[['Thêm mới', result.added], ['Cập nhật', result.updated], ['Chờ đăng ký', result.invited], ['Đã gỡ', result.removed]].map(([l, v]) => (
              <div key={l as string} className="rounded-xl bg-surface-2 p-2"><p className="font-mono text-lg font-bold">{v}</p><p className="text-[11px] text-fg-subtle">{l}</p></div>
            ))}
          </div>
          {result.units_created > 0 && <p>Đã tạo {result.units_created} đơn vị mới.</p>}
          {result.invited > 0 && <p className="text-fg-muted">Người chưa có tài khoản RaceHub nằm ở “Lời mời chờ”: khi họ đăng ký và vào bằng mã mời, hệ thống tự duyệt và gán đơn vị.</p>}
          {result.errors.length > 0 && (
            <div className="rounded-xl border border-danger/40 bg-danger/5 p-2">
              <p className="font-semibold text-danger">{result.errors.length} dòng lỗi</p>
              <ul className="mt-1 max-h-40 overflow-y-auto text-xs">{result.errors.map((e, i) => <li key={i}>{e.email || '(trống)'} — {orgErrorMessage({ message: e.error })}</li>)}</ul>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-surface-2 text-sm font-semibold">
              <FileUp className="size-4" aria-hidden />Chọn tệp CSV
              <input type="file" accept=".csv,.txt,text/csv" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setText(await f.text()) }} />
            </label>
            <Button variant="ghost" onClick={template}><Download className="size-4" aria-hidden />Tệp mẫu</Button>
          </div>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder={'Hoặc dán từ Excel:\nEmail\tĐơn vị\tMã NV\nan@congty.vn\tMiền Bắc / Hà Nội\tNV001'}
            aria-label="Dán danh sách" className="font-mono text-xs" />
          {rows.length > 0 && (
            <div className="rounded-xl border border-border text-xs">
              <p className="border-b border-border px-2 py-1.5 font-semibold">{rows.length} dòng · xem trước</p>
              {rows.slice(0, 5).map((r, i) => (
                <p key={i} className="truncate px-2 py-1">{r.email} · {r.unit || '—'} · {r.employee_code || '—'}{r.role === 'UNIT_ADMIN' ? ' · Trưởng đơn vị' : ''}</p>
              ))}
            </div>
          )}
          <SwitchRow checked={createUnits} onChange={setCreateUnits} label="Tự tạo đơn vị chưa có" description="Tên đơn vị trong tệp chưa có thì tạo mới (tối đa 4 cấp)" />
          <SwitchRow checked={removeMissing} onChange={setRemoveMissing} label="Gỡ người không có trong tệp"
            description="Dùng khi tệp là danh sách nhân sự đầy đủ — người đã nghỉ việc tự bị gỡ, trả lại chỗ. Không gỡ quản trị." />
        </div>
      )}
    </Sheet>
  )
}

function InvitesSheet({ org, onClose }: { org: OrgDetail; onClose: () => void }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['org', org.id, 'invites'], queryFn: () => listPendingInvites(org.id) })
  const del = useMutation({
    mutationFn: (email: string) => deletePendingInvite(org.id, email),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['org', org.id] }),
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  return (
    <Sheet open onClose={onClose} title="Lời mời chờ" description="Người trong danh sách nhập nhưng chưa có tài khoản RaceHub. Gửi họ link mời — khi vào sẽ tự được duyệt.">
      {q.isPending ? <Skeleton className="h-32" /> : !q.data?.length ? <p className="text-sm text-fg-muted">Không có lời mời chờ.</p> : (
        <ul className="divide-y divide-border rounded-xl border border-border text-sm">
          {q.data.map((i) => (
            <li key={i.email} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1"><span className="block truncate">{i.email}</span>
                <span className="block truncate text-xs text-fg-subtle">{[i.unit_name, i.employee_code, i.role === 'UNIT_ADMIN' ? 'Trưởng đơn vị' : null].filter(Boolean).join(' · ') || '—'}</span></span>
              <Button size="sm" variant="ghost" aria-label={`Xoá ${i.email}`} onClick={() => del.mutate(i.email)}><Trash2 className="size-4" aria-hidden /></Button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}
