// app/admin/admin-shell.tsx
import { AppHeader, Main, menuItemClass, menuSeparatorClass } from '../ui/kit'
import Link from 'next/link'
import type { ReactNode } from 'react'
import type { User } from '@prisma/client'
import { logoutUser } from './actions'
import { getCurrentGuestUser } from '../lib/guest-auth'
import { ROLE_LABELS } from '../lib/permissions'
import PushSubscribeButton from './push-subscribe-button'

/**
 * Rahmen aller Verwaltungsseiten nach dem Login (docs/KONZEPT-OBERFLAECHE.md): Kopfzeile (AppHeader aus suite-kit/ui,
 * wie in allen Tools der Suite) mit Navigation (Events, bei Admins Konten) und Konto-Menü (Einstellungen, Push,
 * Wechsel zu "Mein Konto", Abmelden), darunter der Inhalt. Beim Drucken verschwindet die Kopfzeile. `width`: "wide"
 * für Listen und Tabellen, "narrow" für Formulare.
 */
export default async function AdminShell({ user, children, width = 'wide' }: { user: User; children: ReactNode; width?: 'wide' | 'narrow' }) {
  // Ist dieses Gerät zusätzlich als Nutzer (Teilnehmendenkonto) angemeldet, gibt es einen direkten Wechsel
  const guestUser = await getCurrentGuestUser()
  const isAdmin = user.role === 'ADMIN'

  return (
    <>
      <AppHeader
        brand={{ letter: 'R', name: 'RSVP-Verwaltung', href: '/admin' }}
        nav={[
          { href: '/admin', label: 'Events', match: ['/admin/events', '/admin/series', '/admin/create', '/admin/edit-rsvp'], exactOr: '/admin' },
          ...(isAdmin ? [{ href: '/admin/users', label: 'Konten', match: ['/admin/users', '/admin/create-user'] }] : [])
        ]}
        account={{
          name: user.email,
          detail: <>{user.email}<br />{ROLE_LABELS[user.role]}</>,
          menu: <>
            <Link href="/admin/account" className={menuItemClass}>Konto-Einstellungen</Link>
            {user.role !== 'MODERATOR' && <Link href="/admin/create-user" className={menuItemClass}>Konto anlegen</Link>}
            {guestUser && <Link href="/mein-konto" className={menuItemClass}>Zu „Mein Konto“ ({guestUser.email})</Link>}
            <div className="px-1 py-1"><PushSubscribeButton vapidPublicKey={process.env.VAPID_PUBLIC_KEY || null} /></div>
            <form action={logoutUser} className={menuSeparatorClass}>
              <button type="submit" className={menuItemClass}>Abmelden</button>
            </form>
          </>
        }}
      />
      <Main width={width}>{children}</Main>
    </>
  )
}
