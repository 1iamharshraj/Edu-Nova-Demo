import { useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Download, Eye, EyeOff, Lock, LockOpen, Paperclip, Pencil, Plus, Save, Trash2, Unlock } from 'lucide-react'
import { toast } from 'sonner'
import { useAcademic, useStore } from '@/lib/store'
import { api, downloadFile, errorMessage, uploadFile } from '@/lib/api'
import { isAdmin } from '@/lib/access'
import { compareClasses, type Assessment, type GradeScale, type HomeworkRec, type HomeworkSubmission, type SessionStatus, type StaffStatus } from '@/lib/data'
import { isoDate, sortedPeriods, useFetch, type TeacherTimetable } from '@/lib/hooks/useTimetable'
import {
  SESSION_STATUSES, STAFF_STATUSES, STATUS_LABEL, STATUS_SOLID, bandsForClass, downloadCsv, fmtDate, gradeFromBands, termForDate,
  useAssessments, useClassStudents, useGradeScales, useHomework, useSessions, useStaffAttendance, useTeachableClassSubjects,
} from '@/lib/hooks/useAcademics'
import { Avatar, Card, Empty, Field, Modal, PageHead, Pill, TermTabs, inputCls, statusTone } from '../ui'
import { useActiveTerm } from './viewer'

// Teacher/office screens for Phase 3: attendance capture & management, the gradebook and homework authoring.
// Re-exported from office.tsx so the Portal registry keeps importing from one place.

const ghostBtn = 'flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/15 px-3.5 py-2 text-[13px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06] disabled:opacity-40'
const dangerBtn = 'flex items-center gap-1.5 rounded-full bg-rose-50 dark:bg-rose-500/10 px-3.5 py-2 text-[13px] font-semibold text-rose-500 hover:bg-rose-100 disabled:opacity-40'
const loadingRow = (text: string) => <div className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">{text}</div>
const daysAgo = (n: number) => isoDate(new Date(Date.now() - n * 86400000))

function StatusToggle<S extends SessionStatus>({ value, options, onChange, disabled }: { value: S; options: S[]; onChange: (s: S) => void; disabled?: boolean }) {
  return (
    <div className="flex gap-1">
      {options.map(s => (
        <button key={s} onClick={() => onChange(s)} disabled={disabled} title={STATUS_LABEL[s]}
          className={`flex h-9 w-9 items-center justify-center rounded-lg text-[12px] font-bold transition-colors disabled:cursor-not-allowed ${value === s ? STATUS_SOLID[s] : 'bg-black/[.05] dark:bg-white/[.07] text-black/40 dark:text-white/40 hover:bg-black/10 dark:hover:bg-white/15'}`}>
          {s}
        </button>
      ))}
    </div>
  )
}

/* ── Teacher: take attendance ──────────────────────────── */

export function TakeAttendanceMod() {
  const { db, user } = useStore()
  const { classesTaughtBy, classById, templateFor, terms, currentTerm, gradeById } = useAcademic()
  const myClasses = useMemo(() => (user ? [...classesTaughtBy(user.id)] : []).sort(compareClasses(gradeById)), [classesTaughtBy, user, gradeById])
  const [picked, setPicked] = useState('')
  const classId = myClasses.some(c => c.id === picked) ? picked : (myClasses[0]?.id ?? '')
  const cls = classById.get(classId)
  const [date, setDate] = useState(() => isoDate(new Date()))
  const termRec = termForDate(terms, date, currentTerm)
  const students = useClassStudents(classId)

  // Period choices = the teacher's own timetable entries with this class on that weekday, plus "Whole day".
  const tt = useFetch<TeacherTimetable>(user && termRec ? `/timetable/teacher/${user.id}?termId=${encodeURIComponent(termRec.id)}` : null)
  const dow = new Date(`${date}T00:00:00`).getDay()
  const periodOptions = useMemo(() => {
    const ps = sortedPeriods(templateFor(classId))
    return (tt.data?.entries ?? [])
      .filter(e => e.classId === classId && e.dayOfWeek === dow)
      .map(e => ({ idx: e.periodIdx, label: ps.find(p => p.idx === e.periodIdx)?.label ?? `Period ${e.periodIdx}`, subject: e.subjectName }))
      .sort((a, b) => a.idx - b.idx)
  }, [tt.data, classId, dow, templateFor])
  const [periodPick, setPeriodPick] = useState('day')
  const period = periodOptions.some(p => String(p.idx) === periodPick) ? periodPick : 'day'
  const periodIdx = period === 'day' ? null : Number(period)

  const sessions = useSessions(classId, date, date)
  const existing = sessions.items?.find(s => (s.periodIdx ?? null) === periodIdx)
  const serverStatus = useMemo(() => new Map((existing?.records ?? []).map(r => [r.studentId, r.status])), [existing])
  const locked = !!existing?.lockedAt

  // Local edits overlay the saved session, scoped to class × date × period so a picker change never leaks a draft.
  const scope = `${classId}|${date}|${period}`
  const [edits, setEdits] = useState<{ scope: string; cells: Record<string, SessionStatus> }>({ scope, cells: {} })
  const cells = edits.scope === scope ? edits.cells : {}
  const dirty = Object.keys(cells).length > 0
  const statusOf = (id: string): SessionStatus => cells[id] ?? serverStatus.get(id) ?? 'P'
  const setStatus = (id: string, s: SessionStatus) => setEdits({ scope, cells: { ...cells, [id]: s } })
  const markAll = () => setEdits({ scope, cells: Object.fromEntries(students.map(s => [s.id, 'P' as SessionStatus])) })
  const counts = students.reduce((acc, s) => { const st = statusOf(s.id); acc[st] = (acc[st] ?? 0) + 1; return acc }, {} as Partial<Record<SessionStatus, number>>)

  const [busy, setBusy] = useState<'save' | 'lock' | null>(null)
  const save = async () => {
    setBusy('save')
    try {
      await api.post('/attendance/sessions', { classId, date, periodIdx: periodIdx ?? undefined, records: students.map(s => ({ studentId: s.id, status: statusOf(s.id) })) })
      setEdits({ scope, cells: {} })
      sessions.reload()
      toast.success(`Attendance saved — ${counts.P ?? 0}/${students.length} present`)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const lock = async () => {
    if (!existing) return
    setBusy('lock')
    try {
      await api.post(`/attendance/sessions/${existing.id}/lock`)
      sessions.reload()
      toast.success('Session locked — only an admin can change it now')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const markedBy = existing ? db.users.find(u => u.id === existing.markedById)?.name : undefined

  return (
    <div>
      <PageHead title="Take Attendance" sub={cls ? `${cls.label} · ${students.length} students` : 'No class assigned to you yet'}>
        <div className="flex flex-wrap items-center gap-2">
          {myClasses.length > 1 && (
            <select value={classId} onChange={e => setPicked(e.target.value)} className={`${inputCls} w-auto py-2 text-[13.5px]`} aria-label="Class">
              {myClasses.map(c => <option key={c.id} value={c.id}>{c.label} · {c.boardCode}</option>)}
            </select>
          )}
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className={`${inputCls} w-auto py-2 text-[13.5px]`} aria-label="Date" />
          <select value={period} onChange={e => setPeriodPick(e.target.value)} className={`${inputCls} w-auto py-2 text-[13.5px]`} aria-label="Period">
            <option value="day">Whole day</option>
            {periodOptions.map(p => <option key={p.idx} value={String(p.idx)}>{p.label}{p.subject ? ` · ${p.subject}` : ''}</option>)}
          </select>
        </div>
      </PageHead>

      {myClasses.length === 0 ? <Empty text="No classes assigned to you yet. Ask the admin to assign you in Academic Setup." />
        : students.length === 0 ? <Empty text={`No students enrolled in ${cls?.label ?? 'this class'} yet.`} />
        : (
          <Card className="p-0">
            <div className="flex flex-wrap items-center gap-3 border-b border-black/[.06] dark:border-white/[.08] px-6 py-4">
              <p className="text-[14px] font-semibold">{counts.P ?? 0} of {students.length} present</p>
              {(['A', 'L', 'E'] as SessionStatus[]).map(s => (counts[s] ?? 0) > 0 && <Pill key={s} tone={s === 'A' ? 'rose' : s === 'L' ? 'amber' : 'sky'}>{counts[s]} {STATUS_LABEL[s].toLowerCase()}</Pill>)}
              {sessions.loading ? <span className="text-[12.5px] text-black/40 dark:text-white/40">checking saved…</span>
                : existing ? (locked ? <Pill tone="slate"><Lock size={11} /> Locked{markedBy ? ` · ${markedBy}` : ''}</Pill> : <Pill tone="green"><Check size={11} /> Saved{markedBy ? ` · ${markedBy}` : ''}</Pill>)
                : <Pill tone="amber">Not taken yet</Pill>}
              {dirty && <Pill tone="rose">Unsaved</Pill>}
              <span className="flex-1" />
              <button onClick={markAll} disabled={locked} className="text-[12.5px] font-semibold text-indigo-600 hover:underline disabled:opacity-40">Mark all present</button>
            </div>
            {students.map((s, i) => (
              <div key={s.id} className="flex items-center gap-4 border-b border-black/[.05] dark:border-white/[.07] px-6 py-3 last:border-0">
                <span className="w-7 text-[13px] font-semibold text-black/35 dark:text-white/35">{s.rollNo ?? i + 1}</span>
                <Avatar name={s.name} hue={s.avatarHue} size={34} />
                <span className="flex-1 text-[14.5px] font-medium">{s.name}</span>
                <StatusToggle value={statusOf(s.id)} options={SESSION_STATUSES} onChange={st => setStatus(s.id, st)} disabled={locked} />
              </div>
            ))}
            <div className="flex flex-wrap gap-3 p-5">
              <button onClick={save} disabled={locked || !!busy || (!!existing && !dirty)} className="btn-ink flex flex-1 items-center justify-center gap-2 py-3.5 text-[14.5px] font-semibold disabled:opacity-40">
                <Save size={16} /> {busy === 'save' ? 'Saving…' : existing ? 'Save changes' : 'Save attendance'}
              </button>
              {existing && !locked && (
                <button onClick={lock} disabled={!!busy || dirty} title={dirty ? 'Save first' : 'Lock this session'} className={ghostBtn}><Lock size={14} /> Lock</button>
              )}
              {locked && <p className="flex items-center gap-2 text-[12.5px] text-black/45 dark:text-white/45"><Lock size={13} /> Locked on {fmtDate(existing?.lockedAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} — ask an admin to unlock.</p>}
            </div>
          </Card>
        )}
    </div>
  )
}

/* ── Staff / admin: attendance management ──────────────── */

export function AttendanceMgmtMod() {
  const { db, user } = useStore()
  const { classes, currentYear, templateFor, classSubjects, subjectById, gradeById } = useAcademic()
  const admin = isAdmin(user)
  const [tab, setTab] = useState<'students' | 'staff'>('students')
  const classList = useMemo(() => classes.filter(c => !currentYear || c.academicYearId === currentYear.id).sort(compareClasses(gradeById)), [classes, currentYear, gradeById])

  // students
  const [picked, setPicked] = useState('')
  const classId = classList.some(c => c.id === picked) ? picked : (classList[0]?.id ?? '')
  const cls = classList.find(c => c.id === classId)
  const [from, setFrom] = useState(() => daysAgo(6))
  const [to, setTo] = useState(() => isoDate(new Date()))
  const sessions = useSessions(classId, from, to)
  const students = useClassStudents(classId)
  const studentName = (id: string) => students.find(s => s.id === id)?.name ?? db.users.find(u => u.id === id)?.name ?? id
  const periodLabel = (idx?: number | null) => idx === null || idx === undefined ? 'Whole day' : (sortedPeriods(templateFor(classId)).find(p => p.idx === idx)?.label ?? `Period ${idx}`)
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const sessionAction = async (id: string, verb: 'lock' | 'unlock' | 'delete') => {
    if (verb === 'delete' && !confirm('Delete this attendance session and all its records?')) return
    setBusy(id)
    try {
      if (verb === 'delete') await api.del(`/attendance/sessions/${id}`)
      else await api.post(`/attendance/sessions/${id}/${verb}`)
      sessions.reload()
      toast.success(verb === 'lock' ? 'Session locked' : verb === 'unlock' ? 'Session unlocked' : 'Session deleted')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const list = useMemo(() => [...(sessions.items ?? [])].sort((a, b) => b.date.localeCompare(a.date) || (a.periodIdx ?? -1) - (b.periodIdx ?? -1)), [sessions.items])
  const exportStudents = () => {
    const rows: (string | number | undefined)[][] = [['Date', 'Period', 'Roll', 'Student', 'Status', 'Note', 'Locked']]
    list.forEach(s => s.records.forEach(r => rows.push([s.date, periodLabel(s.periodIdx), students.find(x => x.id === r.studentId)?.rollNo, studentName(r.studentId), STATUS_LABEL[r.status], r.note, s.lockedAt ? 'yes' : 'no'])))
    downloadCsv(`attendance_${cls?.label ?? 'class'}_${from}_${to}.csv`, rows)
    toast.success('CSV exported')
  }

  // staff
  const [date, setDate] = useState(() => isoDate(new Date()))
  const staffQ = useStaffAttendance(tab === 'staff' ? date : undefined)
  const people = useMemo(() => db.users.filter(u => u.role === 'teacher' || u.role === 'staff' || u.role === 'admin').sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name)), [db.users])
  const subjectsOf = (teacherId: string) => [...new Set(classSubjects.filter(cs => cs.teacherId === teacherId).map(cs => subjectById.get(cs.subjectId)?.name).filter((n): n is string => !!n))]
  const serverStaff = useMemo(() => new Map((staffQ.items ?? []).map(r => [r.userId, r.status])), [staffQ.items])
  const [staffEdits, setStaffEdits] = useState<{ date: string; cells: Record<string, StaffStatus> }>({ date, cells: {} })
  const staffCells = staffEdits.date === date ? staffEdits.cells : {}
  const staffStatus = (id: string): StaffStatus => staffCells[id] ?? serverStaff.get(id) ?? 'P'
  const staffDirty = Object.keys(staffCells).length > 0
  const saveStaff = async () => {
    setBusy('staff')
    try {
      await Promise.all(Object.entries(staffCells).map(([userId, status]) => api.post('/attendance/staff', { userId, date, status })))
      setStaffEdits({ date, cells: {} })
      staffQ.reload()
      toast.success(`Staff attendance saved for ${fmtDate(date)}`)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const exportStaff = () => {
    downloadCsv(`staff_attendance_${date}.csv`, [['Date', 'Name', 'Role', 'Status'], ...people.map(p => [date, p.name, p.role, STATUS_LABEL[staffStatus(p.id)]])])
    toast.success('CSV exported')
  }
  const staffCounts = people.reduce((acc, p) => { const s = staffStatus(p.id); acc[s] = (acc[s] ?? 0) + 1; return acc }, {} as Partial<Record<StaffStatus, number>>)

  const tabBtn = (id: typeof tab, label: string) => (
    <button onClick={() => setTab(id)} className={`rounded-full px-4 py-2 text-[13px] font-semibold ${tab === id ? 'bg-black text-white' : 'bg-white dark:bg-[#14141f] text-black/60 dark:text-white/60 ring-1 ring-black/10 dark:ring-white/15'}`}>{label}</button>
  )

  return (
    <div>
      <PageHead title="Attendance Management" sub={tab === 'students' ? 'Sessions teachers have taken, per class · lock, unlock, export' : 'Daily attendance for teachers, staff and admins'}>
        <div className="flex gap-2">{tabBtn('students', 'Students')}{tabBtn('staff', 'Staff')}</div>
      </PageHead>

      {tab === 'students' ? (
        <>
          <div className="mb-5 flex flex-wrap items-end gap-3">
            <Field label="Class">
              <select value={classId} onChange={e => setPicked(e.target.value)} className={`${inputCls} w-auto min-w-[160px]`} disabled={classList.length === 0}>
                {classList.map(c => <option key={c.id} value={c.id}>{c.label} · {c.boardCode}</option>)}
              </select>
            </Field>
            <Field label="From"><input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} className={`${inputCls} w-auto`} /></Field>
            <Field label="To"><input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} className={`${inputCls} w-auto`} /></Field>
            <span className="flex-1" />
            <button onClick={exportStudents} disabled={list.length === 0} className={ghostBtn}><Download size={13} /> Export CSV</button>
          </div>
          <Card className="p-0">
            {classList.length === 0 ? <div className="p-6"><Empty text="Create classes in Academic Setup first." /></div>
              : sessions.loading ? loadingRow('Loading sessions…')
              : sessions.error ? <div className="p-6"><Empty text={sessions.error} /></div>
              : list.length === 0 ? <div className="p-6"><Empty text={`No attendance sessions for ${cls?.label ?? 'this class'} between ${fmtDate(from)} and ${fmtDate(to)}.`} /></div>
              : list.map(s => {
                const c = s.records.reduce((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc }, {} as Partial<Record<SessionStatus, number>>)
                const expanded = open === s.id
                const by = db.users.find(u => u.id === s.markedById)?.name
                return (
                  <div key={s.id} className="border-b border-black/[.05] dark:border-white/[.07] last:border-0">
                    <div className="flex flex-wrap items-center gap-3 px-6 py-3.5">
                      <button onClick={() => setOpen(expanded ? null : s.id)} className="flex items-center gap-2 text-left">
                        {expanded ? <ChevronDown size={15} className="text-black/40 dark:text-white/40" /> : <ChevronRight size={15} className="text-black/40 dark:text-white/40" />}
                        <span className="text-[14px] font-semibold">{fmtDate(s.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                        <Pill tone="indigo">{periodLabel(s.periodIdx)}</Pill>
                      </button>
                      <span className="text-[12.5px] text-black/45 dark:text-white/45">{by ? `by ${by}` : ''}</span>
                      <span className="flex-1" />
                      <span className="text-[12.5px] font-semibold text-emerald-600">{c.P ?? 0} P</span>
                      <span className="text-[12.5px] font-semibold text-rose-500">{c.A ?? 0} A</span>
                      <span className="text-[12.5px] font-semibold text-amber-600">{(c.L ?? 0) + (c.E ?? 0)} L/E</span>
                      {s.lockedAt ? <Pill tone="slate"><Lock size={11} /> Locked</Pill> : <Pill tone="green"><LockOpen size={11} /> Open</Pill>}
                      {s.lockedAt
                        ? (admin && <button onClick={() => sessionAction(s.id, 'unlock')} disabled={busy === s.id} className={ghostBtn}><Unlock size={13} /> Unlock</button>)
                        : <button onClick={() => sessionAction(s.id, 'lock')} disabled={busy === s.id} className={ghostBtn}><Lock size={13} /> Lock</button>}
                      {admin && <button onClick={() => sessionAction(s.id, 'delete')} disabled={busy === s.id} className={dangerBtn} aria-label="Delete session"><Trash2 size={13} /></button>}
                    </div>
                    {expanded && (
                      <div className="grid gap-1.5 bg-black/[.02] dark:bg-white/[.03] px-6 py-4 sm:grid-cols-2 lg:grid-cols-3">
                        {[...s.records].sort((a, b) => studentName(a.studentId).localeCompare(studentName(b.studentId))).map(r => (
                          <div key={r.id} className="flex items-center gap-2.5 rounded-xl bg-white dark:bg-[#14141f] px-3 py-2 text-[13px]">
                            <span className={`flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-bold ${STATUS_SOLID[r.status]}`}>{r.status}</span>
                            <span className="flex-1 truncate font-medium">{studentName(r.studentId)}</span>
                            {r.note && <span className="truncate text-[12px] text-black/45 dark:text-white/45">{r.note}</span>}
                          </div>
                        ))}
                        {s.records.length === 0 && <p className="text-[13px] text-black/40 dark:text-white/40">No records in this session.</p>}
                      </div>
                    )}
                  </div>
                )
              })}
          </Card>
        </>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-end gap-3">
            <Field label="Date"><input type="date" value={date} onChange={e => setDate(e.target.value)} className={`${inputCls} w-auto`} /></Field>
            <div className="flex flex-wrap gap-2 pb-1">
              {STAFF_STATUSES.map(s => <Pill key={s} tone={s === 'P' ? 'green' : s === 'A' ? 'rose' : s === 'L' ? 'amber' : 'sky'}>{staffCounts[s] ?? 0} {STATUS_LABEL[s]}</Pill>)}
            </div>
            <span className="flex-1" />
            <button onClick={exportStaff} disabled={people.length === 0} className={ghostBtn}><Download size={13} /> Export CSV</button>
            <button onClick={saveStaff} disabled={!staffDirty || busy === 'staff'} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40"><Save size={14} /> {busy === 'staff' ? 'Saving…' : 'Save'}</button>
          </div>
          <Card className="p-0">
            {staffQ.loading ? loadingRow('Loading…')
              : staffQ.error ? <div className="p-6"><Empty text={staffQ.error} /></div>
              : people.length === 0 ? <div className="p-6"><Empty text="No teachers or staff yet." /></div>
              : people.map((p, i) => (
                <div key={p.id} className="flex flex-wrap items-center gap-4 border-b border-black/[.05] dark:border-white/[.07] px-6 py-3 last:border-0">
                  <span className="w-7 text-[13px] font-semibold text-black/35 dark:text-white/35">{i + 1}</span>
                  <Avatar name={p.name} hue={p.avatarHue} size={36} />
                  <div className="flex-1">
                    <p className="text-[14px] font-semibold">{p.name}</p>
                    <p className="text-[12px] capitalize text-black/45 dark:text-white/45">{p.role}{p.department ? ` · ${p.department}` : subjectsOf(p.id).length ? ` · ${subjectsOf(p.id).join(', ')}` : ''}</p>
                  </div>
                  {!serverStaff.has(p.id) && !(p.id in staffCells) && <span className="text-[11.5px] text-black/35 dark:text-white/35">not marked</span>}
                  <StatusToggle value={staffStatus(p.id)} options={STAFF_STATUSES} onChange={s => setStaffEdits({ date, cells: { ...staffCells, [p.id]: s } })} />
                </div>
              ))}
          </Card>
        </>
      )}
    </div>
  )
}

/* ── Teacher: gradebook ────────────────────────────────── */

interface AssessmentForm { name: string; maxMarks: string; weight: string; date: string }
const emptyAssessment = (): AssessmentForm => ({ name: '', maxMarks: '100', weight: '1', date: '' })

export function GradebookMod() {
  const { db, user } = useStore()
  const rows = useTeachableClassSubjects()
  const { term, setTerm } = useActiveTerm()
  const [picked, setPicked] = useState('')
  const row = rows.find(r => r.cs.id === picked) ?? rows[0]
  const csId = row?.cs.id
  const students = useClassStudents(row?.cls.id)
  const { items, loading, error, reload } = useAssessments({ classSubjectId: csId, termId: term })
  const assessments = useMemo(() => [...(items ?? [])].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.name.localeCompare(b.name)), [items])
  const { items: scales, reload: reloadScales } = useGradeScales()
  const bands = bandsForClass(scales, row?.cls)

  // score edits overlay the server marks, scoped to class-subject × term
  const serverScore = (aId: string, sId: string) => assessments.find(a => a.id === aId)?.marks?.find(m => m.studentId === sId)?.score
  const scope = `${csId}|${term}`
  const [edits, setEdits] = useState<{ scope: string; cells: Record<string, string> }>({ scope, cells: {} })
  const cells = useMemo(() => (edits.scope === scope ? edits.cells : {}), [edits, scope])
  const key = (aId: string, sId: string) => `${aId}|${sId}`
  const valueOf = (aId: string, sId: string) => (key(aId, sId) in cells ? cells[key(aId, sId)] : (serverScore(aId, sId) ?? '').toString())
  const setCell = (aId: string, sId: string, raw: string) => {
    const v = raw.replace(/[^\d.]/g, '')
    const k = key(aId, sId)
    const { [k]: _, ...rest } = cells; void _
    setEdits({ scope, cells: v === (serverScore(aId, sId) ?? '').toString() ? rest : { ...rest, [k]: v } })
  }
  const dirtyIds = useMemo(() => new Set(Object.keys(cells).map(k => k.split('|')[0])), [cells])
  const invalid = (aId: string, v: string) => { const a = assessments.find(x => x.id === aId); return v !== '' && (isNaN(Number(v)) || (!!a && Number(v) > a.maxMarks)) }
  const anyInvalid = Object.entries(cells).some(([k, v]) => invalid(k.split('|')[0], v))

  const [busy, setBusy] = useState<string | null>(null)
  const saveMarks = async () => {
    setBusy('save')
    try {
      for (const aId of dirtyIds) {
        const marks = Object.entries(cells).filter(([k, v]) => k.startsWith(`${aId}|`) && v !== '').map(([k, v]) => ({ studentId: k.split('|')[1], score: Number(v) }))
        if (marks.length) await api.put(`/assessments/${aId}/marks`, { marks })
      }
      setEdits({ scope, cells: {} })
      reload()
      toast.success('Marks saved')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const assessmentAction = async (a: Assessment, verb: 'publish' | 'unpublish' | 'delete') => {
    if (verb === 'delete' && !confirm(`Delete "${a.name}" and all its marks?`)) return
    setBusy(a.id)
    try {
      if (verb === 'delete') await api.del(`/assessments/${a.id}`)
      else await api.post(`/assessments/${a.id}/${verb}`)
      reload()
      toast.success(verb === 'publish' ? `${a.name} published — students can see it now` : verb === 'unpublish' ? `${a.name} hidden from students` : `${a.name} deleted`)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  // add / edit assessment
  const [editing, setEditing] = useState<{ id?: string; form: AssessmentForm } | null>(null)
  const openNew = () => setEditing({ form: emptyAssessment() })
  const openEdit = (a: Assessment) => setEditing({ id: a.id, form: { name: a.name, maxMarks: String(a.maxMarks), weight: String(a.weight ?? 1), date: a.date ?? '' } })
  const formOk = !!editing && editing.form.name.trim() !== '' && Number(editing.form.maxMarks) > 0 && Number(editing.form.weight) > 0
  const submitForm = async () => {
    if (!editing || !formOk || !csId) return
    setBusy('form')
    const body = { name: editing.form.name.trim(), maxMarks: Number(editing.form.maxMarks), weight: Number(editing.form.weight), date: editing.form.date || undefined }
    try {
      if (editing.id) await api.patch(`/assessments/${editing.id}`, body)
      else await api.post('/assessments', { classSubjectId: csId, termId: term, ...body })
      setEditing(null)
      reload()
      toast.success(editing.id ? 'Assessment updated' : 'Assessment added')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  // weighted aggregate per student over assessments that have a score
  const aggregate = (sId: string) => {
    let num = 0, den = 0
    assessments.forEach(a => {
      const v = valueOf(a.id, sId)
      if (v === '' || isNaN(Number(v)) || !a.maxMarks) return
      const w = a.weight ?? 1
      num += (Number(v) / a.maxMarks) * w
      den += w
    })
    return den ? Math.round((num / den) * 100) : undefined
  }

  const header = (
    <PageHead title="Gradebook" sub={row ? `${row.cls.label} · ${row.subject?.name ?? 'Subject'}${row.teacher ? ` · ${row.teacher.name}` : ''}` : 'Assessments and marks per class and subject'}>
      <div className="flex flex-wrap items-center gap-2">
        {rows.length > 0 && (
          <select value={csId ?? ''} onChange={e => setPicked(e.target.value)} className={`${inputCls} w-auto min-w-[180px] py-2 text-[13.5px]`} aria-label="Class subject">
            {rows.map(r => <option key={r.cs.id} value={r.cs.id}>{r.label}</option>)}
          </select>
        )}
        <TermTabs terms={db.terms} term={term} setTerm={setTerm} />
      </div>
    </PageHead>
  )

  if (rows.length === 0) return <div>{header}<Empty text={user?.role === 'teacher' ? 'No subjects assigned to you yet. Ask the admin to assign you under Classes & Sections → Subjects.' : 'No class subjects yet — set up classes and their curriculum first.'} /></div>
  if (!term) return <div>{header}<Empty text="Create a term first — assessments belong to a term." /></div>

  return (
    <div>
      {header}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {dirtyIds.size > 0 && <Pill tone="rose">Unsaved changes</Pill>}
        {anyInvalid && <Pill tone="rose">Some scores exceed the maximum</Pill>}
        <span className="text-[12.5px] text-black/45 dark:text-white/45">{assessments.length} assessment{assessments.length === 1 ? '' : 's'} · {students.length} students</span>
        <span className="flex-1" />
        <button onClick={openNew} className={ghostBtn}><Plus size={13} /> Add assessment</button>
        <button onClick={() => setEdits({ scope, cells: {} })} disabled={dirtyIds.size === 0 || !!busy} className={ghostBtn}>Discard</button>
        <button onClick={saveMarks} disabled={dirtyIds.size === 0 || anyInvalid || !!busy} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40"><Save size={14} /> {busy === 'save' ? 'Saving…' : 'Save marks'}</button>
      </div>

      <Card className="overflow-x-auto p-0">
        {loading ? loadingRow('Loading gradebook…')
          : error ? <div className="p-6"><Empty text={error} /></div>
          : students.length === 0 ? <div className="p-6"><Empty text={`No students enrolled in ${row?.cls.label ?? 'this class'} yet.`} /></div>
          : assessments.length === 0 ? <div className="p-6"><Empty text="No assessments for this term yet — add one to start entering marks." /></div>
          : (
            <table className="w-full min-w-[640px] text-[13.5px]">
              <thead>
                <tr className="border-b border-black/[.06] dark:border-white/[.08] text-left">
                  <th className="sticky left-0 z-10 bg-white px-5 py-3 font-semibold text-black/50 dark:bg-[#14141f] dark:text-white/50">Student</th>
                  {assessments.map(a => (
                    <th key={a.id} className="px-3 py-3 text-center align-top font-semibold">
                      <div className="flex flex-col items-center gap-1">
                        <span className="whitespace-nowrap">{a.name}</span>
                        <span className="text-[11.5px] font-medium text-black/45 dark:text-white/45">/{a.maxMarks}{(a.weight ?? 1) !== 1 ? ` · ×${a.weight}` : ''}{a.date ? ` · ${fmtDate(a.date)}` : ''}</span>
                        <div className="flex items-center gap-1">
                          {a.publishedAt ? <Pill tone="green">Published</Pill> : <Pill tone="amber">Draft</Pill>}
                          <button onClick={() => assessmentAction(a, a.publishedAt ? 'unpublish' : 'publish')} disabled={busy === a.id || dirtyIds.has(a.id)} title={dirtyIds.has(a.id) ? 'Save marks first' : a.publishedAt ? 'Hide from students' : 'Publish to students'} className="rounded-full p-1.5 hover:bg-black/[.05] dark:hover:bg-white/[.08] disabled:opacity-40">
                            {a.publishedAt ? <EyeOff size={13} /> : <Eye size={13} />}
                          </button>
                          <button onClick={() => openEdit(a)} className="rounded-full p-1.5 hover:bg-black/[.05] dark:hover:bg-white/[.08]" title="Edit"><Pencil size={13} /></button>
                          <button onClick={() => assessmentAction(a, 'delete')} disabled={busy === a.id} className="rounded-full p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 disabled:opacity-40" title="Delete"><Trash2 size={13} /></button>
                        </div>
                      </div>
                    </th>
                  ))}
                  <th className="px-4 py-3 text-center font-semibold text-black/50 dark:text-white/50">Aggregate</th>
                </tr>
              </thead>
              <tbody>
                {students.map(s => {
                  const agg = aggregate(s.id)
                  return (
                    <tr key={s.id} className="border-b border-black/[.05] dark:border-white/[.07] last:border-0">
                      <td className="sticky left-0 z-10 bg-white px-5 py-2 dark:bg-[#14141f]">
                        <div className="flex items-center gap-3">
                          <span className="w-6 text-[12px] font-semibold text-black/35 dark:text-white/35">{s.rollNo ?? ''}</span>
                          <Avatar name={s.name} hue={s.avatarHue} size={28} />
                          <span className="whitespace-nowrap font-medium">{s.name}</span>
                        </div>
                      </td>
                      {assessments.map(a => {
                        const v = valueOf(a.id, s.id)
                        const changed = key(a.id, s.id) in cells
                        const bad = invalid(a.id, v)
                        return (
                          <td key={a.id} className="px-3 py-2 text-center">
                            <input value={v} onChange={e => setCell(a.id, s.id, e.target.value)} inputMode="decimal" placeholder="—" aria-label={`${s.name} ${a.name}`}
                              className={`w-16 rounded-lg border bg-white px-2 py-1.5 text-center text-[13.5px] outline-none transition focus:ring-4 focus:ring-indigo-100 dark:bg-[#14141f] ${bad ? 'border-rose-400 text-rose-600' : changed ? 'border-indigo-400' : 'border-black/10 dark:border-white/15'}`} />
                          </td>
                        )
                      })}
                      <td className="px-4 py-2 text-center">
                        {agg === undefined ? <span className="text-black/30 dark:text-white/30">—</span> : (
                          <span className="inline-flex items-center gap-2"><span className="font-semibold tabular-nums">{agg}%</span><Pill tone={agg >= 75 ? 'green' : agg >= 40 ? 'amber' : 'rose'}>{gradeFromBands(agg, bands)}</Pill></span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
      </Card>

      {isAdmin(user) && <GradeScales scales={scales ?? []} reload={reloadScales} />}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit assessment' : `New assessment · ${row?.label ?? ''}`}>
        {editing && (
          <div className="space-y-4">
            <Field label="Name"><input value={editing.form.name} onChange={e => setEditing({ ...editing, form: { ...editing.form, name: e.target.value } })} placeholder="e.g. Unit Test 1" className={inputCls} autoFocus /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Max marks"><input type="number" min={1} value={editing.form.maxMarks} onChange={e => setEditing({ ...editing, form: { ...editing.form, maxMarks: e.target.value } })} className={inputCls} /></Field>
              <Field label="Weight"><input type="number" min={0.1} step={0.1} value={editing.form.weight} onChange={e => setEditing({ ...editing, form: { ...editing.form, weight: e.target.value } })} className={inputCls} /></Field>
              <Field label="Date"><input type="date" value={editing.form.date} onChange={e => setEditing({ ...editing, form: { ...editing.form, date: e.target.value } })} className={inputCls} /></Field>
            </div>
            <p className="text-[12.5px] text-black/50 dark:text-white/50">Weight scales this assessment's share of the term aggregate (1 = equal to the others).</p>
            <div className="flex gap-3 pt-2">
              <button onClick={submitForm} disabled={!formOk || busy === 'form'} className="btn-ink flex-1 py-3 text-[14px] font-semibold disabled:opacity-40">{busy === 'form' ? 'Saving…' : editing.id ? 'Save' : 'Add'}</button>
              <button onClick={() => setEditing(null)} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Cancel</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

/* ── Admin: grade scales (inside the gradebook) ────────── */

const bandsToText = (bands: { min: number; grade: string }[]) => [...bands].sort((a, b) => b.min - a.min).map(b => `${b.grade} ${b.min}`).join('\n')
const parseBands = (text: string) => text.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
  const [grade, min] = l.split(/[\s:,]+/)
  return { grade, min: Number(min) }
})

function GradeScales({ scales, reload }: { scales: GradeScale[]; reload: () => void }) {
  const { boards } = useAcademic()
  const [editing, setEditing] = useState<{ id?: string; name: string; boardId: string; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const bands = editing ? parseBands(editing.text) : []
  const valid = bands.length > 0 && bands.every(b => b.grade && !isNaN(b.min) && b.min >= 0 && b.min <= 100) && bands.every((b, i) => i === 0 || b.min < bands[i - 1].min)
  const save = async () => {
    if (!editing || !valid) return
    setBusy(true)
    const body = { name: editing.name.trim(), boardId: editing.boardId || undefined, bands }
    try {
      if (editing.id) await api.patch(`/assessments/grade-scales/${editing.id}`, body)
      else await api.post('/assessments/grade-scales', body)
      setEditing(null)
      reload()
      toast.success('Grade scale saved')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const remove = async (s: GradeScale) => {
    if (!confirm(`Delete grade scale "${s.name}"?`)) return
    try { await api.del(`/assessments/grade-scales/${s.id}`); reload(); toast.success('Grade scale deleted') } catch (e) { toast.error(errorMessage(e)) }
  }
  return (
    <Card className="mt-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Grade scales</p>
          <p className="mt-0.5 text-[12.5px] text-black/45 dark:text-white/45">Report cards use the class board's scale, else the first one here, else the CBSE 8-point ladder.</p>
        </div>
        <button onClick={() => setEditing({ name: '', boardId: '', text: bandsToText([{ min: 91, grade: 'A1' }, { min: 81, grade: 'A2' }, { min: 71, grade: 'B1' }, { min: 61, grade: 'B2' }, { min: 51, grade: 'C1' }, { min: 41, grade: 'C2' }, { min: 33, grade: 'D' }, { min: 0, grade: 'E' }]) })} className={ghostBtn}><Plus size={13} /> New scale</button>
      </div>
      {scales.length === 0 ? <Empty text="No grade scales yet — the default CBSE ladder applies." /> : (
        <div className="grid gap-2 md:grid-cols-2">
          {scales.map(s => (
            <div key={s.id} className="flex items-start gap-3 rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3.5">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[14px] font-semibold">{s.name}{s.boardId && <Pill tone="sky">{boards.find(b => b.id === s.boardId)?.code ?? 'Board'}</Pill>}</p>
                <p className="mt-1 text-[12px] text-black/50 dark:text-white/50">{[...s.bands].sort((a, b) => b.min - a.min).map(b => `${b.grade} ≥${b.min}`).join(' · ')}</p>
              </div>
              <button onClick={() => setEditing({ id: s.id, name: s.name, boardId: s.boardId ?? '', text: bandsToText(s.bands) })} className="rounded-full p-1.5 hover:bg-black/[.05] dark:hover:bg-white/[.08]" title="Edit"><Pencil size={13} /></button>
              <button onClick={() => remove(s)} className="rounded-full p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10" title="Delete"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit grade scale' : 'New grade scale'}>
        {editing && (
          <div className="space-y-4">
            <Field label="Name"><input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. CBSE 8-point" className={inputCls} autoFocus /></Field>
            <Field label="Board (optional)">
              <select value={editing.boardId} onChange={e => setEditing({ ...editing, boardId: e.target.value })} className={inputCls}>
                <option value="">Any board</option>
                {boards.map(b => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
              </select>
            </Field>
            <Field label="Bands — one per line: grade, minimum %">
              <textarea value={editing.text} onChange={e => setEditing({ ...editing, text: e.target.value })} rows={8} className={`${inputCls} font-mono text-[13px]`} />
            </Field>
            {!valid && editing.text.trim() && <p className="text-[12.5px] text-rose-500">Minimums must be 0–100 and strictly decreasing from top to bottom.</p>}
            <div className="flex gap-3 pt-2">
              <button onClick={save} disabled={!valid || !editing.name.trim() || busy} className="btn-ink flex-1 py-3 text-[14px] font-semibold disabled:opacity-40">{busy ? 'Saving…' : 'Save'}</button>
              <button onClick={() => setEditing(null)} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Cancel</button>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  )
}

/* ── Teacher: create assignment (homework) ─────────────── */

export function CreateAssignmentMod() {
  const { db } = useStore()
  const rows = useTeachableClassSubjects()
  const { term, setTerm } = useActiveTerm()
  const [picked, setPicked] = useState('')
  const row = rows.find(r => r.cs.id === picked) ?? rows[0]
  const students = useClassStudents(row?.cls.id)
  const { items, loading, error, reload } = useHomework(row?.cls.id, term)
  const teachable = useMemo(() => new Set(rows.map(r => r.cs.id)), [rows])
  const list = useMemo(() => (items ?? []).filter(h => teachable.has(h.classSubjectId)).sort((a, b) => b.dueDate.localeCompare(a.dueDate)), [items, teachable])
  const subjectOf = (h: HomeworkRec) => h.subjectName ?? rows.find(r => r.cs.id === h.classSubjectId)?.subject?.name ?? 'Subject'

  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [due, setDue] = useState(() => isoDate(new Date(Date.now() + 7 * 86400000)))
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const canPost = !!row && !!title.trim() && !!due && !!term
  const create = async () => {
    if (!canPost || !row) return
    setBusy('create')
    try {
      const attachments: string[] = []
      for (const f of files) attachments.push((await uploadFile(f)).id)
      await api.post('/homework', { classSubjectId: row.cs.id, title: title.trim(), description: desc.trim(), dueDate: due, attachments })
      setTitle(''); setDesc(''); setFiles([])
      reload()
      toast.success('Assignment posted — students and parents can see it now')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const remove = async (h: HomeworkRec) => {
    if (!confirm(`Delete "${h.title}" and its submissions?`)) return
    setBusy(h.id)
    try { await api.del(`/homework/${h.id}`); reload(); toast.success('Assignment deleted') } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  // grading
  const [open, setOpen] = useState<string | null>(null)
  const [grading, setGrading] = useState<Record<string, { grade: string; feedback: string }>>({})
  const gKey = (hwId: string, sId: string) => `${hwId}|${sId}`
  const gradingOf = (hwId: string, sub?: HomeworkSubmission) => grading[gKey(hwId, sub?.studentId ?? '')] ?? { grade: sub?.grade ?? '', feedback: sub?.feedback ?? '' }
  const grade = async (hwId: string, sId: string, status: 'Graded' | 'Returned') => {
    const g = gradingOf(hwId, { studentId: sId } as HomeworkSubmission)
    setBusy(gKey(hwId, sId))
    try {
      await api.patch(`/homework/${hwId}/submissions/${sId}`, { grade: g.grade || undefined, feedback: g.feedback || undefined, status })
      setGrading(prev => { const { [gKey(hwId, sId)]: _, ...rest } = prev; void _; return rest })
      reload()
      toast.success(status === 'Graded' ? 'Graded' : 'Returned for revision')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const download = (id: string) => downloadFile(id).catch(e => toast.error(errorMessage(e)))

  return (
    <div>
      <PageHead title="Create Assignment" sub="Homework lands instantly in student & parent portals">
        <div className="flex flex-wrap items-center gap-2">
          {rows.length > 0 && (
            <select value={row?.cs.id ?? ''} onChange={e => setPicked(e.target.value)} className={`${inputCls} w-auto min-w-[180px] py-2 text-[13.5px]`} aria-label="Class subject">
              {rows.map(r => <option key={r.cs.id} value={r.cs.id}>{r.label}</option>)}
            </select>
          )}
          <TermTabs terms={db.terms} term={term} setTerm={setTerm} />
        </div>
      </PageHead>
      {rows.length === 0 ? <Empty text="No subjects assigned to you yet. Ask the admin to assign you under Classes & Sections → Subjects." /> : (
        <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
          <Card className="h-fit">
            <div className="space-y-4">
              <Field label="Title"><input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Circle theorems — worksheet 3" className={inputCls} /></Field>
              <Field label="Instructions"><textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} className={inputCls} /></Field>
              <Field label="Due date"><input type="date" value={due} onChange={e => setDue(e.target.value)} className={inputCls} /></Field>
              <label className="flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed border-black/15 dark:border-white/15 py-6 text-black/40 dark:text-white/40 hover:border-indigo-300 hover:text-indigo-500">
                <Paperclip size={22} />
                <span className="mt-2 text-[13px] font-medium">{files.length ? files.map(f => f.name).join(', ') : 'Attach files (pdf, docx, xlsx, images · ≤ 10 MB each)'}</span>
                <input type="file" multiple className="hidden" accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.txt" onChange={e => setFiles(Array.from(e.target.files ?? []))} />
              </label>
              <button onClick={create} disabled={!canPost || busy === 'create'} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy === 'create' ? 'Posting…' : 'Post assignment'}</button>
            </div>
          </Card>
          <Card>
            <p className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Posted this term{row ? ` · ${row.cls.label}` : ''}</p>
            {loading ? loadingRow('Loading…') : error ? <Empty text={error} /> : list.length === 0 ? <Empty text="No assignments posted for this term yet." /> : (
              <div className="space-y-3">
                {list.map(h => {
                  const subs = h.submissions ?? []
                  const expanded = open === h.id
                  return (
                    <div key={h.id} className="rounded-2xl bg-black/[.03] dark:bg-white/[.05]">
                      <div className="flex items-center gap-3 p-3.5">
                        <button onClick={() => setOpen(expanded ? null : h.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                          {expanded ? <ChevronDown size={15} className="shrink-0 text-black/40 dark:text-white/40" /> : <ChevronRight size={15} className="shrink-0 text-black/40 dark:text-white/40" />}
                          <div className="min-w-0">
                            <p className="truncate text-[13.5px] font-semibold">{h.title}</p>
                            <p className="text-[11.5px] text-black/45 dark:text-white/45">{subjectOf(h)} · due {fmtDate(h.dueDate)}{h.attachments.length ? ` · ${h.attachments.length} file${h.attachments.length === 1 ? '' : 's'}` : ''}</p>
                          </div>
                        </button>
                        <Pill tone={subs.length >= students.length && students.length > 0 ? 'green' : 'amber'}>{subs.length}/{students.length} submitted</Pill>
                        <button onClick={() => remove(h)} disabled={busy === h.id} className="rounded-full p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 disabled:opacity-40" title="Delete"><Trash2 size={13} /></button>
                      </div>
                      {expanded && (
                        <div className="space-y-2 border-t border-black/[.05] dark:border-white/[.07] p-3.5">
                          {h.description && <p className="text-[13px] text-black/60 dark:text-white/60">{h.description}</p>}
                          {h.attachments.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {h.attachments.map((id, i) => <button key={id} onClick={() => download(id)} className="flex items-center gap-1.5 rounded-full bg-white dark:bg-[#14141f] px-3 py-1.5 text-[12px] font-semibold ring-1 ring-black/10 dark:ring-white/15"><Download size={12} /> Attachment {i + 1}</button>)}
                            </div>
                          )}
                          {students.map(s => {
                            const sub = subs.find(x => x.studentId === s.id)
                            const g = gradingOf(h.id, sub ?? ({ studentId: s.id } as HomeworkSubmission))
                            const k = gKey(h.id, s.id)
                            return (
                              <div key={s.id} className="flex flex-wrap items-center gap-2.5 rounded-xl bg-white dark:bg-[#14141f] px-3 py-2">
                                <Avatar name={s.name} hue={s.avatarHue} size={26} />
                                <span className="min-w-[120px] flex-1 text-[13px] font-medium">{s.name}</span>
                                {sub ? (
                                  <>
                                    <Pill tone={statusTone(sub.status)}>{sub.status}</Pill>
                                    <span className="text-[11.5px] text-black/45 dark:text-white/45">{fmtDate(sub.submittedAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                    {sub.files.map((id, i) => <button key={id} onClick={() => download(id)} className="rounded-full p-1.5 hover:bg-black/[.05] dark:hover:bg-white/[.08]" title={`Download file ${i + 1}`}><Download size={13} /></button>)}
                                    <input value={g.grade} onChange={e => setGrading({ ...grading, [k]: { ...g, grade: e.target.value } })} placeholder="Grade" className={`${inputCls} w-20 py-1.5 text-[12.5px]`} />
                                    <input value={g.feedback} onChange={e => setGrading({ ...grading, [k]: { ...g, feedback: e.target.value } })} placeholder="Feedback" className={`${inputCls} min-w-[140px] flex-1 py-1.5 text-[12.5px]`} />
                                    <button onClick={() => grade(h.id, s.id, 'Graded')} disabled={busy === k} className="rounded-full bg-emerald-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">Grade</button>
                                    <button onClick={() => grade(h.id, s.id, 'Returned')} disabled={busy === k} className="rounded-full bg-black/[.06] dark:bg-white/[.08] px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40">Return</button>
                                  </>
                                ) : <span className="text-[12px] text-black/40 dark:text-white/40">Not submitted</span>}
                              </div>
                            )
                          })}
                          {students.length === 0 && <p className="text-[12.5px] text-black/40 dark:text-white/40">No students enrolled in this class yet.</p>}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
