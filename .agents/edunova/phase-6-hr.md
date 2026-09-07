# Phase 6 — HR (leave, contracts, resignations, duties)

> Same conventions. Replaces blob keys `leaves`, `contracts`, `resignations`, `workAssign`, and `User.contract/resignation` JSON columns.

## Model
```
LeaveType      id, schoolId, name "Casual", daysPerYear, appliesTo student|staff       unique(schoolId, name, appliesTo)
LeaveRequest   id, schoolId, requesterId, forUserId, leaveTypeId?, fromDate, toDate, days (computed, excluding Sundays), reason,
               status Pending|Approved|Declined|Cancelled, decidedById?, decidedAt?, decisionNote?, createdAt
Contract       id, schoolId, userId, designation, department?, startDate, endDate?, terms (text), status Draft|Active|Ended,
               employeeSignedAt?, adminSignedAt?, adminSignedById?, endedAt?, endReason?, pdfFileId?
Resignation    id, schoolId, userId, reason, submittedAt, lastWorkingDate, status Pending|Approved|Declined|Withdrawn, decidedById?, decidedAt?, notes?
Duty           id, schoolId, title, eventTitle, eventDate, assigneeId?, createdById, status Assigned|Done, notes?
```

## Endpoints
### `/api/leave`
| GET/POST/PATCH/DELETE | `/types` (admin) | |
| GET | `/requests?forUserId&status&scope=mine|approvals` | student/parent: own/wards; teacher: own + `approvals` for students in their classes; staff/admin: all |
| POST | `/requests` | `{ forUserId, leaveTypeId?, fromDate, toDate, reason }` — parent for a ward, student for self, teacher/staff for self |
| POST | `/requests/:id/approve` · `/decline` `{note}` · `/cancel` (requester, while Pending) | approver: student leave → class teacher / staff / admin; staff leave → admin/superadmin |
| GET | `/balance?userId&year` | per type: allowed, used, remaining |

### `/api/hr`
| GET | `/contracts?userId&status` | employee own; admin all |
| POST | `/contracts` | admin `{ userId, designation, department?, startDate, endDate?, terms }` → Draft |
| PATCH | `/contracts/:id` | admin while Draft |
| POST | `/contracts/:id/sign` | employee (`employeeSignedAt`) or admin (`adminSignedAt`); Active when both signed |
| POST | `/contracts/:id/end` | admin `{ reason }` → Ended; deactivates payroll structure? — no: leave payroll, but `POST /payroll/run` only includes Active contracts from now on |
| GET | `/contracts/:id.pdf` | |
| GET/POST | `/resignations` | employee submits `{ reason, lastWorkingDate }` (notice check: ≥ 30 days unless admin overrides) |
| POST | `/resignations/:id/approve` `{notes}` (ends the contract on lastWorkingDate, sets `User.active=false` after that date — add `User.active Boolean default true`; login refused when inactive) · `/decline` · `/withdraw` (employee) | |
| GET/POST/PATCH/DELETE | `/duties?assigneeId` | staff/admin manage; assignee can mark Done |

`GET /api/data` drops `leaves`, `contracts`, `resignations`, `workAssign`; PUT strips. Legacy `User.contract/resignation/salary` no longer read (leave columns).

## Sample data
Leave types Casual (12, staff), Sick (10, staff), Student leave (unlimited → daysPerYear 0). Seed leaves ported. Contracts from `makeContract` (Active, both signed). Resignation res1 Pending. Duties from `workAssign` with assignees (Meera, Arjun).

## Frontend
- `LeaveMod` (parent/student create for ward/self with type; approvers with balances) and a new **My Leave** for teachers/staff (replaces the fake `TeacherLeaveMod` in Portal.tsx) with balance card + history; admin **Leave types** in Settings or HR.
- `ContractMod` (employee): view contract, **Sign**, download PDF, **Resign** (real submit) with notice-period calc; withdraw while Pending.
- `ContractsResignationsMod` (admin): create/edit/sign/end contracts; approve/decline resignations (ending the contract).
- `WorkAssignMod`: duties with an assignee picker; assignee marks done; "Event duties" for teachers shows own.
- Overview: teacher "Leave requests" = approvals pending for their classes; admin "Resignations" from `/hr/resignations`.
