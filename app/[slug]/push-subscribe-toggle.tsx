// app/[slug]/push-subscribe-toggle.tsx
'use client'

import { useEffect, useState } from 'react'
import { subscribeParticipantToPush, unsubscribeParticipantFromPush } from '../actions'
import { resolvePushState, urlBase64ToUint8Array } from '../lib/push-client'

/**
 * Gast-seitiges Gegenstück zu app/admin/push-subscribe-button.tsx - abonniert dasselbe
 * public/sw.js für Erinnerungen und Termin-Änderungen (siehe app/lib/push.ts,
 * sendPushToParticipant). Anders als beim Admin-Pendant hängt das Abo am editToken des
 * Participants statt an einer Login-Session, funktioniert also auch ganz ohne
 * "Mein Konto"-Konto. Bei einem Reihen-Termin deckt ein einmaliges Abo automatisch alle
 * Termine der Reihe ab, da der Participant dort geteilt ist.
 */
export default function PushSubscribeToggle({ editToken, vapidPublicKey }: { editToken: string; vapidPublicKey: string | null }) {
  const [supported, setSupported] = useState(false)
  const [subscribed, setSubscribed] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!vapidPublicKey || !('serviceWorker' in navigator) || !('PushManager' in window)) return

    // Registriert den Service Worker bereits beim Laden der Seite (nicht erst beim Klick),
    // damit im Klick-Handler nur noch ein einziger, schneller await bis zum eigentlichen
    // subscribe() nötig ist - siehe app/admin/push-subscribe-button.tsx für den Grund
    // (sonst kann die "User Activation" des Klicks vorher ablaufen).
    //
    // „Aktiv“ zeigt der Schalter nur, wenn der SERVER das Abo dieses Geräts für diesen Gast hat - ein abgelaufenes
    // ersetzt resolvePushState dabei selbst (app/lib/push-client.ts).
    navigator.serviceWorker.register('/sw.js').then(async (registration) => {
      setSupported(true)
      if (editToken) setSubscribed(await resolvePushState(registration, vapidPublicKey, { editToken }))
    }).catch((error) => {
      console.error('Service-Worker-Registrierung fehlgeschlagen:', error)
    })
  }, [vapidPublicKey, editToken])

  if (!vapidPublicKey || !supported || !editToken) return null

  async function handleSubscribe() {
    setIsLoading(true)
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey!),
      })

      await subscribeParticipantToPush(editToken, subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } })
      setSubscribed(true)
    } catch (error) {
      console.error('Push-Abo fehlgeschlagen:', error)
      alert('Push-Benachrichtigungen konnten nicht aktiviert werden. Hast du die Erlaubnis für Benachrichtigungen abgelehnt?')
    } finally {
      setIsLoading(false)
    }
  }

  async function handleUnsubscribe() {
    setIsLoading(true)
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      // Nur die eigene Zeile auf dem Server löschen, das Abo im Browser bleibt: Es gehört dem ganzen Gerät und kann
      // noch für die Verwaltung oder andere Termine/Reihen gespeichert sein (app/lib/push-subscriptions.ts).
      if (subscription) {
        await unsubscribeParticipantFromPush(editToken, subscription.endpoint)
      }
      setSubscribed(false)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={subscribed ? handleUnsubscribe : handleSubscribe}
      disabled={isLoading}
      className={`text-sm font-medium px-3 py-1.5 rounded transition disabled:opacity-50 ${
        subscribed
          ? 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900 dark:text-green-200 dark:hover:bg-green-800'
          : 'bg-gray-200 text-gray-800 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
      }`}
      title={subscribed ? 'Push-Benachrichtigungen für dieses Gerät deaktivieren' : 'Erinnerungen und Termin-Änderungen auch als Push-Benachrichtigung auf diesem Gerät erhalten'}
    >
      {subscribed ? '🔔 Push aktiv' : '🔕 Push-Benachrichtigungen aktivieren'}
    </button>
  )
}
