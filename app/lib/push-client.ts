// app/lib/push-client.ts
//
// Nur im Browser (Push-Schalter der Gästeseite und der Verwaltung). Gegenstück auf dem Server:
// app/lib/push-subscriptions.ts mit /api/push/status und /api/push/resubscribe.

/** Wandelt den VAPID-Public-Key (URL-safe Base64) ins vom Push API erwartete Uint8Array um. */
export function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)))
}

type Owner = { editToken: string } | { admin: true }

async function serverStatus(owner: Owner, subscription: PushSubscription): Promise<string> {
  const response = await fetch('/api/push/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...('editToken' in owner ? { editToken: owner.editToken } : {}), subscription: subscription.toJSON() })
  })
  if (!response.ok) return 'none'
  return ((await response.json()) as { status?: string }).status ?? 'none'
}

/**
 * Ist Push auf diesem Gerät für diesen Gast bzw. dieses Konto wirklich aktiv? Fragt den Server statt nur den Browser:
 * Ein Abo, das der Browser noch kennt, kann beim Push-Dienst längst abgelaufen sein. Meldet der Server es als
 * abgelaufen und ist die Erlaubnis noch erteilt, holt der Browser ein neues Abo und ersetzt das alte überall
 * (/api/push/resubscribe) - Push geht dann ohne weiteres Zutun wieder.
 */
export async function resolvePushState(registration: ServiceWorkerRegistration, vapidPublicKey: string, owner: Owner): Promise<boolean> {
  const existing = await registration.pushManager.getSubscription()
  if (!existing) return false
  const status = await serverStatus(owner, existing)
  if (status === 'active') return true
  if (status !== 'expired' || Notification.permission !== 'granted') return false

  try {
    const oldEndpoint = existing.endpoint
    await existing.unsubscribe()
    const fresh = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) })
    await fetch('/api/push/resubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldEndpoint, subscription: fresh.toJSON() })
    })
    return (await serverStatus(owner, fresh)) === 'active'
  } catch (error) {
    console.error('Push-Abo erneuern fehlgeschlagen:', error)
    return false
  }
}
