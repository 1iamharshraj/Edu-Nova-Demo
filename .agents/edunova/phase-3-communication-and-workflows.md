# Phase 3 — Communication & Workflows

## Goals

Fix communication modules, make work upload and online meetings realistic, and improve the desktop UI of the feed and AI doubt clearing.

## Changes

### 1. Teacher Messaging fix (`src/portal/modules/social.tsx`)

- When a teacher sends a message, it appears as sent by the teacher (not as a parent typing).
- Support both parent-teacher and teacher-teacher threads in `db.threads`.
- For teachers, show two tabs:
  - **Parents** — conversations with parents of their class/subjects.
  - **Teachers** — all teachers of the current year/term.
- For parents/students, keep the current teacher list.
- Make term selection flexible: filter threads by term, allow switching.
- Seed teacher-teacher threads.
- Update page title/subtitle to reflect the active conversation type.

### 2. Online Meetings / PTA (`src/portal/modules/actions.tsx` or `meetings.tsx`)

- Replace simple `PTAMod` with full `MeetingsMod`.
- Roles that can request: teacher, student, parent.
- Approvers: teacher (for student requests), admin/superadmin.
- Fields: purpose, preferred slot, requested teacher, GMeet-style link (`meet.edunova.in/abc-defg`), status.
- Once approved, the meeting link appears in both requester and teacher portals.
- Status: Requested → Scheduled → Completed → Cancelled.
- Seed demo meetings.

### 3. Homework / Work Upload legitimation (`src/portal/modules/actions.tsx`)

- Show real file picker UI.
- Display selected file name, size, upload date, status.
- Simulate upload progress bar (2 seconds) before marking as Submitted.
- Store `WorkUpload` record with filename and status.
- Teacher can view submitted work list with file names and submission dates.

### 4. AI Doubt Clearing desktop UI (`src/portal/modules/social.tsx`)

- Use a 2-column layout on desktop: history sidebar on the left, chat on the right.
- Keep rule-based answers.
- Add suggested questions as chips at the bottom or top.
- Improve the "Nova is thinking" state with animated dots.
- Mobile stays single-column.

### 5. School Feed desktop UI (`src/portal/modules/social.tsx`)

- Use a 2-column masonry or wider single column (`max-w-5xl` grid) instead of narrow `max-w-xl`.
- Improve image/gradient placeholder height and spacing.
- Larger text and better use of whitespace.
- Keep like/comment functionality.

### 6. Event Highlights (optional polish)

- Keep Rickroll placeholder for demo, but structure the component so real YouTube IDs can be dropped in later.

## Definition of done

- Teacher messages render correctly from the teacher's perspective.
- Teachers can message other teachers; parents/students can message teachers.
- Meeting requests flow end-to-end with GMeet-style links.
- Work upload looks like a real file upload with progress.
- AI doubt clearing and school feed desktop layouts are spacious and modern.
- Mobile layouts remain usable.

## Files to modify/create

- Modify `src/portal/modules/social.tsx`
- Modify `src/portal/modules/actions.tsx`
- Create `src/portal/modules/meetings.tsx` (optional split)
- Modify `src/lib/data.ts` (seed threads, meetings, work uploads)
- Modify `src/portal/Portal.tsx` (register Meetings module, remove old PTA)
