'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useMyProfile, useSession, takePendingRedirect } from '@/features/auth'
import { routes } from '@/shared/config/routes'
import { ErrorState } from '@/shared/ui'
import { TopBar } from './_components/TopBar'
import { BottomTabBar } from './_components/BottomTabBar'
import { FullScreenMessage } from './_components/FullScreenMessage'

// Khung chung cho mọi màn hình cần đăng nhập
export default function AppLayout({ children }: LayoutProps<'/'>) {
  const router = useRouter()
  const pathname = usePathname()
  const { session, loading } = useSession()
  const { profile, isError, refetch } = useMyProfile()

  useEffect(() => {
    if (loading) return
    if (!session) {
      router.replace(`${routes.login}?next=${encodeURIComponent(pathname)}`)
      return
    }
    const pending = takePendingRedirect()
    if (pending) router.replace(pending)
  }, [loading, session, pathname, router])

  if (loading || !session) {
    return <FullScreenMessage><Loader2 className="size-6 animate-spin text-brand" aria-label="Đang tải" /></FullScreenMessage>
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col border-x border-border/60">
      <TopBar profile={profile} />
      <main className="flex-1 px-4 pb-32 pt-4">
        {isError ? <ErrorState message="Không tải được hồ sơ của bạn." onRetry={() => refetch()} /> : children}
      </main>
      <BottomTabBar />
    </div>
  )
}
