import { ExchangeScreen } from '@/features/club'

export default async function ClubExchangePage({ params }: PageProps<'/clubs/[id]/exchange'>) {
  const { id } = await params
  return <ExchangeScreen clubId={id} />
}
