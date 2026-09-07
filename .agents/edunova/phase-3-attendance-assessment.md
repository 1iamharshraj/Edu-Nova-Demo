# Phase 3 — Attendance, assessment, homework, files

> Same conventions as the earlier contracts. Replaces the legacy blob keys `attendance`, `attendanceRecords`, `marks`, `ranks`, `directory`, `homework`, `workUploads`.

## Model
```
File                 id, schoolId, uploaderId, name, mime, size, path, sha256, createdAt
AttendanceSession    id, schoolId, classId, date (YYYY-MM-DD), periodIdx? (null = day attendance), markedById, lockedAt?
                     unique(classId, date, periodIdx)   — Postgres treats NULL as distinct: service enforces uniqueness for the null case
AttendanceRecord     id, sessionId, studentId, status P|A|L|E|H, note?        unique(sessionId, studentId)
StaffAttendance      id, schoolId, userId, date, status P|A|L|H, markedById  unique(userId, date)
GradeScale           id, schoolId, name, boardId?, bands Json [{ min:number, grade:"A1", points?:number }]  (sorted desc by min)
Assessment           id, schoolId, classSubjectId, termId, name, maxMarks, weight (default 1), date?, publishedAt?
Mark                 id, assessmentId, studentId, score (Decimal/Float), remark?          unique(assessmentId, studentId)
Homework             id, schoolId, classSubjectId, title, description, dueDate, createdById, attachments String[] (File ids)
HomeworkSubmission   id, homeworkId, studentId, submittedAt, files String[], status Submitted|Late|Graded|Returned, grade?, feedback?
                     unique(homeworkId, studentId)
```
Cascades: Class → sessions; ClassSubject → assessments, homework; Assessment → marks; Homework → submissions; User(student) → records, marks, submissions.

## Authorisation
- Teacher may write attendance/assessments/marks/homework only for classes where they are the class teacher or have a ClassSubject (`classesTaughtBy`). Staff/admin/superadmin: any class.
- Students see their own records/marks (published assessments only) and homework of their class; parents see their wards'.
- Locked sessions (`lockedAt`) reject record edits except by admin/superadmin.

## Endpoints
### `/api/attendance`
| Method | Path | Body / notes |
|---|---|---|
| GET | `/sessions?classId&from&to` | sessions with records |
| POST | `/sessions` | `{ classId, date, periodIdx?, records: [{studentId, status, note?}] }` — creates or **replaces** that session's records (upsert by unique) |
| PATCH | `/sessions/:id/records` | `{ records: [...] }` partial upsert |
| POST | `/sessions/:id/lock` · `/unlock` | admin/superadmin for unlock |
| DELETE | `/sessions/:id` | admin/superadmin |
| GET | `/summary?studentId&termId` or `?classId&termId` | `{ bySubject? , overall: {present,total,pct}, days: [{date,status}] }` — for a student, "bySubject" groups period sessions by the timetable entry's subject for that day/period (if the timetable exists), else just overall |
| GET/POST | `/staff?date` · `{ userId, date, status }` (staff/admin) | |
| GET | `/staff/summary?userId&from&to` | |

### `/api/assessments`
| GET | `/?classSubjectId&termId` or `?classId&termId` | includes `marks` when caller may see them (teacher/admin: all; student/parent: own, published only) |
| POST | `/` | `{ classSubjectId, termId, name, maxMarks, weight?, date? }` |
| PATCH/DELETE | `/:id` | |
| PUT | `/:id/marks` | `{ marks: [{ studentId, score, remark? }] }` upsert; score ≤ maxMarks |
| POST | `/:id/publish` · `/unpublish` | |
| GET/POST/PATCH/DELETE | `/grade-scales` | bands validated: min 0..100 strictly decreasing |
| GET | `/report-card?studentId&termId` | per subject: assessments (published), total, max, pct, grade (from the class board's scale, else the school's first scale, else A1..E default); overall pct, grade, rank in class, class size |
| GET | `/ranks?classId&termId` | `[{ studentId, name, total, pct, rank }]` computed from published assessments; ties share rank |

### `/api/homework`
| GET | `/?classId&termId` (any role in class) | with `submissions` (teacher: all; student: own) |
| POST | `/` | `{ classSubjectId, title, description, dueDate, attachments?: fileIds }` |
| PATCH/DELETE | `/:id` | |
| POST | `/:id/submit` | student: `{ files: fileIds, note? }` → status Submitted (Late if after dueDate) |
| PATCH | `/:id/submissions/:studentId` | teacher: `{ grade?, feedback?, status? }` → Graded/Returned |

### `/api/files`
| POST | `/` multipart (`multer`, field `file`, ≤ 10 MB, allow pdf/png/jpg/jpeg/docx/xlsx/txt) → `{ item: File }` stored under `server/uploads/<schoolId>/<id>` (gitignored) |
| GET | `/:id` streams (auth; any member of the school) · `GET /:id/meta` |
| DELETE | `/:id` uploader or admin |

`GET /api/data`: stop returning `attendance`, `attendanceRecords`, `marks`, `ranks`, `directory`, `homework`, `workUploads` (keys omitted); PUT strips them.

## Sample data
Sessions: day attendance for X-A and X-B for every school day in term t3 so far (use the seed's deterministic pattern), locked. Grade scale "CBSE 8-point" (A1 91, A2 81, B1 71, B2 61, C1 51, C2 41, D 33, E 0). Assessments per X-A class-subject per term: Unit Test (25), Mid Term (50), Term Exam (80), published, marks from the old `makeMarks` shape for each student. Homework: the old 8 seed items mapped to X-A class-subjects with a submission for h2/h3/h6-8.

## Frontend
- `academics.tsx`: `AttendanceMod` → `/attendance/summary` (student/parent/ward select); `MarksMod` → `/assessments/report-card`; `RanksMod` → `/assessments/ranks` for the viewer's class (teacher/admin: class picker); `TeachersMod` → derived from users + classSubjects for the viewer's class (delete `db.directory`).
- `office.tsx`: `TakeAttendanceMod` → pick class (from `classesTaughtBy`) + date + period (from timetable entries the teacher has that day, or "Whole day"); roster with P/A/L/E toggles; save → POST session; shows locked state; `AttendanceMgmtMod` → sessions by class/date + staff attendance + lock/unlock + CSV export (client-side). `GradeUploadMod` → **Gradebook**: class-subject picker → assessments as columns (add assessment inline), students as rows, inline score entry with bulk save, publish button per assessment. `CreateAssignmentMod` → POST homework with attachments upload; list with submissions and grade/feedback.
- `actions.tsx`: `HomeworkMod` → `/homework` for the viewer; student upload real files (`POST /files` then `/submit`); `WorkUploadMod` becomes a redirect/alias into HomeworkMod (keep export, render HomeworkMod with a note).
- `studentReport.tsx`: attendance/marks/ranks sections read the new endpoints.
- `Portal.tsx` Overview: attendance % and pending homework from the new endpoints.
- Delete the legacy `students` array + `makeRanks`, `makeMarks`, `makeDays`, `makeAttendanceRecords` from `data.ts` once the sample loader (server) no longer imports them — coordinate: the server sample loader should build Phase 3 data itself (port the generators into `server/src/sampleData.ts`).
