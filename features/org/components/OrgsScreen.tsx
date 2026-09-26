'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Building2, ChevronRight, KeyRound } from 'lucide-react'
import { Button, Card, EmptyState, ErrorState, Input, SectionTitle, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { listMyOrgs, orgErrorMessage } from '../api/orgApi'
import { KIND_LABEL } from '../model/org'
import { OrgLogo } from './OrgHeader'

/** Tổ chức của tôi + nhập mã mời + giới thiệu gói Doanh nghiệp */
export function OrgsScreen() {
  const router = useRouter()
  const q = useQuery({ queryKey: ['orgs', 'mine'], queryFn: listMyOrgs })
  const [code, setCode] = useState('')
  return (
    <div className="space-y-6 pb-8">
      <div>
        <h1 className="text-2xl font-bold">Tổ chức</h1>
        <p className="text-sm text-fg-muted">Doanh nghiệp, liên đoàn, trường học bạn đang tham gia trên RaceHub.</p>
      </div>

      <Card className="space-y-2">
        <p className="flex items-center gap-2 text-sm font-semibold"><KeyRound className="size-4 text-brand" aria-hidden />Có mã mời từ tổ chức?</p>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim().length >= 6) router.push(routes.orgJoin(code.trim())) }}>
          <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 12))} placeholder="VD: 4F2A9C1B"
            aria-label="Mã mời tổ chức" className="font-mono uppercase tracking-widest" />
          <Button type="submit" className="shrink-0" disabled={code.trim().length < 6}>Vào</Button>
        </form>
      </Card>

      <section>
        <SectionTitle>Tổ chức của tôi</SectionTitle>
        {q.isPending ? <Skeleton className="h-24" />
          : q.isError ? <ErrorState message={orgErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
          : !q.data.length ? <EmptyState icon={Building2} title="Chưa tham gia tổ chức nào" description="Nhập mã mời do công ty / liên đoàn gửi, hoặc mở link mời họ chia sẻ." />
          : (
            <ul className="space-y-2">
              {q.data.map((o) => (
                <li key={o.id}>
                  <Link href={routes.org(o.id)} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 hover:border-fg-subtle">
                    <OrgLogo org={o} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{o.name}</span>
                      <span className="block text-xs text-fg-muted">
                        {KIND_LABEL[o.kind]} · {o.seats_used} thành viên{o.club_count ? ` · ${o.club_count} CLB` : ''}
                      </span>
                    </span>
                    {o.my_status === 'PENDING'
                      ? <span className="rounded-full bg-coin/15 px-2 py-0.5 text-[11px] font-semibold text-coin">Chờ duyệt</span>
                      : o.my_role !== 'MEMBER' && <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-semibold text-brand">Quản trị</span>}
                    <ChevronRight className="size-4 text-fg-subtle" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
      </section>

      <Link href={routes.enterprise} className={cn('block overflow-hidden rounded-2xl border border-brand/30 p-4',
        'bg-gradient-to-br from-brand/15 via-surface to-surface')}>
        <p className="flex items-center gap-2 font-bold"><Building2 className="size-5 text-brand" aria-hidden />RaceHub Doanh nghiệp</p>
        <p className="mt-1 text-sm text-fg-muted">Chiến dịch sức khoẻ cho nhân viên, xếp hạng phòng ban, quản lý nhiều CLB, báo cáo cho nhân sự.</p>
        <p className="mt-2 text-sm font-semibold text-brand">Xem gói & nhận báo giá →</p>
      </Link>
    </div>
  )
}
