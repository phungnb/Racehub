import type { MetadataRoute } from 'next'
import { ICONS } from '@/shared/config/brand'

// Web App Manifest: cho phép "Cài lên màn hình chính" (Android, iOS 16.4+, máy tính)
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'RaceHub — Chạy bộ, thử thách & CLB',
    short_name: 'RaceHub',
    description: 'Chạy bộ cùng CLB: thử thách, giải chạy ảo, nhân vật và phần thưởng Xu.',
    lang: 'vi',
    start_url: '/feed?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0a0d12',
    theme_color: '#0a0d12',
    categories: ['sports', 'health', 'social'],
    icons: [
      { src: ICONS.any192, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: ICONS.any512, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: ICONS.maskable192, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: ICONS.maskable512, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Ghi bài chạy', url: '/run', icons: [{ src: ICONS.any192, sizes: '192x192' }] },
      { name: 'CLB của tôi', url: '/clubs', icons: [{ src: ICONS.any192, sizes: '192x192' }] },
      { name: 'Thông báo', url: '/notifications', icons: [{ src: ICONS.any192, sizes: '192x192' }] },
    ],
  }
}
