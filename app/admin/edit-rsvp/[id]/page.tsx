// app/admin/edit-rsvp/[id]/page.tsx
import { PrismaClient } from '@prisma/client'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { updateAdminRsvp } from '../../actions'
import { getCurrentUser } from '../../../lib/auth'
import { hasEventModeratorOrAbove } from '../../../lib/permissions'
import SubmitButton from '../../../ui/submit-button'

const prisma = new PrismaClient()

/**
 * Admin-Ansicht zur manuellen Bearbeitung einer einzelnen Gast-Antwort.
 * Ermöglicht Korrekturen durch den Administrator, falls Gäste sich vertippt haben oder nachträgliche Änderungen mitteilen.
 */
export default async function EditRsvpPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')

  // Die spezifische Antwort aus der Datenbank abrufen (inkl. des geteilten Gast-Profils)
  const { id } = await params
  const rsvp = await prisma.rsvp.findUnique({ where: { id }, include: { participant: true, event: true } })

  if (!rsvp || !(await hasEventModeratorOrAbove(user, rsvp.event))) return <div className="p-8">Antwort nicht gefunden.</div>

  const participant = rsvp.participant

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
              <label htmlFor="name" className="block text-sm font-medium mb-1">Name</label>
              <input id="name" type="text" name="name" defaultValue={participant.name} required className="w-full border border-gray-300 p-2 rounded" />
            </div>
            <div>
              <label htmlFor="isAttending" className="block text-sm font-medium mb-1">Status</label>
              <select id="isAttending" name="isAttending" defaultValue={rsvp.isAttending ? 'true' : 'false'} className="w-full border border-gray-300 p-2 rounded bg-white">
                <option value="true">Zusage</option>
                <option value="false">Absage</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1">E-Mail</label>
              <input id="email" type="email" name="email" defaultValue={participant.email || ''} className="w-full border border-gray-300 p-2 rounded" />
            </div>
            <div>
              <label htmlFor="phone" className="block text-sm font-medium mb-1">Handy</label>
              <input id="phone" type="tel" name="phone" defaultValue={participant.phone || ''} className="w-full border border-gray-300 p-2 rounded" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-4 border-t">
            <div>
              <label htmlFor="plusOne" className="block text-sm font-medium mb-1">Begleitung (+1)?</label>
              <select id="plusOne" name="plusOne" defaultValue={rsvp.plusOne ? 'true' : 'false'} className="w-full border border-gray-300 p-2 rounded bg-white">
                <option value="true">Ja</option>
                <option value="false">Nein</option>
              </select>
            </div>
            <div>
              <label htmlFor="plusOneName" className="block text-sm font-medium mb-1">Name d. Begleitung</label>
              <input id="plusOneName" type="text" name="plusOneName" defaultValue={rsvp.plusOneName || ''} className="w-full border border-gray-300 p-2 rounded" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="dietaryOption" className="block text-sm font-medium mb-1">Essen</label>
              <select id="dietaryOption" name="dietaryOption" defaultValue={participant.dietaryOption || ''} className="w-full border border-gray-300 p-2 rounded bg-white">
                <option value="">Keine Angabe</option>
                <option value="Allesesser">Allesesser</option>
                <option value="Vegetarisch">Vegetarisch</option>
                <option value="Vegan">Vegan</option>
              </select>
            </div>
            <div>
              <label htmlFor="drinksAlcohol" className="block text-sm font-medium mb-1">Alkohol?</label>
              <select id="drinksAlcohol" name="drinksAlcohol" defaultValue={rsvp.drinksAlcohol === true ? 'true' : rsvp.drinksAlcohol === false ? 'false' : ''} className="w-full border border-gray-300 p-2 rounded bg-white">
                <option value="">Keine Angabe</option>
                <option value="true">Ja</option>
                <option value="false">Nein</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="allergies" className="block text-sm font-medium mb-1">Allergien</label>
            <input id="allergies" type="text" name="allergies" defaultValue={participant.allergies || ''} className="w-full border border-gray-300 p-2 rounded" />
          </div>

          <div>
            <label htmlFor="bringingItem" className="block text-sm font-medium mb-1">Mitbringsel</label>
            <input id="bringingItem" type="text" name="bringingItem" defaultValue={rsvp.bringingItem || ''} className="w-full border border-gray-300 p-2 rounded" />
          </div>

          <div>
            <label htmlFor="additionalInfoOrDeclineReason" className="block text-sm font-medium mb-1">Anmerkungen (bei Zusage) / Grund (bei Absage)</label>
            {/*
              Dynamische Zuordnung des Feldes:
              Das Datenbankfeld (additionalInfo oder declineReason) variiert je nach Teilnahmestatus.
            */}
            <textarea
              id="additionalInfoOrDeclineReason"
              name={rsvp.isAttending ? 'additionalInfo' : 'declineReason'}
              defaultValue={rsvp.isAttending ? (rsvp.additionalInfo || '') : (rsvp.declineReason || '')} 
              rows={3} 
              className="w-full border border-gray-300 p-2 rounded"
            ></textarea>
          </div>

          <SubmitButton>Änderungen speichern</SubmitButton>
        </form>
      </div>
    </main>
  )
}