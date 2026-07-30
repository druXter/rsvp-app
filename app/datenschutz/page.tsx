// app/datenschutz/page.tsx

import Link from 'next/link'

export default function DatenschutzPage() {
  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-3xl mx-auto bg-white p-8 rounded-lg shadow text-gray-800 space-y-6">
        <h1 className="text-3xl font-bold border-b pb-4">Datenschutzerklärung</h1>
        
        <div>
          <p>
            Wir nehmen den Schutz Ihrer persönlichen Daten ernst. Diese Datenschutzerklärung informiert Sie darüber, wie wir Ihre Daten erheben, verwenden und schützen.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">Erhebung und Verarbeitung von Daten</h2>
          <p className="mt-2">
            Wir erheben nur die Daten, die für die Durchführung unserer Veranstaltungen und die Verwaltung von RSVPs erforderlich sind. Dazu gehören Name, E-Mail-Adresse, Telefonnummer und eventuelle Begleitpersonen.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">Verwendung von Daten</h2>
          <p className="mt-2">
            Die erhobenen Daten werden ausschließlich für die Organisation und Durchführung der Veranstaltungen verwendet. Wir geben Ihre Daten nicht an Dritte weiter.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">Ihre Rechte</h2>
          <p className="mt-2">
            Sie haben das Recht, Auskunft über die von uns gespeicherten Daten zu erhalten, sowie das Recht auf Berichtigung, Löschung oder Einschränkung der Verarbeitung Ihrer Daten. Bitte kontaktieren Sie uns, wenn Sie eines dieser Rechte ausüben möchten.
          </p>
        </div>

        <div className="pt-6 border-t">
          <Link href="/" className="text-blue-600 hover:underline">
            &larr; Zurück zur Startseite
          </Link>
        </div>
      </div>
    </main>
  )
}