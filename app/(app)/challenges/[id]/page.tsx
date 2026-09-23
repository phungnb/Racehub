import { ChallengeDetailScreen } from '@/features/challenge'

export default async function ChallengePage({ params, searchParams }: PageProps<'/challenges/[id]'>) {
  const { id } = await params
  const { code } = await searchParams
  return <ChallengeDetailScreen id={id} code={typeof code === 'string' ? code : null} />
}
