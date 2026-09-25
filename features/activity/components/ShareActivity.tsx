'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, Loader2, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, SegmentedControl, Sheet, SwitchRow, useImageSaver } from '@/shared/ui'
import { useMyProfile } from '@/features/auth'
import { renderCharacter, resolveOutfit, useCharacterState } from '@/features/character'
import { paceFrom } from '@/shared/lib/format'
import type { ActivityDetail } from '../api/activities'
import type { LatLng } from '../model/route'
import { drawPoster, posterFileName, type PosterFormat } from '../model/poster'

/** Tạo ảnh chia sẻ bài chạy: chọn khổ, bật/tắt bản đồ + nhân vật, xem trước, chia sẻ hoặc tải về */
export function ShareActivitySheet({ activity: a, route, onClose }: { activity: ActivityDetail; route: LatLng[]; onClose: () => void }) {
  const { profile } = useMyProfile()
  const character = useCharacterState()
  const [format, setFormat] = useState<PosterFormat>('story')
  const [showMap, setShowMap] = useState(route.length >= 2)
  const [showChar, setShowChar] = useState(true)
  const [img, setImg] = useState<{ url: string; blob: Blob } | null>(null)
  const [busy, setBusy] = useState(true)
  const charCanvas = useRef<Promise<HTMLCanvasElement | null> | null>(null)

  useEffect(() => {
    let alive = true
    const c = character.data
    if (showChar && c && !charCanvas.current) charCanvas.current = renderCharacter(c.gender, resolveOutfit(c.items, c.equipped)).catch(() => null)
    ;(async () => {
      setBusy(true)
      const canvas = document.createElement('canvas')
      await drawPoster(canvas, {
        title: a.title, startedAt: a.started_at, distanceM: a.distance_m, movingS: a.moving_s,
        paceS: a.avg_pace_s || paceFrom(a.distance_m, a.moving_s), elevationM: a.elevation_gain_m,
        name: profile?.display_name ?? a.owner.display_name ?? 'Runner', level: (profile?.level as number | null) ?? a.owner.level,
        route: showMap ? route : [], character: showChar && charCanvas.current ? await charCanvas.current : null,
        site: location.host,
      }, format)
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
      if (!alive || !blob) return
      setImg((old) => { if (old) URL.revokeObjectURL(old.url); return { url: URL.createObjectURL(blob), blob } })
      setBusy(false)
    })().catch(() => { if (alive) { setBusy(false); toast.error('Không tạo được ảnh. Thử lại.') } })
    return () => { alive = false }
  }, [a, route, format, showMap, showChar, character.data, profile])

  useEffect(() => () => { if (img) URL.revokeObjectURL(img.url) }, [img])

  const file = () => new File([img!.blob], posterFileName(a.started_at), { type: 'image/png' })
  const canShareFile = typeof navigator !== 'undefined' && !!img && !!navigator.canShare?.({ files: [file()] })

  const share = async () => {
    if (!img) return
    try {
      await navigator.share({ files: [file()], title: a.title, text: 'Bài chạy của tôi trên RaceHub' })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast.error('Không chia sẻ được. Hãy tải ảnh về rồi đăng.')
    }
  }
  const saver = useImageSaver()
  const download = () => { if (img) void saver.saveBlob(img.blob, posterFileName(a.started_at), a.title ?? 'Bài chạy RaceHub') }

  return (
    <Sheet open onClose={onClose} title="Chia sẻ bài chạy" description="Đăng lên Facebook, Zalo, Instagram Story…"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" block onClick={download} disabled={!img || busy} loading={saver.busy}><Download className="size-4" aria-hidden />Lưu ảnh</Button>
          {canShareFile && <Button block onClick={() => void share()} disabled={busy}><Share2 className="size-4" aria-hidden />Chia sẻ</Button>}
        </div>
      }>
      <div className="space-y-4">
        <SegmentedControl value={format} onChange={setFormat} options={[{ value: 'story', label: 'Story 9:16' }, { value: 'square', label: 'Vuông 1:1' }]} />
        <div className="relative mx-auto w-full max-w-[260px]">
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element -- ảnh vừa vẽ (blob)
            <img src={img.url} alt="Xem trước ảnh chia sẻ" className={`w-full rounded-2xl border border-border ${busy ? 'opacity-50' : ''}`} />
          ) : <div className={`w-full rounded-2xl bg-surface-2 ${format === 'story' ? 'aspect-[9/16]' : 'aspect-square'}`} />}
          {busy && <Loader2 className="absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 animate-spin text-brand" aria-label="Đang tạo ảnh" />}
        </div>
        <div className="divide-y divide-border rounded-2xl border border-border px-3">
          <SwitchRow label="Hiện tuyến chạy" checked={showMap} onChange={setShowMap} disabled={route.length < 2}
            description={route.length < 2 ? 'Bài này không có dữ liệu GPS' : 'Tắt nếu tuyến đi qua nhà bạn'} />
          <SwitchRow label="Hiện nhân vật" checked={showChar} onChange={setShowChar} description="Nhân vật đang mặc bộ đồ hiện tại" />
        </div>
      </div>
      {saver.sheet}
    </Sheet>
  )
}
