// app/ui/auth-error.tsx

const MESSAGES: Record<string, string> = {
  locked: 'Zu viele Versuche. Bitte warte etwa 15 Minuten und versuche es dann erneut.',
  throttled: 'Zu viele Anfragen von dieser Adresse. Bitte versuche es in einer Stunde erneut.',
  pin: 'Für diese Veranstaltung ist ein Zugangscode nötig. Öffne die Veranstaltungsseite und gib ihn dort zuerst ein.',
  weak: 'Das Passwort ist zu schwach: mindestens 10 Zeichen, nicht zu naheliegend und nicht deine E-Mail-Adresse.',
  email: 'Bitte gib eine gültige E-Mail-Adresse ein.',
  invalidemail: 'Bitte gib eine gültige E-Mail-Adresse ein.',
  nopassword: 'Für dieses Konto ist kein Passwort hinterlegt - die Anmeldung läuft über ein anderes Tool.',
  nochain: 'Dieses Konto wird über ein anderes Tool angemeldet und kann hier keine Anmeldung für weitere Tools bestätigen.',
  lastlogin: 'Das ist deine einzige Anmeldemöglichkeit. Lege erst ein Passwort fest, bevor du sie entfernst.',
  sso: 'Die Anmeldung über das andere Tool ist fehlgeschlagen. Bitte versuche es erneut.',
  'idp-unreachable': 'Das andere Tool ist gerade nicht erreichbar. Melde dich mit E-Mail und Passwort an oder versuche es später erneut.',
  'email-taken': 'Zu dieser E-Mail-Adresse gibt es hier bereits ein Konto. Melde dich dort mit dem Passwort an und verknüpfe das andere Konto unter "Konto-Einstellungen".',
  'not-linked': 'Dieses Konto ist hier noch nicht verknüpft. Melde dich mit E-Mail und Passwort an und verknüpfe es unter "Konto-Einstellungen".',
  'linked-other': 'Dieses Konto ist bereits mit einem anderen Konto hier verknüpft.',
  app: 'Diese Anfrage kommt von einer nicht freigegebenen Anwendung und wurde abgelehnt.',
}

/**
 * Einheitliche Fehlerbox für die Sicherheits-Fehlercodes aus den Login-/Konto-Aktionen (gesperrt,
 * zu schwaches Passwort, Verbund-Fehler). Zeigt nichts an, wenn der Code hier nicht bekannt ist -
 * die übrigen Fehler (falsches Passwort usw.) behandeln die Seiten selbst.
 */
export default function AuthError({ code }: { code?: string }) {
  const message = code ? MESSAGES[code] : undefined
  if (!message) return null
  return (
    <div role="alert" className="p-3 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 text-sm rounded">
      {message}
    </div>
  )
}
