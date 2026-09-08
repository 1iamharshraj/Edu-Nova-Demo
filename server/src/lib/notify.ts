import webpush from 'web-push'
import { prisma } from '../prisma'
import { sendToUser, sendToUsers } from './realtime'

// Creates a Notification row and pushes it over SSE. Used by feed/messages/leave/fees/etc services —
// see phase-7-communication.md → Rules ("Notifications are created by services: …").
//
// Phase 9 additive: every in-app notification also best-effort fans out to the user's web-push
// subscriptions (see phase-9-10-integrations-hardening.md → item 4). This piggybacks push onto the
// existing notify() call sites instead of hunting down every one individually.
export async function notify(schoolId: string, userId: string, kind: string, title: string, body?: string, link?: string) {
  const row = await prisma.notification.create({ data: { schoolId, userId, kind, title, body: body ?? null, link: link ?? null } })
  sendToUser(userId, { type: 'notification', payload: serializeNotification(row) })
  await pushNotify(userId, title, body, link)
  return row
}

export async function notifyMany(schoolId: string, userIds: string[], kind: string, title: string, body?: string, link?: string) {
  const ids = [...new Set(userIds)]
  await Promise.all(ids.map(id => notify(schoolId, id, kind, title, body, link)))
}

export function serializeNotification(n: { id: string; kind: string; title: string; body: string | null; link: string | null; readAt: Date | null; createdAt: Date }) {
  return { id: n.id, kind: n.kind, title: n.title, body: n.body ?? undefined, link: n.link ?? undefined, readAt: n.readAt?.toISOString(), createdAt: n.createdAt.toISOString() }
}

export { sendToUsers }

// ──────────────────────────────────────────────────────────────────────────
// Phase 9 — pluggable outbound-message layer (email / SMS / push).
// See phase-9-10-integrations-hardening.md → item 3 (Email/SMS provider abstraction) and item 4 (PWA push).
// ──────────────────────────────────────────────────────────────────────────

type EmailProvider = 'console' | 'resend'
type SmsProvider = 'console' | 'msg91'

function emailProvider(): EmailProvider {
  return process.env.RESEND_API_KEY ? 'resend' : 'console'
}

function smsProvider(): SmsProvider {
  return process.env.MSG91_API_KEY ? 'msg91' : 'console'
}

export interface EmailMessage { to: string; subject: string; body: string }
export interface SmsMessage { to: string; body: string }

// Sends an email through whichever provider is configured (RESEND_API_KEY present → Resend; otherwise
// logs to the console — the default for local dev with no real provider configured). Best-effort: never
// throws, since a delivery failure should never fail the caller's request/transaction.
export async function sendEmail(msg: EmailMessage): Promise<void> {
  const provider = emailProvider()
  try {
    if (provider === 'resend') {
      const { Resend } = await import('resend')
      const resend = new Resend(process.env.RESEND_API_KEY)
      const from = process.env.RESEND_FROM || 'EduNova <no-reply@edunova.in>'
      const { error } = await resend.emails.send({ from, to: msg.to, subject: msg.subject, text: msg.body })
      if (error) console.error('[notify] resend email failed:', error)
      return
    }
    console.log(`[notify:email:console] to=${msg.to} subject=${JSON.stringify(msg.subject)}\n${msg.body}`)
  } catch (err) {
    console.error('[notify] sendEmail failed:', err)
  }
}

// Sends an SMS through whichever provider is configured (MSG91_API_KEY present → MSG91 via plain fetch;
// otherwise logs to the console). Best-effort: never throws.
export async function sendSms(msg: SmsMessage): Promise<void> {
  const provider = smsProvider()
  try {
    if (provider === 'msg91') {
      const key = process.env.MSG91_API_KEY!
      const sender = process.env.MSG91_SENDER_ID || 'EDUNOV'
      const res = await fetch('https://api.msg91.com/api/v5/flow/', {
        method: 'POST',
        headers: { authkey: key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender, mobiles: msg.to, sms: msg.body }),
      })
      if (!res.ok) console.error('[notify] msg91 sms failed:', res.status, await res.text().catch(() => ''))
      return
    }
    console.log(`[notify:sms:console] to=${msg.to} ${msg.body}`)
  } catch (err) {
    console.error('[notify] sendSms failed:', err)
  }
}

// ── web push (PWA) ──

let vapidWarned = false
function vapidConfigured() {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
    return true
  }
  if (!vapidWarned) {
    vapidWarned = true
    console.warn('[notify] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT not set — web push is disabled (no-op).')
  }
  return false
}

// Fans out a push notification to every subscription of `userId`. Best-effort per subscription: a
// failure (or a 410 Gone, meaning the browser dropped the subscription) never throws — it's logged and,
// for 410s, the stale subscription row is pruned.
export async function pushNotify(userId: string, title: string, body?: string, link?: string): Promise<void> {
  if (!vapidConfigured()) return
  const subs = await prisma.pushSubscription.findMany({ where: { userId } })
  if (!subs.length) return
  const payload = JSON.stringify({ title, body: body ?? '', link: link ?? '' })
  await Promise.all(subs.map(async sub => {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number } | undefined)?.statusCode
      if (statusCode === 410 || statusCode === 404) {
        await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {})
      } else {
        console.error('[notify] push send failed:', err)
      }
    }
  }))
}
