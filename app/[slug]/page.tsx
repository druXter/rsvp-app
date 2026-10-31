import { DATE_PENDING_TEXT } from '../lib/event-date'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { notFound, redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import RsvpForm from './rsvp-form'
import PinForm from './pin-form'
import GuestRequiredGate from './guest-required-gate'
import InvitationGate from './invitation-gate'
import { householdForForm, invitationOf } from '../lib/invitation-store'
import PollResultBanner from '../ui/poll-result-banner'
import PhotoLinkBanner from '../ui/photo-link-banner'
import { photoLinkVisible } from '../lib/photo-link'
import FeedbackBanner from '../ui/feedback-banner'
import { assemblyLinkVisible } from '../lib/assembly'
import AssemblyBanner from '../ui/assembly-banner'
import { feedbackLinkVisible } from '../lib/feedback-link'
import { bringSlotsForForm, claimedLabels } from '../lib/bring-list'
import { getCurrentGuestUser } from '../lib/guest-auth'
import { invitedGuestUser } from '../lib/guest-invites'
import { findAccountParticipant } from '../lib/account-participant'
import { guestPersons } from '../lib/guest-persons'
import { guestTicketing } from '../lib/guest-ticketing'
import { TOOL_LINKS } from '../lib/linked-tools-store'
import { isTimelineConfirmed, timelineLinkOf } from '../lib/timeline'
import { wichtelnLinkOf } from '../lib/wichteln'
import { maybeForForm } from '../lib/maybe'
import { deadlinePassed, formatDeadline } from '../lib/rsvp-deadline'
import EventHeader from '../ui/event-header'
import WishList from '../ui/wish-list'
import { wishesForGuest } from '../lib/wishlist-store'
import { reconfirmForGuest } from '../lib/reconfirm'
import { isConfirmedRsvp } from '../lib/linked-tools'
import ReconfirmBox from '../ui/reconfirm-box'


type PublicRsvp = Prisma.RsvpGetPayload<{
  select: {
    id: true
    isAttending: true
    isMaybe: true
    isOnWaitlist: true
    persons: { select: { position: true, name: true, ageGroup: true, isAttending: true, isMaybe: true } }
    bringingItem: true
    declineReason: true
    createdAt: true
    participant: { select: { name: true } }
    bringClaims: { select: { slot: { select: { label: true, position: true } } } }
  }
}>

export default async function EventPage({
  params,
  searchParams
}: {
  params: Promise<{ slug: string }>,
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  // FIX: In Next.js 15+ müssen params und searchParams asynchron aufgelöst werden!
  const { slug } = await params;
  const currentSearchParams = await searchParams;

  const event = await prisma.event.findUnique({
    where: { slug: slug },
    include: { series: true, toolLinks: TOOL_LINKS }
  })

  if (!event) notFound()

  // Termine einer Reihe werden ausschließlich über die Reihen-Route bedient,
  // damit reihenweite PIN/Gästeliste/Profil-Einstellungen konsistent greifen.
  if (event.series) {
    const token = typeof currentSearchParams?.token === 'string' ? `?token=${currentSearchParams.token}` : ''
    redirect(`/reihe/${event.series.slug}/${event.slug}${token}`)
  }

  // 1. Zugangsprüfung (Issue #9)
  let isAuthorized = true;
  if (event.eventPin) {
    const cookieStore = await cookies()
    const pinCookie = cookieStore.get(`event_pin_${event.id}`)

    // Eingeladene Teilnehmendenkonten (app/lib/guest-invites.ts) brauchen keine PIN
    if (pinCookie?.value !== event.eventPin && !(await invitedGuestUser(event))) {
      isAuthorized = false;
    }
  }

  // Wenn nicht berechtigt, zeige nur das PIN-Formular
  if (!isAuthorized) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <PinForm eventId={event.id} slug={event.slug} title={event.title} />
      </main>
    )
  }

  // 2. Token aus der URL auslesen und bestehenden Participant + dessen Antwort zu diesem Termin laden
  const token = typeof currentSearchParams?.token === 'string' ? currentSearchParams.token : undefined
  let participant = null
  let existingRsvp = null

  if (token) {
    participant = await prisma.participant.findUnique({ where: { editToken: token } })
    if (participant) {
      existingRsvp = await prisma.rsvp.findUnique({
        where: { eventId_participantId: { eventId: event.id, participantId: participant.id } }
      })
    }
  } else if (!event.inviteOnly) {
    // Wer angemeldet ist, antwortet immer mit seinem Konto (performRsvpSubmission) - im Einladungsmodus zählt nur der
    // persönliche Link. "Nur registrierte Teilnehmer": ohne editToken MUSS eine eingeloggte Gast-Session vorliegen,
    // sonst wird statt des Formulars nur das Login/Registrieren-Gate gezeigt (serverseitig ebenso abgesichert).
    const guestUser = await getCurrentGuestUser()
    if (!guestUser && event.requireGuestUser) {
      const nextPath = `/${event.slug}`
      return (
        <main className="min-h-screen bg-gray-50 dark:bg-gray-900">
          <GuestRequiredGate
            title={event.title}
            loginHref={`/mein-konto/login?next=${encodeURIComponent(nextPath)}`}
            registerHref={`/${event.slug}/registrieren?next=${encodeURIComponent(nextPath)}`}
          />
        </main>
      )
    }

    // Nicht angemeldet (ohne Konto-Pflicht): anonymes Formular wie bisher
    const guestParticipant = guestUser ? await findAccountParticipant(guestUser, event) : null
    if (guestParticipant) {
      participant = guestParticipant
      existingRsvp = await prisma.rsvp.findUnique({
        where: { eventId_participantId: { eventId: event.id, participantId: guestParticipant.id } }
      })
    } else if (guestUser) {
      // Erste Antwort dieses Kontos zu diesem Event - Formular aus dem zentralen Profil vorausfüllen
      participant = {
        name: guestUser.name,
        email: guestUser.email,
        phone: guestUser.phone,
        dietaryOption: guestUser.dietaryOption,
        allergies: guestUser.allergies,
        isVerified: guestUser.isVerified,
        editToken: undefined
      }
    }
  }

  // Einladungsmodus (docs/KONZEPT-EINLADUNGEN.md): nur mit dem Link einer Einladung zu diesem Termin
  let household = null
  if (event.inviteOnly) {
    const invitation = token && participant && 'id' in participant ? await invitationOf(participant.id, event) : null
    if (!invitation) {
      return (
        <main className="min-h-screen bg-gray-50 dark:bg-gray-900">
          <InvitationGate title={event.title} />
        </main>
      )
    }
    household = { label: invitation.label, rows: await householdForForm(invitation, existingRsvp?.id ?? null), extraPersons: invitation.extraPersons }
  }

  // Rückbestätigung (app/lib/reconfirm.ts): nur mit persönlichem Participant (Link oder Konto) und Antwort zu diesem Termin
  const reconfirmBox = participant && 'id' in participant && existingRsvp
    ? reconfirmForGuest(event, existingRsvp, isConfirmedRsvp(existingRsvp, participant, event.requireVerification))
    : null
  const reconfirm = reconfirmBox && participant?.editToken ? { box: reconfirmBox, editToken: participant.editToken } : null

  const wishes = event.wishlist ? await wishesForGuest(event.id, participant && 'id' in participant ? participant.id : null) : []

  // 3. Gästeliste laden (Issue #8) - EXTREM WICHTIG: Nur ungefährliche Felder abfragen!
  let publicRsvps: PublicRsvp[] = [];
  if (event.isGuestListVisible) {
    publicRsvps = await prisma.rsvp.findMany({
      where: { eventId: event.id },
      select: {
        id: true,
        isAttending: true,
        isMaybe: true,
        isOnWaitlist: true,
        persons: { select: { position: true, name: true, ageGroup: true, isAttending: true, isMaybe: true }, orderBy: { position: 'asc' } },
        bringingItem: true,
        declineReason: true,
        createdAt: true,
        participant: { select: { name: true } },
        bringClaims: { select: { slot: { select: { label: true, position: true } } } }
        // E-MAIL, HANDYNUMMER, ALLERGIEN SIND HIER ABSICHTLICH NICHT DABEI!
      },
      orderBy: { createdAt: 'asc' }
    })
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900 py-10">
      <div className="max-w-3xl mx-auto px-4">

        <EventHeader event={event} />

        <PollResultBanner pollResult={event.pollResult} />

        {event.datePending && (
          <p className="mb-4 text-center text-sm bg-cyan-50 text-cyan-800 border border-cyan-200 rounded-lg py-2 px-4 dark:bg-cyan-950 dark:text-cyan-300 dark:border-cyan-800">
            📅 {DATE_PENDING_TEXT} - sobald es feststeht, übernimmt dieses Event den Termin. Wer zugesagt hat, wird dann benachrichtigt.
          </p>
        )}

        {event.pollUrl && (
          <a
            href={`/api/poll-link/${event.id}`}
            className="block mb-4 text-center bg-cyan-50 text-cyan-800 border border-cyan-200 rounded-lg py-3 px-4 font-medium hover:bg-cyan-100 dark:bg-cyan-950 dark:text-cyan-300 dark:border-cyan-800 dark:hover:bg-cyan-900 transition"
          >
            {event.pollLabel || '🗳️ Zur Abstimmung'}
          </a>
        )}

        {photoLinkVisible(event, existingRsvp) && <PhotoLinkBanner url={event.photoUrl!} className="mb-4" />}
        {assemblyLinkVisible(event, existingRsvp, participant && 'isVerified' in participant ? { isVerified: !!participant.isVerified } : null, event.requireVerification) && <AssemblyBanner eventId={event.id} editToken={token} className="mb-4" />}
        {feedbackLinkVisible(event, existingRsvp, participant && 'isVerified' in participant ? { isVerified: !!participant.isVerified } : null, event.requireVerification) && <FeedbackBanner eventId={event.id} editToken={token} className="mb-4" />}

        {/* Rückbestätigung (Idee L30): „Kommst du noch?“ mit Knöpfen, nur für die eigene feste Zusage */}
        {reconfirm && <ReconfirmBox eventId={event.id} editToken={reconfirm.editToken} {...reconfirm.box} />}

        {/* Das eigentliche Formular */}
        <RsvpForm
          bringSlots={await bringSlotsForForm(event.id, existingRsvp?.id ?? null)}
          {...await guestPersons(event, existingRsvp)}
          deadline={event.rsvpDeadline ? { label: formatDeadline(event.rsvpDeadline)!, passed: deadlinePassed(event) } : null}
          household={household}
          {...await guestTicketing(event, existingRsvp, !!participant?.isVerified, event.requireVerification)}
          seatingLabel={existingRsvp?.seatingLabel ?? null}
          wichteln={!!wichtelnLinkOf(event)}
          maybe={maybeForForm(event, existingRsvp)}
          canOpenTimeline={!!timelineLinkOf(event) && !!existingRsvp && isTimelineConfirmed(existingRsvp, { isVerified: !!participant?.isVerified }, event.requireVerification)}
          eventId={event.id}
          formConfig={event.formConfig}
          participant={participant}
          rsvp={existingRsvp}
          isGuestListVisible={event.isGuestListVisible}
          usedUrlToken={!!token}
          vapidPublicKey={process.env.VAPID_PUBLIC_KEY || null}
        />

        {/* Wunschliste (docs/KONZEPT-WUNSCHLISTE.md): reservieren nur mit persönlichem Link nach Antwort bzw. mit Einladung */}
        {wishes.length > 0 && (
          <div className="mt-8">
            <WishList wishes={wishes} eventId={event.id} editToken={participant && 'id' in participant && (existingRsvp || household) ? participant.editToken ?? null : null} />
          </div>
        )}

        {/* Die öffentliche Gästeliste */}
        {event.isGuestListVisible && (
          <div className="mt-12 bg-white dark:bg-gray-800 p-6 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700">
            <h3 className="text-xl font-bold mb-4 text-gray-800 dark:text-gray-100">Gästeliste</h3>

            {publicRsvps.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400 italic">Noch keine Rückmeldungen vorhanden.</p>
            ) : (
              <ul className="space-y-3">
                {publicRsvps.map((guest) => (
                  <li key={guest.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded border border-gray-100 dark:border-gray-700">
                    <div>
                      <span className="font-bold text-gray-800 dark:text-gray-100">{guest.participant.name}</span>
                      {event.inviteOnly && guest.isAttending && (
                        <span className="text-gray-500 dark:text-gray-400 text-sm ml-1">({guest.persons.filter(p => p.isAttending).map(p => p.name).join(', ')})</span>
                      )}
                      {event.inviteOnly && guest.persons.some(p => p.isMaybe) && (
                        <span className="text-gray-500 dark:text-gray-400 text-sm ml-1">{guest.isAttending ? 'vielleicht auch' : ''} ({guest.persons.filter(p => p.isMaybe).map(p => p.name).join(', ')})</span>
                      )}
                      {!event.inviteOnly && guest.persons.length > 1 && guest.isAttending && (
                        <span className="text-gray-500 dark:text-gray-400 text-sm ml-1">(+ {guest.persons.slice(1).map(p => p.name || 'Begleitung').join(', ')})</span>
                      )}

                      {/* Mitbringsel anzeigen, falls Zusage */}
                      {guest.isAttending && (guest.bringingItem || guest.bringClaims.length > 0) && (
                        <div className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                          🍕 Bringt mit: {[...claimedLabels(guest), ...(guest.bringingItem ? [guest.bringingItem] : [])].join(', ')}
                        </div>
                      )}

                      {/* Absagegrund anzeigen, falls Absage */}
                      {!guest.isAttending && !guest.isMaybe && guest.declineReason && (
                        <div className="text-sm text-gray-500 dark:text-gray-400 mt-1 italic">
                          &quot;{guest.declineReason}&quot;
                        </div>
                      )}
                    </div>

                    <div className="mt-2 sm:mt-0">
                      {guest.isAttending ? (
                        guest.isOnWaitlist ? (
                          <span className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 text-xs px-2 py-1 rounded-full font-bold">Warteliste</span>
                        ) : (
                          <span className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs px-2 py-1 rounded-full font-bold">Dabei</span>
                        )
                      ) : guest.isMaybe ? (
                        <span className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-xs px-2 py-1 rounded-full font-bold">Vielleicht</span>
                      ) : (
                        <span className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 text-xs px-2 py-1 rounded-full font-bold">Abgesagt</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

      </div>
    </main>
  )
}
