import { useMemo, useState } from 'react'
import { Camera, KeyRound, Save, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAcademic, useStore } from '@/lib/store'
import { api, errorMessage, uploadFile } from '@/lib/api'
import type { BandAffinity, BandLevel } from '@/lib/data'
import { MIN_PASSWORD, fmtDateTime, passwordProblem, useFileUrl } from '@/lib/hooks/useIdentity'
import { PushToggle } from '@/lib/pwa'
import { Avatar, Card, Field, PageHead, Pill, VerificationCard, inputCls } from '../ui'
import { EmploymentHistoryTimeline, IdCardButton } from './employee'

// Profile screen (every role): self-service edits via PATCH /users/me, photo upload, password change,
// and a read-only view of the wards / classes the account is linked to. See phase-4-admissions-identity.md

const sectionHead = (text: string) => <p className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">{text}</p>

const BAND_LEVELS: { value: BandLevel; label: string }[] = [
  { value: 'NONE', label: 'Not declared' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'STRONG', label: 'Strong' },
]
const BAND_FIELDS: { key: keyof BandAffinity; label: string; hint: string }[] = [
  { key: 'support', label: 'Support band', hint: 'Students who need extra reinforcement' },
  { key: 'mid', label: 'Mid band', hint: 'The broad middle of a class' },
  { key: 'advanced', label: 'Advanced band', hint: 'Stretch/high-achiever groups' },
]

export function ProfileMod() {
  const { user, db, refreshMe, refreshDB } = useStore()
  const { classOf, wardsOf, classesTaughtBy, enrollments, currentYear } = useAcademic()
  const [form, setForm] = useState(() => ({
    name: user?.name ?? '', phone: user?.phone ?? '', dob: user?.dob ?? '', address: user?.address ?? '', emergencyContact: user?.emergencyContact ?? '',
  }))
  const [saving, setSaving] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [pwBusy, setPwBusy] = useState(false)
  const photoUrl = useFileUrl(user?.photoFileId)

  // Phase T1 §4 — teacher band affinity self-service (roadmap D2 groundwork for T5's Mode 4 optimizer).
  // Only `declaredBandAffinity` is ever writable here; `verifiedBandAffinity` stays null until the future
  // T11 evaluation engine populates it — no UI for it exists yet, by design.
  const defaultBand: BandAffinity = { support: 'NONE', mid: 'NONE', advanced: 'NONE' }
  const [bandForm, setBandForm] = useState<BandAffinity>(() => user?.declaredBandAffinity ?? defaultBand)
  const [bandBusy, setBandBusy] = useState(false)
  const bandDirty = JSON.stringify(bandForm) !== JSON.stringify(user?.declaredBandAffinity ?? defaultBand)
  const saveBand = async () => {
    setBandBusy(true)
    try {
      await api.patch('/users/me/band-affinity', { declaredBandAffinity: bandForm })
      await refreshMe()
      toast.success('Band affinity updated')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBandBusy(false) }
  }

  const links = useMemo(() => {
    if (!user) return []
    const label = (studentId: string) => {
      const c = classOf(studentId)
      const roll = enrollments.find(e => e.studentId === studentId && e.status === 'active' && (!currentYear || e.academicYearId === currentYear.id))?.rollNo
      return [c?.label, roll ? `Roll ${roll}` : undefined].filter(Boolean).join(' · ') || 'Not enrolled yet'
    }
    if (user.role === 'student') return [{ id: user.id, title: 'My class', sub: label(user.id) }]
    if (user.role === 'parent') {
      return wardsOf(user.id).map(id => {
        const s = db.users.find(u => u.id === id)
        return { id, title: s?.name ?? 'Student', sub: label(id) }
      })
    }
    if (user.role === 'teacher') {
      return classesTaughtBy(user.id).map(c => ({ id: c.id, title: c.label, sub: c.classTeacherId === user.id ? 'Class teacher' : 'Subject teacher' }))
    }
    return []
  }, [user, db.users, classOf, wardsOf, classesTaughtBy, enrollments, currentYear])

  if (!user) return null
  const isStudent = user.role === 'student'
  const isEmployee = user.role === 'teacher' || user.role === 'staff' || user.role === 'admin' || user.role === 'superadmin'
  const managerName = user.reportsTo ? (db.users.find(u => u.id === user.reportsTo)?.name ?? user.reportsTo) : undefined
  const dirty = form.name !== (user.name ?? '') || form.phone !== (user.phone ?? '') || form.dob !== (user.dob ?? '') || form.address !== (user.address ?? '') || form.emergencyContact !== (user.emergencyContact ?? '')

  const save = async () => {
    setSaving(true)
    try {
      const body: Record<string, string | undefined> = {
        phone: form.phone.trim() || undefined, dob: form.dob || undefined, address: form.address.trim() || undefined, emergencyContact: form.emergencyContact.trim() || undefined,
      }
      if (!isStudent && form.name.trim()) body.name = form.name.trim()
      await api.patch('/users/me', body)
      await Promise.all([refreshMe(), refreshDB()])
      toast.success('Profile updated')
    } catch (e) { toast.error(errorMessage(e)) } finally { setSaving(false) }
  }

  const setPhoto = async (file?: File | null) => {
    setPhotoBusy(true)
    try {
      const photoFileId = file ? (await uploadFile(file)).id : null
      await api.patch('/users/me', { photoFileId })
      await Promise.all([refreshMe(), refreshDB()])
      toast.success(file ? 'Photo updated' : 'Photo removed')
    } catch (e) { toast.error(errorMessage(e)) } finally { setPhotoBusy(false) }
  }

  const changePassword = async () => {
    const problem = passwordProblem(pw.next, pw.confirm)
    if (problem) { toast.error(problem); return }
    setPwBusy(true)
    try {
      await api.post('/auth/change-password', { currentPassword: pw.current, newPassword: pw.next })
      setPw({ current: '', next: '', confirm: '' })
      await refreshMe()
      toast.success('Password changed')
    } catch (e) { toast.error(errorMessage(e)) } finally { setPwBusy(false) }
  }

  return (
    <div>
      <PageHead title="My Profile" sub="Your account details, photo and password" />
      <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-5">
          <Card className="flex flex-col items-center text-center">
            <Avatar name={user.name} hue={user.avatarHue} size={112} src={photoUrl} />
            <p className="mt-4 text-[18px] font-semibold">{user.name}</p>
            <p className="text-[13.5px] text-black/50 dark:text-white/50">{user.title}</p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <Pill tone="indigo"><span className="capitalize">{user.role}</span></Pill>
              {user.role === 'parent' && (user.verified ? <Pill tone="green"><ShieldCheck size={12} /> verified</Pill> : <Pill tone="amber"><ShieldCheck size={12} /> unverified</Pill>)}
            </div>
            <div className="mt-5 flex gap-2">
              <label className={`flex cursor-pointer items-center gap-2 rounded-full border border-black/10 dark:border-white/15 px-4 py-2 text-[13px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06] ${photoBusy ? 'pointer-events-none opacity-50' : ''}`}>
                <Camera size={14} /> {photoBusy ? 'Uploading…' : user.photoFileId ? 'Change photo' : 'Add photo'}
                <input type="file" accept="image/png,image/jpeg" className="hidden" disabled={photoBusy} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setPhoto(f) }} />
              </label>
              {user.photoFileId && (
                <button onClick={() => setPhoto(null)} disabled={photoBusy} className="flex items-center gap-1.5 rounded-full bg-rose-50 dark:bg-rose-500/10 px-4 py-2 text-[13px] font-semibold text-rose-500 disabled:opacity-50">
                  <Trash2 size={14} /> Remove
                </button>
              )}
            </div>
            <dl className="mt-6 w-full space-y-2 text-left text-[13.5px]">
              <div className="flex justify-between gap-3"><dt className="text-black/50 dark:text-white/50">Email</dt><dd className="truncate font-medium">{user.email}</dd></div>
              {user.employeeId && <div className="flex justify-between gap-3"><dt className="text-black/50 dark:text-white/50">Employee ID</dt><dd className="font-mono font-medium">{user.employeeId}</dd></div>}
              {isEmployee && <div className="flex justify-between gap-3"><dt className="text-black/50 dark:text-white/50">Reports to</dt><dd className="font-medium">{managerName || '—'}</dd></div>}
              <div className="flex justify-between gap-3"><dt className="text-black/50 dark:text-white/50">Last sign-in</dt><dd className="font-medium">{fmtDateTime(user.lastLoginAt)}</dd></div>
            </dl>
            {isEmployee && <div className="mt-5"><IdCardButton userId={user.id} /></div>}
          </Card>

          {links.length > 0 && (
            <Card>
              {sectionHead(user.role === 'parent' ? 'My wards' : user.role === 'teacher' ? 'My classes' : 'Enrolment')}
              <div className="space-y-2">
                {links.map(l => (
                  <div key={l.id} className="rounded-2xl bg-black/[.03] dark:bg-white/[.05] px-4 py-3">
                    <p className="text-[14px] font-semibold">{l.title}</p>
                    <p className="text-[12.5px] text-black/50 dark:text-white/50">{l.sub}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {user.role === 'parent' && (
            <Card>
              {sectionHead('Parent verification')}
              <VerificationCard />
            </Card>
          )}

          {isEmployee && (
            <Card>
              {sectionHead('Employment history')}
              <EmploymentHistoryTimeline userId={user.id} />
            </Card>
          )}

          <Card>
            {sectionHead('Notifications')}
            <PushToggle />
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            {sectionHead('Details')}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={isStudent ? 'Full name (set by the school)' : 'Full name'}>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} disabled={isStudent} className={`${inputCls} disabled:opacity-60`} />
              </Field>
              <Field label="Phone"><input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+91 …" className={inputCls} /></Field>
              <Field label="Date of birth"><input type="date" value={form.dob} onChange={e => setForm(f => ({ ...f, dob: e.target.value }))} className={inputCls} /></Field>
              <Field label="Emergency contact"><input value={form.emergencyContact} onChange={e => setForm(f => ({ ...f, emergencyContact: e.target.value }))} placeholder="Name · phone" className={inputCls} /></Field>
            </div>
            <div className="mt-4">
              <Field label="Address"><textarea value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} rows={2} className={inputCls} /></Field>
            </div>
            <button onClick={save} disabled={!dirty || saving} className="btn-ink mt-5 flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40">
              <Save size={15} /> {saving ? 'Saving…' : 'Save changes'}
            </button>
          </Card>

          {user.role === 'teacher' && (
            <Card>
              {sectionHead('Teaching band affinity')}
              <p className="mb-4 -mt-2 text-[13px] text-black/50 dark:text-white/50">
                Which student ability bands you're strongest teaching to. Self-declared — used as a starting signal for band-aware timetabling; a future evaluation pass may add a verified value alongside it.
              </p>
              <div className="grid gap-4 sm:grid-cols-3">
                {BAND_FIELDS.map(f => (
                  <Field key={f.key} label={f.label}>
                    <select value={bandForm[f.key]} onChange={e => setBandForm(b => ({ ...b, [f.key]: e.target.value as BandLevel }))} className={inputCls}>
                      {BAND_LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                    <span className="mt-1 block text-[11.5px] text-black/40 dark:text-white/40">{f.hint}</span>
                  </Field>
                ))}
              </div>
              {user.affinitySource === 'VERIFIED' && (
                <p className="mt-3 text-[12.5px] text-indigo-600 dark:text-indigo-400">A verified affinity is on file and currently takes priority over your declared values above.</p>
              )}
              <button onClick={saveBand} disabled={!bandDirty || bandBusy} className="btn-ink mt-5 flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40">
                <Sparkles size={15} /> {bandBusy ? 'Saving…' : 'Save band affinity'}
              </button>
            </Card>
          )}

          <Card>
            {sectionHead('Change password')}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Current"><input type="password" value={pw.current} onChange={e => setPw(p => ({ ...p, current: e.target.value }))} autoComplete="current-password" className={inputCls} /></Field>
              <Field label={`New (min ${MIN_PASSWORD})`}><input type="password" value={pw.next} onChange={e => setPw(p => ({ ...p, next: e.target.value }))} autoComplete="new-password" className={inputCls} /></Field>
              <Field label="Confirm"><input type="password" value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} autoComplete="new-password" className={inputCls} /></Field>
            </div>
            <button onClick={changePassword} disabled={!pw.current || !pw.next || !pw.confirm || pwBusy} className="btn-ink mt-5 flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40">
              <KeyRound size={15} /> {pwBusy ? 'Updating…' : 'Update password'}
            </button>
          </Card>
        </div>
      </div>
    </div>
  )
}
