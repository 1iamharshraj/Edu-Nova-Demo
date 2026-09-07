import { Prisma, type TimetableEntry, type Substitution } from '@prisma/client'
import { fmtDate } from '../../lib/validate'

// Includes + serializers shared by the timetable and substitutions services.

export const classLabel = (c: { grade: { label: string }; section: string }) => `${c.grade.label}-${c.section}`

export const entryInclude = {
  class: { include: { grade: true } },
  classSubject: { include: { subject: true } },
  room: true,
} satisfies Prisma.TimetableEntryInclude
export type EntryFull = Prisma.TimetableEntryGetPayload<{ include: typeof entryInclude }>

export const substitutionInclude = { timetableEntry: { include: entryInclude } } satisfies Prisma.SubstitutionInclude
export type SubstitutionFull = Prisma.SubstitutionGetPayload<{ include: typeof substitutionInclude }>

export const serializeEntry = (e: TimetableEntry) => ({
  id: e.id,
  classId: e.classId,
  termId: e.termId,
  dayOfWeek: e.dayOfWeek,
  periodIdx: e.periodIdx,
  classSubjectId: e.classSubjectId,
  roomId: e.roomId ?? undefined,
  teacherId: e.teacherId ?? undefined,
})

// Entry plus the display fields the teacher / substitution views need.
export const serializeEntryFull = (e: EntryFull) => ({
  ...serializeEntry(e),
  classLabel: classLabel(e.class),
  subjectId: e.classSubject.subjectId,
  subjectName: e.classSubject.subject.name,
  subjectColor: e.classSubject.subject.color,
  roomName: e.room?.name ?? undefined,
})

export const serializeSubstitution = (s: Substitution) => ({
  id: s.id,
  timetableEntryId: s.timetableEntryId,
  date: fmtDate(s.date),
  substituteTeacherId: s.substituteTeacherId,
  reason: s.reason ?? undefined,
})

export const serializeSubstitutionFull = (s: SubstitutionFull) => ({
  ...serializeSubstitution(s),
  entry: serializeEntryFull(s.timetableEntry),
})
