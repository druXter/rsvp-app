// app/lib/mail.ts
import { renderMail } from 'suite-kit/web'
import {
  accountInviteMail, confirmationMail, emailChangeMail, eventUpdatedMail, feedbackMail, guestVerificationMail, invitationMail, maybeDeclinedMail,
  maybeReminderMail, maybeVerificationMail, passwordResetMail,
  paymentCancelledMail, paymentReceivedMail, paymentReminderMail, reminderMail, verificationMail, waitlistMail, waitlistPromotedMail,
  type MailContent, type SeriesHint
} from './mail-templates'
import { formatEventDate } from './event-date'
import nodemailer from 'nodemailer'
import { buildEventIcs, ICS_CONTENT_TYPE } from './ics'
import { Event, EventSeries, GuestUser, Participant, Rsvp, User } from '@prisma/client'
import { generateCheckinQrBuffer } from './qrcode'
import { findToolLink } from './linked-tools-store'
import { formatPaymentDate, paymentDue, paymentMailParts } from './payment'
import { formatEuro } from './payment-state'
import { prisma } from './prisma'
import { describePerson, personsOf } from './persons'
import { describeSelection } from './menu'
import { formatMaybeTime } from './maybe'

// Den Mail-Transporter mit den Daten aus der .env initialisieren
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_PORT === '465', // Port 465 nutzt direkt TLS, andere Ports (wie 587) nutzen STARTTLS
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

// Ein Event, das optional (bei Reihen-Terminen) seine EventSeries mitbringt.
type EventWithSeries = Event & { series?: EventSeries | null }

const baseUrl = () => process.env.BASE_URL || 'http://localhost:3000'

/**
 * Persönlicher Link für einen Participant zu genau EINEM Termin. Bei Reihen-Terminen
 * führt der Link über die Reihen-Route, bei Einzel-Events direkt auf den Event-Slug.
 * Exportiert, damit auch Gast-Push-Benachrichtigungen (siehe app/lib/push.ts,
 * sendPushToParticipant) auf denselben Link verweisen können wie die zugehörige E-Mail.
 */
export function personalEventLink(event: EventWithSeries, participant: Participant) {
  if (event.series) {
    return `${baseUrl()}/reihe/${event.series.slug}/${event.slug}?token=${participant.editToken}`
  }
  return `${baseUrl()}/${event.slug}?token=${participant.editToken}`
}

/**
 * Link zur Reihen-Übersicht (alle Termine), personalisiert mit dem Participant-Token,
 * damit Kontakt-/Profildaten dort vorausgefüllt sind.
 */
function seriesOverviewLink(series: EventSeries, participant: Participant) {
  return `${baseUrl()}/reihe/${series.slug}?token=${participant.editToken}`
}

/** Hinweis auf die weiteren Termine, falls der Termin zu einer Reihe gehört (Bestätigung, Warteliste, Änderung). */
function seriesHint(event: EventWithSeries, participant: Participant): SeriesHint {
  return event.series ? { title: event.series.title, link: seriesOverviewLink(event.series, participant) } : null
}

type Attachment = { filename: string; content: Buffer | string; contentType: string; cid?: string }

/**
 * Verschickt eine Mail aus den Bausteinen (app/lib/mail-templates.ts, Vorlage aus suite-kit): HTML- und Klartext-Teil
 * aus demselben Inhalt. Wirft bei einem Fehler - Aufrufer, die stattdessen false melden, nutzen tryDeliver.
 */
async function deliver(to: string, content: MailContent, attachments: Attachment[] = []) {
  const { html, text } = renderMail(content.mail)
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: content.subject,
    text,
    html,
    attachments,
    // Zwingt Mail-Server, den korrekten technischen Absender zu akzeptieren
    envelope: { from: process.env.SMTP_USER, to }
  })
}

/** Wie deliver, aber false statt eines Fehlers (Versand, der den Ablauf nicht abbrechen darf). */
async function tryDeliver(to: string, content: MailContent, what: string, attachments: Attachment[] = []): Promise<boolean> {
  try {
    await deliver(to, content, attachments)
    return true
  } catch (error) {
    console.error(`Fehler beim Senden der ${what} an ${to}:`, error)
    return false
  }
}

/**
 * Baut den .ics-Kalender-Anhang für einen zugesagten Gast (app/lib/ics.ts). Gemeinsam genutzt von der Bestätigungs- und
 * der Änderungs-Mail, damit beide dieselbe stabile UID/SEQUENCE verwenden.
 */
function buildIcsAttachment(event: EventWithSeries, participant: Participant) {
  // "Datum noch offen" (Event.datePending): Das Datum ist nur ein Platzhalter - kein Kalendereintrag.
  // Sobald die Terminabstimmung es festlegt, geht die Änderungs-Mail mit Anhang raus (app/lib/poll-date.ts).
  if (event.datePending) return null
  const personalLink = personalEventLink(event, participant)
  const content = buildEventIcs(event, `${event.description || ''}\n\nAntwort nachträglich bearbeiten: ${personalLink}`, baseUrl())
  return content ? { filename: `${event.slug}.ics`, content, contentType: ICS_CONTENT_TYPE } : null
}

/**
 * Bestätigung einer Zu- oder Absage: bei einer Zusage mit Kalenderdatei, Einlass-QR-Code (Check-in), Zahlungsdaten
 * samt GiroCode (fester Platz mit offenem Betrag) und den Wegen zu Seating und Zeitplan.
 */
export async function sendConfirmationEmail(participant: Participant, rsvp: Rsvp, event: EventWithSeries) {
  const personalLink = personalEventLink(event, participant)

  // Wenn der Gast zusagt, generieren wir die .ics-Datei für den Anhang
  const icsAttachment = rsvp.isAttending ? buildIcsAttachment(event, participant) : null

  // Einlass-QR-Code: Nur für bestätigte Zusagen (sendConfirmationEmail wird für
  // Wartelisten-Fälle nie aufgerufen - siehe sendWaitlistEmail) und nur, wenn
  // der Check-in für diesen Termin aktiviert ist.
  const qrAttachment = rsvp.isAttending && event.enableCheckin
    ? { filename: 'einlass-qrcode.png', content: await generateCheckinQrBuffer(rsvp.id), cid: 'checkinqr', contentType: 'image/png' }
    : null

  // Zahlungsdaten samt GiroCode, falls für den festen Platz ein Betrag offen ist (app/lib/payment.ts)
  const payment = rsvp.isAttending && !rsvp.isOnWaitlist ? await paymentMailParts(rsvp, event) : null

  // "Sitzplatz wählen" (Seating): frisch ausgestellt erst beim Klick, siehe
  // app/api/seating-link/[eventId]/route.ts - die Mail trägt nur den persönlichen editToken.
  // Mit "Sitzplatzwahl erst nach Zahlung" kommt der Link erst mit der Mail "Zahlung eingegangen".
  const hasSeating = rsvp.isAttending && !rsvp.isOnWaitlist && !!(await findToolLink(event.id, 'seating'))
  const seatAfterPayment = hasSeating && event.seatingRequiresPayment && paymentDue(rsvp)
  const seatLink = hasSeating && !seatAfterPayment
    ? `${baseUrl()}/api/seating-link/${event.id}?token=${encodeURIComponent(participant.editToken)}`
    : null
  // "Zeitplan" (Zeitplan-Tool) genauso: nur die Weiterleitung, nie das signierte Token selbst
  const timelineLink = rsvp.isAttending && !rsvp.isOnWaitlist && await findToolLink(event.id, 'timeline')
    ? `${baseUrl()}/api/timeline-link/${event.id}?token=${encodeURIComponent(participant.editToken)}`
    : null

  // Begleitungen und Menü (docs/KONZEPT-EINLADUNGEN.md): wer mit angemeldet ist, samt Angaben und Wahl
  const [personRows, courses] = rsvp.isAttending
    ? await Promise.all([
        prisma.rsvpPerson.findMany({ where: { rsvpId: rsvp.id }, include: { menuChoices: true } }),
        prisma.menuCourse.findMany({ where: { eventId: event.id }, orderBy: { position: 'asc' } })
      ])
    : [[], []]
  const persons = personsOf({ isAttending: true, persons: personRows }, participant).filter(p => p.isAttending)
  // Bei einer Einladung sind alle Personen gleichrangig (die Antwort trägt den Namen des Haushalts)
  const companions = (event.inviteOnly ? persons : persons.slice(1)).map(p => describePerson(p))
  const menuLines = courses.length > 0
    ? persons.filter(p => p.ageGroup !== 'INFANT').map(p => `${p.name || 'Begleitung'}: ${describeSelection(courses, p.menu) || 'noch nicht gewählt'}`)
    : []

  await deliver(participant.email!, confirmationMail({
    name: participant.name,
    attending: rsvp.isAttending,
    event: { title: event.title, when: formatEventDate(event), location: event.location },
    companions: { label: event.inviteOnly ? 'Angemeldet' : 'Mit dir angemeldet', names: companions },
    menuLines,
    payment: payment?.block ?? null,
    seatAfterPayment,
    seatLink,
    timelineLink,
    checkinQr: !!qrAttachment,
    ics: !!icsAttachment,
    personalLink,
    series: seriesHint(event, participant)
  }), [icsAttachment, qrAttachment, payment?.attachment ?? null].filter((a): a is NonNullable<typeof a> => a !== null))
}

/**
 * Versendet eine Erinnerungs-E-Mail an einen bestimmten Gast.
 * Akzeptiert eine optionale, benutzerdefinierte Nachricht des Gastgebers.
 */
export async function sendReminderEmail(event: EventWithSeries, participant: Participant, customMessage: string) {
  return tryDeliver(participant.email!, reminderMail({
    name: participant.name,
    event: { title: event.title, when: formatEventDate(event), location: event.location },
    message: customMessage,
    personalLink: personalEventLink(event, participant)
  }), 'Erinnerung')
}

/**
 * Versendet eine Verifizierungs-E-Mail (Double-Opt-In), wenn requireVerification aktiv ist.
 * Die Verifizierung gilt für den Participant (und damit reihenweit), nicht für ein einzelnes Rsvp.
 */
export async function sendVerificationEmail(participant: Participant, event: EventWithSeries) {
  return tryDeliver(participant.email!, verificationMail({
    name: participant.name, eventTitle: event.title, link: `${baseUrl()}/verify?token=${participant.verifyToken}`
  }), 'Verifizierungs-Mail')
}

/** „Vielleicht“ (app/lib/maybe.ts): Adresse bestätigen, sonst keine Erinnerung. Gleicher Link wie die Verifizierung. */
export async function sendMaybeVerificationEmail(participant: Participant, event: EventWithSeries, remindAt: Date) {
  return tryDeliver(participant.email!, maybeVerificationMail({
    name: participant.name, eventTitle: event.title, remindAt: `am ${formatMaybeTime(remindAt)}`, link: `${baseUrl()}/verify?token=${participant.verifyToken}`
  }), 'Verifizierungs-Mail (vielleicht)')
}

/** Erinnerung zum gewählten Zeitpunkt (sendDueMaybeReminders). `who`: Personen eines Haushalts, die noch offen sind. */
export async function sendMaybeReminderEmail(participant: Participant, event: EventWithSeries, who: string | null, cutoff: Date | null) {
  return tryDeliver(participant.email!, maybeReminderMail({
    name: participant.name,
    event: { title: event.title, when: formatEventDate(event), location: event.location },
    who,
    cutoff: cutoff ? formatMaybeTime(cutoff) : null,
    capacity: event.maxCapacity !== null,
    personalLink: personalEventLink(event, participant)
  }), 'Vielleicht-Erinnerung')
}

/** „Vielleicht“ ist zur Absage geworden (Stichtag oder abgeschaltet, app/lib/maybe-store.ts). */
export async function sendMaybeDeclinedEmail(participant: Participant, event: EventWithSeries, reason: 'expired' | 'disabled', who: string | null, canAnswer: boolean) {
  return tryDeliver(participant.email!, maybeDeclinedMail({
    name: participant.name, eventTitle: event.title, reason, who, canAnswer, personalLink: personalEventLink(event, participant)
  }), 'Vielleicht-Absage')
}

/**
 * Bestätigung eines neu registrierten Teilnehmendenkontos (registerGuestUser in app/mein-konto/actions.ts) - nicht
 * die Verifizierung einer einzelnen Anmeldung. `contextTitle` ist der Titel der Reihe oder (Registrierung für ein
 * Einzel-Event mit requireGuestUser) des Events, null bei der allgemeinen Registrierung (/mein-konto/registrieren). `next` (optional) ist der Pfad, zu dem die Seite nach dem Bestätigen
 * weiterleitet - so landet ein Gast, der sich von einem Termin aus registriert hat, wieder dort.
 */
export async function sendGuestVerificationEmail(guestUser: GuestUser, contextTitle: string | null, next: string | null | undefined, token: string) {
  const link = `${baseUrl()}/mein-konto/verify?token=${token}${next ? `&next=${encodeURIComponent(next)}` : ''}`
  return tryDeliver(guestUser.email, guestVerificationMail({ name: guestUser.name, contextTitle, link }), 'Konto-Bestätigung')
}

/** Einladung eines Teilnehmendenkontos zu einem Termin (app/lib/guest-invites.ts). */
export async function sendAccountInviteEmail(guestUser: GuestUser, event: EventWithSeries) {
  const path = event.series ? `/reihe/${event.series.slug}/${event.slug}` : `/${event.slug}`
  return tryDeliver(guestUser.email, accountInviteMail({
    name: guestUser.name, eventTitle: event.title, when: formatEventDate(event), location: event.location, link: `${baseUrl()}${path}`
  }), 'Einladung zum Termin')
}

/** Passwort-Reset für ein Teilnehmendenkonto (requestGuestPasswordReset in app/mein-konto/actions.ts). */
export async function sendGuestPasswordResetEmail(guestUser: GuestUser, token: string) {
  return tryDeliver(guestUser.email, passwordResetMail({
    name: guestUser.name, email: guestUser.email, link: `${baseUrl()}/mein-konto/reset-password?token=${token}`
  }), 'Passwort-Reset-Mail')
}

/**
 * Passwort-Reset für ein Verwaltungskonto (requestPasswordReset in app/admin/actions.ts). Wird NIE für ein Konto mit
 * Admin-Rolle aufgerufen - dort bleibt ein Reset ausschließlich über direkten Server-Zugriff möglich
 * (create-user.js/set-role.js).
 */
export async function sendPasswordResetEmail(user: User, token: string) {
  return tryDeliver(user.email, passwordResetMail({
    name: null, email: user.email, link: `${baseUrl()}/admin/reset-password?token=${token}`
  }), 'Passwort-Reset-Mail')
}

/**
 * Bestätigungslink für eine E-Mail-Änderung eines Verwaltungskontos (requestEmailChange in app/admin/actions.ts).
 * Geht an die NEUE Adresse - erst der Klick macht die Änderung wirksam. Auch für Konten mit Admin-Rolle sicher: Der
 * Vorgang wurde bereits mit aktiver Sitzung UND aktuellem Passwort ausgelöst.
 */
export async function sendEmailChangeConfirmation(user: User, token: string) {
  return tryDeliver(user.pendingEmail!, emailChangeMail({
    name: null, currentEmail: user.email, link: `${baseUrl()}/admin/confirm-email?token=${token}`
  }), 'Bestätigung der E-Mail-Änderung')
}

/** Wie sendEmailChangeConfirmation, für Teilnehmendenkonten (requestGuestEmailChange in app/mein-konto/actions.ts). */
export async function sendGuestEmailChangeConfirmation(guestUser: GuestUser, token: string) {
  return tryDeliver(guestUser.pendingEmail!, emailChangeMail({
    name: guestUser.name, currentEmail: guestUser.email, link: `${baseUrl()}/mein-konto/confirm-email?token=${token}`
  }), 'Bestätigung der E-Mail-Änderung')
}

/** Der Gast ist bei der Anmeldung auf der Warteliste gelandet. */
export async function sendWaitlistEmail(participant: Participant, rsvp: Rsvp, event: EventWithSeries) {
  return tryDeliver(participant.email!, waitlistMail({
    name: participant.name, eventTitle: event.title, personalLink: personalEventLink(event, participant), series: seriesHint(event, participant)
  }), 'Wartelisten-Mail')
}

/** Der Gast ist von der Warteliste auf einen festen Platz nachgerückt. */
export async function sendWaitlistPromotedEmail(participant: Participant, rsvp: Rsvp, event: EventWithSeries) {
  return tryDeliver(participant.email!, waitlistPromotedMail({
    name: participant.name, eventTitle: event.title, personalLink: personalEventLink(event, participant)
  }), 'Nachrücker-Mail')
}

/**
 * Änderungs-Mail an einen bereits zugesagten Gast, wenn die Verwaltung wichtige Termin-Details (Titel/Datum/Dauer/
 * Ort/Beschreibung, siehe diffEventFields in app/admin/actions.ts) ändert und "Teilnehmende benachrichtigen" angehakt
 * hat. Hängt die aktualisierte .ics-Datei an (gleiche UID, höhere SEQUENCE - siehe buildIcsAttachment), damit ein
 * gespeicherter Kalendereintrag aktualisiert statt dupliziert wird.
 */
export async function sendEventUpdatedEmail(
  participant: Participant,
  rsvp: Rsvp,
  event: EventWithSeries,
  changes: { label: string; detail: string }[]
) {
  const icsAttachment = buildIcsAttachment(event, participant)
  return tryDeliver(participant.email!, eventUpdatedMail({
    name: participant.name,
    eventTitle: event.title,
    changes,
    ics: !!icsAttachment,
    personalLink: personalEventLink(event, participant),
    series: seriesHint(event, participant),
    // „Vielleicht“ (app/lib/maybe.ts) bekommt Änderungen auch
    maybe: !rsvp.isAttending
  }), 'Änderungs-Mail', icsAttachment ? [icsAttachment] : [])
}

/**
 * "Zahlung eingegangen" - nach dem Markieren einer Überweisung in der Verwaltung (setPaymentStatus). Bei
 * "Sitzplatzwahl erst nach Zahlung" bringt erst diese Mail den Link zur Sitzplatzwahl.
 */
export async function sendPaymentReceivedEmail(participant: Participant, rsvp: Rsvp, event: EventWithSeries) {
  const seatLink = event.seatingRequiresPayment && await findToolLink(event.id, 'seating')
    ? `${baseUrl()}/api/seating-link/${event.id}?token=${encodeURIComponent(participant.editToken)}`
    : null
  await deliver(participant.email!, paymentReceivedMail({
    name: participant.name,
    eventTitle: event.title,
    amount: rsvp.amountCents ? formatEuro(rsvp.amountCents) : '',
    reference: rsvp.paymentReference,
    seatLink,
    personalLink: personalEventLink(event, participant)
  }))
}

/** Stornierung wegen abgelaufener Zahlfrist (cancelUnpaidRsvp) - nur auf Klick der Verwaltung, nie automatisch. */
export async function sendPaymentCancelledEmail(participant: Participant, rsvp: Rsvp, event: EventWithSeries) {
  await deliver(participant.email!, paymentCancelledMail({
    name: participant.name,
    eventTitle: event.title,
    due: rsvp.paymentDueAt ? formatPaymentDate(rsvp.paymentDueAt) : null,
    reference: rsvp.paymentReference,
    personalLink: personalEventLink(event, participant)
  }))
}

/**
 * Zahlungserinnerung (app/lib/payment-reminder.ts): automatisch vor Ablauf der Frist oder per Knopf in der
 * Verwaltung. Enthält dieselben Zahlungsdaten samt GiroCode wie die Bestätigung; nach Ablauf der Frist mit
 * dem Hinweis, dass die Veranstaltung den Platz freigeben kann.
 */
export async function sendPaymentReminderEmail(participant: Participant, rsvp: Rsvp, event: EventWithSeries) {
  const payment = await paymentMailParts(rsvp, event)
  if (!payment) return
  await deliver(participant.email!, paymentReminderMail({
    name: participant.name,
    eventTitle: event.title,
    overdue: !!rsvp.paymentDueAt && rsvp.paymentDueAt < new Date(),
    payment: payment.block,
    personalLink: personalEventLink(event, participant)
  }), [payment.attachment])
}

/**
 * Feedback nach dem Event (Idee L8 Teil 2, app/lib/feedback.ts): Link auf "Feedback geben" - über rsvp-app
 * (/api/feedback-link/[eventId]), das bei jedem Klick einen frischen Nachweis für das Abstimmungstool ausstellt.
 */
export async function sendFeedbackEmail(participant: Participant, event: EventWithSeries, link: string) {
  await deliver(participant.email!, feedbackMail({ name: participant.name, eventTitle: event.title, link }))
}

/**
 * Einladung an einen Haushalt (docs/KONZEPT-EINLADUNGEN.md, Abschnitt 3) - oder mit `reminder` die Erinnerung an
 * eine noch offene Antwort vor der Antwortfrist. Nennt Termin, Ort, eingeladene Personen, ggf. die Frist und den
 * persönlichen Link.
 */
export async function sendInvitationEmail(
  invitation: { label: string; email: string; persons: { name: string }[] },
  occasion: { title: string; dates: string[] },
  link: string,
  options: { reminder?: boolean } = {}
) {
  await deliver(invitation.email, invitationMail({
    label: invitation.label,
    title: occasion.title,
    dates: occasion.dates,
    names: invitation.persons.map(p => p.name).join(', '),
    link,
    reminder: !!options.reminder
  }))
}
