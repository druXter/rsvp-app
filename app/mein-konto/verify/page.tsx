// app/mein-konto/verify/page.tsx
import { UNVERIFIED_GUEST_ACCOUNT_DAYS, unverifiedGuestCutoff } from '../../lib/guest-retention'
import { SubmitButton } from '../../ui/kit'
import { prisma } from '../../lib/prisma'
import Link from 'next/link'
import { hashToken } from '../../lib/tokens'
import { confirmGuestAccount } from '../actions'
import StatusCard from '../../ui/status-card'


/**
 * Bestätigt ein frisch registriertes Nutzer-Konto. Das Öffnen des Mail-Links prüft den Token
 * nur (lesend) und zeigt "Konto jetzt bestätigen" - erst dieser Klick (confirmGuestAccount)
 * bestätigt. Link-Scanner von Mail-Anbietern rufen Links automatisch ab; bestätigte schon der
 * Aufruf, liefe ein mit fremder Adresse registriertes Konto danach unter dieser Adresse.
 */
export default async function GuestVerifyPage({ searchParams }: { searchParams: Promise<{ token?: string; next?: string; done?: string; error?: string }> }) {
  const { token, next, done, error } = await searchParams
  const loginHref = `/mein-konto/login${next ? `?next=${encodeURIComponent(next)}` : ''}`

  if (done) {
    return (
      <StatusCard title="Konto bestätigt! 🎉" tone="success">
        <p className="mb-6">Dein Konto ist jetzt aktiv. Du kannst dich ab sofort einloggen.</p>
        <Link href={loginHref} className="inline-block bg-blue-600 text-white font-bold py-2 px-6 rounded hover:bg-blue-700 transition">
          Jetzt einloggen
        </Link>
      </StatusCard>
    )
  }

  const guestUser = token && !error ? await prisma.guestUser.findFirst({ where: { verifyToken: hashToken(token), createdAt: { gte: unverifiedGuestCutoff() } }, select: { id: true } }) : null
  if (!token || !guestUser) {
    return (
      <StatusCard title="Ungültiger Link" tone="error">
        <p>Dieser Bestätigungslink ist ungültig, abgelaufen (nach {UNVERIFIED_GUEST_ACCOUNT_DAYS} Tagen) oder wurde bereits verwendet. Ein nicht bestätigtes Konto wird danach gelöscht - du kannst dich einfach neu registrieren.</p>
      </StatusCard>
    )
  }

  return (
    <StatusCard title="Konto bestätigen" tone="neutral">
      <p className="mb-6">Bitte bestätige mit einem Klick, dass dies deine E-Mail-Adresse ist - danach kannst du dich einloggen. Bestätige nur, wenn du das Konto selbst angelegt hast: Wer es angelegt hat, kennt sein Passwort.</p>
      <form action={confirmGuestAccount}>
        <input type="hidden" name="token" value={token} />
        {next && <input type="hidden" name="next" value={next} />}
        <SubmitButton>Konto jetzt bestätigen</SubmitButton>
      </form>
    </StatusCard>
  )
}
