// Typed fetch client for the Edkonic API. Every module talks to the server through this —
// never through raw fetch — so auth headers, error shapes and the base URL live in one place.

import type { FileRec } from './data'

export const API_BASE = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE || 'http://localhost:4000/api'
const TOKEN_KEY = 'edkonic_token_v1'
const REFRESH_TOKEN_KEY = 'edkonic_refresh_token_v1'

export class ApiError extends Error {
  status: number
  details?: unknown
  /** The full error body — some endpoints add top-level keys next to `error` (e.g. timetable `conflicts`). */
  body?: unknown
  constructor(status: number, message: string, details?: unknown, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
    this.body = body
  }
}

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}
export function setToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t)
    else localStorage.removeItem(TOKEN_KEY)
  } catch { /* storage unavailable */ }
}

/** The rotating refresh token from `/auth/login` or `/auth/refresh` — stored alongside the access token
 * (same header/localStorage transport the app already used) so a 401 on an expired access token can be
 * retried once after silently minting a new one. */
export function getRefreshToken(): string | null {
  try { return localStorage.getItem(REFRESH_TOKEN_KEY) } catch { return null }
}
export function setRefreshToken(t: string | null) {
  try {
    if (t) localStorage.setItem(REFRESH_TOKEN_KEY, t)
    else localStorage.removeItem(REFRESH_TOKEN_KEY)
  } catch { /* storage unavailable */ }
}

/** Stores both tokens from a `/auth/login` or `/auth/refresh` response in one call. */
export function setTokens(t: { token: string; refreshToken?: string } | null) {
  setToken(t?.token ?? null)
  if (t) { if (t.refreshToken) setRefreshToken(t.refreshToken) } else setRefreshToken(null)
}

// Access tokens are short-lived (15 min, see server/src/auth.ts) — a single in-flight refresh is shared so
// concurrent 401s don't each race to rotate the refresh token (rotation revokes the old one, so a second,
// slightly-late refresh call with the now-stale token would otherwise fail).
let refreshInFlight: Promise<boolean> | null = null

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refreshToken = getRefreshToken()
      if (!refreshToken) return false
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        })
        if (!res.ok) { setTokens(null); return false }
        const json = await res.json().catch(() => ({}))
        if (!json.token) { setTokens(null); return false }
        setTokens({ token: json.token, refreshToken: json.refreshToken })
        return true
      } catch {
        return false
      }
    })().finally(() => { refreshInFlight = null })
  }
  return refreshInFlight
}

async function request<T>(method: string, path: string, body?: unknown, _retried = false): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${API_BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  // A 401 gets one silent refresh-and-retry — avoids bouncing the user to a re-login just because
  // their 15-minute access token expired mid-session. This must cover `/auth/me` too (the boot-time
  // session check): excluding all `/auth/*` paths previously meant an expired access token on page
  // load/reload always logged the user out even with a perfectly valid refresh token. Only `/auth/login`
  // (a 401 there means wrong credentials, not an expired token) and `/auth/refresh` itself (would recurse)
  // are excluded.
  if (res.status === 401 && !_retried && path !== '/auth/login' && path !== '/auth/refresh') {
    if (await refreshAccessToken()) return request<T>(method, path, body, true)
  }
  if (res.status === 204) return null as T
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, json.error || `Request failed (${res.status})`, json.details, json)
  return json as T
}

// Loose default so legacy call sites can read `res.user` etc. without a cast; typed callers pass T.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any

export const api = {
  get: <T = Loose>(path: string) => request<T>('GET', path),
  post: <T = Loose>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T = Loose>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T = Loose>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T = Loose>(path: string, body?: unknown) => request<T>('DELETE', path, body),
}

/** `POST /files` (multipart, field `file`, ≤ 10 MB). Returns the stored file's record. */
export async function uploadFile(file: File): Promise<FileRec> {
  const body = new FormData()
  body.append('file', file)
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/files`, { method: 'POST', headers, body })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, json.error || `Upload failed (${res.status})`, json.details, json)
  return json.item as FileRec
}

/** Fetches `GET /files/:id` with the bearer token (a plain link can't carry it) and hands the browser a download. */
export async function downloadFile(id: string, name = 'file') {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/files/${encodeURIComponent(id)}`, { headers })
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new ApiError(res.status, json.error || `Download failed (${res.status})`, json.details, json)
  }
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

/** Authenticated GET of any API path as a Response (for PDFs / images the server streams). Throws `ApiError` on failure. */
export async function fetchAuthed(path: string, _retried = false): Promise<Response> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${API_BASE}${path}`, { headers })
  if (res.status === 401 && !_retried) {
    if (await refreshAccessToken()) return fetchAuthed(path, true)
  }
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new ApiError(res.status, json.error || `Request failed (${res.status})`, json.details, json)
  }
  return res
}

/** Downloads whatever `path` streams (e.g. `/certificates/:id/pdf`) with the bearer token attached. */
export async function downloadPath(path: string, name = 'file') {
  const res = await fetchAuthed(path)
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 409) return e.message || 'That already exists.'
    if (e.status === 403) return 'You don’t have permission to do that.'
    return e.message
  }
  return e instanceof Error ? e.message : 'Something went wrong.'
}
