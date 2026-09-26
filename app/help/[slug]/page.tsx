import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { createSupabaseServerClient } from '@/shared/lib/supabase-server'
import { HelpArticle, HelpShell, type HelpPage } from '@/features/help'

const load = cache(async (slug: string) => {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('help_page', { p_slug: slug })
  return error ? null : (data as HelpPage | null)
})

export async function generateMetadata({ params }: PageProps<'/help/[slug]'>): Promise<Metadata> {
  const page = await load((await params).slug)
  return page ? { title: page.title, description: page.summary ?? undefined } : { title: 'Không tìm thấy trang' }
}

export default async function HelpPageRoute({ params }: PageProps<'/help/[slug]'>) {
  const page = await load((await params).slug)
  if (!page) notFound()
  return <HelpShell><HelpArticle page={page} /></HelpShell>
}
