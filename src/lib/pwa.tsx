import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { ArrowDownToLine, CheckCircle2, Share, Smartphone, X } from 'lucide-react'

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
