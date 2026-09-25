'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button, Field, Input, Sheet } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { addVoucherCodes, saveVoucher, voucherErrorMessage, type VoucherCampaign, type VoucherInput } from '../api/voucherApi'

const toLocal = (iso: string | null | undefined) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '')

/** Tạo / sửa chiến dịch voucher + dán kho mã. target cố định (thử thách hoặc nhiệm vụ). */
export function VoucherForm({ init, target, onClose, onSaved }: {
  init?: VoucherCampaign | null; target: { type: 'CHALLENGE' | 'QUEST'; id: string }; onClose: () => void; onSaved: () => void
}) {
  const [v, setV] = useState<VoucherInput>(() => init ?? { target_type: target.type, target_id: target.id, condition: 'COMPLETE', code_mode: 'POOL', is_active: true })
  const set = (p: Partial<VoucherInput>) => setV((x) => ({ ...x, ...p }))
  const [codes, setCodes] = useState('')
  const list = codes.split(/[\s,;]+/).map((c) => c.trim()).filter(Boolean)
  const save = useMutation({
    mutationFn: async () => {
      const saved = await saveVoucher({ ...v, target_type: target.type, target_id: target.id })
      if (v.code_mode !== 'SHARED' && list.length) {
        const r = await addVoucherCodes(saved.id, list)
        toast.success(`Đã thêm ${r.added} mã${r.issued ? ` · đã phát ${r.issued} voucher` : ''}`)
      }
      return saved
    },
    onSuccess: () => { toast.success('Đã lưu voucher tài trợ'); onSaved(); onClose() },
    onError: (e) => toast.error(voucherErrorMessage(e)),
  })
  const chip = (on: boolean) => cn('rounded-full border px-3 py-1.5 text-xs font-semibold', on ? 'border-brand bg-brand/15' : 'border-border text-fg-muted')
  return (
    <Sheet open onClose={onClose} title={init ? 'Sửa voucher tài trợ' : 'Thêm voucher tài trợ'}
      description="Nhà tài trợ tặng mã giảm giá / quà; runner đạt điều kiện tự nhận. RaceHub không thu tiền hộ."
      footer={<Button block onClick={() => save.mutate()} loading={save.isPending}
        disabled={!v.sponsor_name?.trim() || !v.title?.trim() || (v.code_mode === 'SHARED' && !v.shared_code?.trim())}>Lưu</Button>}>
      <div className="space-y-4">
        <Field label="Nhà tài trợ" htmlFor="vc-sp"><Input id="vc-sp" value={v.sponsor_name ?? ''} maxLength={60} onChange={(e) => set({ sponsor_name: e.target.value })} placeholder="VD: Shop Giày Chạy A" /></Field>
        <Field label="Logo (link ảnh https, không bắt buộc)" htmlFor="vc-logo"><Input id="vc-logo" value={v.sponsor_logo ?? ''} onChange={(e) => set({ sponsor_logo: e.target.value || null })} placeholder="https://…" inputMode="url" /></Field>
        <Field label="Ưu đãi" htmlFor="vc-title"><Input id="vc-title" value={v.title ?? ''} maxLength={80} onChange={(e) => set({ title: e.target.value })} placeholder="VD: Giảm 50.000đ cho đơn từ 500.000đ" /></Field>
        <Field label="Điều kiện sử dụng" htmlFor="vc-terms">
          <textarea id="vc-terms" value={v.terms ?? ''} maxLength={500} rows={3} onChange={(e) => set({ terms: e.target.value || null })}
            className="w-full rounded-xl border border-border bg-surface-2 p-3 text-sm" placeholder="Áp dụng tại cửa hàng / website, không cộng dồn…" />
        </Field>
        <Field label="Link dùng voucher (không bắt buộc)" htmlFor="vc-url"><Input id="vc-url" value={v.redeem_url ?? ''} onChange={(e) => set({ redeem_url: e.target.value || null })} placeholder="https://shop.vn/…" inputMode="url" /></Field>
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Ai nhận</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={chip(v.condition === 'COMPLETE')} onClick={() => set({ condition: 'COMPLETE' })}>{target.type === 'QUEST' ? 'Hoàn thành nhiệm vụ' : 'Hoàn thành thử thách'}</button>
            {target.type === 'CHALLENGE' && <button type="button" className={chip(v.condition === 'TOP_N')} onClick={() => set({ condition: 'TOP_N', top_n: v.top_n ?? 3 })}>Top N khi chốt hạng</button>}
          </div>
          {v.condition === 'TOP_N' && <Input inputMode="numeric" value={v.top_n ?? ''} onChange={(e) => set({ top_n: Number(e.target.value.replace(/\D/g, '')) || null })} aria-label="Top N" />}
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Kiểu mã</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={chip(v.code_mode === 'POOL')} onClick={() => set({ code_mode: 'POOL' })}>Mỗi người một mã (dán danh sách)</button>
            <button type="button" className={chip(v.code_mode === 'SHARED')} onClick={() => set({ code_mode: 'SHARED' })}>Một mã chung</button>
          </div>
          {v.code_mode === 'SHARED' ? (
            <Input value={v.shared_code ?? ''} maxLength={40} onChange={(e) => set({ shared_code: e.target.value.toUpperCase() })} placeholder="VD: RACEHUB50" aria-label="Mã chung" />
          ) : (
            <>
              <textarea value={codes} rows={4} onChange={(e) => setCodes(e.target.value)} aria-label="Danh sách mã"
                className="w-full rounded-xl border border-border bg-surface-2 p-3 font-mono text-sm" placeholder={'Mỗi dòng một mã\nABC001\nABC002'} />
              <p className="text-xs text-fg-muted">
                {list.length ? `${list.length} mã sẽ được thêm.` : 'Có thể dán sau.'}
                {init?.total != null && ` Kho hiện có ${init.total} mã, còn ${init.remaining ?? 0}, đã phát ${init.issued}.`}
                {' '}Người đã đạt điều kiện trước khi có mã sẽ được phát bù.
              </p>
            </>
          )}
        </div>
        <Field label="Hạn dùng voucher (không bắt buộc)" htmlFor="vc-until">
          <Input id="vc-until" type="datetime-local" value={toLocal(v.valid_until)} onChange={(e) => set({ valid_until: e.target.value ? new Date(e.target.value).toISOString() : null })} />
        </Field>
        <label className="flex items-center gap-3 rounded-xl border border-border p-3 text-sm">
          <input type="checkbox" checked={v.is_active !== false} onChange={(e) => set({ is_active: e.target.checked })} className="size-5 accent-[var(--color-brand)]" />
          Đang phát voucher
        </label>
      </div>
    </Sheet>
  )
}
