import { ShopManager } from '@/features/market'

export default async function ShopManagePage({ params }: PageProps<'/market/me/shop/[id]'>) {
  const { id } = await params
  return <ShopManager partnerId={id} />
}
