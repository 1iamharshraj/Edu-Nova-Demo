import { useEffect, useMemo, useState } from 'react'
import { BrainCircuit, Download, Languages, Pencil, Sparkles, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAcademic, useStore } from '@/lib/store'
import { api, ApiError, downloadFile, errorMessage } from '@/lib/api'
import { TRANSLATE_LANGUAGES, compareClasses, type GeneratedWorksheetRec, type ReportCard, type TranslateLanguage, type WorksheetDifficulty } from '@/lib/data'
import { useProgress } from '@/lib/hooks/useSyllabus'
import { qs, useClassStudents, useTeachableClassSubjects } from '@/lib/hooks/useAcademics'
import { draftRemark, generateWorksheetDraft, saveGeneratedWorksheet, saveReportCardRemark, translateText, useGeneratedWorksheets } from '@/lib/hooks/useAiTools'
import { Avatar, Card, Empty, Field, Modal, PageHead, TermTabs, inputCls } from '../ui'
import { useActiveTerm } from './viewer'

/** The server doesn't (yet) render a PDF for a saved worksheet — `pdfFileId` is reserved for when it does
 * (see `GeneratedWorksheetRec`). Until then this exports the reviewed/saved content as a plain-text file,
 * client-side, same pattern as `StudentReportMod`'s `downloadTxt` in studentReport.tsx — not a fake API. */
function downloadWorksheet(w: GeneratedWorksheetRec) {
  if (w.pdfFileId) { downloadFile(w.pdfFileId, `${w.title.replace(/\s+/g, '_')}.pdf`).catch(e => toast.error(errorMessage(e))); return }
  const blob = new Blob([`${w.title}\n${'='.repeat(w.title.length)}\n\n${w.content}`], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${w.title.replace(/\s+/g, '_')}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

// Phase 20 — AI-powered teaching & communication. See .agents/edunova/phase-20-ai-teaching-communication.md
// and server/src/modules/ai/ (extended in parallel for items 2-4; item 1 is a server-only prompt change,
// already covered by the existing AIDoubtsMod in social.tsx).
//
// Every AI draft rendered here is clearly labeled and edit-before-save — see the "AI-generated draft"
// banners below. Nothing in this file ever saves/sends a draft without an explicit teacher action.

const DIFFICULTIES: WorksheetDifficulty[] = ['easy', 'medium', 'hard']
const DIFFICULTY_LABEL: Record<WorksheetDifficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }

/** Renders when the server answers 503 (no `ANTHROPIC_API_KEY` configured) — same message shape/tone as
 * `AIDoubtsMod`'s not-configured card in social.tsx, so the "AI is off" experience reads the same everywhere. */
function NotConfiguredCard({ what }: { what: string }) {
  return (
    <div className="rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-8 text-center">
      <BrainCircuit size={26} className="mx-auto text-black/25 dark:text-white/25" />
      <p className="mt-3 text-[14.5px] font-semibold">{what} not available</p>
      <p className="mx-auto mt-1 max-w-sm text-[13px] text-black/40 dark:text-white/40">
        The school hasn't connected an AI provider yet. Ask your admin to set it up, or check back later.
      </p>
    </div>
  )
}

/* ── shared: inline translate (item 4) ──────────────────────
 * Dropped next to any composed/read notice, message or remark. Always renders the translation in its own
 * panel below the original — it never edits or replaces the source text. */
export function TranslateInline({ text, className = '' }: { text: string; className?: string }) {
  const [lang, setLang] = useState<TranslateLanguage>('Hindi')
  const [state, setState] = useState<{ status: 'idle' | 'busy' | 'done' | 'not-configured'; text?: string }>({ status: 'idle' })

  const run = async () => {
    const t = text.trim()
    if (!t || state.status === 'busy') return
    setState({ status: 'busy' })
    try {
      const res = await translateText(t, lang)
      setState({ status: 'done', text: res.translatedText })
    } catch (e) {
      if (e instanceof ApiError && (e.status === 503 || /not configured/i.test(e.message))) setState({ status: 'not-configured' })
      else { toast.error(errorMessage(e)); setState({ status: 'idle' }) }
    }
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <select value={lang} onChange={e => { setLang(e.target.value as TranslateLanguage); setState({ status: 'idle' }) }}
          className="rounded-full border border-black/[.08] dark:border-white/[.1] bg-white dark:bg-[#14141f] px-2.5 py-1 text-[11.5px] font-medium outline-none">
          {TRANSLATE_LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <button type="button" onClick={run} disabled={!text.trim() || state.status === 'busy'}
          className="flex items-center gap-1.5 rounded-full bg-black/[.05] dark:bg-white/[.08] px-3 py-1 text-[11.5px] font-semibold text-black/70 dark:text-white/70 hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-40">
          <Languages size={12} /> {state.status === 'busy' ? 'Translating…' : 'Translate'}
        </button>
      </div>
      {state.status === 'not-configured' && (
        <p className="mt-2 rounded-xl bg-black/[.03] dark:bg-white/[.05] px-3 py-2 text-[12px] text-black/45 dark:text-white/45">
          Translation isn't available — the school hasn't connected an AI provider yet.
        </p>
      )}
      {state.status === 'done' && (
        <div className="mt-2 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 px-3 py-2.5">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-300">{lang} translation (AI-generated)</p>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{state.text}</p>
        </div>
      )}
    </div>
  )
}

/* ── worksheet generator (item 2) ───────────────────────── */

export function WorksheetGeneratorMod() {
  const rows = useTeachableClassSubjects()
  const [picked, setPicked] = useState('')
  const row = rows.find(r => r.cs.id === picked) ?? rows[0]
  const csId = row?.cs.id

  const { items: progressRows } = useProgress(csId)
  const chapters = useMemo(() => [...(progressRows ?? [])].map(r => r.chapter).sort((a, b) => a.order - b.order), [progressRows])
  const [chapterIds, setChapterIds] = useState<string[]>([])
  const toggleChapter = (id: string) => setChapterIds(ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]))

  const [questionCount, setQuestionCount] = useState('10')
  const [difficulty, setDifficulty] = useState<WorksheetDifficulty>('medium')
  const [draft, setDraft] = useState<{ title: string; content: string } | null>(null)
  const [genBusy, setGenBusy] = useState(false)
  const [notConfigured, setNotConfigured] = useState(false)
  const [limitMessage, setLimitMessage] = useState<string | null>(null)
  const [saveBusy, setSaveBusy] = useState(false)

  const { items: saved, loading: savedLoading, error: savedError, reload: reloadSaved } = useGeneratedWorksheets(csId)

  // Reset the draft/chapter selection when the picked class-subject changes — adjusted at render time.
  const [seenCsId, setSeenCsId] = useState(csId)
  if (seenCsId !== csId) { setSeenCsId(csId); setChapterIds([]); setDraft(null) }

  const generate = async () => {
    if (!csId) return
    if (chapterIds.length === 0) { toast.error('Pick at least one chapter'); return }
    setGenBusy(true)
    setLimitMessage(null)
    try {
      const res = await generateWorksheetDraft({ classSubjectId: csId, chapterIds, questionCount: Number(questionCount) || undefined, difficulty })
      setDraft({ title: res.title, content: res.content })
      setNotConfigured(false)
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) { setLimitMessage(e.message); toast.error(e.message) }
      else if (e instanceof ApiError && (e.status === 503 || /not configured/i.test(e.message))) setNotConfigured(true)
      else toast.error(errorMessage(e))
    } finally { setGenBusy(false) }
  }

  const save = async () => {
    if (!draft || !csId) return
    if (!draft.title.trim() || !draft.content.trim()) { toast.error('Title and content are required'); return }
    setSaveBusy(true)
    try {
      await saveGeneratedWorksheet({ classSubjectId: csId, chapterIds, title: draft.title.trim(), content: draft.content })
      toast.success('Worksheet saved')
      setDraft(null)
      reloadSaved()
    } catch (e) { toast.error(errorMessage(e)) } finally { setSaveBusy(false) }
  }

  const header = (
    <PageHead title="AI Worksheet Generator" sub="Draft a question paper from your syllabus chapters — review and edit before saving">
      {rows.length > 0 && (
        <select value={csId ?? ''} onChange={e => setPicked(e.target.value)} className={`${inputCls} w-auto min-w-[200px] py-2 text-[13.5px]`} aria-label="Class subject">
          {rows.map(r => <option key={r.cs.id} value={r.cs.id}>{r.label}</option>)}
        </select>
      )}
    </PageHead>
  )

  if (rows.length === 0) return <div>{header}<Empty text="No subjects assigned to you yet." /></div>

  return (
    <div className="space-y-5">
      {header}

      <Card>
        <p className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Chapters to cover</p>
        {chapters.length === 0 ? (
          <Empty text="No syllabus chapters set up for this subject yet — add chapters under Curriculum first." />
        ) : (
          <div className="flex flex-wrap gap-2">
            {chapters.map(c => (
              <button key={c.id} type="button" onClick={() => toggleChapter(c.id)}
                className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-colors ${chapterIds.includes(c.id) ? 'bg-black text-white dark:bg-white dark:text-black' : 'bg-black/[.05] dark:bg-white/[.08] text-black/60 dark:text-white/60 hover:bg-black/10 dark:hover:bg-white/15'}`}>
                {c.order}. {c.title}
              </button>
            ))}
          </div>
        )}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Number of questions"><input type="number" min={1} max={50} value={questionCount} onChange={e => setQuestionCount(e.target.value)} className={inputCls} /></Field>
          <Field label="Difficulty">
            <select value={difficulty} onChange={e => setDifficulty(e.target.value as WorksheetDifficulty)} className={inputCls}>
              {DIFFICULTIES.map(d => <option key={d} value={d}>{DIFFICULTY_LABEL[d]}</option>)}
            </select>
          </Field>
        </div>
        <button onClick={generate} disabled={genBusy || chapters.length === 0 || chapterIds.length === 0}
          className="btn-ink mt-5 flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40">
          <Wand2 size={15} /> {genBusy ? 'Generating…' : 'Generate draft'}
        </button>
        {limitMessage && <p className="mt-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 px-3.5 py-2 text-[12.5px] font-medium text-amber-700 dark:text-amber-400">{limitMessage}</p>}
      </Card>

      {notConfigured && <Card><NotConfiguredCard what="AI worksheet generation" /></Card>}

      {draft && (
        <Card className="border-2 border-indigo-200 dark:border-indigo-500/30">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white"><Sparkles size={15} /></span>
            <div>
              <p className="text-[14px] font-semibold">AI-generated draft — review before saving</p>
              <p className="text-[12px] text-black/45 dark:text-white/45">Edit anything below, then explicitly save it. Nothing is stored until you do.</p>
            </div>
          </div>
          <div className="space-y-4">
            <Field label="Title"><input value={draft.title} onChange={e => setDraft(d => d && { ...d, title: e.target.value })} className={inputCls} /></Field>
            <Field label="Content">
              <textarea value={draft.content} onChange={e => setDraft(d => d && { ...d, content: e.target.value })} rows={16}
                className={`${inputCls} font-mono text-[13px] leading-relaxed`} />
            </Field>
          </div>
          <div className="mt-5 flex gap-3">
            <button onClick={save} disabled={saveBusy} className="btn-ink flex-1 py-3 text-[14px] font-semibold disabled:opacity-40">{saveBusy ? 'Saving…' : 'Save worksheet'}</button>
            <button onClick={() => setDraft(null)} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Discard</button>
          </div>
        </Card>
      )}

      <Card>
        <p className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Saved worksheets</p>
        {savedLoading ? <p className="py-6 text-center text-[13px] text-black/40 dark:text-white/40">Loading…</p>
          : savedError ? <Empty text={savedError} />
          : (saved ?? []).length === 0 ? <Empty text="No worksheets saved for this subject yet." />
          : (
            <div className="space-y-2">
              {(saved ?? []).map(w => (
                <div key={w.id} className="flex items-center justify-between gap-3 rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3.5">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold">{w.title}</p>
                    <p className="text-[12px] text-black/45 dark:text-white/45">{w.chapterIds.length} chapter{w.chapterIds.length === 1 ? '' : 's'} · {new Date(w.createdAt).toLocaleDateString('en-IN')}</p>
                  </div>
                  <button onClick={() => downloadWorksheet(w)} className="flex shrink-0 items-center gap-1.5 rounded-full bg-black/[.05] dark:bg-white/[.08] px-3.5 py-1.5 text-[12px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">
                    <Download size={13} /> Download
                  </button>
                </div>
              ))}
            </div>
          )}
      </Card>
    </div>
  )
}

/* ── report-card remarks (item 3) ────────────────────────
 * The one teacher-editable overall remark per (student, term) — `Enrollment.remarks[termId]`, read back as
 * `ReportCard.remark`, saved via `PUT /assessments/report-card/remark` (modules/assessments/service.ts
 * #setReportCardRemark). Scope matches `POST /ai/draft-remark`: the student's class teacher, or staff/admin.
 * "Draft AI Remark" only ever fills this screen's own editable field — saving is a separate, explicit click. */

export function ReportCardRemarksMod() {
  const { db, user } = useStore()
  const { classes, currentYear, gradeById } = useAcademic()
  const { term, setTerm } = useActiveTerm()
  const isTeacher = user?.role === 'teacher'

  const classList = useMemo(() => {
    const base = classes.filter(c => !currentYear || c.academicYearId === currentYear.id)
    return (isTeacher ? base.filter(c => c.classTeacherId === user!.id) : base).sort(compareClasses(gradeById))
  }, [classes, currentYear, gradeById, isTeacher, user])

  const [picked, setPicked] = useState('')
  const classId = classList.some(c => c.id === picked) ? picked : (classList[0]?.id ?? '')
  const cls = classList.find(c => c.id === classId)
  const students = useClassStudents(classId)

  // One report card per student in the picked class/term, fetched in parallel — same pattern as
  // useFetchMany (useAcademics.ts), but with its own reload nonce since that hook doesn't expose one.
  const studentIds = useMemo(() => students.map(s => s.id).join(','), [students])
  const [nonce, setNonce] = useState(0)
  const [cardsState, setCardsState] = useState<{ key: string; data?: (ReportCard | undefined)[] }>({ key: '' })
  const fetchKey = `${studentIds}|${term}|${nonce}`
  useEffect(() => {
    if (!term || students.length === 0) return
    let cancelled = false
    Promise.all(students.map(s => api.get<ReportCard>(`/assessments/report-card${qs({ studentId: s.id, termId: term })}`).catch(() => undefined)))
      .then(data => { if (!cancelled) setCardsState({ key: fetchKey, data }) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey])
  const cards = students.length === 0 ? [] : (cardsState.key === fetchKey ? cardsState.data : undefined)
  const loading = students.length > 0 && !cards

  const [editing, setEditing] = useState<{ studentId: string; name: string } | null>(null)

  const header = (
    <PageHead title="Report Card Remarks" sub="One overall remark per student per term — draft with AI, then review and save it yourself">
      <div className="flex flex-wrap items-center gap-2">
        {classList.length > 0 && (
          <select value={classId} onChange={e => setPicked(e.target.value)} className={`${inputCls} w-auto min-w-[160px] py-2 text-[13.5px]`} aria-label="Class">
            {classList.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        )}
        <TermTabs terms={db.terms} term={term} setTerm={setTerm} />
      </div>
    </PageHead>
  )

  if (classList.length === 0) return <div>{header}<Empty text={isTeacher ? "You aren't the class teacher of any class yet." : 'No classes yet.'} /></div>
  if (!term) return <div>{header}<Empty text="Create a term first." /></div>

  return (
    <div>
      {header}
      <Card className="p-0">
        {students.length === 0 ? <div className="p-6"><Empty text={`No students enrolled in ${cls?.label ?? 'this class'} yet.`} /></div>
          : loading ? <div className="p-6"><p className="text-center text-[13px] text-black/40 dark:text-white/40">Loading…</p></div>
          : students.map((s, i) => {
            const card = cards?.[i]
            return (
              <div key={s.id} className="flex items-start gap-3.5 border-b border-black/[.05] dark:border-white/[.07] px-5 py-4 last:border-0">
                <Avatar name={s.name} hue={s.avatarHue} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold">{s.name}</p>
                  {card?.remark ? (
                    <p className="mt-1 text-[13px] leading-relaxed text-black/65 dark:text-white/65">{card.remark}</p>
                  ) : (
                    <p className="mt-1 text-[12.5px] text-black/35 dark:text-white/35">No remark saved for this term yet.</p>
                  )}
                </div>
                <button onClick={() => setEditing({ studentId: s.id, name: s.name })}
                  className="flex shrink-0 items-center gap-1.5 rounded-full bg-black/[.05] dark:bg-white/[.08] px-3.5 py-1.5 text-[12px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">
                  <Pencil size={12} /> {card?.remark ? 'Edit' : 'Add'}
                </button>
              </div>
            )
          })}
      </Card>

      {editing && (
        <RemarkModal studentId={editing.studentId} studentName={editing.name} termId={term}
          initial={cards?.[students.findIndex(s => s.id === editing.studentId)]?.remark ?? ''}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setNonce(n => n + 1) }}
        />
      )}
    </div>
  )
}

function RemarkModal({ studentId, studentName, termId, initial, onClose, onSaved }: {
  studentId: string; studentName: string; termId: string; initial: string; onClose: () => void; onSaved: () => void
}) {
  const [text, setText] = useState(initial)
  const [draftState, setDraftState] = useState<{ status: 'idle' | 'busy' | 'done' | 'not-configured'; text?: string; limitMessage?: string }>({ status: 'idle' })
  const [saveBusy, setSaveBusy] = useState(false)

  const requestDraft = async () => {
    setDraftState({ status: 'busy' })
    try {
      const res = await draftRemark(studentId, termId)
      setDraftState({ status: 'done', text: res.draft })
    } catch (e) {
      if (e instanceof ApiError && (e.status === 503 || /not configured/i.test(e.message))) setDraftState({ status: 'not-configured' })
      else if (e instanceof ApiError && e.status === 429) setDraftState({ status: 'idle', limitMessage: e.message })
      else { toast.error(errorMessage(e)); setDraftState({ status: 'idle' }) }
    }
  }
  const useDraft = () => { if (draftState.text) setText(draftState.text) }

  const save = async () => {
    if (!text.trim()) { toast.error('Remark cannot be empty'); return }
    setSaveBusy(true)
    try {
      await saveReportCardRemark(studentId, termId, text.trim())
      toast.success('Remark saved')
      onSaved()
    } catch (e) { toast.error(errorMessage(e)) } finally { setSaveBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title={`Remark · ${studentName}`}>
      <div className="space-y-4">
        <button type="button" onClick={requestDraft} disabled={draftState.status === 'busy'}
          className="flex items-center gap-2 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-50">
          <BrainCircuit size={14} /> {draftState.status === 'busy' ? 'Drafting…' : 'Draft AI Remark'}
        </button>
        {draftState.limitMessage && <p className="rounded-xl bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-[12px] font-medium text-amber-700 dark:text-amber-400">{draftState.limitMessage}</p>}
        {draftState.status === 'not-configured' && (
          <p className="rounded-xl bg-black/[.03] dark:bg-white/[.05] px-3 py-2 text-[12px] text-black/45 dark:text-white/45">
            AI remark drafting isn't available — the school hasn't connected an AI provider yet.
          </p>
        )}
        {draftState.status === 'done' && draftState.text && (
          <div className="rounded-xl bg-indigo-50 dark:bg-indigo-500/10 p-3.5">
            <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-300"><Sparkles size={11} /> AI-generated draft — review before using</p>
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{draftState.text}</p>
            <button type="button" onClick={useDraft} className="mt-2 rounded-full bg-white dark:bg-[#14141f] px-3 py-1.5 text-[12px] font-semibold text-indigo-600 ring-1 ring-indigo-200 hover:bg-indigo-50 dark:text-indigo-300 dark:ring-indigo-500/30">
              Copy into remark below
            </button>
          </div>
        )}
        <Field label="Remark (visible to the student/parent once saved)">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={4} className={inputCls}
            placeholder="e.g. Aarav has shown consistent improvement in Mathematics this term and participates actively in class." />
        </Field>
        <TranslateInline text={text} />
        <div className="flex gap-3 pt-1">
          <button onClick={save} disabled={saveBusy || !text.trim()} className="btn-ink flex-1 py-3 text-[14px] font-semibold disabled:opacity-40">{saveBusy ? 'Saving…' : 'Save remark'}</button>
          <button onClick={onClose} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Cancel</button>
        </div>
      </div>
    </Modal>
  )
}
