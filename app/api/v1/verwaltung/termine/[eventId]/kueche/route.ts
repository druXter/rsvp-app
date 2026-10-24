// app/api/v1/verwaltung/termine/[eventId]/kueche/route.ts
import { apiError, getUserFromApiToken } from '../../../../../../lib/api-auth'
import { kitchenForApi, loadApiEvent } from '../../../../../../lib/admin-api'
import { loadKitchenReport } from '../../../../../../lib/kitchen'

/**
 * Küchenübersicht eines Termins (wie der Reiter "Küche"): Menüwahl pro Gang gezählt, Personen mit ihrer Wahl.
 * Für alle mit Zugriff auf die Gästeliste, also auch Moderator*innen. Ohne Allergien pro Person (siehe
 * kitchenForApi). Ohne Zugriff dieselbe 404 wie für einen unbekannten Termin.
 */
export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const user = await getUserFromApiToken(request)
  if (!user) return apiError(401, 'Ungültiger oder fehlender API-Token')

  const { eventId } = await params
  const loaded = await loadApiEvent(user, eventId)
  if (!loaded) return apiError(404, 'Termin nicht gefunden')
  const { event } = loaded

  return Response.json({
    termin: { id: event.id, title: event.title, date: event.date.toISOString(), series: event.series },
    ...kitchenForApi(await loadKitchenReport(event.id))
  }, { headers: { 'cache-control': 'no-store' } })
}
