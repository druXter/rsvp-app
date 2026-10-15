import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { alcoholFor, alcoholLabel, asAgeGroup, attendingNames, cleanCompanion, companionsOf, describePerson, MAX_COMPANIONS, personsOf, readCompanions, readYesNo, seatsOf } from '../../app/lib/persons'

const row = (position: number, name: string | null, extra: Partial<{ ageGroup: string; isAttending: boolean; dietaryOption: string | null; allergies: string | null; drinksAlcohol: boolean | null; checkedInAt: Date | null }> = {}) => ({
  position, name, ageGroup: 'ADULT', isAttending: true, dietaryOption: null, allergies: null, ...extra
})

describe('Personen einer Antwort (docs/KONZEPT-EINLADUNGEN.md)', () => {
  const participant = { name: 'Erika', dietaryOption: 'Vegan', allergies: 'Nüsse' }

  it('personsOf: ohne gespeicherte Personen genau die anmeldende, sonst nach Position', () => {
    expect(personsOf({ isAttending: true }, participant)).toEqual([{ name: 'Erika', ageGroup: 'ADULT', isAttending: true, dietaryOption: 'Vegan', allergies: 'Nüsse', menu: {}, drinksAlcohol: null, checkedIn: false, left: false }])
    // Ohne Personenliste: Alkohol und Einlass der Antwort
    expect(personsOf({ isAttending: true, drinksAlcohol: false, hasAttended: true }, participant)[0]).toMatchObject({ drinksAlcohol: false, checkedIn: true })
    expect(personsOf({ isAttending: false, persons: [] }, participant)[0].isAttending).toBe(false)
    const persons = personsOf({ isAttending: true, persons: [row(1, 'Max', { ageGroup: 'CHILD' }), row(0, 'Erika'), row(2, 'Lia', { ageGroup: 'unbekannt' })] }, participant)
    expect(persons.map(p => [p.name, p.ageGroup])).toEqual([['Erika', 'ADULT'], ['Max', 'CHILD'], ['Lia', 'ADULT']])
  })

  it('Alkohol und Einlass pro Person: Alkohol nur bei Erwachsenen', () => {
    const persons = personsOf({ isAttending: true, drinksAlcohol: true, hasAttended: true, persons: [
      row(0, 'Erika', { drinksAlcohol: false, checkedInAt: new Date() }), row(1, 'Max', { ageGroup: 'CHILD', drinksAlcohol: true }), row(2, 'Lia')
    ] }, participant)
    expect(persons.map(p => [p.name, p.drinksAlcohol, p.checkedIn])).toEqual([['Erika', false, true], ['Max', null, false], ['Lia', null, false]])
    expect(alcoholFor('ADULT', true)).toBe(true)
    expect(alcoholFor('INFANT', false)).toBeNull()
    expect(alcoholFor('ADULT', undefined)).toBeNull()
    expect([readYesNo('true'), readYesNo(false), readYesNo('ja'), readYesNo(1)]).toEqual([true, false, null, null])
    expect([alcoholLabel(true), alcoholLabel(false), alcoholLabel(null)]).toEqual(['Alkohol', 'alkoholfrei', null])
    // Kinder bekommen keinen Alkohol, auch wenn der Client einen schickt
    expect(cleanCompanion({ name: 'Ben', ageGroup: 'CHILD', drinksAlcohol: true })?.drinksAlcohol).toBeNull()
    expect(cleanCompanion({ name: 'Ben', drinksAlcohol: 'false' })?.drinksAlcohol).toBe(false)
  })

  it('seatsOf: zusagende Personen ohne Kleinkinder, ohne Personen ein Platz', () => {
    expect(seatsOf(undefined)).toBe(1)
    expect(seatsOf([])).toBe(1)
    expect(seatsOf([row(0, 'A'), row(1, 'B', { ageGroup: 'CHILD' }), row(2, 'C', { ageGroup: 'INFANT' })])).toBe(2)
    expect(seatsOf([row(0, 'A', { isAttending: false }), row(1, 'B', { isAttending: false })])).toBe(0)
  })

  it('companionsOf: alle außer der ersten Person', () => {
    expect(companionsOf([{ ...row(1, 'Max', { allergies: 'Ei' }), menuChoices: [{ courseId: 'c1', option: 'Fisch' }] }, row(0, 'Erika')]))
      .toEqual([{ name: 'Max', ageGroup: 'ADULT', dietaryOption: null, allergies: 'Ei', menu: { c1: 'Fisch' }, drinksAlcohol: null }])
    expect(companionsOf([row(0, 'Erika')])).toEqual([])
  })

  it('cleanCompanion: Name Pflicht, Steuerzeichen und Leerraum raus, Längen begrenzt, unbekannte Altersgruppe = erwachsen', () => {
    expect(cleanCompanion({ name: '  ' })).toBeNull()
    expect(cleanCompanion({ name: 42 })).toBeNull()
    expect(cleanCompanion({ name: ' Max\n  Muster ', ageGroup: 'CHILD', dietaryOption: '', allergies: 'x'.repeat(400) }))
      .toEqual({ name: 'Max Muster', ageGroup: 'CHILD', dietaryOption: null, allergies: 'x'.repeat(300), menu: {}, drinksAlcohol: null })
    // Menü aus JSON: nur Text unter plausiblen Gang-IDs
    expect(cleanCompanion({ name: 'Lia', menu: { c1: 'Fisch', 'x y': 'Eis', c2: 3, c3: '' } })?.menu).toEqual({ c1: 'Fisch' })
    expect(cleanCompanion({ name: 'Lia', menu: ['Fisch'] })?.menu).toEqual({})
    expect(cleanCompanion({ name: 'y'.repeat(200), ageGroup: 'ADMIN' })).toMatchObject({ name: 'y'.repeat(100), ageGroup: 'ADULT' })
    expect(asAgeGroup('INFANT')).toBe('INFANT')
  })

  it('readCompanions: nur mit Markierungsfeld, Zeilen ohne Namen zählen nicht, höchstens MAX_COMPANIONS + 1 gelesen', () => {
    const form = new FormData()
    form.set('companion_0_name', 'Max')
    expect(readCompanions(form)).toBeUndefined()
    form.set('companionsShown', '1')
    form.set('companion_0_age', 'CHILD')
    form.set('companion_1_name', '')
    form.set('companion_2_name', 'Lia')
    form.set('companion_2_diet', 'Vegetarisch')
    form.set('companion_2_menu_c1', 'Fisch')
    form.set('companion_2_alcohol', 'false')
    form.set('companion_0_alcohol', 'true')
    expect(readCompanions(form)).toEqual([
      { name: 'Max', ageGroup: 'CHILD', dietaryOption: null, allergies: null, menu: {}, drinksAlcohol: null },
      { name: 'Lia', ageGroup: 'ADULT', dietaryOption: 'Vegetarisch', allergies: null, menu: {}, drinksAlcohol: false }
    ])
    // Menüfelder zählen nur mit Markierungsfeld menuShown
    form.set('menuShown', '1')
    expect(readCompanions(form)?.[1].menu).toEqual({ c1: 'Fisch' })
    const many = new FormData()
    many.set('companionsShown', '1')
    for (let i = 0; i < 100; i++) many.set(`companion_${i}_name`, `P${i}`)
    expect(readCompanions(many)).toHaveLength(MAX_COMPANIONS + 1)
  })

  it('describePerson und attendingNames für Listen', () => {
    const base = { isAttending: true, menu: {}, drinksAlcohol: null, checkedIn: false, left: false }
    expect(describePerson({ ...base, name: 'Max', ageGroup: 'CHILD', dietaryOption: 'Vegan', allergies: 'Ei' })).toBe('Max (Kind, Vegan, Ei)')
    expect(describePerson({ ...base, name: null, ageGroup: 'ADULT', dietaryOption: null, allergies: null })).toBe('Begleitung')
    const persons = personsOf({ isAttending: true, persons: [row(0, 'Erika'), row(1, 'Max', { ageGroup: 'INFANT' }), row(2, 'Lia', { isAttending: false })] }, participant)
    expect(attendingNames(persons)).toBe('Erika, Max (Kleinkind)')
  })
})

describe('migrate-persons.js', () => {
  const { convertFormConfig } = createRequire(import.meta.url)('../../migrate-persons.js')

  it('nimmt askPlusOne aus formConfig und meldet, ob es an war', () => {
    expect(convertFormConfig('{"askDiet":true,"askPlusOne":true}')).toEqual({ formConfig: '{"askDiet":true}', askPlusOne: true })
    expect(convertFormConfig('{"askPlusOne":false}')).toEqual({ formConfig: '{}', askPlusOne: false })
    expect(convertFormConfig('{"askDiet":true}')).toEqual({ formConfig: '{"askDiet":true}', askPlusOne: false })
    expect(convertFormConfig(null)).toEqual({ formConfig: null, askPlusOne: false })
    expect(convertFormConfig('kaputt')).toEqual({ formConfig: 'kaputt', askPlusOne: false })
  })
})

describe('migrate-person-details.js', () => {
  const { personUpdates } = createRequire(import.meta.url)('../../migrate-person-details.js')
  const person = (id: string, position: number, extra: object = {}) => ({ id, position, ageGroup: 'ADULT', isAttending: true, drinksAlcohol: null, checkedInAt: null, invitationPersonId: null, ...extra })

  it('Alkohol an die anmeldende Person, bei Haushalten an alle zusagenden Erwachsenen; Einlass an alle zusagenden', () => {
    expect(personUpdates({ drinksAlcohol: true, hasAttended: true, persons: [person('b', 1), person('a', 0), person('c', 2, { isAttending: false })] }))
      .toEqual({ alcohol: ['a'], checkIn: ['a', 'b'] })
    expect(personUpdates({ drinksAlcohol: false, hasAttended: false, persons: [
      person('a', 0, { invitationPersonId: 'i1' }), person('b', 1, { invitationPersonId: 'i2', ageGroup: 'CHILD' }), person('c', 2, { isAttending: false }), person('d', 3, { drinksAlcohol: true })
    ] })).toEqual({ alcohol: ['a'], checkIn: [] })
    expect(personUpdates({ drinksAlcohol: null, hasAttended: false, persons: [person('a', 0)] })).toEqual({ alcohol: [], checkIn: [] })
  })
})
