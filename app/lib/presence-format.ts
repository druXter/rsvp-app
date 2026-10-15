// app/lib/presence-format.ts
//
// Uhrzeiten im Anwesenheitsprotokoll (Idee L7): nur "20:15" am Tag des Termins, an anderen Tagen (mehrtägige
// Termine, Nachtsitzung) mit Datum davor. Immer in der Zeitzone der Termine (Europe/Berlin). Rein.
const TIME_ZONE = 'Europe/Berlin'
const day = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: TIME_ZONE })

export function formatPresenceTime(at: Date, eventDate: Date): string {
  const time = at.toLocaleTimeString('de-DE', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' })
  if (day(at) === day(eventDate)) return time
  return `${at.toLocaleDateString('de-DE', { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit' })} ${time}`
}
