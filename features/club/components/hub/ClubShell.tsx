'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Clock, Lock, Settings, ShieldOff, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, ErrorState, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatNumber } from '@/shared/lib/format'
import { routes } from '@/shared/config/routes'
import { clubErrorMessage, joinClub, leaveClub } from '../../api/clubApi'
import { accentOf, JOIN_POLICY_LABEL } from '../../model/roles'
import { useClub, useClubInbox, useClubMembers } from '../../hooks/useClub'
import { clubKeys } from '../../hooks/keys'
import { ClubAvatar } from './ClubAvatar'

/** Khung chung cho mọi tab của một CLB: đầu trang có màu CLB + thanh tab dính khi cuộn. */
export function ClubShell({ clubId, children }: { clubId: string; children: ReactNode }) {
  const pathname = usePathname()
  const { club, membership, isMember, isStaff, isLoading, isError, error, refetch } = useClub(clubId)
  const inbox = useClubInbox()
  const members = useClubMembers(clubId, isStaff)
  const unread = inbox.data?.find((c) => c.club_id === clubId)?.unread_count ?? 0
  const pending = isStaff ? (members.data ?? []).filter((m) => m.status === 'PENDING').length : 0

  if (isLoading) return <ShellSkeleton />
  if (isError || !club) return <ErrorState message="Không tải được CLB." error={error} onRetry={refetch} />

  const accent = accentOf(club)
  const base = routes.club(clubId)
  const tabs = [
    { href: base, label: 'Bảng tin' },
    { href: `${base}/chat`, label: 'Chat', badge: unread },
    { href: `${base}/events`, label: 'Lịch' },
    { href: `${base}/challenges`, label: 'Thử thách' },
    { href: `${base}/leaderboard`, label: 'BXH' },
    { href: `${base}/members`, label: 'Thành viên', badge: pending },
    { href: `${base}/treasury`, label: 'Quỹ' },
  ]

  return (
    <div className="-mx-4 -mt-4">
      <header className="relative overflow-hidden border-b border-border"
        style={{ background: `linear-gradient(160deg, color-mix(in srgb, ${accent} 28%, transparent), transparent 70%)` }}>
        <div className="flex items-center justify-between px-2 pt-2">
          <Link href={routes.clubs} aria-label="Về danh sách CLB"
            className="grid size-11 place-items-center rounded-full text-fg-muted hover:bg-surface-2 hover:text-fg">
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
          {isMember && (
            <Link href={`${base}/settings`} aria-label="Cài đặt CLB"
              className="grid size-11 place-items-center rounded-full text-fg-muted hover:bg-surface-2 hover:text-fg">
              <Settings className="size-5" aria-hidden />
            </Link>
          )}
        </div>
        <div className="flex items-end gap-4 px-4 pb-4">
          <ClubAvatar club={club} size="lg" className="shadow-lg" />
          <div className="min-w-0 pb-1">
            <h1 className="flex items-center gap-2 text-xl font-bold leading-tight sm:text-2xl">
              <span className="line-clamp-2 break-words">{club.name}</span>
              {club.plan === 'PRO' && <span className="shrink-0 rounded-full bg-coin/20 px-2 py-0.5 text-[11px] font-bold text-coin">PRO</span>}
            </h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-fg-muted">
              <Users className="size-4" aria-hidden />
              <span className="font-mono tabular">{formatNumber(club.member_count)}</span> thành viên
            </p>
          </div>
        </div>
      </header>

      {isMember ? (
        <>
          <nav aria-label="Các mục của CLB"
            className="sticky top-[var(--topbar-h)] z-30 flex gap-0.5 overflow-x-auto border-b border-border bg-bg/95 px-2 backdrop-blur-md scrollbar-none [mask-image:linear-gradient(to_right,black_88%,transparent)]">
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
          </nav>
          <div className="px-4 pt-4">{children}</div>
        </>
      ) : (
        <div className="px-4 pt-4"><JoinGate clubId={clubId} status={membership?.status ?? null} /></div>
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
  const policy = JOIN_POLICY_LABEL[club.join_policy]

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
