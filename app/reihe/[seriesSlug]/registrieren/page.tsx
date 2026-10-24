// app/reihe/[seriesSlug]/registrieren/page.tsx
import { ProofOfWork, SubmitButton, inputClass } from '../../../ui/kit'
import { prisma } from '../../../lib/prisma'
import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import PinForm from '../../../[slug]/pin-form'
import { registerGuestUser } from '../../../mein-konto/actions'
import AuthError from '../../../ui/auth-error'


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
  searchParams: Promise<{ error?: string; next?: string }>
}) {
  const { seriesSlug } = await params
  const { error, next } = await searchParams
  const loginHref = `/mein-konto/login${next ? `?next=${encodeURIComponent(next)}` : ''}`

  const series = await prisma.eventSeries.findUnique({ where: { slug: seriesSlug } })
  // Reihen im Einladungsmodus: keine Konten, der persönliche Link aus der Einladung ist der Zugang
  if (!series || series.inviteOnly) notFound()

  let isAuthorized = true
  if (series.eventPin) {
    const cookieStore = await cookies()
    const pinCookie = cookieStore.get(`series_pin_${series.id}`)
    if (pinCookie?.value !== series.eventPin) isAuthorized = false
  }

  if (!isAuthorized) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <PinForm seriesId={series.id} slug={series.slug} title={series.title} />
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900 py-10 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 p-8 rounded-lg shadow space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Konto für {series.title}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Einmal einloggen, alle Termine dieser Reihe automatisch sehen - ohne dir einen Link merken oder Angaben erneut eintragen zu müssen.
          </p>
        </div>

        {error === 'exists' && (
          <div className="p-3 bg-red-50 text-red-700 text-sm rounded dark:bg-red-950 dark:text-red-300">
            Für diese E-Mail-Adresse existiert bereits ein Konto. <Link href={loginHref} className="underline font-medium">Hier einloggen</Link>.
          </div>
        )}

        <AuthError code={error} />
        <form action={registerGuestUser} className="space-y-4">
          <input type="hidden" name="seriesId" value={series.id} />
          {next && <input type="hidden" name="next" value={next} />}

          <div>
            <label htmlFor="name" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Name</label>
            <input id="name" type="text" name="name" required className={inputClass} placeholder="Max Mustermann" />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">E-Mail</label>
            <input id="email" type="email" name="email" required className={inputClass} placeholder="max@beispiel.de" />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Passwort</label>
            <input id="password" type="password" name="password" required minLength={10} className={inputClass} placeholder="Mindestens 10 Zeichen" />
          </div>

          <ProofOfWork />
          <SubmitButton>Konto erstellen</SubmitButton>
        </form>

        <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
          Bereits ein Konto? <Link href={loginHref} className="text-blue-600 hover:underline">Hier einloggen</Link>
        </p>
      </div>
    </main>
  )
}
