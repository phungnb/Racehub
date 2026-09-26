'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock, KeyRound, Lock, MessagesSquare, Pin, Plus, Search, Shield, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button, EmptyState, ErrorState, Field, Input, SectionTitle, Sheet, Skeleton, Textarea } from '@/shared/ui'
import { formatNumber, formatRelative } from '@/shared/lib/format'
import { routes } from '@/shared/config/routes'
import { cn } from '@/shared/lib/cn'
import { useDebounced } from '@/shared/lib/search'
import { clubErrorMessage, createClub, joinClubByCode, searchClubs } from '../../api/clubApi'
import type { InboxClub } from '../../api/hubApi'
import { JOIN_POLICY_LABEL } from '../../model/roles'
import { useClubInbox } from '../../hooks/useClub'
import { clubKeys } from '../../hooks/keys'
import { ClubAvatar } from './ClubAvatar'

/** Màn CLB: hộp thư các CLB của tôi (kiểu Zalo) + tạo / nhập mã / khám phá CLB */
export function ClubsInboxScreen() {
  const inbox = useClubInbox()
  const [sheet, setSheet] = useState<'create' | 'code' | null>(null)
  const mine = inbox.data ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">CLB</h1>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setSheet('code')}><KeyRound className="size-4" aria-hidden />Nhập mã</Button>
          <Button size="sm" onClick={() => setSheet('create')}><Plus className="size-4" aria-hidden />Tạo CLB</Button>
        </div>
      </div>

      {inbox.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[72px]" />)}</div>
      ) : inbox.isError ? (
        <ErrorState message="Không tải được CLB của bạn." error={inbox.error} onRetry={() => inbox.refetch()} />
      ) : mine.length === 0 ? (
        <EmptyState icon={Shield} title="Bạn chưa ở CLB nào"
          description="CLB là nơi cả nhóm trò chuyện, xem ai chạy nhiều nhất tuần và cùng làm thử thách. Tạo CLB mới hoặc nhập mã mời từ bạn bè."
          action={<Button onClick={() => setSheet('code')}><KeyRound className="size-4" aria-hidden />Nhập mã mời</Button>} />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          {mine.map((c) => <InboxRow key={c.club_id} c={c} />)}
        </ul>
      )}

      <Discover exclude={new Set(mine.map((c) => c.club_id))} />

      <CreateClubSheet open={sheet === 'create'} onClose={() => setSheet(null)} />
      <JoinByCodeSheet open={sheet === 'code'} onClose={() => setSheet(null)} />
    </div>
  )
}

function InboxRow({ c }: { c: InboxClub }) {
  const pending = c.member_status === 'PENDING'
  const preview = pending
    ? 'Đang chờ ban quản trị duyệt'
    : c.last_message_body
      ? `${c.last_message_author}: ${c.last_message_body}`
      : c.pinned_title ?? 'Chưa có tin nhắn. Gửi lời chào đầu tiên!'
  return (
    <li>
      <Link href={pending ? routes.club(c.club_id) : c.unread_count > 0 ? routes.clubTab(c.club_id, 'chat') : routes.club(c.club_id)}
        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2">
        <ClubAvatar club={{ name: c.name, avatar_url: c.avatar_url, accent_color: c.accent_color }} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-semibold">{c.name}</span>
            {c.last_message_at && !pending && <span className="ml-auto shrink-0 text-xs text-fg-subtle">{formatRelative(c.last_message_at)}</span>}
          </span>
          <span className="mt-0.5 flex items-center gap-2">
            {pending ? <Clock className="size-3.5 shrink-0 text-warning" aria-hidden />
              : !c.last_message_body && c.pinned_title ? <Pin className="size-3.5 shrink-0 text-coin" aria-hidden /> : null}
            <span className={c.unread_count > 0 ? 'truncate text-sm font-medium text-fg' : 'truncate text-sm text-fg-muted'}>{preview}</span>
            {c.unread_count > 0 && (
              <span className="ml-auto grid min-w-5 shrink-0 place-items-center rounded-full bg-live px-1.5 font-mono text-xs leading-5 text-white">
                {c.unread_count > 99 ? '99+' : c.unread_count}
              </span>
            )}
          </span>
        </span>
      </Link>
    </li>
  )
}

function Discover({ exclude }: { exclude: Set<string> }) {
  const [q, setQ] = useState('')
  const term = useDebounced(q.trim())
  const res = useQuery({ queryKey: clubKeys.search(term), queryFn: () => searchClubs(term, 30), staleTime: 60_000, placeholderData: keepPreviousData })
  const list = (res.data ?? []).filter((c) => !exclude.has(c.id))
  return (
    <section>
      <SectionTitle>Khám phá CLB</SectionTitle>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên CLB" aria-label="Tìm CLB" className="pl-9" />
      </div>
      {res.isLoading ? (
        <div className="grid grid-cols-4 gap-x-2 gap-y-4">{Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5"><Skeleton className="size-14 rounded-2xl" /><Skeleton className="h-3 w-12" /></div>))}</div>
      ) : res.isError ? (
        <ErrorState error={res.error} onRetry={() => res.refetch()} />
      ) : list.length === 0 ? (
        <p className="py-6 text-center text-sm text-fg-muted">{term ? `Không tìm thấy CLB nào khớp "${term}". Thử gõ không dấu hoặc vài chữ trong tên.` : 'Chưa có CLB công khai nào.'}</p>
      ) : (
        <ul className={cn('grid grid-cols-4 gap-x-2 gap-y-4 transition-opacity', res.isPlaceholderData && 'opacity-60')}>
          {list.map((c) => (
            <li key={c.id}>
              <Link href={routes.club(c.id)} className="group flex flex-col items-center gap-1.5 text-center"
                title={`${c.name} · ${formatNumber(c.member_count)} thành viên · ${(JOIN_POLICY_LABEL[c.join_policy] ?? JOIN_POLICY_LABEL.OPEN).title}`}>
                <span className="relative">
                  <ClubAvatar club={c} className="size-14 rounded-2xl transition-transform group-hover:scale-105 group-active:scale-95" />
                  {c.join_policy !== 'OPEN' && (
                    <span className="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full border-2 border-bg bg-surface-2 text-fg-muted"
                      aria-label={(JOIN_POLICY_LABEL[c.join_policy] ?? JOIN_POLICY_LABEL.OPEN).title}>
                      {c.join_policy === 'INVITE_ONLY' ? <Lock className="size-2.5" aria-hidden /> : <Clock className="size-2.5" aria-hidden />}
                    </span>
                  )}
                </span>
                <span className="line-clamp-2 w-full break-words text-[11px] font-semibold leading-tight">{c.name}</span>
                <span className="-mt-1 flex items-center gap-0.5 text-[10px] text-fg-muted"><Users className="size-3" aria-hidden />{formatCompact(c.member_count)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** 1234 → "1,2k" */
function formatCompact(n: number) {
  return n >= 1000 ? `${(n / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}k` : String(n)
}

function CreateClubSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const router = useRouter()
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const create = useMutation({
    mutationFn: () => createClub(name.trim(), desc.trim() || undefined),
    onSuccess: (club) => {
      toast.success('Đã tạo CLB. Mời mọi người vào thôi!')
      void qc.invalidateQueries({ queryKey: clubKeys.inbox })
      onClose()
      router.push(routes.clubTab(club.id, 'members'))
    },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  return (
    <Sheet open={open} onClose={onClose} title="Tạo CLB mới" description="Bạn sẽ là Chủ nhiệm. Có thể đổi tên, logo và màu CLB sau."
      footer={<Button block onClick={() => create.mutate()} loading={create.isPending} disabled={!name.trim()}>Tạo CLB</Button>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate() }}>
        <Field label="Tên CLB" htmlFor="club-name" hint={`${name.trim().length}/60`}>
          <Input id="club-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="VD: Hồ Tây Runners" autoComplete="off" />
        </Field>
        <Field label="Giới thiệu (không bắt buộc)" htmlFor="club-desc" hint={`${desc.length}/300`}>
          <Textarea id="club-desc" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={300}
            placeholder="Lịch chạy cố định, điểm tập trung, ai nên tham gia…" />
        </Field>
      </form>
    </Sheet>
  )
}

function JoinByCodeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const router = useRouter()
  const [code, setCode] = useState('')
  const join = useMutation({
    mutationFn: () => joinClubByCode(code.includes('/') ? code.trim().split('/').pop()! : code),
    onSuccess: (m) => {
      toast.success(m.status === 'APPROVED' ? 'Đã vào CLB!' : 'Đã gửi yêu cầu, chờ ban quản trị duyệt.')
      void qc.invalidateQueries({ queryKey: clubKeys.inbox })
      onClose()
      router.push(m.status === 'APPROVED' ? routes.clubTab(m.club_id, 'chat') : routes.club(m.club_id))
    },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  return (
    <Sheet open={open} onClose={onClose} title="Nhập mã mời" description="Dán mã hoặc link mời mà ban quản trị CLB gửi cho bạn."
      footer={<Button block onClick={() => join.mutate()} loading={join.isPending} disabled={!code.trim()}>Vào CLB</Button>}>
      <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) join.mutate() }}>
        <Field label="Mã hoặc link mời" htmlFor="club-code">
          <Input id="club-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="VD: 3f9a1c2b7d4e"
            autoCapitalize="off" autoComplete="off" spellCheck={false} className="font-mono" />
        </Field>
      </form>
      <p className="mt-4 flex items-start gap-2 text-sm text-fg-muted">
        <MessagesSquare className="mt-0.5 size-4 shrink-0" aria-hidden />
        Vào CLB là bạn thấy ngay bảng tin, nhóm chat và BXH tuần của cả nhóm.
      </p>
    </Sheet>
  )
}
