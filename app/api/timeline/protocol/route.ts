// app/api/timeline/protocol/route.ts
import { readLimitedText } from 'suite-kit/web'
import { NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { TOOL_LINKS } from '../../../lib/linked-tools-store'
import { timelineLinkOf, timelineTool } from '../../../lib/timeline'
import { createProtocol, fetchDecisions, protocolPresence, verifyProtocolRequest } from '../../../lib/timeline-protocol'

export const dynamic = 'force-dynamic'

const MAX_BODY = 5_000
const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * Protokoll für den Zeitplan-Rückblick (Idee L7, app/lib/timeline-protocol.ts): Der Zeitplan fragt signiert an,
 * geantwortet wird nur, wenn dieser Termin genau dieses Zeitplan-Event verlinkt (sonst 404), und nur mit dem, was der
 * Termin freigibt - Kommen und Gehen mit Namen, Beschlüsse der Sitzung. Ungültige Anfrage: 401.
 */
export async function POST(request: Request) {
  const tool = timelineTool()
  if (!tool) return NextResponse.json({ error: 'not configured' }, { status: 404, headers: NO_STORE })
  const body = await readLimitedText(request, MAX_BODY)
  if (body === null) return NextResponse.json({ error: 'too large' }, { status: 413, headers: NO_STORE })

  const query = verifyProtocolRequest(body, tool)
  if (!query) return NextResponse.json({ error: 'invalid message' }, { status: 401, headers: NO_STORE })

  const event = await prisma.event.findUnique({ where: { id: query.rsvpEventId }, include: { toolLinks: TOOL_LINKS } })
  const link = event ? timelineLinkOf(event) : null
  if (!event || !link || link.remoteEventId !== query.timelineEventId) return NextResponse.json({ error: 'not linked' }, { status: 404, headers: NO_STORE })

  const [entries, decisions] = await Promise.all([
    event.timelinePresence
      ? prisma.presenceEntry.findMany({ where: { eventId: event.id }, select: { rsvpId: true, position: true, name: true, kind: true, at: true }, take: 20_000 })
      : null,
    event.timelineDecisions ? fetchDecisions(event) : null
  ])
  const reply = createProtocol(tool, link, event.id, { presence: entries ? protocolPresence(entries) : null, decisions })
  return new Response(reply, { headers: { 'Content-Type': 'text/plain; charset=utf-8', ...NO_STORE } })
}
