import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Download, FileText, Target, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAcademic, useStore } from '@/lib/store'
import { downloadFile, errorMessage } from '@/lib/api'
import { isStaffOrAdmin } from '@/lib/access'
import type { ChapterProgressStatus, CurriculumSubject, SyllabusChapter, TermSyllabusTarget } from '@/lib/data'
import { fmtDate, useFetchMany, useTeachableClassSubjects } from '@/lib/hooks/useAcademics'
import {
  addChapterResource, paceHeadline, paceTone, removeChapterResource, updateProgress, useChapterResources, useChapters,
  useCoverage, usePace, useProgress, useTargetActions, useTargets, type ChapterProgressRow,
} from '@/lib/hooks/useSyllabus'
import { Card, Empty, Field, PageHead, Pill, UploadField, inputCls, type UploadedFile } from '../ui'
import { useActiveTerm } from './viewer'

// Phase 18 — syllabus & teaching-progress tracking. See .agents/edunova/phase-18-syllabus-tracking.md.
// Chapter management (add/reorder/edit) lives on the Curriculum screen (academic.tsx's ChapterManagerModal) —
// this file holds the teacher-facing Teaching Progress screen and the staff/admin Syllabus Overview screen.

const dangerBtn = 'flex items-center gap-1.5 rounded-full bg-rose-50 dark:bg-rose-500/10 px-3.5 py-2 text-[13px] font-semibold text-rose-500 hover:bg-rose-100 disabled:opacity-40'
const muted = 'text-[12.5px] text-black/50 dark:text-white/50'
const sectionLabel = 'text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40'

const STATUS_OPTS: ChapterProgressStatus[] = ['NotStarted', 'InProgress', 'Done']
const STATUS_LABEL: Record<ChapterProgressStatus, string> = { NotStarted: 'Not started', InProgress: 'In progress', Done: 'Done' }
const STATUS_SOLID: Record<ChapterProgressStatus, string> = {
  NotStarted: 'bg-black/[.06] dark:bg-white/[.1] text-black/50 dark:text-white/55',
  InProgress: 'bg-amber-500 text-white',
  Done: 'bg-emerald-500 text-white',
}

function StatusToggle({ value, onChange, disabled }: { value: ChapterProgressStatus; onChange: (s: ChapterProgressStatus) => void; disabled?: boolean }) {
  return (
    <div className="flex gap-1">
      {STATUS_OPTS.map(s => (
        <button key={s} onClick={() => onChange(s)} disabled={disabled || value === s}
          className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:cursor-default ${value === s ? STATUS_SOLID[s] : 'bg-black/[.04] dark:bg-white/[.06] text-black/45 dark:text-white/45 hover:bg-black/10 dark:hover:bg-white/15'}`}>
          {STATUS_LABEL[s]}
        </button>
      ))}
    </div>
  )
}

/** The chapter's shared teaching-resource library — mounted only while a chapter row is expanded. */
function ChapterResources({ chapterId, canUpload }: { chapterId: string; canUpload: boolean }) {
  const { items, loading, reload } = useChapterResources(chapterId)
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const add = async () => {
    if (!files[0]) return
    setBusy(true)
    try {
      await addChapterResource(chapterId, files[0].id, label.trim() || files[0].name)
      setFiles([]); setLabel('')
      reload()
      toast.success('Resource added')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const remove = async (id: string) => {
    setBusy(true)
    try { await removeChapterResource(id); reload(); toast.success('Resource removed') } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-3 rounded-xl bg-black/[.03] dark:bg-white/[.05] p-3.5">
      <p className={sectionLabel}>Teaching resources</p>
      {loading ? <p className={muted}>Loading…</p> : (items ?? []).length === 0 ? <p className={muted}>No resources uploaded for this chapter yet.</p> : (
        <div className="space-y-1.5">
          {(items ?? []).map(r => (
            <div key={r.id} className="flex items-center gap-2 rounded-lg bg-white dark:bg-[#14141f] px-3 py-2 text-[13px]">
              <FileText size={14} className="shrink-0 text-black/40 dark:text-white/40" />
              <span className="min-w-0 flex-1 truncate font-medium">{r.label}</span>
              <button onClick={() => downloadFile(r.fileId, r.label).catch(e => toast.error(errorMessage(e)))} className="rounded-full p-1.5 hover:bg-black/[.05] dark:hover:bg-white/[.08]" title="Download"><Download size={13} /></button>
              {canUpload && <button onClick={() => remove(r.id)} disabled={busy} className="rounded-full p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 disabled:opacity-40" title="Remove"><Trash2 size={13} /></button>}
            </div>
          ))}
        </div>
      )}
      {canUpload && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[160px] flex-1">
            <UploadField files={files} onChange={setFiles} label="Add a resource" hint="Lesson plan, worksheet, slides…" />
          </div>
          {files.length > 0 && (
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label (optional)" className={`${inputCls} min-w-[140px] flex-1 py-2 text-[13px]`} />
              <button onClick={add} disabled={busy} className="rounded-full bg-black text-white px-4 py-2 text-[12.5px] font-semibold disabled:opacity-40">Save</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Teacher: Teaching Progress ────────────────────────── */

export function TeachingProgressMod() {
  const { user } = useStore()
  const all = useTeachableClassSubjects()
  // Progress writes are scoped to the class-subject's own assigned teacher — the same tightened scoping the
  // Phase 10 audit fixed for attendance/marks, not the looser "any class I'm peripherally connected to" set
  // `useTeachableClassSubjects` returns for staff/admin/class-teacher convenience elsewhere in the app.
  const rows = useMemo(() => all.filter(r => r.cs.teacherId === user?.id), [all, user])
  const [picked, setPicked] = useState('')
  const row = rows.find(r => r.cs.id === picked) ?? rows[0]
  const csId = row?.cs.id

  const { items, loading, error, reload } = useProgress(csId)
  const chapters = useMemo(() => [...(items ?? [])].sort((a, b) => a.chapter.order - b.chapter.order), [items])
  const pace = usePace(csId)
  const [open, setOpen] = useState<string | null>(null)
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const setStatus = async (chapterId: string, status: ChapterProgressStatus) => {
    if (!csId) return
    setBusy(chapterId)
    try {
      await updateProgress(csId, chapterId, { status })
      reload(); pace.reload()
      toast.success(`Marked ${STATUS_LABEL[status].toLowerCase()}`)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const saveNotes = async (chapterId: string) => {
    if (!csId) return
    const draft = notesDraft[chapterId]
    if (draft === undefined) return
    setNotesDraft(d => { const { [chapterId]: _, ...rest } = d; void _; return rest })
    try { await updateProgress(csId, chapterId, { notes: draft.trim() || null }); reload() } catch (e) { toast.error(errorMessage(e)) }
  }

  const done = chapters.filter(c => c.progress.status === 'Done').length

  return (
    <div>
      <PageHead title="Teaching Progress" sub={row ? `${row.cls.label} · ${row.subject?.name ?? 'Subject'}` : 'Chapter-by-chapter progress for your classes'}>
        {rows.length > 1 && (
          <select value={csId ?? ''} onChange={e => setPicked(e.target.value)} className={`${inputCls} w-auto min-w-[200px] py-2 text-[13.5px]`} aria-label="Class subject">
            {rows.map(r => <option key={r.cs.id} value={r.cs.id}>{r.label}</option>)}
          </select>
        )}
      </PageHead>

      {rows.length === 0 ? <Empty text="No class-subjects assigned to you yet. Ask the admin to assign you a class-subject under Classes & Sections → Subjects." /> : (
        <div className="space-y-5">
          <Card>
            {pace.loading ? <p className={muted}>Computing pace…</p>
              : pace.error || !pace.data ? <p className={muted}>Pace isn't available yet — it needs a term start date, timetable entries and the calendar for this class-subject.</p>
              : (
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Pill tone={paceTone(pace.data)}>{paceHeadline(pace.data, chapters.length)}</Pill>
                  </div>
                  <p className={`mt-2 ${muted}`}>
                    {pace.data.deliverablePeriods} of {pace.data.scheduledPeriodsSoFar} scheduled periods actually deliverable this term as of {fmtDate(pace.data.asOf)}
                    {pace.data.lostPeriods.total > 0 ? ` — ${pace.data.lostPeriods.total} lost to holidays, leave or cancelled periods.` : '.'}
                  </p>
                </div>
              )}
          </Card>

          <Card className="p-0">
            <div className="flex items-center justify-between border-b border-black/[.06] dark:border-white/[.08] px-6 py-3.5">
              <p className={sectionLabel}>Chapters</p>
              <p className={muted}>{done} of {chapters.length} done</p>
            </div>
            {loading ? <p className="p-6 text-center text-[13.5px] text-black/40 dark:text-white/40">Loading…</p>
              : error ? <div className="p-6"><Empty text={error} /></div>
              : chapters.length === 0 ? <div className="p-6"><Empty text="No chapters defined for this curriculum-subject yet — ask an admin to add them on the Curriculum screen." /></div>
              : chapters.map((c: ChapterProgressRow) => {
                const expanded = open === c.chapter.id
                return (
                  <div key={c.chapter.id} className="border-b border-black/[.05] dark:border-white/[.07] last:border-0">
                    <div className="flex flex-wrap items-center gap-3 px-6 py-3.5">
                      <button onClick={() => setOpen(expanded ? null : c.chapter.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                        {expanded ? <ChevronDown size={15} className="shrink-0 text-black/40 dark:text-white/40" /> : <ChevronRight size={15} className="shrink-0 text-black/40 dark:text-white/40" />}
                        <div className="min-w-0">
                          <p className="truncate text-[14px] font-semibold">{c.chapter.order}. {c.chapter.title}</p>
                          <p className={muted}>{c.chapter.estimatedPeriods} periods{c.chapter.examWeightagePct != null ? ` · ${c.chapter.examWeightagePct}% exam weightage` : ''}</p>
                        </div>
                      </button>
                      <StatusToggle value={c.progress.status} onChange={s => setStatus(c.chapter.id, s)} disabled={busy === c.chapter.id} />
                    </div>
                    {expanded && (
                      <div className="space-y-3 bg-black/[.02] dark:bg-white/[.03] px-6 py-4">
                        <Field label="Notes">
                          <textarea value={notesDraft[c.chapter.id] ?? c.progress.notes ?? ''} onChange={e => setNotesDraft(d => ({ ...d, [c.chapter.id]: e.target.value }))}
                            onBlur={() => saveNotes(c.chapter.id)} rows={2} placeholder="Optional notes for this class's run through the chapter…" className={inputCls} />
                        </Field>
                        <ChapterResources chapterId={c.chapter.id} canUpload />
                      </div>
                    )}
                  </div>
                )
              })}
          </Card>
        </div>
      )}
    </div>
  )
}

/* ── Staff/admin: Syllabus Overview ────────────────────── */

function PaceTab() {
  const rows = useTeachableClassSubjects()
  const paths = useMemo(() => rows.map(r => `/syllabus/pace/${r.cs.id}`), [rows])
  const { data, loading } = useFetchMany<import('@/lib/data').SyllabusPace>(paths)
  return (
    <Card className="overflow-x-auto p-0">
      {rows.length === 0 ? <div className="p-6"><Empty text="No class-subjects set up yet." /></div> : (
        <table className="w-full min-w-[640px] text-left text-[13.5px]">
          <thead className="border-b border-black/[.06] dark:border-white/[.08]">
            <tr className="text-[12px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">
              <th className="px-5 py-3">Class · Subject</th>
              <th className="px-4 py-3">Teacher</th>
              <th className="px-4 py-3">Pace</th>
              <th className="px-4 py-3 text-right">Lost periods</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const p = data?.[i]
              return (
                <tr key={r.cs.id} className="border-b border-black/[.05] dark:border-white/[.07] last:border-0">
                  <td className="px-5 py-3 font-medium">{r.label}</td>
                  <td className="px-4 py-3 text-black/60 dark:text-white/60">{r.teacher?.name ?? '—'}</td>
                  <td className="px-4 py-3">
                    {loading && !p ? <span className={muted}>loading…</span> : !p ? <span className={muted}>no chapters/timetable yet</span> : <Pill tone={paceTone(p)}>{paceHeadline(p)}</Pill>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{p?.lostPeriods.total ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </Card>
  )
}

function TargetsTab() {
  const { boards, grades, subjectById, curriculumFor, classes } = useAcademic()
  const { term } = useActiveTerm()
  const { items: targets, reload } = useTargets({ termId: term })
  const { busy, create, remove } = useTargetActions()

  const [pickedBoardId, setPickedBoardId] = useState('')
  const [pickedGradeId, setPickedGradeId] = useState('')
  const boardId = boards.some(b => b.id === pickedBoardId) ? pickedBoardId : (boards[0]?.id ?? '')
  const gradeId = grades.some(g => g.id === pickedGradeId) ? pickedGradeId : (grades[0]?.id ?? '')
  const options = useMemo(() => curriculumFor({ boardId, gradeId }), [curriculumFor, boardId, gradeId])

  const [pickedCsId, setPickedCsId] = useState('')
  const [targetChapterId, setTargetChapterId] = useState('')
  const [targetClassId, setTargetClassId] = useState('')
  const csId = options.some(o => o.id === pickedCsId) ? pickedCsId : (options[0]?.id ?? '')
  const { items: chapters } = useChapters(csId)
  const sortedChapters = useMemo(() => [...(chapters ?? [])].sort((a, b) => a.order - b.order), [chapters])
  const classOptions = classes.filter(c => c.boardId === boardId && c.gradeId === gradeId)

  const canSave = !!csId && !!term && !!targetChapterId
  const save = async () => {
    if (!canSave) return
    const out = await create({ curriculumSubjectId: csId, termId: term, targetChapterId, classId: targetClassId || null })
    if (out) { setTargetChapterId(''); setTargetClassId(''); reload() }
  }

  // The listed targets can span curriculum-subjects the picker above isn't currently showing, so their
  // chapter titles are fetched independently (one GET per distinct curriculum-subject among the targets).
  const targetCsIds = useMemo(() => [...new Set((targets ?? []).map(t => t.curriculumSubjectId))], [targets])
  const chapterListPaths = useMemo(() => targetCsIds.map(id => `/syllabus/chapters?curriculumSubjectId=${encodeURIComponent(id)}`), [targetCsIds])
  const { data: chapterLists } = useFetchMany<{ items?: SyllabusChapter[] } | SyllabusChapter[]>(chapterListPaths)
  const chapterTitleMap = useMemo(() => {
    const m = new Map<string, string>()
    chapterLists?.forEach(list => (Array.isArray(list) ? list : list?.items ?? []).forEach(c => m.set(c.id, c.title)))
    return m
  }, [chapterLists])
  const curriculumSubjectById = useMemo(() => {
    const m = new Map<string, CurriculumSubject>()
    grades.forEach(g => boards.forEach(b => curriculumFor({ boardId: b.id, gradeId: g.id }).forEach(cs => m.set(cs.id, cs))))
    return m
  }, [boards, grades, curriculumFor])
  const subjectNameFor = (t: TermSyllabusTarget) => {
    const cs = curriculumSubjectById.get(t.curriculumSubjectId)
    return cs ? subjectById.get(cs.subjectId)?.name ?? 'Subject' : 'Subject'
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
      <Card>
        <p className={`mb-3 ${sectionLabel}`}>Set a target</p>
        <div className="space-y-3">
          <Field label="Board">
            <select value={boardId} onChange={e => setPickedBoardId(e.target.value)} className={inputCls}>
              {boards.map(b => <option key={b.id} value={b.id}>{b.code}</option>)}
            </select>
          </Field>
          <Field label="Grade">
            <select value={gradeId} onChange={e => setPickedGradeId(e.target.value)} className={inputCls}>
              {grades.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
          </Field>
          <Field label="Subject">
            <select value={csId} onChange={e => { setPickedCsId(e.target.value); setTargetChapterId('') }} className={inputCls}>
              <option value="">Select…</option>
              {options.map(o => <option key={o.id} value={o.id}>{subjectById.get(o.subjectId)?.name ?? 'Subject'}</option>)}
            </select>
          </Field>
          <Field label="Target chapter by term end">
            <select value={targetChapterId} onChange={e => setTargetChapterId(e.target.value)} className={inputCls} disabled={sortedChapters.length === 0}>
              <option value="">{sortedChapters.length === 0 ? 'No chapters for this subject yet' : 'Select…'}</option>
              {sortedChapters.map(c => <option key={c.id} value={c.id}>{c.order}. {c.title}</option>)}
            </select>
          </Field>
          <Field label="Class (optional — blank applies to every section)">
            <select value={targetClassId} onChange={e => setTargetClassId(e.target.value)} className={inputCls}>
              <option value="">Every section</option>
              {classOptions.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </Field>
          <button onClick={save} disabled={!canSave || busy} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40"><Target size={14} className="mr-1.5 inline" /> Set target</button>
        </div>
      </Card>
      <Card className="p-0">
        <div className="border-b border-black/[.06] dark:border-white/[.08] px-6 py-3"><p className={sectionLabel}>Targets this term · {targets?.length ?? 0}</p></div>
        {(targets ?? []).length === 0 ? <div className="p-6"><Empty text="No term targets set yet." /></div> : (
          <div className="divide-y divide-black/[.05] dark:divide-white/[.07]">
            {(targets ?? []).map(t => (
              <div key={t.id} className="flex items-center gap-3 px-6 py-3.5">
                <Target size={15} className="shrink-0 text-black/35 dark:text-white/35" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium">{subjectNameFor(t)} · by term end, reach: {chapterTitleMap.get(t.targetChapterId) ?? t.targetChapterId}</p>
                  <p className={muted}>{t.classId ? (classes.find(c => c.id === t.classId)?.label ?? 'One class') : 'Every section teaching this curriculum-subject'}</p>
                </div>
                <button onClick={() => remove(t.id, 'Target removed').then(reload)} className={dangerBtn}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function CoverageTab() {
  const rows = useTeachableClassSubjects()
  const [picked, setPicked] = useState('')
  const csId = rows.some(r => r.cs.id === picked) ? picked : (rows[0]?.cs.id ?? '')
  const row = rows.find(r => r.cs.id === csId)
  const { items, loading, error } = useCoverage(csId)

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Class subject">
          <select value={csId} onChange={e => setPicked(e.target.value)} className={`${inputCls} w-auto min-w-[220px]`}>
            {rows.map(r => <option key={r.cs.id} value={r.cs.id}>{r.label}</option>)}
          </select>
        </Field>
        <p className={`pb-2.5 ${muted}`}>Chapters marked Done — completion date next to the class's average score on any published assessment linked to that chapter.</p>
      </div>
      <Card className="p-0">
        {rows.length === 0 ? <div className="p-6"><Empty text="No class-subjects set up yet." /></div>
          : loading ? <p className="p-6 text-center text-[13.5px] text-black/40 dark:text-white/40">Loading…</p>
          : error ? <div className="p-6"><Empty text={error} /></div>
          : (items ?? []).length === 0 ? <div className="p-6"><Empty text={`No completed chapters for ${row?.label ?? 'this class-subject'} yet.`} /></div>
          : (
            <div className="divide-y divide-black/[.05] dark:divide-white/[.07]">
              {[...(items ?? [])].sort((a, b) => a.chapterOrder - b.chapterOrder).map(r => (
                <div key={r.chapterId} className="flex flex-wrap items-center gap-3 px-6 py-3.5">
                  <div className="min-w-[180px] flex-1">
                    <p className="text-[13.5px] font-medium">{r.chapterOrder}. {r.chapterTitle}</p>
                    <p className={muted}>Completed {fmtDate(r.completedAt)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {r.assessments.length === 0 ? <span className={muted}>No linked assessment yet</span> : r.assessments.map(a => (
                      <span key={a.assessmentId} className="flex items-center gap-1.5 rounded-full bg-black/[.04] dark:bg-white/[.06] px-3 py-1.5 text-[12.5px]">
                        {a.name}
                        {a.avgScorePct == null ? <span className="text-black/40 dark:text-white/40">no marks yet</span> : (
                          <Pill tone={a.avgScorePct >= 75 ? 'green' : a.avgScorePct >= 40 ? 'amber' : 'rose'}>{Math.round(a.avgScorePct)}% avg</Pill>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
      </Card>
    </div>
  )
}

export function SyllabusOverviewMod() {
  const { user } = useStore()
  const [tab, setTab] = useState<'pace' | 'targets' | 'coverage'>('pace')
  if (!isStaffOrAdmin(user)) return <div><PageHead title="Syllabus Overview" /><Empty text="Staff/admin access only." /></div>

  const tabBtn = (id: typeof tab, label: string) => (
    <button onClick={() => setTab(id)} className={`rounded-full px-4 py-2 text-[13px] font-semibold ${tab === id ? 'bg-black text-white' : 'bg-white dark:bg-[#14141f] text-black/60 dark:text-white/60 ring-1 ring-black/10 dark:ring-white/15'}`}>{label}</button>
  )
  return (
    <div>
      <PageHead title="Syllabus Overview" sub="Every class-subject's pace, term targets, and coverage-vs-learning">
        <div className="flex gap-2">{tabBtn('pace', 'Pace')}{tabBtn('targets', 'Targets')}{tabBtn('coverage', 'Coverage vs. learning')}</div>
      </PageHead>
      {tab === 'pace' && <PaceTab />}
      {tab === 'targets' && <TargetsTab />}
      {tab === 'coverage' && <CoverageTab />}
    </div>
  )
}
