// app/admin/push-subscribe-button.tsx
'use client'

import { useEffect, useState } from 'react'
import { subscribeToPush, unsubscribeFromPush } from './actions'
import { resolvePushState, urlBase64ToUint8Array } from '../lib/push-client'

export default function PushSubscribeButton({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const [supported, setSupported] = useState(false)
  const [subscribed, setSubscribed] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!vapidPublicKey || !('serviceWorker' in navigator) || !('PushManager' in window)) return

    // Registriert den Service Worker bereits beim Laden des Dashboards (nicht erst
    // beim Klick), damit im Klick-Handler nur noch ein einziger, schneller await bis
    // zum eigentlichen subscribe() nötig ist - sonst kann die "User Activation" des
    // Klicks durch mehrere hintereinander await'ete Schritte ablaufen, bevor der
    // Browser den Zugriff auf die Push API überhaupt erlaubt.
    // „An“ zeigt der Knopf nur, wenn der SERVER das Abo dieses Geräts für dieses Konto hat - ein abgelaufenes ersetzt
    // resolvePushState dabei selbst (app/lib/push-client.ts).
    navigator.serviceWorker.register('/sw.js').then(async (registration) => {
      setSupported(true)
      setSubscribed(await resolvePushState(registration, vapidPublicKey, { admin: true }))
    }).catch((error) => {
      console.error('Service-Worker-Registrierung fehlgeschlagen:', error)
    })
  }, [vapidPublicKey])

  if (!vapidPublicKey || !supported) return null

  async function handleSubscribe() {
    setIsLoading(true)
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey!),
      })

      await subscribeToPush(subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } })
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
        await unsubscribeFromPush(subscription.endpoint)
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
      className="block w-full rounded-md px-2 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-700"
      title={subscribed ? 'Push-Benachrichtigungen für dieses Gerät deaktivieren' : 'Push-Benachrichtigungen für dieses Gerät aktivieren'}
    >
      {subscribed ? 'Push-Benachrichtigungen: an (ausschalten)' : 'Push-Benachrichtigungen einschalten'}
    </button>
  )
}
