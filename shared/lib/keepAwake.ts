// Giữ màn hình sáng khi ghi bài chạy trên trình duyệt (GPS web dừng khi màn hình tắt).
// Lớp 1: Screen Wake Lock API (Chrome/Android, Safari iOS 16.4+), tự xin lại khi bị nhả.
// Lớp 2 (iPhone / máy không có Wake Lock): phát video câm lặp vô hạn — iOS không tự khoá màn hình khi đang phát video
// (kỹ thuật NoSleep; bắt buộc gọi trong thao tác bấm của người dùng). App cài không cần: GPS chạy nền.

type Sentinel = { release: () => Promise<void>; addEventListener?: (t: 'release', f: () => void) => void }

let wanted = false
let sentinel: Sentinel | null = null
let video: HTMLVideoElement | null = null

const isIOS = () => typeof navigator !== 'undefined'
  && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

async function requestLock() {
  const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Sentinel> } }).wakeLock
  if (!wl || document.visibilityState !== 'visible') return false
  try {
    sentinel = await wl.request('screen')
    sentinel.addEventListener?.('release', () => {
      sentinel = null
      if (wanted && document.visibilityState === 'visible') void requestLock()
    })
    return true
  } catch { return false }
}

function playVideo() {
  if (!video) {
    video = document.createElement('video')
    video.setAttribute('playsinline', '')
    video.setAttribute('webkit-playsinline', '')
    video.muted = true
    video.loop = true
    video.src = '/media/keep-awake.mp4'
    Object.assign(video.style, { position: 'fixed', width: '1px', height: '1px', opacity: '0.01', pointerEvents: 'none', left: '0', top: '0' })
    document.body.appendChild(video)
  }
  void video.play().catch(() => undefined)
}

/** Bật giữ màn hình. GỌI NGAY trong sự kiện bấm (không sau await) để iOS cho phép phát video. */
export function keepAwake(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  wanted = true
  const hasWakeLock = 'wakeLock' in navigator
  if (isIOS() || !hasWakeLock) playVideo()           // iPhone: chạy song song vì Wake Lock trên PWA iOS cũ không ổn định
  return requestLock().then((ok) => ok || !!video)
}

/** Quay lại app (hiện màn hình): xin lại khoá + phát tiếp video */
export function reacquireAwake() {
  if (!wanted) return
  if (!sentinel) void requestLock()
  if (video) void video.play().catch(() => undefined)
}

export function releaseAwake() {
  wanted = false
  sentinel?.release().catch(() => undefined)
  sentinel = null
  if (video) { video.pause(); video.remove(); video = null }
}
