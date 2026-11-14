// app/admin/verify-email/page.tsx
import { SubmitButton } from '../../ui/kit'
import { prisma } from '../../lib/prisma'
import Link from 'next/link'
import { hashToken } from '../../lib/tokens'
import { confirmAccountEmail } from '../actions'
import StatusCard from '../../ui/status-card'

/**
 * Bestätigt die Adresse eines Verwaltungskontos, das jemand anderes angelegt hat (createUser, User.emailVerified).
 * Der Aufruf prüft den Token nur; erst der Klick (confirmAccountEmail) bestätigt - Mail-Scanner rufen Links von
 * selbst ab.
 */
export default async function VerifyAccountEmailPage({ searchParams }: { searchParams: Promise<{ token?: string; done?: string; error?: string }> }) {
  const { token, done, error } = await searchParams

  if (done) {
    return (
      <StatusCard title="Adresse bestätigt" tone="success">
        <p className="mb-6">Danke - dein Verwaltungskonto meldet dich jetzt auch bei anderen Tools der Suite an.</p>
        <Link href="/admin/login?local=1" className="inline-block bg-blue-600 text-white font-bold py-2 px-6 rounded hover:bg-blue-700 transition">
          Zum Login
        </Link>
      </StatusCard>
    )
  }

  const account = token && !error
    ? await prisma.user.findFirst({ where: { emailVerifyToken: hashToken(token), emailVerified: false }, select: { email: true } })
    : null
  if (!token || !account) {
    return (
      <StatusCard title="Ungültiger Link" tone="error">
        <p>Dieser Bestätigungslink ist ungültig oder wurde bereits verwendet. Einen neuen bekommst du nach dem Anmelden unter „Konto-Einstellungen“.</p>
      </StatusCard>
    )
  }

  return (
    <StatusCard title="Adresse bestätigen" tone="neutral">
      <p className="mb-6">Ist <strong>{account.email}</strong> deine Adresse und gehört das Verwaltungskonto dazu dir?</p>
      <form action={confirmAccountEmail}>
        <input type="hidden" name="token" value={token} />
        <SubmitButton>Adresse jetzt bestätigen</SubmitButton>
      </form>
    </StatusCard>
  )
}
