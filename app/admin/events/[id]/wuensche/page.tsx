// app/admin/events/[id]/wuensche/page.tsx
import { notFound } from 'next/navigation'
import { prisma } from '../../../../lib/prisma'
import { formatEuro } from '../../../../lib/payment-state'
import { wishState } from '../../../../lib/wishlist'
import { Badge, Card, Notice } from '../../../../ui/kit'
import { loadAdminEvent } from '../event-access'
import { AddWishForm, DeleteWishButton, EditWishForm } from './wish-forms'

const euroInput = (cents: number | null) => (cents === null ? '' : (cents / 100).toString().replace('.', ','))

/**
 * Reiter "Wünsche" (docs/KONZEPT-WUNSCHLISTE.md): Wünsche anlegen und bearbeiten, Stand pro Wunsch (reserviert,
 * gesammelter Betrag). Namen der Schenkenden nur ohne "Überraschung" (Event.wishesSecret) - mit ihr lädt die Seite
 * sie gar nicht erst. Für alle mit Zugriff auf die Gästeliste.
 */
export default async function WishesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const loaded = await loadAdminEvent(id)
  if (!loaded) notFound()
  const { event, isOwner } = loaded
  const secret = event.wishesSecret

  const wishes = await prisma.wish.findMany({
    where: { eventId: event.id },
    orderBy: { position: 'asc' },
    include: {
      reservations: { select: { participantId: true, quantity: true, amountCents: true }, orderBy: { createdAt: 'asc' } }
    }
  })
  if (!event.wishlist && wishes.length === 0) notFound()
  // Namen nur ohne Überraschung - sonst gar nicht geladen
  const names = secret ? new Map<string, string>() : new Map((await prisma.participant.findMany({
    where: { id: { in: wishes.flatMap(w => w.reservations.map(r => r.participantId)) } }, select: { id: true, name: true }
  })).map(p => [p.id, p.name]))
  const rows = wishes.map(w => ({ wish: w, state: wishState(w, w.reservations, null) }))
  const money = rows.filter(r => r.wish.targetCents !== null).reduce((sum, r) => sum + r.state.reserved, 0)

  return (
    <div className="space-y-6">
      {!event.wishlist && <Notice tone="warning">Die Wunschliste ist ausgeschaltet - Gäste sehen sie nicht. {isOwner ? 'Einschalten unter „Einstellungen“ → „Wunschliste“.' : ''}</Notice>}
      <Card>
        <p className="text-sm" data-testid="wish-summary">
          <strong>{wishes.length} Wünsche</strong> · {rows.filter(r => r.state.full).length} ganz reserviert · {rows.filter(r => r.state.reserved === 0).length} noch offen
          {money > 0 && <> · Geldwünsche: {formatEuro(money)} zugesagt</>}
        </p>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {secret
            ? '🎁 Überraschung: Ihr seht, was reserviert ist, aber nicht von wem.'
            : 'Namen sind sichtbar (Überraschung ist in den Einstellungen ausgeschaltet).'}
        </p>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold text-gray-900 dark:text-gray-100">Wunsch hinzufügen</h2>
        <AddWishForm eventId={event.id} />
      </Card>

      {rows.length > 0 && (
        <ul className="space-y-3" data-testid="wishes">
          {rows.map(({ wish, state }) => {
            const isMoney = wish.targetCents !== null
            return (
              <li key={wish.id} className="space-y-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800" data-testid="admin-wish">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-gray-900 dark:text-gray-100">{wish.title}</span>
                      {isMoney ? <Badge tone="purple">Geldwunsch</Badge> : wish.quantity > 1 ? <Badge>{wish.quantity} Stück</Badge> : null}
                      <Badge tone={state.full ? 'green' : state.reserved > 0 ? 'amber' : 'gray'}>
                        {isMoney ? `${formatEuro(state.reserved)} von ${formatEuro(wish.targetCents!)}` : state.full ? 'reserviert' : state.reserved > 0 ? `${state.reserved} von ${wish.quantity} reserviert` : 'offen'}
                      </Badge>
                    </div>
                    {(wish.description || wish.url || wish.priceCents) && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {[wish.description, wish.priceCents ? `ca. ${formatEuro(wish.priceCents)}` : null].filter(Boolean).join(' · ')}
                        {wish.url && <> · <a href={wish.url} target="_blank" rel="noopener noreferrer" className="underline">Link</a></>}
                      </p>
                    )}
                    {!secret && wish.reservations.length > 0 && (
                      <p className="text-sm text-gray-700 dark:text-gray-300" data-testid="wish-givers">
                        {wish.reservations.map(r => `${names.get(r.participantId) ?? '?'}${isMoney ? ` (${formatEuro(r.amountCents ?? 0)})` : r.quantity > 1 ? ` (${r.quantity})` : ''}`).join(', ')}
                      </p>
                    )}
                  </div>
                  <DeleteWishButton wishId={wish.id} title={wish.title} reserved={wish.reservations.length > 0} />
                </div>
                <details>
                  <summary className="cursor-pointer text-sm text-blue-700 dark:text-blue-300">Bearbeiten</summary>
                  <EditWishForm wish={{
                    id: wish.id, title: wish.title, description: wish.description, url: wish.url, price: euroInput(wish.priceCents),
                    quantity: wish.quantity, target: euroInput(wish.targetCents), money: isMoney
                  }} />
                </details>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
