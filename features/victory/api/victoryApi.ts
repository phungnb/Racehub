// Victory Studio (migration 011600): mọi số liệu do máy chủ điền; client chỉ gửi loại + mã thành tích
import { supabase } from '@/shared/lib/supabase'
import { systemErrorMessage } from '@/shared/lib/errors'
import type { VicFacts, VicKind, VicPerson } from '../model/victory'

export interface SourceItem { ref: string; title: string; subtitle?: string | null; date?: string | null; state?: string; icon?: string | null; participants?: number }
export interface VictorySources {
  challenges: SourceItem[]; runs: SourceItem[]; totals: SourceItem[]; levels: SourceItem[]; badges: SourceItem[]; managed: SourceItem[]; total_km: number
}
export interface Issued { code: string; new: boolean; facts: VicFacts; award: string | null; person: VicPerson }
export interface Verified {
  code: string; kind: VicKind; facts: Omit<VicFacts, 'person'>; award: string | null; person: VicPerson; issued_by: string | null; created_at: string; updated_at: string
}
export interface MyVictory { code: string; kind: VicKind; ref: string; award: string | null; facts: Omit<VicFacts, 'person'>; person: VicPerson; mine: boolean; exports: number; created_at: string }

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}

export const getSources = () => call<VictorySources>('victory_sources')
export const getFacts = (kind: VicKind, ref: string, user?: string | null) =>
  call<VicFacts>('victory_facts', { p_kind: kind, p_ref: ref, p_user: user ?? null })
export const issueVictory = (kind: VicKind, ref: string, user: string | null, award: string | null, design: unknown) =>
  call<Issued>('issue_victory', { p_kind: kind, p_ref: ref, p_user: user, p_award: award, p_design: design })
/** Victory Studio theo gói (011800): VIP, thành viên CLB Pro / doanh nghiệp, hoặc thử thách của CLB Pro */
export type AccessVia = 'FREE' | 'ADMIN' | 'VIP' | 'CLUB_PRO' | 'ORG' | 'EVENT'
export interface VictoryAccess { unlocked: boolean; via: AccessVia | null }
export const getAccess = (challengeId?: string | null) =>
  call<VictoryAccess>('victory_access', { p_challenge: challengeId ?? null }).catch(() => ({ unlocked: true, via: null }) as VictoryAccess)
export const recordExport = (code: string, design: unknown) => call<void>('record_victory_export', { p_code: code, p_design: design })
export const myVictories = () => call<MyVictory[]>('my_victories').then((x) => x ?? [])
export const revokeVictory = (code: string) => call<void>('revoke_victory', { p_code: code })

const MESSAGES: Record<string, string> = {
  NOT_PARTICIPANT: 'Người này chưa tham gia thử thách.',
  NO_RESULT: 'Chưa có kết quả để vinh danh — hãy chạy ít nhất một bài hợp lệ trong thử thách.',
  NOT_ELIGIBLE: 'Chưa đạt thành tích này.',
  NOT_FOUND: 'Không tìm thấy thành tích.',
  FORBIDDEN: 'Chỉ người tạo thử thách, ban quản trị CLB hoặc admin mới vinh danh người khác và đặt danh hiệu.',
  RATE_LIMITED: 'Bạn đã tạo quá nhiều ảnh hôm nay. Thử lại ngày mai.',
  VICTORY_LOCKED: 'Victory Studio dành cho runner VIP, thành viên CLB Pro hoặc doanh nghiệp. Nâng cấp để xuất ảnh.',
}
export function victoryErrorMessage(e: unknown): string {
  const raw = (e as { message?: string } | null)?.message ?? ''
  const key = Object.keys(MESSAGES).sort((a, b) => b.length - a.length).find((k) => raw.includes(k))
  return key ? MESSAGES[key] : systemErrorMessage(e, 'Không tạo được ảnh vinh danh. Hãy thử lại.')
}

/** Người tham gia thử thách (BTC chọn người để vinh danh) — dùng BXH sẵn có */
export interface Participant { user_id: string; display_name: string | null; avatar_url: string | null; rank: number; score: number }
export const getParticipants = (challengeId: string) => call<Participant[]>('challenge_leaderboard', { p_challenge_id: challengeId }).then((x) => x ?? [])
