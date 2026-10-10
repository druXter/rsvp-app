// app/admin/admin-shell.tsx
import Link from 'next/link'
import type { ReactNode } from 'react'
import type { User } from '@prisma/client'
import { logoutUser } from './actions'
import { getCurrentGuestUser } from '../lib/guest-auth'
import { ROLE_LABELS } from '../lib/permissions'
import PushSubscribeButton from './push-subscribe-button'
import NavLink from './nav-link'

/**
 * Rahmen aller Verwaltungsseiten nach dem Login (docs/KONZEPT-OBERFLAECHE.md): Kopfzeile mit Navigation (Events,
 * bei Admins Konten) und Konto-Menü (Einstellungen, Push, Wechsel zu "Mein Konto", Abmelden), darunter der Inhalt.
 * Beim Drucken verschwindet die Kopfzeile. `width`: "wide" für Listen und Tabellen, "narrow" für Formulare.
 */
export default async function AdminShell({ user, children, width = 'wide' }: { user: User; children: ReactNode; width?: 'wide' | 'narrow' }) {
  // Ist dieses Gerät zusätzlich als Nutzer (Teilnehmendenkonto) angemeldet, gibt es einen direkten Wechsel
  const guestUser = await getCurrentGuestUser()
  const isAdmin = user.role === 'ADMIN'
  const menuItem = 'block w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700'

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur dark:border-gray-700 dark:bg-gray-900/95 print:hidden">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
          <Link href="/admin" className="mr-2 flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100">
            <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-sm text-white">R</span>
            <span className="hidden sm:inline">RSVP-Verwaltung</span>
          </Link>
          <nav className="flex items-center gap-1" aria-label="Hauptnavigation">
            <NavLink href="/admin" match={['/admin', '/admin/events', '/admin/series', '/admin/create', '/admin/edit-rsvp']}>Events</NavLink>
            {isAdmin && <NavLink href="/admin/users" match={['/admin/users', '/admin/create-user']}>Konten</NavLink>}
          </nav>
          <details className="relative ml-auto">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800" aria-label="Konto-Menü">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold uppercase text-gray-700 dark:bg-gray-700 dark:text-gray-200">{user.email.slice(0, 1)}</span>
              <span className="hidden max-w-48 truncate md:inline">{user.email}</span>
              <span aria-hidden className="text-gray-400">▾</span>
            </summary>
            <div className="absolute right-0 mt-2 w-64 rounded-xl border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-800">
              <p className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">{user.email}<br />{ROLE_LABELS[user.role]}</p>
              <Link href="/admin/account" className={menuItem}>Konto-Einstellungen</Link>
              {user.role !== 'MODERATOR' && <Link href="/admin/create-user" className={menuItem}>Konto anlegen</Link>}
              {guestUser && <Link href="/mein-konto" className={menuItem}>Zu „Mein Konto“ ({guestUser.email})</Link>}
              <div className="px-1 py-1"><PushSubscribeButton vapidPublicKey={process.env.VAPID_PUBLIC_KEY || null} /></div>
              <form action={logoutUser} className="border-t border-gray-100 pt-1 dark:border-gray-700">
                <button type="submit" className={menuItem}>Abmelden</button>
              </form>
            </div>
          </details>
        </div>
      </header>
      <main className={`mx-auto px-4 py-6 sm:py-8 ${width === 'narrow' ? 'max-w-3xl' : 'max-w-6xl'} print:max-w-none print:p-0`}>
        {children}
      </main>
    </div>
  )
}
