// app/reihe/[seriesSlug]/registrieren/page.tsx
import { PrismaClient } from '@prisma/client'
import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import PinForm from '../../../[slug]/pin-form'
import { registerGuestUser } from '../../../mein-konto/actions'

const prisma = new PrismaClient()

/**
 * Selbstregistrierung für ein Nutzer-Konto, gebunden an EINE Reihe (die Reihen-Slug in
 * der URL). Hinter derselben Reihen-PIN wie der Rest der Reihe - wer die Termine schon
 * sehen darf, darf sich hier auch registrieren. Weitere Reihen kommen später über
 * addGuestUserToSeries (Creator/Moderator) oder automatisch beim Beantworten hinzu.
 */
export default async function RegisterGuestUserPage({
  params,
  searchParams
}: {
  params: Promise<{ seriesSlug: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { seriesSlug } = await params
  const { error } = await searchParams

  const series = await prisma.eventSeries.findUnique({ where: { slug: seriesSlug } })
  if (!series) notFound()

  let isAuthorized = true
  if (series.eventPin) {
    const cookieStore = await cookies()
    const pinCookie = cookieStore.get(`series_pin_${series.id}`)
    if (pinCookie?.value !== series.eventPin) isAuthorized = false
  }

  if (!isAuthorized) {
    return (
      <main className="min-h-screen bg-gray-50">
        <PinForm seriesId={series.id} slug={series.slug} title={series.title} />
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50 py-10 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white p-8 rounded-lg shadow space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Konto für {series.title}</h1>
          <p className="text-sm text-gray-500 mt-1">
            Einmal einloggen, alle Termine dieser Reihe automatisch sehen - ohne dir einen Link merken oder Angaben erneut eintragen zu müssen.
          </p>
        </div>

        {error === 'exists' && (
          <div className="p-3 bg-red-50 text-red-700 text-sm rounded">
            Für diese E-Mail-Adresse existiert bereits ein Konto. <Link href="/mein-konto/login" className="underline font-medium">Hier einloggen</Link>.
          </div>
        )}

        <form action={registerGuestUser} className="space-y-4">
          <input type="hidden" name="seriesId" value={series.id} />

          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700">Name</label>
            <input type="text" name="name" required className="w-full border border-gray-300 p-2 rounded text-gray-900" placeholder="Max Mustermann" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700">E-Mail</label>
            <input type="email" name="email" required className="w-full border border-gray-300 p-2 rounded text-gray-900" placeholder="max@beispiel.de" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700">Passwort</label>
            <input type="password" name="password" required minLength={8} className="w-full border border-gray-300 p-2 rounded text-gray-900" placeholder="Mindestens 8 Zeichen" />
          </div>

          <button type="submit" className="w-full bg-blue-600 text-white font-bold py-2 px-4 rounded hover:bg-blue-700 transition">
            Konto erstellen
          </button>
        </form>

        <p className="text-xs text-gray-500 text-center">
          Bereits ein Konto? <Link href="/mein-konto/login" className="text-blue-600 hover:underline">Hier einloggen</Link>
        </p>
      </div>
    </main>
  )
}
