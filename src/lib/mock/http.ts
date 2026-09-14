// Shared error/response shapes for the in-browser mock backend. Mirrors server/src/lib/errors.ts's
// HttpError contract closely enough that mock handlers can throw the same way real route handlers do.

export class MockHttpError extends Error {
  status: number
  details?: unknown
  extra?: Record<string, unknown>
  constructor(status: number, message: string, details?: unknown, extra?: Record<string, unknown>) {
    super(message)
    this.status = status
    this.details = details
    this.extra = extra
  }
}

export function notFound(what = 'Resource'): MockHttpError {
  return new MockHttpError(404, `${what} not found`)
}

export function forbidden(message = 'Not permitted'): MockHttpError {
  return new MockHttpError(403, message)
}

export function badRequest(message: string, details?: unknown): MockHttpError {
  return new MockHttpError(400, message, details)
}

export function conflict(message: string, extra?: Record<string, unknown>): MockHttpError {
  return new MockHttpError(409, message, undefined, extra)
}
