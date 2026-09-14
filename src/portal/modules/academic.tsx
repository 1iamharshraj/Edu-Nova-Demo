import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { BookMarked, BookOpen, CalendarRange, ChevronDown, ChevronUp, Clock3, DoorOpen, GraduationCap, LayoutGrid, Pencil, Plus, Star, Trash2, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAcademic, useStore } from '@/lib/store'
import { useEntity } from '@/lib/hooks/useEntity'
import { api, errorMessage } from '@/lib/api'
import type { AcademicYear, BoardRec, ClassRec, Cohort, CohortType, CurriculumKind, CurriculumSubject, Grade, PeriodDef, PeriodKind, PeriodTemplate, Room, RoomKind, Stream, SubjectRec, TermRec } from '@/lib/data'
import { Avatar, Card, Empty, Field, Modal, PageHead, Pill, inputCls } from '../ui'
import { AsyncEntityPicker } from '../components/AsyncEntityPicker'
// Chrome primitives shared with the routed pages that used to be modals here (src/pages/portal/
// SubjectChapters.tsx, ClassSubjects.tsx, ClassRoster.tsx) live in academicShared.tsx, not here — a file
// mixing component and non-component exports breaks React Fast Refresh. See
// .agents/edunova/ui-architecture-fix.md, Phase C.
import { classPills, comboLabel, dangerBtn, ghostBtn, iconBtn, muted, nextRow, rowsValid, sectionLabel, STARTER_ROWS, swatch, type PeriodRow } from './academicShared'

/* ── shared bits ───────────────────────────────────────── */

const today = () => new Date().toISOString().slice(0, 10)
const rowCls = 'flex items-center gap-3 border-b border-black/[.05] dark:border-white/[.07] px-6 py-3.5 last:border-0'
const cardHead = 'flex items-center justify-between gap-3 border-b border-black/[.06] dark:border-white/[.08] px-6 py-3'

function DateRange({ start, end }: { start: string; end: string }) {
  return <span className={muted}>{start} → {end}</span>
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold">
      <Plus size={15} /> {label}
    </button>
  )
}

export function HeaderAdd({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex shrink-0 items-center gap-1.5 rounded-full bg-black/[.05] dark:bg-white/[.07] px-3 py-1.5 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">
      <Plus size={13} /> {label}
    </button>
  )
}

export function FormActions({ onCancel, onSave, label, disabled }: { onCancel: () => void; onSave: () => void; label: string; disabled?: boolean }) {
  return (
    <div className="flex gap-3 pt-2">
      <button onClick={onSave} disabled={disabled} className="btn-ink flex-1 py-3 text-[14px] font-semibold disabled:opacity-40">{label}</button>
      <button onClick={onCancel} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Cancel</button>
    </div>
  )
}

export function ConfirmModal({ open, title, body, action, busy, onClose, onConfirm }: {
  open: boolean; title: string; body: string; action: string; busy?: boolean; onClose: () => void; onConfirm: () => void
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <p className="text-[14px] text-black/60 dark:text-white/60">{body}</p>
        <div className="flex gap-3">
          <button onClick={onConfirm} disabled={busy} className="btn-ink flex-1 py-3 text-[14px] font-semibold bg-rose-600 hover:bg-rose-700 disabled:opacity-40">{action}</button>
          <button onClick={onClose} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Cancel</button>
        </div>
      </div>
    </Modal>
  )
}

const byDate = <T extends { startDate: string }>(a: T, b: T) => a.startDate.localeCompare(b.startDate)
const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name)
const byLabel = (a: ClassRec, b: ClassRec) => a.label.localeCompare(b.label, undefined, { numeric: true })
const byOrder = (a: Grade, b: Grade) => a.order - b.order || a.label.localeCompare(b.label, undefined, { numeric: true })

/* ── 1. Academic Years & Terms ─────────────────────────── */

interface DatedForm { label: string; startDate: string; endDate: string }
const emptyDated = (): DatedForm => ({ label: '', startDate: today(), endDate: today() })

export function AcademicYearsMod() {
  const { currentYear } = useAcademic()
  const years = useEntity('years')
  const terms = useEntity('terms')

  const sortedYears = useMemo(() => [...years.items].sort(byDate), [years.items])
  const [pickedId, setSelectedId] = useState<string>('')
  // fall back to the current year (or the first) when nothing valid is picked, without an effect
  const selectedId = sortedYears.some(y => y.id === pickedId) ? pickedId : (currentYear?.id ?? sortedYears[0]?.id ?? '')
  const selected = sortedYears.find(y => y.id === selectedId)
  const yearTerms = useMemo(() => terms.items.filter(t => t.academicYearId === selectedId).sort(byDate), [terms.items, selectedId])

  // year form
  const [yearOpen, setYearOpen] = useState(false)
  const [editYear, setEditYear] = useState<AcademicYear | null>(null)
  const [yearForm, setYearForm] = useState<DatedForm>(emptyDated)
  const openAddYear = () => { setEditYear(null); setYearForm(emptyDated()); setYearOpen(true) }
  const openEditYear = (y: AcademicYear) => { setEditYear(y); setYearForm({ label: y.label, startDate: y.startDate, endDate: y.endDate }); setYearOpen(true) }
  const saveYear = async () => {
    const body = { label: yearForm.label.trim(), startDate: yearForm.startDate, endDate: yearForm.endDate }
    const out = editYear ? await years.update(editYear.id, body, 'Academic year updated') : await years.create(body, 'Academic year created')
    if (out) { setYearOpen(false); if (!editYear) setSelectedId(out.id) }
  }

  // term form
  const [termOpen, setTermOpen] = useState(false)
  const [editTerm, setEditTerm] = useState<TermRec | null>(null)
  const [termForm, setTermForm] = useState<DatedForm>(emptyDated)
  const openAddTerm = () => {
    setEditTerm(null)
    setTermForm({ label: '', startDate: selected?.startDate ?? today(), endDate: selected?.endDate ?? today() })
    setTermOpen(true)
  }
  const openEditTerm = (t: TermRec) => { setEditTerm(t); setTermForm({ label: t.name, startDate: t.startDate, endDate: t.endDate }); setTermOpen(true) }
  const saveTerm = async () => {
    const body = { name: termForm.label.trim(), startDate: termForm.startDate, endDate: termForm.endDate }
    const out = editTerm ? await terms.update(editTerm.id, body, 'Term updated') : await terms.create({ ...body, academicYearId: selectedId }, 'Term created')
    if (out) setTermOpen(false)
  }

  // deletes
  const [delYear, setDelYear] = useState<AcademicYear | null>(null)
  const [delTerm, setDelTerm] = useState<TermRec | null>(null)

  const datedValid = (f: DatedForm) => f.label.trim() && f.startDate && f.endDate && f.startDate <= f.endDate

  const datedFields = (f: DatedForm, set: (f: DatedForm) => void, nameLabel: string, placeholder: string) => (
    <>
      <Field label={nameLabel}><input value={f.label} onChange={e => set({ ...f, label: e.target.value })} placeholder={placeholder} className={inputCls} autoFocus /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start date"><input type="date" value={f.startDate} onChange={e => set({ ...f, startDate: e.target.value })} className={inputCls} /></Field>
        <Field label="End date"><input type="date" value={f.endDate} onChange={e => set({ ...f, endDate: e.target.value })} className={inputCls} /></Field>
      </div>
      {f.startDate && f.endDate && f.startDate > f.endDate && <p className="text-[12.5px] text-rose-500">End date must be on or after the start date.</p>}
    </>
  )

  return (
    <div>
      <PageHead title="Academic Years & Terms" sub="Define the school year and split it into terms">
        {sortedYears.length > 0 && <AddButton label="Add year" onClick={openAddYear} />}
      </PageHead>

      {sortedYears.length === 0 ? (
        <Card className="flex flex-col items-center py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600"><CalendarRange size={26} /></div>
          <p className="mt-4 font-display text-xl font-medium">Start by creating the academic year</p>
          <p className="mt-1 max-w-sm text-[14px] text-black/50 dark:text-white/50">Terms, classes and enrollments all live inside an academic year. The first one you create becomes the current year.</p>
          <div className="mt-5"><AddButton label="Create academic year" onClick={openAddYear} /></div>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
          {/* years */}
          <Card className="p-0">
            <p className={`border-b border-black/[.06] dark:border-white/[.08] px-6 py-4 ${sectionLabel}`}>Academic years</p>
            {sortedYears.map(y => (
              <div key={y.id} onClick={() => setSelectedId(y.id)}
                className={`flex cursor-pointer flex-wrap items-center gap-3 border-b border-black/[.05] dark:border-white/[.07] px-6 py-3.5 last:border-0 transition-colors ${y.id === selectedId ? 'bg-indigo-50/60 dark:bg-indigo-500/10' : 'hover:bg-black/[.02] dark:hover:bg-white/[.03]'}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[14px] font-semibold">{y.label}</p>
                    {y.isCurrent && <Pill tone="green">Current</Pill>}
                  </div>
                  <DateRange start={y.startDate} end={y.endDate} />
                </div>
                <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                  {!y.isCurrent && (
                    <button onClick={() => years.action(y.id, 'set-current', `${y.label} is now the current year`)} disabled={years.busy} className={ghostBtn}>
                      <span className="flex items-center gap-1"><Star size={12} /> Set current</span>
                    </button>
                  )}
                  <button onClick={() => openEditYear(y)} className={iconBtn} aria-label="Edit"><Pencil size={14} /></button>
                  <button onClick={() => setDelYear(y)} className={dangerBtn} aria-label="Delete"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </Card>

          {/* terms */}
          <Card className="p-0">
            <div className={cardHead}>
              <p className={sectionLabel}>Terms{selected ? ` · ${selected.label}` : ''}</p>
              {selected && <HeaderAdd label="Add term" onClick={openAddTerm} />}
            </div>
            {!selected ? (
              <div className="p-6"><Empty text="Select a year to manage its terms." /></div>
            ) : yearTerms.length === 0 ? (
              <div className="p-6">
                <Empty text="No terms in this year yet." />
                <div className="mt-4 flex justify-center"><AddButton label="Add first term" onClick={openAddTerm} /></div>
              </div>
            ) : yearTerms.map(t => (
              <div key={t.id} className="flex flex-wrap items-center gap-3 border-b border-black/[.05] dark:border-white/[.07] px-6 py-3.5 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[14px] font-semibold">{t.name}</p>
                    {t.isCurrent && <Pill tone="green">Current</Pill>}
                  </div>
                  <DateRange start={t.startDate} end={t.endDate} />
                </div>
                <div className="flex items-center gap-2">
                  {!t.isCurrent && (
                    <button onClick={() => terms.action(t.id, 'set-current', `${t.name} is now the current term`)} disabled={terms.busy} className={ghostBtn}>
                      <span className="flex items-center gap-1"><Star size={12} /> Set current</span>
                    </button>
                  )}
                  <button onClick={() => openEditTerm(t)} className={iconBtn} aria-label="Edit"><Pencil size={14} /></button>
                  <button onClick={() => setDelTerm(t)} className={dangerBtn} aria-label="Delete"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </Card>
        </div>
      )}

      <Modal open={yearOpen} onClose={() => setYearOpen(false)} title={editYear ? 'Edit academic year' : 'New academic year'}>
        <div className="space-y-4">
          {datedFields(yearForm, setYearForm, 'Label', 'e.g. 2026-27')}
          <FormActions onCancel={() => setYearOpen(false)} onSave={saveYear} label={editYear ? 'Save changes' : 'Create year'} disabled={!datedValid(yearForm) || years.busy} />
        </div>
      </Modal>

      <Modal open={termOpen} onClose={() => setTermOpen(false)} title={editTerm ? 'Edit term' : `New term${selected ? ` · ${selected.label}` : ''}`}>
        <div className="space-y-4">
          {datedFields(termForm, setTermForm, 'Term name', 'e.g. Term 1')}
          <FormActions onCancel={() => setTermOpen(false)} onSave={saveTerm} label={editTerm ? 'Save changes' : 'Create term'} disabled={!datedValid(termForm) || terms.busy} />
        </div>
      </Modal>

      <ConfirmModal open={!!delYear} onClose={() => setDelYear(null)} title={`Delete ${delYear?.label ?? 'year'}?`}
        body="This deletes its terms and classes, along with every enrollment and subject assignment inside them. This cannot be undone."
        action="Delete year" busy={years.busy}
        onConfirm={async () => { if (delYear && await years.remove(delYear.id, 'Academic year deleted')) setDelYear(null) }} />

      <ConfirmModal open={!!delTerm} onClose={() => setDelTerm(null)} title={`Delete ${delTerm?.name ?? 'term'}?`}
        body="Marks, attendance and timetable entries keyed to this term will no longer have a term to belong to."
        action="Delete term" busy={terms.busy}
        onConfirm={async () => { if (delTerm && await terms.remove(delTerm.id, 'Term deleted')) setDelTerm(null) }} />
    </div>
  )
}

/* ── 2. Boards, grade ladder & streams ─────────────────── */

interface NamedForm { name: string; code: string }

export function BoardsMod() {
  const { refreshAcademic } = useStore()
  const boards = useEntity('boards')
  const grades = useEntity('grades')
  const streams = useEntity('streams')

  const sortedBoards = useMemo(() => [...boards.items].sort(byName), [boards.items])
  const ladder = useMemo(() => [...grades.items].sort(byOrder), [grades.items])
  const sortedStreams = useMemo(() => [...streams.items].sort(byName), [streams.items])

  // board form
  const [boardOpen, setBoardOpen] = useState(false)
  const [editBoard, setEditBoard] = useState<BoardRec | null>(null)
  const [boardForm, setBoardForm] = useState<NamedForm>({ name: '', code: '' })
  const openAddBoard = () => { setEditBoard(null); setBoardForm({ name: '', code: '' }); setBoardOpen(true) }
  const openEditBoard = (b: BoardRec) => { setEditBoard(b); setBoardForm({ name: b.name, code: b.code }); setBoardOpen(true) }
  const saveBoard = async () => {
    const body = { name: boardForm.name.trim(), code: boardForm.code.trim().toUpperCase() }
    const out = editBoard ? await boards.update(editBoard.id, body, 'Board updated') : await boards.create(body, 'Board added')
    if (out) setBoardOpen(false)
  }
  const [delBoard, setDelBoard] = useState<BoardRec | null>(null)

  // grade form
  const [gradeOpen, setGradeOpen] = useState(false)
  const [editGrade, setEditGrade] = useState<Grade | null>(null)
  const [gradeLabel, setGradeLabel] = useState('')
  const openAddGrade = () => { setEditGrade(null); setGradeLabel(''); setGradeOpen(true) }
  const openEditGrade = (g: Grade) => { setEditGrade(g); setGradeLabel(g.label); setGradeOpen(true) }
  const saveGrade = async () => {
    const label = gradeLabel.trim()
    const out = editGrade ? await grades.update(editGrade.id, { label }, 'Grade renamed') : await grades.create({ label }, 'Grade added')
    if (out) setGradeOpen(false)
  }
  const [delGrade, setDelGrade] = useState<Grade | null>(null)
  const [moving, setMoving] = useState(false)
  const moveGrade = async (index: number, dir: -1 | 1) => {
    const a = ladder[index], b = ladder[index + dir]
    if (!a || !b) return
    const next = [...ladder]
    next[index] = b; next[index + dir] = a
    // swap `order` with the neighbour; if the two happen to tie, renumber the ladder in its new sequence instead
    const patches = a.order === b.order
      ? next.map((g, i) => ({ id: g.id, order: i + 1 })).filter((p, i) => next[i].order !== p.order)
      : [{ id: a.id, order: b.order }, { id: b.id, order: a.order }]
    setMoving(true)
    try {
      await Promise.all(patches.map(p => api.patch(`/academic/grades/${p.id}`, { order: p.order })))
      await refreshAcademic()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setMoving(false)
    }
  }

  // stream form
  const [streamOpen, setStreamOpen] = useState(false)
  const [editStream, setEditStream] = useState<Stream | null>(null)
  const [streamName, setStreamName] = useState('')
  const openAddStream = () => { setEditStream(null); setStreamName(''); setStreamOpen(true) }
  const openEditStream = (s: Stream) => { setEditStream(s); setStreamName(s.name); setStreamOpen(true) }
  const saveStream = async () => {
    const body = { name: streamName.trim() }
    const out = editStream ? await streams.update(editStream.id, body, 'Stream updated') : await streams.create(body, 'Stream added')
    if (out) setStreamOpen(false)
  }
  const [delStream, setDelStream] = useState<Stream | null>(null)

  return (
    <div>
      <PageHead title="Boards & Grades" sub="The boards your school is affiliated to, the grade ladder from the first year to the last, and optional streams for senior grades" />

      <div className="grid gap-5 lg:grid-cols-3">
        {/* boards */}
        <Card className="p-0">
          <div className={cardHead}>
            <p className={sectionLabel}>Boards · {sortedBoards.length}</p>
            <HeaderAdd label="Add board" onClick={openAddBoard} />
          </div>
          {sortedBoards.length === 0 ? (
            <div className="p-6">
              <Empty text="No boards yet. Add the boards your school is affiliated to." />
              <div className="mt-4 flex justify-center"><AddButton label="Add first board" onClick={openAddBoard} /></div>
            </div>
          ) : sortedBoards.map(b => (
            <div key={b.id} className={rowCls}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold">{b.name}</p>
                <div className="mt-1"><Pill tone="indigo">{b.code}</Pill></div>
              </div>
              <button onClick={() => openEditBoard(b)} className={iconBtn} aria-label="Edit"><Pencil size={14} /></button>
              <button onClick={() => setDelBoard(b)} className={dangerBtn} aria-label="Delete"><Trash2 size={14} /></button>
            </div>
          ))}
        </Card>

        {/* grade ladder */}
        <Card className="p-0">
          <div className={cardHead}>
            <p className={sectionLabel}>Grade ladder · {ladder.length}</p>
            <HeaderAdd label="Add grade" onClick={openAddGrade} />
          </div>
          {ladder.length === 0 ? (
            <div className="p-6">
              <Empty text="No grades yet. Add them in order, from the first year to the last." />
              <div className="mt-4 flex justify-center"><AddButton label="Add first grade" onClick={openAddGrade} /></div>
            </div>
          ) : ladder.map((g, i) => (
            <div key={g.id} className={rowCls}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/[.05] dark:bg-white/[.07] text-[12px] font-semibold text-black/50 dark:text-white/50">{i + 1}</span>
              <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">{g.label}</p>
              <button onClick={() => moveGrade(i, -1)} disabled={i === 0 || moving} className={iconBtn} aria-label="Move up"><ChevronUp size={14} /></button>
              <button onClick={() => moveGrade(i, 1)} disabled={i === ladder.length - 1 || moving} className={iconBtn} aria-label="Move down"><ChevronDown size={14} /></button>
              <button onClick={() => openEditGrade(g)} className={iconBtn} aria-label="Rename"><Pencil size={14} /></button>
              <button onClick={() => setDelGrade(g)} className={dangerBtn} aria-label="Delete"><Trash2 size={14} /></button>
            </div>
          ))}
        </Card>

        {/* streams */}
        <Card className="p-0">
          <div className={cardHead}>
            <p className={sectionLabel}>Streams · {sortedStreams.length}</p>
            <HeaderAdd label="Add stream" onClick={openAddStream} />
          </div>
          {sortedStreams.length === 0 ? (
            <div className="p-6">
              <Empty text="No streams yet. Streams are optional — add them if senior grades split into groups." />
              <div className="mt-4 flex justify-center"><AddButton label="Add first stream" onClick={openAddStream} /></div>
            </div>
          ) : sortedStreams.map(s => (
            <div key={s.id} className={rowCls}>
              <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">{s.name}</p>
              <button onClick={() => openEditStream(s)} className={iconBtn} aria-label="Edit"><Pencil size={14} /></button>
              <button onClick={() => setDelStream(s)} className={dangerBtn} aria-label="Delete"><Trash2 size={14} /></button>
            </div>
          ))}
        </Card>
      </div>

      <Modal open={boardOpen} onClose={() => setBoardOpen(false)} title={editBoard ? `Edit ${editBoard.code}` : 'New board'}>
        <div className="space-y-4">
          <Field label="Name"><input value={boardForm.name} onChange={e => setBoardForm({ ...boardForm, name: e.target.value })} placeholder="e.g. Central Board of Secondary Education" className={inputCls} autoFocus /></Field>
          <Field label="Code"><input value={boardForm.code} onChange={e => setBoardForm({ ...boardForm, code: e.target.value.toUpperCase() })} placeholder="e.g. CBSE" className={inputCls} /></Field>
          <FormActions onCancel={() => setBoardOpen(false)} onSave={saveBoard} label={editBoard ? 'Save changes' : 'Add board'} disabled={!boardForm.name.trim() || !boardForm.code.trim() || boards.busy} />
        </div>
      </Modal>

      <Modal open={gradeOpen} onClose={() => setGradeOpen(false)} title={editGrade ? `Rename ${editGrade.label}` : 'New grade'}>
        <div className="space-y-4">
          <Field label="Label"><input value={gradeLabel} onChange={e => setGradeLabel(e.target.value)} placeholder="e.g. LKG, I, XII" className={inputCls} autoFocus onKeyDown={e => { if (e.key === 'Enter' && gradeLabel.trim()) saveGrade() }} /></Field>
          {!editGrade && <p className={muted}>New grades go to the bottom of the ladder — use the arrows to reorder.</p>}
          <FormActions onCancel={() => setGradeOpen(false)} onSave={saveGrade} label={editGrade ? 'Save changes' : 'Add grade'} disabled={!gradeLabel.trim() || grades.busy} />
        </div>
      </Modal>

      <Modal open={streamOpen} onClose={() => setStreamOpen(false)} title={editStream ? `Edit ${editStream.name}` : 'New stream'}>
        <div className="space-y-4">
          <Field label="Name"><input value={streamName} onChange={e => setStreamName(e.target.value)} placeholder="e.g. Science" className={inputCls} autoFocus onKeyDown={e => { if (e.key === 'Enter' && streamName.trim()) saveStream() }} /></Field>
          <FormActions onCancel={() => setStreamOpen(false)} onSave={saveStream} label={editStream ? 'Save changes' : 'Add stream'} disabled={!streamName.trim() || streams.busy} />
        </div>
      </Modal>

      <ConfirmModal open={!!delBoard} onClose={() => setDelBoard(null)} title={`Delete ${delBoard?.code ?? 'board'}?`}
        body="This removes every class under this board (with their enrollments and subject assignments) and its entire curriculum. This cannot be undone."
        action="Delete board" busy={boards.busy}
        onConfirm={async () => { if (delBoard && await boards.remove(delBoard.id, 'Board deleted')) setDelBoard(null) }} />

      <ConfirmModal open={!!delGrade} onClose={() => setDelGrade(null)} title={`Delete grade ${delGrade?.label ?? ''}?`}
        body="This removes every class in this grade across all boards, along with the curriculum defined for it. This cannot be undone."
        action="Delete grade" busy={grades.busy}
        onConfirm={async () => { if (delGrade && await grades.remove(delGrade.id, 'Grade deleted')) setDelGrade(null) }} />

      <ConfirmModal open={!!delStream} onClose={() => setDelStream(null)} title={`Delete ${delStream?.name ?? 'stream'}?`}
        body="Curriculum entries specific to this stream are removed. Classes in this stream are kept but will no longer have a stream."
        action="Delete stream" busy={streams.busy}
        onConfirm={async () => { if (delStream && await streams.remove(delStream.id, 'Stream deleted')) setDelStream(null) }} />
    </div>
  )
}

/* ── 3. Curriculum (subject catalogue + board/grade curriculum) ── */

const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316', '#64748b']

const KINDS: { value: CurriculumKind; label: string }[] = [
  { value: 'core', label: 'Core' },
  { value: 'elective', label: 'Elective' },
  { value: 'language', label: 'Language' },
]

interface SubjectForm { name: string; code: string; color: string }
const emptySubjectForm = (): SubjectForm => ({ name: '', code: '', color: PALETTE[0] })

/* ── chapter management (Phase 18) — per curriculum-subject, opened from the Curriculum table below ── */

// The chapter manager (per curriculum-subject) used to be `ChapterManagerModal` here — an outer modal wrapping
// its own nested add/edit/delete sub-modals. Converted to a real routed page,
// `/portal/academic/subjects/:id/chapters` (src/pages/portal/SubjectChapters.tsx) — see
// .agents/edunova/ui-architecture-fix.md. The nested add/edit form and delete-confirm stay as single-level
// modals ON that page; only the outer wrapper was eliminated.

export function CurriculumMod() {
  const navigate = useNavigate()
  const { boards, grades, streams, subjectById } = useAcademic()
  const subjects = useEntity('subjects')
  const curriculum = useEntity('curriculum')

  const sortedSubjects = useMemo(() => [...subjects.items].sort(byName), [subjects.items])
  const sortedBoards = useMemo(() => [...boards].sort(byName), [boards])
  const ladder = useMemo(() => [...grades].sort(byOrder), [grades])
  const sortedStreams = useMemo(() => [...streams].sort(byName), [streams])

  // catalogue form
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<SubjectRec | null>(null)
  const [form, setForm] = useState<SubjectForm>(emptySubjectForm)
  const openAdd = () => { setEditing(null); setForm({ ...emptySubjectForm(), color: PALETTE[sortedSubjects.length % PALETTE.length] }); setFormOpen(true) }
  const openEdit = (s: SubjectRec) => { setEditing(s); setForm({ name: s.name, code: s.code, color: s.color }); setFormOpen(true) }
  const save = async () => {
    const body = { name: form.name.trim(), code: form.code.trim(), color: form.color }
    const out = editing ? await subjects.update(editing.id, body, 'Subject updated') : await subjects.create(body, 'Subject created')
    if (out) setFormOpen(false)
  }
  const [del, setDel] = useState<SubjectRec | null>(null)

  // pickers — fall back to the first board/grade when nothing valid is picked
  const [pickedBoardId, setPickedBoardId] = useState('')
  const [pickedGradeId, setPickedGradeId] = useState('')
  const [pickedStreamId, setPickedStreamId] = useState('')
  const boardId = sortedBoards.some(b => b.id === pickedBoardId) ? pickedBoardId : (sortedBoards[0]?.id ?? '')
  const gradeId = ladder.some(g => g.id === pickedGradeId) ? pickedGradeId : (ladder[0]?.id ?? '')
  const streamId = sortedStreams.some(s => s.id === pickedStreamId) ? pickedStreamId : ''
  const board = sortedBoards.find(b => b.id === boardId)
  const grade = ladder.find(g => g.id === gradeId)
  const stream = sortedStreams.find(s => s.id === streamId)
  const combo = comboLabel(board, grade, stream)

  const rows = useMemo(() =>
    curriculum.items
      .filter(r => r.boardId === boardId && r.gradeId === gradeId && (r.streamId ?? '') === streamId)
      .map(r => ({ row: r, subject: subjectById.get(r.subjectId) }))
      .sort((a, b) => (a.subject?.name ?? '').localeCompare(b.subject?.name ?? '')),
  [curriculum.items, boardId, gradeId, streamId, subjectById])
  const inCombo = useMemo(() => new Set(rows.map(r => r.row.subjectId)), [rows])
  const addable = sortedSubjects.filter(s => !inCombo.has(s.id))

  const [addId, setAddId] = useState('')
  const [textbookDraft, setTextbookDraft] = useState<Record<string, string>>({})
  const addRow = async () => {
    if (!addId) return
    const out = await curriculum.create({ boardId, gradeId, streamId: streamId || undefined, subjectId: addId, kind: 'core' }, 'Subject added to curriculum')
    if (out) setAddId('')
  }
  const setKind = (r: CurriculumSubject, kind: CurriculumKind) => curriculum.update(r.id, { kind }, 'Kind updated')
  const commitTextbook = async (r: CurriculumSubject) => {
    const draft = textbookDraft[r.id]
    if (draft === undefined) return
    const next = draft.trim()
    setTextbookDraft(d => { const { [r.id]: _, ...rest } = d; void _; return rest })
    if (next === (r.textbook ?? '')) return
    // null clears the textbook on the server; the client type only knows `string | undefined`
    await curriculum.update(r.id, { textbook: (next || null) as unknown as string }, 'Textbook updated')
  }

  const ready = sortedBoards.length > 0 && ladder.length > 0

  const rowControls = (r: CurriculumSubject) => ({
    kind: (
      <select value={r.kind} onChange={e => setKind(r, e.target.value as CurriculumKind)} disabled={curriculum.busy} className={inputCls + ' py-2 text-[13.5px]'}>
        {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
      </select>
    ),
    textbook: (
      <input value={textbookDraft[r.id] ?? r.textbook ?? ''}
        onChange={e => setTextbookDraft(d => ({ ...d, [r.id]: e.target.value }))}
        onBlur={() => commitTextbook(r)}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        placeholder="Textbook (optional)" disabled={curriculum.busy} className={inputCls + ' py-2 text-[13.5px]'} />
    ),
    chapters: (
      <button onClick={() => navigate(`/portal/academic/subjects/${r.id}/chapters`)} className="flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/15 px-3 py-1.5 text-[12.5px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06]">
        <BookMarked size={13} /> Chapters
      </button>
    ),
    remove: (
      <button onClick={() => curriculum.remove(r.id, 'Removed from curriculum')} disabled={curriculum.busy} className={dangerBtn} aria-label="Remove from curriculum"><Trash2 size={14} /></button>
    ),
  })

  return (
    <div>
      <PageHead title="Curriculum" sub="Keep the subject catalogue, then build each board's grade-wise curriculum from it">
        <AddButton label="Add subject" onClick={openAdd} />
      </PageHead>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.7fr]">
        {/* catalogue */}
        <Card className="p-0">
          <div className={cardHead}>
            <p className={sectionLabel}>Subject catalogue · {sortedSubjects.length}</p>
            <HeaderAdd label="Add" onClick={openAdd} />
          </div>
          {sortedSubjects.length === 0 ? (
            <div className="p-6">
              <Empty text="No subjects yet. Add every subject taught in your school — the catalogue is shared across boards." />
              <div className="mt-4 flex justify-center"><AddButton label="Add first subject" onClick={openAdd} /></div>
            </div>
          ) : sortedSubjects.map(s => (
            <div key={s.id} className={rowCls}>
              {swatch(s.color, 14)}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold">{s.name}</p>
                <p className={muted}>{s.code || '—'}</p>
              </div>
              <button onClick={() => openEdit(s)} className={iconBtn} aria-label="Edit"><Pencil size={14} /></button>
              <button onClick={() => setDel(s)} className={dangerBtn} aria-label="Delete"><Trash2 size={14} /></button>
            </div>
          ))}
        </Card>

        {/* curriculum for one board + grade (+ stream) */}
        <Card className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/[.06] dark:border-white/[.08] px-6 py-3">
            <div>
              <p className={sectionLabel}>Curriculum{combo ? ` · ${combo}` : ''}</p>
              {ready && <p className={muted}>{rows.length} subject{rows.length === 1 ? '' : 's'}</p>}
            </div>
            {ready && (
              <div className="flex flex-wrap items-center gap-2">
                <select value={boardId} onChange={e => setPickedBoardId(e.target.value)} className={inputCls + ' w-auto min-w-[110px] py-2 text-[13.5px]'} aria-label="Board">
                  {sortedBoards.map(b => <option key={b.id} value={b.id}>{b.code}</option>)}
                </select>
                <select value={gradeId} onChange={e => setPickedGradeId(e.target.value)} className={inputCls + ' w-auto min-w-[90px] py-2 text-[13.5px]'} aria-label="Grade">
                  {ladder.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
                </select>
                <select value={streamId} onChange={e => setPickedStreamId(e.target.value)} className={inputCls + ' w-auto min-w-[120px] py-2 text-[13.5px]'} aria-label="Stream">
                  <option value="">No stream</option>
                  {sortedStreams.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
          </div>

          {!ready ? (
            <div className="p-6"><Empty text="Set up at least one board and one grade in Boards & Grades first — a curriculum belongs to a board and a grade." /></div>
          ) : sortedSubjects.length === 0 ? (
            <div className="p-6"><Empty text="Add subjects to the catalogue to start building this curriculum." /></div>
          ) : (
            <div className="space-y-5 p-4 md:p-6">
              <div className="rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-4">
                <p className={`mb-3 ${sectionLabel}`}>Add subject</p>
                {addable.length === 0 ? (
                  <p className="text-[13.5px] text-black/50 dark:text-white/50">Every catalogue subject is already part of this curriculum.</p>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    <select value={addId} onChange={e => setAddId(e.target.value)} className={inputCls + ' min-w-[200px] flex-1'}>
                      <option value="">Select a subject…</option>
                      {addable.map(s => <option key={s.id} value={s.id}>{s.name}{s.code ? ` (${s.code})` : ''}</option>)}
                    </select>
                    <button onClick={addRow} disabled={!addId || curriculum.busy} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40">
                      <Plus size={15} /> Add
                    </button>
                  </div>
                )}
              </div>

              {rows.length === 0 ? (
                <Empty text={`No subjects in the ${combo} curriculum yet. Add one from the catalogue above.`} />
              ) : (
                <div className="rounded-2xl border border-black/[.06] dark:border-white/[.08]">
                  {/* desktop table */}
                  <table className="hidden w-full text-left text-[14px] md:table">
                    <thead className="border-b border-black/[.06] dark:border-white/[.08]">
                      <tr className="text-[12px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">
                        <th className="px-4 py-3">Subject</th>
                        <th className="px-4 py-3">Kind</th>
                        <th className="px-4 py-3">Textbook</th>
                        <th className="px-4 py-3">Syllabus</th>
                        <th className="px-4 py-3 text-right"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({ row, subject }) => {
                        const ctl = rowControls(row)
                        return (
                          <tr key={row.id} className="border-b border-black/[.05] dark:border-white/[.07] last:border-0">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                {swatch(subject?.color ?? '#94a3b8')}
                                <div><p className="font-semibold">{subject?.name ?? 'Unknown subject'}</p><p className={muted}>{subject?.code || '—'}</p></div>
                              </div>
                            </td>
                            <td className="w-[140px] px-4 py-3">{ctl.kind}</td>
                            <td className="min-w-[180px] px-4 py-3">{ctl.textbook}</td>
                            <td className="px-4 py-3">{ctl.chapters}</td>
                            <td className="px-4 py-3 text-right">{ctl.remove}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>

                  {/* mobile cards */}
                  <div className="divide-y divide-black/[.05] dark:divide-white/[.07] md:hidden">
                    {rows.map(({ row, subject }) => {
                      const ctl = rowControls(row)
                      return (
                        <div key={row.id} className="p-4">
                          <div className="mb-3 flex items-center gap-3">
                            {swatch(subject?.color ?? '#94a3b8')}
                            <p className="flex-1 truncate font-semibold">{subject?.name ?? 'Unknown subject'}</p>
                            {ctl.remove}
                          </div>
                          <div className="grid gap-3">
                            <Field label="Kind">{ctl.kind}</Field>
                            <Field label="Textbook">{ctl.textbook}</Field>
                            <Field label="Syllabus">{ctl.chapters}</Field>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? `Edit ${editing.name}` : 'New subject'}>
        <div className="space-y-4">
          <Field label="Name"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Mathematics" className={inputCls} autoFocus /></Field>
          <Field label="Code"><input value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="e.g. MATH" className={inputCls} /></Field>
          <div>
            <span className="text-[13px] font-semibold text-black/60 dark:text-white/60">Colour</span>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {PALETTE.map(c => (
                <button key={c} type="button" onClick={() => setForm({ ...form, color: c })} aria-label={c}
                  className={`h-8 w-8 rounded-full transition ${form.color.toLowerCase() === c ? 'ring-2 ring-offset-2 ring-black dark:ring-white dark:ring-offset-[#14141f]' : 'ring-1 ring-black/10 hover:scale-110'}`}
                  style={{ background: c }} />
              ))}
              <label className="ml-1 flex h-8 items-center gap-2 rounded-full border border-black/10 dark:border-white/15 px-3 text-[12.5px] font-semibold">
                <input type="color" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0" />
                Custom
              </label>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3">
            {swatch(form.color, 16)}
            <span className="text-[14px] font-semibold">{form.name.trim() || 'Subject name'}</span>
            <span className={muted}>{form.code.trim() || 'CODE'}</span>
          </div>
          <FormActions onCancel={() => setFormOpen(false)} onSave={save} label={editing ? 'Save changes' : 'Create subject'} disabled={!form.name.trim() || subjects.busy} />
        </div>
      </Modal>

      <ConfirmModal open={!!del} onClose={() => setDel(null)} title={`Delete ${del?.name ?? 'subject'}?`}
        body="This removes the subject from the catalogue, from every curriculum it appears in, and from every class assignment that uses it."
        action="Delete subject" busy={subjects.busy}
        onConfirm={async () => { if (del && await subjects.remove(del.id, 'Subject deleted')) setDel(null) }} />
    </div>
  )
}

/** Kept for older imports — the Subjects screen is now the Curriculum screen. */
export function SubjectsMod() {
  return <CurriculumMod />
}

/* ── 4. Classes & Sections ─────────────────────────────── */

interface ClassForm { boardId: string; gradeId: string; streamId: string; section: string; classTeacherId: string; capacity: string; periodTemplateId: string }
const emptyClassForm = (): ClassForm => ({ boardId: '', gradeId: '', streamId: '', section: '', classTeacherId: '', capacity: '', periodTemplateId: '' })

// Manual-cohort types only — SECTION is reserved for the auto-generated 1:1 cohort (roadmap D2).
const COHORT_TYPES: { value: Exclude<CohortType, 'SECTION'>; label: string }[] = [
  { value: 'GRADE', label: 'Grade-wide' },
  { value: 'CROSS_SECTION', label: 'Cross-section' },
  { value: 'TRACK', label: 'Track (e.g. JEE/NEET)' },
  { value: 'ELECTIVE', label: 'Elective basket' },
]
interface CohortForm { name: string; type: Exclude<CohortType, 'SECTION'>; gradeId: string; classIds: string[] }
const emptyCohortForm = (): CohortForm => ({ name: '', type: 'CROSS_SECTION', gradeId: '', classIds: [] })

function YearSelect({ years, value, onChange }: { years: AcademicYear[]; value: string; onChange: (id: string) => void }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={inputCls + ' w-auto min-w-[160px]'}>
      {years.map(y => <option key={y.id} value={y.id}>{y.label}{y.isCurrent ? ' · current' : ''}</option>)}
    </select>
  )
}

export function ClassesMod() {
  const navigate = useNavigate()
  const { db } = useStore()
  const { years, currentYear, boards, grades, streams, enrollments: allEnrollments, periodTemplates, defaultTemplate } = useAcademic()
  const classes = useEntity('classes')
  const classSubjects = useEntity('classSubjects')
  const cohorts = useEntity('cohorts')

  const sortedYears = useMemo(() => [...years].sort(byDate), [years])
  const [pickedYearId, setYearId] = useState('')
  const yearId = sortedYears.some(y => y.id === pickedYearId) ? pickedYearId : (currentYear?.id ?? sortedYears[0]?.id ?? '')

  const sortedBoards = useMemo(() => [...boards].sort(byName), [boards])
  const ladder = useMemo(() => [...grades].sort(byOrder), [grades])
  const sortedStreams = useMemo(() => [...streams].sort(byName), [streams])
  const userById = useMemo(() => new Map(db.users.map(u => [u.id, u])), [db.users])
  const yearClasses = useMemo(() => classes.items.filter(c => c.academicYearId === yearId), [classes.items, yearId])
  const activeCount = (classId: string) => allEnrollments.filter(e => e.classId === classId && e.status === 'active').length

  // cards grouped by board, ordered by grade ladder then label within a board
  const groups = useMemo(() => {
    const gradeOrder = new Map(ladder.map(g => [g.id, g.order]))
    const byClass = (a: ClassRec, b: ClassRec) => (gradeOrder.get(a.gradeId) ?? 0) - (gradeOrder.get(b.gradeId) ?? 0) || byLabel(a, b)
    const byBoard = new Map<string, ClassRec[]>()
    yearClasses.forEach(c => byBoard.set(c.boardId, [...(byBoard.get(c.boardId) ?? []), c]))
    const known = sortedBoards.filter(b => byBoard.has(b.id)).map(b => ({ board: b, classes: byBoard.get(b.id)!.sort(byClass) }))
    // classes whose board isn't in the list any more (transient, between a delete and the refresh)
    const orphans = [...byBoard.entries()].filter(([id]) => !sortedBoards.some(b => b.id === id))
      .map(([id, list]) => ({ board: { id, name: list[0].boardCode, code: list[0].boardCode } as BoardRec, classes: list.sort(byClass) }))
    return [...known, ...orphans]
  }, [yearClasses, sortedBoards, ladder])

  // class form
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ClassRec | null>(null)
  const [form, setForm] = useState<ClassForm>(emptyClassForm)
  const openAdd = () => { setEditing(null); setForm({ ...emptyClassForm(), boardId: sortedBoards[0]?.id ?? '', gradeId: ladder[0]?.id ?? '' }); setFormOpen(true) }
  const openEdit = (c: ClassRec) => {
    setEditing(c)
    setForm({ boardId: c.boardId, gradeId: c.gradeId, streamId: c.streamId ?? '', section: c.section, classTeacherId: c.classTeacherId ?? '', capacity: c.capacity ? String(c.capacity) : '', periodTemplateId: c.periodTemplateId ?? '' })
    setFormOpen(true)
  }
  const save = async () => {
    // on edit, null clears an optional field on the server; on create we simply omit it
    const clear = (editing ? null : undefined) as unknown as undefined
    const body: Partial<ClassRec> = {
      boardId: form.boardId, gradeId: form.gradeId,
      streamId: form.streamId || clear,
      section: form.section.trim(),
      classTeacherId: form.classTeacherId || clear,
      capacity: form.capacity ? Number(form.capacity) : clear,
      periodTemplateId: form.periodTemplateId || clear,
    }
    const out = editing
      ? await classes.update(editing.id, body, 'Class updated')
      : await classes.create({ ...body, academicYearId: yearId }, 'Class created')
    if (out) setFormOpen(false)
  }
  const [del, setDel] = useState<ClassRec | null>(null)
  // The "Subjects & teachers" and "Roster" editors used to be mini list+editor modals opened from a class card
  // here. Converted to real routed pages — `/portal/academic/classes/:id/subjects`
  // (src/pages/portal/ClassSubjects.tsx) and `/portal/academic/classes/:id/roster`
  // (src/pages/portal/ClassRoster.tsx) — see .agents/edunova/ui-architecture-fix.md, Phase C.

  const setupReady = sortedBoards.length > 0 && ladder.length > 0
  const formValid = form.boardId && form.gradeId && form.section.trim()
  const selectedYear = sortedYears.find(y => y.id === yearId)
  // classPills is the module-level export above (also reused by ClassSubjects.tsx/ClassRoster.tsx pages)

  // ── Cohorts (Phase T1 §1 — layered on top of Class, per roadmap D2) ──
  // Every class gets an implicit 1:1 SECTION cohort automatically (server-side, on class create). This
  // panel surfaces those plus lets an admin define additional cross-section cohorts (grade-wide "12-ALL",
  // JEE/NEET tracks, elective baskets) referencing 2+ classes. Kept inside Classes & Sections (not a
  // separate sidebar page) — it's a light, occasional-use extension of "what classes exist this year", the
  // same judgment call already made for Subjects/Roster living inside a class card rather than get their
  // own top-level nav entry.
  const yearCohorts = useMemo(
    () => cohorts.items.filter(c => c.academicYearId === yearId).sort((a, b) => Number(b.autoGenerated) - Number(a.autoGenerated) || a.name.localeCompare(b.name)),
    [cohorts.items, yearId],
  )
  const [cohortFormOpen, setCohortFormOpen] = useState(false)
  const [editCohort, setEditCohort] = useState<Cohort | null>(null)
  const [cohortForm, setCohortForm] = useState<CohortForm>(emptyCohortForm)
  const openAddCohort = () => { setEditCohort(null); setCohortForm(emptyCohortForm()); setCohortFormOpen(true) }
  const openEditCohort = (c: Cohort) => {
    if (c.autoGenerated) return
    setEditCohort(c)
    setCohortForm({ name: c.name, type: c.type as CohortForm['type'], gradeId: c.gradeId ?? '', classIds: c.classIds })
    setCohortFormOpen(true)
  }
  const toggleCohortClass = (id: string) => setCohortForm(f => ({ ...f, classIds: f.classIds.includes(id) ? f.classIds.filter(x => x !== id) : [...f.classIds, id] }))
  const saveCohort = async () => {
    const name = cohortForm.name.trim()
    const out = editCohort
      ? await cohorts.update(editCohort.id, { name, gradeId: cohortForm.gradeId || null, classIds: cohortForm.classIds } as Partial<Cohort>, 'Cohort updated')
      : await cohorts.create({ name, type: cohortForm.type, gradeId: cohortForm.gradeId || undefined, classIds: cohortForm.classIds, academicYearId: yearId } as Partial<Cohort>, 'Cohort created')
    if (out) setCohortFormOpen(false)
  }
  const [delCohort, setDelCohort] = useState<Cohort | null>(null)
  const cohortFormValid = cohortForm.name.trim().length > 0 && cohortForm.classIds.length >= 2

  return (
    <div>
      <PageHead title="Classes & Sections" sub="Create classes per board and grade, assign class teachers, subjects and rosters">
        <div className="flex flex-wrap items-center gap-3">
          {sortedYears.length > 0 && <YearSelect years={sortedYears} value={yearId} onChange={setYearId} />}
          {selectedYear && setupReady && <AddButton label="Add class" onClick={openAdd} />}
        </div>
      </PageHead>

      {sortedYears.length === 0 ? (
        <Empty text="Create an academic year first — classes belong to a year." />
      ) : !setupReady ? (
        <Card className="flex flex-col items-center py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600"><GraduationCap size={26} /></div>
          <p className="mt-4 font-display text-xl font-medium">Set up boards and grades first</p>
          <p className="mt-1 max-w-sm text-[14px] text-black/50 dark:text-white/50">Every class belongs to a board and a grade. Add at least one of each under Boards & Grades, then come back to create sections.</p>
        </Card>
      ) : yearClasses.length === 0 ? (
        <Card className="flex flex-col items-center py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600"><LayoutGrid size={26} /></div>
          <p className="mt-4 font-display text-xl font-medium">No classes in {selectedYear?.label}</p>
          <p className="mt-1 max-w-sm text-[14px] text-black/50 dark:text-white/50">Pick a board, grade and section, choose a class teacher, then enrol students from the roster.</p>
          <div className="mt-5"><AddButton label="Add first class" onClick={openAdd} /></div>
        </Card>
      ) : (
        <div className="space-y-7">
          {groups.map(({ board, classes: list }) => (
            <section key={board.id}>
              <div className="mb-3 flex items-center gap-2">
                <p className="text-[15px] font-semibold">{board.name}</p>
                <Pill tone="indigo">{board.code}</Pill>
                <span className={muted}>{list.length} class{list.length === 1 ? '' : 'es'}</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {list.map(c => {
                  const teacher = c.classTeacherId ? userById.get(c.classTeacherId) : undefined
                  const count = activeCount(c.id)
                  const over = c.capacity !== undefined && count > c.capacity
                  const subjectCount = classSubjects.items.filter(cs => cs.classId === c.id).length
                  return (
                    <Card key={c.id} className="flex flex-col gap-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-display text-2xl font-medium tracking-tight">{c.label}</p>
                          <div className="mt-1.5">{classPills(c)}</div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => openEdit(c)} className={iconBtn} aria-label="Edit"><Pencil size={14} /></button>
                          <button onClick={() => setDel(c)} className={dangerBtn} aria-label="Delete"><Trash2 size={14} /></button>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {teacher ? <Avatar name={teacher.name} hue={teacher.avatarHue} size={36} /> : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/[.05] dark:bg-white/[.07] text-black/40 dark:text-white/40"><Users size={16} /></span>}
                        <div className="min-w-0">
                          <p className="truncate text-[14px] font-semibold">{teacher?.name ?? 'No class teacher'}</p>
                          <p className={muted}>Class teacher</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/[.06] dark:border-white/[.08] pt-4">
                        <div className="flex items-center gap-2 text-[13.5px]">
                          <span className="font-semibold">{count}</span>
                          <span className="text-black/50 dark:text-white/50">student{count === 1 ? '' : 's'}{c.capacity !== undefined ? ` / ${c.capacity}` : ''}</span>
                          {over && <Pill tone="rose">Over capacity</Pill>}
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => navigate(`/portal/academic/classes/${c.id}/subjects`)} className={ghostBtn}>
                            <span className="flex items-center gap-1"><BookOpen size={12} /> Subjects{subjectCount ? ` · ${subjectCount}` : ''}</span>
                          </button>
                          <button onClick={() => navigate(`/portal/academic/classes/${c.id}/roster`)} className={ghostBtn}>Roster</button>
                        </div>
                      </div>
                    </Card>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {selectedYear && setupReady && yearClasses.length > 0 && (
        <Card className="mt-5 p-0">
          <div className={cardHead}>
            <div>
              <p className={sectionLabel}>Cohorts · {selectedYear.label}</p>
              <p className={muted}>Every class has its own 1:1 section cohort automatically. Add a cohort here only when scheduling needs to treat 2+ classes as one group (grade-wide, JEE/NEET tracks, elective baskets).</p>
            </div>
            {yearClasses.length >= 2 && <HeaderAdd label="Add cohort" onClick={openAddCohort} />}
          </div>
          {yearCohorts.length === 0 ? (
            <div className="p-6"><Empty text="No cohorts yet." /></div>
          ) : yearCohorts.map(c => (
            <div key={c.id} className={rowCls}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-[14px] font-semibold">{c.name}</p>
                  {c.autoGenerated ? <Pill tone="slate">Auto</Pill> : <Pill tone="indigo">{COHORT_TYPES.find(t => t.value === c.type)?.label ?? c.type}</Pill>}
                </div>
                <p className={muted}>{c.classLabels.join(', ') || '—'}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => navigate(`/portal/academic/cohorts/${c.id}/requirements`)} className={ghostBtn} title="Define what this cohort needs taught each week — feeds Auto-Generate">
                  <span className="flex items-center gap-1"><BookOpen size={12} /> Teaching Requirements</span>
                </button>
                {!c.autoGenerated && (
                  <>
                    <button onClick={() => openEditCohort(c)} className={iconBtn} aria-label="Edit"><Pencil size={14} /></button>
                    <button onClick={() => setDelCohort(c)} className={dangerBtn} aria-label="Delete"><Trash2 size={14} /></button>
                  </>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}

      <Modal open={cohortFormOpen} onClose={() => setCohortFormOpen(false)} title={editCohort ? `Edit ${editCohort.name}` : `New cohort${selectedYear ? ` · ${selectedYear.label}` : ''}`} wide>
        <div className="space-y-4">
          <Field label="Name"><input value={cohortForm.name} onChange={e => setCohortForm({ ...cohortForm, name: e.target.value })} placeholder="e.g. XII-ALL, XII-JEE" className={inputCls} autoFocus /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select value={cohortForm.type} onChange={e => setCohortForm({ ...cohortForm, type: e.target.value as CohortForm['type'] })} className={inputCls} disabled={!!editCohort}>
                {COHORT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Grade (optional)">
              <select value={cohortForm.gradeId} onChange={e => setCohortForm({ ...cohortForm, gradeId: e.target.value })} className={inputCls}>
                <option value="">— none —</option>
                {ladder.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
              </select>
            </Field>
          </div>
          <div>
            <p className="mb-2 text-[13px] font-semibold text-black/60 dark:text-white/60">Member classes · {cohortForm.classIds.length} selected</p>
            <div className="thin-scroll max-h-56 space-y-1 overflow-y-auto rounded-2xl border border-black/[.08] dark:border-white/[.12] p-2">
              {yearClasses.map(c => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-black/[.03] dark:hover:bg-white/[.05]">
                  <input type="checkbox" checked={cohortForm.classIds.includes(c.id)} onChange={() => toggleCohortClass(c.id)} />
                  <span className="text-[13.5px] font-medium">{c.label}</span>
                </label>
              ))}
            </div>
            {cohortForm.classIds.length === 1 && <p className="mt-2 text-[12.5px] text-amber-600 dark:text-amber-400">A cohort spanning just one class duplicates that class's automatic section cohort — pick 2 or more.</p>}
          </div>
          <FormActions onCancel={() => setCohortFormOpen(false)} onSave={saveCohort} label={editCohort ? 'Save changes' : 'Create cohort'} disabled={!cohortFormValid || cohorts.busy} />
        </div>
      </Modal>

      <ConfirmModal open={!!delCohort} onClose={() => setDelCohort(null)} title={`Delete ${delCohort?.name ?? 'cohort'}?`}
        body="This removes the cohort. The classes themselves, and their individual section cohorts, are unaffected."
        action="Delete cohort" busy={cohorts.busy}
        onConfirm={async () => { if (delCohort && await cohorts.remove(delCohort.id, 'Cohort deleted')) setDelCohort(null) }} />

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? `Edit ${editing.label}` : `New class${selectedYear ? ` · ${selectedYear.label}` : ''}`}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Board">
              <select value={form.boardId} onChange={e => setForm({ ...form, boardId: e.target.value })} className={inputCls} autoFocus>
                <option value="">Select board</option>
                {sortedBoards.map(b => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
              </select>
            </Field>
            <Field label="Grade">
              <select value={form.gradeId} onChange={e => setForm({ ...form, gradeId: e.target.value })} className={inputCls}>
                <option value="">Select grade</option>
                {ladder.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Stream">
              <select value={form.streamId} onChange={e => setForm({ ...form, streamId: e.target.value })} className={inputCls} disabled={sortedStreams.length === 0}>
                <option value="">{sortedStreams.length ? '— none —' : 'No streams defined'}</option>
                {sortedStreams.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Section"><input value={form.section} onChange={e => setForm({ ...form, section: e.target.value.toUpperCase() })} placeholder="e.g. A" className={inputCls} /></Field>
          </div>
          <AsyncEntityPicker label="Class teacher" role="teacher" value={form.classTeacherId}
            onChange={id => setForm({ ...form, classTeacherId: id })}
            placeholder="Search teachers by name or email…"
            initialLabel={editing?.classTeacherId ? userById.get(editing.classTeacherId)?.name : undefined} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Capacity"><input type="number" min={0} value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value })} placeholder="Optional" className={inputCls} /></Field>
            <Field label="Period template">
              <select value={form.periodTemplateId} onChange={e => setForm({ ...form, periodTemplateId: e.target.value })} className={inputCls} disabled={periodTemplates.length === 0}>
                <option value="">{defaultTemplate ? `School default (${defaultTemplate.name})` : 'No templates defined'}</option>
                {periodTemplates.filter(t => t.id !== defaultTemplate?.id).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
          </div>
          {!editing && <p className={muted}>The class starts with the subjects defined in its board and grade curriculum. You can adjust them afterwards.</p>}
          <FormActions onCancel={() => setFormOpen(false)} onSave={save} label={editing ? 'Save changes' : 'Create class'} disabled={!formValid || classes.busy} />
        </div>
      </Modal>

      <ConfirmModal open={!!del} onClose={() => setDel(null)} title={`Delete ${del?.label ?? 'class'}?`}
        body="This removes the class along with all of its enrollments and subject assignments. Students stay in the system but will no longer belong to a class this year."
        action="Delete class" busy={classes.busy}
        onConfirm={async () => { if (del && await classes.remove(del.id, 'Class deleted')) setDel(null) }} />

    </div>
  )
}

/* ── 5. Rooms ──────────────────────────────────────────── */

const ROOM_KINDS: { value: RoomKind; label: string }[] = [
  { value: 'classroom', label: 'Classroom' },
  { value: 'lab', label: 'Lab' },
  { value: 'ground', label: 'Ground' },
  { value: 'hall', label: 'Hall' },
  { value: 'other', label: 'Other' },
]
const kindLabel = (k: RoomKind) => ROOM_KINDS.find(r => r.value === k)?.label ?? k
const kindTone = (k: RoomKind): 'indigo' | 'sky' | 'green' | 'amber' | 'slate' =>
  k === 'classroom' ? 'indigo' : k === 'lab' ? 'sky' : k === 'ground' ? 'green' : k === 'hall' ? 'amber' : 'slate'

interface RoomForm { name: string; kind: RoomKind; capacity: string; capabilityIds: string[] }
const emptyRoomForm = (): RoomForm => ({ name: '', kind: 'classroom', capacity: '', capabilityIds: [] })

interface CapabilityForm { name: string; code: string }
const emptyCapabilityForm = (): CapabilityForm => ({ name: '', code: '' })

/** Phase T1 §2 — small capability catalog (Physics Lab, Projector, ...) managed inline above the Rooms
 *  table, since it exists purely to feed the room capability multi-select below it. */
function CapabilitiesCatalog() {
  const capabilities = useEntity('capabilities')
  const { refreshAcademic } = useStore()
  const sorted = useMemo(() => [...capabilities.items].sort(byName), [capabilities.items])
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<CapabilityForm>(emptyCapabilityForm)
  const [del, setDel] = useState<{ id: string; name: string } | null>(null)
  const [seeding, setSeeding] = useState(false)

  const save = async () => {
    const body = { name: form.name.trim(), code: form.code.trim().toUpperCase().replace(/\s+/g, '_') }
    const out = await capabilities.create(body, 'Capability added')
    if (out) { setFormOpen(false); setForm(emptyCapabilityForm()) }
  }
  const seedDefaults = async () => {
    setSeeding(true)
    try {
      const r = await api.post<{ added: number }>('/academic/capabilities/seed-defaults')
      await refreshAcademic()
      toast.success(r.added > 0 ? `Added ${r.added} default capabilit${r.added === 1 ? 'y' : 'ies'}` : 'Default capabilities already present')
    } catch (e) { toast.error(errorMessage(e)) } finally { setSeeding(false) }
  }

  return (
    <Card className="mb-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className={sectionLabel}>Capability catalog</p>
          <p className={muted}>What a room can host — Physics Lab, Projector, Smart Board… assign these below per room.</p>
        </div>
        <div className="flex items-center gap-2">
          {sorted.length === 0 && (
            <button onClick={seedDefaults} disabled={seeding} className={ghostBtn}>{seeding ? 'Adding…' : 'Add default set'}</button>
          )}
          <HeaderAdd label="Add capability" onClick={() => { setForm(emptyCapabilityForm()); setFormOpen(true) }} />
        </div>
      </div>
      {sorted.length === 0 ? (
        <Empty text="No capabilities defined yet." />
      ) : (
        <div className="flex flex-wrap gap-2">
          {sorted.map(c => (
            <span key={c.id} className="flex items-center gap-1.5 rounded-full bg-black/[.05] dark:bg-white/[.07] py-1.5 pl-3 pr-1.5 text-[12.5px] font-semibold">
              {c.name}
              <button onClick={() => setDel({ id: c.id, name: c.name })} className="rounded-full p-1 text-black/40 hover:bg-black/10 hover:text-rose-500 dark:text-white/40 dark:hover:bg-white/15" aria-label={`Delete ${c.name}`}><X size={11} /></button>
            </span>
          ))}
        </div>
      )}

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title="New capability">
        <div className="space-y-4">
          <Field label="Name"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Physics Lab" className={inputCls} autoFocus /></Field>
          <Field label="Code"><input value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="e.g. PHYSICS_LAB" className={inputCls} /></Field>
          <FormActions onCancel={() => setFormOpen(false)} onSave={save} label="Add capability" disabled={!form.name.trim() || !form.code.trim() || capabilities.busy} />
        </div>
      </Modal>

      <ConfirmModal open={!!del} onClose={() => setDel(null)} title={`Delete ${del?.name ?? 'capability'}?`}
        body="Rooms currently marked with this capability lose it." action="Delete capability" busy={capabilities.busy}
        onConfirm={async () => { if (del && await capabilities.remove(del.id, 'Capability deleted')) setDel(null) }} />
    </Card>
  )
}

export function RoomsMod() {
  const rooms = useEntity('rooms')
  const { capabilities } = useAcademic()
  const capabilityById = useMemo(() => new Map(capabilities.map(c => [c.id, c])), [capabilities])
  const sorted = useMemo(() => [...rooms.items].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })), [rooms.items])

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Room | null>(null)
  const [form, setForm] = useState<RoomForm>(emptyRoomForm)
  const openAdd = () => { setEditing(null); setForm(emptyRoomForm()); setFormOpen(true) }
  const openEdit = (r: Room) => { setEditing(r); setForm({ name: r.name, kind: r.kind, capacity: r.capacity ? String(r.capacity) : '', capabilityIds: r.capabilityIds ?? [] }); setFormOpen(true) }
  const toggleCapability = (id: string) => setForm(f => ({ ...f, capabilityIds: f.capabilityIds.includes(id) ? f.capabilityIds.filter(x => x !== id) : [...f.capabilityIds, id] }))
  const save = async () => {
    const body: Partial<Room> = { name: form.name.trim(), kind: form.kind, capacity: form.capacity ? Number(form.capacity) : undefined, capabilityIds: form.capabilityIds }
    const out = editing ? await rooms.update(editing.id, body, 'Room updated') : await rooms.create(body, 'Room added')
    if (out) setFormOpen(false)
  }
  const [del, setDel] = useState<Room | null>(null)
  const capsOf = (r: Room) => (r.capabilityIds ?? []).map(id => capabilityById.get(id)?.name).filter((n): n is string => !!n)

  return (
    <div>
      <PageHead title="Rooms" sub="Classrooms, labs, halls and grounds available for the timetable">
        <AddButton label="Add room" onClick={openAdd} />
      </PageHead>

      <CapabilitiesCatalog />

      {sorted.length === 0 ? (
        <Card className="flex flex-col items-center py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600"><DoorOpen size={26} /></div>
          <p className="mt-4 font-display text-xl font-medium">No rooms yet</p>
          <p className="mt-1 max-w-sm text-[14px] text-black/50 dark:text-white/50">Add the physical spaces where classes happen so they can be scheduled.</p>
          <div className="mt-5"><AddButton label="Add first room" onClick={openAdd} /></div>
        </Card>
      ) : (
        <>
          <Card className="hidden p-0 md:block">
            <table className="w-full text-left text-[14px]">
              <thead className="border-b border-black/[.06] dark:border-white/[.08]">
                <tr className="text-[12px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">
                  <th className="px-6 py-3.5">Room</th>
                  <th className="px-6 py-3.5">Kind</th>
                  <th className="px-6 py-3.5">Capacity</th>
                  <th className="px-6 py-3.5">Capabilities</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(r => (
                  <tr key={r.id} className="border-b border-black/[.05] dark:border-white/[.07] last:border-0">
                    <td className="px-6 py-4 font-semibold">{r.name}</td>
                    <td className="px-6 py-4"><Pill tone={kindTone(r.kind)}>{kindLabel(r.kind)}</Pill></td>
                    <td className="px-6 py-4">{r.capacity ?? <span className="text-black/40 dark:text-white/40">—</span>}</td>
                    <td className="px-6 py-4">
                      {capsOf(r).length === 0 ? <span className="text-black/40 dark:text-white/40">—</span> : (
                        <div className="flex flex-wrap gap-1">{capsOf(r).map(name => <Pill key={name} tone="sky">{name}</Pill>)}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => openEdit(r)} className={iconBtn} aria-label="Edit"><Pencil size={15} /></button>
                        <button onClick={() => setDel(r)} className={dangerBtn} aria-label="Delete"><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <div className="space-y-3 md:hidden">
            {sorted.map(r => (
              <Card key={r.id} className="flex items-center gap-3 p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/[.05] dark:bg-white/[.07]"><BookOpen size={16} className="text-black/50 dark:text-white/50" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{r.name}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <Pill tone={kindTone(r.kind)}>{kindLabel(r.kind)}</Pill>
                    <span className={muted}>{r.capacity !== undefined ? `Capacity ${r.capacity}` : 'No capacity set'}</span>
                  </div>
                  {capsOf(r).length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{capsOf(r).map(name => <Pill key={name} tone="sky">{name}</Pill>)}</div>}
                </div>
                <button onClick={() => openEdit(r)} className={iconBtn} aria-label="Edit"><Pencil size={14} /></button>
                <button onClick={() => setDel(r)} className={dangerBtn} aria-label="Delete"><Trash2 size={14} /></button>
              </Card>
            ))}
          </div>
        </>
      )}

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? `Edit ${editing.name}` : 'New room'}>
        <div className="space-y-4">
          <Field label="Name"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Room 101" className={inputCls} autoFocus /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kind">
              <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value as RoomKind })} className={inputCls}>
                {ROOM_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </Field>
            <Field label="Capacity"><input type="number" min={0} value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value })} placeholder="Optional" className={inputCls} /></Field>
          </div>
          <div>
            <span className="text-[13px] font-semibold text-black/60 dark:text-white/60">Capabilities</span>
            {capabilities.length === 0 ? (
              <p className={`mt-1.5 ${muted}`}>No capabilities defined yet — add some to the catalog above.</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {capabilities.map(c => {
                  const on = form.capabilityIds.includes(c.id)
                  return (
                    <button key={c.id} type="button" onClick={() => toggleCapability(c.id)}
                      className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${on ? 'bg-indigo-600 text-white' : 'bg-black/[.05] dark:bg-white/[.07] hover:bg-black/10 dark:hover:bg-white/15'}`}>
                      {c.name}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          <FormActions onCancel={() => setFormOpen(false)} onSave={save} label={editing ? 'Save changes' : 'Add room'} disabled={!form.name.trim() || rooms.busy} />
        </div>
      </Modal>

      <ConfirmModal open={!!del} onClose={() => setDel(null)} title={`Delete ${del?.name ?? 'room'}?`}
        body="Timetable slots that reference this room will keep the name as plain text but can no longer be linked to it."
        action="Delete room" busy={rooms.busy}
        onConfirm={async () => { if (del && await rooms.remove(del.id, 'Room deleted')) setDel(null) }} />
    </div>
  )
}

/* ── 6. Period templates ───────────────────────────────── */

interface TemplateForm { name: string; rows: PeriodRow[] }

const emptyTemplateForm = (): TemplateForm => ({ name: '', rows: STARTER_ROWS.map(r => ({ ...r })) })

export function PeriodsMod() {
  const templates = useEntity('periodTemplates')
  const { classes } = useAcademic()
  const sorted = useMemo(() => [...templates.items].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || byName(a, b)), [templates.items])

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<PeriodTemplate | null>(null)
  const [form, setForm] = useState<TemplateForm>(emptyTemplateForm)
  const openAdd = () => { setEditing(null); setForm(emptyTemplateForm()); setFormOpen(true) }
  const openEdit = (t: PeriodTemplate) => {
    setEditing(t)
    setForm({ name: t.name, rows: [...t.periods].sort((a, b) => a.idx - b.idx).map(p => ({ label: p.label, start: p.start, end: p.end, kind: p.kind })) })
    setFormOpen(true)
  }
  const setRows = (rows: PeriodRow[]) => setForm(f => ({ ...f, rows }))
  const patchRow = (i: number, patch: Partial<PeriodRow>) => setRows(form.rows.map((r, j) => j === i ? { ...r, ...patch } : r))
  const moveRow = (i: number, dir: -1 | 1) => {
    const rows = [...form.rows]
    const j = i + dir
    if (!rows[j]) return
    ;[rows[i], rows[j]] = [rows[j], rows[i]]
    setRows(rows)
  }
  const save = async () => {
    const periods: PeriodDef[] = form.rows.map((r, i) => ({ idx: i + 1, label: r.label.trim(), start: r.start, end: r.end, kind: r.kind }))
    const body = { name: form.name.trim(), periods }
    const out = editing ? await templates.update(editing.id, body, 'Template updated') : await templates.create(body, 'Template created')
    if (out) setFormOpen(false)
  }
  const [del, setDel] = useState<PeriodTemplate | null>(null)
  const usedBy = (t: PeriodTemplate) => classes.filter(c => c.periodTemplateId === t.id).length

  const formValid = form.name.trim() && rowsValid(form.rows)

  return (
    <div>
      <PageHead title="Periods" sub="The daily bell schedule — periods and breaks with their timings. Classes use the school default unless overridden.">
        {sorted.length > 0 && <AddButton label="Add template" onClick={openAdd} />}
      </PageHead>

      {sorted.length === 0 ? (
        <Card className="flex flex-col items-center py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600"><Clock3 size={26} /></div>
          <p className="mt-4 font-display text-xl font-medium">No period template yet</p>
          <p className="mt-1 max-w-sm text-[14px] text-black/50 dark:text-white/50">Define the periods of a school day before building timetables. The first template you create becomes the school default.</p>
          <div className="mt-5"><AddButton label="Create template" onClick={openAdd} /></div>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {sorted.map(t => {
            const periods = [...t.periods].sort((a, b) => a.idx - b.idx)
            const classCount = periods.filter(p => p.kind === 'class').length
            const first = periods[0], last = periods[periods.length - 1]
            const overrides = usedBy(t)
            return (
              <Card key={t.id} className="flex flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-display text-xl font-medium tracking-tight">{t.name}</p>
                      {t.isDefault && <Pill tone="green">Default</Pill>}
                    </div>
                    <p className={`mt-1 ${muted}`}>
                      {classCount} period{classCount === 1 ? '' : 's'} · {periods.length - classCount} break{periods.length - classCount === 1 ? '' : 's'}
                      {first && last ? ` · ${first.start} – ${last.end}` : ''}
                      {overrides > 0 ? ` · used by ${overrides} class${overrides === 1 ? '' : 'es'}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => openEdit(t)} className={iconBtn} aria-label="Edit"><Pencil size={14} /></button>
                    <button onClick={() => setDel(t)} className={dangerBtn} aria-label="Delete"><Trash2 size={14} /></button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {periods.map(p => (
                    <span key={p.idx} title={`${p.start} – ${p.end}`}
                      className={`rounded-lg px-2 py-1 text-[11.5px] font-semibold ${p.kind === 'break' ? 'bg-amber-400/10 text-amber-700 dark:text-amber-300' : 'bg-black/[.05] dark:bg-white/[.07] text-black/70 dark:text-white/70'}`}>
                      {p.label} <span className="font-normal opacity-70">{p.start}</span>
                    </span>
                  ))}
                </div>
                {!t.isDefault && (
                  <div className="border-t border-black/[.06] dark:border-white/[.08] pt-3">
                    <button onClick={() => templates.action(t.id, 'set-default', `${t.name} is now the school default`)} disabled={templates.busy} className={ghostBtn}>
                      <span className="flex items-center gap-1"><Star size={12} /> Set as default</span>
                    </button>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? `Edit ${editing.name}` : 'New period template'} wide>
        <div className="space-y-4">
          <Field label="Name"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Standard day" className={inputCls} autoFocus /></Field>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className={sectionLabel}>Periods · {form.rows.length}</p>
              <HeaderAdd label="Add row" onClick={() => setRows([...form.rows, nextRow(form.rows)])} />
            </div>
            <div className="hidden grid-cols-[minmax(0,1fr)_118px_118px_104px_92px] gap-2 px-1 pb-1 text-[11.5px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40 sm:grid">
              <span>Label</span><span>Start</span><span>End</span><span>Kind</span><span />
            </div>
            <div className="space-y-2">
              {form.rows.map((r, i) => (
                <div key={i} className={`grid grid-cols-2 gap-2 rounded-2xl p-2 sm:grid-cols-[minmax(0,1fr)_118px_118px_104px_92px] sm:rounded-none sm:p-0 ${r.kind === 'break' ? 'bg-amber-400/10 sm:bg-transparent' : 'bg-black/[.03] dark:bg-white/[.05] sm:bg-transparent'}`}>
                  <input value={r.label} onChange={e => patchRow(i, { label: e.target.value })} placeholder={r.kind === 'break' ? 'Break' : 'P1'} className={inputCls + ' col-span-2 py-2 text-[13.5px] sm:col-span-1'} aria-label="Label" />
                  <input type="time" value={r.start} onChange={e => patchRow(i, { start: e.target.value })} className={inputCls + ' py-2 text-[13.5px]'} aria-label="Start" />
                  <input type="time" value={r.end} onChange={e => patchRow(i, { end: e.target.value })} className={inputCls + ' py-2 text-[13.5px]'} aria-label="End" />
                  <select value={r.kind} onChange={e => patchRow(i, { kind: e.target.value as PeriodKind })} className={inputCls + ` py-2 text-[13.5px] ${r.kind === 'break' ? 'text-amber-700 dark:text-amber-300' : ''}`} aria-label="Kind">
                    <option value="class">Class</option>
                    <option value="break">Break</option>
                  </select>
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => moveRow(i, -1)} disabled={i === 0} className={iconBtn} aria-label="Move up"><ChevronUp size={13} /></button>
                    <button onClick={() => moveRow(i, 1)} disabled={i === form.rows.length - 1} className={iconBtn} aria-label="Move down"><ChevronDown size={13} /></button>
                    <button onClick={() => setRows(form.rows.filter((_, j) => j !== i))} className={dangerBtn} aria-label="Remove"><X size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
            {form.rows.length === 0 && <Empty text="Add at least one period." />}
            {form.rows.some(r => r.start && r.end && r.start >= r.end) && <p className="mt-2 text-[12.5px] text-rose-500">Every period must end after it starts.</p>}
          </div>
          {!editing && templates.items.length === 0 && <p className={muted}>This is your first template, so it becomes the school default.</p>}
          <FormActions onCancel={() => setFormOpen(false)} onSave={save} label={editing ? 'Save changes' : 'Create template'} disabled={!formValid || templates.busy} />
        </div>
      </Modal>

      <ConfirmModal open={!!del} onClose={() => setDel(null)} title={`Delete ${del?.name ?? 'template'}?`}
        body={del?.isDefault ? 'This is the school default. It cannot be deleted while any class has timetable entries — set another template as default first.' : 'Classes overriding to this template fall back to the school default. Existing timetable entries are kept.'}
        action="Delete template" busy={templates.busy}
        onConfirm={async () => { if (del && await templates.remove(del.id, 'Template deleted')) setDel(null) }} />
    </div>
  )
}
