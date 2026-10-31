// app/lib/mail-templates.ts
//
// Inhalt aller Mails dieses Tools, gebaut aus den Bausteinen von suite-kit (renderMail, gleiche Vorlage in allen
// Tools der Suite). Rein, ohne Datenbank und Versand: app/lib/mail.ts lädt die Daten und verschickt, die Vorschau
// (scripts/mail-preview.ts) und die Unit-Tests rufen dieselben Funktionen mit Beispieldaten auf. Kein eigenes HTML -
// die Bausteine escapen jeden Text selbst.
import type { Mail, MailBlock, MailText } from 'suite-kit/web'

export type MailContent = { subject: string; mail: Mail }

const BRAND = { letter: 'R', name: 'RSVP' }
const CLOSING: MailBlock = { kind: 'p', text: 'Viele Grüße\nDein Event-Team' }

function mail(subject: string, heading: string, blocks: (MailBlock | null | false | '' | undefined)[], options: { preheader?: string; footer?: string } = {}): MailContent {
  return { subject, mail: { brand: BRAND, heading, blocks: blocks.filter((b): b is MailBlock => !!b), ...options } }
}

const hello = (name: string): MailBlock => ({ kind: 'p', text: `Hallo ${name},` })

/** Termin und Ort als Tabelle - in jeder Mail zu einem Termin gleich. */
function eventRows(event: { when: string; location: string | null }, extra: [string, string][] = []): MailBlock {
  return { kind: 'rows', rows: [['Wann', event.when], ['Wo', event.location || 'wird noch bekannt gegeben'], ...extra] }
}

export type SeriesHint = { title: string; link: string } | null

/** Hinweis auf die weiteren Termine einer Reihe (Bestätigung, Warteliste, Änderung). */
function seriesBlock(series: SeriesHint): MailBlock | null {
  return series && {
    kind: 'small',
    text: ['Dieser Termin gehört zur Reihe ', { strong: series.title }, '. Weitere Termine und deine bisherigen Antworten: ', { link: 'Zur Reihe', href: series.link }]
  }
}

/** Zahlungsdaten samt GiroCode (Bestätigung und Zahlungserinnerung, Daten aus app/lib/payment.ts). */
export function paymentBox(rows: [string, string][], giroCode: boolean): MailBlock {
  return {
    kind: 'box',
    tone: 'pink',
    title: 'Bitte überweise den Ticketpreis',
    blocks: [
      { kind: 'rows', rows: rows.map(([label, value]) => ({ label, value, strong: label === 'Betrag' || label === 'Verwendungszweck', mono: label === 'IBAN' || label === 'Verwendungszweck' })) },
      { kind: 'small', text: 'Bitte gib den Verwendungszweck genau so an, damit wir deine Zahlung zuordnen können.' },
      ...(giroCode ? [{ kind: 'image' as const, src: 'cid:girocode', alt: 'GiroCode für die Überweisung', width: 180, height: 180, caption: 'GiroCode: in der Banking-App scannen' }] : [])
    ]
  }
}

export type ConfirmationInput = {
  name: string
  attending: boolean
  event: { title: string; when: string; location: string | null }
  /** Wer mit angemeldet ist (bei Einladungen alle Personen des Haushalts). */
  companions: { label: string; names: string[] }
  menuLines: string[]
  payment: MailBlock | null
  seatAfterPayment: boolean
  seatLink: string | null
  timelineLink: string | null
  checkinQr: boolean
  ics: boolean
  personalLink: string
  series: SeriesHint
}

export function confirmationMail(input: ConfirmationInput): MailContent {
  const { attending, event } = input
  const intro: MailText = attending
    ? ['vielen Dank für deine Zusage zu ', { strong: event.title }, '. Wir freuen uns, dass du dabei bist!']
    : ['vielen Dank für deine Rückmeldung zu ', { strong: event.title }, '. Schade, dass du nicht dabei sein kannst - falls sich deine Pläne ändern, kannst du deine Antwort jederzeit anpassen.']
  const attachments = [input.ics && 'eine Kalenderdatei (.ics)', input.checkinQr && 'deinen Einlass-QR-Code'].filter(Boolean)
  return mail(
    attending ? `Zusage bestätigt: ${event.title}` : `Absage bestätigt: ${event.title}`,
    attending ? `Zusage bestätigt, ${input.name}!` : `Absage bestätigt, ${input.name}`,
    [
      hello(input.name),
      { kind: 'p', text: intro },
      attending && eventRows(event, input.companions.names.length > 0 ? [[input.companions.label, input.companions.names.join('\n')]] : []),
      input.menuLines.length > 0 && { kind: 'box', title: 'Menü', blocks: [{ kind: 'list', items: input.menuLines }] },
      input.payment,
      input.checkinQr && { kind: 'image', src: 'cid:checkinqr', alt: 'Einlass-QR-Code', width: 200, height: 200, caption: 'Dein persönlicher Einlass-QR-Code - bitte am Einlass bereithalten.' },
      input.seatAfterPayment && { kind: 'p', text: 'Deinen Sitzplatz kannst du wählen, sobald deine Zahlung eingegangen ist - dann bekommst du eine Mail mit dem Link.' },
      { kind: 'button', label: 'Antwort bearbeiten', href: input.personalLink },
      input.seatLink && { kind: 'button', label: 'Sitzplatz wählen', href: input.seatLink, secondary: true },
      input.timelineLink && { kind: 'button', label: 'Zeitplan ansehen', href: input.timelineLink, secondary: true },
      attachments.length > 0 && { kind: 'small', text: `Im Anhang findest du ${attachments.join(' und ')}.` },
      seriesBlock(input.series),
      CLOSING
    ],
    {
      preheader: attending ? `Du bist dabei: ${event.title}, ${event.when}` : `Deine Absage für ${event.title} ist angekommen.`,
      footer: `Du bekommst diese Mail, weil du auf die Einladung zu „${event.title}“ geantwortet hast. Über den Knopf „Antwort bearbeiten“ kannst du deine Angaben jederzeit ändern oder löschen.`
    }
  )
}

export function reminderMail(input: { name: string; event: { title: string; when: string; location: string | null }; message: string; personalLink: string }): MailContent {
  return mail(
    `Erinnerung: ${input.event.title} steht bald an!`,
    `Bald ist es so weit, ${input.name}!`,
    [
      hello(input.name),
      { kind: 'p', text: ['wir freuen uns, dass du bei ', { strong: input.event.title }, ' dabei bist. Hier noch einmal das Wichtigste:'] },
      eventRows(input.event),
      input.message && { kind: 'box', tone: 'blue', title: 'Nachricht der Veranstaltung', blocks: [{ kind: 'p', text: input.message }] },
      { kind: 'p', text: 'Falls sich an deiner Zusage etwas ändert, kannst du sie jederzeit anpassen.' },
      { kind: 'button', label: 'Antwort bearbeiten', href: input.personalLink },
      { kind: 'p', text: 'Bis bald!' }
    ],
    { preheader: `${input.event.title}: ${input.event.when}`, footer: `Du bekommst diese Mail, weil du zu „${input.event.title}“ zugesagt hast.` }
  )
}

/** Nachricht an Gäste (Idee L29, app/lib/guest-message.ts): freier Text der Verwaltung, Absatz für Absatz. */
export function guestMessageMail(input: { name: string; event: { title: string; when: string; location: string | null }; subject: string; paragraphs: string[]; personalLink: string }): MailContent {
  return mail(
    `${input.event.title}: ${input.subject}`,
    input.subject,
    [
      hello(input.name),
      ...input.paragraphs.map((text): MailBlock => ({ kind: 'p', text })),
      eventRows(input.event),
      { kind: 'button', label: 'Zu deiner Anmeldung', href: input.personalLink },
      CLOSING
    ],
    { preheader: input.paragraphs[0]?.slice(0, 120), footer: `Du bekommst diese Mail, weil du dich zu „${input.event.title}“ angemeldet hast.` }
  )
}

export function verificationMail(input: { name: string; eventTitle: string; link: string }): MailContent {
  return mail(
    `Bitte bestätige deine Anmeldung für ${input.eventTitle}`,
    'Bitte bestätige deine Anmeldung',
    [
      hello(input.name),
      { kind: 'p', text: ['du hast dich für ', { strong: input.eventTitle }, ' angemeldet. Bitte bestätige deine E-Mail-Adresse - erst danach ist deine Anmeldung verbindlich und du bekommst alle weiteren Informationen samt Kalendereintrag.'] },
      { kind: 'button', label: 'E-Mail-Adresse bestätigen', href: input.link }
    ],
    { footer: 'Falls du dich nicht angemeldet hast, kannst du diese Mail ignorieren - ohne Bestätigung wird die Anmeldung nicht gültig.' }
  )
}

export function guestVerificationMail(input: { name: string; contextTitle: string | null; link: string }): MailContent {
  return mail(
    input.contextTitle ? `Bitte bestätige dein Konto für ${input.contextTitle}` : 'Bitte bestätige dein Konto',
    'Bitte bestätige dein Konto',
    [
      hello(input.name),
      input.contextTitle
        ? { kind: 'p', text: ['du hast dir ein Konto für ', { strong: input.contextTitle }, ' angelegt. Nach der Bestätigung kannst du dich anmelden und siehst alle Termine deiner Reihen, ohne dir Links merken oder Angaben erneut eintragen zu müssen.'] }
        : { kind: 'p', text: 'du hast dir ein Teilnehmendenkonto angelegt. Nach der Bestätigung kannst du dich anmelden und siehst unter „Mein Konto“ deine Termine, ohne dir Links merken oder Angaben erneut eintragen zu müssen.' },
      { kind: 'button', label: 'Konto bestätigen', href: input.link }
    ],
    { footer: 'Falls du kein Konto angelegt hast, kannst du diese Mail ignorieren.' }
  )
}

/**
 * Einladung eines Teilnehmendenkontos zu einem Termin (GuestUserEvent, app/lib/guest-invites.ts): Der Termin steht
 * jetzt unter "Mein Konto"; der Knopf führt zum Termin, geantwortet wird mit dem Konto.
 */
export function accountInviteMail(input: { name: string; eventTitle: string; when: string; location: string | null; link: string }): MailContent {
  return mail(
    `Einladung: ${input.eventTitle}`,
    `Einladung: ${input.eventTitle}`,
    [
      hello(input.name),
      { kind: 'p', text: ['du bist zu ', { strong: input.eventTitle }, ` eingeladen (${input.when}${input.location ? `, ${input.location}` : ''}). Der Termin steht ab jetzt auch unter „Mein Konto“, dort kannst du mit deinem Konto zu- oder absagen.`] },
      { kind: 'button', label: 'Zum Termin', href: input.link }
    ],
    { footer: 'Du bekommst diese Mail, weil dich die Veranstaltung mit deinem Teilnehmendenkonto eingeladen hat. Unter „Mein Konto“ kannst du den Termin ausblenden.' }
  )
}

/** Passwort-Reset für ein Teilnehmenden- oder Verwaltungskonto (`name` fehlt bei Verwaltungskonten). */
export function passwordResetMail(input: { name: string | null; email: string; link: string }): MailContent {
  return mail(
    'Passwort zurücksetzen',
    'Passwort zurücksetzen',
    [
      { kind: 'p', text: input.name ? `Hallo ${input.name},` : 'Hallo,' },
      { kind: 'p', text: ['für dein Konto ', { strong: input.email }, ' wurde ein neues Passwort angefordert. Falls du das warst, vergib über den Knopf ein neues. Der Link ist eine Stunde gültig.'] },
      { kind: 'button', label: 'Neues Passwort vergeben', href: input.link }
    ],
    { footer: 'Falls du das nicht warst, kannst du diese Mail ignorieren - dein Passwort bleibt unverändert.' }
  )
}

/** Bestätigung einer neuen Adresse (geht an die NEUE Adresse). */
export function emailChangeMail(input: { name: string | null; currentEmail: string; link: string }): MailContent {
  return mail(
    'Neue E-Mail-Adresse bestätigen',
    'Neue E-Mail-Adresse bestätigen',
    [
      { kind: 'p', text: input.name ? `Hallo ${input.name},` : 'Hallo,' },
      { kind: 'p', text: ['für dein Konto (bisher ', { strong: input.currentEmail }, ') soll künftig diese Adresse gelten. Falls du das warst, bestätige die Änderung über den Knopf. Der Link ist eine Stunde gültig.'] },
      { kind: 'button', label: 'E-Mail-Adresse bestätigen', href: input.link }
    ],
    { footer: 'Falls du das nicht warst, kannst du diese Mail ignorieren - die Adresse des Kontos bleibt unverändert.' }
  )
}

export function waitlistMail(input: { name: string; eventTitle: string; personalLink: string; series: SeriesHint }): MailContent {
  return mail(
    `Du stehst auf der Warteliste für ${input.eventTitle}`,
    'Du stehst auf der Warteliste',
    [
      hello(input.name),
      { kind: 'p', text: [{ strong: input.eventTitle }, ' ist im Moment ausgebucht, deine Anmeldung ist aber notiert. Sobald ein Platz frei wird, rückst du automatisch nach und bekommst eine Mail.'] },
      { kind: 'button', label: 'Zur Event-Seite', href: input.personalLink },
      { kind: 'small', text: 'Über die Event-Seite kannst du dich auch wieder von der Warteliste nehmen.' },
      seriesBlock(input.series),
      CLOSING
    ]
  )
}

export function waitlistPromotedMail(input: { name: string; eventTitle: string; personalLink: string }): MailContent {
  return mail(
    `Du bist nachgerückt: ${input.eventTitle}`,
    `Du bist dabei, ${input.name}!`,
    [
      hello(input.name),
      { kind: 'p', text: ['es ist ein Platz frei geworden: Du bist von der Warteliste für ', { strong: input.eventTitle }, ' nachgerückt. Deine Teilnahme ist damit fest gebucht.'] },
      { kind: 'button', label: 'Zur Event-Seite', href: input.personalLink },
      CLOSING
    ]
  )
}

export function eventUpdatedMail(input: { name: string; eventTitle: string; changes: { label: string; detail: string }[]; ics: boolean; personalLink: string; series: SeriesHint; maybe?: boolean }): MailContent {
  return mail(
    `Wichtige Änderung: ${input.eventTitle}`,
    `Änderung: ${input.eventTitle}`,
    [
      hello(input.name),
      { kind: 'p', text: input.maybe ? 'für den Termin, bei dem du „vielleicht“ angegeben hast, hat sich etwas geändert:' : 'für den Termin, zu dem du zugesagt hast, hat sich etwas geändert:' },
      { kind: 'box', tone: 'amber', blocks: [{ kind: 'rows', rows: input.changes.map(c => [c.label, c.detail] as [string, string]) }] },
      { kind: 'p', text: 'Bitte beachte das bei deiner Planung.' },
      { kind: 'button', label: 'Antwort bearbeiten', href: input.personalLink },
      input.ics && { kind: 'small', text: 'Im Anhang findest du die aktualisierte Kalenderdatei (.ics) - beim Öffnen wird dein bestehender Kalendereintrag aktualisiert statt doppelt angelegt.' },
      seriesBlock(input.series),
      CLOSING
    ]
  )
}

export function paymentReceivedMail(input: { name: string; eventTitle: string; amount: string; reference: string | null; seatLink: string | null; personalLink: string }): MailContent {
  return mail(
    `Zahlung eingegangen: ${input.eventTitle}`,
    'Zahlung eingegangen',
    [
      hello(input.name),
      { kind: 'p', text: ['deine Zahlung für ', { strong: input.eventTitle }, ' ist eingegangen. Danke!'] },
      { kind: 'rows', rows: [['Betrag', input.amount], ...(input.reference ? [{ label: 'Verwendungszweck', value: input.reference, mono: true }] : [])] },
      input.seatLink && { kind: 'p', text: 'Jetzt kannst du deinen Sitzplatz wählen.' },
      input.seatLink && { kind: 'button', label: 'Sitzplatz wählen', href: input.seatLink },
      { kind: 'button', label: 'Zur Anmeldung', href: input.personalLink, secondary: !!input.seatLink },
      CLOSING
    ]
  )
}

export function paymentCancelledMail(input: { name: string; eventTitle: string; due: string | null; reference: string | null; personalLink: string }): MailContent {
  return mail(
    `Anmeldung storniert: ${input.eventTitle}`,
    'Anmeldung storniert',
    [
      hello(input.name),
      { kind: 'p', text: ['für deine Anmeldung zu ', { strong: input.eventTitle }, ' ist', input.due ? ` bis zum ${input.due}` : '', ' keine Zahlung eingegangen', ...(input.reference ? [' (Verwendungszweck ', { mono: input.reference }, ')'] : []), '. Deshalb haben wir deinen Platz freigegeben.'] },
      { kind: 'p', text: 'Falls du schon überwiesen hast, melde dich bitte bei der Veranstaltung. Über deinen persönlichen Link kannst du dich erneut anmelden, solange es Plätze gibt.' },
      { kind: 'button', label: 'Zur Event-Seite', href: input.personalLink },
      CLOSING
    ]
  )
}

export function paymentReminderMail(input: { name: string; eventTitle: string; overdue: boolean; payment: MailBlock; personalLink: string }): MailContent {
  const title = input.overdue ? 'Zahlung überfällig' : 'Zahlungserinnerung'
  return mail(
    `${title}: ${input.eventTitle}`,
    title,
    [
      hello(input.name),
      { kind: 'p', text: input.overdue
        ? ['für deine Anmeldung zu ', { strong: input.eventTitle }, ' ist die Zahlfrist abgelaufen und wir haben noch keine Zahlung erhalten. Bitte überweise jetzt, sonst kann die Veranstaltung deinen Platz freigeben.']
        : ['für deine Anmeldung zu ', { strong: input.eventTitle }, ' ist die Zahlung noch offen. Bitte denk an die Überweisung.'] },
      { kind: 'small', text: 'Falls du schon überwiesen hast, ist alles gut - die Zahlung ist dann nur noch nicht verbucht.' },
      input.payment,
      { kind: 'button', label: 'Zur Anmeldung', href: input.personalLink, secondary: true },
      CLOSING
    ]
  )
}

export function feedbackMail(input: { name: string; eventTitle: string; link: string }): MailContent {
  return mail(
    `Wie war's? ${input.eventTitle}`,
    "Wie war's?",
    [
      hello(input.name),
      { kind: 'p', text: ['danke, dass du bei ', { strong: input.eventTitle }, ' dabei warst! Wir würden gern wissen, wie es dir gefallen hat - der kurze Fragebogen dauert nur ein paar Minuten.'] },
      { kind: 'button', label: 'Feedback geben', href: input.link },
      { kind: 'small', text: 'Deine Antworten sind nicht mit deinem Namen oder deiner E-Mail-Adresse verknüpft. Du kannst sie über denselben Link ändern, solange der Fragebogen läuft.' },
      CLOSING
    ]
  )
}

export function invitationMail(input: { label: string; title: string; dates: string[]; names: string; link: string; reminder: boolean }): MailContent {
  const heading = input.reminder ? 'Erinnerung an die Einladung' : 'Einladung'
  return mail(
    `${heading}: ${input.title}`,
    input.reminder ? heading : `Einladung: ${input.title}`,
    [
      { kind: 'p', text: `Hallo ${input.label},` },
      { kind: 'p', text: input.reminder
        ? ['ihr habt noch nicht geantwortet, ob ihr zu ', { strong: input.title }, ' kommt.']
        : ['wir laden euch herzlich ein: ', { strong: input.title }, '.'] },
      input.dates.length === 1
        ? { kind: 'rows', rows: [['Wann und wo', input.dates[0]], ['Eingeladen', input.names]] }
        : { kind: 'rows', rows: [['Termine', input.dates.join('\n')], ['Eingeladen', input.names]] },
      { kind: 'p', text: 'Bitte gebt uns Bescheid, wer von euch kommt - über den Knopf sagt ihr für jede Person einzeln zu oder ab.' },
      { kind: 'button', label: 'Jetzt antworten', href: input.link },
      { kind: 'p', text: 'Viele Grüße' }
    ],
    { footer: 'Der Link ist persönlich für euch - bitte nicht weitergeben.' }
  )
}

/**
 * „Vielleicht“ (docs/KONZEPT-VIELLEICHT.md): Bestätigung der Adresse, ohne die keine Erinnerung kommt. Eigene Mail,
 * weil die Antwort keine Anmeldung ist - der Link führt auf dieselbe Seite /verify.
 */
export function maybeVerificationMail(input: { name: string; eventTitle: string; remindAt: string; link: string }): MailContent {
  return mail(
    `Bitte bestätige deine E-Mail-Adresse für ${input.eventTitle}`,
    'Bitte bestätige deine E-Mail-Adresse',
    [
      hello(input.name),
      { kind: 'p', text: ['du hast bei ', { strong: input.eventTitle }, ' mit „vielleicht“ geantwortet. Wir erinnern dich ', { strong: input.remindAt }, ' daran, dich zu entscheiden - aber nur, wenn du vorher deine E-Mail-Adresse bestätigst.'] },
      { kind: 'button', label: 'E-Mail-Adresse bestätigen', href: input.link },
      CLOSING
    ],
    { footer: 'Falls du nicht geantwortet hast, kannst du diese Mail ignorieren - ohne Bestätigung schicken wir dir nichts weiter.' }
  )
}

/** Erinnerung zum selbst gewählten Zeitpunkt: zu- oder absagen bis zum Stichtag, sonst gilt die Antwort als Absage. */
export function maybeReminderMail(input: {
  name: string; event: { title: string; when: string; location: string | null }; who: string | null; cutoff: string | null; capacity: boolean; personalLink: string
}): MailContent {
  return mail(
    `Kommst du zu ${input.event.title}?`,
    'Bitte sag zu oder ab',
    [
      hello(input.name),
      { kind: 'p', text: [input.who ? `für ${input.who} steht bei ` : 'du hast bei ', { strong: input.event.title }, ` noch „vielleicht“${input.who ? '' : ' angegeben'}. Wie du es dir gewünscht hast, erinnern wir dich jetzt: Bitte sag zu oder ab.`] },
      eventRows(input.event),
      input.cutoff && { kind: 'box', tone: 'amber', title: 'Bis wann?', blocks: [{ kind: 'p', text: `Bis ${input.cutoff}. Danach gilt „vielleicht“ als Absage.` }] },
      input.capacity && { kind: 'small', text: 'Die Plätze sind begrenzt: Ist der Termin voll, kommst du mit einer Zusage auf die Warteliste.' },
      { kind: 'button', label: 'Jetzt zu- oder absagen', href: input.personalLink },
      CLOSING
    ],
    { footer: `Du bekommst diese Mail, weil du bei „${input.event.title}“ mit „vielleicht“ geantwortet und eine Erinnerung gewählt hast.` }
  )
}

/**
 * „Vielleicht“ wurde zur Absage: am Stichtag (`expired`) oder weil die Veranstaltung „Vielleicht“ abgeschaltet hat
 * (`disabled`). `canAnswer`: ob der Gast noch selbst zusagen kann (keine Antwortfrist abgelaufen).
 */
export function maybeDeclinedMail(input: { name: string; eventTitle: string; reason: 'expired' | 'disabled'; who: string | null; canAnswer: boolean; personalLink: string }): MailContent {
  const whom = input.who ? `${input.who} ist` : 'du bist'
  return mail(
    `Als abgesagt eingetragen: ${input.eventTitle}`,
    'Als abgesagt eingetragen',
    [
      hello(input.name),
      { kind: 'p', text: input.reason === 'expired'
        ? ['bis zum Stichtag kam keine Entscheidung zu ', { strong: input.eventTitle }, `. Deshalb ${whom} jetzt als abgesagt eingetragen.`]
        : ['die Veranstaltung von ', { strong: input.eventTitle }, ` nimmt keine „vielleicht“-Antworten mehr an. Deshalb ${whom} jetzt als abgesagt eingetragen.`] },
      input.canAnswer
        ? { kind: 'p', text: 'Wenn du doch kommen möchtest, kannst du über deinen persönlichen Link selbst zusagen.' }
        : { kind: 'p', text: 'Die Antwortfrist ist abgelaufen. Wenn du doch kommen möchtest, wende dich bitte direkt an die Veranstaltung.' },
      { kind: 'button', label: 'Zur Event-Seite', href: input.personalLink },
      CLOSING
    ]
  )
}

/**
 * Rückbestätigung (Idee L30, app/lib/reconfirm.ts): „Kommst du noch?“ an feste Zusagen. Der Link führt nur auf die
 * Gästeseite - bestätigt bzw. abgesagt wird dort per Knopf (Links lösen beim Aufruf nichts aus).
 */
export function reconfirmRequestMail(input: {
  name: string; event: { title: string; when: string; location: string | null }; deadline: string; autoDecline: boolean; waitlist: boolean; personalLink: string
}): MailContent {
  return mail(
    `Kommst du noch? ${input.event.title}`,
    'Kommst du noch?',
    [
      hello(input.name),
      { kind: 'p', text: ['du hast zu ', { strong: input.event.title }, ' zugesagt. Damit kein Platz leer bleibt, fragen wir kurz nach: Kommst du noch?'] },
      eventRows(input.event),
      { kind: 'box', tone: 'amber', title: 'Bis wann?', blocks: [{ kind: 'p', text: input.autoDecline
        ? `Bitte bestätige bis ${input.deadline}. Ohne Antwort geben wir deinen Platz frei${input.waitlist ? ' - an die Warteliste' : ''}.`
        : `Bitte bestätige bis ${input.deadline}.` }] },
      { kind: 'p', text: 'Wenn du nicht kommen kannst, sag bitte ab - dann bekommt jemand anderes deinen Platz.' },
      { kind: 'button', label: 'Bestätigen oder absagen', href: input.personalLink },
      CLOSING
    ],
    { footer: `Du bekommst diese Mail, weil du bei „${input.event.title}“ zugesagt hast und die Veranstaltung vorher nachfragt.` }
  )
}

/** Rückbestätigung ohne Antwort bis zur Frist: Die Zusage wurde abgesagt (Event.reconfirmAutoDecline). */
export function reconfirmLapsedMail(input: { name: string; eventTitle: string; canAnswer: boolean; personalLink: string }): MailContent {
  return mail(
    `Platz freigegeben: ${input.eventTitle}`,
    'Dein Platz wurde freigegeben',
    [
      hello(input.name),
      { kind: 'p', text: ['bis zur Frist kam keine Bestätigung deiner Zusage zu ', { strong: input.eventTitle }, '. Deshalb haben wir deinen Platz freigegeben und dich als abgesagt eingetragen.'] },
      input.canAnswer
        ? { kind: 'p', text: 'Wenn du doch kommen möchtest, kannst du über deinen persönlichen Link wieder zusagen. Ist der Termin inzwischen voll, kommst du auf die Warteliste.' }
        : { kind: 'p', text: 'Die Antwortfrist ist abgelaufen. Wenn du doch kommen möchtest, wende dich bitte direkt an die Veranstaltung.' },
      { kind: 'button', label: 'Zur Event-Seite', href: input.personalLink },
      CLOSING
    ]
  )
}
