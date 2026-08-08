# Phase 5 — Polish, QA & Release

## Goal

Final responsive pass, light/dark audit, smoke tests, documentation sync, and push to GitHub.

## Scope

### 1. Responsive audit

Test these modules on real mobile and desktop widths:

- Login role selector
- Timetable
- Calendar
- Attendance (student + management)
- People management
- Student profile report
- Messages
- School feed
- AI doubt clearing
- Payment gateway
- Fee defaulters
- Disciplinary committee
- Board Registration
- Contracts & resignations

Fix any layout breaks, overflow, or touch-target issues. Ensure the bottom mobile nav still works with the expanded module list.

### 2. Light/dark audit

- Check every module in both themes.
- Fix any remaining hardcoded light backgrounds without `dark:` counterparts.
- Verify `mega-panel`, `glass-nav`, `aurora`, `grain`, cards, modals, tables, and inputs.
- Check Pill badges in dark mode (some currently use light-only colors).

### 3. Smoke tests per role

- Start `npm run dev`.
- Log in as each role and verify assigned modules render without errors.
- Key flows:
  - superadmin creates/manages an admin.
  - admin/staff marks attendance for teachers and students.
  - teacher messages a parent and another teacher.
  - parent verifies and approves a slip.
  - student submits homework and asks AI a doubt.
  - staff assigns a fee and sees defaulters.
  - admin approves a disciplinary case.
- Reset demo data and confirm seeds still produce a fully functional app.
- Check PWA install prompt still works.

### 4. Build & lint

- `npm run build` — zero TypeScript errors.
- `npm run lint` — zero errors; only acceptable warnings.
- Address any new warnings introduced by the earlier phases.

### 5. Documentation sync

- Update `.agents/edunova/current-state.md` with the final feature matrix.
- Update `.agents/edunova/todos-and-further-plans.md` to mark all open items as completed.
- Add any deviations/simplifications to the phase documents.
- Final commit message should summarize all phases.

### 6. Push to GitHub

- `git add -A && git commit -m "..." && git push origin main`
- Verify the latest commit appears on `1iamharshraj/Edu-Nova-Demo`.

## Definition of done

- `npm run build` passes with zero errors.
- `npm run lint` passes (or only acceptable warnings).
- All six roles can log in and use their modules.
- Mobile and desktop layouts are polished.
- Light/dark mode is consistent.
- Demo data reset produces a fully seeded app.
- Documentation is up to date.
- Latest code is on `origin/main`.

## Estimated files

- `src/index.css`
- Any module files where responsive/theme issues are found
- `.agents/edunova/*.md` documentation
