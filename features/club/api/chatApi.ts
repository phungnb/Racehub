// Trò chuyện CLB. Gửi tin = insert trực tiếp (RLS + trigger kiểm tra, giới hạn 20 tin/phút).
import { supabase } from '@/shared/lib/supabase'

export interface ChatMessage {
  id: string
  club_id: string
  author_id: string
  body: string
  reply_to: string | null
  mentions: string[]
  created_at: string
  deleted_at: string | null
  /** Chỉ có ở phía client khi tin đang gửi / gửi lỗi */
  pending?: 'sending' | 'failed'
}

const COLS = 'id, club_id, author_id, body, reply_to, mentions, created_at, deleted_at'

/** Tin cũ hơn `before` (created_at), trả về theo thứ tự cũ → mới */
export async function listMessages(clubId: string, before?: string, limit = 40): Promise<ChatMessage[]> {
  let q = supabase.from('club_messages').select(COLS).eq('club_id', clubId)
    .order('created_at', { ascending: false }).limit(limit)
  if (before) q = q.lt('created_at', before)
  const { data, error } = await q
  if (error) throw error
  return ((data ?? []) as ChatMessage[]).reverse()
}

export async function sendMessage(input: { clubId: string; body: string; replyTo?: string | null; mentions?: string[] }): Promise<ChatMessage> {
  const { data, error } = await supabase.from('club_messages')
    .insert({ club_id: input.clubId, body: input.body, reply_to: input.replyTo ?? null, mentions: input.mentions ?? [] })
    .select(COLS).single()
  if (error) throw error
  return data as ChatMessage
}

export async function deleteMessage(messageId: string) {
  const { error } = await supabase.rpc('delete_club_message', { p_message_id: messageId })
  if (error) throw error
}

export async function markClubRead(clubId: string) {
  const { error } = await supabase.rpc('mark_club_read', { p_club_id: clubId })
  if (error) throw error
}
