import { useState } from 'react'
import { AlertTriangle, Check, FileText, MapPin, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useStore } from '@/lib/store'
import { isAdmin } from '@/lib/access'
import type { AdmissionCategory, ApplicationRec, RequiredDocumentType, SubmittedDocument } from '@/lib/data'
import {
  documentStatusTone, seedDefaultAdmissionCategories, seedDefaultDocumentTypes, useAdmissionCategories, useAdmissionSettings,
  useChecklist, useRecordsReport, useRequiredDocumentTypes, useSubmittedDocumentActions, useSubmittedDocuments,
} from '@/lib/hooks/useDocuments'
import { fmtDate } from '@/lib/hooks/useAcademics'
import { Card, Empty, Field, Modal, PageHead, Pill, UploadField, inputCls, type UploadedFile } from '../ui'
import { ConfirmModal, FormActions, HeaderAdd } from './academic'
import { dangerBtn, iconBtn, muted } from './academicShared'

// Phase T2 Part B — document & certificate management with physical custody tracking.
// See .agents/edunova/phase-t2-strong-admissions.md. Matches the real server contract under
// /api/admission-documents (server/src/modules/admissionDocuments). Part A's extended admission form lives
// in office.tsx; this file owns the AdmissionCategory + RequiredDocumentType catalogs (one combined admin
// screen), the completeness checklist (used from the Application detail page), and the records report. The
// TC-issuance return workflow gets its own page — see src/pages/portal/TcIssuance.tsx.

/* ── AdmissionCategory + RequiredDocumentType catalogs (admin screen) ───────────
 * UX-fit call (D9): a Card list + add/edit Modal per tab, matching every other small catalog in this app
 * (Boards, Grades, Activities) rather than a dedicated route — rows of a handful of fields with no nested
 * sub-editor, exactly the shape this codebase already keeps as a modal-off-a-list, not the "mini-app in a
 * modal" pattern the earlier UI-architecture fix moved away from. Combined into one module (tabs, not two
 * separate Portal entries) since the two catalogs are small, always edited by the same admin, and the
 * document-type conditions directly reference category codes — flipping between two standalone screens to
 * cross-check a code would be worse than one screen with a tab switch. Both catalogs are soft-delete only
 * (PATCH isActive:false) — the server has no DELETE for either, since existing submissions may reference them. */

const emptyCategoryForm = { name: '', code: '', requiresCertificate: false, isActive: true }
type CategoryForm = typeof emptyCategoryForm
const emptyTypeForm = { name: '', code: '', alwaysRequired: false, requiredIfCategoryIn: '', requiredIfAdmissionMode: '', requiredIfBoardChanged: false, isActive: true }
type TypeForm = typeof emptyTypeForm

function CategoriesTab({ canManage }: { canManage: boolean }) {
  const categories = useAdmissionCategories()
  const [modal, setModal] = useState<{ t: 'form'; editing?: AdmissionCategory } | { t: 'deactivate'; item: AdmissionCategory } | null>(null)
  const [form, setForm] = useState<CategoryForm>(emptyCategoryForm)
  const [seeding, setSeeding] = useState(false)

  const openAdd = () => { setForm(emptyCategoryForm); setModal({ t: 'form' }) }
  const openEdit = (c: AdmissionCategory) => { setForm({ name: c.name, code: c.code, requiresCertificate: c.requiresCertificate, isActive: c.isActive }); setModal({ t: 'form', editing: c }) }
  const save = async () => {
    const body = { name: form.name.trim(), code: form.code.trim() || form.name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_'), requiresCertificate: form.requiresCertificate, isActive: form.isActive }
    const editing = modal?.t === 'form' ? modal.editing : undefined
    const out = editing ? await categories.update(editing.id, body, 'Category updated') : await categories.create(body, 'Category added')
    if (out) setModal(null)
  }
  const deactivate = async () => {
    if (modal?.t !== 'deactivate') return
    if (await categories.deactivate(modal.item.id, 'Category deactivated')) setModal(null)
  }
  const seed = async () => {
    setSeeding(true)
    try { await seedDefaultAdmissionCategories(); categories.reload() } finally { setSeeding(false) }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        {canManage && categories.items.length === 0 && !categories.loading && (
          <button onClick={seed} disabled={seeding} className="flex items-center gap-1.5 rounded-full bg-indigo-50 dark:bg-indigo-500/10 px-3.5 py-1.5 text-[12.5px] font-semibold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 disabled:opacity-40">
            <Sparkles size={13} /> {seeding ? 'Adding…' : 'Add default set (General/SC/ST/OBC/EWS/RTE…)'}
          </button>
        )}
        {canManage && <HeaderAdd label="New category" onClick={openAdd} />}
      </div>
      <Card className="p-0 divide-y divide-black/[.05] dark:divide-white/[.07]">
        {categories.loading && <div className="p-6 text-center text-[13px] text-black/40 dark:text-white/40">Loading…</div>}
        {!categories.loading && categories.items.length === 0 && <div className="p-6"><Empty text="No admission categories configured yet." /></div>}
        {categories.items.map(c => (
          <div key={c.id} className="flex flex-wrap items-center gap-4 px-6 py-4">
            <div className="min-w-52 flex-1">
              <p className="flex items-center gap-2 text-[14.5px] font-semibold">{c.name} {!c.isActive && <Pill tone="slate">Inactive</Pill>}</p>
              <p className={muted}>{c.code}{c.requiresCertificate ? ' · requires a supporting certificate' : ''}</p>
            </div>
            {canManage && (
              <div className="flex items-center gap-2">
                <button onClick={() => openEdit(c)} className={iconBtn} aria-label="Edit"><Pencil size={14} /></button>
                {c.isActive && <button onClick={() => setModal({ t: 'deactivate', item: c })} className={dangerBtn} aria-label="Deactivate"><Trash2 size={14} /></button>}
              </div>
            )}
          </div>
        ))}
      </Card>

      <Modal open={modal?.t === 'form'} onClose={() => setModal(null)} title={modal?.t === 'form' && modal.editing ? 'Edit admission category' : 'New admission category'}>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name"><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Scheduled Caste (SC)" className={inputCls} autoFocus /></Field>
            <Field label="Code (optional)"><input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="Auto from name if blank" className={inputCls} /></Field>
          </div>
          <label className="flex items-center gap-2 text-[13.5px] font-medium">
            <input type="checkbox" checked={form.requiresCertificate} onChange={e => setForm(f => ({ ...f, requiresCertificate: e.target.checked }))} className="h-4 w-4 rounded border-black/20" />
            Requires a supporting certificate
          </label>
          {modal?.t === 'form' && modal.editing && (
            <label className="flex items-center gap-2 text-[13.5px] font-medium">
              <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} className="h-4 w-4 rounded border-black/20" /> Active
            </label>
          )}
          <FormActions onCancel={() => setModal(null)} onSave={save} label={modal?.t === 'form' && modal.editing ? 'Save changes' : 'Add category'} disabled={!form.name.trim() || categories.busy} />
        </div>
      </Modal>

      <ConfirmModal open={modal?.t === 'deactivate'} onClose={() => setModal(null)} title="Deactivate this category?"
        body="It drops off the admission form's category picker. Existing applications keep it, and it can be reactivated later." action="Deactivate" busy={categories.busy} onConfirm={deactivate} />
    </div>
  )
}

function DocumentTypesTab({ canManage }: { canManage: boolean }) {
  const types = useRequiredDocumentTypes()
  const [modal, setModal] = useState<{ t: 'form'; editing?: RequiredDocumentType } | { t: 'deactivate'; item: RequiredDocumentType } | null>(null)
  const [form, setForm] = useState<TypeForm>(emptyTypeForm)
  const [seeding, setSeeding] = useState(false)

  const openAdd = () => { setForm(emptyTypeForm); setModal({ t: 'form' }) }
  const openEdit = (t: RequiredDocumentType) => {
    setForm({
      name: t.name, code: t.code, alwaysRequired: t.alwaysRequired,
      requiredIfCategoryIn: t.requiredIfCategoryIn.join(', '), requiredIfAdmissionMode: t.requiredIfAdmissionMode.join(', '),
      requiredIfBoardChanged: t.requiredIfBoardChanged, isActive: t.isActive,
    })
    setModal({ t: 'form', editing: t })
  }
  const save = async () => {
    const body = {
      name: form.name.trim(), code: form.code.trim() || form.name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
      alwaysRequired: form.alwaysRequired,
      requiredIfCategoryIn: form.requiredIfCategoryIn.split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
      requiredIfAdmissionMode: form.requiredIfAdmissionMode.split(',').map(s => s.trim()).filter(Boolean),
      requiredIfBoardChanged: form.requiredIfBoardChanged, isActive: form.isActive,
    }
    const editing = modal?.t === 'form' ? modal.editing : undefined
    const out = editing ? await types.update(editing.id, body, 'Document type updated') : await types.create(body, 'Document type added')
    if (out) setModal(null)
  }
  const deactivate = async () => {
    if (modal?.t !== 'deactivate') return
    if (await types.deactivate(modal.item.id, 'Document type deactivated')) setModal(null)
  }
  const seed = async () => {
    setSeeding(true)
    try { await seedDefaultDocumentTypes(); types.reload() } finally { setSeeding(false) }
  }

  const conditionSummary = (t: RequiredDocumentType) => {
    if (t.alwaysRequired) return 'Always required'
    const parts: string[] = []
    if (t.requiredIfCategoryIn.length) parts.push(`category in ${t.requiredIfCategoryIn.join(', ')}`)
    if (t.requiredIfAdmissionMode.length) parts.push(`mode in ${t.requiredIfAdmissionMode.join(', ')}`)
    if (t.requiredIfBoardChanged) parts.push('board changed')
    return parts.length ? `Required if ${parts.join(' · ')}` : 'Never automatically required'
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        {canManage && types.items.length === 0 && !types.loading && (
          <button onClick={seed} disabled={seeding} className="flex items-center gap-1.5 rounded-full bg-indigo-50 dark:bg-indigo-500/10 px-3.5 py-1.5 text-[12.5px] font-semibold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 disabled:opacity-40">
            <Sparkles size={13} /> {seeding ? 'Adding…' : 'Add default document set'}
          </button>
        )}
        {canManage && <HeaderAdd label="New document type" onClick={openAdd} />}
      </div>
      <Card className="p-0 divide-y divide-black/[.05] dark:divide-white/[.07]">
        {types.loading && <div className="p-6 text-center text-[13px] text-black/40 dark:text-white/40">Loading…</div>}
        {!types.loading && types.items.length === 0 && <div className="p-6"><Empty text="No document types configured yet." /></div>}
        {types.items.map(t => (
          <div key={t.id} className="flex flex-wrap items-center gap-4 px-6 py-4">
            <div className="min-w-52 flex-1">
              <p className="flex items-center gap-2 text-[14.5px] font-semibold">{t.name} {!t.isActive && <Pill tone="slate">Inactive</Pill>}</p>
              <p className={muted}>{conditionSummary(t)}</p>
            </div>
            {canManage && (
              <div className="flex items-center gap-2">
                <button onClick={() => openEdit(t)} className={iconBtn} aria-label="Edit"><Pencil size={14} /></button>
                {t.isActive && <button onClick={() => setModal({ t: 'deactivate', item: t })} className={dangerBtn} aria-label="Deactivate"><Trash2 size={14} /></button>}
              </div>
            )}
          </div>
        ))}
      </Card>

      <Modal open={modal?.t === 'form'} onClose={() => setModal(null)} title={modal?.t === 'form' && modal.editing ? 'Edit document type' : 'New document type'}>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name"><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Caste Certificate" className={inputCls} autoFocus /></Field>
            <Field label="Code (optional)"><input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="Auto from name if blank" className={inputCls} /></Field>
          </div>
          <label className="flex items-center gap-2 text-[13.5px] font-medium">
            <input type="checkbox" checked={form.alwaysRequired} onChange={e => setForm(f => ({ ...f, alwaysRequired: e.target.checked }))} className="h-4 w-4 rounded border-black/20" />
            Always required, for every admission
          </label>
          {!form.alwaysRequired && (
            <>
              <Field label="Required if admission category code is one of (comma-separated)">
                <input value={form.requiredIfCategoryIn} onChange={e => setForm(f => ({ ...f, requiredIfCategoryIn: e.target.value }))} placeholder="SC, ST, OBC, EWS" className={inputCls} />
              </Field>
              <Field label="Required if admission mode is one of (comma-separated — Regular, RTE, Management, Staff-Ward)">
                <input value={form.requiredIfAdmissionMode} onChange={e => setForm(f => ({ ...f, requiredIfAdmissionMode: e.target.value }))} placeholder="RTE" className={inputCls} />
              </Field>
              <label className="flex items-center gap-2 text-[13.5px] font-medium">
                <input type="checkbox" checked={form.requiredIfBoardChanged} onChange={e => setForm(f => ({ ...f, requiredIfBoardChanged: e.target.checked }))} className="h-4 w-4 rounded border-black/20" />
                Required when the applicant's previous board differs from this school's
              </label>
            </>
          )}
          {modal?.t === 'form' && modal.editing && (
            <label className="flex items-center gap-2 text-[13.5px] font-medium">
              <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} className="h-4 w-4 rounded border-black/20" /> Active
            </label>
          )}
          <FormActions onCancel={() => setModal(null)} onSave={save} label={modal?.t === 'form' && modal.editing ? 'Save changes' : 'Add document type'} disabled={!form.name.trim() || types.busy} />
        </div>
      </Modal>

      <ConfirmModal open={modal?.t === 'deactivate'} onClose={() => setModal(null)} title="Deactivate this document type?"
        body="It drops off future completeness checklists. Existing submitted documents referencing it are unaffected." action="Deactivate" busy={types.busy} onConfirm={deactivate} />
    </div>
  )
}

/** Admin toggle for `admissionDocumentsBlockApproval` — whether missing required documents hard-block
 * approving an admission, or just leave the checklist open with a visible warning. */
function BlockApprovalToggle() {
  const { settings, save, busy, loading } = useAdmissionSettings()
  if (loading || !settings) return null
  return (
    <Card className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-[14px] font-semibold">Block approval on missing documents</p>
        <p className={muted}>When on, an admission with missing required documents can't be approved until they're collected. When off, approval proceeds with a visible warning.</p>
      </div>
      <button onClick={() => save(!settings.admissionDocumentsBlockApproval)} disabled={busy}
        className={`shrink-0 rounded-full px-4 py-2 text-[12.5px] font-semibold transition-colors ${settings.admissionDocumentsBlockApproval ? 'bg-black text-white dark:bg-white dark:text-black' : 'bg-black/[.06] dark:bg-white/[.08]'}`}>
        {settings.admissionDocumentsBlockApproval ? 'Blocking — on' : 'Blocking — off'}
      </button>
    </Card>
  )
}

export function AdmissionCatalogsMod() {
  const { user } = useStore()
  const canManage = isAdmin(user)
  const [tab, setTab] = useState<'categories' | 'types'>('categories')
  return (
    <div>
      <PageHead title="Admission Catalogs" sub="The school's configurable admission-category (quota/reservation) list and required-document-type catalog, with conditional-requirement rules" />
      {canManage && <BlockApprovalToggle />}
      <div className="mb-4 inline-flex flex-wrap rounded-full border border-black/[.08] dark:border-white/[.10] bg-white dark:bg-[#14141f] p-1">
        {(['categories', 'types'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-all ${tab === t ? 'bg-black text-white shadow' : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'}`}>
            {t === 'categories' ? 'Admission categories' : 'Required document types'}
          </button>
        ))}
      </div>
      {tab === 'categories' ? <CategoriesTab canManage={canManage} /> : <DocumentTypesTab canManage={canManage} />}
    </div>
  )
}

/* ── Completeness checklist + submission (used on the Application detail page) ── */

const emptySubmitForm = { fileId: '', isOriginal: false, room: '', shelf: '', folder: '', receivedDate: new Date().toISOString().slice(0, 10) }

function SubmitDocumentForm({ applicationId, studentId, type, existingDocs, onDone }: {
  applicationId?: string; studentId?: string; type?: { id: string; name: string }; existingDocs: { id: string; name: string }[]; onDone: () => void
}) {
  const [f, setF] = useState(emptySubmitForm)
  const [newFile, setNewFile] = useState<UploadedFile[]>([])
  const { busy, submit } = useSubmittedDocumentActions()
  const fileId = newFile[0]?.id || f.fileId
  const save = async () => {
    const out = await submit({
      applicationId, studentId, requiredDocumentTypeId: type?.id,
      fileId: fileId || undefined, isOriginal: f.isOriginal,
      physicalLocationRoom: f.isOriginal ? f.room.trim() || undefined : undefined,
      physicalLocationShelf: f.isOriginal ? f.shelf.trim() || undefined : undefined,
      physicalLocationFolder: f.isOriginal ? f.folder.trim() || undefined : undefined,
      receivedDate: f.receivedDate || undefined,
      status: 'HELD',
    })
    if (out) onDone()
  }
  return (
    <div className="space-y-4">
      {type && <p className="text-[13.5px] text-black/60 dark:text-white/60">Recording <b>{type.name}</b>.</p>}
      <Field label="Digital scan">
        {existingDocs.length > 0 && !newFile.length && (
          <select value={f.fileId} onChange={e => setF(x => ({ ...x, fileId: e.target.value }))} className={inputCls + ' mb-2'}>
            <option value="">Or attach an already-uploaded file…</option>
            {existingDocs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        <UploadField files={newFile} onChange={setNewFile} accept=".pdf,.png,.jpg,.jpeg" hint="PDF, PNG or JPG — optional if only tracking a physical original" />
      </Field>
      <label className="flex items-center gap-2 text-[13.5px] font-medium">
        <input type="checkbox" checked={f.isOriginal} onChange={e => setF(x => ({ ...x, isOriginal: e.target.checked }))} className="h-4 w-4 rounded border-black/20" />
        This is the physical original (needs custody tracking)
      </label>
      {f.isOriginal && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Room / records area"><input value={f.room} onChange={e => setF(x => ({ ...x, room: e.target.value }))} className={inputCls} /></Field>
          <Field label="Cabinet / shelf"><input value={f.shelf} onChange={e => setF(x => ({ ...x, shelf: e.target.value }))} className={inputCls} /></Field>
          <Field label="Folder / file ref"><input value={f.folder} onChange={e => setF(x => ({ ...x, folder: e.target.value }))} className={inputCls} /></Field>
        </div>
      )}
      <Field label="Received date"><input type="date" value={f.receivedDate} onChange={e => setF(x => ({ ...x, receivedDate: e.target.value }))} className={inputCls} /></Field>
      <FormActions onCancel={onDone} onSave={save} label={busy ? 'Saving…' : 'Record document'} disabled={!!busy || (!fileId && !f.isOriginal)} />
    </div>
  )
}

/** The completeness checklist for one application — server-computed (`GET
 * /admission-documents/checklist/:applicationId`) required-vs-submitted per RequiredDocumentType's
 * condition, cross-referenced with the full SubmittedDocument rows (for physical-location detail and
 * per-row actions). Embedded on the Application detail page (a dedicated route, per D9 — this is exactly
 * the dense multi-state screen the roadmap flags). */
export function DocumentChecklistPanel({ app }: { app: ApplicationRec }) {
  const checklistQ = useChecklist(app.id)
  const submittedQ = useSubmittedDocuments({ applicationId: app.id })
  const { markReturned, remove, busy } = useSubmittedDocumentActions()
  const [addFor, setAddFor] = useState<{ id: string; name: string } | 'other' | null>(null)

  const checklist = checklistQ.data
  const submittedByType = new Map<string, SubmittedDocument[]>()
  for (const d of submittedQ.items ?? []) {
    if (!d.requiredDocumentTypeId) continue
    submittedByType.set(d.requiredDocumentTypeId, [...(submittedByType.get(d.requiredDocumentTypeId) ?? []), d])
  }
  const existingUntaggedDocs = app.documents.map((id, i) => ({ id, name: `Document ${i + 1}` }))

  const removeDoc = async (d: SubmittedDocument) => {
    if (!window.confirm('Remove this submitted document record?')) return
    if (await remove(d.id)) { submittedQ.reload(); checklistQ.reload() }
  }
  const doReturn = async (id: string, returnedTo: string) => { if (await markReturned(id, returnedTo)) { submittedQ.reload(); checklistQ.reload() } }
  const closeAdd = () => { setAddFor(null); submittedQ.reload(); checklistQ.reload() }

  if (checklistQ.loading || submittedQ.loading || !checklist) return <p className="py-6 text-center text-[13px] text-black/40 dark:text-white/40">Loading checklist…</p>

  return (
    <div className="space-y-3">
      {!checklist.complete && (
        <div className={`flex items-center gap-2 rounded-2xl px-4 py-3 text-[13px] font-semibold ${checklist.admissionDocumentsBlockApproval ? 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300' : 'bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300'}`}>
          <AlertTriangle size={15} /> {checklist.missingRequired.length} required document{checklist.missingRequired.length > 1 ? 's' : ''} missing{checklist.admissionDocumentsBlockApproval ? ' — this blocks approval' : ' — approval proceeds with this left open'}
        </div>
      )}
      {checklist.items.map(item => {
        const rows = submittedByType.get(item.requiredDocumentTypeId) ?? []
        return (
          <Card key={item.requiredDocumentTypeId} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {item.submitted ? <Check size={16} className="text-emerald-600" /> : item.required ? <AlertTriangle size={16} className="text-amber-500" /> : <FileText size={16} className="text-black/30 dark:text-white/30" />}
                <span className="text-[14px] font-semibold">{item.name}</span>
                <Pill tone={item.required ? (item.submitted ? 'green' : 'amber') : 'slate'}>{item.required ? (item.submitted ? 'Collected' : 'Missing — required') : 'Optional'}</Pill>
              </div>
              <button onClick={() => setAddFor({ id: item.requiredDocumentTypeId, name: item.name })} className="flex items-center gap-1 rounded-full bg-black/[.05] dark:bg-white/[.07] px-3 py-1.5 text-[12px] font-semibold hover:bg-black/10 dark:hover:bg-white/15"><Plus size={12} /> Add</button>
            </div>
            {rows.length > 0 && (
              <div className="mt-3 space-y-2">
                {rows.map(d => <SubmittedDocRow key={d.id} d={d} onRemove={() => removeDoc(d)} onReturn={doReturn} busy={busy === d.id} />)}
              </div>
            )}
          </Card>
        )
      })}

      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[14px] font-semibold">Other documents on file</p>
          <button onClick={() => setAddFor('other')} className="flex items-center gap-1 rounded-full bg-black/[.05] dark:bg-white/[.07] px-3 py-1.5 text-[12px] font-semibold hover:bg-black/10 dark:hover:bg-white/15"><Plus size={12} /> Add</button>
        </div>
        {checklist.extraDocuments.length === 0 ? <p className={`mt-2 ${muted}`}>None recorded outside the catalog above.</p> : (
          <div className="mt-3 space-y-2">{checklist.extraDocuments.map(d => <SubmittedDocRow key={d.id} d={d} onRemove={() => removeDoc(d)} onReturn={doReturn} busy={busy === d.id} />)}</div>
        )}
      </Card>

      <Modal open={!!addFor} onClose={() => setAddFor(null)} title={addFor && addFor !== 'other' ? `Add · ${addFor.name}` : 'Add document'}>
        {addFor && (
          <SubmitDocumentForm applicationId={app.id} studentId={app.studentId ?? undefined} type={addFor !== 'other' ? addFor : undefined}
            existingDocs={existingUntaggedDocs} onDone={closeAdd} />
        )}
      </Modal>
    </div>
  )
}

function SubmittedDocRow({ d, onRemove, onReturn, busy }: { d: SubmittedDocument; onRemove: () => void; onReturn: (id: string, returnedTo: string) => void; busy: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-black/[.03] dark:bg-white/[.05] px-3 py-2 text-[12.5px]">
      <Pill tone={documentStatusTone(d.status)}>{d.status}</Pill>
      {d.isOriginal && <Pill tone="indigo">Original</Pill>}
      {d.fileId && <span className="flex items-center gap-1 text-black/60 dark:text-white/60"><FileText size={12} /> Scan on file</span>}
      {d.isOriginal && (d.physicalLocationRoom || d.physicalLocationShelf || d.physicalLocationFolder) && (
        <span className="flex items-center gap-1 text-black/50 dark:text-white/50">
          <MapPin size={12} /> {[d.physicalLocationRoom, d.physicalLocationShelf, d.physicalLocationFolder].filter(Boolean).join(' / ')}
        </span>
      )}
      {d.receivedDate && <span className="text-black/40 dark:text-white/40">received {fmtDate(d.receivedDate)}</span>}
      <div className="ml-auto flex items-center gap-2">
        {d.isOriginal && d.status === 'HELD' && (
          <button disabled={busy} onClick={() => { const to = window.prompt('Returned to (name):'); if (to) onReturn(d.id, to) }}
            className="rounded-full bg-emerald-50 dark:bg-emerald-500/10 px-2.5 py-1 text-[11.5px] font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20">Mark returned</button>
        )}
        <button onClick={onRemove} className="rounded-full p-1 text-black/35 hover:bg-rose-50 hover:text-rose-500 dark:text-white/35" aria-label="Remove"><Trash2 size={12} /></button>
      </div>
    </div>
  )
}

/* ── Records report — which original documents are held, where, for which students ── */

export function DocumentRecordsReportMod() {
  const [room, setRoom] = useState('')
  const [q, setQ] = useState('')
  const report = useRecordsReport({ room: room || undefined })

  const rows = (report.items ?? []).filter(d => {
    if (!q.trim()) return true
    const query = q.trim().toLowerCase()
    return (d.studentName ?? d.applicantName ?? '').toLowerCase().includes(query) || (d.documentTypeName ?? '').toLowerCase().includes(query)
  })
  const rooms = Array.from(new Set((report.items ?? []).map(d => d.physicalLocationRoom).filter((r): r is string => !!r))).sort()

  return (
    <div>
      <PageHead title="Held Original Documents" sub="Which original certificates are currently held, and exactly where — for real records-room audits, filterable by room and student" />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search student or document type…" className={inputCls + ' max-w-xs'} />
        {rooms.length > 0 && (
          <select value={room} onChange={e => setRoom(e.target.value)} className={inputCls + ' w-auto'}>
            <option value="">All rooms</option>
            {rooms.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        )}
        <span className={muted}>{rows.length} held original{rows.length === 1 ? '' : 's'}</span>
      </div>
      <Card className="p-0 divide-y divide-black/[.05] dark:divide-white/[.07]">
        {report.loading && <div className="p-6 text-center text-[13px] text-black/40 dark:text-white/40">Loading…</div>}
        {!report.loading && rows.length === 0 && <div className="p-6"><Empty text="No original documents currently held." /></div>}
        {rows.map(d => (
          <div key={d.id} className="flex flex-wrap items-center gap-4 px-6 py-4 text-[13px]">
            <div className="min-w-40 flex-1">
              <p className="font-semibold">{d.studentName ?? d.applicantName ?? 'Student'}</p>
              <p className={muted}>{d.documentTypeName ?? 'Other document'}</p>
            </div>
            <span className="flex items-center gap-1.5 text-black/60 dark:text-white/60"><MapPin size={13} /> {[d.physicalLocationRoom, d.physicalLocationShelf, d.physicalLocationFolder].filter(Boolean).join(' / ') || '—'}</span>
            {d.receivedDate && <span className="text-black/40 dark:text-white/40">since {fmtDate(d.receivedDate)}</span>}
          </div>
        ))}
      </Card>
    </div>
  )
}
