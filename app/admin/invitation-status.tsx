// app/admin/invitation-status.tsx
import type { InvitationStatus } from '../lib/invitations'
import { Badge } from '../ui/kit'

// Stand einer Einladung in der Verwaltung (Einzel-Event, Reihe, Reihen-Termin): Abzeichen und Personenzeile.
const STATE_LABEL = { open: 'offen', attending: 'zugesagt', waitlist: 'Warteliste', declined: 'abgesagt' }
const STATE_TONE = { open: 'gray', attending: 'green', waitlist: 'orange', declined: 'red' } as const
const PERSON_MARK = { yes: '✓', no: '✗', open: '?' }

export function StateBadge({ state }: { state: InvitationStatus['state'] }) {
  return <Badge tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Badge>
}

/** "✓ Anna · ✗ Ben · ? Clara (Kind) · ✓ Max +" (+ = selbst eingetragen), dazu "bis zu N weitere". */
export function personsLine(status: InvitationStatus, extraPersons = 0): string {
  return status.persons.map(p => `${PERSON_MARK[p.status]} ${p.name}${p.ageGroup === 'CHILD' ? ' (Kind)' : p.ageGroup === 'INFANT' ? ' (Kleinkind)' : ''}${p.extra ? ' +' : ''}`).join(' · ')
    + (extraPersons > 0 ? ` · bis zu ${extraPersons} weitere` : '')
}

/** Summen über alle Personen: kommen (nach Altersgruppe), kommen nicht, offen. */
export function personTotals(statuses: readonly InvitationStatus[]) {
  const persons = statuses.flatMap(s => s.persons)
  const count = (filter: (p: (typeof persons)[number]) => boolean) => persons.filter(filter).length
  return {
    yes: count(p => p.status === 'yes'),
    adults: count(p => p.status === 'yes' && p.ageGroup === 'ADULT'),
    children: count(p => p.status === 'yes' && p.ageGroup === 'CHILD'),
    infants: count(p => p.status === 'yes' && p.ageGroup === 'INFANT'),
    no: count(p => p.status === 'no'),
    open: count(p => p.status === 'open')
  }
}
