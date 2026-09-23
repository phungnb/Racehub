'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Copy, CornerUpLeft, Loader2, MessagesSquare, RotateCcw, SendHorizontal, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, EmptyState, ErrorState, Sheet, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { clubErrorMessage } from '../../api/clubApi'
import type { ChatMessage } from '../../api/chatApi'
import { applyMention, findMentions, groupMessages, mentionQuery } from '../../model/chat'
import { accentOf } from '../../model/roles'
import { useClub, useClubMembers } from '../../hooks/useClub'
import { useClubChat } from '../../hooks/useClubChat'
import { MenuItem } from '../feed/PostCard'

interface Person { id: string; name: string; avatar: string | null }

const time = (iso: string) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })

export function ClubChatScreen({ clubId }: { clubId: string }) {
  const { uid, club, isStaff, isMember } = useClub(clubId)
  const members = useClubMembers(clubId)
  const chat = useClubChat(clubId, isMember)
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [action, setAction] = useState<ChatMessage | null>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const restore = useRef<number | null>(null)

  const people = useMemo(() => {
    const map = new Map<string, Person>()
    for (const m of members.data ?? []) {
      map.set(m.user_id, { id: m.user_id, name: m.profile?.display_name?.trim() || 'Thành viên', avatar: m.profile?.avatar_url ?? null })
    }
    return map
  }, [members.data])
  const approved = useMemo(() => (members.data ?? []).filter((m) => m.status === 'APPROVED'), [members.data])
  const items = useMemo(() => groupMessages(chat.messages), [chat.messages])
  const byId = useMemo(() => new Map(chat.messages.map((m) => [m.id, m])), [chat.messages])

  // Theo dõi người dùng có đang ở gần cuối không (để tự cuộn khi có tin mới)
  useEffect(() => {
    const onScroll = () => { nearBottom.current = window.innerHeight + window.scrollY >= document.body.scrollHeight - 160 }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Tin mới: cuộn xuống nếu đang ở cuối hoặc là tin của mình. Tải tin cũ: giữ nguyên vị trí đang đọc.
  const last = chat.messages[chat.messages.length - 1]
  useLayoutEffect(() => {
    if (restore.current !== null) {
      window.scrollTo({ top: document.body.scrollHeight - restore.current })
      restore.current = null
      return
    }
    if (nearBottom.current || last?.author_id === uid) bottom.current?.scrollIntoView({ block: 'end' })
  }, [last?.id, last?.author_id, uid, chat.messages.length])

  const loadOlder = async () => {
    restore.current = document.body.scrollHeight - window.scrollY
    await chat.fetchNextPage()
  }

  const send = useCallback(async (body: string, mentions: string[], retryId?: string, reply?: string | null) => {
    if (!uid) return
    try {
      await chat.send({ body, mentions, replyTo: reply, authorId: uid, retryId })
    } catch (e) {
      toast.error(clubErrorMessage(e))
    }
  }, [chat, uid])

  if (!uid) return null
  const accent = accentOf(club)

  return (
    <div className="pb-28">
      {chat.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className={cn('h-12 w-2/3', i % 2 && 'ml-auto')} />)}
        </div>
      ) : chat.isError ? (
        <ErrorState message="Không tải được tin nhắn." onRetry={() => chat.refetch()} />
      ) : chat.messages.length === 0 ? (
        <EmptyState icon={MessagesSquare} title="Chưa có tin nhắn"
          description="Gửi lời chào, rủ mọi người chạy sáng mai, hoặc nhắc tên ai đó bằng @." />
      ) : (
        <div role="log" aria-live="polite" aria-label="Tin nhắn CLB" className="space-y-0.5">
          {chat.hasNextPage && (
            <div className="flex justify-center pb-3">
              <Button variant="ghost" size="sm" onClick={loadOlder} loading={chat.isFetchingNextPage}>Xem tin cũ hơn</Button>
            </div>
          )}
          {items.map((it) => it.type === 'day'
            ? <p key={it.key} className="py-3 text-center text-xs font-medium text-fg-subtle">{it.label}</p>
            : (
              <Bubble key={it.key} m={it.message} mine={it.message.author_id === uid} start={it.groupStart} end={it.groupEnd}
                author={people.get(it.message.author_id)} accent={accent}
                reply={it.message.reply_to ? byId.get(it.message.reply_to) : undefined} people={people}
                onAction={() => setAction(it.message)}
                onRetry={() => void send(it.message.body, it.message.mentions, it.message.id, it.message.reply_to)} />
            ))}
        </div>
      )}
      <div ref={bottom} className="scroll-mb-40" />

      <ChatComposer members={approved.filter((m) => m.user_id !== uid).map((m) => ({
        user_id: m.user_id, name: m.profile?.display_name?.trim() || '', avatar: m.profile?.avatar_url ?? null,
      }))}
        replyTo={replyTo} replyName={replyTo ? people.get(replyTo.author_id)?.name : undefined} onCancelReply={() => setReplyTo(null)}
        onSend={(body, mentions) => { const r = replyTo?.id ?? null; setReplyTo(null); void send(body, mentions, undefined, r) }} />

      <Sheet open={!!action} onClose={() => setAction(null)} title="Tin nhắn">
        {action && (
          <div className="space-y-1">
            {!action.deleted_at && !action.pending && (
              <MenuItem icon={CornerUpLeft} label="Trả lời" onClick={() => { setReplyTo(action); setAction(null) }} />
            )}
            {!action.deleted_at && (
              <MenuItem icon={Copy} label="Sao chép" onClick={() => {
                void navigator.clipboard?.writeText(action.body).then(() => toast('Đã sao chép'))
                setAction(null)
              }} />
            )}
            {!action.deleted_at && (action.author_id === uid || isStaff) && (
              <MenuItem icon={Trash2} label={action.author_id === uid ? 'Thu hồi' : 'Gỡ tin nhắn (quản trị)'} danger onClick={() => {
                const id = action.id
                setAction(null)
                chat.remove(id).catch((e) => toast.error(clubErrorMessage(e)))
              }} />
            )}
          </div>
        )}
      </Sheet>
    </div>
  )
}

function Bubble({ m, mine, start, end, author, accent, reply, people, onAction, onRetry }: {
  m: ChatMessage; mine: boolean; start: boolean; end: boolean; author?: Person; accent: string
  reply?: ChatMessage; people: Map<string, Person>; onAction: () => void; onRetry: () => void
}) {
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pressStart = () => { hold.current = setTimeout(onAction, 450) }
  const pressEnd = () => { if (hold.current) clearTimeout(hold.current) }

  return (
    <div className={cn('flex items-end gap-2', mine ? 'justify-end' : 'justify-start', start && 'mt-2')}>
      {!mine && <span className="w-8 shrink-0">{end && <Avatar src={author?.avatar} name={author?.name} size="sm" />}</span>}
      <div className={cn('flex max-w-[78%] flex-col', mine ? 'items-end' : 'items-start')}>
        {!mine && start && <span className="mb-0.5 px-3 text-xs font-semibold" style={{ color: accent }}>{author?.name ?? 'Thành viên cũ'}</span>}
        <button type="button" onClick={onAction} onTouchStart={pressStart} onTouchEnd={pressEnd} onTouchMove={pressEnd}
          onContextMenu={(e) => { e.preventDefault(); onAction() }}
          aria-label={`Tin nhắn${author ? ` của ${author.name}` : ''}, ${time(m.created_at)}. Chạm để xem tùy chọn`}
          className={cn('select-text rounded-2xl px-3.5 py-2 text-left text-[15px] leading-snug transition-opacity',
            mine ? 'bg-brand text-brand-fg' : 'bg-surface-2 text-fg',
            mine ? (start ? 'rounded-br-md' : 'rounded-r-md') : (start ? 'rounded-bl-md' : 'rounded-l-md'),
            m.pending === 'sending' && 'opacity-60', m.deleted_at && 'bg-transparent border border-dashed border-border text-fg-subtle italic')}>
          {m.deleted_at ? 'Tin nhắn đã được thu hồi' : (
            <>
              {m.reply_to && (
                <span className={cn('mb-1.5 block border-l-2 pl-2 text-sm', mine ? 'border-brand-fg/40 text-brand-fg/80' : 'border-fg-subtle text-fg-muted')}>
                  <span className="block font-semibold">{reply ? people.get(reply.author_id)?.name ?? 'Thành viên' : 'Tin nhắn trước'}</span>
                  <span className="line-clamp-2">{reply ? (reply.deleted_at ? 'Tin nhắn đã được thu hồi' : reply.body) : '…'}</span>
                </span>
              )}
              <span className="whitespace-pre-line break-words">{highlight(m.body, m.mentions.map((id) => people.get(id)?.name).filter(Boolean) as string[], mine)}</span>
            </>
          )}
        </button>
        {(end || m.pending) && (
          <span className="mt-0.5 flex items-center gap-1 px-1 text-xs text-fg-subtle">
            {m.pending === 'sending' && <><Loader2 className="size-3 animate-spin" aria-hidden />Đang gửi</>}
            {m.pending === 'failed' && (
              <button onClick={onRetry} className="flex items-center gap-1 font-semibold text-danger">
                <RotateCcw className="size-3" aria-hidden />Gửi lỗi · Thử lại
              </button>
            )}
            {!m.pending && time(m.created_at)}
          </span>
        )}
      </div>
    </div>
  )
}

/** Tô đậm "@Tên" của người được nhắc */
function highlight(body: string, names: string[], mine: boolean): ReactNode {
  if (!names.length) return body
  const escaped = names.sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`(@(?:${escaped.join('|')}))`, 'giu')
  return body.split(re).map((part, i) => (i % 2 === 1
    ? <span key={i} className={cn('font-semibold', mine ? 'underline decoration-brand-fg/40' : 'text-xp')}>{part}</span>
    : part))
}

function ChatComposer({ members, replyTo, replyName, onCancelReply, onSend }: {
  members: { user_id: string; name: string; avatar: string | null }[]
  replyTo: ChatMessage | null; replyName?: string; onCancelReply: () => void
  onSend: (body: string, mentions: string[]) => void
}) {
  const [text, setText] = useState('')
  const [caret, setCaret] = useState(0)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { if (replyTo) ref.current?.focus() }, [replyTo])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`
  }, [text])

  const mq = mentionQuery(text, caret)
  const suggestions = mq
    ? members.filter((m) => m.name && m.name.toLocaleLowerCase('vi').includes(mq.query.toLocaleLowerCase('vi'))).slice(0, 5)
    : []

  const submit = () => {
    const body = text.trim()
    if (!body) return
    onSend(body, findMentions(body, members.map((m) => ({ user_id: m.user_id, name: m.name }))))
    setText('')
    setCaret(0)
  }

  const pick = (name: string) => {
    if (!mq) return
    const r = applyMention(text, mq.start, caret, name)
    setText(r.text)
    setCaret(r.caret)
    requestAnimationFrame(() => { ref.current?.focus(); ref.current?.setSelectionRange(r.caret, r.caret) })
  }

  return (
    <div className="fixed inset-x-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md border-t border-border bg-bg/95 px-3 py-2 backdrop-blur-md">
      {suggestions.length > 0 && (
        <ul role="listbox" aria-label="Gợi ý nhắc tên" className="mb-2 overflow-hidden rounded-xl border border-border bg-surface">
          {suggestions.map((m) => (
            <li key={m.user_id}>
              <button type="button" role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(m.name)}
                className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm hover:bg-surface-2">
                <Avatar src={m.avatar} name={m.name} size="xs" />{m.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {replyTo && (
        <div className="mb-2 flex items-center gap-2 rounded-xl bg-surface px-3 py-2">
          <CornerUpLeft className="size-4 shrink-0 text-fg-subtle" aria-hidden />
          <span className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">Trả lời {replyName ?? 'tin nhắn'}</span>
            <span className="block truncate text-fg-muted">{replyTo.body}</span>
          </span>
          <button onClick={onCancelReply} aria-label="Bỏ trả lời" className="grid size-9 place-items-center rounded-full text-fg-subtle hover:bg-surface-2">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}
      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <textarea ref={ref} value={text} rows={1} maxLength={2000} aria-label="Soạn tin nhắn" placeholder="Nhắn cho cả CLB… (@ để nhắc tên)"
          onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart) }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) {
              e.preventDefault()
              submit()
            }
          }}
          className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-[15px] leading-snug placeholder:text-fg-subtle focus:border-brand focus:outline-none" />
        <Button type="submit" aria-label="Gửi" disabled={!text.trim()} className="size-11 shrink-0 rounded-full px-0">
          <SendHorizontal className="size-5" aria-hidden />
        </Button>
      </form>
    </div>
  )
}
