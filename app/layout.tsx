// app/layout.tsx
import './globals.css'
import { Inter } from 'next/font/google'
import Link from 'next/link'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'RSVP App',
  description: 'Gästeliste & Event-Management',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="de">
      {/* antialiased macht die Schrift weicher und leserlicher */}
      <body className={`${inter.className} bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 antialiased`}>
        {children}
        {/* Global statt pro Seite verlinkt, damit Impressum/Datenschutz von JEDER Seite aus
            erreichbar sind (auch von direkt aufgerufenen Gast-Formularen, die die
            Startseite nie durchlaufen) - Art. 13 DSGVO verlangt die Information am Ort der
            Datenerhebung, nicht nur auf einer separaten Landingpage. */}
        <footer className="border-t border-gray-200 dark:border-gray-800 py-4 text-center text-xs text-gray-400 dark:text-gray-500">
          <Link href="/impressum" className="hover:text-gray-600 dark:hover:text-gray-300 underline">Impressum</Link>
          {' · '}
          <Link href="/datenschutz" className="hover:text-gray-600 dark:hover:text-gray-300 underline">Datenschutz</Link>
        </footer>
      </body>
    </html>
  )
}