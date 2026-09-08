import type { z } from 'zod'
import { prisma } from '../../prisma'
import type { Ctx } from '../../lib/rbac'
import type { subscribeBody, unsubscribeBody } from './schema'

// See phase-9-10-integrations-hardening.md → item 4 (PWA push). Subscriptions are tied to the calling
// user; fan-out/delivery lives in lib/notify.ts#pushNotify.

export async function subscribe(ctx: Ctx, input: z.infer<typeof subscribeBody>) {
  const row = await prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: { userId: ctx.actorId, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth },
    update: { userId: ctx.actorId, p256dh: input.keys.p256dh, auth: input.keys.auth },
  })
  return { id: row.id }
}

export async function unsubscribe(ctx: Ctx, input: z.infer<typeof unsubscribeBody>) {
  await prisma.pushSubscription.deleteMany({ where: { endpoint: input.endpoint, userId: ctx.actorId } })
}
