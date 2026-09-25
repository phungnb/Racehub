'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ImageUp, Palette, Layers } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Field, Input, SegmentedControl, Sheet, SwitchRow } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import {
  FRAME, PaperDoll, PrintFields, RARITY_META, SLOTS, hasPrint, isTintSlot, uploadPrintLogo,
  type CharacterItem, type Gender, type ItemLifecycle, type ItemPrint, type Rarity, type RenderKind, type Slot,
} from '@/features/character'
import { useMyProfile } from '@/features/auth'
import { useAchievements } from '@/features/game'
import { adminErrorMessage, ITEM_STATUS, uploadLayer, type AdminItem } from '../../api/adminApi'
import { useAvatarCollections, useSaveAvatarItem } from '../../hooks/useAdmin'
import { ChallengePick, ClubPick, fromLocalInput, toLocalInput, type Picked } from './ItemRules'
import { checkLayer, CODE_PATTERN, suggestCode, type LayerStats } from '../../model/itemLayer'

const GENDERS: { value: Gender; label: string }[] = [{ value: 'male', label: 'Nam' }, { value: 'female', label: 'Nữ' }]
const RARITIES = Object.keys(RARITY_META) as Rarity[]

interface LayerDraft { url: string; file?: File; errors: string[]; warnings: string[] }

const loadImg = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image()
  img.onload = () => resolve(img)
  img.onerror = () => reject(new Error('Không đọc được ảnh'))
  img.src = src
})

/** Đọc kích thước + độ trong suốt của file PNG ngay trên trình duyệt */
async function readStats(file: File, url: string): Promise<LayerStats> {
  const img = await loadImg(url)
  const W = img.naturalWidth, H = img.naturalHeight
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, W, H).data
  let opaque = 0, n = 0
  for (let i = 3; i < d.length; i += 16) { n++; if (d[i] > 8) opaque++ }
  const a = (x: number, y: number) => d[(y * W + x) * 4 + 3]
  return { width: W, height: H, bytes: file.size, type: file.type, opaqueRatio: n ? opaque / n : 0,
    cornerAlpha: Math.max(a(0, 0), a(W - 1, 0), a(0, H - 1), a(W - 1, H - 1)) }
}

/** Thêm / sửa vật phẩm: màu (áo, quần, tất, giày) hoặc lớp ảnh PNG khung chuẩn; xem thử ngay trên nhân vật Nam/Nữ */
export function ItemEditor({ item, onClose }: { item: AdminItem | null; onClose: () => void }) {
  const isNew = !item
  const [kind, setKind] = useState<RenderKind>(item?.render_kind ?? 'LAYER')
  const [slot, setSlot] = useState<Slot>(item?.slot ?? 'hat')
  const [name, setName] = useState(item?.name ?? '')
  const [code, setCode] = useState(item?.code ?? '')
  const [codeTouched, setCodeTouched] = useState(!isNew)
  const [description, setDescription] = useState(item?.description ?? '')
  const [rarity, setRarity] = useState<Rarity>(item?.rarity ?? 'common')
  const [color, setColor] = useState<string | null>(item ? item.color : '#e11d48')
  const [price, setPrice] = useState(item ? String(item.price_xu) : '30')
  const [level, setLevel] = useState(item?.unlock_level ?? 1)
  const [status, setStatus] = useState<ItemLifecycle>(item?.status ?? 'DRAFT')
  const [collection, setCollection] = useState(item?.collection ?? '')
  const [club, setClub] = useState<Picked | null>(item?.club_id ? { id: item.club_id, name: item.club_name ?? 'CLB' } : null)
  const [badge, setBadge] = useState(item?.required_badge ?? '')
  const [challenge, setChallenge] = useState<Picked | null>(item?.required_challenge ? { id: item.required_challenge, name: item.challenge_title ?? 'Thử thách' } : null)
  const [from, setFrom] = useState(toLocalInput(item?.available_from))
  const [to, setTo] = useState(toLocalInput(item?.available_to))
  const [supply, setSupply] = useState(item?.supply_limit ? String(item.supply_limit) : '')
  const [print, setPrint] = useState<ItemPrint | null>(item?.print ?? null)
  const [uploading, setUploading] = useState(false)
  const collections = useAvatarCollections()
  const badges = useAchievements()
  const { profile } = useMyProfile()
  const [layers, setLayers] = useState<Partial<Record<Gender, LayerDraft>>>(() => {
    const out: Partial<Record<Gender, LayerDraft>> = {}
    for (const g of ['male', 'female'] as const) {
      const url = item?.layer_urls?.[g]
      if (url) out[g] = { url, errors: [], warnings: [] }
    }
    return out
  })
  const [gender, setGender] = useState<Gender>('male')
  const [busy, setBusy] = useState(false)
  const save = useSaveAvatarItem()

  // Giải phóng ảnh xem thử (blob:) khi đóng
  const blobs = useRef<string[]>([])
  useEffect(() => () => { for (const u of blobs.current) URL.revokeObjectURL(u) }, [])

  const finalCode = codeTouched ? code : suggestCode(slot, name)
  const slotChoices = kind === 'TINT' ? SLOTS.filter((s) => isTintSlot(s.slot)) : SLOTS
  const priceNum = Number(price)

  const pick = async (g: Gender, file: File | undefined) => {
    if (!file) return
    const url = URL.createObjectURL(file)
    blobs.current.push(url)
    try {
      const { errors, warnings } = checkLayer(await readStats(file, url), slot)
      setLayers((l) => ({ ...l, [g]: { url, file, errors, warnings } }))
    } catch {
      setLayers((l) => ({ ...l, [g]: { url, file, errors: ['Không đọc được file ảnh.'], warnings: [] } }))
    }
  }

  const preview: CharacterItem = useMemo(() => ({
    code: finalCode || 'preview', name, description: null, slot, rarity, render_kind: kind, price_xu: 0, unlock_level: 1, is_default: false,
    color: kind === 'TINT' ? color : null,
    layer_urls: kind === 'LAYER' ? Object.fromEntries(Object.entries(layers).map(([g, l]) => [g, l!.url])) : null,
    print: slot === 'top' ? print : null,
  }), [finalCode, name, slot, rarity, kind, color, layers, print])

  const problems: string[] = []
  if (!CODE_PATTERN.test(finalCode)) problems.push('Mã chỉ gồm chữ thường không dấu, số, dấu _ (3–48 ký tự).')
  if (name.trim().length < 2) problems.push('Nhập tên vật phẩm.')
  if (!Number.isFinite(priceNum) || priceNum < 0) problems.push('Giá không hợp lệ.')
  if (kind === 'LAYER') {
    if (!layers.male && !layers.female) problems.push('Tải lên ít nhất một ảnh lớp.')
    if (Object.values(layers).some((l) => l && l.errors.length)) problems.push('Ảnh lớp còn lỗi, xem bên dưới.')
  }
  if (from && to && to <= from) problems.push('Ngày kết thúc bán phải sau ngày mở bán.')
  if (supply && !(Number.isInteger(Number(supply)) && Number(supply) >= 1)) problems.push('Số lượng giới hạn phải là số nguyên ≥ 1.')
  if (slot === 'top' && print && !hasPrint(print)) problems.push('Vùng in đang trống: thêm logo / chữ hoặc tắt In lên áo.')
  const missing = kind === 'LAYER' && (layers.male ? !layers.female : !!layers.female)

  const submit = async () => {
    if (problems.length) return
    setBusy(true)
    try {
      const urls: Partial<Record<Gender, string>> = {}
      for (const g of ['male', 'female'] as const) {
        const l = layers[g]
        if (l) urls[g] = l.file ? await uploadLayer(finalCode, g, l.file) : l.url
      }
      await save.mutateAsync({
        code: finalCode, name: name.trim(), description: description.trim() || null, slot, rarity, render_kind: kind,
        color: kind === 'TINT' ? color : null, layer_urls: kind === 'LAYER' ? urls : null,
        price_xu: priceNum, unlock_level: level, sort: item?.sort ?? 100, status,
        collection: collection || null, club_id: club?.id ?? null, required_badge: badge || null, required_challenge: challenge?.id ?? null,
        available_from: fromLocalInput(from), available_to: fromLocalInput(to), supply_limit: supply ? Number(supply) : null,
        print: slot === 'top' && print && hasPrint(print) ? print : null,
      })
      toast.success(isNew ? `Đã thêm ${name.trim()}` : 'Đã lưu vật phẩm')
      onClose()
    } catch (e) {
      toast.error(adminErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose} title={isNew ? 'Thêm vật phẩm' : `Sửa: ${item.name}`}
      description="Xem thử ngay trên nhân vật trước khi lưu"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" block onClick={onClose} disabled={busy}>Hủy</Button>
          <Button block onClick={submit} loading={busy} disabled={problems.length > 0 || uploading}>{isNew ? 'Tạo vật phẩm' : 'Lưu'}</Button>
        </div>
      }>
      <div className="space-y-4">
        {/* Xem thử */}
        <div className="relative h-80 overflow-hidden rounded-2xl border border-border bg-[#c4c4ce]">
          <PaperDoll gender={gender} items={[preview]} personalName={profile?.display_name ?? 'Runner'} className="size-full" fit="contain" label="Xem thử vật phẩm" />
          <SegmentedControl value={gender} onChange={setGender} options={GENDERS} className="absolute right-2 top-2 w-28 bg-bg/85" />
        </div>

        {isNew && (
          <SegmentedControl value={kind} onChange={(k) => { setKind(k); if (k === 'TINT' && !isTintSlot(slot)) setSlot('top') }}
            options={[{ value: 'LAYER', label: 'Lớp ảnh PNG' }, { value: 'TINT', label: 'Đổi màu' }]} />
        )}

        <Field label="Ô trang phục">
          <div className="flex flex-wrap gap-1.5">
            {slotChoices.map((s) => (
              <button key={s.slot} type="button" onClick={() => setSlot(s.slot)} aria-pressed={slot === s.slot}
                className={cn('flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm font-semibold',
                  slot === s.slot ? 'border-brand bg-brand/10 text-fg' : 'border-border text-fg-muted')}>
                <s.icon className="size-4" aria-hidden />{s.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Tên" htmlFor="item-name">
          <Input id="item-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Mũ lưỡi trai Đỏ" />
        </Field>
        <Field label="Mã vật phẩm" htmlFor="item-code" hint={isNew ? 'Tự tạo từ tên, sửa được. Không đổi được sau khi lưu.' : 'Mã cố định'}>
          <Input id="item-code" value={finalCode} disabled={!isNew} className="font-mono"
            onChange={(e) => { setCodeTouched(true); setCode(e.target.value.toLowerCase()) }} />
        </Field>
        <Field label="Mô tả (không bắt buộc)" htmlFor="item-desc">
          <Input id="item-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={160} placeholder="Quà sự kiện 2/9" />
        </Field>

        {kind === 'TINT' ? (
          <Field label="Màu" hint="Nếp vải và ánh sáng được giữ nguyên, chỉ đổi màu">
            <div className="flex items-center gap-3">
              <input type="color" aria-label="Chọn màu" value={color ?? '#888888'} onChange={(e) => setColor(e.target.value)}
                className="h-11 w-16 cursor-pointer rounded-xl border border-border bg-bg" />
              <span className="font-mono text-sm">{color ?? 'Nguyên bản'}</span>
              <Button variant="secondary" size="sm" onClick={() => setColor(null)} disabled={color === null}>
                <Palette className="size-4" aria-hidden />Màu gốc
              </Button>
            </div>
          </Field>
        ) : (
          <Field label={`Ảnh lớp (PNG ${FRAME.width}×${FRAME.height}, nền trong suốt)`}
            hint="Vẽ đè lên đúng ảnh nhân vật rồi xuất riêng lớp món đồ, không cắt sát. Xem docs/vat-pham/HUONG_DAN.md">
            <div className="grid grid-cols-2 gap-2">
              {GENDERS.map((g) => {
                const l = layers[g.value]
                return (
                  <div key={g.value} className="space-y-1.5">
                    <label className={cn('flex h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed text-sm font-semibold',
                      l?.errors.length ? 'border-danger text-danger' : l ? 'border-brand text-fg' : 'border-border text-fg-muted')}>
                      {l ? <Layers className="size-5" aria-hidden /> : <ImageUp className="size-5" aria-hidden />}
                      {g.label}{l ? (l.file ? ' · file mới' : ' · đã có') : ''}
                      <input type="file" accept="image/png" className="sr-only" onChange={(e) => { void pick(g.value, e.target.files?.[0]); e.target.value = '' }} />
                    </label>
                    {l?.errors.map((m) => <p key={m} role="alert" className="text-xs text-danger">{m}</p>)}
                    {l?.warnings.map((m) => <p key={m} className="text-xs text-coin">{m}</p>)}
                  </div>
                )
              })}
            </div>
            {missing && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-coin">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Chưa có bản {layers.male ? 'Nữ' : 'Nam'}: giới đó dùng chung ảnh này, dễ lệch. Bấm {layers.male ? 'Nữ' : 'Nam'} ở khung xem thử để kiểm tra.
              </p>
            )}
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Giá (Xu)" htmlFor="item-price" hint="0 + cấp > 1 = quà lên cấp">
            <Input id="item-price" type="number" inputMode="decimal" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Field label="Mở ở cấp" htmlFor="item-level">
            <select id="item-level" value={level} onChange={(e) => setLevel(Number(e.target.value))}
              className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-[15px]">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>Cấp {n}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Độ hiếm">
          <div className="grid grid-cols-4 gap-1.5">
            {RARITIES.map((r) => (
              <button key={r} type="button" onClick={() => setRarity(r)} aria-pressed={rarity === r}
                className={cn('h-10 rounded-xl border text-xs font-semibold', RARITY_META[r].text,
                  rarity === r ? 'border-brand bg-brand/10' : 'border-border')}>
                {RARITY_META[r].label}
              </button>
            ))}
          </div>
        </Field>

        {slot === 'top' && (
          <div className="space-y-3 rounded-2xl border border-border p-3">
            <SwitchRow checked={!!print} onChange={(on) => setPrint(on ? (item?.print ?? { personal: 'NONE', text_color: '#ffffff', font: 'sport' }) : null)}
              label="In lên áo" description="Logo ngực, chữ lớn, dòng phụ, tên runner — vẽ theo nếp vải của áo" />
            {print && <PrintFields value={print} onChange={setPrint} upload={(f) => uploadPrintLogo(`items/${finalCode || 'moi'}`, f)} onUploading={setUploading} />}
          </div>
        )}

        <div className="space-y-3 rounded-2xl border border-border p-3">
          <p className="text-sm font-semibold">Điều kiện mở khóa & bán</p>
          <Field label="Bộ sưu tập" htmlFor="item-col">
            <select id="item-col" value={collection} onChange={(e) => setCollection(e.target.value)}
              className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-[15px]">
              <option value="">Không thuộc bộ nào</option>
              {(collections.data ?? []).map((c) => <option key={c.code} value={c.code}>{c.name}{c.is_active ? '' : ' (đã tắt)'}</option>)}
            </select>
          </Field>
          <Field label="Chỉ thành viên CLB" hint="Đồng phục: chỉ thành viên mua / mặc; rời CLB tự tháo ra">
            <ClubPick value={club} onChange={setClub} />
          </Field>
          <Field label="Cần huy hiệu" htmlFor="item-badge">
            <select id="item-badge" value={badge} onChange={(e) => setBadge(e.target.value)}
              className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-[15px]">
              <option value="">Không cần</option>
              {badge && !(badges.data ?? []).some((b) => b.code === badge) && <option value={badge}>{badge}</option>}
              {(badges.data ?? []).map((b) => <option key={b.code} value={b.code}>{b.title}</option>)}
            </select>
          </Field>
          <Field label="Hoàn thành thử thách" hint="Giá 0 Xu + có điều kiện = tự phát khi đủ điều kiện">
            <ChallengePick value={challenge} onChange={setChallenge} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mở bán từ" htmlFor="item-from"><Input id="item-from" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="Bán đến" htmlFor="item-to"><Input id="item-to" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
          <Field label="Giới hạn số lượng" htmlFor="item-supply" hint="Để trống = không giới hạn">
            <Input id="item-supply" type="number" inputMode="numeric" min={1} value={supply} onChange={(e) => setSupply(e.target.value)} placeholder="Không giới hạn" />
          </Field>
        </div>

        <Field label="Trạng thái">
          <div className="grid grid-cols-3 gap-1.5">
            {(Object.keys(ITEM_STATUS) as ItemLifecycle[]).map((st) => (
              <button key={st} type="button" onClick={() => setStatus(st)} aria-pressed={status === st} title={ITEM_STATUS[st].hint}
                className={cn('h-10 rounded-xl border text-xs font-semibold', status === st ? 'border-brand bg-brand/10 text-fg' : 'border-border text-fg-muted')}>
                {ITEM_STATUS[st].label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-fg-muted">{ITEM_STATUS[status].hint}</p>
        </Field>

        {problems.length > 0 && (
          <ul className="space-y-1 rounded-xl bg-surface-2 p-3 text-xs text-fg-muted">
            {problems.map((p) => <li key={p}>• {p}</li>)}
          </ul>
        )}
      </div>
    </Sheet>
  )
}
