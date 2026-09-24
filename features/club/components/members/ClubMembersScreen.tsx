'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Ban, Check, Copy, Crown, Link2, QrCode, Search, Share2, ShieldCheck, UserMinus, UserX } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Card, ConfirmSheet, EmptyState, ErrorState, Input, LevelBadge, SectionTitle, Sheet, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatRelative } from '@/shared/lib/format'
import { clubErrorMessage, removeMember, setMemberRole, setMemberStatus, type ClubMember } from '../../api/clubApi'
import { canManage, ROLE_LABEL } from '../../model/roles'
import { useClub, useClubMembers } from '../../hooks/useClub'
import { clubKeys } from '../../hooks/keys'
import { MenuItem } from '../feed/PostCard'

type Pending = { kind: 'remove' | 'ban'; m: ClubMember } | null

export function ClubMembersScreen({ clubId }: { clubId: string }) {
  const qc = useQueryClient()
  const { club, role, isStaff, uid } = useClub(clubId)
  const members = useClubMembers(clubId)
  const [q, setQ] = useState('')
  const [menu, setMenu] = useState<ClubMember | null>(null)
  const [confirm, setConfirm] = useState<Pending>(null)
  const [invite, setInvite] = useState(false)

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: clubKeys.members(clubId) })
    void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) })
  }
  const act = useMutation({
    mutationFn: async (a: { type: 'approve' | 'reject' | 'ban' | 'remove' | 'promote' | 'demote'; m: ClubMember }) => {
      if (a.type === 'approve') return setMemberStatus(a.m.id, 'APPROVED')
      if (a.type === 'reject') return setMemberStatus(a.m.id, 'REJECTED')
      if (a.type === 'ban') return setMemberStatus(a.m.id, 'BANNED')
      if (a.type === 'remove') return removeMember(a.m.id)
      return setMemberRole(a.m.id, a.type === 'promote' ? 'CAPTAIN' : 'MEMBER')
    },
    onSuccess: (_, a) => {
      const name = a.m.profile?.display_name ?? 'Thành viên'
      toast.success({
        approve: `Đã duyệt ${name}`, reject: `Đã từ chối ${name}`, ban: `Đã cấm ${name}`, remove: `Đã mời ${name} rời CLB`,
        promote: `${name} giờ là Quản trị viên`, demote: `${name} giờ là Thành viên`,
      }[a.type])
      setMenu(null)
      setConfirm(null)
      refresh()
    },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })

  const all = members.data ?? []
  const pending = all.filter((m) => m.status === 'PENDING')
  const banned = all.filter((m) => m.status === 'BANNED')
  const term = q.trim().toLocaleLowerCase('vi')
  const approved = all.filter((m) => m.status === 'APPROVED')
    .filter((m) => !term || (m.profile?.display_name ?? '').toLocaleLowerCase('vi').includes(term))
    .sort((a, b) => ({ OWNER: 0, CAPTAIN: 1, MEMBER: 2 }[a.role] - { OWNER: 0, CAPTAIN: 1, MEMBER: 2 }[b.role]))

  return (
    <div className="space-y-6">
      <Button block variant="secondary" onClick={() => setInvite(true)}><Share2 className="size-4" aria-hidden />Mời bạn vào CLB</Button>

      {members.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : members.isError ? (
        <ErrorState onRetry={() => members.refetch()} />
      ) : (
        <>
          {isStaff && pending.length > 0 && (
            <section>
              <SectionTitle>Xin gia nhập <span className="ml-1 rounded-full bg-live px-2 text-sm text-white">{pending.length}</span></SectionTitle>
              <ul className="space-y-2">
                {pending.map((m) => (
                  <li key={m.id}>
                    <Card className="flex items-center gap-3 p-3">
                      <Avatar src={m.profile?.avatar_url} name={m.profile?.display_name} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{m.profile?.display_name ?? 'Runner'}</span>
                        <span className="text-xs text-fg-subtle">Xin vào {formatRelative(m.joined_at)}</span>
                      </span>
                      <Button size="sm" variant="secondary" aria-label={`Từ chối ${m.profile?.display_name ?? ''}`}
                        onClick={() => act.mutate({ type: 'reject', m })} disabled={act.isPending} className="w-11 px-0">
                        <UserX className="size-4" aria-hidden />
                      </Button>
                      <Button size="sm" onClick={() => act.mutate({ type: 'approve', m })} disabled={act.isPending}>
                        <Check className="size-4" aria-hidden />Duyệt
                      </Button>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <SectionTitle>Thành viên · {all.filter((m) => m.status === 'APPROVED').length}</SectionTitle>
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm thành viên" aria-label="Tìm thành viên" className="pl-9" />
            </div>
            {approved.length === 0 ? (
              <EmptyState icon={Search} title="Không tìm thấy" description={`Không có thành viên nào tên "${q}".`} />
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
                {approved.map((m) => {
                  const manageable = canManage(role, m.role) && m.user_id !== uid
                  const row = (
                    <>
                      <Avatar src={m.profile?.avatar_url} name={m.profile?.display_name} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate font-semibold">{m.profile?.display_name ?? 'Runner'}{m.user_id === uid && ' (bạn)'}</span>
                          <LevelBadge level={m.profile?.level} />
                        </span>
                        <span className="text-xs text-fg-subtle">Tham gia {formatRelative(m.joined_at)}</span>
                      </span>
                      <RoleChip role={m.role} />
                    </>
                  )
                  return (
                    <li key={m.id}>
                      {manageable
                        ? <button onClick={() => setMenu(m)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">{row}</button>
                        : <div className="flex items-center gap-3 px-4 py-3">{row}</div>}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {isStaff && banned.length > 0 && (
            <section>
              <SectionTitle>Đã cấm · {banned.length}</SectionTitle>
              <ul className="space-y-2">
                {banned.map((m) => (
                  <li key={m.id}>
                    <Card className="flex items-center gap-3 p-3">
                      <Avatar src={m.profile?.avatar_url} name={m.profile?.display_name} size="sm" />
                      <span className="flex-1 truncate text-sm">{m.profile?.display_name ?? 'Runner'}</span>
                      <Button size="sm" variant="ghost" onClick={() => act.mutate({ type: 'remove', m })}>Gỡ cấm</Button>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <Sheet open={!!menu} onClose={() => setMenu(null)} title={menu?.profile?.display_name ?? 'Thành viên'} description={menu ? ROLE_LABEL[menu.role] : undefined}>
        {menu && (
          <div className="space-y-1">
            {role === 'OWNER' && menu.role === 'MEMBER' && (
              <MenuItem icon={ShieldCheck} label="Cho làm Quản trị viên" onClick={() => act.mutate({ type: 'promote', m: menu })} />
            )}
            {role === 'OWNER' && menu.role === 'CAPTAIN' && (
              <MenuItem icon={ShieldCheck} label="Thôi làm Quản trị viên" onClick={() => act.mutate({ type: 'demote', m: menu })} />
            )}
            <MenuItem icon={UserMinus} label="Mời rời CLB" danger onClick={() => { setConfirm({ kind: 'remove', m: menu }); setMenu(null) }} />
            <MenuItem icon={Ban} label="Cấm khỏi CLB" danger onClick={() => { setConfirm({ kind: 'ban', m: menu }); setMenu(null) }} />
          </div>
        )}
      </Sheet>

      <ConfirmSheet open={!!confirm} onClose={() => setConfirm(null)} loading={act.isPending}
        title={confirm?.kind === 'ban' ? `Cấm ${confirm.m.profile?.display_name ?? 'thành viên'}?` : `Mời ${confirm?.m.profile?.display_name ?? 'thành viên'} rời CLB?`}
        description={confirm?.kind === 'ban' ? 'Người này sẽ rời CLB và không thể tự xin vào lại.' : 'Người này có thể xin vào lại sau.'}
        confirmLabel={confirm?.kind === 'ban' ? 'Cấm' : 'Mời rời CLB'}
        onConfirm={() => confirm && act.mutate({ type: confirm.kind, m: confirm.m })} />

      {club && <InviteSheet open={invite} onClose={() => setInvite(false)} code={club.invite_code} name={club.name} />}
    </div>
  )
}

function RoleChip({ role }: { role: ClubMember['role'] }) {
  if (role === 'MEMBER') return null
  return (
    <span className={cn('flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
      role === 'OWNER' ? 'bg-coin/15 text-coin' : 'bg-xp/15 text-xp')}>
      {role === 'OWNER' ? <Crown className="size-3.5" aria-hidden /> : <ShieldCheck className="size-3.5" aria-hidden />}
      {ROLE_LABEL[role]}
    </span>
  )
}

function InviteSheet({ open, onClose, code, name }: { open: boolean; onClose: () => void; code: string; name: string }) {
  const link = typeof window === 'undefined' ? '' : `${window.location.origin}/club/join/${code}`
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(`Đã sao chép ${what}`) } catch { toast.error('Không sao chép được, hãy chọn và sao chép thủ công.') }
  }
  const share = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: `Vào CLB ${name} trên RaceHub`, text: `Tham gia CLB ${name} cùng mình trên RaceHub nhé!`, url: link }) } catch { /* người dùng hủy */ }
    } else void copy(link, 'link mời')
  }
  return (
    <Sheet open={open} onClose={onClose} title="Mời bạn vào CLB" description="Gửi link vào nhóm Zalo hoặc Messenger để mọi người chuyển sang RaceHub.">
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-bg p-3">
          <p className="flex items-center gap-2 text-xs text-fg-subtle"><Link2 className="size-3.5" aria-hidden />Link mời</p>
          <p className="mt-1 break-all font-mono text-sm">{link}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => copy(link, 'link mời')}><Copy className="size-4" aria-hidden />Sao chép link</Button>
          <Button onClick={share}><Share2 className="size-4" aria-hidden />Chia sẻ</Button>
        </div>
        <button onClick={() => copy(code, 'mã mời')} className="flex w-full items-center justify-between rounded-xl border border-dashed border-border px-4 py-3 text-left">
          <span>
            <span className="flex items-center gap-2 text-xs text-fg-subtle"><QrCode className="size-3.5" aria-hidden />Mã mời</span>
            <span className="font-mono text-lg font-bold tracking-widest">{code}</span>
          </span>
          <Copy className="size-4 text-fg-subtle" aria-hidden />
        </button>
      </div>
    </Sheet>
  )
}
