'use client'

import { Suspense, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useSession } from '@/features/auth'
import { OnboardingScreen } from '@/features/onboarding'
import { OfflineBanner } from '@/features/pwa'
import { routes } from '@/shared/config/routes'

// Màn chào mừng người mới (ngoài khung app: không thanh tab, không thanh trên)
export default function WelcomePage() {
  const router = useRouter()
  const { session, loading } = useSession()
  useEffect(() => {
    if (!loading && !session) router.replace(`${routes.login}?next=${routes.welcome}`)
  }, [loading, session, router])

  const spinner = <div className="grid min-h-dvh place-items-center"><Loader2 className="size-6 animate-spin text-brand" aria-label="Đang tải" /></div>
  if (loading || !session) return spinner
  return (
    <>
      <OfflineBanner />
      <Suspense fallback={spinner}><OnboardingScreen /></Suspense>
    </>
  )
}
