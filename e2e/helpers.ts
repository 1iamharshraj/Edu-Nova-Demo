import fs from 'node:fs'
import path from 'node:path'

// Playwright always runs from the repo root, so a cwd-relative path is simplest here — avoids the
// `__dirname` (CJS-only) vs `import.meta.url` dance for a plain "type": "module" package.
import type { APIRequestContext, Page } from '@playwright/test'

export const API_BASE = 'http://localhost:4000/api'

export const SUPERADMIN = { email: 'principal@edunova.in', password: 'principal123' }

// Where global-setup.ts caches the one-time superadmin login. Kept outside e2e/ so it never gets
// mistaken for a test file.
export const AUTH_CACHE_PATH = path.join(process.cwd(), 'node_modules', '.cache', 'e2e-superadmin-auth.json')

// The backend rate-limits POST /auth/login to 10 attempts / 15 min per IP (Phase 10 §4, exercised
// directly by login.spec.ts). To stay well under that across the whole suite, the superadmin logs in
// exactly ONCE (see global-setup.ts) and every reset/setup call below reuses that cached token instead
// of hitting /auth/login again. Only login.spec.ts (which tests login itself) and each test's own
// distinct student/teacher/parent/staff fixture accounts call /auth/login for real.
export function cachedSuperadminToken(): { token: string; refreshToken: string } {
  return JSON.parse(fs.readFileSync(AUTH_CACHE_PATH, 'utf8'))
}

/** Logs in via the raw API (fast — no UI) and returns the access token + user id. */
export async function apiLogin(request: APIRequestContext, email: string, password: string) {
  const res = await request.post(`${API_BASE}/auth/login`, { data: { email, password } })
  if (!res.ok()) throw new Error(`apiLogin failed for ${email}: ${res.status()} ${await res.text()}`)
  const json = await res.json()
  return { token: json.token as string, refreshToken: json.refreshToken as string, user: json.user }
}

/** Resets the school to empty (only the caller's own account survives). Superadmin only. */
export async function resetSchool(request: APIRequestContext, token: string) {
  const res = await request.post(`${API_BASE}/admin/reset`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { confirm: 'RESET' },
  })
  if (!res.ok()) throw new Error(`resetSchool failed: ${res.status()} ${await res.text()}`)
}

/** Loads the bundled sample-school fixture (school must be empty). Superadmin only. */
export async function loadSampleData(request: APIRequestContext, token: string) {
  const res = await request.post(`${API_BASE}/admin/load-sample-data`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok()) throw new Error(`loadSampleData failed: ${res.status()} ${await res.text()}`)
}

/** Resets the school using the cached superadmin token (no fresh /auth/login call). */
export async function resetViaApi(request: APIRequestContext) {
  const { token } = cachedSuperadminToken()
  await resetSchool(request, token)
  return token
}

/** Logs a role in through the real UI login form. Only use this where the test cares about the actual
 * login journey (login.spec.ts) — everywhere else, prefer `tokenLogin` to avoid spending the shared
 * /auth/login rate-limit budget on a login the test isn't actually about. */
export async function uiLogin(page: Page, email: string, password: string) {
  await page.goto('/login')
  const emailInput = page.locator('input[type="email"]')
  const passInput = page.locator('input[type="password"]')
  await emailInput.fill(email)
  await passInput.fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/** Logs a page in by injecting already-obtained tokens into localStorage (one /auth/login call already
 * spent to get them via `apiLogin`) instead of submitting the login form again. The app's boot sequence
 * (src/lib/store.tsx) reads the token from localStorage and calls GET /auth/me — not /auth/login — so
 * this is safe against the login rate limiter and still exercises every screen through the real UI. */
export async function tokenLogin(page: Page, token: string, refreshToken: string) {
  await page.goto('/login')
  await page.locator('input[type="email"]').waitFor()
  await page.evaluate(([t, r]) => {
    localStorage.setItem('edunova_token_v1', t)
    localStorage.setItem('edunova_refresh_token_v1', r)
  }, [token, refreshToken])
  await page.goto('/portal')
}

/** Small typed helper for authenticated JSON API calls from within a test (setup speed, not UI). */
export async function authedJson(
  request: APIRequestContext,
  token: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  data?: unknown,
) {
  const res = await request.fetch(`${API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    data,
  })
  if (!res.ok()) throw new Error(`${method} ${path} failed: ${res.status()} ${await res.text()}`)
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

/**
 * Builds a minimal "empty school -> one class with people in it" fixture through the real API, the
 * same way an admin would through the UI. Used as fast setup for tests whose actual subject under
 * test is a different flow (publishing a timetable, marking attendance, paying an invoice) — per the
 * task brief, API-seeding a precondition and testing the real flow through the UI is fine here.
 * Mirrors server/test/helpers/fixtures.ts buildFixture().
 */
export async function buildMinimalFixture(request: APIRequestContext, saToken: string) {
  const post = (path: string, data: unknown) => authedJson(request, saToken, 'POST', path, data)
  const patch = (path: string, data: unknown) => authedJson(request, saToken, 'PATCH', path, data)

  const year = await post('/academic/years', { label: '2026-27', startDate: '2026-06-01', endDate: '2027-05-31' })
  const yearId = year.item.id as string

  const term = await post('/academic/terms', { academicYearId: yearId, name: 'Term 1', startDate: '2026-06-01', endDate: '2026-09-30' })
  const termId = term.item.id as string

  const board = await post('/academic/boards', { name: 'Central Board', code: 'CBSE' })
  const boardId = board.item.id as string

  const grade = await post('/academic/grades', { label: 'VIII' })
  const gradeId = grade.item.id as string

  const subject = await post('/academic/subjects', { name: 'Mathematics', code: 'MATH', color: '#4f46e5' })
  const subjectId = subject.item.id as string

  const room = await post('/academic/rooms', { name: 'C-101', kind: 'classroom', capacity: 40 })
  const roomId = room.item.id as string

  const cls = await post('/academic/classes', { academicYearId: yearId, boardId, gradeId, section: 'A', capacity: 10 })
  const classId = cls.item.id as string

  const teacher = await post('/users', { role: 'teacher', name: 'Kavya Rao' })
  const staff = await post('/users', { role: 'staff', name: 'Farhan Qureshi' })
  const student = await post('/users', { role: 'student', name: 'Ishaan Student', classId, rollNo: '1' })
  const parent = await post('/users', { role: 'parent', name: 'Meenakshi Rao', studentIds: [student.user.id] })

  const classSubject = await post('/academic/class-subjects', { classId, subjectId, teacherId: teacher.user.id, periodsPerWeek: 5 })
  await patch(`/academic/classes/${classId}`, { classTeacherId: teacher.user.id })

  // A period template is a prerequisite for the Timetable Builder grid to render anything — it's pure
  // fixture setup (not the flow under test), so it's fine to create it via the API rather than the UI.
  const template = await post('/timetable/period-templates', {
    name: 'Standard day',
    isDefault: true,
    periods: [
      { idx: 1, label: 'P1', start: '09:00', end: '09:45', kind: 'class' },
      { idx: 2, label: 'P2', start: '09:45', end: '10:30', kind: 'class' },
    ],
  })

  return {
    yearId, termId, boardId, gradeId, classId, subjectId, roomId,
    classSubjectId: classSubject.item.id as string,
    templateId: template.item.id as string,
    teacher: teacher.user as { id: string; email: string },
    staff: staff.user as { id: string; email: string },
    student: student.user as { id: string; email: string },
    parent: parent.user as { id: string; email: string },
  }
}
