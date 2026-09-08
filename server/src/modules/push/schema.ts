import { z } from 'zod'

// Shape of the browser PushSubscription.toJSON() object.
export const subscribeBody = z.object({
  endpoint: z.string().trim().url().max(2000),
  keys: z.object({
    p256dh: z.string().trim().min(1),
    auth: z.string().trim().min(1),
  }),
})

export const unsubscribeBody = z.object({
  endpoint: z.string().trim().url().max(2000),
})
