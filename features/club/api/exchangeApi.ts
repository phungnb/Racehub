// Thư mời giao lưu offline giữa hai CLB (migration 008100). Nhận lời → mỗi CLB có một sự kiện trong tab Lịch.
import { supabase } from '@/shared/lib/supabase'

export type ExchangeStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED'
export interface ExchangeClub { id: string; name: string; avatar_url: string | null; accent_color: string | null; member_count: number }
export interface ClubExchange {
  id: string
  from_club: string
  to_club: string
  title: string
  message: string | null
  starts_at: string
  duration_min: number
  location_name: string
  lat: number | null
  lng: number | null
  distance_km: number | null
  pace_text: string | null
  guest_capacity: number | null
  status: ExchangeStatus
  response_note: string | null
  responded_at: string | null
  host_event_id: string | null
  guest_event_id: string | null
  created_at: string
  from: ExchangeClub
  to: ExchangeClub
  sender_name: string | null
  responder_name: string | null
}
export interface ClubExchanges { is_staff: boolean; incoming: ClubExchange[]; outgoing: ClubExchange[] }
export interface ExchangeInput {
  title: string
  message?: string | null
  starts_at: string
  duration_min: number
  location_name: string
  lat?: number | null
  lng?: number | null
  distance_km?: number | null
  pace_text?: string | null
  guest_capacity?: number | null
}

export async function getClubExchanges(clubId: string): Promise<ClubExchanges> {
  const { data, error } = await supabase.rpc('club_exchanges', { p_club_id: clubId })
  if (error) throw error
  return data as ClubExchanges
}

export async function sendClubExchange(fromClub: string, toClub: string, input: ExchangeInput): Promise<ClubExchange> {
  const { data, error } = await supabase.rpc('send_club_exchange', { p_from_club: fromClub, p_to_club: toClub, p: input })
  if (error) throw error
  return data as ClubExchange
}

export async function respondClubExchange(id: string, accept: boolean, note?: string): Promise<ClubExchange> {
  const { data, error } = await supabase.rpc('respond_club_exchange', { p_invite_id: id, p_accept: accept, p_note: note?.trim() || null })
  if (error) throw error
  return data as ClubExchange
}

export async function cancelClubExchange(id: string, reason: string): Promise<ClubExchange> {
  const { data, error } = await supabase.rpc('cancel_club_exchange', { p_invite_id: id, p_reason: reason })
  if (error) throw error
  return data as ClubExchange
}
