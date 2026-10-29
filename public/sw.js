// public/sw.js
// Schlanker Service Worker ausschließlich für Web-Push-Benachrichtigungen (Verwaltung und
// Gäste) - keine Offline-Caching-Strategie, das ist hier nicht nötig.

self.addEventListener('push', (event) => {
  if (!event.data) return

  const data = event.data.json()

  event.waitUntil(
    self.registration.showNotification(data.title || 'RSVP-App', {
      body: data.body || '',
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      data: { url: data.url || '/admin' },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/admin'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus()
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url)
      }
    })
  )
})

// Der Browser hat das Abo erneuert oder beendet (z.B. Schlüsselwechsel beim Push-Dienst). Ohne diese Meldung schickt
// der Server weiter an den alten Endpoint, den der Push-Dienst dann mit 404/410 ablehnt. Das neue Abo ersetzt das
// alte für Verwaltung und Gäste (app/api/push/resubscribe). Fehlt das neue, holt der Worker selbst eins mit den
// Optionen des alten; fehlt das alte (manche Browser), bleibt nur der Abgleich beim nächsten Seitenbesuch
// (app/lib/push-client.ts).
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const oldSubscription = event.oldSubscription
    if (!oldSubscription) return
    const subscription = event.newSubscription || await self.registration.pushManager.subscribe(oldSubscription.options)
    await fetch('/api/push/resubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldEndpoint: oldSubscription.endpoint, subscription: subscription.toJSON() })
    })
  })())
})
