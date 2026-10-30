// app/admin/events/[id]/nachrichten/page.tsx
import { notFound } from 'next/navigation'
import { prisma } from '../../../../lib/prisma'
import { groupOf, MAX_MESSAGES_PER_DAY, messageParagraphs, type MessageRsvp } from '../../../../lib/guest-message'
import { Card, Notice, formatShortDate } from '../../../../ui/kit'
import { loadAdminEvent } from '../event-access'
import MessageForm from './message-form'

/**
 * Reiter „Nachrichten“ (Idee L29, nur Owner und Admins): freie Nachricht per Mail und Push an eine Auswahl der Gäste,
 * darunter der Verlauf. An den Client gehen für die Vorschau nur die Merkmale der Auswahl, keine Namen oder Adressen.
 */
export default async function MessagesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ gesendet?: string }> }) {
  const { id } = await params
  const { gesendet } = await searchParams
  const loaded = await loadAdminEvent(id)
  if (!loaded || !loaded.isOwner) notFound()
  const { event } = loaded

  const [rsvps, categories, messages] = await Promise.all([
    prisma.rsvp.findMany({
      where: { eventId: event.id },
      select: {
        isAttending: true, isMaybe: true, isOnWaitlist: true, hasAttended: true, ticketCategoryId: true,
        amountCents: true, paymentDueAt: true, paidAt: true, refundedAt: true,
        participant: { select: { email: true, isVerified: true } }
      }
    }),
    prisma.ticketCategory.findMany({ where: { eventId: event.id }, orderBy: { position: 'asc' }, select: { id: true, label: true } }),
    prisma.guestMessage.findMany({ where: { eventId: event.id }, orderBy: { createdAt: 'desc' } })
  ])
  // Für die Vorschau im Browser: nur ob es eine Adresse gibt, nicht welche
  const rows: MessageRsvp[] = rsvps.filter(r => groupOf(r)).map(r => ({ ...r, participant: { email: r.participant.email?.trim() ? 'x' : null, isVerified: r.participant.isVerified } }))
  const requireVerification = event.series ? event.series.requireVerification : event.requireVerification
  const sent = gesendet ? messages.find(m => m.id === gesendet) : null

  return (
    <div className="space-y-6">
      {sent && (
        <Notice tone={sent.mailFailed > 0 ? 'warning' : 'success'}>
          Nachricht „{sent.subject}“ an {sent.recipients} verschickt: {sent.mailSent} Mail(s){sent.mailFailed > 0 ? `, ${sent.mailFailed} nicht zustellbar` : ''}, dazu Push an alle mit Abo.
        </Notice>
      )}
      <Card>
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">Nachricht an Gäste</h2>
        <p className="mt-1 mb-4 text-sm text-gray-600 dark:text-gray-400">
          Ein Hinweis an alle oder eine Auswahl, per Mail und Push - z.B. Parkplatz, Dresscode oder Treffpunkt. Wie bei Änderungen bekommt
          nur, wer seine Adresse bestätigt hat, falls der Termin das verlangt. Höchstens {MAX_MESSAGES_PER_DAY} Nachrichten in 24 Stunden.
        </p>
        <MessageForm eventId={event.id} rows={rows} requireVerification={requireVerification} categories={categories}
          payments={categories.length > 0} checkin={event.enableCheckin} />
      </Card>

      <section aria-labelledby="verlauf" className="space-y-3">
        <h2 id="verlauf" className="font-semibold text-gray-900 dark:text-gray-100">Verlauf</h2>
        {messages.length === 0 ? <p className="text-sm text-gray-600 dark:text-gray-400">Noch keine Nachricht verschickt.</p> : (
          <ul className="space-y-3" data-testid="message-history">
            {messages.map(m => (
              <li key={m.id}>
                <details className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                  <summary className="cursor-pointer">
                    <span className="font-medium text-gray-900 dark:text-gray-100">{m.subject}</span>
                    <span className="block text-sm text-gray-600 dark:text-gray-400">
                      {formatShortDate(m.createdAt)} · {m.audienceText} · {m.recipients} Empfänger*innen, {m.mailSent} Mail(s){m.mailFailed > 0 ? `, ${m.mailFailed} fehlgeschlagen` : ''}{m.authorEmail ? ` · ${m.authorEmail}` : ''}
                    </span>
                  </summary>
                  <div className="mt-3 space-y-2 text-sm text-gray-800 dark:text-gray-200">
                    {messageParagraphs(m.body).map((p, i) => <p key={i} className="whitespace-pre-line">{p}</p>)}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
