import type { Metadata, Viewport } from 'next'
import { Be_Vietnam_Pro, JetBrains_Mono } from 'next/font/google'
import { Providers } from './providers'
import { ICONS } from '@/shared/config/brand'
import './globals.css'

const sans = Be_Vietnam_Pro({
  variable: '--font-be-vietnam',
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700', '800'],
})
const mono = JetBrains_Mono({ variable: '--font-jetbrains', subsets: ['latin'] })

export const metadata: Metadata = {
  title: { default: 'RaceHub — Chạy bộ, thử thách & cộng đồng', template: '%s · RaceHub' },
  description: 'Nền tảng chạy bộ xã hội: thử thách, giải chạy ảo, CLB và phần thưởng RaceCoin.',
  applicationName: 'RaceHub',
  appleWebApp: { capable: true, title: 'RaceHub', statusBarStyle: 'black-translucent' },
  icons: { icon: [{ url: ICONS.any192, sizes: '192x192', type: 'image/png' }], apple: ICONS.apple },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  themeColor: '#0a0d12',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="vi" className={`${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
