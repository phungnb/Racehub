import { Shield } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { accentOf } from '../../model/roles'

const SIZES = { sm: 'size-10 rounded-xl', md: 'size-12 rounded-2xl', lg: 'size-20 rounded-3xl' } as const

/** Logo CLB; chưa có logo thì dùng khiên với màu CLB */
export function ClubAvatar({ club, size = 'md', className }: {
  club: { name: string; avatar_url: string | null; accent_color?: string | null }; size?: keyof typeof SIZES; className?: string
}) {
  const accent = accentOf(club)
  return (
    <span className={cn('grid shrink-0 place-items-center overflow-hidden border border-border bg-surface-2', SIZES[size], className)}
      style={{ color: accent }}>
      {club.avatar_url
        // eslint-disable-next-line @next/next/no-img-element -- ảnh logo từ Supabase Storage
        ? <img src={club.avatar_url} alt="" className="size-full object-cover" />
        : <Shield className={size === 'lg' ? 'size-9' : 'size-5'} aria-hidden />}
      <span className="sr-only">{club.name}</span>
    </span>
  )
}
