import { defineConfig } from 'vitest/config'
import dotenv from 'dotenv'

// Loaded here (main vitest process) so DATABASE_URL is already pointed at the test database before
// any test file (and therefore src/prisma.ts) is imported. See test/helpers/db.ts and TESTING notes
// in the Phase 10 test suite report for why this must never point at the dev "edkonic" database.
dotenv.config({ path: '.env.test' })
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST
process.env.NODE_ENV = 'test'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    root: '.',
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/setup.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
    // The suite shares one Postgres database across files; run test files one at a time so
    // fixture creation/teardown in one file can't race another.
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.DATABASE_URL_TEST,
      DATABASE_URL_TEST: process.env.DATABASE_URL_TEST,
      JWT_SECRET: process.env.JWT_SECRET,
      NODE_ENV: 'test',
    },
  },
})
