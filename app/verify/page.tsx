// app/verify/page.tsx
import { PrismaClient } from '@prisma/client'
import StatusCard from '../ui/status-card'
import VerifyForm from './verify-form'

const prisma = new PrismaClient()

/**
 * Double-Opt-In einer Zusage (Link aus sendVerificationEmail). Das Öffnen des Links prüft den
 * Token nur (lesend) und zeigt "Jetzt bestätigen" - erst dieser Klick
 * (confirmParticipantVerification in app/actions.ts) verifiziert und verschickt die
 * Bestätigungen. Link-Scanner von Mail-Anbietern rufen Links automatisch ab und hätten die
 * Adresse sonst ohne die Person bestätigt.
 */
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams

  const participant = token ? await prisma.participant.findUnique({ where: { verifyToken: token }, select: { id: true } }) : null
  if (!token || !participant) {
    return (
      <StatusCard title="Ungültiger Link" tone="error">
        <p>{token ? 'Dieser Bestätigungslink ist ungültig oder wurde bereits verwendet.' : 'Es wurde kein Verifizierungs-Token übergeben.'}</p>
      </StatusCard>
    )
  }

  return <VerifyForm token={token} />
}
