'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Crown } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, ConfirmSheet, SectionTitle } from '@/shared/ui'
import { routes } from '@/shared/config/routes'
import { getClubOrgs, orgErrorMessage, removeOrgClub, respondOrgInvite } from '../api/orgApi'
import { KIND_LABEL, fmtDay } from '../model/org'
import { OrgLogo } from './OrgHeader'

/** Cài đặt CLB: tổ chức / liên đoàn CLB đang thuộc + lời mời đang chờ (migration 008300) */
export function ClubOrgCard({ clubId }: { clubId: string }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['club', clubId, 'orgs'], queryFn: () => getClubOrgs(clubId) })
  const [leave, setLeave] = useState(false)
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['club', clubId] }) }
  const respond = useMutation({
    mutationFn: ({ org, accept }: { org: string; accept: boolean }) => respondOrgInvite(org, clubId, accept),
    onSuccess: (_, v) => { toast.success(v.accept ? 'CLB đã vào tổ chức' : 'Đã từ chối lời mời'); refresh() },
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: (org: string) => removeOrgClub(org, clubId),
    onSuccess: () => { setLeave(false); toast.success('CLB đã rời tổ chức'); refresh() },
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  const d = q.data
  if (!d || (!d.current && !d.invites.length)) return null
  return (
    <section>
      <SectionTitle>Tổ chức / liên đoàn</SectionTitle>
      <Card className="space-y-3">
        {d.current && (
          <div className="flex items-center gap-3">
            <OrgLogo org={d.current} size="sm" />
            <div className="min-w-0 flex-1">
              <Link href={routes.org(d.current.id)} className="block truncate font-semibold">{d.current.name}</Link>
              <p className="text-xs text-fg-muted">{KIND_LABEL[d.current.kind]}</p>
              {d.current.pro_granted && (
                <p className="flex items-center gap-1 text-xs text-coin"><Crown className="size-3.5" aria-hidden />
                  CLB Pro do tổ chức tài trợ{d.current.granted_until ? ` đến ${fmtDay(d.current.granted_until)}` : ''}</p>
              )}
            </div>
            {d.is_staff && <Button size="sm" variant="ghost" onClick={() => setLeave(true)}>Rời</Button>}
          </div>
        )}
        {d.invites.map((o) => (
          <div key={o.id} className="space-y-2 rounded-xl border border-brand/40 bg-brand/5 p-3">
            <div className="flex items-center gap-3">
              <OrgLogo org={o} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{o.name}</p>
                <p className="text-xs text-fg-muted">mời CLB tham gia · {KIND_LABEL[o.kind]}</p>
              </div>
            </div>
            <p className="text-xs text-fg-muted">
              Thành viên CLB được tính vào chiến dịch của tổ chức (tổng km / số buổi, không lộ bản đồ).
              {o.include_club_pro ? ' CLB được nâng Pro miễn phí trong thời hạn hợp đồng.' : ''}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="secondary" loading={respond.isPending && !respond.variables?.accept} onClick={() => respond.mutate({ org: o.id, accept: false })}>Từ chối</Button>
              <Button size="sm" loading={respond.isPending && respond.variables?.accept} onClick={() => respond.mutate({ org: o.id, accept: true })}>
                <Building2 className="size-4" aria-hidden />Đồng ý
              </Button>
            </div>
          </div>
        ))}
      </Card>
      <ConfirmSheet open={leave} onClose={() => setLeave(false)} title="CLB rời tổ chức?"
        description={d.current?.pro_granted ? 'CLB trở về gói trước khi được tài trợ Pro.' : 'Thành viên CLB không còn được tính vào chiến dịch của tổ chức.'}
        confirmLabel="Rời tổ chức" loading={remove.isPending} onConfirm={() => d.current && remove.mutate(d.current.id)} />
    </section>
  )
}
