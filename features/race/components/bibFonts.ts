// Font chữ cho BIB (chỉ tải khi mở e-BIB / trình thiết kế: preload tắt). Đều có bộ chữ tiếng Việt.
import { Anton, Barlow_Condensed, Black_Ops_One, Chakra_Petch, Dancing_Script, Oswald, Playfair_Display, Roboto_Slab } from 'next/font/google'
import { registerBibFonts } from '../model/bib'

// next/font chỉ nhận tham số viết trực tiếp (không dùng biến / spread)
const oswald = Oswald({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['700'] })
const anton = Anton({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['400'] })
const barlow = Barlow_Condensed({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['800'], style: ['normal', 'italic'] })
const chakra = Chakra_Petch({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['700'], style: ['normal', 'italic'] })
const slab = Roboto_Slab({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['800'] })
const stencil = Black_Ops_One({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['400'] })
const script = Dancing_Script({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['700'] })
const serif = Playfair_Display({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['800'], style: ['normal', 'italic'] })

export const BIB_FONT_FAMILIES = registerBibFonts({
  condensed: oswald.style.fontFamily,
  impact: anton.style.fontFamily,
  athletic: barlow.style.fontFamily,
  tech: chakra.style.fontFamily,
  slab: slab.style.fontFamily,
  stencil: stencil.style.fontFamily,
  script: script.style.fontFamily,
  serif: serif.style.fontFamily,
})
