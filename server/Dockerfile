# EduNova API — multi-stage build.
#
# Build context MUST be the repo root (not server/), because server/tsconfig.json's `rootDir` reaches
# one level up to compile a single shared file from the frontend workspace (../src/lib/data.ts — plain
# types + seed data, no React/DOM deps, safe to compile under the server's Node-only tsconfig).
#
#   docker build -f server/Dockerfile -t edunova-server .
#
# That "reach up a level" is also why the compiled output lands nested as dist/server/src/... and
# dist/src/lib/... — matches server/package.json's `"start": "node dist/server/src/index.js"` and the
# runtime's `UPLOAD_ROOT` (server/src/modules/files/service.ts resolves 3 levels up from its own compiled
# location), so uploads end up on disk at /app/server/dist/server/uploads. See docker-compose.prod.yml,
# which mounts a named volume there.

# ---- deps + build ----
FROM node:20-alpine AS build
WORKDIR /app

COPY server/package.json server/package-lock.json ./server/
RUN npm --prefix server ci

COPY src/lib/data.ts ./src/lib/data.ts
COPY server ./server

# Generates the Prisma client against server/prisma/schema.prisma, then compiles TypeScript (tsc -p
# server/tsconfig.json) to server/dist/**.
RUN npm --prefix server run prisma:generate
RUN npm --prefix server run build

# ---- production runtime ----
FROM node:20-alpine AS production
ENV NODE_ENV=production
WORKDIR /app

# Fresh install (not `--omit=dev`): `prisma migrate deploy` at container start needs the `prisma` CLI,
# which is a devDependency of server/package.json. This is a small single-node deployment, not a
# size-optimized edge image, so the extra devDependency weight is an acceptable trade for not having to
# hand-copy CLI binaries between stages.
COPY server/package.json server/package-lock.json ./server/
RUN npm --prefix server ci

# schema.prisma + migrations/ must ship in the image — `prisma migrate deploy` reads them at container
# start to bring the database up to date before the server starts.
COPY server/prisma ./server/prisma
COPY --from=build /app/server/dist ./server/dist

# Regenerate the client in this stage so it's built against the exact `prisma` CLI/engine version just
# installed here (cheap — a few seconds — and removes any doubt about cross-stage engine compatibility).
RUN npm --prefix server run prisma:generate

COPY server/docker-entrypoint.sh ./server/docker-entrypoint.sh
RUN chmod +x ./server/docker-entrypoint.sh

WORKDIR /app/server
EXPOSE 4000
ENTRYPOINT ["./docker-entrypoint.sh"]
