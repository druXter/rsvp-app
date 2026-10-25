import { describe, expect, it } from 'vitest'
import manifest from '../../app/manifest'

describe('manifest', () => {
  it('eine App für die ganze Seite: Links auf Termine öffnen in der installierten App, im laufenden Fenster', () => {
    const m = manifest()
    // id wie der bisherige Standardwert (start_url) - sonst wäre jede Installation danach eine andere App
    expect(m).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone' })
    expect(m.launch_handler).toEqual({ client_mode: ['navigate-existing', 'auto'] })
  })
})
