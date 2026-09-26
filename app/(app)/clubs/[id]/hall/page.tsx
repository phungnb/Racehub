import { HallOfFameScreen } from '@/features/club'

export default async function ClubHallPage({ params }: PageProps<'/clubs/[id]/hall'>) {
  const { id } = await params
  return <HallOfFameScreen clubId={id} />
}
