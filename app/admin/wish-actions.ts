// app/admin/wish-actions.ts
'use server'

// Wunschliste verwalten (docs/KONZEPT-WUNSCHLISTE.md): Wünsche anlegen, ändern, löschen - für alle mit Zugriff auf
// die Gästeliste (wie Einladungen). Ob Namen sichtbar sind, stellen Owner/Admins in den Einstellungen ein.
import { revalidatePath } from 'next/cache'
import { prisma } from '../lib/prisma'
import { requireUser } from '../lib/auth'
import { hasEventModeratorOrAbove } from '../lib/permissions'
import { formString } from '../lib/form'
import { readWishInput, WishInputError } from '../lib/wishlist'
import { createWish, deleteWish, updateWish } from '../lib/wishlist-store'

export type WishFormState = { error?: string; saved?: boolean } | null

async function editableEvent(eventId: string) {
  const user = await requireUser()
  const event = await prisma.event.findUnique({ where: { id: eventId }, include: { series: { select: { slug: true } } } })
  if (!event || !(await hasEventModeratorOrAbove(user, event))) return null
  return event
}

function revalidate(event: { id: string; slug: string; series: { slug: string } | null }) {
  revalidatePath(`/admin/events/${event.id}/wuensche`)
  revalidatePath(event.series ? `/reihe/${event.series.slug}/${event.slug}` : `/${event.slug}`)
}

async function withErrors(run: () => Promise<void>): Promise<WishFormState> {
  try {
    await run()
  } catch (error) {
    if (error instanceof WishInputError) return { error: error.message }
    throw error
  }
  return { saved: true }
}

export async function addWish(_prev: WishFormState, formData: FormData): Promise<WishFormState> {
  const event = await editableEvent(formString(formData, 'eventId', 50))
  if (!event) return { error: 'Termin nicht gefunden.' }
  const result = await withErrors(() => createWish(event.id, readWishInput(formData)))
  if (result?.saved) revalidate(event)
  return result
}

export async function saveWish(_prev: WishFormState, formData: FormData): Promise<WishFormState> {
  const wish = await prisma.wish.findUnique({ where: { id: formString(formData, 'wishId', 50) } })
  const event = wish ? await editableEvent(wish.eventId) : null
  if (!wish || !event) return { error: 'Wunsch nicht gefunden.' }
  const result = await withErrors(() => updateWish(wish.id, readWishInput(formData)))
  if (result?.saved) revalidate(event)
  return result
}

/** Löscht einen Wunsch samt Reservierungen (die Seite fragt vorher nach). */
export async function removeWish(formData: FormData) {
  const wish = await prisma.wish.findUnique({ where: { id: formString(formData, 'wishId', 50) } })
  const event = wish ? await editableEvent(wish.eventId) : null
  if (!wish || !event) return
  await deleteWish(wish.id)
  revalidate(event)
}
