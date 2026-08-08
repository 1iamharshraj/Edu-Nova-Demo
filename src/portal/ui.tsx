import React, { useEffect, useState } from 'react'
import { CheckCircle2, Fingerprint, ScanFace, ShieldCheck, X } from 'lucide-react'
import { useStore } from '@/lib/store'
import type { Term } from '@/lib/data'

/* ── layout primitives ─────────────────────────────────── */

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-[clamp(1.6rem,3vw,2.2rem)] font-medium tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-[14px] text-black/50 dark:text-white/50">{sub}</p>}
      </div>
      {children}
    </div>
  )
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-3xl border border-black/[.06] dark:border-white/[.08] bg-white dark:bg-[#14141f] p-6 ${className}`}>{children}</div>
}

export function Pill({ tone, children }: { tone: 'green' | 'amber' | 'rose' | 'slate' | 'indigo' | 'sky'; children: React.ReactNode }) {
  const map = {
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200',
    rose: 'bg-rose-50 text-rose-600 ring-rose-200',
    slate: 'bg-black/[.05] dark:bg-white/[.07] text-black/60 dark:text-white/60 ring-black/10 dark:ring-white/15',
    indigo: 'bg-indigo-50 text-indigo-600 ring-indigo-200',
    sky: 'bg-sky-50 text-sky-600 ring-sky-200',
  }
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ring-1 ${map[tone]}`}>{children}</span>
}

// eslint-disable-next-line react-refresh/only-export-components
export function statusTone(s: string): 'green' | 'amber' | 'rose' | 'slate' {
  if (['Approved', 'Paid', 'Graded', 'Submitted', 'Done'].includes(s)) return 'green'
  if (['Pending', 'Due', 'Assigned'].includes(s)) return 'amber'
  if (['Declined', 'Late'].includes(s)) return 'rose'
  return 'slate'
}

export function TermTabs({ terms, term, setTerm }: { terms: Term[]; term: string; setTerm: (t: string) => void }) {
  return (
    <div className="inline-flex rounded-full border border-black/[.08] dark:border-white/[.10] bg-white dark:bg-[#14141f] p-1">
      {terms.map((t) => (
        <button key={t.id} onClick={() => setTerm(t.id)}
          className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-all ${term === t.id ? 'bg-black text-white shadow' : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'}`}>
          {t.name}{t.current ? ' ·' : ''}
        </button>
      ))}
    </div>
  )
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    if (open) window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`mega-in relative max-h-[85vh] w-full overflow-y-auto rounded-3xl bg-white dark:bg-[#14141f] p-6 shadow-2xl thin-scroll ${wide ? 'max-w-2xl' : 'max-w-md'}`}>
        <div className="mb-4 flex items-center justify-between">
          <p className="font-display text-xl font-medium">{title}</p>
          <button onClick={onClose} className="rounded-full bg-black/[.05] dark:bg-white/[.07] p-2 hover:bg-black/10 dark:hover:bg-white/15"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[13px] font-semibold text-black/60 dark:text-white/60">{label}</span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  )
}

export const inputCls = 'w-full rounded-xl border border-black/10 dark:border-white/15 bg-white dark:bg-[#14141f] px-4 py-2.5 text-[14.5px] outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100'

export function Progress({ pct, color = '#6366f1' }: { pct: number; color?: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.08]">
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
    </div>
  )
}

export function Avatar({ name, hue = 262, size = 40 }: { name: string; hue?: number; size?: number }) {
  const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('')
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.36, background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${hue + 40} 75% 60%))` }}>
      {initials}
    </span>
  )
}

export function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-black/15 dark:border-white/15 py-10 text-center text-[14px] text-black/40 dark:text-white/40">{text}</div>
}

/* ── Parent Verify (Aadhaar + face, simulated) ─────────── */

export function VerifyButton({ label, onVerified, className = '' }: { label: string; onVerified: () => void; className?: string }) {
  const { user, db, update } = useStore()
  const verified = user?.verified
  const [open, setOpen] = useState(false)
  const [stage, setStage] = useState<'aadhaar' | 'face' | 'done'>('aadhaar')
  const [otp, setOtp] = useState('')

  useEffect(() => {
    if (!open) return
    if (stage === 'face') {
      const t = setTimeout(() => setStage('done'), 2200)
      return () => clearTimeout(t)
    }
    if (stage === 'done') {
      const t = setTimeout(() => {
        update((d) => { d.users = d.users.map(u => u.id === user?.id ? { ...u, verified: true } : u); return d })
        setOpen(false); setStage('aadhaar'); setOtp('')
        onVerified()
      }, 1300)
      return () => clearTimeout(t)
    }
  }, [stage, open]) // eslint-disable-line

  const parentName = user?.name ?? 'parent'
  const mobileEnding = user?.phone?.slice(-2) ?? '23'

  if (verified) return null
  void db
  return (
    <>
      <button onClick={() => setOpen(true)} className={`flex items-center gap-2 rounded-full bg-amber-500 px-5 py-2.5 text-[13.5px] font-semibold text-white transition hover:bg-amber-600 ${className}`}>
        <ShieldCheck size={16} /> {label}
      </button>
      <Modal open={open} onClose={() => { setOpen(false); setStage('aadhaar') }} title="Parent Verify">
        {stage === 'aadhaar' && (
          <div className="space-y-4">
            <p className="text-[14px] leading-relaxed text-black/60 dark:text-white/60">
              Sensitive actions need the actual parent. Enter the OTP sent to the Aadhaar-linked mobile ending <b>••{mobileEnding}</b>.
            </p>
            <div className="flex items-center gap-2 rounded-2xl bg-black/[.04] dark:bg-white/[.06] p-4">
              <Fingerprint size={22} className="text-indigo-600" />
              <span className="text-[13.5px] text-black/60 dark:text-white/60">Aadhaar XXXX-XXXX-4821 · {parentName}</span>
            </div>
            <input value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="Enter any 4+ digit OTP (demo)"
              className={inputCls} maxLength={6} inputMode="numeric" />
            <button disabled={otp.length < 4} onClick={() => setStage('face')}
              className="btn-ink w-full py-3 text-[14.5px] font-semibold disabled:opacity-40">Verify OTP</button>
          </div>
        )}
        {stage === 'face' && (
          <div className="flex flex-col items-center py-6 text-center">
            <div className="relative flex h-28 w-28 items-center justify-center rounded-full bg-indigo-50">
              <ScanFace size={52} className="animate-pulse text-indigo-600" />
              <span className="absolute inset-0 animate-ping rounded-full border-2 border-indigo-300" />
            </div>
            <p className="mt-5 text-[15px] font-semibold">Scanning face…</p>
            <p className="mt-1 text-[13px] text-black/50 dark:text-white/50">Matching against enrolled parent biometric</p>
          </div>
        )}
        {stage === 'done' && (
          <div className="flex flex-col items-center py-6 text-center">
            <CheckCircle2 size={56} className="text-emerald-500" />
            <p className="mt-4 text-[16px] font-semibold">Identity verified</p>
            <p className="mt-1 text-[13px] text-black/50 dark:text-white/50">Parent access unlocked for this session</p>
          </div>
        )}
      </Modal>
    </>
  )
}
