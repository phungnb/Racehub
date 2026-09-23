'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import AuthScreen from '@/features/auth/components/AuthScreen'
import { useSession } from '@/features/auth/model/session'
import { safeNext } from '@/shared/config/routes'

function LoginInner() {
  const router = useRouter()
  const params = useSearchParams()
  const { session, loading } = useSession()
  const next = safeNext(params.get('next'))

  useEffect(() => {
    if (!loading && session) router.replace(next)
  }, [loading, session, next, router])

  return (
    <div className="mx-auto min-h-dvh max-w-md">
      <AuthScreen onAuthSuccess={() => router.replace(next)} />
    </div>
  )
}

export default function LoginPage() {
  return <Suspense fallback={null}><LoginInner /></Suspense>
}
