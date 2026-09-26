'use client'

import { useEffect } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { supabase } from '@/shared/lib/supabase'
import { createPost, deletePost, listPinnedPosts, listPosts, pinPost, toggleReaction, type ClubPost } from '../api/postsApi'
import { clubKeys } from './keys'

const PAGE = 15

export function useClubFeed(clubId: string, userId: string | undefined) {
  const qc = useQueryClient()
  const enabled = !!userId

  const pinned = useQuery({ queryKey: clubKeys.pinned(clubId), queryFn: () => listPinnedPosts(clubId, userId!), enabled })
  const posts = useInfiniteQuery({
    queryKey: clubKeys.posts(clubId),
    queryFn: ({ pageParam }) => listPosts(clubId, userId!, pageParam, PAGE),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].created_at : undefined),
    enabled,
  })

  // Bài mới / bị gỡ / đổi ghim → tải lại (bài tự sinh khi thành viên chạy xong cũng về đây)
  useEffect(() => {
    if (!enabled) return
    const channel = supabase.channel(`club:${clubId}:posts`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'club_posts', filter: `club_id=eq.${clubId}` }, () => {
        void qc.invalidateQueries({ queryKey: clubKeys.posts(clubId) })
        void qc.invalidateQueries({ queryKey: clubKeys.pinned(clubId) })
        void qc.invalidateQueries({ queryKey: clubKeys.news(clubId) })
      })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [clubId, enabled, qc])

  return { pinned, posts, items: posts.data?.pages.flat() ?? [] }
}

/** Cập nhật một bài trong mọi cache bảng tin của CLB */
function patchPost(qc: ReturnType<typeof useQueryClient>, clubId: string, postId: string, patch: (p: ClubPost) => ClubPost) {
  qc.setQueryData<InfiniteData<ClubPost[]>>(clubKeys.posts(clubId), (d) =>
    d && { ...d, pages: d.pages.map((pg) => pg.map((p) => (p.id === postId ? patch(p) : p))) })
  qc.setQueryData<ClubPost[]>(clubKeys.pinned(clubId), (d) => d?.map((p) => (p.id === postId ? patch(p) : p)))
  qc.setQueryData<ClubPost[]>(clubKeys.news(clubId), (d) => d?.map((p) => (p.id === postId ? patch(p) : p)))
}

export function usePostActions(clubId: string) {
  const qc = useQueryClient()
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: clubKeys.posts(clubId) })
    void qc.invalidateQueries({ queryKey: clubKeys.pinned(clubId) })
    void qc.invalidateQueries({ queryKey: clubKeys.news(clubId) })
  }

  const react = useMutation({
    mutationFn: (post: ClubPost) => toggleReaction(post.id),
    onMutate: (post) => patchPost(qc, clubId, post.id, (p) => ({
      ...p, reacted: !p.reacted, reaction_count: Math.max(0, p.reaction_count + (p.reacted ? -1 : 1)),
    })),
    onSuccess: (r, post) => patchPost(qc, clubId, post.id, (p) => ({ ...p, reacted: r.reacted, reaction_count: r.count })),
    onError: refresh,
  })
  const create = useMutation({ mutationFn: createPost, onSuccess: refresh })
  const remove = useMutation({ mutationFn: (id: string) => deletePost(id), onSuccess: refresh })
  const pin = useMutation({ mutationFn: (v: { id: string; pinned: boolean }) => pinPost(v.id, v.pinned), onSuccess: refresh })
  return { react, create, remove, pin }
}
