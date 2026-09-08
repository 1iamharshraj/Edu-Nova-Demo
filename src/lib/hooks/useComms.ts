import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { API_BASE, getToken } from '../api'
import { useStore } from '../store'
import { qs, useList } from './useAcademics'
import { useFetch } from './useTimetable'
import type {
  CalendarEventRec, ContactPerson, ContactsByRole, ConversationRec, MeetingRec, MessageRec, NotificationRec, PostRec, Role,
} from '../data'

// Data hooks and pure helpers for Phase 7: feed, messaging, notifications, meetings, calendar audience.
// Components live in src/portal/modules/{social,meetings}.tsx. See .agents/edunova/phase-7-communication.md

/* ── realtime: SSE with a polling fallback ─────────────────────────────
 * One EventSource is shared across every `useEventStream()` caller (ref-counted module-level singleton) so
 * mounting the notification bell and the messages screen at once doesn't open two connections. On error the
 * connection is torn down and retried every 30s; consumers should also poll their own data on that cadence
 * (see `useLivePoll`) since a flaky connection may silently drop individual events. */

export type StreamStatus = 'connecting' | 'open' | 'polling' | 'closed'
export interface StreamEvent { type: 'message' | 'notification' | string; payload: unknown }
type StreamListener = (e: StreamEvent) => void

interface StreamManager {
  token: string
  es: EventSource | null
  status: StreamStatus
  listeners: Set<StreamListener>
  statusListeners: Set<(s: StreamStatus) => void>
  refCount: number
  retryTimer: number | null
}

let manager: StreamManager | null = null

function setManagerStatus(m: StreamManager, s: StreamStatus) {
  m.status = s
  m.statusListeners.forEach(fn => fn(s))
}

function connectManager(m: StreamManager) {
  try {
    const es = new EventSource(`${API_BASE}/events/stream?token=${encodeURIComponent(m.token)}`)
    m.es = es
    es.onopen = () => setManagerStatus(m, 'open')
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as StreamEvent
        m.listeners.forEach(fn => fn(data))
      } catch { /* ignore malformed payloads */ }
    }
    es.onerror = () => {
      es.close()
      m.es = null
      setManagerStatus(m, 'polling')
      if (!m.retryTimer) {
        m.retryTimer = window.setInterval(() => { if (!m.es && manager === m) connectManager(m) }, 30_000) as unknown as number
      }
    }
  } catch {
    setManagerStatus(m, 'polling')
    if (!m.retryTimer) m.retryTimer = window.setInterval(() => { if (!m.es && manager === m) connectManager(m) }, 30_000) as unknown as number
  }
}

function teardownManager() {
  if (!manager) return
  manager.es?.close()
  if (manager.retryTimer) window.clearInterval(manager.retryTimer)
  manager = null
}

function ensureManager(token: string): StreamManager {
  if (manager && manager.token === token) return manager
  if (manager) teardownManager()
  manager = { token, es: null, status: 'connecting', listeners: new Set(), statusListeners: new Set(), refCount: 0, retryTimer: null }
  connectManager(manager)
  return manager
}

/**
 * Opens (or joins) the shared `GET /events/stream` connection for the signed-in user. Returns the connection
 * status and a `subscribe` callback for `{type:"message"|"notification", payload}` events. When `status` is
 * `'polling'` the SSE connection is down and retrying — callers with their own list to keep fresh should poll
 * it on a ~30s interval too (see `useLivePoll`).
 */
export function useEventStream() {
  const { user } = useStore()
  const token = getToken()

  // subscribe/getSnapshot for useSyncExternalStore — React calls `subscribeStatus` in an effect for us, so
  // ref-counting the shared manager (and tearing it down once nothing needs it) happens outside render.
  const subscribeStatus = useCallback((onStoreChange: () => void) => {
    if (!user || !token) return () => {}
    const m = ensureManager(token)
    m.refCount++
    m.statusListeners.add(onStoreChange)
    return () => {
      m.statusListeners.delete(onStoreChange)
      m.refCount--
      if (m.refCount <= 0) teardownManager()
    }
  }, [user, token])

  const getSnapshot = useCallback((): StreamStatus => {
    if (!user || !token) return 'closed'
    return manager && manager.token === token ? manager.status : 'connecting'
  }, [user, token])

  const status = useSyncExternalStore(subscribeStatus, getSnapshot)

  const subscribe = useCallback((fn: StreamListener) => {
    if (!token) return () => {}
    const m = ensureManager(token)
    m.listeners.add(fn)
    return () => { m.listeners.delete(fn) }
  }, [token])

  return { status, subscribe }
}

/** Reloads `reload` whenever a stream event of `kind` arrives, and on a 30s timer whenever the stream isn't open. */
export function useLivePoll(kind: 'message' | 'notification', reload: () => void) {
  const { subscribe, status } = useEventStream()
  const reloadRef = useRef(reload)
  useEffect(() => { reloadRef.current = reload })

  useEffect(() => subscribe(e => { if (e.type === kind) reloadRef.current() }), [subscribe, kind])

  useEffect(() => {
    if (status === 'open') return
    if (status === 'closed') return
    const id = window.setInterval(() => reloadRef.current(), 30_000)
    return () => window.clearInterval(id)
  }, [status])
}

/* ── feed ────────────────────────────────────────────────── */

/** `GET /feed` — audience-filtered for the caller by the server; pinned posts sort first. */
export function useFeed(enabled = true) {
  const r = useList<PostRec>(enabled ? '/feed' : null)
  // Memoized on the fetched array's identity so this returns the *same* array/object references across
  // re-renders until a new fetch actually lands — components that derive local state from these posts
  // (see PostCard's "syncedPost") rely on that stability to avoid re-deriving (and re-rendering) forever.
  const items = useMemo(() => r.items ? [...r.items].sort((a, b) =>
    Number(b.pinned) - Number(a.pinned) || (b.publishedAt || b.createdAt).localeCompare(a.publishedAt || a.createdAt)) : r.items, [r.items])
  return { ...r, items }
}

export const CAN_POST_ROLES = ['admin', 'superadmin', 'staff', 'teacher'] as const

/* ── messages ───────────────────────────────────────────── */

/** `GET /messages/conversations` — mine, with last message + unread count. */
export function useConversations(enabled = true) {
  return useList<ConversationRec>(enabled ? '/messages/conversations' : null)
}

/** `GET /messages/conversations/:id/messages?before` — sorted oldest-first so bubbles read top to bottom. */
export function useConversationMessages(conversationId?: string, before?: string) {
  const r = useList<MessageRec>(conversationId ? `/messages/conversations/${encodeURIComponent(conversationId)}/messages${qs({ before })}` : null)
  // Memoized on `r.items` identity — see the note on `useFeed` above; MessagesMod syncs local state off this.
  const items = useMemo(() => r.items ? [...r.items].sort((a, b) => a.sentAt.localeCompare(b.sentAt)) : r.items, [r.items])
  return { ...r, items }
}

export const ROLE_GROUP_LABEL: Record<Role, string> = { admin: 'Admin', superadmin: 'Admin', staff: 'Staff', teacher: 'Teachers', parent: 'Parents', student: 'Students' }

export interface ContactGroup { group: string; people: ContactPerson[] }

/** `GET /messages/contacts` — people the caller may start a conversation with, as `{ [role]: person[] }`. */
export function useContacts(enabled = true) {
  const r = useFetch<{ items?: ContactsByRole } | ContactsByRole>(enabled ? '/messages/contacts' : null)
  const groups: ContactGroup[] = useMemo(() => {
    const byRole = (r.data && 'items' in r.data && r.data.items) ? r.data.items : (r.data as ContactsByRole | undefined)
    if (!byRole) return []
    // admin and superadmin share the "Admin" label — merge them so the picker doesn't render two same-keyed groups.
    const byLabel = new Map<string, ContactPerson[]>()
    for (const [role, people] of Object.entries(byRole) as [Role, ContactPerson[]][]) {
      if (!people?.length) continue
      const label = ROLE_GROUP_LABEL[role] ?? role
      byLabel.set(label, [...(byLabel.get(label) ?? []), ...people])
    }
    return [...byLabel.entries()].map(([group, people]) => ({ group, people }))
  }, [r.data])
  return { groups, error: r.error, loading: r.loading, reload: r.reload }
}

export const otherParticipants = (c: ConversationRec, myUserId?: string) =>
  (c.participants ?? []).filter(p => p.userId !== myUserId)

/** Display name for a conversation: its title (group), else the other DM participant's name. */
export function conversationTitle(c: ConversationRec, myUserId?: string): string {
  if (c.title) return c.title
  const others = otherParticipants(c, myUserId)
  if (others.length === 1) return others[0].name ?? 'Conversation'
  if (others.length > 1) return others.map(o => o.name).filter(Boolean).join(', ') || 'Group'
  return 'Conversation'
}

/** Whether every other participant has read up to (or past) this message's timestamp — a "seen" tick. */
export function seenByOthers(c: ConversationRec, m: MessageRec | undefined, myUserId?: string): boolean {
  if (!m) return false
  const others = otherParticipants(c, myUserId)
  if (others.length === 0) return false
  return others.every(p => !!p.lastReadAt && p.lastReadAt >= m.sentAt)
}

/* ── notifications ──────────────────────────────────────── */

/** `GET /notifications?unread` */
export function useNotifications(params: { unread?: boolean } = {}, enabled = true) {
  return useList<NotificationRec>(enabled ? `/notifications${qs({ unread: params.unread ? '1' : undefined })}` : null)
}

/* ── meetings ───────────────────────────────────────────── */

export const MEETING_STATUSES: MeetingRec['status'][] = ['Requested', 'Scheduled', 'Completed', 'Cancelled', 'Declined']
export const meetingTone = (s: MeetingRec['status']): 'green' | 'amber' | 'rose' | 'slate' =>
  s === 'Scheduled' ? 'green' : s === 'Requested' ? 'amber' : s === 'Completed' ? 'slate' : 'rose'

/** `GET /meetings` — server-scoped: mine for parent/student, mine + for-me for teacher, all for admin/staff. */
export function useMeetings(enabled = true) {
  return useList<MeetingRec>(enabled ? '/meetings' : null)
}

/* ── calendar (audience) ────────────────────────────────── */

/** `GET /calendar?termId&from&to` — audience-filtered for the caller. Not used by this phase's own screens (CalendarMod/CalendarAdminMod live elsewhere) but kept here so those modules share one shape. */
export function useCalendarEvents(params: { termId?: string; from?: string; to?: string } = {}, enabled = true) {
  return useList<CalendarEventRec>(enabled ? `/calendar${qs(params)}` : null)
}

/* ── shared formatting ──────────────────────────────────── */

export const fmtTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '')
export const fmtDayTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')
/** `<input type="datetime-local">` value (local time, seconds dropped) for "now". */
export const nowLocal = () => {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}
