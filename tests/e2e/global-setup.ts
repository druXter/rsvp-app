import { prisma } from './helpers'

/**
 * Läuft nach dem Start des Servers (dessen Befehl hat die Datenbank bereits frisch angelegt).
 * Leert nur die Drossel-Zähler zur Sicherheit - alle anderen Daten legen die Tests selbst mit
 * eindeutigen Namen an.
 */
export default async function globalSetup() {
  await prisma.loginThrottle.deleteMany()
  await prisma.$disconnect()
}
