'use client'

import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, ImagePlus, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, ConfirmSheet, Field, Input, SectionTitle, SwitchRow, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { CLUB_THEMES } from '@/features/club'
import { orgErrorMessage, rotateOrgInvite, updateOrg, uploadOrgImage, type OrgDetail, type OrgTheme } from '../../api/orgApi'
import { routes } from '@/shared/config/routes'
import { KIND_LABEL, fmtDay } from '../../model/org'
import { OrgHeader } from '../OrgHeader'

/** Cài đặt tổ chức: thương hiệu, cách nhận thành viên, mã mời, thông tin xuất hoá đơn */
export function SettingsTab({ org }: { org: OrgDetail }) {
  const qc = useQueryClient()
  const refresh = () => void qc.invalidateQueries({ queryKey: ['org', org.id] })
  return (
    <div className="space-y-6">
      <InviteCard org={org} onChange={refresh} />
      <BrandCard org={org} onSaved={refresh} />
      <PolicyCard org={org} onSaved={refresh} />
      <DomainCard org={org} onSaved={refresh} />
      <BillingCard org={org} onSaved={refresh} />
      <Card className="space-y-1 text-sm">
        <p className="font-semibold">Gói Doanh nghiệp</p>
        <p className="text-fg-muted">{KIND_LABEL[org.kind]} · {org.seat_limit} chỗ · {org.club_limit} CLB{org.include_club_pro ? ' · tài trợ CLB Pro' : ''}</p>
        <p className="text-fg-muted">{org.active_until ? `Hiệu lực đến ${fmtDay(org.active_until)}` : 'Không thời hạn'}{org.status === 'SUSPENDED' ? ' · đang tạm dừng' : ''}</p>
        <p className="text-xs text-fg-subtle">Cần thêm chỗ / gia hạn: liên hệ RaceHub, số liệu hiện có được giữ nguyên.</p>
      </Card>
    </div>
  )
}

function InviteCard({ org, onChange }: { org: OrgDetail; onChange: () => void }) {
  const [rotate, setRotate] = useState(false)
  const [copied, setCopied] = useState(false)
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const link = org.invite_code ? `${origin}${routes.orgJoin(org.invite_code)}` : ''
  const rot = useMutation({
    mutationFn: () => rotateOrgInvite(org.id),
    onSuccess: () => { setRotate(false); toast.success('Đã đổi mã mời — mã cũ hết hiệu lực'); onChange() },
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { toast.error('Không sao chép được') }
  }
  return (
    <section className="space-y-2">
      <SectionTitle>Mời thành viên</SectionTitle>
      <Card className="space-y-3">
        <p className="text-center font-mono text-3xl font-extrabold tracking-[0.3em]">{org.invite_code}</p>
        <p className="break-all rounded-xl bg-surface-2 p-2 text-center text-xs text-fg-muted">{link}</p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={copy}>{copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}{copied ? 'Đã chép' : 'Chép link'}</Button>
          <Button variant="ghost" onClick={() => setRotate(true)}><RefreshCw className="size-4" aria-hidden />Đổi mã</Button>
        </div>
        <p className="text-xs text-fg-subtle">Gửi link qua email nội bộ, Zalo nhóm công ty… {org.join_policy === 'OPEN' ? 'Người có link vào ngay (trong số chỗ).' : 'Người có link gửi yêu cầu, bạn duyệt ở tab Thành viên.'}</p>
      </Card>
      <ConfirmSheet open={rotate} onClose={() => setRotate(false)} title="Đổi mã mời?" description="Link cũ không dùng được nữa. Thành viên hiện tại không bị ảnh hưởng."
        danger={false} confirmLabel="Đổi mã" loading={rot.isPending} onConfirm={() => rot.mutate()} />
    </section>
  )
}

function BrandCard({ org, onSaved }: { org: OrgDetail; onSaved: () => void }) {
  const [f, setF] = useState({ name: org.name, tagline: org.tagline ?? '', description: org.description ?? '', logo_url: org.logo_url,
    cover_url: org.cover_url, cover_position: org.cover_position, theme: org.theme })
  const logo = useRef<HTMLInputElement>(null)
  const cover = useRef<HTMLInputElement>(null)
  const upload = useMutation({
    mutationFn: ({ file, kind }: { file: File; kind: 'logo' | 'cover' }) => uploadOrgImage(org.id, file, kind).then((url) => ({ url, kind })),
    onSuccess: ({ url, kind }) => setF((x) => (kind === 'logo' ? { ...x, logo_url: url } : { ...x, cover_url: url, cover_position: 50 })),
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  const save = useMutation({
    mutationFn: () => updateOrg(org.id, { ...f, tagline: f.tagline.trim() || null, description: f.description.trim() || null }),
    onSuccess: () => { toast.success('Đã lưu thương hiệu'); onSaved() },
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  const pick = (kind: 'logo' | 'cover') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = ''; if (file) upload.mutate({ file, kind })
  }
  return (
    <section className="space-y-2">
      <SectionTitle>Thương hiệu</SectionTitle>
      <OrgHeader org={{ ...org, ...f, tagline: f.tagline.trim() || null }} />
      <Card className="space-y-3">
        <input ref={logo} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pick('logo')} />
        <input ref={cover} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pick('cover')} />
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" loading={upload.isPending && upload.variables?.kind === 'logo'} onClick={() => logo.current?.click()}><ImagePlus className="size-4" aria-hidden />Logo</Button>
          <Button variant="secondary" loading={upload.isPending && upload.variables?.kind === 'cover'} onClick={() => cover.current?.click()}><ImagePlus className="size-4" aria-hidden />Ảnh bìa</Button>
        </div>
        {f.cover_url && (
          <div className="flex items-center gap-2">
            <label className="flex-1 text-xs text-fg-muted">Vị trí ảnh bìa
              <input type="range" min={0} max={100} value={f.cover_position} onChange={(e) => setF({ ...f, cover_position: Number(e.target.value) })} className="mt-1 w-full accent-brand" />
            </label>
            <Button size="sm" variant="ghost" aria-label="Bỏ ảnh bìa" onClick={() => setF({ ...f, cover_url: null })}><Trash2 className="size-4" aria-hidden /></Button>
          </div>
        )}
        <Field label="Tên hiển thị" htmlFor="o-name"><Input id="o-name" value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Khẩu hiệu" htmlFor="o-tag" hint={`${f.tagline.length}/80`}><Input id="o-tag" value={f.tagline} maxLength={80} onChange={(e) => setF({ ...f, tagline: e.target.value })} placeholder="Khoẻ để cống hiến" /></Field>
        <Field label="Giới thiệu" htmlFor="o-desc"><Textarea id="o-desc" value={f.description} maxLength={2000} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div>
          <p className="mb-1.5 text-xs text-fg-muted">Chủ đề màu</p>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(CLUB_THEMES) as OrgTheme[]).map((k) => (
              <button key={k} type="button" aria-pressed={f.theme === k} onClick={() => setF({ ...f, theme: f.theme === k ? null : k })}
                className={cn('relative h-12 overflow-hidden rounded-xl border-2 text-left', f.theme === k ? 'border-coin' : 'border-transparent')}
                style={{ background: CLUB_THEMES[k].bg }}>
                <span className="absolute bottom-1 left-2 text-[11px] font-semibold text-white drop-shadow">{CLUB_THEMES[k].label}</span>
              </button>
            ))}
          </div>
        </div>
        <Button block loading={save.isPending} disabled={upload.isPending || f.name.trim().length < 2} onClick={() => save.mutate()}>Lưu thương hiệu</Button>
      </Card>
    </section>
  )
}

function PolicyCard({ org, onSaved }: { org: OrgDetail; onSaved: () => void }) {
  const [label, setLabel] = useState(org.unit_label)
  const save = useMutation({
    mutationFn: (p: Parameters<typeof updateOrg>[1]) => updateOrg(org.id, p),
    onSuccess: () => { toast.success('Đã lưu'); onSaved() },
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  return (
    <section className="space-y-2">
      <SectionTitle>Nhận thành viên</SectionTitle>
      <Card className="space-y-3">
        <SwitchRow checked={org.join_policy === 'OPEN'} onChange={(v) => save.mutate({ join_policy: v ? 'OPEN' : 'APPROVAL' })} disabled={save.isPending}
          label="Tự duyệt khi có mã mời" description="Tắt: mỗi người gửi yêu cầu, quản trị duyệt từng người." />
        <SwitchRow checked={org.allow_self_unit} onChange={(v) => save.mutate({ allow_self_unit: v })} disabled={save.isPending}
          label={`Thành viên tự chọn ${org.unit_label.toLowerCase()}`} description="Tắt: chỉ quản trị gán đơn vị." />
        <SwitchRow checked={org.privacy_mode} onChange={(v) => save.mutate({ privacy_mode: v })} disabled={save.isPending}
          label="Chế độ riêng tư" description="Thành viên chỉ thấy BXH theo đơn vị và thứ hạng của chính mình, không thấy tên người khác. Quản trị vẫn xem đủ để trao giải." />
        <SwitchRow checked={org.member_posts} onChange={(v) => save.mutate({ member_posts: v })} disabled={save.isPending}
          label="Thành viên được đăng bài lên bảng tin" description="Tắt: chỉ quản trị và trưởng đơn vị đăng." />
        <div className="flex items-end gap-2">
          <Field label="Tên gọi đơn vị" htmlFor="o-unit" hint="VD: Phòng ban, Chi nhánh, Lớp, Khoa">
            <Input id="o-unit" value={label} maxLength={30} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <Button className="mb-0.5 shrink-0" variant="secondary" disabled={label.trim() === org.unit_label || label.trim().length < 2}
            onClick={() => save.mutate({ unit_label: label.trim() })}>Lưu</Button>
        </div>
      </Card>
    </section>
  )
}

function BillingCard({ org, onSaved }: { org: OrgDetail; onSaved: () => void }) {
  const b = org.billing
  const [f, setF] = useState({ legal_name: b?.legal_name ?? '', tax_code: b?.tax_code ?? '', contact_name: b?.contact_name ?? '',
    contact_phone: b?.contact_phone ?? '', contact_email: b?.contact_email ?? '' })
  const save = useMutation({
    mutationFn: () => updateOrg(org.id, f),
    onSuccess: () => { toast.success('Đã lưu thông tin xuất hoá đơn'); onSaved() },
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  const fields: [keyof typeof f, string, number][] = [['legal_name', 'Tên pháp nhân', 200], ['tax_code', 'Mã số thuế', 20],
    ['contact_name', 'Người liên hệ', 80], ['contact_phone', 'Điện thoại', 20], ['contact_email', 'Email nhận hoá đơn', 120]]
  return (
    <section className="space-y-2">
      <SectionTitle>Xuất hoá đơn</SectionTitle>
      <Card className="space-y-3">
        {fields.map(([k, l, max]) => (
          <Field key={k} label={l} htmlFor={`b-${k}`}><Input id={`b-${k}`} value={f[k]} maxLength={max} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
        ))}
        <Button block variant="secondary" loading={save.isPending} onClick={() => save.mutate()}>Lưu</Button>
        <p className="text-xs text-fg-subtle">Chỉ quản trị tổ chức và RaceHub thấy thông tin này.</p>
      </Card>
    </section>
  )
}

/** Tên miền email công ty: tự duyệt / chỉ nhận email công ty (008400) */
function DomainCard({ org, onSaved }: { org: OrgDetail; onSaved: () => void }) {
  const [text, setText] = useState(org.email_domains.join(', '))
  const [auto, setAuto] = useState(org.domain_auto_approve)
  const [only, setOnly] = useState(org.domain_only)
  const domains = text.split(/[\s,;]+/).map((d) => d.trim().replace(/^@/, '').toLowerCase()).filter(Boolean)
  const dirty = domains.join(',') !== org.email_domains.join(',') || auto !== org.domain_auto_approve || only !== org.domain_only
  const save = useMutation({
    mutationFn: () => updateOrg(org.id, { email_domains: domains, domain_auto_approve: auto, domain_only: only }),
    onSuccess: () => { toast.success('Đã lưu tên miền'); onSaved() },
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  return (
    <section className="space-y-2">
      <SectionTitle>Email công ty</SectionTitle>
      <Card className="space-y-3">
        <Field label="Tên miền email" htmlFor="o-dom" hint="Cách nhau bằng dấu phẩy, vd: congty.vn, congty.com.vn">
          <Input id="o-dom" value={text} onChange={(e) => setText(e.target.value)} placeholder="congty.vn" autoCapitalize="none" />
        </Field>
        <SwitchRow checked={auto} onChange={setAuto} label="Tự duyệt email công ty" description="Người đăng nhập bằng email đúng tên miền vào ngay, không cần chờ duyệt." />
        <SwitchRow checked={only} onChange={setOnly} label="Chỉ nhận email công ty" description="Người dùng email khác (gmail…) không vào được, trừ người có trong danh sách nhập." />
        <Button block variant="secondary" disabled={!dirty || (only && !domains.length)} loading={save.isPending} onClick={() => save.mutate()}>Lưu</Button>
      </Card>
    </section>
  )
}
