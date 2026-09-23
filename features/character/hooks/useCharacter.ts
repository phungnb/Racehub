'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useInvalidateProfile } from '@/features/auth'
import { buyItem, getCharacter, getCharacterState, saveCharacter } from '../api/characterApi'
import type { Look, Slot } from '../model/catalog'

export const characterKeys = {
  state: ['character', 'state'] as const,
  of: (userId: string) => ['character', 'of', userId] as const,
}

export const useCharacterState = () => useQuery({ queryKey: characterKeys.state, queryFn: getCharacterState })
export const useCharacterOf = (userId: string | null | undefined) =>
  useQuery({ queryKey: characterKeys.of(userId ?? ''), queryFn: () => getCharacter(userId!), enabled: !!userId, staleTime: 5 * 60_000 })

export function useBuyItem() {
  const qc = useQueryClient()
  const refreshProfile = useInvalidateProfile()
  return useMutation({
    mutationFn: ({ code, key }: { code: string; key: string }) => buyItem(code, key),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: characterKeys.state })
      void qc.invalidateQueries({ queryKey: ['game', 'wallet'] })
      refreshProfile()
    },
  })
}

export function useSaveCharacter() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ look, equipped }: { look: Partial<Omit<Look, 'equipped'>>; equipped: Partial<Record<Slot, string | null>> }) =>
      saveCharacter(look, equipped),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['character'] }),
  })
}
