import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { createSupabaseServerClient } from '@/shared/lib/supabase-server'
import { groupMenu, HelpShell, SECTION_LABEL, staticHref, type HelpMenu } from '@/features/help'

export const metadata: Metadata = { title: 'Hướng dẫn & chính sách', description: 'Cách chơi RaceHub, quy định Xu & quà tặng, quy tắc cộng đồng, quyền riêng tư và hỗ trợ.' }

export default async function HelpIndexPage() {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.rpc('help_menu')
  const groups = groupMenu((data as HelpMenu | null)?.pages ?? [])
  return (
    <HelpShell back={null}>
      <h1 className="text-2xl font-bold">Hướng dẫn & chính sách</h1>
      <p className="mt-1 text-fg-muted">RaceHub chơi thế nào, quy định và quyền của bạn.</p>
      {groups.map((g) => (
        <section key={g.section} className="mt-6">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-fg-subtle">{SECTION_LABEL[g.section]}</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {g.items.map((p) => (
              <li key={p.slug}>
                <Link href={staticHref(p.slug)} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-surface-2">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-lg" aria-hidden>{p.icon ?? '📄'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{p.title}</span>
                    {p.summary && <span className="block truncate text-xs text-fg-muted">{p.summary}</span>}
                  </span>
                  <ChevronRight className="size-4 text-fg-subtle" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </HelpShell>
  )
}
