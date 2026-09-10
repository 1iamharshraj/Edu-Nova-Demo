import { prisma } from '../../prisma'
import type { Ctx } from '../../lib/rbac'
import { effectiveTemplate, resolveForDay, serializePeriodTemplate } from '../periodTemplates/service'
import type { UnplacedItem } from './autogen'

// ───────────────────────── Phase T6 §4 — infeasibility diagnostics ─────────────────────────
// See phase-t6-sessions-jobs.md §4. Computed deterministically from the actual constraint model — the real
// numbers already produced by generateForCohorts (T4/T5, unchanged) plus a real capacity count derived from
// each cohort's own effective PeriodTemplate/WorkingDayPattern — never free-text guesswork or an LLM call.

export interface CapacityDiagnostic {
  type: 'CAPACITY_EXCEEDED'
  cohortId: string
  cohortLabel: string
  requiredPeriodsPerWeek: number
  availablePeriodsPerWeek: number
  deficit: number
  suggestedActions: string[]
}

export interface RequirementDiagnostic {
  type: 'REQUIREMENT_UNSATISFIED'
  cohortLabel: string
  subjectName: string | null
  teacherName: string | null
  unplacedPeriods: number
  cause: 'NO_TEACHER_ASSIGNED' | 'TEACHER_BUSY' | 'NO_ROOM_TYPE' | 'ROOM_SHORTAGE' | 'OTHER'
  reason: string
  suggestedActions: string[]
}

export type Diagnostic = CapacityDiagnostic | RequirementDiagnostic

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Real, deterministic weekly-capacity count for one cohort: sum of "class"-kind periods across every
// working day its (first member class's) effective PeriodTemplate resolves to — the exact same source
// solver.ts#generateForCohorts itself schedules into, so "available periods" here is never a guess.
async function cohortWeeklyCapacity(ctx: Ctx, cohort: { academicYearId: string; members: { class: { periodTemplateId: string | null } }[] }): Promise<number> {
  const memberClass = cohort.members[0]?.class
  if (!memberClass) return 0
  const baseTemplate = await effectiveTemplate(ctx.schoolId, memberClass.periodTemplateId)
  if (!baseTemplate) return 0
  const workingDayPattern = await prisma.workingDayPattern.findFirst({ where: { schoolId: ctx.schoolId, academicYearId: cohort.academicYearId } })
  const allowedDayNums = workingDayPattern
    ? new Set((workingDayPattern.workingDays as string[]).map(d => DAY_NAMES.indexOf(d)).filter(n => n >= 1 && n <= 6))
    : new Set([1, 2, 3, 4, 5, 6])
  let total = 0
  for (const day of allowedDayNums) {
    const resolved = await resolveForDay(ctx.schoolId, baseTemplate.id, day)
    if (!resolved) continue
    total += serializePeriodTemplate(resolved).periods.filter(p => p.kind === 'class').length
  }
  return total
}

// Categorizes generateForCohorts' own `reason` string (already derived from real constraint-check outcomes
// — see solver.ts's `reasonParts` construction) into a real cause code + concrete suggested actions. This
// is pattern-matching on OUR OWN deterministic output, not an LLM guessing at natural language.
function classifyUnplaced(u: UnplacedItem): { cause: RequirementDiagnostic['cause']; suggestedActions: string[] } {
  const r = u.reason
  if (/no teacher assigned/i.test(r)) {
    return { cause: 'NO_TEACHER_ASSIGNED', suggestedActions: [`Create a Teaching Assignment for "${u.subjectName}"`, 'Or switch this requirement to POOL/RANDOM/OPTIMIZED assignment mode so the solver resolves one automatically'] }
  }
  if (/no lab-type room exists/i.test(r)) {
    return { cause: 'NO_ROOM_TYPE', suggestedActions: ['Add a Lab-type room under Academic Setup → Rooms', 'Or change this requirement\'s roomRequirement to ANY / turn off labDoubleAllowed'] }
  }
  if (/lab room is booked|required room type is booked/i.test(r)) {
    return { cause: 'ROOM_SHORTAGE', suggestedActions: ['Add another Lab-type room', `Reduce ${u.subjectName ?? 'this subject'}'s periods/week`, 'Spread the requirement across more days (labDoubleAllowed off)'] }
  }
  if (/booked/i.test(r)) {
    return { cause: 'TEACHER_BUSY', suggestedActions: [`Reduce ${u.teacherName ?? 'the teacher'}'s load elsewhere in the timetable`, 'Assign a different teacher (switch to Pool mode)', `Relax ${u.teacherName ?? 'the teacher'}'s NOT_PREFERRED/UNAVAILABLE TeacherAvailability rows`] }
  }
  return { cause: 'OTHER', suggestedActions: ['Review this requirement\'s configuration manually'] }
}

export async function computeDiagnostics(
  ctx: Ctx,
  cohorts: { id: string; name: string; academicYearId: string; members: { class: { periodTemplateId: string | null } }[] }[],
  unplaced: UnplacedItem[],
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = []

  for (const cohort of cohorts) {
    const requirements = await prisma.teachingRequirement.findMany({ where: { schoolId: ctx.schoolId, cohortId: cohort.id } })
    const required = requirements.reduce((a, r) => a + r.requiredPeriodsPerWeek, 0)
    if (!required) continue
    const available = await cohortWeeklyCapacity(ctx, cohort)
    if (required > available) {
      diagnostics.push({
        type: 'CAPACITY_EXCEEDED', cohortId: cohort.id, cohortLabel: cohort.name,
        requiredPeriodsPerWeek: required, availablePeriodsPerWeek: available, deficit: required - available,
        suggestedActions: [
          `Reduce "${cohort.name}"'s total weekly periods by at least ${required - available} (currently ${required}, only ${available} class periods/week exist)`,
          'Allow Saturday teaching (Working Days & Periods) to add more available periods',
          'Add a second period template with more daily periods for this cohort\'s classes',
        ],
      })
    }
  }

  for (const u of unplaced) {
    if (!u.subjectName || !u.remaining) continue // cohort-level structural failures (no template, no classes) are reported as-is by the caller, not double-counted here
    const { cause, suggestedActions } = classifyUnplaced(u)
    diagnostics.push({
      type: 'REQUIREMENT_UNSATISFIED', cohortLabel: u.classLabel, subjectName: u.subjectName, teacherName: u.teacherName,
      unplacedPeriods: u.remaining, cause, reason: u.reason, suggestedActions,
    })
  }

  return diagnostics
}
