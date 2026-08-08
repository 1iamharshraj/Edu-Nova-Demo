# Phase 5 — Polish & Build

## Goals

Final responsive pass, theme audit, install dependencies from a working registry, build, lint, and smoke-test every role.

## Changes

### 1. Responsive audit

- Test all key modules on mobile and desktop:
  - Login role selector
  - Timetable
  - Calendar
  - Attendance (student + management)
  - People management
  - Student profile report
  - Messages
  - Feed
  - AI doubt clearing
  - Payments
  - Fee defaulters
  - Disciplinary committee
- Fix any layout breaks, overflow, or touch-target issues.
- Ensure bottom mobile nav works with the expanded module list.

### 2. Light/dark audit

- Check every module in both themes.
- Fix any remaining hardcoded light backgrounds without `dark:` counterparts.
- Verify `mega-panel`, `glass-nav`, `aurora`, `grain`, cards, modals, tables, and inputs.

### 3. Dependency resolution

- The current environment fails `npm install` because it tries to fetch from `https://npm.mirrors.msh.team/` (ENOTFOUND).
- Configure npm to use `registry.npmjs.org` or a working mirror.
- Run `npm install` to restore missing packages: `react-router`, `qrcode`, `kimi-plugin-inspect-react`.

### 4. Build & lint

- Run `npm run build`.
- Fix all TypeScript errors.
- Run `npm run lint`.
- Fix lint issues (unused vars, hook deps, etc.).

### 5. Smoke tests

- Start `npm run dev`.
- Log in as each role and verify assigned modules render.
- Test key flows:
  - superadmin creates/manages an admin.
  - admin marks attendance for teachers and students.
  - teacher messages a parent and another teacher.
  - parent verifies and approves a slip.
  - student submits homework and asks AI a doubt.
  - staff assigns a fee and sees defaulters.
  - admin approves a disciplinary case.
- Reset demo data and confirm seeds work.
- Check PWA install prompt still works.

### 6. Documentation sync

- Update `.agents/edunova/current-state.md` with what is now functional.
- Update phase documents with any deviations or simplifications made during implementation.
- Add any new open questions or future enhancements to `todos-and-further-plans.md`.

## Definition of done

- `npm run build` passes with zero errors.
- `npm run lint` passes (or only acceptable warnings).
- All six roles can log in and use their modules.
- Mobile and desktop layouts are polished.
- Light/dark mode is consistent.
- Demo data reset produces a fully seeded app.
- Documentation is up to date.

## Files to modify

- `src/index.css` (final theme fixes)
- Any module files where responsive or theme issues are found
- `.agents/edunova/*.md` (documentation updates)
- `.npmrc` or npm config if needed to fix registry
