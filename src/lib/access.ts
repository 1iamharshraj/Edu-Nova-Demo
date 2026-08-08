import type { Role, User } from './data'

export const ROLE_RANK: Record<Role, number> = {
  superadmin: 5,
  admin: 4,
  staff: 3,
  teacher: 3,
  parent: 2,
  student: 1,
}

export function isSuperAdmin(u: User | null): boolean {
  return u?.role === 'superadmin'
}

export function isAdmin(u: User | null): boolean {
  return u?.role === 'admin' || u?.role === 'superadmin'
}

export function isStaffOrAdmin(u: User | null): boolean {
  return u?.role === 'staff' || u?.role === 'admin' || u?.role === 'superadmin'
}

export function canManage(current: User, target: User, allUsers: User[]): boolean {
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
  if (current.role === 'staff' || current.role === 'teacher') {
    return target.role === 'student' || target.role === 'parent'
  }
  return false
}

export function canViewStudentProfile(current: User): boolean {
  return isAdmin(current) || current.role === 'staff' || current.role === 'teacher'
}

export function canViewFeeDefaulters(current: User): boolean {
  return isAdmin(current) || current.role === 'staff' || current.role === 'teacher'
}

export function canEditCalendar(current: User): boolean {
  return isAdmin(current) || current.role === 'staff'
}

export function canApproveResignation(current: User): boolean {
  return isAdmin(current)
}

export function canManageDisciplinary(current: User): boolean {
  return isAdmin(current) || current.role === 'staff' || current.role === 'teacher'
}
