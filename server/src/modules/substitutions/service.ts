import { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { toDate } from '../../lib/validate'
import { assertTeacher } from '../classes/service'
import type { Conflict } from '../timetable/service'
import { classLabel, entryInclude, serializeSubstitution, substitutionInclude } from '../timetable/shared'
import { createSubstitution, substitutionQuery } from './schema'

// JS getUTCDay(): 0 = Sunday … 6 = Saturday; the timetable uses 1 = Monday … 6 = Saturday.
const weekdayOf = (d: Date) => d.getUTCDay()

// GET /substitutions?date&teacherId&classId — teacherId matches either the substitute or the covered teacher.
export function list(ctx: Ctx, filter: z.infer<typeof substitutionQuery> = {}) {
  return prisma.substitution.findMany({
    where: {
      schoolId: ctx.schoolId,
      date: filter.date ? toDate(filter.date) : undefined,
      timetableEntry: filter.classId ? { classId: filter.classId } : undefined,
      ...(filter.teacherId ? { OR: [{ substituteTeacherId: filter.teacherId }, { timetableEntry: { teacherId: filter.teacherId } }] } : {}),
    },
    include: substitutionInclude,
    orderBy: [{ date: 'asc' }, { timetableEntry: { periodIdx: 'asc' } }, { createdAt: 'asc' }],
  })
}

async function get(ctx: Ctx, id: string) {
  const row = await prisma.substitution.findFirst({ where: { id, schoolId: ctx.schoolId }, include: substitutionInclude })
  if (!row) throw notFound('Substitution')
  return row
}

export async function create(ctx: Ctx, input: z.infer<typeof createSubstitution>) {
  const entry = await prisma.timetableEntry.findFirst({ where: { id: input.timetableEntryId, schoolId: ctx.schoolId }, include: entryInclude })
  if (!entry) throw notFound('Timetable entry')
  await assertTeacher(ctx, input.substituteTeacherId)
  if (input.substituteTeacherId === entry.teacherId) throw new HttpError(400, 'Substitute must differ from the entry’s own teacher')

  const date = toDate(input.date)
  if (weekdayOf(date) !== entry.dayOfWeek) throw new HttpError(400, `${input.date} is not on the entry’s weekday (day ${entry.dayOfWeek})`)

  const dup = await prisma.substitution.findUnique({ where: { timetableEntryId_date: { timetableEntryId: entry.id, date } } })
  if (dup) throw new HttpError(409, 'A substitution already exists for this entry on that date', { substitutionId: dup.id })

  // The substitute must be free at that slot: no regular period of their own, and no other cover that day.
  const conflicts: Conflict[] = []
  const own = await prisma.timetableEntry.findFirst({
    where: { schoolId: ctx.schoolId, termId: entry.termId, dayOfWeek: entry.dayOfWeek, periodIdx: entry.periodIdx, teacherId: input.substituteTeacherId },
    include: { class: { include: { grade: true } } },
  })
  if (own) conflicts.push({ rule: 'teacher', entryId: own.id, classId: own.classId, classLabel: classLabel(own.class), dayOfWeek: own.dayOfWeek, periodIdx: own.periodIdx, teacherId: input.substituteTeacherId })
  const cover = await prisma.substitution.findFirst({
    where: { schoolId: ctx.schoolId, date, substituteTeacherId: input.substituteTeacherId, timetableEntry: { dayOfWeek: entry.dayOfWeek, periodIdx: entry.periodIdx } },
    include: { timetableEntry: { include: { class: { include: { grade: true } } } } },
  })
  if (cover) {
    const e = cover.timetableEntry
    conflicts.push({ rule: 'teacher', entryId: e.id, classId: e.classId, classLabel: classLabel(e.class), dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx, teacherId: input.substituteTeacherId })
  }
  if (conflicts.length) throw new HttpError(409, 'Substitute teacher is not free at that period', undefined, { conflicts })

  const row = await prisma.substitution.create({
    data: { schoolId: ctx.schoolId, timetableEntryId: entry.id, date, substituteTeacherId: input.substituteTeacherId, reason: input.reason ?? null },
    include: substitutionInclude,
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'substitution', row.id, undefined, serializeSubstitution(row))
  return row
}

export async function remove(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  await prisma.substitution.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'substitution', id, serializeSubstitution(before))
}
