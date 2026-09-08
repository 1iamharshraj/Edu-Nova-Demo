// Runs once per test FILE (vitest setupFiles), after global-setup.ts has migrated the test database.
// Each file starts from a clean database — see test/helpers/db.ts#resetDatabase — so fixtures created
// in one test file (e.g. the fixed 'fx-superadmin' id) never collide with another file's run.
import { beforeAll, afterAll } from 'vitest'
import { prisma, resetDatabase } from './helpers/db'

beforeAll(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await prisma.$disconnect()
})
