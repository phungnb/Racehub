import { supabase } from '@/shared/lib/supabase';

export interface CreateChallengePayload {
  title: string;
  challenge_type: 'INDIVIDUAL' | 'TEAM';
  game_mode: string;
  target_type?: string;
  target_km?: number;
  min_km?: number;
  min_members?: number;
  fixed_team_size?: number;
  start_date?: string;
  end_date?: string;
  reg_deadline?: string;
  min_pace?: number;
  max_pace?: number;
  creator_role?: string;
  target_audience?: 'PUBLIC' | 'CLUB_ONLY' | 'INVITE_ONLY';
  target_club_id?: string | null;
  max_slots?: number;
  created_by?: string;
}

export async function createChallengeInSupabase(payload: CreateChallengePayload) {
  if (!payload.created_by) {
    throw new Error('Thiếu thông tin người dùng.');
  }

  const idempotencyKey = `chal_${payload.created_by}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const { data, error } = await supabase.rpc('create_challenge_with_ledger', {
    p_user_id: payload.created_by,
    p_title: payload.title,
    p_challenge_type: payload.challenge_type,
    p_game_mode: payload.game_mode,
    p_target_km: payload.target_km || 0,
    p_min_km: payload.min_km || 2.0,
    p_min_members: payload.min_members || 1,
    p_fixed_team_size: payload.fixed_team_size || 0,
    p_target_audience: payload.target_audience || 'PUBLIC',
    p_start_date: payload.start_date,
    p_end_date: payload.end_date,
    p_reg_deadline: payload.reg_deadline,
    p_min_pace: payload.min_pace || 3.0,
    p_max_pace: payload.max_pace || 12.0,
    p_max_slots: payload.max_slots || 50,
    p_idempotency_key: idempotencyKey
  });

  if (error) {
    console.error('Lỗi Sổ cái Ledger:', error.message);
    throw new Error(error.message);
  }

  return data;
}

export async function getChallengesFromSupabase() {
  const { data, error } = await supabase
    .from('challenges')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Lỗi tải danh sách challenge:', error.message);
    return [];
  }

  return data || [];
}
