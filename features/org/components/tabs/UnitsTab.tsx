'use client'

import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Crown, Network, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, ConfirmSheet, EmptyState, Input, SectionTitle, Sheet } from '@/shared/ui'
import { useDebounced } from '@/shared/lib/search'
import { formatNumber } from '@/shared/lib/format'
import { searchClubs } from '@/features/club'
import { deleteOrgUnit, inviteClubToOrg, orgErrorMessage, removeOrgClub, saveOrgUnit, setMyOrgUnit, type OrgClub, type OrgDetail } from '../../api/orgApi'

/** Đơn vị (phòng ban / chi nhánh / lớp) và CLB thuộc tổ chức */
export function UnitsTab({ org }: { org: OrgDetail }) {
  const qc = useQueryClient()
  const refresh = () => void qc.invalidateQueries({ queryKey: ['org', org.id] })
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [del, setDel] = useState<{ id: string; name: string } | null>(null)
  const [inviting, setInviting] = useState(false)
  const [removing, setRemoving] = useState<OrgClub | null>(null)
  const saveUnit = useMutation({
    mutationFn: ({ id, n }: { id: string | null; n: string }) => saveOrgUnit(org.id, id, n),
    onSuccess: () => { setName(''); setEditing(null); refresh() },
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  const delUnit = useMutation({
    mutationFn: (id: string) => deleteOrgUnit(id),
    onSuccess: () => { setDel(null); refresh() },
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  const mine = useMutation({
    mutationFn: (unit: string | null) => setMyOrgUnit(org.id, unit),
    onSuccess: () => { toast.success('Đã đổi đơn vị'); refresh() },
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  const removeClub = useMutation({
    mutationFn: (clubId: string) => removeOrgClub(org.id, clubId),
    onSuccess: () => { setRemoving(null); toast.success('Đã bỏ CLB khỏi tổ chức'); refresh() },
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  const showClubs = org.kind === 'FEDERATION' || org.club_limit > 0 || org.clubs.length > 0

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <SectionTitle>{org.unit_label}</SectionTitle>
        {org.is_real_member && org.allow_self_unit && org.units.length > 0 && (
          <label className="block rounded-xl border border-border bg-surface p-3 text-sm">
            <span className="font-semibold">{org.unit_label} của bạn</span>
            <select value={org.my_unit_id ?? ''} onChange={(e) => mine.mutate(e.target.value || null)} disabled={mine.isPending}
              className="mt-1 h-11 w-full rounded-xl border border-border bg-surface px-3 text-[15px]">
              <option value="">— Chưa chọn —</option>
              {org.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
        )}
        {!org.units.length ? (
          <p className="text-sm text-fg-muted">{org.is_admin ? `Thêm ${org.unit_label.toLowerCase()} để xếp hạng theo nhóm trong chiến dịch.` : 'Chưa có đơn vị.'}</p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
            {org.units.map((u) => (
              <li key={u.id} className="flex items-center gap-2 px-3 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{u.name}</span>
                <span className="text-xs text-fg-muted">{u.members} người</span>
                {org.is_admin && (
                  <>
                    <Button size="sm" variant="ghost" aria-label={`Đổi tên ${u.name}`} onClick={() => setEditing({ id: u.id, name: u.name })}><Pencil className="size-4" aria-hidden /></Button>
                    <Button size="sm" variant="ghost" aria-label={`Xoá ${u.name}`} onClick={() => setDel({ id: u.id, name: u.name })}><Trash2 className="size-4" aria-hidden /></Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {org.is_admin && (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) saveUnit.mutate({ id: null, n: name }) }}>
            <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={`Thêm ${org.unit_label.toLowerCase()}, vd: Phòng Kinh doanh`} aria-label={`Tên ${org.unit_label}`} />
            <Button type="submit" className="shrink-0" loading={saveUnit.isPending && !editing} disabled={!name.trim()}><Plus className="size-4" aria-hidden />Thêm</Button>
          </form>
        )}
      </section>

      {showClubs && (
        <section className="space-y-2">
          <SectionTitle action={org.is_admin && org.active ? <Button size="sm" onClick={() => setInviting(true)}><Plus className="size-4" aria-hidden />Mời CLB</Button> : undefined}>
            CLB thuộc tổ chức {org.club_limit > 0 && org.is_admin ? `(${org.clubs.length}/${org.club_limit})` : ''}
          </SectionTitle>
          {org.include_club_pro && <p className="flex items-center gap-1.5 text-xs text-coin"><Crown className="size-3.5" aria-hidden />Gói có tài trợ CLB Pro cho mọi CLB thành viên.</p>}
          {!org.clubs.length ? (
            <EmptyState icon={Network} title="Chưa có CLB" description={org.is_admin ? 'Mời CLB tham gia — thành viên CLB được tính vào chiến dịch của tổ chức.' : 'Tổ chức chưa có CLB thành viên.'} />
          ) : (
            <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
              {org.clubs.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                  <ClubLogo c={c} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{c.name}</span>
                    <span className="block text-xs text-fg-muted">{formatNumber(c.member_count)} thành viên{c.pro_granted ? ' · Pro tài trợ' : ''}</span></span>
                  {c.status === 'PENDING' && <span className="rounded-full bg-coin/15 px-2 py-0.5 text-[11px] font-semibold text-coin">Chờ CLB đồng ý</span>}
                  {org.is_admin && <Button size="sm" variant="ghost" aria-label={`Bỏ ${c.name}`} onClick={() => setRemoving(c)}><X className="size-4" aria-hidden /></Button>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {editing && (
        <Sheet open onClose={() => setEditing(null)} title={`Đổi tên ${org.unit_label.toLowerCase()}`}
          footer={<Button block loading={saveUnit.isPending} disabled={!editing.name.trim()} onClick={() => saveUnit.mutate({ id: editing.id, n: editing.name })}>Lưu</Button>}>
          <Input value={editing.name} maxLength={80} onChange={(e) => setEditing({ ...editing, name: e.target.value })} aria-label="Tên mới" />
        </Sheet>
      )}
      <ConfirmSheet open={!!del} onClose={() => setDel(null)} title={`Xoá “${del?.name}”?`} description="Thành viên trong đơn vị này trở về “chưa gán”, không bị xoá khỏi tổ chức."
        confirmLabel="Xoá" loading={delUnit.isPending} onConfirm={() => del && delUnit.mutate(del.id)} />
      <ConfirmSheet open={!!removing} onClose={() => setRemoving(null)} title={`Bỏ ${removing?.name} khỏi tổ chức?`}
        description={removing?.pro_granted ? 'CLB trở về gói trước khi được tổ chức tài trợ Pro.' : 'Thành viên CLB không còn được tính vào chiến dịch.'}
        confirmLabel="Bỏ CLB" loading={removeClub.isPending} onConfirm={() => removing && removeClub.mutate(removing.id)} />
      {inviting && <InviteClubSheet org={org} onClose={() => setInviting(false)} onDone={refresh} />}
    </div>
  )
}

function ClubLogo({ c }: { c: Pick<OrgClub, 'name' | 'avatar_url' | 'accent_color'> }) {
  return (
    <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-surface-2 text-xs font-bold"
      style={{ color: c.accent_color ?? undefined }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- logo CLB */}
      {c.avatar_url ? <img src={c.avatar_url} alt="" className="size-full object-cover" /> : c.name.slice(0, 2).toUpperCase()}
    </span>
  )
}

function InviteClubSheet({ org, onClose, onDone }: { org: OrgDetail; onClose: () => void; onDone: () => void }) {
  const [term, setTerm] = useState('')
  const debounced = useDebounced(term.trim())
  const found = useQuery({ queryKey: ['club-search', debounced], queryFn: () => searchClubs(debounced, 10), placeholderData: keepPreviousData })
  const invite = useMutation({
    mutationFn: (clubId: string) => inviteClubToOrg(org.id, clubId),
    onSuccess: () => { toast.success('Đã gửi lời mời — chờ ban quản trị CLB đồng ý'); onDone(); onClose() },
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  const taken = new Set(org.clubs.map((c) => c.id))
  return (
    <Sheet open onClose={onClose} title="Mời CLB vào tổ chức" description={org.include_club_pro ? 'CLB đồng ý sẽ được nâng Pro trong thời hạn hợp đồng.' : 'Ban quản trị CLB nhận thông báo và trả lời trong Cài đặt CLB.'}>
      <div className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Tìm CLB" className="pl-9" aria-label="Tìm CLB" autoFocus />
        </div>
        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {(found.data ?? []).filter((c) => !taken.has(c.id)).map((c) => (
            <li key={c.id} className="flex items-center gap-3 rounded-xl px-2 py-2">
              <ClubLogo c={c} />
              <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{c.name}</span>
                <span className="text-xs text-fg-subtle">{formatNumber(c.member_count)} thành viên</span></span>
              <Button size="sm" loading={invite.isPending && invite.variables === c.id} onClick={() => invite.mutate(c.id)}>Mời</Button>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  )
}
