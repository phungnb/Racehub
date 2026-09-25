'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Crown, ShieldCheck, ShieldOff, Unlock } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Card, ConfirmSheet, ErrorState, Field, Input, LevelBadge, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin, formatNumber } from '@/shared/lib/format'
import { routes } from '@/shared/config/routes'
import type { AccountHit } from '../../api/adminApi'
import { adminSetUserBan, adminSetUserRole, adminUserDetail, auditLabel, consoleErrorMessage, type AdminUserDetail } from '../../api/consoleApi'
import { AccountPicker } from '../economy/AccountPicker'
import { inboxKey } from './InboxPanel'

const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }) : '—')

/** Người dùng: tìm theo tên / email / ID → hồ sơ đầy đủ, khóa / mở khóa, cấp / gỡ quyền admin */
export function UsersTab() {
  const [pick, setPick] = useState<AccountHit | null>(null)
  return (
    <div className="space-y-3">
      <AccountPicker id="admin-user" value={pick} onChange={setPick} />
      {!pick ? <p className="text-sm text-fg-muted">Tìm người dùng để xem hồ sơ, số dư, CLB, giao dịch gần đây; khóa tài khoản vi phạm hoặc cấp quyền quản trị.</p>
        : pick.kind === 'CLUB' ? <Card className="text-sm">Đây là CLB — xem ở nhóm <b>Cộng đồng → CLB Pro</b> hoặc <Link className="text-brand underline" href={routes.club(pick.id)}>mở trang CLB</Link>.</Card>
        : <UserDetail id={pick.id} />}
    </div>
  )
}

function UserDetail({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['admin', 'user', id], queryFn: () => adminUserDetail(id) })
  if (q.isPending) return <Skeleton className="h-96" />
  if (q.isError || !q.data) return <ErrorState message={consoleErrorMessage(q.error, 'Không tải được hồ sơ.')} error={q.error} onRetry={() => void q.refetch()} />
  const u = q.data
  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <div className="flex items-center gap-3">
          <Avatar src={u.avatar_url} name={u.display_name} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-lg font-bold">{u.display_name}<LevelBadge level={u.level} />
              {u.role === 'SYSTEM_ADMIN' && <span className="rounded-full bg-brand/15 px-2 py-0.5 text-xs font-bold text-brand">Admin</span>}
              {u.banned_at && <span className="rounded-full bg-danger/15 px-2 py-0.5 text-xs font-bold text-danger">Đang khóa</span>}</p>
            <p className="truncate text-sm text-fg-muted">{u.email ?? 'không có email'}</p>
            <p className="font-mono text-[11px] text-fg-subtle">{u.id}</p>
          </div>
        </div>
        {u.banned_at && <p className="rounded-xl bg-danger/10 p-2 text-sm text-danger">Khóa lúc {fmt(u.banned_at)}: {u.banned_reason}</p>}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Item label="Số dư">{formatCoin(u.balance)} Xu</Item>
          <Item label="Gói">{u.plan ? `${u.plan.name} · đến ${new Date(u.plan.ends_at).toLocaleDateString('vi-VN')}` : 'Miễn phí'}</Item>
          <Item label="Tham gia">{fmt(u.created_at)}</Item>
          <Item label="Đăng nhập gần nhất">{fmt(u.last_sign_in_at)}</Item>
          <Item label="Bài chạy hợp lệ">{formatNumber(u.stats.runs)} · {formatNumber(u.stats.km)} km</Item>
          <Item label="Bài chờ duyệt">{u.stats.pending_runs}</Item>
          <Item label="Bài gần nhất">{fmt(u.stats.last_run_at)}</Item>
          <Item label="Thử thách đang tham gia">{u.stats.challenges}</Item>
          <Item label="Đã thanh toán">{formatNumber(u.stats.orders_paid_vnd)} đ</Item>
          <Item label="Strava">{u.strava_connected ? 'Đã kết nối' : 'Chưa'}</Item>
          <Item label="Mã giới thiệu">{u.referral_code ?? '—'}</Item>
          <Item label="Được mời bởi">{u.referred_by ?? '—'}</Item>
        </dl>
      </Card>
      <Actions u={u} />
      {u.clubs.length > 0 && (
        <Card className="space-y-2">
          <h3 className="font-semibold">CLB ({u.clubs.length})</h3>
          <ul className="flex flex-wrap gap-1.5">
            {u.clubs.map((c) => <li key={c.id}><Link href={routes.club(c.id)} className="block rounded-full bg-surface-2 px-2.5 py-1 text-xs">{c.name} · {c.status === 'PENDING' ? 'chờ duyệt' : c.role}</Link></li>)}
          </ul>
        </Card>
      )}
      <Card className="space-y-2">
        <h3 className="font-semibold">Giao dịch Xu gần đây</h3>
        {!u.ledger.length ? <p className="text-sm text-fg-muted">Chưa có giao dịch.</p> : (
          <ul className="divide-y divide-border text-sm">
            {u.ledger.map((l, i) => (
              <li key={i} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0"><span className="block truncate">{l.description ?? l.type}</span><span className="text-xs text-fg-subtle">{fmt(l.at)}</span></span>
                <span className={cn('shrink-0 font-mono font-semibold', Number(l.amount) >= 0 ? 'text-brand' : 'text-danger')}>{Number(l.amount) >= 0 ? '+' : ''}{formatCoin(l.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {u.audit.length > 0 && (
        <Card className="space-y-2">
          <h3 className="font-semibold">Lịch sử quản trị</h3>
          <ul className="space-y-1 text-sm">
            {u.audit.map((a, i) => <li key={i}><b>{auditLabel(a.action)}</b> · {a.actor ?? 'hệ thống'} · {fmt(a.at)}{a.reason ? ` — ${a.reason}` : ''}</li>)}
          </ul>
        </Card>
      )}
    </div>
  )
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs text-fg-subtle">{label}</dt><dd className="truncate font-medium">{children}</dd></div>
}

function Actions({ u }: { u: AdminUserDetail }) {
  const qc = useQueryClient()
  const [sheet, setSheet] = useState<'ban' | 'unban' | 'admin' | 'member' | null>(null)
  const [reason, setReason] = useState('')
  const done = (msg: string) => {
    toast.success(msg); setSheet(null); setReason('')
    void qc.invalidateQueries({ queryKey: ['admin', 'user', u.id] }); void qc.invalidateQueries({ queryKey: inboxKey })
  }
  const act = useMutation({
    mutationFn: () => sheet === 'ban' ? adminSetUserBan(u.id, true, reason) : sheet === 'unban' ? adminSetUserBan(u.id, false, reason)
      : adminSetUserRole(u.id, sheet === 'admin' ? 'SYSTEM_ADMIN' : 'MEMBER', reason),
    onSuccess: () => done(sheet === 'ban' ? 'Đã khóa tài khoản và đăng xuất mọi thiết bị' : sheet === 'unban' ? 'Đã mở khóa' : sheet === 'admin' ? 'Đã cấp quyền admin' : 'Đã gỡ quyền admin'),
    onError: (e) => toast.error(consoleErrorMessage(e)),
  })
  const meta = {
    ban: { title: 'Khóa tài khoản?', desc: 'Người này bị đăng xuất khỏi mọi thiết bị và không đăng nhập lại được cho tới khi mở khóa. Dữ liệu vẫn giữ nguyên.', label: 'Khóa tài khoản', need: true },
    unban: { title: 'Mở khóa tài khoản?', desc: 'Người này đăng nhập lại được ngay.', label: 'Mở khóa', need: false },
    admin: { title: 'Cấp quyền quản trị?', desc: 'Người này có TOÀN QUYỀN quản trị RaceHub (Xu, đơn hàng, người dùng…). Chỉ cấp cho người thật sự tin cậy.', label: 'Cấp quyền admin', need: false },
    member: { title: 'Gỡ quyền quản trị?', desc: 'Người này trở lại tài khoản thường.', label: 'Gỡ quyền', need: false },
  } as const
  const m = sheet ? meta[sheet] : null
  return (
    <Card className="flex flex-wrap gap-2">
      {u.banned_at
        ? <Button size="sm" variant="secondary" onClick={() => setSheet('unban')}><Unlock className="size-4" aria-hidden />Mở khóa</Button>
        : <Button size="sm" variant="danger" disabled={u.role === 'SYSTEM_ADMIN'} onClick={() => setSheet('ban')}><Ban className="size-4" aria-hidden />Khóa tài khoản</Button>}
      {u.role === 'SYSTEM_ADMIN'
        ? <Button size="sm" variant="secondary" onClick={() => setSheet('member')}><ShieldOff className="size-4" aria-hidden />Gỡ quyền admin</Button>
        : <Button size="sm" variant="secondary" disabled={!!u.banned_at} onClick={() => setSheet('admin')}><ShieldCheck className="size-4" aria-hidden />Cấp quyền admin</Button>}
      <p className="flex w-full items-center gap-1.5 text-xs text-fg-subtle"><Crown className="size-3.5" aria-hidden />Cộng / trừ Xu, tặng gói VIP: nhóm <b>Kinh tế → Cộng/Trừ Xu</b> và <b>Kinh doanh → Gói & giá</b>.</p>
      {m && (
        <ConfirmSheet open onClose={() => setSheet(null)} title={m.title} description={m.desc} confirmLabel={m.label}
          danger={sheet === 'ban' || sheet === 'admin'} loading={act.isPending}
          onConfirm={() => { if (m.need && reason.trim().length < 3) { toast.error('Hãy ghi lý do (ít nhất 3 ký tự).'); return } act.mutate() }}>
          <Field label={m.need ? 'Lý do (bắt buộc, lưu nhật ký)' : 'Ghi chú (lưu nhật ký)'} htmlFor="admin-user-reason">
            <Input id="admin-user-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="VD: Gian lận GPS nhiều lần" />
          </Field>
        </ConfirmSheet>
      )}
    </Card>
  )
}
