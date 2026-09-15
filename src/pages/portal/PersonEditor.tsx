import { useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { useAcademic, useStore, type CreateUserInput } from '@/lib/store'
import { api, errorMessage } from '@/lib/api'
import { isSuperAdmin } from '@/lib/access'
import { compareClasses, type Role } from '@/lib/data'
import { useEmployees } from '@/lib/hooks/useFinance'
import { Card, Empty, Field, PageHead, Pill, inputCls } from '@/portal/ui'
import { SearchableUserPicker } from '@/portal/modules/employee'
import { AsyncPickList, CredentialRow } from '@/portal/modules/office'
import { PortalPageShell } from './PortalPageShell'

// Small helpers ported verbatim from office.tsx's PeopleMod (kept local rather than exported — exporting
// plain functions/types alongside components out of office.tsx trips the react-refresh/only-export-components
// lint rule that the rest of this codebase respects).
const todayISO = () => new Date().toISOString().slice(0, 10)

/** Placeholder hint only — the server derives the real default (server/src/userDefaults.ts). */
function emailHint(name: string, role: Role) {
  const base = name.trim().toLowerCase().replace(/[^a-z]+/g, '.').replace(/(^\.|\.$)/g, '') || 'first.last'
  return role === 'parent' ? `parent.${base}@edkonic.in` : `${base}@edkonic.in`
}

interface PersonForm {
  name: string
  email: string
  role: Role
  classId: string
  rollNo: string
  dob: string
  parentIds: string[]
  studentIds: string[]
  phone: string
  classTeacherOf: string
  joinDate: string
  department: string
  designation: string
  reportsTo: string
}

const emptyPersonForm = (role: Role): PersonForm => ({
  name: '', email: '', role,
  classId: '', rollNo: '', dob: '', parentIds: [],
  studentIds: [], phone: '',
  classTeacherOf: '', joinDate: todayISO(),
  department: '', designation: '',
  reportsTo: '',
})

// Was the "Add/Edit user" modal inside `PeopleMod` (office.tsx) — multi-role account creation/editing with
// a different field set per role (student/teacher/staff/parent/admin). Converted to two routes per
// .agents/edunova/ui-architecture-fix.md Phase D #2: `/portal/people/new` (optionally `?role=`) and
// `/portal/people/:id/edit`, both served by this one component (matching how the original modal shared a
// single form for create and edit). Field logic/save() payloads are carried over verbatim from PeopleMod;
// PeopleMod itself keeps the list/filter/table UI and its own revoke-access / reactivate / counselor actions.

const ALLOWED_CREATE_ROLES: Role[] = ['student', 'teacher', 'staff', 'parent']

export default function PersonEditor() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { db, user, createUser, updateUser, refreshAcademic, refreshDB } = useStore()
  const academic = useAcademic()
  const { currentYear, classById, subjectById, classOf, wardsOf } = academic
  const current = user!
  const isSuper = isSuperAdmin(current)
  const employeeOptions = useEmployees()

  const editing = id ? db.users.find(u => u.id === id) ?? null : null
  const roleParam = searchParams.get('role') as Role | null
  const createRoles: Role[] = [...ALLOWED_CREATE_ROLES, ...(isSuper ? ['admin' as Role] : [])]
  const initialRole: Role = editing ? editing.role : (roleParam && createRoles.includes(roleParam) ? roleParam : 'student')

  const yearClasses = useMemo(
    () => academic.classes.filter(c => !currentYear || c.academicYearId === currentYear.id).slice().sort(compareClasses(academic.gradeById)),
    [academic.classes, academic.gradeById, currentYear],
  )
  const userById = useMemo(() => new Map(db.users.map(u => [u.id, u])), [db.users])
  const nameById = (uid: string) => userById.get(uid)?.name ?? uid

  const enrollmentOf = (studentId: string) =>
    academic.enrollments.find(e => e.studentId === studentId && e.status === 'active' && (!currentYear || e.academicYearId === currentYear.id))
    ?? academic.enrollments.find(e => e.studentId === studentId)
  const guardiansOf = (studentId: string) => academic.guardians.filter(g => g.studentId === studentId)
  const classTeacherOf = (teacherId: string) => academic.classes.find(c => c.classTeacherId === teacherId)
  const teachingOf = (teacherId: string) => academic.classSubjects
    .filter(cs => cs.teacherId === teacherId)
    .map(cs => ({ id: cs.id, label: `${subjectById.get(cs.subjectId)?.name ?? 'Subject'} · ${classById.get(cs.classId)?.label ?? '—'}` }))

  const departmentOptions = useMemo(
    () => Array.from(new Set(db.users.map(u => u.department).filter((d): d is string => !!d))).sort(),
    [db.users],
  )
  const classOption = (c: { label: string; boardCode: string; stream?: string }) => `${c.label} · ${c.boardCode}${c.stream ? ' · ' + c.stream : ''}`

  const buildEditForm = (u: NonNullable<typeof editing>): PersonForm => {
    const e = enrollmentOf(u.id)
    const c = classOf(u.id)
    return {
      ...emptyPersonForm(u.role),
      name: u.name,
      email: u.email,
      classId: c && yearClasses.some(x => x.id === c.id) ? c.id : '',
      rollNo: e?.rollNo ?? '',
      dob: u.dob ?? '',
      parentIds: guardiansOf(u.id).map(g => g.parentId),
      studentIds: wardsOf(u.id),
      phone: u.phone ?? '',
      classTeacherOf: classTeacherOf(u.id)?.id ?? '',
      joinDate: u.joinDate ?? todayISO(),
      department: u.department ?? '',
      designation: u.designation ?? '',
      reportsTo: u.reportsTo ?? '',
    }
  }

  const [form, setForm] = useState<PersonForm>(() => (editing ? buildEditForm(editing) : emptyPersonForm(initialRole)))
  // Re-sync the form once when the editing target first resolves (db.users can still be loading on a direct
  // URL load — `editing` starts `null` and flips to the real record a tick later).
  const [syncedFor, setSyncedFor] = useState<string | null>(null)
  if (editing && syncedFor !== editing.id) {
    setSyncedFor(editing.id)
    setForm(buildEditForm(editing))
  }

  const [saving, setSaving] = useState(false)
  const [created, setCreated] = useState<{ name: string; email: string; password: string } | null>(null)

  const patch = (p: Partial<PersonForm>) => setForm(f => ({ ...f, ...p }))
  const toggleIn = (key: 'parentIds' | 'studentIds', pid: string) =>
    setForm(f => ({ ...f, [key]: f[key].includes(pid) ? f[key].filter(x => x !== pid) : [...f[key], pid] }))

  const noClassForStudent = form.role === 'student' && yearClasses.length === 0
  const canSave = !!form.name.trim() && !saving && (form.role !== 'student' || !!form.classId)

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    const name = form.name.trim()
    try {
      if (editing) {
        const uid = editing.id
        let touchedAcademic = false
        if (form.role === 'student') {
          await updateUser(uid, { name, classId: form.classId, rollNo: form.rollNo.trim(), dob: form.dob || undefined })
          const existing = guardiansOf(uid)
          const want = new Set(form.parentIds)
          const toAdd = form.parentIds.filter(pid => !existing.some(g => g.parentId === pid))
          const toRemove = existing.filter(g => !want.has(g.parentId))
          if (toAdd.length || toRemove.length) {
            await Promise.all([
              ...toAdd.map(parentId => api.post('/academic/guardians', { parentId, studentId: uid })),
              ...toRemove.map(g => api.del('/academic/guardians/' + g.id)),
            ])
            touchedAcademic = true
          }
        } else if (form.role === 'parent') {
          await updateUser(uid, { name, phone: form.phone.trim(), studentIds: form.studentIds })
        } else if (form.role === 'teacher') {
          const prev = classTeacherOf(uid)
          await updateUser(uid, { name, joinDate: form.joinDate, classTeacherOf: form.classTeacherOf || undefined, phone: form.phone.trim(), reportsTo: form.reportsTo || null })
          if (prev && !form.classTeacherOf) {
            // Unassign: PATCH /users can only (re)assign, so clear the class directly.
            await api.patch('/academic/classes/' + prev.id, { classTeacherId: null })
            touchedAcademic = true
          }
        } else if (form.role === 'staff') {
          await updateUser(uid, { name, department: form.department, designation: form.designation.trim(), joinDate: form.joinDate, phone: form.phone.trim(), reportsTo: form.reportsTo || null })
        } else {
          await updateUser(uid, { name, designation: form.designation.trim(), department: form.department, phone: form.phone.trim(), reportsTo: form.reportsTo || null })
        }
        if (touchedAcademic) await Promise.all([refreshAcademic(), refreshDB()])
        toast.success(`${name} updated`)
        navigate(-1)
      } else {
        const email = form.email.trim() || undefined
        const base = { role: form.role, name, email }
        const input: CreateUserInput =
          form.role === 'student' ? { ...base, classId: form.classId, rollNo: form.rollNo.trim() || undefined, dob: form.dob || undefined }
          : form.role === 'parent' ? { ...base, phone: form.phone.trim() || undefined, studentIds: form.studentIds }
          : form.role === 'teacher' ? { ...base, joinDate: form.joinDate, classTeacherOf: form.classTeacherOf || undefined, phone: form.phone.trim() || undefined, reportsTo: form.reportsTo || undefined }
          : form.role === 'staff' ? { ...base, department: form.department || undefined, designation: form.designation.trim() || undefined, joinDate: form.joinDate, phone: form.phone.trim() || undefined, reportsTo: form.reportsTo || undefined }
          : { ...base, designation: form.designation.trim() || undefined, department: form.department || undefined, phone: form.phone.trim() || undefined, reportsTo: form.reportsTo || undefined }
        const res = await createUser(input)
        if (form.role === 'student' && form.parentIds.length) {
          await Promise.all(form.parentIds.map(parentId => api.post('/academic/guardians', { parentId, studentId: res.user.id })))
          await Promise.all([refreshAcademic(), refreshDB()])
        }
        setCreated({ name: res.user.name, email: res.user.email, password: res.password })
        toast.success(`${res.user.name} onboarded as ${res.user.role}`)
      }
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  if (id && !editing) {
    return (
      <PortalPageShell backLabel="Back to people">
        <Empty text="Person not found." />
      </PortalPageShell>
    )
  }

  if (created) {
    return (
      <PortalPageShell backLabel="Back to people">
        <PageHead title="Account created" />
        <Card>
          <div className="space-y-4">
            <p className="text-[14px] leading-relaxed text-black/60 dark:text-white/60">
              Share these credentials with <b>{created.name}</b>. The password is shown only once; they will be asked to change it on first login.
            </p>
            <CredentialRow label="Email" value={created.email} />
            <CredentialRow label="Password" value={created.password} />
            <button onClick={() => navigate('/portal')} className="btn-ink w-full py-3 text-[14px] font-semibold">Done</button>
          </div>
        </Card>
      </PortalPageShell>
    )
  }

  return (
    <PortalPageShell backLabel="Back to people">
      <PageHead title={editing ? `Edit ${editing.name}` : `Add ${form.role}`} />
      <Card>
        <div className="space-y-4">
          {editing?.employeeId && <p className="text-[12.5px] text-black/45 dark:text-white/45">Employee ID: <span className="font-mono">{editing.employeeId}</span></p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name">
              <input value={form.name} onChange={e => patch({ name: e.target.value })} placeholder="e.g. Kavya Nair" className={inputCls} autoFocus />
            </Field>
            {editing ? (
              <Field label="Email"><input value={form.email} readOnly className={`${inputCls} bg-black/[.03] dark:bg-white/[.04] text-black/60 dark:text-white/60`} /></Field>
            ) : (
              <Field label="Email (optional)">
                <input type="email" value={form.email} onChange={e => patch({ email: e.target.value })} placeholder={emailHint(form.name, form.role)} className={inputCls} />
              </Field>
            )}
          </div>

          {!editing && (
            <Field label="Role">
              <select value={form.role} onChange={e => setForm(emptyPersonForm(e.target.value as Role))} className={inputCls}>
                {(['student', 'teacher', 'staff', 'parent', ...(isSuper ? ['admin'] : [])] as Role[]).map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
          )}

          {form.role === 'student' && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Class">
                  {noClassForStudent ? (
                    <p className="rounded-xl border border-dashed border-amber-300 bg-amber-50/50 dark:border-amber-500/40 dark:bg-amber-500/10 px-3 py-2.5 text-[13px] text-amber-800 dark:text-amber-300">Create a class first in Academic Setup.</p>
                  ) : (
                    <select value={form.classId} onChange={e => patch({ classId: e.target.value })} className={inputCls}>
                      <option value="">Select class</option>
                      {yearClasses.map(c => <option key={c.id} value={c.id}>{classOption(c)}</option>)}
                    </select>
                  )}
                </Field>
                <Field label="Roll number"><input value={form.rollNo} onChange={e => patch({ rollNo: e.target.value })} placeholder="e.g. 12" className={inputCls} /></Field>
                <Field label="Date of birth"><input type="date" value={form.dob} onChange={e => patch({ dob: e.target.value })} className={inputCls} /></Field>
              </div>
              <Field label="Parent(s) — optional">
                <AsyncPickList role="parent" selected={form.parentIds} nameOf={nameById} placeholder="Add a parent…"
                  onAdd={pid => { if (!form.parentIds.includes(pid)) toggleIn('parentIds', pid) }}
                  onRemove={pid => toggleIn('parentIds', pid)} />
              </Field>
            </div>
          )}

          {form.role === 'parent' && (
            <div className="space-y-4">
              <Field label="Phone"><input value={form.phone} onChange={e => patch({ phone: e.target.value })} placeholder="+91 98765 43210" className={inputCls} /></Field>
              <Field label="Wards">
                <AsyncPickList role="student" selected={form.studentIds} nameOf={nameById} placeholder="Add a student…"
                  onAdd={sid => { if (!form.studentIds.includes(sid)) toggleIn('studentIds', sid) }}
                  onRemove={sid => toggleIn('studentIds', sid)} />
              </Field>
            </div>
          )}

          {form.role === 'teacher' && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Class teacher of">
                  <select value={form.classTeacherOf} onChange={e => patch({ classTeacherOf: e.target.value })} className={inputCls}>
                    <option value="">{yearClasses.length ? 'None' : 'No classes yet'}</option>
                    {yearClasses.map(c => {
                      const other = c.classTeacherId && c.classTeacherId !== editing?.id ? userById.get(c.classTeacherId)?.name : undefined
                      return <option key={c.id} value={c.id}>{c.label}{other ? ` · currently ${other}` : ''}</option>
                    })}
                  </select>
                </Field>
                <Field label="Joining date"><input type="date" value={form.joinDate} onChange={e => patch({ joinDate: e.target.value })} className={inputCls} /></Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Phone"><input value={form.phone} onChange={e => patch({ phone: e.target.value })} placeholder="+91 …" className={inputCls} /></Field>
                <SearchableUserPicker label="Reports to" employees={employeeOptions} value={form.reportsTo} onChange={rid => patch({ reportsTo: rid })} excludeId={editing?.id} />
              </div>
              <p className="text-[12px] text-black/45 dark:text-white/45">Set up salary in Finance → Payroll once the account is created.</p>
              <div>
                <span className="text-[13px] font-semibold text-black/60 dark:text-white/60">Subjects taught</span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {editing && teachingOf(editing.id).length > 0
                    ? teachingOf(editing.id).map(x => <Pill key={x.id} tone="indigo">{x.label}</Pill>)
                    : <span className="text-[13px] text-black/45 dark:text-white/45">No subjects assigned yet.</span>}
                </div>
                <p className="mt-1.5 text-[12px] text-black/45 dark:text-white/45">Assign subjects in Classes & Sections → Subjects & teachers.</p>
              </div>
            </div>
          )}

          {form.role === 'staff' && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Department">
                  <select value={form.department} onChange={e => patch({ department: e.target.value })} className={inputCls}>
                    <option value="">Select department</option>
                    {Array.from(new Set([...departmentOptions, 'Administration', 'Finance', 'Admissions', 'Operations'])).map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </Field>
                <Field label="Designation"><input value={form.designation} onChange={e => patch({ designation: e.target.value })} placeholder="e.g. Office Superintendent" className={inputCls} /></Field>
                <Field label="Joining date"><input type="date" value={form.joinDate} onChange={e => patch({ joinDate: e.target.value })} className={inputCls} /></Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Phone"><input value={form.phone} onChange={e => patch({ phone: e.target.value })} placeholder="+91 …" className={inputCls} /></Field>
                <SearchableUserPicker label="Reports to" employees={employeeOptions} value={form.reportsTo} onChange={rid => patch({ reportsTo: rid })} excludeId={editing?.id} />
              </div>
            </div>
          )}

          {(form.role === 'admin' || form.role === 'superadmin') && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Designation"><input value={form.designation} onChange={e => patch({ designation: e.target.value })} placeholder="e.g. School Administrator" className={inputCls} /></Field>
                <Field label="Access scope">
                  <select value={form.department} onChange={e => patch({ department: e.target.value })} className={inputCls}>
                    <option value="">Select scope</option>
                    <option value="Full access">Full access</option>
                    <option value="Finance">Finance only</option>
                    <option value="Academics">Academics only</option>
                    <option value="Admissions">Admissions only</option>
                  </select>
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Phone"><input value={form.phone} onChange={e => patch({ phone: e.target.value })} placeholder="+91 …" className={inputCls} /></Field>
                <SearchableUserPicker label="Reports to" employees={employeeOptions} value={form.reportsTo} onChange={rid => patch({ reportsTo: rid })} excludeId={editing?.id} />
              </div>
            </div>
          )}

          {!editing && (
            <p className="text-[12.5px] text-black/45 dark:text-white/45">A one-time password is generated on creation and shown once — copy it for the new user.</p>
          )}

          <div className="flex gap-3 pt-2">
            <button onClick={save} disabled={!canSave} className="btn-ink flex-1 py-3 text-[14px] font-semibold disabled:opacity-40">
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create account'}
            </button>
            <button onClick={() => navigate(-1)} disabled={saving} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-40">Cancel</button>
          </div>
        </div>
      </Card>
    </PortalPageShell>
  )
}
