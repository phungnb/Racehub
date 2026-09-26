'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, LayoutGrid, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button, ErrorState, Sheet, Skeleton, useImageSaver } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import {
  autoCert, CERT_BINDS, CERT_COLOR_LABEL, CERT_FORMATS, CERT_TEMPLATES, certPayload, drawCertificate, editableCert, keepCertAssets, resolveCert,
  type CertDesign, type CertFormat, type CertificateData, type CertTemplate, type StoredCert,
} from '@/features/race'
import { COLOR_KEYS, DEFAULT_FIT, panArt, type Layer } from '@/shared/design/engine'
import { DesignCanvas } from '@/shared/design/DesignCanvas'
import { ImagePick, Section, Slider, Toggle, useImageSize } from '@/shared/design/studio/bits'
import { Studio } from '@/shared/design/studio/Studio'
import { useHistory } from '@/shared/design/studio/useHistory'
import { getCampaignCertificate, orgErrorMessage, setCampaignCertDesign, uploadOrgImage, type CampaignCertificate, type CampaignMetric } from '../api/orgApi'
import { fmtValue } from '../model/org'

/** Nhãn trường dữ liệu trên chứng nhận chiến dịch (cùng khoá với chứng nhận giải chạy ảo) */
const CAMPAIGN_BINDS: typeof CERT_BINDS = {
  name: { label: 'Tên người chạy', sample: 'Nguyễn Văn An' },
  race: { label: 'Tên chiến dịch', sample: 'Tháng 10 chạy vì sức khoẻ' },
  org: { label: 'Tổ chức', sample: 'Công ty ABC' },
  distance: { label: 'Thành tích', sample: '312 km' },
  time: { label: 'Số buổi · ngày', sample: '24 buổi · 20 ngày' },
  pace: { label: 'Tổng km', sample: '312 km' },
  rank: { label: 'Hạng', sample: '12/340' },
  date: { label: 'Ngày', sample: '31 tháng 10, 2026' },
  bib: { label: 'Đơn vị', sample: 'Phòng Kỹ thuật' },
}

const longDate = (iso: string) => new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: 'long', year: 'numeric' })

function certData(c: Pick<CampaignCertificate, 'campaign' | 'org_name' | 'name' | 'unit_name' | 'value' | 'km' | 'runs' | 'active_days' | 'rank' | 'participants' | 'date'> & { metric: CampaignMetric }, url: string): CertificateData {
  return {
    race: c.campaign, organizer: c.org_name, name: c.name, bib: '', distanceKm: Number(c.km), timeS: 0, rank: c.rank, finishers: c.participants,
    date: longDate(c.date), raceUrl: url, verifyUrl: url,
    values: {
      distance: fmtValue(c.value, c.metric), time: `${c.runs} buổi · ${c.active_days} ngày`, pace: fmtValue(c.km, 'DISTANCE'),
      bib: c.unit_name ?? '', rank: `${c.rank}/${c.participants}`,
    },
  }
}

/** Quản trị thiết kế chứng nhận hoàn thành chiến dịch — cùng trình thiết kế với chứng nhận giải chạy ảo */
export function CampaignCertDesigner({ orgId, campaign, onClose }: {
  orgId: string; onClose: () => void
  campaign: { id: string; title: string; org_name: string; metric: CampaignMetric; ends_at: string; cert_design?: StoredCert | null }
}) {
  const qc = useQueryClient()
  const h = useHistory<CertDesign>(() => editableCert(campaign.cert_design ?? null))
  const d = h.value
  const set = (p: Partial<CertDesign>, record = true) => h.update((x) => ({ ...x, ...p }), record)
  const size = CERT_FORMATS[d.format]
  const palette = { ...CERT_TEMPLATES[d.template].colors, ...d.colors }
  const artDim = useImageSize(d.art_url)
  const framed = d.use_art && !!d.art_url
  const [uploading, setUploading] = useState<string | null>(null)
  const upload = (f: File) => uploadOrgImage(orgId, f, 'cert').catch((e) => { throw new Error(orgErrorMessage(e)) })
  const pick = async (key: string, file: File | undefined, apply: (url: string) => void) => {
    if (!file) return
    setUploading(key)
    try { apply(await upload(file)) } catch (e) { toast.error((e as Error).message) } finally { setUploading(null) }
  }
  const done = (msg: string) => { toast.success(msg); void qc.invalidateQueries({ queryKey: ['org', orgId] }); onClose() }
  const save = useMutation({ mutationFn: () => setCampaignCertDesign(campaign.id, certPayload(d)), onSuccess: () => done('Đã lưu mẫu chứng nhận'), onError: (e) => toast.error(orgErrorMessage(e)) })
  const reset = useMutation({ mutationFn: () => setCampaignCertDesign(campaign.id, null), onSuccess: () => done('Đã về mẫu mặc định'), onError: (e) => toast.error(orgErrorMessage(e)) })
  const url = typeof window === 'undefined' ? '' : window.location.href
  const sample = certData({ campaign: campaign.title, org_name: campaign.org_name, name: 'Nguyễn Văn An', unit_name: 'Phòng Kỹ thuật', metric: campaign.metric,
    value: campaign.metric === 'DISTANCE' ? 312 : 24, km: 312, runs: 24, active_days: 20, rank: 12, participants: 340, date: campaign.ends_at }, url)
  const setLayers = (fn: (ls: Layer[]) => Layer[], record = true) => h.update((x) => ({ ...x, layers: fn(x.layers) }), record)
  const auto = (format: CertFormat = d.format, template: CertTemplate = d.template) =>
    h.update((x) => ({ ...x, format, template, layers: autoCert(format, template, keepCertAssets(x.layers)) }))

  const stylePanel = (
    <div className="space-y-3">
      <Section title="Khổ giấy">
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(CERT_FORMATS) as CertFormat[]).map((f) => (
            <button key={f} type="button" aria-pressed={d.format === f} onClick={() => f !== d.format && auto(f)}
              className={cn('rounded-xl border p-2.5 text-left', d.format === f ? 'border-brand bg-brand/10' : 'border-border')}>
              <span className="block text-sm font-semibold">{CERT_FORMATS[f].label}</span>
              <span className="block text-[11px] text-fg-muted">{CERT_FORMATS[f].hint}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Mẫu chứng nhận">
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(CERT_TEMPLATES) as CertTemplate[]).map((t) => (
            <button key={t} type="button" aria-pressed={d.template === t} onClick={() => set({ template: t, colors: {} })}
              className={cn('rounded-xl border p-2.5 text-left', d.template === t ? 'border-brand bg-brand/10' : 'border-border')}>
              <span className="block text-sm font-semibold">{CERT_TEMPLATES[t].label}</span>
              <span className="block text-[11px] text-fg-muted">{CERT_TEMPLATES[t].hint}</span>
            </button>
          ))}
        </div>
        <Button size="sm" variant="secondary" onClick={() => auto()}><LayoutGrid className="size-4" aria-hidden />Dựng lại bố cục</Button>
      </Section>
      <Section title="Bảng màu">
        <div className="grid grid-cols-5 gap-2">
          {COLOR_KEYS.map((k) => (
            <label key={k} className="flex flex-col items-center gap-1 text-center text-[11px] text-fg-muted">
              <input type="color" value={palette[k]} onChange={(e) => set({ colors: { ...d.colors, [k]: e.target.value } }, false)}
                className="h-10 w-full cursor-pointer rounded-lg border border-border bg-transparent" aria-label={`Màu ${CERT_COLOR_LABEL[k]}`} />
              {CERT_COLOR_LABEL[k]}
            </label>
          ))}
        </div>
        <Toggle checked={d.decor} onChange={(v) => set({ decor: v })} label="Khung viền / họa tiết của mẫu" />
      </Section>
      <Section title="Ảnh nền có sẵn" hint={`Đã có mẫu thiết kế? Tải lên (${size.w}×${size.h}), app in tên, thành tích lên trên.`}>
        <ImagePick label="Ảnh chứng nhận" url={d.art_url} busy={uploading === 'art'}
          onPick={(f) => pick('art', f, (u) => set({ art_url: u, use_art: true, art_fit: DEFAULT_FIT }))} onClear={() => set({ art_url: null, use_art: false })} />
        {d.art_url && <Toggle checked={d.use_art} onChange={(v) => set({ use_art: v })} label="Dùng ảnh này làm nền" />}
        {framed && <Slider label="Thu phóng" value={Math.round(d.art_fit.zoom * 100)} min={50} max={300} unit="%" onChange={(v) => set({ art_fit: { ...d.art_fit, zoom: v / 100 } }, false)} />}
        {!framed && (
          <>
            <ImagePick label="Ảnh nền mờ" url={d.bg_url} busy={uploading === 'bg'} onPick={(f) => pick('bg', f, (u) => set({ bg_url: u }))} onClear={() => set({ bg_url: null })} />
            {d.bg_url && <Slider label="Độ đậm ảnh nền" value={Math.round(d.bg_opacity * 100)} min={5} max={100} unit="%" onChange={(v) => set({ bg_opacity: v / 100 }, false)} />}
          </>
        )}
      </Section>
      {campaign.cert_design && <Button variant="ghost" block onClick={() => reset.mutate()} loading={reset.isPending}><RotateCcw className="size-4" aria-hidden />Về mẫu mặc định</Button>}
    </div>
  )

  return (
    <Sheet open onClose={onClose} title="Thiết kế chứng nhận chiến dịch" description="Kéo thả mọi phần tử · người đạt mục tiêu tải chứng nhận theo mẫu này (tên, thành tích tự điền)."
      className="sm:max-w-5xl sm:max-h-[94dvh]"
      footer={<Button block onClick={() => save.mutate()} loading={save.isPending} disabled={!!uploading}>Lưu mẫu chứng nhận</Button>}>
      <Studio size={size} binds={CAMPAIGN_BINDS} palette={palette} colorLabels={CERT_COLOR_LABEL}
        layers={d.layers} update={setLayers} snapshot={h.snapshot} history={h}
        preview={(onLayout) => (
          <DesignCanvas size={size} label="Xem trước chứng nhận" onLayout={onLayout}
            drawKey={JSON.stringify([d, sample])} draw={(c) => drawCertificate(c, d, sample, { editing: true })} />
        )}
        onPanArt={framed && artDim ? (dx, dy) => h.update((x) => ({ ...x, art_fit: panArt(x.art_fit, dx, dy, artDim.w, artDim.h, size) }), false) : null}
        upload={upload} qrSuggestions={[]} onAuto={() => auto()} stylePanel={stylePanel} />
    </Sheet>
  )
}

/** Người đạt mục tiêu: xem + lưu chứng nhận về máy */
export function CampaignCertificateSheet({ campaignId, onClose }: { campaignId: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['campaign-cert', campaignId], queryFn: () => getCampaignCertificate(campaignId) })
  const ref = useRef<HTMLCanvasElement>(null)
  const saver = useImageSaver()
  const c = q.data
  const size = CERT_FORMATS[resolveCert((c?.design ?? null) as StoredCert | null).format]
  useEffect(() => {
    if (!ref.current || !c) return
    void drawCertificate(ref.current, c.design as StoredCert | null, certData(c, window.location.href))
  }, [c])
  return (
    <Sheet open onClose={onClose} title="Chứng nhận hoàn thành"
      footer={c ? <Button block loading={saver.busy} onClick={() => void saver.saveCanvas(ref.current, `chung-nhan-${campaignId.slice(0, 8)}.png`, `Chứng nhận ${c.campaign}`)}>
        <Download className="size-4" aria-hidden />Lưu ảnh về máy</Button> : undefined}>
      {saver.sheet}
      {q.isPending ? <Skeleton className="h-96" /> : q.isError ? <ErrorState message={orgErrorMessage(q.error)} error={q.error} /> : (
        <canvas ref={ref} width={size.w} height={size.h} style={{ aspectRatio: `${size.w} / ${size.h}` }}
          className={cn('mx-auto w-full rounded-xl', size.h > size.w && 'max-w-xs')} aria-label="Chứng nhận" />
      )}
    </Sheet>
  )
}
