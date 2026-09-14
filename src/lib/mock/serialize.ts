// Shared row → client-JSON shaping used by more than one mock module. Module-specific serializers
// live in their own module file; only genuinely cross-cutting ones (User, above all — referenced by
// auth, users, hr, academic, timetable, …) belong here.

import type { Row } from './store'

export function serializeUser(u: Row, plainPassword?: string) {
  return {
    id: u.id, role: u.role, name: u.name, email: u.email,
    password: plainPassword ?? '••••••••',
    title: u.title, avatarHue: u.avatarHue, verified: u.verified,
    mustChangePassword: u.mustChangePassword ?? false,
    employeeId: u.employeeId, department: u.department, designation: u.designation,
    reportsTo: u.reportsTo, joinDate: u.joinDate, phone: u.phone, dob: u.dob,
    photoFileId: u.photoFileId, emergencyContact: u.emergencyContact, address: u.address,
    lastLoginAt: u.lastLoginAt, isCounselor: u.isCounselor ?? false, active: u.active ?? true,
    declaredBandAffinity: u.declaredBandAffinity, verifiedBandAffinity: u.verifiedBandAffinity,
    affinitySource: u.affinitySource,
    class: u.class, section: u.section, roll: u.roll, subjects: u.subjects, board: u.board,
    salary: u.salary, wards: u.wards,
  }
}
