import { ListingFormScreen } from '@/features/race'

export default async function NewListingPage({ searchParams }: { searchParams: Promise<{ candidate?: string }> }) {
  const { candidate } = await searchParams
  return <ListingFormScreen id={null} candidateId={candidate && /^[0-9a-f-]{36}$/i.test(candidate) ? candidate : null} />
}
