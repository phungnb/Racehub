import { ClubLeaderboardScreen } from '@/features/club'

export default async function ClubLeaderboardPage({ params }: PageProps<'/clubs/[id]/leaderboard'>) {
  const { id } = await params
  return <ClubLeaderboardScreen clubId={id} />
}
