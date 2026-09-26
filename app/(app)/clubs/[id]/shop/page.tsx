import { ClubShopScreen } from '@/features/club'

export default async function ClubShopPage({ params }: PageProps<'/clubs/[id]/shop'>) {
  const { id } = await params
  return <ClubShopScreen clubId={id} />
}
