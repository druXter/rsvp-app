// app/[slug]/invitation-gate.tsx

/**
 * Statt des Formulars bei einem Termin im Einladungsmodus (Event.inviteOnly), wenn der Link keine Einladung zu
 * diesem Termin trägt (docs/KONZEPT-EINLADUNGEN.md, Abschnitt 3). Zeigt nur den Titel - keine Beschreibung, keinen
 * Ort, keine Gästeliste.
 */
export default function InvitationGate({ title }: { title: string }) {
  return (
    <div className="min-h-[50vh] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-md max-w-md w-full border border-gray-100 dark:border-gray-700 text-center space-y-4">
        <span className="text-4xl block">💌</span>
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">{title}</h2>
        <p className="text-gray-500 dark:text-gray-400 text-sm" data-testid="invitation-gate">
          Nur mit persönlicher Einladung. Bitte öffne den Link aus deiner Einladung (Mail oder QR-Code auf der Karte).
        </p>
      </div>
    </div>
  )
}
