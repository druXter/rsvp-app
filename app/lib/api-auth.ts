// app/lib/api-auth.ts
import { PrismaClient, GuestUser } from '@prisma/client'
import { createHash, randomBytes, timingSafeEqual } from 'crypto'

const prisma = new PrismaClient()

/**
 * Authentifizierung für die Client-API (app/api/v1/), gedacht für selbstgebaute Clients
 * wie eine WatchOS-App. Bewusst getrennt von den beiden Cookie-Logins (app/lib/auth.ts für
 * Admins, app/lib/guest-auth.ts für Nutzer-Konten): ein nativer Client hat keinen Browser,
 * der Cookies verwaltet, und soll weder das Passwort speichern noch die Browser-Sitzung
 * des Nutzenden übernehmen können. Ein API-Token gilt ausschließlich für die Gast-Seite -
 * es kann nie zu Admin-Rechten führen, egal wem das Konto gehört.
 */

const TOKEN_PREFIX = 'rsvp_'

/**
 * Cookie, in dem ein frisch erzeugter Token für genau eine Minute liegt, damit die
 * Konto-Seite ihn einmalig anzeigen kann (siehe createApiToken in app/mein-konto/actions.ts).
 */
export const NEW_API_TOKEN_COOKIE = 'new_api_token'

/**
 * Erzeugt einen neuen Klartext-Token. Der Rückgabewert ist das EINZIGE Mal, dass der
 * Klartext existiert - gespeichert wird nur sein Hash (siehe hashApiToken).
 */
export function generateApiToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString('hex')
}

/**
 * SHA-256 statt bcrypt: der Token besteht aus 32 zufälligen Bytes, ist also nicht erratbar
 * und braucht keine künstlich langsame Hash-Funktion - die würde hier nur jeden einzelnen
 * API-Request ausbremsen.
 */
export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Löst den `Authorization: Bearer ...`-Header eines Requests zum zugehörigen Nutzer-Konto
 * auf und gibt null zurück, wenn kein oder ein unbekannter Token mitgeschickt wurde.
 * Aktualisiert nebenbei lastUsedAt, damit der Nutzende in den Konto-Einstellungen sieht,
 * welches Gerät noch aktiv ist und welchen Token er gefahrlos widerrufen kann.
 */
export async function getGuestUserFromApiToken(request: Request): Promise<GuestUser | null> {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null

  const presented = header.slice('Bearer '.length).trim()
  if (!presented) return null

  const record = await prisma.guestApiToken.findUnique({
    where: { tokenHash: hashApiToken(presented) },
    include: { guestUser: true }
  })
  if (!record) return null

  // Der Lookup läuft bereits über den Hash, ist also kein Zeichenvergleich auf dem
  // Geheimnis selbst; dieser Vergleich stellt nur sicher, dass ein manipulierter
  // Datenbankeintrag nicht doch einen abweichenden Token akzeptiert.
  const expected = Buffer.from(record.tokenHash, 'utf8')
  const actual = Buffer.from(hashApiToken(presented), 'utf8')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null

  await prisma.guestApiToken.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
  return record.guestUser
}

/**
 * Einheitliche JSON-Fehlerantwort, damit ein fremder Client immer dieselbe Form bekommt.
 */
export function apiError(status: number, message: string) {
  return Response.json({ error: message }, { status })
}
