import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { asAgeGroup, attendingNames, cleanCompanion, companionsOf, describePerson, MAX_COMPANIONS, personsOf, readCompanions, seatsOf } from '../../app/lib/persons'

const row = (position: number, name: string | null, extra: Partial<{ ageGroup: string; isAttending: boolean; dietaryOption: string | null; allergies: string | null }> = {}) => ({
  position, name, ageGroup: 'ADULT', isAttending: true, dietaryOption: null, allergies: null, ...extra
})

describe('Personen einer Antwort (docs/KONZEPT-EINLADUNGEN.md)', () => {
  const participant = { name: 'Erika', dietaryOption: 'Vegan', allergies: 'Nüsse' }

  it('personsOf: ohne gespeicherte Personen genau die anmeldende, sonst nach Position', () => {
    expect(personsOf({ isAttending: true }, participant)).toEqual([{ name: 'Erika', ageGroup: 'ADULT', isAttending: true, dietaryOption: 'Vegan', allergies: 'Nüsse' }])
    expect(personsOf({ isAttending: false, persons: [] }, participant)[0].isAttending).toBe(false)
    const persons = personsOf({ isAttending: true, persons: [row(1, 'Max', { ageGroup: 'CHILD' }), row(0, 'Erika'), row(2, 'Lia', { ageGroup: 'unbekannt' })] }, participant)
    expect(persons.map(p => [p.name, p.ageGroup])).toEqual([['Erika', 'ADULT'], ['Max', 'CHILD'], ['Lia', 'ADULT']])
  })

  it('seatsOf: zusagende Personen ohne Kleinkinder, ohne Personen ein Platz', () => {
    expect(seatsOf(undefined)).toBe(1)
    expect(seatsOf([])).toBe(1)
    expect(seatsOf([row(0, 'A'), row(1, 'B', { ageGroup: 'CHILD' }), row(2, 'C', { ageGroup: 'INFANT' })])).toBe(2)
    expect(seatsOf([row(0, 'A', { isAttending: false }), row(1, 'B', { isAttending: false })])).toBe(0)
  })

  it('companionsOf: alle außer der ersten Person', () => {
    expect(companionsOf([row(1, 'Max', { allergies: 'Ei' }), row(0, 'Erika')])).toEqual([{ name: 'Max', ageGroup: 'ADULT', dietaryOption: null, allergies: 'Ei' }])
    expect(companionsOf([row(0, 'Erika')])).toEqual([])
  })

  it('cleanCompanion: Name Pflicht, Steuerzeichen und Leerraum raus, Längen begrenzt, unbekannte Altersgruppe = erwachsen', () => {
    expect(cleanCompanion({ name: '  ' })).toBeNull()
    expect(cleanCompanion({ name: 42 })).toBeNull()
    expect(cleanCompanion({ name: ' Max\n  Muster ', ageGroup: 'CHILD', dietaryOption: '', allergies: 'x'.repeat(400) }))
      .toEqual({ name: 'Max Muster', ageGroup: 'CHILD', dietaryOption: null, allergies: 'x'.repeat(300) })
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
    expect(readCompanions(form)).toEqual([
      { name: 'Max', ageGroup: 'CHILD', dietaryOption: null, allergies: null },
      { name: 'Lia', ageGroup: 'ADULT', dietaryOption: 'Vegetarisch', allergies: null }
    ])
    const many = new FormData()
    many.set('companionsShown', '1')
    for (let i = 0; i < 100; i++) many.set(`companion_${i}_name`, `P${i}`)
    expect(readCompanions(many)).toHaveLength(MAX_COMPANIONS + 1)
  })

  it('describePerson und attendingNames für Listen', () => {
    expect(describePerson({ name: 'Max', ageGroup: 'CHILD', isAttending: true, dietaryOption: 'Vegan', allergies: 'Ei' })).toBe('Max (Kind, Vegan, Ei)')
    expect(describePerson({ name: null, ageGroup: 'ADULT', isAttending: true, dietaryOption: null, allergies: null })).toBe('Begleitung')
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
