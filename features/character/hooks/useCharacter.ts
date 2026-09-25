'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useInvalidateProfile } from '@/features/auth'
import { buyBundle, buyItem, getCharacter, getCharacterState, saveCharacter, tryItem } from '../api/characterApi'
import type { Gender, Slot } from '../model/catalog'

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

export function useTryItem() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (code: string) => tryItem(code), onSuccess: () => void qc.invalidateQueries({ queryKey: characterKeys.state }) })
}

export function useBuyBundle() {
  const qc = useQueryClient()
  const refreshProfile = useInvalidateProfile()
  return useMutation({
    mutationFn: ({ id, key }: { id: string; key: string }) => buyBundle(id, key),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: characterKeys.state }); void qc.invalidateQueries({ queryKey: ['game', 'wallet'] }); refreshProfile() },
  })
}

export function useSaveCharacter() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ look, equipped }: { look: { gender?: Gender; body?: string | null }; equipped: Partial<Record<Slot, string | null>> }) =>
      saveCharacter(look, equipped),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['character'] }),
  })
}
