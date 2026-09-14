import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { ArrowRight, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { api, errorMessage } from '@/lib/api'
import { MIN_PASSWORD, passwordProblem } from '@/lib/hooks/useIdentity'
import { AuthError, AuthField, AuthShell, authInputCls } from './AuthShell'

/** `/reset?token=…` → `POST /auth/reset`. */
export default function Reset() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const problem = passwordProblem(next, confirm)
    if (problem) { setError(problem); return }
    setError('')
    setBusy(true)
    try {
      await api.post('/auth/reset', { token, newPassword: next })
      toast.success('Password reset — sign in with your new password')
      navigate('/login', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (!token) {
    return (
      <AuthShell title="Reset link missing" sub="This page needs the token from your reset email. Request a new link and open it from there.">
        <Link to="/forgot" className="btn-ink flex w-full items-center justify-center gap-2 py-3.5 text-[15px] font-semibold">Request a new link <ArrowRight size={17} /></Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Choose a new password" sub="Reset links work once and expire after a short while.">
      <form onSubmit={submit} className="space-y-4">
        <AuthField label={`New password (min ${MIN_PASSWORD} characters)`}>
          <input type="password" value={next} onChange={e => setNext(e.target.value)} required minLength={MIN_PASSWORD} autoFocus autoComplete="new-password" className={authInputCls} />
        </AuthField>
        <AuthField label="Confirm new password">
          <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required autoComplete="new-password" className={authInputCls} />
        </AuthField>
        <AuthError text={error} />
        <button type="submit" disabled={busy} className="btn-ink flex w-full items-center justify-center gap-2 py-3.5 text-[15px] font-semibold disabled:opacity-50">
          <KeyRound size={16} /> {busy ? 'Saving…' : 'Reset password'}
        </button>
        <p className="text-center text-[12.5px] text-black/45 dark:text-white/45">
          Link expired? <Link to="/forgot" className="font-semibold text-indigo-600 hover:underline">Request another</Link>
        </p>
      </form>
    </AuthShell>
  )
}
