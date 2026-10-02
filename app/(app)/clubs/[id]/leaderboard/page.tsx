import { ClubLeaderboardScreen } from '@/features/club'
import { ClubMatchesTab } from '@/features/cup'

export default async function ClubLeaderboardPage({ params }: PageProps<'/clubs/[id]/leaderboard'>) {
  const { id } = await params
  return <ClubLeaderboardScreen clubId={id} battles={<ClubMatchesTab clubId={id} />} />
}
