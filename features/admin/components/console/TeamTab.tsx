'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Crown, KeyRound, ShieldCheck, ShieldOff, SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Card, ConfirmSheet, ErrorState, Field, Input, Sheet, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import {
  ADMIN_SCOPES, adminSetPermissions, adminSetUserRole, adminTeam, consoleErrorMessage, type AdminScope, type AdminTeam, type TeamMember,
} from '../../api/consoleApi'

export const teamKey = ['admin', 'team'] as const
export function useAdminTeam() {
  return useQuery({ queryKey: teamKey, queryFn: adminTeam, retry: false, staleTime: 60_000 })
}

const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }) : '—')
const SCOPES = Object.keys(ADMIN_SCOPES) as AdminScope[]
const OWNER_SQL = "select private.admin_set_owner('email-cua-ban@...');"

/** Đội quản trị: Quản trị chính (giữ key hệ thống) phân quyền từng admin theo nhóm; mọi admin xem được danh sách (minh bạch) */
export function TeamTab() {
  const q = useAdminTeam()
  const [edit, setEdit] = useState<TeamMember | null>(null)
  const [revoke, setRevoke] = useState<TeamMember | null>(null)
  if (q.isPending) return <Skeleton className="h-64" />
  if (q.isError) return <ErrorState message={consoleErrorMessage(q.error, 'Không tải được đội quản trị — hãy chạy migration 011800.')} error={q.error} onRetry={() => void q.refetch()} />
  const t = q.data
  const owner = t.me.is_owner
  return (
    <div className="space-y-3">
      {!t.owner_exists && <OwnerSetup />}
      <Card className="space-y-1.5 text-sm">
        <p className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-4 text-brand" aria-hidden />Quy định quản trị</p>
        <ul className="list-disc space-y-1 pl-5 text-fg-muted">
          <li><b>Quản trị chính</b> giữ key hệ thống: toàn quyền, là người duy nhất cấp / gỡ / phân quyền admin. Chỉ đặt hoặc đổi được trong Supabase SQL Editor — không ai trong app (kể cả admin) tác động được.</li>
          <li><b>Admin thường</b> chỉ làm được các nhóm quyền được giao, có thể đặt hạn dùng; không cấp quyền, không gỡ quyền, không khóa được admin khác.</li>
          <li>Mọi thao tác ghi vào nhật ký không sửa / xóa được; Quản trị chính nhận thông báo mỗi khi đội quản trị thay đổi.</li>
        </ul>
        <p className="pt-1 text-xs text-fg-subtle">Bạn: {owner ? 'Quản trị chính' : t.me.legacy ? 'admin cũ — đang toàn quyền cho tới khi Quản trị chính phân quyền lại' : `admin · ${t.me.scopes.map((s) => ADMIN_SCOPES[s]?.label ?? s).join(', ') || 'chưa có nhóm quyền'}`}
          {t.me.expires_at ? ` · hết hạn ${fmt(t.me.expires_at)}` : ''}</p>
      </Card>

      <Card className="space-y-2">
        <p className="font-semibold">Đội quản trị ({t.admins.length})</p>
        <ul className="divide-y divide-border">
          {t.admins.map((a) => (
            <li key={a.id} className="space-y-1.5 py-2.5">
              <div className="flex items-center gap-3">
                <Avatar src={a.avatar_url} name={a.display_name} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">{a.display_name ?? 'Chưa đặt tên'}{a.is_me ? ' (bạn)' : ''}
                    {a.is_owner && <Tag tone="coin"><Crown className="size-3" aria-hidden />Quản trị chính</Tag>}
                    {!a.email && <Tag tone="warning">không đăng nhập được</Tag>}
                    {a.expired && <Tag tone="danger">hết hạn</Tag>}
                    {a.legacy && !a.is_owner && <Tag tone="muted">chưa phân quyền</Tag>}
                  </span>
                  <span className="block truncate text-xs text-fg-muted">{a.email ?? '—'} · đăng nhập {fmt(a.last_sign_in_at)}{a.expires_at && !a.expired ? ` · hết hạn ${fmt(a.expires_at)}` : ''}</span>
                </span>
              </div>
              <div className="flex flex-wrap gap-1 pl-11">
                {a.is_owner ? <Tag tone="coin">Toàn quyền</Tag>
                  : a.scopes.length ? a.scopes.map((s) => <Tag key={s} tone="brand">{ADMIN_SCOPES[s]?.label ?? s}</Tag>)
                  : <span className="text-xs text-fg-subtle">Chưa có nhóm quyền nào</span>}
                {a.note && <span className="w-full text-xs text-fg-subtle">Ghi chú: {a.note}</span>}
              </div>
              {owner && !a.is_owner && !a.is_me && (
                <div className="flex gap-2 pl-11">
                  <Button size="sm" variant="secondary" onClick={() => setEdit(a)}><SlidersHorizontal className="size-4" aria-hidden />Phân quyền</Button>
                  <Button size="sm" variant="ghost" onClick={() => setRevoke(a)}><ShieldOff className="size-4" aria-hidden />Gỡ quyền</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {owner ? <AddAdmin team={t} onAdded={(m) => setEdit(m)} />
          : <p className="text-xs text-fg-subtle">Chỉ Quản trị chính thêm / gỡ / phân quyền admin.</p>}
      </Card>

      {edit && <ScopeSheet member={edit} onClose={() => setEdit(null)} />}
      {revoke && <RevokeSheet member={revoke} onClose={() => setRevoke(null)} />}
    </div>
  )
}

function Tag({ tone, children }: { tone: 'coin' | 'warning' | 'danger' | 'muted' | 'brand'; children: React.ReactNode }) {
  const cls = { coin: 'bg-coin/15 text-coin', warning: 'bg-warning/15 text-warning', danger: 'bg-danger/15 text-danger', muted: 'bg-surface-2 text-fg-muted', brand: 'bg-brand/15 text-brand' }[tone]
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold', cls)}>{children}</span>
}

/** Chưa có Quản trị chính: hướng dẫn người giữ key hệ thống tự đặt trong SQL Editor */
function OwnerSetup() {
  return (
    <Card className="space-y-2 border-warning/50 bg-warning/5 text-sm">
      <p className="flex items-center gap-2 font-semibold"><KeyRound className="size-4 text-warning" aria-hidden />Chưa có Quản trị chính</p>
      <p className="text-fg-muted">Trong lúc này không ai cấp / gỡ quyền admin được. Người giữ key hệ thống mở <b>Supabase → SQL Editor</b> và chạy (thay bằng email đăng nhập của mình):</p>
      <div className="flex items-center gap-2 rounded-lg bg-surface-2 p-2">
        <code className="min-w-0 flex-1 break-all font-mono text-xs">{OWNER_SQL}</code>
        <Button size="sm" variant="ghost" aria-label="Sao chép lệnh" onClick={() => void navigator.clipboard?.writeText(OWNER_SQL).then(() => toast('Đã sao chép'))}><Copy className="size-4" aria-hidden /></Button>
      </div>
      <p className="text-xs text-fg-subtle">Nên có 1 Quản trị chính + 1 tài khoản dự phòng (tối đa 3). Bỏ Quản trị chính: <code className="font-mono">select private.admin_set_owner(&apos;email&apos;, false);</code></p>
    </Card>
  )
}

function ScopeSheet({ member, onClose }: { member: TeamMember; onClose: () => void }) {
  const qc = useQueryClient()
  const [scopes, setScopes] = useState<AdminScope[]>(member.legacy ? [] : member.scopes)
  const [until, setUntil] = useState(member.expires_at ? member.expires_at.slice(0, 10) : '')
  const [note, setNote] = useState(member.note ?? '')
  const save = useMutation({
    mutationFn: () => adminSetPermissions(member.id, scopes, until ? new Date(`${until}T23:59:59`).toISOString() : null, note.trim() || null),
    onSuccess: () => { toast.success(`Đã phân quyền cho ${member.display_name ?? 'admin'}`); void qc.invalidateQueries({ queryKey: teamKey }); onClose() },
    onError: (e) => toast.error(consoleErrorMessage(e)),
  })
  const toggle = (s: AdminScope) => setScopes((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]))
  return (
    <Sheet open onClose={onClose} title={`Phân quyền: ${member.display_name ?? 'admin'}`} description="Chỉ giao đúng nhóm việc người này cần làm."
      footer={<Button block loading={save.isPending} onClick={() => save.mutate()}>Lưu phân quyền</Button>}>
      <div className="space-y-3">
        {member.legacy && <p className="rounded-xl bg-warning/10 p-2 text-xs text-warning">Admin cũ đang toàn quyền. Lưu phân quyền để giới hạn lại.</p>}
        <div className="space-y-1.5">
          {SCOPES.map((s) => (
            <label key={s} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border p-3', scopes.includes(s) ? 'border-brand bg-brand/10' : 'border-border')}>
              <input type="checkbox" checked={scopes.includes(s)} onChange={() => toggle(s)} className="mt-0.5 size-5 accent-[var(--color-brand)]" />
              <span><span className="block text-sm font-semibold">{ADMIN_SCOPES[s].label}</span><span className="block text-xs text-fg-muted">{ADMIN_SCOPES[s].hint}</span></span>
            </label>
          ))}
        </div>
        <Field label="Hết hạn (bỏ trống = không hết hạn)" htmlFor="adm-until">
          <Input id="adm-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </Field>
        <Field label="Ghi chú (vai trò, bộ phận…)" htmlFor="adm-note">
          <Input id="adm-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="VD: CSKH ca tối" />
        </Field>
      </div>
    </Sheet>
  )
}

function RevokeSheet({ member, onClose }: { member: TeamMember; onClose: () => void }) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const act = useMutation({
    mutationFn: () => adminSetUserRole(member.id, 'MEMBER', reason.trim() || undefined),
    onSuccess: () => { toast.success('Đã gỡ quyền admin'); void qc.invalidateQueries({ queryKey: ['admin'] }); onClose() },
    onError: (e) => toast.error(consoleErrorMessage(e)),
  })
  return (
    <ConfirmSheet open onClose={onClose} title={`Gỡ quyền admin của ${member.display_name ?? 'người này'}?`} description="Người này trở lại tài khoản thường, mất mọi nhóm quyền." confirmLabel="Gỡ quyền"
      loading={act.isPending} onConfirm={() => act.mutate()}>
      <Field label="Ghi chú (lưu nhật ký)" htmlFor="adm-revoke">
        <Input id="adm-revoke" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="VD: Nghỉ việc" />
      </Field>
    </ConfirmSheet>
  )
}

/** Thêm admin bằng email: có tài khoản → cấp quyền ngay; chưa có → gửi thư mời. Xong mở phân quyền. */
function AddAdmin({ team, onAdded }: { team: AdminTeam; onAdded: (m: TeamMember) => void }) {
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [confirm, setConfirm] = useState(false)
  const add = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/admin/add-admin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email.trim() }) })
      const j = await res.json().catch(() => ({})) as { ok?: boolean; invited?: boolean; already?: boolean; id?: string; error?: string; detail?: string | null }
      if (!res.ok || !j.ok) throw new Error(j.error === 'INVALID_EMAIL' ? 'Email chưa đúng.' : j.error === 'INVITE_FAILED' ? `Không gửi được thư mời${j.detail ? `: ${j.detail}` : ''}.` : consoleErrorMessage({ message: j.error ?? '' }))
      return j
    },
    onSuccess: async (j) => {
      toast.success(j.already ? 'Tài khoản này đã là admin' : j.invited ? `Đã gửi thư mời tới ${email.trim()} — đăng ký xong là admin` : `Đã cấp quyền admin cho ${email.trim()} — hãy chọn nhóm quyền`)
      setEmail(''); setConfirm(false)
      const fresh = await qc.fetchQuery({ queryKey: teamKey, queryFn: adminTeam })
      const m = fresh.admins.find((a) => a.id === j.id)
      if (m && !m.is_owner && !m.is_me && !j.already) onAdded(m)
    },
    onError: (e) => { toast.error((e as Error).message); setConfirm(false) },
  })
  return (
    <form className="flex gap-2 pt-1" onSubmit={(e) => { e.preventDefault(); if (email.trim()) setConfirm(true) }}>
      <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email người cần thêm làm admin" aria-label="Email admin mới" className="h-10" />
      <Button type="submit" size="sm" className="h-10 shrink-0" disabled={!email.trim() || !team.owner_exists}>Thêm admin</Button>
      <ConfirmSheet open={confirm} onClose={() => setConfirm(false)} title={`Thêm ${email.trim()} vào đội quản trị?`} confirmLabel="Thêm admin" loading={add.isPending}
        description="Admin mới chưa có nhóm quyền nào — bạn chọn nhóm quyền ngay sau bước này. Chưa có tài khoản thì RaceHub gửi thư mời đăng ký." onConfirm={() => add.mutate()} />
    </form>
  )
}
