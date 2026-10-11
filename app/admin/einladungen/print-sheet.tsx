// app/admin/einladungen/print-sheet.tsx
import Link from 'next/link'
import QRCode from 'qrcode'
import { formatPersonList } from '../../lib/invitations'
import PrintButton from '../events/[id]/kueche/print-button'

type PrintInvitation = { id: string; label: string; extraPersons: number; persons: { name: string; ageGroup: string }[] }

/**
 * Druckliste der Einladungen (docs/KONZEPT-EINLADUNGEN.md, Abschnitt 3): pro Haushalt eine Karte mit Personen,
 * persönlichem Link und QR-Code - zum Ausschneiden oder als Vorlage für gedruckte Einladungskarten. Für Einzel-Events
 * und Reihen; `hint` steht auf jeder Karte (Frist bzw. Termine).
 */
export default async function InvitationPrintSheet({ title, backHref, items }: {
  title: string
  backHref: string
  items: { invitation: PrintInvitation; link: string; hint: string | null }[]
}) {
  const cards = await Promise.all(items.map(async item => ({ ...item, qr: await QRCode.toDataURL(item.link, { width: 240, margin: 1 }) })))
  return (
    <main className="min-h-screen bg-white text-gray-900 p-6 print:p-0">
      <div className="flex justify-between items-center mb-6 print:hidden">
        <h1 className="text-xl font-bold">Druckliste: {title}</h1>
        <div className="flex gap-4 items-center">
          <PrintButton />
          <Link href={backHref} className="text-sm text-gray-600 hover:underline">Zurück zu den Einladungen</Link>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 print:grid-cols-2">
        {cards.map(({ invitation, link, qr, hint }) => (
          <section key={invitation.id} className="border border-gray-300 rounded p-4 flex gap-4 break-inside-avoid" data-testid="invitation-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt={`QR-Code für ${invitation.label}`} className="w-28 h-28 shrink-0" />
            <div className="min-w-0 text-sm">
              <p className="font-bold text-base">{invitation.label}</p>
              <p>{formatPersonList(invitation.persons)}{invitation.extraPersons > 0 ? ` (+${invitation.extraPersons})` : ''}</p>
              {hint && <p className="mt-1">{hint}</p>}
              <p className="mt-1 font-mono text-[10px] break-all text-gray-600">{link}</p>
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}
