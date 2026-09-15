// Typed client for the Edkonic API. Every module talks to the server through this — never through
// raw fetch — so auth headers, error shapes and the request path live in one place.
//
// STATIC DEMO NOTE: this branch has no real backend. `request()`/`uploadFile()`/`fetchAuthed()` below
// call into `src/lib/mock` (an in-browser, localStorage-persisted stand-in for the real Express API on
// `feature/backend-api`) instead of doing a network `fetch`. Every hook and page in this app is
// unchanged from the real-backend version — they all go through `api.get/post/patch/put/del`, so the
// swap lives entirely in this one file. See `.agents/edunova/static-demo-plan.md`.

import type { FileRec } from './data'
import { dispatch } from './mock'

/** Static demo: no real server, so there's nothing to stream from — useComms.ts's EventSource simply
 * never connects (it retries quietly in the background; nothing else in the app depends on it). */
export const API_BASE = ''

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
 * so a 401 on an expired access token can be retried once after silently minting a new one. */
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

let refreshInFlight: Promise<boolean> | null = null

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refreshToken = getRefreshToken()
      if (!refreshToken) return false
      try {
        const { status, json } = await dispatch('POST', '/auth/refresh', { refreshToken }, null)
        if (status !== 200 || !json || typeof json !== 'object' || !('token' in json)) { setTokens(null); return false }
        const j = json as { token: string; refreshToken?: string }
        setTokens({ token: j.token, refreshToken: j.refreshToken })
        return true
      } catch {
        return false
      }
    })().finally(() => { refreshInFlight = null })
  }
  return refreshInFlight
}

async function request<T>(method: string, path: string, body?: unknown, _retried = false): Promise<T> {
  const token = getToken()
  const { status, json } = await dispatch(method, path, body, token)
  // A 401 gets one silent refresh-and-retry — avoids bouncing the user to a re-login just because
  // their access token "expired" mid-session. Only `/auth/login` (a 401 there means wrong credentials)
  // and `/auth/refresh` itself (would recurse) are excluded.
  if (status === 401 && !_retried && path !== '/auth/login' && path !== '/auth/refresh') {
    if (await refreshAccessToken()) return request<T>(method, path, body, true)
  }
  if (status === 204) return null as T
  const j = (json ?? {}) as Record<string, unknown> & { error?: string; details?: unknown }
  if (status < 200 || status >= 300) throw new ApiError(status, j.error || `Request failed (${status})`, j.details, j)
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

/** `POST /files` — in the static demo this just records the file's name/size/type (no real storage; a
 * data URL is kept for images small enough to round-trip through localStorage, so thumbnails still work). */
export async function uploadFile(file: File): Promise<FileRec> {
  const dataUrl: string | undefined = await new Promise((resolve) => {
    if (!file.type.startsWith('image/') || file.size > 300_000) return resolve(undefined)
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : undefined)
    reader.onerror = () => resolve(undefined)
    reader.readAsDataURL(file)
  })
  const json = await request<{ item: FileRec }>('POST', '/files', { name: file.name, size: file.size, mimeType: file.type, dataUrl })
  return json.item
}

/** Static demo: synthesizes a small placeholder download so the click doesn't dead-end, rather than
 * fetching real stored bytes (there are none — see uploadFile's note). */
export async function downloadFile(id: string, name = 'file') {
  await downloadPath(`/files/${encodeURIComponent(id)}`, name)
}

/** Authenticated GET of any API path as a Response-like object (for PDFs/images the real server would
 * stream). Throws `ApiError` on failure, same as `request()`. */
export async function fetchAuthed(path: string, _retried = false): Promise<Response> {
  const token = getToken()
  const { status, json } = await dispatch('GET', path, undefined, token)
  if (status === 401 && !_retried) {
    if (await refreshAccessToken()) return fetchAuthed(path, true)
  }
  if (status < 200 || status >= 300) {
    const j = (json ?? {}) as Record<string, unknown> & { error?: string; details?: unknown }
    throw new ApiError(status, j.error || `Request failed (${status})`, j.details, j)
  }
  const dataUrl = (json as { dataUrl?: string } | null)?.dataUrl
  const blob = dataUrl ? await (await fetch(dataUrl)).blob() : new Blob(['This is a placeholder file from the Edkonic static demo.'], { type: 'text/plain' })
  return new Response(blob)
}

/** Downloads whatever `path` resolves to (e.g. `/certificates/:id/pdf`) — a real file's data URL if one
 * was uploaded, otherwise a placeholder, so the click always produces something. */
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
