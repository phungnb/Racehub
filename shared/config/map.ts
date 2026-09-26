// Nền bản đồ (Leaflet). Mặc định: OpenStreetMap chuẩn — miễn phí, không cần khoá API
// (tôn trọng chính sách sử dụng: ghi nguồn, lượng dùng vừa phải). Giao diện tối bằng bộ lọc CSS `.map-dark`.
// Lên production nhiều người dùng: đặt NEXT_PUBLIC_MAP_TILES (vd MapTiler / Stadia / Mapbox có khoá của bạn)
// và NEXT_PUBLIC_MAP_ATTRIBUTION; NEXT_PUBLIC_MAP_TILES_DARK=1 nếu nền đã là màu tối (bỏ bộ lọc).
// Ghi chú: nền CARTO miễn phí trước đây nay đòi khoá API (hiện chữ "API KEY REQUIRED" trên bản đồ).

const custom = (process.env.NEXT_PUBLIC_MAP_TILES ?? '').trim()

export const MAP_TILES = {
  url: custom || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: (process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ?? '').trim()
    || '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  maxZoom: 19,
  /** Nền sáng → đảo màu thành tối cho hợp giao diện app */
  darken: custom ? process.env.NEXT_PUBLIC_MAP_TILES_DARK !== '1' && process.env.NEXT_PUBLIC_MAP_TILES_DARK !== 'true' : true,
} as const
