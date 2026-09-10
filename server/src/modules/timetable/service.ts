import { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { effectiveTemplate, serializePeriodTemplate } from '../periodTemplates/service'
import { classLabel, entryInclude, serializeEntry, serializeEntryFull, serializeSubstitutionFull, substitutionInclude } from './shared'
import type { entryInput, putEntries, copyBody, publishBody, meQuery } from './schema'

export type EntryInput = z.infer<typeof entryInput>
export const slotKey = (e: { dayOfWeek: number; periodIdx: number }) => `${e.dayOfWeek}:${e.periodIdx}`

const REVIEW_ROLES = ['admin', 'superadmin', 'staff']

// Exported (also used by autogen.ts — the Phase 26 auto-generate draft/commit endpoints reuse these
// exact class/term lookups and the replaceGrid write path rather than duplicating them).
export async function getClass(ctx: Ctx, id: string) {
  const row = await prisma.class.findFirst({ where: { id, schoolId: ctx.schoolId }, include: { grade: true } })
  if (!row) throw notFound('Class')
  return row
}
export type ClassRow = Awaited<ReturnType<typeof getClass>>

export async function getTerm(ctx: Ctx, id: string) {
  const row = await prisma.term.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Term')
  return row
}

export function assertSameYear(cls: ClassRow, term: { id: string; academicYearId: string }) {
  if (cls.academicYearId !== term.academicYearId) throw new HttpError(400, 'Term does not belong to the class’s academic year', { classId: cls.id, termId: term.id })
}

export function listEntries(classId: string, termId: string) {
  return prisma.timetableEntry.findMany({ where: { classId, termId }, orderBy: [{ dayOfWeek: 'asc' }, { periodIdx: 'asc' }] })
}

// ───────────────────────────── conflict validation ─────────────────────────────

export interface Conflict {
  rule: 'teacher' | 'room'
  entryId: string
  classId: string
  classLabel: string
  dayOfWeek: number
  periodIdx: number
  teacherId?: string
  roomId?: string
}

export interface ResolvedEntry { dayOfWeek: number; periodIdx: number; classSubjectId: string; roomId: string | null; teacherId: string | null; sessionId: string | null }

// Applies the four rules from phase-2-timetable.md to a whole class×term grid. Rules 3 (period must be a
// class period of the effective template) and 4 (classSubject belongs to the class) are input errors → 400;
// rules 1 (teacher) and 2 (room) are checked against every other class in the school for that term → 409
// with the structured `conflicts` list. Returns the entries with teacherId defaulted from the ClassSubject.
export async function validateGrid(ctx: Ctx, cls: ClassRow, termId: string, entries: EntryInput[]): Promise<ResolvedEntry[]> {
  const seen = new Set<string>()
  for (const e of entries) {
    const k = slotKey(e)
    if (seen.has(k)) throw new HttpError(400, `Duplicate slot: day ${e.dayOfWeek} period ${e.periodIdx}`)
    seen.add(k)
  }

  const template = await effectiveTemplate(ctx.schoolId, cls.periodTemplateId)
  if (!template) throw new HttpError(400, 'No period template — create one under Academic Setup → Periods first')
  const classIdx = new Set(serializePeriodTemplate(template).periods.filter(p => p.kind === 'class').map(p => p.idx))
  const badIdx = entries.filter(e => !classIdx.has(e.periodIdx))
  if (badIdx.length) {
    throw new HttpError(400, `periodIdx must be a class period of template "${template.name}"`, {
      periodIdx: [...new Set(badIdx.map(b => b.periodIdx))], templateId: template.id,
    })
  }

  const csById = new Map((await prisma.classSubject.findMany({ where: { classId: cls.id } })).map(cs => [cs.id, cs]))
  const badCs = entries.filter(e => !csById.has(e.classSubjectId))
  if (badCs.length) throw new HttpError(400, 'classSubjectId must belong to the class', { classSubjectId: [...new Set(badCs.map(b => b.classSubjectId))] })

  const overrides = [...new Set(entries.map(e => e.teacherId).filter((t): t is string => !!t))]
  if (overrides.length) {
    const found = await prisma.user.count({ where: { id: { in: overrides }, schoolId: ctx.schoolId, role: 'teacher' } })
    if (found !== overrides.length) throw new HttpError(400, 'teacherId must reference a teacher in this school')
  }
  const roomIds = [...new Set(entries.map(e => e.roomId).filter((r): r is string => !!r))]
  if (roomIds.length) {
    const found = await prisma.room.count({ where: { id: { in: roomIds }, schoolId: ctx.schoolId } })
    if (found !== roomIds.length) throw notFound('Room')
  }

  const resolved: ResolvedEntry[] = entries.map(e => ({
    dayOfWeek: e.dayOfWeek,
    periodIdx: e.periodIdx,
    classSubjectId: e.classSubjectId,
    roomId: e.roomId ?? null,
    teacherId: e.teacherId ?? csById.get(e.classSubjectId)!.teacherId ?? null,
    sessionId: e.sessionId ?? null,
  }))

  // This class's own grid is being replaced, so only other classes can clash.
  const others = await prisma.timetableEntry.findMany({
    where: { schoolId: ctx.schoolId, termId, classId: { not: cls.id } },
    include: { class: { include: { grade: true } } },
  })
  const byTeacher = new Map<string, typeof others[number]>()
  const byRoom = new Map<string, typeof others[number]>()
  for (const o of others) {
    if (o.teacherId) byTeacher.set(`${o.teacherId}@${slotKey(o)}`, o)
    if (o.roomId) byRoom.set(`${o.roomId}@${slotKey(o)}`, o)
  }

  // Phase T6 — a SharedSession's own sibling rows (same sessionId, written into a different class by the
  // same materialization call) are never a real conflict: they're the SAME session, deliberately spanning
  // multiple classes (roadmap D3's "12-A + 12-B combined English" example). Every pre-T6 caller leaves
  // e.sessionId/o.sessionId null, so this exemption can never fire for the manual builder or the legacy
  // draft-commit path — their conflict behavior is byte-identical to before this phase.
  const sameSession = (e: ResolvedEntry, o: { sessionId: string | null }) => !!e.sessionId && !!o.sessionId && e.sessionId === o.sessionId

  const conflicts: Conflict[] = []
  for (const e of resolved) {
    const t = e.teacherId ? byTeacher.get(`${e.teacherId}@${slotKey(e)}`) : undefined
    if (t && !sameSession(e, t)) conflicts.push({ rule: 'teacher', entryId: t.id, classId: t.classId, classLabel: classLabel(t.class), dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx, teacherId: e.teacherId! })
    const r = e.roomId ? byRoom.get(`${e.roomId}@${slotKey(e)}`) : undefined
    if (r && !sameSession(e, r)) conflicts.push({ rule: 'room', entryId: r.id, classId: r.classId, classLabel: classLabel(r.class), dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx, roomId: e.roomId! })
  }
  if (conflicts.length) {
    throw new HttpError(409, `${conflicts.length} timetable conflict${conflicts.length === 1 ? '' : 's'}`, undefined, { conflicts })
  }
  return resolved
}

// ───────────────────────────── Phase T7 §2 — enforced publish-immutability ─────────────────────────────
// See phase-t7-versioning-override.md §2. This is the SERVICE-LAYER guard the phase explicitly requires be
// tested by attempting a direct write that bypasses the override system's own fork->edit->publish flow: any
// caller that reaches replaceGrid/removeEntry directly (this app's pre-existing, still-live manual builder
// endpoints — PUT /entries, DELETE /entries/:id) against a class/term currently governed by a PUBLISHED
// TimetableVersion is refused here, unconditionally, regardless of role. The ONLY sanctioned path that ever
// replaces a PUBLISHED version's live rows is versions.ts#publishVersion (superseding it with a NEW
// version) — that function deliberately does not call replaceGrid/removeEntry, so this guard never fires
// for it. See also lib/timetableImmutability.ts for a second, Prisma-client-level guard underneath this one.
export async function assertGridEditable(ctx: Ctx, classId: string, termId: string) {
  const publishedRow = await prisma.timetableEntry.findFirst({
    where: { schoolId: ctx.schoolId, classId, termId, timetableVersion: { status: 'PUBLISHED' } },
    select: { timetableVersionId: true },
  })
  if (publishedRow) {
    throw new HttpError(409, `This class's timetable is governed by PUBLISHED version ${publishedRow.timetableVersionId} and is immutable — fork a modification draft first (POST /timetable/versions/fork), edit it there, then publish`, undefined, { publishedVersionId: publishedRow.timetableVersionId })
  }
}

async function assertEntryEditable(entry: { timetableVersionId: string | null }) {
  if (!entry.timetableVersionId) return
  const version = await prisma.timetableVersion.findUnique({ where: { id: entry.timetableVersionId }, select: { status: true, id: true } })
  if (version?.status === 'PUBLISHED') {
    throw new HttpError(409, `This entry belongs to PUBLISHED version ${version.id} and is immutable — fork a modification draft first (POST /timetable/versions/fork), edit it there, then publish`, undefined, { publishedVersionId: version.id })
  }
}

// ───────────────────────────── writes ─────────────────────────────

// PUT /entries — replaces the class×term grid: deletes slots not in the set, upserts the rest. All-or-nothing.
export async function replaceGrid(ctx: Ctx, input: z.infer<typeof putEntries>) {
  const cls = await getClass(ctx, input.classId)
  const term = await getTerm(ctx, input.termId)
  assertSameYear(cls, term)
  await assertGridEditable(ctx, cls.id, term.id)
  const resolved = await validateGrid(ctx, cls, term.id, input.entries)

  const before = await listEntries(cls.id, term.id)
  const keep = new Set(resolved.map(slotKey))
  const stale = before.filter(b => !keep.has(slotKey(b))).map(b => b.id)
  await prisma.$transaction(async tx => {
    if (stale.length) await tx.timetableEntry.deleteMany({ where: { id: { in: stale } } })
    for (const e of resolved) {
      await tx.timetableEntry.upsert({
        where: { classId_termId_dayOfWeek_periodIdx: { classId: cls.id, termId: term.id, dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx } },
        create: { schoolId: ctx.schoolId, classId: cls.id, termId: term.id, ...e },
        update: { classSubjectId: e.classSubjectId, roomId: e.roomId, teacherId: e.teacherId, sessionId: e.sessionId },
      })
    }
  })
  const after = await listEntries(cls.id, term.id)
  await audit(ctx.schoolId, ctx.actorId, 'replace-grid', 'timetable', `${cls.id}:${term.id}`, { entries: before.length }, { entries: after.length, classId: cls.id, termId: term.id })
  return after
}

export async function removeEntry(ctx: Ctx, id: string) {
  const before = await prisma.timetableEntry.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!before) throw notFound('Timetable entry')
  await assertEntryEditable(before)
  await prisma.timetableEntry.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'timetableEntry', id, serializeEntry(before))
}

// POST /copy — maps source entries onto the target class by subjectId. Target must be empty.
export async function copy(ctx: Ctx, input: z.infer<typeof copyBody>) {
  if (input.fromClassId === input.toClassId && input.fromTermId === input.toTermId) throw new HttpError(400, 'Source and target are the same')
  const [fromClass, fromTerm, toClass, toTerm] = await Promise.all([
    getClass(ctx, input.fromClassId), getTerm(ctx, input.fromTermId), getClass(ctx, input.toClassId), getTerm(ctx, input.toTermId),
  ])
  assertSameYear(toClass, toTerm)

  const source = await prisma.timetableEntry.findMany({
    where: { classId: fromClass.id, termId: fromTerm.id },
    include: { classSubject: { include: { subject: true } } },
    orderBy: [{ dayOfWeek: 'asc' }, { periodIdx: 'asc' }],
  })
  if (!source.length) throw new HttpError(400, 'Source timetable is empty')
  const existing = await prisma.timetableEntry.count({ where: { classId: toClass.id, termId: toTerm.id } })
  if (existing) throw new HttpError(409, 'Target timetable is not empty — clear it first', { entries: existing })

  const targetBySubject = new Map((await prisma.classSubject.findMany({ where: { classId: toClass.id } })).map(cs => [cs.subjectId, cs]))
  const template = await effectiveTemplate(ctx.schoolId, toClass.periodTemplateId)
  if (!template) throw new HttpError(400, 'No period template — create one under Academic Setup → Periods first')
  const classIdx = new Set(serializePeriodTemplate(template).periods.filter(p => p.kind === 'class').map(p => p.idx))

  const skipped: { entryId: string; dayOfWeek: number; periodIdx: number; subjectName: string; reason: string }[] = []
  const entries: EntryInput[] = []
  for (const s of source) {
    const cs = targetBySubject.get(s.classSubject.subjectId)
    const base = { entryId: s.id, dayOfWeek: s.dayOfWeek, periodIdx: s.periodIdx, subjectName: s.classSubject.subject.name }
    if (!cs) { skipped.push({ ...base, reason: 'Subject is not taught in the target class' }); continue }
    if (!classIdx.has(s.periodIdx)) { skipped.push({ ...base, reason: 'Period is not a class period in the target template' }); continue }
    // A per-entry teacher override only travels when the class stays the same (it is class-specific).
    const override = s.teacherId && s.teacherId !== s.classSubject.teacherId && fromClass.id === toClass.id ? s.teacherId : null
    entries.push({ dayOfWeek: s.dayOfWeek, periodIdx: s.periodIdx, classSubjectId: cs.id, roomId: s.roomId, teacherId: override })
  }

  const resolved = await validateGrid(ctx, toClass, toTerm.id, entries)
  await prisma.timetableEntry.createMany({ data: resolved.map(e => ({ schoolId: ctx.schoolId, classId: toClass.id, termId: toTerm.id, ...e })) })
  await audit(ctx.schoolId, ctx.actorId, 'copy', 'timetable', `${toClass.id}:${toTerm.id}`, undefined, { from: `${fromClass.id}:${fromTerm.id}`, copied: resolved.length, skipped: skipped.length })
  return { copied: resolved.length, skipped }
}

export async function publish(ctx: Ctx, input: z.infer<typeof publishBody>) {
  const cls = await getClass(ctx, input.classId)
  const term = await getTerm(ctx, input.termId)
  const where = { classId_termId: { classId: cls.id, termId: term.id } }
  const before = await prisma.timetablePublish.findUnique({ where })
  let publishedAt: Date | undefined
  if (input.published) {
    const row = await prisma.timetablePublish.upsert({
      where,
      create: { schoolId: ctx.schoolId, classId: cls.id, termId: term.id },
      update: { publishedAt: new Date() },
    })
    publishedAt = row.publishedAt
  } else if (before) {
    await prisma.timetablePublish.delete({ where })
  }
  await audit(ctx.schoolId, ctx.actorId, input.published ? 'publish' : 'unpublish', 'timetable', `${cls.id}:${term.id}`, { published: !!before }, { published: input.published })
  return { classId: cls.id, termId: term.id, published: input.published, publishedAt: publishedAt?.toISOString() }
}

// ───────────────────────────── reads ─────────────────────────────

// Students see a class only if enrolled in it; parents only if one of their wards is.
async function canView(ctx: Ctx, classId: string) {
  if (ctx.role === 'student') return !!(await prisma.enrollment.findFirst({ where: { classId, studentId: ctx.actorId } }))
  if (ctx.role === 'parent') return !!(await prisma.enrollment.findFirst({ where: { classId, student: { guardianLinks: { some: { parentId: ctx.actorId } } } } }))
  return true
}

// GET /?classId&termId
export async function getGrid(ctx: Ctx, classId: string, termId: string) {
  const cls = await getClass(ctx, classId)
  const term = await getTerm(ctx, termId)
  if (!(await canView(ctx, cls.id))) throw new HttpError(403, 'You are not enrolled in this class')
  const restricted = ctx.role === 'student' || ctx.role === 'parent'
  const [template, pub] = await Promise.all([
    effectiveTemplate(ctx.schoolId, cls.periodTemplateId),
    prisma.timetablePublish.findUnique({ where: { classId_termId: { classId: cls.id, termId: term.id } } }),
  ])
  const entries = restricted && !pub ? [] : await listEntries(cls.id, term.id)
  return {
    classId: cls.id,
    classLabel: classLabel(cls),
    termId: term.id,
    template: template ? serializePeriodTemplate(template) : null,
    entries: entries.map(serializeEntry),
    published: !!pub,
    publishedAt: pub?.publishedAt.toISOString(),
  }
}

// GET /teacher/:userId?termId — a teacher's periods across classes plus substitutions touching them.
export async function teacherView(ctx: Ctx, userId: string, termId: string) {
  if (!REVIEW_ROLES.includes(ctx.role) && ctx.actorId !== userId) throw new HttpError(403, 'You can only view your own timetable')
  const term = await getTerm(ctx, termId)
  const user = await prisma.user.findFirst({ where: { id: userId, schoolId: ctx.schoolId }, select: { id: true, name: true } })
  if (!user) throw notFound('User')
  const [entries, publishes, substitutions] = await Promise.all([
    prisma.timetableEntry.findMany({ where: { schoolId: ctx.schoolId, termId: term.id, teacherId: user.id }, include: entryInclude, orderBy: [{ dayOfWeek: 'asc' }, { periodIdx: 'asc' }] }),
    prisma.timetablePublish.findMany({ where: { schoolId: ctx.schoolId, termId: term.id }, select: { classId: true } }),
    prisma.substitution.findMany({
      where: { schoolId: ctx.schoolId, timetableEntry: { termId: term.id }, OR: [{ substituteTeacherId: user.id }, { timetableEntry: { teacherId: user.id } }] },
      include: substitutionInclude,
      orderBy: [{ date: 'asc' }, { timetableEntry: { periodIdx: 'asc' } }],
    }),
  ])
  const published = new Set(publishes.map(p => p.classId))
  return {
    userId: user.id,
    termId: term.id,
    entries: entries.map(e => ({ ...serializeEntryFull(e), published: published.has(e.classId) })),
    substitutions: substitutions.map(serializeSubstitutionFull),
  }
}

// GET /me?termId&studentId — resolves the caller: student → own class, parent → a ward, teacher → own periods.
export async function me(ctx: Ctx, query: z.infer<typeof meQuery>) {
  const term = await getTerm(ctx, query.termId)
  if (ctx.role === 'teacher') return { kind: 'teacher' as const, ...(await teacherView(ctx, ctx.actorId, term.id)) }

  let studentId: string
  if (ctx.role === 'student') {
    studentId = ctx.actorId
  } else if (ctx.role === 'parent') {
    const wards = await prisma.guardian.findMany({ where: { parentId: ctx.actorId }, orderBy: { createdAt: 'asc' }, select: { studentId: true } })
    if (!wards.length) throw new HttpError(404, 'No wards linked to this account')
    studentId = query.studentId ?? wards[0].studentId
    if (!wards.some(w => w.studentId === studentId)) throw new HttpError(403, 'That student is not your ward')
  } else {
    if (!query.studentId) throw new HttpError(400, 'studentId is required for this role (or use GET /timetable?classId&termId)')
    studentId = query.studentId
  }

  const enrollment = await prisma.enrollment.findFirst({
    where: { studentId, academicYearId: term.academicYearId, status: 'active' },
    orderBy: { createdAt: 'desc' },
  })
  if (!enrollment) return { kind: 'student' as const, studentId, termId: term.id, classId: undefined, classLabel: undefined, template: null, entries: [], published: false, publishedAt: undefined }
  return { kind: 'student' as const, studentId, ...(await getGrid(ctx, enrollment.classId, term.id)) }
}
