'use client'

import { Building2 } from 'lucide-react'
import { CLUB_THEMES } from '@/features/club'
import { cn } from '@/shared/lib/cn'
import type { Org, OrgTheme } from '../api/orgApi'
import { KIND_LABEL } from '../model/org'

const SIZES = { sm: 'size-11 rounded-xl', md: 'size-14 rounded-2xl', lg: 'size-20 rounded-3xl' } as const

export function OrgLogo({ org, size = 'md', className }: { org: Pick<Org, 'name' | 'logo_url'>; size?: keyof typeof SIZES; className?: string }) {
  return (
    <span className={cn('grid shrink-0 place-items-center overflow-hidden border border-border bg-surface-2 text-fg-muted', SIZES[size], className)}>
      {org.logo_url
        // eslint-disable-next-line @next/next/no-img-element -- logo tổ chức từ Supabase Storage
        ? <img src={org.logo_url} alt="" className="size-full object-cover" />
        : <Building2 className={size === 'lg' ? 'size-9' : 'size-5'} aria-hidden />}
      <span className="sr-only">{org.name}</span>
    </span>
  )
}

export const themeBg = (theme: OrgTheme | null | undefined) =>
  theme ? CLUB_THEMES[theme].bg : 'linear-gradient(135deg, color-mix(in srgb, var(--color-brand) 35%, #0b1020) 0%, #0b1020 75%)'

/** Đầu trang tổ chức: ảnh bìa / chủ đề, logo, tên, khẩu hiệu */
export function OrgHeader({ org, extra }: {
  org: Pick<Org, 'name' | 'logo_url' | 'cover_url' | 'cover_position' | 'tagline' | 'theme' | 'kind'>; extra?: React.ReactNode
}) {
  return (
    <header className="relative -mx-4 overflow-hidden sm:mx-0 sm:rounded-2xl" style={{ background: themeBg(org.theme) }}>
      {org.cover_url && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- ảnh bìa tổ chức */}
          <img src={org.cover_url} alt="" className="absolute inset-0 size-full object-cover" style={{ objectPosition: `50% ${org.cover_position ?? 50}%` }} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/10" />
        </>
      )}
      <div className={cn('relative flex items-end gap-4 px-4 pb-4', org.cover_url ? 'pt-24' : 'pt-10')}>
        <OrgLogo org={org} size="lg" className="border-2 border-white/70 shadow-lg" />
        <div className="min-w-0 flex-1 text-white">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-white/70">{KIND_LABEL[org.kind]}</p>
          <h1 className="text-xl font-bold leading-tight drop-shadow sm:text-2xl">{org.name}</h1>
          {org.tagline && <p className="mt-0.5 text-sm italic text-white/90 drop-shadow">“{org.tagline}”</p>}
          {extra}
        </div>
      </div>
    </header>
  )
}
