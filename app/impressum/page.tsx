// app/impressum/page.tsx
import Link from 'next/link'

export default function ImpressumPage() {
  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-3xl mx-auto bg-white p-8 rounded-lg shadow text-gray-800 space-y-6">
        <h1 className="text-3xl font-bold border-b pb-4">Impressum</h1>
        
        <div>
          <h2 className="font-bold text-lg">Angaben gemäß § 5 TMG</h2>
          <p className="mt-2">
            [Dein Vorname] [Dein Nachname]<br />
            [Deine Straße und Hausnummer]<br />
            [PLZ] [Ort]
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">Kontakt</h2>
          <p className="mt-2">
            E-Mail: [Deine E-Mail-Adresse]<br />
            Telefon: [Deine Telefonnummer - Optional]
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