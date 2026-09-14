// Orchestrates every seed fragment into one fresh Collections object. Each module's seed file
// (seedCore, seedHr, seedTimetable, …) only ever ADDS keys/rows — never reads another fragment's
// output — so fragments can be extended independently without ordering bugs, as long as any
// fragment that references another's rows by id (e.g. timetable referencing Class/User ids from
// seedCore) only uses ids that seedCore is guaranteed to have created first (it always runs first).

import type { Collections } from '../store'
import { registerSeed } from '../store'
import { seedCore } from './core'
import { seedSectioning } from './sectioning' // Phase T3 — Sectioning Engine
import './library' // Phase 15 — Library (self-registers via addSeedFragment)
import './hostel' // Phase 14/24 — Hostel + boarding extensions (self-registers via addSeedFragment)
import './transport' // Phase 12 — Transport (self-registers via addSeedFragment)
import './inventory' // Phase 16 — Inventory/Procurement (self-registers via addSeedFragment)

type SeedFragment = (db: Collections) => void

// New module batches push their seed fragment onto this list (imported for its side effect,
// e.g. `import './seed/hr'`) rather than editing this file — keeps merge conflicts down while
// several agents build modules in parallel.
//
// `fragments` is deliberately `var`, uninitialized at its declaration, and never holds `seedCore` (see
// `seedAll` below) — NOT a style slip. A side-effect-importing fragment module (`import './library'`)
// creates a circular import with this file (it imports `addSeedFragment` back from here), and ES module
// evaluation always finishes evaluating an imported module's own top-level code (including a top-level
// `addSeedFragment(seedX)` call) *before* returning to run any of *this* file's own top-level statements
// that appear after the `import` — regardless of where that import is textually written. A `const`/`let`
// here would throw "Cannot access 'fragments' before initialization" the moment such a fragment's
// self-registering call runs, because the TDZ isn't lifted until this file's own declaration statement
// executes, which is always later. `var` has no TDZ (it's hoisted as `undefined` immediately), and
// `addSeedFragment` lazily creates the array on first use, so an early call from a circularly-imported
// fragment is safe; a later, explicit `addSeedFragment(seedX)` call from this file's own body (like the
// one at the bottom for seedSectioning) works the same way.
// eslint-disable-next-line no-var -- see the comment above: `var`'s lack of a TDZ is load-bearing here.
var fragments: SeedFragment[] | undefined

export function addSeedFragment(fn: SeedFragment) {
  (fragments ??= []).push(fn)
}

function seedAll(): Collections {
  const db: Collections = {}
  seedCore(db) // always first, unconditionally — every other fragment may assume its Class/User/... ids exist
  for (const fn of fragments ?? []) fn(db)
  return db
}

registerSeed(seedAll)

addSeedFragment(seedSectioning) // Phase T3 — Sectioning Engine
