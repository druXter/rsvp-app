// app/admin/kueche/[eventId]/page.tsx
import { PrismaClient } from '@prisma/client'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '../../../lib/auth'
import { hasEventModeratorOrAbove } from '../../../lib/permissions'
import { loadKitchenReport } from '../../../lib/kitchen'
import { AGE_GROUP_LABEL } from '../../../lib/persons'
import PrintButton from './print-button'

const prisma = new PrismaClient()

/**
 * Küchenübersicht (docs/KONZEPT-EINLADUNGEN.md, Abschnitt 4): Menüwahl pro Gang gezählt, Essen, Allergien und
 * eine Liste aller Personen mit festem Platz (nach Sitzplatz sortiert). Für alle mit Zugriff auf die Gästeliste.
 * Druckbar (Navigation und Knöpfe verschwinden beim Drucken), dazu die Personen-CSV.
 */
export default async function KitchenPage({ params }: { params: Promise<{ eventId: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')

  const { eventId } = await params
  const event = await prisma.event.findUnique({ where: { id: eventId } })
  if (!event || !(await hasEventModeratorOrAbove(user, event))) return notFound()

  const report = await loadKitchenReport(event.id)
  const totalPersons = report.totals.ADULT + report.totals.CHILD + report.totals.INFANT

  return (
    <main className="min-h-screen bg-gray-100 dark:bg-gray-900 py-12 px-4 print:bg-white print:py-0">
      <div className="max-w-5xl mx-auto bg-white dark:bg-gray-800 p-8 rounded-lg shadow space-y-6 text-gray-900 dark:text-gray-100 print:shadow-none print:p-0">
        <div className="flex flex-wrap gap-2 justify-between items-center border-b dark:border-gray-700 pb-4">
          <h1 className="text-2xl font-bold">🍽️ Küche: {event.title}</h1>
          <div className="flex gap-3 items-center print:hidden">
            <a href={`/api/export/kueche?eventId=${event.id}`} download className="text-sm font-medium text-orange-700 dark:text-orange-300 hover:underline">📥 Personen-CSV</a>
            <PrintButton />
            <Link href="/admin" className="text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition">Zur Verwaltung</Link>
          </div>
        </div>

        <p className="text-sm" data-testid="kitchen-totals">
          {totalPersons} Personen mit festem Platz: {report.totals.ADULT} Erwachsene, {report.totals.CHILD} Kinder, {report.totals.INFANT} Kleinkinder (ohne Menü).
        </p>

        {report.courses.length > 0 && (
          <section className="grid sm:grid-cols-2 gap-4" data-testid="kitchen-courses">
            {report.courses.map(course => (
              <div key={course.id} className="p-4 rounded border border-orange-200 dark:border-orange-800">
                <h2 className="font-bold mb-2">{course.label}</h2>
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-gray-500 dark:text-gray-400"><th>Option</th><th className="text-right">Erw.</th><th className="text-right">Kinder</th><th className="text-right">Summe</th></tr></thead>
                  <tbody>
                    {course.counts.map(c => (
                      <tr key={c.option}><td>{c.option}</td><td className="text-right">{c.adults}</td><td className="text-right">{c.children}</td><td className="text-right font-semibold">{c.adults + c.children}</td></tr>
                    ))}
                  </tbody>
                </table>
                {course.missing > 0 && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{course.missing} ohne Wahl</p>}
              </div>
            ))}
          </section>
        )}

        {report.diets.length > 0 && (
          <p className="text-sm" data-testid="kitchen-diets">Essen: {report.diets.map(d => `${d.label} ${d.count}`).join(' · ')}</p>
        )}

        {report.persons.some(p => p.allergies) && (
          <section>
            <h2 className="font-bold mb-1">Allergien und Unverträglichkeiten</h2>
            <ul className="text-sm list-disc ml-5" data-testid="kitchen-allergies">
              {report.persons.filter(p => p.allergies).map((p, i) => (
                <li key={i}><strong>{p.name}</strong>{p.seat ? ` (${p.seat})` : ''}: {p.allergies}</li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="font-bold mb-2">Alle Personen</h2>
          {report.persons.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 italic">Noch keine Zusagen mit festem Platz.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left" data-testid="kitchen-persons">
                <thead>
                  <tr className="border-b bg-gray-50 dark:bg-gray-700">
                    <th className="p-2">Platz</th><th className="p-2">Name</th><th className="p-2">Antwort</th><th className="p-2">Alter</th>
                    {report.courses.map(c => <th key={c.id} className="p-2">{c.label}</th>)}
                    <th className="p-2">Essen</th><th className="p-2">Allergien</th>
                  </tr>
                </thead>
                <tbody>
                  {report.persons.map((p, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="p-2">{p.seat ?? '-'}</td>
                      <td className="p-2 font-medium">{p.name}</td>
                      <td className="p-2 text-gray-500 dark:text-gray-400">{p.answer}</td>
                      <td className="p-2">{p.ageGroup === 'ADULT' ? '' : AGE_GROUP_LABEL[p.ageGroup].replace(/ \(.*\)$/, '')}</td>
                      {report.courses.map(c => <td key={c.id} className="p-2">{p.ageGroup === 'INFANT' ? '' : p.menu[c.id] ?? '–'}</td>)}
                      <td className="p-2">{p.dietaryOption ?? ''}</td>
                      <td className="p-2">{p.allergies ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
