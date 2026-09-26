// Kho link ảnh CLB (migration 006300): album Google Photos / Drive / Facebook… theo sự kiện, giải, buổi tập.
import { supabase } from '@/shared/lib/supabase'
import type { AlbumKind } from '../model/media'

export interface ClubAlbum {
  id: string; club_id: string; title: string; url: string; description: string | null; kind: AlbumKind; taken_on: string
  event_id: string | null; event_title: string | null; race_name: string | null; cover_path: string | null; photographer: string | null
  status: 'PENDING' | 'APPROVED'; opens: number; created_by: string | null; created_by_name: string | null; created_at: string
}
export interface AlbumFilters { q?: string; kind?: AlbumKind | 'ALL'; year?: number | null; event_id?: string | null }
export interface AlbumPage { items: ClubAlbum[]; total: number; years: number[]; pending: number; can_manage: boolean }
export interface AlbumInput {
  id?: string; title: string; url: string; description?: string | null; kind: AlbumKind; taken_on: string; event_id?: string | null
  race_name?: string | null; cover_path?: string | null; photographer?: string | null; notify?: boolean
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}

export const listAlbums = (clubId: string, f: AlbumFilters, offset = 0) => rpc<AlbumPage>('club_albums', { p_club_id: clubId, p: { ...f, offset } })
export const saveAlbum = (clubId: string, p: AlbumInput) => rpc<string>('save_club_album', { p_club_id: clubId, p })
export const reviewAlbum = (id: string, approve: boolean, note: string | null = null) => rpc<void>('review_club_album', { p_id: id, p_approve: approve, p_note: note })
export const deleteAlbum = (id: string) => rpc<void>('delete_club_album', { p_id: id })
export const openAlbum = (id: string) => rpc<void>('open_club_album', { p_id: id })
