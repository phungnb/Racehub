import { Suspense } from 'react'
import { HubScreen } from '@/features/hub'

export default function HubPage() {
  // useSearchParams (?post=…) cần Suspense
  return <Suspense><HubScreen /></Suspense>
}
