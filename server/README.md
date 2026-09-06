# EduNova backend

Node + Express + TypeScript + Prisma + Postgres backend for the EduNova demo.

## Architecture

- **Postgres** (via Docker Compose) holds real tables for `School`, `User` (bcrypt-hashed
  passwords) and the Phase 1 academic entities (`AcademicYear`, `Term`, `Class`, `Subject`,
  `ClassSubject`, `Room`, `Enrollment`, `Guardian`, `AuditLog`), plus a `SchoolData` table with one
  JSONB blob per school holding everything else the frontend's `DB` type needs (timetable,
  attendance, marks, feed, ... — see `src/lib/data.ts`'s `DB` interface at the repo root).
  The legacy `User` columns (`class`, `section`, `roll`, `subjects`, `parentEmail`, `wards`) are
  denormalised from the academic tables by `src/lib/legacySync.ts` after every relevant write.
  Full contract: `.agents/edunova/phase-0-1-contract.md`.
- **Auth** is a simple email+password → JWT flow (`/api/auth/login`, `/api/auth/me`,
  `/api/auth/logout`). The JWT (7-day expiry) is verified by middleware on every other route.
- **Users** (`/api/users`) are proper rows, not part of the JSON blob, and get real permission
  checks ported from `src/lib/access.ts`'s `canManage`.
- **Data** (`/api/data`) is a get/replace-whole-blob API, mirroring the client's previous
  `structuredClone` + full-replace `update()` pattern. `terms` and `subjects` in the response are
  derived from the real tables (legacy shapes); `users`/`terms`/`subjects` are stripped on PUT.
- **Academic** (`/api/academic/*`) is the CRUD API for the Phase 1 entities — one
  `src/modules/<entity>/{router,service,schema}.ts` per entity, zod-validated, audited.
- **Admin** (`/api/admin`) has `load-sample-data` (builds the demo school from `seedDB()`),
  `reset` (`{ confirm: "RESET" }`, keeps only the requesting superadmin) and `audit`.

## First-time setup

From the repo root:

```bash
npm run db:up        # docker compose up -d — starts Postgres on localhost:5434
npm run db:migrate    # prisma migrate dev — creates the schema
npm run db:seed       # ensures one school + the superadmin principal (mustChangePassword) — nothing else
npm run server:dev    # starts the API on http://localhost:4000
```

In a second terminal, from the repo root:

```bash
npm run dev           # starts the Vite frontend on http://localhost:3000
```

`server/.env` (already created from `server/.env.example`) points at the dockerized Postgres on
port 5434 (5432 was already taken by another local service in this environment; change it back if
that's not the case for you — just keep `docker-compose.yml`'s port mapping and `DATABASE_URL` in
sync).

## Demo logins

A fresh seed only has the principal. After `POST /api/admin/load-sample-data` (as the principal)
the full demo school exists with the same emails/passwords as before (from `seedDB()`):

| Role | Email | Password |
|---|---|---|
| Superadmin (Principal) | principal@edunova.in | principal123 |
| Admin | admin@edunova.in | admin123 |
| Staff | staff@edunova.in | staff123 |
| Teacher | teacher@edunova.in | teacher123 |
| Parent | parent@edunova.in | parent123 |
| Student | student@edunova.in | student123 |

(Plus several more teacher/staff/student/parent accounts seeded with the same per-role passwords —
see `seedDB()` for the full list.)

## API summary

- `POST /api/auth/login` `{ email, password }` → `{ token, user }`
- `POST /api/auth/logout` → `{ ok: true }` (stateless; client just drops the token)
- `GET /api/auth/me` (Bearer token) → `{ user }`
- `GET /api/users` → `{ users: User[] }`
- `POST /api/users` `{ name, role, email?, password?, classId?, rollNo?, studentIds?, classTeacherOf?, ... }`
  → `{ user, password }` (requester must `canManage` the target role; creates the Enrollment /
  Guardians / class-teacher link in the same transaction)
- `PATCH|PUT /api/users/:id` `{ ...fields }` → `{ user }` (self, or `canManage` permission required;
  same relational extras as POST)
- `DELETE /api/users/:id` → `{ ok: true }` (`canManage` permission required; cascades)
- `GET /api/data` → `{ data }` (blob with derived legacy `terms`/`subjects`)
- `PUT /api/data` `<the data object>` → `{ data }` (full replace; `users`/`terms`/`subjects` ignored)
- `GET /api/academic/bootstrap` → `AcademicState`; `/api/academic/{years,terms,classes,subjects,
  class-subjects,rooms,enrollments,guardians}` → `{ items }` / `{ item }` / `{ ok: true }`
- `POST /api/admin/load-sample-data`, `POST /api/admin/reset { confirm: "RESET" }` (superadmin),
  `GET /api/admin/audit?limit=50&before=<iso>` (admin|superadmin)

## Known limitations (demo-grade, intentional)

- No refresh-token rotation — a JWT is valid for 7 days and that's it; logging out just drops it
  client-side.
- `PUT /api/data` replaces the *entire* non-user blob on every `update()` call from the frontend —
  there's no per-field diffing/patching or request debouncing. Fine for a single-user demo; would
  need real conflict handling for concurrent multi-user editing.
- Single-tenant: only one `School` row is ever seeded/used, though the schema supports more.
- `PUT /api/data` doesn't validate the shape of the JSON blob against the
  frontend's `DB` type — the backend trusts the frontend to send/receive matching shapes (same
  assumption the old localStorage version made).
- A couple of module files mutate `db.users` directly through the generic `update()` call instead of
  `createUser`/`deleteUser` (self-verification in `src/portal/ui.tsx`, one inline push in
  `src/portal/modules/office.tsx`). The store now diffs `db.users` after `update()` and PUT-syncs any
  changed/new user to `/api/users/:id` individually — this works for the two existing cases, but
  isn't a general-purpose users sync path.
