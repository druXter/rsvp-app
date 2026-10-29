// app/api/push/status/route.ts
import { readLimitedText, validPushSubscription, type PushSubscriptionInput } from 'suite-kit/web'
import { NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { getCurrentUser } from '../../../lib/auth'
import { participantPushStatus, userPushStatus, type PushStatus } from '../../../lib/push-subscriptions'

const MAX_BODY = 4_000

export const dynamic = 'force-dynamic'

function reply(status: PushStatus) {
  return NextResponse.json({ status }, { headers: { 'Cache-Control': 'no-store' } })
}

/**
 * Stand des Push-Abos dieses Browsers aus Sicht des Servers (app/lib/push-subscriptions.ts) - für die Schalter auf der
 * Gästeseite (`editToken`) und in der Verwaltung (Sitzung). Die Schalter zeigen „aktiv“ nur bei `active`; bei
 * `expired` holt der Browser ein neues Abo und meldet es an /api/push/resubscribe. Unbekannte Gäste, fehlende
 * Anmeldung und ungültige Eingaben ergeben einheitlich `none`.
 */
export async function POST(request: Request) {
  let input: { editToken?: unknown; subscription?: unknown } = {}
  try {
    const parsed: unknown = JSON.parse((await readLimitedText(request, MAX_BODY)) ?? '')
    if (parsed && typeof parsed === 'object') input = parsed
  } catch {
    return reply('none')
  }
  const subscription = validPushSubscription(input.subscription as PushSubscriptionInput)
  if (!subscription) return reply('none')

  if (typeof input.editToken === 'string') {
    if (!input.editToken) return reply('none')
    const participant = await prisma.participant.findUnique({ where: { editToken: input.editToken }, select: { id: true } })
    return reply(participant ? await participantPushStatus(participant.id, subscription.endpoint) : 'none')
  }

  const user = await getCurrentUser()
  return reply(user ? await userPushStatus(user.id, subscription.endpoint) : 'none')
}
