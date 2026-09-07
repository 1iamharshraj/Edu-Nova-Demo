import { useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowRight, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { api, errorMessage } from '@/lib/api'
import { MIN_PASSWORD, passwordProblem } from '@/lib/hooks/useIdentity'
import { AuthError, AuthField, AuthShell, authInputCls } from './AuthShell'

/** Forced password change: `App.tsx` routes here whenever `user.mustChangePassword` (new accounts, admin resets). */
export default function ChangePassword() {
  const { user, refreshMe, logout } = useStore()
  const navigate = useNavigate()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const problem = passwordProblem(next, confirm)
    if (problem) { setError(problem); return }
    if (next === current) { setError('Pick a password different from the current one.'); return }
    setError('')
    setBusy(true)
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next })
      await refreshMe()
      toast.success('Password updated')
      navigate('/portal', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Set a new password" back={null}
      sub={user?.mustChangePassword ? `Hi ${user.name.split(' ')[0]} — this account uses a temporary password. Choose your own before continuing.` : 'Choose a new password for your account.'}>
      <form onSubmit={submit} className="space-y-4">
        <AuthField label="Current (temporary) password">
          <input type="password" value={current} onChange={e => setCurrent(e.target.value)} required autoComplete="current-password" className={authInputCls} />
        </AuthField>
        <AuthField label={`New password (min ${MIN_PASSWORD} characters)`}>
          <input type="password" value={next} onChange={e => setNext(e.target.value)} required minLength={MIN_PASSWORD} autoComplete="new-password" className={authInputCls} />
        </AuthField>
        <AuthField label="Confirm new password">
          <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required autoComplete="new-password" className={authInputCls} />
        </AuthField>
        <AuthError text={error} />
        <button type="submit" disabled={busy} className="btn-ink flex w-full items-center justify-center gap-2 py-3.5 text-[15px] font-semibold disabled:opacity-50">
          <KeyRound size={16} /> {busy ? 'Saving…' : 'Save and continue'} {!busy && <ArrowRight size={17} />}
        </button>
        <button type="button" onClick={() => { logout(); navigate('/login') }} className="w-full text-center text-[13px] font-medium text-black/45 dark:text-white/45 hover:text-black dark:hover:text-white">
          Sign out instead
        </button>
      </form>
    </AuthShell>
  )
}
