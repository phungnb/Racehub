'use client'

import Link from 'next/link'
import { useLayoutEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Ban, Copy, Flag, MoreVertical, SendHorizontal, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, BackLink, Button, ConfirmSheet, ErrorState, ExpressionPanel, ExpressionToggle, ExpressiveBody, Sheet, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import {
  blockRunner, deleteDirectMessage, DM_REACTIONS, getDirectThread, reactDirectMessage, sendDirectMessage, socialErrorMessage, unblockRunner, type DirectMessage, type DirectThread,
} from '../api/socialApi'
import { socialKeys } from '../hooks/keys'
import { ReportRunnerSheet } from './ReportRunnerSheet'

const time = (iso: string) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
const day = (iso: string) => new Date(iso).toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric' })

/** Trò chuyện 1-1 với một runner: tự làm mới 5 giây / lần, thu hồi tin của mình, chặn / báo cáo */
export function DirectChatScreen({ userId }: { userId: string }) {
  const qc = useQueryClient()
  const key = socialKeys.thread(userId)
  const q = useQuery({ queryKey: key, queryFn: () => getDirectThread(userId), refetchInterval: 5_000 })
  const [action, setAction] = useState<DirectMessage | null>(null)
  const [sheet, setSheet] = useState<'menu' | 'report' | 'block' | null>(null)
  const [reportNote, setReportNote] = useState('')
  const bottom = useRef<HTMLDivElement>(null)
  const t = q.data
  const name = t?.user.display_name ?? 'Runner'
  const lastId = t?.messages[t.messages.length - 1]?.id

  useLayoutEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }) }, [lastId])

  const refreshAround = () => {
    void qc.invalidateQueries({ queryKey: socialKeys.inbox })
    void qc.invalidateQueries({ queryKey: socialKeys.unread })
  }
  const send = useMutation({
    mutationFn: (body: string) => sendDirectMessage(userId, body),
    onSuccess: (m) => {
      qc.setQueryData<DirectThread>(key, (old) => (old ? { ...old, messages: [...old.messages.filter((x) => x.id !== m.id), m] } : old))
      refreshAround()
    },
    onError: (e) => toast.error(socialErrorMessage(e)),
  })
  const recall = useMutation({
    mutationFn: deleteDirectMessage,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: key }); refreshAround() },
    onError: (e) => toast.error(socialErrorMessage(e)),
  })
  const react = useMutation({
    mutationFn: ({ id, emoji }: { id: string; emoji: string }) => reactDirectMessage(id, emoji),
    onMutate: ({ id, emoji }) => {
      // Cập nhật lạc quan: đổi / bỏ cảm xúc của mình ngay
      qc.setQueryData<DirectThread>(key, (old) => old && ({
        ...old,
        messages: old.messages.map((m) => (m.id === id ? { ...m, reactions: toggleReaction(m.reactions ?? [], emoji) } : m)),
      }))
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(socialErrorMessage(e)),
  })
  const block = useMutation({
    mutationFn: () => (t?.blocked_by_me ? unblockRunner(userId) : blockRunner(userId)),
    onSuccess: () => { toast.success(t?.blocked_by_me ? `Đã bỏ chặn ${name}` : `Đã chặn ${name}`); setSheet(null); void qc.invalidateQueries({ queryKey: ['social'] }) },
    onError: (e) => toast.error(socialErrorMessage(e)),
  })

  // Chưa đọc được: hồ sơ không tồn tại / máy chủ chưa cập nhật
  if (q.isError) return <div className="space-y-4"><BackLink fallback={routes.messages} /><ErrorState message="Không mở được cuộc trò chuyện." error={q.error} onRetry={() => void q.refetch()} /></div>

  return (
    <div className="pb-32">
      <header className="sticky top-[var(--topbar-h)] z-30 -mx-4 flex items-center gap-2 border-b border-border bg-bg/90 px-2 py-1.5 backdrop-blur-md">
        <Link href={routes.messages} aria-label="Về hộp thư" className="grid size-11 shrink-0 place-items-center rounded-full text-fg-muted hover:bg-surface-2">
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
        {t ? (
          <Link href={routes.athlete(userId)} className="flex min-w-0 flex-1 items-center gap-2">
            <Avatar src={t.user.avatar_url} name={t.user.display_name} size="sm" />
            <span className="truncate font-bold">{name}</span>
          </Link>
        ) : <Skeleton className="h-8 flex-1" />}
        <button type="button" onClick={() => setSheet('menu')} aria-label="Tùy chọn" className="grid size-11 place-items-center rounded-full text-fg-muted hover:bg-surface-2">
          <MoreVertical className="size-5" aria-hidden />
        </button>
      </header>

      {!t ? (
        <div className="mt-4 space-y-3">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className={cn('h-10 w-2/3', i % 2 && 'ml-auto')} />)}</div>
      ) : (
        <div role="log" aria-live="polite" aria-label={`Tin nhắn với ${name}`} className="mt-3 space-y-1">
          {t.messages.length === 0 && (
            <p className="py-10 text-center text-sm text-fg-muted">Gửi lời chào tới {name} 👋<br />Rủ nhau chạy sáng mai chẳng hạn!</p>
          )}
          {t.messages.map((m, i) => {
            const prev = t.messages[i - 1]
            const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString()
            return (
              <div key={m.id}>
                {newDay && <p className="py-3 text-center text-xs font-medium capitalize text-fg-subtle">{day(m.created_at)}</p>}
                <Bubble m={m} onAction={() => setAction(m)} onReact={(emoji) => react.mutate({ id: m.id, emoji })} />
              </div>
            )
          })}
        </div>
      )}
      <div ref={bottom} className="scroll-mb-40" />

      {t && (t.can_message ? (
        <Composer pending={send.isPending} onSend={(b) => send.mutate(b)} />
      ) : (
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md border-t border-border bg-bg/95 px-4 py-3 text-center text-sm text-fg-muted backdrop-blur-md">
          {t.blocked
            ? (t.blocked_by_me ? 'Bạn đã chặn người này. Bỏ chặn trong nút ⋮ để nhắn tiếp.' : 'Bạn không thể nhắn cho người này.')
            : `Bạn chỉ nhắn được khi ${name} theo dõi bạn, là bạn kết nối, cùng CLB hoặc đã nhắn cho bạn trước.`}
        </div>
      ))}

      <Sheet open={!!action} onClose={() => setAction(null)} title="Tin nhắn">
        {action && !action.deleted && (
          <div className="grid gap-2">
            <div role="group" aria-label="Thả cảm xúc" className="mb-1 flex justify-between gap-1 rounded-2xl bg-surface-2 p-1.5">
              {DM_REACTIONS.map((e) => {
                const mine = action.reactions?.some((r) => r.mine && r.emoji === e)
                return (
                  <button key={e} type="button" aria-pressed={!!mine} aria-label={`Thả ${e}`}
                    onClick={() => { react.mutate({ id: action.id, emoji: e }); setAction(null) }}
                    className={cn('grid size-10 place-items-center rounded-full text-2xl transition-transform active:scale-90', mine && 'bg-brand/15 ring-2 ring-brand')}>
                    {e}
                  </button>
                )
              })}
            </div>
            <Button variant="secondary" block onClick={() => { void navigator.clipboard?.writeText(action.body ?? '').then(() => toast('Đã sao chép')); setAction(null) }}>
              <Copy className="size-4" aria-hidden />Sao chép
            </Button>
            {action.mine && (
              <Button variant="danger" block onClick={() => { recall.mutate(action.id); setAction(null) }}>
                <Trash2 className="size-4" aria-hidden />Thu hồi
              </Button>
            )}
            {!action.mine && (
              <Button variant="secondary" block onClick={() => { setReportNote(`Tin nhắn lúc ${time(action.created_at)}: "${action.body ?? ''}"`); setAction(null); setSheet('report') }}>
                <Flag className="size-4" aria-hidden />Báo cáo tin nhắn này
              </Button>
            )}
          </div>
        )}
      </Sheet>
      <Sheet open={sheet === 'menu'} onClose={() => setSheet(null)} title={name}>
        <div className="grid gap-2">
          <Link href={routes.athlete(userId)}><Button variant="secondary" block>Xem hồ sơ</Button></Link>
          <Button variant="secondary" block onClick={() => { setReportNote(''); setSheet('report') }}><Flag className="size-4" aria-hidden />Báo cáo</Button>
          <Button variant="danger" block onClick={() => setSheet('block')}><Ban className="size-4" aria-hidden />{t?.blocked_by_me ? 'Bỏ chặn' : 'Chặn'}</Button>
        </div>
      </Sheet>
      <ConfirmSheet open={sheet === 'block'} onClose={() => setSheet(null)} title={t?.blocked_by_me ? `Bỏ chặn ${name}?` : `Chặn ${name}?`}
        confirmLabel={t?.blocked_by_me ? 'Bỏ chặn' : 'Chặn'} loading={block.isPending} onConfirm={() => block.mutate()}
        description={t?.blocked_by_me ? 'Hai bạn lại có thể nhắn tin (nếu đủ điều kiện).' : 'Hai bạn không nhắn tin, không theo dõi nhau được nữa. Người kia không được báo.'} />
      {sheet === 'report' && <ReportRunnerSheet userId={userId} name={name} context="DM" initialNote={reportNote} onClose={() => setSheet(null)} />}
    </div>
  )
}

function toggleReaction(list: NonNullable<DirectMessage['reactions']>, emoji: string) {
  const had = list.find((r) => r.mine)?.emoji
  const next = list
    .map((r) => (r.mine ? { ...r, count: r.count - 1, mine: false } : r))
    .filter((r) => r.count > 0)
  if (had === emoji) return next
  const hit = next.find((r) => r.emoji === emoji)
  return hit ? next.map((r) => (r === hit ? { ...r, count: r.count + 1, mine: true } : r)) : [...next, { emoji, count: 1, mine: true }]
}

function Bubble({ m, onAction, onReact }: { m: DirectMessage; onAction: () => void; onReact: (emoji: string) => void }) {
  const expressive = !m.deleted && m.body ? ExpressiveBody({ body: m.body, align: m.mine ? 'end' : 'start' }) : null
  return (
    <div className={cn('flex', m.mine ? 'justify-end' : 'justify-start')}>
      <div className={cn('flex max-w-[78%] flex-col', m.mine ? 'items-end' : 'items-start')}>
        <button type="button" onClick={onAction} onContextMenu={(e) => { e.preventDefault(); onAction() }}
          aria-label={`${m.mine ? 'Tin của bạn' : 'Tin nhắn'}, ${time(m.created_at)}. Chạm để xem tùy chọn`}
          className={cn('select-text rounded-2xl px-3.5 py-2 text-left text-[15px] leading-snug',
            m.deleted ? 'border border-dashed border-border bg-transparent italic text-fg-subtle'
              : expressive ? 'bg-transparent px-0 py-0' : m.mine ? 'rounded-br-md bg-brand text-brand-fg' : 'rounded-bl-md bg-surface-2 text-fg')}>
          {m.deleted ? 'Tin nhắn đã được thu hồi' : expressive ?? <span className="whitespace-pre-line break-words">{m.body}</span>}
        </button>
        {!m.deleted && !!m.reactions?.length && (
          <div className="-mt-1.5 flex flex-wrap gap-1 px-1">
            {m.reactions.map((r) => (
              <button key={r.emoji} type="button" onClick={() => onReact(r.emoji)} aria-pressed={r.mine}
                aria-label={`${r.emoji} ${r.count}${r.mine ? ', của bạn — chạm để bỏ' : ''}`}
                className={cn('flex h-6 items-center gap-0.5 rounded-full border bg-surface px-1.5 text-sm leading-none shadow-sm',
                  r.mine ? 'border-brand' : 'border-border')}>
                <span aria-hidden>{r.emoji}</span>{r.count > 1 && <span className="text-[11px] font-semibold text-fg-muted">{r.count}</span>}
              </button>
            ))}
          </div>
        )}
        <span className="mt-0.5 px-1 text-[11px] text-fg-subtle">{time(m.created_at)}</span>
      </div>
    </div>
  )
}

function Composer({ pending, onSend }: { pending: boolean; onSend: (body: string) => void }) {
  const [text, setText] = useState('')
  const [panel, setPanel] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`
  }, [text])
  const submit = () => {
    const body = text.trim()
    if (!body || pending) return
    onSend(body)
    setText('')
  }
  return (
    <div className="fixed inset-x-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md border-t border-border bg-bg/95 px-3 py-2 backdrop-blur-md">
      {panel && <ExpressionPanel className="mb-2" onEmoji={(e) => setText((x) => x + e)} onSend={(b) => { setPanel(false); onSend(b) }} />}
      <form className="flex items-end gap-1.5" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <ExpressionToggle open={panel} onToggle={() => setPanel((o) => !o)} />
        <textarea ref={ref} value={text} rows={1} maxLength={2000} aria-label="Soạn tin nhắn" placeholder="Nhắn tin…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) {
              e.preventDefault()
              submit()
            }
          }}
          className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-[15px] leading-snug placeholder:text-fg-subtle focus:border-brand focus:outline-none" />
        <Button type="submit" aria-label="Gửi" loading={pending} disabled={!text.trim()} className="size-11 shrink-0 rounded-full px-0">
          {!pending && <SendHorizontal className="size-5" aria-hidden />}
        </Button>
      </form>
    </div>
  )
}
