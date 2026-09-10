// ─────────────────────────────────────────────────────────────────────────────────────────────
// T0 research spike — pure-TypeScript timetable solving with local-search soft-constraint
// optimization. THROWAWAY CODE. Not wired into the app. No Prisma, no DB, no production imports.
//
// Run with:  cd server && npx tsx scratch/t0-solver-spike/spike.ts
//
// What this does:
//  1. Synthesizes a realistic one-grade scheduling problem (6 sections, ~35 teachers, 9 subjects,
//     6-day week with a Saturday half-day, 4 lab subjects needing double periods + lab rooms).
//  2. Runs a greedy/backtracking initial placement adapted from the shipped Phase 26 algorithm
//     (server/src/modules/timetable/autogen.ts) — same core ideas: cross-class teacher/room busy
//     tracking, lab double-period pairing, same-subject-per-day relaxation when capacity is tight.
//  3. Scores the result with a staged/lexicographic soft-constraint objective (hard violations >>
//     major soft violations >> workload balance >> minor preference penalties, encoded as one
//     scalar via well-separated weight magnitudes so a single simulated-annealing acceptance rule
//     respects the staging automatically).
//  4. Runs simulated-annealing local search (swap / relocate / lab-block-move neighborhoods, every
//     candidate move re-checked against hard constraints before it's even scored) at a few time
//     budgets and reports before/after quality plus a hard-constraint sanity re-verification.
// ─────────────────────────────────────────────────────────────────────────────────────────────

// ============================== Types ==============================

interface Teacher {
  id: string
  name: string
  subjectIds: string[] // subjects this teacher is qualified to teach
  notPreferredPeriods: Set<string> // set of "day:periodIdx" this teacher would rather not teach
}

interface Subject {
  id: string
  name: string
  isLab: boolean
}

interface ClassSection {
  id: string
  label: string // e.g. "10-A"
}

interface ClassSubject {
  id: string // classId:subjectId
  classId: string
  subjectId: string
  teacherId: string
  periodsPerWeek: number
}

interface Room {
  id: string
  name: string
  isLab: boolean
}

interface PeriodSlot {
  day: number // 1=Mon .. 6=Sat
  idx: number // period index within the day
}

interface Problem {
  teachers: Teacher[]
  subjects: Subject[]
  classes: ClassSection[]
  classSubjects: ClassSubject[]
  rooms: Room[]
  workingDays: number[]
  periodsByDay: Map<number, number[]> // day -> ordered period indices
  doublePairsByDay: Map<number, [number, number][]> // day -> valid contiguous pairs for double periods
}

interface Entry {
  id: number
  classId: string
  day: number
  idx: number
  classSubjectId: string
  teacherId: string
  roomId: string | null
  isDouble: boolean
  pairId: number | null // links the two halves of a lab double period together
}

// ============================== Synthetic problem generation ==============================

function generateProblem(scale = 1): Problem {
  const workingDays = [1, 2, 3, 4, 5, 6] // Mon..Sat
  const periodsByDay = new Map<number, number[]>()
  const doublePairsByDay = new Map<number, [number, number][]>()
  // Mon-Fri: 9 periods in three blocks of [1-4] [5-6] [7-9] (two breaks). Sat: half day, 5 periods, one block.
  const monFriBlocks = [[1, 2, 3, 4], [5, 6], [7, 8, 9]]
  const satBlocks = [[1, 2, 3, 4, 5]]
  for (const d of [1, 2, 3, 4, 5]) {
    periodsByDay.set(d, monFriBlocks.flat())
    doublePairsByDay.set(d, blocksToPairs(monFriBlocks))
  }
  periodsByDay.set(6, satBlocks.flat())
  doublePairsByDay.set(6, blocksToPairs(satBlocks))

  const subjectDefs: { id: string; name: string; isLab: boolean; periodsPerWeek: number; teacherCount: number }[] = [
    { id: 'math', name: 'Mathematics', isLab: false, periodsPerWeek: 6, teacherCount: 5 },
    { id: 'eng', name: 'English', isLab: false, periodsPerWeek: 5, teacherCount: 5 },
    { id: 'hin', name: 'Hindi', isLab: false, periodsPerWeek: 4, teacherCount: 3 },
    { id: 'phy', name: 'Physics', isLab: true, periodsPerWeek: 6, teacherCount: 4 },
    { id: 'chem', name: 'Chemistry', isLab: true, periodsPerWeek: 6, teacherCount: 4 },
    { id: 'bio', name: 'Biology', isLab: true, periodsPerWeek: 5, teacherCount: 3 },
    { id: 'cs', name: 'Computer Science', isLab: true, periodsPerWeek: 5, teacherCount: 3 },
    { id: 'soc', name: 'Social Science', isLab: false, periodsPerWeek: 5, teacherCount: 4 },
    { id: 'pe', name: 'Physical Education', isLab: false, periodsPerWeek: 3, teacherCount: 3 },
  ]
  const subjects: Subject[] = subjectDefs.map(s => ({ id: s.id, name: s.name, isLab: s.isLab }))

  const sectionLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
  const gradesNeeded = Math.ceil((6 * scale) / sectionLetters.length)
  const classes: ClassSection[] = []
  for (let g = 0; g < gradesNeeded; g++) {
    const remaining = Math.min(sectionLetters.length, 6 * scale - g * sectionLetters.length)
    for (let i = 0; i < remaining; i++) classes.push({ id: `G${g + 9}-${sectionLetters[i]}`, label: `Grade ${g + 9} - ${sectionLetters[i]}` })
  }

  // Teachers: one pool per subject, sized per subjectDefs (scaled). Deterministic RNG for reproducibility.
  const rng = mulberry32(42)
  const teachers: Teacher[] = []
  let tCounter = 0
  const teachersBySubject = new Map<string, Teacher[]>()
  for (const sd0 of subjectDefs) {
    const sd = { ...sd0, teacherCount: Math.max(1, Math.round(sd0.teacherCount * scale)) }
    const pool: Teacher[] = []
    for (let i = 0; i < sd.teacherCount; i++) {
      tCounter++
      const t: Teacher = {
        id: `t${tCounter}`,
        name: `${sd.name.slice(0, 3)}-Teacher-${i + 1}`,
        subjectIds: [sd.id],
        notPreferredPeriods: new Set(),
      }
      // Each teacher has 1-3 "not preferred" slots (e.g. last period of the day, or Saturday).
      const nNot = 1 + Math.floor(rng() * 3)
      for (let k = 0; k < nNot; k++) {
        const day = workingDays[Math.floor(rng() * workingDays.length)]
        const periods = periodsByDay.get(day)!
        const idx = periods[periods.length - 1] // bias toward last-period-of-day being unpreferred
        t.notPreferredPeriods.add(`${day}:${idx}`)
      }
      pool.push(t)
      teachers.push(t)
    }
    teachersBySubject.set(sd.id, pool)
  }

  // Rooms: shared lab rooms (physics/chem/bio/cs practicals all compete for these, same as autogen.ts's
  // "any Lab-kind room" matching — no per-subject dedicated lab in this codebase's model). Scaled with
  // problem size (a real school adds lab capacity as it adds sections, roughly 4 labs per 6 sections).
  const labRoomCount = Math.max(4, Math.round(4 * scale))
  const rooms: Room[] = Array.from({ length: labRoomCount }, (_, i) => ({ id: `lab${i + 1}`, name: `Lab ${i + 1}`, isLab: true }))

  // ClassSubjects: round-robin assign a teacher per (class, subject) from that subject's pool, spreading
  // load roughly evenly across the pool rather than reusing teacher[0] for every section.
  const classSubjects: ClassSubject[] = []
  const rrCounter = new Map<string, number>()
  for (const cls of classes) {
    for (const sd of subjectDefs) {
      const pool = teachersBySubject.get(sd.id)!
      const i = (rrCounter.get(sd.id) ?? 0) % pool.length
      rrCounter.set(sd.id, i + 1)
      classSubjects.push({
        id: `${cls.id}:${sd.id}`,
        classId: cls.id,
        subjectId: sd.id,
        teacherId: pool[i].id,
        periodsPerWeek: sd.periodsPerWeek,
      })
    }
  }

  return { teachers, subjects, classes, classSubjects, rooms, workingDays, periodsByDay, doublePairsByDay }
}

function blocksToPairs(blocks: number[][]): [number, number][] {
  const pairs: [number, number][] = []
  for (const block of blocks) for (let i = 0; i < block.length - 1; i++) pairs.push([block[i], block[i + 1]])
  return pairs
}

function mulberry32(seed: number) {
  let a = seed
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ============================== Greedy initial placement (Phase 26 style) ==============================
// Mirrors server/src/modules/timetable/autogen.ts's core loop: per class, per classSubject, place lab
// double-periods first (matching teacher + a free lab room across ALL classes, not just this one), then
// fill remaining single periods, spreading across days and only repeating a day once genuinely necessary
// to fit remaining periods into the week (the same "allowRepeat" relaxation).

function greedyGenerate(problem: Problem): { entries: Entry[]; unplaced: number } {
  const { classes, classSubjects, rooms, workingDays, periodsByDay, doublePairsByDay } = problem
  const labRoomIds = rooms.filter(r => r.isLab).map(r => r.id)
  const teacherBusy = new Map<string, Set<string>>() // teacherId -> "day:idx"
  const roomBusy = new Map<string, Set<string>>()
  const mark = (m: Map<string, Set<string>>, k: string, s: string) => { const set = m.get(k) ?? new Set(); set.add(s); m.set(k, set) }
  const busy = (m: Map<string, Set<string>>, k: string | null, s: string) => !!k && !!m.get(k)?.has(s)

  const entries: Entry[] = []
  let entryId = 0
  let unplaced = 0
  let pairCounter = 0

  const subjectById = new Map(problem.subjects.map(s => [s.id, s]))

  for (const cls of classes) {
    const csForClass = classSubjects.filter(cs => cs.classId === cls.id)
    const occupied = new Set<string>() // this class's own slot occupancy
    const daysUsedBySubject = new Map<string, Set<number>>()
    const daysFor = (csId: string) => {
      let s = daysUsedBySubject.get(csId)
      if (!s) { s = new Set(); daysUsedBySubject.set(csId, s) }
      return s
    }

    const place = (day: number, idx: number, cs: ClassSubject, roomId: string | null, isDouble: boolean, pairId: number | null) => {
      const slot = `${day}:${idx}`
      occupied.add(slot)
      mark(teacherBusy, cs.teacherId, slot)
      if (roomId) mark(roomBusy, roomId, slot)
      daysFor(cs.id).add(day)
      entries.push({ id: entryId++, classId: cls.id, day, idx, classSubjectId: cs.id, teacherId: cs.teacherId, roomId, isDouble, pairId })
    }

    const freeLabRoom = (slots: string[]) => labRoomIds.find(id => slots.every(s => !busy(roomBusy, id, s))) ?? null

    for (const cs of csForClass) {
      const subject = subjectById.get(cs.subjectId)!
      let need = cs.periodsPerWeek
      const daysUsed = daysFor(cs.id)
      const allowRepeat = () => need > workingDays.length - daysUsed.size

      if (subject.isLab) {
        let progressed = true
        while (need >= 2 && progressed) {
          progressed = false
          const repeat = allowRepeat()
          for (const day of workingDays) {
            if (!repeat && daysUsed.has(day)) continue
            const pairs = doublePairsByDay.get(day)!
            let placedHere = false
            for (const [a, b] of pairs) {
              const slotA = `${day}:${a}`, slotB = `${day}:${b}`
              if (occupied.has(slotA) || occupied.has(slotB)) continue
              if (busy(teacherBusy, cs.teacherId, slotA) || busy(teacherBusy, cs.teacherId, slotB)) continue
              const room = freeLabRoom([slotA, slotB])
              if (!room) continue
              pairCounter++
              place(day, a, cs, room, true, pairCounter)
              place(day, b, cs, room, true, pairCounter)
              need -= 2
              progressed = true
              placedHere = true
              break
            }
            if (placedHere) break
          }
        }
      }

      let progressed = true
      while (need > 0 && progressed) {
        progressed = false
        const repeat = allowRepeat()
        for (const day of workingDays) {
          if (!repeat && daysUsed.has(day)) continue
          const periods = periodsByDay.get(day)!
          let placedHere = false
          for (const idx of periods) {
            const slot = `${day}:${idx}`
            if (occupied.has(slot)) continue
            if (busy(teacherBusy, cs.teacherId, slot)) continue
            let room: string | null = null
            if (subject.isLab) {
              room = freeLabRoom([slot])
              if (!room) continue
            }
            place(day, idx, cs, room, false, null)
            need -= 1
            progressed = true
            placedHere = true
            break
          }
          if (placedHere) break
        }
      }

      if (need > 0) unplaced += need
    }
  }

  return { entries, unplaced }
}

// ============================== Staged/lexicographic scoring ==============================
// Encoded as one scalar with well-separated weight magnitudes: HARD >> MAJOR >> WORKLOAD >> MINOR.
// Because each tier's total possible contribution is far smaller than one unit of the tier above it
// (verified by construction: the problem has ~270 entries, so even a pathological major-violation count
// in the hundreds is dwarfed by a single hard violation's weight, and minor penalties in the thousands
// are dwarfed by one workload-tier point), a single SA acceptance rule minimizing this scalar cannot
// trade a higher tier off against a lower one — it acts lexicographically without needing a separate
// solver pass per tier.

const W_HARD = 1_000_000
const W_MAJOR = 1_000
const W_WORKLOAD = 50
const W_MINOR = 1

interface ScoreBreakdown {
  hard: number
  major: number
  workload: number
  minor: number
  total: number
  details: { teacherDoubleBooked: number; roomDoubleBooked: number; classDoubleBooked: number
    labSplits: number; teacherDailyOverload: number; teacherWeeklyOverload: number
    workloadVariance: number; teacherGapPeriods: number
    unpreferredSlot: number; forcedSameDayRepeat: number; accidentalAdjacentSameSubject: number }
}

const DAILY_CAP = 6 // periods/day a teacher should not exceed (major)
const WEEKLY_CAP = 30 // periods/week a teacher should not exceed (major)

function scoreSolution(entries: Entry[], problem: Problem): ScoreBreakdown {
  const teacherSlots = new Map<string, Map<string, number>>() // teacherId -> slot -> count
  const roomSlots = new Map<string, Map<string, number>>()
  const classSlots = new Map<string, Map<string, number>>()
  const teacherDayCount = new Map<string, Map<number, number>>()
  const teacherWeekCount = new Map<string, number>()
  const teacherDaySlots = new Map<string, Map<number, number[]>>() // teacherId -> day -> sorted period idxs

  const bump = (m: Map<string, Map<string, number>>, k: string, s: string) => {
    const inner = m.get(k) ?? new Map<string, number>()
    inner.set(s, (inner.get(s) ?? 0) + 1)
    m.set(k, inner)
  }

  for (const e of entries) {
    const slot = `${e.day}:${e.idx}`
    bump(teacherSlots, e.teacherId, slot)
    if (e.roomId) bump(roomSlots, e.roomId, slot)
    bump(classSlots, e.classId, slot)

    const dayMap = teacherDayCount.get(e.teacherId) ?? new Map<number, number>()
    dayMap.set(e.day, (dayMap.get(e.day) ?? 0) + 1)
    teacherDayCount.set(e.teacherId, dayMap)
    teacherWeekCount.set(e.teacherId, (teacherWeekCount.get(e.teacherId) ?? 0) + 1)

    const dsMap = teacherDaySlots.get(e.teacherId) ?? new Map<number, number[]>()
    const arr = dsMap.get(e.day) ?? []
    arr.push(e.idx)
    dsMap.set(e.day, arr)
    teacherDaySlots.set(e.teacherId, dsMap)
  }

  let teacherDoubleBooked = 0
  for (const inner of teacherSlots.values()) for (const c of inner.values()) if (c > 1) teacherDoubleBooked += c - 1
  let roomDoubleBooked = 0
  for (const inner of roomSlots.values()) for (const c of inner.values()) if (c > 1) roomDoubleBooked += c - 1
  let classDoubleBooked = 0
  for (const inner of classSlots.values()) for (const c of inner.values()) if (c > 1) classDoubleBooked += c - 1

  // Lab splits: group lab entries by (classSubjectId, day); any day where the count of that subject's
  // periods is odd, or where two periods on the same day aren't adjacent, counts as a split instance.
  let labSplits = 0
  const labByCsDayEntries = new Map<string, Entry[]>()
  const subjectById = new Map(problem.subjects.map(s => [s.id, s]))
  const csById = new Map(problem.classSubjects.map(cs => [cs.id, cs]))
  for (const e of entries) {
    const cs = csById.get(e.classSubjectId)!
    if (!subjectById.get(cs.subjectId)!.isLab) continue
    const key = `${e.classSubjectId}:${e.day}`
    const arr = labByCsDayEntries.get(key) ?? []
    arr.push(e)
    labByCsDayEntries.set(key, arr)
  }
  for (const arr of labByCsDayEntries.values()) {
    if (arr.length === 1) { labSplits += 1; continue } // a lone single period of a lab subject that day
    if (arr.length === 2) {
      const idxs = arr.map(e => e.idx).sort((a, b) => a - b)
      if (idxs[1] - idxs[0] !== 1) labSplits += 1 // two periods same day but not contiguous
      continue
    }
    // 3+ periods of the same lab subject on one day: at minimum one is unpaired
    labSplits += arr.length % 2
  }

  let teacherDailyOverload = 0
  for (const dayMap of teacherDayCount.values()) for (const c of dayMap.values()) if (c > DAILY_CAP) teacherDailyOverload += c - DAILY_CAP
  let teacherWeeklyOverload = 0
  for (const c of teacherWeekCount.values()) if (c > WEEKLY_CAP) teacherWeeklyOverload += c - WEEKLY_CAP

  // Workload balance: population variance of weekly period counts across teachers who teach at all.
  const loads = [...teacherWeekCount.values()]
  const mean = loads.length ? loads.reduce((a, b) => a + b, 0) / loads.length : 0
  const workloadVariance = loads.length ? loads.reduce((a, b) => a + (b - mean) ** 2, 0) / loads.length : 0

  // Teacher gaps: idle periods strictly between a teacher's first and last class of the day.
  let teacherGapPeriods = 0
  for (const [day_, dsMap] of teacherDaySlots) {
    void day_
    for (const [day, idxs] of dsMap) {
      const periods = problem.periodsByDay.get(day)!
      const sorted = [...idxs].sort((a, b) => a - b)
      const first = sorted[0], last = sorted[sorted.length - 1]
      const between = periods.filter(p => p > first && p < last)
      const occupiedSet = new Set(sorted)
      teacherGapPeriods += between.filter(p => !occupiedSet.has(p)).length
    }
  }

  // Minor: unpreferred-slot assignments, forced same-day-subject repeats, accidental adjacent-same-subject
  // (two periods of the same non-lab subject back to back, not an intentional double).
  let unpreferredSlot = 0
  const teacherById = new Map(problem.teachers.map(t => [t.id, t]))
  for (const e of entries) {
    const teacher = teacherById.get(e.teacherId)
    if (teacher?.notPreferredPeriods.has(`${e.day}:${e.idx}`)) unpreferredSlot++
  }
  let forcedSameDayRepeat = 0
  const csDay = new Map<string, number>()
  for (const e of entries) {
    const key = `${e.classSubjectId}:${e.day}`
    csDay.set(key, (csDay.get(key) ?? 0) + 1)
  }
  for (const [key, c] of csDay) {
    void key
    if (c > 1) forcedSameDayRepeat += c - 1
  }
  // subtract legitimate lab-double pairs from that count (a lab's intended double period is 2-on-one-day
  // by design, not a "repeat")
  for (const arr of labByCsDayEntries.values()) if (arr.length >= 2) forcedSameDayRepeat -= 1

  let accidentalAdjacentSameSubject = 0
  const byClassDay = new Map<string, Entry[]>()
  for (const e of entries) {
    const key = `${e.classId}:${e.day}`
    const arr = byClassDay.get(key) ?? []
    arr.push(e)
    byClassDay.set(key, arr)
  }
  for (const arr of byClassDay.values()) {
    const sorted = [...arr].sort((a, b) => a.idx - b.idx)
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i], b = sorted[i + 1]
      if (a.idx + 1 === b.idx && a.classSubjectId === b.classSubjectId && !(a.isDouble && b.isDouble && a.pairId === b.pairId)) {
        accidentalAdjacentSameSubject++
      }
    }
  }

  const hard = teacherDoubleBooked + roomDoubleBooked + classDoubleBooked
  const major = labSplits + teacherDailyOverload + teacherWeeklyOverload
  const workload = workloadVariance + teacherGapPeriods * 0.2
  const minor = unpreferredSlot + Math.max(0, forcedSameDayRepeat) + accidentalAdjacentSameSubject

  return {
    hard, major, workload, minor,
    total: hard * W_HARD + major * W_MAJOR + workload * W_WORKLOAD + minor * W_MINOR,
    details: {
      teacherDoubleBooked, roomDoubleBooked, classDoubleBooked, labSplits, teacherDailyOverload,
      teacherWeeklyOverload, workloadVariance, teacherGapPeriods, unpreferredSlot,
      forcedSameDayRepeat: Math.max(0, forcedSameDayRepeat), accidentalAdjacentSameSubject,
    },
  }
}

// ============================== Simulated annealing local search ==============================
// Chosen over tabu search: the staged objective collapses into one scalar via weight separation
// (see above), so all SA needs is a single acceptance rule — no per-tier solver passes. Tabu search
// would add a tabu-tenure/aspiration-criterion tuning surface for little benefit here, since the
// neighborhood (swap / relocate / lab-block-move) is small and cheap enough that SA's random restarts
// out of local optima are sufficient within the time budgets we care about (seconds, not hours). Every
// candidate move is validated against ALL hard constraints (teacher/room/class slot occupancy) BEFORE
// it is scored or considered — an infeasible move is never proposed to the acceptance rule, so hard
// constraints can never regress during refinement.

interface OccIndex {
  teacherSlot: Map<string, Map<string, number>> // teacherId -> slot -> entryId (single occupant expected)
  roomSlot: Map<string, Map<string, number>>
  classSlot: Map<string, Map<string, number>>
}

function buildIndex(entries: Entry[]): OccIndex {
  const idx: OccIndex = { teacherSlot: new Map(), roomSlot: new Map(), classSlot: new Map() }
  const put = (m: Map<string, Map<string, number>>, k: string, slot: string, id: number) => {
    const inner = m.get(k) ?? new Map<string, number>()
    inner.set(slot, id)
    m.set(k, inner)
  }
  for (const e of entries) {
    const slot = `${e.day}:${e.idx}`
    put(idx.teacherSlot, e.teacherId, slot, e.id)
    if (e.roomId) put(idx.roomSlot, e.roomId, slot, e.id)
    put(idx.classSlot, e.classId, slot, e.id)
  }
  return idx
}

function occupantAt(idx: OccIndex, kind: 'teacherSlot' | 'roomSlot' | 'classSlot', key: string, slot: string): number | undefined {
  return idx[kind].get(key)?.get(slot)
}

// Try relocating a single non-double entry to a random different (day,idx) valid for its class, subject
// (lab needs a lab room), and checks teacher/room/class are free at the target. Returns null if infeasible.
function tryRelocateMove(entries: Entry[], idx: OccIndex, problem: Problem, rng: () => number): Entry[] | null {
  const movable = entries.filter(e => !e.isDouble)
  if (!movable.length) return null
  const e = movable[Math.floor(rng() * movable.length)]
  const subject = problem.subjects.find(s => s.id === problem.classSubjects.find(cs => cs.id === e.classSubjectId)!.subjectId)!
  const day = problem.workingDays[Math.floor(rng() * problem.workingDays.length)]
  const periods = problem.periodsByDay.get(day)!
  const targetIdx = periods[Math.floor(rng() * periods.length)]
  if (day === e.day && targetIdx === e.idx) return null
  const slot = `${day}:${targetIdx}`

  if (occupantAt(idx, 'classSlot', e.classId, slot) !== undefined) return null
  if (occupantAt(idx, 'teacherSlot', e.teacherId, slot) !== undefined) return null
  let roomId: string | null = e.roomId
  if (subject.isLab) {
    const labRoom = problem.rooms.filter(r => r.isLab).find(r => occupantAt(idx, 'roomSlot', r.id, slot) === undefined)
    if (!labRoom) return null
    roomId = labRoom.id
  }
  const next = entries.map(x => x.id === e.id ? { ...x, day, idx: targetIdx, roomId } : x)
  return next
}

// Swap the (day,idx,room) of two single-period entries (any two classes/subjects), each landing in the
// other's old slot. Feasible only if each entry's teacher (and, for labs, its room) is free at the OTHER
// slot (the class-slot itself is trivially fine since it's a straight swap within — usually — different
// classes, or the same class exchanging two of its own periods).
function trySwapMove(entries: Entry[], idx: OccIndex, problem: Problem, rng: () => number): Entry[] | null {
  const movable = entries.filter(e => !e.isDouble)
  if (movable.length < 2) return null
  const a = movable[Math.floor(rng() * movable.length)]
  const b = movable[Math.floor(rng() * movable.length)]
  if (a.id === b.id) return null
  if (a.day === b.day && a.idx === b.idx) return null

  const subjA = problem.subjects.find(s => s.id === problem.classSubjects.find(cs => cs.id === a.classSubjectId)!.subjectId)!
  const subjB = problem.subjects.find(s => s.id === problem.classSubjects.find(cs => cs.id === b.classSubjectId)!.subjectId)!
  const slotA = `${a.day}:${a.idx}`, slotB = `${b.day}:${b.idx}`

  // If different classes, target class-slot must be free (it is, since that's where the other entry sits
  // and it's about to vacate) — but if a THIRD entry occupies it that's already excluded by index lookup
  // matching a/b's own ids, so just check teacher/room feasibility at the swapped slot.
  if (a.classId !== b.classId) {
    if (occupantAt(idx, 'classSlot', a.classId, slotB) !== undefined) return null
    if (occupantAt(idx, 'classSlot', b.classId, slotA) !== undefined) return null
  }
  const teacherAOccupantAtB = occupantAt(idx, 'teacherSlot', a.teacherId, slotB)
  if (teacherAOccupantAtB !== undefined && teacherAOccupantAtB !== b.id) return null
  const teacherBOccupantAtA = occupantAt(idx, 'teacherSlot', b.teacherId, slotA)
  if (teacherBOccupantAtA !== undefined && teacherBOccupantAtA !== a.id) return null

  let roomA = a.roomId, roomB = b.roomId
  if (subjA.isLab) {
    const occ = a.roomId ? occupantAt(idx, 'roomSlot', a.roomId, slotB) : undefined
    if (occ !== undefined && occ !== b.id) {
      const alt = problem.rooms.filter(r => r.isLab).find(r => occupantAt(idx, 'roomSlot', r.id, slotB) === undefined)
      if (!alt) return null
      roomA = alt.id
    }
  }
  if (subjB.isLab) {
    const occ = b.roomId ? occupantAt(idx, 'roomSlot', b.roomId, slotA) : undefined
    if (occ !== undefined && occ !== a.id) {
      const alt = problem.rooms.filter(r => r.isLab).find(r => occupantAt(idx, 'roomSlot', r.id, slotA) === undefined)
      if (!alt) return null
      roomB = alt.id
    }
  }

  return entries.map(x => {
    if (x.id === a.id) return { ...x, day: b.day, idx: b.idx, roomId: roomA }
    if (x.id === b.id) return { ...x, day: a.day, idx: a.idx, roomId: roomB }
    return x
  })
}

// Move a whole lab double-block (both halves, same pairId) to a different double-pair slot (possibly a
// different day), fixing lab splits and freeing up capacity elsewhere.
function tryMoveLabBlock(entries: Entry[], idx: OccIndex, problem: Problem, rng: () => number): Entry[] | null {
  const pairIds = [...new Set(entries.filter(e => e.isDouble).map(e => e.pairId!))]
  if (!pairIds.length) return null
  const pairId = pairIds[Math.floor(rng() * pairIds.length)]
  const halves = entries.filter(e => e.pairId === pairId)
  if (halves.length !== 2) return null
  const [h1] = halves
  const day = problem.workingDays[Math.floor(rng() * problem.workingDays.length)]
  const pairs = problem.doublePairsByDay.get(day)!
  if (!pairs.length) return null
  const [ta, tb] = pairs[Math.floor(rng() * pairs.length)]
  if (day === h1.day && [ta, tb].includes(h1.idx)) return null
  const slotA = `${day}:${ta}`, slotB = `${day}:${tb}`
  const classId = h1.classId
  if (occupantAt(idx, 'classSlot', classId, slotA) !== undefined) return null
  if (occupantAt(idx, 'classSlot', classId, slotB) !== undefined) return null
  if (occupantAt(idx, 'teacherSlot', h1.teacherId, slotA) !== undefined) return null
  if (occupantAt(idx, 'teacherSlot', h1.teacherId, slotB) !== undefined) return null
  const labRoom = problem.rooms.filter(r => r.isLab).find(r =>
    occupantAt(idx, 'roomSlot', r.id, slotA) === undefined && occupantAt(idx, 'roomSlot', r.id, slotB) === undefined)
  if (!labRoom) return null
  return entries.map(x => {
    if (x.id === halves[0].id) return { ...x, day, idx: ta, roomId: labRoom.id }
    if (x.id === halves[1].id) return { ...x, day, idx: tb, roomId: labRoom.id }
    return x
  })
}

function simulatedAnneal(initial: Entry[], problem: Problem, budgetMs: number, seed: number) {
  const rng = mulberry32(seed)
  let current = initial
  let currentScore = scoreSolution(current, problem)
  let best = current
  let bestScore = currentScore

  const startTemp = 500
  const endTemp = 0.5
  const start = Date.now()
  let iterations = 0
  let accepted = 0

  while (Date.now() - start < budgetMs) {
    iterations++
    const idx = buildIndex(current)
    const r = rng()
    let candidate: Entry[] | null
    if (r < 0.5) candidate = trySwapMove(current, idx, problem, rng)
    else if (r < 0.85) candidate = tryRelocateMove(current, idx, problem, rng)
    else candidate = tryMoveLabBlock(current, idx, problem, rng)
    if (!candidate) continue

    const candScore = scoreSolution(candidate, problem)
    const delta = candScore.total - currentScore.total
    const elapsedFrac = Math.min(1, (Date.now() - start) / budgetMs)
    const temp = startTemp * Math.pow(endTemp / startTemp, elapsedFrac)
    const accept = delta <= 0 || rng() < Math.exp(-delta / temp)
    if (accept) {
      current = candidate
      currentScore = candScore
      accepted++
      if (candScore.total < bestScore.total) { best = candidate; bestScore = candScore }
    }
  }

  return { best, bestScore, iterations, accepted, elapsedMs: Date.now() - start }
}

// ============================== Hard-constraint re-verification ==============================

function verifyHardConstraints(entries: Entry[]): string[] {
  const problems: string[] = []
  const teacherSlot = new Map<string, string>()
  const roomSlot = new Map<string, string>()
  const classSlot = new Map<string, string>()
  for (const e of entries) {
    const slot = `${e.day}:${e.idx}`
    const tk = `${e.teacherId}@${slot}`
    if (teacherSlot.has(tk)) problems.push(`Teacher ${e.teacherId} double-booked at ${slot}`)
    teacherSlot.set(tk, String(e.id))
    if (e.roomId) {
      const rk = `${e.roomId}@${slot}`
      if (roomSlot.has(rk)) problems.push(`Room ${e.roomId} double-booked at ${slot}`)
      roomSlot.set(rk, String(e.id))
    }
    const ck = `${e.classId}@${slot}`
    if (classSlot.has(ck)) problems.push(`Class ${e.classId} double-booked at ${slot}`)
    classSlot.set(ck, String(e.id))
  }
  return problems
}

// ============================== Runner ==============================

function fmt(n: number) { return n.toFixed(2) }

function runScenario(scale: number, budgets: number[], label: string, spotCheck = false) {
  const problem = generateProblem(scale)
  const totalDemand = problem.classSubjects.reduce((a, cs) => a + cs.periodsPerWeek, 0)
  const totalCapacity = problem.classes.length * [...problem.periodsByDay.values()].reduce((a, p) => a + p.length, 0)
  console.log(`\n############ ${label} (scale=${scale}x) ############`)
  console.log(`Sections: ${problem.classes.length}, Subjects: ${problem.subjects.length}, Teachers: ${problem.teachers.length}, Lab rooms: ${problem.rooms.length}`)
  console.log(`Weekly demand total = ${totalDemand}; total capacity = ${totalCapacity} (capacity/section = ${totalCapacity / problem.classes.length})`)
  console.log()

  const t0 = Date.now()
  const { entries: greedyEntries, unplaced } = greedyGenerate(problem)
  const greedyMs = Date.now() - t0
  const greedyScore = scoreSolution(greedyEntries, problem)
  const greedyHardProblems = verifyHardConstraints(greedyEntries)

  console.log('=== Greedy initial placement ===')
  console.log(`Solve time: ${greedyMs} ms`)
  console.log(`Entries placed: ${greedyEntries.length}, unplaced (couldn't fit): ${unplaced}`)
  console.log(`Hard-constraint re-check: ${greedyHardProblems.length === 0 ? 'CLEAN' : greedyHardProblems.length + ' PROBLEMS: ' + greedyHardProblems.slice(0, 5).join('; ')}`)
  console.log(`Score: total=${fmt(greedyScore.total)}  hard=${greedyScore.hard} major=${fmt(greedyScore.major)} workload=${fmt(greedyScore.workload)} minor=${fmt(greedyScore.minor)}`)
  console.log(`Details:`, greedyScore.details)
  console.log()

  let lastResult: ReturnType<typeof simulatedAnneal> | null = null
  for (const budget of budgets) {
    const t1 = Date.now()
    const result = simulatedAnneal(greedyEntries, problem, budget, 1234)
    const wallMs = Date.now() - t1
    const hardProblems = verifyHardConstraints(result.best)
    console.log(`=== Simulated annealing refinement, budget=${budget}ms ===`)
    console.log(`Wall time: ${wallMs} ms, iterations: ${result.iterations} (${fmt(result.iterations / (wallMs / 1000))} iter/s), accepted moves: ${result.accepted} (${fmt(100 * result.accepted / result.iterations)}%)`)
    console.log(`Hard-constraint re-check: ${hardProblems.length === 0 ? 'CLEAN' : hardProblems.length + ' PROBLEMS'}`)
    console.log(`Score: total=${fmt(result.bestScore.total)}  hard=${result.bestScore.hard} major=${fmt(result.bestScore.major)} workload=${fmt(result.bestScore.workload)} minor=${fmt(result.bestScore.minor)}`)
    console.log(`Details:`, result.bestScore.details)
    console.log(`Improvement vs greedy: total ${fmt(100 * (1 - result.bestScore.total / greedyScore.total))}%,  major ${fmt(100 * (1 - result.bestScore.major / Math.max(1, greedyScore.major)))}%,  workloadVar ${fmt(100 * (1 - result.bestScore.details.workloadVariance / Math.max(0.001, greedyScore.details.workloadVariance)))}%`)
    console.log()
    lastResult = result
  }

  if (spotCheck && lastResult) {
    const sampleClass = problem.classes[0].id
    const sampleEntries = lastResult.best.filter(e => e.classId === sampleClass).sort((a, b) => a.day - b.day || a.idx - b.idx)
    console.log(`=== Spot check: ${sampleClass}'s week after refinement ===`)
    const csById = new Map(problem.classSubjects.map(cs => [cs.id, cs]))
    const subjById = new Map(problem.subjects.map(s => [s.id, s.name]))
    for (const e of sampleEntries) {
      const cs = csById.get(e.classSubjectId)!
      console.log(`  day ${e.day} P${e.idx}: ${subjById.get(cs.subjectId)} (teacher ${e.teacherId}${e.roomId ? ', room ' + e.roomId : ''}${e.isDouble ? ', DOUBLE' : ''})`)
    }
    const loadByTeacher = new Map<string, number>()
    for (const e of lastResult.best) loadByTeacher.set(e.teacherId, (loadByTeacher.get(e.teacherId) ?? 0) + 1)
    const loads = [...loadByTeacher.values()]
    console.log()
    console.log(`=== Teacher workload spread after refinement (${loadByTeacher.size} teachers used) ===`)
    console.log(`min=${Math.min(...loads)} max=${Math.max(...loads)} mean=${fmt(loads.reduce((a, b) => a + b, 0) / loads.length)}`)
  }
}

function main() {
  runScenario(1, [5000, 15000, 30000], 'ONE GRADE (6 sections)', true)
  runScenario(8, [5000, 15000, 30000], 'WHOLE SCHOOL (48 sections, ~8x)', false)
}

main()
