'use client'

// Trình thiết kế theo lớp dùng chung (BIB / chứng nhận): xem trước trực tiếp, chạm chọn, kéo di chuyển,
// tay nắm phóng to + xoay, đường gióng giữa, Hoàn tác / Làm lại, thêm chữ / trường / ảnh / QR / hình, danh sách lớp.
import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import {
  CircleUserRound, Eye, EyeOff, Image as ImageIcon, Layers, Lock, Plus, QrCode, Redo2, RotateCw, Shapes, SlidersHorizontal, Sparkles, Type, Undo2, Wand2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import {
  duplicateLayer, hitTest, imageLayer, layerLabel, MAX_LAYERS, moveInStack, moveLayer, photoLayer, qrLayer, scaleLayer, shapeLayer, SHAPES, textLayer,
  type Binds, type Layer, type Layout, type Palette, type QrLayer, type ShapeKind, type Size,
} from '../engine'
import { LayerInspector } from './LayerInspector'
import { imageAspect } from './bits'

export interface QrSuggestion { key: string; title: string; hint: string; ready: boolean; layer: Partial<QrLayer> }

export interface StudioProps {
  size: Size
  binds: Binds
  palette: Palette
  colorLabels: Record<string, string>
  layers: Layer[]
  update: (fn: (ls: Layer[]) => Layer[], record?: boolean) => void
  snapshot: () => void
  history: { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean }
  /** Vẽ xem trước (chế độ thiết kế); gọi onLayout với vị trí các lớp */
  preview: (onLayout: (l: Layout) => void) => ReactNode
  /** Kéo chỗ trống để căn ảnh khung (khi đang dùng ảnh có sẵn) */
  onPanArt?: ((dx: number, dy: number) => void) | null
  upload: (file: File) => Promise<string>
  qrSuggestions: QrSuggestion[]
  onAuto: () => void
  /** Bảng Mẫu & nền */
  stylePanel: ReactNode
  /** Nội dung thêm trong tab Phần tử (nhà tài trợ…) */
  extraPanel?: ReactNode
  feePreset?: Partial<QrLayer> | null
  /** Trường ảnh cho khung ảnh runner (có thì hiện nút "Ảnh runner") */
  photoBinds?: Record<string, string>
  /** Tối đa số phần tử (mặc định 40) */
  maxLayers?: number
  /** Ẩn công cụ QR */
  noQr?: boolean
}

type Tab = 'edit' | 'layers' | 'style'
type Drag =
  | { mode: 'move'; id: string; x: number; y: number; moved: boolean }
  | { mode: 'scale'; id: string; orig: Layer; d0: number; cx: number; cy: number }
  | { mode: 'rotate'; id: string; cx: number; cy: number }
  | { mode: 'art'; x: number; y: number; moved: boolean }

export function Studio(p: StudioProps) {
  const { size, layers, update } = p
  const [sel, setSel] = useState<string | null>(null)
  const [layout, setLayout] = useState<Layout>({})
  const [tab, setTab] = useState<Tab>('edit')
  const [adding, setAdding] = useState<'field' | 'qr' | 'shape' | null>(null)
  const [guides, setGuides] = useState({ x: false, y: false })
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const layer = layers.find((l) => l.id === sel) ?? null
  const hit = sel ? layout[sel] : undefined

  const patch = (id: string, pt: Partial<Layer>, record = true) => update((ls) => ls.map((l) => (l.id === id ? ({ ...l, ...pt } as Layer) : l)), record)
  const add = (l: Layer) => {
    const max = p.maxLayers ?? MAX_LAYERS
    if (layers.length >= max) { toast.error(`Tối đa ${max} phần tử`); return }
    update((ls) => [...ls, l])
    setSel(l.id)
    setTab('edit')
    setAdding(null)
  }
  const doUpload = async (file: File | undefined, apply: (url: string, aspect: number) => void) => {
    if (!file) return
    setBusy(true)
    try { const url = await p.upload(file); apply(url, await imageAspect(url)) } catch (e) { toast.error((e as Error).message || 'Không tải được ảnh') } finally { setBusy(false) }
  }
  const action = (a: 'delete' | 'duplicate' | 'up' | 'down' | 'top' | 'bottom') => {
    if (!sel) return
    if (a === 'delete') { update((ls) => ls.filter((l) => l.id !== sel)); setSel(null) }
    else if (a === 'duplicate') update((ls) => duplicateLayer(ls, sel))
    else update((ls) => moveInStack(ls, sel, a))
  }

  // ---------- kéo thả ----------
  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect()
    const k = size.w / r.width
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, k }
  }
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    const { x, y } = toCanvas(e)
    const id = hitTest(layers, layout, x, y, 14)
    box.current?.focus({ preventScroll: true })
    if (id) {
      setSel(id)
      setTab('edit')
      const l = layers.find((v) => v.id === id)
      if (l?.locked) return
      drag.current = { mode: 'move', id, x, y, moved: false }
    } else if (p.onPanArt) {
      setSel(null)
      drag.current = { mode: 'art', x, y, moved: false }
    } else { setSel(null); return }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const { x, y } = toCanvas(e)
    if (d.mode === 'move') {
      const dx = x - d.x, dy = y - d.y
      if (!d.moved) { if (Math.hypot(dx, dy) < 3) return; p.snapshot(); d.moved = true }
      const cur = layers.find((l) => l.id === d.id)
      if (cur) { const g = moveLayer(cur, dx, dy, size); setGuides({ x: g.guideX, y: g.guideY }) }
      update((ls) => ls.map((l) => (l.id === d.id ? moveLayer(l, dx, dy, size).layer : l)), false)
      d.x = x; d.y = y
    } else if (d.mode === 'art') {
      if (!d.moved) { p.snapshot(); d.moved = true }
      p.onPanArt?.(x - d.x, y - d.y)
      d.x = x; d.y = y
    } else if (d.mode === 'scale') {
      const k = Math.max(0.05, Math.hypot(x - d.cx, y - d.cy) / d.d0)
      update((ls) => ls.map((l) => (l.id === d.id ? scaleLayer(d.orig, k) : l)), false)
    } else {
      let deg = (Math.atan2(y - d.cy, x - d.cx) * 180) / Math.PI + 90
      if (deg > 180) deg -= 360
      for (const s of [-180, -90, 0, 90, 180]) if (Math.abs(deg - s) < 4) deg = s
      update((ls) => ls.map((l) => (l.id === d.id ? { ...l, rot: Math.round(deg) } : l)), false)
    }
  }
  const onUp = () => { drag.current = null; setGuides({ x: false, y: false }) }
  const startHandle = (mode: 'scale' | 'rotate', e: PointerEvent) => {
    e.stopPropagation()
    if (!layer || !hit || layer.locked) return
    const { x, y } = toCanvas(e)
    p.snapshot()
    drag.current = mode === 'scale'
      ? { mode, id: layer.id, orig: layer, d0: Math.max(10, Math.hypot(x - hit.cx, y - hit.cy)), cx: hit.cx, cy: hit.cy }
      : { mode, id: layer.id, cx: hit.cx, cy: hit.cy }
    box.current?.setPointerCapture(e.pointerId)
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) p.history.redo(); else p.history.undo(); return }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); p.history.redo(); return }
    if (!layer) return
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); action('delete'); return }
    const step = e.shiftKey ? 20 : 2
    const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (mv && !layer.locked) { e.preventDefault(); update((ls) => ls.map((l) => (l.id === layer.id ? moveLayer(l, mv[0], mv[1], size).layer : l))) }
  }

  const pct = (v: number, of: number) => `${(v / of) * 100}%`
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
      {/* Xem trước + thao tác trực tiếp */}
      <div className="sticky top-0 z-10 -mx-1 space-y-2 bg-surface px-1 pb-2 lg:top-2">
        <div ref={box} tabIndex={0} onKeyDown={onKey} aria-label="Khung thiết kế — chạm chọn, kéo để di chuyển, phím mũi tên để dịch"
          style={{ '--ar': size.w / size.h } as CSSProperties}
          className="relative mx-auto max-w-[calc(46dvh*var(--ar))] touch-none select-none rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-brand lg:max-w-[calc(72dvh*var(--ar))]"
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          {p.preview(setLayout)}
          {guides.x && <span aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-fuchsia-500" />}
          {guides.y && <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-fuchsia-500" />}
          {layer && hit && (
            <div aria-hidden className="pointer-events-none absolute"
              style={{ left: pct(hit.cx, size.w), top: pct(hit.cy, size.h), width: pct(hit.w + 16, size.w), height: pct(hit.h + 16, size.h),
                transform: `translate(-50%, -50%) rotate(${hit.rot}deg)` }}>
              <span className={cn('absolute inset-0 rounded-md border-2 border-dashed shadow-[0_0_0_1px_rgba(0,0,0,0.35)]', layer.locked ? 'border-amber-400' : 'border-brand')} />
              {!layer.locked && (
                <>
                  <span onPointerDown={(e) => startHandle('scale', e)} title="Kéo để phóng to / thu nhỏ"
                    className="pointer-events-auto absolute -bottom-3 -right-3 size-6 cursor-nwse-resize rounded-full border-2 border-white bg-brand shadow" />
                  <span onPointerDown={(e) => startHandle('rotate', e)} title="Kéo để xoay"
                    className="pointer-events-auto absolute -top-9 left-1/2 grid size-6 -translate-x-1/2 cursor-grab place-items-center rounded-full border-2 border-white bg-brand text-brand-fg shadow">
                    <RotateCw className="size-3" />
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Thanh công cụ */}
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
          <Button size="sm" variant="ghost" onClick={p.history.undo} disabled={!p.history.canUndo} aria-label="Hoàn tác" title="Hoàn tác (Ctrl+Z)"><Undo2 className="size-4" aria-hidden /></Button>
          <Button size="sm" variant="ghost" onClick={p.history.redo} disabled={!p.history.canRedo} aria-label="Làm lại" title="Làm lại (Ctrl+Y)"><Redo2 className="size-4" aria-hidden /></Button>
          <span className="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden />
          <Tool icon={Type} label="Chữ" onClick={() => add(textLayer({ x: 0.5, y: 0.5, text: 'Chữ mới', size: 64, font: 'montserrat' }))} />
          <Tool icon={Plus} label="Trường" on={adding === 'field'} onClick={() => setAdding(adding === 'field' ? null : 'field')} />
          <Tool icon={ImageIcon} label={busy ? 'Đang tải…' : 'Ảnh / logo'} file disabled={busy}
            onFile={(f) => doUpload(f, (src, a) => {
              const w = 0.18
              add(imageLayer({ x: 0.5, y: 0.5, src, role: layers.some((l) => l.type === 'image' && l.role === 'logo' && l.src) ? 'image' : 'logo', w, h: (w * size.w) / a / size.h }))
            })} />
          {p.photoBinds && (
            <Tool icon={CircleUserRound} label="Ảnh runner" onClick={() => {
              const k = Object.keys(p.photoBinds!)[0]
              add(photoLayer({ x: 0.5, y: 0.5, bind: k ?? 'custom', w: 0.28, h: (0.28 * size.w) / size.h }))
            }} />
          )}
          {!p.noQr && <Tool icon={QrCode} label="QR" on={adding === 'qr'} onClick={() => setAdding(adding === 'qr' ? null : 'qr')} />}
          <Tool icon={Shapes} label="Hình" on={adding === 'shape'} onClick={() => setAdding(adding === 'shape' ? null : 'shape')} />
          <span className="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden />
          <Tool icon={Wand2} label="Tự động" onClick={() => { p.onAuto(); setSel(null) }} />
        </div>

        {adding === 'field' && (
          <AddRow title="Chèn trường dữ liệu (mỗi VĐV một giá trị)">
            {Object.entries(p.binds).map(([k, b]) => (
              <Button key={k} size="sm" variant="secondary" onClick={() => add(textLayer({ x: 0.5, y: 0.5, bind: k, size: 56, upper: k === 'name' }))}>{b.label}</Button>
            ))}
          </AddRow>
        )}
        {adding === 'shape' && (
          <AddRow title="Hình trang trí · nền chữ">
            {(Object.keys(SHAPES) as ShapeKind[]).map((s) => (
              <Button key={s} size="sm" variant="secondary" onClick={() => add(shapeLayer({
                x: 0.5, y: 0.5, shape: s, fill: s === 'laurel' || s === 'seal' ? 'band' : 'accent',
                w: s === 'line' ? 0.4 : s === 'circle' || s === 'seal' || s === 'laurel' ? 0.22 : 0.4,
                h: s === 'line' ? 0.004 : s === 'circle' || s === 'seal' || s === 'laurel' ? 0.22 * size.w / size.h : 0.1,
                opacity: s === 'rect' || s === 'round' ? 0.9 : 1,
              }))}>{SHAPES[s]}</Button>
            ))}
          </AddRow>
        )}
        {adding === 'qr' && <QrPanel suggestions={p.qrSuggestions} layers={layers} busy={busy}
          onAdd={(q) => add(qrLayer({ x: 0.5, y: 0.5, ...q }))}
          onUpload={(f) => doUpload(f, (src) => add(qrLayer({ x: 0.5, y: 0.5, source: 'image', src, label: 'Quét mã' })))} />}
      </div>

      {/* Bảng điều khiển */}
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1" role="tablist" aria-label="Bảng thiết kế">
          {([['edit', 'Phần tử', SlidersHorizontal], ['layers', `Lớp (${layers.length})`, Layers], ['style', 'Mẫu & nền', Sparkles]] as const).map(([k, label, Icon]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={cn('flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold', tab === k ? 'bg-surface text-fg shadow' : 'text-fg-muted')}>
              <Icon className="size-3.5" aria-hidden />{label}
            </button>
          ))}
        </div>

        {tab === 'edit' && (layer ? (
          <div className="space-y-3 rounded-2xl border border-border p-3">
            <p className="flex items-center justify-between gap-2 text-sm font-bold">
              <span className="truncate">{layerLabel(layer, p.binds)}</span>
              <Button size="sm" variant="ghost" onClick={() => setSel(null)}>Xong</Button>
            </p>
            <LayerInspector layer={layer} size={size} binds={p.binds} palette={p.palette} colorLabels={p.colorLabels} busy={busy} feePreset={p.feePreset} photoBinds={p.photoBinds}
              onChange={(pt, record) => patch(layer.id, pt, record)} onUpload={doUpload} onAction={action} />
          </div>
        ) : (
          <div className="space-y-3">
            <p className="rounded-xl bg-surface-2 px-3 py-2.5 text-xs text-fg-muted">
              Chạm vào bất kỳ phần tử nào trên bản xem trước để chọn · kéo để di chuyển · kéo chấm tròn góc để phóng to, chấm phía trên để xoay.
              Máy tính: phím mũi tên dịch từng chút, Delete để xóa, Ctrl+Z hoàn tác.
            </p>
            {p.extraPanel}
          </div>
        ))}

        {tab === 'layers' && (
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {[...layers].reverse().map((l) => (
              <li key={l.id} className={cn('flex items-center gap-2 px-3 py-2', sel === l.id && 'bg-brand/10')}>
                <button type="button" className="min-w-0 flex-1 truncate text-left text-sm" onClick={() => { setSel(l.id); setTab('edit') }}>
                  <span className={cn(l.hidden && 'text-fg-subtle line-through')}>{layerLabel(l, p.binds)}</span>
                </button>
                {l.locked && <Lock className="size-3.5 text-amber-400" aria-label="Đã khóa" />}
                <button type="button" onClick={() => patch(l.id, { hidden: !l.hidden })} aria-label={l.hidden ? 'Hiện' : 'Ẩn'} className="grid size-8 place-items-center rounded-lg text-fg-muted hover:bg-surface-2">
                  {l.hidden ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                </button>
              </li>
            ))}
            {!layers.length && <li className="px-3 py-4 text-sm text-fg-muted">Chưa có phần tử — bấm Tự động để dựng bố cục chuẩn.</li>}
          </ul>
        )}

        {tab === 'style' && p.stylePanel}
      </div>
    </div>
  )
}

function Tool({ icon: Icon, label, onClick, on, file, onFile, disabled }: {
  icon: typeof Type; label: string; onClick?: () => void; on?: boolean; file?: boolean; onFile?: (f: File | undefined) => void; disabled?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <button type="button" disabled={disabled} aria-pressed={on} onClick={file ? () => input.current?.click() : onClick}
        className={cn('flex shrink-0 flex-col items-center gap-0.5 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold disabled:opacity-50',
          on ? 'bg-brand/15 text-fg' : 'text-fg-muted hover:bg-surface-2')}>
        <Icon className="size-4" aria-hidden />{label}
      </button>
      {file && <input ref={input} type="file" hidden accept="image/*" onChange={(e) => { onFile?.(e.target.files?.[0]); e.target.value = '' }} />}
    </>
  )
}

function AddRow({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5 rounded-xl border border-border bg-surface-2/60 p-2">
      <p className="text-[11px] font-medium text-fg-muted">{title}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

/** Hộp gợi ý mã QR: nguồn nào có sẵn thì thêm một chạm; kéo tới vị trí mong muốn trên bản xem trước */
function QrPanel({ suggestions, layers, busy, onAdd, onUpload }: {
  suggestions: QrSuggestion[]; layers: Layer[]; busy: boolean; onAdd: (q: Partial<QrLayer>) => void; onUpload: (f: File | undefined) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const has = (s: QrSuggestion) => layers.some((l) => l.type === 'qr' && l.source === s.layer.source && (s.layer.source !== 'link' || l.url === s.layer.url))
  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface-2/60 p-2">
      <p className="text-[11px] font-medium text-fg-muted">Gợi ý mã QR — thêm rồi kéo tới vị trí mong muốn</p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {suggestions.map((s) => (
          <button key={s.key} type="button" onClick={() => onAdd(s.layer)} disabled={!s.ready}
            className="flex items-start gap-2 rounded-lg border border-border bg-surface p-2 text-left disabled:opacity-50">
            <QrCode className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            <span className="min-w-0">
              <span className="block text-xs font-semibold">{s.title}{has(s) && <span className="ml-1 font-normal text-fg-subtle">· đã có</span>}</span>
              <span className="block text-[11px] text-fg-muted">{s.hint}</span>
            </span>
          </button>
        ))}
        <button type="button" onClick={() => input.current?.click()} disabled={busy}
          className="flex items-start gap-2 rounded-lg border border-dashed border-brand/60 bg-surface p-2 text-left">
          <Plus className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
          <span className="min-w-0">
            <span className="block text-xs font-semibold">{busy ? 'Đang tải…' : 'Thêm ảnh QR khác'}</span>
            <span className="block text-[11px] text-fg-muted">QR ngân hàng, Zalo, fanpage… tải ảnh lên</span>
          </span>
        </button>
        <button type="button" onClick={() => onAdd({ source: 'link', url: '', label: 'Quét mã' })}
          className="flex items-start gap-2 rounded-lg border border-dashed border-brand/60 bg-surface p-2 text-left">
          <Plus className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
          <span className="min-w-0">
            <span className="block text-xs font-semibold">QR từ đường link</span>
            <span className="block text-[11px] text-fg-muted">Dán link → app tự tạo mã</span>
          </span>
        </button>
      </div>
      <input ref={input} type="file" hidden accept="image/*" onChange={(e) => { onUpload(e.target.files?.[0]); e.target.value = '' }} />
    </div>
  )
}
