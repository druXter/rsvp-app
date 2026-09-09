// app/admin/users/page.tsx
import { PrismaClient } from '@prisma/client'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '../../lib/auth'
import { updateUserRole } from '../actions'
import { ROLE_LABELS } from '../../lib/permissions'
import DeleteUserButton from '../delete-user-button'

const prisma = new PrismaClient()

/**
 * Admin-exklusive Nutzerverwaltung: Übersicht aller Konten mit ihrer Rolle und der
 * Anzahl eigener Events/Reihen, inkl. Rollenwechsel und Löschen. Admin-Konten lassen
 * sich hier nicht löschen (siehe deleteUser-Action) - so bleibt immer mindestens ein
 * funktionierender Admin-Zugang erhalten.
 */
export default async function UsersPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  if (user.role !== 'ADMIN') redirect('/admin')

  const users = await prisma.user.findMany({
    include: { _count: { select: { events: true, series: true } } },
    orderBy: { createdAt: 'asc' }
  })

  return (
    <main className="min-h-screen bg-gray-100 dark:bg-gray-900 py-12 px-4">
      <div className="max-w-4xl mx-auto space-y-6">

        <div className="flex justify-between items-center bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Nutzerverwaltung</h1>
          <Link href="/admin" className="text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition">← Dashboard</Link>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-x-auto">
          <table className="w-full text-left text-sm min-w-max">
            <thead>
              <tr className="border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                <th className="p-3">E-Mail</th>
                <th className="p-3">Rolle</th>
                <th className="p-3">Eigene Events</th>
                <th className="p-3">Eigene Reihen</th>
                <th className="p-3">Erstellt am</th>
                <th className="p-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const isSelf = u.id === user.id
                return (
                  <tr key={u.id} className="border-b dark:border-gray-700 last:border-0">
                    <td className="p-3 font-medium text-gray-900 dark:text-gray-100">
                      {u.email}{isSelf && <span className="text-gray-400 dark:text-gray-500 font-normal"> (du)</span>}
                    </td>
                    <td className="p-3">
                      {isSelf || u.role === 'ADMIN' ? (
                        <span className="text-gray-700 dark:text-gray-300">{ROLE_LABELS[u.role]}</span>
                      ) : (
                        <form action={updateUserRole} className="flex gap-2 items-center">
                          <input type="hidden" name="userId" value={u.id} />
                          <select name="role" defaultValue={u.role} className="border border-gray-300 dark:border-gray-600 p-1 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs">
                            <option value="ADMIN">Admin</option>
                            <option value="CREATOR">Creator</option>
                            <option value="MODERATOR">Moderator</option>
                          </select>
                          <button type="submit" className="text-xs text-blue-600 hover:text-blue-800 font-medium transition">
                            Speichern
                          </button>
                        </form>
                      )}
                    </td>
                    <td className="p-3 text-gray-600 dark:text-gray-300">{u._count.events}</td>
                    <td className="p-3 text-gray-600 dark:text-gray-300">{u._count.series}</td>
                    <td className="p-3 text-gray-500 dark:text-gray-400">{u.createdAt.toLocaleDateString('de-DE')}</td>
                    <td className="p-3 text-right">
                      {u.role !== 'ADMIN' && <DeleteUserButton userId={u.id} email={u.email} />}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400">
          Admin-Konten können hier weder gelöscht noch (auch nicht das eigene) in ihrer Rolle geändert werden -
          das schützt davor, versehentlich den letzten funktionierenden Admin-Zugang zu verlieren. Ein Rollenwechsel
          für dein eigenes Konto ist nur per <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">set-role.js</code> mit direktem Server-Zugriff möglich.
        </p>

      </div>
    </main>
  )
}
