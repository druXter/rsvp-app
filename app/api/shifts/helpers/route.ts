// app/api/shifts/helpers/route.ts
import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { ownOrigin, readLimitedText } from '../../../lib/linked-tools'
import { shiftsTool, verifyShiftHelpers } from '../../../lib/shift-helpers'
import { applyShiftHelpers, linkedShiftsEvent } from '../../../lib/shift-helpers-store'

export const dynamic = 'force-dynamic'

// Bis zu 5000 Helfer*innen mit Name und Adresse - realistisch wenige KB.
const MAX_BODY = 2_000_000

/**
 * Meldung der Helfer*innen aus Schichten (typ "shift-helpers", app/lib/shift-helpers.ts): der VOLLSTÄNDIGE Stand.
 * 404 ohne Anbindung, 413 zu groß, 401 bei ungültiger Nachricht, 404, wenn der Termin nicht genau so verknüpft ist.
 * Antwortet mit den Konflikten (eigene Zusage derselben Adresse), damit Schichten sie anzeigen kann.
 */
export async function POST(request: Request) {
  const tool = shiftsTool()
  const audience = ownOrigin()
  if (!tool || !audience) return NextResponse.json({ error: 'not configured' }, { status: 404 })

  const body = await readLimitedText(request, MAX_BODY)
  if (body === null) return NextResponse.json({ error: 'too large' }, { status: 413 })

  const message = verifyShiftHelpers(body, { secret: tool.secret, audience })
  if (!message) return NextResponse.json({ error: 'invalid message' }, { status: 401 })

  const linked = await linkedShiftsEvent(message)
  if (!linked) return NextResponse.json({ error: 'not linked' }, { status: 404 })

  const result = await applyShiftHelpers(linked, message)
  if (result.outcome === 'applied') revalidatePath('/admin', 'layout')
  return NextResponse.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } })
}
