import type { Request, Response, NextFunction, RequestHandler } from 'express'
import { ZodError } from 'zod'
import { Prisma } from '@prisma/client'

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message)
  }
}

export const notFound = (what = 'Record') => new HttpError(404, `${what} not found`)

// Express 4 does not forward rejected promises to the error handler — wrap async handlers.
export function wrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => { fn(req, res, next).catch(next) }
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details })
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Validation failed', details: err.issues })
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Already exists (unique constraint)', details: err.meta })
    if (err.code === 'P2025') return res.status(404).json({ error: 'Record not found' })
    if (err.code === 'P2003') return res.status(400).json({ error: 'Referenced record does not exist', details: err.meta })
  }
  if (err instanceof SyntaxError && 'body' in (err as object)) {
    return res.status(400).json({ error: 'Malformed JSON body' })
  }
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
}
