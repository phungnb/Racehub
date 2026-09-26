'use client'

import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { BellRing, ImagePlus, Link2, Pin, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Field, Input, Sheet, SwitchRow, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { clubErrorMessage } from '../../api/clubApi'
import { MAX_POST_IMAGES, postImageUrl, publishNews, uploadPostImage, type ClubPost, type NewsCategory } from '../../api/postsApi'
import { clubKeys } from '../../hooks/keys'
import { NEWS_CATEGORIES } from '../../model/media'

type Img = { path?: string; file?: File; url: string }

/** Ban chủ nhiệm đăng / sửa Tin CLB: tiêu đề, chuyên mục, nội dung, link, ảnh; ghim và / hoặc báo cho cả CLB */
export function NewsSheet({ clubId, meId, post, onClose }: { clubId: string; meId: string; post?: ClubPost | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [title, setTitle] = useState(post?.title ?? '')
  const [body, setBody] = useState(post?.body ?? '')
  const [cat, setCat] = useState<NewsCategory>(post?.meta.category ?? 'NOTICE')
  const [link, setLink] = useState(post?.meta.link ?? '')
  const [pin, setPin] = useState(post?.is_pinned ?? false)
  const [notify, setNotify] = useState(!post)
  const [imgs, setImgs] = useState<Img[]>(() => (post?.image_paths ?? []).map((p) => ({ path: p, url: postImageUrl(p) })))
  const input = useRef<HTMLInputElement>(null)

  const save = useMutation({
    mutationFn: async () => {
      const paths = await Promise.all(imgs.map((i) => (i.path ? Promise.resolve(i.path) : uploadPostImage(clubId, meId, i.file!))))
      return publishNews(clubId, { id: post?.id, title: title.trim(), body: body.trim(), category: cat, link: link.trim() || null, image_paths: paths, pin, notify: !post && notify })
    },
    onSuccess: () => {
      imgs.forEach((i) => i.file && URL.revokeObjectURL(i.url))
      void qc.invalidateQueries({ queryKey: clubKeys.news(clubId) })
      void qc.invalidateQueries({ queryKey: clubKeys.posts(clubId) })
      void qc.invalidateQueries({ queryKey: clubKeys.pinned(clubId) })
      toast.success(post ? 'Đã cập nhật tin' : notify ? 'Đã đăng tin và báo cho cả CLB' : 'Đã đăng tin')
      onClose()
    },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  const badLink = !!link.trim() && !/^https?:\/\/\S+$/i.test(link.trim())

  return (
    <Sheet open onClose={onClose} title={post ? 'Sửa tin CLB' : 'Đăng tin CLB'} description="Tin của ban chủ nhiệm — runner lọc xem riêng ở mục Tin CLB"
      footer={<Button block loading={save.isPending} disabled={title.trim().length < 3 || badLink} onClick={() => save.mutate()}>{post ? 'Lưu' : 'Đăng tin'}</Button>}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Chuyên mục">
          {(Object.keys(NEWS_CATEGORIES) as NewsCategory[]).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={cat === k} onClick={() => setCat(k)}
              className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold', cat === k ? 'border-transparent ' + NEWS_CATEGORIES[k].tone : 'border-border text-fg-muted')}>
              {NEWS_CATEGORIES[k].label}
            </button>
          ))}
        </div>
        <Field label="Tiêu đề" htmlFor="news-title" hint={`${title.length}/120`}>
          <Input id="news-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Mở đăng ký giải Hà Nội Marathon theo đoàn CLB" />
        </Field>
        <Field label="Nội dung" htmlFor="news-body">
          <Textarea id="news-body" value={body} maxLength={4000} rows={6} onChange={(e) => setBody(e.target.value)} placeholder="Thời gian, địa điểm, cách đăng ký, người liên hệ…" />
        </Field>
        <Field label="Link kèm theo (không bắt buộc)" htmlFor="news-link" error={badLink ? 'Link phải bắt đầu bằng https://' : null} hint="Form đăng ký, trang giải, album ảnh…">
          <div className="relative">
            <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
            <Input id="news-link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" className="pl-9" inputMode="url" />
          </div>
        </Field>
        {imgs.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {imgs.map((im, i) => (
              <div key={im.url} className="relative aspect-square overflow-hidden rounded-xl border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element -- ảnh xem trước */}
                <img src={im.url} alt="" className="size-full object-cover" />
                <button type="button" aria-label="Bỏ ảnh" onClick={() => { if (im.file) URL.revokeObjectURL(im.url); setImgs(imgs.filter((_, j) => j !== i)) }}
                  className="absolute right-1 top-1 grid size-7 place-items-center rounded-full bg-black/70 text-white"><X className="size-4" aria-hidden /></button>
              </div>
            ))}
          </div>
        )}
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden
          onChange={(e) => { const l = Array.from(e.target.files ?? []); setImgs((x) => [...x, ...l.map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, MAX_POST_IMAGES)); e.target.value = '' }} />
        <Button type="button" variant="secondary" size="sm" onClick={() => input.current?.click()} disabled={imgs.length >= MAX_POST_IMAGES}>
          <ImagePlus className="size-4" aria-hidden />Thêm ảnh ({imgs.length}/{MAX_POST_IMAGES})
        </Button>
        <SwitchRow icon={Pin} checked={pin} onChange={setPin} label="Ghim đầu bảng tin" description="Tin quan trọng luôn nằm trên cùng" />
        {!post && <SwitchRow icon={BellRing} checked={notify} onChange={setNotify} label="Gửi thông báo cho cả CLB" description="Mọi thành viên nhận thông báo đẩy" />}
      </div>
    </Sheet>
  )
}
