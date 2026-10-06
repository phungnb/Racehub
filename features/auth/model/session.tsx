'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/shared/lib/supabase'
import { errorKind } from '@/shared/lib/errors'
import type { Profile } from '@/shared/types/profile'

interface SessionState {
  session: Session | null
  loading: boolean
}

const SessionContext = createContext<SessionState>({ session: null, loading: true })

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ session: null, loading: true })
  const queryClient = useQueryClient()

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (active) setState({ session: data.session, loading: false })
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setState({ session, loading: false })
      if (event === 'SIGNED_OUT') queryClient.clear()
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [queryClient])

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>
}

export const useSession = () => useContext(SessionContext)

export const profileQueryKey = (uid: string | undefined) => ['profile', uid] as const

async function fetchOrCreateProfile(uid: string): Promise<Profile> {
  // Hồ sơ đầy đủ của chính mình qua RPC (011900: bảng profiles chỉ còn cột công khai); máy chủ chưa có RPC → đọc bảng như cũ
  const read = async (): Promise<{ data: Profile | null; error: Error | null }> => {
    const r = await supabase.rpc('my_account')
    if (!r.error) return { data: (r.data as Profile | null) ?? null, error: null }
    // Chỉ quay về đọc bảng khi máy chủ CHƯA CÓ hàm (PGRST202). "permission denied for function my_account" (yêu cầu đi bằng
    // vai trò khách khi phiên đăng nhập chưa kịp nạp / làm mới) không phải thiếu hàm — đọc bảng lúc đó chỉ đẻ thêm lỗi
    // "permission denied for table profiles" (bảng chỉ còn cột công khai từ 011900)
    if (errorKind(r.error) !== 'NOT_DEPLOYED') return { data: null, error: r.error }
    const t = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle<Profile>()
    return { data: t.data, error: t.error }
  }
  const { data, error } = await read()
  if (error) throw error
  if (data) return data
  // Chưa có hồ sơ (user cũ trước khi có trigger) → server tạo
  const { error: ensureError } = await supabase.rpc('ensure_profile')
  if (ensureError) throw ensureError
  const again = await read()
  if (again.error || !again.data) throw again.error ?? new Error('PROFILE_NOT_FOUND')
  return again.data
}

/** Hồ sơ của người đang đăng nhập (cache bằng TanStack Query). */
export function useMyProfile() {
  const { session } = useSession()
  const uid = session?.user.id
  const query = useQuery({
    queryKey: profileQueryKey(uid),
    queryFn: () => fetchOrCreateProfile(uid!),
    enabled: !!uid,
    staleTime: 30_000,
  })
  return { ...query, profile: query.data ?? null }
}

/** Hàm ổn định giữa các lần render — an toàn khi đặt trong deps của useEffect. */
export function useInvalidateProfile() {
  const qc = useQueryClient()
  const uid = useSession().session?.user.id
  return useCallback(() => qc.invalidateQueries({ queryKey: profileQueryKey(uid) }), [qc, uid])
}
