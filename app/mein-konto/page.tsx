// app/mein-konto/page.tsx
import { PrismaClient } from '@prisma/client'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentGuestUser } from '../lib/guest-auth'
import { getCurrentUser } from '../lib/auth'
import { logoutGuestUser, updateGuestProfile, changeGuestPassword, requestGuestEmailChange, cancelGuestEmailChange } from './actions'
import DeleteAccountButton from './delete-account-button'

const prisma = new PrismaClient()

/**
 * Persönliches Dashboard eines eingeloggten Nutzer-Kontos: zentrales Profil (gilt für
 * alle Reihen) plus, pro Reihen-Mitgliedschaft, alle Termine mit dem jeweiligen
 * Antwortstatus. Antworten funktionieren über die bestehende Termin-Seite ganz ohne
 * Token in der URL, da die Identität dort über die Gast-Session aufgelöst wird.
 */
export default async function MeinKontoPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; passwordChanged?: string; emailChangeRequested?: string }>
}) {
  const guestUser = await getCurrentGuestUser()
  if (!guestUser) redirect('/mein-konto/login')

  const params = await searchParams
  const wrongPassword = params.error === 'wrongpassword'
  const emailTaken = params.error === 'emailtaken'
  const passwordChanged = params.passwordChanged === '1'
  const emailChangeRequested = params.emailChangeRequested === '1'

  // Nur relevant, falls DIESES Konto auch gerade im Admin-Bereich eingeloggt ist (eigenes
  // Cookie, siehe app/lib/auth.ts) - z.B. ein Moderator, der bei einer fremden Reihe auch
  // ganz normal als Nutzer teilnimmt. Bekommt dann einen direkten Wechsel-Link zurück,
  // ohne sich manuell zum Dashboard durchklicken zu müssen (wichtig v.a. in der
  // installierten PWA).
  const user = await getCurrentUser()

  const memberships = await prisma.guestUserSeries.findMany({
    where: { guestUserId: guestUser.id },
    include: { series: { include: { events: { orderBy: { date: 'asc' } } } } },
    orderBy: { createdAt: 'asc' }
  })

  const participants = await prisma.participant.findMany({
    where: { guestUserId: guestUser.id },
    include: { rsvps: true }
  })
  const participantBySeriesId = new Map(participants.map(p => [p.seriesId, p]))

  return (
    <main className="min-h-screen bg-gray-100 py-12 px-4">
      <div className="max-w-2xl mx-auto space-y-8">

        <div className="flex justify-between items-center bg-white p-6 rounded-lg shadow">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Mein Konto</h1>
            <p className="text-sm text-gray-500">{guestUser.email}</p>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            {user && (
              <Link href="/admin" className="bg-emerald-100 text-emerald-700 px-4 py-2 rounded hover:bg-emerald-200 transition text-sm font-medium flex items-center">
                🔀 Admin-Dashboard ({user.email})
              </Link>
            )}
            <form action={logoutGuestUser}>
              <button type="submit" className="bg-gray-200 text-gray-800 px-4 py-2 rounded hover:bg-gray-300 transition text-sm font-medium">
                Abmelden
              </button>
            </form>
          </div>
        </div>

        {passwordChanged && (
          <div className="p-3 bg-green-50 text-green-700 text-sm rounded">Passwort erfolgreich geändert. Andere angemeldete Geräte wurden abgemeldet.</div>
        )}
        {wrongPassword && (
          <div className="p-3 bg-red-50 text-red-700 text-sm rounded">Aktuelles Passwort ist falsch.</div>
        )}
        {emailTaken && (
          <div className="p-3 bg-red-50 text-red-700 text-sm rounded">Für diese E-Mail-Adresse existiert bereits ein Konto.</div>
        )}
        {emailChangeRequested && (
          <div className="p-3 bg-blue-50 text-blue-700 text-sm rounded">Bestätigungslink an die neue Adresse gesendet. Die Änderung wird erst nach dem Klick darauf wirksam.</div>
        )}

        {guestUser.pendingEmail && (
          <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg space-y-2">
            <p className="text-sm text-yellow-800">
              Ausstehende Änderung zu <strong>{guestUser.pendingEmail}</strong> - prüfe dein Postfach für den Bestätigungslink.
            </p>
            <form action={cancelGuestEmailChange}>
              <button type="submit" className="text-xs text-yellow-700 hover:text-yellow-900 underline">Änderung abbrechen</button>
            </form>
          </div>
        )}

        <div className="bg-white p-6 rounded-lg shadow space-y-4">
          <h2 className="font-bold text-gray-900">Passwort ändern</h2>
          <form action={changeGuestPassword} className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">Aktuelles Passwort</label>
              <input type="password" name="currentPassword" required className="w-full border border-gray-300 p-2 rounded text-gray-900" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">Neues Passwort</label>
              <input type="password" name="newPassword" required minLength={8} className="w-full border border-gray-300 p-2 rounded text-gray-900" placeholder="Mindestens 8 Zeichen" />
            </div>
            <button type="submit" className="bg-blue-600 text-white font-bold py-2 px-4 rounded hover:bg-blue-700 transition text-sm">
              Passwort ändern
            </button>
          </form>
        </div>

        <div className="bg-white p-6 rounded-lg shadow space-y-4">
          <h2 className="font-bold text-gray-900">E-Mail-Adresse ändern</h2>
          <form action={requestGuestEmailChange} className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">Aktuelles Passwort</label>
              <input type="password" name="currentPassword" required className="w-full border border-gray-300 p-2 rounded text-gray-900" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">Neue E-Mail-Adresse</label>
              <input type="email" name="newEmail" required className="w-full border border-gray-300 p-2 rounded text-gray-900" />
              <p className="text-xs text-gray-500 mt-1">Wird erst nach Bestätigung über einen an diese Adresse geschickten Link wirksam.</p>
            </div>
            <button type="submit" className="bg-blue-600 text-white font-bold py-2 px-4 rounded hover:bg-blue-700 transition text-sm">
              Bestätigungslink anfordern
            </button>
          </form>
        </div>

        <div className="bg-white p-6 rounded-lg shadow space-y-4">
          <div>
            <h2 className="font-bold text-gray-900">Deine Angaben</h2>
            <p className="text-xs text-gray-500 mt-1">Gilt automatisch für alle Termine all deiner Reihen - einmal ändern, überall aktuell.</p>
          </div>
          <form action={updateGuestProfile} className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">Name</label>
              <input type="text" name="name" defaultValue={guestUser.name} required className="w-full border border-gray-300 p-2 rounded text-gray-900" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">Handynummer</label>
              <input type="tel" name="phone" defaultValue={guestUser.phone || ''} className="w-full border border-gray-300 p-2 rounded text-gray-900" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">Essenswunsch</label>
              <select name="dietaryOption" defaultValue={guestUser.dietaryOption || ''} className="w-full border border-gray-300 p-2 rounded text-gray-900 bg-white">
                <option value="">Keine Angabe</option>
                <option value="Allesesser">Ich esse alles (Fleisch/Fisch)</option>
                <option value="Vegetarisch">Vegetarisch</option>
                <option value="Vegan">Vegan</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">Allergien</label>
              <input type="text" name="allergies" defaultValue={guestUser.allergies || ''} className="w-full border border-gray-300 p-2 rounded text-gray-900" placeholder="z.B. Laktose, Nüsse, Gluten..." />
            </div>
            <button type="submit" className="bg-blue-600 text-white font-bold py-2 px-4 rounded hover:bg-blue-700 transition text-sm">
              Speichern
            </button>
          </form>
        </div>

        {memberships.length === 0 ? (
          <p className="text-center text-gray-500 italic bg-white p-6 rounded-lg shadow">Du bist noch keiner Reihe zugeordnet.</p>
        ) : (
          memberships.map(m => {
            const participant = participantBySeriesId.get(m.series.id)
            const rsvpByEventId = new Map((participant?.rsvps || []).map(r => [r.eventId, r]))

            return (
              <div key={m.id} className="bg-white p-6 rounded-lg shadow space-y-4">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">{m.series.title}</h2>
                  {m.series.description && <p className="text-sm text-gray-600">{m.series.description}</p>}
                </div>

                {m.series.events.length === 0 ? (
                  <p className="text-sm text-gray-500 italic">Für diese Reihe stehen aktuell noch keine Termine fest.</p>
                ) : (
                  <div className="space-y-2">
                    {m.series.events.map(event => {
                      const rsvp = rsvpByEventId.get(event.id)
                      const formattedDate = new Date(event.date).toLocaleString('de-DE', {
                        timeZone: 'Europe/Berlin',
                        weekday: 'short',
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                      })

                      return (
                        <Link
                          key={event.id}
                          href={`/reihe/${m.series.slug}/${event.slug}`}
                          className="flex justify-between items-center p-3 rounded border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition"
                        >
                          <div>
                            <p className="font-medium text-gray-900">{event.title}</p>
                            <p className="text-xs text-gray-500">📅 {formattedDate} Uhr</p>
                          </div>
                          {rsvp ? (
                            rsvp.isAttending ? (
                              rsvp.isOnWaitlist
                                ? <span className="bg-orange-100 text-orange-800 text-xs px-2 py-1 rounded-full font-bold whitespace-nowrap">Warteliste</span>
                                : <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full font-bold whitespace-nowrap">Zugesagt</span>
                            ) : (
                              <span className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded-full font-bold whitespace-nowrap">Abgesagt</span>
                            )
                          ) : (
                            <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full font-bold whitespace-nowrap">Jetzt antworten</span>
                          )}
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })
        )}

        <div className="bg-white p-6 rounded-lg shadow border-t-4 border-red-200 space-y-2">
          <h2 className="font-bold text-gray-900">Konto löschen</h2>
          <p className="text-xs text-gray-500">
            Löscht dein Konto, alle Reihen-Zuordnungen und alle deine Antworten zu jedem Termin jeder Reihe
            unwiderruflich. Mehr dazu in unserer <Link href="/datenschutz" className="underline">Datenschutzerklärung</Link>.
          </p>
          <DeleteAccountButton />
        </div>

      </div>
    </main>
  )
}
