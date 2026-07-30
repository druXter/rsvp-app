// app/[slug]/rsvp-form.tsx
'use client' // Kennzeichnet diese Datei als Client-Komponente für interaktive Hooks (useState)

import { useState } from 'react'
import { submitRsvp } from '../actions'

/**
 * Interaktives Formular zur Erfassung der Gäste-Antworten.
 * Passt sich dynamisch an die Konfiguration (formConfig) des jeweiligen Events an.
 */
export default function RsvpForm({ 
  eventId, 
  formConfig,
  existingRsvp
}: { 
  eventId: string; 
  formConfig: string | null; 
  existingRsvp?: any; 
}) {
  // Initialisierung der Zustände. Falls existingRsvp übergeben wurde (Gast bearbeitet seine Antwort),
  // nutzen wir diese Daten als Standardwerte, andernfalls starten wir leer (null/false).
  const [isAttending, setIsAttending] = useState<boolean | null>(existingRsvp ? existingRsvp.isAttending : null)
  const [hasPlusOne, setHasPlusOne] = useState<boolean>(existingRsvp ? existingRsvp.plusOne : false)
  const [submittedToken, setSubmittedToken] = useState<string | null>(null) 
  
  // JSON-Konfiguration des Events sicher parsen, andernfalls Fallback-Werte nutzen
  const config = formConfig 
    ? JSON.parse(formConfig) 
    : { askEmail: false, askPhone: false, askDiet: true, askAlcohol: true, askPlusOne: false, askBringingItem: false, askAllergies: false }

  /**
   * Behandelt das Absenden des Formulars.
   * Reicht die Formulardaten an die Server-Action weiter und speichert den zurückgegebenen Bearbeitungs-Token.
   */
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const result = await submitRsvp(formData)
    setSubmittedToken(result.editToken)
  }

  // Erfolgsmeldung anzeigen, sobald das Formular erfolgreich verarbeitet wurde
  if (submittedToken) {
    // Dynamische Konstruktion der aktuellen URL inklusive des neuen Tokens zur nachträglichen Bearbeitung
    const personalLink = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}?token=${submittedToken}` : ''

    return (
      <div className="p-6 bg-green-50 text-green-800 rounded-lg shadow flex flex-col items-center">
        <h3 className="text-xl font-bold mb-2 text-center">Danke für deine Antwort!</h3>
        <p className="mb-6 text-center">Deine Rückmeldung wurde erfolgreich gespeichert.</p>
        
        {/* Anzeige des persönlichen Links zur späteren Bearbeitung */}
        <div className="bg-white p-4 rounded border border-green-200 w-full mb-6">
          <p className="text-sm font-bold mb-2 text-green-900">🔗 Dein persönlicher Bearbeitungs-Link:</p>
          <p className="text-xs text-gray-600 mb-2">Speichere diesen Link, falls du deine Antwort später noch einmal ändern möchtest.</p>
          <input 
            type="text" 
            readOnly 
            value={personalLink} 
            className="w-full bg-gray-50 border border-gray-200 rounded p-2 text-sm text-gray-700 outline-none cursor-pointer"
            onClick={(e) => e.currentTarget.select()} // Text bei Klick automatisch markieren
            title="Link zum Kopieren anklicken"
          />
        </div>

        {/* iCal-Download-Button nur für Gäste einblenden, die zugesagt haben */}
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

  // Das eigentliche Eingabeformular
  return (
    <form onSubmit={handleSubmit} className="space-y-6 bg-white p-6 rounded-lg shadow text-gray-900">
      {/* Versteckte Felder für die Datenbank-Zuordnung */}
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

      {/* Zusatzfelder: Werden nur eingeblendet, wenn der Gast zusagt */}
      {isAttending === true && (
        <div className="space-y-4 pt-4 border-t border-gray-200">
          
          {/* Optionale Felder, basierend auf der Event-Konfiguration */}
          {config.askEmail && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">E-Mail Adresse</label>
              <input type="email" name="email" defaultValue={existingRsvp?.email || ''} required className="w-full border border-gray-300 p-2 rounded-md" placeholder="max@beispiel.de" />
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

      {/* Abfragegrund: Wird nur eingeblendet, wenn der Gast absagt */}
      {isAttending === false && (
        <div className="space-y-4 pt-4 border-t">
          <div>
            <label className="block text-sm font-medium mb-1">Warum klappt es leider nicht? (Optional)</label>
            <textarea name="declineReason" defaultValue={existingRsvp?.declineReason || ''} className="w-full border border-gray-300 p-2 rounded" rows={2} placeholder="z.B. Sind leider im Urlaub..."></textarea>
          </div>
        </div>
      )}

      {/* Dynamischer Button-Text, je nachdem ob es sich um eine neue oder bearbeitete Antwort handelt */}
      <button type="submit" className="w-full bg-blue-600 text-white font-bold py-2 px-4 rounded hover:bg-blue-700 transition">
        {existingRsvp ? "Änderungen speichern" : "Antwort absenden"}
      </button>
    </form>
  )
}