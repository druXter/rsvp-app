// app/admin/events/[id]/wuensche/wish-forms.tsx
'use client'

import { useActionState, useState } from 'react'
import { addWish, removeWish, saveWish, type WishFormState } from '../../../wish-actions'
import { buttonClass, hintClass, inputClass, labelClass } from '../../../../ui/kit'

type WishValues = { id: string; title: string; description: string | null; url: string | null; price: string; quantity: number; target: string; money: boolean }

const EMPTY: WishValues = { id: '', title: '', description: null, url: null, price: '', quantity: 1, target: '', money: false }

/** Felder eines Wunschs (gelesen von readWishInput): Geschenk mit Anzahl oder Geldwunsch mit Zielbetrag. */
function WishFields({ values, prefix }: { values: WishValues; prefix: string }) {
  const [money, setMoney] = useState(values.money)
  const id = (name: string) => `${prefix}-${name}`
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4 text-sm" role="radiogroup" aria-label="Art des Wunschs">
        <label className="flex items-center gap-2"><input type="radio" name="kind" value="item" defaultChecked={!values.money} onChange={() => setMoney(false)} /> Geschenk</label>
        <label className="flex items-center gap-2"><input type="radio" name="kind" value="money" defaultChecked={values.money} onChange={() => setMoney(true)} /> Geldwunsch (Teilbeträge)</label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={id('title')} className={labelClass}>Bezeichnung</label>
          <input id={id('title')} name="title" defaultValue={values.title} required maxLength={100} className={inputClass} placeholder={money ? 'z. B. Hochzeitsreise' : 'z. B. Kaffeemaschine'} />
        </div>
        {money ? (
          <div>
            <label htmlFor={id('target')} className={labelClass}>Zielbetrag in €</label>
            <input id={id('target')} name="target" defaultValue={values.target} required inputMode="decimal" className={inputClass} placeholder="2000" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={id('quantity')} className={labelClass}>Anzahl</label>
              <input id={id('quantity')} name="quantity" type="number" min={1} max={99} defaultValue={values.quantity} className={inputClass} />
            </div>
            <div>
              <label htmlFor={id('price')} className={labelClass}>Preis ca. (€)</label>
              <input id={id('price')} name="price" defaultValue={values.price} inputMode="decimal" className={inputClass} placeholder="optional" />
            </div>
          </div>
        )}
      </div>
      <div>
        <label htmlFor={id('url')} className={labelClass}>Link (optional)</label>
        <input id={id('url')} name="url" type="url" defaultValue={values.url ?? ''} className={inputClass} placeholder="https://…" />
      </div>
      <div>
        <label htmlFor={id('description')} className={labelClass}>Beschreibung (optional)</label>
        <input id={id('description')} name="description" defaultValue={values.description ?? ''} maxLength={500} className={inputClass} placeholder={money ? 'z. B. Zwei Wochen Portugal im Herbst' : 'z. B. Farbe, Modell'} />
      </div>
    </div>
  )
}

function Feedback({ state, success }: { state: WishFormState; success: string }) {
  if (state?.error) return <p role="alert" className="text-sm text-red-700 dark:text-red-300">{state.error}</p>
  if (state?.saved) return <p role="status" className="text-sm text-green-700 dark:text-green-300">{success}</p>
  return null
}

export function AddWishForm({ eventId }: { eventId: string }) {
  const [state, action, pending] = useActionState<WishFormState, FormData>(addWish, null)
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="eventId" value={eventId} />
      <WishFields values={EMPTY} prefix="new" />
      <p className={hintClass}>Gäste sehen Bezeichnung, Beschreibung, Link und Preis, reservieren Stück bzw. tragen ihren Betrag ein. Wer was reserviert, sehen andere Gäste nie.</p>
      <Feedback state={state} success="✅ Wunsch hinzugefügt." />
      <button type="submit" disabled={pending} className={buttonClass('primary', 'sm')}>Wunsch hinzufügen</button>
    </form>
  )
}

export function EditWishForm({ wish }: { wish: WishValues }) {
  const [state, action, pending] = useActionState<WishFormState, FormData>(saveWish, null)
  return (
    <form action={action} className="mt-2 space-y-3">
      <input type="hidden" name="wishId" value={wish.id} />
      <WishFields values={wish} prefix={`edit-${wish.id}`} />
      <Feedback state={state} success="✅ Gespeichert." />
      <button type="submit" disabled={pending} className={buttonClass('primary', 'sm')}>Speichern</button>
    </form>
  )
}

export function DeleteWishButton({ wishId, title, reserved }: { wishId: string; title: string; reserved: boolean }) {
  return (
    <form action={removeWish}>
      <input type="hidden" name="wishId" value={wishId} />
      <button
        type="submit" className={buttonClass('danger', 'sm')} aria-label={`Wunsch ${title} löschen`}
        onClick={e => { if (!confirm(`Wunsch „${title}“ löschen?${reserved ? ' Er ist schon reserviert - die Reservierungen gehen verloren.' : ''}`)) e.preventDefault() }}
      >
        🗑️
      </button>
    </form>
  )
}
