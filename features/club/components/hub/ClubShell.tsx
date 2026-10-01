'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ChevronRight, Clock, Lock, Search, Settings, ShieldOff, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Card, ErrorState, Input, LevelBadge, ScrollRow, Sheet, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatNumber } from '@/shared/lib/format'
import { routes } from '@/shared/config/routes'
import { matchesSearch } from '@/shared/lib/search'
import { clubErrorMessage, joinClub, leaveClub, type ClubMember } from '../../api/clubApi'
import { CLUB_THEMES, isProActive } from '../../model/theme'
import { accentOf, clubRank, JOIN_POLICY_LABEL, ROLE_LABEL } from '../../model/roles'
import { useClub, useClubInbox, useClubMembers } from '../../hooks/useClub'
import { clubKeys } from '../../hooks/keys'
import { ClubAvatar } from './ClubAvatar'

/** Khung chung cho mọi tab của một CLB: đầu trang có màu CLB + thanh tab dính khi cuộn. */
export function ClubShell({ clubId, children }: { clubId: string; children: ReactNode }) {
  const pathname = usePathname()
  const { club, membership, isMember, isStaff, isRealMember, isAdmin, isLoading, isError, error, refetch } = useClub(clubId)
  const inbox = useClubInbox()
  const members = useClubMembers(clubId, isMember)
  const [showMembers, setShowMembers] = useState(false)
  const unread = inbox.data?.find((c) => c.club_id === clubId)?.unread_count ?? 0
  const pending = isStaff ? (members.data ?? []).filter((m) => m.status === 'PENDING').length : 0

  if (isLoading) return <ShellSkeleton />
  if (isError || !club) return <ErrorState message="Không tải được CLB." error={error} onRetry={refetch} />

  const accent = accentOf(club)
  const pro = isProActive(club)
  const theme = club.theme ? CLUB_THEMES[club.theme] : null
  const base = routes.club(clubId)
  const tabs = [
    // Bảng điều khiển ban quản trị (009600): chỉ chủ nhiệm / quản trị viên thấy
    ...(isStaff ? [{ href: `${base}/admin`, label: 'Quản trị', badge: pending }] : []),
    { href: base, label: 'Bảng tin' },
    { href: `${base}/chat`, label: 'Chat', badge: unread },
    { href: `${base}/events`, label: 'Lịch' },
    { href: `${base}/photos`, label: 'Ảnh' },
    { href: `${base}/challenges`, label: 'Thử thách' },
    { href: `${base}/leaderboard`, label: 'BXH' },
    { href: `${base}/hall`, label: 'Đại sảnh' },
    { href: `${base}/members`, label: 'Thành viên', badge: pending },
    { href: `${base}/treasury`, label: 'Quỹ' },
    { href: `${base}/shop`, label: 'Cửa hàng' },
  ]

  return (
    <div className="-mx-4 -mt-4">
      <header className="relative overflow-hidden border-b border-border"
        style={{ background: pro && theme ? theme.bg : `linear-gradient(160deg, color-mix(in srgb, ${accent} 28%, transparent), transparent 70%)` }}>
        {/* Tường nhà CLB Pro (migration 008100): ảnh bìa + lớp phủ để chữ luôn đọc được */}
        {pro && club.cover_url && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- ảnh bìa CLB */}
            <img src={club.cover_url} alt="" className="absolute inset-0 size-full object-cover" style={{ objectPosition: `50% ${club.cover_position ?? 50}%` }} />
            <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/25 to-bg" aria-hidden />
          </>
        )}
        <div className="relative flex items-center justify-between px-2 pt-2">
          <Link href={routes.clubs} aria-label="Về danh sách CLB"
            className={cn('grid size-11 place-items-center rounded-full hover:bg-surface-2 hover:text-fg', pro && (club.cover_url || theme) ? 'bg-black/30 text-white' : 'text-fg-muted')}>
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
          {isMember && (
            <Link href={`${base}/settings`} aria-label="Cài đặt CLB"
              className={cn('grid size-11 place-items-center rounded-full hover:bg-surface-2 hover:text-fg', pro && (club.cover_url || theme) ? 'bg-black/30 text-white' : 'text-fg-muted')}>
              <Settings className="size-5" aria-hidden />
            </Link>
          )}
        </div>
        <div className={cn('relative flex items-end gap-4 px-4 pb-4', pro && club.cover_url && 'pt-16')}>
          <ClubAvatar club={club} size="lg" className={cn('shadow-lg', pro && 'ring-2 ring-coin ring-offset-2 ring-offset-bg')} />
          <div className="min-w-0 pb-1">
            <h1 className={cn('flex items-center gap-2 text-xl font-bold leading-tight sm:text-2xl', pro && (club.cover_url || theme) && 'text-white drop-shadow')}>
              <span className="line-clamp-2 break-words">{club.name}</span>
              {pro && <span className="shrink-0 rounded-full bg-gradient-to-r from-coin to-amber-300 px-2 py-0.5 text-[11px] font-black text-bg shadow">✦ PRO</span>}
            </h1>
            {pro && club.tagline && <p className={cn('mt-0.5 text-sm font-medium italic', club.cover_url || theme ? 'text-white/90 drop-shadow' : 'text-fg-muted')}>“{club.tagline}”</p>}
            {isMember ? (
              <button type="button" onClick={() => setShowMembers(true)} aria-haspopup="dialog"
                className={cn('-ml-2 mt-0.5 flex min-h-9 items-center gap-1.5 rounded-full px-2 text-sm underline-offset-4 hover:underline',
                  pro && (club.cover_url || theme) ? 'text-white/85 hover:bg-black/20' : 'text-fg-muted hover:bg-surface-2 hover:text-fg')}>
                <Users className="size-4" aria-hidden />
                <span className="font-mono tabular">{formatNumber(club.member_count)}</span> thành viên
                <ChevronRight className="size-4" aria-hidden />
              </button>
            ) : (
              <p className={cn('mt-1 flex items-center gap-1.5 text-sm', pro && (club.cover_url || theme) ? 'text-white/80' : 'text-fg-muted')}>
                <Users className="size-4" aria-hidden />
                <span className="font-mono tabular">{formatNumber(club.member_count)}</span> thành viên
              </p>
            )}
          </div>
        </div>
      </header>

      {isMember ? (
        <>
          <nav aria-label="Các mục của CLB" className="sticky top-[var(--topbar-h)] z-30 border-b border-border bg-bg/95 backdrop-blur-md">
            <ScrollRow activeKey={pathname} innerClassName="gap-0.5 px-2">
            {tabs.map((t) => {
              const active = t.href === base ? pathname === base : pathname.startsWith(t.href)
              return (
                <Link key={t.href} href={t.href} aria-current={active ? 'page' : undefined}
                  className={cn('relative flex min-h-12 shrink-0 items-center gap-1.5 px-2.5 text-sm font-semibold transition-colors',
                    active ? 'text-fg' : 'text-fg-subtle hover:text-fg')}>
                  {t.label}
                  {!!t.badge && (
                    <span className="grid min-w-5 place-items-center rounded-full bg-live px-1 font-mono text-xs leading-5 text-white">
                      {t.badge > 99 ? '99+' : t.badge}
                    </span>
                  )}
                  {active && <span className="absolute inset-x-2.5 bottom-0 h-0.5 rounded-full" style={{ background: accent }} />}
                </Link>
              )
            })}
            </ScrollRow>
          </nav>
          {/* Admin hệ thống xem hộ (toàn quyền, 007100) nhưng chưa là thành viên thật: vẫn cho tham gia như runner */}
          {isAdmin && !isRealMember && <AdminJoinBar clubId={clubId} status={membership?.status ?? null} />}
          <div className="px-4 pt-4">{children}</div>
          <MembersSheet open={showMembers} onClose={() => setShowMembers(false)} members={members.data ?? []}
            loading={members.isLoading} total={club.member_count} manageHref={`${base}/members`} />
        </>
      ) : (
        <div className="px-4 pt-4"><JoinGate clubId={clubId} status={membership?.status ?? null} /></div>
      )}
    </div>
  )
}

/** Bấm "N thành viên" ở đầu trang CLB: danh sách thành viên (ban quản trị lên đầu), tìm nhanh, bấm để xem hồ sơ. */
function MembersSheet({ open, onClose, members, loading, total, manageHref }: {
  open: boolean; onClose: () => void; members: ClubMember[]; loading: boolean; total: number; manageHref: string
}) {
  const [q, setQ] = useState('')
  const approved = members
    .filter((m) => m.status === 'APPROVED')
    .sort((a, b) => clubRank(b.role) - clubRank(a.role) || (a.profile?.display_name ?? '').localeCompare(b.profile?.display_name ?? '', 'vi'))
  const shown = q.trim() ? approved.filter((m) => matchesSearch(q, m.profile?.display_name)) : approved
  return (
    <Sheet open={open} onClose={onClose} title={`Thành viên (${formatNumber(total)})`}
      footer={<Link href={manageHref} onClick={onClose} className="flex min-h-11 items-center justify-center gap-1 rounded-xl bg-surface-2 text-sm font-semibold hover:text-fg">
        Mở tab Thành viên <ChevronRight className="size-4" aria-hidden />
      </Link>}>
      {approved.length > 8 && (
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm thành viên…" className="pl-9" aria-label="Tìm thành viên" />
        </div>
      )}
      {loading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-fg-muted">{q.trim() ? 'Không tìm thấy thành viên.' : 'Chưa có thành viên.'}</p>
      ) : (
        <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto overscroll-contain">
          {shown.map((m) => (
            <li key={m.id}>
              <Link href={routes.athlete(m.user_id)} onClick={onClose} className="flex min-h-14 items-center gap-3 py-2 hover:bg-surface-2/50">
                <Avatar src={m.profile?.avatar_url} name={m.profile?.display_name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{m.profile?.display_name ?? 'Runner'}</span>
                  {m.role !== 'MEMBER' && <span className="text-xs font-semibold text-brand">{ROLE_LABEL[m.role]}</span>}
                </span>
                <LevelBadge level={m.profile?.level} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}

function AdminJoinBar({ clubId, status }: { clubId: string; status: string | null }) {
  const qc = useQueryClient()
  const { club, uid } = useClub(clubId)
  const join = useMutation({
    mutationFn: () => joinClub(clubId),
    onSuccess: (m) => {
      toast.success(m.status === 'APPROVED' ? 'Bạn đã là thành viên CLB' : 'Đã gửi yêu cầu — bạn tự duyệt được ở tab Thành viên')
      void qc.invalidateQueries({ queryKey: clubKeys.membership(clubId, uid) })
      void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) })
      void qc.invalidateQueries({ queryKey: clubKeys.inbox })
    },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  if (!club) return null
  return (
    <div className="mx-4 mt-3 flex items-center gap-3 rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm">
      <span className="min-w-0 flex-1 text-fg-muted">
        {status === 'PENDING' ? 'Yêu cầu tham gia đang chờ duyệt (tự duyệt ở tab Thành viên).' : 'Bạn đang xem với quyền admin, chưa là thành viên.'}
      </span>
      {status !== 'PENDING' && status !== 'BANNED' && (
        <Button size="sm" onClick={() => join.mutate()} loading={join.isPending}>
          {club.join_policy === 'OPEN' ? 'Tham gia CLB' : 'Xin gia nhập'}
        </Button>
      )}
    </div>
  )
}

function JoinGate({ clubId, status }: { clubId: string; status: string | null }) {
  const qc = useQueryClient()
  const router = useRouter()
  const { club, uid } = useClub(clubId)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: clubKeys.membership(clubId, uid) })
    void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) })
    void qc.invalidateQueries({ queryKey: clubKeys.inbox })
  }
  const join = useMutation({
    mutationFn: () => joinClub(clubId),
    onSuccess: (m) => {
      toast.success(m.status === 'APPROVED' ? 'Chào mừng bạn đến với CLB!' : 'Đã gửi yêu cầu. Ban quản trị sẽ duyệt sớm.')
      refresh()
    },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  const cancel = useMutation({
    mutationFn: () => leaveClub(clubId),
    onSuccess: () => { toast('Đã hủy yêu cầu tham gia'); refresh(); router.push(routes.clubs) },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  if (!club) return null
  const policy = JOIN_POLICY_LABEL[club.join_policy] ?? JOIN_POLICY_LABEL.OPEN

  if (status === 'BANNED') {
    return <Notice icon={ShieldOff} title="Bạn không thể tham gia CLB này" text="Ban quản trị đã hạn chế tài khoản của bạn trong CLB." />
  }
  if (status === 'PENDING') {
    return (
      <Notice icon={Clock} title="Đang chờ duyệt" text="Yêu cầu của bạn đã được gửi tới ban quản trị. Bạn sẽ nhận thông báo khi được duyệt.">
        <Button variant="secondary" onClick={() => cancel.mutate()} loading={cancel.isPending}>Hủy yêu cầu</Button>
      </Notice>
    )
  }
  return (
    <Card className="space-y-4">
      {club.description && <p className="whitespace-pre-line text-[15px] leading-relaxed text-fg-muted">{club.description}</p>}
      <div className="flex items-center gap-2 text-sm text-fg-muted">
        {club.join_policy === 'INVITE_ONLY' ? <Lock className="size-4" aria-hidden /> : <Users className="size-4" aria-hidden />}
        {policy.hint}
      </div>
      {club.join_policy === 'INVITE_ONLY' ? (
        <p className="text-sm text-fg-subtle">Hãy xin link mời từ ban quản trị CLB.</p>
      ) : (
        <Button block size="lg" onClick={() => join.mutate()} loading={join.isPending}>
          {club.join_policy === 'OPEN' ? 'Tham gia CLB' : 'Xin gia nhập'}
        </Button>
      )}
    </Card>
  )
}

function Notice({ icon: Icon, title, text, children }: { icon: typeof Clock; title: string; text: string; children?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center gap-2 py-8 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-surface-2 text-fg-muted"><Icon className="size-6" aria-hidden /></span>
      <p className="font-semibold">{title}</p>
      <p className="max-w-xs text-sm text-fg-muted">{text}</p>
      {children && <div className="mt-2">{children}</div>}
    </Card>
  )
}

function ShellSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-end gap-4 pt-10">
        <Skeleton className="size-20 rounded-3xl" />
        <div className="flex-1 space-y-2"><Skeleton className="h-7 w-2/3" /><Skeleton className="h-4 w-1/3" /></div>
      </div>
      <Skeleton className="h-10" />
      <Skeleton className="h-32" />
      <Skeleton className="h-32" />
    </div>
  )
}
