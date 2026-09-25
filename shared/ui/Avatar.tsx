import { Sparkles, Crown } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { SHINE_NAMES, type ShineTier } from '@/shared/lib/shine'

const SIZES = { xs: 'size-6 text-xs', sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-14 text-lg', xl: 'size-20 text-2xl' } as const

/** Chữ cái đầu của hai từ cuối: "Nguyễn Văn An" → "VA" */
export function initials(name: string | null | undefined) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return parts.slice(-2).map((p) => p[0]).join('').toUpperCase()
}

export function Avatar({ src, name, size = 'md', ring, shine = 0, className }: {
  src?: string | null; name?: string | null; size?: keyof typeof SIZES; ring?: string | null
  /** Bậc Tỏa sáng 0–4: khung phát sáng quanh ảnh (người được cộng đồng tặng quà nhiều) */
  shine?: ShineTier | number; className?: string
}) {
  const face = (
    <span
      className={cn('relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-surface-2 font-semibold text-fg-muted',
        ring && 'ring-2 ring-offset-2 ring-offset-bg', SIZES[size], shine > 0 ? 'shine-inner' : className)}
      style={ring ? ({ '--tw-ring-color': ring } as React.CSSProperties) : undefined}
    >
      {src
        // eslint-disable-next-line @next/next/no-img-element -- ảnh từ Supabase Storage, kích thước nhỏ
        ? <img src={src} alt="" className="size-full object-cover" loading="lazy" />
        : <span aria-hidden>{initials(name)}</span>}
      <span className="sr-only">{name ?? ''}</span>
    </span>
  )
  if (!shine || shine <= 0) return face
  const t = Math.min(4, Math.max(1, Math.round(shine))) as 1 | 2 | 3 | 4
  const big = size === 'lg' || size === 'xl'
  const Badge = t === 4 ? Crown : Sparkles
  return (
    <span className={cn('shine-frame', `shine-t${t}`, className)} title={`Tỏa sáng ${SHINE_NAMES[t]}`}>
      {face}
      {t >= 2 && (
        <span className={cn('shine-badge', big ? 'size-6' : 'size-4')} aria-hidden>
          <Badge className={cn(big ? 'size-4' : 'size-2.5', t === 4 ? 'text-rarity-epic' : 'text-coin')} />
        </span>
      )}
      <span className="sr-only">, Tỏa sáng {SHINE_NAMES[t]}</span>
    </span>
  )
}

/** Nhãn bậc Tỏa sáng cạnh tên */
export function ShineBadge({ tier, className }: { tier: ShineTier | number; className?: string }) {
  if (!tier) return null
  const t = Math.min(4, Math.max(1, Math.round(tier))) as 1 | 2 | 3 | 4
  const tone = ['', 'bg-surface-2 text-fg', 'bg-coin/15 text-coin', 'bg-coin/20 text-coin', 'bg-rarity-epic/20 text-rarity-epic'][t]
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold', tone, className)}>
      {t === 4 ? <Crown className="size-3" aria-hidden /> : <Sparkles className="size-3" aria-hidden />}{SHINE_NAMES[t]}
    </span>
  )
}

export function AvatarStack({ people, max = 4, size = 'sm' }: {
  people: { id: string; name?: string | null; src?: string | null }[]; max?: number; size?: keyof typeof SIZES
}) {
  const shown = people.slice(0, max)
  const rest = people.length - shown.length
  return (
    <span className="flex -space-x-2">
      {shown.map((p) => <Avatar key={p.id} src={p.src} name={p.name} size={size} className="border-2 border-bg" />)}
      {rest > 0 && <span className={cn('grid place-items-center rounded-full border-2 border-bg bg-surface-2 font-semibold text-fg-muted', SIZES[size])}>+{rest}</span>}
    </span>
  )
}
