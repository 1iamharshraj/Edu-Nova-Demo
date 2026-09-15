// The in-browser "database" behind the static demo. One big collection map, persisted to
// localStorage, standing in for the real Postgres/Prisma backend on `feature/backend-api`.
// Collection names mirror the real Prisma model names (schoolId-scoped rows, `id` primary key)
// so mock module handlers can be written by reading the real server code as a reference.

export type Row = Record<string, unknown> & { id: string }
export type Collections = Record<string, Row[]>

const DB_KEY = 'edkonic_mock_db_v1'
const SESSION_KEY = 'edkonic_mock_sessions_v1'
export const SCHOOL_ID = 'demo-school'

let seedFn: (() => Collections) | null = null
/** Registered once by seed/index.ts (avoids a circular import between store.ts and the seed modules). */
export function registerSeed(fn: () => Collections) {
  seedFn = fn
}

let cache: Collections | null = null

function runSeed(): Collections {
  if (!seedFn) throw new Error('mock DB seed not registered — import src/lib/mock/seed before using the store')
  return seedFn()
}

export function getDB(): Collections {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(DB_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Collections
      if (parsed && typeof parsed === 'object') { cache = parsed; return cache }
    }
  } catch { /* fall through to reseed */ }
  cache = runSeed()
  persist()
  return cache
}

export function persist() {
  if (!cache) return
  try { localStorage.setItem(DB_KEY, JSON.stringify(cache)) } catch { /* storage unavailable */ }
}

export function resetDB() {
  cache = runSeed()
  persist()
  try { localStorage.removeItem(SESSION_KEY) } catch { /* ignore */ }
}

/** A typed view onto one collection — creates it lazily if a seed forgot it. */
export function table(name: string): Row[] {
  const db = getDB()
  if (!db[name]) db[name] = []
  return db[name]
}

export function saveTable(name: string, rows: Row[]) {
  const db = getDB()
  db[name] = rows
  persist()
}

const counters: Record<string, number> = {}
export function uid(prefix: string): string {
  counters[prefix] = (counters[prefix] ?? 0) + 1
  return `${prefix}_${Date.now().toString(36)}_${counters[prefix]}_${Math.random().toString(36).slice(2, 6)}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

// ── Sessions (fake bearer tokens → userId). No real JWT — this is a client-only demo, so a token is
// just an opaque key into a localStorage-persisted map. Mirrors the real API's token/refreshToken pair
// shape so `src/lib/api.ts` doesn't need to change.
interface SessionMap { [token: string]: { userId: string; refreshToken: string } }

function loadSessions(): SessionMap {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) as SessionMap : {}
  } catch { return {} }
}
function saveSessions(s: SessionMap) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)) } catch { /* ignore */ }
}

export function issueSession(userId: string): { token: string; refreshToken: string } {
  const sessions = loadSessions()
  const token = uid('tok')
  const refreshToken = uid('rtok')
  sessions[token] = { userId, refreshToken }
  saveSessions(sessions)
  return { token, refreshToken }
}

export function userIdForToken(token: string | null): string | null {
  if (!token) return null
  const sessions = loadSessions()
  return sessions[token]?.userId ?? null
}

export function rotateRefreshToken(refreshToken: string): { token: string; refreshToken: string } | null {
  const sessions = loadSessions()
  const entry = Object.entries(sessions).find(([, v]) => v.refreshToken === refreshToken)
  if (!entry) return null
  const userId = entry[1].userId
  delete sessions[entry[0]]
  saveSessions(sessions)
  return issueSession(userId)
}

export function revokeToken(token: string | null) {
  if (!token) return
  const sessions = loadSessions()
  delete sessions[token]
  saveSessions(sessions)
}
