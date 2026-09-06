# EduNova — School OS

React 19 + Vite frontend, Express + Prisma + Postgres backend. A school starts empty (one superadmin) and everything else is created from the admin portal; a sample school can be loaded from **Settings** for walkthroughs.

## Run locally

```bash
npm install && npm --prefix server install
npm run db:up        # Postgres 16 in Docker on :5434
npm run db:migrate    # apply Prisma migrations
npm run db:seed       # one school + principal@edunova.in / principal123
npm run server:dev    # API on http://localhost:4000
npm run dev            # frontend on http://localhost:3000 (separate terminal)
```

Sign in as `principal@edunova.in` / `principal123`. Then either set the school up by hand (**Academic Setup → Years & Terms → Classes → Subjects**, then **People**) or load the demo school from **Settings → Load sample school**, which also creates the demo accounts (`admin@`, `staff@`, `teacher@`, `parent@`, `student@edunova.in`, passwords `<role>123`).

**Settings → Danger zone → Reset school** wipes everything except your own account (typed confirmation).

## Where things are

| Path | What |
|---|---|
| `server/` | API — see `server/README.md` for routes and env |
| `src/lib/api.ts` | Typed fetch client (`api.get/post/patch/put/del`) |
| `src/lib/store.tsx` | Session, `db` (legacy JSON blob), `academic` (real entities), `useAcademic()` selectors |
| `src/lib/hooks/useEntity.ts` | CRUD hook for `/api/academic/*` collections |
| `src/portal/modules/` | One file per feature area; `academic.tsx` and `settings.tsx` are Phase 1 |
| `.agents/edunova/rebuild-plan.md` | The phase-by-phase rebuild plan |
| `.agents/edunova/phase-0-1-contract.md` | API contract for what's built so far |

## Quality gates

```bash
npx tsc -b --noEmit && npx eslint .          # frontend
cd server && npx tsc --noEmit                 # backend
```
