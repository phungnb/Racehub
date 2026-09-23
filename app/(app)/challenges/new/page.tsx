import { CreateChallengeScreen } from '@/features/challenge'

export default async function NewChallengePage({ searchParams }: PageProps<'/challenges/new'>) {
  const { club } = await searchParams
  return <CreateChallengeScreen clubId={typeof club === 'string' ? club : null} />
}
