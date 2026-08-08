# EduNova Demo — Project Overview

## What this is

EduNova Demo is a single-page React frontend prototype for an Indian school-management SaaS ("School OS"). It simulates a multi-role portal for **Superadmin, Admin, Staff, Teacher, Parent, and Student** entirely in the browser using seeded demo data and `localStorage` persistence.

No backend is connected. Every action is a client-side simulation meant for demos, investor pitches, and usability testing.

## Tech stack

| Layer | Choice |
|-------|--------|
| Build tool | Vite 7.3.6 |
| Framework | React 19 + TypeScript 5.9 |
| Routing | React Router 7 |
| Styling | Tailwind CSS 3.4 + custom dark/light theme |
| UI kit | shadcn/ui-style primitives (`src/components/ui/`) |
| State | React Context + `localStorage` |
| Toasts | Sonner |
| Charts | Recharts |
| PWA | Manifest, service worker, install prompt, offline page |

## Project structure

```
src/
  pages/           Landing.tsx, Login.tsx
  portal/          Portal.tsx (shell), ui.tsx (primitives), modules/*.tsx
  lib/             data.ts (types + seed DB), store.tsx (context + localStorage), theme.tsx, pwa.tsx
  components/ui/   50+ shadcn/ui primitives
  hooks/           use-mobile.ts
public/            manifest.json, sw.js, offline.html, icons, screenshots
```

## Role hierarchy

`superadmin` > `admin` > `staff` / `teacher` > `parent` / `student`

- **superadmin** — principal/vice-chairman. Can manage admins, staff, teachers, students, parents, calendar, contracts, admissions, attendance, fees, disciplinary committee.
- **admin** — school-level manager. Can manage staff, teachers, students, parents; same control as superadmin except cannot manage other admins.
- **staff** — office/operations. Can manage attendance, people, applications, fees, fee defaulters, disciplinary cases, student reports, calendar, work assignment.
- **teacher** — classroom. Can take attendance, upload grades, create assignments, message parents/teachers, view/manage leave, resignations, contracts, fee defaulters, disciplinary cases, student reports.
- **parent** — guardian. Can view timetable, attendance, marks, rank, calendar, messages, permission slips, leave, health records, achievements, payments, meetings.
- **student** — learner. Can view timetable, attendance, marks, rank, calendar, homework, AI doubts, feed, events, clubs, meetings.

## Design decisions

1. **No backend** — all data is simulated and persisted in `localStorage`.
2. **localStorage DB** — a single `DB` object stored under `edunova_db_v1`; session under `edunova_session_v1`.
3. **Reset demo data** — the sidebar has a reset action that re-seeds the DB from `seedDB()`.
4. **Board-aware marksheets** — supports CBSE and Matric/State board validation workflows.
5. **Client-side simulated features** — AI doubt clearing, AI parent calls, face scan/Aadhaar verification, payment gateway, and file uploads are all simulated UIs.
6. **Theme** — dark/light toggle persisted in `localStorage`; CSS uses `dark:` variants and explicit dark backgrounds (`#090911`, `#14141f`).

## Key files

- `src/lib/data.ts` — types and seed database
- `src/lib/store.tsx` — `StoreProvider`, `useStore`, `update`, `resetAll`
- `src/lib/access.ts` — role/access helpers (`canManage`, `isAdmin`, `isSuperAdmin`)
- `src/portal/Portal.tsx` — role-based module registry and shell
- `src/portal/ui.tsx` — shared UI primitives
- `src/portal/modules/*.tsx` — feature modules grouped by academics, social, actions, office, admin

## Current status

The majority of the requested modules are implemented and wired into the portal. Recent work (Aug 2026) added **name/DOB mismatch highlighting** in Board Registration.

Remaining work is focused on:
- tightening access-control and messaging bugs,
- improving a few high-visibility UI modules (timetable, school feed, AI doubts, login role selector),
- polishing admin admissions and people workflows,
- a final responsive/light/dark QA pass.

See `current-state.md` for the full feature matrix and known issues.  
See `todos-and-further-plans.md` for the open backlog.  
See the `phase-*.md` files for the phased execution plan.
