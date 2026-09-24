import { ClubFeedScreen } from '@/features/club'

export default async function ClubFeedPage({ params }: PageProps<'/clubs/[id]'>) {
  const { id } = await params
  return <ClubFeedScreen clubId={id} />
}
