// app/ui/wish-list.tsx
'use client'

import { useActionState } from 'react'
import { updateWishReservation, type WishActionState } from '../actions'
import { formatEuro } from '../lib/payment-state'
import type { WishForGuest } from '../lib/wishlist-store'

const INPUT = 'border border-gray-300 p-1.5 rounded-md bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100 text-sm'
const BUTTON = 'rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50'

/**
 * Wunschliste auf der Gästeseite (docs/KONZEPT-WUNSCHLISTE.md): Geschenke mit freier Stückzahl, Geldwünsche mit
 * Fortschritt. Reservieren nur mit persönlichem Link (editToken) nach einer Antwort bzw. mit Einladung; ohne ihn nur
 * zum Ansehen. Wer was reserviert hat, sieht niemand - nur die eigene Reservierung.
 */
export default function WishList({ wishes, eventId, editToken }: { wishes: WishForGuest[]; eventId: string; editToken: string | null }) {
  return (
    <section className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 shadow-sm dark:border-gray-700" data-testid="wishlist">
      <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100">🎁 Wunschliste</h3>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        {editToken
          ? 'Reserviere, was du schenken möchtest - so gibt es nichts doppelt. Wer was schenkt, sieht niemand außer dir.'
          : 'Reservieren kannst du, sobald du geantwortet hast - über deinen persönlichen Link.'}
      </p>
      <ul className="mt-4 space-y-3">
        {wishes.map(wish => <WishItem key={wish.id} wish={wish} eventId={eventId} editToken={editToken} />)}
      </ul>
    </section>
  )
}

function WishItem({ wish, eventId, editToken }: { wish: WishForGuest; eventId: string; editToken: string | null }) {
  const [state, action, pending] = useActionState<WishActionState, FormData>(updateWishReservation, null)
  const { state: s } = wish
  const money = wish.targetCents !== null
  const mine = s.mine
  // Wählbare Stückzahl: was frei ist plus das, was man selbst schon hält
  const available = s.remaining + (mine?.quantity ?? 0)
  const canReserve = !!editToken && (money || available > 0)

  return (
    <li className="rounded-lg border border-gray-200 p-3 dark:border-gray-700" data-testid="wish">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-gray-900 dark:text-gray-100">
          {wish.url ? <a href={wish.url} target="_blank" rel="noopener noreferrer nofollow" className="underline decoration-dotted">{wish.title} ↗</a> : wish.title}
        </span>
        <span className="text-sm text-gray-600 dark:text-gray-400" data-testid="wish-status">
          {money
            ? `${formatEuro(s.reserved)} von ${formatEuro(wish.targetCents!)}`
            : wish.quantity === 1 ? (s.full ? 'vergeben' : 'frei') : `noch ${s.remaining} von ${wish.quantity} frei`}
          {wish.priceCents ? ` · ca. ${formatEuro(wish.priceCents)}` : ''}
        </span>
      </div>
      {wish.description && <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{wish.description}</p>}
      {money && (
        <div className="mt-2 h-2 rounded-full bg-gray-100 dark:bg-gray-700" aria-hidden>
          <div className="h-2 rounded-full bg-green-500" style={{ width: `${Math.min(100, Math.round((s.reserved / wish.targetCents!) * 100))}%` }} />
        </div>
      )}
      {mine && (
        <p className="mt-2 text-sm font-medium text-green-700 dark:text-green-300" data-testid="wish-mine">
          ✓ {money ? `Dein Beitrag: ${formatEuro(mine.amountCents ?? 0)}` : `Du schenkst das${wish.quantity > 1 ? ` (${mine.quantity} Stück)` : ''}`}
        </p>
      )}
      {editToken && (canReserve || mine) && (
        <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
          <input type="hidden" name="editToken" value={editToken} />
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="wishId" value={wish.id} />
          {canReserve && money && (
            <label className="flex items-center gap-1 text-sm">
              <span className="sr-only">Betrag für {wish.title}</span>
              <input name="amount" inputMode="decimal" required defaultValue={mine?.amountCents ? (mine.amountCents / 100).toString().replace('.', ',') : ''} placeholder="z. B. 50" className={`${INPUT} w-24`} aria-label={`Betrag für ${wish.title}`} /> €
            </label>
          )}
          {canReserve && !money && wish.quantity > 1 && (
            <select name="quantity" defaultValue={mine?.quantity ?? 1} className={INPUT} aria-label={`Anzahl für ${wish.title}`}>
              {Array.from({ length: available }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n} Stück</option>)}
            </select>
          )}
          {canReserve && (
            <button type="submit" name="mode" value="reserve" disabled={pending} className={BUTTON}>
              {mine ? 'Ändern' : money ? 'Beitragen' : 'Ich schenke das'}
            </button>
          )}
          {mine && (
            <button type="submit" name="mode" value="release" formNoValidate disabled={pending} className="text-sm text-red-700 hover:underline dark:text-red-300">
              Aufheben
            </button>
          )}
        </form>
      )}
      {state?.error && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{state.error}</p>}
      {state?.ok && <p role="status" className="mt-2 text-sm text-green-700 dark:text-green-300">{state.ok}</p>}
    </li>
  )
}
