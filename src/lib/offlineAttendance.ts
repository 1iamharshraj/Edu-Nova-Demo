// Offline-first support for the "Take Attendance" screen ONLY (Phase 29 Part B).
// Scope is deliberately narrow — a small IndexedDB-backed queue for attendance submissions made while
// offline, plus a tiny roster/session cache so a session the teacher recently opened can still be viewed
// (and re-marked) with no network. This does NOT make the rest of the app offline-capable.
//
// Storage: one IndexedDB database (`edkonic-attendance-offline`) via the `idb` package, two stores:
//  - `queue`   — pending/synced/error/conflict attendance submissions, replayed in FIFO order on reconnect.
//  - `cache`   — last-known roster + session snapshot per (classId, date, periodIdx) scope, so the screen
//                can render something useful when opened with no network.
//
// Sync triggers (see useAttendanceSync below): the `online` event, a foreground focus/visibility fallback
// (covers Safari, which has no Background Sync API), and the service worker's Background Sync API where
// supported (see public/sw.js — the SW cannot hold the auth token itself, so its `sync` handler just wakes
// any open tab via postMessage, which then runs the real replay here with the in-page token).

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { ApiError, api } from './api'
import type { SessionStatus } from './data'

/* ── types ─────────────────────────────────────────────── */

export interface QueuedRecord { studentId: string; status: SessionStatus }

export type QueueStatus = 'pending' | 'syncing' | 'synced' | 'error' | 'conflict'

export interface QueuedSubmission {
  /** Primary key — also used as the client-generated idempotency key sent to the server. */
  id: string
  classId: string
  classLabel: string
  date: string
  periodIdx: number | null
  periodLabel: string
  records: QueuedRecord[]
  /** The server-known records at the moment this was queued — used to detect a conflicting server-side
   *  change (someone else submitted this session) before blindly overwriting on replay. */
  baseline: QueuedRecord[]
  createdAt: number
  attempts: number
  status: QueueStatus
  /** Human-readable reason, set on 'error' or 'conflict'. */
  message?: string
}

interface CachedSession {
  /** `${classId}|${date}|${periodIdx ?? 'day'}` */
  scope: string
  classId: string
  date: string
  periodIdx: number | null
  students: { id: string; name: string; rollNo?: string; avatarHue?: number }[]
  serverRecords: QueuedRecord[]
  lockedAt?: string | null
  markedById?: string
  cachedAt: number
}

interface AttendanceOfflineDB extends DBSchema {
  queue: { key: string; value: QueuedSubmission; indexes: { byCreatedAt: number } }
  cache: { key: string; value: CachedSession }
}

const DB_NAME = 'edkonic-attendance-offline'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase<AttendanceOfflineDB>> | null = null
function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<AttendanceOfflineDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const q = db.createObjectStore('queue', { keyPath: 'id' })
        q.createIndex('byCreatedAt', 'createdAt')
        db.createObjectStore('cache', { keyPath: 'scope' })
      },
    })
  }
  return dbPromise
}

export const scopeKey = (classId: string, date: string, periodIdx: number | null) => `${classId}|${date}|${periodIdx ?? 'day'}`

/* ── roster / session cache ───────────────────────────────
   Written whenever the screen successfully loads a session over the network; read as a fallback when
   the network is unavailable, so a recently-opened class/date/period still renders offline. */

export async function cacheSessionSnapshot(snap: Omit<CachedSession, 'cachedAt'>) {
  const db = await getDb()
  await db.put('cache', { ...snap, cachedAt: Date.now() })
}

export async function getCachedSessionSnapshot(classId: string, date: string, periodIdx: number | null) {
  const db = await getDb()
  return db.get('cache', scopeKey(classId, date, periodIdx))
}

/* ── queue ─────────────────────────────────────────────── */

export async function listQueue(): Promise<QueuedSubmission[]> {
  const db = await getDb()
  const items = await db.getAllFromIndex('queue', 'byCreatedAt')
  return items
}

export async function getQueueItemForScope(classId: string, date: string, periodIdx: number | null) {
  const items = await listQueue()
  return items.find(q => q.classId === classId && q.date === date && q.periodIdx === periodIdx && q.status !== 'synced')
}

export async function enqueueSubmission(input: {
  classId: string; classLabel: string; date: string; periodIdx: number | null; periodLabel: string
  records: QueuedRecord[]; baseline: QueuedRecord[]
}): Promise<QueuedSubmission> {
  const db = await getDb()
  // Reuse an existing not-yet-synced entry for the same scope (a re-save while still offline replaces the
  // pending payload rather than piling up duplicate queue entries for the same session).
  const existing = await getQueueItemForScope(input.classId, input.date, input.periodIdx)
  const item: QueuedSubmission = {
    id: existing?.id ?? (crypto.randomUUID ? crypto.randomUUID() : `q_${Date.now()}_${Math.random().toString(36).slice(2)}`),
    classId: input.classId, classLabel: input.classLabel, date: input.date, periodIdx: input.periodIdx, periodLabel: input.periodLabel,
    records: input.records,
    baseline: existing?.baseline ?? input.baseline,
    createdAt: existing?.createdAt ?? Date.now(),
    attempts: 0,
    status: 'pending',
  }
  await db.put('queue', item)
  notifyQueueChanged()
  requestBackgroundSync()
  return item
}

export async function removeQueueItem(id: string) {
  const db = await getDb()
  await db.delete('queue', id)
  notifyQueueChanged()
}

async function updateQueueItem(id: string, patch: Partial<QueuedSubmission>) {
  const db = await getDb()
  const cur = await db.get('queue', id)
  if (!cur) return
  await db.put('queue', { ...cur, ...patch })
  notifyQueueChanged()
}

/* ── change notifications (so React components can re-render on queue mutation) ── */

const QUEUE_EVENT = 'edkonic:attendance-queue-changed'
function notifyQueueChanged() {
  window.dispatchEvent(new CustomEvent(QUEUE_EVENT))
}
export function onQueueChanged(cb: () => void) {
  window.addEventListener(QUEUE_EVENT, cb)
  return () => window.removeEventListener(QUEUE_EVENT, cb)
}

/* ── background sync registration (best-effort; foreground fallback covers browsers without it) ── */

function requestBackgroundSync() {
  navigator.serviceWorker?.ready
    .then(reg => {
      const syncReg = (reg as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync
      return syncReg?.register('edkonic-attendance-sync')
    })
    .catch(() => { /* Background Sync unsupported (e.g. Safari) — online/focus listeners cover it */ })
}

/* ── genuine-network-failure detection ─────────────────────
   navigator.onLine is unreliable (true on a captive portal / dead wifi, false on some browsers behind a
   VPN) — the authoritative signal is always an actual failed request. `api.post` throws `ApiError` once a
   response came back (even an error response — the server IS reachable), and throws a plain non-ApiError
   (TypeError from `fetch`, e.g. "Failed to fetch" / "Load failed") when the request never completed. */
export function isNetworkFailure(e: unknown): boolean {
  return !(e instanceof ApiError)
}

/* ── replay ────────────────────────────────────────────── */

export interface SyncResult { synced: number; conflicts: number; errors: number; remaining: number }

let syncing = false

/** Replays the queue in FIFO order against the real endpoint. Safe to call from multiple triggers at once
 *  (online + focus firing together) — a lock keeps replays from overlapping. */
export async function flushQueue(): Promise<SyncResult> {
  if (syncing) return { synced: 0, conflicts: 0, errors: 0, remaining: (await listQueue()).length }
  syncing = true
  const result: SyncResult = { synced: 0, conflicts: 0, errors: 0, remaining: 0 }
  try {
    const items = (await listQueue()).filter(q => q.status === 'pending' || q.status === 'error')
    for (const item of items) {
      await updateQueueItem(item.id, { status: 'syncing' })
      try {
        // Conflict check: has the server's copy of this session moved since we captured the baseline?
        const serverSessions = await api.get<{ items: { id: string; periodIdx?: number | null; records: { studentId: string; status: SessionStatus }[]; lockedAt?: string }[] }>(
          `/attendance/sessions?classId=${encodeURIComponent(item.classId)}&from=${item.date}&to=${item.date}`,
        )
        const serverSession = (serverSessions.items ?? []).find(s => (s.periodIdx ?? null) === item.periodIdx)
        const serverRecords: QueuedRecord[] = (serverSession?.records ?? []).map(r => ({ studentId: r.studentId, status: r.status }))
        const changedSinceBaseline = !sameRecords(serverRecords, item.baseline)

        if (serverSession?.lockedAt) {
          await updateQueueItem(item.id, { status: 'conflict', message: 'This session was locked by an admin before your offline changes could sync. Ask an admin to unlock it, then re-mark and save.' })
          result.conflicts++
          continue
        }
        if (changedSinceBaseline) {
          await updateQueueItem(item.id, { status: 'conflict', message: 'Someone else saved attendance for this class/date/period while you were offline. Your offline changes were kept but NOT applied — review and choose whether to overwrite.' })
          result.conflicts++
          continue
        }

        await api.post('/attendance/sessions', {
          classId: item.classId, date: item.date, periodIdx: item.periodIdx ?? undefined,
          records: item.records, idempotencyKey: item.id,
        })
        await updateQueueItem(item.id, { status: 'synced' })
        // Keep a 'synced' tombstone briefly for UI feedback, then drop it.
        setTimeout(() => { removeQueueItem(item.id).catch(() => {}) }, 4000)
        result.synced++
      } catch (e) {
        if (isNetworkFailure(e)) {
          // Still offline (or the flakiness continues) — leave it pending for the next trigger, and stop
          // replaying further items so we don't hammer a dead connection or replay out of order.
          await updateQueueItem(item.id, { status: 'pending', attempts: item.attempts + 1 })
          break
        }
        if (e instanceof ApiError && e.status === 403) {
          await updateQueueItem(item.id, { status: 'conflict', message: e.message || 'This session can no longer be saved by you — it may have been locked.' })
          result.conflicts++
          continue
        }
        await updateQueueItem(item.id, { status: 'error', attempts: item.attempts + 1, message: e instanceof Error ? e.message : 'Sync failed' })
        result.errors++
      }
    }
  } finally {
    syncing = false
    result.remaining = (await listQueue()).length
  }
  return result
}

function sameRecords(a: QueuedRecord[], b: QueuedRecord[]): boolean {
  if (a.length !== b.length) return false
  const mb = new Map(b.map(r => [r.studentId, r.status]))
  return a.every(r => mb.get(r.studentId) === r.status)
}

/** Discards a queue item's offline changes entirely (teacher chose "discard mine" on a conflict). */
export async function discardQueueItem(id: string) {
  await removeQueueItem(id)
}

/** Force-replays one item, skipping the conflict check (teacher chose "overwrite with mine"). */
export async function forceSyncItem(id: string): Promise<void> {
  const db = await getDb()
  const item = await db.get('queue', id)
  if (!item) return
  await updateQueueItem(id, { status: 'syncing' })
  try {
    await api.post('/attendance/sessions', { classId: item.classId, date: item.date, periodIdx: item.periodIdx ?? undefined, records: item.records, idempotencyKey: item.id })
    await updateQueueItem(id, { status: 'synced' })
    setTimeout(() => { removeQueueItem(id).catch(() => {}) }, 4000)
  } catch (e) {
    if (isNetworkFailure(e)) { await updateQueueItem(id, { status: 'pending' }); return }
    await updateQueueItem(id, { status: 'error', message: e instanceof Error ? e.message : 'Sync failed' })
  }
}
