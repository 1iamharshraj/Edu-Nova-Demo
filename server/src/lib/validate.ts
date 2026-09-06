import { z, type ZodType } from 'zod'

// Throws ZodError (mapped to 400 by errorHandler) when the body does not match.
export function validate<T>(schema: ZodType<T>, data: unknown): T {
  return schema.parse(data)
}

// Dates travel as YYYY-MM-DD strings; Postgres stores them as DATE.
export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
export const toDate = (s: string) => new Date(`${s}T00:00:00.000Z`)
export const fmtDate = (d: Date) => d.toISOString().slice(0, 10)

export const idStr = z.string().min(1)
