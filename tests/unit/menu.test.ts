import { describe, expect, it } from 'vitest'
import { courseOptions, describeSelection, formatMenu, isCompleteSelection, parseMenu, readMenuSelection, validSelection } from '../../app/lib/menu'
import { buildKitchenReport } from '../../app/lib/kitchen'

describe('Menü (docs/KONZEPT-EINLADUNGEN.md)', () => {
  it('parseMenu: eine Zeile pro Gang, Optionen mit Semikolon, leere Zeilen zählen nicht', () => {
    expect(parseMenu('Vorspeise: Suppe; Salat\r\n\n Hauptgang :Fisch;Fleisch ; Vegetarisch;\n')).toEqual([
      { label: 'Vorspeise', options: ['Suppe', 'Salat'] },
      { label: 'Hauptgang', options: ['Fisch', 'Fleisch', 'Vegetarisch'] }
    ])
    expect(parseMenu('')).toEqual([])
  })

  it('parseMenu: Fehler mit Meldung fürs Formular', () => {
    expect(() => parseMenu('Hauptgang Fisch')).toThrow('Doppelpunkt')
    expect(() => parseMenu(': Fisch')).toThrow('Namen des Gangs')
    expect(() => parseMenu('Hauptgang:')).toThrow('mindestens eine Option')
    expect(() => parseMenu('Hauptgang: Fisch; Fisch')).toThrow('doppelt')
    expect(() => parseMenu('A: x\nA: y')).toThrow('doppelt')
    expect(() => parseMenu(`${'G'.repeat(61)}: x`)).toThrow('zu lang')
    expect(() => parseMenu(`G: ${'o'.repeat(61)}`)).toThrow('zu lang')
    expect(() => parseMenu(`G: ${Array.from({ length: 13 }, (_, i) => `o${i}`).join(';')}`)).toThrow('zu viele Optionen')
    expect(() => parseMenu(Array.from({ length: 9 }, (_, i) => `G${i}: x`).join('\n'))).toThrow('höchstens 8')
  })

  it('formatMenu ist das Gegenstück, courseOptions liest das gespeicherte JSON', () => {
    const text = 'Vorspeise: Suppe; Salat\nHauptgang: Fisch'
    expect(formatMenu(parseMenu(text))).toBe(text)
    expect(courseOptions('["Fisch","Fleisch"]')).toEqual(['Fisch', 'Fleisch'])
    expect(courseOptions('kaputt')).toEqual([])
    expect(courseOptions('{"a":1}')).toEqual([])
  })

  const courses = [{ id: 'c1', label: 'Hauptgang', options: ['Fisch', 'Fleisch'] }, { id: 'c2', label: 'Dessert', options: ['Eis'] }]

  it('validSelection/isCompleteSelection: nur Gänge und Optionen des Termins', () => {
    expect(validSelection(courses, { c1: 'Fisch', c2: 'Torte', c9: 'Eis' })).toEqual({ c1: 'Fisch' })
    expect(isCompleteSelection(courses, { c1: 'Fisch' })).toBe(false)
    expect(isCompleteSelection(courses, { c1: 'Fisch', c2: 'Eis' })).toBe(true)
    expect(isCompleteSelection([], undefined)).toBe(true)
    expect(describeSelection(courses, { c1: 'Fisch', c2: 'Eis' })).toBe('Hauptgang: Fisch, Dessert: Eis')
  })

  it('readMenuSelection: nur mit Markierungsfeld, nur Felder mit dem Präfix', () => {
    const form = new FormData()
    form.set('menu_c1', 'Fisch')
    expect(readMenuSelection(form, 'menu_')).toBeUndefined()
    form.set('menuShown', '1')
    form.set('menu_c2', '')
    form.set('companion_0_menu_c1', 'Fleisch')
    form.set('menu_../x', 'Eis')
    expect(readMenuSelection(form, 'menu_')).toEqual({ c1: 'Fisch' })
    expect(readMenuSelection(form, 'companion_0_menu_')).toEqual({ c1: 'Fleisch' })
  })
})

describe('Küchenübersicht', () => {
  const courses = [{ id: 'c1', label: 'Hauptgang', options: ['Fisch', 'Fleisch'] }]
  const person = (position: number, name: string, ageGroup: string, option: string | null, extra: object = {}) => ({
    position, name, ageGroup, isAttending: true, dietaryOption: null, allergies: null, menuChoices: option ? [{ courseId: 'c1', option }] : [], ...extra
  })
  const rsvp = (name: string, seat: string | null, persons: ReturnType<typeof person>[], extra: object = {}) => ({
    isAttending: true, isOnWaitlist: false, seatingLabel: seat, participant: { name, dietaryOption: 'Vegan', allergies: null }, persons, ...extra
  })

  it('zählt pro Option nach Erwachsenen und Kindern, nur feste Plätze und zusagende Personen, Kleinkinder ohne Menü', () => {
    const report = buildKitchenReport(courses, [
      rsvp('Familie A', 'Tisch 10', [person(0, 'Anna', 'ADULT', 'Fisch', { allergies: 'Nüsse', drinksAlcohol: false }), person(1, 'Ben', 'CHILD', 'Fleisch', { drinksAlcohol: true }), person(2, 'Mia', 'INFANT', null), person(3, 'Opa', 'ADULT', 'Fisch', { isAttending: false })]),
      rsvp('Carl', 'Tisch 2', [person(0, 'Carl', 'ADULT', null, { drinksAlcohol: true })]),
      rsvp('Warte', null, [person(0, 'Warte', 'ADULT', 'Fisch')], { isOnWaitlist: true }),
      rsvp('Absage', null, [person(0, 'Absage', 'ADULT', 'Fisch')], { isAttending: false }),
      // Ohne Personenliste: eine Person mit den Angaben des Participants
      rsvp('Dora', null, [])
    ])
    expect(report.courses[0].counts).toEqual([{ option: 'Fisch', adults: 1, children: 0 }, { option: 'Fleisch', adults: 0, children: 1 }])
    expect(report.courses[0].missing).toBe(2)
    expect(report.totals).toEqual({ ADULT: 3, CHILD: 1, INFANT: 1 })
    // Nach Platz (natürlich sortiert, ohne Platz zuletzt), innerhalb einer Antwort in Reihenfolge
    expect(report.persons.map(p => p.name)).toEqual(['Carl', 'Anna', 'Ben', 'Mia', 'Dora'])
    expect(report.diets).toEqual([{ label: 'ohne Angabe', count: 3 }, { label: 'Vegan', count: 1 }])
    // Getränke: nur Erwachsene (Ben ist ein Kind), Dora ohne Angabe
    expect(report.drinks).toEqual({ alcohol: 1, alcoholFree: 1 })
    // Ohne Tisch pro Person aus Seating keine Liste pro Tisch
    expect(report.tables).toEqual([])
  })

  it('Küchenliste pro Tisch: Tische natürlich sortiert, Wahl pro Tisch, Personen ohne Tisch zuletzt', () => {
    const places = (...tables: string[]) => JSON.stringify(tables.map((table, index) => ({ index, table, seat: null })))
    const report = buildKitchenReport(courses, [
      rsvp('Familie A', 'Tisch 10', [person(0, 'Anna', 'ADULT', 'Fisch', { allergies: 'Nüsse' }), person(1, 'Ben', 'CHILD', 'Fleisch'), person(2, 'Mia', 'INFANT', null)], { seatingPersons: places('Tisch 10', 'Kindertisch') }),
      rsvp('Carl', 'Tisch 2', [person(0, 'Carl', 'ADULT', 'Fisch')], { seatingPersons: places('Tisch 2') }),
      rsvp('Dora', null, [person(0, 'Dora', 'ADULT', null)])
    ])
    expect(report.tables.map(t => [t.table, t.persons.map(p => p.name)])).toEqual([
      ['Kindertisch', ['Ben']], ['Tisch 2', ['Carl']], ['Tisch 10', ['Anna', 'Mia']], [null, ['Dora']]
    ])
    const tisch10 = report.tables[2]
    expect(tisch10.totals).toEqual({ ADULT: 1, CHILD: 0, INFANT: 1 })
    expect(tisch10.courses[0]).toMatchObject({ label: 'Hauptgang', counts: [{ option: 'Fisch', count: 1 }], missing: 0 })
    expect(report.tables[3].courses[0]).toMatchObject({ counts: [], missing: 1 })
    expect(report.persons.map(p => [p.name, p.table])).toEqual([['Ben', 'Kindertisch'], ['Carl', 'Tisch 2'], ['Anna', 'Tisch 10'], ['Mia', 'Tisch 10'], ['Dora', null]])
  })
})
