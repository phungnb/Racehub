'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, FlaskConical, Phone, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, EmptyState, ErrorState, Field, Input, SegmentedControl, Sheet, Skeleton, SwitchRow } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { adminCreateDemoOrg, adminDeleteDemoOrg, isDemoOrg, adminCreateOrg, adminListOrgs, adminOrgLeads, adminSetOrgLead, adminUpdateOrg, orgErrorMessage, type AdminOrg, type OrgKind, type OrgLead } from '../../api/orgApi'
import { KIND_LABEL, fmtDay, toDayInput, vnDayStart } from '../../model/org'

const LEAD_STATUS: Record<OrgLead['status'], { label: string; cls: string }> = {
  NEW: { label: 'Mới', cls: 'bg-danger/15 text-danger' }, CONTACTED: { label: 'Đã liên hệ', cls: 'bg-coin/15 text-coin' },
  WON: { label: 'Đã ký', cls: 'bg-brand/15 text-brand' }, LOST: { label: 'Không thành', cls: 'bg-surface-2 text-fg-muted' },
}

/** Quản trị → Doanh nghiệp: yêu cầu báo giá + tổ chức đang dùng gói (tạo / gia hạn / số chỗ / tài trợ CLB Pro) */
export function EnterpriseAdminTab() {
  const [view, setView] = useState<'leads' | 'orgs'>('leads')
  const [create, setCreate] = useState<OrgLead | 'blank' | null>(null)
  const [demo, setDemo] = useState(false)
  return (
    <div className="space-y-3">
      <HowItWorks />
      <div className="flex items-center gap-2">
        <SegmentedControl className="flex-1" value={view} onChange={setView} options={[{ value: 'leads', label: 'Yêu cầu báo giá' }, { value: 'orgs', label: 'Tổ chức' }]} />
        <Button className="shrink-0" variant="secondary" onClick={() => setDemo(true)}><FlaskConical className="size-4" aria-hidden />Demo</Button>
        <Button className="shrink-0" onClick={() => setCreate('blank')}><Plus className="size-4" aria-hidden />Tạo</Button>
      </div>
      {view === 'leads' ? <Leads onCreate={setCreate} /> : <Orgs />}
      <p className="text-xs text-fg-subtle">Trang giới thiệu gửi khách: <Link className="text-brand" href={routes.enterprise}>{routes.enterprise}</Link></p>
      {create && <CreateOrgSheet lead={create === 'blank' ? null : create} onClose={() => setCreate(null)} />}
      {demo && <DemoSheet onClose={() => setDemo(false)} onCreated={() => setView('orgs')} />}
    </div>
  )
}

/** Sơ đồ cấu trúc gói Doanh nghiệp — để admin (và khách khi demo) hình dung ai làm gì */
function HowItWorks() {
  return (
    <details className="rounded-2xl border border-border bg-surface p-3 text-sm [&_li]:ml-4 [&_li]:list-disc">
      <summary className="cursor-pointer font-semibold">Cấu trúc gói Doanh nghiệp — ai làm gì?</summary>
      <div className="mt-2 space-y-2 text-fg-muted">
        <p><b className="text-fg">1. Admin RaceHub</b> (tab này): nhận yêu cầu báo giá → ký hợp đồng → <b>Tạo</b> tổ chức (số chỗ, số CLB, hạn, tài trợ Pro) → gia hạn / tạm dừng. Nút <b>Demo</b> tạo tổ chức mẫu để xem thử hoặc đưa khách dùng thử.</p>
        <p><b className="text-fg">2. Chủ / quản trị viên tổ chức</b> (khách hàng) vào menu ☰ → Tổ chức của tôi → tổ chức:</p>
        <ul>
          <li><b>Chiến dịch</b>: tạo chiến dịch (km / số buổi / số ngày), trần km/ngày, ngày hội ×2, chứng nhận, chốt kết quả, duyệt top, quay thưởng.</li>
          <li><b>Thành viên</b>: duyệt người vào, nhập danh sách Excel, gán đơn vị, mã nhân viên, phân quyền.</li>
          <li><b>Đơn vị</b>: phòng ban / chi nhánh / lớp nhiều cấp, trưởng đơn vị.</li>
          <li><b>Báo cáo</b>: km, buổi, ngày chạy từng người theo khoảng ngày, xuất Excel.</li>
          <li><b>Cài đặt</b>: logo, ảnh bìa, email công ty tự duyệt, chế độ riêng tư, mã mời, CLB thành viên.</li>
        </ul>
        <p><b className="text-fg">3. Trưởng đơn vị</b>: quản lý người trong đơn vị mình. <b className="text-fg">4. Nhân viên</b>: nhập mã mời → chạy như bình thường → bài tự tính vào chiến dịch, xem BXH, bảng tin.</p>
      </div>
    </details>
  )
}

function DemoSheet({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ kind: 'COMPANY' as OrgKind, name: '', guest_email: '', days: '14' })
  const [done, setDone] = useState<{ id: string; invite_code: string } | null>(null)
  const create = useMutation({
    mutationFn: () => adminCreateDemoOrg({ kind: f.kind, name: f.name.trim() || undefined, guest_email: f.guest_email.trim() || undefined, days: Number(f.days) || 14 }),
    onSuccess: (r) => { setDone(r); void qc.invalidateQueries({ queryKey: ['admin', 'orgs'] }); void qc.invalidateQueries({ queryKey: ['orgs'] }); onCreated() },
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  if (done) {
    return (
      <Sheet open onClose={onClose} title="Đã tạo tổ chức demo"
        footer={<Link href={routes.org(done.id)} className="flex h-12 items-center justify-center rounded-2xl bg-brand font-bold text-brand-fg">Mở tổ chức demo</Link>}>
        <div className="space-y-2 text-sm">
          <p>Bạn là <b>chủ tổ chức</b>{f.guest_email.trim() ? <>, khách <b>{f.guest_email.trim()}</b> là <b>quản trị viên</b> và đã được báo</> : null}.</p>
          <p>Mã mời để người khác vào thử: <span className="rounded bg-surface-2 px-2 py-0.5 font-mono font-bold tracking-widest">{done.invite_code}</span></p>
          <p className="text-fg-muted">Có sẵn đơn vị nhiều cấp, một chiến dịch đang chạy và bảng tin. Demo tự hết hạn sau {f.days} ngày; xoá ở danh sách Tổ chức.</p>
        </div>
      </Sheet>
    )
  }
  return (
    <Sheet open onClose={onClose} title="Tạo tổ chức demo" description="Tổ chức mẫu có sẵn dữ liệu để bạn xem cấu trúc quản lý, hoặc cho khách dùng thử trước khi ký."
      footer={<Button block loading={create.isPending} onClick={() => create.mutate()}>Tạo demo</Button>}>
      <div className="space-y-3">
        <Field label="Loại hình" htmlFor="ad-kind">
          <select id="ad-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as OrgKind })} className="h-11 w-full rounded-xl border border-border bg-surface px-3">
            <option value="COMPANY">Doanh nghiệp (phòng ban)</option>
            <option value="SCHOOL">Trường học (khối, lớp)</option>
            <option value="FEDERATION">Liên đoàn (khu vực, nhiều CLB)</option>
          </select>
        </Field>
        <Field label="Tên hiển thị (tuỳ chọn)" htmlFor="ad-name"><Input id="ad-name" value={f.name} maxLength={100} placeholder="VD: Công ty ABC" onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Email khách dùng thử (tuỳ chọn)" htmlFor="ad-guest" hint="Khách phải đăng ký RaceHub trước; sẽ là quản trị viên tổ chức demo.">
          <Input id="ad-guest" type="email" value={f.guest_email} onChange={(e) => setF({ ...f, guest_email: e.target.value })} />
        </Field>
        <Field label="Số ngày dùng thử" htmlFor="ad-days"><Input id="ad-days" inputMode="numeric" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value.replace(/\D/g, '').slice(0, 2) })} /></Field>
      </div>
    </Sheet>
  )
}

function Leads({ onCreate }: { onCreate: (l: OrgLead) => void }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin', 'org-leads'], queryFn: () => adminOrgLeads() })
  const set = useMutation({
    mutationFn: ({ id, status }: { id: string; status: OrgLead['status'] }) => adminSetOrgLead(id, status),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'org-leads'] }),
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  if (q.isPending) return <Skeleton className="h-40" />
  if (q.isError) return <ErrorState message={orgErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data.length) return <EmptyState icon={Building2} title="Chưa có yêu cầu" description="Khách gửi ở trang /doanh-nghiep sẽ hiện ở đây kèm thông báo cho admin." />
  return (
    <ul className="space-y-2">
      {q.data.map((l) => (
        <li key={l.id}><Card className="space-y-2">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{l.org_name}</p>
              <p className="text-xs text-fg-muted">{KIND_LABEL[l.kind]}{l.size ? ` · ~${l.size} người` : ''} · {new Date(l.created_at).toLocaleString('vi-VN')}</p>
            </div>
            <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', LEAD_STATUS[l.status].cls)}>{LEAD_STATUS[l.status].label}</span>
          </div>
          <p className="text-sm">{l.contact_name} · <a className="inline-flex items-center gap-1 font-semibold text-brand" href={`tel:${l.phone.replace(/[^0-9+]/g, '')}`}><Phone className="size-3.5" aria-hidden />{l.phone}</a>
            {l.email && <> · <a className="text-brand" href={`mailto:${l.email}`}>{l.email}</a></>}</p>
          {l.note && <p className="whitespace-pre-line rounded-xl bg-surface-2 p-2 text-sm text-fg-muted">{l.note}</p>}
          {l.org_name_linked && <p className="text-xs text-brand">Đã tạo tổ chức: {l.org_name_linked}</p>}
          <div className="flex flex-wrap gap-1.5">
            {(['CONTACTED', 'LOST'] as const).filter((s) => s !== l.status).map((s) => (
              <Button key={s} size="sm" variant="secondary" onClick={() => set.mutate({ id: l.id, status: s })}>{LEAD_STATUS[s].label}</Button>
            ))}
            {!l.org_id && <Button size="sm" onClick={() => onCreate(l)}>Tạo tổ chức</Button>}
          </div>
        </Card></li>
      ))}
    </ul>
  )
}

function Orgs() {
  const q = useQuery({ queryKey: ['admin', 'orgs'], queryFn: adminListOrgs })
  const [edit, setEdit] = useState<AdminOrg | null>(null)
  if (q.isPending) return <Skeleton className="h-40" />
  if (q.isError) return <ErrorState message={orgErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data.length) return <EmptyState icon={Building2} title="Chưa có tổ chức" description="Tạo tổ chức sau khi ký hợp đồng với khách." />
  return (
    <ul className="space-y-2">
      {q.data.map((o) => (
        <li key={o.id}><Card className="space-y-1.5">
          <div className="flex items-start gap-2">
            <Link href={routes.org(o.id)} className="min-w-0 flex-1">
              <p className="truncate font-semibold">{o.name}</p>
              <p className="text-xs text-fg-muted">{KIND_LABEL[o.kind]} · chủ: {o.owner_name ?? '—'}</p>
            </Link>
            <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', o.active ? 'bg-brand/15 text-brand' : 'bg-danger/15 text-danger')}>
              {o.active ? 'Hiệu lực' : o.status === 'SUSPENDED' ? 'Tạm dừng' : 'Hết hạn'}
            </span>
          </div>
          <p className="text-sm">{o.seats_used}/{o.seat_limit} chỗ · {o.club_count}/{o.club_limit} CLB{o.include_club_pro ? ' · tài trợ Pro' : ''} · {o.active_until ? `hạn ${fmtDay(o.active_until)}` : 'không thời hạn'}</p>
          {(o.legal_name || o.tax_code) && <p className="text-xs text-fg-subtle">{[o.legal_name, o.tax_code && `MST ${o.tax_code}`].filter(Boolean).join(' · ')}</p>}
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => setEdit(o)}>Gia hạn / sửa gói</Button>
            {isDemoOrg(o.name) && <DeleteDemo org={o} />}
          </div>
        </Card></li>
      ))}
      {edit && <EditOrgSheet org={edit} onClose={() => setEdit(null)} />}
    </ul>
  )
}

function DeleteDemo({ org }: { org: AdminOrg }) {
  const qc = useQueryClient()
  const del = useMutation({
    mutationFn: () => adminDeleteDemoOrg(org.id),
    onSuccess: () => { toast.success('Đã xoá tổ chức demo'); void qc.invalidateQueries({ queryKey: ['admin', 'orgs'] }); void qc.invalidateQueries({ queryKey: ['orgs'] }) },
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  return (
    <Button size="sm" variant="secondary" loading={del.isPending}
      onClick={() => { if (window.confirm(`Xoá hẳn "${org.name}" và toàn bộ dữ liệu mẫu?`)) del.mutate() }}>
      <Trash2 className="size-4" aria-hidden />Xoá demo
    </Button>
  )
}

const plusYear = () => toDayInput(new Date(Date.now() + 365 * 86400_000).toISOString())

function CreateOrgSheet({ lead, onClose }: { lead: OrgLead | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ name: lead?.org_name ?? '', kind: (lead?.kind ?? 'COMPANY') as OrgKind, owner_email: lead?.email ?? '',
    seat_limit: String(Math.max(lead?.size ?? 50, 2)), club_limit: lead?.kind === 'FEDERATION' ? '20' : '0', include_club_pro: lead?.kind === 'FEDERATION',
    until: plusYear(), contact_name: lead?.contact_name ?? '', contact_phone: lead?.phone ?? '', legal_name: '', tax_code: '' })
  const create = useMutation({
    mutationFn: () => adminCreateOrg({ name: f.name.trim(), kind: f.kind, owner_email: f.owner_email.trim(), seat_limit: Number(f.seat_limit),
      club_limit: Number(f.club_limit || 0), include_club_pro: f.include_club_pro, active_until: f.until ? vnDayStart(f.until) : null,
      contact_name: f.contact_name, contact_phone: f.contact_phone, contact_email: f.owner_email, legal_name: f.legal_name, tax_code: f.tax_code, lead_id: lead?.id ?? null }),
    onSuccess: (r) => { toast.success(`Đã tạo tổ chức · mã mời ${r.invite_code}`); void qc.invalidateQueries({ queryKey: ['admin'] }); onClose() },
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  const valid = f.name.trim().length >= 2 && /@/.test(f.owner_email) && Number(f.seat_limit) >= 2
  return (
    <Sheet open onClose={onClose} title="Tạo tổ chức theo hợp đồng" description="Người quản trị cần có tài khoản RaceHub với email bên dưới."
      footer={<Button block loading={create.isPending} disabled={!valid} onClick={() => create.mutate()}>Tạo tổ chức</Button>}>
      <div className="space-y-3">
        <Field label="Tên tổ chức" htmlFor="ao-name"><Input id="ao-name" value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Loại hình" htmlFor="ao-kind">
          <select id="ao-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as OrgKind })} className="h-11 w-full rounded-xl border border-border bg-surface px-3">
            {(Object.keys(KIND_LABEL) as OrgKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label="Email tài khoản quản trị tổ chức" htmlFor="ao-owner"><Input id="ao-owner" type="email" value={f.owner_email} onChange={(e) => setF({ ...f, owner_email: e.target.value })} /></Field>
        <PlanFields f={f} setF={(p) => setF({ ...f, ...p })} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tên pháp nhân" htmlFor="ao-legal"><Input id="ao-legal" value={f.legal_name} onChange={(e) => setF({ ...f, legal_name: e.target.value })} /></Field>
          <Field label="Mã số thuế" htmlFor="ao-tax"><Input id="ao-tax" value={f.tax_code} onChange={(e) => setF({ ...f, tax_code: e.target.value })} /></Field>
        </div>
      </div>
    </Sheet>
  )
}

type PlanF = { seat_limit: string; club_limit: string; include_club_pro: boolean; until: string }
function PlanFields({ f, setF }: { f: PlanF; setF: (p: Partial<PlanF>) => void }) {
  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Số chỗ" htmlFor="ap-seat"><Input id="ap-seat" inputMode="numeric" value={f.seat_limit} onChange={(e) => setF({ seat_limit: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="Số CLB" htmlFor="ap-club"><Input id="ap-club" inputMode="numeric" value={f.club_limit} onChange={(e) => setF({ club_limit: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="Hết hạn" htmlFor="ap-until"><Input id="ap-until" type="date" value={f.until} onChange={(e) => setF({ until: e.target.value })} /></Field>
      </div>
      <SwitchRow checked={f.include_club_pro} onChange={(v) => setF({ include_club_pro: v })} label="Tài trợ CLB Pro" description="CLB thuộc tổ chức tự lên Pro tới hết hạn hợp đồng" />
    </>
  )
}

function EditOrgSheet({ org, onClose }: { org: AdminOrg; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState<PlanF>({ seat_limit: String(org.seat_limit), club_limit: String(org.club_limit), include_club_pro: org.include_club_pro,
    until: org.active_until ? toDayInput(org.active_until) : '' })
  const [status, setStatus] = useState(org.status)
  const [reason, setReason] = useState('')
  const save = useMutation({
    mutationFn: () => adminUpdateOrg(org.id, { seat_limit: Number(f.seat_limit), club_limit: Number(f.club_limit || 0), include_club_pro: f.include_club_pro,
      active_until: f.until ? vnDayStart(f.until) : null, status }, reason),
    onSuccess: () => { toast.success('Đã cập nhật gói'); void qc.invalidateQueries({ queryKey: ['admin', 'orgs'] }); onClose() },
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  return (
    <Sheet open onClose={onClose} title={org.name} description="Để trống ngày hết hạn = không thời hạn. Mọi thay đổi ghi nhật ký."
      footer={<Button block loading={save.isPending} disabled={reason.trim().length < 3 || Number(f.seat_limit) < 2} onClick={() => save.mutate()}>Lưu</Button>}>
      <div className="space-y-3">
        <PlanFields f={f} setF={(p) => setF({ ...f, ...p })} />
        <SwitchRow checked={status === 'SUSPENDED'} onChange={(v) => setStatus(v ? 'SUSPENDED' : 'ACTIVE')} label="Tạm dừng tổ chức" description="VD: chưa thanh toán. Số liệu được giữ nguyên." />
        <Field label="Lý do (ghi nhật ký)" htmlFor="ae-reason"><Input id="ae-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Gia hạn HĐ số 12/2026" /></Field>
      </div>
    </Sheet>
  )
}

