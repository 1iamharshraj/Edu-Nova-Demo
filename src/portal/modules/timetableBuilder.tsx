import { useCallback, useMemo, useState } from 'react'
import { AlertTriangle, CalendarDays, Copy, Eye, EyeOff, Plus, RotateCcw, Save } from 'lucide-react'
import { toast } from 'sonner'
import { useAcademic, useStore } from '@/lib/store'
import { ApiError, api, errorMessage } from '@/lib/api'
import type { PeriodDef } from '@/lib/data'
import { DAY_LABELS, cellKey, daysFor, sortedPeriods, useEntryLookup, useFetch, type ClassTimetable, type TimetableEntryView } from '@/lib/hooks/useTimetable'
import { Card, Empty, Field, Modal, PageHead, Pill, inputCls } from '../ui'
import { FreeCell, PeriodCard, TimetableGrid } from './timetable'

interface DraftCell { classSubjectId: string; roomId?: string; teacherId?: string }
interface Conflict { rule: 'teacher' | 'room'; entryId?: string; classId?: string; classLabel?: string; dayOfWeek: number; periodIdx: number; teacherId?: string; roomId?: string }

const sameCell = (a: DraftCell | undefined, b: DraftCell | undefined) =>
  (!a && !b) || (!!a && !!b && a.classSubjectId === b.classSubjectId && (a.roomId ?? '') === (b.roomId ?? '') && (a.teacherId ?? '') === (b.teacherId ?? ''))
const toDraft = (e: TimetableEntryView): DraftCell => ({ classSubjectId: e.classSubjectId, roomId: e.roomId, teacherId: e.teacherId })

const ghostBtn = 'flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/15 px-3.5 py-2 text-[13px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06] disabled:opacity-40'

export function TimetableBuilderMod() {
  const { db } = useStore()
  const { classes, terms, currentYear, currentTerm, classSubjects, subjectById, rooms, templateFor, periodTemplates } = useAcademic()
  const lookup = useEntryLookup()

  // pickers — fall back to the current year's first class and the current term
  const classList = useMemo(() => classes.filter(c => !currentYear || c.academicYearId === currentYear.id).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })), [classes, currentYear])
  const [pickedClass, setPickedClass] = useState('')
  const [pickedTerm, setPickedTerm] = useState('')
  const classId = classList.some(c => c.id === pickedClass) ? pickedClass : (classList[0]?.id ?? '')
  const cls = classList.find(c => c.id === classId)
  const termList = useMemo(() => terms.filter(t => !cls || t.academicYearId === cls.academicYearId).sort((a, b) => a.startDate.localeCompare(b.startDate)), [terms, cls])
  const termId = termList.some(t => t.id === pickedTerm) ? pickedTerm : (termList.find(t => t.id === currentTerm?.id)?.id ?? termList[0]?.id ?? '')
  const scope = `${classId}|${termId}`

  const { data, loading, error, reload } = useFetch<ClassTimetable>(classId && termId ? `/timetable?classId=${encodeURIComponent(classId)}&termId=${encodeURIComponent(termId)}` : null)
  const template = data?.template ?? templateFor(classId)
  const periods = sortedPeriods(template)
  const serverEntries = useMemo(() => data?.entries ?? [], [data])
  // The server stores the resolved teacher on every entry; in the draft, a teacher equal to the subject's own
  // teacher is "no override" so switching the subject re-defaults the teacher instead of carrying the old one.
  const csTeacher = useMemo(() => new Map(classSubjects.map(cs => [cs.id, cs.teacherId])), [classSubjects])
  const normalize = useCallback((c: DraftCell): DraftCell =>
    ({ classSubjectId: c.classSubjectId, roomId: c.roomId || undefined, teacherId: c.teacherId && c.teacherId !== csTeacher.get(c.classSubjectId) ? c.teacherId : undefined }), [csTeacher])
  const serverByKey = useMemo(() => new Map(serverEntries.map(e => [cellKey(e.dayOfWeek, e.periodIdx), normalize(toDraft(e))])), [serverEntries, normalize])

  // Local edits are an overlay on the server grid (null = cleared), scoped to one class×term so a picker
  // change never leaks a draft into another grid.
  const [edits, setEdits] = useState<{ scope: string; cells: Record<string, DraftCell | null> }>({ scope, cells: {} })
  const cells = useMemo(() => (edits.scope === scope ? edits.cells : {}), [edits, scope])
  const dirty = Object.keys(cells).length > 0
  const cellAt = (key: string): DraftCell | undefined => (key in cells ? cells[key] ?? undefined : serverByKey.get(key))
  const setCell = (key: string, next: DraftCell | null) => {
    setConflicts([])
    setEdits({ scope, cells: (() => {
      const { [key]: _, ...rest } = cells; void _
      return sameCell(next ?? undefined, serverByKey.get(key)) ? rest : { ...rest, [key]: next }
    })() })
  }
  const discard = () => { setEdits({ scope, cells: {} }); setConflicts([]) }

  const [showSat, setShowSat] = useState(false)
  const grid = useMemo(() => {
    const out: { key: string; dayOfWeek: number; periodIdx: number; cell: DraftCell }[] = []
    for (const d of [1, 2, 3, 4, 5, 6]) for (const p of periods) {
      if (p.kind !== 'class') continue
      const key = cellKey(d, p.idx)
      const cell = key in cells ? cells[key] : serverByKey.get(key)
      if (cell) out.push({ key, dayOfWeek: d, periodIdx: p.idx, cell })
    }
    return out
  }, [cells, serverByKey, periods])
  const days = daysFor(grid, showSat)

  // class subjects with teacher names + per-week counters
  const subjectRows = useMemo(() => classSubjects.filter(cs => cs.classId === classId).map(cs => {
    const subject = subjectById.get(cs.subjectId)
    const teacher = cs.teacherId ? db.users.find(u => u.id === cs.teacherId) : undefined
    const count = grid.filter(g => g.cell.classSubjectId === cs.id).length
    return { cs, name: subject?.name ?? 'Subject', color: subject?.color ?? '#94a3b8', teacher, count }
  }).sort((a, b) => a.name.localeCompare(b.name)), [classSubjects, classId, subjectById, db.users, grid])
  const teachers = useMemo(() => db.users.filter(u => u.role === 'teacher'), [db.users])
  const roomList = useMemo(() => [...rooms].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })), [rooms])

  // cell editor
  const [editing, setEditing] = useState<{ dayOfWeek: number; period: PeriodDef } | null>(null)
  const [form, setForm] = useState<DraftCell>({ classSubjectId: '' })
  const openCell = (dayOfWeek: number, period: PeriodDef) => {
    const cur = cellAt(cellKey(dayOfWeek, period.idx))
    setForm(cur ? { ...cur } : { classSubjectId: subjectRows[0]?.cs.id ?? '' })
    setEditing({ dayOfWeek, period })
  }
  const applyCell = () => {
    if (!editing || !form.classSubjectId) return
    setCell(cellKey(editing.dayOfWeek, editing.period.idx), normalize(form))
    setEditing(null)
  }
  const clearCell = () => { if (editing) { setCell(cellKey(editing.dayOfWeek, editing.period.idx), null); setEditing(null) } }
  const formSubject = subjectRows.find(r => r.cs.id === form.classSubjectId)

  // save / conflicts
  const [busy, setBusy] = useState<'save' | 'publish' | 'copy' | null>(null)
  const [conflicts, setConflicts] = useState<Conflict[]>([])
  const conflictKeys = useMemo(() => new Set(conflicts.map(c => cellKey(c.dayOfWeek, c.periodIdx))), [conflicts])
  const save = async () => {
    setBusy('save')
    try {
      await api.put('/timetable/entries', {
        classId, termId,
        entries: grid.map(g => ({ dayOfWeek: g.dayOfWeek, periodIdx: g.periodIdx, classSubjectId: g.cell.classSubjectId, roomId: g.cell.roomId, teacherId: g.cell.teacherId })),
      })
      setEdits({ scope, cells: {} })
      setConflicts([])
      reload()
      toast.success('Timetable saved')
    } catch (e) {
      const body = e instanceof ApiError && e.status === 409 ? (e.body as { conflicts?: Conflict[] } | undefined) : undefined
      if (body?.conflicts?.length) {
        setConflicts(body.conflicts)
        toast.error(`${body.conflicts.length} clash${body.conflicts.length === 1 ? '' : 'es'} — nothing was saved`)
      } else toast.error(errorMessage(e))
    } finally { setBusy(null) }
  }
  const togglePublish = async () => {
    if (!data) return
    setBusy('publish')
    try {
      await api.post('/timetable/publish', { classId, termId, published: !data.published })
      reload()
      toast.success(data.published ? 'Timetable unpublished' : 'Timetable published')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  // copy from…
  const [copyOpen, setCopyOpen] = useState(false)
  const [copyFrom, setCopyFrom] = useState({ classId: '', termId: '' })
  const copyTerms = useMemo(() => {
    const c = classes.find(x => x.id === copyFrom.classId)
    return terms.filter(t => !c || t.academicYearId === c.academicYearId).sort((a, b) => a.startDate.localeCompare(b.startDate))
  }, [classes, terms, copyFrom.classId])
  const openCopy = () => { setCopyFrom({ classId: classList.find(c => c.id !== classId)?.id ?? classId, termId }); setCopyOpen(true) }
  const runCopy = async () => {
    setBusy('copy')
    try {
      const res = await api.post<{ copied: number; skipped: unknown[] }>('/timetable/copy', { fromClassId: copyFrom.classId, fromTermId: copyFrom.termId, toClassId: classId, toTermId: termId })
      setCopyOpen(false)
      setEdits({ scope, cells: {} })
      reload()
      const skipped = res.skipped?.length ?? 0
      toast.success(`Copied ${res.copied} period${res.copied === 1 ? '' : 's'}${skipped ? ` · ${skipped} skipped (subject not on this class)` : ''}`)
    } catch (e) {
      const body = e instanceof ApiError && e.status === 409 ? (e.body as { conflicts?: Conflict[] } | undefined) : undefined
      if (body?.conflicts?.length) { setConflicts(body.conflicts); setCopyOpen(false) }
      toast.error(errorMessage(e))
    } finally { setBusy(null) }
  }

  const conflictText = (c: Conflict) => {
    const who = c.rule === 'teacher' ? (lookup.userName(c.teacherId) ?? 'That teacher') : (roomList.find(r => r.id === c.roomId)?.name ?? 'That room')
    const period = periods.find(p => p.idx === c.periodIdx)?.label ?? `period ${c.periodIdx}`
    return `${who} is already booked${c.classLabel ? ` in ${c.classLabel}` : ''} on ${DAY_LABELS[c.dayOfWeek]} ${period}.`
  }

  const header = (
    <PageHead title="Timetable Builder" sub="Place each class's subjects on the week, save to check for clashes, then publish for students and parents">
      <div className="flex flex-wrap items-center gap-2">
        <select value={classId} onChange={e => setPickedClass(e.target.value)} className={inputCls + ' w-auto min-w-[150px] py-2 text-[13.5px]'} aria-label="Class" disabled={classList.length === 0}>
          {classList.map(c => <option key={c.id} value={c.id}>{c.label} · {c.boardCode}</option>)}
        </select>
        <select value={termId} onChange={e => setPickedTerm(e.target.value)} className={inputCls + ' w-auto min-w-[120px] py-2 text-[13.5px]'} aria-label="Term" disabled={termList.length === 0}>
          {termList.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
    </PageHead>
  )

  if (classList.length === 0) return <div>{header}<Empty text="Create a class in the current year first — timetables are built per class." /></div>
  if (termList.length === 0) return <div>{header}<Empty text="Create a term for this year first — every timetable belongs to a term." /></div>
  if (periodTemplates.length === 0 && !data?.template) return <div>{header}<Empty text="Define the school day under Periods first — the grid's columns come from the period template." /></div>

  return (
    <div>
      {header}

      {/* toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {data && (data.published ? <Pill tone="green">Published</Pill> : <Pill tone="amber">Draft</Pill>)}
        {dirty && <Pill tone="rose">Unsaved changes</Pill>}
        {template && <span className="text-[12.5px] text-black/45 dark:text-white/45">{template.name}{cls?.periodTemplateId ? ' · class override' : ''}</span>}
        <span className="flex-1" />
        <label className="flex items-center gap-2 text-[13px] font-medium text-black/60 dark:text-white/60">
          <input type="checkbox" checked={days.includes(6)} disabled={grid.some(g => g.dayOfWeek === 6)} onChange={e => setShowSat(e.target.checked)} className="h-4 w-4 accent-indigo-600" />
          Saturday
        </label>
        <button onClick={openCopy} disabled={!!busy || classList.length < 2 && termList.length < 2} className={ghostBtn} title="Copy another class's grid into this one (this grid must be empty)"><Copy size={13} /> Copy from…</button>
        <button onClick={togglePublish} disabled={!!busy || !data || dirty || (serverEntries.length === 0 && !data.published)} className={ghostBtn} title={dirty ? 'Save first' : undefined}>
          {data?.published ? <><EyeOff size={13} /> Unpublish</> : <><Eye size={13} /> Publish</>}
        </button>
        <button onClick={discard} disabled={!dirty || !!busy} className={ghostBtn}><RotateCcw size={13} /> Discard</button>
        <button onClick={save} disabled={!dirty || !!busy} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40"><Save size={14} /> {busy === 'save' ? 'Saving…' : 'Save'}</button>
      </div>

      {conflicts.length > 0 && (
        <div className="mb-4 rounded-2xl border border-rose-200 dark:border-rose-500/30 bg-rose-50/70 dark:bg-rose-500/10 p-4">
          <p className="flex items-center gap-2 text-[13.5px] font-semibold text-rose-700 dark:text-rose-300"><AlertTriangle size={15} /> Nothing was saved — resolve these clashes first</p>
          <ul className="mt-2 space-y-1 text-[13px] text-rose-700/90 dark:text-rose-300/90">
            {conflicts.map((c, i) => <li key={i}>• {conflictText(c)}</li>)}
          </ul>
        </div>
      )}

      {loading ? <div className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading grid…</div>
        : error ? <Empty text={error} />
        : !template ? <Empty text="No period template applies to this class." />
        : subjectRows.length === 0 ? <Empty text={`${cls?.label ?? 'This class'} has no subjects yet — add them under Classes & Sections → Subjects.`} />
        : (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_240px]">
            <div className="min-w-0">
              <TimetableGrid template={template} days={days} dense renderCell={(d, p) => {
                const key = cellKey(d, p.idx)
                const cell = cellAt(key)
                const changed = key in cells
                const clash = conflictKeys.has(key)
                if (!cell) {
                  return (
                    <button onClick={() => openCell(d, p)} className="group relative w-full text-left" aria-label={`Add period ${DAY_LABELS[d]} ${p.label}`}>
                      <FreeCell dense />
                      <span className="absolute inset-0 flex items-center justify-center text-black/20 opacity-0 transition group-hover:opacity-100 dark:text-white/20"><Plus size={16} /></span>
                    </button>
                  )
                }
                const row = subjectRows.find(r => r.cs.id === cell.classSubjectId)
                const teacher = cell.teacherId ? lookup.userName(cell.teacherId) : row?.teacher?.name
                return (
                  <button onClick={() => openCell(d, p)} className="w-full text-left" aria-label={`Edit ${DAY_LABELS[d]} ${p.label}`}>
                    <PeriodCard title={row?.name ?? 'Unknown subject'} color={row?.color ?? '#94a3b8'} teacher={teacher} room={cell.roomId ? roomList.find(r => r.id === cell.roomId)?.name : undefined}
                      className={`min-h-[76px] ${clash ? 'border-rose-400 ring-2 ring-rose-200 dark:ring-rose-500/30' : changed ? 'border-indigo-300 dark:border-indigo-500/40' : ''}`}
                      badge={clash ? <Pill tone="rose">Clash</Pill> : changed ? <span className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400">edited</span> : undefined} />
                  </button>
                )
              }} />
            </div>

            {/* side panel */}
            <Card className="h-fit p-5">
              <p className="mb-3 text-[12.5px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Periods per week</p>
              <div className="space-y-2.5">
                {subjectRows.map(r => {
                  const tone = r.count === r.cs.periodsPerWeek ? 'text-emerald-600 dark:text-emerald-400' : r.count > r.cs.periodsPerWeek ? 'text-rose-500' : 'text-amber-600 dark:text-amber-400'
                  return (
                    <div key={r.cs.id} className="flex items-center gap-2.5">
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: r.color }} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] font-semibold">{r.name}</p>
                        <p className="truncate text-[11.5px] text-black/45 dark:text-white/45">{r.teacher?.name ?? 'No teacher assigned'}</p>
                      </div>
                      <span className={`text-[13px] font-bold tabular-nums ${tone}`}>{r.count}/{r.cs.periodsPerWeek}</span>
                    </div>
                  )
                })}
              </div>
              <div className="mt-4 border-t border-black/[.06] dark:border-white/[.08] pt-3 text-[12px] text-black/45 dark:text-white/45">
                {grid.length} of {periods.filter(p => p.kind === 'class').length * days.length} slots filled
              </div>
            </Card>
          </div>
        )}

      {/* cell editor */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing ? `${DAY_LABELS[editing.dayOfWeek]} · ${editing.period.label} (${editing.period.start} – ${editing.period.end})` : ''}>
        {editing && (
          <div className="space-y-4">
            <Field label="Subject">
              <select value={form.classSubjectId} onChange={e => setForm({ ...form, classSubjectId: e.target.value, teacherId: undefined })} className={inputCls} autoFocus>
                {subjectRows.map(r => <option key={r.cs.id} value={r.cs.id}>{r.name}{r.teacher ? ` — ${r.teacher.name}` : ' — no teacher'}</option>)}
              </select>
            </Field>
            <Field label="Room">
              <select value={form.roomId ?? ''} onChange={e => setForm({ ...form, roomId: e.target.value || undefined })} className={inputCls}>
                <option value="">— none —</option>
                {roomList.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <Field label="Teacher override">
              <select value={form.teacherId ?? ''} onChange={e => setForm({ ...form, teacherId: e.target.value || undefined })} className={inputCls}>
                <option value="">{formSubject?.teacher ? `Subject teacher (${formSubject.teacher.name})` : 'Subject teacher (unassigned)'}</option>
                {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <div className="flex gap-3 pt-2">
              <button onClick={applyCell} disabled={!form.classSubjectId} className="btn-ink flex-1 py-3 text-[14px] font-semibold disabled:opacity-40">Apply</button>
              {cellAt(cellKey(editing.dayOfWeek, editing.period.idx)) && (
                <button onClick={clearCell} className="rounded-xl bg-rose-50 dark:bg-rose-500/10 px-5 py-3 text-[14px] font-semibold text-rose-500 hover:bg-rose-100">Clear</button>
              )}
              <button onClick={() => setEditing(null)} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Cancel</button>
            </div>
          </div>
        )}
      </Modal>

      {/* copy from */}
      <Modal open={copyOpen} onClose={() => setCopyOpen(false)} title={`Copy into ${cls?.label ?? 'class'}`}>
        <div className="space-y-4">
          <p className="text-[13.5px] text-black/60 dark:text-white/60">Copies every period from another class and term, matched by subject. Subjects this class doesn't have are skipped. This grid must be empty.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From class">
              <select value={copyFrom.classId} onChange={e => setCopyFrom({ classId: e.target.value, termId: '' })} className={inputCls}>
                {classes.map(c => <option key={c.id} value={c.id}>{c.label} · {c.boardCode}</option>)}
              </select>
            </Field>
            <Field label="From term">
              <select value={copyTerms.some(t => t.id === copyFrom.termId) ? copyFrom.termId : (copyTerms[0]?.id ?? '')} onChange={e => setCopyFrom({ ...copyFrom, termId: e.target.value })} className={inputCls}>
                {copyTerms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
          </div>
          {serverEntries.length > 0 && <p className="text-[12.5px] text-rose-500">This grid already has {serverEntries.length} period{serverEntries.length === 1 ? '' : 's'} — clear them and save before copying.</p>}
          <div className="flex gap-3 pt-2">
            <button onClick={() => { if (!copyFrom.termId) setCopyFrom(f => ({ ...f, termId: copyTerms[0]?.id ?? '' })); runCopy() }}
              disabled={busy === 'copy' || serverEntries.length > 0 || !copyFrom.classId || (copyFrom.classId === classId && (copyFrom.termId || copyTerms[0]?.id) === termId)}
              className="btn-ink flex flex-1 items-center justify-center gap-2 py-3 text-[14px] font-semibold disabled:opacity-40"><CalendarDays size={14} /> {busy === 'copy' ? 'Copying…' : 'Copy'}</button>
            <button onClick={() => setCopyOpen(false)} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Cancel</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
