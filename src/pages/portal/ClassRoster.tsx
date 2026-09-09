import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, UserPlus, X } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { ThemeToggle } from '@/lib/theme'
import { useAcademic, useStore } from '@/lib/store'
import { useEntity } from '@/lib/hooks/useEntity'
import { Avatar, Card, Empty, PageHead, inputCls } from '@/portal/ui'
import { AsyncEntityPicker } from '@/portal/components/AsyncEntityPicker'
import { byRoll, dangerBtn, muted, sectionLabel } from '@/portal/modules/academicShared'

// Converted from ClassesMod's "Roster" modal (academic.tsx) — a mini list+editor (add-student form +
// enrolled-students list with remove actions) — into a real routed page. See
// .agents/edunova/ui-architecture-fix.md, Phase C #4. The student picker was already retrofitted to
// AsyncEntityPicker in Phase B and is carried over unchanged.

export default function ClassRoster() {
  const { id: classId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { db } = useStore()
  const { enrollments: allEnrollments } = useAcademic()
  const classes = useEntity('classes')
  const enrollments = useEntity('enrollments')

  const rosterClass = classes.items.find(c => c.id === classId) ?? null
  const userById = useMemo(() => new Map(db.users.map(u => [u.id, u])), [db.users])
  const roster = useMemo(() =>
    allEnrollments.filter(e => e.classId === classId && e.status === 'active').sort(byRoll),
  [allEnrollments, classId])

  const [pickId, setPickId] = useState('')
  const [pickRoll, setPickRoll] = useState('')
  const [rollDraft, setRollDraft] = useState<Record<string, string>>({})

  const addStudent = async () => {
    if (!rosterClass || !pickId) return
    const out = await enrollments.create({ studentId: pickId, classId: rosterClass.id, rollNo: pickRoll.trim() || undefined }, 'Student enrolled')
    if (out) { setPickId(''); setPickRoll('') }
  }
  const commitRoll = async (e: { id: string; rollNo?: string }) => {
    const draft = rollDraft[e.id]
    if (draft === undefined) return
    const next = draft.trim()
    setRollDraft(d => { const { [e.id]: _, ...rest } = d; void _; return rest })
    if (next === (e.rollNo ?? '')) return
    await enrollments.update(e.id, { rollNo: next || undefined }, 'Roll number updated')
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
        {!rosterClass ? (
          <Empty text="Class not found." />
        ) : (
          <>
            <PageHead title={`Roster · ${rosterClass.label}`} />
            <Card>
              <div className="space-y-5">
                <div className="rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-4">
                  <p className={`mb-3 ${sectionLabel}`}>Add student</p>
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-[200px] flex-1">
                      <AsyncEntityPicker role="student" value={pickId}
                        onChange={id => setPickId(id)}
                        placeholder="Search students by name or email…" />
                    </div>
                    <input value={pickRoll} onChange={e => setPickRoll(e.target.value)} placeholder="Roll no." className={inputCls + ' w-28'} />
                    <button onClick={addStudent} disabled={!pickId || enrollments.busy} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40">
                      <UserPlus size={15} /> Add
                    </button>
                  </div>
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
            </Card>
          </>
        )}
      </main>
    </div>
  )
}
