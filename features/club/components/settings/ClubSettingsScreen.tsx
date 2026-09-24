'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, BellOff, BellRing, Camera, Check, Crown, LogOut, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { getClubNotificationLevel, setClubNotificationLevel, type NotificationLevel } from '@/features/notification'
import { Avatar, Button, Card, ConfirmSheet, Field, Input, SectionTitle, Sheet, Skeleton, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import {
  clubErrorMessage, deleteClub, leaveClub, rotateInviteCode, setClubAccent, transferClubOwnership, updateClub,
  updateClubPolicy, uploadClubAvatar, type Club,
} from '../../api/clubApi'
import { accentOf, CLUB_ACCENTS, JOIN_POLICY_LABEL, type JoinPolicy } from '../../model/roles'
import { useClub, useClubMembers } from '../../hooks/useClub'
import { clubKeys } from '../../hooks/keys'
import { ClubAvatar } from '../hub/ClubAvatar'

export function ClubSettingsScreen({ clubId }: { clubId: string }) {
  const { club, role, isStaff } = useClub(clubId)
  if (!club) return <Skeleton className="h-64" />
  return (
    <div className="space-y-8 pb-6">
      <NotificationSection clubId={clubId} />
      {isStaff && <ProfileSection club={club} />}
      {role === 'OWNER' && <PolicySection club={club} />}
      <DangerSection club={club} isOwner={role === 'OWNER'} />
    </div>
  )
}

function useRefreshClub(clubId: string) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) })
    void qc.invalidateQueries({ queryKey: clubKeys.inbox })
  }
}

const LEVELS: { value: NotificationLevel; title: string; hint: string; icon: typeof Bell }[] = [
  { value: 'ALL', title: 'Tất cả', hint: 'Thông báo, nhắc tên, cổ vũ, bình luận', icon: BellRing },
  { value: 'IMPORTANT', title: 'Chỉ quan trọng', hint: 'Thông báo ghim và khi được nhắc tên', icon: Bell },
  { value: 'NONE', title: 'Tắt', hint: 'Không nhận thông báo nào từ CLB này', icon: BellOff },
]

function NotificationSection({ clubId }: { clubId: string }) {
  const qc = useQueryClient()
  const key = ['club', clubId, 'notification-level']
  const level = useQuery({ queryKey: key, queryFn: () => getClubNotificationLevel(clubId) })
  const set = useMutation({
    mutationFn: (v: NotificationLevel) => setClubNotificationLevel(clubId, v),
    onMutate: (v) => qc.setQueryData(key, v),
    onSuccess: () => toast.success('Đã lưu cài đặt thông báo'),
    onError: (e) => { toast.error(clubErrorMessage(e)); void level.refetch() },
  })
  return (
    <section>
      <SectionTitle>Thông báo từ CLB</SectionTitle>
      <div role="radiogroup" aria-label="Mức thông báo" className="space-y-2">
        {LEVELS.map((l) => {
          const on = level.data === l.value
          return (
            <button key={l.value} role="radio" aria-checked={on} onClick={() => set.mutate(l.value)} disabled={level.isLoading}
              className={cn('flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors',
                on ? 'border-brand/60 bg-brand/10' : 'border-border bg-surface hover:border-fg-subtle')}>
              <l.icon className={cn('size-5', on ? 'text-brand' : 'text-fg-subtle')} aria-hidden />
              <span className="flex-1"><span className="block text-sm font-semibold">{l.title}</span><span className="block text-xs text-fg-muted">{l.hint}</span></span>
              {on && <Check className="size-5 text-brand" aria-hidden />}
            </button>
          )
        })}
      </div>
    </section>
  )
}

function ProfileSection({ club }: { club: Club }) {
  const refresh = useRefreshClub(club.id)
  const [name, setName] = useState(club.name)
  const [desc, setDesc] = useState(club.description ?? '')
  const file = useRef<HTMLInputElement>(null)
  const save = useMutation({
    mutationFn: () => updateClub(club.id, { name: name.trim(), description: desc.trim() }),
    onSuccess: () => { toast.success('Đã lưu thông tin CLB'); refresh() },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  const avatar = useMutation({
    mutationFn: (f: File) => uploadClubAvatar(club.id, f),
    onSuccess: () => { toast.success('Đã đổi logo'); refresh() },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  const accent = useMutation({
    mutationFn: (c: string) => setClubAccent(club.id, c),
    onSuccess: refresh,
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  const dirty = name.trim() !== club.name || desc.trim() !== (club.description ?? '')

  return (
    <section>
      <SectionTitle>Hồ sơ CLB</SectionTitle>
      <Card className="space-y-4">
        <div className="flex items-center gap-4">
          <button onClick={() => file.current?.click()} aria-label="Đổi logo CLB" className="relative">
            <ClubAvatar club={club} size="lg" />
            <span className="absolute -bottom-1 -right-1 grid size-8 place-items-center rounded-full border-2 border-surface bg-surface-2">
              <Camera className="size-4" aria-hidden />
            </span>
          </button>
          <input ref={file} type="file" hidden accept="image/jpeg,image/png,image/webp"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) avatar.mutate(f); e.target.value = '' }} />
          <p className="text-sm text-fg-muted">{avatar.isPending ? 'Đang tải logo…' : 'Logo vuông, tối đa 2 MB (JPG, PNG, WebP).'}</p>
        </div>
        <Field label="Tên CLB" htmlFor="c-name"><Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></Field>
        <Field label="Giới thiệu" htmlFor="c-desc" hint={`${desc.length}/300`}>
          <Textarea id="c-desc" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={300} />
        </Field>
        <div>
          <p className="mb-2 text-sm font-medium text-fg-muted">Màu CLB</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Màu CLB">
            {CLUB_ACCENTS.map((c) => {
              const on = accentOf(club) === c
              return (
                <button key={c} role="radio" aria-checked={on} aria-label={`Màu ${c}`} onClick={() => accent.mutate(c)}
                  className={cn('grid size-11 place-items-center rounded-full border-2 transition-transform', on ? 'scale-110 border-fg' : 'border-transparent')}
                  style={{ background: c }}>
                  {on && <Check className="size-5 text-bg" aria-hidden />}
                </button>
              )
            })}
          </div>
        </div>
        <Button block onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty || !name.trim()}>Lưu thay đổi</Button>
      </Card>
    </section>
  )
}

function PolicySection({ club }: { club: Club }) {
  const refresh = useRefreshClub(club.id)
  const [limit, setLimit] = useState(String(club.member_limit))
  const policy = useMutation({
    mutationFn: (p: { joinPolicy?: JoinPolicy; memberLimit?: number }) => updateClubPolicy(club.id, p),
    onSuccess: () => { toast.success('Đã lưu'); refresh() },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  const rotate = useMutation({
    mutationFn: () => rotateInviteCode(club.id),
    onSuccess: () => { toast.success('Đã đổi mã mời. Link cũ không còn dùng được.'); refresh() },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  return (
    <section>
      <SectionTitle>Tham gia CLB</SectionTitle>
      <Card className="space-y-4">
        <div role="radiogroup" aria-label="Chế độ tham gia" className="space-y-2">
          {(Object.keys(JOIN_POLICY_LABEL) as JoinPolicy[]).map((p) => {
            const on = club.join_policy === p
            return (
              <button key={p} role="radio" aria-checked={on} onClick={() => !on && policy.mutate({ joinPolicy: p })}
                className={cn('flex w-full items-center gap-3 rounded-xl border p-3 text-left', on ? 'border-brand/60 bg-brand/10' : 'border-border hover:border-fg-subtle')}>
                <span className="flex-1"><span className="block text-sm font-semibold">{JOIN_POLICY_LABEL[p].title}</span>
                  <span className="block text-xs text-fg-muted">{JOIN_POLICY_LABEL[p].hint}</span></span>
                {on && <Check className="size-5 text-brand" aria-hidden />}
              </button>
            )
          })}
        </div>
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); policy.mutate({ memberLimit: Number(limit) }) }}>
          <div className="flex-1">
            <Field label="Số thành viên tối đa" htmlFor="c-limit" hint="Từ 2 đến 1000">
              <Input id="c-limit" inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, '').slice(0, 4))} />
            </Field>
          </div>
          <Button type="submit" variant="secondary" disabled={Number(limit) === club.member_limit || !limit} className="mb-[22px]">Lưu</Button>
        </form>
        <Button variant="secondary" block onClick={() => rotate.mutate()} loading={rotate.isPending}>
          <RefreshCw className="size-4" aria-hidden />Đổi mã mời (vô hiệu link cũ)
        </Button>
      </Card>
    </section>
  )
}

function DangerSection({ club, isOwner }: { club: Club; isOwner: boolean }) {
  const router = useRouter()
  const qc = useQueryClient()
  const members = useClubMembers(club.id, isOwner)
  const [dialog, setDialog] = useState<'leave' | 'transfer' | 'delete' | null>(null)
  const [target, setTarget] = useState<string | null>(null)
  const [confirmName, setConfirmName] = useState('')
  const done = (msg: string) => {
    toast.success(msg)
    setDialog(null)
    void qc.invalidateQueries({ queryKey: ['club', club.id] })
    void qc.invalidateQueries({ queryKey: clubKeys.inbox })
  }
  const leave = useMutation({ mutationFn: () => leaveClub(club.id), onSuccess: () => { done('Bạn đã rời CLB'); router.push(routes.clubs) }, onError: (e) => toast.error(clubErrorMessage(e)) })
  const transfer = useMutation({ mutationFn: () => transferClubOwnership(club.id, target!), onSuccess: () => done('Đã trao quyền Chủ nhiệm'), onError: (e) => toast.error(clubErrorMessage(e)) })
  const remove = useMutation({ mutationFn: () => deleteClub(club.id, confirmName), onSuccess: () => { done('Đã giải tán CLB'); router.push(routes.clubs) }, onError: (e) => toast.error(clubErrorMessage(e)) })
  const candidates = (members.data ?? []).filter((m) => m.status === 'APPROVED' && m.role !== 'OWNER')

  return (
    <section>
      <SectionTitle>Khác</SectionTitle>
      <div className="space-y-2">
        {isOwner ? (
          <>
            <Row icon={Crown} label="Trao quyền Chủ nhiệm" hint="Bạn sẽ trở thành Quản trị viên" onClick={() => setDialog('transfer')} />
            <Row icon={Trash2} label="Giải tán CLB" hint="Xóa vĩnh viễn CLB, bảng tin và tin nhắn" danger onClick={() => setDialog('delete')} />
          </>
        ) : (
          <Row icon={LogOut} label="Rời CLB" danger onClick={() => setDialog('leave')} />
        )}
      </div>

      <ConfirmSheet open={dialog === 'leave'} onClose={() => setDialog(null)} onConfirm={() => leave.mutate()} loading={leave.isPending}
        title={`Rời ${club.name}?`} description="Bạn sẽ không thấy bảng tin và tin nhắn của CLB nữa. Có thể xin vào lại sau." confirmLabel="Rời CLB" />

      <Sheet open={dialog === 'transfer'} onClose={() => setDialog(null)} title="Trao quyền Chủ nhiệm" description="Chọn người sẽ làm Chủ nhiệm mới."
        footer={<Button block onClick={() => transfer.mutate()} loading={transfer.isPending} disabled={!target}>Trao quyền</Button>}>
        {members.isLoading ? <Skeleton className="h-32" /> : candidates.length === 0 ? (
          <p className="py-6 text-center text-sm text-fg-muted">CLB chưa có thành viên nào khác.</p>
        ) : (
          <ul role="radiogroup" aria-label="Chủ nhiệm mới" className="space-y-1">
            {candidates.map((m) => (
              <li key={m.id}>
                <button role="radio" aria-checked={target === m.user_id} onClick={() => setTarget(m.user_id)}
                  className={cn('flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left', target === m.user_id ? 'bg-brand/10' : 'hover:bg-surface-2')}>
                  <Avatar src={m.profile?.avatar_url} name={m.profile?.display_name} size="sm" />
                  <span className="flex-1 truncate">{m.profile?.display_name ?? 'Runner'}</span>
                  {target === m.user_id && <Check className="size-5 text-brand" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Sheet>

      <ConfirmSheet open={dialog === 'delete'} onClose={() => setDialog(null)} onConfirm={() => remove.mutate()} loading={remove.isPending}
        title="Giải tán CLB?" description="Không thể hoàn tác. Gõ đúng tên CLB để xác nhận." confirmLabel="Giải tán">
        <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={club.name} aria-label="Tên CLB để xác nhận" />
      </ConfirmSheet>
    </section>
  )
}

function Row({ icon: Icon, label, hint, danger, onClick }: { icon: typeof Crown; label: string; hint?: ReactNode; danger?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface p-3 text-left hover:border-fg-subtle">
      <Icon className={cn('size-5', danger ? 'text-danger' : 'text-fg-muted')} aria-hidden />
      <span className="flex-1">
        <span className={cn('block text-sm font-semibold', danger && 'text-danger')}>{label}</span>
        {hint && <span className="block text-xs text-fg-muted">{hint}</span>}
      </span>
    </button>
  )
}
