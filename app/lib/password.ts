// app/lib/password.ts
import bcrypt from 'bcryptjs'

/**
 * Passwort-Hashing für Admin- und Nutzer-Konten. Bleibt bei bcrypt, damit alle bestehenden
 * Konten weiter funktionieren; neue Hashes bekommen COST 12 (bisher 10), und ein Login mit einem
 * schwächeren Hash schreibt ihn automatisch neu (needsRehash). Nachteil von bcrypt: Es
 * berücksichtigt nur die ersten 72 Byte - längere Passwörter werden deshalb abgelehnt statt
 * stillschweigend abgeschnitten.
 */
const COST = 12
export const MIN_PASSWORD_LENGTH = 10
export const MAX_PASSWORD_BYTES = 72

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST)
}

export type PasswordCheck = { ok: boolean; needsRehash: boolean }

export async function verifyPassword(password: string, hash: string): Promise<PasswordCheck> {
  const ok = await bcrypt.compare(password, hash)
  let needsRehash = false
  try {
    needsRehash = ok && bcrypt.getRounds(hash) < COST
  } catch {
    // Kein bcrypt-Hash im erwarteten Format - dann gibt es auch nichts umzustellen.
  }
  return { ok, needsRehash }
}

let dummyHash: Promise<string> | undefined

/**
 * Rechnet eine gleich teure Prüfung gegen einen Wegwerf-Hash, wenn es zur eingegebenen E-Mail
 * gar kein (passwortfähiges) Konto gibt. Ohne das antwortet der Login bei unbekannten Adressen
 * messbar schneller als bei bekannten (keine bcrypt-Rechnung) und verrät so, welche Adressen
 * registriert sind.
 */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing-equalization')
  await bcrypt.compare(password, await dummyHash)
}

const COMMON_PASSWORDS = new Set([
  'passwort123', 'password123', '1234567890', '0123456789', 'qwertzuiop', 'qwertyuiop',
  'passwort12', 'password12', 'willkommen', 'abcdefghij', 'iloveyou12', 'changeme123'
])

/**
 * Gibt eine Fehlermeldung zurück oder null, wenn das Passwort akzeptabel ist. Bewusst ohne
 * Zeichenklassen-Zwang (das erzeugt nur "Passwort1!") - stattdessen Mindestlänge, Obergrenze,
 * und ein Abgleich gegen die naheliegendsten Fälle (E-Mail selbst, offensichtliche Klassiker).
 */
export function validatePassword(password: unknown, email?: string): string | null {
  if (typeof password !== 'string') return 'Bitte gib ein Passwort ein.'
  if (password.length < MIN_PASSWORD_LENGTH) return `Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) return `Das Passwort ist zu lang (höchstens ${MAX_PASSWORD_BYTES} Byte).`

  const lower = password.toLowerCase()
  if (COMMON_PASSWORDS.has(lower)) return 'Dieses Passwort ist zu naheliegend.'
  if (/^(.)\1+$/.test(password)) return 'Das Passwort darf nicht nur aus einem wiederholten Zeichen bestehen.'
  if (email) {
    const mail = email.toLowerCase()
    if (lower === mail || lower === mail.split('@')[0]) return 'Das Passwort darf nicht deiner E-Mail-Adresse entsprechen.'
  }
  return null
}
