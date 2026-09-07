// app/[slug]/rsvp-form.tsx
'use client'

import { useState } from 'react'
import { submitRsvp } from '../actions'

export default function RsvpForm({
  eventId,
  formConfig,
  participant,
  rsvp,
  isEmbed = false
}: {
  eventId: string;
  formConfig: string | null;
  participant?: any;
  rsvp?: any;
  isEmbed?: boolean;
}) {
  const [isAttending, setIsAttending] = useState<boolean | null>(rsvp ? rsvp.isAttending : null)
  const [hasPlusOne, setHasPlusOne] = useState<boolean>(rsvp ? rsvp.plusOne : false)
  const [submittedToken, setSubmittedToken] = useState<string | null>(null)

  const [showVerifyScreen, setShowVerifyScreen] = useState<boolean>(false)

  const [isOnWaitlist, setIsOnWaitlist] = useState<boolean>(rsvp ? rsvp.isOnWaitlist : false)
  const [qrCode, setQrCode] = useState<string | null>(null)

  const config = formConfig
    ? JSON.parse(formConfig)
    : { askEmail: false, askPhone: false, askDiet: true, askAlcohol: true, askPlusOne: false, askBringingItem: false, askAllergies: false }

  const customQuestions: string[] = config.customQuestions || []
  const existingCustomAnswers: string[] = rsvp?.customAnswers ? JSON.parse(rsvp.customAnswers) : []

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const result = await submitRsvp(formData)
    setSubmittedToken(result.editToken)

    // Auslesen, ob der gelbe Screen gezeigt werden soll
    if (result.needsVerification) {
      setShowVerifyScreen(true)
    }
    // Setze den Wartelisten-Status
    if (result.isOnWaitlist !== undefined) {
      setIsOnWaitlist(result.isOnWaitlist)
    }
    if (result.qrCode) {
      setQrCode(result.qrCode)
    }
  }

  if (submittedToken) {
    const personalLink = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}?token=${submittedToken}` : ''

    // Spezieller Screen für Absagen
    if (isAttending === false) {
      return (
        <div className={`flex flex-col items-center ${isEmbed ? 'py-6 text-red-800' : 'p-6 bg-red-50 text-red-800 rounded-lg shadow'}`}>
          <h3 className="text-xl font-bold mb-2 text-center">Schade, dass du nicht dabei bist!</h3>
          <p className="mb-6 text-center">Deine Absage wurde erfolgreich gespeichert.</p>
          <div className="w-full text-left">
            <p className="text-xs text-gray-600 mb-1">Dein persönlicher Link (falls du es dir anders überlegst):</p>
            <input
              type="text"
              readOnly
              value={personalLink}
              className="w-full bg-white border border-red-200 rounded p-2 text-sm text-gray-700 outline-none cursor-pointer"
              onClick={(e) => e.currentTarget.select()}
            />
          </div>
        </div>
      )
    }

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

    // Wenn Warteliste aktiv ist
    if (isOnWaitlist) {
      return (
        <div className={`flex flex-col items-center ${isEmbed ? 'py-6 text-orange-800' : 'p-6 bg-orange-50 text-orange-800 rounded-lg shadow'}`}>
          <h3 className="text-xl font-bold mb-2 text-center">Du stehst auf der Warteliste! ⏳</h3>
          <p className="mb-6 text-center">Das Event ist leider aktuell ausgebucht. Wir haben deine Anmeldung aber notiert.</p>
          <p className="text-sm bg-orange-100 p-4 rounded w-full mb-6">
            Sobald jemand abspringt und ein Platz für dich frei wird, rückt dein Platz automatisch nach und wir benachrichtigen dich sofort per E-Mail!
          </p>
          <div className="w-full text-left">
            <p className="text-xs text-gray-600 mb-1">Dein persönlicher Link (z.B. für Absagen):</p>
            <input type="text" readOnly value={personalLink} className="w-full bg-white border border-orange-200 rounded p-2 text-sm text-gray-700 outline-none" onClick={(e) => e.currentTarget.select()} />
          </div>
        </div>
      )
    }

    // Der normale "Alles erfolgreich"-Screen
    return (
      <div className={`flex flex-col items-center ${isEmbed ? 'py-6 text-green-800' : 'p-6 bg-green-50 text-green-800 rounded-lg shadow'}`}>
        <h3 className="text-xl font-bold mb-2 text-center">Danke für deine Anmeldung! 🎉</h3>
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

        {qrCode && (
          <div className={`w-full mt-6 flex flex-col items-center ${isEmbed ? 'p-4 border border-green-200 rounded' : 'bg-white p-4 rounded border border-green-200'}`}>
            <p className="text-sm font-bold mb-2 text-green-900">🎫 Dein persönlicher Einlass-QR-Code:</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrCode} alt="Einlass-QR-Code" className="w-48 h-48" />
            <p className="text-xs text-gray-600 mt-2 text-center">Bitte am Einlass bereithalten (auch per E-Mail an dich verschickt).</p>
          </div>
        )}
      </div>
    )
  }

  return (
    // Dynamische Klassen für das eigentliche Formular. Im Embed-Modus entfernen wir die Box-Optik komplett.
    <form onSubmit={handleSubmit} className={`space-y-6 text-gray-900 ${isEmbed ? '' : 'bg-white p-6 rounded-lg shadow'}`}>
      <input type="hidden" name="eventId" value={eventId} />
      {participant && <input type="hidden" name="editToken" value={participant.editToken} />}

      <div>
        <label className="block text-sm font-medium mb-1">Dein Name</label>
        <input type="text" name="name" defaultValue={participant?.name} required className="w-full border border-gray-300 p-2 rounded" placeholder="Max Mustermann" />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Bist du dabei?</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="isAttending" value="true" defaultChecked={rsvp?.isAttending === true} required onChange={() => setIsAttending(true)} />
            Ja, ich komme
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="isAttending" value="false" defaultChecked={rsvp?.isAttending === false} required onChange={() => setIsAttending(false)} />
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
                defaultValue={participant?.email || ''}
                required
                // Wenn eine E-Mail existiert und verifiziert ist, wird das Feld gesperrt
                readOnly={participant?.isVerified ? true : false}
                className={`w-full border p-2 rounded-md ${participant?.isVerified ? 'bg-gray-100 border-gray-200 text-gray-500 cursor-not-allowed outline-none' : 'border-gray-300'}`}
                placeholder="max@beispiel.de"
              />
              {/* Kleiner visueller Hinweis für den Gast */}
              {participant?.isVerified && participant?.email && (
                <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                  🔒 E-Mail ist verifiziert und geschützt.
                </p>
              )}
            </div>
          )}

          {config.askPhone && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Handynummer</label>
              <input type="tel" name="phone" defaultValue={participant?.phone || ''} required className="w-full border border-gray-300 p-2 rounded-md" placeholder="0151 12345678" />
            </div>
          )}

          {config.askPlusOne && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Bringst du eine Begleitperson mit?</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2">
                  <input type="radio" name="plusOne" value="true" defaultChecked={rsvp?.plusOne === true} required onChange={() => setHasPlusOne(true)} className="w-4 h-4 text-blue-600" /> Ja
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="plusOne" value="false" defaultChecked={rsvp?.plusOne === false} required onChange={() => setHasPlusOne(false)} className="w-4 h-4 text-blue-600" /> Nein
                </label>
              </div>
              {hasPlusOne && (
                <input type="text" name="plusOneName" defaultValue={rsvp?.plusOneName || ''} required className="w-full border border-gray-300 p-2 rounded-md mt-2" placeholder="Name der Begleitperson" />
              )}
            </div>
          )}

          {config.askDiet && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Essenswunsch</label>
              <select name="dietaryOption" defaultValue={participant?.dietaryOption || ''} required className="w-full border border-gray-300 p-2 rounded-md bg-white">
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
              <input type="text" name="allergies" defaultValue={participant?.allergies || ''} className="w-full border border-gray-300 p-2 rounded-md" placeholder="z.B. Laktose, Nüsse, Gluten..." />
            </div>
          )}

          {config.askAlcohol && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Trinkst du Alkohol?</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2">
                  <input type="radio" name="drinksAlcohol" value="true" defaultChecked={rsvp?.drinksAlcohol === true} required className="w-4 h-4 text-blue-600" /> Ja
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="drinksAlcohol" value="false" defaultChecked={rsvp?.drinksAlcohol === false} required className="w-4 h-4 text-blue-600" /> Nein (nur alkoholfrei)
                </label>
              </div>
            </div>
          )}

          {config.askBringingItem && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bringst du etwas mit? (Optional)</label>
              <input type="text" name="bringingItem" defaultValue={rsvp?.bringingItem || ''} className="w-full border border-gray-300 p-2 rounded-md" placeholder="z.B. Nudelsalat, Kasten Bier..." />
            </div>
          )}

          {customQuestions.map((question: string, i: number) => (
            <div key={i}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{question} (Optional)</label>
              <input type="text" name={`customAnswer_${i}`} defaultValue={existingCustomAnswers[i] || ''} className="w-full border border-gray-300 p-2 rounded-md" />
            </div>
          ))}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sonstige Anmerkungen? (Optional)</label>
            <textarea name="additionalInfo" defaultValue={rsvp?.additionalInfo || ''} className="w-full border border-gray-300 p-2 rounded-md" rows={3}></textarea>
          </div>
        </div>
      )}

      {isAttending === false && (
        <div className="space-y-4 pt-4 border-t">
          <div>
            <label className="block text-sm font-medium mb-1">Warum klappt es leider nicht? (Optional)</label>
            <textarea name="declineReason" defaultValue={rsvp?.declineReason || ''} className="w-full border border-gray-300 p-2 rounded" rows={2} placeholder="z.B. Sind leider im Urlaub..."></textarea>
          </div>
        </div>
      )}

      <button type="submit" className="w-full bg-blue-600 text-white font-bold py-2 px-4 rounded hover:bg-blue-700 transition">
        {rsvp ? "Änderungen speichern" : "Antwort absenden"}
      </button>
    </form>
  )
}
