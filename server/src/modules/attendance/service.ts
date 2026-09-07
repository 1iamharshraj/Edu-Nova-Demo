import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { fmtDate, toDate } from '../../lib/validate'
import { assertOnRoster, assertViewClass, assertViewStudent, assertWriteClass, enrollmentFor, getClass, getTerm, isAdmin, isStaff, rosterOf, visibleStudentIds } from '../../lib/scope'
import type { createSession, patchRecords, sessionsQuery, summaryQuery, staffBody, staffQuery, staffSummaryQuery } from './schema'

// ───────────────────────────── shapes ─────────────────────────────

export const sessionInclude = { records: { orderBy: { studentId: 'asc' } } } satisfies Prisma.AttendanceSessionInclude
type SessionFull = Prisma.AttendanceSessionGetPayload<{ include: typeof sessionInclude }>

export const serializeRecord = (r: { id: string; studentId: string; status: string; note: string | null }) => ({
  id: r.id, studentId: r.studentId, status: r.status, note: r.note ?? undefined,
})

export const serializeSession = (s: SessionFull, onlyStudents?: string[] | null) => ({
  id: s.id,
  classId: s.classId,
  date: fmtDate(s.date),
  periodIdx: s.periodIdx ?? undefined,
  markedById: s.markedById ?? undefined,
  lockedAt: s.lockedAt?.toISOString(),
  records: s.records.filter(r => !onlyStudents || onlyStudents.includes(r.studentId)).map(serializeRecord),
})

// P and L count as present; H (holiday) is outside the denominator.
const COUNTED = new Set(['P', 'A', 'L', 'E'])
const PRESENT = new Set(['P', 'L'])
const pctOf = (present: number, total: number) => (total ? Math.round((present / total) * 1000) / 10 : 0)

async function getSession(ctx: Ctx, id: string) {
  const row = await prisma.attendanceSession.findFirst({ where: { id, schoolId: ctx.schoolId }, include: sessionInclude })
  if (!row) throw notFound('Attendance session')
  return row
}

function assertUnlocked(ctx: Ctx, s: { lockedAt: Date | null }) {
  if (s.lockedAt && !isAdmin(ctx)) throw new HttpError(403, 'This session is locked — ask an admin to unlock it')
}

// ───────────────────────────── sessions ─────────────────────────────

// GET /sessions?classId&from&to — students/parents get only their own records back.
export async function listSessions(ctx: Ctx, q: z.infer<typeof sessionsQuery>) {
  await getClass(ctx, q.classId)
  await assertViewClass(ctx, q.classId)
  const only = await visibleStudentIds(ctx)
  const rows = await prisma.attendanceSession.findMany({
    where: { classId: q.classId, date: { gte: q.from ? toDate(q.from) : undefined, lte: q.to ? toDate(q.to) : undefined } },
    include: sessionInclude,
    orderBy: [{ date: 'asc' }, { periodIdx: 'asc' }],
  })
  return rows.map(s => serializeSession(s, only))
}

// POST /sessions — creates the (classId, date, periodIdx) session or REPLACES its records.
export async function upsertSession(ctx: Ctx, input: z.infer<typeof createSession>) {
  const cls = await getClass(ctx, input.classId)
  await assertWriteClass(ctx, cls.id)
  const periodIdx = input.periodIdx ?? null
  const date = toDate(input.date)
  const ids = input.records.map(r => r.studentId)
  if (new Set(ids).size !== ids.length) throw new HttpError(400, 'Duplicate studentId in records')
  await assertOnRoster(cls.id, ids)

  // NULL is distinct in the unique index, so look the day session up by hand.
  const existing = await prisma.attendanceSession.findFirst({ where: { classId: cls.id, date, periodIdx }, include: sessionInclude })
  if (existing) assertUnlocked(ctx, existing)

  const row = await prisma.$transaction(async tx => {
    const session = existing
      ? await tx.attendanceSession.update({ where: { id: existing.id }, data: { markedById: ctx.actorId } })
      : await tx.attendanceSession.create({ data: { schoolId: ctx.schoolId, classId: cls.id, date, periodIdx, markedById: ctx.actorId } })
    if (existing) await tx.attendanceRecord.deleteMany({ where: { sessionId: session.id } })
    if (input.records.length) {
      await tx.attendanceRecord.createMany({ data: input.records.map(r => ({ sessionId: session.id, studentId: r.studentId, status: r.status, note: r.note ?? null })) })
    }
    return tx.attendanceSession.findUniqueOrThrow({ where: { id: session.id }, include: sessionInclude })
  })
  await audit(ctx.schoolId, ctx.actorId, existing ? 'replace' : 'create', 'attendanceSession', row.id, existing ? serializeSession(existing) : undefined, serializeSession(row))
  return { row, created: !existing }
}

// PATCH /sessions/:id/records — partial upsert.
export async function patchSessionRecords(ctx: Ctx, id: string, input: z.infer<typeof patchRecords>) {
  const before = await getSession(ctx, id)
  await assertWriteClass(ctx, before.classId)
  assertUnlocked(ctx, before)
  await assertOnRoster(before.classId, input.records.map(r => r.studentId))
  await prisma.$transaction(async tx => {
    for (const r of input.records) {
      await tx.attendanceRecord.upsert({
        where: { sessionId_studentId: { sessionId: id, studentId: r.studentId } },
        create: { sessionId: id, studentId: r.studentId, status: r.status, note: r.note ?? null },
        update: { status: r.status, note: r.note === undefined ? undefined : r.note },
      })
    }
    await tx.attendanceSession.update({ where: { id }, data: { markedById: ctx.actorId } })
  })
  const row = await getSession(ctx, id)
  await audit(ctx.schoolId, ctx.actorId, 'patch-records', 'attendanceSession', id, serializeSession(before), serializeSession(row))
  return row
}

export async function setLocked(ctx: Ctx, id: string, locked: boolean) {
  const before = await getSession(ctx, id)
  if (locked) await assertWriteClass(ctx, before.classId)
  else if (!isAdmin(ctx)) throw new HttpError(403, 'Only an admin can unlock a session')
  const row = await prisma.attendanceSession.update({ where: { id }, data: { lockedAt: locked ? new Date() : null }, include: sessionInclude })
  await audit(ctx.schoolId, ctx.actorId, locked ? 'lock' : 'unlock', 'attendanceSession', id, { lockedAt: before.lockedAt }, { lockedAt: row.lockedAt })
  return row
}

export async function removeSession(ctx: Ctx, id: string) {
  const before = await getSession(ctx, id)
  await prisma.attendanceSession.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'attendanceSession', id, serializeSession(before))
}

// ───────────────────────────── summary ─────────────────────────────

const weekdayOf = (d: Date) => d.getUTCDay() // 0 Sun … 6 Sat; timetable dayOfWeek is 1 Mon … 6 Sat

// GET /summary?studentId&termId | ?classId&termId
export async function summary(ctx: Ctx, q: z.infer<typeof summaryQuery>) {
  const term = await getTerm(ctx, q.termId)
  return q.studentId ? studentSummary(ctx, q.studentId, term) : classSummary(ctx, q.classId!, term)
}

type Term = Awaited<ReturnType<typeof getTerm>>

async function studentSummary(ctx: Ctx, studentId: string, term: Term) {
  await assertViewStudent(ctx, studentId)
  const student = await prisma.user.findFirst({ where: { id: studentId, schoolId: ctx.schoolId, role: 'student' }, select: { id: true, name: true } })
  if (!student) throw notFound('Student')
  const enrollment = await enrollmentFor(studentId, term.academicYearId)

  const records = await prisma.attendanceRecord.findMany({
    where: { studentId, session: { schoolId: ctx.schoolId, date: { gte: term.startDate, lte: term.endDate } } },
    include: { session: { select: { id: true, classId: true, date: true, periodIdx: true, lockedAt: true } } },
    orderBy: [{ session: { date: 'asc' } }, { session: { periodIdx: 'asc' } }],
  })

  let present = 0, total = 0
  const byDate = new Map<string, { day?: string; periods: string[] }>()
  for (const r of records) {
    if (COUNTED.has(r.status)) { total++; if (PRESENT.has(r.status)) present++ }
    const key = fmtDate(r.session.date)
    const slot = byDate.get(key) ?? { periods: [] }
    if (r.session.periodIdx === null) slot.day = r.status
    else slot.periods.push(r.status)
    byDate.set(key, slot)
  }
  // Day status: the day session if one exists, else derived from the period sessions of that date.
  const days = [...byDate.entries()].map(([date, s]) => ({
    date,
    status: s.day ?? (s.periods.every(p => p === 'A') ? 'A' : s.periods.every(p => p === 'H') ? 'H' : s.periods.some(p => PRESENT.has(p)) ? (s.periods.includes('L') && !s.periods.includes('P') ? 'L' : 'P') : s.periods[0]),
  }))

  // bySubject: period sessions → the timetable entry for (class, term, weekday, period) → subject.
  const periodRecords = records.filter(r => r.session.periodIdx !== null)
  let bySubject: { subjectId: string; subject: string; present: number; total: number; pct: number }[] | undefined
  if (periodRecords.length) {
    const entries = await prisma.timetableEntry.findMany({
      where: { schoolId: ctx.schoolId, termId: term.id, classId: { in: [...new Set(periodRecords.map(r => r.session.classId))] } },
      include: { classSubject: { include: { subject: true } } },
    })
    if (entries.length) {
      const bySlot = new Map(entries.map(e => [`${e.classId}|${e.dayOfWeek}|${e.periodIdx}`, e]))
      const acc = new Map<string, { subjectId: string; subject: string; present: number; total: number }>()
      for (const r of periodRecords) {
        if (!COUNTED.has(r.status)) continue
        const e = bySlot.get(`${r.session.classId}|${weekdayOf(r.session.date)}|${r.session.periodIdx}`)
        if (!e) continue
        const s = acc.get(e.classSubject.subjectId) ?? { subjectId: e.classSubject.subjectId, subject: e.classSubject.subject.name, present: 0, total: 0 }
        s.total++; if (PRESENT.has(r.status)) s.present++
        acc.set(e.classSubject.subjectId, s)
      }
      bySubject = [...acc.values()].map(s => ({ ...s, pct: pctOf(s.present, s.total) }))
    }
  }

  return {
    studentId, name: student.name, termId: term.id,
    classId: enrollment?.classId, classLabel: enrollment ? `${enrollment.class.grade.label}-${enrollment.class.section}` : undefined,
    overall: { present, total, pct: pctOf(present, total) },
    days,
    bySubject,
  }
}

async function classSummary(ctx: Ctx, classId: string, term: Term) {
  const cls = await getClass(ctx, classId)
  await assertViewClass(ctx, cls.id)
  const only = await visibleStudentIds(ctx)
  const roster = (await rosterOf(cls.id)).filter(s => !only || only.includes(s.id))
  const sessions = await prisma.attendanceSession.findMany({
    where: { classId: cls.id, date: { gte: term.startDate, lte: term.endDate } },
    include: sessionInclude,
    orderBy: [{ date: 'asc' }, { periodIdx: 'asc' }],
  })
  const per = new Map(roster.map(s => [s.id, { studentId: s.id, name: s.name, rollNo: s.rollNo, present: 0, total: 0 }]))
  const days = new Map<string, { date: string; present: number; total: number; sessions: number; locked: boolean }>()
  let present = 0, total = 0
  for (const s of sessions) {
    const key = fmtDate(s.date)
    const d = days.get(key) ?? { date: key, present: 0, total: 0, sessions: 0, locked: true }
    d.sessions++; d.locked = d.locked && !!s.lockedAt
    for (const r of s.records) {
      const p = per.get(r.studentId)
      if (!p || !COUNTED.has(r.status)) continue
      const hit = PRESENT.has(r.status) ? 1 : 0
      p.total++; p.present += hit; d.total++; d.present += hit; total++; present += hit
    }
    days.set(key, d)
  }
  return {
    classId: cls.id, classLabel: `${cls.grade.label}-${cls.section}`, termId: term.id,
    overall: { present, total, pct: pctOf(present, total) },
    days: [...days.values()].map(d => ({ ...d, pct: pctOf(d.present, d.total) })),
    students: [...per.values()].map(p => ({ ...p, pct: pctOf(p.present, p.total) })),
  }
}

// ───────────────────────────── staff attendance ─────────────────────────────

const STAFF_LIKE = ['teacher', 'staff', 'admin', 'superadmin']

export const serializeStaff = (r: { id: string; userId: string; date: Date; status: string; markedById: string | null }) => ({
  id: r.id, userId: r.userId, date: fmtDate(r.date), status: r.status, markedById: r.markedById ?? undefined,
})

// GET /staff?date — staff/admin see everyone; a teacher sees only their own rows.
export async function listStaff(ctx: Ctx, q: z.infer<typeof staffQuery>) {
  if (!isStaff(ctx) && ctx.role !== 'teacher') throw new HttpError(403, 'Forbidden')
  return prisma.staffAttendance.findMany({
    where: { schoolId: ctx.schoolId, date: q.date ? toDate(q.date) : undefined, userId: isStaff(ctx) ? undefined : ctx.actorId },
    orderBy: [{ date: 'desc' }, { createdAt: 'asc' }],
  })
}

export async function markStaff(ctx: Ctx, input: z.infer<typeof staffBody>) {
  const user = await prisma.user.findFirst({ where: { id: input.userId, schoolId: ctx.schoolId } })
  if (!user) throw notFound('User')
  if (!STAFF_LIKE.includes(user.role)) throw new HttpError(400, 'userId must reference a teacher or staff member')
  const date = toDate(input.date)
  const before = await prisma.staffAttendance.findUnique({ where: { userId_date: { userId: user.id, date } } })
  const row = await prisma.staffAttendance.upsert({
    where: { userId_date: { userId: user.id, date } },
    create: { schoolId: ctx.schoolId, userId: user.id, date, status: input.status, markedById: ctx.actorId },
    update: { status: input.status, markedById: ctx.actorId },
  })
  await audit(ctx.schoolId, ctx.actorId, before ? 'update' : 'create', 'staffAttendance', row.id, before ? serializeStaff(before) : undefined, serializeStaff(row))
  return row
}

// GET /staff/summary?userId&from&to — a teacher/staff member may ask for themselves; admin/staff anyone.
export async function staffSummary(ctx: Ctx, q: z.infer<typeof staffSummaryQuery>) {
  if (!isStaff(ctx) && ctx.actorId !== q.userId) throw new HttpError(403, 'You can only view your own attendance')
  const user = await prisma.user.findFirst({ where: { id: q.userId, schoolId: ctx.schoolId }, select: { id: true, name: true } })
  if (!user) throw notFound('User')
  const rows = await prisma.staffAttendance.findMany({
    where: { userId: user.id, date: { gte: q.from ? toDate(q.from) : undefined, lte: q.to ? toDate(q.to) : undefined } },
    orderBy: { date: 'asc' },
  })
  const counted = rows.filter(r => r.status !== 'H')
  const present = counted.filter(r => PRESENT.has(r.status)).length
  return {
    userId: user.id, name: user.name,
    overall: { present, total: counted.length, pct: pctOf(present, counted.length) },
    days: rows.map(r => ({ date: fmtDate(r.date), status: r.status })),
  }
}
