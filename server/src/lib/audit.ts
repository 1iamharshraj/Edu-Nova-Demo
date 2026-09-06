import { prisma } from '../prisma'

export async function audit(
  schoolId: string,
  actorId: string,
  action: string,
  entity: string,
  entityId: string,
  before?: unknown,
  after?: unknown,
) {
  await prisma.auditLog.create({
    data: {
      schoolId,
      actorId,
      action,
      entity,
      entityId,
      before: before === undefined ? undefined : (before as object),
      after: after === undefined ? undefined : (after as object),
    },
  })
}
