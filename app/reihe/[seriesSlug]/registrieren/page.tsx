// app/reihe/[seriesSlug]/registrieren/page.tsx
import { hasPinCookie } from '../../../lib/pin'
import { ProofOfWork, SubmitButton, inputClass, linkClass } from '../../../ui/kit'
import { prisma } from '../../../lib/prisma'
import { notFound } from 'next/navigation'
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
    if (!(await hasPinCookie('series', series.id, series.eventPin))) isAuthorized = false
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
          Bereits ein Konto? <Link href={loginHref} className={linkClass}>Hier einloggen</Link>
        </p>
      </div>
    </main>
  )
}
