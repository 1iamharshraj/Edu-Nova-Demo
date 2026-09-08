import type { Response } from 'express'

// In-process SSE pub/sub keyed by userId (see phase-7-communication.md → Realtime). Single dev server,
// no Redis: a Map of userId → connected `res` objects is enough. `GET /api/events/stream` (auth via
// `?token=`) registers a client here; feed/messages/notifications services push events through `sendToUser`.

interface Client { schoolId: string; res: Response }

const clients = new Map<string, Set<Client>>()

export function addClient(userId: string, schoolId: string, res: Response): Client {
  const client: Client = { schoolId, res }
  if (!clients.has(userId)) clients.set(userId, new Set())
  clients.get(userId)!.add(client)
  return client
}

export function removeClient(userId: string, client: Client) {
  const set = clients.get(userId)
  if (!set) return
  set.delete(client)
  if (!set.size) clients.delete(userId)
}

export function isConnected(userId: string): boolean {
  return !!clients.get(userId)?.size
}

// Sends `{type, payload}` as one SSE `data:` event to every open connection for this user.
export function sendToUser(userId: string, event: { type: string; payload: unknown }) {
  const set = clients.get(userId)
  if (!set || !set.size) return
  const line = `data: ${JSON.stringify(event)}\n\n`
  for (const c of set) c.res.write(line)
}

export function sendToUsers(userIds: string[], event: { type: string; payload: unknown }) {
  for (const id of new Set(userIds)) sendToUser(id, event)
}

// Closes every open connection belonging to a school — used by admin reset so stale streams don't
// keep serving events for a school that no longer exists (in the demo, wiped-and-reloaded).
export function closeSchoolConnections(schoolId: string) {
  for (const [userId, set] of clients) {
    for (const c of [...set]) {
      if (c.schoolId !== schoolId) continue
      try { c.res.end() } catch { /* already closed */ }
      set.delete(c)
    }
    if (!set.size) clients.delete(userId)
  }
}
