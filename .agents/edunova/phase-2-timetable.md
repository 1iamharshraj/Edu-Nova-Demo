# Phase 2 — Timetable

> Builds on `phase-0-1-contract.md` and `phase-1b-boards-curriculum.md`. Same conventions (zod, `requireRole`, audit, `{item}`/`{items}`/`{ok}`, 409 on conflicts).

## Goal
Admin builds a timetable per class per term from that class's subjects; conflicts are rejected on write; students/parents see their class's published grid; teachers see their own periods across classes plus substitutions. The legacy `db.timetable` blob and `TIMESLOTS` constant are no longer read by the app.

## Model
```
PeriodTemplate   id, schoolId, name, isDefault, periods Json  [{ idx:number, label:"P1", start:"09:00", end:"09:45", kind:"class"|"break" }]
                 exactly one isDefault per school (service enforces); Class.periodTemplateId? overrides
TimetableEntry   id, schoolId, classId, termId, dayOfWeek 1..6, periodIdx, classSubjectId, roomId?, teacherId?
                 unique(classId, termId, dayOfWeek, periodIdx)
                 teacherId defaults to the ClassSubject's teacher at write time; can be overridden per entry
TimetablePublish id, schoolId, classId, termId, publishedAt              unique(classId, termId)
Substitution     id, schoolId, timetableEntryId, date (YYYY-MM-DD), substituteTeacherId, reason?   unique(timetableEntryId, date)
```
Cascades: Class/Term → TimetableEntry, TimetablePublish; ClassSubject → TimetableEntry; TimetableEntry → Substitution; Room → TimetableEntry.roomId set null; User → TimetableEntry.teacherId set null, Substitution cascade; PeriodTemplate → Class.periodTemplateId set null.

## Conflict rules (checked server-side on every write, across the whole school for that term)
1. A **teacher** cannot have two entries with the same (termId, dayOfWeek, periodIdx) in different classes.
2. A **room** cannot have two entries with the same (termId, dayOfWeek, periodIdx).
3. `periodIdx` must exist in the class's effective period template and have `kind:"class"`.
4. `classSubjectId` must belong to `classId`.
Violations → `409 { error, conflicts: [{ rule:"teacher"|"room", entryId, classId, classLabel, dayOfWeek, periodIdx, teacherId?, roomId? }] }`. Bulk writes are all-or-nothing.

## Endpoints (`/api/timetable`, auth required; writes admin|superadmin)
| Method | Path | Body / notes |
|---|---|---|
| GET/POST | `/period-templates` | `{name, periods[], isDefault?}` — first one created becomes default |
| PATCH/DELETE | `/period-templates/:id` | DELETE refused (409) if it is the default and other templates exist… simply: cannot delete the default while any class has entries |
| POST | `/period-templates/:id/set-default` | |
| GET | `/?classId&termId` | `{ template, entries, published: bool, publishedAt? }`. **student/parent**: 403 unless the requester (or a ward) is enrolled in that class, and returns `entries: []` with `published:false` if not published. **teacher**: any class. |
| GET | `/teacher/:userId?termId` | `{ entries (with classLabel, subjectName, roomName), substitutions }` — teacher may only request their own id unless admin/staff |
| GET | `/me?termId` | resolves for the caller: student → own class; parent → `?studentId` (must be a ward) ; teacher → own entries |
| PUT | `/entries` | `{ classId, termId, entries: [{dayOfWeek, periodIdx, classSubjectId, roomId?, teacherId?}] }` — **replaces** the class×term grid with this set (delete missing, upsert present), validated as one transaction |
| DELETE | `/entries/:id` | |
| POST | `/copy` | `{ fromClassId, fromTermId, toClassId, toTermId }` — target must be empty; maps by subject (classSubject of the target class with the same subjectId); entries whose subject the target lacks are skipped and reported `{ copied, skipped[] }`; conflicts → 409 |
| POST | `/publish` | `{ classId, termId, published: boolean }` |
| GET/POST | `/substitutions` | `{ timetableEntryId, date, substituteTeacherId, reason? }`; GET `?date&teacherId&classId` |
| DELETE | `/substitutions/:id` | |

Bootstrap (`GET /api/academic/bootstrap`) adds `periodTemplates`. Timetable entries are **not** in bootstrap — fetched per screen.

## Sample data
Default template "Standard day" from the old `TIMESLOTS`: P1 09:00–09:45, P2 09:45–10:30, Morning Break 10:30–10:45 (break), P3 11:30–12:15… keep the old eleven slots (8 classes + 3 breaks) with the old times. Entries for all 4 classes × 3 terms generated like the old `makeTT` rotation (subject i → room i, teacher = class-subject teacher), skipping any assignment that would violate a conflict (rotate the shift per class so teachers don't collide). Publish all.

## Frontend
Types (`src/lib/data.ts`): `PeriodDef { idx; label; start; end; kind }`, `PeriodTemplate { id; name; isDefault; periods: PeriodDef[] }`, `TimetableEntry { id; classId; termId; dayOfWeek; periodIdx; classSubjectId; roomId?; teacherId? }`, `Substitution { id; timetableEntryId; date; substituteTeacherId; reason? }`. `AcademicState.periodTemplates`. `ClassRec.periodTemplateId?`.

Screens:
- **Academic Setup → Periods** (`PeriodsMod`, in `academic.tsx`): templates list; editor with rows (label, start, end, kind) add/remove/reorder; set default; class override is chosen in the class edit form ("Period template" select, default = school default).
- **Timetable Builder** (`TimetableBuilderMod`, new file `src/portal/modules/timetableBuilder.tsx`, admin/superadmin, group "Academic Setup" after Classes): pick class + term; grid days (Mon–Sat from the template — show Sat only if any entry or via toggle; default Mon–Fri) × periods; break columns rendered as narrow strips; click a cell → popover/modal: subject select (the class's ClassSubjects, teacher shown), room select, optional teacher override; clear. Local draft state; **Save** → `PUT /entries` with the full grid; on 409 highlight the conflicting cells with the message; unsaved-changes indicator; **Copy from…** (class + term picker) ; **Publish / Unpublish** toggle with pill; per-subject counter vs `periodsPerWeek` ("Mathematics 5/6") in a side panel.
- **Timetable** (`TimetableMod`, rewrite `timetable.tsx`): data from `GET /timetable/me` (student/parent — parent with >1 ward gets a ward select) or `GET /timetable/teacher/:id` (teacher — cells show class label + subject + room; substitutions for the current week highlighted) or, for admin/staff, a class picker over `GET /timetable`. Uses the class's template for columns. Unpublished → Empty "Timetable not published yet". Keep the readable-card style from the current file.
- **Overview**: student "Next class" tile from today's entries + clock; teacher "Classes today" count.
- Delete: all reads of `db.timetable`, `TIMESLOTS`, `DAYS` from the timetable module (keep constants in data.ts only if the sample loader still imports them; otherwise delete).
