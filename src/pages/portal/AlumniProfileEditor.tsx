import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { api, errorMessage } from '@/lib/api'
import type { AlumniProfile } from '@/lib/data'
import { useAlumniProfiles } from '@/lib/hooks/useAlumni'
import { Card, Empty, Field, PageHead, inputCls } from '@/portal/ui'
import { PortalPageShell } from './PortalPageShell'

// Kept local rather than imported from alumni.tsx — exporting a plain object alongside that file's
// components trips the react-refresh/only-export-components lint rule the rest of this codebase respects.
const emptyProfileForm = { name: '', email: '', phone: '', graduationYear: String(new Date().getFullYear()), lastClassLabel: '', currentOccupation: '', currentOrganization: '', currentCity: '', linkedInUrl: '', notes: '' }

// Was the "Add alumni profile" / edit-profile modals inside `DirectoryTab` (alumni.tsx). Converted to two
// routes per .agents/edunova/ui-architecture-fix.md Phase D #6: `/portal/alumni/new` and
// `/portal/alumni/:id/edit`, both served by this one component. Note the edit form only exposes a SUBSET of
// fields (email/phone/occupation/organization/city/LinkedIn/notes) — name, graduation year and last class
// were never editable in the original modal either (the PATCH payload never included them), so that's
// preserved exactly, not an oversight.

export default function AlumniProfileEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isEdit = !!id
  const profiles = useAlumniProfiles({}, isEdit)
  const profile = isEdit ? (profiles.items ?? []).find(a => a.id === id) ?? null : null

  const [busy, setBusy] = useState(false)

  // create-mode form
  const [form, setForm] = useState(emptyProfileForm)
  const addProfile = async () => {
    if (!form.name.trim() || !form.graduationYear || !form.lastClassLabel.trim()) return
    setBusy(true)
    try {
      await api.post('/alumni/profiles', {
        name: form.name.trim(), email: form.email.trim() || undefined, phone: form.phone.trim() || undefined,
        graduationYear: Number(form.graduationYear), lastClassLabel: form.lastClassLabel.trim(),
        currentOccupation: form.currentOccupation.trim() || undefined, currentOrganization: form.currentOrganization.trim() || undefined,
        currentCity: form.currentCity.trim() || undefined, linkedInUrl: form.linkedInUrl.trim() || undefined, notes: form.notes.trim() || undefined,
      })
      toast.success('Alumni profile added')
      navigate(-1)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  // edit-mode form — a local editable copy of the fetched profile, synced once it resolves
  const [editForm, setEditForm] = useState<AlumniProfile | null>(null)
  const [syncedFor, setSyncedFor] = useState<string | null>(null)
  if (profile && syncedFor !== profile.id) {
    setSyncedFor(profile.id)
    setEditForm(profile)
  }
  const saveEdit = async () => {
    if (!editForm) return
    setBusy(true)
    try {
      await api.patch(`/alumni/profiles/${editForm.id}`, {
        email: editForm.email || undefined, phone: editForm.phone || undefined,
        currentOccupation: editForm.currentOccupation || undefined, currentOrganization: editForm.currentOrganization || undefined,
        currentCity: editForm.currentCity || undefined, linkedInUrl: editForm.linkedInUrl || undefined, notes: editForm.notes || undefined,
      })
      toast.success('Profile updated')
      navigate(-1)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  if (isEdit && !profiles.loading && !profile) {
    return (
      <PortalPageShell backLabel="Back to alumni">
        <Empty text="Alumni profile not found." />
      </PortalPageShell>
    )
  }

  return (
    <PortalPageShell backLabel="Back to alumni">
      {isEdit && profiles.loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading…</p>}
      {isEdit && editForm && (
        <div>
          <PageHead title={editForm.name} sub={`Class of ${editForm.graduationYear} · ${editForm.lastClassLabel}`} />
          <Card>
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Email"><input type="email" value={editForm.email ?? ''} onChange={e => setEditForm({ ...editForm, email: e.target.value })} className={inputCls} /></Field>
                <Field label="Phone"><input value={editForm.phone ?? ''} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} className={inputCls} /></Field>
                <Field label="Current occupation"><input value={editForm.currentOccupation ?? ''} onChange={e => setEditForm({ ...editForm, currentOccupation: e.target.value })} className={inputCls} /></Field>
                <Field label="Current organization"><input value={editForm.currentOrganization ?? ''} onChange={e => setEditForm({ ...editForm, currentOrganization: e.target.value })} className={inputCls} /></Field>
                <Field label="Current city"><input value={editForm.currentCity ?? ''} onChange={e => setEditForm({ ...editForm, currentCity: e.target.value })} className={inputCls} /></Field>
                <Field label="LinkedIn URL"><input value={editForm.linkedInUrl ?? ''} onChange={e => setEditForm({ ...editForm, linkedInUrl: e.target.value })} className={inputCls} /></Field>
              </div>
              <Field label="Notes"><textarea value={editForm.notes ?? ''} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} rows={2} className={inputCls} /></Field>
              <div className="flex gap-3 pt-2">
                <button onClick={saveEdit} disabled={busy} className="btn-ink flex-1 py-3 text-[14px] font-semibold disabled:opacity-40">{busy ? 'Saving…' : 'Save changes'}</button>
                <button onClick={() => navigate(-1)} disabled={busy} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-40">Cancel</button>
              </div>
            </div>
          </Card>
        </div>
      )}
      {!isEdit && (
        <div>
          <PageHead title="Add alumni profile" sub="Standalone alumni record — not linked to a student account" />
          <Card>
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={inputCls} autoFocus /></Field>
                <Field label="Graduation year"><input type="number" value={form.graduationYear} onChange={e => setForm({ ...form, graduationYear: e.target.value })} className={inputCls} /></Field>
                <Field label="Last class"><input value={form.lastClassLabel} onChange={e => setForm({ ...form, lastClassLabel: e.target.value })} placeholder="e.g. XII-A CBSE" className={inputCls} /></Field>
                <Field label="Email"><input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className={inputCls} /></Field>
                <Field label="Phone"><input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className={inputCls} /></Field>
                <Field label="Current occupation"><input value={form.currentOccupation} onChange={e => setForm({ ...form, currentOccupation: e.target.value })} className={inputCls} /></Field>
                <Field label="Current organization"><input value={form.currentOrganization} onChange={e => setForm({ ...form, currentOrganization: e.target.value })} className={inputCls} /></Field>
                <Field label="Current city"><input value={form.currentCity} onChange={e => setForm({ ...form, currentCity: e.target.value })} className={inputCls} /></Field>
                <Field label="LinkedIn URL"><input value={form.linkedInUrl} onChange={e => setForm({ ...form, linkedInUrl: e.target.value })} className={inputCls} /></Field>
              </div>
              <Field label="Notes"><textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className={inputCls} /></Field>
              <div className="flex gap-3 pt-2">
                <button onClick={addProfile} disabled={busy || !form.name.trim() || !form.graduationYear || !form.lastClassLabel.trim()} className="btn-ink flex-1 py-3 text-[14px] font-semibold disabled:opacity-40">{busy ? 'Adding…' : 'Add profile'}</button>
                <button onClick={() => navigate(-1)} disabled={busy} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-40">Cancel</button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </PortalPageShell>
  )
}
