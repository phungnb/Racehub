import { CampaignScreen } from '@/features/org'

export default async function OrgCampaignPage({ params }: PageProps<'/orgs/[id]/campaigns/[cid]'>) {
  const { id, cid } = await params
  return <CampaignScreen orgId={id} campaignId={cid} />
}
