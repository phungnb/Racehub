import type { Metadata } from 'next'
import Link from 'next/link'
import { cache } from 'react'
import { BadgeCheck, ShieldAlert } from 'lucide-react'
import { createSupabaseServerClient } from '@/shared/lib/supabase-server'
import { MenuDrawer } from '@/features/help'
import { StatusBarScrim } from '@/shared/ui/StatusBarScrim'

interface Verified {
  code: string
  kind: string
  award: string | null
  issued_by: string | null
  created_at: string
  updated_at: string
  person: { display_name: string | null; avatar_url: string | null; level: number }
  facts: { headline: string; title: string; subtitle: string | null; date: string | null; club: string | null; stats: { key: string; label: string; value: string }[]; honors: string[] }
}

const KIND: Record<string, string> = { CHALLENGE: 'Thử thách', RUN: 'Thành tích cá nhân', TOTAL_KM: 'Cột mốc hành trình', LEVEL: 'Level', BADGE: 'Huy hiệu' }

const load = cache(async (code: string) => {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('verify_victory', { p_code: code })
  return error ? null : (data as Verified | null)
})

export async function generateMetadata({ params }: PageProps<'/v/[code]'>): Promise<Metadata> {
  const v = await load((await params).code)
  if (!v) return { title: 'Xác thực thành tích', robots: { index: false } }
  const title = `${v.person.display_name ?? 'Runner'} · ${v.award ?? v.facts.headline}`
  return { title, description: `${v.facts.title} — thành tích đã xác thực trên RaceHub (mã ${v.code}).`, robots: { index: false } }
}

// Trang xác thực ảnh vinh danh (Victory Studio, migration 011600): quét QR trên ảnh → xem số liệu gốc trên RaceHub, không cần đăng nhập
export default async function VerifyVictoryPage({ params }: PageProps<'/v/[code]'>) {
  const { code } = await params
  const v = await load(code)
  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 pb-16">
      <StatusBarScrim />
      <nav className="flex items-center gap-1 pt-[max(env(safe-area-inset-top),0.5rem)]">
        <MenuDrawer className="-ml-2" />
        <Link href="/" className="text-lg font-extrabold tracking-wide">RACE<span className="text-brand">HUB</span></Link>
      </nav>
      {!v ? (
        <section className="mt-10 rounded-3xl border border-border bg-surface p-6 text-center">
          <ShieldAlert className="mx-auto size-10 text-danger" aria-hidden />
          <h1 className="mt-3 text-xl font-extrabold">Không xác thực được</h1>
          <p className="mt-1 text-sm text-fg-muted">Mã <b className="font-mono">{code.toUpperCase()}</b> không tồn tại hoặc đã bị thu hồi.</p>
        </section>
      ) : (
        <section className="mt-6 space-y-4">
          <div className="flex items-center justify-center gap-2 rounded-full bg-brand/15 px-4 py-2 text-sm font-bold text-brand">
            <BadgeCheck className="size-5" aria-hidden />Thành tích đã được RaceHub xác thực
          </div>
          <div className="rounded-3xl border border-border bg-surface p-5 text-center">
            <div className="mx-auto grid size-24 place-items-center overflow-hidden rounded-full border-4 border-brand bg-surface-2 text-3xl font-black">
              {/* eslint-disable-next-line @next/next/no-img-element -- ảnh đại diện runner */}
              {v.person.avatar_url ? <img src={v.person.avatar_url} alt="" className="size-full object-cover" /> : (v.person.display_name ?? 'R').slice(0, 2).toUpperCase()}
            </div>
            <h1 className="mt-3 text-2xl font-extrabold">{v.person.display_name ?? 'Runner'}</h1>
            <p className="text-xs font-bold uppercase tracking-wider text-fg-subtle">{KIND[v.kind] ?? v.kind}</p>
            {v.award && <p className="mt-3 inline-block rounded-full bg-coin px-3 py-1 text-sm font-extrabold text-black">{v.award}</p>}
            <p className="mt-3 text-lg font-extrabold text-brand">{v.facts.headline}</p>
            <p className="text-base font-semibold">{v.facts.title}</p>
            {v.facts.subtitle && <p className="text-sm text-fg-muted">{v.facts.subtitle}</p>}
            {!!v.facts.honors?.length && <p className="mt-2 text-sm font-semibold text-coin">{v.facts.honors.join(' · ')}</p>}
            <dl className="mt-4 grid grid-cols-2 gap-2 text-left">
              {v.facts.stats.map((s) => (
                <div key={s.key} className="rounded-xl bg-surface-2 px-3 py-2">
                  <dt className="text-[11px] uppercase tracking-wide text-fg-subtle">{s.label}</dt>
                  <dd className="font-mono text-base font-bold">{s.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs text-fg-subtle">
              {[v.facts.club, v.facts.date].filter(Boolean).join(' · ')}
              {v.issued_by && <><br />Vinh danh bởi {v.issued_by}</>}
            </p>
          </div>
          <p className="text-center text-xs text-fg-subtle">
            Mã xác thực <b className="font-mono">{v.code}</b> · cập nhật {new Date(v.updated_at).toLocaleDateString('vi-VN')}
          </p>
          <Link href="/welcome" className="block rounded-2xl bg-brand px-4 py-3 text-center font-bold text-brand-fg">Chạy cùng RaceHub</Link>
        </section>
      )}
    </main>
  )
}
