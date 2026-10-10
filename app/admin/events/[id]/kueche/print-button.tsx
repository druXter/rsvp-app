// app/admin/events/[id]/kueche/print-button.tsx
'use client'

import { buttonClass } from '../../../../ui/kit'

export default function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClass('secondary')}>
      🖨️ Drucken
    </button>
  )
}
