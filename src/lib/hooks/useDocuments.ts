import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api, errorMessage } from '../api'
import { qs, useList, useOne } from './useAcademics'
import type {
  AdmissionCategory, AdmissionChecklist, AdmissionSettings, DocumentStatus, RequiredDocumentType, SiblingSuggestion,
  SubmittedDocument, TcReturnChecklist, TransportTodo,
} from '../data'

// Data hooks for Phase T2 Part A/B — strong admissions (sibling lookup, transport handoff to-dos, document
// catalog + physical custody, completeness checklist, TC-return workflow, records report). Matches the real
// server contract under /api/admission-documents (server/src/modules/admissionDocuments) and the Part A
// additions to /api/applications (server/src/modules/applications). See
// .agents/edunova/phase-t2-strong-admissions.md. Components live in src/portal/modules/documents.tsx and the
// extended AdmissionForm in src/portal/modules/office.tsx.

export const DOCUMENT_STATUSES: DocumentStatus[] = ['HELD', 'RETURNED', 'LOST', 'NOT_APPLICABLE']
export const documentStatusTone = (s: DocumentStatus): 'green' | 'amber' | 'rose' | 'slate' =>
  s === 'RETURNED' ? 'green' : s === 'HELD' ? 'amber' : s === 'LOST' ? 'rose' : 'slate'

/* ── generic small-catalog CRUD (same shape as useSchoolConfig's hooks) — no DELETE on these two catalogs,
   only PATCH { isActive: false } to retire an entry (existing submitted documents may still reference it) ── */

function useCatalog<T extends { id: string }>(path: string, enabled = true) {
  const [state, setState] = useState<{ key: string; items: T[] }>({ key: '', items: [] })
  const [busy, setBusy] = useState(false)
  const [nonce, setNonce] = useState(0)
  const key = enabled ? `${path}#${nonce}` : ''

  useEffect(() => {
    if (!key) return undefined
    let cancelled = false
    api.get<{ items?: T[] } | T[]>(path)
      .then(r => { if (!cancelled) setState({ key, items: Array.isArray(r) ? r : r.items ?? [] }) })
      .catch((e: unknown) => { if (!cancelled) toast.error(errorMessage(e)) })
    return () => { cancelled = true }
  }, [key, path])

  const loading = enabled && state.key !== key
  const items = state.key === key ? state.items : []
  const reload = () => setNonce(n => n + 1)

  const run = async <R,>(fn: () => Promise<R>, okMsg?: string): Promise<R | null> => {
    setBusy(true)
    try {
      const out = await fn()
      reload()
      if (okMsg) toast.success(okMsg)
      return out
    } catch (e) {
      toast.error(errorMessage(e))
      return null
    } finally {
      setBusy(false)
    }
  }

  const create = (body: Partial<T>, okMsg?: string) => run(() => api.post<{ item: T }>(path, body).then(r => r.item), okMsg)
  const update = (id: string, body: Partial<T>, okMsg?: string) => run(() => api.patch<{ item: T }>(`${path}/${id}`, body).then(r => r.item), okMsg)
  const deactivate = (id: string, okMsg?: string) => update(id, { isActive: false } as unknown as Partial<T>, okMsg)

  return { items, loading, busy, create, update, deactivate, reload }
}

/** School-editable quota/reservation catalog (General/SC/ST/OBC/EWS/RTE/…) — drives which document types apply. */
export function useAdmissionCategories(enabled = true) {
  return useCatalog<AdmissionCategory>('/admission-documents/categories', enabled)
}
export const seedDefaultAdmissionCategories = () => api.post<{ added: number }>('/admission-documents/categories/seed-defaults')

/** School-editable document-type catalog with conditional-requirement flags. */
export function useRequiredDocumentTypes(enabled = true) {
  return useCatalog<RequiredDocumentType>('/admission-documents/types', enabled)
}
export const seedDefaultDocumentTypes = () => api.post<{ added: number }>('/admission-documents/types/seed-defaults')

/** School-level `admissionDocumentsBlockApproval` toggle. */
export function useAdmissionSettings(enabled = true) {
  const { data, loading, error, reload } = useOne<AdmissionSettings>(enabled ? '/admission-documents/settings' : null)
  const [busy, setBusy] = useState(false)
  const save = async (admissionDocumentsBlockApproval: boolean) => {
    setBusy(true)
    try { await api.patch('/admission-documents/settings', { admissionDocumentsBlockApproval }); reload(); toast.success('Setting saved'); return true }
    catch (e) { toast.error(errorMessage(e)); return false } finally { setBusy(false) }
  }
  return { settings: data, loading, error, busy, save }
}

/* ── submitted documents (digital scan + physical custody) ── */

export function useSubmittedDocuments(params: { applicationId?: string; studentId?: string; status?: DocumentStatus | '' }, enabled = true) {
  const q = qs({ applicationId: params.applicationId, studentId: params.studentId, status: params.status })
  return useList<SubmittedDocument>(enabled ? `/admission-documents${q}` : null)
}

export function useSubmittedDocumentActions() {
  const [busy, setBusy] = useState<string | null>(null)
  const run = async <R,>(key: string, fn: () => Promise<R>, okMsg?: string): Promise<R | null> => {
    setBusy(key)
    try {
      const out = await fn()
      if (okMsg) toast.success(okMsg)
      return out
    } catch (e) { toast.error(errorMessage(e)); return null } finally { setBusy(null) }
  }
  const submit = (body: Partial<SubmittedDocument>, okMsg = 'Document recorded') =>
    run('create', () => api.post<{ item: SubmittedDocument }>('/admission-documents', body).then(r => r.item), okMsg)
  const update = (id: string, body: Partial<SubmittedDocument>, okMsg?: string) =>
    run(id, () => api.patch<{ item: SubmittedDocument }>(`/admission-documents/${id}`, body).then(r => r.item), okMsg)
  const markReturned = (id: string, returnedTo: string, returnReason?: string) =>
    run(id, () => api.post<{ item: SubmittedDocument }>(`/admission-documents/${id}/return`, { returnedTo, returnReason }).then(r => r.item), 'Marked returned')
  const markLost = (id: string, reason?: string) =>
    run(id, () => api.post<{ item: SubmittedDocument }>(`/admission-documents/${id}/lost`, { reason }).then(r => r.item), 'Recorded as lost')
  const remove = (id: string, okMsg = 'Document record removed') => run(id, () => api.del<{ ok: true }>(`/admission-documents/${id}`), okMsg)
  return { busy, submit, update, markReturned, markLost, remove }
}

/* ── completeness checklist (server-computed — GET /admission-documents/checklist/:applicationId) ── */

export function useChecklist(applicationId: string | undefined) {
  return useOne<AdmissionChecklist>(applicationId ? `/admission-documents/checklist/${applicationId}` : null)
}

/* ── sibling lookup — GET /applications/sibling-suggestions?phone=&email= (Guardian-derived, not a stored
   field, per D4/T2 Part A: "verify siblings are already derivable via shared Guardian") ── */

export function useSiblingSuggestions(phone: string, email: string) {
  const q = qs({ phone: phone.trim() || undefined, email: email.trim() || undefined })
  const enabled = !!(phone.trim() || email.trim())
  return useList<SiblingSuggestion>(enabled ? `/applications/sibling-suggestions${q}` : null)
}

/* ── transport-requirement staff to-do surface (Part A hand-off) ── */

export function useTransportTodos(enabled = true) {
  const list = useList<TransportTodo>(enabled ? '/applications/transport-todos' : null)
  const markHandled = async (applicationId: string) => {
    try { await api.post(`/applications/${applicationId}/transport-handled`); await list.reload(); toast.success('Marked handled') }
    catch (e) { toast.error(errorMessage(e)) }
  }
  return { ...list, markHandled }
}

/* ── TC-issuance document-return workflow (GET .../tc-return-checklist/:studentId; resolution happens by
   resolving each SubmittedDocument via markReturned/markLost above, then calling POST
   /applications/:id/approve with no held originals left — or, for a TC without an Application, POST
   /certificates directly, which is NOT gated by this workflow server-side, matching the existing "a TC
   issued here does not close the student's enrolment" direct-reissue path) ── */

export function useTcReturnChecklist(studentId: string | undefined) {
  return useOne<TcReturnChecklist>(studentId ? `/admission-documents/tc-return-checklist/${studentId}` : null)
}

/* ── records report: which original documents are held, where, for which students ── */

export function useRecordsReport(params: { room?: string; shelf?: string; studentId?: string } = {}, enabled = true) {
  const q = qs({ room: params.room, shelf: params.shelf, studentId: params.studentId })
  return useList<SubmittedDocument>(enabled ? `/admission-documents/records-report${q}` : null)
}
