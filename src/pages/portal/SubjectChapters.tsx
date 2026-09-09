import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, ChevronDown, ChevronUp, Pencil, Trash2 } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { ThemeToggle } from '@/lib/theme'
import { useAcademic } from '@/lib/store'
import { useChapterActions, useChapters } from '@/lib/hooks/useSyllabus'
import type { SyllabusChapter } from '@/lib/data'
import { Card, Empty, Field, Modal, PageHead, inputCls } from '@/portal/ui'
import { ConfirmModal, FormActions, HeaderAdd } from '@/portal/modules/academic'
import { comboLabel, dangerBtn, emptyChapterForm, iconBtn, muted, type ChapterForm } from '@/portal/modules/academicShared'

// Converted from `ChapterManagerModal` (academic.tsx) — an outer modal wrapping its own nested add/edit and
// delete-confirm sub-modals — into a real routed page. See .agents/edunova/ui-architecture-fix.md, Phase C #2.
// The nested add/edit form and delete-confirm stay as single-level modals ON this page; only the outer
// "Chapters" wrapper (previously opened from inside the Curriculum modal-adjacent table) was eliminated.

export default function SubjectChapters() {
  const { id: curriculumSubjectId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { curriculum, subjectById, boardById, gradeById, streamById } = useAcademic()
  const row = useMemo(() => curriculum.find(r => r.id === curriculumSubjectId), [curriculum, curriculumSubjectId])
  const subject = row ? subjectById.get(row.subjectId) : undefined
  const subjectLabel = row
    ? `${subject?.name ?? 'Subject'} · ${comboLabel(boardById.get(row.boardId), gradeById.get(row.gradeId), row.streamId ? streamById.get(row.streamId) : undefined)}`
    : ''

  const { items, loading, error, reload } = useChapters(curriculumSubjectId)
  const chapters = useMemo(() => [...(items ?? [])].sort((a, b) => a.order - b.order), [items])
  const totalPeriods = useMemo(() => chapters.reduce((sum, c) => sum + (c.estimatedPeriods || 0), 0), [chapters])
  const { busy, create, update, remove, swapOrder } = useChapterActions()

  const [form, setForm] = useState<{ id?: string; body: ChapterForm } | null>(null)
  const openAdd = () => setForm({ body: emptyChapterForm() })
  const openEdit = (c: SyllabusChapter) => setForm({ id: c.id, body: { title: c.title, estimatedPeriods: String(c.estimatedPeriods ?? ''), examWeightagePct: c.examWeightagePct != null ? String(c.examWeightagePct) : '' } })
  const formOk = !!form && form.body.title.trim() !== '' && Number(form.body.estimatedPeriods) > 0
  const save = async () => {
    if (!form || !formOk || !curriculumSubjectId) return
    const examWeightagePct = form.body.examWeightagePct.trim() ? Number(form.body.examWeightagePct) : null
    const out = form.id
      ? await update(form.id, { title: form.body.title.trim(), estimatedPeriods: Number(form.body.estimatedPeriods), examWeightagePct }, 'Chapter updated')
      : await create({ curriculumSubjectId, order: chapters.length + 1, title: form.body.title.trim(), estimatedPeriods: Number(form.body.estimatedPeriods), examWeightagePct }, 'Chapter added')
    if (out) { setForm(null); reload() }
  }
  const [del, setDel] = useState<SyllabusChapter | null>(null)
  const move = async (i: number, dir: -1 | 1) => {
    const a = chapters[i], b = chapters[i + dir]
    if (!a || !b) return
    if (await swapOrder(a, b, chapters.map(c => c.order))) reload()
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
        {!row ? (
          <Empty text="Curriculum subject not found." />
        ) : (
          <>
            <PageHead title={`Chapters · ${subjectLabel}`} />
            <Card>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className={muted}>{chapters.length} chapter{chapters.length === 1 ? '' : 's'}{totalPeriods ? ` · ${totalPeriods} periods estimated` : ''} — shared by every section teaching this curriculum-subject.</p>
                  <HeaderAdd label="Add chapter" onClick={openAdd} />
                </div>
                {loading ? <p className="py-8 text-center text-[13.5px] text-black/40 dark:text-white/40">Loading chapters…</p>
                  : error ? <Empty text={error} />
                  : chapters.length === 0 ? <Empty text="No chapters yet. Build the chapter list by hand — add each chapter with its estimated period count." />
                  : (
                    <div className="rounded-2xl border border-black/[.06] dark:border-white/[.08]">
                      {chapters.map((c, i) => (
                        <div key={c.id} className="flex items-start gap-3 border-b border-black/[.05] dark:border-white/[.07] px-4 py-3 last:border-0">
                          <div className="flex flex-col gap-0.5 pt-0.5">
                            <button onClick={() => move(i, -1)} disabled={i === 0 || busy} className={iconBtn} aria-label="Move up"><ChevronUp size={13} /></button>
                            <button onClick={() => move(i, 1)} disabled={i === chapters.length - 1 || busy} className={iconBtn} aria-label="Move down"><ChevronDown size={13} /></button>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[14px] font-semibold">{i + 1}. {c.title}</p>
                            <p className={muted}>{c.estimatedPeriods} period{c.estimatedPeriods === 1 ? '' : 's'}{c.examWeightagePct != null ? ` · ${c.examWeightagePct}% exam weightage` : ''}</p>
                          </div>
                          <button onClick={() => openEdit(c)} className={iconBtn} aria-label="Edit"><Pencil size={14} /></button>
                          <button onClick={() => setDel(c)} className={dangerBtn} aria-label="Delete"><Trash2 size={14} /></button>
                        </div>
                      ))}
                    </div>
                  )}
              </div>
            </Card>
          </>
        )}
      </main>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit chapter' : `New chapter · ${subjectLabel}`}>
        {form && (
          <div className="space-y-4">
            <Field label="Title"><input value={form.body.title} onChange={e => setForm({ ...form, body: { ...form.body, title: e.target.value } })} placeholder="e.g. Real Numbers" className={inputCls} autoFocus /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Estimated periods"><input type="number" min={1} value={form.body.estimatedPeriods} onChange={e => setForm({ ...form, body: { ...form.body, estimatedPeriods: e.target.value } })} className={inputCls} /></Field>
              <Field label="Exam weightage % (optional)"><input type="number" min={0} max={100} value={form.body.examWeightagePct} onChange={e => setForm({ ...form, body: { ...form.body, examWeightagePct: e.target.value } })} className={inputCls} /></Field>
            </div>
            <FormActions onCancel={() => setForm(null)} onSave={save} label={form.id ? 'Save changes' : 'Add chapter'} disabled={!formOk || busy} />
          </div>
        )}
      </Modal>

      <ConfirmModal open={!!del} onClose={() => setDel(null)} title={`Delete "${del?.title ?? ''}"?`}
        body="This removes the chapter and every class-section's recorded progress against it."
        action="Delete chapter" busy={busy}
        onConfirm={async () => { if (del && await remove(del.id, 'Chapter deleted')) { setDel(null); reload() } }} />
    </div>
  )
}
