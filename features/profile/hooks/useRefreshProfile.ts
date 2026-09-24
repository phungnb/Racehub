import { useQueryClient } from '@tanstack/react-query'
import { useInvalidateProfile } from '@/features/auth'

export const myProfileKey = ['my-profile'] as const

/** Làm mới mọi nơi hiện hồ sơ của tôi (Cài đặt, trang Tôi, nhân vật, trang vận động viên) */
export function useRefreshProfile() {
  const qc = useQueryClient()
  const invalidate = useInvalidateProfile()
  return () => {
    void qc.invalidateQueries({ queryKey: myProfileKey })
    void qc.invalidateQueries({ queryKey: ['character'] })
    void qc.invalidateQueries({ queryKey: ['athlete'] })
    invalidate()
  }
}
