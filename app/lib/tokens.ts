// app/lib/tokens.ts
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Sitzungs- und Einmal-Link-Tokens (Passwort-Reset, E-Mail-Änderung, Konto-Bestätigung) werden
 * in der Datenbank nur als SHA-256-Hash gespeichert. Der Klartext steht ausschließlich im Cookie
 * bzw. im Mail-Link. Eine Kopie der Datenbank (Backup, Leak) ergibt damit keine übernehmbaren
 * Sitzungen und keine einlösbaren Links. SHA-256 genügt, weil die Tokens 32 zufällige Bytes
 * sind (nicht erratbar) und keine künstlich langsame Hash-Funktion brauchen - anders als Passwörter.
 */
export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Konstantzeitvergleich für Geheimnisse - `===` würde über die Antwortzeit verraten, wie viele Zeichen stimmen. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}
