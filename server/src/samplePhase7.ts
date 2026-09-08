import type { Prisma } from '@prisma/client'

// Phase 7 demo data (feed, conversations/messages, meetings, calendar). Runs inside the same
// transaction as loadSampleData, after users/classes/enrollments already exist. See
// phase-7-communication.md → Sample data.
//
// Deviations from the legacy seed (documented — the legacy shapes don't map 1:1 onto real users):
//  - Feed authors: the legacy feed has posts "by" EduNova School / Science Club / Art Society, which
//    aren't real users. All 5 posts are authored by the admin (u-a); the legacy `tag` becomes the
//    post title so the club/section name isn't lost.
//  - Reaction counts: the legacy `likes` numbers (98–301) don't correspond to real users (~20 seed
//    accounts). A handful of real reactions are seeded per post instead of the literal count.
//  - Meeting m3 ("PTA — mid-term feedback", requested by teacher Meera): the Phase 7 model requires
//    `withUserId` to be a teacher/admin (that's who decides). The legacy seed has no such party — it
//    implicitly targets parent Nisha. Ported with `withUserId` = admin (u-a) instead, status Requested.

type Tx = Prisma.TransactionClient

export interface Phase7Args {
  schoolId: string
  userId: (seedId: string) => string
}

const shortId = (id: string) => id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toLowerCase()
const jitsiLink = (schoolId: string, meetingId: string) =>
  process.env.MEET_PROVIDER === 'none' ? null : `https://meet.jit.si/edunova-${shortId(schoolId)}-${meetingId}`

const FEED_POSTS: { id: string; tag: string; text: string; hoursAgo: number; comments: { by: string; text: string }[]; likes: string[] }[] = [
  { id: 'f1', tag: 'Announcement', text: 'Annual Sports Day 2026 was a blockbuster — 14 records broken, and X-A takes the overall trophy. Full photo album is live.', hoursAgo: 2, comments: [{ by: 'u-s2', text: 'That 4×100 finish was unreal!' }], likes: ['u-s', 'u-p', 'u-t2'] },
  { id: 'f2', tag: 'Club', text: 'Our young astronomers captured the lunar eclipse from the school observatory deck. Swipe through the best shots from the night.', hoursAgo: 24, comments: [], likes: ['u-s2', 'u-t3'] },
  { id: 'f3', tag: 'Exam', text: 'Term 3 examination timetable is published. Hall tickets will be issued through class teachers from Monday.', hoursAgo: 72, comments: [{ by: 'u-p', text: 'Thanks for the early notice!' }], likes: ['u-p2', 'u-t'] },
  { id: 'f4', tag: 'Arts', text: 'Winter exhibition "Chromatic" is now open in the main atrium. 80+ student artworks on display till Friday.', hoursAgo: 120, comments: [], likes: ['u-s3'] },
  { id: 'f5', tag: 'Event', text: 'Founders’ Day celebrations begin at 9 AM this Saturday. Parents are welcome — entry through Gate 2.', hoursAgo: 168, comments: [{ by: 'u-s3', text: 'Choir practice was great today!' }], likes: ['u-s', 'u-s2', 'u-p3'] },
]

// [id, meA, meB, messages: [fromA, text, minutesAgo]]
const CONVERSATIONS: { id: string; a: string; b: string; messages: { from: string; text: string; minutesAgo: number }[] }[] = [
  {
    id: 'th1', a: 'u-p', b: 'u-t',
    messages: [
      { from: 'u-t', text: 'Good evening! Aarav did really well in the mid-term. His algebra is much stronger now.', minutesAgo: 300 },
      { from: 'u-p', text: 'That’s great to hear, thank you! We’ve been practising daily.', minutesAgo: 250 },
      { from: 'u-t', text: 'It shows. Do remind him to revise trigonometry before Friday’s quiz.', minutesAgo: 200 },
    ],
  },
  {
    id: 'th2', a: 'u-p', b: 'u-t2',
    messages: [
      { from: 'u-t2', text: 'Lab records for optics are due this Thursday.', minutesAgo: 400 },
      { from: 'u-p', text: 'Noted, he’ll submit it on time.', minutesAgo: 380 },
    ],
  },
  {
    id: 'th4', a: 'u-t', b: 'u-t2',
    messages: [
      { from: 'u-t2', text: 'Hi Meera, can we swap the X-A and X-B Physics slots on Friday?', minutesAgo: 500 },
      { from: 'u-t', text: 'Sure, that works for me. I’ll update the timetable note.', minutesAgo: 480 },
    ],
  },
  {
    id: 'th5', a: 'u-t', b: 'u-t3',
    messages: [
      { from: 'u-t3', text: 'The lab equipment for titration practicals has arrived.', minutesAgo: 150 },
      { from: 'u-t', text: 'Great, thanks for the update!', minutesAgo: 120 },
    ],
  },
]

const CAL_EVENTS: { date: string; title: string; type: 'holiday' | 'exam' | 'event'; term: string }[] = [
  { date: '2026-02-14', title: 'Term 3 begins', type: 'event', term: 't3' },
  { date: '2026-02-26', title: 'Science Exhibition', type: 'event', term: 't3' },
  { date: '2026-03-08', title: 'Holi — Holiday', type: 'holiday', term: 't3' },
  { date: '2026-03-18', title: 'Unit Test: Mathematics', type: 'exam', term: 't3' },
  { date: '2026-03-20', title: 'Unit Test: Physics', type: 'exam', term: 't3' },
  { date: '2026-04-02', title: 'Annual Sports Day', type: 'event', term: 't3' },
  { date: '2026-04-14', title: 'Ambedkar Jayanti — Holiday', type: 'holiday', term: 't3' },
  { date: '2026-05-05', title: 'Term 3 Finals begin', type: 'exam', term: 't3' },
  { date: '2025-10-02', title: 'Gandhi Jayanti — Holiday', type: 'holiday', term: 't2' },
  { date: '2025-10-20', title: 'Diwali Break begins', type: 'holiday', term: 't2' },
  { date: '2025-11-10', title: 'Mid Term Exams begin', type: 'exam', term: 't2' },
  { date: '2025-12-24', title: 'Winter Break begins', type: 'holiday', term: 't2' },
  { date: '2025-06-16', title: 'Term 1 begins', type: 'event', term: 't1' },
  { date: '2025-08-15', title: 'Independence Day', type: 'holiday', term: 't1' },
  { date: '2025-09-08', title: 'Unit Test week', type: 'exam', term: 't1' },
]

export async function loadPhase7(tx: Tx, a: Phase7Args) {
  const { schoolId } = a
  const now = Date.now()
  const adminId = a.userId('u-a')

  // ── feed posts ──
  for (const [i, p] of FEED_POSTS.entries()) {
    const publishedAt = new Date(now - p.hoursAgo * 3600_000)
    const post = await tx.post.create({
      data: {
        schoolId, authorId: adminId, audience: 'School', title: p.tag, body: p.text,
        publishedAt, createdAt: publishedAt,
      },
    })
    for (const uid of p.likes) {
      await tx.postReaction.create({ data: { postId: post.id, userId: a.userId(uid) } })
    }
    for (const [ci, c] of p.comments.entries()) {
      await tx.postComment.create({ data: { postId: post.id, authorId: a.userId(c.by), body: c.text, createdAt: new Date(publishedAt.getTime() + (ci + 1) * 60_000) } })
    }
  }

  // ── conversations + messages ──
  for (const c of CONVERSATIONS) {
    const userA = a.userId(c.a)
    const userB = a.userId(c.b)
    const conv = await tx.conversation.create({ data: { schoolId, kind: 'DM', createdById: userA, createdAt: new Date(now - c.messages[0].minutesAgo * 60_000 - 60_000) } })
    await tx.participant.create({ data: { conversationId: conv.id, userId: userA, lastReadAt: new Date() } })
    await tx.participant.create({ data: { conversationId: conv.id, userId: userB, lastReadAt: new Date() } })
    for (const m of c.messages) {
      await tx.message.create({
        data: { conversationId: conv.id, senderId: a.userId(m.from), body: m.text, sentAt: new Date(now - m.minutesAgo * 60_000) },
      })
    }
  }

  // ── meetings m1–m3 ──
  const m1 = await tx.meeting.create({
    data: {
      schoolId, requesterId: a.userId('u-p'), withUserId: a.userId('u-t'), studentId: a.userId('u-s'),
      purpose: 'Discuss Aarav’s Algebra progress', scheduledAt: new Date('2026-04-03T16:00:00.000Z'), durationMin: 30,
      status: 'Scheduled', decidedById: a.userId('u-t'), decidedAt: new Date('2026-04-02T00:00:00.000Z'),
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
    },
  })
  await tx.meeting.update({ where: { id: m1.id }, data: { link: jitsiLink(schoolId, m1.id) } })

  const m2 = await tx.meeting.create({
    data: {
      schoolId, requesterId: a.userId('u-s'), withUserId: a.userId('u-t2'), studentId: a.userId('u-s'),
      purpose: 'Doubt clearing — Physics Optics', scheduledAt: new Date('2026-04-08T15:30:00.000Z'), durationMin: 30,
      status: 'Scheduled', decidedById: a.userId('u-t2'), decidedAt: new Date('2026-04-04T00:00:00.000Z'),
      createdAt: new Date('2026-04-03T00:00:00.000Z'),
    },
  })
  await tx.meeting.update({ where: { id: m2.id }, data: { link: jitsiLink(schoolId, m2.id) } })

  await tx.meeting.create({
    data: {
      schoolId, requesterId: a.userId('u-t'), withUserId: adminId, studentId: a.userId('u-s'),
      purpose: 'PTA — mid-term feedback', scheduledAt: new Date('2026-04-11T10:00:00.000Z'), durationMin: 30,
      status: 'Requested', createdAt: new Date('2026-04-05T00:00:00.000Z'),
    },
  })

  // ── calendar events (all audience School) ──
  for (const e of CAL_EVENTS) {
    await tx.calendarEvent.create({
      data: { schoolId, title: e.title, date: new Date(`${e.date}T00:00:00.000Z`), type: e.type, audience: 'School', termId: e.term, createdById: adminId },
    })
  }
}
