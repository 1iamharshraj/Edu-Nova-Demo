import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { Role } from '../data'

export interface EntitySearchResult {
  id: string
  name: string
  email: string
  role: Role
  /** Single pre-formatted disambiguating line — "X-A · Roll 12" for a student, "EMP-2024-0007 ·
   *  Mathematics" for staff/teacher — see server/src/routes/users.ts GET /search. */
  context: string
}

interface UseEntitySearchOpts {
  /** One role, or several (fanned out to one request per role and merged, since the server endpoint
   *  only accepts a single `role` per call). */
  role: Role | Role[]
  /** Narrows student results to one class (ignored server-side for non-student roles). */
  classId?: string
  query: string
  limit?: number
  /** Set false to skip fetching entirely (e.g. the picker's dropdown is closed) without unmounting the hook. */
  enabled?: boolean
}

const DEBOUNCE_MS = 300
const DEFAULT_LIMIT = 20

/**
 * Debounced (~300ms) wrapper around `GET /api/users/search` (see server/src/routes/users.ts). Cancels
 * stale in-flight requests via a request-id guard — api.ts's `request()` has no `AbortSignal` hook, so a
 * monotonically increasing id is compared when each response lands; a response whose id no longer matches
 * the latest request in flight is dropped silently instead of clobbering newer results.
 */
export function useEntitySearch({ role, classId, query, limit, enabled = true }: UseEntitySearchOpts) {
  const [results, setResults] = useState<EntitySearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)
  // Stable key for the effect's dependency list — an inline `role={['teacher','staff']}` array literal
  // is a new reference every render, which would otherwise reset the debounce timer on every keystroke.
  const roleKey = Array.isArray(role) ? role.join(',') : role

  useEffect(() => {
    if (!enabled) return undefined // gated at the return below — avoids setState-in-effect for this branch
    const id = ++requestId.current
    const q = query.trim()
    const take = limit ?? DEFAULT_LIMIT
    const timer = setTimeout(() => {
      setLoading(true)
      setError(null)
      const roles = Array.isArray(role) ? role : [role]
      Promise.all(roles.map(r => {
        const params = new URLSearchParams()
        if (q) params.set('q', q)
        if (classId) params.set('classId', classId)
        params.set('role', r)
        params.set('limit', String(take))
        return api.get<{ items: EntitySearchResult[]; nextCursor: string | null }>(`/users/search?${params.toString()}`)
      }))
        .then(responses => {
          if (requestId.current !== id) return // a newer request superseded this one — drop it
          const merged = responses.flatMap(r => r.items).sort((a, b) => a.name.localeCompare(b.name)).slice(0, take)
          setResults(merged)
        })
        .catch((e: unknown) => {
          if (requestId.current !== id) return
          setError(e instanceof Error ? e.message : 'Search failed')
          setResults([])
        })
        .finally(() => {
          if (requestId.current === id) setLoading(false)
        })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleKey, classId, query, limit, enabled])

  // Gated here rather than reset via setState inside the effect above (see the `!enabled` early return) —
  // closing the picker just stops exposing the last-fetched results/loading/error, it doesn't need to
  // clear the underlying state, which avoids a same-tick cascading setState from inside an effect.
  return enabled ? { results, loading, error } : { results: EMPTY, loading: false, error: null }
}

const EMPTY: EntitySearchResult[] = []
