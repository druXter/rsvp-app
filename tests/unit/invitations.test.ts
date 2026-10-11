import { describe, expect, it } from 'vitest'
import { formatPersonList, householdAttends, invitationStatus, parseInvitationLines, parsePersonList, readHousehold, resolveHousehold, type HouseholdPersonInput, invitationCovers, invitationsForTermin } from '../../app/lib/invitations'
import { deadlineInputValue, deadlinePassed, formatDeadline, parseDeadline } from '../../app/lib/rsvp-deadline'

describe('Einladungen (docs/KONZEPT-EINLADUNGEN.md)', () => {
  it('parseInvitationLines: Bezeichnung, dann E-Mail, Personen und Zusatzpersonen in beliebiger Reihenfolge', () => {
    expect(parseInvitationLines('Familie Müller; Mueller@Example.org; Anna, Ben, Clara (Kind), Dora (Kleinkind); +1\n\nTante Erna; +2\nJonas; Jonas, Lea (erwachsen)')).toEqual([
      { label: 'Familie Müller', email: 'mueller@example.org', extraPersons: 1, persons: [
        { name: 'Anna', ageGroup: 'ADULT' }, { name: 'Ben', ageGroup: 'ADULT' }, { name: 'Clara', ageGroup: 'CHILD' }, { name: 'Dora', ageGroup: 'INFANT' }
      ] },
      { label: 'Tante Erna', email: null, extraPersons: 2, persons: [{ name: 'Tante Erna', ageGroup: 'ADULT' }] },
      { label: 'Jonas', email: null, extraPersons: 0, persons: [{ name: 'Jonas', ageGroup: 'ADULT' }, { name: 'Lea', ageGroup: 'ADULT' }] }
    ])
  })

  it('parseInvitationLines: Fehler mit Meldung', () => {
    expect(() => parseInvitationLines('; x@y.de')).toThrow('Bezeichnung')
    expect(() => parseInvitationLines('A; x@y')).toThrow('keine gültige E-Mail')
    expect(() => parseInvitationLines('A; x@y.de; z@y.de')).toThrow('zwei E-Mail')
    expect(() => parseInvitationLines('A; Anna; Ben')).toThrow('mehreren Feldern')
    expect(() => parseInvitationLines('A; Anna (Oma)')).toThrow('keine Altersgruppe')
    expect(() => parseInvitationLines('A; Anna (constructor)')).toThrow('keine Altersgruppe')
    expect(() => parseInvitationLines('A; +11')).toThrow('höchstens +10')
    expect(() => parseInvitationLines(`A; ${Array.from({ length: 21 }, (_, i) => `P${i}`).join(', ')}`)).toThrow('höchstens 20')
  })

  it('parsePersonList/formatPersonList sind Gegenstücke', () => {
    const persons = parsePersonList('Anna,\nBen (Kind), Mia (Baby)')
    expect(persons).toEqual([{ name: 'Anna', ageGroup: 'ADULT' }, { name: 'Ben', ageGroup: 'CHILD' }, { name: 'Mia', ageGroup: 'INFANT' }])
    expect(formatPersonList(persons)).toBe('Anna, Ben (Kind), Mia (Kleinkind)')
    expect(parsePersonList(formatPersonList(persons))).toEqual(persons)
  })

  const invited = [{ id: 'p1', name: 'Anna', ageGroup: 'ADULT', position: 0 }, { id: 'p2', name: 'Clara', ageGroup: 'CHILD', position: 1 }]
  const answer = (id: string | null, name: string, isAttending: boolean, ageGroup: 'ADULT' | 'CHILD' | 'INFANT' = 'ADULT'): HouseholdPersonInput =>
    ({ invitationPersonId: id, name, ageGroup, isAttending, dietaryOption: null, allergies: null, menu: {}, drinksAlcohol: null })

  it('resolveHousehold: jede eingeladene Person genau einmal, Altersgruppe aus der Einladung, Name korrigierbar', () => {
    const result = resolveHousehold(invited, 1, [answer('p2', 'Klara', true, 'ADULT'), answer('p1', '', false), answer(null, 'Max', true)])
    expect(result).toEqual({ persons: [answer('p1', 'Anna', false), answer('p2', 'Klara', true, 'CHILD'), answer(null, 'Max', true)] })
  })

  it('resolveHousehold: Alkohol nur bei Erwachsenen laut Einladung', () => {
    const result = resolveHousehold(invited, 1, [{ ...answer('p1', 'Anna', true), drinksAlcohol: true }, { ...answer('p2', 'Clara', true, 'ADULT'), drinksAlcohol: true }, { ...answer(null, 'Mia', true, 'INFANT'), drinksAlcohol: false }])
    expect('persons' in result && result.persons.map(p => p.drinksAlcohol)).toEqual([true, null, null])
  })

  it('resolveHousehold: fremde, doppelte, fehlende Personen und zu viele Zusatzpersonen', () => {
    expect(resolveHousehold(invited, 1, [answer('p1', 'Anna', true)])).toEqual({ error: 'Bitte gib für Clara an, ob die Person kommt.' })
    expect(resolveHousehold(invited, 1, [answer('p1', 'Anna', true), answer('p2', 'Clara', true), answer('px', 'Eve', true)])).toMatchObject({ error: expect.stringContaining('nicht zu dieser Einladung') })
    expect(resolveHousehold(invited, 1, [answer('p1', 'Anna', true), answer('p1', 'Anna', true), answer('p2', 'Clara', true)])).toMatchObject({ error: expect.stringContaining('doppelt') })
    expect(resolveHousehold(invited, 0, [answer('p1', 'Anna', true), answer('p2', 'Clara', true), answer(null, 'Max', true)])).toEqual({ error: 'Diese Einladung sieht keine weiteren Personen vor.' })
    expect(resolveHousehold(invited, 1, [answer('p1', 'Anna', true), answer('p2', 'Clara', true), answer(null, 'Max', true), answer(null, 'Moritz', true)])).toMatchObject({ error: expect.stringContaining('höchstens 1 weitere Person') })
  })

  it('householdAttends: mindestens eine Person, die nicht nur ein Kleinkind ist', () => {
    expect(householdAttends([answer('p1', 'A', false), answer('p2', 'B', true, 'CHILD')])).toBe(true)
    expect(householdAttends([answer('p1', 'A', false), answer('p2', 'B', true, 'INFANT')])).toBe(false)
    expect(householdAttends([])).toBe(false)
  })

  it('readHousehold: nur mit Markierungsfeld; Zusatzpersonen ohne ID, leere Zeilen zählen nicht', () => {
    const form = new FormData()
    form.set('person_0_id', 'p1')
    expect(readHousehold(form)).toBeUndefined()
    form.set('householdShown', '1')
    form.set('person_0_name', ' Anna ')
    form.set('person_0_attending', 'true')
    form.set('person_0_diet', 'Vegan')
    form.set('person_0_alcohol', 'false')
    form.set('person_1_id', 'p2')
    form.set('person_1_attending', 'false')
    form.set('person_2_name', 'Max')
    form.set('person_2_age', 'CHILD')
    form.set('person_2_attending', 'true')
    form.set('person_3_name', '')
    expect(readHousehold(form)).toEqual([
      { invitationPersonId: 'p1', name: 'Anna', ageGroup: 'ADULT', isAttending: true, dietaryOption: 'Vegan', allergies: null, menu: {}, drinksAlcohol: false },
      { invitationPersonId: 'p2', name: '', ageGroup: 'ADULT', isAttending: false, dietaryOption: null, allergies: null, menu: {}, drinksAlcohol: null },
      { invitationPersonId: null, name: 'Max', ageGroup: 'CHILD', isAttending: true, dietaryOption: null, allergies: null, menu: {}, drinksAlcohol: null }
    ])
  })

  it('invitationStatus: pro Person kommt/kommt nicht/offen, Zusatzpersonen, Stand der Einladung', () => {
    expect(invitationStatus(invited, null)).toEqual({ state: 'open', persons: [
      { name: 'Anna', ageGroup: 'ADULT', status: 'open', extra: false }, { name: 'Clara', ageGroup: 'CHILD', status: 'open', extra: false }
    ] })
    const rsvp = { isAttending: true, isOnWaitlist: false, persons: [
      { invitationPersonId: 'p1', name: 'Anna', ageGroup: 'ADULT', isAttending: false, position: 0 },
      { invitationPersonId: null, name: 'Max', ageGroup: 'ADULT', isAttending: true, position: 2 }
    ] }
    expect(invitationStatus(invited, rsvp)).toEqual({ state: 'attending', persons: [
      { name: 'Anna', ageGroup: 'ADULT', status: 'no', extra: false },
      { name: 'Clara', ageGroup: 'CHILD', status: 'open', extra: false },
      { name: 'Max', ageGroup: 'ADULT', status: 'yes', extra: true }
    ] })
    expect(invitationStatus(invited, { ...rsvp, isOnWaitlist: true }).state).toBe('waitlist')
    expect(invitationStatus(invited, { ...rsvp, isAttending: false }).state).toBe('declined')
  })
})

describe('Antwortfrist', () => {
  it('Datum -> Ende des Tages in Ortszeit, Gegenstück fürs Formular, abgelaufen erst nach 23:59:59', () => {
    // Sommerzeit: 23:59:59 in Berlin = 21:59:59 UTC, Winterzeit 22:59:59 UTC - egal, wie der Server eingestellt ist
    const deadline = parseDeadline('2027-05-30')!
    expect(deadline.toISOString()).toBe('2027-05-30T21:59:59.000Z')
    expect(parseDeadline('2027-01-15')!.toISOString()).toBe('2027-01-15T22:59:59.000Z')
    expect(deadlineInputValue(deadline)).toBe('2027-05-30')
    expect(formatDeadline(deadline)).toBe('Sonntag, 30. Mai 2027')
    expect(deadlinePassed({ rsvpDeadline: deadline }, new Date('2027-05-30T21:00:00Z'))).toBe(false)
    expect(deadlinePassed({ rsvpDeadline: deadline }, new Date('2027-05-30T22:00:00Z'))).toBe(true)
    expect(deadlinePassed({ rsvpDeadline: null })).toBe(false)
    expect(parseDeadline('')).toBeNull()
    expect(() => parseDeadline('2027-02-30')).toThrow('gültiges Datum')
    expect(() => parseDeadline('morgen')).toThrow('gültiges Datum')
  })
})

describe('Einladungen einer Reihe', () => {
  const single = { eventId: 'e1', seriesId: null, allEvents: true, events: [] }
  const all = { eventId: null, seriesId: 's1', allEvents: true, events: [] }
  const some = { eventId: null, seriesId: 's1', allEvents: false, events: [{ eventId: 't2' }] }

  it('invitationCovers: Einzel-Event nur sich selbst, Reihe alle bzw. ausgewählte Termine, nie fremde Reihen', () => {
    expect(invitationCovers(single, { id: 'e1', seriesId: null })).toBe(true)
    expect(invitationCovers(single, { id: 'e2', seriesId: null })).toBe(false)
    expect(invitationCovers(all, { id: 't1', seriesId: 's1' })).toBe(true)
    expect(invitationCovers(all, { id: 'x1', seriesId: 's2' })).toBe(false)
    expect(invitationCovers(all, { id: 'e1', seriesId: null })).toBe(false)
    expect(invitationCovers(some, { id: 't2', seriesId: 's1' })).toBe(true)
    expect(invitationCovers(some, { id: 't1', seriesId: 's1' })).toBe(false)
    expect(invitationCovers({ ...some, events: undefined }, { id: 't2', seriesId: 's1' })).toBe(false)
  })

  it('invitationsForTermin zählt alle und ausdrücklich ausgewählte', () => {
    expect(invitationsForTermin([all, some, some], 't2')).toBe(3)
    expect(invitationsForTermin([all, some], 't1')).toBe(1)
  })
})
