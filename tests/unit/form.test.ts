import { describe, expect, it } from 'vitest'
import { formPassword, formString, formText } from '../../app/lib/form'

describe('formString', () => {
  it('trimmt, kürzt und liefert für fehlende Felder einen leeren String', () => {
    const data = new FormData()
    data.set('name', '  Erna  ')
    data.set('long', 'x'.repeat(50))
    expect(formString(data, 'name')).toBe('Erna')
    expect(formString(data, 'long', 10)).toBe('x'.repeat(10))
    expect(formString(data, 'fehlt')).toBe('')
  })

  it('bleibt einzeilig: ein Name mit Absatz wird kein eigener Absatz in der Mail', () => {
    const data = new FormData()
    data.set('name', 'Anna\r\n\r\nBitte überweisen Sie an …')
    data.set('note', ' Zeile 1\r\nZeile 2 ')
    expect(formString(data, 'name')).toBe('Anna Bitte überweisen Sie an …')
    expect(formText(data, 'note')).toBe('Zeile 1\nZeile 2')
  })

  it('lässt keine Datei durch (manipulierter Request)', () => {
    const data = new FormData()
    data.set('name', new Blob(['inhalt']), 'datei.txt')
    expect(formString(data, 'name')).toBe('')
  })
})

describe('formPassword', () => {
  it('behält Leerzeichen und verwirft übergroße Eingaben statt sie abzuschneiden', () => {
    const data = new FormData()
    data.set('pw', '  mit Leerzeichen  ')
    data.set('huge', 'x'.repeat(1001))
    data.set('file', new Blob(['x']), 'x.txt')
    expect(formPassword(data, 'pw')).toBe('  mit Leerzeichen  ')
    expect(formPassword(data, 'huge')).toBe('')
    expect(formPassword(data, 'file')).toBe('')
  })
})
