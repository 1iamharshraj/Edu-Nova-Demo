# Edkonic — School OS

React 19 + Vite frontend, Express + Prisma + Postgres backend. A school starts empty (one superadmin) and everything else is created from the admin portal; a sample school can be loaded from **Settings** for walkthroughs.

## Run locally

```bash
npm install && npm --prefix server install
npm run db:up        # Postgres 16 in Docker on :5434
npm run db:migrate    # apply Prisma migrations
npm run db:seed       # one school + principal@edkonic.in / principal123
npm run server:dev    # API on http://localhost:4000
npm run dev            # frontend on http://localhost:3000 (separate terminal)
```

Sign in as `principal@edkonic.in` / `principal123`. Then either set the school up by hand (**Academic Setup → Years & Terms → Classes → Subjects**, then **People**) or load the demo school from **Settings → Load sample school**, which also creates the demo accounts (`admin@`, `staff@`, `teacher@`, `parent@`, `student@edkonic.in`, passwords `<role>123`).

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

## Deploy

A small-school, single-node deployment — one Postgres, one API container, one nginx serving the built
frontend and reverse-proxying `/api`. No Kubernetes or multi-region setup is implied or needed at this
scale; `docker compose` on one machine is the whole story.

**Prerequisites:** Docker + Docker Compose on the host. Nothing else — the app images are self-contained
multi-stage builds (Node for compiling, then a slim runtime).

**1. Configure secrets**

```bash
cp .env.example .env
```

Fill in `.env`:
- `POSTGRES_PASSWORD` — a long random value; also composes `DATABASE_URL` for the `api` service.
- `JWT_SECRET` — a long random value; rotating it invalidates every existing session.
- `CORS_ORIGIN` — your public origin (same-origin requests through nginx don't need this, but keep it accurate).
- Phase 9 integration keys (`ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `MSG91_API_KEY`, `VAPID_*`) are **optional** — each feature degrades gracefully (logs/no-ops) when its var is unset. See `server/.env.example` for what each one turns on.

**2. Build and start the stack**

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

This builds three images (`api`, `nginx`, plus pulls `postgres` and the backup image) and starts four
containers: `postgres`, `api`, `nginx`, `backup`. The site is served on `http://<host>:${HTTP_PORT:-80}`.

**Migrations run automatically** — the `api` container's entrypoint (`server/docker-entrypoint.sh`) runs
`prisma migrate deploy` against `DATABASE_URL` before starting the server, on every container start.
There's no separate migration step to remember; `docker compose ... up -d --build` is the whole
deploy/redeploy command, including after pulling new code with new migrations.

**3. Backups**

The `backup` service (`prodrigestivill/postgres-backup-local`) runs a nightly `pg_dump` (`SCHEDULE:
"@daily"`) and writes timestamped, gzip'd dumps to `./backups` on the host, pruning older ones per
`BACKUP_KEEP_DAYS`/`_WEEKS`/`_MONTHS` in `docker-compose.prod.yml`.

To restore a backup:

```bash
gunzip -c backups/daily/edunova-<timestamp>.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

(Stop the `api` container first if you're restoring over a live database, so nothing writes mid-restore.)

**4. Redeploying**

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Rebuilds only what changed; `prisma migrate deploy` on the `api` container's next start applies any new
migrations. Uploaded files persist in the `edunova_uploads_prod` volume and the database in
`edunova_pgdata_prod` across rebuilds — only `docker compose down -v` would drop them.
