// app/layout.tsx
import './globals.css'
import { Inter } from 'next/font/google'

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
      <body className={`${inter.className} bg-gray-50 text-gray-900 antialiased`}>
        {children}
      </body>
    </html>
  )
}