import { useEffect, useState } from 'react'
import { fetchAuthed } from '../api'
import { useFetch } from './useTimetable'
import { qs, useList } from './useAcademics'
import type {
  ApplicationKind, ApplicationRec, ApplicationStatus, BoardRegistration, BoardRegistrationStatus, Certificate, CertificateKind,
  ParentVerification, VerificationStatus,
} from '../data'

// Data hooks and pure helpers for Phase 4: applications & certificates, board registration, parent verification, profile.
// Components live in src/portal/modules/{office,profile}.tsx and src/portal/ui.tsx (VerifyButton).
// See .agents/edunova/phase-4-admissions-identity.md

/* ── applications & certificates ───────────────────────── */

export const APPLICATION_KINDS: ApplicationKind[] = ['Admission', 'TC', 'Bonafide', 'Character']
export const CERTIFICATE_KINDS: CertificateKind[] = ['TC', 'Bonafide', 'Character']
export const APPLICATION_STATUSES: ApplicationStatus[] = ['Pending', 'Verified', 'Approved', 'Declined']
export const KIND_LABEL: Record<ApplicationKind, string> = { Admission: 'Admission', TC: 'Transfer certificate', Bonafide: 'Bonafide certificate', Character: 'Character certificate' }
export const kindTone = (k: ApplicationKind): 'indigo' | 'sky' | 'green' | 'amber' => (k === 'Admission' ? 'indigo' : k === 'TC' ? 'sky' : k === 'Bonafide' ? 'green' : 'amber')
export const isCertificateKind = (k: ApplicationKind): k is CertificateKind => k !== 'Admission'

/** `/applications?kind&status` — staff/admin see all, students/parents their own (server-scoped). */
export function useApplications(params: { kind?: ApplicationKind | ''; status?: ApplicationStatus | '' } = {}, enabled = true) {
  return useList<ApplicationRec>(enabled ? `/applications${qs(params)}` : null)
}

/** `/certificates?studentId` — omit the id for every certificate the caller may see. */
export function useCertificates(studentId?: string, enabled = true) {
  return useList<Certificate>(enabled ? `/certificates${qs({ studentId })}` : null)
}

export const certificateFileName = (c: Certificate, studentName?: string) =>
  `${c.kind}-${(studentName ?? c.studentId).replace(/[^\w]+/g, '_')}-${c.serialNo.replace(/[^\w]+/g, '_')}.pdf`

/* ── board registration ────────────────────────────────── */

export const BOARD_REG_STATUSES: BoardRegistrationStatus[] = ['Draft', 'Pending', 'Validated', 'SentToBoard']
export const boardRegLabel = (s: BoardRegistrationStatus) => (s === 'SentToBoard' ? 'Sent to board' : s)
export const boardRegTone = (s: BoardRegistrationStatus | undefined): 'amber' | 'green' | 'sky' | 'slate' =>
  s === 'SentToBoard' ? 'sky' : s === 'Validated' ? 'green' : s === 'Pending' ? 'amber' : 'slate'

/** `/board-registrations` — scoped server-side: student self, parent wards, teacher classes, staff/admin all. */
export function useBoardRegistrations(enabled = true) {
  return useList<BoardRegistration>(enabled ? '/board-registrations' : null)
}

/* ── parent verification ───────────────────────────────── */

export const VERIFICATION_STATUSES: VerificationStatus[] = ['Pending', 'Verified', 'Rejected']
export const verificationTone = (s: VerificationStatus | undefined): 'amber' | 'green' | 'rose' | 'slate' =>
  s === 'Verified' ? 'green' : s === 'Pending' ? 'amber' : s === 'Rejected' ? 'rose' : 'slate'

/**
 * The signed-in parent's own verification record. `record` is `null` once the server has answered that there
 * is none (or the endpoint failed — the upload card is the safe fallback), `undefined` while loading.
 */
export function useMyVerification(enabled = true) {
  const r = useFetch<{ item?: ParentVerification | null }>(enabled ? '/verification/me' : null)
  const record: ParentVerification | null | undefined = !enabled ? null : r.loading ? undefined : r.error ? null : (r.data?.item ?? null)
  return { record, loading: r.loading, error: r.error, reload: r.reload }
}

/** Staff/admin queue: `/verification?status`. */
export function useVerifications(status?: VerificationStatus | '', enabled = true) {
  return useList<ParentVerification>(enabled ? `/verification${qs({ status })}` : null)
}

/* ── files ─────────────────────────────────────────────── */

/**
 * Object URL for `GET /files/:id` fetched with the bearer token (a plain `<img src>` can't carry it).
 * Revoked when the id changes or the component unmounts. `undefined` while loading / on failure / without an id.
 */
export function useFileUrl(fileId?: string | null) {
  const [url, setUrl] = useState<{ id: string; url: string }>()
  useEffect(() => {
    if (!fileId) return
    let cancelled = false
    let objectUrl: string | undefined
    fetchAuthed(`/files/${encodeURIComponent(fileId)}`)
      .then(res => res.blob())
      .then(blob => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl({ id: fileId, url: objectUrl })
      })
      .catch(() => { /* fall back to the initials avatar / no preview */ })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [fileId])
  return fileId && url?.id === fileId ? url.url : undefined
}

/* ── misc ──────────────────────────────────────────────── */

export const MIN_PASSWORD = 8
/** Client-side echo of the server's rule (min 8) plus a confirmation check; returns the message to show, or ''. */
export function passwordProblem(newPassword: string, confirm: string) {
  if (newPassword.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`
  if (newPassword !== confirm) return 'The two passwords don’t match.'
  return ''
}

export const fmtDateTime = (d?: string | null) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
