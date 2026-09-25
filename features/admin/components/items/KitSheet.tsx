'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button, Field, Input, Sheet } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { useMyProfile } from '@/features/auth'
import {
  defaultKit, hasPrint, KIT_PARTS, KitStudio, RARITY_META, uploadPrintLogo,
  type ItemLifecycle, type KitDesign, type Rarity, type Slot,
} from '@/features/character'
import { adminErrorMessage, ITEM_STATUS, type ItemInput } from '../../api/adminApi'
import { useAvatarCollections, useSaveAvatarItem } from '../../hooks/useAdmin'
import { ClubPick, type Picked } from './ItemRules'

const RARITIES = Object.keys(RARITY_META) as Rarity[]
const PRICE_LABEL: Record<'top' | 'bottom' | 'socks' | 'shoes', string> = { top: 'Áo', bottom: 'Quần', socks: 'Tất', shoes: 'Giày' }

/** Admin thiết kế cả bộ (áo + quần + tất + giày) → tạo các vật phẩm cùng mã bộ; chọn CLB = đồng phục riêng */
export function KitSheet({ onClose }: { onClose: () => void }) {
  const { profile } = useMyProfile()
  const [club, setClub] = useState<Picked | null>(null)
  const [name, setName] = useState('Bộ đồng phục')
  const [kit, setKit] = useState<KitDesign>(() => defaultKit(''))
  const [prices, setPrices] = useState<Record<string, string>>({ top: '50', bottom: '30', socks: '10', shoes: '30' })
  const [rarity, setRarity] = useState<Rarity>('rare')
  const [collection, setCollection] = useState('')
  const [status, setStatus] = useState<ItemLifecycle>('DRAFT')
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [base] = useState(() => `kit_${Date.now().toString(36)}`)
  const collections = useAvatarCollections()
  const save = useSaveAvatarItem()

  const slots = ['top', ...KIT_PARTS.filter((p) => kit[p.slot]).map((p) => p.slot)] as ('top' | 'bottom' | 'socks' | 'shoes')[]
  const badPrice = slots.some((s) => !(Number(prices[s]) >= 0 && Number(prices[s]) <= 100000))
  const ok = name.trim().length >= 2 && !badPrice

  const pickClub = (c: Picked | null) => {
    setClub(c)
    if (c && name === 'Bộ đồng phục') setName(`Đồng phục ${c.name}`.slice(0, 60))
    if (c && !kit.print.title) setKit((k) => ({ ...k, print: { ...k.print, title: c.name.toUpperCase().slice(0, 24) } }))
  }

  const submit = async () => {
    setBusy(true)
    try {
      const common = { description: club ? `Đồng phục ${club.name}` : null, rarity, render_kind: 'TINT' as const, layer_urls: null, unlock_level: 1, sort: 20,
        status, collection: collection || null, club_id: club?.id ?? null, required_badge: null, required_challenge: null,
        available_from: null, available_to: null, supply_limit: null, kit: base }
      const items: ItemInput[] = [{ ...common, code: base, name: name.trim(), slot: 'top', color: kit.top, price_xu: Number(prices.top),
        print: hasPrint(kit.print) || kit.print.pattern ? kit.print : null }]
      for (const { slot, label } of KIT_PARTS) {
        const part = kit[slot]
        if (part) items.push({ ...common, code: `${base}_${slot}`, name: `${label} ${name.trim()}`.slice(0, 60), slot: slot as Slot, color: part.color,
          price_xu: Number(prices[slot]), print: part.pattern ? { pattern: part.pattern } : null })
      }
      for (const it of items) await save.mutateAsync(it)
      toast.success(`Đã tạo bộ ${name.trim()} (${items.length} món)`, { description: status === 'PUBLISHED' ? 'Đã lên Tủ đồ.' : 'Đang ở Nháp — bấm Bán khi sẵn sàng.' })
      onClose()
    } catch (e) {
      toast.error(adminErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose} title="Thiết kế bộ đồng phục" description="Áo + quần + tất + giày theo màu CLB, xem thử ngay trên nhân vật"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" block onClick={onClose} disabled={busy}>Hủy</Button>
          <Button block onClick={submit} loading={busy} disabled={!ok || uploading}>Tạo {slots.length} món</Button>
        </div>
      }>
      <div className="space-y-4">
        <Field label="Đồng phục của CLB (không bắt buộc)" hint="Chọn CLB: chỉ thành viên mua / mặc; lấy được màu và logo của CLB">
          <ClubPick value={club} onChange={pickClub} />
        </Field>
        <Field label="Tên bộ" htmlFor="kit-name"><Input id="kit-name" value={name} maxLength={52} onChange={(e) => setName(e.target.value)} /></Field>

        <KitStudio value={kit} onChange={setKit} clubLogoUrl={club?.logo} personalName={profile?.display_name} onUploading={setUploading}
          upload={(f) => uploadPrintLogo(club ? club.id : `items/${base}`, f)} />

        <div className="space-y-3 rounded-2xl border border-border p-3">
          <p className="text-sm font-semibold">Giá & bán</p>
          <div className="grid grid-cols-2 gap-2">
            {slots.map((s) => (
              <Field key={s} label={`${PRICE_LABEL[s]} (Xu)`} htmlFor={`kit-p-${s}`}>
                <Input id={`kit-p-${s}`} type="number" inputMode="decimal" min={0} value={prices[s]} onChange={(e) => setPrices((p) => ({ ...p, [s]: e.target.value }))} />
              </Field>
            ))}
          </div>
          <p className="text-xs text-fg-muted">0 Xu + chọn CLB = phát miễn phí cho mọi thành viên.</p>
          <Field label="Độ hiếm">
            <div className="grid grid-cols-4 gap-1.5">
              {RARITIES.map((r) => (
                <button key={r} type="button" onClick={() => setRarity(r)} aria-pressed={rarity === r}
                  className={cn('h-10 rounded-xl border text-xs font-semibold', RARITY_META[r].text, rarity === r ? 'border-brand bg-brand/10' : 'border-border')}>
                  {RARITY_META[r].label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Bộ sưu tập" htmlFor="kit-col">
            <select id="kit-col" value={collection} onChange={(e) => setCollection(e.target.value)} className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-[15px]">
              <option value="">Không thuộc bộ nào</option>
              {(collections.data ?? []).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Trạng thái">
            <div className="grid grid-cols-2 gap-1.5">
              {(['DRAFT', 'PUBLISHED'] as ItemLifecycle[]).map((st) => (
                <button key={st} type="button" onClick={() => setStatus(st)} aria-pressed={status === st}
                  className={cn('h-10 rounded-xl border text-xs font-semibold', status === st ? 'border-brand bg-brand/10 text-fg' : 'border-border text-fg-muted')}>
                  {ITEM_STATUS[st].label}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </div>
    </Sheet>
  )
}
