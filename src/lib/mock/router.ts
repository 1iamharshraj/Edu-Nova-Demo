// A tiny Express-alike router for the mock backend. Real module handler files (src/lib/mock/modules/*)
// call `route()` at import time to register themselves; `dispatch()` is the single entry point
// `src/lib/api.ts` calls instead of `fetch`.

import { MockHttpError, notFound } from './http'
import { getDB, table, saveTable, uid, nowIso, userIdForToken, SCHOOL_ID, type Row } from './store'

export interface Actor {
  userId: string
  role: string
  schoolId: string
}

export interface ReqCtx {
  params: Record<string, string>
  query: Record<string, string>
  body: Record<string, unknown>
  actor: Actor | null
  /** The raw path actually matched, for handlers that need to know their own mount point. */
  path: string
}

export type Handler = (ctx: ReqCtx) => unknown | Promise<unknown>

interface Registered { method: string; segments: string[]; handler: Handler }
const registry: Registered[] = []

/** Register a route. Pattern segments starting with `:` are captured into `ctx.params`. */
export function route(method: string, pattern: string, handler: Handler) {
  const segments = pattern.split('/').filter(Boolean)
  registry.push({ method: method.toUpperCase(), segments, handler })
}

function matchPath(routeSegs: string[], pathSegs: string[]): Record<string, string> | null {
  if (routeSegs.length !== pathSegs.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < routeSegs.length; i++) {
    const rs = routeSegs[i]
    if (rs.startsWith(':')) params[rs.slice(1)] = decodeURIComponent(pathSegs[i])
    else if (rs !== pathSegs[i]) return null
  }
  return params
}

function resolveActor(token: string | null): Actor | null {
  const userId = userIdForToken(token)
  if (!userId) return null
  const user = table('User').find(u => u.id === userId)
  if (!user) return null
  return { userId, role: String(user.role), schoolId: String(user.schoolId ?? SCHOOL_ID) }
}

export interface DispatchResult { status: number; json: unknown }

/** Mirrors the real server's error shape: `{ error, details? }`, plus any extra top-level keys an
 * endpoint adds (e.g. timetable's `conflicts[]` on a 409). */
function errorBody(e: MockHttpError) {
  return { error: e.message, ...(e.details !== undefined ? { details: e.details } : {}), ...(e.extra ?? {}) }
}

export async function dispatch(method: string, fullPath: string, body: unknown, token: string | null): Promise<DispatchResult> {
  const [rawPath, queryStr] = fullPath.split('?')
  const pathSegs = rawPath.split('/').filter(Boolean)
  const query: Record<string, string> = {}
  if (queryStr) for (const pair of queryStr.split('&')) {
    const [k, v] = pair.split('=')
    if (k) query[decodeURIComponent(k)] = decodeURIComponent(v ?? '')
  }

  const m = method.toUpperCase()
  for (const r of registry) {
    if (r.method !== m) continue
    const params = matchPath(r.segments, pathSegs)
    if (!params) continue
    const actor = resolveActor(token)
    try {
      const result = await r.handler({ params, query, body: (body ?? {}) as Record<string, unknown>, actor, path: rawPath })
      if (result && typeof result === 'object' && '__status' in (result as Record<string, unknown>)) {
        const r2 = result as { __status: number; body: unknown }
        return { status: r2.__status, json: r2.body }
      }
      return { status: 200, json: result ?? {} }
    } catch (e) {
      if (e instanceof MockHttpError) return { status: e.status, json: errorBody(e) }
      console.error('[mock backend] unexpected error in handler for', m, rawPath, e)
      return { status: 500, json: { error: e instanceof Error ? e.message : 'Internal error' } }
    }
  }
  return { status: 404, json: { error: `No mock route for ${m} ${rawPath}` } }
}

/** Explicit status helper for handlers that need something other than 200 (e.g. 201 Created). */
export function status(code: number, body: unknown) {
  return { __status: code, body }
}

export function requireAuth(ctx: ReqCtx): Actor {
  if (!ctx.actor) throw new MockHttpError(401, 'Unauthorized')
  return ctx.actor
}

export function requireRole(ctx: ReqCtx, ...roles: string[]): Actor {
  const actor = requireAuth(ctx)
  if (!roles.includes(actor.role)) throw new MockHttpError(403, 'Not permitted')
  return actor
}

// ───────────────────────── Generic CRUD helper ─────────────────────────
// Most of the 168 Prisma models behind this app are plain schoolId-scoped CRUD from the frontend's
// point of view. Rather than hand-writing list/get/create/update/delete for every one, module handler
// files register a `crud()` block per collection and only write custom `route()` calls for endpoints
// that do something beyond straightforward persistence (aggregation, cross-collection validation,
// simulated algorithms, etc).
export interface CrudOptions {
  /** Reshape a stored row into what the frontend expects (renames, computed fields, nested lookups). */
  serialize?: (row: Row) => Record<string, unknown>
  /** Reshape an incoming create/update body into stored-row fields before merge. */
  deserialize?: (body: Record<string, unknown>) => Record<string, unknown>
  /** Extra filtering beyond schoolId (e.g. ?classId=). Return true to keep a row. */
  filter?: (row: Row, query: Record<string, string>) => boolean
  /** Disable one of the default verbs (e.g. a read-only collection admins shouldn't be able to DELETE). */
  disable?: Array<'list' | 'get' | 'create' | 'update' | 'delete'>
  /** Role gate for writes; defaults to any authenticated actor. */
  writeRoles?: string[]
  /** Set false for a collection that spans every school (rare in this app). Default true. */
  schoolScoped?: boolean
}

export function crud(basePath: string, collection: string, opts: CrudOptions = {}) {
  const ser = opts.serialize ?? ((r: Row) => r)
  const deser = opts.deserialize ?? ((b: Record<string, unknown>) => b)
  const disabled = new Set(opts.disable ?? [])
  const scoped = opts.schoolScoped !== false

  const scopeOf = (actor: Actor | null) => (scoped ? actor?.schoolId ?? SCHOOL_ID : undefined)

  if (!disabled.has('list')) {
    route('GET', basePath, (ctx) => {
      const actor = requireAuth(ctx)
      const sid = scopeOf(actor)
      let rows = table(collection).filter(r => !sid || r.schoolId === sid)
      if (opts.filter) rows = rows.filter(r => opts.filter!(r, ctx.query))
      return { items: rows.map(ser) }
    })
  }
  if (!disabled.has('get')) {
    route('GET', `${basePath}/:id`, (ctx) => {
      const actor = requireAuth(ctx)
      const sid = scopeOf(actor)
      const row = table(collection).find(r => r.id === ctx.params.id && (!sid || r.schoolId === sid))
      if (!row) throw notFound(collection)
      return { item: ser(row) }
    })
  }
  if (!disabled.has('create')) {
    route('POST', basePath, (ctx) => {
      const actor = opts.writeRoles ? requireRole(ctx, ...opts.writeRoles) : requireAuth(ctx)
      const rows = table(collection)
      const row: Row = { id: uid(collection.toLowerCase()), schoolId: scopeOf(actor) ?? SCHOOL_ID, createdAt: nowIso(), ...deser(ctx.body) }
      rows.push(row)
      saveTable(collection, rows)
      return status(201, { item: ser(row) })
    })
  }
  if (!disabled.has('update')) {
    route('PATCH', `${basePath}/:id`, (ctx) => {
      const actor = opts.writeRoles ? requireRole(ctx, ...opts.writeRoles) : requireAuth(ctx)
      const sid = scopeOf(actor)
      const rows = table(collection)
      const idx = rows.findIndex(r => r.id === ctx.params.id && (!sid || r.schoolId === sid))
      if (idx === -1) throw notFound(collection)
      rows[idx] = { ...rows[idx], ...deser(ctx.body), updatedAt: nowIso() }
      saveTable(collection, rows)
      return { item: ser(rows[idx]) }
    })
    // A handful of frontend call sites use PUT for a full-row replace — accept it as PATCH's alias.
    route('PUT', `${basePath}/:id`, (ctx) => {
      const actor = opts.writeRoles ? requireRole(ctx, ...opts.writeRoles) : requireAuth(ctx)
      const sid = scopeOf(actor)
      const rows = table(collection)
      const idx = rows.findIndex(r => r.id === ctx.params.id && (!sid || r.schoolId === sid))
      if (idx === -1) throw notFound(collection)
      rows[idx] = { ...rows[idx], ...deser(ctx.body), updatedAt: nowIso() }
      saveTable(collection, rows)
      return { item: ser(rows[idx]) }
    })
  }
  if (!disabled.has('delete')) {
    route('DELETE', `${basePath}/:id`, (ctx) => {
      const actor = opts.writeRoles ? requireRole(ctx, ...opts.writeRoles) : requireAuth(ctx)
      const sid = scopeOf(actor)
      const rows = table(collection)
      const idx = rows.findIndex(r => r.id === ctx.params.id && (!sid || r.schoolId === sid))
      if (idx === -1) throw notFound(collection)
      rows.splice(idx, 1)
      saveTable(collection, rows)
      return { ok: true }
    })
  }
}

/** Escape hatch for tests/dev tools that want to poke the raw DB. */
export function debugDB() { return getDB() }
