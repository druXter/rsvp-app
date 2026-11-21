// app/lib/proven-email.ts

/**
 * Die Adresse, für die rsvp-app gegenüber einem anderen Tool einstehen kann (docs/AUDIT-2026-11.md, R-02; Seating
 * S-09 b): die eines bestätigten Kontos, mit dem die Person verknüpft ist, sonst die am Participant, wenn die Person
 * sie selbst bestätigt hat - sonst keine. Eine unbestätigte Adresse kann irgendwer eingetippt haben; ein Tool, das an
 * sie schreibt oder über sie Daten zuordnet, gäbe einer fremden Adresse sonst Post von unserem Absender oder Zugriff.
 * Rein (ohne Datenbank) - das Konto lädt, wer aufruft.
 */
export function provenAddress(
  participant: { email: string | null; isVerified: boolean },
  account?: { email: string; isVerified: boolean } | null
): string | null {
  if (account?.isVerified) return account.email
  return participant.isVerified ? participant.email : null
}
