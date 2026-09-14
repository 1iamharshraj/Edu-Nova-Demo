import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowLeft, CheckCircle2, Layers, Plus, Trash2, UserPlus, Users } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { ThemeToggle } from '@/lib/theme'
import { useAcademic, useStore } from '@/lib/store'
import { DAY_LABELS, sortedPeriods, useElectiveBlocks } from '@/lib/hooks/useTimetable'
import type { ElectiveBlock, SubjectRec, User } from '@/lib/data'
import { Card, Empty, PageHead, Pill, inputCls } from '@/portal/ui'
import { AsyncEntityPicker } from '@/portal/components/AsyncEntityPicker'
import { ghostBtn, muted, sectionLabel, swatch } from '@/portal/modules/academicShared'

// Phase T6 §1b (.agents/edunova/phase-t6-sessions-jobs.md) — a grade-wide reserved slot where N parallel
// elective offerings run at once so students can choose between them without a schedule clash. NOT a
// SharedSession (which merges cohorts into one session) — the inverse: one slot, multiple parallel
// sessions, students individually bucketed by choice (see server/src/modules/timetable/electives.ts).
// A routed page (not a modal) per D9 — a dynamic offerings-row create form plus a real per-offering
// registration view is exactly the "genuinely multi-state screen" bar the T2/T3/T5 page conversions used.

interface OfferingDraft { subjectId: string; teacherId: string; teacherLabel: string; roomId: string; capacity: string }
const emptyOffering = (): OfferingDraft => ({ subjectId: '', teacherId: '', teacherLabel: '', roomId: '', capacity: '' })

export default function ElectiveBlocks() {
  const navigate = useNavigate()
  const { grades, subjects, rooms, terms, currentTerm, defaultTemplate, gradeById, subjectById } = useAcademic()
  const { db } = useStore()
  const userById = useMemo(() => new Map(db.users.map(u => [u.id, u])), [db.users])

  const sortedGrades = useMemo(() => [...grades].sort((a, b) => a.order - b.order), [grades])
  const sortedTerms = useMemo(() => [...terms].sort((a, b) => a.startDate.localeCompare(b.startDate)), [terms])
  const sortedSubjects = useMemo(() => [...subjects].sort((a, b) => a.name.localeCompare(b.name)), [subjects])
  const sortedRooms = useMemo(() => [...rooms].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })), [rooms])
  const classPeriods = useMemo(() => sortedPeriods(defaultTemplate).filter(p => p.kind === 'class'), [defaultTemplate])

  const [termId, setTermId] = useState('')
  const effectiveTermId = sortedTerms.some(t => t.id === termId) ? termId : (currentTerm?.id ?? sortedTerms[0]?.id ?? '')
  const [gradeFilter, setGradeFilter] = useState('')

  const blocks = useElectiveBlocks({ termId: effectiveTermId || undefined, gradeId: gradeFilter || undefined })

  // ── create form ──────────────────────────────────────────────
  const [name, setName] = useState('')
  const [gradeId, setGradeId] = useState('')
  const [dayOfWeek, setDayOfWeek] = useState(1)
  const [periodIdx, setPeriodIdx] = useState<number | ''>('')
  const [durationPeriods, setDurationPeriods] = useState('1')
  const [offerings, setOfferings] = useState<OfferingDraft[]>([emptyOffering(), emptyOffering()])

  const setOffering = (i: number, patch: Partial<OfferingDraft>) =>
    setOfferings(rows => rows.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  const addOffering = () => setOfferings(rows => [...rows, emptyOffering()])
  const removeOffering = (i: number) => setOfferings(rows => rows.length > 2 ? rows.filter((_, idx) => idx !== i) : rows)

  const formValid = !!name.trim() && !!gradeId && periodIdx !== '' && Number(durationPeriods) >= 1
    && offerings.length >= 2 && offerings.every(o => o.subjectId && o.teacherId)
    && new Set(offerings.map(o => o.teacherId)).size === offerings.length // same guard the server enforces, surfaced early

  const resetForm = () => { setName(''); setGradeId(''); setDayOfWeek(1); setPeriodIdx(''); setDurationPeriods('1'); setOfferings([emptyOffering(), emptyOffering()]) }

  const submit = async () => {
    if (!formValid || !effectiveTermId) return
    const out = await blocks.create({
      termId: effectiveTermId, gradeId, name: name.trim(), dayOfWeek, periodIdx, durationPeriods: Number(durationPeriods),
      offerings: offerings.map(o => ({ subjectId: o.subjectId, teacherId: o.teacherId, roomId: o.roomId || undefined, capacity: o.capacity ? Number(o.capacity) : undefined })),
    })
    if (out) resetForm()
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#f6f6f4] dark:bg-[#090911]">
      <header className="glass-nav">
        <div className="mx-auto flex h-[68px] max-w-6xl items-center justify-between px-6">
          <Link to="/portal"><Logo /></Link>
          <div className="flex items-center gap-2.5">
            <ThemeToggle />
            <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-[14px] font-medium text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white">
              <ArrowLeft size={16} /> Back
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-8 sm:py-8">
        <PageHead title="Elective Blocks" sub="A grade-wide slot where students choose between parallel elective offerings — Psychology vs. Fine Arts at the same period, without a schedule clash.">
          <div className="flex flex-wrap items-center gap-2">
            <select value={effectiveTermId} onChange={e => setTermId(e.target.value)} className={inputCls + ' w-auto min-w-[130px] py-2 text-[13.5px]'} aria-label="Term">
              {sortedTerms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select value={gradeFilter} onChange={e => setGradeFilter(e.target.value)} className={inputCls + ' w-auto min-w-[130px] py-2 text-[13.5px]'} aria-label="Grade filter">
              <option value="">All grades</option>
              {sortedGrades.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
          </div>
        </PageHead>

        <div className="space-y-5">
          {/* ── create ─────────────────────────────────────────── */}
          <Card>
            <p className={sectionLabel}>New elective block</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Name, e.g. Grade 11 Electives" className={inputCls} />
              <select value={gradeId} onChange={e => setGradeId(e.target.value)} className={inputCls} aria-label="Grade">
                <option value="">Select grade…</option>
                {sortedGrades.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
              </select>
              <select value={dayOfWeek} onChange={e => setDayOfWeek(Number(e.target.value))} className={inputCls} aria-label="Day">
                {[1, 2, 3, 4, 5, 6].map(d => <option key={d} value={d}>{DAY_LABELS[d]}</option>)}
              </select>
              <select value={periodIdx} onChange={e => setPeriodIdx(e.target.value === '' ? '' : Number(e.target.value))} className={inputCls} aria-label="Starting period">
                <option value="">Select period…</option>
                {classPeriods.map(p => <option key={p.idx} value={p.idx}>{p.label} ({p.start}–{p.end})</option>)}
              </select>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <label className="flex items-center gap-2 text-[13px] font-medium text-black/60 dark:text-white/60">
                Duration
                <input type="number" min={1} max={4} value={durationPeriods} onChange={e => setDurationPeriods(e.target.value)} className={inputCls + ' w-20 py-1.5'} aria-label="Duration periods" />
                period{durationPeriods === '1' ? '' : 's'}
              </label>
            </div>

            <div className="mt-4 border-t border-black/[.06] dark:border-white/[.08] pt-4">
              <div className="mb-2 flex items-center justify-between">
                <p className={sectionLabel}>Offerings · {offerings.length}</p>
                <button onClick={addOffering} className={ghostBtn}><Plus size={12} /> Add offering</button>
              </div>
              <p className={`mb-3 ${muted}`}>At least 2 parallel offerings, each with its own subject and teacher (a teacher can only run one offering per block).</p>
              <div className="space-y-2.5">
                {offerings.map((o, i) => (
                  <div key={i} className="grid grid-cols-1 gap-2.5 rounded-xl border border-black/[.06] dark:border-white/[.08] p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_140px_90px_36px] sm:items-center">
                    <select value={o.subjectId} onChange={e => setOffering(i, { subjectId: e.target.value })} className={inputCls + ' py-2 text-[13px]'} aria-label="Offering subject">
                      <option value="">Select subject…</option>
                      {sortedSubjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <AsyncEntityPicker role="teacher" value={o.teacherId} onChange={(id, label) => setOffering(i, { teacherId: id, teacherLabel: label })}
                      placeholder="Teacher…" initialLabel={o.teacherLabel} />
                    <select value={o.roomId} onChange={e => setOffering(i, { roomId: e.target.value })} className={inputCls + ' py-2 text-[13px]'} aria-label="Offering room">
                      <option value="">No room</option>
                      {sortedRooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                    <input type="number" min={1} value={o.capacity} onChange={e => setOffering(i, { capacity: e.target.value })} placeholder="Cap." className={inputCls + ' py-2 text-[13px]'} aria-label="Capacity" />
                    <button onClick={() => removeOffering(i)} disabled={offerings.length <= 2} className={ghostBtn + ' justify-center !px-0 !py-2'} aria-label="Remove offering"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            </div>

            <button onClick={submit} disabled={!formValid || blocks.busy} className="btn-ink mt-4 flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40">
              <Layers size={14} /> {blocks.busy ? 'Creating…' : 'Create Elective Block'}
            </button>
          </Card>

          {/* ── list ───────────────────────────────────────────── */}
          <div>
            <p className={`mb-2 ${sectionLabel}`}>Existing blocks · {blocks.items.length}</p>
            {blocks.loading ? <div className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading…</div>
              : blocks.items.length === 0 ? <Empty text="No elective blocks for this term/grade yet." />
              : (
                <div className="space-y-3">
                  {blocks.items.map(b => (
                    <BlockCard key={b.id} block={b} gradeLabel={gradeById.get(b.gradeId)?.label} subjectById={subjectById} userById={userById}
                      commitBusy={blocks.busy} onCommit={() => blocks.commitBlock(b.id)} onChoose={(offeringId, studentId) => blocks.choose(b.id, offeringId, studentId)} />
                  ))}
                </div>
              )}
          </div>
        </div>
      </main>
    </div>
  )
}

function BlockCard({ block, gradeLabel, subjectById, userById, commitBusy, onCommit, onChoose }: {
  block: ElectiveBlock
  gradeLabel?: string
  subjectById: Map<string, SubjectRec>
  userById: Map<string, User>
  commitBusy: boolean
  onCommit: () => void
  onChoose: (offeringId: string, studentId: string) => void
}) {
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const anyCommitted = block.offerings.some(o => !!o.sessionId)
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[14.5px] font-semibold">{block.name}</p>
        <Pill tone="slate">{gradeLabel ?? 'Grade'}</Pill>
        <Pill tone="indigo">{DAY_LABELS[block.dayOfWeek]} · period {block.periodIdx}{block.durationPeriods > 1 ? `–${block.periodIdx + block.durationPeriods - 1}` : ''}</Pill>
        <span className="flex-1" />
        <button onClick={onCommit} disabled={commitBusy} className={ghostBtn} title="Reserves this slot in every base class's timetable for this grade">
          <CheckCircle2 size={12} /> {commitBusy ? 'Committing…' : 'Commit to timetable'}
        </button>
      </div>
      <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
        {block.offerings.map(o => {
          const subject = o.subjectId ? subjectById.get(o.subjectId) : undefined
          return (
            <div key={o.id} className="rounded-xl border border-black/[.06] dark:border-white/[.08] p-3">
              <div className="flex items-center gap-2">
                {subject && swatch(subject.color)}
                <p className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{subject?.name ?? 'Subject'}</p>
                <span className="flex items-center gap-1 text-[12px] font-semibold text-black/50 dark:text-white/50">
                  <Users size={12} /> {o.registered}{o.capacity ? `/${o.capacity}` : ''}
                </span>
              </div>
              {o.choices.length > 0 && (
                <ul className="mt-1.5 flex flex-wrap gap-1 text-[11.5px] text-black/50 dark:text-white/50">
                  {o.choices.filter(c => c.status === 'Registered').map(c => (
                    <li key={c.studentId} className="rounded-full bg-black/[.04] dark:bg-white/[.06] px-2 py-0.5">{userById.get(c.studentId)?.name ?? c.studentId}</li>
                  ))}
                </ul>
              )}
              {addingTo === o.id ? (
                <div className="mt-2 flex items-center gap-1.5">
                  <div className="min-w-0 flex-1">
                    <AsyncEntityPicker role="student" value="" onChange={id => { if (id) { onChoose(o.id, id); setAddingTo(null) } }} placeholder="Search student…" />
                  </div>
                  <button onClick={() => setAddingTo(null)} className={ghostBtn}>Cancel</button>
                </div>
              ) : (
                <button onClick={() => setAddingTo(o.id)} disabled={!!o.capacity && o.registered >= o.capacity}
                  className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-indigo-600 hover:underline disabled:opacity-40 dark:text-indigo-400">
                  <UserPlus size={12} /> Register a student
                </button>
              )}
            </div>
          )
        })}
      </div>
      {anyCommitted && <p className={`mt-3 ${muted}`}>Committed to the timetable — the underlying per-offering schedule stays here; each base class shows a shared "Elective Block" placeholder period.</p>}
    </Card>
  )
}
