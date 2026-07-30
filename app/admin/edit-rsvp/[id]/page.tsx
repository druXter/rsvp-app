// app/admin/edit-rsvp/[id]/page.tsx
import { PrismaClient } from '@prisma/client'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { updateAdminRsvp } from '../../actions'

const prisma = new PrismaClient()

/**
 * Admin-Ansicht zur manuellen Bearbeitung einer einzelnen Gast-Antwort.
 * Ermöglicht Korrekturen durch den Administrator, falls Gäste sich vertippt haben oder nachträgliche Änderungen mitteilen.
 */
export default async function EditRsvpPage({ params }: { params: Promise<{ id: string }> }) {
  // Sicherheits-Check
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')
  if (!session || session.value !== 'true') redirect('/admin/login')

  // Die spezifische Antwort aus der Datenbank abrufen
  const { id } = await params
  const rsvp = await prisma.rsvp.findUnique({ where: { id } })

  if (!rsvp) return <div className="p-8">Antwort nicht gefunden.</div>

  return (
    <main className="min-h-screen bg-gray-100 py-12 px-4">
      <div className="max-w-2xl mx-auto bg-white p-8 rounded-lg shadow space-y-6 text-gray-900">
        
        <div className="flex justify-between items-center border-b pb-4">
          <h1 className="text-2xl font-bold">Antwort bearbeiten</h1>
          <Link href="/admin" className="text-gray-500 hover:text-gray-800 transition">Abbrechen</Link>
        </div>

        <form action={updateAdminRsvp} className="space-y-4">
          <input type="hidden" name="rsvpId" value={rsvp.id} />

          {/* Raster-Layout (Grid) für eine kompaktere Darstellung der Eingabefelder */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input type="text" name="name" defaultValue={rsvp.name} required className="w-full border border-gray-300 p-2 rounded" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Status</label>
              <select name="isAttending" defaultValue={rsvp.isAttending ? 'true' : 'false'} className="w-full border border-gray-300 p-2 rounded bg-white">
                <option value="true">Zusage</option>
                <option value="false">Absage</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">E-Mail</label>
              <input type="email" name="email" defaultValue={rsvp.email || ''} className="w-full border border-gray-300 p-2 rounded" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Handy</label>
              <input type="tel" name="phone" defaultValue={rsvp.phone || ''} className="w-full border border-gray-300 p-2 rounded" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-4 border-t">
            <div>
              <label className="block text-sm font-medium mb-1">Begleitung (+1)?</label>
              <select name="plusOne" defaultValue={rsvp.plusOne ? 'true' : 'false'} className="w-full border border-gray-300 p-2 rounded bg-white">
                <option value="true">Ja</option>
                <option value="false">Nein</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Name d. Begleitung</label>
              <input type="text" name="plusOneName" defaultValue={rsvp.plusOneName || ''} className="w-full border border-gray-300 p-2 rounded" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Essen</label>
              <select name="dietaryOption" defaultValue={rsvp.dietaryOption || ''} className="w-full border border-gray-300 p-2 rounded bg-white">
                <option value="">Keine Angabe</option>
                <option value="Allesesser">Allesesser</option>
                <option value="Vegetarisch">Vegetarisch</option>
                <option value="Vegan">Vegan</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Alkohol?</label>
              <select name="drinksAlcohol" defaultValue={rsvp.drinksAlcohol === true ? 'true' : rsvp.drinksAlcohol === false ? 'false' : ''} className="w-full border border-gray-300 p-2 rounded bg-white">
                <option value="">Keine Angabe</option>
                <option value="true">Ja</option>
                <option value="false">Nein</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Allergien</label>
            <input type="text" name="allergies" defaultValue={rsvp.allergies || ''} className="w-full border border-gray-300 p-2 rounded" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Mitbringsel</label>
            <input type="text" name="bringingItem" defaultValue={rsvp.bringingItem || ''} className="w-full border border-gray-300 p-2 rounded" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Anmerkungen (bei Zusage) / Grund (bei Absage)</label>
            {/* 
              Dynamische Zuordnung des Feldes: 
              Das Datenbankfeld (additionalInfo oder declineReason) variiert je nach Teilnahmestatus.
            */}
            <textarea 
              name={rsvp.isAttending ? 'additionalInfo' : 'declineReason'} 
              defaultValue={rsvp.isAttending ? (rsvp.additionalInfo || '') : (rsvp.declineReason || '')} 
              rows={3} 
              className="w-full border border-gray-300 p-2 rounded"
            ></textarea>
          </div>

          <button type="submit" className="w-full bg-blue-600 text-white font-bold py-2 px-4 rounded hover:bg-blue-700 transition">
            Änderungen speichern
          </button>
        </form>
      </div>
    </main>
  )
}