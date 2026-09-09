import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Logo } from '@/components/Logo'
import { ThemeToggle } from '@/lib/theme'
import { useAcademic, useStore } from '@/lib/store'
import { useEntity } from '@/lib/hooks/useEntity'
import { api, errorMessage } from '@/lib/api'
import type { ClassSubject } from '@/lib/data'
import { Card, Empty, PageHead, inputCls } from '@/portal/ui'
import { AsyncEntityPicker } from '@/portal/components/AsyncEntityPicker'
import { classPills, dangerBtn, ghostBtn, muted, sectionLabel, swatch } from '@/portal/modules/academicShared'

// Converted from ClassesMod's "Subjects & teachers" modal (academic.tsx) — a mini list+editor (add-subject
// form + editable subject/teacher/periods-per-week table + sync-from-curriculum action) — into a real routed
// page. See .agents/edunova/ui-architecture-fix.md, Phase C #3. The teacher picker was already retrofitted to
// AsyncEntityPicker in Phase B and is carried over unchanged.

export default function ClassSubjects() {
  const { id: classId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { db, refreshAcademic } = useStore()
  const { subjectById, subjects: allSubjects } = useAcademic()
  const classes = useEntity('classes')
  const classSubjects = useEntity('classSubjects')

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)
  const sortedSubjects = useMemo(() => [...allSubjects].sort(byName), [allSubjects])
  const userById = useMemo(() => new Map(db.users.map(u => [u.id, u])), [db.users])
  const subjectsClass = classes.items.find(c => c.id === classId) ?? null

  const [periodsDraft, setPeriodsDraft] = useState<Record<string, string>>({})
  const [addSubjectId, setAddSubjectId] = useState('')
  const [syncing, setSyncing] = useState(false)

  const classRows = useMemo(() =>
    classSubjects.items
      .filter(cs => cs.classId === classId)
      .map(cs => ({ cs, subject: subjectById.get(cs.subjectId) }))
      .sort((a, b) => (a.subject?.name ?? '').localeCompare(b.subject?.name ?? '')),
  [classSubjects.items, classId, subjectById])
  const addableSubjects = useMemo(() => {
    const onClass = new Set(classRows.map(r => r.cs.subjectId))
    return sortedSubjects.filter(s => !onClass.has(s.id))
  }, [classRows, sortedSubjects])
  const totalPeriods = classRows.reduce((sum, r) => sum + r.cs.periodsPerWeek, 0)
  const busyRows = classSubjects.busy || syncing

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
        {!subjectsClass ? (
          <Empty text="Class not found." />
        ) : (
          <>
            <PageHead title={`Subjects & teachers · ${subjectsClass.label}`} />
            <Card>
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
                            <AsyncEntityPicker role="teacher" value={cs.teacherId ?? ''} onChange={id => setTeacher(cs, id)}
                              placeholder="Search teachers…"
                              initialLabel={cs.teacherId ? userById.get(cs.teacherId)?.name : undefined} />
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
            </Card>
          </>
        )}
      </main>
    </div>
  )
}
