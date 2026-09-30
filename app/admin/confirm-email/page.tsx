// app/admin/confirm-email/page.tsx
import { PrismaClient } from '@prisma/client'
import Link from 'next/link'
import { hashToken } from '../../lib/tokens'
import { confirmEmailChange } from '../actions'
import StatusCard from '../../ui/status-card'
import SubmitButton from '../../ui/submit-button'

const prisma = new PrismaClient()

/**
 * Zweiter Schritt einer per requestEmailChange angeforderten E-Mail-Änderung (Link an die NEUE
 * Adresse). Das Öffnen des Links prüft den Token nur (lesend) und zeigt "Neue Adresse jetzt
 * bestätigen" - erst dieser Klick (confirmEmailChange) ändert die Adresse. Link-Scanner von
 * Mail-Anbietern rufen Links automatisch ab; bestätigte schon der Aufruf, könnte jemand sein
 * Konto auf eine fremde Adresse umstellen, ohne dass deren Besitzer*in etwas tut.
 */
export default async function ConfirmEmailPage({ searchParams }: { searchParams: Promise<{ token?: string; done?: string; error?: string }> }) {
  const { token, done, error } = await searchParams

  if (done) {
    return (
      <StatusCard title="E-Mail-Adresse geändert! 🎉" tone="success">
        <p className="mb-6">Deine neue E-Mail-Adresse ist ab sofort aktiv - nutze sie beim nächsten Login.</p>
        <Link href="/admin/login" className="inline-block bg-blue-600 text-white font-bold py-2 px-6 rounded hover:bg-blue-700 transition">
          Zum Login
        </Link>
      </StatusCard>
    )
  }

  if (error === 'taken') {
    return (
      <StatusCard title="Adresse bereits vergeben" tone="error">
        <p>Diese E-Mail-Adresse wurde inzwischen von einem anderen Konto verwendet. Bitte fordere eine Änderung zu einer anderen Adresse an.</p>
      </StatusCard>
    )
  }

  const account = token && !error ? await prisma.user.findUnique({ where: { emailChangeToken: hashToken(token) }, select: { pendingEmail: true, emailChangeTokenExpiresAt: true } }) : null
  if (!token || !account || !account.pendingEmail || !account.emailChangeTokenExpiresAt || account.emailChangeTokenExpiresAt < new Date()) {
    return (
      <StatusCard title="Ungültiger Link" tone="error">
        <p>Dieser Bestätigungslink ist ungültig, abgelaufen oder wurde bereits verwendet.</p>
      </StatusCard>
    )
  }

  return (
    <StatusCard title="Neue E-Mail-Adresse bestätigen" tone="neutral">
      <p className="mb-6">Soll <strong>{account.pendingEmail}</strong> künftig die E-Mail-Adresse deines Kontos sein?</p>
      <form action={confirmEmailChange}>
        <input type="hidden" name="token" value={token} />
        <SubmitButton>Neue Adresse jetzt bestätigen</SubmitButton>
      </form>
    </StatusCard>
  )
}
