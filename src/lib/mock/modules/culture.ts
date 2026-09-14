// Mirrors server/src/modules/culture/{router,service}.ts (phase-27-culture-engagement.md).
// Item 1 — inter-house points: a "house" is just an Activity row with kind='house' (see
// seed/community.ts) — HousePoints is a pure additive ledger, the leaderboard is always a SUM, so
// concurrent awards can never race. Item 2 — student digital portfolio: a read-only aggregation of
// Achievement (verified only)/Certificate/ActivityRegistration — no new tables; those collections are
// owned by other module batches (achievements, certificates/admissions, activities) and may simply be
// empty here, which this renders gracefully (matches the real endpoint's behavior for a student with none
// of that data yet).

import { route, requireAuth, status } from '../router'
import { notFound, forbidden, badRequest } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'

const STAFF_ROLES = new Set(['staff', 'admin', 'superadmin'])
const isStaff = (role: string) => STAFF_ROLES.has(role)

function serializeHousePoints(p: Row) {
  return { id: p.id, houseActivityId: p.houseActivityId, points: p.points, reason: p.reason, awardedById: p.awardedById, awardedAt: p.awardedAt, sourceType: p.sourceType ?? undefined, sourceRefId: p.sourceRefId ?? undefined }
}

function getHouseActivity(schoolId: string, id: string) {
  const row = table('Activity').find(a => a.id === id && a.schoolId === schoolId && a.kind === 'house')
  if (!row) throw notFound('House')
  return row
}

// ── house points ──

route('POST', '/culture/house-points', (ctx) => {
  const actor = requireAuth(ctx)
  if (!isStaff(actor.role)) throw forbidden('Only staff/admin may award house points')
  const b = ctx.body as { houseActivityId: string; points: number; reason: string; sourceType?: string; sourceRefId?: string }
  if (!Number.isInteger(b.points) || b.points === 0) throw badRequest('points must be a non-zero integer')
  const house = getHouseActivity(actor.schoolId, b.houseActivityId)
  const row: Row = { id: uid('housepoints'), schoolId: actor.schoolId, houseActivityId: house.id, points: b.points, reason: b.reason, awardedById: actor.userId, awardedAt: nowIso(), sourceType: b.sourceType ?? null, sourceRefId: b.sourceRefId ?? null }
  const rows = table('HousePoints'); rows.push(row); saveTable('HousePoints', rows)

  // Best-effort feed post, mirroring the real service's "post to the school feed" integration — never
  // let a missing/failing Post collection break the award itself.
  try {
    const verb = b.points >= 0 ? 'earns' : 'loses'
    const amount = Math.abs(b.points)
    const posts = table('Post')
    posts.push({
      id: uid('post'), schoolId: actor.schoolId, authorId: actor.userId, audience: 'School', classId: null, role: null,
      title: 'House points update', body: `${house.title} ${verb} ${amount} point${amount === 1 ? '' : 's'} — ${b.reason}`,
      pinned: false, publishedAt: nowIso(), createdAt: nowIso(),
    } as Row)
    saveTable('Post', posts)
  } catch { /* best-effort only */ }

  return status(201, { item: serializeHousePoints(row) })
})

route('GET', '/culture/house-points/leaderboard', (ctx) => {
  const actor = requireAuth(ctx)
  const { termId } = ctx.query
  let range: { start: string; end: string } | undefined
  if (termId) {
    const term = table('Term').find(t => t.id === termId && t.schoolId === actor.schoolId)
    if (term) range = { start: String(term.startDate), end: String(term.endDate) }
  }
  const houses = table('Activity').filter(a => a.schoolId === actor.schoolId && a.kind === 'house')
  if (!houses.length) return { items: [] }

  const sumOf = new Map<string, number>()
  for (const p of table('HousePoints').filter(p => p.schoolId === actor.schoolId)) {
    if (range) {
      const at = String(p.awardedAt).slice(0, 10)
      if (at < range.start || at > range.end) continue
    }
    sumOf.set(String(p.houseActivityId), (sumOf.get(String(p.houseActivityId)) ?? 0) + Number(p.points))
  }
  const rows = houses
    .map(h => ({ houseActivityId: h.id, houseName: h.title, points: sumOf.get(h.id) ?? 0 }))
    .sort((a, b) => b.points - a.points)
    .map((row, i) => ({ ...row, rank: i + 1 }))
  return { items: rows }
})

route('GET', '/culture/house-points', (ctx) => {
  const actor = requireAuth(ctx)
  const { houseActivityId } = ctx.query
  if (!houseActivityId) throw badRequest('houseActivityId is required')
  const house = getHouseActivity(actor.schoolId, houseActivityId)
  const rows = [...table('HousePoints').filter(p => p.schoolId === actor.schoolId && p.houseActivityId === house.id)].sort((a, b) => String(b.awardedAt).localeCompare(String(a.awardedAt)))
  return { items: rows.map(serializeHousePoints) }
})

// ── student digital portfolio ──

function assertPortfolioAccess(actor: { userId: string; role: string; schoolId: string }, studentId: string) {
  if (isStaff(actor.role)) return
  if (actor.role === 'student' && actor.userId === studentId) return
  if (table('Guardian').some(g => g.schoolId === actor.schoolId && g.studentId === studentId && g.parentId === actor.userId)) return
  const myClassIds = new Set(table('Class').filter(c => c.schoolId === actor.schoolId && c.classTeacherId === actor.userId).map(c => c.id))
  if (table('Enrollment').some(e => e.schoolId === actor.schoolId && e.studentId === studentId && e.status === 'active' && myClassIds.has(String(e.classId)))) return
  throw forbidden('You cannot view this student’s portfolio')
}

route('GET', '/culture/portfolio/:studentId', (ctx) => {
  const actor = requireAuth(ctx)
  const studentId = ctx.params.studentId
  const student = table('User').find(u => u.id === studentId && u.schoolId === actor.schoolId && u.role === 'student')
  if (!student) throw notFound('Student')
  assertPortfolioAccess(actor, studentId)

  const achievements = table('Achievement').filter(a => a.schoolId === actor.schoolId && a.userId === studentId && a.verifiedAt)
  const certificates = table('Certificate').filter(c => c.schoolId === actor.schoolId && c.studentId === studentId)
  const registrations = table('ActivityRegistration')
    .filter(r => r.userId === studentId && r.status !== 'Cancelled')
    .map(r => ({ row: r, activity: table('Activity').find(a => a.id === r.activityId) }))
    .filter((r): r is { row: Row; activity: Row } => !!r.activity && r.activity.schoolId === actor.schoolId)

  const groups = new Map<string, Row[]>()
  for (const a of achievements) {
    const list = groups.get(String(a.category)) ?? []
    list.push(a); groups.set(String(a.category), list)
  }
  const years = new Set<number>()
  achievements.forEach(a => years.add(new Date(String(a.date)).getUTCFullYear()))
  certificates.forEach(c => years.add(new Date(String(c.issuedAt)).getUTCFullYear()))
  registrations.forEach(r => years.add(new Date(String(r.row.registeredAt)).getUTCFullYear()))

  return {
    item: {
      student: { id: student.id, name: student.name },
      summary: { achievements: achievements.length, certificates: certificates.length, activities: registrations.length, years: years.size },
      achievements: [...groups.entries()].map(([category, items]) => ({
        category,
        items: items.map(a => ({ id: a.id, title: a.title, detail: a.detail, date: a.date, verifiedAt: a.verifiedAt })),
      })),
      certificates: certificates.map(c => ({ id: c.id, kind: c.kind, serialNo: c.serialNo, issuedAt: c.issuedAt, pdfUrl: c.pdfFileId ? `/certificates/${c.id}/pdf` : undefined })),
      activityHistory: registrations.map(r => ({ id: r.row.id, activityId: r.row.activityId, kind: r.activity.kind, title: r.activity.title, status: r.row.status, registeredAt: r.row.registeredAt, year: new Date(String(r.row.registeredAt)).getUTCFullYear() })),
    },
  }
})
