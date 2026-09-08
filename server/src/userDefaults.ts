// Ported from src/lib/store.tsx (client) so user-creation defaults match exactly server-side.

import crypto from 'node:crypto'

export type Role = 'parent' | 'student' | 'teacher' | 'staff' | 'admin' | 'superadmin'

// Roles that get an employee ID (A1), can appear in a `reportsTo` chain (A2), and are reviewable /
// document-able under Phase 11 (A3/A4/A5/A6). Mirrors the local `EMPLOYEE_ROLES` already used by
// modules/hr/service.ts and modules/payroll/service.ts (`PAYROLL_ROLES`) — kept here as the one shared
// copy for the new Phase 11 modules so they don't each redeclare it.
export const EMPLOYEE_ROLES: Role[] = ['teacher', 'staff', 'admin', 'superadmin']

export function makeEmail(name: string, role: Role) {
  const base = name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/(^\.|\.$)/g, '')
  if (role === 'student') return `${base}@edunova.in`
  if (role === 'parent') return `parent.${base}@edunova.in`
  if (role === 'teacher') return `${base}@edunova.in`
  if (role === 'staff') return `${base}@edunova.in`
  if (role === 'admin') return `${base}@edunova.in`
  return `${base}@edunova.in`
}

// Random one-time password — same generator used by admissions (applications/service.ts) and
// auth.ts's admin/set-password. Account-creation paths must use this (plus mustChangePassword: true),
// never a static per-role password (see git history: userDefaults.ts's old `rolePassword()` handed out
// the same guessable password — e.g. `staff123` — to every account of a role).
export function genPassword() {
  return crypto.randomBytes(6).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x').slice(0, 8) + '2k'
}

export function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

export function idPrefixFor(role: Role) {
  return role === 'student' ? 'u-s' : role === 'parent' ? 'u-p' : role === 'teacher' ? 'u-t' : role === 'staff' ? 'u-st' : 'u-a'
}
