import { ClubPhotosScreen } from '@/features/club'

export default async function ClubPhotosPage({ params }: PageProps<'/clubs/[id]/photos'>) {
  const { id } = await params
  return <ClubPhotosScreen clubId={id} />
}
