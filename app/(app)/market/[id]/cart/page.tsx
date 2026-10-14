import { CartScreen } from '@/features/market'

export default async function CartPage({ params }: PageProps<'/market/[id]/cart'>) {
  const { id } = await params
  return <CartScreen partnerId={id} />
}
