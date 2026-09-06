import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Database, History, Sparkles } from 'lucide-react'
import { useStore } from '@/lib/store'
import { api, errorMessage } from '@/lib/api'
import { isSuperAdmin } from '@/lib/access'
import { Card, Empty, Field, Modal, PageHead, Pill, inputCls } from '../ui'

interface AuditRow { id: string; actorId: string; action: string; entity: string; entityId: string; at: string }

export function SettingsMod() {
  const { user, db, academic, loadSampleData, resetSchool } = useStore()
  const superadmin = isSuperAdmin(user)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState<'sample' | 'reset' | null>(null)
  const [audit, setAudit] = useState<AuditRow[] | null>(null)

  const hasData = academic.classes.length > 0 || db.users.length > 1

  useEffect(() => {
    api.get<{ items: AuditRow[] }>('/admin/audit?limit=30')
      .then(r => setAudit(r.items))
      .catch(() => setAudit([]))
  }, [db, academic])

  const runSample = async () => {
    setBusy('sample')
    try {
      await loadSampleData()
      toast.success('Sample school loaded')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const runReset = async () => {
    if (confirmText !== 'RESET') return
    setBusy('reset')
    try {
      await resetSchool()
      setConfirmOpen(false)
      setConfirmText('')
      toast.success('School reset — only your account remains')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const actorName = (id: string) => db.users.find(u => u.id === id)?.name ?? id

  return (
    <div>
      <PageHead title="Settings" sub="School data, sample content and the audit trail" />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">
            <Database size={14} /> School data
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[14px]">
            <dt className="text-black/50 dark:text-white/50">Academic years</dt><dd className="font-semibold">{academic.years.length}</dd>
            <dt className="text-black/50 dark:text-white/50">Terms</dt><dd className="font-semibold">{academic.terms.length}</dd>
            <dt className="text-black/50 dark:text-white/50">Boards</dt><dd className="font-semibold">{academic.boards.length}</dd>
            <dt className="text-black/50 dark:text-white/50">Grades</dt><dd className="font-semibold">{academic.grades.length}</dd>
            <dt className="text-black/50 dark:text-white/50">Classes</dt><dd className="font-semibold">{academic.classes.length}</dd>
            <dt className="text-black/50 dark:text-white/50">Subjects</dt><dd className="font-semibold">{academic.subjects.length}</dd>
            <dt className="text-black/50 dark:text-white/50">Curriculum rows</dt><dd className="font-semibold">{academic.curriculum.length}</dd>
            <dt className="text-black/50 dark:text-white/50">Rooms</dt><dd className="font-semibold">{academic.rooms.length}</dd>
            <dt className="text-black/50 dark:text-white/50">People</dt><dd className="font-semibold">{db.users.length}</dd>
          </dl>
        </Card>

        {superadmin && (
          <Card>
            <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">
              <Sparkles size={14} /> Sample school
            </div>
            <p className="text-[14px] text-black/60 dark:text-white/60">
              Loads a demo school for walkthroughs — one academic year, three terms, two boards with a I–XII grade ladder, four CBSE classes, six subjects, and demo accounts for every role.
            </p>
            {hasData ? (
              <p className="mt-3 text-[13px] text-amber-700 dark:text-amber-300">Available only on an empty school. Reset first if you want the demo.</p>
            ) : (
              <button onClick={runSample} disabled={busy !== null} className="btn-ink mt-4 px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40">
                {busy === 'sample' ? 'Loading…' : 'Load sample school'}
              </button>
            )}
          </Card>
        )}

        {superadmin && (
          <Card className="border-rose-200 dark:border-rose-500/30">
            <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">
              <AlertTriangle size={14} /> Danger zone
            </div>
            <p className="text-[14px] text-black/60 dark:text-white/60">
              Reset deletes every class, term, subject, room, enrollment, record and account in this school except yours. This cannot be undone.
            </p>
            <button onClick={() => setConfirmOpen(true)} disabled={busy !== null} className="mt-4 rounded-xl bg-rose-600 px-5 py-2.5 text-[13.5px] font-semibold text-white hover:bg-rose-700 disabled:opacity-40">
              Reset school…
            </button>
          </Card>
        )}

        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">
            <History size={14} /> Recent activity
          </div>
          {audit === null ? (
            <p className="text-[13px] text-black/40 dark:text-white/40">Loading…</p>
          ) : audit.length === 0 ? (
            <Empty text="No activity recorded yet." />
          ) : (
            <div className="divide-y divide-black/[.05] dark:divide-white/[.07]">
              {audit.map(row => (
                <div key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-[13.5px]">
                  <span className="font-medium">{actorName(row.actorId)}</span>
                  <Pill tone="slate">{row.action}</Pill>
                  <span className="text-black/60 dark:text-white/60">{row.entity} <span className="font-mono text-[12px] text-black/40 dark:text-white/40">{row.entityId}</span></span>
                  <span className="ml-auto text-[12px] text-black/40 dark:text-white/40">{new Date(row.at).toLocaleString('en-IN')}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Reset this school?">
        <div className="space-y-4">
          <p className="text-[14px] text-black/60 dark:text-white/60">
            Type <span className="font-mono font-semibold">RESET</span> to confirm. Everything except your own account will be permanently deleted.
          </p>
          <Field label="Confirmation">
            <input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder="RESET" className={inputCls} autoFocus />
          </Field>
          <div className="flex gap-3">
            <button onClick={runReset} disabled={confirmText !== 'RESET' || busy !== null} className="flex-1 rounded-xl bg-rose-600 py-3 text-[14px] font-semibold text-white hover:bg-rose-700 disabled:opacity-40">
              {busy === 'reset' ? 'Resetting…' : 'Delete everything'}
            </button>
            <button onClick={() => setConfirmOpen(false)} className="rounded-xl bg-black/[.05] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:bg-white/[.07] dark:hover:bg-white/15">Cancel</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
