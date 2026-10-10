// app/lib/persons.ts
//
// Personen einer Antwort (Idee L2/L3 der Suite, docs/KONZEPT-EINLADUNGEN.md): die anmeldende Person und ihre
// Begleitungen, jede mit Altersgruppe, Essen und Allergien. Die Antwort (Rsvp) bleibt die Einheit für Platz,
// Warteliste, Einlass und verknüpfte Tools - Plätze zählen aber Personen. Reine Funktionen ohne Datenbank,
// auch im Browser nutzbar (Formular).

export const AGE_GROUPS = ['ADULT', 'CHILD', 'INFANT'] as const
export type AgeGroup = (typeof AGE_GROUPS)[number]

export const AGE_GROUP_LABEL: Record<AgeGroup, string> = {
  ADULT: 'Erwachsen',
  CHILD: 'Kind',
  INFANT: 'Kleinkind (ohne eigenen Platz)'
}

/** Kurzform für Listen ("Anna (Kind)"), Erwachsene ohne Zusatz. */
const AGE_GROUP_SHORT: Record<AgeGroup, string | null> = { ADULT: null, CHILD: 'Kind', INFANT: 'Kleinkind' }

/** Auswahl "Essenswunsch" wie im bisherigen Formularfeld der anmeldenden Person (Wert, Anzeige). */
export const DIET_OPTIONS: readonly (readonly [string, string])[] = [
  ['Allesesser', 'Isst alles (Fleisch/Fisch)'],
  ['Vegetarisch', 'Vegetarisch'],
  ['Vegan', 'Vegan']
]

/** Höchstwert für "bis zu N Begleitungen" (Seating erlaubt bis zu 50 Personen pro Antwort). */
export const MAX_COMPANIONS = 20
const MAX_NAME = 100
const MAX_TEXT = 300

export function asAgeGroup(value: unknown): AgeGroup {
  return AGE_GROUPS.includes(value as AgeGroup) ? (value as AgeGroup) : 'ADULT'
}

/** Eine Person, wie sie angezeigt, gezählt und an Seating gemeldet wird. */
export type PersonData = {
  name: string | null
  ageGroup: AgeGroup
  isAttending: boolean
  dietaryOption: string | null
  allergies: string | null
}

/** Eine Begleitung aus dem Formular oder der Client-API (sagt immer zusammen mit der Antwort zu oder ab). */
export type CompanionInput = { name: string; ageGroup: AgeGroup; dietaryOption: string | null; allergies: string | null }

type PersonRow = { position: number; name: string | null; ageGroup: string; isAttending: boolean; dietaryOption: string | null; allergies: string | null }

/**
 * Alle Personen einer Antwort. Ohne gespeicherte Personen (Termin ohne Begleitungen, ältere Antworten) ist die
 * Antwort genau eine Person: die anmeldende, mit den Angaben aus dem Participant.
 */
export function personsOf(
  rsvp: { isAttending: boolean; persons?: readonly PersonRow[] | null },
  participant: { name: string; dietaryOption: string | null; allergies: string | null }
): PersonData[] {
  if (rsvp.persons && rsvp.persons.length > 0) {
    return [...rsvp.persons]
      .sort((a, b) => a.position - b.position)
      .map(p => ({ name: p.name, ageGroup: asAgeGroup(p.ageGroup), isAttending: p.isAttending, dietaryOption: p.dietaryOption, allergies: p.allergies }))
  }
  return [{ name: participant.name, ageGroup: 'ADULT', isAttending: rsvp.isAttending, dietaryOption: participant.dietaryOption, allergies: participant.allergies }]
}

/**
 * Wie viele Plätze die Personen brauchen: zusagende Personen ohne Kleinkinder. Ohne gespeicherte Personen ist
 * es ein Platz (die Antwort selbst) - so zählen Antworten von vor den Begleitungen wie bisher.
 */
export function seatsOf(persons: readonly { isAttending: boolean; ageGroup: string }[] | null | undefined): number {
  if (!persons || persons.length === 0) return 1
  return persons.filter(p => p.isAttending && p.ageGroup !== 'INFANT').length
}

/** Die Begleitungen einer Antwort (alle Personen außer der anmeldenden) als Eingabe, z. B. zum Übernehmen. */
export function companionsOf(persons: readonly PersonRow[]): CompanionInput[] {
  return [...persons]
    .sort((a, b) => a.position - b.position)
    .slice(1)
    .map(p => ({ name: p.name ?? '', ageGroup: asAgeGroup(p.ageGroup), dietaryOption: p.dietaryOption, allergies: p.allergies }))
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned ? cleaned.slice(0, max) : null
}

/** Eine Begleitung aus beliebigen Daten (Formular, JSON der Client-API). null ohne Namen. */
export function cleanCompanion(raw: { name?: unknown; ageGroup?: unknown; dietaryOption?: unknown; allergies?: unknown }): CompanionInput | null {
  const name = text(raw.name, MAX_NAME)
  if (!name) return null
  return { name, ageGroup: asAgeGroup(raw.ageGroup), dietaryOption: text(raw.dietaryOption, MAX_NAME), allergies: text(raw.allergies, MAX_TEXT) }
}

/**
 * Begleitungen aus dem Formular (Felder companion_<i>_name, _age, _diet, _allergies). undefined, wenn das
 * Formular sie nicht angezeigt hat (Markierungsfeld companionsShown) - dann bleiben bestehende unverändert.
 * Zeilen ohne Namen zählen nicht. Mehr als MAX_COMPANIONS werden gar nicht erst gelesen.
 */
export function readCompanions(formData: FormData): CompanionInput[] | undefined {
  if (!formData.has('companionsShown')) return undefined
  const companions: CompanionInput[] = []
  for (let i = 0; i < MAX_COMPANIONS + 1; i++) {
    const companion = cleanCompanion({
      name: formData.get(`companion_${i}_name`),
      ageGroup: formData.get(`companion_${i}_age`),
      dietaryOption: formData.get(`companion_${i}_diet`),
      allergies: formData.get(`companion_${i}_allergies`)
    })
    if (companion) companions.push(companion)
  }
  return companions
}

/** "Anna (Kind, Vegetarisch, Nüsse)" - für Verwaltung, Einlass und Mails. */
export function describePerson(person: PersonData, fallbackName = 'Begleitung'): string {
  const details = [AGE_GROUP_SHORT[person.ageGroup], person.dietaryOption, person.allergies].filter(Boolean)
  return `${person.name || fallbackName}${details.length > 0 ? ` (${details.join(', ')})` : ''}`
}

/** Zusagende Personen als Namensliste ("Anna, Ben (Kind)"). */
export function attendingNames(persons: readonly PersonData[]): string {
  return persons.filter(p => p.isAttending).map(p => `${p.name || 'Begleitung'}${AGE_GROUP_SHORT[p.ageGroup] ? ` (${AGE_GROUP_SHORT[p.ageGroup]})` : ''}`).join(', ')
}
