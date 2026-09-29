import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// linked-tools-notify.ts plant die Meldungen über next/server after() und liest über Prisma -
// beides wird hier nicht gebraucht (geprüft wird die reine Planung deliveriesFor und deliver).
vi.mock('next/server', () => ({ after: (task: () => unknown) => task() }))
vi.mock('../../app/lib/prisma', () => ({ prisma: {} }))

const {
  TOOL_DEFINITIONS, configuredTool, createSignedMessage, linkedToolsOf, openMessage, parseToolUrl, resolveConfiguredTool,
  resolveToolSecret, toolLinkOf, validToolLink, verifyEnvelope
} = await import('../../app/lib/linked-tools')
const { deliver, deliveriesFor } = await import('../../app/lib/linked-tools-notify')
const { createMessage } = await import('../../app/lib/seating')
type ToolDefinition = import('../../app/lib/linked-tools').ToolDefinition
type NotifiableTool = import('../../app/lib/linked-tools-notify').NotifiableTool
type RsvpState = import('../../app/lib/linked-tools-notify').RsvpState

// Zwei erfundene Tools - die Struktur muss mit mehreren Tools funktionieren, nicht nur mit Seating.
const alpha: ToolDefinition = {
  type: 'alpha', label: 'Alpha', linkLabel: 'Alpha-Link', secretEnv: 'ALPHA_SECRET', baseUrlEnv: 'ALPHA_BASE_URL',
  formField: 'alphaUrl', linkSegment: 'rsvp', remoteIdField: 'alphaEventId', webhookPath: '/api/rsvp-webhook'
}
const beta: ToolDefinition = {
  type: 'beta', label: 'Beta', linkLabel: 'Beta-Link', secretEnv: 'BETA_SECRET', baseUrlEnv: 'BETA_BASE_URL',
  formField: 'betaUrl', linkSegment: 'e', remoteIdField: 'betaEventId', webhookPath: '/hook'
}
const definitions = [alpha, beta]
const own = 'https://rsvp.example.test'
const alphaOrigin = 'https://alpha.example.test'
const betaOrigin = 'https://beta.example.test'
const alphaSecret = 'alpha-secret-0123456789abcdef0123456789'
const betaSecret = 'beta-secret-0123456789abcdef01234567890'
const env = {
  BASE_URL: own,
  ALPHA_SECRET: alphaSecret, ALPHA_BASE_URL: `${alphaOrigin}/`,
  BETA_SECRET: betaSecret, BETA_BASE_URL: betaOrigin,
  POLL_VERIFICATION_SECRET: 'poll-secret-0123456789abcdef0123456789'
}
const rsvpEventId = 'cmrsvpevent00000001'
const alphaEventId = 'cmalphaevent0000001'
const betaEventId = 'cmbetaevent00000001'
const alphaLink = { type: 'alpha', url: `${alphaOrigin}/rsvp/${alphaEventId}`, remoteEventId: alphaEventId }
const betaLink = { type: 'beta', url: `${betaOrigin}/e/${betaEventId}`, remoteEventId: betaEventId }

const tools = () => definitions.map(d => resolveConfiguredTool(d, env, definitions)!)

describe('Konfiguration je Tool', () => {
  it('jedes Tool hat sein eigenes Secret und seine eigene Adresse', () => {
    expect(resolveConfiguredTool(alpha, env, definitions)).toEqual({ definition: alpha, secret: alphaSecret, origin: alphaOrigin, ownOrigin: own })
    expect(resolveConfiguredTool(beta, env, definitions)).toEqual({ definition: beta, secret: betaSecret, origin: betaOrigin, ownOrigin: own })
  })

  it('zwei Tools mit demselben Secret: BEIDE nicht eingerichtet, unabhängig von der Reihenfolge', () => {
    const shared = { ...env, BETA_SECRET: alphaSecret }
    expect(resolveToolSecret(alpha, shared, definitions)).toBeNull()
    expect(resolveToolSecret(beta, shared, definitions)).toBeNull()
    expect(resolveToolSecret(alpha, shared, [beta, alpha])).toBeNull()
  })

  it('das Secret des Abstimmungstools ist nie ein Tool-Secret', () => {
    const reused = { ...env, ALPHA_SECRET: env.POLL_VERIFICATION_SECRET }
    expect(resolveToolSecret(alpha, reused, definitions)).toBeNull()
    expect(resolveToolSecret(beta, reused, definitions)).toBe(betaSecret)
  })

  it('zu kurzes Secret, fehlende Adresse des Tools oder dieser App: nicht eingerichtet', () => {
    expect(resolveConfiguredTool(alpha, { ...env, ALPHA_SECRET: 'zu-kurz' }, definitions)).toBeNull()
    expect(resolveConfiguredTool(alpha, { ...env, ALPHA_BASE_URL: undefined }, definitions)).toBeNull()
    expect(resolveConfiguredTool(alpha, { ...env, ALPHA_BASE_URL: 'javascript:alert(1)' }, definitions)).toBeNull()
    expect(resolveConfiguredTool(alpha, { ...env, BASE_URL: undefined }, definitions)).toBeNull()
  })
})

describe('Bisherige Seating-Konfiguration gilt unverändert', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    process.env.BASE_URL = own
    process.env.SEATING_SECRET = alphaSecret
    process.env.SEATING_BASE_URL = 'https://plaetze.example.test'
    process.env.POLL_VERIFICATION_SECRET = env.POLL_VERIFICATION_SECRET
  })
  afterEach(() => {
    process.env = { ...saved }
  })

  it('SEATING_SECRET und SEATING_BASE_URL richten das Tool "seating" ein', () => {
    expect(configuredTool('seating')).toMatchObject({ secret: alphaSecret, origin: 'https://plaetze.example.test', ownOrigin: own })
    delete process.env.SEATING_BASE_URL
    expect(configuredTool('seating')).toBeNull()
  })

  it('Vertragsdaten von Seating: Formularfeld, Link-Form, ID-Feld und Webhook-Pfad wie bisher', () => {
    expect(TOOL_DEFINITIONS.find(d => d.type === 'seating')).toMatchObject({
      secretEnv: 'SEATING_SECRET', baseUrlEnv: 'SEATING_BASE_URL', formField: 'seatingUrl',
      linkSegment: 'rsvp', remoteIdField: 'seatingEventId', webhookPath: '/api/rsvp-webhook'
    })
  })

  it('ein übernommener Link (EventToolLink "seating") gilt wie früher seatingUrl', () => {
    const seatingEventId = 'cmseatingevent00001'
    const event = { id: rsvpEventId, toolLinks: [{ type: 'seating', url: `https://plaetze.example.test/rsvp/${seatingEventId}`, remoteEventId: seatingEventId }] }
    expect(toolLinkOf(event, 'seating')).toMatchObject({ origin: 'https://plaetze.example.test', remoteEventId: seatingEventId })
    process.env.SEATING_BASE_URL = 'https://anders.example.test'
    expect(toolLinkOf(event, 'seating')).toBeNull()
  })
})

describe('Secret und Empfänger eines Tools gelten nie für ein anderes', () => {
  const now = new Date('2026-10-01T12:00:00Z')
  const fromAlpha = createSignedMessage('guest-list-request', { aud: own, alphaEventId, rsvpEventId }, alphaSecret, { now })

  it('eine Nachricht von Alpha gilt nur mit Alphas Secret und Alphas ID-Feld', () => {
    expect(verifyEnvelope(fromAlpha, 'guest-list-request', { secret: alphaSecret, audience: own, remoteIdField: 'alphaEventId', now }))
      .toMatchObject({ envelope: { remoteEventId: alphaEventId, rsvpEventId } })
    expect(verifyEnvelope(fromAlpha, 'guest-list-request', { secret: betaSecret, audience: own, remoteIdField: 'alphaEventId', now })).toBeNull()
    expect(verifyEnvelope(fromAlpha, 'guest-list-request', { secret: alphaSecret, audience: own, remoteIdField: 'betaEventId', now })).toBeNull()
  })

  it('eine Nachricht an Alpha gilt nicht als Nachricht an diese App (aud)', () => {
    const toAlpha = createSignedMessage('guest-list-request', { aud: alphaOrigin, alphaEventId, rsvpEventId }, alphaSecret, { now })
    expect(verifyEnvelope(toAlpha, 'guest-list-request', { secret: alphaSecret, audience: own, remoteIdField: 'alphaEventId', now })).toBeNull()
  })

  it('Links werden nur für das eigene Tool angenommen', () => {
    expect(parseToolUrl(alpha, alphaLink.url, alphaOrigin)).toMatchObject({ type: 'alpha', remoteEventId: alphaEventId })
    expect(parseToolUrl(alpha, betaLink.url, alphaOrigin)).toBeNull()
    expect(parseToolUrl(beta, alphaLink.url, betaOrigin)).toBeNull()
    expect(parseToolUrl(alpha, `${betaOrigin}/rsvp/${alphaEventId}`, alphaOrigin)).toBeNull()
  })

  it('eine gespeicherte Verknüpfung gilt nur für ihren Typ und nur, wenn url und ID zusammenpassen', () => {
    const [alphaTool] = tools()
    expect(validToolLink(alphaTool, rsvpEventId, alphaLink)).not.toBeNull()
    expect(validToolLink(alphaTool, rsvpEventId, { ...alphaLink, type: 'beta' })).toBeNull()
    expect(validToolLink(alphaTool, rsvpEventId, { ...alphaLink, remoteEventId: 'cmanderesevent00001' })).toBeNull()
    expect(validToolLink(alphaTool, 'x', alphaLink)).toBeNull()
  })
})

describe('Webhook nur an verknüpfte Tools', () => {
  const recordingTools = (): NotifiableTool[] => tools().map(tool => ({
    ...tool,
    rsvpChange: input => createSignedMessage('rsvp-change', {
      aud: input.link.origin, [tool.definition.remoteIdField]: input.link.remoteEventId, rsvpEventId: input.rsvpEventId,
      rsvpId: input.rsvp.id, attending: !input.deleted && input.rsvp.isAttending
    }, input.secret)
  }))
  const rsvp = (toolLinks: RsvpState['event']['toolLinks']): RsvpState => ({
    id: 'cmrsvpanswer0000001', isAttending: true, isOnWaitlist: false, plusOne: false, plusOneName: null,
    participant: { name: 'Erika', email: null, isVerified: true },
    event: { id: rsvpEventId, requireVerification: false, series: null, toolLinks }
  })

  it('Termin ohne Verknüpfung, mit unbekanntem Typ oder ungültigem Link: keine Meldung', () => {
    expect(deliveriesFor(rsvp([]), false, recordingTools())).toEqual([])
    expect(deliveriesFor(rsvp([{ ...alphaLink, type: 'gamma' }]), false, recordingTools())).toEqual([])
    expect(deliveriesFor(rsvp([{ ...alphaLink, url: `https://intern.example.test/rsvp/${alphaEventId}` }]), false, recordingTools())).toEqual([])
  })

  it('nur mit Alpha verknüpft: genau eine Meldung, an Alpha, mit Alphas Secret', () => {
    const deliveries = deliveriesFor(rsvp([alphaLink]), false, recordingTools())
    expect(deliveries.map(d => d.url)).toEqual([`${alphaOrigin}/api/rsvp-webhook`])
    expect(openMessage(deliveries[0].body, alphaSecret)).toMatchObject({ aud: alphaOrigin, alphaEventId, attending: true })
    expect(openMessage(deliveries[0].body, betaSecret)).toBeNull()
  })

  it('mit beiden verknüpft: je Tool eine eigene Nachricht, eigenes Secret, eigener Empfänger', () => {
    const deliveries = deliveriesFor(rsvp([alphaLink, betaLink]), true, recordingTools())
    expect(deliveries.map(d => d.url)).toEqual([`${alphaOrigin}/api/rsvp-webhook`, `${betaOrigin}/hook`])
    expect(openMessage(deliveries[1].body, betaSecret)).toMatchObject({ aud: betaOrigin, betaEventId, attending: false })
    expect(openMessage(deliveries[1].body, alphaSecret)).toBeNull()
  })

  it('pro Tool in Reihenfolge, ein nicht erreichbares Tool hält die anderen nicht auf', async () => {
    const calls: string[] = []
    const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
      calls.push(`${url} ${init.body}`)
      if (url.startsWith(betaOrigin)) throw new Error('nicht erreichbar')
      return new Response('ok')
    })
    vi.stubGlobal('fetch', fetchMock)
    await deliver([
      { url: `${alphaOrigin}/a`, body: '1' }, { url: `${betaOrigin}/b`, body: '2' }, { url: `${alphaOrigin}/a`, body: '3' }
    ])
    vi.unstubAllGlobals()
    expect(calls.filter(c => c.startsWith(alphaOrigin))).toEqual([`${alphaOrigin}/a 1`, `${alphaOrigin}/a 3`])
    expect(calls).toContain(`${betaOrigin}/b 2`)
  })

  describe('Seating: Inhalt wie bisher', () => {
    const saved = { ...process.env }
    const now = new Date('2026-10-01T12:00:00Z')
    beforeEach(() => {
      process.env.BASE_URL = own
      process.env.SEATING_SECRET = alphaSecret
      process.env.SEATING_BASE_URL = 'https://plaetze.example.test'
      vi.useFakeTimers({ now })
    })
    afterEach(() => {
      process.env = { ...saved }
      vi.useRealTimers()
    })

    it('rsvp-change byte-gleich zur bisherigen Nachricht an <Seating>/api/rsvp-webhook', () => {
      const seatingEventId = 'cmseatingevent00001'
      const state = rsvp([{ type: 'seating', url: `https://plaetze.example.test/rsvp/${seatingEventId}`, remoteEventId: seatingEventId }])
      state.plusOne = true
      state.plusOneName = 'Max'
      const [delivery] = deliveriesFor(state, false)
      expect(delivery.url).toBe('https://plaetze.example.test/api/rsvp-webhook')
      expect(delivery.body).toBe(createMessage('rsvp-change', {
        aud: 'https://plaetze.example.test', seatingEventId, rsvpEventId,
        rsvpId: state.id, name: 'Erika', email: null, companions: ['Max'], attending: true
      }, alphaSecret, { now }))
      expect(openMessage(deliveriesFor(state, true)[0].body, alphaSecret)).toMatchObject({ attending: false })
    })
  })
})

describe('linkedToolsOf', () => {
  it('liefert jedes gültig verknüpfte Tool genau einmal mit seinem Link', () => {
    const result = linkedToolsOf({ id: rsvpEventId, toolLinks: [betaLink, { ...alphaLink, type: 'gamma' }] }, tools())
    expect(result.map(r => [r.tool.definition.type, r.link.remoteEventId])).toEqual([['beta', betaEventId]])
  })
})
