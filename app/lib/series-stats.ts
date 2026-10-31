// app/lib/series-stats.ts
//
// Auswertung einer Reihe (Idee L31): Teilnahme pro Termin als Verlauf, Quote „zugesagt und erschienen“ (nur Termine
// mit QR-Einlass) und wer regelmäßig kommt oder oft zusagt und dann fehlt. Rein, ohne Datenbank: Alles wird bei jedem
// Aufruf aus den gespeicherten Antworten berechnet - es gibt kein eigenes Gedächtnis, was die Löschfristen löschen
// (cron/cleanup), fehlt auch hier.
//
// Personen werden über alle Termine zusammengeführt: Teilnehmendenkonto, sonst bestätigte E-Mail-Adresse, sonst der
// Participant der Reihe (persönlicher Link). Unbestätigte Adressen führen nichts zusammen - wer sich mit einer fremden
// Adresse anmeldet, soll nicht in deren Statistik landen.
import type { Prisma } from '@prisma/client'
import { isPastEvent, summarizeEvent } from './event-summary'

/** Was die Auswertung pro Termin lädt (Reiter und CSV) - Personen nur mit Name und den Merkmalen zum Zusammenführen. */
export const SERIES_STATS_SELECT = {
  id: true, title: true, date: true, duration: true, datePending: true, enableCheckin: true, maxCapacity: true,
  rsvps: {
    select: {
      isAttending: true, isMaybe: true, isOnWaitlist: true, hasAttended: true, amountCents: true, paidAt: true, refundedAt: true, paymentDueAt: true,
      reconfirmLapsedAt: true,
      participant: { select: { id: true, name: true, email: true, isVerified: true, guestUserId: true } },
      persons: { select: { isAttending: true, ageGroup: true, checkedInAt: true } }
    }
  }
} satisfies Prisma.EventSelect

type StatsParticipant = { id: string; name: string; email: string | null; isVerified: boolean; guestUserId: string | null }
type StatsRsvp = {
  isAttending: boolean
  isMaybe: boolean
  isOnWaitlist: boolean
  hasAttended: boolean
  amountCents: number | null
  paidAt: Date | null
  refundedAt: Date | null
  paymentDueAt: Date | null
  reconfirmLapsedAt: Date | null
  participant: StatsParticipant
  persons?: readonly { isAttending: boolean; ageGroup: string; checkedInAt?: Date | null }[]
}
export type StatsTermin = {
  id: string
  title: string
  date: Date
  duration: number
  datePending: boolean
  enableCheckin: boolean
  maxCapacity: number | null
  rsvps: readonly StatsRsvp[]
}

export type TerminStats = {
  id: string
  title: string
  date: Date
  datePending: boolean
  past: boolean
  maxCapacity: number | null
  confirmed: number
  seats: number
  waitlist: number
  maybe: number
  declined: number
  /** Zusagen ohne Bestätigung abgesagt (Rückbestätigung, app/lib/reconfirm.ts) */
  lapsed: number
  /** Nur mit QR-Einlass: Zusagen mit festem Platz, die eingecheckt wurden; sonst null */
  attended: number | null
}

export type PersonStats = {
  key: string
  name: string
  /** Woran die Person über Termine hinweg erkannt wird */
  matchedBy: 'konto' | 'adresse' | 'link'
  confirmed: number
  attended: number
  /** zugesagt (fester Platz) bei einem Termin mit Einlass, aber nicht eingecheckt */
  noShow: number
  declined: number
  lapsed: number
  regular: boolean
}

export type SeriesStats = {
  termine: TerminStats[]
  pastCount: number
  avgConfirmed: number | null
  /** Quote „zugesagt und erschienen“ über alle vergangenen Termine mit Einlass, null ohne solche */
  attendanceRate: number | null
  checkinTermine: number
  persons: PersonStats[]
  regularThreshold: number
}

const fixed = (r: { isAttending: boolean; isOnWaitlist: boolean }) => r.isAttending && !r.isOnWaitlist

/** Schlüssel einer Person über alle Termine der Reihe (siehe Kopfkommentar). */
export function personKey(p: StatsParticipant): { key: string; matchedBy: PersonStats['matchedBy'] } {
  if (p.guestUserId) return { key: `konto:${p.guestUserId}`, matchedBy: 'konto' }
  if (p.email && p.isVerified) return { key: `adresse:${p.email.trim().toLowerCase()}`, matchedBy: 'adresse' }
  return { key: `link:${p.id}`, matchedBy: 'link' }
}

/** Stammgast: bei mindestens der Hälfte der vergangenen Termine (aufgerundet, mindestens 2) zugesagt. */
export function regularThreshold(pastCount: number): number {
  return Math.max(2, Math.ceil(pastCount / 2))
}

export function seriesStats(termine: readonly StatsTermin[], now = new Date()): SeriesStats {
  const sorted = [...termine].sort((a, b) => a.date.getTime() - b.date.getTime())
  const rows: TerminStats[] = sorted.map(t => {
    const s = summarizeEvent(t.rsvps, null, now)
    return {
      id: t.id, title: t.title, date: t.date, datePending: t.datePending, past: isPastEvent(t, now), maxCapacity: t.maxCapacity,
      confirmed: s.confirmed, seats: s.seats, waitlist: s.waitlist, maybe: s.maybe,
      declined: t.rsvps.filter(r => !r.isAttending && !r.isMaybe && !r.reconfirmLapsedAt).length,
      lapsed: t.rsvps.filter(r => !r.isAttending && r.reconfirmLapsedAt).length,
      attended: t.enableCheckin ? t.rsvps.filter(r => fixed(r) && r.hasAttended).length : null
    }
  })
  const past = sorted.filter(t => isPastEvent(t, now))
  const pastRows = rows.filter(r => r.past)
  const withCheckin = pastRows.filter(r => r.attended !== null)
  const checkinConfirmed = withCheckin.reduce((sum, r) => sum + r.confirmed, 0)
  const threshold = regularThreshold(past.length)

  // Personen nur über vergangene Termine: wer kommt regelmäßig, wer fehlt nach einer Zusage
  const persons = new Map<string, PersonStats>()
  for (const t of past) {
    for (const r of t.rsvps) {
      const { key, matchedBy } = personKey(r.participant)
      const p = persons.get(key) ?? { key, name: r.participant.name, matchedBy, confirmed: 0, attended: 0, noShow: 0, declined: 0, lapsed: 0, regular: false }
      // Termine kommen nach Datum sortiert - der Name der jüngsten Antwort gilt
      p.name = r.participant.name
      if (fixed(r)) {
        p.confirmed++
        if (t.enableCheckin) {
          if (r.hasAttended) p.attended++
          else p.noShow++
        }
      } else if (!r.isAttending && r.reconfirmLapsedAt) {
        p.lapsed++
      } else if (!r.isAttending && !r.isMaybe) {
        p.declined++
      }
      persons.set(key, p)
    }
  }
  const list = [...persons.values()]
    .map(p => ({ ...p, regular: past.length >= 2 && p.confirmed >= threshold }))
    .sort((a, b) => b.confirmed - a.confirmed || b.attended - a.attended || a.name.localeCompare(b.name, 'de'))

  return {
    termine: rows,
    pastCount: past.length,
    avgConfirmed: pastRows.length > 0 ? pastRows.reduce((sum, r) => sum + r.confirmed, 0) / pastRows.length : null,
    attendanceRate: checkinConfirmed > 0 ? withCheckin.reduce((sum, r) => sum + r.attended!, 0) / checkinConfirmed : null,
    checkinTermine: withCheckin.length,
    persons: list,
    regularThreshold: threshold
  }
}

/** Quote zugesagt und erschienen einer Person, null ohne Termine mit Einlass. */
export function personRate(p: Pick<PersonStats, 'attended' | 'noShow'>): number | null {
  const total = p.attended + p.noShow
  return total > 0 ? p.attended / total : null
}

export function formatPercent(rate: number | null): string {
  return rate === null ? '-' : `${Math.round(rate * 100)} %`
}

export const MATCHED_BY_LABELS: Record<PersonStats['matchedBy'], string> = {
  konto: 'Teilnehmendenkonto',
  adresse: 'bestätigte E-Mail-Adresse',
  link: 'persönlicher Link'
}
