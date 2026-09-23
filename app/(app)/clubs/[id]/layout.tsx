import { ClubShell } from '@/features/club'

export default async function ClubLayout({ children, params }: LayoutProps<'/clubs/[id]'>) {
  const { id } = await params
  return <ClubShell clubId={id}>{children}</ClubShell>
}
