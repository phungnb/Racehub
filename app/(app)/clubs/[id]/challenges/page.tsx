import { ClubChallengesTab } from '@/features/challenge'

export default async function ClubChallengesPage({ params }: PageProps<'/clubs/[id]/challenges'>) {
  const { id } = await params
  return <ClubChallengesTab clubId={id} />
}
