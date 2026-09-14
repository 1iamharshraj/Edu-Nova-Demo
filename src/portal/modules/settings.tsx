import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Database, History, Network, Sparkles } from 'lucide-react'
import { useStore } from '@/lib/store'
import { api, errorMessage } from '@/lib/api'
import { isSuperAdmin } from '@/lib/access'
import { useCreateGroup, useGroupMemberships, useJoinGroup } from '@/lib/hooks/useGroup'
import { Card, Empty, Field, Modal, PageHead, Pill, inputCls } from '../ui'

interface AuditRow { id: string; actorId: string; action: string; entity: string; entityId: string; at: string }

export function SettingsMod() {
  const { user, db, academic, loadSampleData, resetSchool } = useStore()
  const superadmin = isSuperAdmin(user)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState<'sample' | 'reset' | null>(null)
  const [audit, setAudit] = useState<AuditRow[] | null>(null)
  const [entityFilter, setEntityFilter] = useState('')
  const [actorFilter, setActorFilter] = useState('')

  const hasData = academic.classes.length > 0 || db.users.length > 1

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ limit: '30' })
    if (entityFilter) params.set('entity', entityFilter)
    if (actorFilter) params.set('actorId', actorFilter)
    api.get<{ items: AuditRow[] }>(`/admin/audit?${params.toString()}`)
      .then(r => { if (!cancelled) setAudit(r.items) })
      .catch(() => { if (!cancelled) setAudit([]) })
    return () => { cancelled = true }
  }, [db, academic, entityFilter, actorFilter])

  const entityOptions = useMemo(() => Array.from(new Set((audit ?? []).map(r => r.entity))).sort(), [audit])
  const actorOptions = useMemo(() => {
    const ids = Array.from(new Set(db.users.map(u => u.id)))
    return ids.map(id => ({ id, name: db.users.find(u => u.id === id)?.name ?? id })).sort((a, b) => a.name.localeCompare(b.name))
  }, [db.users])

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

        <GroupSettingsCard superadmin={superadmin} />

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
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">
              <History size={14} /> Recent activity
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select value={entityFilter} onChange={e => setEntityFilter(e.target.value)} className={`${inputCls} w-auto py-1.5 text-[12.5px]`} aria-label="Entity">
                <option value="">All entities</option>
                {entityFilter && !entityOptions.includes(entityFilter) && <option value={entityFilter}>{entityFilter}</option>}
                {entityOptions.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
              <select value={actorFilter} onChange={e => setActorFilter(e.target.value)} className={`${inputCls} w-auto py-1.5 text-[12.5px]`} aria-label="Actor">
                <option value="">All actors</option>
                {actorOptions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              {(entityFilter || actorFilter) && (
                <button onClick={() => { setEntityFilter(''); setActorFilter('') }} className="text-[12px] font-semibold text-black/40 hover:text-black dark:text-white/40 dark:hover:text-white">Clear</button>
              )}
            </div>
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

/* ── Phase 28: which group is my school part of + create/join a group ────
 * Visible to everyone who can reach Settings (admin/superadmin — see Portal.tsx's modulesFor), so the
 * "which group" indicator is always readable. Create/Join are superadmin-only, and live HERE rather than
 * inside the Group module: a superadmin with zero memberships has no "Group" nav entry yet (Portal.tsx
 * only splices it in once useGroupMemberships().memberships.length > 0), so this is the only reachable
 * place to create the first group or join an existing one before that entry appears. */
function GroupSettingsCard({ superadmin }: { superadmin: boolean }) {
  const { school, refresh } = useGroupMemberships()
  const createGroup = useCreateGroup()
  const joinGroup = useJoinGroup()
  const [createOpen, setCreateOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)
  const [name, setName] = useState('')
  const [joinGroupId, setJoinGroupId] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null)

  const submitCreate = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      const item = await createGroup(name.trim())
      setCreated({ id: item.id, name: item.name })
      setName('')
      toast.success(`Group "${item.name}" created — you're its Group Admin.`)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  const submitJoin = async () => {
    if (!joinGroupId.trim()) return
    setBusy(true)
    try {
      await joinGroup(joinGroupId.trim())
      await refresh()
      toast.success('This school joined the group')
      setJoinOpen(false); setJoinGroupId('')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">
        <Network size={14} /> School group
      </div>
      <p className="text-[14px]">
        {school?.groupId ? (
          <>This school is part of <span className="font-semibold">{school.groupName}</span>.</>
        ) : (
          <span className="text-black/50 dark:text-white/50">Not part of any group.</span>
        )}
      </p>
      {superadmin && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={() => setCreateOpen(true)} className="rounded-full border border-black/10 dark:border-white/15 px-4 py-2 text-[13px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06]">
            Create a group
          </button>
          <button onClick={() => setJoinOpen(true)} disabled={!!school?.groupId} className="rounded-full border border-black/10 dark:border-white/15 px-4 py-2 text-[13px] font-semibold hover:bg-black/[.04] disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/[.06]">
            Join a group
          </button>
        </div>
      )}

      <Modal open={createOpen} onClose={() => { setCreateOpen(false); setCreated(null) }} title={created ? 'Group created' : 'Create a group'}>
        {created ? (
          <div className="space-y-4">
            <p className="text-[13px] text-black/50 dark:text-white/50">
              Your own school hasn't joined <span className="font-semibold">{created.name}</span> yet — use "Join a group" with the ID below. Share this ID with other schools' superadmins so they can join too.
            </p>
            <div className="flex items-center gap-3 rounded-2xl bg-black/[.04] dark:bg-white/[.06] px-4 py-3">
              <div className="min-w-0 flex-1"><p className="text-[11.5px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Group ID</p><p className="select-all truncate font-mono text-[14px]">{created.id}</p></div>
            </div>
            <button onClick={() => { setCreateOpen(false); setCreated(null) }} className="btn-ink w-full py-3 text-[14px] font-semibold">Done</button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-[13px] text-black/50 dark:text-white/50">
              You become this group's Group Admin. Your own school does not automatically join — use "Join a group" afterwards with the group ID shown once it's created.
            </p>
            <Field label="Group name"><input value={name} onChange={e => setName(e.target.value)} autoFocus className={inputCls} /></Field>
            <button onClick={submitCreate} disabled={!name.trim() || busy} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">
              {busy ? 'Creating…' : 'Create group'}
            </button>
          </div>
        )}
      </Modal>

      <Modal open={joinOpen} onClose={() => setJoinOpen(false)} title="Join a group">
        <div className="space-y-4">
          <p className="text-[13px] text-black/50 dark:text-white/50">
            Enter the group ID given to you by the group's creator. This adds YOUR school to that group — you cannot add another school.
          </p>
          <Field label="Group ID"><input value={joinGroupId} onChange={e => setJoinGroupId(e.target.value)} placeholder="e.g. grp_abc123" autoFocus className={inputCls} /></Field>
          <button onClick={submitJoin} disabled={!joinGroupId.trim() || busy} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">
            {busy ? 'Joining…' : 'Join group'}
          </button>
        </div>
      </Modal>
    </Card>
  )
}
