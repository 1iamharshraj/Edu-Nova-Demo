import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../auth'
import { wrap } from '../lib/errors'
import { ctxOf } from '../lib/rbac'
import { yearsRouter } from './years/router'
import { termsRouter } from './terms/router'
import { boardsRouter } from './boards/router'
import { gradesRouter } from './grades/router'
import { streamsRouter } from './streams/router'
import { curriculumRouter } from './curriculum/router'
import { classesRouter } from './classes/router'
import { subjectsRouter } from './subjects/router'
import { classSubjectsRouter } from './classSubjects/router'
import { roomsRouter } from './rooms/router'
import { enrollmentsRouter } from './enrollments/router'
import { guardiansRouter } from './guardians/router'
import { cohortsRouter } from './cohorts/router'
import { capabilitiesRouter } from './capabilities/router'
import { teacherQualificationsRouter } from './teacherQualifications/router'
import * as years from './years/service'
import * as terms from './terms/service'
import * as boards from './boards/service'
import * as grades from './grades/service'
import * as streams from './streams/service'
import * as curriculum from './curriculum/service'
import * as classes from './classes/service'
import * as subjects from './subjects/service'
import * as classSubjects from './classSubjects/service'
import * as rooms from './rooms/service'
import * as enrollments from './enrollments/service'
import * as guardians from './guardians/service'
import * as periodTemplates from './periodTemplates/service'
import * as cohorts from './cohorts/service'
import * as capabilities from './capabilities/service'
import * as teacherQualifications from './teacherQualifications/service'

// Everything under /api/academic. Reads: any authenticated role; writes gated per router.
export const academicRouter = Router()
academicRouter.use(requireAuth)

// Returns the full AcademicState for the school (see contract + phase-1b + phase-2).
academicRouter.get('/bootstrap', wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  const [y, t, b, gr, st, cu, c, s, cs, r, e, g, pt, co, cap, tq] = await Promise.all([
    years.list(ctx), terms.list(ctx), boards.list(ctx), grades.list(ctx), streams.list(ctx), curriculum.list(ctx),
    classes.list(ctx), subjects.list(ctx), classSubjects.list(ctx), rooms.list(ctx), enrollments.list(ctx), guardians.list(ctx),
    periodTemplates.list(ctx), cohorts.list(ctx), capabilities.list(ctx), teacherQualifications.list(ctx),
  ])
  res.json({
    years: y.map(years.serializeYear),
    terms: t.map(terms.serializeTerm),
    boards: b.map(boards.serializeBoard),
    grades: gr.map(grades.serializeGrade),
    streams: st.map(streams.serializeStream),
    curriculum: cu.map(curriculum.serializeCurriculum),
    classes: c.map(classes.serializeClass),
    subjects: s.map(subjects.serializeSubject),
    classSubjects: cs.map(classSubjects.serializeClassSubject),
    rooms: r.map(rooms.serializeRoom),
    enrollments: e.map(enrollments.serializeEnrollment),
    guardians: g.map(guardians.serializeGuardian),
    periodTemplates: pt.map(periodTemplates.serializePeriodTemplate),
    // Phase T1 additions — see phase-t1-timetable-foundations.md. Purely additive keys; every field above
    // is unchanged, so an existing frontend that doesn't read these keys sees byte-identical bootstrap data.
    cohorts: co.map(cohorts.serializeCohort),
    capabilities: cap.map(capabilities.serializeCapability),
    teacherQualifications: tq.map(teacherQualifications.serializeTeacherQualification),
  })
}))

academicRouter.use('/years', yearsRouter)
academicRouter.use('/terms', termsRouter)
academicRouter.use('/boards', boardsRouter)
academicRouter.use('/grades', gradesRouter)
academicRouter.use('/streams', streamsRouter)
academicRouter.use('/curriculum', curriculumRouter)
academicRouter.use('/classes', classesRouter)
academicRouter.use('/subjects', subjectsRouter)
academicRouter.use('/class-subjects', classSubjectsRouter)
academicRouter.use('/rooms', roomsRouter)
academicRouter.use('/enrollments', enrollmentsRouter)
academicRouter.use('/guardians', guardiansRouter)
academicRouter.use('/cohorts', cohortsRouter)
academicRouter.use('/capabilities', capabilitiesRouter)
academicRouter.use('/teacher-qualifications', teacherQualificationsRouter)
