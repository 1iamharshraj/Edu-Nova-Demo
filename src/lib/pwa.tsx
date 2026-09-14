import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { ArrowDownToLine, CheckCircle2, Share, Smartphone, X } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError, api, errorMessage } from './api'

/* ── install prompt hook ───────────────────────────────── */

interface BIPEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

declare global {
  interface Navigator { standalone?: boolean }
}

export function useInstall() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null)
  const [installed, setInstalled] = useState(false)

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const inStandalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: window-controls-overlay)').matches ||
    navigator.standalone === true

  useEffect(() => {
    setInstalled(inStandalone)
    const onPrompt = (e: Event) => { e.preventDefault(); setDeferred(e as BIPEvent) }
    const onInstalled = () => { setInstalled(true); setDeferred(null) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [inStandalone])

  const promptInstall = useCallback(async () => {
    if (!deferred) return 'unavailable'
    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    if (outcome === 'accepted') setDeferred(null)
    return outcome
  }, [deferred])

  return { canPrompt: !!deferred, isIOS, installed, promptInstall }
}

/* ── install modal (iOS guide / QR for other browsers) ─── */

export function InstallModal({ open, onClose, isIOS }: { open: boolean; onClose: () => void; isIOS: boolean }) {
  const [qr, setQr] = useState('')
  useEffect(() => {
    if (!open) return
    QRCode.toDataURL(window.location.origin, {
      width: 480, margin: 2,
      color: { dark: '#0b0b10', light: '#ffffff' },
    }).then(setQr).catch(() => setQr(''))
  }, [open])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center">
      <div className="fade-in absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="sheet-up relative w-full max-w-sm rounded-t-[2rem] bg-white dark:bg-[#12121c] p-6 pb-8 sm:rounded-[2rem] mega-panel">
        <div className="mb-4 flex items-center justify-between">
          <p className="font-display text-xl font-medium">Install EduNova</p>
          <button onClick={onClose} className="rounded-full bg-black/[.05] dark:bg-white/[.07] p-2 hover:bg-black/10 dark:hover:bg-white/15">
            <X size={16} />
          </button>
        </div>

        {isIOS ? (
          <div className="space-y-3">
            {[
              <>Tap the <Share size={15} className="inline text-sky-500" /> <b>Share</b> button in Safari’s toolbar.</>,
              <>Scroll down and tap <b>“Add to Home Screen”</b>.</>,
              <>Tap <b>Add</b> — EduNova will open like a native app.</>,
            ].map((step, i) => (
              <div key={i} className="flex items-start gap-3.5 rounded-2xl bg-black/[.04] dark:bg-white/[.06] p-4 text-[13.5px] leading-relaxed text-black/70 dark:text-white/70">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black text-[11px] font-bold text-white dark:bg-white dark:text-black">{i + 1}</span>
                <span>{step}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center">
            <p className="text-[13.5px] leading-relaxed text-black/55 dark:text-white/55">
              Scan with your phone to open EduNova, then choose <b>“Install app”</b> when the browser offers it.
            </p>
            <div className="mx-auto mt-4 w-fit rounded-3xl border border-black/[.07] dark:border-white/[.09] bg-white p-3 shadow-sm">
              {qr
                ? <img src={qr} alt="QR code to open EduNova" className="h-48 w-48 rounded-2xl" />
                : <div className="flex h-48 w-48 items-center justify-center text-black/30">…</div>}
            </div>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-[12px] font-medium text-black/40 dark:text-white/40">
              <Smartphone size={14} /> Opens installable on Android, iOS & desktop
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── install button ────────────────────────────────────── */

export function InstallButton({ variant = 'pill', className = '' }: { variant?: 'pill' | 'row'; className?: string }) {
  const { canPrompt, isIOS, installed, promptInstall } = useInstall()
  const [modal, setModal] = useState(false)
  const [done, setDone] = useState(false)

  if (installed) return null
  if (done) {
    return variant === 'pill' ? (
      <span className={`flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 px-4 py-2 text-[13px] font-semibold text-emerald-600 dark:text-emerald-400 ${className}`}>
        <CheckCircle2 size={14} /> Installed
      </span>
    ) : null
  }

  const click = async () => {
    if (canPrompt) {
      const outcome = await promptInstall()
      if (outcome === 'accepted') setDone(true)
      else if (outcome === 'unavailable') setModal(true)
    } else {
      setModal(true)
    }
  }

  return (
    <>
      {variant === 'pill' ? (
        <button onClick={click} aria-label="Install app"
          className={`flex items-center gap-1.5 rounded-full bg-black/[.06] dark:bg-white/[.08] px-4 py-2 text-[13px] font-semibold transition-colors hover:bg-black/10 dark:hover:bg-white/15 ${className}`}>
          <ArrowDownToLine size={14} /> <span className="hidden sm:inline">Install app</span>
        </button>
      ) : (
        <button onClick={click}
          className={`flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-fuchsia-600 py-3 text-[13.5px] font-semibold text-white shadow-lg shadow-indigo-500/25 transition-transform active:scale-[.98] ${className}`}>
          <ArrowDownToLine size={16} /> Install EduNova app
        </button>
      )}
      <InstallModal open={modal} onClose={() => setModal(false)} isIOS={isIOS && !canPrompt} />
    </>
  )
}

/* ── push notifications (Phase 9) ──────────────────────────
 * Reuses the service worker already registered by main.tsx (`/sw.js`) — this hook only asks it to subscribe
 * to a push endpoint via the browser's PushManager, using the VAPID public key the server hands out.
 * `POST /push/subscribe` persists the subscription; `DELETE /push/subscribe` drops it. See
 * .agents/edunova/phase-9-10-integrations-hardening.md. */

/** Converts a base64url VAPID public key (the format `web-push`/servers hand out) into the `Uint8Array` `PushManager.subscribe` expects. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64Safe)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export type PushState = 'checking' | 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed'

/**
 * Per-account push-notification preference. `state` reflects the browser's actual subscription (re-checked
 * on mount), so this stays correct across devices/reinstalls rather than trusting a stored flag.
 */
export function usePushNotifications() {
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  const [state, setState] = useState<PushState>(supported ? 'checking' : 'unsupported')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!supported) return
    let cancelled = false
    ;(async () => {
      try {
        if (Notification.permission === 'denied') { if (!cancelled) setState('denied'); return }
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        if (!cancelled) setState(sub ? 'subscribed' : 'unsubscribed')
      } catch { if (!cancelled) setState('unsupported') }
    })()
    return () => { cancelled = true }
  }, [supported])

  const subscribe = useCallback(async () => {
    if (!supported || busy) return
    setBusy(true)
    try {
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
      if (permission !== 'granted') { setState('denied'); return }
      let key: string | undefined
      try {
        const keyRes = await api.get<{ key?: string; publicKey?: string } | string>('/push/vapid-public-key')
        key = typeof keyRes === 'string' ? keyRes : (keyRes.key ?? keyRes.publicKey)
      } catch (e) {
        // The server doesn't expose a VAPID key endpoint yet in this environment — friendly disabled
        // state rather than a raw 404 toast (see final report: this is a noted server-shape gap).
        if (e instanceof ApiError && e.status === 404) { toast.error('Push notifications aren’t set up on the server yet.'); return }
        throw e
      }
      if (!key) { toast.error('Push notifications aren’t set up on the server yet.'); return }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) })
      await api.post('/push/subscribe', sub.toJSON())
      setState('subscribed')
      toast.success('Notifications enabled on this device')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }, [supported, busy])

  const unsubscribe = useCallback(async () => {
    if (!supported || busy) return
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await api.del('/push/subscribe', { endpoint: sub.endpoint }).catch(() => { /* best-effort server cleanup */ })
        await sub.unsubscribe()
      }
      setState('unsubscribed')
      toast.success('Notifications turned off on this device')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }, [supported, busy])

  return { state, busy, supported, subscribe, unsubscribe }
}

/** Small settings-style row for the Profile screen: toggles this device's push subscription. */
export function PushToggle() {
  const { state, busy, supported, subscribe, unsubscribe } = usePushNotifications()

  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl bg-black/[.03] dark:bg-white/[.05] px-4 py-3.5">
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold">Push notifications</p>
        <p className="mt-0.5 text-[12px] text-black/50 dark:text-white/50">
          {!supported && 'Not supported in this browser.'}
          {supported && state === 'checking' && 'Checking…'}
          {supported && state === 'denied' && 'Blocked — allow notifications for this site in your browser settings.'}
          {supported && state === 'subscribed' && 'Enabled on this device.'}
          {supported && state === 'unsubscribed' && 'Get notified here for messages, approvals and alerts.'}
        </p>
      </div>
      {supported && state !== 'denied' && (
        <button
          onClick={() => (state === 'subscribed' ? unsubscribe() : subscribe())}
          disabled={busy || state === 'checking'}
          className={`shrink-0 rounded-full px-4 py-2 text-[12.5px] font-semibold transition disabled:opacity-50 ${
            state === 'subscribed'
              ? 'bg-black/[.06] dark:bg-white/[.08] hover:bg-black/10 dark:hover:bg-white/15'
              : 'bg-black text-white hover:bg-black/85 dark:bg-white dark:text-black dark:hover:bg-white/85'
          }`}
        >
          {busy ? 'Working…' : state === 'subscribed' ? 'Disable' : 'Enable'}
        </button>
      )}
    </div>
  )
}
