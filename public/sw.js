/* ─────────────────────────────────────────────────────────
   EduNova Service Worker
   Strategy:
   · Precache app shell + offline page (versioned cache)
   · Cache-first  → hashed static assets (/assets/), icons
   · Stale-while-revalidate → fonts & manifest
   · Network-first → navigations & everything else,
     falling back to cache / offline page when offline
   · Old caches pruned on activate; instant update via
     SKIP_WAITING message from the registration script.
   ───────────────────────────────────────────────────────── */

const VERSION = 'edunova-pwa-v1'
const SHELL_CACHE = `${VERSION}-shell`
const RUNTIME_CACHE = `${VERSION}-runtime`
const FONT_CACHE = `${VERSION}-fonts`

const SHELL = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-192.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL))
  )
  // NOTE: no skipWaiting here — the page asks the user to update,
  // then posts SKIP_WAITING (see registration script).
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => ![SHELL_CACHE, RUNTIME_CACHE, FONT_CACHE].includes(k))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) {
    const cache = await caches.open(RUNTIME_CACHE)
    cache.put(request, response.clone())
  }
  return response
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(FONT_CACHE)
  const cached = await cache.match(request)
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone())
      return response
    })
    .catch(() => cached)
  return cached || network
}

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) cache.put(request, response.clone())
    return response
  } catch {
    const cached = await cache.match(request)
    if (cached) return cached
    throw new Error('offline')
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // 1) Page navigations → network-first, then cached shell, then offline page
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(RUNTIME_CACHE).then((c) => c.put('/index.html', copy))
          return response
        })
        .catch(async () => {
          const cached = await caches.match('/index.html')
          return cached || caches.match('/offline.html')
        })
    )
    return
  }

  // 2) Same-origin hashed build assets & icons → cache-first
  if (url.origin === self.location.origin &&
      (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname.startsWith('/screenshots/'))) {
    event.respondWith(cacheFirst(request))
    return
  }

  // 3) Google Fonts → stale-while-revalidate
  if (url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request))
    return
  }

  // 4) Everything else same-origin → network-first with cache fallback
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request))
  }
})
