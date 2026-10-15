// app/lib/event-presets.ts
//
// Arten beim Anlegen eines Events (docs/KONZEPT-OBERFLAECHE.md): "Neues Event" fragt nur Grunddaten und eine Art ab,
// die Art setzt passende Grundeinstellungen und bestimmt, wo es danach weitergeht. Alles lässt sich später in den
// Einstellungen ändern. Rein, ohne Datenbank.

export type FormConfig = {
  askEmail: boolean; askPhone: boolean; askDiet: boolean; askAlcohol: boolean; askBringingItem: boolean; askAllergies: boolean
}

export type EventPreset = {
  label: string
  description: string
  formConfig: FormConfig
  maxCompanions: number
  inviteOnly: boolean
  isGuestListVisible: boolean
  enableCheckin: boolean
  /** Kommen und Gehen protokollieren (Idee L7) */
  trackPresence: boolean
  /** Wunschliste (Idee N4) gleich einschalten */
  wishlist: boolean
  /** Wohin es nach dem Anlegen geht: Reiter "Einladungen" oder ein Abschnitt der Einstellungen */
  next: { tab: 'einladungen' } | { tab: 'einstellungen'; section: string }
}

const FORM: FormConfig = { askEmail: true, askPhone: false, askDiet: true, askAlcohol: false, askBringingItem: false, askAllergies: false }

export const EVENT_PRESETS = {
  offen: {
    label: 'Offene Anmeldung',
    description: 'Treffen, Workshop, Vereinsabend: Alle mit dem Link melden sich an, mit E-Mail und Essenswunsch.',
    formConfig: FORM, maxCompanions: 0, inviteOnly: false, isGuestListVisible: false, enableCheckin: false, trackPresence: false, wishlist: false,
    next: { tab: 'einstellungen', section: 'formular' }
  },
  feier: {
    label: 'Feier mit Freund*innen',
    description: 'Geburtstag, Grillen, WG-Party: bis zu 2 Begleitungen, sichtbare Gästeliste, Platz für eine Mitbringliste.',
    formConfig: { ...FORM, askEmail: false, askAlcohol: true, askAllergies: true }, maxCompanions: 2, inviteOnly: false, isGuestListVisible: true, enableCheckin: false, trackPresence: false, wishlist: false,
    next: { tab: 'einstellungen', section: 'mitbringliste' }
  },
  hochzeit: {
    label: 'Hochzeit oder Feier mit Einladungen',
    description: 'Nur eingeladene Haushalte, jeder mit persönlichem Link; Zu-/Absage, Essen und Allergien pro Person, optional Menü und Wunschliste.',
    formConfig: { ...FORM, askAllergies: true }, maxCompanions: 0, inviteOnly: true, isGuestListVisible: false, enableCheckin: false, trackPresence: false, wishlist: true,
    next: { tab: 'einladungen' }
  },
  ball: {
    label: 'Ball oder Event mit Tickets',
    description: 'Ticketkategorien mit Preis und Kontingent, Überweisung per GiroCode, Einlass mit QR-Code.',
    formConfig: { ...FORM, askAllergies: true }, maxCompanions: 0, inviteOnly: false, isGuestListVisible: false, enableCheckin: true, trackPresence: false, wishlist: false,
    next: { tab: 'einstellungen', section: 'tickets' }
  },
  sitzung: {
    label: 'Sitzung oder Versammlung',
    description: 'Mitgliederversammlung, Fachschaft, StuPa: Einlass mit QR-Code, Kommen und Gehen mit Uhrzeit fürs Protokoll.',
    formConfig: { ...FORM, askDiet: false }, maxCompanions: 0, inviteOnly: false, isGuestListVisible: false, enableCheckin: true, trackPresence: true, wishlist: false,
    next: { tab: 'einstellungen', section: 'ablauf' }
  }
} satisfies Record<string, EventPreset>

export type EventPresetKey = keyof typeof EVENT_PRESETS

export function presetOf(value: unknown): EventPresetKey {
  return typeof value === 'string' && Object.hasOwn(EVENT_PRESETS, value) ? (value as EventPresetKey) : 'offen'
}

/** "Annas 30. Geburtstag!" -> "annas-30-geburtstag" (Umlaute ausgeschrieben, höchstens 60 Zeichen). */
export function slugify(text: string): string {
  return text.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'event'
}
