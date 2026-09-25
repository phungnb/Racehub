'use client'

// Trình thiết kế in trực tiếp lên áo / quần của nhân vật: kéo thả, co giãn, xoay (chuột hoặc 2 ngón tay), chữ nhiều font, logo / ảnh.
// Lớp lưu theo hộp bao vùng (0..1) nên cùng thiết kế lên được mọi dáng nhân vật (xem printLayers.ts).
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import {
  AlignCenterHorizontal, ArrowDown, ArrowUp, Copy, ImagePlus, Maximize2, Minimize2, Redo2, Trash2, Type, Undo2, UserRound,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button, Input } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { FONTS, type FontKey } from '@/shared/design/engine'
import { FontPicker } from '@/shared/design/studio/LayerInspector'
import { Slider } from '@/shared/design/studio/bits'
import { useHistory } from '@/shared/design/studio/useHistory'
import { FRAME, NAME_TOKEN, type Body, type CharacterItem, type PrintLayer } from '../model/catalog'
import { drawLayer, hitLayer, isFontKey, layerFont, layerRect, newLayerId, rectCorners, type Box, type LayerRect } from '../model/printLayers'
import { loadImage, PaperDoll, regionBoxes, SIDE, TOP } from './PaperDoll'

const STAGE = { w: FRAME.width + 2 * SIDE, h: FRAME.height + TOP }
type Gesture =
  | { mode: 'move'; id: string; start: PrintLayer; px: number; py: number }
  | { mode: 'scale' | 'rotate'; id: string; start: PrintLayer; px: number; py: number; cx: number; cy: number }
  | { mode: 'pinch'; id: string; start: PrintLayer; d0: number; a0: number }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const round = (v: number, k = 1000) => Math.round(v * k) / k

export function GarmentDesigner({ body, items, slot, layers, onLayers, upload, personalName, colors }: {
  body: Body
  /** Cả bộ đang thiết kế (để xem thử); lớp của `slot` lấy từ `layers` */
  items: CharacterItem[]
  slot: 'top' | 'bottom'
  layers: PrintLayer[]
  onLayers: (l: PrintLayer[]) => void
  upload: (file: File) => Promise<string>
  personalName?: string | null
  /** Màu gợi ý (màu CLB) */
  colors: string[]
}) {
  const h = useHistory<PrintLayer[]>(() => layers)
  const value = h.value
  const [sel, setSel] = useState<string | null>(value[0]?.id ?? null)
  const [draft, setDraft] = useState<PrintLayer | null>(null)           // lớp đang kéo (vẽ trực tiếp, chưa ghi)
  const [box, setBox] = useState<Box | null>(null)
  const [zoom, setZoom] = useState(true)
  const [view, setView] = useState({ w: 360, h: 460 })
  const [imgs, setImgs] = useState<Record<string, HTMLImageElement>>({})
  const [fontTick, setFontTick] = useState(0)
  const [guides, setGuides] = useState<{ v: boolean; h: boolean }>({ v: false, h: false })
  const [busy, setBusy] = useState(false)
  const viewport = useRef<HTMLDivElement>(null)
  const live = useRef<HTMLCanvasElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const measure = useMemo(() => (typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')), [])
  const personal = (personalName ?? '').trim().split(/\s+/).pop()?.toUpperCase() || null

  // Đồng bộ ra ngoài mỗi khi thiết kế đổi (kể cả hoàn tác)
  const first = useRef(true)
  useEffect(() => { if (first.current) { first.current = false; return } onLayers(value) }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void regionBoxes(body).then((b) => setBox(b[slot] ?? null)) }, [body, slot])
  useEffect(() => {
    const el = viewport.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setView({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // Font + ảnh cần có trước khi đo khung chọn
  useEffect(() => {
    let alive = true
    void (async () => {
      await import('@/shared/design/fonts')
      await Promise.all(value.filter((l) => l.type === 'text').map((l) => document.fonts?.load(layerFont(l, 40)).catch(() => undefined)))
      if (alive) setFontTick((t) => t + 1)
    })()
    for (const l of value) {
      if (l.type === 'image' && l.url && !imgs[l.url]) void loadImage(l.url).then((img) => alive && setImgs((m) => ({ ...m, [l.url!]: img }))).catch(() => undefined)
    }
    return () => { alive = false }
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  // Khung nhìn: toàn thân hoặc phóng vào vùng in
  const cam = useMemo(() => {
    const r = zoom && box
      ? { x: box.x0 + SIDE - box.w * 0.35, y: box.y0 + TOP - box.h * 0.3, w: box.w * 1.7, h: box.h * 1.6 }
      : { x: SIDE - 40, y: TOP - 40, w: FRAME.width + 80, h: FRAME.height + 60 }
    const s = Math.min(view.w / r.w, view.h / r.h)
    return { s, left: view.w / 2 - (r.x + r.w / 2) * s, top: view.h / 2 - (r.y + r.h / 2) * s }
  }, [zoom, box, view])

  const toFrame = (clientX: number, clientY: number) => {
    const r = viewport.current!.getBoundingClientRect()
    return { x: (clientX - r.left - cam.left) / cam.s - SIDE, y: (clientY - r.top - cam.top) / cam.s - TOP }
  }
  const rectOf = useCallback((l: PrintLayer): LayerRect | null => (measure && box ? layerRect(measure, l, box, personal, l.url ? imgs[l.url] : null) : null),
    [measure, box, personal, imgs, fontTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const current = draft ?? value.find((l) => l.id === sel) ?? null
  const selRect = current ? rectOf(current) : null

  // Lớp đang kéo: vẽ trực tiếp lên canvas phủ (không chờ vẽ lại cả nhân vật)
  useEffect(() => {
    const c = live.current?.getContext('2d')
    if (!c) return
    c.clearRect(0, 0, STAGE.w, STAGE.h)
    if (!draft || !box) return
    c.save()
    c.translate(SIDE, TOP)
    drawLayer(c, draft, box, personal, draft.url ? imgs[draft.url] : null)
    c.restore()
  }, [draft, box, personal, imgs])

  // Nhân vật vẽ với các lớp đã ghi (bỏ lớp đang kéo để khỏi thấy 2 lần)
  const renderItems = useMemo(() => items.map((i) => (i.slot === slot
    ? { ...i, print: { ...(i.print ?? {}), layers: value.filter((l) => !draft || l.id !== draft.id) } } : i)), [items, slot, value, draft])

  const patch = (id: string, p: Partial<PrintLayer>, record = true) => h.update((ls) => ls.map((l) => (l.id === id ? { ...l, ...p } : l)), record)

  // ---------------- Cử chỉ ----------------
  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (!box) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const handle = (e.target as Element).getAttribute('data-handle')
    const f = toFrame(e.clientX, e.clientY)
    if (pointers.current.size === 2 && current) {
      const [a, b] = [...pointers.current.values()]
      gesture.current = { mode: 'pinch', id: current.id, start: current, d0: Math.hypot(b.x - a.x, b.y - a.y), a0: Math.atan2(b.y - a.y, b.x - a.x) }
      return
    }
    if ((handle === 'scale' || handle === 'rotate') && current && selRect) {
      gesture.current = { mode: handle, id: current.id, start: current, px: f.x, py: f.y, cx: selRect.cx, cy: selRect.cy }
      setDraft(current)
      return
    }
    const hit = [...value].reverse().find((l) => { const r = rectOf(l); return r && hitLayer(r, f.x, f.y, 8 / cam.s) })
    if (!hit) { setSel(null); return }
    setSel(hit.id)
    gesture.current = { mode: 'move', id: hit.id, start: hit, px: f.x, py: f.y }
    setDraft(hit)
  }
  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const g = gesture.current
    if (!g || !box) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const f = toFrame(e.clientX, e.clientY)
    if (g.mode === 'move') {
      let x = g.start.x + (f.x - g.px) / box.w, y = g.start.y + (f.y - g.py) / box.h
      const sv = Math.abs(x - 0.5) * box.w < 6 / cam.s, sh = Math.abs(y - 0.5) * box.h < 6 / cam.s
      if (sv) x = 0.5
      if (sh) y = 0.5
      setGuides({ v: sv, h: sh })
      setDraft({ ...g.start, x: round(clamp(x, -0.2, 1.2)), y: round(clamp(y, -0.2, 1.2)) })
    } else if (g.mode === 'scale') {
      const k = Math.hypot(f.x - g.cx, f.y - g.cy) / Math.max(1, Math.hypot(g.px - g.cx, g.py - g.cy))
      setDraft({ ...g.start, w: round(clamp(g.start.w * k, 0.02, 1.6)) })
    } else if (g.mode === 'rotate') {
      let a = g.start.rot + ((Math.atan2(f.y - g.cy, f.x - g.cx) - Math.atan2(g.py - g.cy, g.px - g.cx)) * 180) / Math.PI
      a = ((a + 540) % 360) - 180
      const snap = Math.round(a / 45) * 45
      if (Math.abs(a - snap) < 4) a = snap
      setDraft({ ...g.start, rot: Math.round(a) })
    } else if (g.mode === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const k = Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, g.d0)
      const rot = g.start.rot + ((Math.atan2(b.y - a.y, b.x - a.x) - g.a0) * 180) / Math.PI
      setDraft({ ...g.start, w: round(clamp(g.start.w * k, 0.02, 1.6)), rot: Math.round(((rot + 540) % 360) - 180) })
    }
  }
  const onUp = (e: RPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size > 0 && gesture.current?.mode !== 'pinch') return
    const d = draft
    gesture.current = null
    setGuides({ v: false, h: false })
    setDraft(null)
    if (d) {
      const old = value.find((l) => l.id === d.id)
      if (old && (old.x !== d.x || old.y !== d.y || old.w !== d.w || old.rot !== d.rot)) patch(d.id, { x: d.x, y: d.y, w: d.w, rot: d.rot })
    }
  }

  // ---------------- Thao tác ----------------
  const add = (l: Omit<PrintLayer, 'id'>) => {
    const id = newLayerId()
    h.update((ls) => [...ls, { ...l, id }].slice(-12))
    setSel(id)
  }
  const addText = (text = 'CHỮ MỚI') => {
    if (value.length >= 12) { toast.error('Tối đa 12 lớp in.'); return }
    add({ type: 'text', text, font: 'athletic', color: colors[1] ?? '#ffffff', x: 0.5, y: text === NAME_TOKEN ? 0.82 : 0.4, w: text === NAME_TOKEN ? 0.28 : 0.45, rot: 0, opacity: 1, spacing: 0.04 })
  }
  const addImage = async (file: File | undefined) => {
    if (!file) return
    if (value.length >= 12) { toast.error('Tối đa 12 lớp in.'); return }
    if (file.size > 2 * 1024 * 1024) { toast.error('Ảnh tối đa 2 MB.'); return }
    setBusy(true)
    try { add({ type: 'image', url: await upload(file), x: 0.72, y: 0.22, w: 0.18, rot: 0, opacity: 1 }) }
    catch { toast.error('Không tải được ảnh. Hãy thử lại.') }
    finally { setBusy(false) }
  }
  const remove = (id: string) => { h.update((ls) => ls.filter((l) => l.id !== id)); setSel(null) }
  const duplicate = (l: PrintLayer) => add({ ...l, x: clamp(l.x + 0.05, 0, 1), y: clamp(l.y + 0.05, 0, 1) })
  const move = (id: string, dir: 1 | -1) => h.update((ls) => {
    const i = ls.findIndex((l) => l.id === id), j = i + dir
    if (i < 0 || j < 0 || j >= ls.length) return ls
    const n = [...ls]; [n[i], n[j]] = [n[j], n[i]]; return n
  })

  // Phím tắt: xóa, di chuyển từng chút, hoàn tác
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) h.redo(); else h.undo(); return }
      if (!sel) return
      const l = value.find((x) => x.id === sel)
      if (!l) return
      const step = e.shiftKey ? 0.02 : 0.005
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(sel) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); patch(sel, { x: round(l.x - step) }) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); patch(sel, { x: round(l.x + step) }) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); patch(sel, { y: round(l.y - step) }) }
      else if (e.key === 'ArrowDown') { e.preventDefault(); patch(sel, { y: round(l.y + step) }) }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  })

  const s = cam.s
  const corners = selRect ? rectCorners(selRect).map(([x, y]) => [x + SIDE, y + TOP]) : []
  const rotHandle = selRect ? (() => {
    const a = (selRect.rot * Math.PI) / 180, d = selRect.h / 2 + 34 / s
    return [selRect.cx + SIDE + Math.sin(a) * d, selRect.cy + TOP - Math.cos(a) * d]
  })() : null
  const sel0 = value.find((l) => l.id === sel) ?? null
  const swatches = [...new Set([...colors, '#ffffff', '#111111', '#facc15', '#ef4444'].map((c) => c.toLowerCase()))]

  return (
    <div className="space-y-3">
      {/* Thanh công cụ */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" onClick={() => addText()}><Type className="size-4" aria-hidden />Chữ</Button>
        <label className={cn('inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-semibold hover:bg-surface-2', busy && 'opacity-60')}>
          <ImagePlus className="size-4" aria-hidden />{busy ? 'Đang tải…' : 'Logo / ảnh'}
          <input type="file" accept="image/png,image/webp,image/jpeg" className="sr-only" disabled={busy} onChange={(e) => { void addImage(e.target.files?.[0]); e.target.value = '' }} />
        </label>
        <Button size="sm" variant="secondary" onClick={() => addText(NAME_TOKEN)}><UserRound className="size-4" aria-hidden />Tên runner</Button>
        <span className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" onClick={h.undo} disabled={!h.canUndo} aria-label="Hoàn tác"><Undo2 className="size-4" aria-hidden /></Button>
          <Button size="sm" variant="ghost" onClick={h.redo} disabled={!h.canRedo} aria-label="Làm lại"><Redo2 className="size-4" aria-hidden /></Button>
          <Button size="sm" variant="ghost" onClick={() => setZoom((z) => !z)} aria-label={zoom ? 'Xem toàn thân' : 'Phóng vào vùng in'}>
            {zoom ? <Minimize2 className="size-4" aria-hidden /> : <Maximize2 className="size-4" aria-hidden />}
          </Button>
        </span>
      </div>

      {/* Bàn làm việc */}
      <div ref={viewport} className="relative h-[28rem] touch-none select-none overflow-hidden rounded-2xl border border-border bg-[#c4c4ce]">
        <div className="absolute origin-top-left" style={{ width: STAGE.w, height: STAGE.h, transform: `translate(${cam.left}px, ${cam.top}px) scale(${s})` }}>
          <PaperDoll gender={body} items={renderItems} personalName={personalName ?? 'Runner'} className="size-full" label="Bàn thiết kế" />
          <canvas ref={live} width={STAGE.w} height={STAGE.h} className="pointer-events-none absolute inset-0 size-full" aria-hidden />
          <svg viewBox={`0 0 ${STAGE.w} ${STAGE.h}`} className="absolute inset-0 size-full cursor-crosshair"
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} role="application" aria-label="Kéo để di chuyển, kéo góc để phóng to, kéo nút tròn phía trên để xoay">
            {box && (
              <rect x={box.x0 + SIDE} y={box.y0 + TOP} width={box.w} height={box.h} fill="none" stroke="#ffffff" strokeOpacity={0.35}
                strokeDasharray={`${6 / s} ${6 / s}`} strokeWidth={1 / s} pointerEvents="none" />
            )}
            {box && guides.v && <line x1={box.x0 + SIDE + box.w / 2} x2={box.x0 + SIDE + box.w / 2} y1={box.y0 + TOP - 20} y2={box.y0 + TOP + box.h + 20} stroke="#f0abfc" strokeWidth={1.5 / s} pointerEvents="none" />}
            {box && guides.h && <line y1={box.y0 + TOP + box.h / 2} y2={box.y0 + TOP + box.h / 2} x1={box.x0 + SIDE - 20} x2={box.x0 + SIDE + box.w + 20} stroke="#f0abfc" strokeWidth={1.5 / s} pointerEvents="none" />}
            {selRect && (
              <g>
                <polygon points={corners.map((c) => c.join(',')).join(' ')} fill="none" stroke="#a3e635" strokeWidth={2 / s} pointerEvents="none" />
                {rotHandle && <line x1={(corners[0][0] + corners[1][0]) / 2} y1={(corners[0][1] + corners[1][1]) / 2} x2={rotHandle[0]} y2={rotHandle[1]} stroke="#a3e635" strokeWidth={1.5 / s} pointerEvents="none" />}
                {rotHandle && <circle data-handle="rotate" cx={rotHandle[0]} cy={rotHandle[1]} r={11 / s} fill="#ffffff" stroke="#65a30d" strokeWidth={2 / s} className="cursor-grab" />}
                {corners.map(([x, y], k) => (
                  <rect key={k} data-handle="scale" x={x - 8 / s} y={y - 8 / s} width={16 / s} height={16 / s} rx={3 / s} fill="#ffffff" stroke="#65a30d" strokeWidth={2 / s} className="cursor-nwse-resize" />
                ))}
              </g>
            )}
          </svg>
        </div>
        {value.length === 0 && (
          <p className="pointer-events-none absolute inset-x-4 bottom-3 rounded-xl bg-bg/85 p-2 text-center text-xs text-fg-muted backdrop-blur">
            Thêm chữ hoặc logo, rồi kéo trên áo để đặt vị trí
          </p>
        )}
      </div>
      <p className="text-[11px] text-fg-muted">Kéo để di chuyển · kéo ô vuông ở góc để phóng to / thu nhỏ · kéo nút tròn để xoay · 2 ngón tay: vừa phóng vừa xoay · đường hồng = đang căn giữa</p>

      {/* Danh sách lớp */}
      {value.length > 0 && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="listbox" aria-label="Các lớp in">
          {[...value].reverse().map((l) => (
            <button key={l.id} type="button" role="option" aria-selected={sel === l.id} onClick={() => setSel(l.id)}
              className={cn('flex max-w-40 shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold', sel === l.id ? 'border-brand bg-brand/15' : 'border-border text-fg-muted')}>
              {l.type === 'text' ? <Type className="size-3.5 shrink-0" aria-hidden /> : <ImagePlus className="size-3.5 shrink-0" aria-hidden />}
              <span className="truncate">{l.type === 'text' ? (l.text === NAME_TOKEN ? 'Tên runner' : l.text) : 'Ảnh'}</span>
            </button>
          ))}
        </div>
      )}

      {/* Thuộc tính lớp đang chọn */}
      {sel0 && (
        <div className="space-y-3 rounded-2xl border border-border p-3">
          {sel0.type === 'text' && (
            <>
              <div className="flex gap-2">
                <Input value={sel0.text ?? ''} maxLength={40} onChange={(e) => patch(sel0.id, { text: e.target.value })} aria-label="Nội dung chữ" />
                {!sel0.text?.includes(NAME_TOKEN) && (
                  <Button size="sm" variant="secondary" className="h-11 shrink-0" onClick={() => patch(sel0.id, { text: `${sel0.text ?? ''}${NAME_TOKEN}`.slice(0, 40) })}>+ Tên</Button>
                )}
              </div>
              <p className="-mt-1 text-[11px] text-fg-muted"><b>{NAME_TOKEN}</b> sẽ thành tên gọi của từng người mặc.</p>
              <FontPicker value={isFontKey(sel0.font) ? sel0.font : 'athletic'} italic={false} sample="Aa"
                onChange={(f: FontKey) => { patch(sel0.id, { font: f }); void document.fonts?.load(`${FONTS[f].weight} 40px sans-serif`) }} />
              <ColorRow label="Màu chữ" value={sel0.color ?? '#ffffff'} swatches={swatches} onChange={(c) => patch(sel0.id, { color: c })} />
              <div className="grid grid-cols-2 gap-3">
                <Slider label="Viền chữ" value={Math.round((sel0.stroke_w ?? 0) * 100)} min={0} max={30} unit="%" onChange={(v) => patch(sel0.id, { stroke_w: v / 100 })} />
                <Slider label="Giãn chữ" value={Math.round((sel0.spacing ?? 0) * 100)} min={-10} max={80} unit="%" onChange={(v) => patch(sel0.id, { spacing: v / 100 })} />
              </div>
              {(sel0.stroke_w ?? 0) > 0 && <ColorRow label="Màu viền" value={sel0.stroke ?? '#000000'} swatches={swatches} onChange={(c) => patch(sel0.id, { stroke: c })} />}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={sel0.bold !== false} onChange={(e) => patch(sel0.id, { bold: e.target.checked })} className="size-4 accent-[var(--color-brand)]" />
                Chữ đậm
              </label>
            </>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Slider label="Cỡ" value={Math.round(sel0.w * 100)} min={2} max={160} unit="%" onChange={(v) => patch(sel0.id, { w: v / 100 })} />
            <Slider label="Xoay" value={sel0.rot} min={-180} max={180} unit="°" onChange={(v) => patch(sel0.id, { rot: v })} />
            <Slider label="Độ đậm (mờ)" value={Math.round(sel0.opacity * 100)} min={10} max={100} unit="%" onChange={(v) => patch(sel0.id, { opacity: v / 100 })} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => patch(sel0.id, { x: 0.5 })}><AlignCenterHorizontal className="size-4" aria-hidden />Căn giữa</Button>
            <Button size="sm" variant="secondary" onClick={() => patch(sel0.id, { rot: 0 })}>Thẳng</Button>
            <Button size="sm" variant="secondary" onClick={() => move(sel0.id, 1)} aria-label="Đưa lên trên"><ArrowUp className="size-4" aria-hidden /></Button>
            <Button size="sm" variant="secondary" onClick={() => move(sel0.id, -1)} aria-label="Đưa xuống dưới"><ArrowDown className="size-4" aria-hidden /></Button>
            <Button size="sm" variant="secondary" onClick={() => duplicate(sel0)} aria-label="Nhân đôi"><Copy className="size-4" aria-hidden /></Button>
            <Button size="sm" variant="danger" onClick={() => remove(sel0.id)} aria-label="Xóa lớp"><Trash2 className="size-4" aria-hidden /></Button>
          </div>
        </div>
      )}
    </div>
  )
}

function ColorRow({ label, value, swatches, onChange }: { label: string; value: string; swatches: string[]; onChange: (c: string) => void }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-fg-muted">{label}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {swatches.map((c) => (
          <button key={c} type="button" onClick={() => onChange(c)} aria-label={`Màu ${c}`} aria-pressed={value.toLowerCase() === c}
            className={cn('size-8 rounded-full border-2', value.toLowerCase() === c ? 'border-fg' : 'border-border')} style={{ background: c }} />
        ))}
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${label}: màu bất kỳ`} className="h-8 w-10 cursor-pointer rounded-lg border border-border bg-bg" />
      </div>
    </div>
  )
}
