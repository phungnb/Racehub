/* RaceHub service worker — khung offline + Web Push.
 * Không cache trang/HTML hay dữ liệu API (luôn lấy mới); chỉ cache tệp tĩnh có hash của Next
 * và trang offline để khi mất mạng vẫn mở được app và thấy thông báo rõ ràng. */
const VERSION = 'rh-v6'   // tăng khi đổi icon / trang offline để máy người dùng lấy bản mới
const STATIC = `${VERSION}-static`
const OFFLINE_URL = '/offline.html'
const PRECACHE = [OFFLINE_URL, '/icons/rh5-icon-192.png', '/icons/rh5-badge-96.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // Trang: luôn lấy từ mạng; mất mạng thì hiện trang offline
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error()))
    return
  }
  // Tệp tĩnh có hash (không bao giờ đổi nội dung): lấy cache trước
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || url.pathname.startsWith('/character/')) {
    event.respondWith((async () => {
      const hit = await caches.match(req)
      if (hit) return hit
      const res = await fetch(req)
      if (res.ok) { const c = await caches.open(STATIC); c.put(req, res.clone()) }
      return res
    })())
  }
})

// ---------------------------------------------------------------- Web Push
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { title: 'RaceHub', body: event.data && event.data.text() } }
  const title = data.title || 'RaceHub'
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icons/rh5-icon-192.png',
      badge: '/icons/rh5-badge-96.png',
      tag: data.tag || undefined,
      renotify: !!data.tag,
      data: { url: data.url || '/notifications' },
      vibrate: [80, 40, 80],
      lang: 'vi',
    }),
    // Số trên biểu tượng app (Android/desktop hỗ trợ)
    typeof data.unread === 'number' && self.navigator.setAppBadge ? self.navigator.setAppBadge(data.unread).catch(() => {}) : null,
  ]))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL((event.notification.data && event.notification.data.url) || '/notifications', self.location.origin).href
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const win = wins.find((w) => new URL(w.url).origin === self.location.origin)
    if (win) {
      await win.focus()
      return win.navigate ? win.navigate(target).catch(() => win.postMessage({ type: 'navigate', url: target })) : undefined
    }
    return self.clients.openWindow(target)
  })())
})

// Trình duyệt đổi khóa đăng ký push (hiếm): báo trang mở gần nhất đăng ký lại
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then((ws) => ws.forEach((w) => w.postMessage({ type: 'push-resubscribe' }))))
})
