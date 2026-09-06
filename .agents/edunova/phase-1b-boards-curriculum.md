# Phase 1b — Boards, grades, streams, curriculum

> Amends `phase-0-1-contract.md`. Motivation: a school runs several boards (CBSE / ICSE / State / IGCSE / IB), spans LKG–XII, and subjects, books and streams vary by board and grade. A flat school-wide subject list cannot express that.

## Decisions (from the user)
- **One board per class.** Sections are per board: CBSE can have X-A and X-B and ICSE can have its own X-A and X-B in the same year.
- **No starter templates.** The admin builds every board's grade-wise curriculum by hand.

## Model

```
Board              id, schoolId, name "Central Board of Secondary Education", code "CBSE"      unique(schoolId, code)
Grade              id, schoolId, label "LKG" | "I" … "XII" | "PYP-1", order Int                 unique(schoolId, label)
Stream             id, schoolId, name "Science" | "Commerce" | "Humanities"                      unique(schoolId, name)
Subject            (unchanged) id, schoolId, name, code, color — the board-agnostic catalogue
CurriculumSubject  id, schoolId, boardId, gradeId, streamId?, subjectId,
                   kind core | elective | language, textbook?, syllabusRef?
                   uniqueness enforced in the service on (boardId, gradeId, streamId, subjectId) — streamId is nullable
Class              id, schoolId, academicYearId, boardId, gradeId, streamId?, section, classTeacherId?, capacity?
                   unique(schoolId, academicYearId, boardId, gradeId, section)      (the `grade` string column is dropped)
ClassSubject       (unchanged) classId, subjectId, teacherId?, periodsPerWeek
```

Cascades: Board → CurriculumSubject, Class; Grade → CurriculumSubject, Class; Stream → CurriculumSubject, Class.streamId set null; Subject → CurriculumSubject, ClassSubject.

## Behaviour
- **Creating a class** copies its curriculum (rows for its board + grade, plus rows for its stream if set, plus rows with no stream) into `ClassSubject` rows (teacher null, periodsPerWeek from the curriculum row if present else 5). `POST /api/academic/classes/:id/sync-curriculum` re-applies that: adds missing rows, never deletes existing ones.
- Class `label` = `${grade.label}-${section}`; serialised ClassRec also carries `boardId`, `boardCode`, `gradeId`, `grade` (label), `streamId?`, `stream?` (name). Display convention in the UI: **`X-A` with a board pill** — never bake the board into the label string.
- Legacy sync: student `user.board` = the class's board code; `user.class` stays `X-A`.
- Sample data: boards CBSE + Matric (state), grades I–XII ladder, no streams; curriculum: the 6 seed subjects for CBSE IX and X and Matric X; classes X-A, X-B, IX-A, IX-B all under CBSE (unchanged sections); ClassSubject rows as before.

## Endpoints (all under `/api/academic`, same conventions as the main contract)
| Method | Path | Body |
|---|---|---|
| GET/POST | `/boards` | `{name, code}` |
| PATCH/DELETE | `/boards/:id` | partial |
| GET/POST | `/grades` | `{label, order}` (order defaults to max+1) |
| PATCH/DELETE | `/grades/:id` | partial |
| GET/POST | `/streams` | `{name}` |
| PATCH/DELETE | `/streams/:id` | partial |
| GET | `/curriculum?boardId&gradeId&streamId` | |
| POST | `/curriculum` | `{boardId, gradeId, streamId?, subjectId, kind, textbook?, syllabusRef?}` → 409 if the combination exists |
| PATCH/DELETE | `/curriculum/:id` | partial (kind, textbook, syllabusRef) |
| POST | `/classes` | `{academicYearId, boardId, gradeId, streamId?, section, classTeacherId?, capacity?}` |
| POST | `/classes/:id/sync-curriculum` | — |

`GET /bootstrap` adds `boards`, `grades` (ordered by `order`), `streams`, `curriculum`.

## Frontend types
```ts
export interface BoardRec { id: string; name: string; code: string }   // (named BoardRec: `Board` is already the legacy CBSE|Matric union)
export interface Grade { id: string; label: string; order: number }
export interface Stream { id: string; name: string }
export type CurriculumKind = 'core' | 'elective' | 'language'
export interface CurriculumSubject { id: string; boardId: string; gradeId: string; streamId?: string; subjectId: string; kind: CurriculumKind; textbook?: string; syllabusRef?: string }
export interface ClassRec { id: string; academicYearId: string; boardId: string; boardCode: string; gradeId: string; grade: string; streamId?: string; stream?: string; section: string; label: string; classTeacherId?: string; capacity?: number }
```

## Admin flow (sidebar "Academic Setup")
1. **Years & Terms** (unchanged)
2. **Boards & Grades** — boards list; grade ladder (add / rename / reorder); streams list
3. **Curriculum** — subject catalogue (name, code, colour) + picker board → grade → (stream) → rows: subject, kind, textbook; add from catalogue
4. **Classes & Sections** — create as board + grade (+ stream) + section; card shows a board pill; **Subjects & teachers** modal per class lists its ClassSubject rows (from the curriculum) with teacher + periods, and a "Sync from curriculum" button
5. **Rooms** (unchanged)
6. **People** — class dropdown shows `X-A · CBSE`
