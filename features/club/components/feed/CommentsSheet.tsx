'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SendHorizontal, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, ErrorState, Input, Sheet, Skeleton } from '@/shared/ui'
import { formatRelative } from '@/shared/lib/format'
import { clubErrorMessage } from '../../api/clubApi'
import { addComment, deleteComment, listComments, type ClubPost } from '../../api/postsApi'
import { clubKeys } from '../../hooks/keys'

export function CommentsSheet({ post, meId, isStaff, onClose }: { post: ClubPost | null; meId: string; isStaff: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const postId = post?.id ?? ''
  const q = useQuery({ queryKey: clubKeys.comments(postId), queryFn: () => listComments(postId), enabled: !!post })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: clubKeys.comments(postId) })
    if (post) {
      void qc.invalidateQueries({ queryKey: clubKeys.posts(post.club_id) })
      void qc.invalidateQueries({ queryKey: clubKeys.pinned(post.club_id) })
    }
  }
  const add = useMutation({
    mutationFn: () => addComment(postId, text.trim()),
    onSuccess: () => { setText(''); refresh() },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  const del = useMutation({ mutationFn: deleteComment, onSuccess: refresh, onError: (e) => toast.error(clubErrorMessage(e)) })

  return (
    <Sheet open={!!post} onClose={onClose} title="Bình luận"
      footer={
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) add.mutate() }}>
          <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="Viết bình luận…" aria-label="Bình luận" />
          <Button type="submit" aria-label="Gửi" loading={add.isPending} disabled={!text.trim()} className="w-11 shrink-0 px-0">
            {!add.isPending && <SendHorizontal className="size-5" aria-hidden />}
          </Button>
        </form>
      }>
      {q.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <p className="py-8 text-center text-sm text-fg-muted">Chưa có bình luận. Hãy là người đầu tiên!</p>
      ) : (
        <ul className="space-y-3">
          {q.data.map((c) => (
            <li key={c.id} className="flex gap-3">
              <Avatar src={c.author?.avatar_url} name={c.author?.display_name} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="rounded-2xl rounded-tl-md bg-surface-2 px-3 py-2">
                  <p className="text-sm font-semibold">{c.author?.display_name ?? 'Thành viên cũ'}</p>
                  <p className="whitespace-pre-line break-words text-[15px]">{c.body}</p>
                </div>
                <p className="mt-1 px-1 text-xs text-fg-subtle">{formatRelative(c.created_at)}</p>
              </div>
              {(c.author_id === meId || isStaff) && (
                <button onClick={() => del.mutate(c.id)} aria-label="Xóa bình luận"
                  className="grid size-9 shrink-0 place-items-center rounded-full text-fg-subtle hover:bg-surface-2 hover:text-danger">
                  <Trash2 className="size-4" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}
