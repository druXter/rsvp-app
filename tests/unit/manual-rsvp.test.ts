import { describe, expect, it } from 'vitest'
import { manualMailOf, readManualRsvp, verificationAfterAdminEdit } from '../../app/lib/manual-rsvp'
import { InputError } from '../../app/lib/input-error'

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [k, v] of Object.entries(fields)) data.set(k, v)
  return data
}

describe('readManualRsvp', () => {
  it('liest Name, Antwort und Adresse - die Adresse ist ohne Haken nicht bestätigt', () => {
    expect(readManualRsvp(form({ name: '  Anna ', status: 'yes', email: ' Anna@Example.org ' }))).toEqual({
      name: 'Anna', status: 'yes', email: 'anna@example.org', emailVerified: false, sendMail: false, ticketCategoryId: null
    })
  })

  it('bestätigt die Adresse nur mit Haken und nur, wenn es eine gibt', () => {
    expect(readManualRsvp(form({ name: 'Anna', status: 'maybe', email: 'anna@example.org', emailVerified: 'on' })).emailVerified).toBe(true)
    expect(readManualRsvp(form({ name: 'Anna', status: 'no', email: '', emailVerified: 'on' }))).toMatchObject({ email: null, emailVerified: false })
  })

  it('lehnt fehlenden Namen, unbekannte Antwort und ungültige Adresse ab', () => {
    expect(() => readManualRsvp(form({ name: ' ', status: 'yes' }))).toThrow(InputError)
    expect(() => readManualRsvp(form({ name: 'Anna', status: 'waitlist' }))).toThrow(InputError)
    expect(() => readManualRsvp(form({ name: 'Anna', status: 'yes', email: 'keine adresse' }))).toThrow(InputError)
  })
})

describe('manualMailOf', () => {
  const base = { email: 'anna@example.org', emailVerified: false, sendMail: true }

  it('ohne Haken oder ohne Adresse keine Mail', () => {
    expect(manualMailOf({ ...base, status: 'yes', sendMail: false }, false)).toBeNull()
    expect(manualMailOf({ ...base, status: 'yes', email: null }, false)).toBeNull()
  })

  it('Zusage: Bestätigung, mit Verifizierungs-Pflicht und unbestätigter Adresse erst die Bitte um Bestätigung', () => {
    expect(manualMailOf({ ...base, status: 'yes' }, false)).toBe('confirmation')
    expect(manualMailOf({ ...base, status: 'yes' }, true)).toBe('verification')
    expect(manualMailOf({ ...base, status: 'yes', emailVerified: true }, true)).toBe('confirmation')
  })

  it('Vielleicht nur mit unbestätigter Adresse, Absage nie', () => {
    expect(manualMailOf({ ...base, status: 'maybe' }, false)).toBe('maybe-verification')
    expect(manualMailOf({ ...base, status: 'maybe', emailVerified: true }, true)).toBeNull()
    expect(manualMailOf({ ...base, status: 'no' }, true)).toBeNull()
  })
})

describe('verificationAfterAdminEdit', () => {
  const now = new Date('2026-10-28T10:00:00Z')
  const verified = { email: 'anna@example.org', isVerified: true }
  const unverified = { email: 'anna@example.org', isVerified: false }

  it('unveränderte Adresse ohne Haken bleibt, wie sie ist (auch andere Schreibweise)', () => {
    expect(verificationAfterAdminEdit(verified, ' Anna@Example.org', false, now)).toBeNull()
    expect(verificationAfterAdminEdit(unverified, 'anna@example.org', false, now)).toBeNull()
  })

  it('geänderte oder gelöschte Adresse ohne Haken ist unbestätigt, der alte Link verfällt', () => {
    const reset = { isVerified: false, verifiedAt: null, verifyToken: null }
    expect(verificationAfterAdminEdit(verified, 'neu@example.org', false, now)).toEqual(reset)
    expect(verificationAfterAdminEdit(unverified, 'neu@example.org', false, now)).toEqual(reset)
    expect(verificationAfterAdminEdit(verified, null, false, now)).toEqual(reset)
  })

  it('mit Haken bestätigt - eine schon bestätigte, unveränderte Adresse behält ihr Datum', () => {
    const confirmed = { isVerified: true, verifiedAt: now, verifyToken: null }
    expect(verificationAfterAdminEdit(unverified, 'anna@example.org', true, now)).toEqual(confirmed)
    expect(verificationAfterAdminEdit(verified, 'neu@example.org', true, now)).toEqual(confirmed)
    expect(verificationAfterAdminEdit(verified, 'anna@example.org', true, now)).toBeNull()
    expect(verificationAfterAdminEdit(verified, null, true, now)).toEqual({ isVerified: false, verifiedAt: null, verifyToken: null })
  })
})
