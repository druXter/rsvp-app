import { describe, expect, it } from 'vitest'
import { escapeHtml } from '../../app/lib/escape-html'

describe('escapeHtml', () => {
  it('macht HTML aus Gast-Eingaben unschädlich', () => {
    expect(escapeHtml('<a href="https://evil">Jetzt zahlen</a>')).toBe('&lt;a href=&quot;https://evil&quot;&gt;Jetzt zahlen&lt;/a&gt;')
    expect(escapeHtml("Tom & Jerry's")).toBe('Tom &amp; Jerry&#39;s')
  })
  it('null und undefined ergeben einen leeren Text statt "null"', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })
})
