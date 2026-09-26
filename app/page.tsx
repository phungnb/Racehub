import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/shared/lib/supabase-server'
import { routes } from '@/shared/config/routes'
import { IntroScreen } from '@/features/onboarding'

// Trang gốc: đã đăng nhập → Trang chủ; chưa đăng nhập → màn giới thiệu (lần sau vào thẳng Đăng nhập).
// Hỗ trợ link cũ dạng /?tab=profile&strava_success=true và /?tab=club&clubId=...
export default async function RootPage({ searchParams }: PageProps<'/'>) {
  const params = await searchParams
  const tab = typeof params.tab === 'string' ? params.tab : null
  const passthrough = new URLSearchParams()
  for (const key of ['strava_success', 'strava_error', 'clubId']) {
    const v = params[key]
    if (typeof v === 'string') passthrough.set(key, v)
  }
  const qs = passthrough.toString() ? `?${passthrough}` : ''

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <Suspense fallback={null}><IntroScreen /></Suspense>

  if (tab === 'profile') redirect(`${routes.me}${qs}`)
  if (tab === 'club') {
    const clubId = typeof params.clubId === 'string' ? params.clubId : null
    redirect(clubId ? routes.club(clubId) : routes.clubs)
  }
  redirect(routes.home)
}
