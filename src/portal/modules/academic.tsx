import { useMemo, useState } from 'react'
import { BookOpen, CalendarRange, ChevronDown, ChevronUp, DoorOpen, GraduationCap, LayoutGrid, Pencil, Plus, RefreshCw, Star, Trash2, UserPlus, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAcademic, useStore } from '@/lib/store'
import { useEntity } from '@/lib/hooks/useEntity'
import { api, errorMessage } from '@/lib/api'
import type { AcademicYear, BoardRec, ClassRec, ClassSubject, CurriculumKind, CurriculumSubject, Enrollment, Grade, Room, RoomKind, Stream, SubjectRec, TermRec } from '@/lib/data'
import { Avatar, Card, Empty, Field, Modal, PageHead, Pill, inputCls } from '../ui'

/* ── shared bits ───────────────────────────────────────── */

const today = () => new Date().toISOString().slice(0, 10)
const sectionLabel = 'text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40'
const iconBtn = 'rounded-full bg-black/[.05] dark:bg-white/[.07] p-2 hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-black/[.05]'
const dangerBtn = 'rounded-full bg-rose-50 dark:bg-rose-500/10 p-2 text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-500/20 disabled:opacity-40'
const ghostBtn = 'rounded-full border border-black/10 dark:border-white/15 px-3 py-1.5 text-[12.5px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06] disabled:opacity-40'
const muted = 'text-[12.5px] text-black/50 dark:text-white/50'
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

function HeaderAdd({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex shrink-0 items-center gap-1.5 rounded-full bg-black/[.05] dark:bg-white/[.07] px-3 py-1.5 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">
      <Plus size={13} /> {label}
    </button>
  )
}

function FormActions({ onCancel, onSave, label, disabled }: { onCancel: () => void; onSave: () => void; label: string; disabled?: boolean }) {
  return (
    <div className="flex gap-3 pt-2">
      <button onClick={onSave} disabled={disabled} className="btn-ink flex-1 py-3 text-[14px] font-semibold disabled:opacity-40">{label}</button>
      <button onClick={onCancel} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Cancel</button>
    </div>
  )
}

function ConfirmModal({ open, title, body, action, busy, onClose, onConfirm }: {
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

const swatch = (color: string, size = 12) => <span className="inline-block shrink-0 rounded-full ring-1 ring-black/10" style={{ width: size, height: size, background: color }} />

const byDate = <T extends { startDate: string }>(a: T, b: T) => a.startDate.localeCompare(b.startDate)
const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name)
const byLabel = (a: ClassRec, b: ClassRec) => a.label.localeCompare(b.label, undefined, { numeric: true })
const byRoll = (a: Enrollment, b: Enrollment) => (a.rollNo ?? '').localeCompare(b.rollNo ?? '', undefined, { numeric: true })
const byOrder = (a: Grade, b: Grade) => a.order - b.order || a.label.localeCompare(b.label, undefined, { numeric: true })

/** Human label for a board + grade (+ stream) combination, e.g. "CBSE · XI · Science". */
const comboLabel = (board?: BoardRec, grade?: Grade, stream?: Stream) =>
  [board?.code, grade?.label, stream?.name].filter(Boolean).join(' · ')

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

export function CurriculumMod() {
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

interface ClassForm { boardId: string; gradeId: string; streamId: string; section: string; classTeacherId: string; capacity: string }
const emptyClassForm = (): ClassForm => ({ boardId: '', gradeId: '', streamId: '', section: '', classTeacherId: '', capacity: '' })

function YearSelect({ years, value, onChange }: { years: AcademicYear[]; value: string; onChange: (id: string) => void }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={inputCls + ' w-auto min-w-[160px]'}>
      {years.map(y => <option key={y.id} value={y.id}>{y.label}{y.isCurrent ? ' · current' : ''}</option>)}
    </select>
  )
}

export function ClassesMod() {
  const { db, refreshAcademic } = useStore()
  const { years, currentYear, boards, grades, streams, subjectById, enrollments: allEnrollments, subjects: allSubjects } = useAcademic()
  const classes = useEntity('classes')
  const enrollments = useEntity('enrollments')
  const classSubjects = useEntity('classSubjects')

  const sortedYears = useMemo(() => [...years].sort(byDate), [years])
  const [pickedYearId, setYearId] = useState('')
  const yearId = sortedYears.some(y => y.id === pickedYearId) ? pickedYearId : (currentYear?.id ?? sortedYears[0]?.id ?? '')

  const sortedBoards = useMemo(() => [...boards].sort(byName), [boards])
  const ladder = useMemo(() => [...grades].sort(byOrder), [grades])
  const sortedStreams = useMemo(() => [...streams].sort(byName), [streams])
  const sortedSubjects = useMemo(() => [...allSubjects].sort(byName), [allSubjects])
  const teachers = useMemo(() => db.users.filter(u => u.role === 'teacher'), [db.users])
  const students = useMemo(() => db.users.filter(u => u.role === 'student'), [db.users])
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
    setForm({ boardId: c.boardId, gradeId: c.gradeId, streamId: c.streamId ?? '', section: c.section, classTeacherId: c.classTeacherId ?? '', capacity: c.capacity ? String(c.capacity) : '' })
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
    }
    const out = editing
      ? await classes.update(editing.id, body, 'Class updated')
      : await classes.create({ ...body, academicYearId: yearId }, 'Class created')
    if (out) setFormOpen(false)
  }
  const [del, setDel] = useState<ClassRec | null>(null)

  // roster
  const [rosterId, setRosterIdRaw] = useState<string | null>(null)
  const [pickId, setPickId] = useState('')
  const [pickRoll, setPickRoll] = useState('')
  const [rollDraft, setRollDraft] = useState<Record<string, string>>({})
  const setRosterId = (id: string | null) => { setRosterIdRaw(id); setPickId(''); setPickRoll(''); setRollDraft({}) }
  const rosterClass = classes.items.find(c => c.id === rosterId) ?? null
  const roster = useMemo(() =>
    allEnrollments.filter(e => e.classId === rosterId && e.status === 'active').sort(byRoll),
  [allEnrollments, rosterId])
  const availableStudents = useMemo(() => {
    if (!rosterClass) return []
    const taken = new Set(allEnrollments.filter(e => e.academicYearId === rosterClass.academicYearId).map(e => e.studentId))
    return students.filter(s => !taken.has(s.id)).sort(byName)
  }, [rosterClass, allEnrollments, students])
  const addStudent = async () => {
    if (!rosterClass || !pickId) return
    const out = await enrollments.create({ studentId: pickId, classId: rosterClass.id, rollNo: pickRoll.trim() || undefined }, 'Student enrolled')
    if (out) { setPickId(''); setPickRoll('') }
  }
  const commitRoll = async (e: Enrollment) => {
    const draft = rollDraft[e.id]
    if (draft === undefined) return
    const next = draft.trim()
    setRollDraft(d => { const { [e.id]: _, ...rest } = d; void _; return rest })
    if (next === (e.rollNo ?? '')) return
    await enrollments.update(e.id, { rollNo: next || undefined }, 'Roll number updated')
  }

  // subjects & teachers
  const [subjectsId, setSubjectsIdRaw] = useState<string | null>(null)
  const [periodsDraft, setPeriodsDraft] = useState<Record<string, string>>({})
  const [addSubjectId, setAddSubjectId] = useState('')
  const [syncing, setSyncing] = useState(false)
  const setSubjectsId = (id: string | null) => { setSubjectsIdRaw(id); setPeriodsDraft({}); setAddSubjectId('') }
  const subjectsClass = classes.items.find(c => c.id === subjectsId) ?? null
  const classRows = useMemo(() =>
    classSubjects.items
      .filter(cs => cs.classId === subjectsId)
      .map(cs => ({ cs, subject: subjectById.get(cs.subjectId) }))
      .sort((a, b) => (a.subject?.name ?? '').localeCompare(b.subject?.name ?? '')),
  [classSubjects.items, subjectsId, subjectById])
  const addableSubjects = useMemo(() => {
    const onClass = new Set(classRows.map(r => r.cs.subjectId))
    return sortedSubjects.filter(s => !onClass.has(s.id))
  }, [classRows, sortedSubjects])
  const totalPeriods = classRows.reduce((sum, r) => sum + r.cs.periodsPerWeek, 0)
  const setTeacher = (cs: ClassSubject, teacherId: string) =>
    // null clears the teacher on the server; the client type only knows `string | undefined`
    classSubjects.update(cs.id, { teacherId: (teacherId || null) as unknown as string }, 'Teacher updated')
  const commitPeriods = async (cs: ClassSubject) => {
    const draft = periodsDraft[cs.id]
    if (draft === undefined) return
    setPeriodsDraft(d => { const { [cs.id]: _, ...rest } = d; void _; return rest })
    const n = parseInt(draft, 10)
    if (!Number.isFinite(n) || n < 0 || n === cs.periodsPerWeek) return
    await classSubjects.update(cs.id, { periodsPerWeek: n }, 'Periods updated')
  }
  const addClassSubject = async () => {
    if (!subjectsClass || !addSubjectId) return
    const out = await classSubjects.create({ classId: subjectsClass.id, subjectId: addSubjectId, periodsPerWeek: 5 }, 'Subject added')
    if (out) setAddSubjectId('')
  }
  const syncCurriculum = async () => {
    if (!subjectsClass) return
    setSyncing(true)
    try {
      await api.post('/academic/classes/' + subjectsClass.id + '/sync-curriculum')
      await refreshAcademic()
      toast.success('Synced from curriculum')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSyncing(false)
    }
  }

  const setupReady = sortedBoards.length > 0 && ladder.length > 0
  const formValid = form.boardId && form.gradeId && form.section.trim()
  const selectedYear = sortedYears.find(y => y.id === yearId)
  const busyRows = classSubjects.busy || syncing

  const classPills = (c: ClassRec) => (
    <div className="flex flex-wrap items-center gap-1.5">
      <Pill tone="indigo">{c.boardCode}</Pill>
      {c.stream && <Pill tone="sky">{c.stream}</Pill>}
    </div>
  )

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
                          <button onClick={() => setSubjectsId(c.id)} className={ghostBtn}>
                            <span className="flex items-center gap-1"><BookOpen size={12} /> Subjects{subjectCount ? ` · ${subjectCount}` : ''}</span>
                          </button>
                          <button onClick={() => setRosterId(c.id)} className={ghostBtn}>Roster</button>
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
          <Field label="Class teacher">
            <select value={form.classTeacherId} onChange={e => setForm({ ...form, classTeacherId: e.target.value })} className={inputCls}>
              <option value="">— none —</option>
              {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Capacity"><input type="number" min={0} value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value })} placeholder="Optional" className={inputCls} /></Field>
          {!editing && <p className={muted}>The class starts with the subjects defined in its board and grade curriculum. You can adjust them afterwards.</p>}
          <FormActions onCancel={() => setFormOpen(false)} onSave={save} label={editing ? 'Save changes' : 'Create class'} disabled={!formValid || classes.busy} />
        </div>
      </Modal>

      <ConfirmModal open={!!del} onClose={() => setDel(null)} title={`Delete ${del?.label ?? 'class'}?`}
        body="This removes the class along with all of its enrollments and subject assignments. Students stay in the system but will no longer belong to a class this year."
        action="Delete class" busy={classes.busy}
        onConfirm={async () => { if (del && await classes.remove(del.id, 'Class deleted')) setDel(null) }} />

      {/* subjects & teachers */}
      <Modal open={!!subjectsClass} onClose={() => setSubjectsId(null)} title={subjectsClass ? `Subjects & teachers · ${subjectsClass.label}` : 'Subjects & teachers'} wide>
        {subjectsClass && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {classPills(subjectsClass)}
                <span className={muted}>{classRows.length} subject{classRows.length === 1 ? '' : 's'} · {totalPeriods} periods/week</span>
              </div>
              <button onClick={syncCurriculum} disabled={busyRows} className={ghostBtn} title="Adds any curriculum subject for this board and grade that isn't on the class yet">
                <span className="flex items-center gap-1.5"><RefreshCw size={12} className={syncing ? 'animate-spin' : ''} /> Sync from curriculum</span>
              </button>
            </div>

            <div className="rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-4">
              <p className={`mb-3 ${sectionLabel}`}>Add subject</p>
              {sortedSubjects.length === 0 ? (
                <p className="text-[13.5px] text-black/50 dark:text-white/50">The subject catalogue is empty — add subjects under Curriculum first.</p>
              ) : addableSubjects.length === 0 ? (
                <p className="text-[13.5px] text-black/50 dark:text-white/50">Every catalogue subject is already on this class.</p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  <select value={addSubjectId} onChange={e => setAddSubjectId(e.target.value)} className={inputCls + ' min-w-[200px] flex-1'}>
                    <option value="">Select a subject…</option>
                    {addableSubjects.map(s => <option key={s.id} value={s.id}>{s.name}{s.code ? ` (${s.code})` : ''}</option>)}
                  </select>
                  <button onClick={addClassSubject} disabled={!addSubjectId || busyRows} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40">
                    <Plus size={15} /> Add
                  </button>
                </div>
              )}
            </div>

            <div>
              <p className={`mb-2 ${sectionLabel}`}>Subjects · {classRows.length}</p>
              {classRows.length === 0 ? (
                <Empty text="No subjects on this class yet. Sync from the curriculum or add one above." />
              ) : (
                <div className="divide-y divide-black/[.05] dark:divide-white/[.07] rounded-2xl border border-black/[.06] dark:border-white/[.08]">
                  <div className="hidden grid-cols-[minmax(0,1fr)_200px_88px_36px] items-center gap-3 px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40 sm:grid">
                    <span>Subject</span><span>Teacher</span><span>Periods</span><span />
                  </div>
                  {classRows.map(({ cs, subject }) => (
                    <div key={cs.id} className="grid grid-cols-[minmax(0,1fr)_36px] items-center gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_200px_88px_36px]">
                      <div className="flex min-w-0 items-center gap-3">
                        {swatch(subject?.color ?? '#94a3b8')}
                        <div className="min-w-0">
                          <p className="truncate text-[14px] font-semibold">{subject?.name ?? 'Unknown subject'}</p>
                          <p className={muted}>{subject?.code || '—'}</p>
                        </div>
                      </div>
                      <div className="order-last col-span-2 grid grid-cols-[1fr_88px] gap-3 sm:order-none sm:col-span-2 sm:contents">
                        <select value={cs.teacherId ?? ''} onChange={e => setTeacher(cs, e.target.value)} disabled={busyRows} className={inputCls + ' py-2 text-[13.5px]'} aria-label="Teacher">
                          <option value="">— unassigned —</option>
                          {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                        <input type="number" min={0} value={periodsDraft[cs.id] ?? String(cs.periodsPerWeek)}
                          onChange={e => setPeriodsDraft(d => ({ ...d, [cs.id]: e.target.value }))}
                          onBlur={() => commitPeriods(cs)}
                          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                          disabled={busyRows} className={inputCls + ' py-2 text-[13.5px]'} aria-label="Periods per week" />
                      </div>
                      <button onClick={() => classSubjects.remove(cs.id, 'Subject removed')} disabled={busyRows} className={dangerBtn} aria-label="Remove subject"><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* roster */}
      <Modal open={!!rosterClass} onClose={() => setRosterId(null)} title={rosterClass ? `Roster · ${rosterClass.label}` : 'Roster'} wide>
        {rosterClass && (
          <div className="space-y-5">
            <div className="rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-4">
              <p className={`mb-3 ${sectionLabel}`}>Add student</p>
              {availableStudents.length === 0 ? (
                <p className="text-[13.5px] text-black/50 dark:text-white/50">Every student is already enrolled in a class this year.</p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  <select value={pickId} onChange={e => setPickId(e.target.value)} className={inputCls + ' min-w-[200px] flex-1'}>
                    <option value="">Select a student…</option>
                    {availableStudents.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <input value={pickRoll} onChange={e => setPickRoll(e.target.value)} placeholder="Roll no." className={inputCls + ' w-28'} />
                  <button onClick={addStudent} disabled={!pickId || enrollments.busy} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40">
                    <UserPlus size={15} /> Add
                  </button>
                </div>
              )}
            </div>

            <div>
              <p className={`mb-2 ${sectionLabel}`}>Enrolled · {roster.length}</p>
              {roster.length === 0 ? (
                <Empty text="No students enrolled yet. Add one above." />
              ) : (
                <div className="divide-y divide-black/[.05] dark:divide-white/[.07] rounded-2xl border border-black/[.06] dark:border-white/[.08]">
                  {roster.map(e => {
                    const s = userById.get(e.studentId)
                    return (
                      <div key={e.id} className="flex items-center gap-3 px-4 py-3">
                        {s ? <Avatar name={s.name} hue={s.avatarHue} size={34} /> : <span className="h-[34px] w-[34px] rounded-full bg-black/[.05]" />}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-semibold">{s?.name ?? 'Unknown student'}</p>
                          {s && <p className={`truncate ${muted}`}>{s.email}</p>}
                        </div>
                        <label className="flex items-center gap-2 text-[12.5px] text-black/50 dark:text-white/50">
                          Roll
                          <input value={rollDraft[e.id] ?? e.rollNo ?? ''}
                            onChange={ev => setRollDraft(d => ({ ...d, [e.id]: ev.target.value }))}
                            onBlur={() => commitRoll(e)}
                            onKeyDown={ev => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur() }}
                            className={inputCls + ' w-20 px-3 py-1.5 text-[13px]'} />
                        </label>
                        <button onClick={() => enrollments.remove(e.id, 'Removed from class')} disabled={enrollments.busy} className={dangerBtn} aria-label="Remove from class"><X size={14} /></button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
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

interface RoomForm { name: string; kind: RoomKind; capacity: string }
const emptyRoomForm = (): RoomForm => ({ name: '', kind: 'classroom', capacity: '' })

export function RoomsMod() {
  const rooms = useEntity('rooms')
  const sorted = useMemo(() => [...rooms.items].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })), [rooms.items])

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Room | null>(null)
  const [form, setForm] = useState<RoomForm>(emptyRoomForm)
  const openAdd = () => { setEditing(null); setForm(emptyRoomForm()); setFormOpen(true) }
  const openEdit = (r: Room) => { setEditing(r); setForm({ name: r.name, kind: r.kind, capacity: r.capacity ? String(r.capacity) : '' }); setFormOpen(true) }
  const save = async () => {
    const body: Partial<Room> = { name: form.name.trim(), kind: form.kind, capacity: form.capacity ? Number(form.capacity) : undefined }
    const out = editing ? await rooms.update(editing.id, body, 'Room updated') : await rooms.create(body, 'Room added')
    if (out) setFormOpen(false)
  }
  const [del, setDel] = useState<Room | null>(null)

  return (
    <div>
      <PageHead title="Rooms" sub="Classrooms, labs, halls and grounds available for the timetable">
        <AddButton label="Add room" onClick={openAdd} />
      </PageHead>

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
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(r => (
                  <tr key={r.id} className="border-b border-black/[.05] dark:border-white/[.07] last:border-0">
                    <td className="px-6 py-4 font-semibold">{r.name}</td>
                    <td className="px-6 py-4"><Pill tone={kindTone(r.kind)}>{kindLabel(r.kind)}</Pill></td>
                    <td className="px-6 py-4">{r.capacity ?? <span className="text-black/40 dark:text-white/40">—</span>}</td>
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
