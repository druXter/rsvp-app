import { describe, expect, it } from 'vitest'
import { renderMail } from 'suite-kit/web'
import {
  accountInviteMail, confirmationMail, emailChangeMail, eventUpdatedMail, feedbackMail, guestVerificationMail, invitationMail, passwordResetMail,
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
  accountInviteMail({ name: EVIL, eventTitle: EVIL, when: 'Samstag', location: EVIL, link: LINK })
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

  it('Absage: kein Termin-Block, keine Anhänge erwähnt', () => {
    const { subject, mail } = confirmationMail(confirmation({ attending: false, ics: false, checkinQr: false, payment: null, seatLink: null, companions: { label: 'x', names: [] }, menuLines: [] }))
    const { text } = renderMail(mail)
    expect(subject).toBe(`Absage bestätigt: Fest ${EVIL}`)
    expect(text).not.toContain('Wann:')
    expect(text).not.toContain('Im Anhang')
  })
})
