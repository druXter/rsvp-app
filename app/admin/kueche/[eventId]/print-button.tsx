// app/admin/kueche/[eventId]/print-button.tsx
'use client'

export default function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="text-sm font-medium text-orange-700 dark:text-orange-300 hover:underline">
      🖨️ Drucken
    </button>
  )
}
