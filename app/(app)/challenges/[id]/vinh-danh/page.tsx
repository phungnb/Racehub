import { HonorStudioScreen } from '@/features/challenge'

export default async function ChallengeHonorStudioPage({ params }: PageProps<'/challenges/[id]/vinh-danh'>) {
  const { id } = await params
  return <HonorStudioScreen id={id} />
}
