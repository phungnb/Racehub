'use client'

import { RacesScreen, useOrganizer } from '@/features/race'

export default function RacesPage() {
  const { canCreate } = useOrganizer()
  return <RacesScreen canCreate={canCreate} />
}
