# Phase 0 + 1 — API & data contract

> This is the contract both the server and the frontend build against. Keep it in sync with the code.

## Design decision: legacy fields stay, populated by the server

The ~40 legacy screens read `user.class` (e.g. `"X-A"`), `user.section`, `user.roll`, `user.subjects[]`, `user.parentEmail`, `user.wards`, plus `db.terms` / `db.subjects` in their old shapes. Phase 1 introduces the real entities (Class, Enrollment, Guardian, ClassSubject, Term, Subject) and the **server keeps the legacy columns denormalised** from them, so old screens keep working while new screens use the real ids. The legacy columns get dropped when the last screen stops reading them (Phase 3+).

## Prisma models (additions)

```
AcademicYear  id, schoolId, label, startDate, endDate, isCurrent
Term          id, schoolId, academicYearId, name, startDate, endDate, isCurrent
Class         id, schoolId, academicYearId, grade, section, classTeacherId?, capacity?      unique(schoolId, academicYearId, grade, section)
Subject       id, schoolId, name, code, color                                                unique(schoolId, name)
ClassSubject  id, schoolId, classId, subjectId, teacherId?, periodsPerWeek                   unique(classId, subjectId)
Room          id, schoolId, name, kind, capacity?                                             unique(schoolId, name)
Enrollment    id, schoolId, studentId, classId, academicYearId, rollNo?, status              unique(studentId, academicYearId)
Guardian      id, schoolId, parentId, studentId, relation                                    unique(parentId, studentId)
AuditLog      id, schoolId, actorId, action, entity, entityId, before Json?, after Json?, at
User          + mustChangePassword Boolean default false   (legacy columns kept)
```

Ids: cuid for new entities, EXCEPT sample data uses fixed ids `t1 t2 t3` for terms and `math phy chem eng cs pe` for subjects so the JSON blob (timetable/marks keyed by term id) still lines up.

Deletes cascade: Class → Enrollment, ClassSubject; User → Enrollment, Guardian, ClassSubject.teacherId set null, Class.classTeacherId set null; AcademicYear → Term, Class (and their children); Subject → ClassSubject.

## Frontend types (`src/lib/data.ts`)

```ts
export interface AcademicYear { id: string; label: string; startDate: string; endDate: string; isCurrent: boolean }
export interface TermRec { id: string; academicYearId: string; name: string; startDate: string; endDate: string; isCurrent: boolean }
export interface ClassRec { id: string; academicYearId: string; grade: string; section: string; label: string; classTeacherId?: string; capacity?: number }
export interface SubjectRec { id: string; name: string; code: string; color: string }
export interface ClassSubject { id: string; classId: string; subjectId: string; teacherId?: string; periodsPerWeek: number }
export interface Room { id: string; name: string; kind: 'classroom' | 'lab' | 'ground' | 'hall' | 'other'; capacity?: number }
export interface Enrollment { id: string; studentId: string; classId: string; academicYearId: string; rollNo?: string; status: 'active' | 'transferred' | 'graduated' }
export interface Guardian { id: string; parentId: string; studentId: string; relation: string }
export interface AcademicState { years: AcademicYear[]; terms: TermRec[]; classes: ClassRec[]; subjects: SubjectRec[]; classSubjects: ClassSubject[]; rooms: Room[]; enrollments: Enrollment[]; guardians: Guardian[] }
```

`label` on ClassRec is computed server-side as `${grade}-${section}`. Dates are `YYYY-MM-DD` strings.

## Endpoints

Conventions: JSON; auth via `Authorization: Bearer <jwt>`; single → `{ item }`, list → `{ items }`, delete → `{ ok: true }`; errors → `{ error: string, details?: unknown }` with 400 (validation), 401, 403, 404, 409 (unique conflict / in-use). Validation with zod. Writes below require role `admin` or `superadmin` unless stated; reads any authenticated role.

### `/api/academic`
| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/bootstrap` | — | returns `AcademicState` (all lists for the school) |
| GET/POST | `/years` | `{label, startDate, endDate}` | POST: first year created becomes current automatically |
| PATCH/DELETE | `/years/:id` | partial | DELETE cascades terms + classes |
| POST | `/years/:id/set-current` | — | clears isCurrent on the others |
| GET/POST | `/terms` | `{academicYearId, name, startDate, endDate}` | |
| PATCH/DELETE | `/terms/:id` | partial | |
| POST | `/terms/:id/set-current` | — | one current term per school |
| GET/POST | `/classes` | `{academicYearId, grade, section, classTeacherId?, capacity?}` | 409 on duplicate grade+section in a year |
| PATCH/DELETE | `/classes/:id` | partial | |
| GET | `/classes/:id/roster` | — | `{ items: { user, enrollment }[] }` active students |
| GET/POST | `/subjects` | `{name, code, color}` | 409 on duplicate name |
| PATCH/DELETE | `/subjects/:id` | partial | DELETE 409 if referenced by timetable? (not in Phase 1 — cascade ClassSubject) |
| GET/POST | `/class-subjects` | `{classId, subjectId, teacherId?, periodsPerWeek}` | 409 on duplicate class+subject; teacherId must be a `teacher` |
| PATCH/DELETE | `/class-subjects/:id` | partial | |
| GET/POST | `/rooms` | `{name, kind, capacity?}` | |
| PATCH/DELETE | `/rooms/:id` | partial | |
| GET/POST | `/enrollments` | `{studentId, classId, rollNo?}` | academicYearId derived from class; 409 if student already enrolled in that year (use PATCH to move) |
| PATCH/DELETE | `/enrollments/:id` | `{classId?, rollNo?, status?}` | |
| GET/POST | `/guardians` | `{parentId, studentId, relation?}` | parent must be role parent, student role student |
| DELETE | `/guardians/:id` | — | |

Every write recomputes legacy user fields for affected users (see below) and writes an AuditLog row.

### `/api/users` (changes)
- `POST /` body gains: `classId?`, `rollNo?` (students → creates Enrollment), `studentIds?: string[]` (parents → creates Guardians), `classTeacherOf?: classId` (teachers → sets Class.classTeacherId). Also accepts `email?`, `password?` (else defaults from `userDefaults.ts`). **Requester must be allowed to manage the target role** (port `canManage` with a synthetic target). Response `{ user, password }` — plain password returned once.
- `PATCH /:id` (keep `PUT` as alias) accepts the same extra fields; `classId` moves the active enrollment for the current year (or creates one); `studentIds` replaces the guardian set; `classTeacherOf` reassigns.
- `DELETE /:id` cascades as above.

### `/api/data`
- `GET /` — blob with `terms` and `subjects` **overridden** by derived legacy shapes:
  - Term: `{ id, name, range: "Jun – Sep 2025", months: ["June", …], current }` (range/months derived from start/end dates)
  - Subject: `{ id, name, teacher: "<distinct teacher names across ClassSubjects, comma-joined, or '—'>", color }`
- `PUT /` — ignores `users`, `terms`, `subjects` keys if present.

### `/api/admin` (superadmin only unless noted)
| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/load-sample-data` | — | Loads the demo school: year 2025-26, terms t1–t3, classes X-A X-B IX-A IX-B, 6 subjects, rooms, all seed users, enrollments, guardians, class-subjects, and the JSON blob. Refuses (409) if any class already exists. |
| POST | `/reset` | `{ confirm: "RESET" }` | Deletes everything in the school except the requesting superadmin; clears the blob. |
| GET | `/audit?limit=50&before=<iso>` | — | admin or superadmin; newest first |

`/api/reset` (old) is removed.

### Seed (`npm run db:seed`)
One School + one superadmin: `principal@edunova.in` / `principal123`, `mustChangePassword: true`. Nothing else.

## Legacy field derivation (server, `syncLegacyUserFields(userIds[])`)
- **student**: `class` = class label ("X-A") of the active enrollment in the current year (or most recent), `section` = class.section, `roll` = enrollment.rollNo, `parentEmail` = email of the first guardian's parent, `title` = `Class ${label} · Roll ${roll}` if not custom.
- **teacher**: `subjects` = distinct subject names where ClassSubject.teacherId = teacher; `class` = label of the Class where classTeacherId = teacher (else null); `title` = `${subjects.join(', ')} · Class Teacher ${class}` when both exist.
- **parent**: `wards` = names of guardian students, comma-joined; `title` = `Parent of ${firstWard} · ${firstWardClass}`.
Recompute after any enrollment / guardian / class-subject / class / user change touching those users.

## Frontend store additions (`src/lib/store.tsx`)
```ts
academic: AcademicState           // fetched at boot via /academic/bootstrap
refreshAcademic(): Promise<void>  // refetch after any academic write
refreshDB(): Promise<void>        // refetch users + data (after load-sample / reset)
```
Term context default = the current term's id (falls back to first term, else `''`).

## Client helpers (`src/lib/api.ts`)
`api.get/post/patch/put/del(path, body?)` — throws `ApiError { status, message, details }`. `useEntity(name)` hook in `src/lib/hooks/useEntity.ts` wraps list/create/update/remove for an `/api/academic/<name>` collection with toast on error and `refreshAcademic()` on success.
