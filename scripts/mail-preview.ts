// scripts/mail-preview.ts - alle Mails mit Beispieldaten ansehen, ohne Datenbank.
//
//   npx tsx scripts/mail-preview.ts                          schreibt .e2e/mail-preview/<name>.html und .txt
//   npx tsx --env-file=.env scripts/mail-preview.ts --send <adresse>
//                                                            schickt zusätzlich die Bestätigung (Zusage mit allem,
//                                                            was vorkommen kann) über SMTP_* aus der .env
//
// Gleiche Vorlagen wie im Betrieb (app/lib/mail-templates.ts, renderMail aus suite-kit). Nicht im Docker-Image.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createEvent } from 'ics'
import nodemailer from 'nodemailer'
import QRCode from 'qrcode'
import { renderMail } from 'suite-kit/web'
import {
  confirmationMail, emailChangeMail, eventUpdatedMail, feedbackMail, guestVerificationMail, invitationMail, maybeDeclinedMail, maybeReminderMail, maybeVerificationMail, passwordResetMail,
  paymentBox, paymentCancelledMail, paymentReceivedMail, paymentReminderMail, reminderMail, verificationMail, waitlistMail,
  waitlistPromotedMail, type MailContent
} from '../app/lib/mail-templates'

const base = (process.env.BASE_URL || 'https://rsvp.example.de').replace(/\/+$/, '')
const link = (path: string) => `${base}${path}`
const personal = link('/reihe/vorschau/herbstfest?token=nur-eine-vorschau')
const event = { title: 'Herbstfest 2026', when: 'Samstag, 14. November 2026 um 18:30 Uhr', location: 'Gemeindesaal, Kirchstraße 3, Koblenz' }
const paymentRows: [string, string][] = [
  ['Betrag', '25,00 € (Studierende)'], ['Empfänger*in', 'Fachschaft Beispiel'], ['IBAN', 'DE02 1203 0000 0000 2020 51'],
  ['Verwendungszweck', 'HERBST-7Q4K'], ['Zahlbar bis', 'Freitag, 7. November 2026']
]

const mails: Record<string, MailContent> = {
  'bestaetigung-zusage': confirmationMail({
    name: 'Ramón', attending: true, event,
    companions: { label: 'Mit dir angemeldet', names: ['Alex (vegetarisch)', 'Mia (Kind)'] },
    menuLines: ['Ramón: Hauptgang Fisch, Dessert Obst', 'Alex: Hauptgang Vegetarisch, Dessert Eis', 'Mia: Kindermenü'],
    payment: paymentBox(paymentRows, true),
    seatAfterPayment: false, seatLink: link('/api/seating-link/vorschau?token=x'), timelineLink: link('/api/timeline-link/vorschau?token=x'),
    checkinQr: true, ics: true, personalLink: personal, series: { title: 'Feste der Fachschaft', link: link('/reihe/vorschau?token=x') }
  }),
  'bestaetigung-absage': confirmationMail({
    name: 'Ramón', attending: false, event, companions: { label: '', names: [] }, menuLines: [], payment: null,
    seatAfterPayment: false, seatLink: null, timelineLink: null, checkinQr: false, ics: false, personalLink: personal, series: null
  }),
  erinnerung: reminderMail({ name: 'Ramón', event, message: 'Bitte bringt warme Kleidung mit - wir sind ab 21 Uhr draußen am Feuer.', personalLink: personal }),
  'anmeldung-bestaetigen': verificationMail({ name: 'Ramón', eventTitle: event.title, link: link('/verify?token=x') }),
  'konto-bestaetigen': guestVerificationMail({ name: 'Ramón', contextTitle: 'Feste der Fachschaft', link: link('/mein-konto/verify?token=x') }),
  'passwort-zuruecksetzen': passwordResetMail({ name: 'Ramón', email: 'ramon@example.de', link: link('/mein-konto/reset-password?token=x') }),
  'email-aendern': emailChangeMail({ name: null, currentEmail: 'alt@example.de', link: link('/admin/confirm-email?token=x') }),
  warteliste: waitlistMail({ name: 'Ramón', eventTitle: event.title, personalLink: personal, series: null }),
  nachgerueckt: waitlistPromotedMail({ name: 'Ramón', eventTitle: event.title, personalLink: personal }),
  aenderung: eventUpdatedMail({ name: 'Ramón', eventTitle: event.title, changes: [{ label: 'Beginn', detail: 'neu 19:00 statt 18:30 Uhr' }, { label: 'Ort', detail: 'Aula statt Gemeindesaal' }], ics: true, personalLink: personal, series: null }),
  'zahlung-eingegangen': paymentReceivedMail({ name: 'Ramón', eventTitle: event.title, amount: '25,00 €', reference: 'HERBST-7Q4K', seatLink: link('/api/seating-link/vorschau?token=x'), personalLink: personal }),
  'zahlung-storniert': paymentCancelledMail({ name: 'Ramón', eventTitle: event.title, due: 'Freitag, 7. November 2026', reference: 'HERBST-7Q4K', personalLink: personal }),
  'zahlung-erinnerung': paymentReminderMail({ name: 'Ramón', eventTitle: event.title, overdue: false, payment: paymentBox(paymentRows, true), personalLink: personal }),
  feedback: feedbackMail({ name: 'Ramón', eventTitle: event.title, link: link('/api/feedback-link/vorschau?token=x') }),
  einladung: invitationMail({ label: 'Familie Röser', title: event.title, dates: [`${event.when}, ${event.location}`], names: 'Ramón, Alex, Mia', link: personal, reminder: false }),
  'vielleicht-bestaetigen': maybeVerificationMail({ name: 'Ramón', eventTitle: event.title, remindAt: 'am Mo., 02.11.2026, 18:00 Uhr', link: link('/verify?token=x') }),
  'vielleicht-erinnerung': maybeReminderMail({ name: 'Ramón', event, who: null, cutoff: 'Fr., 07.11.2026, 23:59 Uhr', capacity: true, personalLink: personal }),
  'vielleicht-abgesagt': maybeDeclinedMail({ name: 'Ramón', eventTitle: event.title, reason: 'expired', who: null, canAnswer: false, personalLink: personal })
}

const dir = join('.e2e', 'mail-preview')
mkdirSync(dir, { recursive: true })
for (const [name, content] of Object.entries(mails)) {
  const { html, text } = renderMail(content.mail)
  // Bilder aus dem Anhang (cid:) zeigt der Browser nicht - in der Vorschau ein Platzhalter.
  writeFileSync(join(dir, `${name}.html`), html.replace(/src="cid:[^"]+"/g, 'src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22%3E%3Crect width=%22200%22 height=%22200%22 fill=%22%23e5e7eb%22/%3E%3C/svg%3E"'))
  writeFileSync(join(dir, `${name}.txt`), `Betreff: ${content.subject}\n\n${text}`)
}
console.log(`${Object.keys(mails).length} Vorschauen in ${dir}/`)

async function send(to: string | undefined) {
  if (!to || !process.env.SMTP_HOST) throw new Error('Aufruf: --send <adresse>, SMTP_* aus der .env (tsx --env-file=.env)')
  const content = mails['bestaetigung-zusage']
  const { html, text } = renderMail(content.mail)
  const ics = createEvent({
    uid: 'vorschau@rsvp', title: event.title, location: event.location, start: [2026, 11, 14, 17, 30], duration: { hours: 5 },
    startInputType: 'utc', startOutputType: 'utc', description: `Antwort bearbeiten: ${personal}`
  }).value!
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_PORT === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  })
  await transporter.sendMail({
    from: process.env.SMTP_FROM, to, subject: `[Vorschau] ${content.subject}`, text, html,
    attachments: [
      { filename: 'herbstfest-2026.ics', content: ics, contentType: 'text/calendar' },
      { filename: 'einlass-qrcode.png', content: await QRCode.toBuffer(link('/admin/checkin/vorschau'), { width: 300, margin: 1 }), cid: 'checkinqr', contentType: 'image/png' },
      { filename: 'girocode.png', content: await QRCode.toBuffer('BCD\n002\n1\nSCT\n\nFachschaft Beispiel\nDE02120300000000202051\nEUR25.00\n\n\nHERBST-7Q4K', { errorCorrectionLevel: 'M', width: 260, margin: 2 }), cid: 'girocode', contentType: 'image/png' }
    ],
    envelope: { from: process.env.SMTP_USER, to }
  })
  console.log(`Bestätigung (Vorschau) an ${to} verschickt`)
}

const sendIndex = process.argv.indexOf('--send')
if (sendIndex !== -1) send(process.argv[sendIndex + 1]).catch(error => { console.error(error); process.exit(1) })
