import { useMemo, useState } from 'react'
import {
  Briefcase, Calendar, GraduationCap, HandCoins, Linkedin, MapPin, Pencil, Plus, Trash2, UserPlus, Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAcademic, useStore } from '@/lib/store'
import { api, errorMessage } from '@/lib/api'
import { fmtINR } from '@/lib/data'
import type { AlumniEvent, AlumniProfile, AlumniRsvpStatus } from '@/lib/data'
import { fmtDate } from '@/lib/hooks/useAcademics'
import { isoDate } from '@/lib/hooks/useTimetable'
import {
  ALUMNI_RSVP_STATUSES, donationTotals, graduationYears, rsvpTone,
  useAlumniDonations, useAlumniEventRsvps, useAlumniEvents, useAlumniProfiles,
} from '@/lib/hooks/useAlumni'
import { Card, Empty, Field, Modal, PageHead, Pill, inputCls } from '../ui'

// Phase 13 — Alumni management: Directory (search/filter, standalone + student-converted profiles),
// Events (create, RSVP on an alumnus's behalf — alumni have no portal login), Donations (log + totals).
// See .agents/edunova/phase-13-alumni.md
//
// The server side was being built concurrently — endpoint paths/payloads below follow the spec's described
// shapes and may need adjusting once verified against the real running server (see final report for details).

const ghostBtn = 'flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/15 px-3.5 py-2 text-[13px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06] disabled:opacity-40'
const dangerBtn = 'flex items-center gap-1.5 rounded-full bg-rose-50 dark:bg-rose-500/10 px-3.5 py-2 text-[13px] font-semibold text-rose-500 hover:bg-rose-100 disabled:opacity-40'
const primaryBtn = 'flex items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-40'
const loadingRow = (text: string) => <div className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">{text}</div>

type Tab = 'directory' | 'events' | 'donations'

function Tabs({ value, onChange }: { value: Tab; onChange: (t: Tab) => void }) {
  const options: { id: Tab; label: string }[] = [
    { id: 'directory', label: 'Directory' },
    { id: 'events', label: 'Events' },
    { id: 'donations', label: 'Donations' },
  ]
  return (
    <div className="inline-flex rounded-full border border-black/[.08] dark:border-white/[.10] bg-white dark:bg-[#14141f] p-1">
      {options.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)}
          className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-all ${value === o.id ? 'bg-black text-white shadow' : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ── top-level module ──────────────────────────────────── */

export function AlumniMod() {
  const [tab, setTab] = useState<Tab>('directory')
  return (
    <div>
      <PageHead title="Alumni" sub="Former students — directory, events and donations. Staff/admin-recorded; alumni have no portal login of their own.">
        <Tabs value={tab} onChange={setTab} />
      </PageHead>
      {tab === 'directory' && <DirectoryTab />}
      {tab === 'events' && <EventsTab />}
      {tab === 'donations' && <DonationsTab />}
    </div>
  )
}

/* ── Directory ──────────────────────────────────────────── */

const emptyProfileForm = { name: '', email: '', phone: '', graduationYear: String(new Date().getFullYear()), lastClassLabel: '', currentOccupation: '', currentOrganization: '', currentCity: '', linkedInUrl: '', notes: '' }

function DirectoryTab() {
  const { db } = useStore()
  const { classOf, currentYear } = useAcademic()
  const [q, setQ] = useState('')
  const [yearFilter, setYearFilter] = useState<number | ''>('')
  const profiles = useAlumniProfiles({ q: q.trim() || undefined, graduationYear: yearFilter || undefined })
  const list = useMemo(() => [...(profiles.items ?? [])].sort((a, b) => b.graduationYear - a.graduationYear || a.name.localeCompare(b.name)), [profiles.items])
  const years = useMemo(() => graduationYears(profiles.items), [profiles.items])
  const [busy, setBusy] = useState<string | null>(null)

  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState(emptyProfileForm)
  const openAdd = () => { setForm(emptyProfileForm); setAddOpen(true) }
  const addProfile = async () => {
    if (!form.name.trim() || !form.graduationYear || !form.lastClassLabel.trim()) return
    setBusy('add')
    try {
      await api.post('/alumni/profiles', {
        name: form.name.trim(), email: form.email.trim() || undefined, phone: form.phone.trim() || undefined,
        graduationYear: Number(form.graduationYear), lastClassLabel: form.lastClassLabel.trim(),
        currentOccupation: form.currentOccupation.trim() || undefined, currentOrganization: form.currentOrganization.trim() || undefined,
        currentCity: form.currentCity.trim() || undefined, linkedInUrl: form.linkedInUrl.trim() || undefined, notes: form.notes.trim() || undefined,
      })
      setAddOpen(false); profiles.reload(); toast.success('Alumni profile added')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  const [editing, setEditing] = useState<AlumniProfile | null>(null)
  const saveEdit = async () => {
    if (!editing) return
    setBusy(editing.id)
    try {
      await api.patch(`/alumni/profiles/${editing.id}`, {
        email: editing.email || undefined, phone: editing.phone || undefined,
        currentOccupation: editing.currentOccupation || undefined, currentOrganization: editing.currentOrganization || undefined,
        currentCity: editing.currentCity || undefined, linkedInUrl: editing.linkedInUrl || undefined, notes: editing.notes || undefined,
      })
      setEditing(null); profiles.reload(); toast.success('Profile updated')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const remove = async (a: AlumniProfile) => {
    if (!confirm(`Delete alumni profile for "${a.name}"? This does not affect any linked student account.`)) return
    setBusy(a.id)
    try { await api.del(`/alumni/profiles/${a.id}`); profiles.reload(); toast.success('Profile deleted') }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  // Convert-student flow — a standalone action here (see final report re: also offering this at TC-issuance
  // time in the Applications module, which this frontend agent does not own).
  const students = useMemo(() => db.users.filter(u => u.role === 'student').sort((a, b) => a.name.localeCompare(b.name)), [db.users])
  const convertedIds = useMemo(() => new Set((profiles.items ?? []).map(a => a.studentUserId).filter((x): x is string => !!x)), [profiles.items])
  const convertible = useMemo(() => students.filter(s => !convertedIds.has(s.id)), [students, convertedIds])
  const [convertOpen, setConvertOpen] = useState(false)
  const defaultGradYear = currentYear?.endDate ? new Date(currentYear.endDate).getFullYear() : new Date().getFullYear()
  const [cForm, setCForm] = useState({ studentId: '', graduationYear: String(defaultGradYear), notes: '' })
  const openConvert = () => { setCForm({ studentId: convertible[0]?.id ?? '', graduationYear: String(defaultGradYear), notes: '' }); setConvertOpen(true) }
  const selectedClass = cForm.studentId ? classOf(cForm.studentId) : undefined
  const convert = async () => {
    if (!cForm.studentId || !cForm.graduationYear) return
    setBusy('convert')
    try {
      await api.post('/alumni/convert-student', { studentId: cForm.studentId, graduationYear: Number(cForm.graduationYear), notes: cForm.notes.trim() || undefined })
      setConvertOpen(false); profiles.reload(); toast.success('Student converted to alumnus')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, email, occupation…" className={`${inputCls} min-w-[220px] flex-1`} />
        <select value={yearFilter} onChange={e => setYearFilter(e.target.value ? Number(e.target.value) : '')} className={`${inputCls} w-auto`}>
          <option value="">All graduation years</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <button onClick={openConvert} disabled={convertible.length === 0} className={ghostBtn} title={convertible.length === 0 ? 'No unconverted students' : undefined}>
          <UserPlus size={14} /> Convert student
        </button>
        <button onClick={openAdd} className={primaryBtn}><Plus size={14} /> Add profile</button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {profiles.loading ? <div className="md:col-span-2">{loadingRow('Loading alumni…')}</div>
          : profiles.error ? <div className="md:col-span-2"><Empty text={profiles.error} /></div>
          : list.length === 0 ? <div className="md:col-span-2"><Empty text="No alumni profiles yet — add one, or convert a graduating student." /></div>
          : list.map(a => (
            <Card key={a.id} className="card-lift">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
                  <GraduationCap size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold">{a.name}</p>
                  <p className="text-[12.5px] text-black/50 dark:text-white/50">Class of {a.graduationYear} · {a.lastClassLabel}</p>
                </div>
                {a.studentUserId && <Pill tone="sky">Ex-student</Pill>}
              </div>
              <div className="mt-3 space-y-1 text-[13px] text-black/60 dark:text-white/60">
                {a.email && <p>{a.email}</p>}
                {a.phone && <p>{a.phone}</p>}
                {(a.currentOccupation || a.currentOrganization) && (
                  <p className="flex items-center gap-1.5"><Briefcase size={12} className="shrink-0 text-black/35 dark:text-white/35" /> {[a.currentOccupation, a.currentOrganization].filter(Boolean).join(' · ')}</p>
                )}
                {a.currentCity && <p className="flex items-center gap-1.5"><MapPin size={12} className="shrink-0 text-black/35 dark:text-white/35" /> {a.currentCity}</p>}
                {a.linkedInUrl && (
                  <a href={a.linkedInUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-indigo-600 hover:underline dark:text-indigo-400">
                    <Linkedin size={12} className="shrink-0" /> LinkedIn
                  </a>
                )}
                {a.notes && <p className="text-[12.5px] text-black/45 dark:text-white/45">{a.notes}</p>}
              </div>
              <div className="mt-4 flex gap-2">
                <button onClick={() => setEditing(a)} className={ghostBtn}><Pencil size={12} /> Edit</button>
                <button onClick={() => remove(a)} disabled={busy === a.id} className={dangerBtn}><Trash2 size={12} /></button>
              </div>
            </Card>
          ))}
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add alumni profile" wide>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={inputCls} /></Field>
            <Field label="Graduation year"><input type="number" value={form.graduationYear} onChange={e => setForm({ ...form, graduationYear: e.target.value })} className={inputCls} /></Field>
            <Field label="Last class"><input value={form.lastClassLabel} onChange={e => setForm({ ...form, lastClassLabel: e.target.value })} placeholder="e.g. XII-A CBSE" className={inputCls} /></Field>
            <Field label="Email"><input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className={inputCls} /></Field>
            <Field label="Phone"><input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className={inputCls} /></Field>
            <Field label="Current occupation"><input value={form.currentOccupation} onChange={e => setForm({ ...form, currentOccupation: e.target.value })} className={inputCls} /></Field>
            <Field label="Current organization"><input value={form.currentOrganization} onChange={e => setForm({ ...form, currentOrganization: e.target.value })} className={inputCls} /></Field>
            <Field label="Current city"><input value={form.currentCity} onChange={e => setForm({ ...form, currentCity: e.target.value })} className={inputCls} /></Field>
            <Field label="LinkedIn URL"><input value={form.linkedInUrl} onChange={e => setForm({ ...form, linkedInUrl: e.target.value })} className={inputCls} /></Field>
          </div>
          <Field label="Notes"><textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className={inputCls} /></Field>
          <button onClick={addProfile} disabled={busy === 'add' || !form.name.trim() || !form.graduationYear || !form.lastClassLabel.trim()} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy === 'add' ? 'Adding…' : 'Add profile'}</button>
        </div>
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing ? editing.name : ''} wide>
        {editing && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email"><input type="email" value={editing.email ?? ''} onChange={e => setEditing({ ...editing, email: e.target.value })} className={inputCls} /></Field>
              <Field label="Phone"><input value={editing.phone ?? ''} onChange={e => setEditing({ ...editing, phone: e.target.value })} className={inputCls} /></Field>
              <Field label="Current occupation"><input value={editing.currentOccupation ?? ''} onChange={e => setEditing({ ...editing, currentOccupation: e.target.value })} className={inputCls} /></Field>
              <Field label="Current organization"><input value={editing.currentOrganization ?? ''} onChange={e => setEditing({ ...editing, currentOrganization: e.target.value })} className={inputCls} /></Field>
              <Field label="Current city"><input value={editing.currentCity ?? ''} onChange={e => setEditing({ ...editing, currentCity: e.target.value })} className={inputCls} /></Field>
              <Field label="LinkedIn URL"><input value={editing.linkedInUrl ?? ''} onChange={e => setEditing({ ...editing, linkedInUrl: e.target.value })} className={inputCls} /></Field>
            </div>
            <Field label="Notes"><textarea value={editing.notes ?? ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} rows={2} className={inputCls} /></Field>
            <button onClick={saveEdit} disabled={busy === editing.id} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">Save</button>
          </div>
        )}
      </Modal>

      <Modal open={convertOpen} onClose={() => setConvertOpen(false)} title="Convert student to alumnus">
        <div className="space-y-4">
          {convertible.length === 0 ? <Empty text="No students available to convert — every current student is already an alumnus, or there are no students yet." /> : (
            <>
              <Field label="Student">
                <select value={cForm.studentId} onChange={e => setCForm({ ...cForm, studentId: e.target.value })} className={inputCls}>
                  {convertible.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <p className="text-[12.5px] text-black/45 dark:text-white/45">
                {selectedClass ? `Currently enrolled in ${selectedClass.label} · ${selectedClass.boardCode}` : 'No active enrolment found — the profile will still be created.'}
              </p>
              <Field label="Graduation year"><input type="number" value={cForm.graduationYear} onChange={e => setCForm({ ...cForm, graduationYear: e.target.value })} className={inputCls} /></Field>
              <Field label="Notes (optional)"><textarea value={cForm.notes} onChange={e => setCForm({ ...cForm, notes: e.target.value })} rows={2} className={inputCls} /></Field>
              <p className="text-[12px] text-black/40 dark:text-white/40">This creates an alumni profile from the student's current record. It does not remove their existing student account.</p>
              <button onClick={convert} disabled={busy === 'convert' || !cForm.studentId || !cForm.graduationYear} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy === 'convert' ? 'Converting…' : 'Convert to alumnus'}</button>
            </>
          )}
        </div>
      </Modal>
    </div>
  )
}

/* ── Events & RSVPs ─────────────────────────────────────── */

function EventsTab() {
  const events = useAlumniEvents()
  const profiles = useAlumniProfiles({})
  const list = useMemo(() => [...(events.items ?? [])].sort((a, b) => b.date.localeCompare(a.date)), [events.items])
  const [busy, setBusy] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ title: '', description: '', date: isoDate(new Date()), location: '' })
  const openCreate = () => { setForm({ title: '', description: '', date: isoDate(new Date()), location: '' }); setCreateOpen(true) }
  const create = async () => {
    if (!form.title.trim() || !form.date) return
    setBusy('create')
    try {
      await api.post('/alumni/events', { title: form.title.trim(), description: form.description.trim() || undefined, date: form.date, location: form.location.trim() || undefined })
      setCreateOpen(false); events.reload(); toast.success('Event created')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const remove = async (ev: AlumniEvent) => {
    if (!confirm(`Delete event "${ev.title}"?`)) return
    setBusy(ev.id)
    try { await api.del(`/alumni/events/${ev.id}`); events.reload(); toast.success('Event deleted') }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  const [detail, setDetail] = useState<AlumniEvent | null>(null)

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button onClick={openCreate} className={primaryBtn}><Plus size={14} /> New event</button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {events.loading ? <div className="md:col-span-2">{loadingRow('Loading events…')}</div>
          : events.error ? <div className="md:col-span-2"><Empty text={events.error} /></div>
          : list.length === 0 ? <div className="md:col-span-2"><Empty text="No alumni events yet." /></div>
          : list.map(ev => (
            <Card key={ev.id} className="card-lift">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300">
                  <Calendar size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold">{ev.title}</p>
                  <p className="text-[12.5px] text-black/50 dark:text-white/50">{fmtDate(ev.date, { day: 'numeric', month: 'short', year: 'numeric' })}{ev.location ? ` · ${ev.location}` : ''}</p>
                </div>
              </div>
              {ev.description && <p className="mt-3 text-[13px] leading-relaxed text-black/60 dark:text-white/60">{ev.description}</p>}
              <div className="mt-4 flex gap-2">
                <button onClick={() => setDetail(ev)} className="rounded-full bg-black/[.06] dark:bg-white/[.08] px-4 py-2 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">RSVPs</button>
                <button onClick={() => remove(ev)} disabled={busy === ev.id} className={dangerBtn}><Trash2 size={12} /></button>
              </div>
            </Card>
          ))}
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New alumni event" wide>
        <div className="space-y-4">
          <Field label="Title"><input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Class of 2015 reunion" className={inputCls} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date"><input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className={inputCls} /></Field>
            <Field label="Location"><input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} className={inputCls} /></Field>
          </div>
          <Field label="Description"><textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3} className={inputCls} /></Field>
          <button onClick={create} disabled={busy === 'create' || !form.title.trim() || !form.date} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy === 'create' ? 'Creating…' : 'Create event'}</button>
        </div>
      </Modal>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `RSVPs · ${detail.title}` : ''} wide>
        {detail && <EventRsvps event={detail} alumni={profiles.items ?? []} />}
      </Modal>
    </div>
  )
}

function EventRsvps({ event, alumni }: { event: AlumniEvent; alumni: AlumniProfile[] }) {
  const rsvps = useAlumniEventRsvps(event.id)
  const list = useMemo(() => [...(rsvps.items ?? [])].sort((a, b) => b.respondedAt.localeCompare(a.respondedAt)), [rsvps.items])
  const nameOf = (id: string, fallback?: string) => fallback ?? alumni.find(a => a.id === id)?.name ?? id
  const rsvpFor = (alumniId: string) => (rsvps.items ?? []).find(r => r.alumniId === alumniId)

  const [alumniId, setAlumniId] = useState(alumni[0]?.id ?? '')
  const [status, setStatus] = useState<AlumniRsvpStatus>('Interested')
  const [busy, setBusy] = useState(false)
  const mark = async () => {
    if (!alumniId) return
    setBusy(true)
    try {
      await api.post(`/alumni/events/${event.id}/rsvp`, { alumniId, status })
      rsvps.reload()
      toast.success(`Marked ${nameOf(alumniId)} as ${status}`)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      {alumni.length === 0 ? <Empty text="No alumni in the directory yet — add one first." /> : (
        <div className="flex flex-wrap items-end gap-2 rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-4">
          <div className="min-w-[180px] flex-1">
            <Field label="Alumnus">
              <select value={alumniId} onChange={e => setAlumniId(e.target.value)} className={inputCls}>
                {alumni.map(a => <option key={a.id} value={a.id}>{a.name}{rsvpFor(a.id) ? ` (currently ${rsvpFor(a.id)!.status})` : ''}</option>)}
              </select>
            </Field>
          </div>
          <div className="w-40">
            <Field label="Status">
              <select value={status} onChange={e => setStatus(e.target.value as AlumniRsvpStatus)} className={inputCls}>
                {ALUMNI_RSVP_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <button onClick={mark} disabled={busy || !alumniId} className="btn-ink px-4 py-2.5 text-[13.5px] font-semibold disabled:opacity-40">{busy ? 'Saving…' : 'Mark RSVP'}</button>
        </div>
      )}
      <div>
        {rsvps.loading ? loadingRow('Loading RSVPs…')
          : rsvps.error ? <Empty text={rsvps.error} />
          : list.length === 0 ? <Empty text="No RSVPs recorded yet." />
          : (
            <div className="space-y-1.5">
              {list.map(r => (
                <div key={r.id} className="flex items-center gap-3 rounded-2xl bg-black/[.03] dark:bg-white/[.05] px-4 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{r.alumniName ?? nameOf(r.alumniId)}</span>
                  <Pill tone={rsvpTone(r.status)}>{r.status}</Pill>
                  <span className="shrink-0 text-[11.5px] text-black/40 dark:text-white/40">{fmtDate(r.respondedAt, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  )
}

/* ── Donations ──────────────────────────────────────────── */

function DonationsTab() {
  const profiles = useAlumniProfiles({})
  const donations = useAlumniDonations({})
  const list = useMemo(() => [...(donations.items ?? [])].sort((a, b) => b.donatedAt.localeCompare(a.donatedAt)), [donations.items])
  const { total, byAlumni } = useMemo(() => donationTotals(donations.items), [donations.items])
  const nameOf = (id: string, fallback?: string) => fallback ?? profiles.items?.find(a => a.id === id)?.name ?? id
  const byAlumniSorted = useMemo(() => [...byAlumni.entries()].sort((a, b) => b[1] - a[1]), [byAlumni])
  const [busy, setBusy] = useState(false)

  const [logOpen, setLogOpen] = useState(false)
  const [form, setForm] = useState({ alumniId: '', amount: '', purpose: '', donatedAt: isoDate(new Date()), note: '' })
  const openLog = () => { setForm({ alumniId: profiles.items?.[0]?.id ?? '', amount: '', purpose: '', donatedAt: isoDate(new Date()), note: '' }); setLogOpen(true) }
  const log = async () => {
    const amt = Math.max(0, Number(form.amount) || 0)
    if (!form.alumniId || amt <= 0) return
    setBusy(true)
    try {
      await api.post('/alumni/donations', { alumniId: form.alumniId, amount: amt, purpose: form.purpose.trim() || undefined, donatedAt: form.donatedAt, note: form.note.trim() || undefined })
      setLogOpen(false); donations.reload(); toast.success('Donation logged')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <Card>
          <p className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><HandCoins size={15} /> School-wide total</p>
          <p className="font-display mt-2 text-3xl font-medium">{fmtINR(total)}</p>
          <p className="mt-1 text-[12.5px] text-black/45 dark:text-white/45">{list.length} donation{list.length === 1 ? '' : 's'} on record</p>
        </Card>
        <Card>
          <p className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><Users size={15} /> Top donors</p>
          {byAlumniSorted.length === 0 ? <p className="mt-3 text-[13px] text-black/40 dark:text-white/40">No donations yet.</p> : (
            <div className="mt-2 space-y-1.5">
              {byAlumniSorted.slice(0, 5).map(([id, amt]) => (
                <div key={id} className="flex justify-between text-[13.5px]"><span>{nameOf(id)}</span><span className="font-semibold">{fmtINR(amt)}</span></div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="mb-4 flex justify-end">
        <button onClick={openLog} disabled={(profiles.items ?? []).length === 0} className={primaryBtn}><Plus size={14} /> Log donation</button>
      </div>

      <Card className="p-0">
        {donations.loading ? loadingRow('Loading donations…')
          : donations.error ? <div className="p-6"><Empty text={donations.error} /></div>
          : list.length === 0 ? <div className="p-6"><Empty text="No donations logged yet." /></div>
          : list.map(d => (
            <div key={d.id} className="flex flex-wrap items-center gap-4 border-b border-black/[.05] dark:border-white/[.07] px-6 py-3.5 last:border-0">
              <div className="min-w-48 flex-1">
                <p className="text-[14.5px] font-semibold">{d.alumniName ?? nameOf(d.alumniId)} · {fmtINR(d.amount)}</p>
                <p className="text-[12.5px] text-black/45 dark:text-white/45">{fmtDate(d.donatedAt, { day: 'numeric', month: 'short', year: 'numeric' })}{d.purpose ? ` · ${d.purpose}` : ''}{d.recordedByName ? ` · recorded by ${d.recordedByName}` : ''}</p>
                {d.note && <p className="mt-1 text-[12px] text-black/50 dark:text-white/50">{d.note}</p>}
              </div>
            </div>
          ))}
      </Card>

      <Modal open={logOpen} onClose={() => setLogOpen(false)} title="Log a donation" wide>
        <div className="space-y-4">
          <Field label="Alumnus">
            <select value={form.alumniId} onChange={e => setForm({ ...form, alumniId: e.target.value })} className={inputCls}>
              {(profiles.items ?? []).map(a => <option key={a.id} value={a.id}>{a.name} · Class of {a.graduationYear}</option>)}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount (₹)"><input type="number" min={1} value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className={inputCls} /></Field>
            <Field label="Date"><input type="date" value={form.donatedAt} onChange={e => setForm({ ...form, donatedAt: e.target.value })} className={inputCls} /></Field>
          </div>
          <Field label="Purpose (optional)"><input value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })} placeholder="e.g. Scholarship fund, Library renovation" className={inputCls} /></Field>
          <Field label="Note (optional)"><textarea value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} rows={2} placeholder="How it came in — cheque no., bank transfer ref…" className={inputCls} /></Field>
          <p className="text-[12px] text-black/40 dark:text-white/40">This is a record-keeping entry for a donation received through an external channel — it does not process a payment.</p>
          <button onClick={log} disabled={busy || !form.alumniId || Math.max(0, Number(form.amount) || 0) <= 0} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy ? 'Logging…' : 'Log donation'}</button>
        </div>
      </Modal>
    </div>
  )
}
