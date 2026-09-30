'use client'

import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CommentComposer, CommentList, ErrorState, Sheet, Skeleton, type ReplyTarget, type ThreadComment } from '@/shared/ui'
import { clubErrorMessage } from '../../api/clubApi'
import { addComment, deleteComment, editComment, listComments, toggleCommentLike, type ClubPost } from '../../api/postsApi'
import { clubKeys } from '../../hooks/keys'

/** Bình luận một bài trên bảng tin CLB: thích, trả lời; nút ⋯: sửa (người viết), xóa (người viết / ban quản trị, luôn hỏi lại) */
export function CommentsSheet({ post, meId, isStaff, onClose }: { post: ClubPost | null; meId: string; isStaff: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const postId = post?.id ?? ''
  const key = clubKeys.comments(postId)
  const q = useQuery({ queryKey: key, queryFn: () => listComments(postId, meId, isStaff), enabled: !!post })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key })
    void qc.invalidateQueries({ queryKey: clubKeys.community })
    if (post) {
      void qc.invalidateQueries({ queryKey: clubKeys.posts(post.club_id) })
      void qc.invalidateQueries({ queryKey: clubKeys.pinned(post.club_id) })
    }
  }
  const add = useMutation({
    mutationFn: (t?: string) => addComment(postId, (t ?? text).trim(), replyTo?.id ?? null),
    // Gửi nhanh (cổ vũ / sticker) không xóa chữ đang gõ dở
    onSuccess: (_r, t) => { if (t === undefined) setText(''); setReplyTo(null); refresh() },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  const del = useMutation({ mutationFn: deleteComment, onSuccess: refresh, onError: (e) => toast.error(clubErrorMessage(e)) })
  const edit = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => editComment(id, body),
    onSuccess: () => { toast.success('Đã sửa bình luận'); void qc.invalidateQueries({ queryKey: key }) },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  // Thích: đổi ngay trên màn hình, máy chủ trả số chính xác sau
  const like = useMutation({
    mutationFn: (c: ThreadComment) => toggleCommentLike(c.id),
    onMutate: (c) => qc.setQueryData<ThreadComment[]>(key, (list) => list?.map((x) => x.id === c.id
      ? { ...x, liked: !x.liked, likeCount: Math.max(0, x.likeCount + (x.liked ? -1 : 1)) } : x)),
    onSuccess: (r, c) => qc.setQueryData<ThreadComment[]>(key, (list) => list?.map((x) => (x.id === c.id ? { ...x, liked: r.liked, likeCount: r.count } : x))),
    onError: (e) => { toast.error(clubErrorMessage(e)); void qc.invalidateQueries({ queryKey: key }) },
  })
  const reply = (t: ReplyTarget) => { setReplyTo(t); requestAnimationFrame(() => input.current?.focus()) }
  const close = () => { setReplyTo(null); onClose() }

  return (
    <Sheet open={!!post} onClose={close} title="Bình luận"
      footer={<CommentComposer ref={input} value={text} onChange={setText} onSubmit={(t) => add.mutate(t)} pending={add.isPending}
        replyTo={replyTo} onCancelReply={() => setReplyTo(null)} />}>
      {q.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <p className="py-8 text-center text-sm text-fg-muted">Chưa có bình luận. Hãy là người đầu tiên!</p>
      ) : (
        <CommentList comments={q.data} onLike={(c) => like.mutate(c)} onReply={reply} onDelete={(c) => del.mutate(c.id)}
          onEdit={(c, body) => edit.mutateAsync({ id: c.id, body })} />
      )}
    </Sheet>
  )
}
