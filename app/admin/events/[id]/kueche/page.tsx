// app/admin/events/[id]/kueche/page.tsx
import { notFound } from 'next/navigation'
import { loadKitchenReport } from '../../../../lib/kitchen'
import { AGE_GROUP_LABEL } from '../../../../lib/persons'
import { buttonClass } from '../../../../ui/kit'
import { loadAdminEvent } from '../event-access'
import PrintButton from './print-button'

/**
 * Reiter "Küche" (docs/KONZEPT-EINLADUNGEN.md, Abschnitt 4): Menüwahl pro Gang gezählt, Essen, Allergien, mit Seating
 * die Küchenliste pro Tisch (was an welchen Tisch geht) und eine Liste aller Personen mit festem Platz (nach Tisch und
 * Platz sortiert). Für alle mit Zugriff auf die Gästeliste. Druckbar (Kopfzeile, Reiter und Knöpfe verschwinden beim
 * Drucken, jeder Tisch bleibt auf einer Seite), dazu die Personen-CSV.
 */
export default async function KitchenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const loaded = await loadAdminEvent(id)
  if (!loaded) notFound()
  const { event } = loaded

  const report = await loadKitchenReport(event.id)
  const totalPersons = report.totals.ADULT + report.totals.CHILD + report.totals.INFANT

  return (
    <div className="space-y-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800 print:border-0 print:p-0 print:shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Küche<span className="hidden print:inline">: {event.title}</span></h2>
          <div className="flex items-center gap-2 print:hidden">
            <a href={`/api/export/kueche?eventId=${event.id}`} download className={buttonClass('secondary')}>📥 Personen-CSV</a>
            <PrintButton />
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
        {report.drinks.alcohol + report.drinks.alcoholFree > 0 && (
          <p className="text-sm" data-testid="kitchen-drinks">Getränke (Erwachsene): {report.drinks.alcohol} mit Alkohol · {report.drinks.alcoholFree} nur alkoholfrei</p>
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

        {report.tables.length > 0 && (
          <section>
            <h2 className="font-bold mb-2">Pro Tisch</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="kitchen-tables">
              {report.tables.map(t => (
                <div key={t.table ?? '-'} className="rounded border border-gray-200 p-3 text-sm break-inside-avoid dark:border-gray-700" data-testid="kitchen-table">
                  <h3 className="font-semibold">
                    {t.table ?? 'Ohne Tisch'}
                    <span className="font-normal text-gray-500 dark:text-gray-400"> · {t.persons.length} {t.persons.length === 1 ? 'Person' : 'Personen'}{t.totals.CHILD + t.totals.INFANT > 0 ? ` (${[t.totals.CHILD ? `${t.totals.CHILD} Kinder` : '', t.totals.INFANT ? `${t.totals.INFANT} Kleinkinder` : ''].filter(Boolean).join(', ')})` : ''}</span>
                  </h3>
                  {t.courses.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {t.courses.map(c => (
                        <li key={c.id}><span className="text-gray-500 dark:text-gray-400">{c.label}:</span> {c.counts.map(x => `${x.count}× ${x.option}`).join(', ') || '–'}{c.missing > 0 ? <span className="text-red-600 dark:text-red-400"> · {c.missing} offen</span> : null}</li>
                      ))}
                    </ul>
                  )}
                  {t.persons.some(p => p.allergies) && (
                    <p className="mt-1 text-red-700 dark:text-red-300">⚠️ {t.persons.filter(p => p.allergies).map(p => `${p.name}: ${p.allergies}`).join('; ')}</p>
                  )}
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t.persons.map(p => p.name).join(', ')}</p>
                </div>
              ))}
            </div>
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
                    {report.tables.length > 0 && <th className="p-2">Tisch</th>}<th className="p-2">Platz</th><th className="p-2">Name</th><th className="p-2">Antwort</th><th className="p-2">Alter</th>
                    {report.courses.map(c => <th key={c.id} className="p-2">{c.label}</th>)}
                    <th className="p-2">Essen</th><th className="p-2">Allergien</th><th className="p-2">Alkohol</th>
                  </tr>
                </thead>
                <tbody>
                  {report.persons.map((p, i) => (
                    <tr key={i} className="border-b last:border-0">
                      {report.tables.length > 0 && <td className="p-2">{p.table ?? '-'}</td>}
                      <td className="p-2">{p.seat ?? '-'}</td>
                      <td className="p-2 font-medium">{p.name}</td>
                      <td className="p-2 text-gray-500 dark:text-gray-400">{p.answer}</td>
                      <td className="p-2">{p.ageGroup === 'ADULT' ? '' : AGE_GROUP_LABEL[p.ageGroup].replace(/ \(.*\)$/, '')}</td>
                      {report.courses.map(c => <td key={c.id} className="p-2">{p.ageGroup === 'INFANT' ? '' : p.menu[c.id] ?? '–'}</td>)}
                      <td className="p-2">{p.dietaryOption ?? ''}</td>
                      <td className="p-2">{p.allergies ?? ''}</td>
                      <td className="p-2">{p.drinksAlcohol === true ? 'ja' : p.drinksAlcohol === false ? 'nein' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
    </div>
  )
}
