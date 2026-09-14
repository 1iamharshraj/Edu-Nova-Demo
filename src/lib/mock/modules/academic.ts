// Mirrors server/src/modules/academic.ts's `/academic/bootstrap` aggregation and
// server/src/routes/data.ts's legacy `/data` endpoint (the only two keys — terms, subjects — that
// route still serves; everything else moved to dedicated routes long ago, same as here).

import { route, requireAuth, crud } from '../router'
import { table, type Row } from '../store'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const short = (m: number) => MONTHS[m].slice(0, 3)

function legacyTerms() {
  return table('Term').map(t => {
    const s = new Date(String(t.startDate)), e = new Date(String(t.endDate))
    const months: string[] = []
    for (let y = s.getUTCFullYear(), m = s.getUTCMonth(); y < e.getUTCFullYear() || (y === e.getUTCFullYear() && m <= e.getUTCMonth()); ) {
      months.push(MONTHS[m])
      if (++m === 12) { m = 0; y++ }
    }
    return { id: t.id, name: t.name, range: `${short(s.getUTCMonth())} – ${short(e.getUTCMonth())} ${e.getUTCFullYear()}`, months, current: t.isCurrent }
  })
}

function legacySubjects() {
  const classSubjects = table('ClassSubject')
  const teachers = table('User')
  return table('Subject').map(s => {
    const teacherIds = [...new Set(classSubjects.filter(cs => cs.subjectId === s.id).map(cs => cs.teacherId))]
    const names = teacherIds.map(id => teachers.find(t => t.id === id)?.name).filter(Boolean)
    return { id: s.id, name: s.name, teacher: names.length ? names.join(', ') : '—', color: s.color }
  })
}

route('GET', '/data', (ctx) => {
  requireAuth(ctx)
  return { data: { terms: legacyTerms(), subjects: legacySubjects() } }
})

function serializeClass(c: Row) {
  const grade = table('Grade').find(g => g.id === c.gradeId)
  const board = table('Board').find(b => b.id === c.boardId)
  const stream = c.streamId ? table('Stream').find(s => s.id === c.streamId) : undefined
  const gradeLabel = grade?.label ?? '?'
  const boardCode = board?.code ?? '?'
  const streamName = stream?.name
  return {
    id: c.id, academicYearId: c.academicYearId, boardId: c.boardId, boardCode,
    gradeId: c.gradeId, grade: gradeLabel, streamId: c.streamId, stream: streamName,
    section: c.section, label: `${gradeLabel}-${c.section}${streamName ? ` (${streamName})` : ''}`,
    classTeacherId: c.classTeacherId, capacity: c.capacity ?? 45, periodTemplateId: c.periodTemplateId,
  }
}

route('GET', '/academic/bootstrap', (ctx) => {
  requireAuth(ctx)
  return {
    years: table('AcademicYear'),
    terms: table('Term').map(t => ({ id: t.id, academicYearId: t.academicYearId, name: t.name, startDate: t.startDate, endDate: t.endDate, isCurrent: t.isCurrent })),
    boards: table('Board').map(b => ({ id: b.id, name: b.name, code: b.code })),
    grades: table('Grade'),
    streams: table('Stream'),
    curriculum: table('CurriculumSubject'),
    classes: table('Class').map(serializeClass),
    subjects: table('Subject').map(s => ({ id: s.id, name: s.name, code: String(s.id).toUpperCase(), color: s.color })),
    classSubjects: table('ClassSubject'),
    rooms: table('Room').map(r => ({ id: r.id, name: r.name, kind: String(r.kind ?? 'classroom').toLowerCase(), capacity: r.capacity, capabilityIds: r.capabilityIds ?? [] })),
    enrollments: table('Enrollment'),
    guardians: table('Guardian'),
    periodTemplates: table('PeriodTemplate'),
    cohorts: table('Cohort').map(c => ({ ...c, classLabels: (c.classIds as string[] | undefined ?? []).map(id => serializeClass(table('Class').find(cl => cl.id === id)!).label) })),
    capabilities: table('Capability'),
    teacherQualifications: table('TeacherQualification'),
  }
})

// Direct CRUD for the sub-resources under /academic/* that don't need bootstrap-style joins.
crud('/academic/classes', 'Class', { serialize: serializeClass, writeRoles: ['admin', 'superadmin'] })
crud('/academic/subjects', 'Subject', { writeRoles: ['admin', 'superadmin'] })
crud('/academic/class-subjects', 'ClassSubject', { writeRoles: ['admin', 'superadmin'] })
crud('/academic/rooms', 'Room', { writeRoles: ['admin', 'superadmin'] })
crud('/academic/enrollments', 'Enrollment', { writeRoles: ['admin', 'superadmin'] })
crud('/academic/guardians', 'Guardian', { writeRoles: ['admin', 'superadmin'] })
crud('/academic/years', 'AcademicYear', { writeRoles: ['admin', 'superadmin'] })
crud('/academic/terms', 'Term', { writeRoles: ['admin', 'superadmin'] })
crud('/academic/boards', 'Board', { writeRoles: ['admin', 'superadmin'] })
crud('/academic/grades', 'Grade', { writeRoles: ['admin', 'superadmin'] })
crud('/academic/streams', 'Stream', { writeRoles: ['admin', 'superadmin'] })
crud('/academic/curriculum', 'CurriculumSubject', { writeRoles: ['admin', 'superadmin'] })
crud('/academic/cohorts', 'Cohort', { writeRoles: ['admin', 'superadmin'] })
crud('/academic/capabilities', 'Capability', { writeRoles: ['admin', 'superadmin'] })
crud('/academic/teacher-qualifications', 'TeacherQualification', { writeRoles: ['admin', 'superadmin'] })
