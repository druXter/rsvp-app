// app/api/v1/verwaltung/me/route.ts
import { apiError, getUserFromApiToken } from '../../../../lib/api-auth'
import { ROLE_LABELS } from '../../../../lib/permissions'

/** Konto des Verwaltungs-Tokens - vor allem zum Prüfen, ob der eingetragene Token (noch) gilt. */
export async function GET(request: Request) {
  const user = await getUserFromApiToken(request)
  if (!user) return apiError(401, 'Ungültiger oder fehlender API-Token')
  return Response.json({ id: user.id, email: user.email, role: user.role, roleLabel: ROLE_LABELS[user.role] }, { headers: { 'cache-control': 'no-store' } })
}
