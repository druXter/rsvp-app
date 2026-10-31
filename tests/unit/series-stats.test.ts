import { describe, expect, it } from 'vitest'
import { personKey, regularThreshold, seriesStats, type StatsTermin } from '../../app/lib/series-stats'

// Auswertung einer Reihe (Idee L31): Verlauf pro Termin, Quote „zugesagt und erschienen“, Personen über alle Termine
const now = new Date('2026-11-01T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000
let ids = 0

type P = { id: string; name: string; email: string | null; isVerified: boolean; guestUserId: string | null }
const person = (name: string, extra: Partial<P> = {}): P => ({ id: `p${++ids}`, name, email: null, isVerified: false, guestUserId: null, ...extra })
const answer = (participant: P, state: 'yes' | 'came' | 'no' | 'maybe' | 'wait' | 'lapsed') => ({
  isAttending: state === 'yes' || state === 'came' || state === 'wait',
  isOnWaitlist: state === 'wait',
  isMaybe: state === 'maybe',
  hasAttended: state === 'came',
  amountCents: null, paidAt: null, refundedAt: null, paymentDueAt: null,
  reconfirmLapsedAt: state === 'lapsed' ? now : null,
  participant
})
const termin = (daysFromNow: number, rsvps: StatsTermin['rsvps'], extra: Partial<StatsTermin> = {}): StatsTermin => ({
  id: `t${++ids}`, title: `Termin ${ids}`, date: new Date(now.getTime() + daysFromNow * DAY), duration: 3, datePending: false, enableCheckin: false, maxCapacity: null, rsvps, ...extra
})

describe('Personen zusammenführen', () => {
  it('Konto vor bestätigter Adresse vor persönlichem Link; unbestätigte Adressen führen nichts zusammen', () => {
    expect(personKey(person('A', { guestUserId: 'g1', email: 'a@x.de', isVerified: true }))).toEqual({ key: 'konto:g1', matchedBy: 'konto' })
    expect(personKey(person('A', { email: ' A@X.de ', isVerified: true }))).toEqual({ key: 'adresse:a@x.de', matchedBy: 'adresse' })
    const unverified = person('A', { email: 'a@x.de' })
    expect(personKey(unverified)).toEqual({ key: `link:${unverified.id}`, matchedBy: 'link' })
  })
})

describe('Auswertung', () => {
  const anna = person('Anna', { guestUserId: 'g-anna' })
  const annaNeu = person('Anna B.', { guestUserId: 'g-anna' })
  const ben = person('Ben', { email: 'ben@x.de', isVerified: true })
  const benZweiterLink = person('Ben', { email: 'BEN@x.de', isVerified: true })
  const cleo = person('Cleo')
  const termine = [
    termin(-21, [answer(anna, 'came'), answer(ben, 'yes'), answer(cleo, 'no')], { enableCheckin: true, maxCapacity: 10 }),
    termin(-14, [answer(anna, 'came'), answer(benZweiterLink, 'came'), answer(cleo, 'maybe')], { enableCheckin: true }),
    termin(-7, [answer(annaNeu, 'yes'), answer(ben, 'lapsed'), answer(cleo, 'wait')]),
    termin(7, [answer(anna, 'yes'), answer(ben, 'yes'), answer(cleo, 'yes')])
  ]
  const stats = seriesStats(termine, now)

  it('Verlauf: alle Termine nach Datum, anstehende markiert, Erschienen nur mit Einlass', () => {
    expect(stats.termine.map(t => [t.past, t.confirmed, t.waitlist, t.maybe, t.declined, t.lapsed, t.attended])).toEqual([
      [true, 2, 0, 0, 1, 0, 1],
      [true, 2, 0, 1, 0, 0, 2],
      [true, 1, 1, 0, 0, 1, null],
      [false, 3, 0, 0, 0, 0, null]
    ])
  })

  it('Kennzahlen nur aus vergangenen Terminen', () => {
    expect(stats.pastCount).toBe(3)
    expect(stats.avgConfirmed).toBeCloseTo(5 / 3)
    // Termine mit Einlass: 3 von 4 festen Zusagen eingecheckt
    expect(stats.attendanceRate).toBe(0.75)
    expect(stats.checkinTermine).toBe(2)
  })

  it('Personen: zusammengeführt, jüngster Name, Gefehlt nur bei Einlass, Stammgast ab der Hälfte', () => {
    expect(regularThreshold(3)).toBe(2)
    expect(stats.persons).toEqual([
      { key: 'konto:g-anna', name: 'Anna B.', matchedBy: 'konto', confirmed: 3, attended: 2, noShow: 0, declined: 0, lapsed: 0, regular: true },
      { key: 'adresse:ben@x.de', name: 'Ben', matchedBy: 'adresse', confirmed: 2, attended: 1, noShow: 1, declined: 0, lapsed: 1, regular: true },
      { key: `link:${cleo.id}`, name: 'Cleo', matchedBy: 'link', confirmed: 0, attended: 0, noShow: 0, declined: 1, lapsed: 0, regular: false }
    ])
  })

  it('ohne vergangene Termine keine Personen und keine Quote', () => {
    const upcoming = seriesStats([termin(3, [answer(anna, 'yes')], { enableCheckin: true })], now)
    expect(upcoming).toMatchObject({ pastCount: 0, avgConfirmed: null, attendanceRate: null, persons: [] })
  })

  it('Stammgast braucht mindestens zwei vergangene Termine', () => {
    const single = seriesStats([termin(-3, [answer(anna, 'yes')])], now)
    expect(single.persons[0].regular).toBe(false)
  })
})
