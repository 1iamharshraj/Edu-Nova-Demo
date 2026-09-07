import React, { useEffect, useState } from 'react'
import { CheckCircle2, Clock3, CloudUpload, FileText, ShieldCheck, X } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { api, errorMessage, uploadFile } from '@/lib/api'
import { useMyVerification } from '@/lib/hooks/useIdentity'
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

/** Initials on a hue gradient, or the profile photo when `src` (an object URL from `useFileUrl`) is given. */
export function Avatar({ name, hue = 262, size = 40, src }: { name: string; hue?: number; size?: number; src?: string }) {
  const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('')
  return (
    <span className="flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.36, background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${hue + 40} 75% 60%))` }}>
      {src ? <img src={src} alt={name} className="h-full w-full object-cover" /> : initials}
    </span>
  )
}

/* ── file upload field ─────────────────────────────────── */

export interface UploadedFile { id: string; name: string }

/**
 * Picks files and uploads them straight away via `POST /files`; the caller only ever sees stored file ids.
 * Single-file mode replaces the previous pick.
 */
export function UploadField({ files, onChange, accept, multiple = false, label, hint }: {
  files: UploadedFile[]; onChange: (files: UploadedFile[]) => void; accept?: string; multiple?: boolean; label?: string; hint?: string
}) {
  const [busy, setBusy] = useState(false)
  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!picked.length) return
    setBusy(true)
    try {
      const stored: UploadedFile[] = []
      for (const f of picked) {
        const rec = await uploadFile(f)
        stored.push({ id: rec.id, name: rec.name || f.name })
      }
      onChange(multiple ? [...files, ...stored] : stored.slice(-1))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      <label className={`flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed border-black/15 dark:border-white/15 py-6 text-black/40 dark:text-white/40 transition hover:border-indigo-300 hover:text-indigo-500 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
        <CloudUpload size={24} />
        <span className="mt-2 text-[13px] font-medium">{busy ? 'Uploading…' : label ?? (multiple ? 'Add documents' : 'Choose a file')}</span>
        {hint && <span className="mt-0.5 text-[11.5px]">{hint}</span>}
        <input type="file" className="hidden" accept={accept} multiple={multiple} onChange={pick} disabled={busy} />
      </label>
      {files.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {files.map(f => (
            <li key={f.id} className="flex items-center gap-2 rounded-xl bg-black/[.04] dark:bg-white/[.06] px-3 py-2 text-[13px]">
              <FileText size={14} className="shrink-0 text-black/40 dark:text-white/40" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <button type="button" onClick={() => onChange(files.filter(x => x.id !== f.id))} className="rounded-full p-1 text-black/40 hover:bg-black/10 hover:text-black dark:text-white/40 dark:hover:bg-white/15 dark:hover:text-white" aria-label={`Remove ${f.name}`}>
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-black/15 dark:border-white/15 py-10 text-center text-[14px] text-black/40 dark:text-white/40">{text}</div>
}

/* ── Parent verification (document review by the office) ── */

/**
 * The parent's verification state as a card: upload an ID document → Pending → the office approves or rejects
 * (Verifications module). Once the record is Verified the store's `user.verified` is refreshed and `onVerified` fires.
 */
export function VerificationCard({ onVerified, compact = false }: { onVerified?: () => void; compact?: boolean }) {
  const { user, refreshMe } = useStore()
  const isParent = user?.role === 'parent'
  const { record, loading, reload } = useMyVerification(isParent && !user?.verified)
  const [doc, setDoc] = useState<UploadedFile[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (record?.status === 'Verified' && user && !user.verified) {
      refreshMe().then(() => onVerified?.())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.status])

  if (!user || !isParent) return null
  if (user.verified) {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 p-4 text-[13.5px] text-emerald-800 dark:text-emerald-300">
        <CheckCircle2 size={20} className="shrink-0" /> Your identity is verified. Slip approvals and e-signatures are unlocked.
      </div>
    )
  }
  if (loading || record === undefined) return <p className="py-4 text-center text-[13px] text-black/40 dark:text-white/40">Checking verification status…</p>

  if (record?.status === 'Pending') {
    return (
      <div className="flex items-start gap-3 rounded-2xl bg-amber-50 dark:bg-amber-500/10 p-4 text-[13.5px] text-amber-800 dark:text-amber-300">
        <Clock3 size={20} className="mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold">Verification pending</p>
          <p className="mt-0.5 leading-relaxed">The school office is reviewing your {record.method === 'Document' ? 'ID document' : 'request'}. You’ll be able to approve slips and e-sign once it’s confirmed.</p>
          <button onClick={reload} className="mt-2 text-[12.5px] font-semibold underline-offset-2 hover:underline">Check again</button>
        </div>
      </div>
    )
  }

  const submit = async () => {
    setBusy(true)
    try {
      await api.post('/verification/me', { method: 'Document', documentFileId: doc[0]?.id })
      setDoc([])
      reload()
      toast.success('Document sent — the office will review it')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {record?.status === 'Rejected' && (
        <div className="rounded-2xl bg-rose-50 dark:bg-rose-500/10 p-3.5 text-[13px] text-rose-700 dark:text-rose-300">
          <p className="font-semibold">Your previous document was not accepted.</p>
          {record.note && <p className="mt-0.5">{record.note}</p>}
          <p className="mt-0.5">Upload a clearer copy to try again.</p>
        </div>
      )}
      {!compact && (
        <p className="text-[13.5px] leading-relaxed text-black/60 dark:text-white/60">
          Sensitive actions — approving permission slips, e-signing records, leave requests — need a verified parent.
          Upload a government ID (Aadhaar, passport, driving licence) and the school office will confirm it.
        </p>
      )}
      <UploadField files={doc} onChange={setDoc} accept=".pdf,.png,.jpg,.jpeg" label="Upload an ID document" hint="PDF, PNG or JPG · up to 10 MB" />
      <button disabled={!doc.length || busy} onClick={submit} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">
        {busy ? 'Sending…' : 'Submit for verification'}
      </button>
    </div>
  )
}

/**
 * Gate for sensitive parent actions. Renders nothing once `user.verified`; otherwise a button that opens the
 * verification card (or shows "Verification pending" while the office reviews). `onVerified` fires when the
 * record turns Verified — callers keep the same props they used with the old simulated flow.
 */
export function VerifyButton({ label, onVerified, className = '' }: { label: string; onVerified: () => void; className?: string }) {
  const { user } = useStore()
  const [open, setOpen] = useState(false)
  const { record } = useMyVerification(user?.role === 'parent' && !user?.verified)
  if (!user || user.verified) return null
  const pending = record?.status === 'Pending'
  return (
    <>
      <button onClick={() => setOpen(true)}
        className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-[13.5px] font-semibold transition ${pending ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30' : 'bg-amber-500 text-white hover:bg-amber-600'} ${className}`}>
        {pending ? <Clock3 size={16} /> : <ShieldCheck size={16} />} {pending ? 'Verification pending' : user.role === 'parent' ? label : 'Verification required'}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Parent verification">
        {user.role === 'parent'
          ? <VerificationCard onVerified={() => { setOpen(false); onVerified() }} />
          : <p className="text-[14px] text-black/60 dark:text-white/60">Only a verified parent account can do this.</p>}
      </Modal>
    </>
  )
}
