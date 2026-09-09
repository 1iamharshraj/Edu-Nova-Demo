import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  AlertTriangle, BookMarked, BookOpen, Check, CheckCircle2, Clock3, IndianRupee, Plus, Search, Undo2, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { api, errorMessage } from '@/lib/api'
import { isStaffOrAdmin } from '@/lib/access'
import type { BookCondition, BookRec, LoanRec, Role, User } from '@/lib/data'
import { fmtDate } from '@/lib/hooks/useAcademics'
import {
  BOOK_CONDITIONS, DEFAULT_LIBRARY_SETTINGS, availabilityLabel, daysOverdue, fineStatusTone,
  isOverdue, loanLimitFor, previewFine, useBooks, useCopies, useLibrarySettings, useLoans, useSplitLoans,
} from '@/lib/hooks/useLibrary'
import { Card, Empty, Field, Modal, PageHead, Pill, inputCls } from '../ui'

// Phase 15 — Library Management (frontend). Catalog browse (all roles), Issue & Returns (staff/admin),
// My Loans (self, all roles) and admin-only Library Settings. Endpoint shapes verified against the live
// server (server/src/modules/library/{router,schema,service}.ts) — see useLibrary.ts's header note for the
// handful of paths/shapes that were inferred before the server landed and confirmed after. See
// .agents/edunova/phase-15-library.md

const muted = 'text-[12.5px] text-black/50 dark:text-white/50'
const sectionLabel = 'text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40'
const rowCls = 'flex flex-wrap items-center gap-3 border-b border-black/[.05] dark:border-white/[.07] px-5 py-3.5 last:border-0'

function FormActions({ onCancel, onSave, label, disabled }: { onCancel: () => void; onSave: () => void; label: string; disabled?: boolean }) {
  return (
    <div className="flex gap-3 pt-2">
      <button onClick={onSave} disabled={disabled} className="btn-ink flex-1 py-3 text-[14px] font-semibold disabled:opacity-40">{label}</button>
      <button onClick={onCancel} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Cancel</button>
    </div>
  )
}

/* ── Catalog: browse (all roles) + inventory management (staff/admin) ─── */

interface BookForm { title: string; author: string; isbn: string; publisher: string; category: string }
const emptyBookForm = (): BookForm => ({ title: '', author: '', isbn: '', publisher: '', category: '' })
export function LibraryCatalogMod() {
  const { user } = useStore()
  const navigate = useNavigate()
  const canManage = isStaffOrAdmin(user)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const books = useBooks({ q: search.trim() || undefined, category: category || undefined })

  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState<BookForm>(emptyBookForm())
  const [busy, setBusy] = useState(false)
  const saveBook = async () => {
    setBusy(true)
    try {
      await api.post('/library/books', {
        title: form.title.trim(), author: form.author.trim(),
        isbn: form.isbn.trim() || undefined, publisher: form.publisher.trim() || undefined, category: form.category.trim() || undefined,
      })
      setAddOpen(false); setForm(emptyBookForm()); books.reload(); toast.success('Book added to catalog')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  const categories = useMemo(() => Array.from(new Set((books.items ?? []).map(b => b.category).filter((c): c is string => !!c))).sort(), [books.items])
  const sorted = useMemo(() => [...(books.items ?? [])].sort((a, b) => a.title.localeCompare(b.title)), [books.items])

  return (
    <div>
      <PageHead title="Library" sub="Browse the catalog and check what's available">
        {canManage && (
          <button onClick={() => { setForm(emptyBookForm()); setAddOpen(true) }} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold">
            <Plus size={15} /> Add book
          </button>
        )}
      </PageHead>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-black/10 dark:border-white/15 bg-white dark:bg-[#14141f] px-3 py-2">
          <Search size={16} className="text-black/40 dark:text-white/40" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by title or author" className="flex-1 bg-transparent text-[14px] outline-none" />
        </div>
        {categories.length > 0 && (
          <select value={category} onChange={e => setCategory(e.target.value)} className={`${inputCls} w-auto min-w-[140px]`}>
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {books.loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading catalog…</p>}
      {books.error && <Empty text={books.error} />}
      {!books.loading && !books.error && sorted.length === 0 && (
        <Card className="flex flex-col items-center py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600"><BookMarked size={26} /></div>
          <p className="mt-4 font-display text-xl font-medium">No books found</p>
          <p className="mt-1 max-w-sm text-[14px] text-black/50 dark:text-white/50">{search || category ? 'Try a different search or clear the filter.' : 'The catalog is empty so far.'}</p>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map(b => {
          const available = (b.availableCopies ?? 0) > 0
          const hasCopies = (b.totalCopies ?? 0) > 0
          return (
            <Card key={b.id} className="card-lift flex cursor-pointer flex-col gap-3" onClick={() => navigate(`/portal/library/books/${b.id}`)}>
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600"><BookOpen size={20} /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold">{b.title}</p>
                  <p className={`truncate ${muted}`}>{b.author}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {b.category && <Pill tone="slate">{b.category}</Pill>}
                <Pill tone={!hasCopies ? 'slate' : available ? 'green' : 'rose'}>{availabilityLabel(b)}</Pill>
              </div>
            </Card>
          )
        })}
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="New book">
        <div className="space-y-4">
          <Field label="Title"><input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className={inputCls} autoFocus /></Field>
          <Field label="Author"><input value={form.author} onChange={e => setForm({ ...form, author: e.target.value })} className={inputCls} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category"><input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="Optional" className={inputCls} /></Field>
            <Field label="Publisher"><input value={form.publisher} onChange={e => setForm({ ...form, publisher: e.target.value })} placeholder="Optional" className={inputCls} /></Field>
          </div>
          <Field label="ISBN"><input value={form.isbn} onChange={e => setForm({ ...form, isbn: e.target.value })} placeholder="Optional" className={inputCls} /></Field>
          <FormActions onCancel={() => setAddOpen(false)} onSave={saveBook} label="Add book" disabled={!form.title.trim() || !form.author.trim() || busy} />
        </div>
      </Modal>
    </div>
  )
}

/* ── Issue & Returns (staff/admin) ──────────────────────── */

function BorrowerRoleLabel({ role }: { role: Role }) {
  return <span className="capitalize">{role}</span>
}

function BorrowerPicker({ value, onChange }: { value: User | null; onChange: (u: User | null) => void }) {
  const { db } = useStore()
  const [text, setText] = useState('')
  const candidates = useMemo(
    () => db.users.filter(u => u.role !== 'parent').sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name)),
    [db.users],
  )
  const matches = useMemo(() => {
    const q = text.trim().toLowerCase()
    if (!q) return []
    return candidates.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)).slice(0, 8)
  }, [candidates, text])

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-black/[.04] dark:bg-white/[.06] px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] font-semibold">{value.name}</p>
          <p className={muted}><BorrowerRoleLabel role={value.role} /> · {value.email}</p>
        </div>
        <button onClick={() => { onChange(null); setText('') }} className="rounded-full p-2 text-black/40 hover:bg-black/10 hover:text-black dark:text-white/40 dark:hover:bg-white/15" aria-label="Change borrower"><X size={15} /></button>
      </div>
    )
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-xl border border-black/10 dark:border-white/15 bg-white dark:bg-[#14141f] px-3 py-2.5">
        <Search size={16} className="text-black/40 dark:text-white/40" />
        <input value={text} onChange={e => setText(e.target.value)} placeholder="Search a student, teacher or staff member by name or email" className="flex-1 bg-transparent text-[14.5px] outline-none" />
      </div>
      {matches.length > 0 && (
        <div className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-2xl border border-black/[.08] dark:border-white/[.1] bg-white dark:bg-[#14141f] shadow-xl">
          {matches.map(u => (
            <button key={u.id} onClick={() => { onChange(u); setText('') }} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-black/[.04] dark:hover:bg-white/[.06]">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{u.name}</p>
                <p className={muted}><BorrowerRoleLabel role={u.role} /> · {u.email}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function IssueBookPanel({ borrower, atLimit, onIssued }: { borrower: User; atLimit: boolean; onIssued: () => void }) {
  const [search, setSearch] = useState('')
  const books = useBooks({ q: search.trim() || undefined }, search.trim().length > 0)
  const [pickedBook, setPickedBook] = useState<BookRec | null>(null)
  const copies = useCopies(pickedBook?.id, !!pickedBook)
  const availableCopies = useMemo(() => (copies.items ?? []).filter(c => c.status === 'Available'), [copies.items])
  const [copyId, setCopyId] = useState('')
  const [busy, setBusy] = useState(false)

  const issue = async () => {
    if (!copyId) return
    setBusy(true)
    try {
      await api.post('/library/loans', { copyId, borrowerId: borrower.id })
      setPickedBook(null); setCopyId(''); setSearch('')
      onIssued()
      toast.success('Book issued')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <Card>
      <p className={sectionLabel}>Issue a book</p>
      {atLimit ? (
        <div className="mt-3 flex items-start gap-3 rounded-2xl bg-amber-50 dark:bg-amber-500/10 p-4 text-[13.5px] text-amber-800 dark:text-amber-300">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <p>{borrower.name} is already at their active-loan limit. Return a book before issuing another.</p>
        </div>
      ) : !pickedBook ? (
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-2 rounded-xl border border-black/10 dark:border-white/15 bg-white dark:bg-[#14141f] px-3 py-2.5">
            <Search size={16} className="text-black/40 dark:text-white/40" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search a book by title or author" className="flex-1 bg-transparent text-[14.5px] outline-none" />
          </div>
          {search.trim() && (
            <div className="max-h-64 divide-y divide-black/[.05] overflow-y-auto rounded-2xl border border-black/[.06] dark:divide-white/[.07] dark:border-white/[.08]">
              {books.loading && <div className="p-4 text-[13px] text-black/40 dark:text-white/40">Searching…</div>}
              {!books.loading && (books.items ?? []).length === 0 && <div className="p-4 text-[13px] text-black/40 dark:text-white/40">No matching books.</div>}
              {(books.items ?? []).map(b => (
                <button key={b.id} onClick={() => setPickedBook(b)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-black/[.04] dark:hover:bg-white/[.06]">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-medium">{b.title}</p>
                    <p className={muted}>{b.author}</p>
                  </div>
                  <Pill tone={(b.availableCopies ?? 0) > 0 ? 'green' : 'rose'}>{availabilityLabel(b)}</Pill>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-3 rounded-2xl bg-black/[.04] dark:bg-white/[.06] px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[14.5px] font-semibold">{pickedBook.title}</p>
              <p className={muted}>{pickedBook.author}</p>
            </div>
            <button onClick={() => { setPickedBook(null); setCopyId('') }} className="rounded-full p-2 text-black/40 hover:bg-black/10 hover:text-black dark:text-white/40 dark:hover:bg-white/15" aria-label="Choose a different book"><X size={15} /></button>
          </div>
          {copies.loading ? (
            <p className="text-[13px] text-black/40 dark:text-white/40">Loading copies…</p>
          ) : availableCopies.length === 0 ? (
            <Empty text="No copies of this title are available right now." />
          ) : (
            <Field label="Copy to issue">
              <select value={copyId} onChange={e => setCopyId(e.target.value)} className={inputCls}>
                <option value="">Select a copy</option>
                {availableCopies.map(c => <option key={c.id} value={c.id}>{c.barcode}{c.condition ? ` · ${c.condition}` : ''}</option>)}
              </select>
            </Field>
          )}
          <button onClick={issue} disabled={!copyId || busy} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy ? 'Issuing…' : 'Issue book'}</button>
        </div>
      )}
    </Card>
  )
}

interface ReturnForm { condition: BookCondition; lost: boolean; fineStatus: 'Pending' | 'Paid' | 'Waived' }

function ReturnModal({ loan, settings, onClose, onDone }: {
  loan: LoanRec | null; settings: { finePerDayOverdue: number }; onClose: () => void; onDone: () => void
}) {
  const overdue = loan ? isOverdue(loan) : false
  const overdueDays = loan ? daysOverdue(loan.dueDate) : 0
  const estFine = loan ? previewFine(loan.dueDate, settings.finePerDayOverdue) : 0
  const [form, setForm] = useState<ReturnForm>({ condition: 'Good', lost: false, fineStatus: 'Pending' })
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!loan) return
    setBusy(true)
    try {
      // Return and fine status are two separate server calls (schema.ts's `returnLoan` only takes
      // `{ condition?, lost? }` — the server sets fineStatus: Pending itself when the return lands overdue;
      // marking it Paid/Waived is the separate `fineUpdate` call).
      await api.post(`/library/loans/${loan.id}/return`, { condition: form.lost ? undefined : form.condition, lost: form.lost || undefined })
      if (overdue && form.fineStatus !== 'Pending') {
        await api.patch(`/library/loans/${loan.id}/fine`, { fineStatus: form.fineStatus })
      }
      onDone()
      toast.success('Return recorded')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  if (!loan) return null
  return (
    <Modal open={!!loan} onClose={onClose} title={`Return ${loan.copy.book.title}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-[13.5px]">
          <div><p className={muted}>Barcode</p><p className="font-mono font-medium">{loan.copy.barcode}</p></div>
          <div><p className={muted}>Due date</p><p className="font-medium">{fmtDate(loan.dueDate)}</p></div>
        </div>

        {overdue && (
          <div className="flex items-start gap-3 rounded-2xl bg-rose-50 dark:bg-rose-500/10 p-4 text-[13.5px] text-rose-700 dark:text-rose-300">
            <IndianRupee size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">{overdueDays} day{overdueDays === 1 ? '' : 's'} overdue — fine ₹{estFine}</p>
              <p className="mt-0.5">Computed at the school's ₹{settings.finePerDayOverdue}/day rate. Mark it below.</p>
            </div>
          </div>
        )}

        <label className="flex items-center gap-2 text-[13.5px]">
          <input type="checkbox" checked={form.lost} onChange={e => setForm({ ...form, lost: e.target.checked })} /> Copy is lost (won't return to circulation)
        </label>

        {!form.lost && (
          <Field label="Condition on return">
            <select value={form.condition} onChange={e => setForm({ ...form, condition: e.target.value as BookCondition })} className={inputCls}>
              {BOOK_CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        )}

        {overdue && (
          <Field label="Fine status">
            <div className="inline-flex rounded-full border border-black/[.08] dark:border-white/[.10] bg-white dark:bg-[#14141f] p-1">
              {(['Pending', 'Paid', 'Waived'] as const).map(s => (
                <button key={s} onClick={() => setForm({ ...form, fineStatus: s })}
                  className={`rounded-full px-4 py-1.5 text-[12.5px] font-semibold transition-all ${form.fineStatus === s ? 'bg-black text-white shadow' : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'}`}>
                  {s}
                </button>
              ))}
            </div>
          </Field>
        )}

        <FormActions onCancel={onClose} onSave={submit} label="Record return" disabled={busy} />
      </div>
    </Modal>
  )
}

export function LibraryIssueReturnsMod() {
  const [borrower, setBorrower] = useState<User | null>(null)
  const { data: settings } = useLibrarySettings()
  const effSettings = settings ?? DEFAULT_LIBRARY_SETTINGS
  const loans = useLoans({ borrowerId: borrower?.id }, !!borrower)
  const { current, past } = useSplitLoans(loans.items)
  const limit = borrower ? loanLimitFor(borrower.role, effSettings) : 0
  const [returning, setReturning] = useState<LoanRec | null>(null)

  const afterChange = () => loans.reload()

  return (
    <div>
      <PageHead title="Issue & Returns" sub="Issue a book to a borrower or record a return" />

      <Card className="mb-5">
        <p className={sectionLabel}>Borrower</p>
        <div className="mt-3"><BorrowerPicker value={borrower} onChange={setBorrower} /></div>
      </Card>

      {!borrower ? (
        <Empty text="Search for a student, teacher or staff member to begin." />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-5">
            <Card>
              <div className="flex items-center justify-between">
                <p className={sectionLabel}>Active loans</p>
                <Pill tone={current.length >= limit ? 'rose' : 'slate'}>{current.length} of {limit} used</Pill>
              </div>
              {loans.loading ? (
                <p className="mt-3 text-[13px] text-black/40 dark:text-white/40">Loading…</p>
              ) : current.length === 0 ? (
                <p className="mt-3 text-[13.5px] text-black/50 dark:text-white/50">No active loans.</p>
              ) : (
                <div className="mt-3 -mx-6 divide-y divide-black/[.05] dark:divide-white/[.07]">
                  {current.map(l => {
                    const late = isOverdue(l)
                    return (
                      <div key={l.id} className={rowCls}>
                        <div className="min-w-32 flex-1">
                          <p className="text-[14px] font-semibold">{l.copy.book.title}</p>
                          <p className={muted}>Due {fmtDate(l.dueDate)} · {l.copy.barcode}</p>
                        </div>
                        {late && <Pill tone="rose"><Clock3 size={11} /> Overdue</Pill>}
                        <button onClick={() => setReturning(l)} className="flex items-center gap-1.5 rounded-full bg-black/[.05] dark:bg-white/[.07] px-3 py-1.5 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">
                          <Undo2 size={13} /> Return
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>

            <Card>
              <p className={sectionLabel}>Past loans</p>
              {past.length === 0 ? (
                <p className="mt-3 text-[13.5px] text-black/50 dark:text-white/50">No return history yet.</p>
              ) : (
                <div className="mt-3 -mx-6 divide-y divide-black/[.05] dark:divide-white/[.07]">
                  {past.slice(0, 8).map(l => (
                    <div key={l.id} className={rowCls}>
                      <div className="min-w-32 flex-1">
                        <p className="text-[14px] font-semibold">{l.copy.book.title}</p>
                        <p className={muted}>Returned {fmtDate(l.returnedAt)}</p>
                      </div>
                      {l.fineStatus !== 'None' && <Pill tone={fineStatusTone(l.fineStatus)}>{l.fineStatus} · ₹{l.fineAmount ?? 0}</Pill>}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <IssueBookPanel borrower={borrower} atLimit={current.length >= limit} onIssued={afterChange} />
        </div>
      )}

      <ReturnModal loan={returning} settings={effSettings} onClose={() => setReturning(null)} onDone={() => { setReturning(null); afterChange() }} />
    </div>
  )
}

/* ── My Loans (self, all roles) ─────────────────────────── */

export function MyLoansMod() {
  const { user } = useStore()
  const loans = useLoans({ borrowerId: user?.id }, !!user)
  const { current, past } = useSplitLoans(loans.items)
  const pendingFines = useMemo(() => (loans.items ?? []).filter(l => l.fineStatus === 'Pending'), [loans.items])
  const totalPending = pendingFines.reduce((a, l) => a + (l.fineAmount ?? 0), 0)

  return (
    <div>
      <PageHead title="My Loans" sub="Books you currently have, and your borrowing history" />

      {pendingFines.length > 0 && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl bg-rose-50 dark:bg-rose-500/10 p-4 text-[13.5px] text-rose-700 dark:text-rose-300">
          <IndianRupee size={18} className="mt-0.5 shrink-0" />
          <p><span className="font-semibold">₹{totalPending} in pending fines</span> across {pendingFines.length} loan{pendingFines.length === 1 ? '' : 's'}. Settle these at the library desk.</p>
        </div>
      )}

      {loans.loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading…</p>}
      {loans.error && <Empty text={loans.error} />}

      {!loans.loading && !loans.error && (
        <div className="space-y-6">
          <Card className="p-0">
            <p className={`${sectionLabel} border-b border-black/[.06] px-6 py-4 dark:border-white/[.08]`}>Current loans</p>
            {current.length === 0 ? <div className="p-6"><Empty text="No books currently on loan." /></div> : (
              <div className="divide-y divide-black/[.05] dark:divide-white/[.07]">
                {current.map(l => {
                  const late = isOverdue(l)
                  return (
                    <div key={l.id} className={rowCls}>
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${late ? 'bg-rose-50 dark:bg-rose-500/10 text-rose-500' : 'bg-black/[.05] dark:bg-white/[.07] text-black/50 dark:text-white/50'}`}><BookOpen size={16} /></span>
                      <div className="min-w-40 flex-1">
                        <p className="text-[14.5px] font-semibold">{l.copy.book.title}</p>
                        <p className={muted}>Issued {fmtDate(l.issuedAt)} · Due {fmtDate(l.dueDate)}</p>
                      </div>
                      {late ? <Pill tone="rose"><Clock3 size={11} /> Overdue</Pill> : <Pill tone="green"><CheckCircle2 size={11} /> On time</Pill>}
                    </div>
                  )
                })}
              </div>
            )}
          </Card>

          <Card className="p-0">
            <p className={`${sectionLabel} border-b border-black/[.06] px-6 py-4 dark:border-white/[.08]`}>Past loans</p>
            {past.length === 0 ? <div className="p-6"><Empty text="No returned loans yet." /></div> : (
              <div className="divide-y divide-black/[.05] dark:divide-white/[.07]">
                {past.map(l => (
                  <div key={l.id} className={rowCls}>
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/[.05] dark:bg-white/[.07] text-black/50 dark:text-white/50"><BookOpen size={16} /></span>
                    <div className="min-w-40 flex-1">
                      <p className="text-[14.5px] font-semibold">{l.copy.book.title}</p>
                      <p className={muted}>Issued {fmtDate(l.issuedAt)} · Returned {fmtDate(l.returnedAt)}</p>
                    </div>
                    {l.fineStatus !== 'None' && <Pill tone={fineStatusTone(l.fineStatus)}>{l.fineStatus === 'Pending' ? `₹${l.fineAmount ?? 0} due` : `${l.fineStatus} · ₹${l.fineAmount ?? 0}`}</Pill>}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}

/* ── Library Settings (admin only) ──────────────────────── */

const settingsToForm = (s: typeof DEFAULT_LIBRARY_SETTINGS) => ({
  loanPeriodDays: String(s.loanPeriodDays), maxActiveLoansStudent: String(s.maxActiveLoansStudent),
  maxActiveLoansStaff: String(s.maxActiveLoansStaff), finePerDayOverdue: String(s.finePerDayOverdue),
})

export function LibrarySettingsMod() {
  const { data: settings, loading, reload } = useLibrarySettings()
  const [form, setForm] = useState(settingsToForm(DEFAULT_LIBRARY_SETTINGS))
  const [busy, setBusy] = useState(false)

  // Sync the editable form from the fetched record the first time it lands (render-time adjustment, not an
  // effect — same convention as SearchableUserPicker's text resync in modules/employee.tsx).
  const [syncedFor, setSyncedFor] = useState<string | undefined>(undefined)
  if (settings && settings.id !== syncedFor) {
    setSyncedFor(settings.id)
    setForm(settingsToForm(settings))
  }

  const save = async () => {
    setBusy(true)
    try {
      await api.patch('/library/settings', {
        loanPeriodDays: Math.max(1, Number(form.loanPeriodDays) || 0),
        maxActiveLoansStudent: Math.max(0, Number(form.maxActiveLoansStudent) || 0),
        maxActiveLoansStaff: Math.max(0, Number(form.maxActiveLoansStaff) || 0),
        finePerDayOverdue: Math.max(0, Number(form.finePerDayOverdue) || 0),
      })
      reload()
      toast.success('Library settings updated')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <div>
      <PageHead title="Library Settings" sub="Loan period, per-role borrowing limits and the overdue fine rate" />
      <Card className="max-w-xl">
        {loading ? (
          <p className="py-6 text-center text-[14px] text-black/40 dark:text-white/40">Loading…</p>
        ) : (
          <div className="space-y-4">
            <Field label="Loan period (days)">
              <input type="number" min={1} value={form.loanPeriodDays} onChange={e => setForm({ ...form, loanPeriodDays: e.target.value })} className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Max active loans — student">
                <input type="number" min={0} value={form.maxActiveLoansStudent} onChange={e => setForm({ ...form, maxActiveLoansStudent: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Max active loans — staff/teacher">
                <input type="number" min={0} value={form.maxActiveLoansStaff} onChange={e => setForm({ ...form, maxActiveLoansStaff: e.target.value })} className={inputCls} />
              </Field>
            </div>
            <Field label="Fine per day overdue (₹)">
              <input type="number" min={0} value={form.finePerDayOverdue} onChange={e => setForm({ ...form, finePerDayOverdue: e.target.value })} className={inputCls} />
            </Field>
            <button onClick={save} disabled={busy} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">
              <span className="inline-flex items-center gap-2"><Check size={15} /> {busy ? 'Saving…' : 'Save settings'}</span>
            </button>
          </div>
        )}
      </Card>
    </div>
  )
}
