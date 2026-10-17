// app/layout.tsx
import './globals.css'
import { AppFooter } from './ui/kit'

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
      <body className="antialiased">
        {children}
        {/* Global statt pro Seite verlinkt, damit Impressum/Datenschutz von JEDER Seite aus
            erreichbar sind (auch von direkt aufgerufenen Gast-Formularen, die die
            Startseite nie durchlaufen) - Art. 13 DSGVO verlangt die Information am Ort der
            Datenerhebung, nicht nur auf einer separaten Landingpage. */}
        <AppFooter />
      </body>
    </html>
  )
}