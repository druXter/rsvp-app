// app/admin/nav-link.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

/**
 * Link der Navigation, hervorgehoben, wenn die aktuelle Seite dazugehört. `match`: Pfade (genau oder als Präfix
 * mit "/"), `exact`: nur genau `href` (für Reiter wie "Übersicht").
 */
export default function NavLink({ href, match, exact = false, children, variant = 'top' }: { href: string; match?: string[]; exact?: boolean; children: ReactNode; variant?: 'top' | 'tab' }) {
  const pathname = usePathname()
  const paths = match ?? [href]
  const active = exact ? pathname === href : paths.some(p => pathname === p || (p !== '/admin' && pathname.startsWith(p + '/')))
  if (variant === 'tab') {
    return (
      <Link href={href} aria-current={active ? 'page' : undefined} className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${active ? 'border-blue-600 text-blue-700 dark:text-blue-300' : 'border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'}`}>
        {children}
      </Link>
    )
  }
  return (
    <Link href={href} aria-current={active ? 'page' : undefined} className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${active ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800'}`}>
      {children}
    </Link>
  )
}
