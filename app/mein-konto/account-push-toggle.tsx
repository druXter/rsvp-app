// app/mein-konto/account-push-toggle.tsx
'use client'

import { useEffect, useState } from 'react'
import { subscribeGuestUserToPush, unsubscribeGuestUserFromPush } from './actions'
import { resolvePushState, urlBase64ToUint8Array, type PushState } from '../lib/push-client'

/**
 * "Push für alle Termine" eines Teilnehmendenkontos: Das Abo dieses Geräts hängt am Konto statt an einem Termin
 * (GuestUserPushSubscription) und gilt damit für alle Termine und Reihen des Kontos, auch künftige. Gegenstück pro
 * Termin bzw. Reihe ist app/[slug]/push-subscribe-toggle.tsx. Bekommt dieses Gerät schon alles über das verknüpfte
 * Verwaltungskonto, zeigt der Schalter nur das an.
 */
export default function AccountPushToggle({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const [supported, setSupported] = useState(false)
  const [state, setState] = useState<PushState>('none')
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!vapidPublicKey || !('serviceWorker' in navigator) || !('PushManager' in window)) return

    // Service Worker schon beim Laden registrieren, damit der Klick bis zu subscribe() nur einen await braucht (sonst
    // läuft die "User Activation" ab, siehe app/admin/push-subscribe-button.tsx). Den Stand liefert der Server.
    navigator.serviceWorker.register('/sw.js').then(async (registration) => {
      setSupported(true)
      setState(await resolvePushState(registration, vapidPublicKey, { account: true }))
    }).catch((error) => {
      console.error('Service-Worker-Registrierung fehlgeschlagen:', error)
    })
  }, [vapidPublicKey])

  if (!vapidPublicKey || !supported) return null

  if (state === 'covered') {
    return (
      <span
        className="bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200 px-4 py-2 rounded text-sm font-medium flex items-center"
        title="Dein verknüpftes Verwaltungskonto bekommt auf diesem Gerät Push - damit auch alles für deine Termine. Abschalten in der Verwaltung."
      >
        🔔 Push aktiv über die Verwaltung
      </span>
    )
  }

  async function handleSubscribe() {
    setIsLoading(true)
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey!),
      })

      await subscribeGuestUserToPush(subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } })
      setState('active')
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
      // Nur die Zeile des Kontos löschen, das Abo im Browser bleibt: Es gehört dem ganzen Gerät (app/lib/push-subscriptions.ts).
      if (subscription) await unsubscribeGuestUserFromPush(subscription.endpoint)
      setState('none')
    } finally {
      setIsLoading(false)
    }
  }

  const subscribed = state === 'active'
  return (
    <button
      type="button"
      onClick={subscribed ? handleUnsubscribe : handleSubscribe}
      disabled={isLoading}
      className={`px-4 py-2 rounded transition text-sm font-medium disabled:opacity-50 ${
        subscribed
          ? 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900 dark:text-green-200 dark:hover:bg-green-800'
          : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
      }`}
      title={subscribed
        ? 'Push für alle Termine auf diesem Gerät ausschalten'
        : 'Erinnerungen, Änderungen und Bestätigungen für alle deine Termine als Push auf diesem Gerät - auch für künftige'}
    >
      {subscribed ? '🔔 Push für alle Termine: an' : '🔕 Push für alle Termine'}
    </button>
  )
}
