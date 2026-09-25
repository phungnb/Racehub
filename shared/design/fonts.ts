// Font chữ cho BIB / chứng nhận (chỉ tải khi mở e-BIB, chứng nhận hoặc trình thiết kế: preload tắt). Đều có bộ chữ tiếng Việt.
import {
  Alfa_Slab_One, Allura, Anton, Asap_Condensed, Bangers, Barlow_Condensed, Black_Ops_One, Bungee, Bungee_Shade, Chakra_Petch,
  Cormorant_Garamond, Dancing_Script, Dela_Gothic_One, EB_Garamond, Exo_2, Fjalla_One, Great_Vibes, Inter_Tight, Kanit, Lexend,
  Lobster, Montserrat, Oswald, Pacifico, Patrick_Hand, Paytone_One, Playfair_Display, Protest_Revolution, Protest_Strike,
  Roboto_Condensed, Roboto_Slab, Rowdies, Saira_Condensed, Sedgwick_Ave, Sigmar_One, Tourney, Unbounded, Yeseva_One,
} from 'next/font/google'
import { registerFonts } from './engine'

// next/font chỉ nhận tham số viết trực tiếp (không dùng biến / spread)
const montserrat = Montserrat({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['900'], style: ['normal', 'italic'] })
const inter = Inter_Tight({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['900'], style: ['normal', 'italic'] })
const lexend = Lexend({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['800'] })
const unbounded = Unbounded({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['800'] })
const anton = Anton({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['400'] })
const dela = Dela_Gothic_One({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['400'] })
const paytone = Paytone_One({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['400'] })
const sigmar = Sigmar_One({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['400'] })
const bungee = Bungee({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['400'] })
const bungeeShade = Bungee_Shade({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['400'] })
const rowdies = Rowdies({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['700'] })
const oswald = Oswald({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['700'] })
const barlow = Barlow_Condensed({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['800'], style: ['normal', 'italic'] })
const saira = Saira_Condensed({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['800'] })
const robotoC = Roboto_Condensed({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['800'], style: ['normal', 'italic'] })
const asapC = Asap_Condensed({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['800'], style: ['normal', 'italic'] })
const fjalla = Fjalla_One({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['400'] })
const chakra = Chakra_Petch({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['700'], style: ['normal', 'italic'] })
const exo = Exo_2({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['800'], style: ['normal', 'italic'] })
const kanit = Kanit({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['800'], style: ['normal', 'italic'] })
const tourney = Tourney({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['800'], style: ['normal', 'italic'] })
const protest = Protest_Strike({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['400'] })
const stencil = Black_Ops_One({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['400'] })
const slab = Roboto_Slab({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['800'] })
const alfa = Alfa_Slab_One({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['400'] })
const serif = Playfair_Display({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['800'], style: ['normal', 'italic'] })
const cormorant = Cormorant_Garamond({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['700'], style: ['normal', 'italic'] })
const garamond = EB_Garamond({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['700'], style: ['normal', 'italic'] })
const yeseva = Yeseva_One({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['400'] })
const script = Dancing_Script({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['700'] })
const vibes = Great_Vibes({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['400'] })
const allura = Allura({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['400'] })
const pacifico = Pacifico({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['400'] })
const lobster = Lobster({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['400'] })
const graffiti = Sedgwick_Ave({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['400'] })
const brush = Protest_Revolution({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['400'] })
const bangers = Bangers({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['400'] })
const patrick = Patrick_Hand({ subsets: ['latin', 'vietnamese'], preload: false, display: 'swap', weight: ['400'] })

export const FONT_FAMILIES = registerFonts({
  montserrat: montserrat.style.fontFamily, inter: inter.style.fontFamily, lexend: lexend.style.fontFamily, unbounded: unbounded.style.fontFamily,
  impact: anton.style.fontFamily, dela: dela.style.fontFamily, paytone: paytone.style.fontFamily, sigmar: sigmar.style.fontFamily,
  bungee: bungee.style.fontFamily, bungee_shade: bungeeShade.style.fontFamily, rowdies: rowdies.style.fontFamily,
  condensed: oswald.style.fontFamily, athletic: barlow.style.fontFamily, saira: saira.style.fontFamily, roboto_c: robotoC.style.fontFamily,
  asap_c: asapC.style.fontFamily, fjalla: fjalla.style.fontFamily,
  tech: chakra.style.fontFamily, exo: exo.style.fontFamily, kanit: kanit.style.fontFamily, tourney: tourney.style.fontFamily,
  protest: protest.style.fontFamily, stencil: stencil.style.fontFamily,
  slab: slab.style.fontFamily, alfa: alfa.style.fontFamily, serif: serif.style.fontFamily, cormorant: cormorant.style.fontFamily,
  garamond: garamond.style.fontFamily, yeseva: yeseva.style.fontFamily,
  script: script.style.fontFamily, vibes: vibes.style.fontFamily, allura: allura.style.fontFamily, pacifico: pacifico.style.fontFamily,
  lobster: lobster.style.fontFamily, graffiti: graffiti.style.fontFamily, brush: brush.style.fontFamily, bangers: bangers.style.fontFamily,
  patrick: patrick.style.fontFamily,
})
