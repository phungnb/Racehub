'use client'

import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/shared/lib/supabase'
import {
  cancelChallenge, changeTeam, getChallenge, getLeaderboard, getTeamStandings, joinChallenge, leaveChallenge, listChallenges,
  settleIfDue, type ChallengeTab,
} from '../api/challengeApi'
import { settlementDue } from '../model/challenge'

export const challengeKeys = {
  list: (tab: ChallengeTab, clubId?: string) => ['challenges', tab, clubId ?? null] as const,
  detail: (id: string) => ['challenge', id] as const,
  leaderboard: (id: string) => ['challenge', id, 'leaderboard'] as const,
  teams: (id: string) => ['challenge', id, 'teams'] as const,
  pledge: (id: string) => ['challenge', id, 'pledge'] as const,
}

export function useChallengeList(tab: ChallengeTab, clubId?: string) {
  return useQuery({ queryKey: challengeKeys.list(tab, clubId), queryFn: () => listChallenges(tab, clubId) })
}

/** Chi tiết + BXH, cập nhật realtime khi bất kỳ ai trong thử thách có tiến độ mới */
export function useChallenge(id: string, code?: string | null) {
  const qc = useQueryClient()
  const detail = useQuery({ queryKey: challengeKeys.detail(id), queryFn: () => getChallenge(id, code) })
  const visible = !!detail.data
  const leaderboard = useQuery({ queryKey: challengeKeys.leaderboard(id), queryFn: () => getLeaderboard(id), enabled: visible })
  const isTeam = detail.data?.challenge.format === 'TEAM'
  const teams = useQuery({ queryKey: challengeKeys.teams(id), queryFn: () => getTeamStandings(id), enabled: visible && isTeam })

  // Realtime: gộp các thay đổi trong 1 giây để tránh tải lại liên tục
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!visible) return
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        void qc.invalidateQueries({ queryKey: challengeKeys.detail(id) })
        void qc.invalidateQueries({ queryKey: challengeKeys.leaderboard(id) })
        void qc.invalidateQueries({ queryKey: challengeKeys.teams(id) })
        void qc.invalidateQueries({ queryKey: challengeKeys.pledge(id) })
      }, 1000)
    }
    const ch = supabase.channel(`challenge:${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'challenge_participants', filter: `challenge_id=eq.${id}` }, refresh)
      .subscribe()
    return () => {
      if (timer.current) clearTimeout(timer.current)
      void supabase.removeChannel(ch)
    }
  }, [id, visible, qc])

  // Hết giờ + 2 giờ chờ đồng bộ muộn mà chưa tất toán → tất toán ngay khi có người mở (cron hằng ngày là dự phòng)
  const c = detail.data?.challenge
  const due = !!c && settlementDue(c)
  useEffect(() => {
    if (!due) return
    settleIfDue(id)
      .then((done) => { if (done) void qc.invalidateQueries({ queryKey: ['challenge', id] }) })
      .catch(() => undefined)
  }, [due, id, qc])

  return { detail, leaderboard, teams }
}

export function useChallengeActions(id: string) {
  const qc = useQueryClient()
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['challenge', id] })
    void qc.invalidateQueries({ queryKey: ['challenges'] })
    void qc.invalidateQueries({ queryKey: ['profile'] })
  }
  return {
    join: useMutation({ mutationFn: (v: { code?: string | null; teamId?: string | null }) => joinChallenge(id, v.code, v.teamId), onSuccess: refresh }),
    leave: useMutation({ mutationFn: () => leaveChallenge(id), onSuccess: refresh }),
    changeTeam: useMutation({ mutationFn: (teamId: string) => changeTeam(id, teamId), onSuccess: refresh }),
    cancel: useMutation({ mutationFn: (reason?: string) => cancelChallenge(id, reason), onSuccess: refresh }),
  }
}
