'use client'

import { useQueryClient } from '@tanstack/react-query'
import { RunScreen } from '@/features/run'
import { useInvalidateProfile } from '@/features/auth'

export default function RunPage() {
  const qc = useQueryClient()
  const invalidateProfile = useInvalidateProfile()
  return (
    <RunScreen
      onSaved={() => {
        invalidateProfile()
        qc.invalidateQueries({ queryKey: ['activities'] })
      }}
    />
  )
}
