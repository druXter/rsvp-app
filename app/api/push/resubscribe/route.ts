// app/api/push/resubscribe/route.ts
import { readLimitedText, validPushSubscription, type PushSubscriptionInput } from 'suite-kit/web'
import { NextResponse } from 'next/server'
import { replaceEndpoint } from '../../../lib/push-subscriptions'

const MAX_BODY = 6_000

export const dynamic = 'force-dynamic'

/**
 * Ersetzt das alte Push-Abo eines Browsers durch sein neues (app/lib/push-subscriptions.ts replaceEndpoint): vom
 * Service Worker bei `pushsubscriptionchange` (public/sw.js) und von den Schaltern, wenn /api/push/status ein
 * abgelaufenes Abo meldet. Berechtigt ist, wer den alten Endpoint kennt - also der Browser selbst. Das neue Abo muss
 * wie jedes Abo bei einem Push-Dienst der Browser-Hersteller liegen (SSRF-Schutz). Antwortet immer gleich (204).
 */
export async function POST(request: Request) {
  const done = new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
  let input: { oldEndpoint?: unknown; subscription?: unknown } = {}
  try {
    const parsed: unknown = JSON.parse((await readLimitedText(request, MAX_BODY)) ?? '')
    if (parsed && typeof parsed === 'object') input = parsed
  } catch {
    return done
  }
  const next = validPushSubscription(input.subscription as PushSubscriptionInput)
  const oldEndpoint = typeof input.oldEndpoint === 'string' && input.oldEndpoint.length <= 2_000 ? input.oldEndpoint : null
  if (!next || !oldEndpoint) return done
  await replaceEndpoint(oldEndpoint, next)
  return done
}
