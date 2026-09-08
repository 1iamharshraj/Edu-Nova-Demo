import pino from 'pino'

// Structured request/app logging (Phase 10 §5). No transport/pretty-printer dependency is added — plain
// JSON lines are fine for a dev console and are what you want in production anyway.
export const logger = pino({ level: process.env.LOG_LEVEL || 'info' })
