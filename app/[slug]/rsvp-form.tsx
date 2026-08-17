// app/[slug]/rsvp-form.tsx
'use client' 

import { useState } from 'react'
import { submitRsvp } from '../actions'

export default function RsvpForm({ 
  eventId, 
  formConfig,
  existingRsvp,
  isEmbed = false 
}: { 
  eventId: string; 
  formConfig: string | null; 
  existingRsvp?: any; 
  isEmbed?: boolean; 
}) {
  const [isAttending, setIsAttending] = useState<boolean | null>(existingRsvp ? existingRsvp.isAttending : null)
  const [hasPlusOne, setHasPlusOne] = useState<boolean>(existingRsvp ? existingRsvp.plusOne : false)
  const [submittedToken, setSubmittedToken] = useState<string | null>(null) 
  
  // NEU: Steuert, ob der gelbe Verifizierungs-Screen gezeigt wird
  const [showVerifyScreen, setShowVerifyScreen] = useState<boolean>(false)
  
  const config = formConfig 
    ? JSON.parse(formConfig) 
    : { askEmail: false, askPhone: false, askDiet: true, askAlcohol: true, askPlusOne: false, askBringingItem: false, askAllergies: false }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const result = await submitRsvp(formData)
    setSubmittedToken(result.editToken)
    
    // NEU: Auslesen, ob der gelbe Screen gezeigt werden soll
    if (result.needsVerification) {
      setShowVerifyScreen(true)
    }
  }

  if (submittedToken) {
    const personalLink = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}?token=${submittedToken}` : ''

    if (showVerifyScreen) {
      return (
        <div className={`flex flex-col items-center ${isEmbed ? 'py-6 text-yellow-800' : 'p-6 bg-yellow-50 text-yellow-800 rounded-lg shadow'}`}>
          <h3 className="text-xl font-bold mb-2 text-center">Fast geschafft! ✉️</h3>
          <p className="mb-6 text-center">Wir haben dir gerade eine E-Mail mit einem Bestätigungslink gesendet.</p>
          <p className="text-sm text-yellow-700 text-center font-medium bg-yellow-100 p-4 rounded w-full">
            Bitte klicke auf den Link in der E-Mail, um deine Anmeldung verbindlich abzuschließen. Erst danach erhältst du deinen Kalendereintrag!
          </p>
        </div>
      )
    }

    // Der normale "Alles erfolgreich"-Screen
    return (
      <div className={`flex flex-col items-center ${isEmbed ? 'py-6 text-green-800' : 'p-6 bg-green-50 text-green-800 rounded-lg shadow'}`}>
        <h3 className="text-xl font-bold mb-2 text-center">Danke für deine Antwort!</h3>
        <p className="mb-6 text-center">Deine Rückmeldung wurde erfolgreich gespeichert.</p>
        
        <div className={`w-full mb-6 ${isEmbed ? 'p-4 border border-green-200 rounded' : 'bg-white p-4 rounded border border-green-200'}`}>
          <p className="text-sm font-bold mb-2 text-green-900">🔗 Dein persönlicher Bearbeitungs-Link:</p>
          <p className="text-xs text-gray-600 mb-2">Speichere diesen Link, falls du deine Antwort später noch einmal ändern möchtest.</p>
          <input 
            type="text" 
            readOnly 
            value={personalLink} 
            className="w-full bg-gray-50 border border-gray-200 rounded p-2 text-sm text-gray-700 outline-none cursor-pointer"
            onClick={(e) => e.currentTarget.select()} 
            title="Link zum Kopieren anklicken"
          />
        </div>

        {isAttending && (
          <a 
            href={`/api/ical/${eventId}?token=${submittedToken}`} 
            className="inline-block bg-green-600 text-white font-bold py-2 px-6 rounded hover:bg-green-700 transition mt-2"
          >
            📅 Zum Kalender hinzufügen
          </a>
        )}
      </div>
    )
  }

  return (
    // Dynamische Klassen für das eigentliche Formular. Im Embed-Modus entfernen wir die Box-Optik komplett.
    <form onSubmit={handleSubmit} className={`space-y-6 text-gray-900 ${isEmbed ? '' : 'bg-white p-6 rounded-lg shadow'}`}>
      <input type="hidden" name="eventId" value={eventId} />
      {existingRsvp && <input type="hidden" name="editToken" value={existingRsvp.editToken} />}

      <div>
        <label className="block text-sm font-medium mb-1">Dein Name</label>
        <input type="text" name="name" defaultValue={existingRsvp?.name} required className="w-full border border-gray-300 p-2 rounded" placeholder="Max Mustermann" />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Bist du dabei?</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="isAttending" value="true" defaultChecked={existingRsvp?.isAttending === true} required onChange={() => setIsAttending(true)} />
            Ja, ich komme
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="isAttending" value="false" defaultChecked={existingRsvp?.isAttending === false} required onChange={() => setIsAttending(false)} />
            Nein, leider nicht
          </label>
        </div>
      </div>

      {isAttending === true && (
        <div className="space-y-4 pt-4 border-t border-gray-200">
          
          {config.askEmail && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">E-Mail Adresse</label>
              <input 
                type="email" 
                name="email" 
                defaultValue={existingRsvp?.email || ''} 
                required 
                // Wenn eine E-Mail existiert und verifiziert ist, wird das Feld gesperrt
                readOnly={existingRsvp?.isVerified ? true : false}
                className={`w-full border p-2 rounded-md ${existingRsvp?.isVerified ? 'bg-gray-100 border-gray-200 text-gray-500 cursor-not-allowed outline-none' : 'border-gray-300'}`}
                placeholder="max@beispiel.de" 
              />
              {/* Kleiner visueller Hinweis für den Gast */}
              {existingRsvp?.isVerified && existingRsvp?.email && (
                <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                  🔒 E-Mail ist verifiziert und geschützt.
                </p>
              )}
            </div>
          )}

          {config.askPhone && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Handynummer</label>
              <input type="tel" name="phone" defaultValue={existingRsvp?.phone || ''} required className="w-full border border-gray-300 p-2 rounded-md" placeholder="0151 12345678" />
            </div>
          )}

          {config.askPlusOne && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Bringst du eine Begleitperson mit?</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2">
                  <input type="radio" name="plusOne" value="true" defaultChecked={existingRsvp?.plusOne === true} required onChange={() => setHasPlusOne(true)} className="w-4 h-4 text-blue-600" /> Ja
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="plusOne" value="false" defaultChecked={existingRsvp?.plusOne === false} required onChange={() => setHasPlusOne(false)} className="w-4 h-4 text-blue-600" /> Nein
                </label>
              </div>
              {hasPlusOne && (
                <input type="text" name="plusOneName" defaultValue={existingRsvp?.plusOneName || ''} required className="w-full border border-gray-300 p-2 rounded-md mt-2" placeholder="Name der Begleitperson" />
              )}
            </div>
          )}

          {config.askDiet && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Essenswunsch</label>
              <select name="dietaryOption" defaultValue={existingRsvp?.dietaryOption || ''} required className="w-full border border-gray-300 p-2 rounded-md bg-white">
                <option value="">Bitte wählen...</option>
                <option value="Allesesser">Ich esse alles (Fleisch/Fisch)</option>
                <option value="Vegetarisch">Vegetarisch</option>
                <option value="Vegan">Vegan</option>
              </select>
            </div>
          )}

          {config.askAllergies && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Allergien oder Unverträglichkeiten? (Optional)</label>
              <input type="text" name="allergies" defaultValue={existingRsvp?.allergies || ''} className="w-full border border-gray-300 p-2 rounded-md" placeholder="z.B. Laktose, Nüsse, Gluten..." />
            </div>
          )}

          {config.askAlcohol && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Trinkst du Alkohol?</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2">
                  <input type="radio" name="drinksAlcohol" value="true" defaultChecked={existingRsvp?.drinksAlcohol === true} required className="w-4 h-4 text-blue-600" /> Ja
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="drinksAlcohol" value="false" defaultChecked={existingRsvp?.drinksAlcohol === false} required className="w-4 h-4 text-blue-600" /> Nein (nur alkoholfrei)
                </label>
              </div>
            </div>
          )}

          {config.askBringingItem && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bringst du etwas mit? (Optional)</label>
              <input type="text" name="bringingItem" defaultValue={existingRsvp?.bringingItem || ''} className="w-full border border-gray-300 p-2 rounded-md" placeholder="z.B. Nudelsalat, Kasten Bier..." />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sonstige Anmerkungen? (Optional)</label>
            <textarea name="additionalInfo" defaultValue={existingRsvp?.additionalInfo || ''} className="w-full border border-gray-300 p-2 rounded-md" rows={3}></textarea>
          </div>
        </div>
      )}

      {isAttending === false && (
        <div className="space-y-4 pt-4 border-t">
          <div>
            <label className="block text-sm font-medium mb-1">Warum klappt es leider nicht? (Optional)</label>
            <textarea name="declineReason" defaultValue={existingRsvp?.declineReason || ''} className="w-full border border-gray-300 p-2 rounded" rows={2} placeholder="z.B. Sind leider im Urlaub..."></textarea>
          </div>
        </div>
      )}

      <button type="submit" className="w-full bg-blue-600 text-white font-bold py-2 px-4 rounded hover:bg-blue-700 transition">
        {existingRsvp ? "Änderungen speichern" : "Antwort absenden"}
      </button>
    </form>
  )
}