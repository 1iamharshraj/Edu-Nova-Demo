import type { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import {
  UDISE_MAPPING_VERSION, SCHOOL_PROFILE_MAP, ENROLLMENT_MAP, ENROLLMENT_GAPS,
  TEACHER_MAP, TEACHER_GAPS, FACILITIES_MAP, FACILITIES_GAPS,
} from './udisePlus.mapping'
import type { udiseExportQuery } from './schema'

// See phase-29-india-compliance-offline.md → Part A. This is an ASSISTIVE EXPORT to speed up manual
// UDISE+ form-filling with real school data — it does not submit anything to any government system,
// and the field mapping (udisePlus.mapping.ts) is an unverified best-effort draft. Both facts are
// repeated in every response's `disclaimer` field so the UI can surface them directly, not just bury
// them in code comments.
export const EXPORT_DISCLAIMER =
  'This export accelerates manual UDISE+ form-filling using real school data. It does NOT submit ' +
  'anything to any government system (no such public submission API exists to integrate with). The ' +
  `field mapping (version ${UDISE_MAPPING_VERSION}) is an unverified best-effort draft based on the ` +
  'well-known public shape of UDISE+ — VERIFY every field against the current UDISE+ portal before ' +
  'any real government submission.'

export async function buildUdiseExport(ctx: Ctx, q: z.infer<typeof udiseExportQuery>) {
  const year = await prisma.academicYear.findFirst({ where: { id: q.academicYearId, schoolId: ctx.schoolId } })
  if (!year) throw notFound('Academic year')

  const school = await prisma.school.findFirstOrThrow({ where: { id: ctx.schoolId } })

  // ── Section 1: School Profile ──
  const boards = await prisma.board.findMany({ where: { schoolId: ctx.schoolId }, select: { name: true }, orderBy: { name: 'asc' } })

  // ── Section 2: Enrollment ──
  const enrollments = await prisma.enrollment.findMany({
    where: { schoolId: ctx.schoolId, academicYearId: year.id, status: 'active' },
    select: { class: { select: { gradeId: true, grade: { select: { label: true, order: true } } } } },
  })
  const byGradeMap = new Map<string, { gradeLabel: string; order: number; count: number }>()
  for (const e of enrollments) {
    const key = e.class.gradeId
    const row = byGradeMap.get(key) ?? { gradeLabel: e.class.grade.label, order: e.class.grade.order, count: 0 }
    row.count += 1
    byGradeMap.set(key, row)
  }
  const byGrade = [...byGradeMap.entries()]
    .map(([gradeId, v]) => ({ gradeId, gradeLabel: v.gradeLabel, count: v.count }))
    .sort((a, b) => (byGradeMap.get(a.gradeId)!.order - byGradeMap.get(b.gradeId)!.order))

  // ── Section 3: Teachers ──
  const teachers = await prisma.user.findMany({
    where: { schoolId: ctx.schoolId, role: 'teacher', active: true },
    select: { designation: true },
  })
  const byDesignationMap = new Map<string, number>()
  for (const t of teachers) {
    const key = t.designation?.trim() || 'Unspecified'
    byDesignationMap.set(key, (byDesignationMap.get(key) ?? 0) + 1)
  }
  const byDesignation = [...byDesignationMap.entries()]
    .map(([designation, count]) => ({ designation, count }))
    .sort((a, b) => b.count - a.count)

  // ── Section 4: Facilities ──
  const rooms = await prisma.room.findMany({ where: { schoolId: ctx.schoolId }, select: { kind: true } })
  const byKindMap = new Map<string, number>()
  for (const r of rooms) byKindMap.set(r.kind, (byKindMap.get(r.kind) ?? 0) + 1)
  const byKind = [...byKindMap.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count)

  const result = {
    mappingVersion: UDISE_MAPPING_VERSION,
    disclaimer: EXPORT_DISCLAIMER,
    generatedAt: new Date().toISOString(),
    academicYear: { id: year.id, label: year.label, startDate: year.startDate.toISOString().slice(0, 10), endDate: year.endDate.toISOString().slice(0, 10) },
    schoolProfile: {
      schoolName: { ...SCHOOL_PROFILE_MAP.schoolName, value: school.name },
      affiliationBoards: { ...SCHOOL_PROFILE_MAP.affiliationBoards, value: boards.map(b => b.name) },
      gaps: [SCHOOL_PROFILE_MAP.udiseSchoolCode, SCHOOL_PROFILE_MAP.managementType, SCHOOL_PROFILE_MAP.location],
    },
    enrollment: {
      totalEnrollment: { ...ENROLLMENT_MAP.totalEnrollment, value: enrollments.length },
      byGrade: { ...ENROLLMENT_MAP.byGrade, value: byGrade },
      gaps: [ENROLLMENT_GAPS.gender, ENROLLMENT_GAPS.category],
    },
    teacher: {
      headcount: { ...TEACHER_MAP.teacherHeadcount, value: teachers.length },
      byDesignation: { ...TEACHER_MAP.byDesignation, value: byDesignation },
      gaps: [TEACHER_GAPS.qualification, TEACHER_GAPS.training],
    },
    facilities: {
      totalRooms: { ...FACILITIES_MAP.totalRooms, value: rooms.length },
      byKind: { ...FACILITIES_MAP.byKind, value: byKind },
      gaps: [FACILITIES_GAPS.toilets, FACILITIES_GAPS.drinkingWater, FACILITIES_GAPS.electricity, FACILITIES_GAPS.accessibility],
    },
  }
  return result
}

export type UdiseExport = Awaited<ReturnType<typeof buildUdiseExport>>

// Human-readable "sanity check before you type this into the portal" summary — the plain-language
// counterpart to the structured export above, meant to render directly in an admin's preview screen.
export function summarize(exp: UdiseExport): string[] {
  const lines: string[] = []
  lines.push(`UDISE+ assistive export — mapping version ${exp.mappingVersion} (DRAFT, unverified — see disclaimer)`)
  lines.push(`Academic year: ${exp.academicYear.label} (${exp.academicYear.startDate} to ${exp.academicYear.endDate})`)
  lines.push('')
  lines.push(`School: ${exp.schoolProfile.schoolName.value}`)
  lines.push(`Affiliated board(s): ${(exp.schoolProfile.affiliationBoards.value as string[]).join(', ') || 'none configured'}`)
  lines.push(`  Gaps (fill manually): ${exp.schoolProfile.gaps.map(g => g.udiseLabel).join('; ')}`)
  lines.push('')
  lines.push(`Total enrollment: ${exp.enrollment.totalEnrollment.value}`)
  for (const g of exp.enrollment.byGrade.value as { gradeLabel: string; count: number }[]) {
    lines.push(`  Grade ${g.gradeLabel}: ${g.count}`)
  }
  lines.push(`  Gaps (fill manually): ${exp.enrollment.gaps.map(g => g.udiseLabel).join('; ')}`)
  lines.push('')
  lines.push(`Total teachers: ${exp.teacher.headcount.value}`)
  for (const d of exp.teacher.byDesignation.value as { designation: string; count: number }[]) {
    lines.push(`  ${d.designation}: ${d.count}`)
  }
  lines.push(`  Gaps (fill manually): ${exp.teacher.gaps.map(g => g.udiseLabel).join('; ')}`)
  lines.push('')
  lines.push(`Total rooms: ${exp.facilities.totalRooms.value}`)
  for (const k of exp.facilities.byKind.value as { kind: string; count: number }[]) {
    lines.push(`  ${k.kind}: ${k.count}`)
  }
  lines.push(`  Gaps (fill manually): ${exp.facilities.gaps.map(g => g.udiseLabel).join('; ')}`)
  return lines
}

const csvEscape = (v: unknown) => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Flat CSV: one row per data point (and one per documented gap), suitable for pasting into a
// spreadsheet alongside the government portal while manually re-keying values.
export function toCsv(exp: UdiseExport): string {
  const rows: string[][] = [['section', 'udiseLabel', 'value', 'sourceOrGapNote', 'verified']]
  rows.push(['meta', 'Mapping version', exp.mappingVersion, exp.disclaimer, 'false'])
  rows.push(['schoolProfile', exp.schoolProfile.schoolName.udiseLabel, String(exp.schoolProfile.schoolName.value), exp.schoolProfile.schoolName.sourceNote, 'false'])
  rows.push(['schoolProfile', exp.schoolProfile.affiliationBoards.udiseLabel, (exp.schoolProfile.affiliationBoards.value as string[]).join(' | '), exp.schoolProfile.affiliationBoards.sourceNote, 'false'])
  for (const g of exp.schoolProfile.gaps) rows.push(['schoolProfile (GAP)', g.udiseLabel, '', g.gapNote, 'false'])

  rows.push(['enrollment', exp.enrollment.totalEnrollment.udiseLabel, String(exp.enrollment.totalEnrollment.value), exp.enrollment.totalEnrollment.sourceNote, 'false'])
  for (const g of exp.enrollment.byGrade.value as { gradeLabel: string; count: number }[]) {
    rows.push(['enrollment', `Grade ${g.gradeLabel}`, String(g.count), exp.enrollment.byGrade.sourceNote, 'false'])
  }
  for (const g of exp.enrollment.gaps) rows.push(['enrollment (GAP)', g.udiseLabel, '', g.gapNote, 'false'])

  rows.push(['teacher', exp.teacher.headcount.udiseLabel, String(exp.teacher.headcount.value), exp.teacher.headcount.sourceNote, 'false'])
  for (const d of exp.teacher.byDesignation.value as { designation: string; count: number }[]) {
    rows.push(['teacher', `Designation: ${d.designation}`, String(d.count), exp.teacher.byDesignation.sourceNote, 'false'])
  }
  for (const g of exp.teacher.gaps) rows.push(['teacher (GAP)', g.udiseLabel, '', g.gapNote, 'false'])

  rows.push(['facilities', exp.facilities.totalRooms.udiseLabel, String(exp.facilities.totalRooms.value), exp.facilities.totalRooms.sourceNote, 'false'])
  for (const k of exp.facilities.byKind.value as { kind: string; count: number }[]) {
    rows.push(['facilities', `Room kind: ${k.kind}`, String(k.count), exp.facilities.byKind.sourceNote, 'false'])
  }
  for (const g of exp.facilities.gaps) rows.push(['facilities (GAP)', g.udiseLabel, '', g.gapNote, 'false'])

  return rows.map(r => r.map(csvEscape).join(',')).join('\n')
}

export async function generateAndAudit(ctx: Ctx, q: z.infer<typeof udiseExportQuery>) {
  const exp = await buildUdiseExport(ctx, q)
  await audit(ctx.schoolId, ctx.actorId, 'export', 'udisePlusExport', q.academicYearId, undefined, {
    mappingVersion: exp.mappingVersion, academicYearId: q.academicYearId, format: q.format,
  })
  return exp
}
