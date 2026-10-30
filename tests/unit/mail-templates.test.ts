import { describe, expect, it } from 'vitest'
import { renderMail } from 'suite-kit/web'
import {
  accountInviteMail, confirmationMail, emailChangeMail, eventUpdatedMail, feedbackMail, guestMessageMail, guestVerificationMail, invitationMail, maybeDeclinedMail,
  maybeReminderMail, maybeVerificationMail, passwordResetMail,
  paymentBox, paymentCancelledMail, paymentReceivedMail, paymentReminderMail, reminderMail, verificationMail, waitlistMail,
  waitlistPromotedMail, type ConfirmationInput
} from '../../app/lib/mail-templates'

// Inhalt der Mails (app/lib/mail-templates.ts) - gerendert mit der gemeinsamen Vorlage aus suite-kit.
const EVIL = '<b onmouseover=alert(1)>Anna</b>'
const LINK = 'https://rsvp.example.test/fest?token=abc'

function confirmation(overrides: Partial<ConfirmationInput> = {}): ConfirmationInput {
  return {
    name: EVIL, attending: true, event: { title: `Fest ${EVIL}`, when: 'Samstag, 1. November 2026 um 19:00 Uhr', location: 'Saal' },
    companions: { label: 'Mit dir angemeldet', names: ['Ben (Kind)'] }, menuLines: ['Anna: Fisch'],
    payment: paymentBox([['Betrag', '25,00 €'], ['IBAN', 'DE00 0000'], ['Verwendungszweck', 'FEST-1234']], true),
    seatAfterPayment: false, seatLink: 'https://rsvp.example.test/api/seating-link/e1?token=abc', timelineLink: null,
    checkinQr: true, ics: true, personalLink: LINK, series: { title: 'Reihe', link: 'https://rsvp.example.test/reihe/r?token=abc' },
    ...overrides
  }
}

const all = [
  confirmationMail(confirmation()), confirmationMail(confirmation({ attending: false })),
  reminderMail({ name: EVIL, event: { title: EVIL, when: 'morgen', location: null }, message: EVIL, personalLink: LINK }),
  verificationMail({ name: EVIL, eventTitle: EVIL, link: LINK }),
  guestVerificationMail({ name: EVIL, contextTitle: EVIL, link: LINK }),
  passwordResetMail({ name: null, email: EVIL, link: LINK }),
  emailChangeMail({ name: EVIL, currentEmail: EVIL, link: LINK }),
  waitlistMail({ name: EVIL, eventTitle: EVIL, personalLink: LINK, series: null }),
  waitlistPromotedMail({ name: EVIL, eventTitle: EVIL, personalLink: LINK }),
  eventUpdatedMail({ name: EVIL, eventTitle: EVIL, changes: [{ label: 'Ort', detail: EVIL }], ics: true, personalLink: LINK, series: null }),
  paymentReceivedMail({ name: EVIL, eventTitle: EVIL, amount: '25,00 €', reference: 'X-1', seatLink: null, personalLink: LINK }),
  paymentCancelledMail({ name: EVIL, eventTitle: EVIL, due: '1.11.2026', reference: 'X-1', personalLink: LINK }),
  paymentReminderMail({ name: EVIL, eventTitle: EVIL, overdue: true, payment: paymentBox([['Betrag', '25,00 €']], true), personalLink: LINK }),
  feedbackMail({ name: EVIL, eventTitle: EVIL, link: LINK }),
  invitationMail({ label: EVIL, title: EVIL, dates: ['a', 'b'], names: EVIL, link: LINK, reminder: false }),
  accountInviteMail({ name: EVIL, eventTitle: EVIL, when: 'Samstag', location: EVIL, link: LINK }),
  maybeVerificationMail({ name: EVIL, eventTitle: EVIL, remindAt: 'am Mo., 02.11.2026, 18:00 Uhr', link: LINK }),
  maybeReminderMail({ name: EVIL, event: { title: EVIL, when: 'Samstag', location: EVIL }, who: EVIL, cutoff: 'Fr., 06.11.2026, 23:59 Uhr', capacity: true, personalLink: LINK }),
  maybeDeclinedMail({ name: EVIL, eventTitle: EVIL, reason: 'expired', who: null, canAnswer: false, personalLink: LINK }),
  maybeDeclinedMail({ name: EVIL, eventTitle: EVIL, reason: 'disabled', who: EVIL, canAnswer: true, personalLink: LINK }),
  guestMessageMail({ name: EVIL, event: { title: EVIL, when: 'Samstag', location: EVIL }, subject: EVIL, paragraphs: [EVIL, 'Zweiter\nAbsatz'], personalLink: LINK })
]

describe('Mail-Vorlagen', () => {
  it('jede Mail: Namen und Titel escapet, Link als Knopf, Marke RSVP, Klartext mit Link', () => {
    for (const content of all) {
      const { html, text } = renderMail(content.mail)
      expect(html, content.subject).not.toContain('<b onmouseover')
      expect(html, content.subject).toContain('&lt;b onmouseover=alert(1)&gt;')
      expect(html, content.subject).toContain('href="https://rsvp.example.test/fest?token=abc"')
      expect(html, content.subject).toContain('>RSVP</span>')
      expect(text, content.subject).toContain(LINK)
      expect(text, content.subject).not.toContain('&lt;')
    }
  })

  it('Nachricht an Gäste (L29): Betreff mit Termin, jeder Absatz einzeln, Termin und Link', () => {
    const content = guestMessageMail({ name: 'Anna', event: { title: 'Ball', when: 'Samstag, 19 Uhr', location: 'Aula' }, subject: 'Bitte Ausweis mitbringen', paragraphs: ['Am Einlass wird kontrolliert.', 'Bis Samstag!'], personalLink: LINK })
    expect(content.subject).toBe('Ball: Bitte Ausweis mitbringen')
    const { text } = renderMail(content.mail)
    expect(text).toContain('Hallo Anna,')
    expect(text).toContain('Am Einlass wird kontrolliert.')
    expect(text).toContain('Bis Samstag!')
    expect(text).toContain('Aula')
  })

  it('Bestätigung einer Zusage: Termin, Begleitung, Menü, Zahlung mit GiroCode, QR-Code, Sitzplatz, Reihe', () => {
    const { subject, mail } = confirmationMail(confirmation())
    const { html, text } = renderMail(mail)
    expect(subject).toBe(`Zusage bestätigt: Fest ${EVIL}`)
    expect(text).toContain('Wann: Samstag, 1. November 2026 um 19:00 Uhr\nWo: Saal')
    expect(text).toContain('Wo: Saal\nMit dir angemeldet: Ben (Kind)')
    expect(text).toContain('- Anna: Fisch')
    expect(text).toContain('Verwendungszweck: FEST-1234')
    expect(html).toContain('src="cid:girocode"')
    expect(html).toContain('src="cid:checkinqr"')
    expect(text).toContain('Sitzplatz wählen:\nhttps://rsvp.example.test/api/seating-link/e1?token=abc')
    expect(text).toContain('Im Anhang findest du eine Kalenderdatei (.ics) und deinen Einlass-QR-Code.')
    expect(text).toContain('Zur Reihe (https://rsvp.example.test/reihe/r?token=abc)')
  })

  it('„Vielleicht“: Erinnerung mit Stichtag und Warteliste, Absage je nach Grund und Antwortfrist', () => {
    const reminder = renderMail(maybeReminderMail({ name: 'Anna', event: { title: 'Fest', when: 'Samstag', location: null }, who: null, cutoff: 'Fr., 06.11.2026, 23:59 Uhr', capacity: true, personalLink: LINK }).mail).text
    expect(reminder).toContain('Bis Fr., 06.11.2026, 23:59 Uhr. Danach gilt „vielleicht“ als Absage.')
    expect(reminder).toContain('Warteliste')
    const open = renderMail(maybeReminderMail({ name: 'Anna', event: { title: 'Fest', when: 'Samstag', location: null }, who: 'Ben', cutoff: null, capacity: false, personalLink: LINK }).mail).text
    expect(open).toContain('für Ben steht bei')
    expect(open).not.toContain('Warteliste')
    const expired = renderMail(maybeDeclinedMail({ name: 'Anna', eventTitle: 'Fest', reason: 'expired', who: null, canAnswer: false, personalLink: LINK }).mail).text
    expect(expired).toContain('bis zum Stichtag')
    expect(expired).toContain('direkt an die Veranstaltung')
    const disabled = renderMail(maybeDeclinedMail({ name: 'Anna', eventTitle: 'Fest', reason: 'disabled', who: null, canAnswer: true, personalLink: LINK }).mail).text
    expect(disabled).toContain('keine „vielleicht“-Antworten mehr')
    expect(disabled).toContain('selbst zusagen')
  })

  it('Absage: kein Termin-Block, keine Anhänge erwähnt', () => {
    const { subject, mail } = confirmationMail(confirmation({ attending: false, ics: false, checkinQr: false, payment: null, seatLink: null, companions: { label: 'x', names: [] }, menuLines: [] }))
    const { text } = renderMail(mail)
    expect(subject).toBe(`Absage bestätigt: Fest ${EVIL}`)
    expect(text).not.toContain('Wann:')
    expect(text).not.toContain('Im Anhang')
  })
})
