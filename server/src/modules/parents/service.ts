import { prisma } from '../../prisma'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { fmtDate, toDate } from '../../lib/validate'
import { visibleStudentIds } from '../../lib/scope'
import { notify, sendWhatsApp } from '../../lib/notify'
import { listInvoices, serializeInvoice } from '../fees/service'
import { homeworkInclude, serializeHomework } from '../homework/service'
import { listEvents } from '../calendar/service'
import { computePace } from '../syllabus/service'

// See phase-23-parent-experience.md → item 1 (family view) and item 2 (daily digest).
//
// This module is a pure aggregation layer: every per-domain figure below is produced by re-calling the
// *existing* domain service (fees/service.ts#listInvoices, homework's homeworkInclude/serializeHomework,
// calendar/service.ts#listEvents, syllabus/service.ts#computePace) with the caller's own parent `ctx` —
// so every existing scoping/permission rule (visibleStudentIds, assertViewClass, etc.) applies exactly as
// it already does for those modules' own routes. No new data is invented here, only combined per ward.

// Monday–Sunday week containing `now` (UTC, matching this codebase's date-as-UTC-midnight convention —
// see lib/validate.ts#toDate/fmtDate).
function currentWeekRange(now = new Date()): { start: Date; end: Date } {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const day = d.getUTCDay() // 0 Sun … 6 Sat
  const diffToMonday = day === 0 ? -6 : 1 - day
  const start = new Date(d.getTime() + diffToMonday * 86_400_000)
  const end = new Date(start.getTime() + 6 * 86_400_000)
  return { start, end }
}

function paceHeadline(delta: number): string {
  if (delta < 0) return `${Math.abs(delta)} chapter${Math.abs(delta) === 1 ? '' : 's'} behind`
  if (delta > 0) return `${delta} chapter${delta === 1 ? '' : 's'} ahead`
  return 'On track'
}

export interface WardSummary {
  studentId: string
  name: string
  classId?: string
  classLabel?: string
  attendanceToday: { status: string | null; marked: boolean }
  homeworkDueThisWeek: { id: string; title: string; subjectName: string; dueDate: string; submitted: boolean }[]
  feeDue: { total: number; invoiceCount: number }
  syllabusPace: { classSubjectId: string; subjectId: string; subjectName: string; paceDeltaChapters: number; headline: string }[]
}

export interface FamilySummary {
  generatedAt: string
  wards: WardSummary[]
  upcomingEvents: Awaited<ReturnType<typeof listEvents>>
}

// GET /api/parents/me/family-summary — parent-only (enforced by the router's requireRole; this extra
// check keeps the function safe to call directly, e.g. from the digest below with a synthetic ctx).
export async function familySummary(ctx: Ctx): Promise<FamilySummary> {
  if (ctx.role !== 'parent') throw new HttpError(403, 'Parents only')

  const wardIds = (await visibleStudentIds(ctx)) ?? []
  if (!wardIds.length) return { generatedAt: new Date().toISOString(), wards: [], upcomingEvents: [] }

  const [students, enrollments] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: wardIds }, schoolId: ctx.schoolId, role: 'student' }, select: { id: true, name: true } }),
    prisma.enrollment.findMany({ where: { studentId: { in: wardIds }, status: 'active' }, include: { class: { include: { grade: true } } } }),
  ])
  const enrByStudent = new Map(enrollments.map(e => [e.studentId, e]))
  const classIds = [...new Set(enrollments.map(e => e.classId))]

  const today = fmtDate(new Date())
  const todayDate = toDate(today)
  const { start: weekStart, end: weekEnd } = currentWeekRange()

  // Today's whole-day attendance status, batched across every ward in one query.
  const attendanceRecords = classIds.length
    ? await prisma.attendanceRecord.findMany({
      where: { studentId: { in: wardIds }, session: { schoolId: ctx.schoolId, date: todayDate, periodIdx: null } },
      select: { studentId: true, status: true },
    })
    : []
  const attendanceByStudent = new Map(attendanceRecords.map(r => [r.studentId, r.status]))

  // Homework due this week, batched across every ward's class in one query then grouped back by class.
  const homeworkRows = classIds.length
    ? await prisma.homework.findMany({
      where: { schoolId: ctx.schoolId, classSubject: { classId: { in: classIds } }, dueDate: { gte: weekStart, lte: weekEnd } },
      include: homeworkInclude,
      orderBy: [{ dueDate: 'asc' }],
    })
    : []
  const homeworkByClass = new Map<string, typeof homeworkRows>()
  for (const h of homeworkRows) homeworkByClass.set(h.classSubject.classId, [...(homeworkByClass.get(h.classSubject.classId) ?? []), h])

  // Fee due — reuses fees/service.ts#listInvoices (the same parent-facing GET /api/fees/invoices?studentId=
  // logic/scoping), one call per ward, then sums serializeInvoice's balance across non-Waived invoices.
  const invoicesByWard = await Promise.all(wardIds.map(async id => {
    const { items } = await listInvoices(ctx, { studentId: id })
    return [id, items.map(serializeInvoice)] as const
  }))
  const invoicesByStudent = new Map(invoicesByWard)

  // Calendar — one call, scoped by calendar/service.ts#listEvents to every ward's class at once (parent
  // role there already unions wardClassIds across all wards) — exactly "relevant to any ward's class".
  const events = await listEvents(ctx, { from: today })
  const upcomingEvents = events.slice(0, 3)

  const wards = await Promise.all(students.map(async s => {
    const enr = enrByStudent.get(s.id)
    const classId = enr?.classId
    const classLabel = enr ? `${enr.class.grade.label}-${enr.class.section}` : undefined

    const attendanceStatus = attendanceByStudent.get(s.id) ?? null

    const wardHomework = classId ? (homeworkByClass.get(classId) ?? []) : []
    const homeworkDueThisWeek = wardHomework.map(h => ({
      id: h.id, title: h.title, subjectName: h.classSubject.subject.name, dueDate: fmtDate(h.dueDate),
      submitted: h.submissions.some(sub => sub.studentId === s.id),
    }))

    const invoices = invoicesByStudent.get(s.id) ?? []
    const payable = invoices.filter(i => i.status !== 'Waived')
    const feeDue = { total: payable.reduce((a, i) => a + i.balance, 0), invoiceCount: payable.length }

    // Syllabus pace (Phase 18) for this ward's core subjects only (CurriculumSubject.kind === 'core').
    let syllabusPace: WardSummary['syllabusPace'] = []
    if (enr) {
      const curriculumSubjects = await prisma.curriculumSubject.findMany({
        where: { schoolId: ctx.schoolId, boardId: enr.class.boardId, gradeId: enr.class.gradeId, streamId: enr.class.streamId, kind: 'core' },
        select: { subjectId: true },
      })
      if (curriculumSubjects.length) {
        const classSubjects = await prisma.classSubject.findMany({
          where: { schoolId: ctx.schoolId, classId: enr.classId, subjectId: { in: curriculumSubjects.map(c => c.subjectId) } },
          include: { subject: true },
        })
        // computePace() throws HttpError(400) when the school has no `isCurrent` term set — a syllabus
        // data-setup issue, not a reason to 500 this read-only aggregation endpoint. Caught per subject so
        // one misconfigured subject doesn't blank out the rest of the family summary.
        const paced = await Promise.all(classSubjects.map(async cs => {
          try {
            const pace = await computePace(ctx, cs.id, {})
            return {
              classSubjectId: cs.id, subjectId: cs.subjectId, subjectName: cs.subject.name,
              paceDeltaChapters: pace.paceDeltaChapters, headline: paceHeadline(pace.paceDeltaChapters),
            }
          } catch {
            return null
          }
        }))
        syllabusPace = paced.filter((p): p is NonNullable<typeof p> => p !== null)
      }
    }

    return {
      studentId: s.id, name: s.name, classId, classLabel,
      attendanceToday: { status: attendanceStatus, marked: attendanceStatus !== null },
      homeworkDueThisWeek, feeDue, syllabusPace,
    }
  }))

  return { generatedAt: new Date().toISOString(), wards, upcomingEvents }
}

// ─────────────────────────── item 2: daily "my child today" digest ───────────────────────────
//
// No cron/scheduler infrastructure exists anywhere in this codebase (grepped for node-cron/agenda/bull/
// setInterval-based jobs — none found; the one precedent, hr/service.ts#deactivateIfPastLastWorkingDate,
// is an "opportunistic sweep on next login" pattern, not a scheduler, and doesn't fit a once-a-day push).
// Per the phase spec, this is built as a well-tested, callable function (sendDigestToParent /
// sendAllDigests) plus a manual-trigger endpoint (POST /api/parents/digest/send-now, admin/superadmin).
//
// PRODUCTION NOTE: nothing in this repo calls sendAllDigests on a timer. Real daily delivery needs an
// external scheduler — a system/hosting-platform cron (e.g. `0 7 * * *`) hitting
// POST /api/parents/digest/send-now with an admin/superadmin bearer token, or a `node-cron` addition to
// src/index.ts if this ever runs as a long-lived single process. That wiring is intentionally NOT faked
// here — see phase-23-parent-experience.md item 2.

// One notification per parent per day: `ParentDigestSend` (parentId, digestDate) is unique, so a second
// call for the same parent on the same calendar day is a no-op (not an error) — safe to call repeatedly
// (e.g. a retried cron run) without double-sending.
export async function sendDigestToParent(ctx: Ctx, parentId: string): Promise<{ parentId: string; sent: boolean; reason?: string }> {
  const digestDate = fmtDate(new Date())
  const already = await prisma.parentDigestSend.findUnique({ where: { parentId_digestDate: { parentId, digestDate } } })
  if (already) return { parentId, sent: false, reason: 'already-sent-today' }

  const parent = await prisma.user.findFirst({ where: { id: parentId, schoolId: ctx.schoolId, role: 'parent' } })
  if (!parent) throw notFound('Parent')

  // familySummary() requires ctx.role === 'parent' and scopes via visibleStudentIds(ctx.actorId) — a
  // synthetic per-parent ctx (same schoolId, actorId = this parent) reuses that exact function/scoping
  // rather than re-deriving ward ids here.
  const parentCtx: Ctx = { schoolId: ctx.schoolId, actorId: parentId, role: 'parent' }
  const summary = await familySummary(parentCtx)
  if (!summary.wards.length) return { parentId, sent: false, reason: 'no-wards' }

  const title = 'Your daily Edkonic digest'
  const body = summary.wards.map(w => {
    const att = w.attendanceToday.status ?? 'not yet marked'
    const hw = w.homeworkDueThisWeek.length
    const feeNote = w.feeDue.total > 0 ? `, ₹${w.feeDue.total} fee due` : ''
    return `${w.name}${w.classLabel ? ` (${w.classLabel})` : ''}: attendance ${att}, ${hw} homework item${hw === 1 ? '' : 's'} due this week${feeNote}.`
  }).join('\n')

  // Push + in-app (Phase 23 item 2) — notify() already best-effort fans out to web push (lib/notify.ts).
  await notify(ctx.schoolId, parentId, 'daily-digest', title, body)
  // WhatsApp (Phase 23 item 3) — same best-effort pattern as every other notify.ts call site.
  if (parent.phone) await sendWhatsApp({ to: parent.phone, body: `${title}\n${body}` })

  await prisma.parentDigestSend.create({ data: { schoolId: ctx.schoolId, parentId, digestDate } })
  return { parentId, sent: true }
}

// POST /api/parents/digest/send-now — sends (or skips, if already sent today) the digest to every parent
// in the caller's school who has at least one ward. Manual/testing trigger; see production note above.
export async function sendAllDigests(ctx: Ctx) {
  const parents = await prisma.user.findMany({ where: { schoolId: ctx.schoolId, role: 'parent' }, select: { id: true } })
  const results = await Promise.all(parents.map(p =>
    sendDigestToParent(ctx, p.id).catch(err => ({ parentId: p.id, sent: false, reason: err instanceof Error ? err.message : String(err) })),
  ))
  return { total: results.length, sent: results.filter(r => r.sent).length, skipped: results.filter(r => !r.sent).length, results }
}
