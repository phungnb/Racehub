import { ListingFormScreen } from '@/features/race'

export default async function EditListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ListingFormScreen id={id} />
}
