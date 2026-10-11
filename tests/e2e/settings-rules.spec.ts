import { expect, test, type Page } from '@playwright/test'
import { createAccount, createEvent, createSeries, createTermin, login, prisma } from './helpers'

// Einstellungen: Was sich ausschließt, sperrt das Formular gleich (app/admin/field-rules.tsx), und ungültige
// Eingaben kommen als Meldung zurück statt als Fehlerseite, mit allen Eingaben noch im Formular
// (app/admin/settings-form.tsx, settingsResult in app/admin/actions.ts).

const section = (page: Page, title: string) => page.locator('summary').filter({ hasText: title }).click()
const save = (page: Page) => page.getByRole('button', { name: 'Änderungen speichern' }).click()
const inviteOnly = (page: Page) => page.getByRole('checkbox', { name: /Nur mit Einladung/ })
const verification = (page: Page) => page.getByRole('checkbox', { name: /^(E-Mail-Bestätigung|Verifizierung zwingend)/ })

test('Event: Einladungsmodus sperrt PIN, Bestätigung und Kategorien, Begleitungen sperren Kategorien', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner)
  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/einstellungen`)
  await section(page, 'Zugang und Gästeliste')
  await section(page, 'Tickets und Bezahlung')

  await inviteOnly(page).check()
  await expect(verification(page)).toBeDisabled()
  await expect(page.locator('#eventPin')).toHaveAttribute('readonly', '')
  await expect(page.locator('#ticketCategories')).toHaveAttribute('readonly', '')
  await expect(page.getByTestId('rule-eventPin')).toHaveText('🔒 Gesperrt: geht nicht zusammen mit „Nur mit Einladung“.')
  await expect(page.getByTestId('rule-requireVerification')).toContainText('Gesperrt')

  // Wieder aus: alles frei; eine PIN sperrt dann den Einladungsmodus
  await inviteOnly(page).uncheck()
  await expect(verification(page)).toBeEnabled()
  await expect(page.locator('#eventPin')).not.toHaveAttribute('readonly')
  await expect(page.getByTestId('rule-eventPin')).toBeEmpty()
  await page.locator('#eventPin').fill('1234')
  await expect(inviteOnly(page)).toBeDisabled()
  await expect(page.getByTestId('rule-inviteOnly')).toContainText('einer PIN')
  await page.locator('#eventPin').fill('')
  await expect(inviteOnly(page)).toBeEnabled()

  // Begleitungen sperren Kategorien und umgekehrt
  await section(page, 'Anmeldeformular')
  await page.locator('#maxCompanions').fill('2')
  await expect(page.locator('#ticketCategories')).toHaveAttribute('readonly', '')
  await expect(page.getByTestId('rule-ticketCategories')).toContainText('Begleitungen')
  await page.locator('#maxCompanions').fill('0')
  await page.locator('#ticketCategories').fill('Gäste; 25')
  await expect(page.locator('#maxCompanions')).toHaveAttribute('readonly', '')
  await expect(inviteOnly(page)).toBeDisabled()

  // Erinnerung an Einladungen braucht eine Antwortfrist
  await expect(page.locator('#rsvpReminderDays')).toHaveAttribute('readonly', '')
  await expect(page.getByTestId('rule-rsvpReminderDays')).toContainText('Antwortfrist')
  await page.locator('#rsvpDeadline').fill('2027-05-30')
  await expect(page.locator('#rsvpReminderDays')).not.toHaveAttribute('readonly')

  // Ungültige IBAN: Meldung statt Fehlerseite, Eingaben bleiben, nichts gespeichert
  await page.locator('#paymentRecipient').fill('Verein')
  await page.locator('#paymentIban').fill('DE00 1234 5678')
  await save(page)
  await expect(page.getByTestId('settings-error')).toHaveText('⚠️ Nicht gespeichert: Bezahlung: Die IBAN ist ungültig (Prüfsumme stimmt nicht).')
  await expect(page.locator('#ticketCategories')).toHaveValue('Gäste; 25')
  await expect(page.locator('#paymentIban')).toHaveValue('DE00 1234 5678')
  expect(page.url()).not.toContain('gespeichert')
  expect(await prisma.ticketCategory.count({ where: { eventId: event.id } })).toBe(0)

  // Korrigiert: gespeichert
  await page.locator('#paymentIban').fill('DE89 3704 0044 0532 0130 00')
  await save(page)
  await page.waitForURL(/gespeichert=1/)
  expect(await prisma.ticketCategory.count({ where: { eventId: event.id } })).toBe(1)
})

test('Event: alte widersprüchliche Einstellungen werden angezeigt, Speichern meldet sie; vergebenes URL-Wort', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { inviteOnly: true, requireVerification: true })
  const other = await createEvent(owner)
  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/einstellungen`)
  await section(page, 'Zugang und Gästeliste')

  // Beide an: nichts gesperrt, aber Hinweise an beiden
  await expect(inviteOnly(page)).toBeEnabled()
  await expect(page.getByTestId('rule-inviteOnly')).toContainText('Geht nicht zusammen mit E-Mail-Bestätigung')
  await expect(page.getByTestId('rule-requireVerification')).toContainText('Geht nicht zusammen mit „Nur mit Einladung“')
  await save(page)
  await expect(page.getByTestId('settings-error')).toContainText('Einladungsmodus: nicht zusammen mit E-Mail-Verifizierung')

  // Eins ausgeschaltet: gespeichert. Danach ein schon vergebenes URL-Wort
  await verification(page).uncheck()
  await save(page)
  await page.waitForURL(/gespeichert=1/)
  await page.locator('#slug').fill(other.slug)
  await save(page)
  await expect(page.getByTestId('settings-error')).toContainText('schon vergeben')
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).slug).toBe(event.slug)
})

test('Event mit Konto-Pflicht und Termin einer Einladungs-Reihe: fest gesperrt', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEvent(owner, { requireGuestUser: true })
  const series = await createSeries(owner, { inviteOnly: true })
  const termin = await createTermin(series, { inviteOnly: true })
  await login(page, owner.email)

  await page.goto(`/admin/events/${event.id}/einstellungen`)
  await section(page, 'Zugang und Gästeliste')
  await expect(inviteOnly(page)).toBeDisabled()
  await expect(page.getByTestId('rule-inviteOnly')).toContainText('Teilnehmendenkonto')

  await page.goto(`/admin/events/${termin.id}/einstellungen`)
  await section(page, 'Tickets und Bezahlung')
  await expect(page.locator('#ticketCategories')).toHaveAttribute('readonly', '')
  await expect(page.getByTestId('rule-ticketCategories')).toContainText('Einladungsmodus')
  await expect(page.locator('#maxCompanions')).not.toHaveAttribute('readonly')
})

test('Reihe: Einladungsmodus sperrt PIN und Verifizierung, Konto-Pflicht sperrt ihn; Fehler als Meldung', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const series = await createSeries(owner)
  const withAccounts = await createSeries(owner, { requireGuestUser: true })
  const legacy = await createSeries(owner, { inviteOnly: true, eventPin: '4711' })
  await login(page, owner.email)

  await page.goto(`/admin/series/${series.id}/edit`)
  await inviteOnly(page).check()
  await expect(verification(page)).toBeDisabled()
  await expect(page.locator('#eventPin')).toHaveAttribute('readonly', '')
  await expect(page.getByTestId('rule-eventPin')).toContainText('„Nur mit Einladung“')
  await save(page)
  await page.waitForURL(/gespeichert=1/)
  expect((await prisma.eventSeries.findUniqueOrThrow({ where: { id: series.id } })).inviteOnly).toBe(true)

  await page.goto(`/admin/series/${withAccounts.id}/edit`)
  await expect(inviteOnly(page)).toBeDisabled()
  await expect(page.getByTestId('rule-inviteOnly')).toContainText('Teilnehmendenkonto')

  await page.goto(`/admin/series/${legacy.id}/edit`)
  await expect(page.getByTestId('rule-eventPin')).toContainText('Geht nicht zusammen')
  await save(page)
  await expect(page.getByTestId('settings-error')).toContainText('Einladungsmodus: nicht zusammen mit PIN')
  await page.locator('#eventPin').fill('')
  await save(page)
  await page.waitForURL(/gespeichert=1/)
  expect((await prisma.eventSeries.findUniqueOrThrow({ where: { id: legacy.id } })).eventPin).toBeNull()
})
