// app/page.tsx
import Link from 'next/link'

/**
 * Die allgemeine Startseite (Landingpage) der Anwendung.
 * Dient als Einstiegspunkt und leitet Administratoren zum Dashboard weiter.
 */
export default function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      
      {/* Hauptbereich (Hero Section) */}
      <main className="grow flex items-center justify-center px-4">
        <div className="max-w-2xl text-center space-y-6">
          <h1 className="text-4xl md:text-6xl font-extrabold text-gray-900 tracking-tight">
            Event-Management <br/> einfach gemacht.
          </h1>
          <p className="text-lg text-gray-600">
            Das schlanke RSVP-System für reibungslose Zusagen, Absagen und Gästelisten.
          </p>
          <div className="pt-8">
            <Link 
              href="/admin/login" 
              className="inline-block bg-blue-600 text-white font-bold py-3 px-8 rounded-lg hover:bg-blue-700 transition shadow-lg"
            >
              Zum Admin-Bereich
            </Link>
          </div>
        </div>
      </main>

      {/* Footer mit rechtlichen Pflichtlinks */}
      <footer className="bg-white border-t border-gray-200 py-6 text-center text-sm text-gray-500">
        <p>&copy; {new Date().getFullYear()} RSVP System. Alle Rechte vorbehalten.</p>
        <div className="mt-2 space-x-4">
          <Link href="/impressum" className="hover:text-gray-900 underline">Impressum</Link>
          <Link href="/datenschutz" className="hover:text-gray-900 underline">Datenschutz</Link>
        </div>
      </footer>
    </div>
  )
}