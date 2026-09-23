'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowUpRight, Gift, HandCoins, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { useInvalidateProfile, useMyProfile } from '@/features/auth'
import { Avatar, Button, Card, CoinAmount, EmptyState, ErrorState, Field, Input, SectionTitle, Sheet, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin, formatRelative } from '@/shared/lib/format'
import { clubErrorMessage, contributeTreasury, type TreasuryEntry } from '../../api/clubApi'
import { useClub, useTreasury } from '../../hooks/useClub'
import { clubKeys } from '../../hooks/keys'

const KIND: Record<TreasuryEntry['kind'], { label: string; icon: typeof Gift; tone: string; sign: string }> = {
  CONTRIBUTE: { label: 'Góp quỹ', icon: ArrowDownLeft, tone: 'text-brand', sign: '+' },
  SPEND: { label: 'Chi quỹ', icon: ArrowUpRight, tone: 'text-danger', sign: '−' },
  REWARD: { label: 'Thưởng thử thách', icon: Gift, tone: 'text-coin', sign: '−' },
}

/** Quỹ CLB bằng Xu (MH21): số dư minh bạch, ai góp bao nhiêu, chi vào đâu */
export function ClubTreasuryScreen({ clubId }: { clubId: string }) {
  const { club } = useClub(clubId)
  const log = useTreasury(clubId)
  const [open, setOpen] = useState(false)

  return (
    <div className="space-y-6">
      <Card className="space-y-4 bg-gradient-to-br from-coin/10 to-transparent">
        <div className="flex items-center gap-2 text-sm text-fg-muted"><Wallet className="size-4" aria-hidden />Quỹ CLB</div>
        {club ? <CoinAmount value={club.treasury_balance} className="text-4xl [&_svg]:size-7" /> : <Skeleton className="h-10 w-40" />}
        <p className="text-sm text-fg-muted">Quỹ dùng để treo thưởng cho thử thách nội bộ và các hoạt động chung của CLB. Mọi khoản góp và chi đều hiện công khai bên dưới.</p>
        <Button variant="coin" block onClick={() => setOpen(true)}><HandCoins className="size-4" aria-hidden />Góp quỹ</Button>
      </Card>

      <section>
        <SectionTitle>Lịch sử quỹ</SectionTitle>
        {log.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : log.isError ? (
          <ErrorState onRetry={() => log.refetch()} />
        ) : !log.data?.length ? (
          <EmptyState icon={HandCoins} title="Chưa có khoản nào" description="Hãy là người góp quỹ đầu tiên cho CLB." />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
            {log.data.map((e) => {
              const k = KIND[e.kind]
              return (
                <li key={e.id} className="flex items-center gap-3 px-4 py-3">
                  <Avatar src={e.user?.avatar_url} name={e.user?.display_name ?? 'CLB'} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{e.user?.display_name ?? 'Ban quản trị'}</span>
                    <span className="flex items-center gap-1 text-xs text-fg-subtle">
                      <k.icon className={cn('size-3.5', k.tone)} aria-hidden />{e.note || k.label} · {formatRelative(e.created_at)}
                    </span>
                  </span>
                  <span className={cn('font-mono tabular font-bold', k.tone)}>{k.sign}{formatCoin(Math.abs(e.amount))}</span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <ContributeSheet clubId={clubId} open={open} onClose={() => setOpen(false)} />
    </div>
  )
}

function ContributeSheet({ clubId, open, onClose }: { clubId: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const { profile } = useMyProfile()
  const invalidateProfile = useInvalidateProfile()
  const [amount, setAmount] = useState('')
  const value = Number(amount.replace(/\D/g, ''))
  const balance = Number(profile?.xu ?? 0)
  const tooMuch = value > balance
  const give = useMutation({
    mutationFn: () => contributeTreasury(clubId, value),
    onSuccess: () => {
      toast.success(`Cảm ơn bạn đã góp ${formatCoin(value)} Xu vào quỹ!`)
      setAmount('')
      onClose()
      void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) })
      void qc.invalidateQueries({ queryKey: clubKeys.treasury(clubId) })
      invalidateProfile()
    },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  return (
    <Sheet open={open} onClose={onClose} title="Góp quỹ CLB" description={`Ví của bạn: ${formatCoin(balance)} Xu`}
      footer={<Button variant="coin" block onClick={() => give.mutate()} loading={give.isPending} disabled={!value || tooMuch}>Góp {value ? formatCoin(value) : ''} Xu</Button>}>
      <div className="space-y-3">
        <Field label="Số Xu" htmlFor="xu" error={tooMuch ? 'Số Xu trong ví không đủ.' : null}>
          <Input id="xu" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, '').slice(0, 7))}
            placeholder="0" className="font-mono text-2xl" />
        </Field>
        <div className="flex gap-2">
          {[50, 100, 500].map((v) => (
            <Button key={v} variant="secondary" size="sm" className="flex-1" onClick={() => setAmount(String(v))} disabled={v > balance}>{v}</Button>
          ))}
        </div>
      </div>
    </Sheet>
  )
}
