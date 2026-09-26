'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, EmptyState, ErrorState, Field, Input, Skeleton } from '@/shared/ui'
import { routes } from '@/shared/config/routes'
import { joinOrg, orgErrorMessage, previewOrgInvite } from '../api/orgApi'
import { OrgHeader } from './OrgHeader'
import { unitOptions } from '../model/org'

/** Vào tổ chức bằng mã mời: xem trước, chọn đơn vị, đồng ý chia sẻ số liệu chạy */
export function JoinOrgScreen({ code }: { code: string }) {
  const router = useRouter()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['org-invite', code], queryFn: () => previewOrgInvite(code) })
  const [unit, setUnit] = useState<string>('')
  const [emp, setEmp] = useState('')
  const join = useMutation({
    mutationFn: () => joinOrg(code, unit || null, emp),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['orgs'] })
      if (r.status === 'APPROVED') { toast.success('Đã vào tổ chức'); router.replace(routes.org(r.org_id)) }
      else { toast.success('Đã gửi yêu cầu — chờ quản trị tổ chức duyệt'); router.replace(routes.orgs) }
    },
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  if (q.isPending) return <Skeleton className="h-64" />
  if (q.isError) return <ErrorState message={orgErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
  const o = q.data
  if (!o) return <EmptyState icon={Building2} title="Mã mời không đúng" description="Mã có thể đã được đổi. Hãy xin mã mới từ quản trị tổ chức." />
  return (
    <div className="space-y-4 pb-8">
      <OrgHeader org={o} extra={<p className="mt-1 text-xs text-white/80">{o.member_count} thành viên</p>} />
      {o.description && <p className="whitespace-pre-line text-sm text-fg-muted">{o.description}</p>}
      {o.my_status ? (
        <Card className="text-sm">
          {o.my_status === 'APPROVED' ? 'Bạn đã là thành viên.' : 'Bạn đã gửi yêu cầu, đang chờ quản trị tổ chức duyệt.'}
          {o.my_status === 'APPROVED' && <Button className="mt-3" block onClick={() => router.push(routes.org(o.id))}>Mở tổ chức</Button>}
        </Card>
      ) : o.blocked ? (
        <Card className="space-y-1 text-sm">
          <p className="font-semibold">Chỉ nhận tài khoản dùng email công ty</p>
          <p className="text-fg-muted">Hãy đăng nhập RaceHub bằng email @{o.email_domains.join(', @')} rồi mở lại link này.</p>
        </Card>
      ) : !o.active ? (
        <Card className="text-sm text-fg-muted">Gói của tổ chức đã hết hạn hoặc tạm dừng — chưa nhận thành viên mới.</Card>
      ) : o.full && o.auto_approve ? (
        <Card className="text-sm text-fg-muted">Tổ chức đã đủ số chỗ. Hãy báo quản trị tổ chức.</Card>
      ) : (
        <Card className="space-y-3">
          {o.allow_self_unit && o.units.length > 0 && (
            <Field label={o.unit_label} htmlFor="j-unit">
              <select id="j-unit" value={unit} onChange={(e) => setUnit(e.target.value)} className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-[15px]">
                <option value="">— Chọn {o.unit_label.toLowerCase()} —</option>
                {unitOptions(o.units).map((u) => <option key={u.id} value={u.id}>{u.path}</option>)}
              </select>
            </Field>
          )}
          <Field label="Mã nhân viên / học viên (không bắt buộc)" htmlFor="j-emp">
            <Input id="j-emp" value={emp} maxLength={40} onChange={(e) => setEmp(e.target.value)} />
          </Field>
          <p className="flex gap-2 rounded-xl bg-surface-2 p-3 text-xs text-fg-muted">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            <span>Khi vào tổ chức, quản trị tổ chức thấy tên, đơn vị và <b>tổng km / số buổi / số ngày chạy</b> của bạn trong các chiến dịch và báo cáo.
              Không thấy vị trí, bản đồ hay nhịp tim. Bài bạn tắt chia sẻ không được tính. Bạn rời tổ chức bất cứ lúc nào.</span>
          </p>
          <Button block size="lg" loading={join.isPending} onClick={() => join.mutate()}>
            {o.auto_approve ? 'Đồng ý & vào tổ chức' : 'Đồng ý & gửi yêu cầu'}
          </Button>
        </Card>
      )}
    </div>
  )
}
