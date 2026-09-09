import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Award, Download, FileText, Medal, Plus, ShieldCheck, Trophy, Users } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { api, downloadPath, errorMessage } from '@/lib/api'
import { isStaffOrAdmin } from '@/lib/access'
import { fmtDate } from '@/lib/hooks/useAcademics'
import { HOUSE_POINTS_SOURCE_TYPES, useHouseLeaderboard, useHousePointsLedger, usePortfolio } from '@/lib/hooks/useCulture'
import { useActivities } from '@/lib/hooks/useWelfare'
import type { HousePointsSourceType } from '@/lib/data'
import { Card, Empty, Field, PageHead, Pill, inputCls } from '../ui'
import { useWard } from './viewer'
import { WardPicker } from './academics'

/* ── Inter-house points leaderboard ────────────────────────
 * Open to everyone (students/parents/staff/admin) — a morale feature, not tucked behind a role gate.
 * Points are awarded to a house, not an individual — additive ledger, summed server-side.
 * See .agents/edunova/phase-27-culture-engagement.md, item 1. */

const RANK_MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }

function AwardPointsForm({ onAwarded }: { onAwarded: () => void }) {
  const { items: houses } = useActivities('house')
  const [houseActivityId, setHouseActivityId] = useState('')
  const [points, setPoints] = useState('')
  const [reason, setReason] = useState('')
  const [sourceType, setSourceType] = useState<HousePointsSourceType>('Manual')
  const [busy, setBusy] = useState(false)

  const houseList = houses ?? []

  const submit = async () => {
    const n = Number(points)
    if (!houseActivityId || !reason.trim() || !Number.isFinite(n) || n === 0) return
    setBusy(true)
    try {
      await api.post('/culture/house-points', { houseActivityId, points: n, reason: reason.trim(), sourceType })
      toast.success('Points awarded — posted to the school feed')
      setPoints(''); setReason('')
      onAwarded()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <Card>
      <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">
        <Trophy size={15} /> Award points
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="House">
          <select value={houseActivityId} onChange={e => setHouseActivityId(e.target.value)} className={inputCls}>
            <option value="">{houseList.length === 0 ? 'No houses set up yet' : 'Select a house'}</option>
            {houseList.map(h => <option key={h.id} value={h.id}>{h.title}</option>)}
          </select>
        </Field>
        <Field label="Points (use a negative number to deduct)">
          <input type="number" value={points} onChange={e => setPoints(e.target.value)} className={inputCls} placeholder="e.g. 25" />
        </Field>
        <Field label="Reason"><input value={reason} onChange={e => setReason(e.target.value)} className={inputCls} placeholder="e.g. Won the inter-house relay" /></Field>
        <Field label="Source">
          <select value={sourceType} onChange={e => setSourceType(e.target.value as HousePointsSourceType)} className={inputCls}>
            {HOUSE_POINTS_SOURCE_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      <button onClick={submit} disabled={busy || !houseActivityId || !reason.trim() || !points}
        className="btn-ink mt-5 flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40">
        <Plus size={15} /> {busy ? 'Awarding…' : 'Award points'}
      </button>
    </Card>
  )
}

/** Points ledger for one house — a transaction history. Rendered both here (unused now, kept exported for
 * the routed page at `/portal/culture/houses/:id/ledger`, see `src/pages/portal/HousePointsLedger.tsx`) and
 * previously inline in a modal from the leaderboard's standings list. */
export function HousePointsLedger({ houseActivityId, houseName }: { houseActivityId: string; houseName: string }) {
  const { db } = useStore()
  const { items, loading } = useHousePointsLedger(houseActivityId)
  const rows = [...(items ?? [])].sort((a, b) => b.awardedAt.localeCompare(a.awardedAt))
  const nameOf = (id: string) => db.users.find(u => u.id === id)?.name ?? 'Staff'
  return (
    <Card>
      <p className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">{houseName} · points ledger</p>
      {loading && <p className="text-[13px] text-black/40 dark:text-white/40">Loading…</p>}
      {!loading && rows.length === 0 && <Empty text="No points awarded to this house yet." />}
      {!loading && rows.length > 0 && (
        <div className="space-y-2.5">
          {rows.map(r => (
            <div key={r.id} className="flex items-center justify-between gap-3 rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3.5">
              <div className="min-w-0">
                <p className="truncate text-[13.5px] font-semibold">{r.reason}</p>
                <p className="text-[11.5px] text-black/45 dark:text-white/45">
                  {nameOf(r.awardedById)} · {fmtDate(r.awardedAt, { day: 'numeric', month: 'short', year: 'numeric' })}
                  {r.sourceType ? ` · ${r.sourceType}` : ''}
                </p>
              </div>
              <span className={`shrink-0 text-[15px] font-display font-medium ${r.points >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                {r.points >= 0 ? '+' : ''}{r.points}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

export function LeaderboardMod() {
  const { user } = useStore()
  const navigate = useNavigate()
  const canAward = isStaffOrAdmin(user)
  const { items, loading, error, reload } = useHouseLeaderboard()

  const rows = useMemo(() => [...(items ?? [])].sort((a, b) => a.rank - b.rank), [items])
  const maxPoints = Math.max(1, ...rows.map(r => r.points))

  return (
    <div>
      <PageHead title="House Leaderboard" sub="Live inter-house standings — cheer your house on" />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        {canAward && <AwardPointsForm onAwarded={reload} />}
        <Card className={canAward ? '' : 'lg:col-span-2'}>
          <p className="mb-5 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">
            <Medal size={15} /> Standings
          </p>
          {loading && <p className="py-8 text-center text-[14px] text-black/40 dark:text-white/40">Loading standings…</p>}
          {error && <Empty text={error} />}
          {!loading && !error && rows.length === 0 && <Empty text="No houses have been awarded points yet." />}
          {!loading && !error && rows.length > 0 && (
            <div className="space-y-4">
              {rows.map(r => (
                <button key={r.houseActivityId} onClick={() => navigate(`/portal/culture/houses/${encodeURIComponent(r.houseActivityId)}/ledger`)}
                  className="block w-full text-left">
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-[14.5px] font-semibold">
                      <span className="w-6 text-center">{RANK_MEDAL[r.rank] ?? `#${r.rank}`}</span>
                      {r.houseName}
                    </span>
                    <span className="font-display text-[16px] font-medium">{r.points} pts</span>
                  </div>
                  <div className="h-3 w-full overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.08]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 transition-all"
                      style={{ width: `${Math.max(3, Math.round((Math.max(0, r.points) / maxPoints) * 100))}%` }}
                    />
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

/* ── Student digital portfolio ──────────────────────────────
 * A presentational aggregation of Achievements + Certificates + Activity history — no new data model.
 * See .agents/edunova/phase-27-culture-engagement.md, item 2. */

export function PortfolioView({ studentId }: { studentId: string }) {
  const { data: portfolio, loading, error } = usePortfolio(studentId)

  if (loading) return <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading portfolio…</p>
  if (error || !portfolio) return <Empty text={error ? errorMessage(error) : 'No portfolio data available.'} />

  const { summary, achievements, certificates, activityHistory } = portfolio

  return (
    <div className="space-y-5">
      <Card className="bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-display text-xl font-medium">{portfolio.student.name}</p>
            <p className="text-[13px] text-white/80">Student portfolio</p>
          </div>
          <button onClick={() => downloadPath(`/culture/portfolio/${encodeURIComponent(studentId)}/export`, `${portfolio.student.name.replace(/\s+/g, '_')}_Portfolio.pdf`).catch(e => toast.error(errorMessage(e)))}
            className="flex items-center gap-2 rounded-full bg-white/15 px-4 py-2.5 text-[13px] font-semibold backdrop-blur hover:bg-white/25">
            <Download size={15} /> Download Portfolio PDF
          </button>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-4">
          <div><p className="font-display text-2xl font-medium">{summary.achievements}</p><p className="text-[12px] text-white/75">Achievements</p></div>
          <div><p className="font-display text-2xl font-medium">{summary.certificates}</p><p className="text-[12px] text-white/75">Certificates</p></div>
          <div><p className="font-display text-2xl font-medium">{summary.activities}</p><p className="text-[12px] text-white/75">Activities · {summary.years} yrs</p></div>
        </div>
      </Card>

      <Card>
        <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><Award size={15} /> Verified achievements</p>
        {achievements.length === 0 ? <Empty text="No verified achievements yet." /> : (
          <div className="space-y-5">
            {achievements.map(group => (
              <div key={group.category}>
                <p className="mb-2 text-[12px] font-semibold text-black/50 dark:text-white/50">{group.category}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {group.items.map(a => (
                    <div key={a.id} className="rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[14px] font-semibold">{a.title}</p>
                        <Pill tone="green"><ShieldCheck size={11} /> verified</Pill>
                      </div>
                      <p className="mt-1 text-[12.5px] text-black/50 dark:text-white/50">{a.detail}</p>
                      <p className="mt-1 text-[11.5px] text-black/40 dark:text-white/40">{fmtDate(a.date, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><FileText size={15} /> Certificates</p>
        {certificates.length === 0 ? <Empty text="No certificates issued." /> : (
          <div className="space-y-2.5">
            {certificates.map(c => (
              <div key={c.id} className="flex items-center justify-between rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3.5">
                <div>
                  <p className="text-[14px] font-semibold">{c.kind}</p>
                  <p className="text-[12.5px] text-black/50 dark:text-white/50">{c.serialNo} · issued {c.issuedAt.slice(0, 10)}</p>
                </div>
                {c.pdfUrl && (
                  <button onClick={() => downloadPath(c.pdfUrl!, `${c.kind}-${c.serialNo}.pdf`).catch(e => toast.error(errorMessage(e)))}
                    className="rounded-full bg-black/[.05] dark:bg-white/[.08] px-3 py-1.5 text-[12px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Download</button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><Users size={15} /> Activities, clubs & houses</p>
        {activityHistory.length === 0 ? <Empty text="No activity history yet." /> : (
          <div className="space-y-2.5">
            {activityHistory.map(a => (
              <div key={a.id} className="flex items-center justify-between gap-3 rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3.5">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold">{a.title}</p>
                  <p className="text-[12px] text-black/45 dark:text-white/45">{a.year} · {fmtDate(a.registeredAt, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                </div>
                <Pill tone={a.status === 'Registered' ? 'green' : a.status === 'Waitlisted' ? 'amber' : 'slate'}>{a.status}</Pill>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

/** Student self-view, or a guardian viewing a ward — mirrors the attendance/report `useWard()` pattern. */
export function PortfolioMod() {
  const { students, ward, wardId, setWardId } = useWard()

  return (
    <div>
      <PageHead title="My Portfolio" sub="Your achievements, certificates and activities in one place">
        <WardPicker students={students} value={wardId} onChange={setWardId} />
      </PageHead>
      {!ward ? <Empty text="No student is linked to your account yet." /> : <PortfolioView studentId={ward.id} />}
    </div>
  )
}
