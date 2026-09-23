import { cn } from '@/shared/lib/cn'

const SIZES = { xs: 'size-6 text-xs', sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-14 text-lg', xl: 'size-20 text-2xl' } as const

/** Chữ cái đầu của hai từ cuối: "Nguyễn Văn An" → "VA" */
export function initials(name: string | null | undefined) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return parts.slice(-2).map((p) => p[0]).join('').toUpperCase()
}

export function Avatar({ src, name, size = 'md', ring, className }: {
  src?: string | null; name?: string | null; size?: keyof typeof SIZES; ring?: string | null; className?: string
}) {
  return (
    <span
      className={cn('relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-surface-2 font-semibold text-fg-muted',
        ring && 'ring-2 ring-offset-2 ring-offset-bg', SIZES[size], className)}
      style={ring ? ({ '--tw-ring-color': ring } as React.CSSProperties) : undefined}
    >
      {src
        // eslint-disable-next-line @next/next/no-img-element -- ảnh từ Supabase Storage, kích thước nhỏ
        ? <img src={src} alt="" className="size-full object-cover" loading="lazy" />
        : <span aria-hidden>{initials(name)}</span>}
      <span className="sr-only">{name ?? ''}</span>
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
