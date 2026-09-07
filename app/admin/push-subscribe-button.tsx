// app/admin/push-subscribe-button.tsx
'use client'

import { useEffect, useState } from 'react'
import { subscribeToPush, unsubscribeFromPush } from './actions'

// Wandelt den VAPID-Public-Key (URL-safe Base64) ins vom Push API erwartete Uint8Array um
function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)))
}

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
    navigator.serviceWorker.register('/sw.js').then(async (registration) => {
      const existing = await registration.pushManager.getSubscription()
      setSupported(true)
      setSubscribed(!!existing)
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
      if (subscription) {
        await unsubscribeFromPush(subscription.endpoint)
        await subscription.unsubscribe()
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
      className={`px-4 py-2 rounded text-sm font-medium transition disabled:opacity-50 ${
        subscribed ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
      }`}
      title={subscribed ? 'Push-Benachrichtigungen für dieses Gerät deaktivieren' : 'Push-Benachrichtigungen für dieses Gerät aktivieren'}
    >
      {subscribed ? '🔔 Push aktiv' : '🔕 Push aktivieren'}
    </button>
  )
}
