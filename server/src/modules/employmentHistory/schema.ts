import { z } from 'zod'

// See phase-11-employee-management.md → A4. Append-only log of role/designation/department/salary
// changes. There is no create/update/delete endpoint exposed to clients — rows are only ever written by
// `logChange()` (service.ts), called from routes/users.ts and modules/payroll/service.ts after the real
// write already succeeded.
export const CHANGE_TYPES = ['Role', 'Designation', 'Department', 'Salary', 'ClassTeacherAssignment', 'Other'] as const
export type ChangeType = (typeof CHANGE_TYPES)[number]
