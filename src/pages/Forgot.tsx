import { useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, MailCheck } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { AuthError, AuthField, AuthShell, authInputCls } from './AuthShell'

/** Turns the server's dev reset URL into an in-app path when it points at this origin, else keeps it as-is. */
function resetLink(url: string): { to: string; external: boolean } {
  try {
    const u = new URL(url, window.location.origin)
    if (u.origin === window.location.origin) return { to: u.pathname + u.search, external: false }
    return { to: url, external: true }
  } catch {
    return { to: url, external: true }
  }
}

/** `POST /auth/forgot` — always answers 200; in development the server also returns the reset link so the demo needs no mailbox. */
export default function Forgot() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [devUrl, setDevUrl] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const res = await api.post<{ devResetUrl?: string }>('/auth/forgot', { email })
      setDevUrl(res?.devResetUrl ?? '')
      setSent(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    const link = devUrl ? resetLink(devUrl) : null
    return (
      <AuthShell title="Check your inbox" sub={`If ${email} belongs to an EduNova account, a reset link is on its way. It expires after a short while.`}>
        <div className="flex items-center gap-3 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 p-4 text-[13.5px] text-emerald-800 dark:text-emerald-300">
          <MailCheck size={20} className="shrink-0" /> Request received.
        </div>
        {link && (
          <div className="mt-4 rounded-2xl border border-dashed border-indigo-300 dark:border-indigo-500/40 bg-indigo-50/60 dark:bg-indigo-500/10 p-4">
            <p className="text-[12px] font-semibold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">Development mode</p>
            <p className="mt-1 text-[13px] text-black/60 dark:text-white/60">No mail is sent locally — use the link the server returned:</p>
            {link.external
              ? <a href={link.to} className="mt-2 block break-all text-[13.5px] font-semibold text-indigo-600 underline-offset-2 hover:underline">{link.to}</a>
              : <Link to={link.to} className="btn-ink mt-3 flex w-full items-center justify-center gap-2 py-3 text-[14px] font-semibold">Open reset link <ArrowRight size={16} /></Link>}
          </div>
        )}
        <Link to="/login" className="mt-5 block text-center text-[13px] font-medium text-black/45 dark:text-white/45 hover:text-black dark:hover:text-white">Back to sign in</Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Forgot your password?" sub="Enter the email on your EduNova account and we’ll send a link to choose a new one.">
      <form onSubmit={submit} className="space-y-4">
        <AuthField label="Email">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus autoComplete="email" className={authInputCls} />
        </AuthField>
        <AuthError text={error} />
        <button type="submit" disabled={busy || !email} className="btn-ink flex w-full items-center justify-center gap-2 py-3.5 text-[15px] font-semibold disabled:opacity-50">
          {busy ? 'Sending…' : 'Send reset link'} {!busy && <ArrowRight size={17} />}
        </button>
      </form>
    </AuthShell>
  )
}
