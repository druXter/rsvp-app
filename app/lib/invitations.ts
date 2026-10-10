// app/lib/invitations.ts
//
// Einladungen pro Haushalt (Idee L2 der Suite, docs/KONZEPT-EINLADUNGEN.md, Abschnitt 3): Die Verwaltung lädt
// Haushalte mit vorgegebenen Personen ein, jeder Haushalt antwortet über seinen persönlichen Link pro Person.
// Reine Funktionen ohne Datenbank, auch im Browser nutzbar; Speichern in app/lib/invitation-store.ts.
import { asAgeGroup, cleanSelection, type AgeGroup } from './persons'
import { readMenuSelection, type MenuSelection } from './menu'

export const INVITATION_LIMITS = { invitations: 500, persons: 20, extraPersons: 10, label: 100, note: 500 }

export type InvitedPersonInput = { name: string; ageGroup: AgeGroup }
export type InvitationInput = { label: string; email: string | null; persons: InvitedPersonInput[]; extraPersons: number }

const AGE_SUFFIX: Record<string, AgeGroup> = { kind: 'CHILD', kinder: 'CHILD', kleinkind: 'INFANT', baby: 'INFANT' }
const AGE_SUFFIX_TEXT: Record<AgeGroup, string> = { ADULT: '', CHILD: ' (Kind)', INFANT: ' (Kleinkind)' }
const EMAIL = /^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/

function clean(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** "Anna, Ben, Clara (Kind), Dora (Kleinkind)" oder eine Person pro Zeile -> Personen mit Altersgruppe. */
export function parsePersonList(text: string, context = 'Personen'): InvitedPersonInput[] {
  const persons: InvitedPersonInput[] = []
  for (const raw of text.split(/[,\n]/)) {
    const part = clean(raw)
    if (!part) continue
    const match = part.match(/^(.*?)\s*\(([^)]*)\)$/)
    const name = clean(match ? match[1] : part)
    const suffix = match ? match[2].trim().toLowerCase() : ''
    if (match && !(suffix in AGE_SUFFIX) && suffix !== 'erwachsen') throw new Error(`${context}: „(${match[2]})“ ist keine Altersgruppe - erlaubt sind (Kind) und (Kleinkind).`)
    if (!name) throw new Error(`${context}: Eine Person hat keinen Namen.`)
    if (name.length > 100) throw new Error(`${context}: Der Name „${name.slice(0, 30)}…“ ist zu lang.`)
    persons.push({ name, ageGroup: AGE_SUFFIX[suffix] ?? 'ADULT' })
  }
  if (persons.length > INVITATION_LIMITS.persons) throw new Error(`${context}: höchstens ${INVITATION_LIMITS.persons} Personen pro Einladung.`)
  return persons
}

export function formatPersonList(persons: readonly { name: string; ageGroup: string }[]): string {
  return persons.map(p => `${p.name}${AGE_SUFFIX_TEXT[asAgeGroup(p.ageGroup)]}`).join(', ')
}

/** "+1" bzw. "+ 2" -> Anzahl Zusatzpersonen, sonst null. */
function extraOf(field: string): number | null {
  const match = field.match(/^\+\s*(\d{1,2})$/)
  return match ? Number(match[1]) : null
}

/**
 * Einladungen aus dem Textfeld der Verwaltung, eine Zeile pro Haushalt:
 * `Familie Müller; mueller@example.org; Anna, Ben, Clara (Kind); +1`. Nach der Bezeichnung in beliebiger
 * Reihenfolge und optional: E-Mail, Personen, Zusatzpersonen. Ohne Personen ist die Bezeichnung die eine
 * eingeladene Person ("Tante Erna; +1"). Wirft mit einer Meldung fürs Formular.
 */
export function parseInvitationLines(text: string): InvitationInput[] {
  const result: InvitationInput[] = []
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!raw.trim()) continue
    const [labelPart, ...fields] = raw.split(';').map(clean)
    const label = labelPart
    if (!label) throw new Error('Einladungen: Jede Zeile braucht vorne eine Bezeichnung (z. B. „Familie Müller“).')
    if (label.length > INVITATION_LIMITS.label) throw new Error(`Einladungen: „${label.slice(0, 30)}…“ ist zu lang.`)
    let email: string | null = null
    let persons: InvitedPersonInput[] | null = null
    let extraPersons = 0
    for (const field of fields) {
      if (!field) continue
      const extra = extraOf(field)
      if (extra !== null) {
        if (extra > INVITATION_LIMITS.extraPersons) throw new Error(`Einladungen: „${label}“ - höchstens +${INVITATION_LIMITS.extraPersons} Zusatzpersonen.`)
        extraPersons = extra
      } else if (field.includes('@')) {
        if (!EMAIL.test(field) || field.length > 254) throw new Error(`Einladungen: „${field}“ bei „${label}“ ist keine gültige E-Mail-Adresse.`)
        if (email) throw new Error(`Einladungen: „${label}“ hat zwei E-Mail-Adressen.`)
        email = field.toLowerCase()
      } else {
        if (persons) throw new Error(`Einladungen: Bei „${label}“ stehen die Personen in mehreren Feldern - bitte mit Komma trennen.`)
        persons = parsePersonList(field, `Einladungen („${label}“)`)
      }
    }
    result.push({ label, email, persons: persons && persons.length > 0 ? persons : [{ name: label, ageGroup: 'ADULT' }], extraPersons })
  }
  if (result.length > INVITATION_LIMITS.invitations) throw new Error(`Einladungen: höchstens ${INVITATION_LIMITS.invitations} auf einmal.`)
  return result
}

/** Eine Person der Haushalts-Antwort, wie sie das Formular (oder die Verwaltung) schickt. */
export type HouseholdPersonInput = {
  /** Eingeladene Person (InvitationPerson.id) oder null für eine selbst eingetragene Zusatzperson */
  invitationPersonId: string | null
  name: string
  ageGroup: AgeGroup
  isAttending: boolean
  dietaryOption: string | null
  allergies: string | null
  menu: MenuSelection
}

const MAX_HOUSEHOLD_ROWS = INVITATION_LIMITS.persons + INVITATION_LIMITS.extraPersons

/**
 * Personen aus dem Formular (Felder person_<i>_id, _name, _age, _attending, _diet, _allergies, _menu_<Gang>).
 * undefined, wenn das Formular sie nicht angezeigt hat (Markierungsfeld householdShown).
 */
export function readHousehold(formData: FormData): HouseholdPersonInput[] | undefined {
  if (!formData.has('householdShown')) return undefined
  const persons: HouseholdPersonInput[] = []
  for (let i = 0; i < MAX_HOUSEHOLD_ROWS + 1; i++) {
    const get = (field: string) => {
      const value = formData.get(`person_${i}_${field}`)
      return typeof value === 'string' ? value : null
    }
    const id = get('id')
    const name = clean(get('name') ?? '').slice(0, 100)
    if (id === null && !name) continue
    persons.push({
      invitationPersonId: id || null,
      name,
      ageGroup: asAgeGroup(get('age')),
      isAttending: get('attending') === 'true',
      dietaryOption: clean(get('diet') ?? '').slice(0, 100) || null,
      allergies: clean(get('allergies') ?? '').slice(0, 300) || null,
      menu: readMenuSelection(formData, `person_${i}_menu_`) ?? {}
    })
  }
  return persons
}

/** Personen aus dem JSON der Client-API oder eines Tests - gleiche Form wie readHousehold. */
export function cleanHouseholdPerson(raw: Record<string, unknown>): HouseholdPersonInput {
  return {
    invitationPersonId: typeof raw.invitationPersonId === 'string' && raw.invitationPersonId ? raw.invitationPersonId : null,
    name: clean(typeof raw.name === 'string' ? raw.name : '').slice(0, 100),
    ageGroup: asAgeGroup(raw.ageGroup),
    isAttending: raw.isAttending === true,
    dietaryOption: typeof raw.dietaryOption === 'string' ? clean(raw.dietaryOption).slice(0, 100) || null : null,
    allergies: typeof raw.allergies === 'string' ? clean(raw.allergies).slice(0, 300) || null : null,
    menu: cleanSelection(raw.menu)
  }
}

/**
 * Prüft die Antwort eines Haushalts gegen seine Einladung und gibt die Personen in der zu speichernden
 * Reihenfolge zurück (eingeladene wie vorgegeben, dann Zusatzpersonen). Jede eingeladene Person genau einmal,
 * ihr Name darf korrigiert werden (leer = wie eingeladen), ihre Altersgruppe gibt die Einladung vor.
 * Zusatzpersonen nur mit Namen und höchstens `extraPersons`. Fehler als Text, sonst die Personen.
 */
export function resolveHousehold(
  invited: readonly { id: string; name: string; ageGroup: string; position: number }[],
  extraPersons: number,
  input: readonly HouseholdPersonInput[]
): { error: string } | { persons: HouseholdPersonInput[] } {
  const byId = new Map(input.filter(p => p.invitationPersonId).map(p => [p.invitationPersonId!, p]))
  if (byId.size !== input.filter(p => p.invitationPersonId).length) return { error: 'Eine eingeladene Person steht doppelt in der Antwort.' }
  for (const id of byId.keys()) {
    if (!invited.some(p => p.id === id)) return { error: 'Die Antwort enthält eine Person, die nicht zu dieser Einladung gehört.' }
  }
  const ordered = [...invited].sort((a, b) => a.position - b.position)
  const missing = ordered.find(p => !byId.has(p.id))
  if (missing) return { error: `Bitte gib für ${missing.name} an, ob die Person kommt.` }
  const extras = input.filter(p => !p.invitationPersonId && p.name)
  if (extras.length > extraPersons) {
    return { error: extraPersons === 0 ? 'Diese Einladung sieht keine weiteren Personen vor.' : `Ihr könnt höchstens ${extraPersons} weitere Person${extraPersons === 1 ? '' : 'en'} mitbringen.` }
  }
  return {
    persons: [
      ...ordered.map(p => {
        const answer = byId.get(p.id)!
        return { ...answer, invitationPersonId: p.id, name: answer.name || p.name, ageGroup: asAgeGroup(p.ageGroup) }
      }),
      ...extras
    ]
  }
}

/** Der Haushalt sagt zu, wenn mindestens eine Person zusagt, die nicht nur ein Kleinkind ist. */
export function householdAttends(persons: readonly { isAttending: boolean; ageGroup: string }[]): boolean {
  return persons.some(p => p.isAttending && p.ageGroup !== 'INFANT')
}

export type InvitationPersonStatus = { name: string; ageGroup: AgeGroup; status: 'yes' | 'no' | 'open'; extra: boolean }
export type InvitationStatus = {
  state: 'open' | 'attending' | 'waitlist' | 'declined'
  persons: InvitationPersonStatus[]
}

/**
 * Stand einer Einladung für die Übersicht: pro eingeladener Person kommt / kommt nicht / offen (eine Person, die
 * die Verwaltung nach der Antwort hinzugefügt hat, ist offen), dazu selbst eingetragene Zusatzpersonen.
 */
export function invitationStatus(
  invited: readonly { id: string; name: string; ageGroup: string; position: number }[],
  rsvp: { isAttending: boolean; isOnWaitlist: boolean; persons: readonly { invitationPersonId: string | null; name: string | null; ageGroup: string; isAttending: boolean; position: number }[] } | null
): InvitationStatus {
  const answers = rsvp?.persons ?? []
  const persons: InvitationPersonStatus[] = [
    ...[...invited].sort((a, b) => a.position - b.position).map(p => {
      const answer = answers.find(a => a.invitationPersonId === p.id)
      return { name: answer?.name || p.name, ageGroup: asAgeGroup(p.ageGroup), status: answer ? (answer.isAttending ? 'yes' as const : 'no' as const) : 'open' as const, extra: false }
    }),
    ...[...answers].filter(a => !a.invitationPersonId).sort((a, b) => a.position - b.position)
      .map(a => ({ name: a.name ?? 'Weitere Person', ageGroup: asAgeGroup(a.ageGroup), status: a.isAttending ? 'yes' as const : 'no' as const, extra: true }))
  ]
  const state = !rsvp ? 'open' : !rsvp.isAttending ? 'declined' : rsvp.isOnWaitlist ? 'waitlist' : 'attending'
  return { state, persons }
}
