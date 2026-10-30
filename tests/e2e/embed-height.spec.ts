import { createServer, type Server } from 'node:http'
import { expect, test } from '@playwright/test'
import { createAccount, createEvent, BASE_URL } from './helpers'

// Automatische Höhe eingebetteter Seiten (Idee Q10, EmbedHeight aus suite-kit, app/[slug]/layout.tsx): Eingebettet
// meldet die Gästeseite ihre Höhe an die einbettende Seite; direkt aufgerufen passiert nichts.

// Eine fremde Website, die die Gästeseite einbettet (localhost ist eine andere Website als 127.0.0.1). Ein echter
// Server auf IPv4 und IPv6: Chromium lässt iFrames auf lokale Adressen nur aus Seiten zu, die selbst lokal sind.
const EMBEDDER_PORT = 3198
let embedded = ''
const servers: Server[] = []

test.beforeAll(async () => {
  for (const address of ['127.0.0.1', '::1']) {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html>
        <script>window.heights = []; addEventListener('message', e => { if (e.origin === '${new URL(BASE_URL).origin}') heights.push(e.data) })</script>
        <iframe src="${embedded}" style="width:400px;height:200px"></iframe>`)
    })
    await new Promise<void>((resolve, reject) => server.once('error', reject).listen(EMBEDDER_PORT, address, resolve))
    servers.push(server)
  }
})
test.afterAll(async () => {
  await Promise.all(servers.map(s => new Promise(resolve => s.close(resolve))))
})

test('Gästeseite im iFrame meldet ihre Höhe, ohne iFrame nicht', async ({ page }) => {
  const owner = await createAccount()
  const event = await createEvent(owner, { description: 'Ein langer Text.\n'.repeat(40) })
  embedded = `${BASE_URL}/${event.slug}`
  await page.goto(`http://localhost:${EMBEDDER_PORT}/`)
  const last = () => page.evaluate(() => (window as unknown as { heights: { type: string; height: number }[] }).heights.at(-1) ?? null)
  await expect.poll(last, { timeout: 15_000 }).toMatchObject({ type: 'suite:height', height: expect.any(Number) })
  // Höher als der Rahmen (langer Text) - min-h-screen am <body> ist eingebettet aufgehoben
  expect((await last())!.height).toBeGreaterThan(200)
  await expect(page.frameLocator('iframe').locator('html')).toHaveAttribute('data-suite-embedded', '')

  // Direkt aufgerufen: kein Attribut
  await page.goto(embedded)
  await expect(page.locator('html')).not.toHaveAttribute('data-suite-embedded', '')
})
