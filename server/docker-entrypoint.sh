#!/bin/sh
# Runs on every container start: brings the schema up to date, then starts the API.
# `prisma migrate deploy` (unlike `migrate dev`) only applies already-committed migrations from
# server/prisma/migrations — it never generates new ones or prompts — so it's safe to run
# unattended on every boot, including rolling restarts where the schema hasn't changed.
set -e

echo "[entrypoint] running prisma migrate deploy..."
npx prisma migrate deploy

echo "[entrypoint] starting EduNova API..."
exec node dist/server/src/index.js
