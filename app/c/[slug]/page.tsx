import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { CalendarDays, Flag, Lock, Trophy, Users } from 'lucide-react'
import { createSupabaseServerClient } from '@/shared/lib/supabase-server'
import { MenuDrawer } from '@/features/help'
import { CLUB_THEMES, type ClubTheme } from '@/features/club'

interface PublicClub {
  id: string; slug: string; name: string; description: string | null; avatar_url: string | null; accent_color: string | null
  member_count: number; join_policy: 'OPEN' | 'APPROVAL' | 'INVITE_ONLY'; founded_at: string
  events_held: number; events_upcoming: number; challenges_held: number
  /** Tường nhà CLB Pro (migration 008100) */
  cover_url?: string | null; cover_position?: number | null; tagline?: string | null; theme?: ClubTheme | null
}

const load = cache(async (slug: string) => {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('club_public_page', { p_slug: slug })
  return error ? null : (data as PublicClub | null)
})

export async function generateMetadata({ params }: PageProps<'/c/[slug]'>): Promise<Metadata> {
  const c = await load((await params).slug)
  if (!c) return { title: 'CLB trên RaceHub' }
  const description = c.description?.slice(0, 160) ?? `${c.name} — câu lạc bộ chạy bộ trên RaceHub. ${c.member_count} thành viên.`
  return { title: c.name, description, openGraph: { title: `${c.name} · RaceHub`, description, images: c.cover_url ? [c.cover_url] : c.avatar_url ? [c.avatar_url] : undefined } }
}

// Trang công khai của CLB Pro (migration 008000): xem được khi chưa đăng nhập, không có dữ liệu bài chạy / tên thành viên
export default async function ClubPublicPage({ params }: PageProps<'/c/[slug]'>) {
  const { slug } = await params
  const c = await load(slug)
  if (!c) notFound()
  const accent = c.accent_color ?? '#b6ff3b'
  const year = new Date(c.founded_at).getFullYear()
  const theme = c.theme ? CLUB_THEMES[c.theme] : null
  const dark = !!(c.cover_url || theme)
  const stats = [
    { icon: Users, label: 'Thành viên', value: c.member_count },
    { icon: Flag, label: 'Buổi chạy nhóm', value: c.events_held },
    { icon: Trophy, label: 'Thử thách', value: c.challenges_held },
  ]
  return (
    <main className="mx-auto min-h-dvh max-w-2xl pb-16">
      <nav className="flex items-center gap-1 px-4 pt-[max(env(safe-area-inset-top),0.5rem)]">
        <MenuDrawer className="-ml-2" />
        <Link href="/" className="text-lg font-extrabold tracking-wide">RACE<span className="text-brand">HUB</span></Link>
      </nav>
      <header className={`relative mt-2 overflow-hidden px-5 pb-8 text-center ${c.cover_url ? 'pt-32' : 'pt-10'}`}
        style={{ background: theme ? theme.bg : `radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, ${accent} 35%, transparent), transparent 70%)` }}>
        {c.cover_url && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- ảnh bìa CLB */}
            <img src={c.cover_url} alt="" className="absolute inset-0 size-full object-cover" style={{ objectPosition: `50% ${c.cover_position ?? 50}%` }} />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/10" />
          </>
        )}
        <div className="relative">
        <div className="mx-auto grid size-28 place-items-center overflow-hidden rounded-3xl border-4 bg-surface text-4xl font-black shadow-xl"
          style={{ borderColor: accent }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- logo CLB */}
          {c.avatar_url ? <img src={c.avatar_url} alt="" className="size-full object-cover" /> : c.name.slice(0, 2).toUpperCase()}
        </div>
        <h1 className={`mt-4 text-3xl font-extrabold leading-tight ${dark ? 'text-white drop-shadow' : ''}`}>{c.name}</h1>
        {c.tagline && <p className={`mt-1 text-base font-medium italic ${dark ? 'text-white/90 drop-shadow' : 'text-fg-muted'}`}>“{c.tagline}”</p>}
        <p className={`mt-2 text-sm ${dark ? 'text-white/80' : 'text-fg-muted'}`}>Câu lạc bộ chạy bộ · thành lập {year} · <span className="rounded-full bg-gradient-to-r from-coin to-amber-300 px-2 py-0.5 text-[11px] font-black text-bg">✦ PRO</span></p>
        </div>
      </header>

      <section className="grid grid-cols-3 gap-2 px-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-surface p-3 text-center">
            <s.icon className="mx-auto size-5" style={{ color: accent }} aria-hidden />
            <p className="mt-1 font-mono text-2xl font-bold">{s.value.toLocaleString('vi-VN')}</p>
            <p className="text-xs text-fg-muted">{s.label}</p>
          </div>
        ))}
      </section>

      {c.description && (
        <section className="mx-4 mt-5 rounded-2xl border border-border bg-surface p-4">
          <h2 className="mb-2 font-semibold">Giới thiệu</h2>
          <p className="whitespace-pre-line text-[15px] leading-relaxed text-fg-muted">{c.description}</p>
        </section>
      )}
      {c.events_upcoming > 0 && (
        <p className="mx-4 mt-3 flex items-center gap-2 rounded-2xl bg-surface-2 px-4 py-3 text-sm">
          <CalendarDays className="size-4 shrink-0" style={{ color: accent }} aria-hidden />
          {c.events_upcoming} buổi chạy nhóm sắp tới — tham gia CLB để xem lịch và đăng ký.
        </p>
      )}

      <section className="mx-4 mt-6 space-y-2">
        {c.join_policy === 'INVITE_ONLY' ? (
          <p className="flex items-center justify-center gap-2 rounded-2xl border border-border p-4 text-sm text-fg-muted">
            <Lock className="size-4" aria-hidden />CLB chỉ nhận thành viên qua link mời của ban quản trị.
          </p>
        ) : (
          <Link href={`/c/${c.slug}/join`} className="flex min-h-13 items-center justify-center rounded-2xl text-base font-extrabold text-bg shadow-lg"
            style={{ backgroundColor: accent }}>
            {c.join_policy === 'OPEN' ? 'Tham gia CLB trên RaceHub' : 'Xin gia nhập CLB'}
          </Link>
        )}
        <p className="text-center text-xs text-fg-subtle">Chưa có tài khoản? Đăng ký miễn phí — chạy bộ, thử thách, BXH và nhân vật riêng của bạn.</p>
      </section>
    </main>
  )
}
