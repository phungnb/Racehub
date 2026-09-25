'use client' // Error boundary phải là Client Component

import { CrashScreen } from '@/shared/ui'

export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <CrashScreen error={error} retry={retry} />
}
