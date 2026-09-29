'use client'

import { useRouter } from 'next/navigation'
import { routes } from '@/shared/config/routes'
import AthleteProfile from './AthleteProfile'

/** Trang hồ sơ vận động viên (lịch sử + chi tiết bài chạy khi họ để công khai) */
export function AthleteScreen({ id }: { id: string }) {
  const router = useRouter()
  return <AthleteProfile userId={id} onClose={() => (window.history.length > 1 ? router.back() : router.push(routes.feed))} />
}
