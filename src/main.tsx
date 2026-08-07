import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { toast } from 'sonner'
import './index.css'
import App from './App.tsx'

// apply saved theme before first paint
try {
  const saved = localStorage.getItem('edunova_theme')
  const dark = saved ? saved === 'dark' : window.matchMedia?.('(prefers-color-scheme: dark)').matches
  document.documentElement.classList.toggle('dark', !!dark)
} catch { /* ignore */ }

/* ── PWA: service worker registration + update flow ────── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // check for a new version every 30 minutes
      setInterval(() => reg.update(), 30 * 60 * 1000)

      reg.addEventListener('updatefound', () => {
        const worker = reg.installing
        if (!worker) return
        worker.addEventListener('statechange', () => {
          // new version ready & an old one is controlling the page
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            toast('A new version of EduNova is ready', {
              duration: Infinity,
              action: {
                label: 'Update',
                onClick: () => worker.postMessage({ type: 'SKIP_WAITING' }),
              },
            })
          }
        })
      })
    }).catch(() => { /* SW unsupported / blocked — app still works online */ })

    // reload once the new worker takes over
    let reloading = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return
      reloading = true
      window.location.reload()
    })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
