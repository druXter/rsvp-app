import { describe, expect, it } from 'vitest'
import { readManualRsvp } from '../../app/lib/manual-rsvp'
import { InputError } from '../../app/lib/input-error'

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [k, v] of Object.entries(fields)) data.set(k, v)
  return data
}

describe('readManualRsvp', () => {
  it('liest Name, Antwort und Adresse - die Adresse ist ohne Haken nicht bestätigt', () => {
    expect(readManualRsvp(form({ name: '  Anna ', status: 'yes', email: ' Anna@Example.org ' }))).toEqual({
      name: 'Anna', status: 'yes', email: 'anna@example.org', emailVerified: false, ticketCategoryId: null
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
