// Typed fetch client for the EduNova API. Every module talks to the server through this —
// never through raw fetch — so auth headers, error shapes and the base URL live in one place.

export const API_BASE = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE || 'http://localhost:4000/api'
const TOKEN_KEY = 'edunova_token_v1'

export class ApiError extends Error {
  status: number
  details?: unknown
  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${API_BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  if (res.status === 204) return null as T
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, json.error || `Request failed (${res.status})`, json.details)
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
  del: <T = Loose>(path: string) => request<T>('DELETE', path),
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 409) return e.message || 'That already exists.'
    if (e.status === 403) return 'You don’t have permission to do that.'
    return e.message
  }
  return e instanceof Error ? e.message : 'Something went wrong.'
}
