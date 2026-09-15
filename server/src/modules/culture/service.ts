import type { z } from 'zod'
import type { HousePoints } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { isStaff, isGuardianOf, isClassTeacherOfStudent, getTerm } from '../../lib/scope'
import { fmtDate } from '../../lib/validate'
import { createPostSvc } from '../feed/service'
import { drawFields, drawFooter, drawHeader, drawTable, fmtLong, renderToBuffer } from '../../lib/pdf'
import type { createHousePoints, leaderboardQuery, ledgerQuery } from './schema'

// See phase-27-culture-engagement.md.
//
// Item 1 — "house" is just an Activity row with kind='house' (see modules/activities). There is no
// separate House model and no houseId field on User/Enrollment: which house a student belongs to is
// resolved elsewhere (activities/service.ts#register) via their Registered ActivityRegistration for that
// Activity. HousePoints is a pure additive ledger — the leaderboard is always a SUM query, never a stored
// running total, so concurrent awards can't race each other.

export const serializeHousePoints = (p: HousePoints) => ({
  id: p.id,
  houseActivityId: p.houseActivityId,
  points: p.points,
  reason: p.reason,
  awardedById: p.awardedById,
  awardedAt: p.awardedAt.toISOString(),
  sourceType: p.sourceType ?? undefined,
  sourceRefId: p.sourceRefId ?? undefined,
})

async function getHouseActivity(ctx: Ctx, id: string) {
  const row = await prisma.activity.findFirst({ where: { id, schoolId: ctx.schoolId, kind: 'house' } })
  if (!row) throw notFound('House')
  return row
}

export async function awardHousePoints(ctx: Ctx, input: z.infer<typeof createHousePoints>) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Only staff/admin may award house points')
  const house = await getHouseActivity(ctx, input.houseActivityId)

  const row = await prisma.housePoints.create({
    data: {
      schoolId: ctx.schoolId, houseActivityId: house.id, points: input.points, reason: input.reason,
      awardedById: ctx.actorId, sourceType: input.sourceType ?? null, sourceRefId: input.sourceRefId ?? null,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'award', 'housePoints', row.id, undefined, serializeHousePoints(row))

  // Feed integration: post a system-visible, school-wide feed item (reusing the same author/audience
  // machinery a staff-authored announcement would use — see modules/feed/service.ts#createPostSvc) so the
  // award is visible without a dedicated leaderboard screen. Never let a feed hiccup fail the award itself.
  const verb = input.points >= 0 ? 'earns' : 'loses'
  const amount = Math.abs(input.points)
  try {
    await createPostSvc(ctx, {
      audience: 'School',
      title: 'House points update',
      body: `${house.title} ${verb} ${amount} point${amount === 1 ? '' : 's'} — ${input.reason}`,
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('house points feed post failed', err)
  }
  return row
}

export async function leaderboard(ctx: Ctx, q: z.infer<typeof leaderboardQuery>) {
  let range: { gte: Date; lte: Date } | undefined
  if (q.termId) {
    const term = await getTerm(ctx, q.termId)
    range = { gte: term.startDate, lte: term.endDate }
  }
  const houses = await prisma.activity.findMany({ where: { schoolId: ctx.schoolId, kind: 'house' }, orderBy: { createdAt: 'asc' } })
  if (!houses.length) return []

  const sums = await prisma.housePoints.groupBy({
    by: ['houseActivityId'],
    where: { schoolId: ctx.schoolId, houseActivityId: { in: houses.map(h => h.id) }, awardedAt: range },
    _sum: { points: true },
  })
  const sumOf = new Map(sums.map(s => [s.houseActivityId, s._sum.points ?? 0]))

  return houses
    .map(h => ({ houseActivityId: h.id, houseName: h.title, points: sumOf.get(h.id) ?? 0 }))
    .sort((a, b) => b.points - a.points)
    .map((row, i) => ({ ...row, rank: i + 1 }))
}

export async function ledger(ctx: Ctx, q: z.infer<typeof ledgerQuery>) {
  const house = await getHouseActivity(ctx, q.houseActivityId)
  const rows = await prisma.housePoints.findMany({ where: { schoolId: ctx.schoolId, houseActivityId: house.id }, orderBy: { awardedAt: 'desc' } })
  return rows.map(serializeHousePoints)
}

// ───────────────────────── item 2 — student digital portfolio ─────────────────────────
// No new model — a read-only aggregation of Achievement (verified only), Certificate, and
// ActivityRegistration history. The student's User row is left untouched by alumni conversion (see
// modules/alumni/service.ts#convertStudent — role stays 'student', active stays true, only the active
// Enrollment ends), so every query here (keyed on userId/studentId, never on an active enrollment) keeps
// resolving identically after a student becomes an alumnus.

async function assertPortfolioAccess(ctx: Ctx, studentId: string) {
  if (isStaff(ctx)) return
  if (ctx.role === 'student' && ctx.actorId === studentId) return
  if (await isGuardianOf(ctx, studentId)) return
  if (await isClassTeacherOfStudent(ctx, studentId)) return
  throw new HttpError(403, 'You cannot view this student’s portfolio')
}

async function studentOf(ctx: Ctx, studentId: string) {
  const student = await prisma.user.findFirst({ where: { id: studentId, schoolId: ctx.schoolId, role: 'student' } })
  if (!student) throw notFound('Student')
  return student
}

async function gatherPortfolio(ctx: Ctx, studentId: string) {
  const student = await studentOf(ctx, studentId)
  await assertPortfolioAccess(ctx, studentId)

  const [achievements, certificates, registrations] = await Promise.all([
    prisma.achievement.findMany({ where: { schoolId: ctx.schoolId, userId: studentId, verifiedAt: { not: null } }, orderBy: { date: 'desc' } }),
    prisma.certificate.findMany({ where: { schoolId: ctx.schoolId, studentId }, orderBy: { issuedAt: 'desc' } }),
    prisma.activityRegistration.findMany({
      where: { userId: studentId, status: { not: 'Cancelled' }, activity: { schoolId: ctx.schoolId } },
      include: { activity: true },
      orderBy: { registeredAt: 'desc' },
    }),
  ])

  const groups = new Map<string, typeof achievements>()
  for (const a of achievements) {
    const list = groups.get(a.category) ?? []
    list.push(a)
    groups.set(a.category, list)
  }

  const years = new Set<number>()
  achievements.forEach(a => years.add(a.date.getUTCFullYear()))
  certificates.forEach(c => years.add(c.issuedAt.getUTCFullYear()))
  registrations.forEach(r => years.add(r.registeredAt.getUTCFullYear()))

  return { student, achievements, certificates, registrations, groups, years }
}

export async function studentPortfolio(ctx: Ctx, studentId: string) {
  const { student, achievements, certificates, registrations, groups, years } = await gatherPortfolio(ctx, studentId)

  return {
    student: { id: student.id, name: student.name },
    summary: { achievements: achievements.length, certificates: certificates.length, activities: registrations.length, years: years.size },
    achievements: [...groups.entries()].map(([category, items]) => ({
      category,
      items: items.map(a => ({ id: a.id, title: a.title, detail: a.detail, date: fmtDate(a.date), verifiedAt: a.verifiedAt!.toISOString() })),
    })),
    certificates: certificates.map(c => ({
      id: c.id, kind: c.kind, serialNo: c.serialNo, issuedAt: c.issuedAt.toISOString(),
      pdfUrl: c.pdfFileId ? `/api/certificates/${c.id}/pdf` : undefined,
    })),
    activityHistory: registrations.map(r => ({
      id: r.id, activityId: r.activityId, kind: r.activity.kind, title: r.activity.title, status: r.status,
      registeredAt: r.registeredAt.toISOString(), year: r.registeredAt.getUTCFullYear(),
    })),
  }
}

export async function portfolioPdf(ctx: Ctx, studentId: string) {
  const { student, achievements, certificates, registrations, groups, years } = await gatherPortfolio(ctx, studentId)
  const school = await prisma.school.findUniqueOrThrow({ where: { id: ctx.schoolId } })
  const now = new Date()

  const bytes = await renderToBuffer(async doc => {
    drawHeader(doc, { schoolName: school.name, title: 'Student Portfolio', subtitle: student.name })
    drawFields(doc, [
      { label: 'Student', value: student.name },
      { label: 'Student id', value: student.id },
      { label: 'Achievements (verified)', value: String(achievements.length) },
      { label: 'Certificates', value: String(certificates.length) },
      { label: 'Activities / clubs / houses', value: String(registrations.length) },
      { label: 'Years covered', value: String(years.size || 1) },
    ])
    doc.moveDown(0.6)

    doc.font('Helvetica-Bold').fontSize(13).fillColor('#111827').text('Verified Achievements')
    doc.moveDown(0.2)
    if (!achievements.length) {
      doc.font('Helvetica').fontSize(10).fillColor('#6b7280').text('No verified achievements on record.')
    } else {
      for (const [category, items] of groups) {
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#374151').text(category)
        drawTable(
          doc,
          [{ label: 'Date', w: 1.4 }, { label: 'Title', w: 3 }, { label: 'Detail', w: 4 }],
          items.map(a => [fmtDate(a.date), a.title, a.detail]),
        )
      }
    }
    doc.moveDown(0.6)

    doc.font('Helvetica-Bold').fontSize(13).fillColor('#111827').text('Certificates')
    doc.moveDown(0.2)
    if (!certificates.length) {
      doc.font('Helvetica').fontSize(10).fillColor('#6b7280').text('No certificates issued.')
    } else {
      drawTable(
        doc,
        [{ label: 'Serial no.', w: 2.6 }, { label: 'Kind', w: 1.6 }, { label: 'Issued', w: 1.4 }],
        certificates.map(c => [c.serialNo, c.kind, fmtLong(c.issuedAt)]),
      )
    }
    doc.moveDown(0.6)

    doc.font('Helvetica-Bold').fontSize(13).fillColor('#111827').text('Activities, Clubs & Houses')
    doc.moveDown(0.2)
    if (!registrations.length) {
      doc.font('Helvetica').fontSize(10).fillColor('#6b7280').text('No activity history on record.')
    } else {
      drawTable(
        doc,
        [{ label: 'Year', w: 1 }, { label: 'Kind', w: 1.4 }, { label: 'Title', w: 3 }, { label: 'Status', w: 1.4 }],
        registrations.map(r => [String(r.registeredAt.getUTCFullYear()), r.activity.kind, r.activity.title, r.status]),
      )
    }

    await drawFooter(doc, { issuedBy: 'Edkonic School Management System', issuedOn: fmtLong(now), qrText: `Edkonic portfolio | ${student.name} | ${student.id}` })
  })

  return { bytes, name: `Portfolio-${student.name.replace(/[^a-z0-9]+/gi, '-')}.pdf` }
}
