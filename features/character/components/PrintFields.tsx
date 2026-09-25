'use client'

import { useState } from 'react'
import { ImageUp, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Field, Input, SegmentedControl, SwitchRow } from '@/shared/ui'
import type { ItemPrint } from '../model/catalog'

const FONTS: { value: NonNullable<ItemPrint['font']>; label: string }[] = [
  { value: 'sport', label: 'Thể thao' }, { value: 'sans', label: 'Hiện đại' }, { value: 'serif', label: 'Cổ điển' },
]

/** In không rỗng: có logo, chữ hoặc tên runner */
export const hasPrint = (p: ItemPrint | null | undefined) =>
  !!p && (!!p.logo_url || !!p.title?.trim() || !!p.subtitle?.trim() || p.personal === 'NAME' || (p.layers?.length ?? 0) > 0)

/** Chỉnh nội dung in lên áo: logo ngực, tên (CLB), dòng phụ, tên runner, màu + kiểu chữ */
export function PrintFields({ value, onChange, upload, onUploading }: {
  value: ItemPrint
  onChange: (p: ItemPrint) => void
  /** Tải logo, trả URL công khai */
  upload: (file: File) => Promise<string>
  onUploading?: (busy: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<ItemPrint>) => onChange({ ...value, ...patch })

  const pick = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { toast.error('Logo tối đa 2 MB.'); return }
    setBusy(true); onUploading?.(true)
    try { set({ logo_url: await upload(file) }) }
    catch (e) { toast.error((e as Error)?.message?.includes('row-level') ? 'Không có quyền tải logo.' : 'Không tải được logo. Hãy thử lại.') }
    finally { setBusy(false); onUploading?.(false) }
  }

  return (
    <div className="space-y-3">
      <Field label="Logo ngực trái" hint="PNG nền trong suốt, vuông, tối đa 2 MB">
        <div className="flex items-center gap-3">
          <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-[repeating-conic-gradient(var(--color-surface-2)_0_25%,transparent_0_50%)] bg-[length:12px_12px]">
            {value.logo_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={value.logo_url} alt="Logo in áo" className="size-full object-contain" />
              : <ImageUp className="size-5 text-fg-subtle" aria-hidden />}
          </span>
          <label className="inline-flex h-10 cursor-pointer items-center rounded-xl border border-border px-3 text-sm font-semibold hover:bg-surface-2">
            {busy ? 'Đang tải…' : value.logo_url ? 'Đổi logo' : 'Tải logo'}
            <input type="file" accept="image/png,image/webp,image/jpeg" className="sr-only" disabled={busy}
              onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          {value.logo_url && (
            <Button variant="ghost" size="sm" onClick={() => set({ logo_url: null })} aria-label="Bỏ logo">
              <Trash2 className="size-4" aria-hidden />
            </Button>
          )}
        </div>
      </Field>
      <Field label="Chữ lớn giữa ngực" htmlFor="print-title" hint={`${(value.title ?? '').length}/24 · thường là tên CLB`}>
        <Input id="print-title" value={value.title ?? ''} maxLength={24} placeholder="SAIGON RUNNERS" onChange={(e) => set({ title: e.target.value })} />
      </Field>
      <Field label="Dòng phụ" htmlFor="print-sub" hint={`${(value.subtitle ?? '').length}/32`}>
        <Input id="print-sub" value={value.subtitle ?? ''} maxLength={32} placeholder="Since 2020 · Run together" onChange={(e) => set({ subtitle: e.target.value })} />
      </Field>
      <SwitchRow checked={value.personal === 'NAME'} onChange={(on) => set({ personal: on ? 'NAME' : 'NONE' })}
        label="In tên runner" description="Mỗi người mặc thấy tên gọi của chính mình (lấy từ hồ sơ)" />
      <div className="grid grid-cols-[auto_1fr] items-end gap-3">
        <Field label="Màu chữ">
          <input type="color" aria-label="Màu chữ" value={value.text_color ?? '#ffffff'} onChange={(e) => set({ text_color: e.target.value })}
            className="h-11 w-16 cursor-pointer rounded-xl border border-border bg-bg" />
        </Field>
        <Field label="Kiểu chữ">
          <SegmentedControl value={value.font ?? 'sport'} onChange={(font) => set({ font })} options={FONTS} />
        </Field>
      </div>
    </div>
  )
}
