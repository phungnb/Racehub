'use client'

import { forwardRef, useState, type FormEvent } from 'react'
import { MoreHorizontal, SendHorizontal, ThumbsUp, X } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { formatRelative } from '@/shared/lib/format'
import { Avatar } from './Avatar'
import { Button } from './Button'
import { Input } from './Field'
import { ConfirmSheet } from './Sheet'
import { ExpressionPanel, ExpressionToggle, ExpressiveBody, QuickCheers } from './Expressions'

/** Một bình luận (dùng chung bảng tin CLB, Doanh nghiệp…) */
export interface ThreadComment {
  id: string
  parentId: string | null
  authorName: string | null
  authorAvatar: string | null
  body: string
  createdAt: string
  likeCount: number
  liked: boolean
  /** người viết hoặc ban quản trị */
  canDelete: boolean
  mine: boolean
}
export interface ReplyTarget { id: string; name: string }

/**
 * Danh sách bình luận kiểu mạng xã hội: dưới mỗi bình luận là "Thích · Trả lời · thời gian";
 * trả lời thụt vào dưới bình luận gốc; xóa nằm trong nút ⋯ (chỉ người viết / ban quản trị) và luôn hỏi lại.
 */
export function CommentList({ comments, onLike, onReply, onDelete, compact = false }: {
  comments: ThreadComment[]
  onLike: (c: ThreadComment) => void
  onReply: (target: ReplyTarget) => void
  onDelete: (c: ThreadComment) => void
  compact?: boolean
}) {
  const [confirm, setConfirm] = useState<ThreadComment | null>(null)
  const ids = new Set(comments.map((c) => c.id))
  // Bình luận gốc đã bị xóa → câu trả lời hiện như bình luận thường
  const roots = comments.filter((c) => !c.parentId || !ids.has(c.parentId))
  const replies = (id: string) => comments.filter((c) => c.parentId === id)
  const item = (c: ThreadComment, reply: boolean) => (
    <CommentItem key={c.id} c={c} reply={reply} compact={compact} onLike={onLike} onMore={setConfirm}
      onReply={() => onReply({ id: c.id, name: c.authorName ?? 'Thành viên' })} />
  )
  return (
    <>
      <ul className={compact ? 'space-y-2' : 'space-y-3'}>
        {roots.map((c) => (
          <li key={c.id} className="space-y-2">
            {item(c, false)}
            {replies(c.id).length > 0 && <ul className={cn('space-y-2', compact ? 'pl-8' : 'pl-11')}>{replies(c.id).map((r) => <li key={r.id}>{item(r, true)}</li>)}</ul>}
          </li>
        ))}
      </ul>
      <ConfirmSheet open={!!confirm} onClose={() => setConfirm(null)} confirmLabel="Xóa bình luận"
        title={confirm?.mine ? 'Xóa bình luận của bạn?' : `Xóa bình luận của ${confirm?.authorName ?? 'thành viên'}?`}
        description={confirm?.mine ? 'Bình luận sẽ biến mất khỏi bài viết.' : 'Bạn đang xóa với quyền quản trị. Bình luận sẽ bị gỡ khỏi bài viết.'}
        onConfirm={() => { if (confirm) onDelete(confirm); setConfirm(null) }} />
    </>
  )
}

function CommentItem({ c, reply, compact, onLike, onReply, onMore }: {
  c: ThreadComment; reply: boolean; compact: boolean; onLike: (c: ThreadComment) => void; onReply: () => void; onMore: (c: ThreadComment) => void
}) {
  const expressive = ExpressiveBody({ body: c.body })
  return (
    <div className="flex gap-2.5">
      <Avatar src={c.authorAvatar} name={c.authorName} size={reply || compact ? 'xs' : 'sm'} />
      <div className="min-w-0 flex-1">
        <div className={cn('relative inline-block max-w-full rounded-2xl rounded-tl-md px-3 py-2', expressive ? 'pb-3' : 'bg-surface-2')}>
          <p className="text-sm font-semibold">{c.authorName ?? 'Thành viên cũ'}</p>
          {expressive ?? <p className="whitespace-pre-line break-words text-[15px]">{c.body}</p>}
          {c.likeCount > 0 && (
            <span className="absolute -bottom-2.5 right-2 inline-flex items-center gap-1 rounded-full border border-border bg-surface px-1.5 py-0.5 text-[11px] font-semibold shadow-sm">
              <ThumbsUp className="size-3 fill-brand text-brand" aria-hidden />{c.likeCount}
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-4 px-1 text-xs font-semibold text-fg-subtle">
          <span className="font-normal">{formatRelative(c.createdAt)}</span>
          <button type="button" onClick={() => onLike(c)} aria-pressed={c.liked} className={cn('py-1', c.liked && 'text-brand')}>Thích</button>
          <button type="button" onClick={onReply} className="py-1">Trả lời</button>
          {c.canDelete && (
            <button type="button" onClick={() => onMore(c)} aria-label="Tùy chọn bình luận" className="ml-auto grid size-7 place-items-center rounded-full hover:bg-surface-2">
              <MoreHorizontal className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Ô viết bình luận; đang trả lời ai thì hiện dòng "Đang trả lời …" có nút hủy.
 * Ô trống: hiện hàng câu cổ vũ nhanh (chạm là gửi). Nút mặt cười: emoji + sticker động.
 */
export const CommentComposer = forwardRef<HTMLInputElement, {
  value: string; onChange: (v: string) => void; onSubmit: (text?: string) => void; pending?: boolean
  replyTo: ReplyTarget | null; onCancelReply: () => void; compact?: boolean
}>(function CommentComposer({ value, onChange, onSubmit, pending, replyTo, onCancelReply, compact }, ref) {
  const [panel, setPanel] = useState(false)
  const submit = (e: FormEvent) => { e.preventDefault(); if (value.trim()) onSubmit() }
  const sendNow = (text: string) => { setPanel(false); if (!pending) onSubmit(text) }
  return (
    <div className="space-y-1.5">
      {replyTo && (
        <p className="flex items-center gap-2 px-1 text-xs text-fg-muted">
          Đang trả lời <b className="text-fg">{replyTo.name}</b>
          <button type="button" onClick={onCancelReply} aria-label="Hủy trả lời" className="grid size-6 place-items-center rounded-full hover:bg-surface-2"><X className="size-3.5" aria-hidden /></button>
        </p>
      )}
      {panel ? (
        <ExpressionPanel showCheers={false} onEmoji={(e) => onChange(value + e)} onSend={sendNow} />
      ) : !value.trim() && (
        <QuickCheers onPick={sendNow} disabled={pending} />
      )}
      <form className="flex gap-1.5" onSubmit={submit}>
        <ExpressionToggle open={panel} onToggle={() => setPanel((o) => !o)} className={compact ? 'size-11' : undefined} />
        <Input ref={ref} value={value} onChange={(e) => onChange(e.target.value)} maxLength={1000}
          placeholder={replyTo ? `Trả lời ${replyTo.name}…` : 'Viết bình luận…'} aria-label="Bình luận" />
        <Button type="submit" aria-label="Gửi" loading={pending} disabled={!value.trim()} className={cn('shrink-0 px-0', compact ? 'h-11 w-11' : 'w-11')}>
          {!pending && <SendHorizontal className="size-5" aria-hidden />}
        </Button>
      </form>
    </div>
  )
})
