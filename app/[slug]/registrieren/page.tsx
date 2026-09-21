// app/[slug]/registrieren/page.tsx
import { PrismaClient } from '@prisma/client'
import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import PinForm from '../pin-form'
import { registerGuestUser } from '../../mein-konto/actions'
import SubmitButton from '../../ui/submit-button'

const prisma = new PrismaClient()

/**
 * Selbstregistrierung für ein Nutzer-Konto, gebunden an EIN Einzel-Event (die Event-Slug in
 * der URL) - das Gegenstück zu app/reihe/[seriesSlug]/registrieren/page.tsx für ein Event
 * ohne Reihe. Hinter derselben Event-PIN wie der Rest des Events. Anders als bei einer Reihe
 * entsteht hier keine Mitgliedschaft (kein GuestUserSeries-Äquivalent für Einzel-Events) -
 * das Konto verknüpft sich erst über performRsvpSubmission mit einem Participant, sobald
 * tatsächlich geantwortet wird.
 */
export default async function RegisterGuestUserForEventPage({
  params,
  searchParams
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ error?: string; next?: string }>
}) {
  const { slug } = await params
  const { error, next } = await searchParams
  const loginHref = `/mein-konto/login${next ? `?next=${encodeURIComponent(next)}` : ''}`

  const event = await prisma.event.findUnique({ where: { slug } })
  if (!event) notFound()

  let isAuthorized = true
  if (event.eventPin) {
    const cookieStore = await cookies()
    const pinCookie = cookieStore.get(`event_pin_${event.id}`)
    if (pinCookie?.value !== event.eventPin) isAuthorized = false
  }

  if (!isAuthorized) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <PinForm eventId={event.id} slug={event.slug} title={event.title} />
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900 py-10 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 p-8 rounded-lg shadow space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Konto für {event.title}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Für dieses Event ist ein Nutzer-Konto erforderlich, um teilzunehmen.
          </p>
        </div>

        {error === 'exists' && (
          <div className="p-3 bg-red-50 text-red-700 text-sm rounded dark:bg-red-950 dark:text-red-300">
            Für diese E-Mail-Adresse existiert bereits ein Konto. <Link href={loginHref} className="underline font-medium">Hier einloggen</Link>.
          </div>
        )}

        <form action={registerGuestUser} className="space-y-4">
          <input type="hidden" name="eventId" value={event.id} />
          {next && <input type="hidden" name="next" value={next} />}

          <div>
            <label htmlFor="name" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Name</label>
            <input id="name" type="text" name="name" required className="w-full border border-gray-300 p-2 rounded text-gray-900 bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100" placeholder="Max Mustermann" />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">E-Mail</label>
            <input id="email" type="email" name="email" required className="w-full border border-gray-300 p-2 rounded text-gray-900 bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100" placeholder="max@beispiel.de" />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Passwort</label>
            <input id="password" type="password" name="password" required minLength={8} className="w-full border border-gray-300 p-2 rounded text-gray-900 bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100" placeholder="Mindestens 8 Zeichen" />
          </div>

          <SubmitButton>Konto erstellen</SubmitButton>
        </form>

        <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
          Bereits ein Konto? <Link href={loginHref} className="text-blue-600 hover:underline">Hier einloggen</Link>
        </p>
      </div>
    </main>
  )
}
