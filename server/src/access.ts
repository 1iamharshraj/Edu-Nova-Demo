// Ported from src/lib/access.ts so the same authorization rule is enforced server-side.
import type { Role } from './userDefaults'

export interface MinimalUser { id: string; role: Role }

export const ROLE_RANK: Record<Role, number> = {
  superadmin: 5,
  admin: 4,
  staff: 3,
  teacher: 3,
  parent: 2,
  student: 1,
}

export function isSuperAdmin(u: MinimalUser | null): boolean {
  return u?.role === 'superadmin'
}

export function canManage(current: MinimalUser, target: MinimalUser, allUsers: MinimalUser[]): boolean {
  if (current.id === target.id) return false
  if (isSuperAdmin(current)) {
    if (isSuperAdmin(target)) {
      const superadmins = allUsers.filter(u => u.role === 'superadmin')
      return superadmins.length > 1
    }
    return true
  }
  if (current.role === 'admin') {
    return ROLE_RANK[target.role] < ROLE_RANK.admin
  }
  if (current.role === 'staff') {
    return target.role === 'student' || target.role === 'parent' || target.role === 'teacher'
  }
  if (current.role === 'teacher') {
    return target.role === 'student' || target.role === 'parent'
  }
  return false
}
