// Mirrors server/src/routes/users.ts's contract for the endpoints the frontend actually calls:
// list (feeds src/lib/store.tsx's DB.users), create, patch, activate/deactivate, delete, and the
// role/class-scoped search endpoint AsyncEntityPicker (src/portal/components/AsyncEntityPicker.tsx)
// uses everywhere a flat <select> would be unusable at real-school scale.

import { route, requireAuth, requireRole } from '../router'
import { notFound } from '../http'
import { table, saveTable, uid, type Row } from '../store'
import { serializeUser } from '../serialize'

route('GET', '/users', (ctx) => {
  requireAuth(ctx)
  return { users: table('User').map(u => serializeUser(u)) }
})

route('GET', '/users/search', (ctx) => {
  requireAuth(ctx)
  const { q, role, classId, limit } = ctx.query
  let rows = table('User') as Row[]
  if (role) rows = rows.filter(u => u.role === role)
  if (q) {
    const needle = q.toLowerCase()
    rows = rows.filter(u => String(u.name).toLowerCase().includes(needle) || String(u.email).toLowerCase().includes(needle))
  }
  if (classId) {
    const enrolled = new Set(table('Enrollment').filter(e => e.classId === classId).map(e => e.studentId))
    const classSubjectTeacher = new Set(table('ClassSubject').filter(cs => cs.classId === classId).map(cs => cs.teacherId))
    rows = rows.filter(u => enrolled.has(u.id) || classSubjectTeacher.has(u.id))
  }
  const max = limit ? Number(limit) : 20
  const items = rows.slice(0, max).map(u => ({
    id: u.id, name: u.name, email: u.email, role: u.role,
    context: u.employeeId ?? (u.role === 'student' ? `${u.class ?? ''}-${u.section ?? ''}`.replace(/^-$/, '—') : '—'),
  }))
  return { items, nextCursor: rows.length > max ? String(items[items.length - 1]?.id ?? '') : undefined }
})

route('POST', '/users', (ctx) => {
  requireRole(ctx, 'admin', 'superadmin')
  const body = ctx.body as Partial<Row> & { name: string; role: string; password?: string }
  const rolePassword: Record<string, string> = {
    superadmin: 'principal123', admin: 'admin123', staff: 'staff123', teacher: 'teacher123', parent: 'parent123', student: 'student123',
  }
  const email = (body.email as string) ?? `${String(body.name).toLowerCase().replace(/[^a-z]+/g, '.')}@edkonic.in`
  const password = body.password ?? rolePassword[body.role] ?? 'welcome123'
  const users = table('User')
  const row: Row = {
    id: uid('u'), schoolId: users[0]?.schoolId ?? 'demo-school',
    avatarHue: Math.floor(Math.random() * 360), verified: true, active: true, mustChangePassword: true,
    title: `${body.role} · onboarded`, ...body, email, password,
  }
  users.push(row)
  saveTable('User', users)
  return { user: serializeUser(row, password), password }
})

route('PATCH', '/users/:id', (ctx) => {
  requireAuth(ctx)
  const users = table('User')
  const idx = users.findIndex(u => u.id === ctx.params.id)
  if (idx === -1) throw notFound('User')
  users[idx] = { ...users[idx], ...ctx.body }
  saveTable('User', users)
  return { user: serializeUser(users[idx]) }
})

route('PATCH', '/users/:id/active', (ctx) => {
  requireRole(ctx, 'admin', 'superadmin')
  const { active } = ctx.body as { active?: boolean }
  const users = table('User')
  const idx = users.findIndex(u => u.id === ctx.params.id)
  if (idx === -1) throw notFound('User')
  users[idx] = { ...users[idx], active: !!active }
  saveTable('User', users)
  return { user: serializeUser(users[idx]) }
})

route('DELETE', '/users/:id', (ctx) => {
  requireRole(ctx, 'admin', 'superadmin')
  const users = table('User')
  const idx = users.findIndex(u => u.id === ctx.params.id)
  if (idx === -1) throw notFound('User')
  users.splice(idx, 1)
  saveTable('User', users)
  return { ok: true }
})
