// app/lib/event-lock.ts

/**
 * Sperre pro Termin für „Platz prüfen und vergeben“ (docs/AUDIT-2026-11.md, R-06). Ohne sie lesen gleichzeitige
 * Zusagen alle denselben Stand, sehen „noch frei“ und bekommen zusammen mehr feste Plätze, als es gibt. Wer die Sperre
 * hält, prüft mit loadCapacity/hasRoom und schreibt Antwort und Personen; erst danach prüft der Nächste.
 *
 * Bewusst im Prozess statt in der Datenbank: rsvp-app läuft als EIN Node-Prozess (ein Container, `next start`) auf
 * EINER SQLite-Datei. Liefe die App je in mehreren Prozessen, gehörte das in die Datenbank (z. B. ein bedingtes
 * Schreiben wie bei reserveWish). Nicht verschachteln: Wer die Sperre eines Termins hält, darf nichts aufrufen, das
 * sie für denselben Termin noch einmal anfordert (fillFreeSeats erst nach dem Freigeben).
 */
const tails = new Map<string, Promise<void>>()

/** Wartet auf die Sperre des Termins und gibt die Freigabe zurück (mehrfaches Aufrufen schadet nicht). */
export async function lockEvent(eventId: string): Promise<() => void> {
  const previous = tails.get(eventId) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>(resolve => { release = resolve })
  const tail = previous.then(() => current)
  tails.set(eventId, tail)
  await previous
  let released = false
  return () => {
    if (released) return
    released = true
    release()
    if (tails.get(eventId) === tail) tails.delete(eventId)
  }
}

/** Führt `fn` unter der Sperre des Termins aus. */
export async function withEventLock<T>(eventId: string, fn: () => Promise<T>): Promise<T> {
  const unlock = await lockEvent(eventId)
  try {
    return await fn()
  } finally {
    unlock()
  }
}
