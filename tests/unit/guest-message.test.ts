import { describe, expect, it } from 'vitest'
import { describeAudience, groupOf, messageParagraphs, readAudience, selectRecipients, type MessageAudience, type MessageRsvp } from '../../app/lib/guest-message'

// Nachricht an Gäste (Idee L29): Gruppen, Filter, Bestätigung der Adresse, Formular, Absätze.
const NOW = new Date('2026-11-01T12:00:00Z')
function rsvp(overrides: Partial<MessageRsvp> & { email?: string | null; verified?: boolean } = {}): MessageRsvp {
  const { email = 'gast@example.org', verified = true, ...rest } = overrides
  return {
    isAttending: true, isMaybe: false, isOnWaitlist: false, hasAttended: false, ticketCategoryId: null,
    amountCents: null, paymentDueAt: null, paidAt: null, refundedAt: null,
    participant: { email, isVerified: verified }, ...rest
  }
}
const audience = (overrides: Partial<MessageAudience> = {}): MessageAudience => ({ groups: ['attending'], categoryId: null, unpaidOnly: false, checkin: 'all', ...overrides })

describe('groupOf', () => {
  it('Zusage, Warteliste, Vielleicht; Absage gehört zu keiner Gruppe', () => {
    expect(groupOf(rsvp())).toBe('attending')
    expect(groupOf(rsvp({ isOnWaitlist: true }))).toBe('waitlist')
    expect(groupOf(rsvp({ isAttending: false, isMaybe: true }))).toBe('maybe')
    expect(groupOf(rsvp({ isAttending: false }))).toBeNull()
  })
})

describe('selectRecipients', () => {
  const rows = [
    rsvp(),
    rsvp({ isOnWaitlist: true }),
    rsvp({ isAttending: false, isMaybe: true }),
    rsvp({ isAttending: false, isMaybe: true, verified: false }),
    rsvp({ isAttending: false }),
    rsvp({ email: null, verified: false })
  ]
  it('nur gewählte Gruppen, nie Absagen; Vielleicht nur mit bestätigter Adresse', () => {
    expect(selectRecipients(rows, audience(), false, NOW).all).toHaveLength(2)
    expect(selectRecipients(rows, audience({ groups: ['attending', 'waitlist', 'maybe'] }), false, NOW).all).toHaveLength(4)
    expect(selectRecipients(rows, audience({ groups: ['maybe'] }), false, NOW).all).toHaveLength(1)
  })
  it('ohne Adresse nur Push; mit E-Mail-Bestätigung nur bestätigte', () => {
    const plain = selectRecipients(rows, audience(), false, NOW)
    expect(plain.mail).toHaveLength(1)
    expect(selectRecipients(rows, audience(), true, NOW).all).toHaveLength(1)
  })
  it('Ticketkategorie, offene Zahlung, Einlass', () => {
    const due = new Date('2026-11-10T00:00:00Z')
    const list = [
      rsvp({ ticketCategoryId: 'studi', amountCents: 1500, paymentDueAt: due }),
      rsvp({ ticketCategoryId: 'studi', amountCents: 1500, paidAt: NOW, hasAttended: true }),
      rsvp({ ticketCategoryId: 'gast', amountCents: 2500, paymentDueAt: new Date('2026-10-01T00:00:00Z') })
    ]
    expect(selectRecipients(list, audience({ categoryId: 'studi' }), false, NOW).all).toHaveLength(2)
    expect(selectRecipients(list, audience({ unpaidOnly: true }), false, NOW).all).toEqual([list[0], list[2]])
    expect(selectRecipients(list, audience({ checkin: 'in' }), false, NOW).all).toEqual([list[1]])
    expect(selectRecipients(list, audience({ checkin: 'out' }), false, NOW).all).toHaveLength(2)
  })
})

describe('readAudience', () => {
  const form = (entries: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(entries)) f.set(k, v); return f }
  it('ohne Gruppe null, unbekannte Kategorie und Einlass fallen auf alle', () => {
    expect(readAudience(form({}), [])).toBeNull()
    expect(readAudience(form({ group_waitlist: 'on', categoryId: 'fremd', checkin: 'quatsch', unpaidOnly: 'on' }), ['studi']))
      .toEqual({ groups: ['waitlist'], categoryId: null, unpaidOnly: true, checkin: 'all' })
    expect(readAudience(form({ group_attending: 'on', group_maybe: 'on', categoryId: 'studi', checkin: 'in' }), ['studi']))
      .toEqual({ groups: ['attending', 'maybe'], categoryId: 'studi', unpaidOnly: false, checkin: 'in' })
  })
  it('Beschreibung für den Verlauf', () => {
    expect(describeAudience(audience({ groups: ['attending', 'waitlist'], categoryId: 'studi', unpaidOnly: true, checkin: 'out' }), 'Studi'))
      .toBe('Zusagen, Warteliste · Kategorie Studi · nur offene Zahlung · nur nicht eingecheckt')
  })
})

describe('messageParagraphs', () => {
  it('Absätze an Leerzeilen, Zeilenumbrüche bleiben, Windows-Zeilenenden', () => {
    expect(messageParagraphs('Hallo\r\nzusammen\r\n\r\n  \r\nZweiter Absatz\n\n\n')).toEqual(['Hallo\nzusammen', 'Zweiter Absatz'])
  })
})
