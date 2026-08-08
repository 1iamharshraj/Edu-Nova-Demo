# Phase 3 — Communication & Visual Polish

## Goal

Make the most visually prominent modules feel modern, consistent, and responsive.

## Scope

### 1. Timetable redesign (`src/portal/modules/timetable.tsx`)

**Desktop**
- Use a clean vertical time-axis grid with periods on the left and day columns across the top.
- Each cell should be a rounded card with the subject color, room badge, and teacher avatar.
- Sticky day headers and time column.
- Remove the `min-w-[720px]` horizontal scroll on large screens; use a fluid grid.
- Add a subtle hover lift and current-period highlight if the timetable matches today.
- Keep a compact subject legend below the grid.

**Mobile**
- Keep the day-picker tabs but make them larger touch targets.
- Stack periods vertically with clear spacing, subject color left border, and a teacher avatar row.
- Avoid cramped text; allow the day button labels to be `Mon`, `Tue`, etc.

### 2. School feed desktop UI (`src/portal/modules/social.tsx`)

- Use a wider centered feed (`max-w-4xl` or `max-w-5xl`) with generous whitespace.
- Make each post a distinct card with a large header, placeholder media, and clean like/comment footer.
- Add a sidebar on desktop for trending announcements (optional, keep it simple).
- Improve the gradient/emoji placeholder to look intentional, not broken.

### 3. AI doubt clearing desktop UI (`src/portal/modules/social.tsx`)

- Keep the 2-column layout but tighten spacing and typography.
- Add suggested-question chips at the bottom of the chat.
- Make the "Nova is thinking" state more polished (animated dots + subtle card).
- Improve empty state and message alignment.

### 4. Mobile login role selector (`src/pages/Login.tsx`)

- Use smaller, more compact role pills (e.g., icon + short label, `text-[10px]` or `text-[11px]`) with horizontal scroll.
- Ensure long text never fills the button; use `truncate` or `whitespace-nowrap`.
- Add a small active indicator (dot) instead of a full background change if it helps readability.

### 5. Meetings refinement (`src/portal/modules/meetings.tsx`)

- Verify GMeet-style links are generated (`meet.edunova.in/...`).
- Confirm teachers and students can both request meetings and the request appears in the other party's portal.
- Improve the meeting card layout (status pill, date, link, participants).

## Definition of done

- Timetable looks modern on desktop and clean on mobile.
- School feed and AI doubt clearing desktop layouts are spacious and intentional.
- Mobile login role selector is compact and readable.
- Meetings flow works end-to-end for all requesters.
- No build/lint errors; commits pushed.

## Estimated files

- `src/portal/modules/timetable.tsx`
- `src/portal/modules/social.tsx`
- `src/pages/Login.tsx`
- `src/portal/modules/meetings.tsx`
- `src/index.css` (theme utilities if needed)
