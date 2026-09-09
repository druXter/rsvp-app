// app/api/v1/me/route.ts
import { getGuestUserFromApiToken, apiError } from '../../../lib/api-auth'

/**
 * Profil des per API-Token authentifizierten Nutzer-Kontos. Dient einem Client vor allem
 * als Prüfung, ob der eingetragene Token (noch) gültig ist.
 */
export async function GET(request: Request) {
  const guestUser = await getGuestUserFromApiToken(request)
  if (!guestUser) return apiError(401, 'Ungültiger oder fehlender API-Token')

  return Response.json({
    id: guestUser.id,
    email: guestUser.email,
    name: guestUser.name,
    phone: guestUser.phone,
    dietaryOption: guestUser.dietaryOption,
    allergies: guestUser.allergies,
    isVerified: guestUser.isVerified
  })
}
