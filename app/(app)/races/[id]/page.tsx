import { RaceDetailScreen } from '@/features/race'

export default async function RacePage({ params }: PageProps<'/races/[id]'>) {
  const { id } = await params
  return <RaceDetailScreen id={id} />
}
