// Mirrors server/src/modules/attendance/{router,service,schema}.ts's contract for
// src/portal/modules/classroom.tsx (Take Attendance) + report/summary consumers. Class-scoped write
// (class teacher for whole-day sessions, the period's subject teacher or a same-day Substitution covering
// teacher for period sessions) mirrors the real T10 fix; students/parents only ever see their own records.

import { route, requireAuth, requireRole, status, type Actor } from '../router'
import { badRequest, forbidden, notFound } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'
import { assertOnRoster, assertViewClass, assertViewStudent, canWriteClassSubject, enrollmentFor, getClass, getTerm, isAdmin, isStaff, rosterOf, visibleStudentIds } from './examsAcademicsScope'

const COUNTED = new Set(['P', 'A', 'L', 'E'])
const PRESENT = new Set(['P', 'L'])
const pctOf = (present: number, total: number) => (total ? Math.round((present / total) * 1000) / 10 : 0)

function serializeRecord(r: Row) {
  return { id: r.id, studentId: r.studentId, status: r.status, note: r.note ?? undefined }
}
function serializeSession(s: Row, onlyStudents?: string[] | null) {
  const records = table('AttendanceRecord').filter(r => r.sessionId === s.id && (!onlyStudents || onlyStudents.includes(r.studentId as string)))
  return { id: s.id, classId: s.classId, date: s.date, periodIdx: s.periodIdx ?? undefined, markedById: s.markedById ?? undefined, lockedAt: s.lockedAt ?? undefined, records: records.map(serializeRecord) }
}

function getSession(schoolId: string, id: string): Row {
  const row = table('AttendanceSession').find(s => s.id === id && s.schoolId === schoolId)
  if (!row) throw notFound('Attendance session')
  return row
}
function assertUnlocked(actor: { role: string }, s: Row) {
  if (s.lockedAt && !isAdmin(actor.role)) throw forbidden('This session is locked — ask an admin to unlock it')
}

// A period session (periodIdx set) maps to a real TimetableEntry -> ClassSubject; a whole-day session
// (periodIdx null) may only be written by the class teacher (or staff/admin) — same split as the real
// T10 fix, including letting a same-day Substitution's covering teacher mark the period they actually taught.
function assertWriteAttendance(actor: Actor, classId: string, date: string, periodIdx: number | null) {
  if (isStaff(actor.role)) return
  if (actor.role !== 'teacher') throw forbidden('You do not teach this class')
  const isClassTeacher = () => table('Class').find(c => c.id === classId)?.classTeacherId === actor.userId
  if (periodIdx === null) {
    if (!isClassTeacher()) throw forbidden('Only the class teacher can mark whole-day attendance for this class')
    return
  }
  const entry = table('TimetableEntry').find(e => e.schoolId === actor.schoolId && e.classId === classId && e.periodIdx === periodIdx && table('Term').find(t => t.id === e.termId && String(t.startDate) <= date && String(t.endDate) >= date))
  if (entry) {
    if (canWriteClassSubject(actor, entry.classSubjectId as string)) return
    const covering = table('Substitution').find(s => s.timetableEntryId === entry.id && s.date === date)
    if (covering?.substituteTeacherId === actor.userId) return
    throw forbidden('You do not teach this subject in this class')
  }
  if (!isClassTeacher()) throw forbidden('You do not teach this class')
}

route('GET', '/attendance/sessions', (ctx) => {
  const actor = requireAuth(ctx)
  const { classId, from, to } = ctx.query
  if (!classId) throw badRequest('classId is required')
  const cls = getClass(actor, classId)
  assertViewClass(actor, cls.id as string)
  const only = visibleStudentIds(actor)
  let rows = table('AttendanceSession').filter(s => s.classId === cls.id)
  if (from) rows = rows.filter(s => String(s.date) >= from)
  if (to) rows = rows.filter(s => String(s.date) <= to)
  rows = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)) || Number(a.periodIdx ?? -1) - Number(b.periodIdx ?? -1))
  return { items: rows.map(s => serializeSession(s, only)) }
})

route('POST', '/attendance/sessions', (ctx) => {
  const actor = requireAuth(ctx)
  const body = ctx.body as { classId?: string; date?: string; periodIdx?: number | null; records?: Array<{ studentId: string; status: string; note?: string | null }> }
  if (!body.classId) throw badRequest('classId is required')
  const cls = getClass(actor, body.classId)
  if (!body.date) throw badRequest('date is required')
  const periodIdx = body.periodIdx ?? null
  assertWriteAttendance(actor, cls.id as string, body.date, periodIdx)
  const records = body.records ?? []
  const ids = records.map(r => r.studentId)
  if (new Set(ids).size !== ids.length) throw badRequest('Duplicate studentId in records')
  assertOnRoster(cls.id as string, ids)

  const existing = table('AttendanceSession').find(s => s.classId === cls.id && s.date === body.date && (s.periodIdx ?? null) === periodIdx)
  if (existing) assertUnlocked(actor, existing)

  const sessions = table('AttendanceSession')
  let session: Row
  if (existing) {
    const idx = sessions.findIndex(s => s.id === existing.id)
    sessions[idx] = { ...sessions[idx], markedById: actor.userId }
    session = sessions[idx]
  } else {
    session = { id: uid('attendancesession'), schoolId: actor.schoolId, classId: cls.id, date: body.date, periodIdx, markedById: actor.userId, lockedAt: undefined, createdAt: nowIso() }
    sessions.push(session)
  }
  saveTable('AttendanceSession', sessions)
  const allRecords = table('AttendanceRecord').filter(r => r.sessionId !== session.id)
  for (const r of records) allRecords.push({ id: uid('attendancerecord'), sessionId: session.id, studentId: r.studentId, status: r.status, note: r.note ?? null } as Row)
  saveTable('AttendanceRecord', allRecords)
  return status(existing ? 200 : 201, { item: serializeSession(session) })
})

route('PATCH', '/attendance/sessions/:id/records', (ctx) => {
  const actor = requireAuth(ctx)
  const before = getSession(actor.schoolId, ctx.params.id)
  assertWriteAttendance(actor, before.classId as string, before.date as string, (before.periodIdx as number | undefined) ?? null)
  assertUnlocked(actor, before)
  const { records } = ctx.body as { records: Array<{ studentId: string; status: string; note?: string | null }> }
  if (!records?.length) throw badRequest('records must have at least one entry')
  assertOnRoster(before.classId as string, records.map(r => r.studentId))
  const rows = table('AttendanceRecord')
  for (const r of records) {
    const idx = rows.findIndex(x => x.sessionId === before.id && x.studentId === r.studentId)
    if (idx === -1) rows.push({ id: uid('attendancerecord'), sessionId: before.id, studentId: r.studentId, status: r.status, note: r.note ?? null } as Row)
    else rows[idx] = { ...rows[idx], status: r.status, note: r.note === undefined ? rows[idx].note : r.note }
  }
  saveTable('AttendanceRecord', rows)
  const sessions = table('AttendanceSession'); const sidx = sessions.findIndex(s => s.id === before.id)
  sessions[sidx] = { ...sessions[sidx], markedById: actor.userId }
  saveTable('AttendanceSession', sessions)
  return { item: serializeSession(sessions[sidx]) }
})

route('POST', '/attendance/sessions/:id/lock', (ctx) => {
  const actor = requireAuth(ctx)
  const before = getSession(actor.schoolId, ctx.params.id)
  assertWriteAttendance(actor, before.classId as string, before.date as string, (before.periodIdx as number | undefined) ?? null)
  const rows = table('AttendanceSession'); const idx = rows.findIndex(s => s.id === before.id)
  rows[idx] = { ...rows[idx], lockedAt: nowIso() }
  saveTable('AttendanceSession', rows)
  return { item: serializeSession(rows[idx]) }
})

route('POST', '/attendance/sessions/:id/unlock', (ctx) => {
  const actor = requireRole(ctx, 'admin', 'superadmin')
  const before = getSession(actor.schoolId, ctx.params.id)
  const rows = table('AttendanceSession'); const idx = rows.findIndex(s => s.id === before.id)
  rows[idx] = { ...rows[idx], lockedAt: undefined }
  saveTable('AttendanceSession', rows)
  return { item: serializeSession(rows[idx]) }
})

route('DELETE', '/attendance/sessions/:id', (ctx) => {
  const actor = requireRole(ctx, 'admin', 'superadmin')
  const before = getSession(actor.schoolId, ctx.params.id)
  const rows = table('AttendanceSession'); const idx = rows.findIndex(s => s.id === before.id)
  rows.splice(idx, 1)
  saveTable('AttendanceSession', rows)
  saveTable('AttendanceRecord', table('AttendanceRecord').filter(r => r.sessionId !== before.id))
  return { ok: true }
})

// ═══════════════════════════ summary ═══════════════════════════

route('GET', '/attendance/summary', (ctx) => {
  const actor = requireAuth(ctx)
  const { termId, studentId, classId } = ctx.query
  if (!termId) throw badRequest('termId is required')
  const term = getTerm(actor, termId)
  if (!!studentId === !!classId) throw badRequest('Provide exactly one of studentId or classId')

  if (studentId) {
    assertViewStudent(actor, studentId)
    const student = table('User').find(u => u.id === studentId && u.role === 'student' && u.schoolId === actor.schoolId)
    if (!student) throw notFound('Student')
    const enrollment = enrollmentFor(studentId, term.academicYearId as string)
    const sessionsAll = table('AttendanceSession').filter(s => s.schoolId === actor.schoolId && String(s.date) >= String(term.startDate) && String(s.date) <= String(term.endDate))
    const sessionById = new Map(sessionsAll.map(s => [s.id, s]))
    const records = table('AttendanceRecord').filter(r => r.studentId === studentId && sessionById.has(r.sessionId as string))
      .map(r => ({ record: r, session: sessionById.get(r.sessionId as string)! }))
      .sort((a, b) => String(a.session.date).localeCompare(String(b.session.date)) || Number(a.session.periodIdx ?? -1) - Number(b.session.periodIdx ?? -1))

    let present = 0, total = 0
    const byDate = new Map<string, { day?: string; periods: string[] }>()
    for (const r of records) {
      const st = r.record.status as string
      if (COUNTED.has(st)) { total++; if (PRESENT.has(st)) present++ }
      const key = String(r.session.date)
      const slot = byDate.get(key) ?? { periods: [] }
      if (r.session.periodIdx == null) slot.day = st
      else slot.periods.push(st)
      byDate.set(key, slot)
    }
    const days = [...byDate.entries()].map(([date, s]) => ({
      date, status: s.day ?? (s.periods.every(p => p === 'A') ? 'A' : s.periods.every(p => p === 'H') ? 'H' : s.periods.some(p => PRESENT.has(p)) ? (s.periods.includes('L') && !s.periods.includes('P') ? 'L' : 'P') : s.periods[0]),
    }))

    const periodRecords = records.filter(r => r.session.periodIdx != null)
    let bySubject: { subjectId: string; subject: string; present: number; total: number; pct: number }[] | undefined
    if (periodRecords.length) {
      const entries = table('TimetableEntry').filter(e => e.schoolId === actor.schoolId && e.termId === term.id)
      const bySlot = new Map(entries.map(e => [`${e.classId}|${e.dayOfWeek}|${e.periodIdx}`, e]))
      const acc = new Map<string, { subjectId: string; subject: string; present: number; total: number }>()
      for (const r of periodRecords) {
        const st = r.record.status as string
        if (!COUNTED.has(st)) continue
        const dow = new Date(`${r.session.date}T00:00:00.000Z`).getUTCDay()
        const e = bySlot.get(`${r.session.classId}|${dow}|${r.session.periodIdx}`)
        if (!e) continue
        const cs = table('ClassSubject').find(c => c.id === e.classSubjectId)
        if (!cs) continue
        const subject = table('Subject').find(su => su.id === cs.subjectId)
        const key = cs.subjectId as string
        const s = acc.get(key) ?? { subjectId: key, subject: (subject?.name as string) ?? key, present: 0, total: 0 }
        s.total++; if (PRESENT.has(st)) s.present++
        acc.set(key, s)
      }
      bySubject = [...acc.values()].map(s => ({ ...s, pct: pctOf(s.present, s.total) }))
    }

    const cls = enrollment ? table('Class').find(c => c.id === enrollment.classId) : undefined
    const grade = cls ? table('Grade').find(g => g.id === cls.gradeId) : undefined
    return {
      studentId, name: student.name, termId: term.id, classId: enrollment?.classId, classLabel: cls ? `${grade?.label ?? '?'}-${cls.section}` : undefined,
      overall: { present, total, pct: pctOf(present, total) }, days, bySubject,
    }
  }

  const cls = getClass(actor, classId!)
  assertViewClass(actor, cls.id as string)
  const only = visibleStudentIds(actor)
  const roster = rosterOf(cls.id as string).filter(s => !only || only.includes(s.id))
  const sessions = table('AttendanceSession').filter(s => s.classId === cls.id && String(s.date) >= String(term.startDate) && String(s.date) <= String(term.endDate))
  const per = new Map(roster.map(s => [s.id, { studentId: s.id, name: s.name, rollNo: s.rollNo, present: 0, total: 0 }]))
  const days = new Map<string, { date: string; present: number; total: number; sessions: number; locked: boolean }>()
  let present = 0, total = 0
  for (const s of sessions) {
    const key = String(s.date)
    const d = days.get(key) ?? { date: key, present: 0, total: 0, sessions: 0, locked: true }
    d.sessions++; d.locked = d.locked && !!s.lockedAt
    for (const r of table('AttendanceRecord').filter(x => x.sessionId === s.id)) {
      const p = per.get(r.studentId as string)
      if (!p || !COUNTED.has(r.status as string)) continue
      const hit = PRESENT.has(r.status as string) ? 1 : 0
      p.total++; p.present += hit; d.total++; d.present += hit; total++; present += hit
    }
    days.set(key, d)
  }
  const grade = table('Grade').find(g => g.id === cls.gradeId)
  return {
    classId: cls.id, classLabel: `${grade?.label ?? '?'}-${cls.section}`, termId: term.id,
    overall: { present, total, pct: pctOf(present, total) },
    days: [...days.values()].map(d => ({ ...d, pct: pctOf(d.present, d.total) })),
    students: [...per.values()].map(p => ({ ...p, pct: pctOf(p.present, p.total) })),
  }
})

// ═══════════════════════════ staff attendance ═══════════════════════════

const STAFF_LIKE = ['teacher', 'staff', 'admin', 'superadmin']

function serializeStaff(r: Row) {
  return { id: r.id, userId: r.userId, date: r.date, status: r.status, markedById: r.markedById ?? undefined }
}

route('GET', '/attendance/staff/summary', (ctx) => {
  const actor = requireAuth(ctx)
  const { userId, from, to } = ctx.query
  if (!userId) throw badRequest('userId is required')
  if (!isStaff(actor.role) && actor.userId !== userId) throw forbidden('You can only view your own attendance')
  const user = table('User').find(u => u.id === userId && u.schoolId === actor.schoolId)
  if (!user) throw notFound('User')
  let rows = table('StaffAttendance').filter(r => r.userId === userId)
  if (from) rows = rows.filter(r => String(r.date) >= from)
  if (to) rows = rows.filter(r => String(r.date) <= to)
  rows = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const counted = rows.filter(r => r.status !== 'H')
  const present = counted.filter(r => PRESENT.has(r.status as string)).length
  return { userId: user.id, name: user.name, overall: { present, total: counted.length, pct: pctOf(present, counted.length) }, days: rows.map(r => ({ date: r.date, status: r.status })) }
})

route('GET', '/attendance/staff', (ctx) => {
  const actor = requireRole(ctx, 'teacher', 'staff', 'admin', 'superadmin')
  const { date } = ctx.query
  let rows = table('StaffAttendance').filter(r => r.schoolId === actor.schoolId)
  if (!isStaff(actor.role)) rows = rows.filter(r => r.userId === actor.userId)
  if (date) rows = rows.filter(r => r.date === date)
  rows = [...rows].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.createdAt).localeCompare(String(b.createdAt)))
  return { items: rows.map(serializeStaff) }
})

route('POST', '/attendance/staff', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const { userId, date, status: st } = ctx.body as { userId?: string; date?: string; status?: string }
  if (!userId || !date || !st) throw badRequest('userId, date and status are required')
  const user = table('User').find(u => u.id === userId && u.schoolId === actor.schoolId)
  if (!user) throw notFound('User')
  if (!STAFF_LIKE.includes(user.role as string)) throw badRequest('userId must reference a teacher or staff member')
  const rows = table('StaffAttendance')
  const idx = rows.findIndex(r => r.userId === userId && r.date === date)
  const row: Row = idx === -1
    ? { id: uid('staffattendance'), schoolId: actor.schoolId, userId, date, status: st, markedById: actor.userId, createdAt: nowIso() }
    : { ...rows[idx], status: st, markedById: actor.userId }
  if (idx === -1) rows.push(row); else rows[idx] = row
  saveTable('StaffAttendance', rows)
  return { item: serializeStaff(row) }
})
