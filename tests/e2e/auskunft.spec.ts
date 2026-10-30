import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { createAccount, createEvent, createGuestUser, prisma, uniqueEmail } from './helpers'

// Auskunft und Löschung zu einer Adresse (Idee Q8, auskunft.js): findet Konto, Teilnehmendenkonto und Antworten ohne
// Groß-/Kleinschreibung, gibt keine Tokens heraus, löscht erst mit --ja und nie Verwaltungskonten oder Fremdes.
const run = (...args: string[]) => JSON.parse(execFileSync('node', ['auskunft.js', ...args], { env: { ...process.env, DATABASE_URL: 'file:./test.db' }, encoding: 'utf8' }))

test('Auskunft, Probe und Löschung', async () => {
  const email = uniqueEmail('auskunft')
  const owner = await createAccount('CREATOR', { email })
  const other = await createAccount()
  const event = await createEvent(other, { title: 'Sommerfest' })
  const guestUser = await createGuestUser({ email })
  // Antwort mit großgeschriebener Adresse, eine über das Teilnehmendenkonto ohne Adresse, eine fremde
  const direct = await prisma.participant.create({ data: { name: 'Anna', email: email.toUpperCase(), allergies: 'Nüsse' } })
  await prisma.rsvp.create({ data: { eventId: event.id, participantId: direct.id, isAttending: true, additionalInfo: 'Komme später' } })
  const viaAccount = await prisma.participant.create({ data: { name: 'Anna (Konto)', guestUserId: guestUser.id } })
  const stranger = await prisma.participant.create({ data: { name: 'Fremd', email: uniqueEmail('fremd') } })
  await prisma.rsvp.create({ data: { eventId: event.id, participantId: stranger.id, isAttending: true } })

  const info = run(email)
  expect(info.tool).toBe('rsvp-app')
  expect(info.daten.verwaltungskonten).toHaveLength(1)
  expect(info.daten.teilnehmendenkonten).toHaveLength(1)
  expect(info.daten.antworten.map((p: { name: string }) => p.name).sort()).toEqual(['Anna', 'Anna (Konto)'])
  const anna = info.daten.antworten.find((p: { name: string }) => p.name === 'Anna')
  expect(anna).toMatchObject({ allergies: 'Nüsse', rsvps: [{ additionalInfo: 'Komme später', event: { title: 'Sommerfest' } }] })
  // Keine Tokens oder Hashes in der Auskunft
  expect(JSON.stringify(info)).not.toMatch(/editToken|passwordHash|tokenHash/)
  expect(JSON.stringify(info)).not.toContain(direct.editToken)
  expect(info.hinweise.join(' ')).toContain('Verwaltungskonto vorhanden')

  // Probe ändert nichts
  const probe = run(email, '--loeschen')
  expect(probe).toMatchObject({ modus: 'probe', loeschen: { identitaeten: 2, antworten: 1, teilnehmendenkonten: 1 } })
  expect(await prisma.participant.count({ where: { id: { in: [direct.id, viaAccount.id] } } })).toBe(2)

  const done = run(email, '--loeschen', '--ja')
  expect(done.modus).toBe('geloescht')
  expect(await prisma.participant.count({ where: { id: { in: [direct.id, viaAccount.id] } } })).toBe(0)
  expect(await prisma.guestUser.count({ where: { id: guestUser.id } })).toBe(0)
  // Verwaltungskonto, fremde Antwort und Termin bleiben
  expect(await prisma.user.count({ where: { id: owner.id } })).toBe(1)
  expect(await prisma.rsvp.count({ where: { participantId: stranger.id } })).toBe(1)
  expect(run(email).daten.antworten).toEqual([])
})
