import bcrypt from 'bcryptjs'
import { describe, expect, it } from 'vitest'
import { MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH, hashPassword, validatePassword, verifyAgainstDummy, verifyPassword } from '../../app/lib/password'

describe('hashPassword / verifyPassword', () => {
  it('erkennt das richtige Passwort und lehnt ein falsches ab', async () => {
    const hash = await hashPassword('ein langes Passwort')
    expect(bcrypt.getRounds(hash)).toBe(12)
    expect(hash).not.toContain('ein langes Passwort')
    expect(await verifyPassword('ein langes Passwort', hash)).toEqual({ ok: true, needsRehash: false })
    expect((await verifyPassword('ein langes passwort', hash)).ok).toBe(false)
  })

  it('erzeugt für dasselbe Passwort unterschiedliche Hashes (Salt)', async () => {
    expect(await hashPassword('gleiches Passwort')).not.toBe(await hashPassword('gleiches Passwort'))
  })

  it('meldet needsRehash für ältere Hashes mit Kosten 10 - nie bei falschem Passwort', async () => {
    const old = await bcrypt.hash('altes Passwort', 10)
    expect(await verifyPassword('altes Passwort', old)).toEqual({ ok: true, needsRehash: true })
    expect(await verifyPassword('falsch', old)).toEqual({ ok: false, needsRehash: false })
  })

  it('lehnt kaputte Hash-Strings ab', async () => {
    for (const stored of ['', 'kein-hash', '$2a$12$zu-kurz']) {
      expect((await verifyPassword('egal', stored)).ok).toBe(false)
    }
  })

  it('verifyAgainstDummy rechnet eine echte bcrypt-Prüfung (Zeitausgleich für unbekannte Adressen)', async () => {
    await verifyAgainstDummy('warmup')
    const start = Date.now()
    await verifyAgainstDummy('irgendwas')
    expect(Date.now() - start).toBeGreaterThan(20)
  })
})

describe('validatePassword', () => {
  it('verlangt Mindest- und Höchstlänge (in Byte, wegen bcrypt)', () => {
    expect(validatePassword('a'.repeat(MIN_PASSWORD_LENGTH - 1) + 'b')).toBeNull()
    expect(validatePassword('kurz')).toMatch(/mindestens/)
    expect(validatePassword('ab'.repeat(MAX_PASSWORD_BYTES))).toMatch(/zu lang/)
    // 30 Umlaute = 60 Byte erlaubt, 40 Umlaute = 80 Byte zu lang - obwohl nur 40 Zeichen.
    expect(validatePassword('äöü'.repeat(10))).toBeNull()
    expect(validatePassword('ä'.repeat(40))).toMatch(/zu lang/)
  })

  it('lehnt naheliegende Passwörter, Wiederholungen und die eigene E-Mail ab', () => {
    expect(validatePassword('Passwort123')).toMatch(/naheliegend/)
    expect(validatePassword('xxxxxxxxxxxx')).toMatch(/wiederholten/)
    expect(validatePassword('max.muster@example.de', 'Max.Muster@example.de')).toMatch(/E-Mail/)
    expect(validatePassword('max.mustermann', 'max.mustermann@example.de')).toMatch(/E-Mail/)
    expect(validatePassword('ein ganz normaler Satz', 'max@example.de')).toBeNull()
  })

  it('lehnt Nicht-Strings ab (manipulierter Request)', () => {
    expect(validatePassword(undefined)).not.toBeNull()
    expect(validatePassword(12345678901)).not.toBeNull()
  })
})
