'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { supabase } from '@/shared/lib/supabase'
import { deleteMessage, listMessages, markClubRead, sendMessage, type ChatMessage } from '../api/chatApi'
import { clubKeys } from './keys'

const PAGE = 40
type Pages = InfiniteData<ChatMessage[], string | undefined>

/**
 * Trò chuyện realtime của một CLB.
 * - Trang 0 là trang MỚI NHẤT; mỗi trang xếp cũ → mới. `messages` là toàn bộ, cũ → mới.
 * - Gửi lạc quan: tin hiện ngay với trạng thái "đang gửi", lỗi thì cho gửi lại.
 */
export function useClubChat(clubId: string, enabled: boolean) {
  const qc = useQueryClient()
  const key = clubKeys.chat(clubId)

  const q = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => listMessages(clubId, pageParam, PAGE),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => (page.length === PAGE ? page[0].created_at : undefined),
    enabled,
    staleTime: Infinity,          // realtime giữ dữ liệu luôn mới
  })

  const upsert = useCallback((m: ChatMessage, replaceId?: string) => {
    qc.setQueryData<Pages>(key, (d) => {
      if (!d) return d
      // Realtime có thể về trước khi lệnh gửi trả kết quả: thay luôn bản tạm cùng nội dung
      if (!replaceId && !m.pending) {
        const temp = d.pages[0]?.find((x) => x.pending === 'sending' && x.author_id === m.author_id && x.body === m.body)
        if (temp) replaceId = temp.id
      }
      const exists = d.pages.some((pg) => pg.some((x) => x.id === m.id))
      const pages = d.pages.map((pg, i) => {
        let next = pg.filter((x) => x.id !== replaceId || x.id === m.id)
        if (exists) next = next.map((x) => (x.id === m.id ? { ...x, ...m, pending: undefined } : x))
        else if (i === 0) next = [...next, m]
        return next
      })
      return { ...d, pages }
    })
  }, [qc, key])

  const markRead = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleRead = useCallback(() => {
    if (markRead.current) clearTimeout(markRead.current)
    markRead.current = setTimeout(() => {
      void markClubRead(clubId).then(() => qc.invalidateQueries({ queryKey: clubKeys.inbox }))
    }, 800)
  }, [clubId, qc])

  useEffect(() => {
    if (!enabled) return
    scheduleRead()
    const channel = supabase.channel(`club:${clubId}:chat`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'club_messages', filter: `club_id=eq.${clubId}` },
        (payload) => {
          upsert(payload.new as ChatMessage)
          if (document.visibilityState === 'visible') scheduleRead()
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'club_messages', filter: `club_id=eq.${clubId}` },
        (payload) => upsert(payload.new as ChatMessage))
      .subscribe()
    return () => {
      if (markRead.current) clearTimeout(markRead.current)
      void supabase.removeChannel(channel)
    }
  }, [clubId, enabled, upsert, scheduleRead])

  const send = useCallback(async (input: { body: string; replyTo?: string | null; mentions?: string[]; authorId: string; retryId?: string }) => {
    const tempId = input.retryId ?? `tmp-${crypto.randomUUID()}`
    const temp: ChatMessage = {
      id: tempId, club_id: clubId, author_id: input.authorId, body: input.body, reply_to: input.replyTo ?? null,
      mentions: input.mentions ?? [], created_at: new Date().toISOString(), deleted_at: null, pending: 'sending',
    }
    if (input.retryId) upsert(temp)
    else qc.setQueryData<Pages>(key, (d) => d && { ...d, pages: d.pages.map((pg, i) => (i === 0 ? [...pg, temp] : pg)) })
    try {
      const saved = await sendMessage({ clubId, body: input.body, replyTo: input.replyTo, mentions: input.mentions })
      upsert(saved, tempId)
    } catch (e) {
      upsert({ ...temp, pending: 'failed' })
      throw e
    }
  }, [clubId, key, qc, upsert])

  const remove = useCallback(async (id: string) => {
    if (id.startsWith('tmp-')) {
      qc.setQueryData<Pages>(key, (d) => d && { ...d, pages: d.pages.map((pg) => pg.filter((x) => x.id !== id)) })
      return
    }
    await deleteMessage(id)
  }, [key, qc])

  const messages = useMemo(() => (q.data ? [...q.data.pages].reverse().flat() : []), [q.data])
  return { ...q, messages, send, remove }
}
