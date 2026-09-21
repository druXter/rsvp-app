// app/mein-konto/actions.ts
'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { PrismaClient } from '@prisma/client'
import { sanitizeNextPath } from 'suite-kit'
import { sendGuestVerificationEmail, sendGuestPasswordResetEmail, sendGuestEmailChangeConfirmation } from '../lib/mail'
import { requireGuestUser, createGuestSession, destroyGuestSession, GUEST_SESSION_COOKIE } from '../lib/guest-auth'
import { generateToken, hashToken } from '../lib/tokens'
import { hashPassword, validatePassword, verifyAgainstDummy, verifyPassword } from '../lib/password'
import { formPassword } from '../lib/form'
import { hasEventPinAccess, hasSeriesPinAccess } from '../lib/pin'
import { clearFailures, clientIp, loginRules, passwordChangeRule, refund, registerRules, reserve, resetRules } from '../lib/throttle'
import { generateApiToken, hashApiToken, NEW_API_TOKEN_COOKIE } from '../lib/api-auth'

const prisma = new PrismaClient()

/**
 * `next` kommt aus einem Formularfeld/Query-Parameter, den ein Angreifer frei befüllen
 * könnte - lässt nur einen internen, mit genau einem "/" beginnenden Pfad durch (kein
 * "//evil.com" oder "https://evil.com"), damit loginGuestUser damit niemals auf eine externe
 * Seite weiterleitet (Open-Redirect).
 */
function safeNextPath(next: string | null): string | null {
  const path = sanitizeNextPath(next, '')
  return path || null
}

/**
 * Selbstregistrierung eines Gastes - entweder für eine bestimmte Reihe (Formular auf
 * /reihe/[seriesSlug]/registrieren, hinter derselben Reihen-PIN wie der Rest der Reihe) oder
 * für ein einzelnes Event mit requireGuestUser (Formular auf /[slug]/registrieren, hinter
 * derselben Event-PIN). Nur bei einer Reihe entsteht sofort eine Mitgliedschaft
 * (GuestUserSeries) - ein Einzel-Event kennt dieses Konzept nicht, dort verknüpft sich das
 * Konto erst über performRsvpSubmission mit einem Participant, sobald tatsächlich geantwortet
 * wird. Weitere Reihen kommen entweder über addGuestUserToSeries (Creator/Moderator) oder
 * automatisch beim ersten Beantworten eines Termins einer anderen Reihe über die
 * Gast-Session hinzu (siehe submitRsvp). `next` (optional, aus dem Registrierungs-Formular)
 * ist der Pfad des Termins, von dem aus registriert wurde - wird an die
 * Verifizierungs-Mail und die Weiterleitungen durchgereicht, damit der Gast nach dem
 * Bestätigen/Einloggen direkt dort landet, statt auf dem allgemeinen Dashboard.
 */
export async function registerGuestUser(formData: FormData) {
  const seriesId = formData.get('seriesId') as string || null
  const eventId = formData.get('eventId') as string || null
  const next = safeNextPath(formData.get('next') as string || null)
  const nextParam = next ? `&next=${encodeURIComponent(next)}` : ''
  const name = (formData.get('name') as string || '').trim()
  const email = (formData.get('email') as string || '').trim().toLowerCase()
  const password = formPassword(formData, 'password')

  const series = seriesId ? await prisma.eventSeries.findUnique({ where: { id: seriesId } }) : null
  const event = eventId ? await prisma.event.findUnique({ where: { id: eventId }, include: { series: true } }) : null
  if (!series && !event) return

  const contextTitle = series ? series.title : event!.title
  const registerPath = series ? `/reihe/${series.slug}/registrieren` : `/${event!.slug}/registrieren`

  // Bei PIN-geschützter Reihe/Event nur MIT PIN-Freischaltung: Sonst wäre die Registrierung ein Weg an der
  // PIN vorbei - die Mitgliedschaft in der Reihe erlaubt später sogar Antworten über die Client-API.
  if (!(series ? await hasSeriesPinAccess(series) : await hasEventPinAccess(event!))) {
    redirect(`${registerPath}?error=pin${nextParam}`)
  }

  // Die Registrierung ist öffentlich und löst eine Mail an eine beliebige Adresse aus - jede Anfrage
  // zählt, damit niemand über dieses Formular fremde Postfächer mit Bestätigungs-Mails flutet.
  if (!(await reserve(registerRules(await clientIp(), email)))) {
    redirect(`${registerPath}?error=throttled${nextParam}`)
  }
  if (validatePassword(password, email)) {
    redirect(`${registerPath}?error=weak${nextParam}`)
  }

  const existing = await prisma.guestUser.findUnique({ where: { email } })
  if (existing) {
    redirect(`${registerPath}?error=exists${nextParam}`)
  }

  // Der Bestätigungs-Token steht nur im Mail-Link, in der Datenbank nur sein Hash (app/lib/tokens.ts).
  const verifyToken = generateToken()
  const guestUser = await prisma.guestUser.create({
    data: { email, passwordHash: await hashPassword(password), name, verifyToken: hashToken(verifyToken), isVerified: false }
  })
  if (series) {
    await prisma.guestUserSeries.create({ data: { guestUserId: guestUser.id, seriesId: series.id } })
  }

  try {
    await sendGuestVerificationEmail(guestUser, contextTitle, next, verifyToken)
  } catch (error) {
    console.error('Fehler beim Senden der Nutzer-Verifizierungs-Mail:', error)
  }

  redirect(`/mein-konto/login?registered=1${nextParam}`)
}

/**
 * Prüft E-Mail/Passwort und erstellt bei Erfolg eine Gast-Session. Ein unverifiziertes
 * Konto (Klick auf den Bestätigungslink steht noch aus) darf sich bewusst noch nicht
 * einloggen, damit E-Mail-Adressen vor dem ersten Login als real bestätigt gelten.
 */
export async function loginGuestUser(formData: FormData) {
  const email = (formData.get('email') as string || '').trim().toLowerCase()
  const password = formPassword(formData, 'password')
  // Pfad eines Termins, von dem aus zum Login verlinkt wurde (siehe GuestRequiredGate) -
  // nach erfolgreichem Login geht es dorthin statt zum allgemeinen /mein-konto-Dashboard,
  // damit ein Gast, der wegen requireGuestUser zum Login geschickt wurde, direkt wieder bei
  // seinem Termin landet (das Dashboard listet Einzel-Events ohnehin nicht auf).
  const next = safeNextPath(formData.get('next') as string || null)
  const nextParam = next ? `&next=${encodeURIComponent(next)}` : ''

  // Drosselung nach IP UND E-Mail, der Versuch wird VOR der Prüfung atomar reserviert (siehe
  // app/lib/throttle.ts und loginUser in app/admin/actions.ts für die Begründung).
  const rules = loginRules(await clientIp(), email, 'guest-login')
  if (!(await reserve([rules.ip, rules.email]))) {
    redirect(`/mein-konto/login?error=locked${nextParam}`)
  }

  const guestUser = email ? await prisma.guestUser.findUnique({ where: { email } }) : null
  let passwordOk = false
  if (guestUser) {
    const check = await verifyPassword(password, guestUser.passwordHash)
    passwordOk = check.ok
    if (check.ok && check.needsRehash) {
      await prisma.guestUser.update({ where: { id: guestUser.id }, data: { passwordHash: await hashPassword(password) } })
    }
  } else {
    // Gleich teure Prüfung wie bei bekannter Adresse, damit die Antwortzeit nichts verrät.
    await verifyAgainstDummy(password)
  }

  if (!guestUser || !passwordOk) {
    redirect(`/mein-konto/login?error=1${nextParam}`)
  }
  if (!guestUser.isVerified) {
    redirect(`/mein-konto/login?error=unverified${nextParam}`)
  }

  await refund(rules.ip)
  await clearFailures([rules.email])
  await createGuestSession(guestUser.id) // neue Session, lastLoginAt aktuell (siehe app/lib/guest-auth.ts)
  redirect(next || '/mein-konto')
}

export async function logoutGuestUser() {
  await destroyGuestSession()
  redirect('/mein-konto/login')
}

const RESET_TOKEN_DURATION_MS = 1000 * 60 * 60 // 1 Stunde

/**
 * Fordert einen Passwort-Reset per E-Mail für ein Nutzer-Konto an. Zeigt IMMER dieselbe
 * neutrale Bestätigung (Weiterleitung zu ?sent=1) - unabhängig davon, ob die E-Mail
 * überhaupt zu einem Konto gehört, damit die Kontoexistenz nicht über das
 * Antwortverhalten verraten wird (gleiches Muster wie requestPasswordReset für
 * Admin-Konten in app/admin/actions.ts - hier gibt es aber keine Rolle, die
 * ausgeschlossen wird, jedes Nutzer-Konto darf sein Passwort selbst zurücksetzen).
 */
export async function requestGuestPasswordReset(formData: FormData) {
  const email = (formData.get('email') as string || '').trim().toLowerCase()
  // Jede Anfrage zählt (auch für unbekannte Adressen): keine Mail-Flut gegen fremde Postfächer und
  // kein Erraten von Konten über die Drosselung.
  if (email && (await reserve(resetRules(await clientIp(), email, 'guest-reset')))) {
    const guestUser = await prisma.guestUser.findUnique({ where: { email } })

    if (guestUser) {
      const resetToken = generateToken()
      const updated = await prisma.guestUser.update({
        where: { id: guestUser.id },
        data: { resetToken: hashToken(resetToken), resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_DURATION_MS) }
      })
      // Nicht abwarten: Sonst wäre die Antwort bei existierender Adresse merklich langsamer.
      sendGuestPasswordResetEmail(updated, resetToken).catch(error => console.error('Fehler beim Senden der Nutzer-Passwort-Reset-Mail:', error))
    }
  }

  redirect('/mein-konto/forgot-password?sent=1')
}

/**
 * Setzt anhand eines gültigen, nicht abgelaufenen Reset-Tokens ein neues Passwort für ein
 * Nutzer-Konto. Invalidiert dabei alle bestehenden Gast-Sessions des Kontos und macht den
 * Token unbrauchbar. Markiert das Konto nebenbei als verifiziert, falls es das noch nicht
 * war - wer einen nur per Mail zustellbaren Reset-Link anklicken konnte, hat die
 * E-Mail-Adresse damit genauso bewiesen wie über den separaten Verifizierungslink.
 */
export async function resetGuestPassword(formData: FormData) {
  const token = formData.get('token') as string
  const password = formPassword(formData, 'password')

  const guestUser = token ? await prisma.guestUser.findUnique({ where: { resetToken: hashToken(token) } }) : null
  if (!guestUser || !guestUser.resetTokenExpiresAt || guestUser.resetTokenExpiresAt < new Date()) {
    redirect('/mein-konto/reset-password?error=invalid')
  }

  if (validatePassword(password, guestUser.email)) {
    redirect(`/mein-konto/reset-password?token=${encodeURIComponent(token)}&error=weak`)
  }

  await prisma.guestUser.update({
    where: { id: guestUser.id },
    data: {
      passwordHash: await hashPassword(password),
      resetToken: null,
      resetTokenExpiresAt: null,
      ...(guestUser.isVerified ? {} : { isVerified: true, verifiedAt: new Date(), verifyToken: null })
    }
  })
  await prisma.guestSession.deleteMany({ where: { guestUserId: guestUser.id } })

  redirect('/mein-konto/login?reset=1')
}

/**
 * Ändert das Passwort eines bereits eingeloggten Nutzer-Kontos - erfordert das aktuelle
 * Passwort statt eines Mail-Links (gleiches Prinzip wie changePassword für Admin-Konten
 * in app/admin/actions.ts). Invalidiert alle ANDEREN Gast-Sessions dieses Kontos, meldet
 * die aktuelle Sitzung aber nicht ab.
 */
export async function changeGuestPassword(formData: FormData) {
  const guestUser = await requireGuestUser()

  const currentPassword = formPassword(formData, 'currentPassword')
  const newPassword = formPassword(formData, 'newPassword')

  // Die Abfrage des aktuellen Passworts ist gedrosselt (Schutz gegen eine gekaperte Sitzung).
  const rule = passwordChangeRule(`guest:${guestUser.id}`)
  if (!(await reserve([rule]))) redirect('/mein-konto/account?error=locked')

  const check = await verifyPassword(currentPassword, guestUser.passwordHash)
  if (!check.ok) {
    redirect('/mein-konto/account?error=wrongpassword')
  }
  if (validatePassword(newPassword, guestUser.email)) {
    redirect('/mein-konto/account?error=weak')
  }

  await prisma.guestUser.update({ where: { id: guestUser.id }, data: { passwordHash: await hashPassword(newPassword) } })

  const cookieStore = await cookies()
  const currentToken = cookieStore.get(GUEST_SESSION_COOKIE)?.value
  await prisma.guestSession.deleteMany({
    where: { guestUserId: guestUser.id, ...(currentToken ? { token: { not: hashToken(currentToken) } } : {}) }
  })
  await clearFailures([rule])

  redirect('/mein-konto/account?passwordChanged=1')
}

/**
 * Fordert eine E-Mail-Änderung für ein Nutzer-Konto an - erfordert das aktuelle Passwort.
 * Die neue Adresse wird erst nach Klick auf den an SIE verschickten Bestätigungslink
 * wirksam (siehe /mein-konto/confirm-email), gleiches Prinzip wie requestEmailChange für
 * Admin-Konten.
 */
export async function requestGuestEmailChange(formData: FormData) {
  const guestUser = await requireGuestUser()

  const currentPassword = formPassword(formData, 'currentPassword')
  const newEmail = (formData.get('newEmail') as string || '').trim().toLowerCase()

  const rule = passwordChangeRule(`guest:${guestUser.id}`)
  if (!(await reserve([rule]))) redirect('/mein-konto/account?error=locked')

  const check = await verifyPassword(currentPassword, guestUser.passwordHash)
  if (!check.ok) {
    redirect('/mein-konto/account?error=wrongpassword')
  }
  await clearFailures([rule])

  if (newEmail === guestUser.email) return
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) redirect('/mein-konto/account?error=invalidemail')

  const existing = await prisma.guestUser.findUnique({ where: { email: newEmail } })
  if (existing) {
    redirect('/mein-konto/account?error=emailtaken')
  }

  const emailChangeToken = generateToken()
  const updated = await prisma.guestUser.update({
    where: { id: guestUser.id },
    data: {
      pendingEmail: newEmail,
      emailChangeToken: hashToken(emailChangeToken),
      emailChangeTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_DURATION_MS)
    }
  })

  try {
    await sendGuestEmailChangeConfirmation(updated, emailChangeToken)
  } catch (error) {
    console.error('Fehler beim Senden der Nutzer-E-Mail-Änderungs-Bestätigung:', error)
  }

  redirect('/mein-konto/account?emailChangeRequested=1')
}

/**
 * Bricht eine noch nicht bestätigte E-Mail-Änderung wieder ab.
 */
export async function cancelGuestEmailChange() {
  const guestUser = await requireGuestUser()
  await prisma.guestUser.update({
    where: { id: guestUser.id },
    data: { pendingEmail: null, emailChangeToken: null, emailChangeTokenExpiresAt: null }
  })
  redirect('/mein-konto/account')
}

/**
 * Aktualisiert das zentrale Profil und spiegelt die Änderung sofort auf alle
 * Participant-Zeilen dieses Nutzer-Kontos über alle Reihen hinweg zurück - das ist der
 * Kern von "einmal ändern, überall aktuell" (siehe Architekturentscheidung zu #12).
 */
export async function updateGuestProfile(formData: FormData) {
  const guestUser = await requireGuestUser()

  const name = (formData.get('name') as string || '').trim()
  const phone = (formData.get('phone') as string || '').trim() || null
  const dietaryOption = (formData.get('dietaryOption') as string || '') || null
  const allergies = (formData.get('allergies') as string || '').trim() || null

  if (!name) return

  await prisma.guestUser.update({ where: { id: guestUser.id }, data: { name, phone, dietaryOption, allergies } })
  await prisma.participant.updateMany({ where: { guestUserId: guestUser.id }, data: { name, phone, dietaryOption, allergies } })

  revalidatePath('/mein-konto')
}

/**
 * Setzt die Präferenz, Bestätigungs-Mails (sendConfirmationEmail) zugunsten einer
 * Push-Benachrichtigung (sendConfirmationPush, siehe app/lib/push.ts und
 * shouldSuppressConfirmationEmail in app/actions.ts) zu unterdrücken. Das Aktivieren wird
 * serverseitig abgelehnt, solange keine der eigenen Participant-Zeilen (über alle Reihen
 * hinweg) eine aktive ParticipantPushSubscription hat - sonst bekäme der Gast beim nächsten
 * Zusagen gar keine Benachrichtigung mehr. Das Deaktivieren ist immer erlaubt.
 */
export async function updateConfirmationEmailPreference(formData: FormData) {
  const guestUser = await requireGuestUser()
  const disable = formData.get('disableConfirmationEmails') === 'true'

  if (disable) {
    const hasPushSubscription = await prisma.participantPushSubscription.findFirst({
      where: { participant: { guestUserId: guestUser.id } }
    })
    if (!hasPushSubscription) {
      redirect('/mein-konto/account?error=nopush')
    }
  }

  await prisma.guestUser.update({ where: { id: guestUser.id }, data: { disableConfirmationEmails: disable } })
  redirect('/mein-konto/account?confirmationPrefSaved=1')
}

/**
 * Erzeugt einen API-Token für einen selbstgebauten Client (z.B. eine WatchOS-App, siehe
 * app/api/v1/). Gespeichert wird nur der Hash - der Klartext wird dem Nutzenden genau
 * einmal angezeigt und dafür kurz in einem httpOnly-Cookie zwischengelagert, statt ihn an
 * die URL zu hängen, wo er in der Browser-History und in Server-Logs stehen bliebe. Das
 * Cookie läuft nach einer Minute von selbst ab, weil eine Server Component es nach dem
 * Anzeigen nicht selbst löschen kann.
 */
export async function createApiToken(formData: FormData) {
  const guestUser = await requireGuestUser()
  const name = (formData.get('name') as string || '').trim() || 'Unbenanntes Gerät'

  const token = generateApiToken()
  await prisma.guestApiToken.create({
    data: { name, tokenHash: hashApiToken(token), guestUserId: guestUser.id }
  })

  const cookieStore = await cookies()
  cookieStore.set(NEW_API_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60,
    path: '/mein-konto',
  })

  redirect('/mein-konto/account?tokenCreated=1')
}

/**
 * Widerruft einen API-Token endgültig. Die Löschung ist auf die eigenen Token beschränkt,
 * damit eine fremde Token-ID nicht das Gerät einer anderen Person abmelden kann.
 */
export async function revokeApiToken(formData: FormData) {
  const guestUser = await requireGuestUser()
  const tokenId = formData.get('tokenId') as string
  if (!tokenId) return

  await prisma.guestApiToken.deleteMany({ where: { id: tokenId, guestUserId: guestUser.id } })

  redirect('/mein-konto/account?tokenRevoked=1')
}

/**
 * Löscht das gesamte Nutzer-Konto unwiderruflich - Recht auf Löschung (Art. 17 DSGVO).
 * Anders als deleteMyParticipantData in app/actions.ts (löscht nur die Identität EINER
 * Reihe über den anonymen editToken-Link) betrifft dies das zentrale Konto und damit
 * ALLE Reihen, denen der Nutzer jemals zugeordnet war.
 */
export async function deleteGuestAccount() {
  const guestUser = await requireGuestUser()

  await prisma.rsvp.deleteMany({ where: { participant: { guestUserId: guestUser.id } } })
  await prisma.participantPushSubscription.deleteMany({ where: { participant: { guestUserId: guestUser.id } } })
  await prisma.participant.deleteMany({ where: { guestUserId: guestUser.id } })
  await prisma.guestUserSeries.deleteMany({ where: { guestUserId: guestUser.id } })
  await prisma.guestSession.deleteMany({ where: { guestUserId: guestUser.id } })
  await prisma.guestApiToken.deleteMany({ where: { guestUserId: guestUser.id } })
  await prisma.guestUser.delete({ where: { id: guestUser.id } })

  const cookieStore = await cookies()
  cookieStore.set(GUEST_SESSION_COOKIE, '', { maxAge: 0, path: '/' })

  redirect('/mein-konto/login')
}
