// Ported from src/lib/store.tsx (client) so user-creation defaults match exactly server-side.

export type Role = 'parent' | 'student' | 'teacher' | 'staff' | 'admin' | 'superadmin'

export function makeEmail(name: string, role: Role) {
  const base = name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/(^\.|\.$)/g, '')
  if (role === 'student') return `${base}@edunova.in`
  if (role === 'parent') return `parent.${base}@edunova.in`
  if (role === 'teacher') return `${base}@edunova.in`
  if (role === 'staff') return `${base}@edunova.in`
  if (role === 'admin') return `${base}@edunova.in`
  return `${base}@edunova.in`
}

export function rolePassword(role: Role) {
  if (role === 'superadmin') return 'principal123'
  if (role === 'admin') return 'admin123'
  if (role === 'staff') return 'staff123'
  if (role === 'teacher') return 'teacher123'
  if (role === 'parent') return 'parent123'
  return 'student123'
}

export function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

export function idPrefixFor(role: Role) {
  return role === 'student' ? 'u-s' : role === 'parent' ? 'u-p' : role === 'teacher' ? 'u-t' : role === 'staff' ? 'u-st' : 'u-a'
}
