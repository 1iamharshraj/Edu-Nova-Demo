import { execSync } from 'node:child_process'
import dotenv from 'dotenv'

// Vitest "globalSetup": runs once, in its own process, before any test file loads. We use it to make
// sure the edunova_test database schema is fully migrated before the suite starts. Safe to re-run.
// (The local Postgres database itself is still named "edunova" — only the app's display branding was
// renamed to Edkonic, not the already-provisioned local infra; see server/.env* for the real values.)
export default async function globalSetup() {
  dotenv.config({ path: '.env.test' })
  const url = process.env.DATABASE_URL_TEST
  if (!url) throw new Error('DATABASE_URL_TEST is not set (check server/.env.test)')
  if (!/edunova_test/.test(url)) {
    throw new Error(`Refusing to run tests: DATABASE_URL_TEST does not look like a test database: ${url}`)
  }
  execSync('npx prisma migrate deploy', {
    cwd: __dirname + '/..',
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  })
}
