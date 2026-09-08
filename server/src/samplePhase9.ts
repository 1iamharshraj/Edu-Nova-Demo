import type { Prisma } from '@prisma/client'

// Phase 9 demo data (event highlights, one example AI tutor conversation). Runs inside the same
// transaction as loadSampleData, after users/classes/subjects already exist. See
// phase-9-10-integrations-hardening.md → Sample data.
//
// Kept minimal per spec: a couple of highlights, one AI conversation for a seeded student with one
// example exchange. No fake push subscriptions (can't be faked meaningfully).

type Tx = Prisma.TransactionClient

export interface Phase9Args {
  schoolId: string
  classIds: Map<string, string>
  userId: (seedId: string) => string
}

export async function loadPhase9(tx: Tx, a: Phase9Args) {
  const { schoolId } = a
  const uid = a.userId
  const cls = (label: string) => a.classIds.get(label)!

  // ── event highlights ──
  await tx.highlight.create({
    data: {
      schoolId, title: 'Annual Day 2026 — Highlights Reel', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      audience: 'School', publishedAt: new Date('2026-02-10T00:00:00.000Z'), createdById: uid('u-a'),
    },
  })
  await tx.highlight.create({
    data: {
      schoolId, title: 'X-A Science Exhibition — Project Walkthroughs', url: 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz',
      audience: 'Class', classId: cls('X-A'), publishedAt: new Date('2026-03-05T00:00:00.000Z'), createdById: uid('u-t'),
    },
  })

  // ── one example AI tutor conversation for Aarav (u-s), scoped to Mathematics ──
  const conversation = await tx.aiConversation.create({
    data: { schoolId, studentId: uid('u-s'), subjectId: 'math', title: 'Quadratic equations doubt' },
  })
  await tx.aiMessage.create({
    data: { conversationId: conversation.id, role: 'user', content: 'How do I know if a quadratic equation has real roots?' },
  })
  await tx.aiMessage.create({
    data: {
      conversationId: conversation.id, role: 'assistant',
      content: 'Look at the discriminant, D = b² − 4ac, from ax² + bx + c = 0. If D > 0 there are two distinct real roots, if D = 0 there is one repeated real root, and if D < 0 the roots are complex (not real). Try it on 2x² − 4x + 1: D = 16 − 8 = 8, which is > 0, so this one has two real roots.',
    },
  })
}
