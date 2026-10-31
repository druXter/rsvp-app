// app/admin/account-invites-panel.tsx
import type { User } from '@prisma/client'
import { canInviteAccounts, inviteCandidates, invitedAccounts } from '../lib/guest-invites'
import { inviteAccountsToEvent, removeAccountInvite } from './account-invite-actions'
import AccountInvitePicker from './account-invite-picker'
import { Badge, Card, Notice, SubmitButton, hintClass, sectionTitleClass } from '../ui/kit'

/**
 * Reiter „Gäste“, unten: zu diesem Termin eingeladene Teilnehmendenkonten (app/lib/guest-invites.ts) und die Auswahl
 * weiterer Konten aus Events und Reihen, auf die das eigene Konto Zugriff hat. Nicht im Einladungsmodus.
 */
export default async function AccountInvitesPanel({ event, user, invitedCount }: {
  event: { id: string; seriesId: string | null; inviteOnly: boolean }; user: User; invitedCount?: number
}) {
  if (!canInviteAccounts(event)) return null
  const [invited, candidates] = await Promise.all([invitedAccounts(event.id), inviteCandidates(user, event)])

  return (
    <Card className="space-y-4">
      <div id="konten">
        <h2 className={sectionTitleClass}>Eingeladene Teilnehmendenkonten</h2>
        <p className={hintClass}>
          Eingeladene Konten sehen den Termin unter „Mein Konto“ wie einen Termin ihrer Reihe, antworten mit ihrem Konto
          und brauchen keine PIN.
        </p>
      </div>
      {invitedCount !== undefined && (
        <Notice tone="success" role="status">{invitedCount === 1 ? '1 Konto eingeladen.' : `${invitedCount} Konten eingeladen.`}</Notice>
      )}
      {invited.length > 0 && (
        <ul className="space-y-1" data-testid="invited-accounts">
          {invited.map(i => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-200 px-3 py-1.5 text-sm dark:border-gray-700">
              <span>
                {i.guestUser.name} <span className="text-gray-500 dark:text-gray-400">{i.guestUser.email}</span>
                {i.hiddenAt && <> <Badge tone="gray">ausgeblendet</Badge></>}
              </span>
              <form action={removeAccountInvite}>
                <input type="hidden" name="inviteId" value={i.id} />
                <button type="submit" className="text-xs font-medium text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300" aria-label={`Einladung von ${i.guestUser.name} zurücknehmen`}>Zurücknehmen</button>
              </form>
            </li>
          ))}
        </ul>
      )}
      {candidates.length > 0 ? (
        <form action={inviteAccountsToEvent} className="space-y-3">
          <input type="hidden" name="eventId" value={event.id} />
          <AccountInvitePicker candidates={candidates} />
          <SubmitButton inline>Einladen</SubmitButton>
        </form>
      ) : (
        <p className={hintClass}>Weitere Konten gibt es in deinen Events und Reihen gerade nicht.</p>
      )}
    </Card>
  )
}
