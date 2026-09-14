import { useState } from 'react'
import { useParams } from 'react-router'
import { Barcode, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { api, errorMessage } from '@/lib/api'
import { isStaffOrAdmin } from '@/lib/access'
import type { BookCondition, BookCopyRec, CopyStatus } from '@/lib/data'
import { BOOK_CONDITIONS, COPY_STATUSES, availabilityLabel, copyStatusTone, useBook, useCopies } from '@/lib/hooks/useLibrary'
import { Card, Empty, Field, Modal, PageHead, Pill, inputCls } from '@/portal/ui'
import { PortalPageShell } from './PortalPageShell'

// Was `BookDetailModal` in portal/modules/library.tsx — an outer modal that itself spawned two nested modals
// (add/edit-copy, delete-copy confirm). Converted to a real routed page per .agents/edunova/ui-architecture-fix.md
// Phase C #1: the add/edit-copy and delete-confirm dialogs stay as single-level (non-nested) modals ON this page.
// Data/mutation logic is carried over verbatim from the original modal.

const muted = 'text-[12.5px] text-black/50 dark:text-white/50'
const sectionLabel = 'text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40'
const rowCls = 'flex flex-wrap items-center gap-3 border-b border-black/[.05] dark:border-white/[.07] px-5 py-3.5 last:border-0'
const iconBtn = 'rounded-full bg-black/[.05] dark:bg-white/[.07] p-2 hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-black/[.05]'
const dangerBtn = 'rounded-full bg-rose-50 dark:bg-rose-500/10 p-2 text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-500/20 disabled:opacity-40'

function FormActions({ onCancel, onSave, label, disabled }: { onCancel: () => void; onSave: () => void; label: string; disabled?: boolean }) {
  return (
    <div className="flex gap-3 pt-2">
      <button onClick={onSave} disabled={disabled} className="btn-ink flex-1 py-3 text-[14px] font-semibold disabled:opacity-40">{label}</button>
      <button onClick={onCancel} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Cancel</button>
    </div>
  )
}

interface CopyForm { barcode: string; condition: BookCondition; status: CopyStatus }
const emptyCopyForm = (): CopyForm => ({ barcode: '', condition: 'New', status: 'Available' })

export default function BookDetail() {
  const { id } = useParams<{ id: string }>()
  const { user } = useStore()
  const canManage = isStaffOrAdmin(user)
  const { data: book, loading, error, reload } = useBook(id, !!id)
  const copies = useCopies(id, !!id && canManage)

  const [copyOpen, setCopyOpen] = useState(false)
  const [editCopy, setEditCopy] = useState<BookCopyRec | null>(null)
  const [copyForm, setCopyForm] = useState<CopyForm>(emptyCopyForm())
  const [busy, setBusy] = useState(false)
  const [delCopy, setDelCopy] = useState<BookCopyRec | null>(null)

  const openAddCopy = () => { setEditCopy(null); setCopyForm(emptyCopyForm()); setCopyOpen(true) }
  const openEditCopy = (c: BookCopyRec) => { setEditCopy(c); setCopyForm({ barcode: c.barcode, condition: c.condition ?? 'Good', status: c.status }); setCopyOpen(true) }
  const saveCopy = async () => {
    if (!book) return
    setBusy(true)
    try {
      // A new copy always starts Available server-side — POST /library/copies doesn't take `status`. Editing
      // an existing copy does, but the server refuses a manual transition into/out of 'Loaned' (that's only
      // ever set by the issue/return flow), so the status field is hidden once a copy is on loan.
      if (editCopy) await api.patch(`/library/copies/${editCopy.id}`, { barcode: copyForm.barcode.trim(), condition: copyForm.condition, status: copyForm.status })
      else await api.post('/library/copies', { barcode: copyForm.barcode.trim(), condition: copyForm.condition, bookId: book.id })
      setCopyOpen(false); copies.reload(); reload(); toast.success(editCopy ? 'Copy updated' : 'Copy added')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const removeCopy = async () => {
    if (!delCopy) return
    setBusy(true)
    try { await api.del(`/library/copies/${delCopy.id}`); setDelCopy(null); copies.reload(); reload(); toast.success('Copy removed') }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <PortalPageShell backLabel="Back to library">
      {loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading book…</p>}
      {!loading && (error || !book) && <Empty text={error || 'Book not found.'} />}
      {!loading && book && (
        <div>
          <PageHead title={book.title} sub={book.author} />
          <div className="space-y-5">
            <Card>
              <div className="grid gap-3 text-[13.5px] sm:grid-cols-2">
                <div><p className={muted}>Author</p><p className="font-medium">{book.author}</p></div>
                {book.category && <div><p className={muted}>Category</p><p className="font-medium">{book.category}</p></div>}
                {book.publisher && <div><p className={muted}>Publisher</p><p className="font-medium">{book.publisher}</p></div>}
                {book.isbn && <div><p className={muted}>ISBN</p><p className="font-medium">{book.isbn}</p></div>}
              </div>
            </Card>

            {!canManage && (
              <div className="rounded-2xl bg-black/[.04] dark:bg-white/[.06] px-4 py-3 text-[14px] font-medium">
                {availabilityLabel(book)}
              </div>
            )}

            {canManage && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className={sectionLabel}>Copies</p>
                  <button onClick={openAddCopy} className="flex items-center gap-1.5 rounded-full bg-black/[.05] dark:bg-white/[.07] px-3 py-1.5 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">
                    <Plus size={13} /> Add copy
                  </button>
                </div>
                <Card className="p-0">
                  {copies.loading && <div className="p-5 text-center text-[13px] text-black/40 dark:text-white/40">Loading copies…</div>}
                  {copies.error && <div className="p-5"><Empty text={copies.error} /></div>}
                  {!copies.loading && !copies.error && (copies.items ?? []).length === 0 && <div className="p-5"><Empty text="No copies catalogued yet." /></div>}
                  {(copies.items ?? []).map(c => (
                    <div key={c.id} className={rowCls}>
                      <Barcode size={15} className="shrink-0 text-black/40 dark:text-white/40" />
                      <div className="min-w-32 flex-1">
                        <p className="font-mono text-[13.5px] font-semibold">{c.barcode}</p>
                        <p className={muted}>{c.condition ?? 'Condition not set'}</p>
                      </div>
                      <Pill tone={copyStatusTone(c.status)}>{c.status}</Pill>
                      <button onClick={() => openEditCopy(c)} className={iconBtn} aria-label="Edit copy"><Pencil size={14} /></button>
                      <button onClick={() => setDelCopy(c)} className={dangerBtn} aria-label="Delete copy" disabled={c.status === 'Loaned'}><Trash2 size={14} /></button>
                    </div>
                  ))}
                </Card>
              </div>
            )}
          </div>
        </div>
      )}

      <Modal open={copyOpen} onClose={() => setCopyOpen(false)} title={editCopy ? `Edit copy ${editCopy.barcode}` : 'New copy'}>
        <div className="space-y-4">
          <Field label="Barcode"><input value={copyForm.barcode} onChange={e => setCopyForm({ ...copyForm, barcode: e.target.value })} placeholder="e.g. LIB-000123" className={inputCls} autoFocus /></Field>
          <Field label="Condition">
            <select value={copyForm.condition} onChange={e => setCopyForm({ ...copyForm, condition: e.target.value as BookCondition })} className={inputCls}>
              {BOOK_CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          {editCopy && (
            copyForm.status === 'Loaned' ? (
              <p className={muted}>This copy is currently on loan — its status changes automatically when it's returned.</p>
            ) : (
              <Field label="Status">
                <select value={copyForm.status} onChange={e => setCopyForm({ ...copyForm, status: e.target.value as CopyStatus })} className={inputCls}>
                  {COPY_STATUSES.filter(s => s !== 'Loaned').map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            )
          )}
          <FormActions onCancel={() => setCopyOpen(false)} onSave={saveCopy} label={editCopy ? 'Save changes' : 'Add copy'} disabled={!copyForm.barcode.trim() || busy} />
        </div>
      </Modal>

      <Modal open={!!delCopy} onClose={() => setDelCopy(null)} title={`Delete copy ${delCopy?.barcode ?? ''}?`}>
        <div className="space-y-4">
          <p className="text-[14px] text-black/60 dark:text-white/60">This cannot be undone.</p>
          <div className="flex gap-3">
            <button onClick={removeCopy} disabled={busy} className="btn-ink flex-1 bg-rose-600 py-3 text-[14px] font-semibold hover:bg-rose-700 disabled:opacity-40">Delete copy</button>
            <button onClick={() => setDelCopy(null)} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Cancel</button>
          </div>
        </div>
      </Modal>
    </PortalPageShell>
  )
}
